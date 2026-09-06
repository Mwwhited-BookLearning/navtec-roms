# Reading these ROMs: Intel 8332 masked ROMs, not generic 2732 EPROMs

The two devices in this project (silkscreened `CN19229N NT3321 7943` and
`CN19230N NT3322 7943` on the board, sockets U37/U38) are electrically **Intel
8332** 4Kx8 masked ROMs - Intel's own mask-ROM equivalent of the 2732 EPROM,
following the same naming convention as the 8316 (Intel's 2Kx8 mask ROM
equivalent of the 2716). They are not generic second-source 2732-class parts,
and reading them as a plain 2732 only recovers half the chip.

This board is otherwise built entirely from Intel 8085-family parts (8085A
CPU, two 8155s, an 8251A, an 8279/8275), so an Intel-branded masked ROM here is
the expected choice, not a surprise.

## How to read a full, correct dump with a TL866-II Plus

The TL866/MiniPro software has no "8332" entry. Read it as a **2732**, but
re-wire three pins between the programmer's ZIF socket and the chip first:

| Programmer pin | Connect to chip pin |
|---|---|
| 21 | 18 |
| 18 | 20 **and** 21 (both) |
| 20 | not connected |

Every other pin (address lines, data lines, Vcc, GND) connects straight
through, unchanged. Only these three control-ish pins need rerouting.

### Procedure

1. Put the chip in a breadboard/adapter where you can override individual
   pins rather than plugging it straight into the programmer's ZIF socket.
2. Wire pins 18, 20 and 21 per the table above.
3. In the TL866 software, select chip type **2732**.
4. Read normally. The result should be a complete, correct 4096-byte image -
   no further pin gymnastics or multiple reads needed.

### Verification

After reading, confirm:
- The low 2 KB (`0000-07FF` for NT3321, `1000-17FF` worth of file offset for
  NT3322) is byte-identical to whatever was already known-good for that chip.
- The upper half is **not** all `FFh`, and disassembles as coherent, properly
  cross-referencing 8085 code (see `../tools/dis8085.js` and
  `../docs/rom-status.md` in the parent project for the actual disassembly and
  cross-reference verification used to confirm this for NT3321).

## How this was figured out

A stock "2732" ZIF read gets the low half right (it matched previously-known
good data exactly) but the upper half comes back solid `FFh`. A stock "2716"
read gets nothing at all - solid `FFh` across the whole chip. Since address
lines, data lines and power pins were clearly fine (the low half read
correctly), the fault had to be in the chip's enable/output-enable/
programming-voltage pins specifically - pins 18, 20 and 21 in the standard
2716/2732 pinout, which is exactly where Intel's 8316/8332 mask-ROM family is
documented to differ from the generic EPROM pinout.

The exact correct wiring was found empirically: breadboard pins 18/20/21 to
independent switches, read the rest of the chip as a plain 2716 (2 KB), and
cycle all 8 on/off combinations of those three pins. One combination (`p21=0,
p18=1, p20=0` in that test) reproduced the known-good low half exactly when
selected for the low address range, and produced fully coherent, correctly
cross-referencing 8085 code - confirmed by re-running the project's
disassembler and watching a 2048-byte "unreached/blank" gap close completely,
with 33 previously-external routine references resolving to real code. The
wiring table above is that same finding, re-expressed as a one-pass rewire on
top of the 2732 profile so the whole 4 KB reads correctly in a single
operation instead of needing two separate 2 KB reads.

## Status

- **NT3321**: fully recovered using this method. The corrected 4096-byte image
  is `CN19229N NT3321 7943.BIN` in this folder (SHA-256
  `8ac15a519a859381ef7720573f592ffe0690b838936f8b9117b6adb574eade7f`).
- **NT3322**: still needs a fresh read using the wiring above. It is almost
  certainly the same physical part, so the same rewire should work directly,
  but this has not yet been confirmed on that specific chip.
