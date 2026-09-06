# Firmware structure

The firmware is a Loran-C receiver/navigator program. The identification rests
on three independent facts in the code:

- the byte shifted in from the receiver is compared with 0CAH and 09FH, and a
  table holds CA F9 / 9F AC. These are exactly the Loran-C phase codes
  (master GRI-A `++--+-+-`, master GRI-B `+--+++++`, secondary GRI-A
  `+++++--+`, secondary GRI-B `+-+-++--`);
- the four-digit thumbwheel value is validated to start with 4..9, the range of
  Loran-C Group Repetition Intervals (4000-9999);
- all time quantities are 4-byte packed BCD, matching the 0.1 us TD readouts of
  a Loran-C receiver, and one record per station (master + up to 4 secondaries)
  is kept.

## Boot sequence

```plantuml
@startuml
start
:DI, JMP INIT;
:8251 mode 0DAH;
:SP = 7100;
:8279 clear;
:8155 #1 timer 2000, cmd CFH;
:8155 #2 timer 130, cmd C3H, PB = 8EH;
:8251 command 37H;
:SIM 1DH (RST 6.5 only);
:8279 mode 04H, prescaler 26H, write-display 90H;
:X_1E4C (missing half: receiver init);
:clear RAM 6F00-70FB;
:VAR_6FD9 = 1BH, UNIT_ID = '0', PRTBUF_PTR = PRTBUF, VAR_6FCB = FFH;
:READ_SWITCHES (loops until GRI and selectors are valid);
:GRI_VAL = GRI_SW
SLOT_COUNT = 4 + ((bin(GRI low digits) + (GRI >= 6000)) - 40) / 10 + 1;
:validate SEL_A / SEL_B against SLOT_COUNT (X_1DBD);
:ACQ_START;
stop
@enduml
```

## Interrupt-driven coroutine

The idle routine `WAIT_SAMPLE` (0459) never returns by itself. It opens a
one-instruction interrupt window, runs the background tasks, and loops. When the
receiver strobes RST 6.5 inside that window the handler pops the interrupt return
address and returns to whoever called `WAIT_SAMPLE`.

```plantuml
@startuml
participant "main loop" as M
participant "WAIT_SAMPLE\n(0459)" as W
participant "RST65_ISR\n(0034)" as I
participant "background\ntasks" as B

M -> W : CALL (pushes RET-to-main)
loop until interrupt
  W -> W : EI / NOP / DI
  W -> B : SERIAL_POLL, TX_SERVICE
  W -> B : if RIM bit 6: TICK tasks
  W -> W : clear PIO1_PC bit 0 (idle)
end
I <- : RST 6.5 during the EI window\n(pushes RET-to-WAIT_SAMPLE)
I -> I : PIO1_PC bit 0 = busy
I -> I : B = PIO2_PC << 2
I -> I : PULSE_PB bit 5 (ack)
I -> I : if SAMPLE_CNT+1 == WIN_END: PULSE_PB2, X_0E1D, SYNC_FLAG = 1
I -> I : POP B  (discard RET-to-WAIT_SAMPLE)
I --> M : RET  (A = B = status)
@enduml
```

Consequences:

- Interrupts are disabled everywhere except that window, so no other code has
  to be re-entrant.
- Every `CALL WAIT_SAMPLE` in the main loop means "wait for the next sample".
- `WAIT_EPOCH` (049B) repeats `WAIT_SAMPLE` until the returned status has bit 4
  set (port C bit 2), i.e. until the start of a GRI.
- Background work (serial port, switches, report output) gets CPU time only
  between samples.

## Main program phases

```plantuml
@startuml
[*] --> ACQ_START
ACQ_START : CUR_TOA = GRI + const, WIN_END = ...
ACQ_START : display cleared (X_0DB3 0EH)
ACQ_START --> SEARCH_LOOP
SEARCH_LOOP : wait epoch, FIRST_SAMPLE, MATCH_PULSES (exact)
SEARCH_LOOP --> SEARCH_LOOP : no match, alternate REC_MASTER / REC_SEC
SEARCH_LOOP --> SEARCH_VERIFY : match
SEARCH_VERIFY : SAMPLE_TO_BCD, copy GRI, X_0EC1(+110)
SEARCH_VERIFY : SHIFT_IN16 == 0CAH ?
SEARCH_VERIFY --> SEARCH_LOOP : no
SEARCH_VERIFY --> MASTER_FOUND : yes
MASTER_FOUND : SLOT_FLAGS[0] = C8H, CUR_MODE = 1, SETTLE_CNT = 20
MASTER_FOUND --> SETTLE_LOOP
SETTLE_LOOP : 20 x (wait epoch, X_0817, QUAL_UPDATE)
SETTLE_LOOP --> ACQ_START : flag bit 5 clear or QUAL_CHECK bad
SETTLE_LOOP --> TRACK_LOOP : good signal
TRACK_LOOP : wait epoch, X_0EEE, X_0ED9, display (X_0F31/X_0F08 by DISP_MODE), X_0817
TRACK_LOOP --> TRACK_NEXT_SLOT
TRACK_NEXT_SLOT : SLOT_IDX++ (wrap -> TRACK_LOOP)
TRACK_NEXT_SLOT --> TRACK_LOOP : wrapped
TRACK_NEXT_SLOT --> TRACK_NEXT_SLOT : slot flag bit 7 clear
TRACK_NEXT_SLOT --> SLOT_PROCESS : bit 7 set, bit 6 clear
TRACK_NEXT_SLOT --> TRACK_NEXT_SLOT : bit 6 set: X_08A9
SLOT_PROCESS : LOAD_CUR_REC
SLOT_PROCESS --> SLOT_TRACKING : TRACK_STATE bit 7
SLOT_PROCESS --> SLOT_ACQUIRE : TRACK_STATE bit 6
SLOT_PROCESS --> SLOT_WIN_CALC : else (state = 1, compute window)
SLOT_WIN_CALC --> SLOT_DONE : TRACK_STATE = 80H
SLOT_TRACKING : X_0E2D, FIRST_SAMPLE, MATCH_PULSES (tolerant)
SLOT_TRACKING --> SLOT_DONE : ok (state 06)
SLOT_TRACKING --> SLOT_TRK_MISS : miss: MISS_CNT++, TOA += 110
SLOT_TRK_MISS --> SLOT_DONE
SLOT_TRACKING --> SLOT_TRK_LOST : lost: state 40H, save TOA, CUR_MODE = 3
SLOT_TRK_LOST --> SLOT_DONE
SLOT_ACQUIRE : READ_PHASE, COUNT_BITS4 x2, CUR_NPULSE++
SLOT_ACQUIRE --> SLOT_DONE : < 4 or 8 pulses seen
SLOT_ACQUIRE --> SLOT_ACQ_FAIL : CHK_NPULSE bad
SLOT_ACQUIRE --> SLOT_ACQ_OK : CHK_NPULSE good: X_1E05, ACQ_COUNT++, flags |= C0H
SLOT_ACQ_OK --> SLOT_DONE
SLOT_ACQ_FAIL --> SLOT_TRK_MISS
SLOT_DONE : CUR_REC[0] = status, SAVE_CUR_REC (X_0875)
SLOT_DONE --> TRACK_NEXT_SLOT
@enduml
```

The exact semantics of the window arithmetic live partly in the missing halves
(`X_0E1D`, `X_0E2D`, `X_0EC1`, `X_0ED9`, `X_0EEE`), so the phase names above are
working names, not proven ones.

## Per-slot data

`SLOT_COUNT` (5..9 depending on GRI) time slots exist per GRI. Each slot has:

| Item | Where | Notes |
|---|---|---|
| flags | `SLOT_FLAGS[slot]` (6F04..6F0D) | bit 7 active, bit 6 acquiring, bits 1..0 = index of the secondary record, bit 3/5/4 used by the report and settle logic (C8H written for the master) |
| 9-byte record | `SLOTREC_CNT + 9*slot` (6FEE..) | counter at +0, fields at +3 (`SLOTREC_3`) and +5 (`SLOTREC_5`); stride was patched from 10 to 9 (`OLD_MUL10`) |
| 1 byte | `SLOT_TBL[slot]` (7054..) | tested by the code fragment at 1000 |

Station records are 25 bytes:

| Offset | Name in `CUR_REC` copy | Contents |
|---|---|---|
| +0..+3 | `CUR_REC` | 4-byte BCD, byte 0 doubles as status (bit 0 = "skip in ISR") |
| +4..+7 | `CUR_TOA` | 4-byte BCD time of arrival / TD (GRI-relative) |
| +8 | `CUR_NPULSE` | pulse counter(s) |
| +9..+13 | `CUR_PULSES` | up to 5 sample positions where the phase code matched |
| +14..+15 | `CUR_PULSE_PTR` | write pointer into the list |
| +22 | `CUR_MODE` | 1 = settling, 3 = re-acquiring |

Record instances: `REC_MASTER` (6F24), `REC_SEC[0..3]` (6F3D, 6F56, 6F6F, 6F88),
working copy `CUR_REC` (6FA1). `LOAD_CUR_REC` / `SAVE_CUR_REC` move records in and
out of the working copy; `GET_SLOT_REC` picks the instance from the slot flags.

## Arithmetic helpers

| Routine | Function |
|---|---|
| `BCD_ADD4` / `BCD_SUB4` | 4-byte packed BCD add / ten's-complement subtract, `(BC) op= (HL)` |
| `BCD_TO_BIN` / `BIN_TO_BCD` | single byte conversions (tails in the missing half) |
| `MUL8` | 8 x 8 -> 16 shift-add multiply |
| `MUL9_INDEX` | HL + 9*A (record indexing) |
| `COUNT_BITS4`, `PHASE_MISMATCH` | popcounts used for phase-code correlation |
| `NEG_HL` | 16-bit negate |
| `COPY4`, `COPY_E`, `FILL_ZERO` | block moves |

## Background tasks (run from WAIT_SAMPLE)

| Task | Trigger | Description |
|---|---|---|
| expansion ROM hook | every pass | if byte at 2000 = 0A5H, `CALL 2001` |
| `SERIAL_POLL` | every pass | 8251 receive state machine, monitor, plot output |
| `TX_SERVICE` | every pass | drain `PRTBUF` to the 8251 when `OUT_MODE` = 0 |
| `TICK_HOOK` | RST 7.5 latched | indirect call through `TICK_HOOK` if non-zero |
| `REPORT_TASK` | RST 7.5 latched | periodic serial data report |
| `X_18C0` | RST 7.5 latched | missing half (display refresh is the likely job) |
| `TICK_TASK` | RST 7.5 latched | BCD tick counter, switch-change handling |

See [serial-protocol.md](serial-protocol.md) and [front-panel.md](front-panel.md).

## Evidence of in-place patching

Three dead fragments show the ROM was patched by hand after assembly:

| Address | Old code | What replaced it |
|---|---|---|
| 0515-051A | multiply by 10 | `MUL9_INDEX` multiply by 9 (record stride 10 -> 9) |
| 0533-053E | copy `CUR_REC` -> record | `LOAD_CUR_REC` copies record -> `CUR_REC` |
| 058C-0593 | flag manipulation on `SLOT_FLAGS` | nothing (jumped around) |

Two more idioms worth knowing when reading the source: `21H` (LXI H) is used as a
two-byte skip prefix (`TX_DASH`, `PHASE_CODE_TBL`), and `EI / NOP / DI` is the
interrupt window described above.
