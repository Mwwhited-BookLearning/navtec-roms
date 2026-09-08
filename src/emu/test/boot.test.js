'use strict';
// Integration test: boots the real ROM images the way docs/emulator.md's
// "What's been checked" section describes, and pins down the exact
// (deterministic, since noise defaults to 0) machine state after a fixed
// number of instructions. This is a characterization/golden-state test:
// if a real, intentional change to CPU or peripheral behavior legitimately
// moves these numbers, update them here with a note of why -- the point is
// to catch *accidental* drift, not to freeze the emulator forever.
const path = require('node:path');
const fs = require('node:fs');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Cpu8085, Bus, ReceiverFrontEnd, loadSymbols } = require('../emu8085.js');

const base = path.resolve(__dirname, '..', '..', '..');
const rom1Path = path.join(base, 'originals', 'CN19229N NT3321 7943.BIN');
const rom2Path = path.join(base, 'originals', 'CN19230N NT3322 7943.BIN');

function boot(switches) {
  const bus = new Bus();
  bus.loadRom(fs.readFileSync(rom1Path), 0);
  bus.loadRom(fs.readFileSync(rom2Path), 0x1000);
  const cpu = new Cpu8085(bus);
  bus.attachCpu(cpu);
  bus.frontEnd = new ReceiverFrontEnd(cpu, bus.pio2, 'master');
  cpu.symbols = loadSymbols(path.join(base, 'disasm', 'nt3321-22.json'));
  if (switches) {
    const encode = (d) => (d === null ? 0x0B : (9 - d) & 0x3F);
    switches.forEach((d, row) => bus.kdc.setSensorRow(row, encode(d)));
  }
  return { bus, cpu };
}

function nearestSymbol(cpu, addr) {
  if (!cpu.symbols) return null;
  let best = null;
  for (const [a, name] of cpu.symbols) if (a <= addr && (!best || a > best[0])) best = [a, name];
  return best ? `${best[1]}+${addr - best[0]}` : null;
}

describe('boot: real ROM images, no switches (bad-switch retry loop)', () => {
  it('runs 100k instructions without hitting an unimplemented opcode or throwing', () => {
    const { cpu } = boot();
    for (let i = 0; i < 100000; i++) cpu.step();
    assert.equal(cpu.unknownOpcodeAt, null);
  });
});

describe('boot: real ROM images, valid switch panel (1,2,9,9,4,0 -- GRI 9940)', () => {
  it('reaches the documented steady-state loop, not stuck in switch-error retry', () => {
    const { cpu } = boot([1, 2, 9, 9, 4, 0]);
    const visited = new Set();
    // Sample every 200 steps rather than resolving a symbol on every one --
    // each named routine below runs for far more than 200 instructions at a
    // stretch, so this misses nothing that matters while avoiding 2M linear
    // symbol-table scans.
    for (let i = 0; i < 2000000; i++) {
      cpu.step();
      if (i % 200 === 0) {
        const sym = nearestSymbol(cpu, cpu.PC);
        if (sym) visited.add(sym.split('+')[0]);
      }
    }
    assert.equal(cpu.unknownOpcodeAt, null);
    // Any of these confirms the firmware got past READ_SWITCHES and into
    // real background processing, per docs/emulator.md's "What's been
    // checked" -- not asserting a single exact routine, since the round
    // robin across background tasks makes the *set* visited the stable
    // thing, not any one instant's PC.
    const expectedAny = ['SERIAL_POLL', 'WAIT_SAMPLE', 'MP_NEXT_SAMPLE', 'TICK_TASK', 'TX_SERVICE'];
    assert.ok(expectedAny.some((name) => visited.has(name)), `expected to visit one of ${expectedAny}, visited: ${[...visited].join(', ')}`);
    assert.ok(!visited.has('SW_ERR_SHOW'), 'a valid switch panel must not hit the switch-error display');
  });

  it('produces an exact, reproducible machine state after 300k instructions (golden state)', () => {
    const { cpu } = boot([1, 2, 9, 9, 4, 0]);
    for (let i = 0; i < 300000; i++) cpu.step();
    assert.equal(cpu.unknownOpcodeAt, null);
    assert.equal(cpu.PC, 0x1E62);
    assert.equal(cpu.SP, 0x70FE);
    assert.equal(cpu.A, 0xED);
    assert.equal(cpu.cycles, 2100290);
  });
});
