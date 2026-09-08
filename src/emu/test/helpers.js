'use strict';
// Shared test helpers: a flat-RAM bus stub (no address decoding, no
// peripherals) for isolated CPU-opcode tests, independent of the real Bus.
const { Cpu8085 } = require('../emu8085.js');

function makeCpu(bytes, org) {
  org = org || 0;
  const mem = new Uint8Array(0x10000);
  if (bytes) mem.set(bytes, org);
  const bus = {
    read8: (a) => mem[a & 0xFFFF],
    write8: (a, v) => { mem[a & 0xFFFF] = v & 0xFF; },
    tick: () => {},
  };
  const cpu = new Cpu8085(bus);
  cpu.PC = org;
  return { cpu, mem, bus };
}

// Run one instruction's worth of bytes already placed in memory at cpu.PC.
function step(cpu, n) {
  for (let i = 0; i < (n || 1); i++) cpu.step();
  return cpu;
}

module.exports = { makeCpu, step };
