# Peripheral chip pinouts

Pin-level reference for the board's three main peripheral chips, for
anyone wiring a new keypad/display panel, breadboarding a chip standalone,
or interfacing something new to the parallel I/O. Companion to
[hardware-reuse.md](hardware-reuse.md).

**Read this before wiring anything:** this document is in two tiers of
confidence, marked explicitly per chip. Don't skip the caveats.

## Confidence summary

| Chip | IC pin numbers | Board connector pinout (J1/P4/P5/P7/J8) |
|---|---|---|
| 8279 (U36) | **Verified** - cross-checked against two independent pin-diagram sources | Not known - see below |
| 8155 x2 (U22/U35) | Pin *functions* confirmed from a real datasheet description; exact pin **numbers** not independently verified in this session | Not known |
| 8251A (U32) | Pin *functions* well-established for this chip family; exact pin **numbers** not independently verified in this session | Not known |

**The board's actual external connectors (J1 `READOUT`, P4 `PWR/DIM`, P5
`IO/TLS`, P7 `TRF`, J8 `OPTION`) have never been traced pin-by-pin against
these chips.** This is explicitly open in
[hardware.md](hardware.md#physical-verification-checklist) (item 9) - "even
without the display panel itself, tracing which 8279 pins... reach which
J1 pins would help confirm" the display theory. Nothing below tells you
which *connector pin* carries a given chip signal; it tells you which
*chip pin* carries it, which is where you'd start tracing from with a
meter, or what you'd wire to if building a new panel/connector from
scratch rather than reverse-engineering the original's.

## Intel 8279 (U36) - keyboard/display controller

Verified 40-pin DIP pinout (cross-checked against two independent
sources):

| Pin | Signal | Pin | Signal |
|---|---|---|---|
| 1 | RL2 | 21 | A0 |
| 2 | RL3 | 22 | CS (active low) |
| 3 | CLK | 23 | BD (blank display, active low) |
| 4 | IRQ | 24 | OUT A3 |
| 5 | RL4 | 25 | OUT A2 |
| 6 | RL5 | 26 | OUT A1 |
| 7 | RL6 | 27 | OUT A0 |
| 8 | RL7 | 28 | OUT B3 |
| 9 | RESET | 29 | OUT B2 |
| 10 | RD (active low) | 30 | OUT B1 |
| 11 | WR (active low) | 31 | OUT B0 |
| 12 | DB0 | 32 | SL0 |
| 13 | DB1 | 33 | SL1 |
| 14 | DB2 | 34 | SL2 |
| 15 | DB3 | 35 | SL3 |
| 16 | DB4 | 36 | SHIFT |
| 17 | DB5 | 37 | CNTL/STB |
| 18 | DB6 | 38 | RL0 |
| 19 | DB7 | 39 | RL1 |
| 20 | Vss (ground) | 40 | Vcc |

### What this firmware does with each group

| Pin group | Role in this firmware | Doc |
|---|---|---|
| `DB0-DB7`, `RD`, `WR`, `CS`, `A0` | CPU interface - memory-mapped at D000 (`A0`=0, data)/D001 (`A0`=1, command/status) | hardware.md |
| `RL0-RL7` (return lines) | The sensor-matrix input rows: `RL0-RL5` for the 6 thumbwheel positions, `RL6`/`RL7` bits 7/6 for the two push-buttons | front-panel.md |
| `SL0-SL3` (scan lines) | Drive the sensor-matrix scan (which row is being sampled) - only 3 bits (`SL0-SL2`) are needed for the 6 thumbwheel rows + 2 button rows, matching the confirmed mode byte `04H` (8x8, encoded scan) | hardware.md |
| `OUT A0-A3`, `OUT B0-B3` | The two display-digit nibbles - `OUT A` drives TD-A's row, `OUT B` drives TD-B's row (see front-panel.md's display byte table) | front-panel.md |
| `IRQ` | Sensor-matrix-change interrupt, wired to RST 5.5 (hardware.md's system diagram) | hardware.md |
| `CLK` | Chip's own timing clock - prescaler set to 6 in this firmware, implying roughly 600 kHz into this pin (hardware.md open question 3, unconfirmed source) | hardware.md |
| `SHIFT`, `CNTL/STB` | Not used in sensor-matrix mode the way a real keyboard would use them - no evidence this firmware reads them | - |
| `BD` | Blank-display output - no evidence this firmware's external circuitry uses it, but it's a real chip output regardless of firmware use | - |

If you're building a *new* front panel from scratch (the original is
missing - see hardware.md), wiring directly to these 40 pins (via a
breakout on U36's socket, or a header added to the board) sidesteps the
unknown `J1` connector pinout entirely.

## Intel 8155 (U22/U35) - RAM/IO/timer, one per chip

Pin **functions** (both chips are identical parts, wired to different
address ranges - see hardware.md):

| Signal | Function |
|---|---|
| `AD0-AD7` | Multiplexed address/data bus (shares the 8085's low byte, demultiplexed via `ALE`) |
| `ALE` | Address latch enable - captures `AD0-AD7` as an address at the start of each bus cycle |
| `RESET` | Chip reset |
| `CE` | Chip enable (active low) - this is what the 8205/PAL decoder (see pal-decoder.md) actually drives |
| `IO/M` | Memory space (0) vs. I/O/register space (1) select - this is the pin hardware.md's decode table has wired directly to `A15`, bypassing the address decoder entirely |
| `RD`, `WR` | Read/write strobes |
| `PA0-PA7` | Port A, 8 bits |
| `PB0-PB7` | Port B, 8 bits |
| `PC0-PC5` | Port C, 6 bits (mode-dependent: plain I/O, or handshake control lines for A/B depending on the command byte - see emulator.md's note on why this firmware's usage collapses to plain I/O) |
| `TIMER IN` | Timer clock input |
| `TIMER OUT` | Timer output (hardware.md's guessed RST 7.5 source, for the 8155 at E000) |
| `Vcc`, `Vss` | Power |

**Pin numbers not independently verified in this session** - the 8155 is a
40-pin DIP; cross-check against the actual Intel 8155/8156 datasheet
before wiring. What *is* confirmed (from hardware.md's software-derived
analysis) is which ports do what in this firmware:

| Chip (assumed per hardware.md, not physically confirmed - see checklist item 3) | Port | Use in this firmware |
|---|---|---|
| 8155 #1 (E000/6F00) | PA, PB | `REC_TO_FRONTEND` output - a station's TD value in binary, see hardware.md's corrected section |
| 8155 #1 (E000/6F00) | PC bit 0 | "busy" indicator |
| 8155 #1 (E000/6F00) | Timer | Guessed RST 7.5 source, continuous square wave, count 2000 |
| 8155 #2 (F000/7000) | PB bits 2/4/5 | Receiver front-end strobes out (latch-reset/shift-clock/sample-ack) - see hardware-reuse.md for why these are freely repurposable |
| 8155 #2 (F000/7000) | PC bits 2/3/4 | Receiver front-end data in (epoch flag, two serial streams) - also freely repurposable |
| 8155 #2 (F000/7000) | Timer | Baud-rate generator for the 8251A |

## Intel 8251A (U32) - USART

Pin **functions** (28-pin DIP; pin numbers not independently verified in
this session - cross-check the datasheet):

| Signal | Function |
|---|---|
| `D0-D7` | Data bus |
| `RESET`, `CLK` | Reset, internal clock |
| `WR`, `RD`, `C/D`, `CS` | CPU interface - `C/D` selects data vs. control/status, matching this board's `A0`-style split at C000/C001 |
| `TxD`, `RxD` | Serial transmit/receive data |
| `TxC`, `RxC` | Transmit/receive clock inputs - both driven from 8155 #2's timer in this design (hardware.md) |
| `TxRDY`, `RxRDY`, `TxEMPTY` | Status outputs, polled by this firmware rather than wired to an interrupt (hardware.md: "interrupts are not used for the USART") |
| `CTS`, `RTS`, `DSR`, `DTR` | Modem-control-style handshake lines - hardware.md notes `RTS`/`DTR` are asserted permanently by this firmware's command byte (`37H`) |
| `SYNDET`/`BRKDET` | Sync-detect (not used - this firmware programs asynchronous mode) |
| `Vcc`, `GND` | Power |

Physically, `TxD`/`RxD` (and presumably `RTS`/`CTS` or similar) feed the
`AM26LS32DC` differential line receiver noted in hardware.md's board
photos, which is what actually reaches the multi-drop RS-422/485 bus - the
8251A itself only ever sees single-ended TTL-level signals.

## What to do if you need real numbers

1. **Read the actual chip.** All three parts have their part number
   printed on the package; look it up directly rather than trusting any
   pin-numbered table (including this one for the 8155/8251A) without
   cross-checking.
2. **If reverse-engineering the existing board**, the
   [physical-verification checklist](hardware.md#physical-verification-checklist)'s
   item 9 (trace `J1` against the 8279) is the natural next step, and the
   same technique (meter + this document's function tables) extends to
   `P4`/`P5`/`P7`/`J8` for the 8155/8251A-side connectors.
3. **If building new**, you don't need the original connector pinout at
   all - wire your new panel/interface directly to the chip pins per the
   function tables above (using the 8279's *verified* numbers, and
   datasheet-confirmed numbers for the other two), and define your own
   connector pinout as part of the new design.
