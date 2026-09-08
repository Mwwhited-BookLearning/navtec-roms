'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ReceiverFrontEnd } = require('../emu8085.js');

function makeFrontEnd(mode) {
  const cpu = { requested: [], requestInterrupt(name) { this.requested.push(name); } };
  const pio2 = { PB: 0, pcIn: 0xFF, onPBWrite: null };
  const fe = new ReceiverFrontEnd(cpu, pio2, mode || 'master');
  return { fe, cpu, pio2 };
}

describe('ReceiverFrontEnd: configuration', () => {
  it('defaults to master and accepts switching to secondary', () => {
    const { fe } = makeFrontEnd();
    assert.equal(fe.mode, 'master');
    fe.setMode('secondary');
    assert.equal(fe.mode, 'secondary');
  });

  it('ignores an unknown mode name', () => {
    const { fe } = makeFrontEnd();
    fe.setMode('bogus');
    assert.equal(fe.mode, 'master');
  });

  it('clamps noise to [0,1]', () => {
    const { fe } = makeFrontEnd();
    fe.setNoise(5);
    assert.equal(fe.noise, 1);
    fe.setNoise(-5);
    assert.equal(fe.noise, 0);
  });
});

describe('ReceiverFrontEnd: sample strobe (regression: the sampleTotal/onSample wiring)', () => {
  // An earlier version of this emulator added sampleTotal/onSample but never
  // actually incremented/called them from tick() -- the web UI's sample
  // counter silently stayed at 0 forever. See docs/emulator.md.
  it('tick() increments sampleTotal, fires onSample, and requests RST 6.5 once per sampleInterval', () => {
    const { fe, cpu, pio2 } = makeFrontEnd();
    let sampleEvents = 0;
    fe.onSample = () => { sampleEvents++; };
    assert.equal(fe.sampleTotal, 0);

    fe.tick(fe.sampleInterval - 1);
    assert.equal(fe.sampleTotal, 0, 'must not fire before a full interval has elapsed');
    assert.equal(sampleEvents, 0);
    assert.equal(cpu.requested.length, 0);

    fe.tick(1); // completes the interval
    assert.equal(fe.sampleTotal, 1);
    assert.equal(sampleEvents, 1);
    assert.deepEqual(cpu.requested, ['6.5']);
    assert.equal(pio2.pcIn & 0x04, 0x04, 'the epoch flag bit must be set for this sample');
  });

  it('accumulates multiple samples across many small ticks', () => {
    const { fe } = makeFrontEnd();
    for (let i = 0; i < fe.sampleInterval * 3; i++) fe.tick(1);
    assert.equal(fe.sampleTotal, 3);
  });
});

describe('ReceiverFrontEnd: port B/C protocol (hardware.md\'s bit assignments)', () => {
  it('a rising edge on PB bit 2 (latch/reset) reloads the shift registers', () => {
    const { fe, pio2 } = makeFrontEnd('master');
    fe.shift1 = 0; fe.shift2 = 0; // perturb them first
    pio2.PB = 0;
    fe.onPBWrite(0x04); // rising edge on bit 2
    assert.equal(fe.shift1, fe.words[0]);
    assert.equal(fe.shift2, fe.words[1]);
  });

  it('a rising edge on PB bit 4 (shift clock) shifts out the MSB of each word onto PC bits 4/3', () => {
    const { fe, pio2 } = makeFrontEnd('master'); // master words: [0xCA, 0x9F] = [11001010, 10011111]
    pio2.PB = 0;
    fe.onPBWrite(0x04); // reload first
    pio2.pcIn = 0x00; // zero it so the assertion actually proves the bits get set, not leftover 0xFF
    pio2.PB = 0x04;
    fe.onPBWrite(0x04 | 0x10); // rising edge on bit 4 (bit 2 stays high, not a new rising edge there)
    // MSB of 0xCA is 1 -> PC bit4 set; MSB of 0x9F is 1 -> PC bit3 set
    assert.equal(pio2.pcIn & 0x10, 0x10);
    assert.equal(pio2.pcIn & 0x08, 0x08);
    assert.equal(fe.shift1, (0xCA << 1) & 0xFF);
    assert.equal(fe.shift2, (0x9F << 1) & 0xFF);
  });

  it('does not reshift on a non-rising edge (bit already high)', () => {
    const { fe, pio2 } = makeFrontEnd('master');
    pio2.PB = 0x10;
    fe.lastPB = 0x10; // bit 4 already high last time
    const before = fe.shift1;
    fe.onPBWrite(0x10); // no rising edge
    assert.equal(fe.shift1, before);
  });
});
