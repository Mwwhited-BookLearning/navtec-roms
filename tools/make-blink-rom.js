'use strict';
// Minimal bring-up image: no peripherals used except the two 8155s' ports A and B.
// Writes a 4 KB image (0000-0FFF) that sets both 8155s (E000 and F000 blocks) to
// PA/PB = output, then toggles all PA and PB bits about every 0.6 s (at 2.5 MHz CLK).
// Use it in a programmed EPROM at 0000 to prove CPU + ROM + decode + 8155 select without
// the Loran firmware or front panel.  Usage: node tools/make-blink-rom.js [out.bin]
const fs = require('fs');
const code = [
  0x31, 0x00, 0x71,       // 0000 LXI SP,7100
  0x3E, 0x03,             // 0003 MVI A,03   (PA out, PB out)
  0x32, 0x00, 0xE0,       // 0005 STA E000
  0x32, 0x00, 0xF0,       // 0008 STA F000
  0x16, 0xFF,             // 000B MVI D,FF
  0x7A,                   // 000D loop: MOV A,D
  0x32, 0x01, 0xE0,       // 000E STA E001  (PA#1)
  0x32, 0x02, 0xE0,       // 0011 STA E002  (PB#1)
  0x32, 0x01, 0xF0,       // 0014 STA F001  (PA#2)
  0x32, 0x02, 0xF0,       // 0017 STA F002  (PB#2)
  0xCD, 0x23, 0x00,       // 001A CALL delay
  0x7A, 0x2F, 0x57,       // 001D MOV A,D / CMA / MOV D,A
  0xC3, 0x0D, 0x00,       // 0020 JMP loop
  0x21, 0x00, 0x00,       // 0023 delay: LXI H,0
  0x2B,                   // 0026 DCX H
  0x7C, 0xB5,             // 0027 MOV A,H / ORA L
  0xC2, 0x26, 0x00,       // 0029 JNZ 0026
  0xC9,                   // 002C RET
];
const img = Buffer.alloc(0x1000, 0xFF);
Buffer.from(code).copy(img, 0);
fs.writeFileSync(process.argv[2] || 'build/blink.bin', img);
console.log(`wrote ${process.argv[2] || 'build/blink.bin'} (${code.length} bytes of code)`);
