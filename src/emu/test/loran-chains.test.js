'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const loran = require('../loran-chains.js');

const chain = loran.CHAINS['9940'];
const { toXY, fromXY } = loran.project(chain);

describe('project(): local equirectangular projection centered on the master', () => {
  it('maps the master station itself to the origin', () => {
    const p = toXY(chain.stations.M.lat, chain.stations.M.lon);
    assert.ok(Math.abs(p.x) < 1e-9 && Math.abs(p.y) < 1e-9);
  });

  it('toXY/fromXY round-trip a secondary station', () => {
    const s = chain.stations.X;
    const p = toXY(s.lat, s.lon);
    const back = fromXY(p.x, p.y);
    assert.ok(Math.abs(back.lat - s.lat) < 1e-9);
    assert.ok(Math.abs(back.lon - s.lon) < 1e-9);
  });
});

describe('secondaryForIndex', () => {
  it('maps 1-based indices onto the chain\'s secondary order', () => {
    assert.equal(loran.secondaryForIndex(chain, 1), 'W');
    assert.equal(loran.secondaryForIndex(chain, 2), 'X');
    assert.equal(loran.secondaryForIndex(chain, 3), 'Y');
    assert.equal(loran.secondaryForIndex(chain, 4), 'Z');
  });

  it('wraps around for a chain with fewer than 9 secondaries', () => {
    assert.equal(loran.secondaryForIndex(chain, 5), 'W');
  });

  it('returns null for an out-of-range index', () => {
    assert.equal(loran.secondaryForIndex(chain, 0), null);
    assert.equal(loran.secondaryForIndex(chain, -1), null);
  });
});

describe('wrapToBaseline', () => {
  it('leaves an in-range value unchanged', () => {
    assert.ok(Math.abs(loran.wrapToBaseline(5, 10) - 5) < 1e-9);
    assert.ok(Math.abs(loran.wrapToBaseline(-5, 10) - -5) < 1e-9);
  });

  it('folds a value outside the range back into it', () => {
    // 25 folded into (-10,10): 25 - 2*20 = -15 -> still out; work it by hand: span=20,
    // ((25+10) % 20 + 20) % 20 - 10 = (35%20)-10 = 15-10 = 5
    assert.ok(Math.abs(loran.wrapToBaseline(25, 10) - 5) < 1e-9);
  });

  it('the result always lands within (-maxAbs, maxAbs]', () => {
    for (const v of [0, 1, 10, 10.0001, 999, -999, 12345.6]) {
      const r = loran.wrapToBaseline(v, 50);
      assert.ok(r > -50 - 1e-9 && r <= 50 + 1e-9, `wrapToBaseline(${v},50) = ${r}`);
    }
  });
});

describe('hyperbolaPoints', () => {
  const m = { x: 0, y: 0 };
  const s = { x: 100, y: 0 }; // c = 50

  it('returns [] when the target difference is not achievable (|a| >= c)', () => {
    assert.deepEqual(loran.hyperbolaPoints(m, s, 200), []);
    assert.deepEqual(loran.hyperbolaPoints(m, s, -200), []);
  });

  it('returns [] for coincident foci', () => {
    assert.deepEqual(loran.hyperbolaPoints(m, m, 1), []);
  });

  it('every returned point actually satisfies dist(P,M) - dist(P,S) = dKm', () => {
    for (const dKm of [40, 10, 0.001, -30]) {
      const pts = loran.hyperbolaPoints(m, s, dKm);
      assert.ok(pts.length > 10);
      for (const p of pts) {
        const diff = Math.hypot(p.x - m.x, p.y - m.y) - Math.hypot(p.x - s.x, p.y - s.y);
        assert.ok(Math.abs(diff - dKm) < 1e-6, `point (${p.x},${p.y}) gives diff ${diff}, expected ${dKm}`);
      }
    }
  });

  it('regression: does not blow up as the folded TD approaches zero (near-degenerate hyperbola)', () => {
    // The original x-parametrization divided by a^2 and produced points tens
    // of thousands of km away exactly in this case. The cosh/sinh
    // parametrization must keep points bounded near the station scale.
    const pts = loran.hyperbolaPoints(m, s, 1e-6);
    assert.ok(pts.length > 10);
    for (const p of pts) {
      assert.ok(Math.abs(p.x) < 1000 && Math.abs(p.y) < 1000, `point (${p.x},${p.y}) is unreasonably far for a c=50 station pair`);
    }
  });
});

describe('solveFix', () => {
  it('recovers a known point from its exact distance differences', () => {
    const m = { x: 0, y: 0 };
    const s1 = { x: 300, y: 0 };
    const s2 = { x: 0, y: 300 };
    const p0 = { x: 40, y: -60 }; // some arbitrary point not on either foci axis
    const d1 = Math.hypot(p0.x - m.x, p0.y - m.y) - Math.hypot(p0.x - s1.x, p0.y - s1.y);
    const d2 = Math.hypot(p0.x - m.x, p0.y - m.y) - Math.hypot(p0.x - s2.x, p0.y - s2.y);
    const fix = loran.solveFix(m, s1, d1, s2, d2);
    assert.ok(fix, 'solver must converge for a well-posed, consistent system');
    assert.ok(Math.abs(fix.x - p0.x) < 1e-3, `x: ${fix.x} vs ${p0.x}`);
    assert.ok(Math.abs(fix.y - p0.y) < 1e-3, `y: ${fix.y} vs ${p0.y}`);
  });

  it('returns null for a geometrically inconsistent system', () => {
    const m = { x: 0, y: 0 };
    const s1 = { x: 10, y: 0 };
    const s2 = { x: -10, y: 0 };
    // Impossible: both differences pinned to the same, very large value.
    const fix = loran.solveFix(m, s1, 1e9, s2, 1e9);
    assert.equal(fix, null);
  });
});
