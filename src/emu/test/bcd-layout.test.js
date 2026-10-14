'use strict';
// Pins down the 4-byte BCD layout the firmware's time quantities use (docs/PROGRESS.md Update 16):
// big-endian in memory (MS byte at the lowest address), CUR_TOA in 0.1 us units. Measured by running the
// real ROMs to ACQ_START (012D..014F) with GRI 9940 entered.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Cpu8085, Bus } = require('../emu8085.js');

const root = path.join(__dirname, '..', '..', '..');
const GRI_BCD = 0x6F1C, CUR_TOA = 0x6FA5;

function bootTo(pc, limit) {
  const bus = new Bus();
  bus.loadRom(fs.readFileSync(path.join(root, 'originals', 'CN19229N NT3321 7943.BIN')), 0);
  bus.loadRom(fs.readFileSync(path.join(root, 'originals', 'CN19230N NT3322 7943.BIN')), 0x1000);
  const cpu = new Cpu8085(bus); bus.attachCpu(cpu);
  [1, 2, 9, 9, 4, 0].forEach((d, row) => bus.kdc.setSensorRow(row, (9 - d) & 0x3F));
  for (let i = 0; i < limit && cpu.PC !== pc; i++) cpu.step();
  assert.equal(cpu.PC, pc, 'did not reach ' + pc.toString(16));
  return { cpu, bus };
}
const bytes = (bus, a) => [0, 1, 2, 3].map((i) => bus.read8(a + i));

describe('4-byte BCD time layout', () => {
  it('GRI 9940 is stored big-endian as 00 99 40 00 and copied to CUR_TOA', () => {
    const { bus } = bootTo(0x0130, 3000000);
    assert.deepEqual(bytes(bus, GRI_BCD), [0x00, 0x99, 0x40, 0x00]);
    assert.deepEqual(bytes(bus, CUR_TOA), [0x00, 0x99, 0x40, 0x00]);
  });

  it('TOA_ADD_CONST of BCD_K_00080980 adds 80980 units (0.1 us): 994000 -> 1074980', () => {
    const { cpu, bus } = bootTo(0x014F, 3000000);
    assert.deepEqual(bytes(bus, CUR_TOA), [0x01, 0x07, 0x49, 0x80]);
    assert.equal(cpu.PC, 0x014F);
  });
});
