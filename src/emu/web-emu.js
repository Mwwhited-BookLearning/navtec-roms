#!/usr/bin/env node
'use strict';
/*
 * web-emu.js -- browser front end for the 8085 emulator.
 *
 * Runs the emulator continuously in the background (paced to roughly the
 * assumed 5 MHz CPU clock -- see docs/hardware.md's crystal discussion) and
 * serves a single-page UI (src/emu/web/index.html) that models the front
 * panel switches described in docs/front-panel.md, the 7-segment display,
 * a small "blinkenlights" panel for a few real internal signals, a serial
 * console bridged to the emulated 8251A, and controls for the synthetic
 * Loran-C receiver front end. See docs/web-emulator.md.
 *
 * Usage:  node src/emu/web-emu.js [--port 8085]
 *
 * No external dependencies (plain Node http). Not verified against real
 * hardware -- same caveats as docs/emulator.md, all the way down.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Cpu8085, Bus, ReceiverFrontEnd, loadSymbols } = require('./emu8085.js');
const loran = require('./loran-chains.js');

const base = path.resolve(__dirname, '..', '..');

function argVal(flag, def) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : def;
}
const PORT = parseInt(argVal('--port', '8085'), 10);

const rom1Buf = fs.readFileSync(path.join(base, 'originals', 'CN19229N NT3321 7943.BIN'));
const rom2Buf = fs.readFileSync(path.join(base, 'originals', 'CN19230N NT3322 7943.BIN'));
const symbols = loadSymbols(path.join(base, 'disasm', 'nt3321-22.json'));

// ---------------------------------------------------------------- UI state
// The server is the source of truth for switch/button/receiver settings so
// a reset can reapply them without the browser having to resend anything.
const uiState = {
  digits: [1, 2, 9, 9, 4, 0], // SEL_A, SEL_B, GRI1..4 -- a valid combination out of the box
  buttons: { A: false, B: false },
  receiverMode: 'master',
  noise: 0, // 0-100
  loranOverride: { tdA: null, tdB: null }, // manual TD entry (microseconds), bypasses the live display -- see docs/web-emulator.md
};

function encodeDigit(d) { return (d === null || d === undefined) ? 0x0B : (9 - Number(d)) & 0x3F; }

let bus, cpu, frontEnd;
let running = true;
let speed = 1;
let lastError = null;
let serialOutBuf = '';
const telemetry = { sample: 0, tick: 0, tx: 0 };

function applySwitchesFromUiState() {
  for (let row = 0; row < 6; row++) bus.kdc.setSensorRow(row, encodeDigit(uiState.digits[row]));
}
function applyButtonsFromUiState() {
  const row = (uiState.buttons.A ? 0x80 : 0) | (uiState.buttons.B ? 0x40 : 0);
  bus.kdc.setSensorRow(6, row);
  bus.kdc.setSensorRow(7, row);
}

function wireHooks() {
  bus.usart.onTx = (byte) => {
    serialOutBuf += String.fromCharCode(byte);
    if (serialOutBuf.length > 8000) serialOutBuf = serialOutBuf.slice(-8000);
    telemetry.tx++;
  };
  frontEnd.onSample = () => { telemetry.sample++; };
  bus.onTick = () => { telemetry.tick++; };
}

// The 8155#1 timer callback in Bus only calls requestInterrupt('7.5') directly;
// route it through bus.onTick too so the web UI can show tick activity.
function patchTickHook() {
  const origRst75 = bus.pio1_rst75.bind(bus);
  bus.pio1_rst75 = () => { origRst75(); if (bus.onTick) bus.onTick(); };
}

function resetAll() {
  bus = new Bus();
  bus.loadRom(rom1Buf, 0);
  bus.loadRom(rom2Buf, 0x1000);
  cpu = new Cpu8085(bus);
  bus.attachCpu(cpu);
  cpu.symbols = symbols;
  frontEnd = new ReceiverFrontEnd(cpu, bus.pio2, uiState.receiverMode);
  frontEnd.setNoise(uiState.noise / 100);
  bus.frontEnd = frontEnd;
  patchTickHook();
  wireHooks();
  applySwitchesFromUiState();
  applyButtonsFromUiState();
  lastError = null;
  serialOutBuf = '';
  running = true;
}
resetAll();

// ---------------------------------------------------------------- run loop
const HZ = 5_000_000; // assumed CPU clock -- see docs/hardware.md's crystal section
const TICK_MS = 20;
function loop() {
  if (running && !lastError) {
    const budget = HZ * (TICK_MS / 1000) * speed;
    const start = cpu.cycles;
    let count = 0;
    try {
      while (cpu.cycles - start < budget && count < 2_000_000) {
        cpu.step();
        count++;
        if (cpu.unknownOpcodeAt !== null) { running = false; lastError = `unimplemented opcode at ${cpu.unknownOpcodeAt.toString(16)}`; break; }
      }
    } catch (e) {
      running = false;
      lastError = String((e && e.stack) || e);
    }
  }
  setTimeout(loop, TICK_MS);
}
loop();

// ---------------------------------------------------------------- state snapshot
function symbolFor(pc) {
  if (!symbols) return null;
  let best = null;
  for (const [a, name] of symbols) if (a <= pc && (!best || a > best[0])) best = [a, name];
  return best ? `${best[1]}+${pc - best[0]}` : null;
}
function decodeDisplay(kdc) {
  const hi = (b) => (b >> 4) & 0xF, lo = (b) => b & 0xF;
  const rowA = [], rowB = [];
  for (let i = 0; i < 6; i++) { rowA.push(hi(kdc.displayRAM[i])); rowB.push(lo(kdc.displayRAM[i])); }
  const extra = kdc.displayRAM[6];
  return { rowA, rowB, extraHi: hi(extra), extraLo: lo(extra) };
}

// Six BCD digits -> DDDDD.D microseconds (front-panel.md: "five digits plus
// tenths"). Returns null if any nibble isn't a real BCD digit (0-9) -- e.g.
// right after the 8279 clear, or mid lamp-test -- rather than showing a
// bogus number.
function decodeTdMicros(digits) {
  if (digits.some((d) => d > 9)) return null;
  return digits.reduce((acc, d) => acc * 10 + d, 0) / 10;
}

// Illustrative Loran-C hyperbolic fix from the current display -- see
// docs/web-emulator.md's "Position map" section for exactly what this does
// and doesn't claim. Never throws; returns { available:false, reason }
// when there isn't enough to work with.
function computeLoranFix(display) {
  const griDigits = uiState.digits.slice(2, 6).map((d) => (d === null ? 0 : d));
  const gri = griDigits.join('');
  const chain = loran.CHAINS[gri];
  if (!chain) return { available: false, reason: `no known station geometry for GRI ${gri}` };

  const secA = loran.secondaryForIndex(chain, (uiState.digits[0] === null ? -1 : uiState.digits[0]) + 1);
  const secB = loran.secondaryForIndex(chain, (uiState.digits[1] === null ? -1 : uiState.digits[1]) + 1);
  if (!secA || !secB) return { available: false, reason: 'SEL A / SEL B not set to a valid station' };

  const ov = uiState.loranOverride;
  const usingOverride = ov.tdA !== null && ov.tdB !== null;
  const tdA = usingOverride ? ov.tdA : decodeTdMicros(display.rowA);
  const tdB = usingOverride ? ov.tdB : decodeTdMicros(display.rowB);
  if (tdA === null || tdB === null) {
    return {
      available: false,
      reason: usingOverride ? 'invalid override value' :
        'display not showing valid BCD digits yet (the synthetic receiver front end has not reached a signal lock -- see docs/emulator.md\'s known limitations); try manual TD entry below',
    };
  }

  const { toXY, fromXY } = loran.project(chain);
  const mXY = { x: 0, y: 0 };
  const sAxy = toXY(chain.stations[secA].lat, chain.stations[secA].lon);
  const sBxy = toXY(chain.stations[secB].lat, chain.stations[secB].lon);
  const v = loran.C_KM_S * loran.VELOCITY_FACTOR;
  const cA = Math.hypot(sAxy.x, sAxy.y) / 2;
  const cB = Math.hypot(sBxy.x, sBxy.y) / 2;
  const dA = loran.wrapToBaseline((tdA / 1e6) * v, cA * 0.98);
  const dB = loran.wrapToBaseline((tdB / 1e6) * v, cB * 0.98);

  const fixXY = loran.solveFix(mXY, sAxy, dA, sBxy, dB);
  const stations = Object.entries(chain.stations).map(([id, s]) => ({ id, name: s.name, ...toXY(s.lat, s.lon) }));
  let fix = null;
  if (fixXY) { const ll = fromXY(fixXY.x, fixXY.y); fix = { x: fixXY.x, y: fixXY.y, lat: ll.lat, lon: ll.lon }; }

  return {
    available: true, usingOverride, chainName: chain.name, gri, secA, secB, tdA, tdB, stations,
    hypA: loran.hyperbolaPoints(mXY, sAxy, dA), hypB: loran.hyperbolaPoints(mXY, sBxy, dB),
    fix,
    note: "TD folded into this station pair's valid geometric range (real per-secondary coding delays aren't known here); illustrates the hyperbolic-fix technique, not a real position -- see docs/web-emulator.md.",
  };
}
function buildState() {
  const t = { sample: telemetry.sample, tick: telemetry.tick, tx: telemetry.tx };
  telemetry.sample = 0; telemetry.tick = 0; telemetry.tx = 0;
  const display = decodeDisplay(bus.kdc);
  return {
    running, speed, error: lastError,
    cpu: {
      pc: cpu.PC, sp: cpu.SP, a: cpu.A, b: cpu.B, c: cpu.C, d: cpu.D, e: cpu.E, h: cpu.H, l: cpu.L,
      flags: { s: cpu.flagS, z: cpu.flagZ, ac: cpu.flagAC, p: cpu.flagP, cy: cpu.flagCY },
      ie: cpu.IE, halted: cpu.halted, cycles: cpu.cycles, symbol: symbolFor(cpu.PC),
    },
    display,
    loran: computeLoranFix(display),
    leds: {
      busy: !!(bus.pio1.PC & 0x01),
      sample: t.sample > 0, tick: t.tick > 0, tx: t.tx > 0,
      ie: cpu.IE, halted: cpu.halted, kdcIrq: bus.kdc.irqPending,
    },
    uiState,
    serial: serialOutBuf,
    receiver: { mode: frontEnd.mode, noise: uiState.noise, samples: frontEnd.sampleTotal },
  };
}

// ---------------------------------------------------------------- HTTP server
function sendJson(res, obj, code) {
  const body = JSON.stringify(obj);
  res.writeHead(code || 200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}
function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}
function readJsonBody(req, cb) {
  let data = '';
  req.on('data', (c) => { data += c; });
  req.on('end', () => { let body = {}; try { body = data ? JSON.parse(data) : {}; } catch (e) { /* ignore malformed body */ } cb(body); });
}

function handlePost(pathname, body, res) {
  try {
    switch (pathname) {
      case '/api/switch': {
        const row = Number(body.row);
        if (row >= 0 && row <= 5) { uiState.digits[row] = body.value === 'blank' ? null : Number(body.value); applySwitchesFromUiState(); bus.kdc.raiseIrq(); }
        break;
      }
      case '/api/button': {
        const name = body.name === 'A' || body.name === 'B' ? body.name : null;
        if (name) { uiState.buttons[name] = !!body.pressed; applyButtonsFromUiState(); bus.kdc.raiseIrq(); }
        break;
      }
      case '/api/serial': {
        const text = String(body.text || '');
        for (let i = 0; i < text.length; i++) bus.usart.injectRx(text.charCodeAt(i));
        break;
      }
      case '/api/control': {
        if (body.action === 'run') running = true;
        else if (body.action === 'pause') running = false;
        else if (body.action === 'reset') resetAll();
        else if (body.action === 'speed') speed = Math.max(0.1, Math.min(50, Number(body.value) || 1));
        break;
      }
      case '/api/receiver': {
        if (body.mode) { uiState.receiverMode = body.mode; frontEnd.setMode(body.mode); }
        if (body.noise !== undefined) { uiState.noise = Math.max(0, Math.min(100, Number(body.noise) || 0)); frontEnd.setNoise(uiState.noise / 100); }
        break;
      }
      case '/api/loran': {
        const parseOrNull = (v) => (v === '' || v === null || v === undefined) ? null : (Number.isFinite(Number(v)) ? Number(v) : null);
        uiState.loranOverride.tdA = parseOrNull(body.tdA);
        uiState.loranOverride.tdB = parseOrNull(body.tdB);
        break;
      }
      default:
        sendJson(res, { ok: false, error: 'unknown endpoint' }, 404);
        return;
    }
    sendJson(res, { ok: true });
  } catch (e) {
    sendJson(res, { ok: false, error: String(e) }, 500);
  }
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && u.pathname === '/') { serveFile(res, path.join(__dirname, 'web', 'index.html'), 'text/html'); return; }
  if (req.method === 'GET' && u.pathname === '/api/state') { sendJson(res, buildState()); return; }
  if (req.method === 'POST' && u.pathname.startsWith('/api/')) { readJsonBody(req, (body) => handlePost(u.pathname, body, res)); return; }
  res.writeHead(404); res.end('not found');
});

server.listen(PORT, () => {
  console.error(`web-emu: http://localhost:${PORT}`);
  console.error('web-emu: not verified against real hardware -- see docs/web-emulator.md and docs/emulator.md');
});
