'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ADDR_DECODE_TERMS, DEVICE_SPECS, generateCupl } = require('../addr-decode.js');

describe('generateCupl', () => {
  it('throws on an unknown device', () => {
    assert.throws(() => generateCupl('bogus'), /unknown PAL device/);
  });

  for (const key of Object.keys(DEVICE_SPECS)) {
    it(`emits a Device line and every PIN/equation for ${key}`, () => {
      const text = generateCupl(key, { date: '2026-01-01' });
      const spec = DEVICE_SPECS[key];
      assert.match(text, new RegExp(`Device\\s+${spec.device};`));
      assert.match(text, new RegExp(`PIN ${spec.pins.clk} = CLK;`));
      for (const [name, num] of Object.entries(spec.pins.inputs)) {
        assert.match(text, new RegExp(`PIN ${num} = ${name};`));
      }
      for (const [name, num] of Object.entries(spec.pins.outputs)) {
        assert.match(text, new RegExp(`PIN ${num} = !${name};`));
      }
      for (const t of ADDR_DECODE_TERMS) {
        const eq = `${t.name} = ${t.pins.join(' & ')};`;
        assert.ok(text.includes(eq), `missing equation: ${eq}`);
      }
    });
  }

  it('16R8 and 20R10 use disjoint pin numbers for the same signal names', () => {
    const p16 = DEVICE_SPECS['16R8'].pins.outputs;
    const p20 = DEVICE_SPECS['20R10'].pins.outputs;
    for (const name of Object.keys(p16)) {
      assert.notEqual(p16[name], p20[name], `${name} should be renumbered between packages`);
    }
  });

  it('every device spec declares exactly 3 inputs (A12-A14) and 8 used outputs', () => {
    for (const spec of Object.values(DEVICE_SPECS)) {
      assert.equal(Object.keys(spec.pins.inputs).length, 3);
      assert.equal(Object.keys(spec.pins.outputs).length, 8);
    }
  });
});
