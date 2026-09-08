# Routine catalog (partial - see note)

**This catalog predates the full ROM recovery** and only covers the routines
that were known when it was written (mostly the low-ROM/dumped-half
routines from before both EPROM halves were read - see
[rom-status.md](rom-status.md)). It was never extended after that. For a
complete, current catalog of every `CALL`ed routine in the ROM (137 of them,
all named) plus every referenced variable (175, all named), see
[jump-graph.md](jump-graph.md) instead - that table is regenerated from the
disassembler's own output and won't drift out of sync the way this
hand-written one has. This file is kept for the routines it documents in
more descriptive prose than the jump-graph table does, not as the
authoritative list.

Addresses are absolute. Register conventions follow the code: BC is usually
a destination pointer, HL a source pointer, A the value.

## Low ROM: vectors and I/O primitives

| Addr | Name | In / Out | Notes |
|---|---|---|---|
| 0000 | `RESET` | | DI, JMP INIT |
| 001C | `PULSE_PB2` | | pulse 8155#2 PB bit 2 |
| 001E | `PULSE_PB` | A = mask | pulse bits of A on 8155#2 PB (toggle twice) |
| 0028 | `CPY_GRI_TO_TOA` | | `CUR_TOA` = `GRI_BCD` |
| 002B | `CPY4_TO_TOA` | HL = src | `CUR_TOA` = (HL..HL+3) |
| 0034 | `RST65_ISR` | | sample interrupt; returns to WAIT_SAMPLE's caller |
| 0072 | `INIT` | | cold start |

## Main sequence (see firmware.md)

| Addr | Name | Notes |
|---|---|---|
| 012D | `ACQ_START` | start master search |
| 0163 | `SEARCH_LOOP` | phase-code search |
| 018E | `SEARCH_VERIFY` | confirm master with a second read |
| 01B0 | `MASTER_FOUND` | set up slot 0 |
| 01E1 | `SETTLE_LOOP` | 20 passes of quality accumulation |
| 021B | `TRACK_LOOP` | per-epoch tracking |
| 023D | `TRACK_NEXT_SLOT` | slot scheduler |
| 0262 | `SLOT_PROCESS` | dispatch on `TRACK_STATE` |
| 031D | `SLOT_TRACKING` | state 80H |
| 0393 | `SLOT_ACQUIRE` | state 40H |
| 0314 | `SLOT_DONE` | store status, save record, next slot |

## Subroutines

| Addr | Name | In | Out | Notes |
|---|---|---|---|---|
| 0412 | `QUAL_UPDATE` | `PHASE_CODE` | `QUAL_LO/HI` | count zero bits per nibble, saturate 40H |
| 0445 | `QUAL_CHECK` | | CY = bad | either counter < 28H |
| 0459 | `WAIT_SAMPLE` | | A = status | background loop, exits via ISR |
| 049B | `WAIT_EPOCH` | | A = status | wait for status bit 4 |
| 04AE | `SHIFT_IN16` | | B, C, A = B | clock 8 bits from the receiver |
| 04D1 | `READ_PHASE` | | `PHASE_CODE` | `SHIFT_IN16` XOR `PHASE_REF` |
| 04E1 | `GET_SLOT_FLAGS` | | A | `SLOT_FLAGS[SLOT_IDX]` |
| 04E4 | `GET_FLAGS_A` | A = slot | A, HL | `SLOT_FLAGS[A]` |
| 04EB | `GET_SLOT_REC` | | HL | record for `SLOT_IDX` |
| 04FD | `GET_SEC_TOA` | A = idx | HL | `REC_SEC_TOA` + 25*(A&3) |
| 050B | `MUL9_INDEX` | A, HL | A = (HL+9A) | patched from x10 |
| 0522 | `LOAD_CUR_REC` | | | flags + 25-byte copy into `CUR_REC` |
| 053F | `LOAD_REC_HL` | HL | | copy 25 bytes (HL) -> `CUR_REC` |
| 0545 | `BIT_OF_STA` | A | A, HL | 1 << (A&3), HL = `TRACK_MASK` |
| 0553 | `COUNT_TRACKED` | | B | popcount `TRACK_MASK` |
| 055E | `SEC_TOA_TO_BIN` | A = idx | A | via `GET_SEC_TOA` |
| 0561 | `TOA_TO_BIN` | HL | A | bin(HL[1]) + (HL[2] >= 60H) |
| 0576 | `BCD_INC_STORE` | A | | `BCD_DELTA_3` = BCD(A+1) |
| 057A | `RESET_PULSES` | | | clear list, reset pointer |
| 0584 | `CLEAR_PULSES` | | | zero 17 bytes from `CUR_NPULSE` |
| 059D | `PHASE_MISMATCH` | B | B | popcount(`PHASE_REF` XOR B) |
| 05AF | `FIRST_SAMPLE` | | | wait, `SAMPLE_CNT` = 8, shift in |
| 05C2 | `MATCH_PULSES` | CY = exact | CY = window end | phase-code correlation over the window |
| 0665 | `SAMPLE_TO_BCD` | | | `BCD_DELTA_3` = BCD(`SAMPLE_CNT` - 9) |
| 0671 | `COUNT_BITS4` | A | B | popcount low nibble |
| 067F | `CHK_NPULSE` | | CY | both `CUR_NPULSE` bytes >= 6 |
| 0698 | `ADJ_PULSES` | | | pulse-position adjustment with BCD add/sub |
| 0721 | `NEG_HL` | HL, E | HL, E+1 | negate |
| 072A | `CALC_TD` | | HL = `TD_ADJ_SCRATCH` | form TD in `BCD_ACC`, store to `CUR_TOA`; always returns HL pointing at the fixed `TD_ADJ_SCRATCH` buffer, regardless of path taken |
| 0782 | `BCD_ADD4` | HL, BC | | (BC) += (HL), 4 bytes |
| 0794 | `PTR_TO_MSB` | HL, BC, DE | | advance both pointers by DE-1 |
| 079F | `BCD_SUB4` | HL, BC | | (BC) -= (HL), 4 bytes |
| 07BB | `COPY4` | HL, BC | | 4 bytes |
| 07BD | `COPY_E` | HL, BC, E | | E bytes |
| 07C6 | `MUL8` | C, D | BC | C * D |
| 07D9 | `BCD_TO_BIN` | A | A | packed BCD -> binary |
| 07EF | `BIN_TO_BCD` | A | A | binary -> packed BCD (continues at 0800: `RLC RLC RLC / ADD H / RET`) |

## ROM 2 (1000-17FF)

| Addr | Name | Notes |
|---|---|---|
| 1000 | `SLOTTBL_CHK` | tail of a routine spanning the ROM 1/ROM 2 boundary (entered from 0FFxH) |
| 1028 | `SLOTREC_PHASE` | update per-slot record from `PHASE_CODE_HI` |
| 105C | `SLOTREC_UPDATE` | per-slot BCD bookkeeping |
| 10DB | `CALL_TICK_HOOK` | PCHL through `TICK_HOOK` |
| 10DF | `SERIAL_POLL` | receive state machine, monitor, plot |
| 11EA | `MON_CMD` | monitor command dispatch |
| 1292 | `TX_STATE_N` | multi-character replies |
| 1358 | `PLOT_OUT` | strip-chart line output |
| 13AB | `PLOT_VALUES` | compute plot columns B, C |
| 13E7 | `DISP_REFRESH` | write 7 bytes of 8279 display RAM |
| 141F | `READ_SWITCHES` | power-up switch validation |
| 14B5 | `SW_TO_DIGIT` | thumbwheel row -> digit |
| 14C9 | `TICK_TASK` | tick counter, switch-change handling |
| 14F0 | `SCAN_SWITCHES` | read all rows, set-up and configuration |
| 16E0 | `TX_SERVICE` | drain print buffer |
| 1708 | `PRTBUF_GET` | fetch next print-buffer char |
| 1723 | `REPORT_TASK` | periodic serial report sequencer |
