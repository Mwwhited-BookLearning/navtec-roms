'use strict';
/*
 * pal.js -- minimal PAL/GAL-style sum-of-products evaluator.
 *
 * Each output is a list of AND terms (product terms) over named input
 * signals, OR'd together, with active-low polarity applied at evaluation.
 * This is a small, honest model: no fuse map, no shared product-term
 * budget across outputs, no tristate/feedback/combinatorial-vs-registered
 * distinction beyond a single clock() call per evaluation -- just enough
 * to describe simple decoders like tools/addr-decode.js's address decoder
 * and to render matching CUPL source from the same term table. See
 * docs/pal-decoder.md.
 */

class ProductTermPal {
  // terms: [{ name, pins: ['!A14', 'A13', ...] }, ...]
  // Each entry is one output with one or more product terms OR'd together;
  // pins within a single term object are AND'd. For a plain decoder (this
  // project's only user so far) each output has exactly one product term.
  constructor(terms) {
    this.terms = terms;
    this.q = {};
    for (const t of terms) this.q[t.name] = true; // idle high == deasserted, active-low convention
  }
  static literal(lit, env) {
    const neg = lit[0] === '!';
    const name = neg ? lit.slice(1) : lit;
    const v = !!env[name];
    return neg ? !v : v;
  }
  static term(pins, env) { return pins.every((l) => ProductTermPal.literal(l, env)); }

  // Combinational value of every output (true = selected/active), before
  // active-low inversion.
  evaluate(env) {
    const out = {};
    for (const t of this.terms) out[t.name] = ProductTermPal.term(t.pins, env);
    return out;
  }
  // "Registered" evaluation: latches the active-low electrical output value.
  // Modeled as updating synchronously with whatever calls clock() -- this
  // emulator doesn't model discrete T-states/clock edges separately from
  // bus accesses, so a real PAL16R8/20R10's one-clock latency isn't
  // reproduced here. See docs/pal-decoder.md's "Known simplifications".
  clock(env) {
    const active = this.evaluate(env);
    const out = {};
    for (const name of Object.keys(active)) out[name] = !active[name]; // active-low
    this.q = out;
    return out;
  }
}

module.exports = { ProductTermPal };
