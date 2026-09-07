#!/usr/bin/env node
'use strict';
/*
 * emu8085.js -- Intel 8085 emulator for the Navtec Loran-C receiver ROM.
 *
 * Usage:  node tools/emu8085.js [options]
 *   --rom1 <path>       ROM1 image, loaded at 0000 (default originals/CN19229N NT3321 7943.BIN)
 *   --rom2 <path>       ROM2 image, loaded at 1000 (default originals/CN19230N NT3322 7943.BIN)
 *   --exprom <path>     optional expansion ROM image, loaded at 2000
 *   --steps N           run N instructions then stop (default: run until HLT or Ctrl-C)
 *   --trace             print PC/opcode/symbol for every executed instruction
 *   --break a1,a2,...   stop and drop into the monitor when PC hits one of these (hex)
 *   --symbols <path>    hints JSON to resolve addresses to names (default disasm/nt3321-22.json)
 *   --repl              interactive monitor after the run (or immediately with --steps 0)
 *   --switches sa,sb,d1,d2,d3,d4  initial thumbwheel digits (0-9, 'B' for blank), see front-panel.md
 *   --unit-id <hex>     UNIT_ID byte latched via GRI digits 3/4 (informational only, see notes)
 *   --serial            bridge stdin/stdout to the emulated 8251A (type at the firmware's monitor)
 *   --master            program the synthetic receiver front end with the master phase code (default)
 *   --secondary         program the synthetic receiver front end with a secondary phase code instead
 *   --quiet             suppress the boot banner
 *
 * This models the CPU and memory-mapped peripherals as reconstructed in
 * docs/hardware.md. It has never been checked against a real board -- see
 * docs/emulator.md for the assumptions this makes and what is known to be
 * approximate (undocumented-opcode semantics, 8155 PC-mode simplification,
 * the synthetic receiver front end's timing and bit protocol).
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// =====================================================================
// CPU core
// =====================================================================

const REGNAME = ['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A'];

function parity(v) {
  let p = 0;
  for (let i = 0; i < 8; i++) if (v & (1 << i)) p ^= 1;
  return p === 0;
}

class Cpu8085 {
  constructor(bus) {
    this.bus = bus;
    this.B = 0; this.C = 0; this.D = 0; this.E = 0; this.H = 0; this.L = 0; this.A = 0;
    this.SP = 0; this.PC = 0;
    this.flagS = false; this.flagZ = false; this.flagAC = false; this.flagP = false;
    this.flagCY = false; this.flagV = false; // V ("K") is the 8085 undocumented overflow flag
    this.IE = false;
    // Interrupt masks: true = masked/disabled. Real 8085 resets with all three masked.
    this.M55 = true; this.M65 = true; this.M75 = true;
    this.I55 = false; this.I65 = false; this.I75 = false; // pending flags
    this.SID = false; this.SOD = false; this.SOE = false;
    this.halted = false;
    this.eiSuppressOnce = false;
    this.cycles = 0;
    this.trace = false;
    this.symbols = null; // Map<number,string>
    this.unknownOpcodeAt = null;
  }

  reset() {
    this.PC = 0; this.SP = 0; this.IE = false;
    this.M55 = true; this.M65 = true; this.M75 = true;
    this.I55 = false; this.I65 = false; this.I75 = false;
    this.halted = false;
  }

  symFor(addr) {
    if (!this.symbols) return '';
    const name = this.symbols.get(addr & 0xFFFF);
    return name ? ` (${name})` : '';
  }

  // ---- fetch / stack ----
  fetch8() { const v = this.bus.read8(this.PC); this.PC = (this.PC + 1) & 0xFFFF; return v; }
  fetch16() { const lo = this.fetch8(); const hi = this.fetch8(); return (hi << 8) | lo; }
  push16(v) {
    this.SP = (this.SP - 1) & 0xFFFF; this.bus.write8(this.SP, (v >> 8) & 0xFF);
    this.SP = (this.SP - 1) & 0xFFFF; this.bus.write8(this.SP, v & 0xFF);
  }
  pop16() {
    const lo = this.bus.read8(this.SP); this.SP = (this.SP + 1) & 0xFFFF;
    const hi = this.bus.read8(this.SP); this.SP = (this.SP + 1) & 0xFFFF;
    return (hi << 8) | lo;
  }

  // ---- register file ----
  getReg(i) {
    switch (i) {
      case 0: return this.B; case 1: return this.C; case 2: return this.D; case 3: return this.E;
      case 4: return this.H; case 5: return this.L;
      case 6: return this.bus.read8((this.H << 8) | this.L);
      case 7: return this.A;
    }
  }
  setReg(i, v) {
    v &= 0xFF;
    switch (i) {
      case 0: this.B = v; break; case 1: this.C = v; break; case 2: this.D = v; break; case 3: this.E = v; break;
      case 4: this.H = v; break; case 5: this.L = v; break;
      case 6: this.bus.write8((this.H << 8) | this.L, v); break;
      case 7: this.A = v; break;
    }
  }
  // B,D,H,SP pairs (LXI/DAD/INX/DCX)
  getRP(i) {
    switch (i) {
      case 0: return (this.B << 8) | this.C; case 1: return (this.D << 8) | this.E;
      case 2: return (this.H << 8) | this.L; case 3: return this.SP;
    }
  }
  setRP(i, v) {
    v &= 0xFFFF;
    switch (i) {
      case 0: this.B = (v >> 8) & 0xFF; this.C = v & 0xFF; break;
      case 1: this.D = (v >> 8) & 0xFF; this.E = v & 0xFF; break;
      case 2: this.H = (v >> 8) & 0xFF; this.L = v & 0xFF; break;
      case 3: this.SP = v; break;
    }
  }

  getF() {
    return (this.flagS ? 0x80 : 0) | (this.flagZ ? 0x40 : 0) | (this.flagAC ? 0x10 : 0) |
      (this.flagP ? 0x04 : 0) | 0x02 | (this.flagCY ? 0x01 : 0);
  }
  setF(f) {
    this.flagS = !!(f & 0x80); this.flagZ = !!(f & 0x40); this.flagAC = !!(f & 0x10);
    this.flagP = !!(f & 0x04); this.flagCY = !!(f & 0x01);
  }

  setZSP(r) { r &= 0xFF; this.flagZ = r === 0; this.flagS = !!(r & 0x80); this.flagP = parity(r); }

  aluAdd(a, b, cin) {
    const full = a + b + (cin ? 1 : 0);
    this.flagAC = ((a & 0xF) + (b & 0xF) + (cin ? 1 : 0)) > 0xF;
    this.flagCY = full > 0xFF;
    const r = full & 0xFF;
    this.setZSP(r);
    return r;
  }
  aluSub(a, b, bin) {
    const full = a - b - (bin ? 1 : 0);
    this.flagAC = (a & 0xF) < ((b & 0xF) + (bin ? 1 : 0));
    this.flagCY = full < 0;
    const r = full & 0xFF;
    this.setZSP(r);
    return r;
  }
  aluOp(which, val) {
    const a = this.A;
    switch (which) {
      case 0: this.A = this.aluAdd(a, val, false); break; // ADD
      case 1: this.A = this.aluAdd(a, val, this.flagCY); break; // ADC
      case 2: this.A = this.aluSub(a, val, false); break; // SUB
      case 3: this.A = this.aluSub(a, val, this.flagCY); break; // SBB
      case 4: { const r = a & val; this.flagCY = false; this.flagAC = !!((a | val) & 0x08); this.setZSP(r); this.A = r; break; } // ANA
      case 5: { const r = a ^ val; this.flagCY = false; this.flagAC = false; this.setZSP(r); this.A = r; break; } // XRA
      case 6: { const r = a | val; this.flagCY = false; this.flagAC = false; this.setZSP(r); this.A = r; break; } // ORA
      case 7: this.aluSub(a, val, false); break; // CMP: flags only
    }
  }
  inr(v) { const r = (v + 1) & 0xFF; this.flagAC = (v & 0xF) === 0xF; this.setZSP(r); return r; }
  dcr(v) { const r = (v - 1) & 0xFF; this.flagAC = (v & 0xF) !== 0x0; this.setZSP(r); return r; }
  dad(v) { const hl = (this.H << 8) | this.L; const full = hl + v; this.flagCY = full > 0xFFFF; const r = full & 0xFFFF; this.H = (r >> 8) & 0xFF; this.L = r & 0xFF; }

  daa() {
    const a = this.A; const cyIn = this.flagCY; const acIn = this.flagAC;
    let adjust = 0; let cyOut = cyIn;
    if (((a & 0xF) > 9) || acIn) adjust |= 0x06;
    if ((((a >> 4) & 0xF) > 9) || cyIn || (((a >> 4) & 0xF) === 9 && (a & 0xF) > 9)) { adjust |= 0x60; cyOut = true; }
    const result = (a + adjust) & 0xFF;
    this.flagAC = ((a & 0xF) + (adjust & 0xF)) > 0xF;
    this.A = result; this.flagCY = cyOut; this.setZSP(result);
  }

  testCC(i) {
    switch (i) {
      case 0: return !this.flagZ; case 1: return this.flagZ;
      case 2: return !this.flagCY; case 3: return this.flagCY;
      case 4: return !this.flagP; case 5: return this.flagP;
      case 6: return !this.flagS; case 7: return this.flagS;
    }
  }

  // ---- interrupts ----
  requestInterrupt(name) {
    if (name === '5.5') this.I55 = true;
    else if (name === '6.5') this.I65 = true;
    else if (name === '7.5') this.I75 = true;
  }
  pendingInterrupt() {
    if (this.I75 && !this.M75) return { name: '7.5', vector: 0x3C };
    if (this.I65 && !this.M65) return { name: '6.5', vector: 0x34 };
    if (this.I55 && !this.M55) return { name: '5.5', vector: 0x2C };
    return null;
  }
  acceptInterrupt(p) {
    this.IE = false;
    if (p.name === '7.5') this.I75 = false;
    if (p.name === '6.5') this.I65 = false;
    if (p.name === '5.5') this.I55 = false;
    this.halted = false;
    this.push16(this.PC);
    this.PC = p.vector;
  }

  // ---- one instruction ----
  step() {
    if (!this.halted) {
      if (this.eiSuppressOnce) { this.eiSuppressOnce = false; }
      else { const p = this.IE && this.pendingInterrupt(); if (p) this.acceptInterrupt(p); }
    }
    if (this.halted) {
      const p = this.IE && this.pendingInterrupt();
      if (p) { this.halted = false; this.acceptInterrupt(p); }
      else { this.cycles += 4; this.bus.tick(4); return; }
    }
    const pc0 = this.PC;
    const op = this.fetch8();
    if (this.trace) {
      console.log(`${pc0.toString(16).toUpperCase().padStart(4, '0')}${this.symFor(pc0)}: ${op.toString(16).toUpperCase().padStart(2, '0')}`);
    }
    const t0 = this.cycles;
    this.execute(op);
    const spent = (this.cycles - t0) || CYCLES[op] || 4;
    if (this.cycles === t0) this.cycles += (CYCLES[op] || 4);
    this.bus.tick((this.cycles - t0) || spent);
  }

  execute(op) {
    if (op === 0x76) { this.halted = true; return; } // HLT
    if (op >= 0x40 && op <= 0x7F) { const dst = (op >> 3) & 7, src = op & 7; this.setReg(dst, this.getReg(src)); return; } // MOV
    if (op >= 0x80 && op <= 0xBF) { const which = (op >> 3) & 7, src = op & 7; this.aluOp(which, this.getReg(src)); return; } // ALU r
    if ((op & 0xC7) === 0x04) { const r = (op >> 3) & 7; this.setReg(r, this.inr(this.getReg(r))); return; } // INR r
    if ((op & 0xC7) === 0x05) { const r = (op >> 3) & 7; this.setReg(r, this.dcr(this.getReg(r))); return; } // DCR r
    if ((op & 0xC7) === 0x06) { const r = (op >> 3) & 7; this.setReg(r, this.fetch8()); return; } // MVI r,d8
    if ((op & 0xC7) === 0xC6) { const which = (op >> 3) & 7; this.aluOp(which, this.fetch8()); return; } // ALU d8 (ADI/ACI/SUI/SBI/ANI/XRI/ORI/CPI)
    if ((op & 0xC7) === 0xC0) { const cc = (op >> 3) & 7; if (this.testCC(cc)) this.PC = this.pop16(); return; } // Rcc
    if ((op & 0xC7) === 0xC2) { const cc = (op >> 3) & 7; const a = this.fetch16(); if (this.testCC(cc)) this.PC = a; return; } // Jcc
    if ((op & 0xC7) === 0xC4) { const cc = (op >> 3) & 7; const a = this.fetch16(); if (this.testCC(cc)) { this.push16(this.PC); this.PC = a; } return; } // Ccc
    if ((op & 0xC7) === 0xC7) { const n = (op >> 3) & 7; this.push16(this.PC); this.PC = n * 8; return; } // RST n
    if ((op & 0xCF) === 0x01) { const rp = (op >> 4) & 3; this.setRP(rp, this.fetch16()); return; } // LXI
    if ((op & 0xCF) === 0x09) { const rp = (op >> 4) & 3; this.dad(this.getRP(rp)); return; } // DAD
    if ((op & 0xCF) === 0x03) { const rp = (op >> 4) & 3; this.setRP(rp, (this.getRP(rp) + 1) & 0xFFFF); return; } // INX
    if ((op & 0xCF) === 0x0B) { const rp = (op >> 4) & 3; this.setRP(rp, (this.getRP(rp) - 1) & 0xFFFF); return; } // DCX
    if ((op & 0xCF) === 0xC1) { // POP
      const rp = (op >> 4) & 3; const v = this.pop16();
      if (rp === 3) { this.A = (v >> 8) & 0xFF; this.setF(v & 0xFF); } else this.setRP(rp, v);
      return;
    }
    if ((op & 0xCF) === 0xC5) { // PUSH
      const rp = (op >> 4) & 3;
      const v = rp === 3 ? ((this.A << 8) | this.getF()) : this.getRP(rp);
      this.push16(v);
      return;
    }
    switch (op) {
      case 0x00: return; // NOP
      case 0x02: this.bus.write8((this.B << 8) | this.C, this.A); return; // STAX B
      case 0x0A: this.A = this.bus.read8((this.B << 8) | this.C); return; // LDAX B
      case 0x12: this.bus.write8((this.D << 8) | this.E, this.A); return; // STAX D
      case 0x1A: this.A = this.bus.read8((this.D << 8) | this.E); return; // LDAX D
      case 0x07: { const cy = !!(this.A & 0x80); this.A = ((this.A << 1) | (cy ? 1 : 0)) & 0xFF; this.flagCY = cy; return; } // RLC
      case 0x0F: { const cy = !!(this.A & 0x01); this.A = ((this.A >> 1) | (cy ? 0x80 : 0)) & 0xFF; this.flagCY = cy; return; } // RRC
      case 0x17: { const newCy = !!(this.A & 0x80); this.A = ((this.A << 1) | (this.flagCY ? 1 : 0)) & 0xFF; this.flagCY = newCy; return; } // RAL
      case 0x1F: { const newCy = !!(this.A & 0x01); this.A = ((this.A >> 1) | (this.flagCY ? 0x80 : 0)) & 0xFF; this.flagCY = newCy; return; } // RAR
      case 0x20: // RIM
        this.A = (this.M55 ? 1 : 0) | (this.M65 ? 2 : 0) | (this.M75 ? 4 : 0) | (this.IE ? 8 : 0) |
          (this.I55 ? 16 : 0) | (this.I65 ? 32 : 0) | (this.I75 ? 64 : 0) | (this.SID ? 128 : 0);
        return;
      case 0x22: { const a = this.fetch16(); this.bus.write8(a, this.L); this.bus.write8((a + 1) & 0xFFFF, this.H); return; } // SHLD
      case 0x27: this.daa(); return; // DAA
      case 0x2A: { const a = this.fetch16(); this.L = this.bus.read8(a); this.H = this.bus.read8((a + 1) & 0xFFFF); return; } // LHLD
      case 0x2F: this.A = (~this.A) & 0xFF; return; // CMA
      case 0x30: { // SIM
        const a = this.A;
        if (a & 0x08) { this.M55 = !!(a & 1); this.M65 = !!(a & 2); this.M75 = !!(a & 4); }
        if (a & 0x10) this.I75 = false;
        this.SOE = !!(a & 0x40);
        if (this.SOE) { this.SOD = !!(a & 0x80); if (this.bus.onSerialOut) this.bus.onSerialOut(this.SOD); }
        return;
      }
      case 0x32: this.bus.write8(this.fetch16(), this.A); return; // STA
      case 0x37: this.flagCY = true; return; // STC
      case 0x3A: this.A = this.bus.read8(this.fetch16()); return; // LDA
      case 0x3F: this.flagCY = !this.flagCY; return; // CMC
      case 0xC3: this.PC = this.fetch16(); return; // JMP
      case 0xC9: this.PC = this.pop16(); return; // RET
      case 0xCD: { const a = this.fetch16(); this.push16(this.PC); this.PC = a; return; } // CALL
      case 0xD3: this.fetch8(); return; // OUT d8 -- unused by this ROM (memory-mapped I/O only)
      case 0xDB: this.fetch8(); this.A = 0xFF; return; // IN d8 -- unused; open bus
      case 0xE3: { const lo = this.bus.read8(this.SP), hi = this.bus.read8((this.SP + 1) & 0xFFFF); this.bus.write8(this.SP, this.L); this.bus.write8((this.SP + 1) & 0xFFFF, this.H); this.L = lo; this.H = hi; return; } // XTHL
      case 0xE9: this.PC = (this.H << 8) | this.L; return; // PCHL
      case 0xEB: { const h = this.H, l = this.L; this.H = this.D; this.L = this.E; this.D = h; this.E = l; return; } // XCHG
      case 0xF3: this.IE = false; return; // DI
      case 0xF9: this.SP = (this.H << 8) | this.L; return; // SPHL
      case 0xFB: this.IE = true; this.eiSuppressOnce = true; return; // EI
      // ---- undocumented 8085 opcodes: best-effort, not authoritative (see docs/emulator.md) ----
      case 0x08: { // DSUB: HL -= BC
        const lo = this.aluSub(this.L, this.C, false); const loBorrow = this.flagCY;
        const hi = this.aluSub(this.H, this.B, loBorrow);
        this.L = lo; this.H = hi; this.flagZ = (this.H === 0 && this.L === 0);
        return;
      }
      case 0x10: { // ARHL: arithmetic shift right HL
        const hl = (this.H << 8) | this.L; this.flagCY = !!(hl & 1);
        const r = ((hl >> 1) | (hl & 0x8000)) & 0xFFFF; this.H = (r >> 8) & 0xFF; this.L = r & 0xFF;
        return;
      }
      case 0x18: { // RDEL: rotate DE left through carry
        const de = (this.D << 8) | this.E; const newCy = !!(de & 0x8000);
        const r = ((de << 1) | (this.flagCY ? 1 : 0)) & 0xFFFF;
        this.flagV = newCy !== !!(r & 0x8000); this.flagCY = newCy;
        this.D = (r >> 8) & 0xFF; this.E = r & 0xFF;
        return;
      }
      case 0x28: { const d = this.fetch8(); const hl = (this.H << 8) | this.L; const full = hl + d; const r = full & 0xFFFF; this.flagCY = full > 0xFFFF; this.D = (r >> 8) & 0xFF; this.E = r & 0xFF; return; } // LDHI
      case 0x38: { const d = this.fetch8(); const full = this.SP + d; const r = full & 0xFFFF; this.flagCY = full > 0xFFFF; this.D = (r >> 8) & 0xFF; this.E = r & 0xFF; return; } // LDSI
      case 0xCB: if (this.flagV) { this.push16(this.PC); this.PC = 0x0040; } return; // RSTV
      case 0xD9: { const a = (this.D << 8) | this.E; this.bus.write8(a, this.L); this.bus.write8((a + 1) & 0xFFFF, this.H); return; } // SHLX
      case 0xED: { const a = (this.D << 8) | this.E; this.L = this.bus.read8(a); this.H = this.bus.read8((a + 1) & 0xFFFF); return; } // LHLX
      case 0xDD: { const a = this.fetch16(); if (!this.flagV) this.PC = a; return; } // JNK
      case 0xFD: { const a = this.fetch16(); if (this.flagV) this.PC = a; return; } // JK
      default:
        this.unknownOpcodeAt = this.PC - 1;
        console.error(`emu8085: unimplemented opcode ${op.toString(16)} at ${(this.PC - 1).toString(16)}`);
        return;
    }
  }
}

// Rough T-state counts, used only to pace peripheral timers -- not cycle-exact.
const CYCLES = new Array(256).fill(7);
[0x00, 0x27, 0x2F, 0x37, 0x3F, 0x07, 0x0F, 0x17, 0x1F, 0x20, 0xEB, 0xF3, 0xFB, 0xF9, 0xE9].forEach(o => CYCLES[o] = 4);
[0xC3, 0x22, 0x2A, 0x32, 0x3A].forEach(o => CYCLES[o] = 13);
[0xCD].forEach(o => CYCLES[o] = 18);
[0xC9].forEach(o => CYCLES[o] = 10);
for (let i = 0; i < 4; i++) { CYCLES[0x01 | (i << 4)] = 10; CYCLES[0xC1 | (i << 4)] = 10; CYCLES[0xC5 | (i << 4)] = 12; }

// =====================================================================
// Peripherals
// =====================================================================

class Intel8155 {
  constructor(name) {
    this.name = name;
    this.ram = new Uint8Array(256);
    this.command = 0;
    this.paDir = 0; this.pbDir = 0; this.pcOutput = false;
    this.PA = 0; this.PB = 0; this.PC = 0;
    this.paIn = 0xFF; this.pbIn = 0xFF; this.pcIn = 0xFF; // external input latches
    this.timerLow = 0; this.timerHigh = 0; this.timerReload = 0; this.timerMode = 0;
    this.timerRunning = false; this.timerCurrent = 0; this.toutLevel = false;
    this.onPAWrite = null; this.onPBWrite = null; this.onPCWrite = null; this.onTimerOut = null;
  }
  writeCommand(v) {
    this.command = v;
    this.paDir = v & 1; this.pbDir = (v >> 1) & 1;
    // Simplified PC-mode model: this ROM only ever uses "PC all input" (E000<-0xC3-style)
    // or "PC all output" (0xCF-style), with IEA/IEB=0 (no handshake interrupts enabled) in
    // both observed cases, so the ALT1-4 handshake distinction is never exercised. See
    // docs/emulator.md for why this collapses the four official ALT modes to a binary choice.
    const pcSel = (v >> 2) & 3;
    this.pcOutput = pcSel !== 0;
    const tm = (v >> 6) & 3;
    if (tm === 3) {
      this.timerReload = ((this.timerHigh & 0x3F) << 8) | this.timerLow;
      this.timerMode = (this.timerHigh >> 6) & 3;
      this.timerCurrent = this.timerReload || 1;
      this.timerRunning = true;
    } else if (tm === 1 || tm === 2) {
      this.timerRunning = false;
    }
  }
  readReg(i) {
    switch (i) {
      case 0: return 0x00; // status: no interrupt/timer flags modeled
      case 1: return this.paDir ? this.PA : this.paIn;
      case 2: return this.pbDir ? this.PB : this.pbIn;
      case 3: return this.pcOutput ? this.PC : this.pcIn;
      case 4: return this.timerLow;
      case 5: return this.timerHigh;
      default: return 0xFF;
    }
  }
  writeReg(i, v) {
    v &= 0xFF;
    switch (i) {
      case 0: this.writeCommand(v); break;
      case 1: this.PA = v; if (this.onPAWrite) this.onPAWrite(v); break;
      case 2: this.PB = v; if (this.onPBWrite) this.onPBWrite(v); break;
      case 3: this.PC = v; if (this.onPCWrite) this.onPCWrite(v); break;
      case 4: this.timerLow = v; break;
      case 5: this.timerHigh = v; break;
    }
  }
  tick(tstates) {
    if (!this.timerRunning) return;
    this.timerCurrent -= tstates;
    let guard = 0;
    while (this.timerCurrent <= 0 && guard++ < 1000) {
      this.toutLevel = !this.toutLevel;
      if (this.onTimerOut) this.onTimerOut(this.toutLevel);
      this.timerCurrent += (this.timerReload || 1);
    }
  }
}

class Intel8251A {
  constructor() {
    this.expectingMode = true;
    this.mode = 0; this.command = 0;
    this.rxQueue = [];
    this.onTx = null;
  }
  readData() { return this.rxQueue.length ? this.rxQueue.shift() : 0; }
  writeData(v) { if (this.onTx) this.onTx(v & 0xFF); }
  readStatus() {
    const txReady = 1; // we "transmit" instantly to onTx
    const rxReady = this.rxQueue.length > 0 ? 1 : 0;
    return (txReady ? 0x01 : 0) | (rxReady ? 0x02 : 0) | 0x04 /* TxEmpty */;
  }
  writeControl(v) {
    if (this.expectingMode) { this.mode = v; this.expectingMode = false; }
    else { this.command = v; if (v & 0x40) this.expectingMode = true; /* internal reset */ }
  }
  injectRx(byte) { this.rxQueue.push(byte & 0xFF); }
  readByAddr(addr) { return (addr & 1) ? this.readStatus() : this.readData(); }
  writeByAddr(addr, v) { if (addr & 1) this.writeControl(v); else this.writeData(v); }
}

class Intel8279 {
  constructor() {
    this.displayRAM = new Uint8Array(16).fill(0xFF);
    this.sensorRAM = new Uint8Array(8);
    this.dispAddr = 0; this.autoIncr = false;
    this.readAddr = 0; this.readAutoIncr = false;
    this.mode = 0; this.prescaler = 0;
    this.irqPending = false;
    this.onDisplayWrite = null;
  }
  writeCommand(v) {
    const top = (v >> 5) & 7;
    switch (top) {
      case 0: this.mode = v & 0x1F; break; // keyboard/display mode set
      case 1: this.prescaler = v & 0x1F; break; // program clock
      case 2: this.readAddr = v & 0xF; this.readAutoIncr = !!(v & 0x10); break; // read FIFO/sensor RAM
      case 3: this.rdispAddr = v & 0xF; this.rdispAutoIncr = !!(v & 0x10); break; // read display RAM (unused by fw)
      case 4: this.dispAddr = v & 0xF; this.autoIncr = !!(v & 0x10); break; // write display RAM
      case 5: this.blank = v; break; // display write inhibit/blank
      case 6: this.displayRAM.fill(0xFF); this.irqPending = false; break; // clear (sensor RAM is a live mirror of the switch matrix in sensor-matrix mode, not chip state software can wipe -- see docs/emulator.md)
      case 7: this.irqPending = false; break; // end interrupt / error mode set
    }
  }
  readStatus() { return this.irqPending ? 0x10 : 0x00; }
  writeData(v) {
    this.displayRAM[this.dispAddr & 0xF] = v & 0xFF;
    if (this.onDisplayWrite) this.onDisplayWrite(this.dispAddr & 0xF, v & 0xFF);
    if (this.autoIncr) this.dispAddr = (this.dispAddr + 1) & 0xF;
  }
  readData() {
    const v = this.sensorRAM[this.readAddr & 0x7];
    if (this.readAutoIncr) this.readAddr = (this.readAddr + 1) & 0x7;
    return v;
  }
  setSensorRow(row, val) { this.sensorRAM[row & 7] = val & 0xFF; }
  raiseIrq() { this.irqPending = true; }
  readByAddr(addr) { return (addr & 1) ? this.readStatus() : this.readData(); }
  writeByAddr(addr, v) { if (addr & 1) this.writeCommand(v); else this.writeData(v); }
}

// =====================================================================
// Synthetic receiver front end (best-effort -- see docs/emulator.md)
//
// Drives 8155 #2 (F000) per the protocol reconstructed in hardware.md:
//   PB bit2 = latch/reset strobe, PB bit4 = shift clock, PB bit5 = sample ack
//   PC bit2 = epoch flag, PC bit3/4 = the two serial data streams
// and periodically raises RST 6.5 to represent the receiver's sample strobe.
// The exact bit-ordering SHIFT_IN16 expects has not been re-verified against
// the disassembly for this emulator; this generator produces the master (or
// secondary) Loran-C phase code bytes documented in hardware.md so the
// firmware sees *a* plausible signal, not a verified-correct one.
// =====================================================================

const PHASE_CODES = {
  master: [0xCA, 0x9F],
  secondary: [0xF9, 0xAC],
};

class ReceiverFrontEnd {
  constructor(cpu, pio2, which) {
    this.cpu = cpu; this.pio2 = pio2;
    this.words = PHASE_CODES[which] || PHASE_CODES.master;
    this.shift1 = 0; this.shift2 = 0; this.bitCount = 0;
    this.lastPB = pio2.PB;
    this.tStateAcc = 0;
    this.sampleInterval = 20000; // T-states between synthetic samples (approximate, not real-time)
    this.pcBits = 0;
    pio2.pcIn = 0xFF;
    pio2.onPBWrite = (v) => this.onPBWrite(v);
  }
  reloadShiftRegs() { this.shift1 = this.words[0]; this.shift2 = this.words[1]; this.bitCount = 0; }
  onPBWrite(v) {
    const rising = (bit) => !(this.lastPB & bit) && (v & bit);
    if (rising(0x04)) this.reloadShiftRegs(); // latch/reset strobe
    if (rising(0x10)) { // shift clock: present next bit on PC4/PC3
      const bit1 = (this.shift1 & 0x80) ? 1 : 0; this.shift1 = (this.shift1 << 1) & 0xFF;
      const bit2 = (this.shift2 & 0x80) ? 1 : 0; this.shift2 = (this.shift2 << 1) & 0xFF;
      this.pcBits = (this.pcBits & ~0x18) | (bit1 ? 0x10 : 0) | (bit2 ? 0x08 : 0);
      this.pio2.pcIn = (this.pio2.pcIn & ~0x18) | this.pcBits;
    }
    this.lastPB = v;
  }
  tick(tstates) {
    this.tStateAcc += tstates;
    if (this.tStateAcc < this.sampleInterval) return;
    this.tStateAcc -= this.sampleInterval;
    // Present the epoch flag for this sample, then strobe RST 6.5.
    this.pio2.pcIn |= 0x04;
    this.cpu.requestInterrupt('6.5');
  }
}

// =====================================================================
// Bus / memory map (see docs/hardware.md "Memory map" and "Address decoding")
// =====================================================================

class Bus {
  constructor() {
    this.rom = new Uint8Array(0x2000); // 0000-1FFF, ROM1+ROM2 back to back
    this.expRom = null; // optional 2000-2FFF
    this.pio1 = new Intel8155('8155#1 (U22 or U35, E000/6F00)');
    this.pio2 = new Intel8155('8155#2 (the other one, F000/7000)');
    this.usart = new Intel8251A();
    this.kdc = new Intel8279();
    this.latch8212 = 0; // purpose unconfirmed, see hardware.md checklist item 8; not memory-mapped in the reconstructed decode table
    this.frontEnd = null;
    this.pio1.onTimerOut = (level) => { if (level) this.pio1_rst75(); };
    this.trace = false;
  }
  pio1_rst75() {
    // hardware.md: 8155#1 TOUT is the *guessed* RST 7.5 source. Model it that way.
    if (this._cpu) this._cpu.requestInterrupt('7.5');
  }
  attachCpu(cpu) { this._cpu = cpu; }
  loadRom(buf, org) { for (let i = 0; i < buf.length && org + i < this.rom.length; i++) this.rom[org + i] = buf[i]; }
  loadExpRom(buf) { this.expRom = new Uint8Array(0x1000); for (let i = 0; i < buf.length && i < 0x1000; i++) this.expRom[i] = buf[i]; }

  read8(addr) {
    addr &= 0xFFFF;
    const sel = (addr >> 12) & 7;
    switch (sel) {
      case 0: return this.rom[addr & 0x0FFF];
      case 1: return this.rom[0x1000 + (addr & 0x0FFF)];
      case 2: return this.expRom ? this.expRom[addr & 0x0FFF] : 0xFF;
      case 3: return 0xFF;
      case 4: return this.usart.readByAddr(addr);
      case 5: return this.kdc.readByAddr(addr);
      case 6: return (addr & 0x8000) ? this.pio1.readReg(addr & 7) : this.pio1.ram[addr & 0xFF];
      case 7: return (addr & 0x8000) ? this.pio2.readReg(addr & 7) : this.pio2.ram[addr & 0xFF];
    }
  }
  write8(addr, val) {
    addr &= 0xFFFF; val &= 0xFF;
    const sel = (addr >> 12) & 7;
    switch (sel) {
      case 0: case 1: case 2: case 3: return; // ROM/unused: writes ignored
      case 4: this.usart.writeByAddr(addr, val); return;
      case 5: this.kdc.writeByAddr(addr, val); return;
      case 6: if (addr & 0x8000) this.pio1.writeReg(addr & 7, val); else this.pio1.ram[addr & 0xFF] = val; return;
      case 7: if (addr & 0x8000) this.pio2.writeReg(addr & 7, val); else this.pio2.ram[addr & 0xFF] = val; return;
    }
  }
  tick(tstates) {
    this.pio1.tick(tstates);
    this.pio2.tick(tstates);
    if (this.frontEnd) this.frontEnd.tick(tstates);
  }
}

// =====================================================================
// Symbol table (optional, from disasm/nt3321-22.json)
// =====================================================================

function loadSymbols(jsonPath) {
  try {
    const cfg = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const map = new Map();
    for (const [addr, name] of Object.entries(cfg.labels || {})) map.set(parseInt(addr, 16), name);
    for (const [addr, name] of Object.entries(cfg.equates || {})) map.set(parseInt(addr, 16), name);
    return map;
  } catch (e) {
    return null;
  }
}

// =====================================================================
// CLI harness
// =====================================================================

function parseArgs(argv) {
  const args = { steps: -1, trace: false, breaks: new Set(), repl: false, serial: false, phase: 'master', quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--rom1': args.rom1 = argv[++i]; break;
      case '--rom2': args.rom2 = argv[++i]; break;
      case '--exprom': args.exprom = argv[++i]; break;
      case '--steps': args.steps = parseInt(argv[++i], 10); break;
      case '--trace': args.trace = true; break;
      case '--break': argv[++i].split(',').forEach(x => args.breaks.add(parseInt(x, 16))); break;
      case '--symbols': args.symbols = argv[++i]; break;
      case '--repl': args.repl = true; break;
      case '--switches': args.switches = argv[++i].split(','); break;
      case '--unit-id': args.unitId = argv[++i]; break;
      case '--serial': args.serial = true; break;
      case '--master': args.phase = 'master'; break;
      case '--secondary': args.phase = 'secondary'; break;
      case '--quiet': args.quiet = true; break;
      default: console.error(`unknown option ${a}`); process.exit(1);
    }
  }
  return args;
}

function fmtRegs(cpu) {
  const f = `${cpu.flagS ? 'S' : '-'}${cpu.flagZ ? 'Z' : '-'}${cpu.flagAC ? 'A' : '-'}${cpu.flagP ? 'P' : '-'}${cpu.flagCY ? 'C' : '-'}`;
  return `PC=${cpu.PC.toString(16).toUpperCase().padStart(4, '0')}${cpu.symFor(cpu.PC)} SP=${cpu.SP.toString(16).toUpperCase().padStart(4, '0')} ` +
    `A=${cpu.A.toString(16).toUpperCase().padStart(2, '0')} B=${cpu.B.toString(16).toUpperCase().padStart(2, '0')} C=${cpu.C.toString(16).toUpperCase().padStart(2, '0')} ` +
    `D=${cpu.D.toString(16).toUpperCase().padStart(2, '0')} E=${cpu.E.toString(16).toUpperCase().padStart(2, '0')} H=${cpu.H.toString(16).toUpperCase().padStart(2, '0')} L=${cpu.L.toString(16).toUpperCase().padStart(2, '0')} ` +
    `F=${f} IE=${cpu.IE ? 1 : 0} HLT=${cpu.halted ? 1 : 0}`;
}

function applySwitches(kdc, sw, unitIdHex) {
  // front-panel.md: sensor rows 0-5 carry SEL_A, SEL_B, SW_D1..SW_D4, each as the
  // 9's-complement thumbwheel code (row & 3F) = 9-digit, blank reads back 0BH.
  const encode = (d) => {
    if (d === undefined || d === 'B' || d === 'b') return 0x0B; // blank position
    const n = parseInt(d, 10);
    return (9 - n) & 0x3F;
  };
  if (sw) sw.forEach((d, row) => kdc.setSensorRow(row, encode(d)));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const base = path.resolve(__dirname, '..');
  const rom1Path = args.rom1 || path.join(base, 'originals', 'CN19229N NT3321 7943.BIN');
  const rom2Path = args.rom2 || path.join(base, 'originals', 'CN19230N NT3322 7943.BIN');

  const bus = new Bus();
  bus.loadRom(fs.readFileSync(rom1Path), 0);
  bus.loadRom(fs.readFileSync(rom2Path), 0x1000);
  if (args.exprom) bus.loadExpRom(fs.readFileSync(args.exprom));

  const cpu = new Cpu8085(bus);
  bus.attachCpu(cpu);
  bus.frontEnd = new ReceiverFrontEnd(cpu, bus.pio2, args.phase);
  cpu.trace = args.trace;
  cpu.symbols = loadSymbols(args.symbols || path.join(base, 'disasm', 'nt3321-22.json'));

  if (args.switches) applySwitches(bus.kdc, args.switches, args.unitId);

  bus.usart.onTx = (byte) => process.stdout.write(Buffer.from([byte]));

  if (!args.quiet) {
    console.error(`emu8085: loaded ROM1 (${rom1Path}) + ROM2 (${rom2Path})`);
    console.error('emu8085: this is a best-effort reconstruction, not verified against real hardware -- see docs/emulator.md');
  }

  let rl = null;
  if (args.serial) {
    process.stdin.setRawMode && process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', (chunk) => { for (const b of chunk) bus.usart.injectRx(b); });
  }

  const breakSet = args.breaks;
  const maxSteps = args.steps;
  let n = 0;
  const limit = maxSteps >= 0 ? maxSteps : Infinity;
  try {
    while (n < limit) {
      if (breakSet.has(cpu.PC)) { console.error(`emu8085: breakpoint hit at ${cpu.PC.toString(16)}`); break; }
      cpu.step();
      n++;
      if (cpu.unknownOpcodeAt !== null) break;
    }
  } catch (e) {
    console.error(`emu8085: exception after ${n} steps at PC=${cpu.PC.toString(16)}: ${e.stack || e}`);
  }

  console.error(`emu8085: stopped after ${n} instructions. ${fmtRegs(cpu)}`);

  if (args.repl) {
    startRepl(cpu, bus);
  } else if (!args.serial) {
    process.exit(0);
  }
}

function startRepl(cpu, bus) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'emu> ' });
  console.error('emu8085: interactive monitor. Commands: s[N] step, c continue, r regs, m addr[,len] dump, break addr, tx <hex bytes>, q quit');
  rl.prompt();
  rl.on('line', (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    try {
      switch (cmd) {
        case 's': { const nStep = rest[0] ? parseInt(rest[0], 10) : 1; for (let i = 0; i < nStep; i++) cpu.step(); console.log(fmtRegs(cpu)); break; }
        case 'c': { const stop = rest[0] ? parseInt(rest[0], 16) : -1; let guard = 0; while (cpu.PC !== stop && guard++ < 5000000) cpu.step(); console.log(fmtRegs(cpu)); break; }
        case 'r': console.log(fmtRegs(cpu)); break;
        case 'm': {
          const addr = parseInt(rest[0], 16); const len = rest[1] ? parseInt(rest[1], 10) : 16;
          let s = '';
          for (let i = 0; i < len; i++) s += bus.read8(addr + i).toString(16).toUpperCase().padStart(2, '0') + ' ';
          console.log(`${addr.toString(16).toUpperCase().padStart(4, '0')}: ${s}`);
          break;
        }
        case 'tx': { const bytes = rest.join('').match(/../g) || []; bytes.forEach(h => bus.usart.injectRx(parseInt(h, 16))); break; }
        case 'q': rl.close(); return;
        default: console.log('unknown command');
      }
    } catch (e) { console.log(`error: ${e.message}`); }
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
}

module.exports = { Cpu8085, Bus, Intel8155, Intel8251A, Intel8279, ReceiverFrontEnd, loadSymbols };

if (require.main === module) main();
