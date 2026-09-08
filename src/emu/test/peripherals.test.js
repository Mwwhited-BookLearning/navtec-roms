'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { Intel8155, Intel8251A, Intel8279 } = require('../emu8085.js');

describe('Intel8155', () => {
  it('decodes the exact command bytes hardware.md documents for both chips', () => {
    const pio1 = new Intel8155('#1');
    pio1.writeReg(0, 0xCF); // hardware.md: "PA out, PB out, PC out (ALT2), timer start"
    assert.equal(pio1.paDir, 1);
    assert.equal(pio1.pbDir, 1);
    assert.equal(pio1.pcOutput, true);
    assert.equal(pio1.timerRunning, true);

    const pio2 = new Intel8155('#2');
    pio2.writeReg(0, 0xC3); // hardware.md: "PA out, PB out, PC input (ALT1), timer start"
    assert.equal(pio2.paDir, 1);
    assert.equal(pio2.pbDir, 1);
    assert.equal(pio2.pcOutput, false);
    assert.equal(pio2.timerRunning, true);
  });

  it('output ports read back the last written value', () => {
    const pio = new Intel8155('t');
    pio.writeReg(0, 0xCF); // PA/PB/PC all output
    pio.writeReg(1, 0x5A);
    assert.equal(pio.readReg(1), 0x5A);
  });

  it('input ports read the external latch, not the write-side value', () => {
    const pio = new Intel8155('t');
    pio.writeReg(0, 0xC0); // PA/PB input, PC input (pcSel bits 0)
    pio.paIn = 0x77;
    assert.equal(pio.readReg(1), 0x77);
  });

  it('read8/write8 route by A15 (registers) vs low byte (RAM), per the standalone-component contract', () => {
    const pio = new Intel8155('t');
    pio.write8(0x6F10, 0x42); // RAM window, no A15
    assert.equal(pio.ram[0x10], 0x42);
    assert.equal(pio.read8(0x6F10), 0x42);

    pio.write8(0xE000, 0xCF); // register window, A15 set: command register
    assert.equal(pio.command, 0xCF);
  });

  it('the timer counts down and toggles TOUT on an auto-reload square wave', () => {
    const pio = new Intel8155('t');
    let toggles = 0;
    pio.onTimerOut = () => { toggles++; };
    pio.writeReg(4, 0x0A); // timer low = 10
    pio.writeReg(5, 0xC0); // timer high: mode bits + count high = 0
    pio.writeReg(0, 0xC0 | 0xC0); // any command with TM=11 (bits 6-7) starts the timer
    pio.tick(10); // exactly one full period
    assert.equal(toggles, 1);
    pio.tick(20); // two more periods
    assert.equal(toggles, 3);
  });

  it('a stop command (TM=01/10) halts the timer', () => {
    const pio = new Intel8155('t');
    let toggles = 0;
    pio.onTimerOut = () => { toggles++; };
    pio.writeReg(4, 0x05);
    pio.writeReg(5, 0x00);
    pio.writeReg(0, 0xC0); // start (TM=11)
    pio.writeReg(0, 0x40); // stop (TM=01)
    pio.tick(100);
    assert.equal(toggles, 0);
  });
});

describe('Intel8251A', () => {
  it('treats the first control write as the mode byte, the second as command', () => {
    const usart = new Intel8251A();
    usart.writeByAddr(0xC001, 0xDA); // hardware.md's documented mode byte
    assert.equal(usart.expectingMode, false);
    usart.writeByAddr(0xC001, 0x37); // hardware.md's documented command byte
    assert.equal(usart.mode, 0xDA);
    assert.equal(usart.command, 0x37);
  });

  it('a command with bit 6 set (internal reset) expects a mode byte again', () => {
    const usart = new Intel8251A();
    usart.writeControl(0xDA);
    usart.writeControl(0x40); // bit6 set
    assert.equal(usart.expectingMode, true);
  });

  it('writeData fires the onTx callback with the transmitted byte', () => {
    const usart = new Intel8251A();
    const sent = [];
    usart.onTx = (b) => sent.push(b);
    usart.writeByAddr(0xC000, 0x41);
    usart.writeByAddr(0xC000, 0x42);
    assert.deepEqual(sent, [0x41, 0x42]);
  });

  it('injectRx queues bytes in order and readData drains them, updating RxRDY', () => {
    const usart = new Intel8251A();
    assert.equal(usart.readStatus() & 0x02, 0, 'RxRDY must be clear on an empty queue');
    usart.injectRx(0x31);
    usart.injectRx(0x32);
    assert.equal(usart.readStatus() & 0x02, 0x02, 'RxRDY must be set with data queued');
    assert.equal(usart.readByAddr(0xC000), 0x31);
    assert.equal(usart.readByAddr(0xC000), 0x32);
    assert.equal(usart.readStatus() & 0x02, 0);
  });
});

describe('Intel8279', () => {
  it('dispatches commands by their top 3 bits, matching hardware.md\'s documented bytes', () => {
    const kdc = new Intel8279();
    kdc.writeCommand(0x04); // mode set (000): "8x8-bit display... sensor matrix keyboard mode"
    assert.equal(kdc.mode, 0x04);
    kdc.writeCommand(0x26); // program clock (001): prescaler 6
    assert.equal(kdc.prescaler, 0x06);
    kdc.writeCommand(0x90); // write display RAM (100), auto-increment, address 0
    assert.equal(kdc.dispAddr, 0);
    assert.equal(kdc.autoIncr, true);
    kdc.writeCommand(0x50); // read sensor RAM (010), row 0, auto-increment
    assert.equal(kdc.readAddr, 0);
    assert.equal(kdc.readAutoIncr, true);
  });

  it('writeData auto-increments the display pointer and calls onDisplayWrite', () => {
    const kdc = new Intel8279();
    kdc.writeCommand(0x90); // write display RAM, address 0, auto-increment
    const writes = [];
    kdc.onDisplayWrite = (addr, v) => writes.push([addr, v]);
    kdc.writeData(0x11);
    kdc.writeData(0x22);
    assert.equal(kdc.displayRAM[0], 0x11);
    assert.equal(kdc.displayRAM[1], 0x22);
    assert.deepEqual(writes, [[0, 0x11], [1, 0x22]]);
  });

  it('readData auto-increments the sensor-read pointer across rows 0-5, matching front-panel.md', () => {
    const kdc = new Intel8279();
    for (let row = 0; row < 6; row++) kdc.setSensorRow(row, row + 1);
    kdc.writeCommand(0x50); // read rows 0-5, auto-increment
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(kdc.readData());
    assert.deepEqual(rows, [1, 2, 3, 4, 5, 6]);
  });

  it('CLEAR wipes display RAM but leaves sensor RAM alone (regression: the sensor-RAM bug)', () => {
    // Sensor-matrix-mode sensor RAM is a live mirror of the external switch
    // matrix on real hardware, not chip state software can erase. An
    // earlier version of this emulator wiped it on the CDH clear command,
    // which made every injected switch setting silently vanish. See
    // docs/emulator.md's "What's been checked".
    const kdc = new Intel8279();
    kdc.setSensorRow(0, 0x2A);
    kdc.setSensorRow(3, 0x15);
    kdc.writeCommand(0xCD); // clear (110)
    assert.deepEqual(Array.from(kdc.displayRAM), new Array(16).fill(0xFF));
    assert.equal(kdc.sensorRAM[0], 0x2A, 'sensor RAM must survive a display clear');
    assert.equal(kdc.sensorRAM[3], 0x15);
  });

  it('raiseIrq sets irqPending; end-interrupt (E0H) and clear (CDH) both clear it', () => {
    const kdc = new Intel8279();
    kdc.raiseIrq();
    assert.equal(kdc.irqPending, true);
    kdc.writeCommand(0xE0); // end interrupt (111)
    assert.equal(kdc.irqPending, false);
    kdc.raiseIrq();
    kdc.writeCommand(0xCD); // clear (110) also clears it
    assert.equal(kdc.irqPending, false);
  });
});
