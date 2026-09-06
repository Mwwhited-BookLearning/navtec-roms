#!/usr/bin/env node
'use strict';
/*
 * dis8085.js -- flow-tracing disassembler for Intel 8085 ROM images.
 *
 * Usage:  node tools/dis8085.js <config.json>
 *
 * The config describes which binary files load where, the code entry
 * points, and manual hints (labels, comments, data regions, jump tables).
 * The tool performs recursive-descent code discovery from the entry
 * points, then emits:
 *   <out>.lst      listing: address / bytes / source / comments
 *   <out>.asm      re-assemblable source with EQUs for external addresses
 *   <out>-refs.md  memory and I/O cross-reference report (Markdown)
 */
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------- opcodes
const R = ['B', 'C', 'D', 'E', 'H', 'L', 'M', 'A'];
const RP = ['B', 'D', 'H', 'SP'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];
const OPS = new Array(256);
function op(code, mn, len, flow) { OPS[code] = { mn, len, flow: flow || 'seq' }; }
for (let i = 0; i < 4; i++) {
  op(0x01 | (i << 4), `LXI ${RP[i]},$W`, 3);
  op(0x09 | (i << 4), `DAD ${RP[i]}`, 1);
  op(0x03 | (i << 4), `INX ${RP[i]}`, 1);
  op(0x0B | (i << 4), `DCX ${RP[i]}`, 1);
  op(0xC1 | (i << 4), `POP ${i === 3 ? 'PSW' : RP[i]}`, 1);
  op(0xC5 | (i << 4), `PUSH ${i === 3 ? 'PSW' : RP[i]}`, 1);
}
op(0x02, 'STAX B', 1); op(0x12, 'STAX D', 1); op(0x0A, 'LDAX B', 1); op(0x1A, 'LDAX D', 1);
const ALU = ['ADD', 'ADC', 'SUB', 'SBB', 'ANA', 'XRA', 'ORA', 'CMP'];
const ALUI = ['ADI', 'ACI', 'SUI', 'SBI', 'ANI', 'XRI', 'ORI', 'CPI'];
for (let i = 0; i < 8; i++) {
  op(0x04 | (i << 3), `INR ${R[i]}`, 1);
  op(0x05 | (i << 3), `DCR ${R[i]}`, 1);
  op(0x06 | (i << 3), `MVI ${R[i]},$B`, 2);
  for (let j = 0; j < 8; j++) if (!(i === 6 && j === 6)) op(0x40 | (i << 3) | j, `MOV ${R[i]},${R[j]}`, 1);
  for (let j = 0; j < 8; j++) op(0x80 | (i << 3) | j, `${ALU[i]} ${R[j]}`, 1);
  op(0xC6 | (i << 3), `${ALUI[i]} $B`, 2);
  op(0xC0 | (i << 3), `R${CC[i]}`, 1, 'cret');
  op(0xC2 | (i << 3), `J${CC[i]} $W`, 3, 'cjmp');
  op(0xC4 | (i << 3), `C${CC[i]} $W`, 3, 'ccall');
  op(0xC7 | (i << 3), `RST ${i}`, 1, 'rst');
}
op(0x76, 'HLT', 1, 'hlt');
op(0x00, 'NOP', 1); op(0x07, 'RLC', 1); op(0x0F, 'RRC', 1); op(0x17, 'RAL', 1); op(0x1F, 'RAR', 1);
op(0x20, 'RIM', 1); op(0x30, 'SIM', 1); op(0x27, 'DAA', 1); op(0x2F, 'CMA', 1); op(0x37, 'STC', 1); op(0x3F, 'CMC', 1);
op(0x22, 'SHLD $W', 3); op(0x2A, 'LHLD $W', 3); op(0x32, 'STA $W', 3); op(0x3A, 'LDA $W', 3);
op(0xC3, 'JMP $W', 3, 'jmp'); op(0xC9, 'RET', 1, 'ret'); op(0xCD, 'CALL $W', 3, 'call');
op(0xD3, 'OUT $B', 2); op(0xDB, 'IN $B', 2);
op(0xE3, 'XTHL', 1); op(0xE9, 'PCHL', 1, 'pchl'); op(0xEB, 'XCHG', 1);
op(0xF3, 'DI', 1); op(0xF9, 'SPHL', 1); op(0xFB, 'EI', 1);
// 8085 undocumented instructions
op(0x08, 'DSUB', 1); op(0x10, 'ARHL', 1); op(0x18, 'RDEL', 1); op(0x28, 'LDHI $B', 2); op(0x38, 'LDSI $B', 2);
op(0xCB, 'RSTV', 1, 'rst'); op(0xD9, 'SHLX', 1); op(0xED, 'LHLX', 1); op(0xDD, 'JNK $W', 3, 'cjmp'); op(0xFD, 'JK $W', 3, 'cjmp');

// ---------------------------------------------------------------- helpers
const hex2 = v => v.toString(16).toUpperCase().padStart(2, '0');
const hex4 = v => v.toString(16).toUpperCase().padStart(4, '0');
const asmH2 = v => { const s = hex2(v); return (/^[A-F]/.test(s) ? '0' : '') + s + 'H'; };
const asmH4 = v => { const s = hex4(v); return (/^[A-F]/.test(s) ? '0' : '') + s + 'H'; };
const p16 = s => typeof s === 'number' ? s : parseInt(s, 16);

// ---------------------------------------------------------------- main
function main() {
  const cfgPath = process.argv[2];
  if (!cfgPath) { console.error('usage: dis8085.js config.json'); process.exit(1); }
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const base = path.dirname(cfgPath);

  const mem = new Uint8Array(0x10000);
  const present = new Uint8Array(0x10000);
  for (const img of cfg.images) {
    const buf = fs.readFileSync(path.resolve(base, img.file));
    const org = p16(img.org);
    for (let i = 0; i < buf.length; i++) { mem[org + i] = buf[i]; present[org + i] = 1; }
  }

  // ---- hints
  const labels = new Map();
  const comments = new Map();
  const blockComments = new Map();
  const dataRegions = [];
  const equates = new Map();
  const opConst = new Set((cfg.opConst || []).map(p16));
  for (const [a, n] of Object.entries(cfg.labels || {})) labels.set(p16(a), n);
  for (const [a, n] of Object.entries(cfg.equates || {})) equates.set(p16(a), n);
  for (const [a, c] of Object.entries(cfg.comments || {})) comments.set(p16(a), c);
  for (const [a, c] of Object.entries(cfg.blockComments || {})) blockComments.set(p16(a), Array.isArray(c) ? c : [c]);
  for (const d of cfg.data || []) dataRegions.push({ start: p16(d.start), end: p16(d.end), kind: d.kind || 'db', width: d.width || 8 });
  const regionAt = a => dataRegions.find(d => a >= d.start && a <= d.end);

  // ---- code discovery
  const isCode = new Uint8Array(0x10000);
  const inInsn = new Uint8Array(0x10000);
  const xrefs = new Map();
  const memRefs = new Map();
  const ioRefs = new Map();
  const addX = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };

  const queue = [];
  for (const e of cfg.entries || []) {
    const ent = typeof e === 'string' ? { addr: p16(e) } : { addr: p16(e.addr), name: e.name };
    queue.push(ent.addr);
    if (ent.name && !labels.has(ent.addr)) labels.set(ent.addr, ent.name);
  }
  for (const jt of cfg.jumpTables || []) {
    const a = p16(jt.addr);
    for (let i = 0; i < jt.count; i++) {
      const t = mem[a + 2 * i] | (mem[a + 2 * i + 1] << 8);
      queue.push(t); addX(xrefs, t, { from: a + 2 * i, kind: 'tbl' });
    }
    dataRegions.push({ start: a, end: a + jt.count * 2 - 1, kind: 'dw' });
  }
  for (const ex of cfg.extraCode || []) queue.push(p16(ex));

  while (queue.length) {
    let pc = queue.pop();
    for (;;) {
      if (pc > 0xFFFF || !present[pc] || isCode[pc] || regionAt(pc) || inInsn[pc]) break;
      const o = OPS[mem[pc]];
      if (!o) break;
      isCode[pc] = 1;
      for (let i = 0; i < o.len; i++) inInsn[pc + i] = 1;
      const b = mem[pc + 1], w = mem[pc + 1] | (mem[pc + 2] << 8);
      const opc = mem[pc];
      if (opConst.has(pc)) { /* constant operand: no memory reference */ }
      else if (opc === 0x32) addX(memRefs, w, { from: pc, kind: 'w' });
      else if (opc === 0x3A) addX(memRefs, w, { from: pc, kind: 'r' });
      else if (opc === 0x22) addX(memRefs, w, { from: pc, kind: 'W' });
      else if (opc === 0x2A) addX(memRefs, w, { from: pc, kind: 'R' });
      else if ((opc & 0xCF) === 0x01) addX(memRefs, w, { from: pc, kind: 'lxi' });
      else if (opc === 0xD3) addX(ioRefs, b, { from: pc, kind: 'out' });
      else if (opc === 0xDB) addX(ioRefs, b, { from: pc, kind: 'in' });
      let next = pc + o.len;
      switch (o.flow) {
        case 'jmp': addX(xrefs, w, { from: pc, kind: 'jmp' }); queue.push(w); next = -1; break;
        case 'cjmp': addX(xrefs, w, { from: pc, kind: 'jmp' }); queue.push(w); break;
        case 'call': case 'ccall': addX(xrefs, w, { from: pc, kind: 'call' }); queue.push(w); break;
        case 'rst': { const t = (opc === 0xCB) ? 0x40 : (opc & 0x38); addX(xrefs, t, { from: pc, kind: 'call' }); queue.push(t); break; }
        case 'ret': case 'pchl': case 'hlt': next = -1; break;
        default: break;
      }
      if (next < 0) break;
      pc = next;
    }
  }

  // ---- automatic labels for anything not named by hand
  for (const [t, refs] of xrefs) {
    if (labels.has(t) || equates.has(t)) continue;
    if (!present[t]) { labels.set(t, `X_${hex4(t)}`); continue; }
    const kinds = new Set(refs.map(r => r.kind));
    labels.set(t, kinds.has('call') ? `SUB_${hex4(t)}` : `L_${hex4(t)}`);
  }
  for (const [a] of memRefs) {
    if (labels.has(a) || equates.has(a)) continue;
    if (present[a]) labels.set(a, `D_${hex4(a)}`);
    else equates.set(a, `M_${hex4(a)}`);
  }
  const nameOf = a => labels.get(a) || equates.get(a);
  const fmtW = w => nameOf(w) || asmH4(w);

  // ---- render
  const lst = [], asm = [];
  if (cfg.asmHeader) for (const h of [].concat(cfg.asmHeader)) asm.push(h);
  const blankLabels = [...labels.entries()].filter(([a]) => { const r = regionAt(a); return r && r.kind === 'blank'; }).sort((x, y) => x[0] - y[0]);
  if (blankLabels.length) {
    asm.push('; ---- routines located in undumped ROM halves (see docs/rom-status.md) ----');
    for (const [a, n] of blankLabels) asm.push(`${n.padEnd(12)} EQU  ${asmH4(a)}`);
    asm.push('');
  }
  const eq = [...equates.entries()].sort((a, b) => a[0] - b[0]);
  if (eq.length) {
    asm.push('; ---- external addresses (RAM / memory-mapped I/O) ----');
    for (const [a, n] of eq) {
      const refs = memRefs.get(a) || [];
      const rd = refs.filter(r => r.kind === 'r' || r.kind === 'R').length;
      const wr = refs.filter(r => r.kind === 'w' || r.kind === 'W').length;
      const lx = refs.filter(r => r.kind === 'lxi').length;
      const c = comments.get(a) ? `  ; ${comments.get(a)}` : `  ; rd=${rd} wr=${wr} lxi=${lx}`;
      asm.push(`${n.padEnd(12)} EQU  ${asmH4(a)}${c}`);
    }
    asm.push('');
  }

  const loaded = [];
  for (let a = 0; a < 0x10000; a++) if (present[a]) loaded.push(a);
  const lineLst = (addr, bytes, src, cmt) => {
    const bs = bytes.map(hex2).join(' ').padEnd(9);
    lst.push(`${hex4(addr)}  ${bs}  ${src.padEnd(28)}${cmt ? '; ' + cmt : ''}`.trimEnd());
  };
  const lineAsm = (src, cmt) => asm.push(`        ${src.padEnd(28)}${cmt ? '; ' + cmt : ''}`.trimEnd());
  const bytesAt = (a, n) => { const r = []; for (let k = 0; k < n; k++) r.push(mem[a + k]); return r; };

  let prevA = -2;
  for (let idx = 0; idx < loaded.length; idx++) {
    const a = loaded[idx];
    if (a !== prevA + 1) { asm.push('', `        ORG  ${asmH4(a)}`, ''); lst.push('', `; ---- ORG ${hex4(a)} ----`); }
    if (blockComments.has(a)) { lst.push(''); asm.push(''); for (const l of blockComments.get(a)) { lst.push(`; ${l}`); asm.push(`; ${l}`); } }
    if (labels.has(a)) {
      const refs = xrefs.get(a) || [];
      const rx = refs.length ? `xref: ${refs.map(r => (r.kind === 'call' ? 'c' : r.kind === 'tbl' ? 't' : 'j') + hex4(r.from)).join(' ')}` : '';
      const mr = memRefs.get(a);
      const mx = mr ? `refs: ${mr.map(r => r.kind + hex4(r.from)).join(' ')}` : '';
      lst.push(`${labels.get(a)}:`.padEnd(45) + (rx || mx ? `; ${[rx, mx].filter(Boolean).join(' ')}` : ''));
      asm.push(`${labels.get(a)}:`);
    }
    if (isCode[a]) {
      const o = OPS[mem[a]];
      for (let k = 1; k < o.len; k++) if (labels.has(a + k)) {
        lst.push(`${labels.get(a + k)}:`.padEnd(45) + `; = ${hex4(a + k)}, inside the next instruction (entered by jumping past the 21H prefix)`);
        asm.push(`${labels.get(a + k).padEnd(12)} EQU  $+${k}`);
      }
      const b = mem[a + 1], w = mem[a + 1] | (mem[a + 2] << 8);
      const src = o.mn.replace('$W', opConst.has(a) ? asmH4(w) : fmtW(w)).replace('$B', asmH2(b));
      let cmt = comments.get(a) || '';
      if (!cmt && o.len === 2 && b >= 0x20 && b < 0x7F && /MVI|CPI|ADI|SUI|ANI|ORI|XRI/.test(o.mn)) cmt = `'${String.fromCharCode(b)}'`;
      lineLst(a, bytesAt(a, o.len), src, cmt); lineAsm(src, cmt);
      idx += o.len - 1; prevA = a + o.len - 1;
      continue;
    }
    const region = regionAt(a);
    if (region && region.kind === 'blank') {
      const e = region.end;
      lst.push(`${hex4(a)}  FF ...     ; unprogrammed (0FFH) through ${hex4(e)} -- ${e - a + 1} bytes not present in dump`);
      asm.push(`; ---- ${hex4(a)}-${hex4(e)}: unprogrammed / not dumped (reads as 0FFH) ----`);
      while (idx < loaded.length && loaded[idx] <= e) idx++;
      idx--; prevA = -2; continue;
    }
    if (region && region.kind === 'dw') {
      const w = mem[a] | (mem[a + 1] << 8);
      lineLst(a, bytesAt(a, 2), `DW   ${fmtW(w)}`, comments.get(a) || '');
      lineAsm(`DW   ${fmtW(w)}`, comments.get(a) || '');
      idx += 1; prevA = a + 1; continue;
    }
    if (region && region.kind === 'str') {
      let e = a, n = 0;
      while (e <= region.end && !isCode[e] && (e === a || !labels.has(e)) && n < 40) { n++; e++; }
      const parts = []; let cur = '';
      for (let k = a; k < e; k++) {
        const c = mem[k];
        if (c >= 0x20 && c < 0x7F && c !== 0x27) cur += String.fromCharCode(c);
        else { if (cur) { parts.push(`'${cur}'`); cur = ''; } parts.push(asmH2(c)); }
      }
      if (cur) parts.push(`'${cur}'`);
      const src = `DB   ${parts.join(',')}`;
      lineLst(a, bytesAt(a, Math.min(n, 8)), src, comments.get(a) || (n > 8 ? `${n} bytes` : ''));
      lineAsm(src, comments.get(a) || '');
      idx += n - 1; prevA = e - 1; continue;
    }
    let e = a, n = 0;
    const maxN = region ? region.width : 8;
    while (n < maxN && e <= 0xFFFF && present[e] && !isCode[e] && (e === a || (!labels.has(e) && !blockComments.has(e))) && (region ? e <= region.end : !regionAt(e))) { n++; e++; }
    const bytes = bytesAt(a, n);
    const ascii = bytes.map(c => (c >= 0x20 && c < 0x7F) ? String.fromCharCode(c) : '.').join('');
    const src = `DB   ${bytes.map(asmH2).join(',')}`;
    lineLst(a, bytes, src, comments.get(a) || `|${ascii}|`);
    lineAsm(src, comments.get(a) || '');
    idx += n - 1; prevA = e - 1;
  }

  const out = path.resolve(base, cfg.output);
  fs.writeFileSync(out + '.lst', lst.join('\n') + '\n');
  fs.writeFileSync(out + '.asm', asm.join('\n') + '\n');

  // ---- cross-reference report
  const rep = [];
  rep.push('# Cross-reference report', '', `Generated by tools/dis8085.js from ${cfg.images.map(i => i.file).join(', ')}`, '');
  let codeBytes = 0, dataBytes = 0; for (const a of loaded) { if (inInsn[a]) codeBytes++; else dataBytes++; }
  rep.push('## Coverage', '', '| Kind | Bytes |', '|---|---|', `| Loaded | ${loaded.length} |`, `| Code (reached by flow analysis) | ${codeBytes} |`, `| Not reached (data or dead code) | ${dataBytes} |`, '');
  rep.push('### Unreached byte runs', '', '| Start | End | Len |', '|---|---|---|');
  for (let i = 0; i < loaded.length;) {
    const a = loaded[i]; if (inInsn[a]) { i++; continue; }
    let e = a; while (e + 1 <= 0xFFFF && present[e + 1] && !inInsn[e + 1]) e++;
    rep.push(`| ${hex4(a)} | ${hex4(e)} | ${e - a + 1} |`);
    i += (e - a + 1);
  }
  rep.push('');
  rep.push('## External memory references (RAM / memory-mapped I/O)', '', '| Address | Name | Reads | Writes | LXI | From |', '|---|---|---|---|---|---|');
  for (const [a, refs] of [...memRefs.entries()].sort((x, y) => x[0] - y[0])) {
    if (present[a]) continue;
    const rd = refs.filter(r => r.kind === 'r' || r.kind === 'R').map(r => 'r' + hex4(r.from));
    const wr = refs.filter(r => r.kind === 'w' || r.kind === 'W').map(r => 'w' + hex4(r.from));
    const lx = refs.filter(r => r.kind === 'lxi').map(r => 'x' + hex4(r.from));
    rep.push(`| ${hex4(a)} | ${nameOf(a) || ''} | ${rd.length} | ${wr.length} | ${lx.length} | ${[...rd, ...wr, ...lx].join(' ')} |`);
  }
  rep.push('');
  rep.push('## I/O port references (IN/OUT)', '', '| Port | IN from | OUT from |', '|---|---|---|');
  for (const [p, refs] of [...ioRefs.entries()].sort((x, y) => x[0] - y[0])) {
    rep.push(`| ${hex2(p)} | ${refs.filter(r => r.kind === 'in').map(r => hex4(r.from)).join(' ')} | ${refs.filter(r => r.kind === 'out').map(r => hex4(r.from)).join(' ')} |`);
  }
  rep.push('');
  rep.push('## Subroutines (call targets)', '', '| Address | Name | Callers |', '|---|---|---|');
  for (const [t, refs] of [...xrefs.entries()].sort((x, y) => x[0] - y[0])) {
    const calls = refs.filter(r => r.kind === 'call');
    if (!calls.length) continue;
    rep.push(`| ${hex4(t)} | ${nameOf(t)} | ${calls.length}: ${calls.map(r => hex4(r.from)).join(' ')} |`);
  }
  rep.push('');
  rep.push('## Jump/call targets outside loaded images', '');
  for (const [t] of xrefs) if (!present[t]) rep.push(`- ${hex4(t)}`);
  fs.writeFileSync(out + '-refs.md', rep.join('\n') + '\n');
  console.log(`wrote ${out}.lst ${out}.asm ${out}-refs.md  code=${codeBytes} data=${dataBytes}`);
}
main();
