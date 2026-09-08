'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { ProductTermPal } = require('../pal.js');
const { CS, ADDR_DECODE_TERMS } = require('../addr-decode.js');

describe('ProductTermPal: generic evaluator', () => {
  it('literal() handles negation', () => {
    assert.equal(ProductTermPal.literal('A', { A: true }), true);
    assert.equal(ProductTermPal.literal('!A', { A: true }), false);
    assert.equal(ProductTermPal.literal('!A', { A: false }), true);
  });

  it('a term is the AND of its literals', () => {
    assert.equal(ProductTermPal.term(['A', '!B'], { A: true, B: false }), true);
    assert.equal(ProductTermPal.term(['A', '!B'], { A: true, B: true }), false);
  });

  it('evaluate() is true-when-selected; clock() inverts to active-low', () => {
    const pal = new ProductTermPal([{ name: 'OUT', pins: ['A'] }]);
    assert.equal(pal.evaluate({ A: true }).OUT, true);
    assert.equal(pal.clock({ A: true }).OUT, false, 'active-low: selected == electrically low');
    assert.equal(pal.clock({ A: false }).OUT, true, 'active-low: deselected == electrically high');
  });
});

describe('The address-decode table (shared by the emulator and the CUPL generator)', () => {
  it('has exactly 8 outputs, each a single 3-literal minterm, all unique', () => {
    assert.equal(ADDR_DECODE_TERMS.length, 8);
    const names = new Set();
    for (const t of ADDR_DECODE_TERMS) {
      assert.equal(t.pins.length, 3);
      names.add(t.name);
    }
    assert.equal(names.size, 8);
  });

  it('decodes A[14:12] into exactly one active-low output per combination, matching hardware.md\'s table', () => {
    const pal = new ProductTermPal(ADDR_DECODE_TERMS);
    const expected = [
      CS.ROM1, CS.ROM2, CS.EXPROM, CS.UNUSED, CS.USART, CS.KDC, CS.PIO1, CS.PIO2,
    ];
    for (let sel = 0; sel < 8; sel++) {
      const env = { A12: !!(sel & 1), A13: !!(sel & 2), A14: !!(sel & 4) };
      const cs = pal.clock(env);
      const asserted = Object.keys(cs).filter((k) => cs[k] === false);
      assert.deepEqual(asserted, [expected[sel]], `sel=${sel.toString(2).padStart(3, '0')}`);
    }
  });
});
