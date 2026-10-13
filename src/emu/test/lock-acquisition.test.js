'use strict';
// End-to-end: boot the real ROMs against the synthetic front end with GRI 9940 entered and check that
// the firmware acquires the master (MASTER_FOUND), survives the settle loop and sits in TRACK_LOOP.
// This exercises the front end *model* (see docs/emulator.md) -- it is not evidence about real hardware.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Cpu8085, Bus, ReceiverFrontEnd } = require('../emu8085.js');

const root = path.join(__dirname, '..', '..', '..');
const MASTER_FOUND = 0x1B0, TRACK_LOOP = 0x21B;

describe('synthetic front end: lock acquisition', () => {
  it('reaches MASTER_FOUND, then TRACK_LOOP, with GRI 9940', () => {
    const bus = new Bus();
    bus.loadRom(fs.readFileSync(path.join(root, 'originals', 'CN19229N NT3321 7943.BIN')), 0);
    bus.loadRom(fs.readFileSync(path.join(root, 'originals', 'CN19230N NT3322 7943.BIN')), 0x1000);
    const cpu = new Cpu8085(bus); bus.attachCpu(cpu);
    bus.frontEnd = new ReceiverFrontEnd(cpu, bus.pio2, 'master');
    [1, 2, 9, 9, 4, 0].forEach((d, row) => bus.kdc.setSensorRow(row, (9 - d) & 0x3F));
    let found = -1, tracking = -1;
    for (let i = 0; i < 8000000 && tracking < 0; i++) {
      cpu.step();
      if (found < 0 && cpu.PC === MASTER_FOUND) found = i;
      if (found >= 0 && cpu.PC === TRACK_LOOP) tracking = i;
    }
    assert.ok(found >= 0, 'MASTER_FOUND never reached');
    assert.ok(tracking > found, 'TRACK_LOOP never reached after MASTER_FOUND');
  });
});
