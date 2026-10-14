# Board trace plan

What needs to be established on the physical board, in the order to do it,
and what each result changes in this repo. This expands
[hardware.md's physical-verification checklist](hardware.md#physical-verification-checklist)
into an executable plan for the situation where you have **the bare board
only** - no display/keypad panel (J1), no RF front end or antenna, and the
power arrangement is not yet worked out.

Rule for everything below: **write down what you measure, including "no
connection" and "couldn't tell"**, in the results tables. A confirmed negative
is as useful as a positive. Mark photos with the chip designator.

## Phase 0 - Inspection and powering the board (no power applied)

Goal: know what the board needs before anything is plugged in. Nothing here
is documented in this repo; the firmware says nothing about supply rails.

| # | Task | Why / what to record |
|---|---|---|
| 0.1 | Photograph both sides, every connector (J1 READOUT, P4 PWR/DIM, P5 IO/TLS, P7 TRF, J8 OPTION) | Baseline; lets us match silkscreen to net names |
| 0.2 | Read the supply pin of each IC: U40 (8085) pin 40 and pin 20, U22/U35 (8155) pin 40/20, U32, U36, U45 | Confirms +5 V and GND nets exist and gives the GND/VCC probe points |
| 0.3 | Beep the **VCC net** to the connectors: which P4/P5/P7/J1 pin(s) are +5 V, which are GND | This is the power input. P4 is labelled PWR/DIM and is the first suspect |
| 0.4 | Look for regulators, big electrolytics, diodes, a DC-DC module, or inductors near P4 | Shows whether the board takes raw DC (and what range) or regulated 5 V |
| 0.5 | Look for any part that needs another rail: AM26LS32 (+5 V only), op-amps, the SAMPLER/receiver section, TCXO, RS-232/422 drivers | A -5/-12/+12/+15 V part means a second supply; note the part number |
| 0.6 | Check for **polarity/overvoltage protection**: series diode, TVS, fuse | Whether it's safe to feed 5 V straight to the VCC net |
| 0.7 | Resistance VCC-GND with power off (a short or <20 ohm means stop) | Safety check before first power |

**Decision at the end of Phase 0:** if the VCC net is only +5 V and nothing
exotic is on it, a bench supply set to 5.00 V with a **current limit of
about 0.5 A** applied to the VCC net (via P4 or direct on the pin-40 rail)
is the lowest-risk first power-up. Everything on the board is 1979-era
NMOS/TTL; expect several hundred mA, not tens. If a second rail is
required, do not power the board until we know its voltage and which pins it
feeds - stop and report.

## Phase 1 - Power-off continuity tracing (needs only a meter)

Highest value first. "U40" etc. are the designators already read from the
silkscreen ([hardware.md designator table](hardware.md)).

| # | Trace | Pins | Answers | Repo impact if confirmed |
|---|---|---|---|---|
| 1.1 | Which 8155 sits at E000 / F000: trace the chip-select (CE) pin of U22 and U35 back to the 8205 (U45) output pins. 8205 is pin-compatible with the 74LS138: A0..A2 = pins 1..3, E1 = 4, E2 = 5, E3 = 6, GND = 8, VCC = 16, outputs O0..O7 = pins 15,14,13,12,11,10,9,7 (the 8205's own datasheet scan was not found; this is from the 74LS138 equivalence) | U22/U35 pin 8 (CE; active-low on an 8155, active-high on an 8156 - check the part marking) and IO/M pin 7, vs U45 O6 = pin 9 (E000) and O7 = pin 7 (F000) per the decoder table | Which physical chip is PIO1 vs PIO2 | Resolves the swap risk across hardware.md, peripheral-pinouts.md, pal docs |
| 1.2 | Full 8205 output map: trace all 8 outputs (ROM1, ROM2, OPTION socket, unused, 8251A, 8279, 8155 x2) | U45 | Whether the decoder table in hardware.md is right in every row | Upgrade "inferred" to "confirmed" |
| 1.3 | 8205 inputs: A0..A2 to A12..A14, E-pins to A15 / IO/M | U45 pins 1-6 vs U40 pins 21-28 (A8..A15) and 34 (IO/M) | Whether A15 gates the selects (hardware.md says software can't tell) | Settles the mirror behaviour in `src/emu` and the PAL model |
| 1.4 | Clock path: TCXO output to U40 X1/X2 (pins 1/2), or via a divider; also U40 CLK OUT (pin 37) to the 8155s/8251A/8279 | TCXO, U40 | CPU clock = 5.000 MHz? what feeds the receiver sample clock | Closes hardware.md open question 1 |
| 1.5 | RST 7.5 source: does either 8155 TIMER OUT (pin 6) reach U40 pin 7? (also pins 8 = RST 6.5, 9 = RST 5.5 - trace what drives each; the 8279 IRQ is pin 4) | U22/U35 pin 6, U40 pins 7-9, U36 pin 4 | The interrupt source map | Fixes emulator RST 7.5 modelling (checklist item 2) |
| 1.6 | 8279 CLK feed (U36 pin 3); also 8251A CLK (U32 pin 20) and TxC/RxC (pins 9/25) - are they the 8155 TIMER OUT? | U36 | 8279 prescale is 6, so ~600 kHz expected here | Closes open question 3 |
| 1.7 | OPTION sockets: which one (if either) is wired to the 2000-2FFF select (8205 O2) | U45 O2, OPTION sockets' CE pins | Where the expansion ROM lives | Closes checklist item 7 |
| 1.8 | U39 (8212): what its inputs and outputs connect to; confirm U39 vs the OPTION-socket designator conflict | U39 | What it latches (status lamps? option ROM buffer?) | Closes items 6 and 8 |
| 1.9 | Receiver tap points: trace 8155 port C input bits PC2..PC5 on the one that is PIO2 to the SAMPLER/SYNCRONIZER logic, and PB bits 2/4/5 outputs | On the PIO2 8155: PC2 = pin 39, PC3 = pin 1, PC4 = pin 2, PC5 = pin 5; PB2 = pin 31, PB4 = pin 33, PB5 = pin 34 (all datasheet-verified, see [peripheral-pinouts.md](peripheral-pinouts.md)) | Which signal is the epoch flag (PC2), sample pulse (PC5), shift data (PC4/PC3) | Directly tests the front-end model's tap assignment |
| 1.10 | J1 READOUT: which 8279 outputs reach which J1 pins | U36, J1 | Display wiring | Checklist item 9 |
| 1.11 | Serial: path from U32 (8251A) TXD/RXD to the AM26LS32 and P5 | U32, AM26LS32, P5 | Whether the host link is RS-422 differential or RS-232 level | Corrects serial wiring docs |

## Phase 2 - First power-up (only after Phase 0 says it is safe)

1. Bench supply to 5.00 V, current limit 0.5 A, no panel, no RF in.
2. Note the idle current. Check no IC is hot (finger test after 30 s).
3. Scope or logic probe: **U40 RESET IN (pin 36)** pulses then goes high,
   **CLK OUT (pin 37)** is a square wave, **ALE (pin 30)** is toggling.
   A running 8085 with the ROM fitted should show ALE activity immediately.
4. Check +5 V at each IC's pin 40/16/28 etc. (some chips are not +5 V on
   the corner pin; look up each one).

## Phase 3 - Live observation

| # | Probe | Expected (from the emulator) | What a mismatch tells us |
|---|---|---|---|
| 3.1 | CLK OUT frequency, and the 8155 CLK pin separately | 5.000 MHz at CLK OUT if the TCXO feeds X1 directly (8085 divides by 2); the baud table implies 2.5 MHz at the 8155 - see [boot-sequence.md](boot-sequence.md) | Crystal question |
| 3.2 | 8155 TIMER OUT on both chips | One continuous square wave, count 07D0H = 2000; the other is the baud-rate timer (e.g. 8 / 130 / 520 / 1418 counts) | Which chip is which, and the RST 7.5 period |
| 3.3 | 8279 CLK | roughly 600 kHz (the firmware programs prescaler 6, which a 100 kHz internal rate would want); record the real value | Open question 3 |
| 3.4 | 8251A TXD with a serial terminal on the host link | 7 data bits, odd parity, 2 stop (7O2) at the baud chosen by the switches; the firmware prints a report a few seconds after INIT if the switch panel is valid | Whether `docs/serial-protocol.md` matches reality; **without the switch panel / front end the firmware may stall in `READ_SWITCHES` validation**, so a quiet UART at first is not a fault |
| 3.5 | Port B/C lines of the PIO2 chip with RF input disconnected | Idle levels, then the strobe/shift pattern (PB bit 2 pulse, bit 4 clocks, bit 5 ack) | Whether the firmware is trying to search; idle values of PC2..PC5 |

Because there is no front panel, the firmware reads its settings from the
8279 sensor matrix. If it stalls at `READ_SWITCHES`, tying the right
sensor-matrix lines to ground (see `docs/front-panel.md`) is the way to feed
it a valid switch setting (GRI selector digits 1,2,9,9,4,0 is what the
emulator uses). Do that only after the board is powered and the 8279 is
seen alive.

## What to send back

For each row: result (connected to X / not connected / couldn't tell),
a photo if non-obvious, and any part markings that differ from the tables.
I will fold the answers into `hardware.md`, `peripheral-pinouts.md` and
`docs/emulator.md`, upgrading "(inferred)" markers to "(confirmed)".

## Safety

Never apply power until Phase 0.7 is done and the supply is
current-limited. Do not probe with the 8085 running with long ground leads
on the 5 MHz clock net (use the nearest GND pin). If any chip gets hot or
the current is pinned at the limit, remove power and report.
