# Board trace results (fill in)

Companion sheet for [board-trace-plan.md](board-trace-plan.md). One row per
trace; write what you measured, including "not connected" and "couldn't
tell". Photos: name them by chip designator. Anything not in the plan is
welcome in the Notes column.

Result codes: **Y** connected as predicted, **N** not connected / different,
**?** couldn't tell.

## Phase 0 - power

| # | Item | Result | Value / notes |
|---|---|---|---|
| 0.2 | +5 V and GND nets found at IC supply pins | | |
| 0.3 | Power input connector and pins | | |
| 0.4 | Regulator / bulk caps / DC-DC seen (part numbers) | | |
| 0.5 | Parts needing another rail (voltage, part) | | |
| 0.6 | Reverse-polarity / overvoltage protection | | |
| 0.7 | VCC-GND resistance (power off) | | ohms |

## Phase 1 - continuity

| # | Trace | Result | Notes (which 8205 output, which pin) |
|---|---|---|---|
| 1.1 | U22 CE <-> 8205 output; U35 CE <-> 8205 output | | |
| 1.2 | 8205 O0..O7 destinations | | |
| 1.3 | 8205 A0-A2 <- A12-A14; E1-E3 sources | | |
| 1.4 | TCXO -> U40 X1/X2 direct or divided | | |
| 1.5 | RST 5.5 / 6.5 / 7.5 sources (U40 pins 9/8/7) | | |
| 1.6 | 8279 CLK, 8251A CLK/TxC/RxC sources | | |
| 1.7 | OPTION socket CE <- 8205 O? | | |
| 1.8 | U39 (8212) inputs / outputs | | |
| 1.9 | PIO2 PC2..PC5, PB2/4/5 destinations | | |
| 1.10 | 8279 outputs -> J1 pins | | |
| 1.11 | 8251A TxD/RxD -> AM26LS32 / P5 | | |

## Phase 2/3 - live

| # | Probe | Expected | Measured |
|---|---|---|---|
| 2.1 | Idle current at 5.00 V | hundreds of mA | |
| 2.3 | U40 ALE (pin 30) toggling | yes | |
| 3.1 | U40 CLK OUT (pin 37) | 5.0 or 2.5 MHz (see [boot-sequence.md](boot-sequence.md)) | |
| 3.1b | 8155 CLK (pin 3), each chip | 2.5 MHz if the baud table is right | |
| 3.2 | 8155 E000 chip TIMER OUT | square wave, count 2000 | |
| 3.2b | 8155 F000 chip TIMER OUT | square wave, count 130 | |
| 3.3 | 8279 CLK | ~600 kHz | |
| 3.4 | 8251A TxD activity | 7O2 framing | |
| 3.5 | Boot order of chip selects | [boot-sequence.md](boot-sequence.md) | |
