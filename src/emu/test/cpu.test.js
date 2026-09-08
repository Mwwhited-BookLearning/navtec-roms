'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { makeCpu, step } = require('./helpers.js');

describe('Cpu8085: data movement', () => {
  it('MVI loads an immediate into a register', () => {
    const { cpu } = makeCpu([0x3E, 0x42]); // MVI A,42H
    step(cpu);
    assert.equal(cpu.A, 0x42);
  });

  it('MOV copies between registers', () => {
    const { cpu } = makeCpu([0x06, 0x99, 0x41]); // MVI B,99H ; MOV B,C(C=0)
    step(cpu, 2);
    assert.equal(cpu.B, 0x00);
  });

  it('MOV M,r and MOV r,M go through the bus at HL', () => {
    const { cpu, mem } = makeCpu([0x21, 0x00, 0x60, 0x3E, 0x7A, 0x77]); // LXI H,6000H; MVI A,7AH; MOV M,A
    step(cpu, 3);
    assert.equal(mem[0x6000], 0x7A);
  });

  it('LXI/SHLD/LHLD round-trip through memory', () => {
    const { cpu } = makeCpu([
      0x21, 0x34, 0x12, // LXI H,1234H
      0x22, 0x00, 0x60, // SHLD 6000H
      0x21, 0x00, 0x00, // LXI H,0000H
      0x2A, 0x00, 0x60, // LHLD 6000H
    ]);
    step(cpu, 4);
    assert.equal(cpu.H, 0x12);
    assert.equal(cpu.L, 0x34);
  });

  it('STA/LDA round-trip through the accumulator', () => {
    const { cpu } = makeCpu([0x3E, 0x55, 0x32, 0x00, 0x60, 0x3E, 0x00, 0x3A, 0x00, 0x60]);
    step(cpu, 4);
    assert.equal(cpu.A, 0x55);
  });

  it('XCHG swaps HL and DE', () => {
    const { cpu } = makeCpu([0x21, 0x11, 0x22, 0x11, 0x33, 0x44, 0xEB]); // LXI H,2211H; LXI D,4433H; XCHG
    step(cpu, 3);
    assert.equal(cpu.H, 0x44);
    assert.equal(cpu.L, 0x33);
    assert.equal(cpu.D, 0x22);
    assert.equal(cpu.E, 0x11);
  });

  it('XTHL swaps HL with the top of stack', () => {
    const { cpu } = makeCpu([
      0x31, 0x00, 0x70, // LXI SP,7000H
      0x21, 0xAA, 0xBB, // LXI H,BBAAH
      0xE5, // PUSH H
      0x21, 0x00, 0x00, // LXI H,0
      0xE3, // XTHL
    ]);
    step(cpu, 5);
    assert.equal(cpu.H, 0xBB);
    assert.equal(cpu.L, 0xAA);
  });
});

describe('Cpu8085: 8-bit arithmetic and flags', () => {
  it('ADD sets carry and clears it appropriately', () => {
    const { cpu } = makeCpu([0x3E, 0xFF, 0xC6, 0x01]); // MVI A,FFH; ADI 01H
    step(cpu, 2);
    assert.equal(cpu.A, 0x00);
    assert.equal(cpu.flagCY, true);
    assert.equal(cpu.flagZ, true);
  });

  it('ADD sets auxiliary carry on a nibble overflow', () => {
    const { cpu } = makeCpu([0x3E, 0x0F, 0xC6, 0x01]); // MVI A,0FH; ADI 01H
    step(cpu, 2);
    assert.equal(cpu.A, 0x10);
    assert.equal(cpu.flagAC, true);
    assert.equal(cpu.flagCY, false);
  });

  it('ADC includes the incoming carry', () => {
    const { cpu } = makeCpu([0x37, 0x3E, 0x01, 0xCE, 0x01]); // STC; MVI A,01H; ACI 01H
    step(cpu, 3);
    assert.equal(cpu.A, 0x03);
  });

  it('SUB borrows correctly', () => {
    const { cpu } = makeCpu([0x3E, 0x00, 0xD6, 0x01]); // MVI A,0; SUI 01H
    step(cpu, 2);
    assert.equal(cpu.A, 0xFF);
    assert.equal(cpu.flagCY, true);
  });

  it('CMP sets flags without changing the accumulator', () => {
    const { cpu } = makeCpu([0x3E, 0x05, 0xFE, 0x05]); // MVI A,05H; CPI 05H
    step(cpu, 2);
    assert.equal(cpu.A, 0x05);
    assert.equal(cpu.flagZ, true);
  });

  it('ANA sets the documented AC quirk from the OR of both operands\' bit 3', () => {
    // A=0F (bit3 set), operand=00 (bit3 clear) -> OR has bit3 set -> AC true
    let r = makeCpu([0x06, 0x00, 0x3E, 0x0F, 0xA0]); // MVI B,00H; MVI A,0FH; ANA B
    step(r.cpu, 3);
    assert.equal(r.cpu.flagAC, true);
    assert.equal(r.cpu.flagCY, false);
    // A=00, operand=00 -> neither has bit3 -> AC false
    r = makeCpu([0x06, 0x00, 0x3E, 0x00, 0xA0]);
    step(r.cpu, 3);
    assert.equal(r.cpu.flagAC, false);
  });

  it('XRA/ORA clear AC and CY', () => {
    const { cpu } = makeCpu([0x37, 0x3E, 0xFF, 0xAF]); // STC; MVI A,FFH; XRA A
    step(cpu, 3);
    assert.equal(cpu.A, 0x00);
    assert.equal(cpu.flagCY, false);
    assert.equal(cpu.flagZ, true);
  });

  it('INR preserves carry and sets AC at a nibble boundary', () => {
    const { cpu } = makeCpu([0x37, 0x06, 0x0F, 0x04]); // STC; MVI B,0FH; INR B
    step(cpu, 3);
    assert.equal(cpu.B, 0x10);
    assert.equal(cpu.flagAC, true);
    assert.equal(cpu.flagCY, true, 'INR must not touch CY');
  });

  it('DCR preserves carry', () => {
    const { cpu } = makeCpu([0x37, 0x06, 0x01, 0x05]); // STC; MVI B,01H; DCR B
    step(cpu, 3);
    assert.equal(cpu.B, 0x00);
    assert.equal(cpu.flagZ, true);
    assert.equal(cpu.flagCY, true, 'DCR must not touch CY');
  });

  it('DAA corrects a non-BCD low nibble', () => {
    const { cpu } = makeCpu([0x3E, 0x0A, 0x27]); // MVI A,0AH; DAA
    step(cpu, 2);
    assert.equal(cpu.A, 0x10);
    assert.equal(cpu.flagCY, false);
  });

  it('DAA performs a classic BCD add correction (59 + 05 = 64 BCD)', () => {
    const { cpu } = makeCpu([0x3E, 0x59, 0xC6, 0x05, 0x27]); // MVI A,59H; ADI 05H; DAA
    step(cpu, 3);
    assert.equal(cpu.A, 0x64);
    assert.equal(cpu.flagCY, false);
  });
});

describe('Cpu8085: rotates and complement', () => {
  it('RLC rotates bit 7 into bit 0 and carry', () => {
    const { cpu } = makeCpu([0x3E, 0x81, 0x07]); // MVI A,81H; RLC
    step(cpu, 2);
    assert.equal(cpu.A, 0x03);
    assert.equal(cpu.flagCY, true);
  });

  it('RRC rotates bit 0 into bit 7 and carry', () => {
    const { cpu } = makeCpu([0x3E, 0x01, 0x0F]); // MVI A,01H; RRC
    step(cpu, 2);
    assert.equal(cpu.A, 0x80);
    assert.equal(cpu.flagCY, true);
  });

  it('RAL rotates through carry, not wrapping bit 7 directly', () => {
    const { cpu } = makeCpu([0x37, 0x3E, 0x40, 0x17]); // STC; MVI A,40H; RAL
    step(cpu, 3);
    assert.equal(cpu.A, 0x81, 'old carry (1) shifts into bit 0');
    assert.equal(cpu.flagCY, false);
  });

  it('CMA complements the accumulator without touching flags', () => {
    const { cpu } = makeCpu([0x37, 0x3E, 0x0F, 0x2F]); // STC; MVI A,0FH; CMA
    step(cpu, 3);
    assert.equal(cpu.A, 0xF0);
    assert.equal(cpu.flagCY, true, 'CMA must not affect CY');
  });

  it('CMC toggles carry, STC sets it', () => {
    const { cpu } = makeCpu([0x37, 0x3F]); // STC; CMC
    step(cpu, 1);
    assert.equal(cpu.flagCY, true);
    step(cpu, 1);
    assert.equal(cpu.flagCY, false);
  });
});

describe('Cpu8085: 16-bit arithmetic and stack', () => {
  it('DAD sets carry on a 16-bit overflow', () => {
    const { cpu } = makeCpu([0x21, 0xFF, 0xFF, 0x01, 0x01, 0x00, 0x09]); // LXI H,FFFFH; LXI B,0001H; DAD B
    step(cpu, 3);
    assert.equal(cpu.H, 0x00);
    assert.equal(cpu.L, 0x00);
    assert.equal(cpu.flagCY, true);
  });

  it('INX/DCX wrap 16-bit register pairs', () => {
    const { cpu } = makeCpu([0x21, 0xFF, 0xFF, 0x23]); // LXI H,FFFFH; INX H
    step(cpu, 2);
    assert.equal(cpu.H, 0x00);
    assert.equal(cpu.L, 0x00);
  });

  it('PUSH/POP preserve a register pair through the stack', () => {
    const { cpu } = makeCpu([
      0x31, 0x00, 0x70, // LXI SP,7000H
      0x01, 0x34, 0x12, // LXI B,1234H
      0xC5, // PUSH B
      0x01, 0x00, 0x00, // LXI B,0
      0xC1, // POP B
    ]);
    step(cpu, 5);
    assert.equal(cpu.B, 0x12);
    assert.equal(cpu.C, 0x34);
  });

  it('PUSH PSW / POP PSW round-trip A and the packed flags byte', () => {
    const { cpu } = makeCpu([
      0x31, 0x00, 0x70, // LXI SP,7000H
      0x37, // STC
      0x3E, 0x81, // MVI A,81H
      0xF5, // PUSH PSW
      0x3E, 0x00, // MVI A,0
      0xF1, // POP PSW
    ]);
    step(cpu, 6); // LXI, STC, MVI, PUSH, MVI, POP -- one step() per instruction
    assert.equal(cpu.A, 0x81);
    assert.equal(cpu.flagCY, true, 'carry must survive the round trip');
  });

  it('SPHL loads SP from HL', () => {
    const { cpu } = makeCpu([0x21, 0x00, 0x71, 0xF9]); // LXI H,7100H; SPHL
    step(cpu, 2);
    assert.equal(cpu.SP, 0x7100);
  });
});

describe('Cpu8085: control flow', () => {
  it('JMP is unconditional', () => {
    const { cpu } = makeCpu([0xC3, 0x10, 0x00]);
    step(cpu, 1);
    assert.equal(cpu.PC, 0x0010);
  });

  it('conditional jump taken vs not taken tracks the zero flag', () => {
    // MVI doesn't touch flags -- ANA A (a no-op logically) runs it through
    // the ALU so Z actually reflects the loaded value.
    const { cpu } = makeCpu([0x3E, 0x00, 0xA7, 0xCA, 0x10, 0x00]); // MVI A,0; ANA A; JZ 0010H
    step(cpu, 3);
    assert.equal(cpu.PC, 0x0010);
  });

  it('conditional jump not taken falls through', () => {
    const { cpu } = makeCpu([0x3E, 0x01, 0xA7, 0xCA, 0x10, 0x00]); // MVI A,1; ANA A; JZ 0010H
    step(cpu, 3);
    assert.equal(cpu.PC, 0x0006);
  });

  it('CALL/RET round-trip through the stack', () => {
    const { cpu, bus } = makeCpu([
      0x31, 0x00, 0x70, // LXI SP,7000H
      0xCD, 0x10, 0x00, // CALL 0010H
      0x00, // (return lands here)
    ], 0);
    bus.write8(0x0010, 0xC9); // RET at the call target
    step(cpu, 2); // LXI SP, CALL
    assert.equal(cpu.PC, 0x0010);
    assert.equal(cpu.SP, 0x6FFE);
    step(cpu, 1); // RET
    assert.equal(cpu.PC, 0x0006, 'RET must return to just after CALL');
  });

  it('RST n vectors to n*8 and can be returned from', () => {
    const { cpu, bus } = makeCpu([0x31, 0x00, 0x70, 0xDF]); // LXI SP,7000H; RST 3
    bus.write8(0x0018, 0xC9); // RET at the RST 3 vector
    step(cpu, 2);
    assert.equal(cpu.PC, 0x0018);
    step(cpu, 1);
    assert.equal(cpu.PC, 0x0004);
  });

  it('PCHL jumps through HL', () => {
    const { cpu } = makeCpu([0x21, 0x00, 0x20, 0xE9]); // LXI H,2000H; PCHL
    step(cpu, 2);
    assert.equal(cpu.PC, 0x2000);
  });
});

describe('Cpu8085: interrupts, SIM/RIM, HLT', () => {
  it('SIM 1DH matches hardware.md\'s documented INIT sequence exactly', () => {
    const { cpu } = makeCpu([0x3E, 0x1D, 0x30]); // MVI A,1DH; SIM
    step(cpu, 2);
    assert.equal(cpu.M55, true);
    assert.equal(cpu.M65, false);
    assert.equal(cpu.M75, true);
    assert.equal(cpu.I75, false, 'R7.5 bit must reset the pending RST 7.5 flip-flop');
  });

  it('RIM reports masks, IE, and pending bits in the documented bit order', () => {
    const { cpu } = makeCpu([0x3E, 0x1D, 0x30, 0xFB, 0x20]); // MVI A,1DH; SIM; EI; RIM
    step(cpu, 3); // MVI, SIM, EI -- PC now points at the RIM opcode
    cpu.I65 = true; // simulate a pending, unmasked RST 6.5 arriving before RIM runs
    step(cpu, 1); // RIM
    // bit0=M55(1), bit1=M65(0), bit2=M75(1), bit3=IE(1), bit5=I65(1)
    assert.equal(cpu.A & 0x01, 0x01);
    assert.equal(cpu.A & 0x02, 0x00);
    assert.equal(cpu.A & 0x04, 0x04);
    assert.equal(cpu.A & 0x08, 0x08);
    assert.equal(cpu.A & 0x20, 0x20);
  });

  it('an unmasked, enabled interrupt vectors and clears IE', () => {
    // step() both accepts a pending interrupt AND executes the first
    // instruction at its vector in the same call (matching "one step() per
    // instruction," since forced vectoring isn't itself an instruction) --
    // use HLT at the vector so a single step() proves the vector was taken
    // without also needing to reason about what runs after it.
    const { cpu, bus } = makeCpu([0xFB, 0x00]); // EI; NOP
    step(cpu, 1); // EI (interrupt check suppressed for the next instruction)
    step(cpu, 1); // NOP (still suppressed instruction, per the one-instruction EI delay)
    cpu.M65 = false; // unmask RST 6.5 (masked by default at reset)
    cpu.requestInterrupt('6.5');
    bus.write8(0x0034, 0x76); // HLT at the RST 6.5 vector
    step(cpu, 1); // accepts the interrupt, then executes the HLT now sitting at PC
    assert.equal(cpu.halted, true, 'must have executed the HLT placed at the RST 6.5 vector');
    assert.equal(cpu.IE, false, 'accepting an interrupt clears IE');
  });

  it('EI delays interrupt recognition by exactly one instruction', () => {
    const { cpu, bus } = makeCpu([0xFB, 0x00, 0x00]); // EI; NOP; NOP
    cpu.M65 = false;
    bus.write8(0x0034, 0x76); // HLT marker so we can tell if we vectored early
    cpu.requestInterrupt('6.5');
    step(cpu, 1); // EI
    step(cpu, 1); // the instruction right after EI must still execute normally
    assert.equal(cpu.PC, 0x0002, 'interrupt must not be taken on the instruction right after EI');
  });

  it('HLT halts the CPU and an unmasked interrupt wakes it', () => {
    const { cpu } = makeCpu([0xFB, 0x00, 0x76]); // EI; NOP; HLT
    cpu.M65 = false;
    step(cpu, 3);
    assert.equal(cpu.halted, true);
    cpu.requestInterrupt('6.5');
    // Waking also executes the vector's first instruction in the same
    // step() call; memory at 0034H defaults to 0 (NOP), so PC should land
    // one past the vector, not on it.
    step(cpu, 1);
    assert.equal(cpu.halted, false);
    assert.equal(cpu.PC, 0x0035);
  });

  it('a masked interrupt never vectors even when requested', () => {
    const { cpu } = makeCpu([0xFB, 0x00, 0x00]);
    // M65 defaults to true (masked) at reset -- leave it masked.
    cpu.requestInterrupt('6.5');
    step(cpu, 3);
    assert.notEqual(cpu.PC, 0x0034);
  });
});

describe('Cpu8085: undocumented opcodes (best-effort, see docs/emulator.md)', () => {
  it('DSUB computes HL -= BC', () => {
    const { cpu } = makeCpu([0x21, 0x05, 0x00, 0x01, 0x02, 0x00, 0x08]); // LXI H,5; LXI B,2; DSUB
    step(cpu, 3);
    assert.equal((cpu.H << 8) | cpu.L, 3);
  });

  it('ARHL performs an arithmetic (sign-preserving) shift right of HL', () => {
    const { cpu } = makeCpu([0x21, 0x01, 0x80, 0x10]); // LXI H,8001H; ARHL
    step(cpu, 2);
    assert.equal(cpu.flagCY, true, 'old bit 0 of L shifts into carry');
    assert.equal((cpu.H << 8) | cpu.L, 0xC000, 'sign bit (bit15) must be preserved');
  });

  it('LDHI adds an immediate byte to HL into DE without touching HL', () => {
    const { cpu } = makeCpu([0x21, 0x00, 0x10, 0x28, 0x05]); // LXI H,1000H; LDHI 05H
    step(cpu, 2);
    assert.equal((cpu.D << 8) | cpu.E, 0x1005);
    assert.equal((cpu.H << 8) | cpu.L, 0x1000, 'LDHI must not modify HL');
  });

  it('SHLX/LHLX store and load HL through the address in DE', () => {
    const { cpu } = makeCpu([
      0x11, 0x00, 0x60, // LXI D,6000H
      0x21, 0xCD, 0xAB, // LXI H,ABCDH
      0xD9, // SHLX
      0x21, 0x00, 0x00, // LXI H,0
      0xED, // LHLX
    ]);
    step(cpu, 5); // LXI D, LXI H, SHLX, LXI H, LHLX -- one step() per instruction, not per byte
    assert.equal(cpu.H, 0xAB);
    assert.equal(cpu.L, 0xCD);
  });

  it('RSTV only vectors when the V (overflow) flag is set', () => {
    let r = makeCpu([0xCB, 0x00]); // RSTV; NOP
    step(r.cpu, 1);
    assert.equal(r.cpu.PC, 0x0001, 'V clear: RSTV must be a no-op besides consuming its byte');

    r = makeCpu([0x31, 0x00, 0x70, 0xCB]); // LXI SP,7000H; RSTV
    step(r.cpu, 1);
    r.cpu.flagV = true;
    step(r.cpu, 1);
    assert.equal(r.cpu.PC, 0x0040, 'V set: RSTV must vector to 0040H');
  });
});
