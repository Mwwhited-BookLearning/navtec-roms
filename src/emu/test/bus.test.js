'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Cpu8085, Bus } = require('../emu8085.js');

function makeBus() {
  const bus = new Bus();
  bus.loadRom(new Uint8Array([0x11, 0x22, 0x33]), 0);
  bus.loadRom(new Uint8Array([0x44, 0x55, 0x66]), 0x1000);
  return bus;
}

describe('Bus: device-address decode (docs/pal-decoder.md)', () => {
  it('routes 0000-0FFF to ROM1', () => {
    const bus = makeBus();
    assert.equal(bus.read8(0x0000), 0x11);
    assert.equal(bus.read8(0x0002), 0x33);
  });

  it('routes 1000-1FFF to ROM2', () => {
    const bus = makeBus();
    assert.equal(bus.read8(0x1000), 0x44);
  });

  it('reads 0xFF from the expansion-ROM slot when nothing is loaded, and real data once loaded', () => {
    const bus = makeBus();
    assert.equal(bus.read8(0x2000), 0xFF);
    bus.loadExpRom(new Uint8Array([0xAB]));
    assert.equal(bus.read8(0x2000), 0xAB);
  });

  it('reads 0xFF from the unused group (3000-3FFF)', () => {
    const bus = makeBus();
    assert.equal(bus.read8(0x3000), 0xFF);
  });

  it('writes to ROM are silently ignored', () => {
    const bus = makeBus();
    bus.write8(0x0000, 0x99);
    assert.equal(bus.read8(0x0000), 0x11);
  });

  it('routes C000/C001 to the USART and D000/D001 to the 8279', () => {
    const bus = makeBus();
    bus.write8(0xC001, 0xDA); // mode byte
    bus.write8(0xC001, 0x37); // command byte
    assert.equal(bus.usart.mode, 0xDA);
    assert.equal(bus.usart.command, 0x37);

    bus.write8(0xD001, 0x04); // 8279 mode set
    assert.equal(bus.kdc.mode, 0x04);
  });

  it('8155 #1 answers at both 6F00-6FFF (RAM) and E000-E005 (registers)', () => {
    const bus = makeBus();
    bus.write8(0x6F10, 0x42);
    assert.equal(bus.read8(0x6F10), 0x42);
    assert.equal(bus.pio1.ram[0x10], 0x42);

    bus.write8(0xE001, 0x77); // PA
    assert.equal(bus.pio1.PA, 0x77);
  });

  it('8155 #2 answers at both 7000-70FF (RAM) and F000-F005 (registers)', () => {
    const bus = makeBus();
    bus.write8(0x7005, 0x11);
    assert.equal(bus.pio2.ram[0x05], 0x11);
    bus.write8(0xF002, 0x8E); // PB, matching hardware.md's documented idle value
    assert.equal(bus.pio2.PB, 0x8E);
  });

  it('the 8155 RAM window mirrors across its whole 4KB group, per the 8205 decode theory', () => {
    const bus = makeBus();
    bus.write8(0x6F10, 0x42);
    assert.equal(bus.read8(0x6010), 0x42, '6010 and 6F10 share the same low-byte RAM cell');
  });
});

describe('Bus: interrupt wiring', () => {
  it('8155 #1\'s timer output requests RST 7.5 (hardware.md\'s guessed source)', () => {
    const bus = makeBus();
    const cpu = new Cpu8085(bus);
    bus.attachCpu(cpu);
    bus.write8(0xE004, 0x02); // timer low = 2
    bus.write8(0xE005, 0x00); // timer high = 0, mode 00
    bus.write8(0xE000, 0xCF); // hardware.md's documented command byte: starts the timer
    assert.equal(cpu.I75, false);
    bus.tick(2); // exactly one period
    assert.equal(cpu.I75, true);
  });

  it('RST 5.5 continuously mirrors the 8279\'s live IRQ pin (regression: the runtime-switch-change fix)', () => {
    // Before this fix, nothing connected the 8279's IRQ output to the CPU's
    // RST 5.5 pending flag, so a switch changed after cold boot was never
    // noticed by the firmware. See docs/web-emulator.md's "Runtime switch
    // changes now actually work".
    const bus = makeBus();
    const cpu = new Cpu8085(bus);
    bus.attachCpu(cpu);
    assert.equal(cpu.I55, false);
    bus.kdc.raiseIrq();
    bus.tick(1);
    assert.equal(cpu.I55, true, 'I55 must track the live IRQ pin, not just a one-shot request');
    bus.kdc.writeCommand(0xE0); // end interrupt -- lowers the chip's IRQ output
    bus.tick(1);
    assert.equal(cpu.I55, false, 'I55 must drop again once the chip deasserts IRQ');
  });
});
