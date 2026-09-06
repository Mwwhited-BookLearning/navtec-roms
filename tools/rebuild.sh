#!/bin/sh
# Rebuild the ROM images from disasm/*.asm with Macroassembler AS and compare to originals/.
# usage: sh tools/rebuild.sh
set -e
cd "$(dirname "$0")/.."
ASL=tools/asl/bin/asl.exe
P2BIN=tools/asl/bin/p2bin.exe
mkdir -p build
"$ASL" -cpu 8085 -L -olist build/nt3321-22.lst -o build/nt3321-22.p disasm/nt3321-22.asm
"$P2BIN" build/nt3321-22.p build/nt3321-22.bin -r '$0000-$1FFF' -l 0xFF
node -e '
const fs=require("fs");
const b=fs.readFileSync("build/nt3321-22.bin");
const r1=fs.readFileSync("originals/CN19229N NT3321 7943.BIN"), r2=fs.readFileSync("originals/CN19230N NT3322 7943.BIN");
const orig=Buffer.concat([r1,r2]);
let diff=0, first=-1;
for(let i=0;i<orig.length;i++) if(b[i]!==orig[i]){ diff++; if(first<0) first=i; }
console.log(`rebuilt ${b.length} bytes; differences vs originals: ${diff}` + (first>=0?` (first at ${first.toString(16)})`:""));
process.exit(diff?1:0);'
