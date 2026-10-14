'use strict';
// Front-end model sensitivity sweep: which unverified assumptions does the firmware's lock
// acquisition actually depend on?  Usage: node src/emu/sensitivity.js [maxSteps]
// For each variant it runs the stock ROMs from reset and reports whether the firmware reaches
// MASTER_FOUND (0x1B0) and holds TRACK_LOOP (0x21B), and at which step.
const fs = require('fs');
const path = require('path');
const { Cpu8085, Bus, ReceiverFrontEnd } = require('./emu8085.js');

const base = path.resolve(__dirname, '..', '..');
const MASTER_FOUND = 0x1B0, TRACK_LOOP = 0x21B;
const max = Number(process.argv[2] || 8000000);

const variants = [
  ['baseline (gate +4, B=PC4/C=PC3, 99)', {}],
  ['gateOffset 3', { gateOffset: 3 }],
  ['gateOffset 5', { gateOffset: 5 }],
  ['gateOffset 0', { gateOffset: 0 }],
  ['B/C taps swapped', { swapBC: true }],
  ['periodSamples 98', { periodSamples: 98 }],
  ['periodSamples 100', { periodSamples: 100 }],
  ['periodSamples 49', { periodSamples: 49 }],
];

function run(opts, mode) {
  const bus = new Bus();
  bus.loadRom(fs.readFileSync(path.join(base, 'originals', 'CN19229N NT3321 7943.BIN')), 0);
  bus.loadRom(fs.readFileSync(path.join(base, 'originals', 'CN19230N NT3322 7943.BIN')), 0x1000);
  const cpu = new Cpu8085(bus); bus.attachCpu(cpu);
  bus.frontEnd = new ReceiverFrontEnd(cpu, bus.pio2, mode, bus.pio1, opts);
  [1, 2, 9, 9, 4, 0].forEach((d, row) => bus.kdc.setSensorRow(row, (9 - d) & 0x3F));
  let found = 0, track = 0, trackHits = 0;
  for (let i = 1; i <= max; i++) {
    cpu.step();
    if (!found && cpu.PC === MASTER_FOUND) found = i;
    if (cpu.PC === TRACK_LOOP) { if (!track) track = i; trackHits++; break; }
  }
  return { found, track, trackHits, records: bus.frontEnd.recordCount };
}

console.log(`steps per run: ${max}`);
for (const [name, opts] of variants) {
  const r = run(opts, 'master');
  console.log(`${name.padEnd(40)} MASTER_FOUND=${r.found || 'no'}  TRACK_LOOP=${r.track || 'no'}  (hits ${r.trackHits}, records ${r.records})`);
}
