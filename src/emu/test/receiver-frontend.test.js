'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ReceiverFrontEnd } = require('../emu8085.js');

function makeFrontEnd(mode) {
  const cpu = { requested: [], requestInterrupt(name) { this.requested.push(name); } };
  const pio2 = { PB: 0, PA: 0, pcIn: 0xFF, onPBWrite: null, onPAWrite: null };
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

describe('ReceiverFrontEnd: port B/C protocol (hardware.md bit assignments)', () => {
  // Station sits exactly at the programmed TOA, even interval -> B reads the CA (A-interval) word.
  function aligned(mode) {
    const r = makeFrontEnd(mode);
    r.fe.gateMs = 0; r.fe.stationMs = 0; r.fe.interval = 0;
    return r;
  }

  it('a rising edge on PB bit 2 (latch/reset) reloads the shift registers', () => {
    const { fe, pio2 } = aligned('master');
    fe.shift1 = 0; fe.shift2 = 0; // perturb them first
    pio2.PB = 0;
    fe.onPBWrite(0x04); // rising edge on bit 2
    assert.equal(fe.shift1, fe.words[0]);
    // searching (status bit 0 clear): C is the last 8 samples, window ending at index 0 -> top 5 bits of CA
    assert.equal(fe.shift2, 0xCA >> 3);
    pio2.PB = 1; fe.lastPB = 0; // status bit 0 set -> gated: both channels read the group
    fe.onPBWrite(0x05);
    assert.equal(fe.shift2, fe.words[0], 'while gated both channels read the same group');
  });

  it('presents the MSB of each word immediately at latch (SHIFT_IN16 reads PC before any clock)', () => {
    const { fe, pio2 } = aligned('master'); // 0xCA = 11001010 -> MSB 1
    pio2.pcIn = 0x00;
    pio2.PB = 1; fe.lastPB = 0; // gated
    fe.onPBWrite(0x05);
    assert.equal(pio2.pcIn & 0x10, 0x10);
    assert.equal(pio2.pcIn & 0x08, 0x08);
  });

  it('a rising edge on PB bit 4 (shift clock) shifts both registers and presents the next MSBs', () => {
    const { fe, pio2 } = aligned('master');
    pio2.PB = 0;
    fe.onPBWrite(0x04);
    pio2.PB = 0x04;
    fe.onPBWrite(0x04 | 0x10);
    assert.equal(fe.shift1, (0xCA << 1) & 0xFF);
    // next MSB of 0xCA (bit 6) is 1 -> PC4 set
    assert.equal(fe.pio2.pcIn & 0x10, 0x10);
  });

  it('does not reshift on a non-rising edge (bit already high)', () => {
    const { fe, pio2 } = aligned('master');
    pio2.PB = 0x10;
    fe.lastPB = 0x10;
    const before = fe.shift1;
    fe.onPBWrite(0x10);
    assert.equal(fe.shift1, before);
  });
});

describe('ReceiverFrontEnd: record decode and epoch/interval model', () => {
  it('decodeRecord inverts INIT_REC_FROM_TOA: record 83 A4 C0 is 107.498 ms', () => {
    const { fe } = makeFrontEnd();
    assert.ok(Math.abs(fe.decodeRecord(0x83, 0xA4, 0xC0) - 107.498) < 1e-9);
  });

  it('epoch flag is set only on epoch strobes and the interval parity alternates every period', () => {
    const { fe, pio2 } = makeFrontEnd();
    const epochs = [];
    const P = fe.periodSamples + 1; // strobes per epoch: sinceEpoch runs 0..periodSamples
    for (let i = 0; i < P * 2 + 1; i++) {
      fe.tick(fe.sampleInterval);
      if (pio2.pcIn & 0x04) epochs.push([i, fe.interval]);
    }
    assert.deepEqual(epochs, [[0, 0], [P, 1], [P * 2, 2]]);
  });
});
