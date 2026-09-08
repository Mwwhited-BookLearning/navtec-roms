'use strict';
/*
 * loran-chains.js -- real historical Loran-C chain geometry, used only to
 * draw an illustrative hyperbolic position fix from the emulator's TD-A/
 * TD-B readout. See docs/web-emulator.md's "Position map" section for
 * exactly what this does and doesn't claim -- short version: the geometry
 * (station coordinates) is real, the math (hyperbolic line-of-position,
 * two-hyperbola intersection) is real and standard for Loran-C, but the
 * TD values feeding it come from a synthetic receiver front end that does
 * not simulate real signal propagation, so the resulting "fix" is a
 * demonstration of the technique, not a real position.
 *
 * Station coordinates are approximate, from general public historical
 * Loran-C references, not independently re-verified in this project
 * against a primary source (e.g. the Coast Guard's official station list).
 * Good enough for a schematic map; not for navigation.
 */

const KM_PER_DEG_LAT = 111.32;
const C_KM_S = 299792.458; // speed of light, km/s
const VELOCITY_FACTOR = 0.9996; // rough groundwave factor -- no ASF correction applied

const CHAINS = {
  // GRI 9940, "Northeast US" chain -- notable here only because it's exactly
  // the GRI the web UI's default switch panel dials in (GRI1..4 = 9,9,4,0).
  '9940': {
    name: 'Northeast US',
    stations: {
      M: { name: 'Seneca, NY (master)', lat: 42.7139, lon: -76.8267 },
      W: { name: 'Caribou, ME', lat: 46.8078, lon: -68.0128 },
      X: { name: 'Nantucket, MA', lat: 41.2533, lon: -69.9775 },
      Y: { name: 'Carolina Beach, NC', lat: 34.0628, lon: -77.9128 },
      Z: { name: 'Dana, IN', lat: 39.8664, lon: -87.4894 },
    },
    order: ['W', 'X', 'Y', 'Z'],
  },
};

// Local equirectangular projection centered on the chain's master station --
// fine for a regional schematic at this scale, not a claim of geodetic rigor.
function project(chain) {
  const m = chain.stations.M;
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos((m.lat * Math.PI) / 180);
  const toXY = (lat, lon) => ({ x: (lon - m.lon) * kmPerDegLon, y: (lat - m.lat) * KM_PER_DEG_LAT });
  const fromXY = (x, y) => ({ lat: m.lat + y / KM_PER_DEG_LAT, lon: m.lon + x / kmPerDegLon });
  return { toXY, fromXY };
}

// front-panel.md: SEL_A/SEL_B are stored as the dialed digit + 1 (1..9).
// Map that 1-based index onto the chain's secondaries, cycling if the
// chain has fewer than 9 of them (real Loran-C chains have 2-5).
function secondaryForIndex(chain, idx) {
  if (!idx || idx < 1) return null;
  return chain.order[(idx - 1) % chain.order.length];
}

// Fold an arbitrary distance-difference into the valid (-maxAbs, maxAbs)
// range for a station pair via modulo. Real Loran-C receivers subtract a
// published per-secondary coding delay before this step; this project
// doesn't have verified coding-delay values, so instead of guessing at
// one, the raw (synthetic, physically-meaningless-anyway) TD is wrapped
// into range so a fix can usually still be drawn. This is explicitly an
// illustration of the hyperbolic-fix technique, not a real correction.
function wrapToBaseline(d, maxAbs) {
  const span = maxAbs * 2;
  return (((d + maxAbs) % span) + span) % span - maxAbs;
}

// Analytic two-foci hyperbola: locus of P where dist(P,M) - dist(P,S) = dKm.
// Foci separated by 2c; constant difference 2a; b^2 = c^2 - a^2. Only the
// branch actually satisfying that signed equation is returned (not its
// mirror image), parametrized the standard way -- x = a*cosh(t), y =
// b*sinh(t) in the frame with foci on the x-axis -- rather than solving for
// y at each x, which divides by a^2 and blows up as a -> 0. a -> 0 is a
// real, common case here: it's the near-degenerate hyperbola approaching
// the perpendicular bisector, which happens whenever the folded TD (see
// wrapToBaseline) lands close to zero.
function hyperbolaPoints(mXY, sXY, dKm, n) {
  const dx = sXY.x - mXY.x, dy = sXY.y - mXY.y;
  const c = Math.hypot(dx, dy) / 2;
  const a = dKm / 2;
  if (c < 1e-6 || Math.abs(a) >= c) return [];
  const b = Math.sqrt(Math.max(c * c - a * a, 1e-9));
  const midx = (mXY.x + sXY.x) / 2, midy = (mXY.y + sXY.y) / 2;
  const theta = Math.atan2(dy, dx);
  const cosT = Math.cos(theta), sinT = Math.sin(theta);
  const steps = n || 80;
  const tMax = 2.5; // cosh/sinh(2.5) ~ 6.1x -- enough arc to read as a curve without running off a regional map
  const signA = a >= 0 ? 1 : -1;
  const absA = Math.abs(a) || 1e-6;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = -tMax + (2 * tMax) * (i / steps);
    const xf = signA * absA * Math.cosh(t);
    const yf = b * Math.sinh(t);
    pts.push({ x: midx + xf * cosT - yf * sinT, y: midy + xf * sinT + yf * cosT });
  }
  return pts;
}

// Newton-Raphson intersection of two hyperbolas (shared focus M, secondaries
// s1/s2), via a numeric Jacobian -- simple and adequate for this demo scale.
function solveFix(mXY, s1XY, d1Km, s2XY, d2Km, guess) {
  let P = guess || { x: (mXY.x + s1XY.x + s2XY.x) / 3, y: (mXY.y + s1XY.y + s2XY.y) / 3 };
  const f = (p) => {
    const dm = Math.hypot(p.x - mXY.x, p.y - mXY.y);
    const d1 = Math.hypot(p.x - s1XY.x, p.y - s1XY.y);
    const d2 = Math.hypot(p.x - s2XY.x, p.y - s2XY.y);
    return [dm - d1 - d1Km, dm - d2 - d2Km];
  };
  const h = 1e-3;
  for (let iter = 0; iter < 25; iter++) {
    const F = f(P);
    if (Math.hypot(F[0], F[1]) < 1e-6) break;
    const Fx = f({ x: P.x + h, y: P.y });
    const Fy = f({ x: P.x, y: P.y + h });
    const J = [[(Fx[0] - F[0]) / h, (Fy[0] - F[0]) / h], [(Fx[1] - F[1]) / h, (Fy[1] - F[1]) / h]];
    const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
    if (Math.abs(det) < 1e-9) return null;
    const dx = (F[0] * J[1][1] - F[1] * J[0][1]) / det;
    const dy = (F[1] * J[0][0] - F[0] * J[1][0]) / det;
    P = { x: P.x - dx, y: P.y - dy };
    if (!isFinite(P.x) || !isFinite(P.y)) return null;
  }
  const F = f(P);
  if (Math.hypot(F[0], F[1]) > 1) return null; // didn't converge to a sane tolerance (km)
  return P;
}

module.exports = { CHAINS, project, secondaryForIndex, wrapToBaseline, hyperbolaPoints, solveFix, C_KM_S, VELOCITY_FACTOR };
