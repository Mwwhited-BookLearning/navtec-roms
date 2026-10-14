# Boot sequence and expected bus activity

What the firmware does to the I/O devices after reset, in order, as run by
the emulator (`node src/emu/boot-trace.js [n]` regenerates it). Intended for
Phase 2/3 of [board-trace-plan.md](board-trace-plan.md): with a logic
analyzer or scope on the 8205 outputs (U45) and the device pins, this is
what a healthy board should show. "Step" is the emulator instruction count
from reset; PC is the address of the instruction doing the access. The
front-panel switches are set to GRI 9940 (sensor rows 1,2,9,9,4,0).

## Initialisation (steps 4-47, ~20 accesses)

| Step | PC | Access | Device | Value | Meaning |
|---|---|---|---|---|---|
| 4 | 0077 | WR C001 | 8251A control | `DA` | Mode: 16x, 7 bits, parity on, odd, 2 stop |
| 10-14 | 0023-0027 | RD/WR F002 | 8155#2 port B | `FF`->`FB` | Pulse a PB bit low (bit 2): receiver latch/reset strobe |
| 17 | 0082 | WR D001 | 8279 command | `CD` | Clear all (display to zeros) |
| 19-21 | 0087-008C | WR E004/E005 | 8155#1 timer | `D0`,`47` | Count 0x07D0 = 2000, mode 01 (continuous square wave) |
| 23 | 0091 | WR E000 | 8155#1 command | `CF` | Start timer, port directions |
| 25-27 | 0096-009B | WR F004/F005 | 8155#2 timer | `82`,`40` | Count 0x0082 = 130, mode 01: baud-rate generator |
| 29 | 00A0 | WR F000 | 8155#2 command | `C3` | Start timer, port directions |
| 31 | 00A5 | WR F002 | 8155#2 port B | `8E` | Initial output pattern |
| 33 | 00AA | WR C001 | 8251A control | `37` | Command: TxEN, DTR, RxE, ER, RTS |
| 37-41 | 00B2-00BC | WR D001 | 8279 command | `04`,`26`,`90` | Mode: encoded sensor matrix, 8 char; prescaler 6; write display RAM at 0 |
| 47+ | 1E5A | WR D001 | 8279 command | `E0` | End interrupt; repeats about every 39,500 steps (the 8279 service tick) |

## What to compare on the board

| Observation | Expected | Source |
|---|---|---|
| First chip-select asserted after reset | ROM select continuously (instruction fetch), then the **8251A select** at step 4 | table above |
| First 8155 touched | The one at F000 (PIO2), port B (F002), reading then writing | steps 10-14 |
| 8155#1 TIMER OUT (E000 chip) | Square wave, count 2000 (period 2000 CLK cycles). 1.25 kHz if the 8155 clock is 2.5 MHz, 2.5 kHz if 5 MHz | E004/E005 |
| 8155#2 TIMER OUT (F000 chip) | Square wave, count 130 (baud generator). 8251A 16x clock = this; baud = f/16 | F004/F005 |
| 8279 | Command writes `CD`, `04`, `26`, `90` in that order, then periodic `E0` | steps 17-47 |
| 8251A | Writes `DA` then later `37`; TxD idles high (mark) | steps 4, 33 |

Timer arithmetic: the 8155 timer divides its clock by the count. The firmware
baud table assumes an 8155 clock of 2.5 MHz (count 130 -> ~1202 baud,
count 8 -> 19.5 kbaud). See the clock note below.

## Open point to settle with a probe: 5 MHz or 2.5 MHz

`hardware.md` currently says both (a) the only oscillator is a 10.000 MHz
TCXO, so the 8085's CLK OUT is 5.000 MHz, and (b) the baud-rate table fits
an 8155 clock of 2.5 MHz. Those are consistent only if the 8155 timers
(and probably the 8251A/8279 clocks) are fed from a divide-by-two, or from a
different net than CLK OUT. Measuring **CLK OUT (U40 pin 37)** and the **8155
CLK pin (pin 3)** on the real board settles it: if both read 5 MHz, the baud
table in `hardware.md` and the serial-protocol baud values are off by 2 and
need correcting; if the 8155 sees 2.5 MHz, a divider is on the board.

The 8085 datasheet ([datasheets/8085.md](datasheets/8085.md)) confirms that
CLK OUT is exactly X1/2, so a 10.000 MHz TCXO on X1 gives 5.000 MHz CLK and
the 2.5 MHz the baud table implies must come from a divider (or the TCXO does
not feed X1 directly).

## Bring-up image

`node tools/make-blink-rom.js build/blink.bin` writes a 45-byte program in a
4 KB image that sets both 8155s' ports A and B to output and toggles all
bits every ~0.6 s (at 2.5 MHz CLK). It proves CPU + ROM + decode + 8155
selects on a powered board without the Loran firmware or the front panel.
Which 8155 is which does not matter - both blocks are driven. The original
parts are masked 8332 ROMs, so using it needs an EPROM in a socket adapter
at 0000 (check the 8332 vs your EPROM pinout first); this is a suggestion,
not something the repo has verified on hardware.
