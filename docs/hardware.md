# Hardware reconstruction (from firmware analysis)

Everything below is inferred from the two ROM images. Nothing has been verified
against a board yet. Items marked **(inferred)** are strong deductions from the
code; items marked **(guess)** are plausible but need confirmation from the
hardware or from the missing ROM halves.

## System overview

```plantuml
@startuml
skinparam componentStyle rectangle
skinparam defaultTextAlignment center

component "Intel 8085\nCPU" as CPU
component "EPROM NT3321\nCN19229N\n0000-0FFF" as ROM1
component "EPROM NT3322\nCN19230N\n1000-1FFF" as ROM2
component "Expansion ROM\n(optional)\n2000-2FFF" as ROM3 #eeeeee
component "8251 USART\nC000/C001" as USART
component "8279 Keyboard/Display\nD000/D001" as KDC
component "8155 #1\nRAM 6F00-6FFF\nI/O E000-E005" as PIO1
component "8155 #2\nRAM 7000-70FF\nI/O F000-F005" as PIO2
component "Loran-C receiver\nfront end\n(shift register + strobes)" as RX
component "Thumbwheel switches\n6 x 10-position\n+ 2 push buttons" as SW
component "7-segment display\n7 x 2 digits" as DISP
component "RS-232 / TTY\nhost or printer" as HOST

CPU -- ROM1
CPU -- ROM2
CPU .. ROM3
CPU -- USART
CPU -- KDC
CPU -- PIO1
CPU -- PIO2
USART -- HOST
KDC -- SW
KDC -- DISP
PIO2 -- RX
KDC -up-> CPU : IRQ -> RST 5.5
RX -up-> CPU : sample strobe -> RST 6.5
PIO1 -up-> CPU : TIMER OUT -> RST 7.5 (guess)
PIO2 -up-> USART : TIMER OUT = TxC/RxC (baud)
@enduml
```

## Chip inventory

| Device | Evidence | Confidence |
|---|---|---|
| Intel 8085 CPU | `RIM`/`SIM` instructions, RST 5.5/6.5/7.5 handling, reset vector at 0000 | certain |
| 2 x 2732-class 4 KB EPROM (labels CN19229N / CN19230N, date code 7943) | image size, contiguous code across 07FF/0800 | see [rom-status.md](rom-status.md) |
| Intel 8251A USART at C000/C001 | mode byte 0DAH then command 37H, status bits 0/1 polled as TxRDY/RxRDY | certain |
| Intel 8279 keyboard/display controller at D000/D001 | command sequence CDH (clear), 04H (sensor matrix), 26H (prescaler), 90H (write display), 50H/56H (read sensor RAM), E0H (end interrupt) | certain |
| Intel 8155 #1, I/O at E000-E005 | 6-register footprint, command CFH, timer loaded via E004/E005 | certain |
| Intel 8155 #2, I/O at F000-F005 | 6-register footprint, command C3H, timer reloaded with baud-rate divisors | certain |
| 512 bytes RAM total, 6F00-70FF | INIT clears exactly 6F00-6FFF and 7000-70FB; SP = 7100; two 8155s supply 2 x 256 bytes | inferred |
| Optional expansion ROM at 2000 | `LDA 2000 / CPI A5H / CZ 2001` in the idle loop | certain (hook exists) |

No `IN`/`OUT` instructions appear anywhere. All peripherals are memory mapped.

## Memory map

```plantuml
@startuml
skinparam monochrome true
skinparam defaultFontName monospaced
title 8085 address space as used by the firmware

rectangle "0000-07FF  ROM1 NT3321 (dumped)" as r1
rectangle "0800-0FFF  ROM1 upper half (NOT in dump, code is referenced)" as r1b #ffdddd
rectangle "1000-17FF  ROM2 NT3322 (dumped)" as r2
rectangle "1800-1FFF  ROM2 upper half (NOT in dump, code is referenced)" as r2b #ffdddd
rectangle "2000-2FFF  optional expansion ROM (2000 = A5H signature, 2001 = entry)" as r3 #eeeeee
rectangle "3000-5FFF  unused / mirrors" as r4 #eeeeee
rectangle "6F00-6FFF  RAM (8155 #1)" as ram1
rectangle "7000-70FF  RAM (8155 #2), stack grows down from 7100" as ram2
rectangle "C000-C001  8251 USART   (C000 data, C001 control/status)" as u
rectangle "D000-D001  8279 KDC     (D000 data, D001 command/status)" as k
rectangle "E000-E005  8155 #1 I/O  (cmd/status, PA, PB, PC, timer lo, timer hi)" as p1
rectangle "F000-F005  8155 #2 I/O  (cmd/status, PA, PB, PC, timer lo, timer hi)" as p2

r1 -[hidden]down- r1b
r1b -[hidden]down- r2
r2 -[hidden]down- r2b
r2b -[hidden]down- r3
r3 -[hidden]down- r4
r4 -[hidden]down- ram1
ram1 -[hidden]down- ram2
ram2 -[hidden]down- u
u -[hidden]down- k
k -[hidden]down- p1
p1 -[hidden]down- p2
@enduml
```

### Address decoding **(inferred)**

The pattern fits a single 3-to-8 decoder on A14..A12 with A15 routed to the
8155 IO/M pins:

| A14..A12 | A15 = 0 (memory) | A15 = 1 (I/O side of 8155) |
|---|---|---|
| 000 | ROM1 0000-0FFF | mirror |
| 001 | ROM2 1000-1FFF | mirror |
| 010 | expansion ROM 2000-2FFF | mirror |
| 011 | unused | unused |
| 100 | (8251 mirror) | 8251 at C000 |
| 101 | (8279 mirror) | 8279 at D000 |
| 110 | 8155 #1 RAM (256 B, mirrored in 6000-6FFF) | 8155 #1 registers at E000 |
| 111 | 8155 #2 RAM (256 B, mirrored in 7000-7FFF) | 8155 #2 registers at F000 |

This explains why the firmware places its RAM at 6F00 and 7000: the last page of
the first 8155's range and the first page of the second's are contiguous, giving
one 512-byte block with the stack at the top. Whether A15 also gates the ROM and
peripheral selects cannot be told from software.

## Peripheral programming

### 8251A USART (C000 data, C001 control)

| Write | Value | Meaning |
|---|---|---|
| mode | 0DAH | asynchronous, x16 clock, 7 data bits, parity enabled, odd parity, 2 stop bits |
| command | 37H | TxEN, DTR, RxE, error reset, RTS |

Status bit 0 (TxRDY) and bit 1 (RxRDY) are polled; interrupts are not used for
the USART. Frame: **7 data, odd parity, 2 stop** (7O2).

The receive/transmit clock comes from 8155 #2's timer output **(inferred)**: the
set-up mode reloads that timer with four divisors, and four divisors only make
sense as a baud-rate table.

| 8155 #2 timer count | Baud at CLK 2.5 MHz | Baud at CLK 2.4576 MHz | Nominal |
|---|---|---|---|
| 1418 (058AH) | 110.2 | 108.3 | 110 |
| 520 (0208H) | 300.5 | 295.4 | 300 |
| 130 (0082H) default | 1201.9 | 1181.5 | 1200 |
| 8 (0008H) | 19531 | 19200 | 19200 |

Baud = CLK / (16 x count). A 5.000 MHz crystal (CLK 2.5 MHz) fits the three low
rates within 0.2 %; a 4.9152 MHz crystal fits 19200 exactly. Either is
plausible; 5 MHz is the better overall fit. Default after reset is 1200 baud.

### 8279 keyboard/display controller (D000 data, D001 command/status)

| Command | Value | Meaning |
|---|---|---|
| clear | 0CDH | clear display RAM (to all ones) and FIFO/sensor RAM |
| mode | 04H | 8 x 8-bit display, left entry; **encoded scan, sensor matrix** keyboard mode |
| prescaler | 26H | clock prescaler 6 (implies a ~600 kHz clock into the 8279, e.g. CLK/4) |
| write display | 90H | write display RAM, auto-increment, address 0 |
| read sensor | 50H / 56H | read sensor RAM from row 0 / row 6, auto-increment |
| end interrupt | 0E0H | clear the sensor-change IRQ |

Sensor matrix mode means the "keyboard" is a set of switches wired straight into
the 8 x 8 return-line matrix, not a scanned keypad. Rows 0..5 are 10-position
thumbwheels (see [front-panel.md](front-panel.md)); rows 6 and 7 carry two
momentary push buttons on bits 7 and 6. The 8279 IRQ output drives **RST 5.5**
(inferred from the End-Interrupt command being issued when RIM shows 5.5 pending).

Display RAM is written as 7 bytes. Each byte carries two 4-bit digit codes (the
8279 OUTA/OUTB nibbles), so the display is two rows of 6 digits plus one extra
byte, most likely through BCD-to-seven-segment decoders. Codes 0EH and 0FH are
passed to display routines in the missing half, which on a 7447-class decoder
give "blank"-like patterns.

### 8155 #1 (I/O at E000)

| Register | Value | Meaning |
|---|---|---|
| E000 command | 0CFH | PA out, PB out, PC out (ALT2), timer start |
| E004/E005 timer | 07D0H, mode 01 | count 2000, continuous square wave |
| E003 port C | bit 0 | set when the CPU starts work, cleared in the idle loop: **busy indicator / watchdog strobe** |

The timer runs at CLK/2000 (1250 Hz at 2.5 MHz). Its output is the most likely
source of the periodic **RST 7.5** tick **(guess)**. Ports A and B of this chip
are never touched by the dumped halves; they are probably driven by code in the
missing halves (status lamps are the obvious candidate).

### 8155 #2 (I/O at F000)

| Register | Value | Meaning |
|---|---|---|
| F000 command | 0C3H | PA out, PB out, PC input (ALT1), timer start |
| F004/F005 timer | 0082H, mode 01 | baud-rate generator, see above |
| F002 port B | idle 8EH | control lines to the receiver front end |
| F003 port C | input | status and serial data from the receiver front end |

Port B bit usage:

| Bit | Idle | Use |
|---|---|---|
| 2 | 1 | pulsed (`PULSE_PB2`) at INIT, around the window-end capture in the ISR, and in tracking. Likely a counter latch/reset strobe. |
| 4 | 0 | pulsed 8 times per `SHIFT_IN16`: shift clock for the receiver's serial data |
| 5 | 0 | pulsed after every RST 6.5 sample: sample acknowledge |
| 1, 3, 7 | 1 | static, meaning unknown |
| 0, 6 | 0 | static, meaning unknown |

Port C bit usage (as read in `SHIFT_IN16` and the ISR):

| Bit | Use |
|---|---|
| 2 | epoch flag: `WAIT_EPOCH` waits for a sample with this bit set (start of GRI) |
| 3 | serial data stream 2 (shifted into C) |
| 4 | serial data stream 1 (shifted into B): the 8-pulse phase-code word |
| 5, 4 | rotated into bits 7, 6 by the ISR and handed to the main loop |

Port A of 8155 #2 is not referenced by the dumped halves.

## Interrupts

| Input | Vector | Use |
|---|---|---|
| TRAP | 0024 | not used (vector falls inside `PULSE_PB`), must be tied low |
| RST 5.5 | 002C | masked; polled via RIM bit 4. Driven by the 8279 IRQ (switch change). |
| RST 6.5 | 0034 | **enabled**. Receiver sample strobe. Handler is a coroutine exit, see [firmware.md](firmware.md). |
| RST 7.5 | 003C | masked; edge-latched and polled via RIM bit 6, cleared with `SIM 10H`. Periodic tick. |
| INTR | - | not used |

`SIM 1DH` at INIT: MSE = 1, M7.5 = 1, M6.5 = 0, M5.5 = 1, R7.5 = 1.

## Receiver front end (what the software expects)

The dumped code never sees raw RF. It sees:

- one strobe per sample (RST 6.5), with two status bits on port C;
- a serial shift register clocked by port B bit 4 delivering two 8-bit words per
  sample: the sign pattern of the 8 pulses in a group (compared against the
  Loran-C phase codes 0CAH/09FH for master, 0F9H/0ACH for secondaries) and a
  second word whose meaning is not yet clear;
- an acknowledge pulse (port B bit 5) after each sample and a latch/reset pulse
  (port B bit 2) at window boundaries.

So the analog board does hard-limiting, cycle/envelope detection and pulse-group
timing; the 8085 does phase-code correlation, station search, tracking and TD
arithmetic in packed BCD.

## Open questions for the hardware owner

1. Crystal frequency (5.000 MHz vs 4.9152 MHz vs 6.144 MHz).
2. What drives RST 7.5 (8155 #1 timer out is the guess).
3. What the 8279 CLK is fed from (prescaler 6 implies about 600 kHz).
4. Whether the display uses BCD-to-7-segment decoders on OUTA/OUTB.
5. The EPROM type (see [rom-status.md](rom-status.md)).
