'use strict';
// Boot-sequence cheat sheet: what the 8085 should do on the bus after reset, per the emulator.
// Usage: node src/emu/boot-trace.js [nAccesses]   (default 40 non-ROM accesses)
// Prints the first N accesses to anything other than ROM/RAM (i.e. the I/O devices), each with
// the step number, PC, and the device -- the things a logic analyzer on the board's chip
// selects (8205 outputs) should see, in order.
const fs = require('fs');
const path = require('path');
const { Cpu8085, Bus } = require('./emu8085.js');
const base = path.resolve(__dirname, '..', '..');
const N = Number(process.argv[2] || 40);

const bus = new Bus();
bus.loadRom(fs.readFileSync(path.join(base, 'originals', 'CN19229N NT3321 7943.BIN')), 0);
bus.loadRom(fs.readFileSync(path.join(base, 'originals', 'CN19230N NT3322 7943.BIN')), 0x1000);
const cpu = new Cpu8085(bus); bus.attachCpu(cpu);
[1, 2, 9, 9, 4, 0].forEach((d, row) => bus.kdc.setSensorRow(row, (9 - d) & 0x3F));

const hex = (v, n) => v.toString(16).toUpperCase().padStart(n, '0');
const name = (a) => (a >= 0xC000 && a < 0xC002) ? '8251A ' + (a & 1 ? 'ctrl/status' : 'data')
  : (a >= 0xD000 && a < 0xD002) ? '8279  ' + (a & 1 ? 'cmd/status' : 'data')
  : (a >= 0xE000 && a < 0xE006) ? '8155#1 reg ' + (a & 7) : (a >= 0xF000 && a < 0xF006) ? '8155#2 reg ' + (a & 7)
  : (a >= 0xE000 && a < 0xF000) ? '8155#1 (alias)' : (a >= 0xF000) ? '8155#2 (alias)' : null;
let step = 0, n = 0;
const out = [];
const rd = bus.read8.bind(bus), wr = bus.write8.bind(bus);
bus.read8 = (a) => { const v = rd(a); const nm = name(a & 0xFFFF); if (nm && n < N) { n++; out.push(`${step}\tPC=${hex(cpu.PC, 4)}\tRD  ${hex(a & 0xFFFF, 4)}\t${nm}\t-> ${hex(v, 2)}`); } return v; };
bus.write8 = (a, v) => { const nm = name(a & 0xFFFF); if (nm && n < N) { n++; out.push(`${step}\tPC=${hex(cpu.PC, 4)}\tWR  ${hex(a & 0xFFFF, 4)}\t${nm}\t<- ${hex(v & 0xFF, 2)}`); } wr(a, v); };
while (n < N && step < 5000000) { step++; cpu.step(); }
console.log('step	PC	op addr	device	data');
console.log(out.join('\n'));
