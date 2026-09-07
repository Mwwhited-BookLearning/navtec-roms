# RAM map (6F00-70FF, 512 bytes)

RAM is two 256-byte blocks, one inside each 8155. INIT zeroes 6F00-70FB; the
stack pointer starts at 7100 and the top four bytes hold the return address of
the clearing call. Names are the ones used in `disasm/nt3321-22.json`; the
"confidence" column says how sure the interpretation is (H = clear from code,
M = consistent reading, L = placeholder name).

## 6F00-6FFF (8155 #1)

| Addr | Name | Size | Conf | Description |
|---|---|---|---|---|
| 6F01 | `ACQ_COUNT` | 1 | M | number of secondaries acquired; 0 triggers `X_0E1A` |
| 6F02 | `FIRST_SLOT` | 1 | M | slot of the first acquired / selected station (init from `SEL_A`) |
| 6F03 | `SLOT_RESULT` | 1 | L | value returned by `X_1E05` |
| 6F04 | `SLOT_FLAGS` | 10 | H | one flag byte per slot: bit 7 active, bit 6 acquiring, bits 1..0 secondary record index, bits 3/4/5 report & settle gates (master = C8H) |
| 6F0E | `WIN_END` | 1 | H | sample count at which the ISR fires the window-end capture |
| 6F0F | `TRACK_MASK` | 1 | H | bit per secondary (1 << (flags & 3)) currently tracked |
| 6F11 | `SLOT_IDX` | 1 | H | current slot 0..`SLOT_COUNT`-1 |
| 6F12 | `SLOT_IDX_B` | 1 | L | slot index used by the switch-scan path |
| 6F13 | `TRACK_STATE` | 1 | H | 01 window search, 20H set by `SET_SLOT_ACTIVE` when a slot is brought into tracking, 40H acquiring, 80H tracking, 06/07 done codes |
| 6F14 | `SLOT_COUNT` | 1 | H | slots per GRI, derived from GRI at INIT |
| 6F15 | `SAMPLE_CNT` | 1 | H | samples since epoch (starts at 8 in `FIRST_SAMPLE`) |
| 6F16 | `SAMPLE_LO` | 1 | M | second shift-register byte from `FIRST_SAMPLE` |
| 6F17 | `SYNC_FLAG` | 1 | H | set by the ISR after the window-end capture |
| 6F18 | `GRI_TMP` | 4 | M | 4-byte BCD scratch holding GRI at +1 (`GRI_TMP_VAL`) |
| 6F1C | `GRI_BCD` | 4 | H | 4-byte BCD GRI; `GRI_VAL` (6F1D/6F1E) holds the 4 dialled digits |
| 6F20 | `BCD_ACC` | 4 | H | 4-byte BCD accumulator for `BCD_ADD4`/`BCD_SUB4` (`BCD_ACC_HI` = 6F23) |
| 6F24 | `REC_MASTER` | 25 | H | master station record |
| 6F3D | `REC_SEC` | 4 x 25 | H | secondary station records (6F3D, 6F56, 6F6F, 6F88) |
| 6F41 | `REC_SEC_TOA` | - | H | TOA field (+4) of `REC_SEC[0]` |
| 6F54 | `SETTLE_CNT` | 1 | H | 20-pass settle counter (aliases `REC_SEC[0]`+23, only used before secondaries exist) |
| 6FA1 | `CUR_REC` | 25 | H | working copy of the current slot record |
| 6FA5 | `CUR_TOA` | 4 | H | +4: 4-byte BCD time of arrival / TD |
| 6FA9 | `CUR_NPULSE` | 1 | H | +8: pulse counters |
| 6FAA | `CUR_PULSES` | 5 | H | +9: matched sample positions |
| 6FAF | `CUR_PULSE_PTR` | 2 | H | +14: write pointer into `CUR_PULSES` |
| 6FB5 | `PHASE_QUAL_A` | 2 | M | saturating (+-511) quality accumulator for `PHASE_CODE`, updated each epoch by `PHASE_QUALITY_UPDATE` (`PHASE_QUAL_A_HI` = 6FB6) |
| 6FB7 | `CUR_MODE` | 1 | M | +22: 1 settling, 3 re-acquiring |
| 6FB8 | `PHASE_QUAL_B` | 2 | M | same as `PHASE_QUAL_A` but for `PHASE_CODE_HI` (`PHASE_QUAL_B_HI` = 6FB9) |
| 6FBA | `CUR_FLAGS` | 1 | H | copy of `SLOT_FLAGS[SLOT_IDX]` |
| 6FBB | `PHASE_REF` | 2 | H | XOR reference for the shift-register words |
| 6FBD | `PHASE_QUAL_FLAGS` | 1 | M | set by `PHASE_QUALITY_UPDATE` when a quality accumulator saturates; copied into `PULSE_ALIGN_FLAGS` each epoch |
| 6FBE | `PULSE_ALIGN_FLAGS` | 1 | M | refreshed from `PHASE_QUAL_FLAGS` every epoch by `EPOCH_PHASE_UPDATE`; consumed by `PULSE_ALIGN_ADJ` to correct `CUR_TOA` by whole pulse-intervals |
| 6FBF | `PHASE_CODE` | 2 | H | last shift-register words after XOR (`PHASE_CODE_HI` = 6FC0) |
| 6FC1 | `DISP_MODE` | 1 | M | 1 -> `X_0F31`, 2 -> `X_0F08` in the track loop |
| 6FC4 | `BUTTONS` | 1 | H | push-button bits from sensor rows 6/7 (bits 7, 6) |
| 6FC5 | `SEL_A` | 1 | H | selector A wheel + 1 |
| 6FC6 | `SEL_B` | 1 | H | selector B wheel + 1 (0CH = blank = set-up mode) |
| 6FCB | `VAR_6FCB` | 1 | L | FFH at INIT |
| 6FCC | `GRI_SW` | 2 | H | GRI from wheels, packed BCD (low byte first) |
| 6FCE | `RESTART_REQ` | 1 | L | set to 2 on a button press outside set-up |
| 6FCF | `BCD_DELTA` | 4 | H | 4-byte BCD operand for `ADJ_PULSES` (`BCD_DELTA_3` = 6FD2 written by `BIN_TO_DELTA`) |
| 6FD1 | `BCD_DELTA_2` | - | M | also passed to `X_0EC1` and copied to `CUR_TOA` |
| 6FD5 | `TOA_SAVE` | 4 | M | TOA saved when tracking is lost |
| 6FD9 | `VAR_6FD9` | 1 | L | 1BH at INIT |
| 6FDA | `MISS_CNT` | 1 | H | consecutive misses while tracking |
| 6FDC | `NEW_DATA` | 1 | M | set when a slot acquires or the selectors change |
| 6FDD | `MISS_LIMIT` | 1 | H | 100 (64H) or 130 (82H) |
| 6FDE | `TOA_ALT` | 4 | M | TOA copied into `CUR_TOA` after `MISS_LIMIT` misses |
| 6FDF | `PULSE_BCD` | 1 | M | BCD(pulse count + 1) |
| 6FE2 | `VAR_6FE2` | 1 | L | bit 1 tested in `ADJ_PULSES` |
| 6FE3 | `VAR_6FE3` | 1 | L | pointer returned by `CALC_TD` |
| 6FE6 | `VAR_6FE6` | 1 | L | 4 after master lock |
| 6FE7 | `VAR_6FE7` | 2 | L | 03,04 after master lock; 10H later |
| 6FE9 | `BCD_TMP` | 4 | H | 4-byte BCD scratch for `SLOTREC_UPDATE` |
| 6FEE | `SLOTREC_CNT` | 9 x n | H | per-slot 9-byte records; fields +3 `SLOTREC_3`, +5 `SLOTREC_5` |

## 7000-70FF (8155 #2)

| Addr | Name | Size | Conf | Description |
|---|---|---|---|---|
| 7034 | `DISP_ROW_A` | 3 | H | packed BCD digits for display row A; also written by `ERR_DASH_TBL`'s copy loop |
| 7037 | `DISP_ROW_B` | 3 | H | packed BCD digits for display row B |
| 703A | `DISP_EXTRA` | 1 | M | display position 6 |
| 703B | `KEY_CHANGED` | 1 | H | 8279 reported a sensor change |
| 703C | `BTN_STATE` | 1 | H | bit 7 toggles per press of button row-6/bit-7; bit 6 mirrors row-7/bit-7 |
| 703D | `TICK_BCD` | 1 | H | BCD tick counter, +2 per RST 7.5 |
| 703E | `PRTBUF` | ~16 | H | serial print buffer; `PRTBUF_PTR` (70D1) points at the last char, drained downwards |
| 704E | `TX_PENDING` | 1 | H | set when the print buffer ran dry, cleared by the report sequencer |
| 704F | `VAR_704F` | 1 | L | cleared when set-up latches; gates the report; also cascaded as a BCD clock digit by `TICK_CLOCK_CASCADE` (unreconciled dual use, see firmware.md) |
| 7050 | `VAR_7050` | 2 | L | cleared by second button press in set-up |
| 7054 | `SLOT_TBL` | n | L | one byte per slot, tested at 1000 |
| 70BD | `VAR_70BD` | 2 | L | cleared with `VAR_7050`; also cascaded by `TICK_CLOCK_CASCADE`'s second clock when `STATUS_BITS` bit 7 is clear |
| 70BF | `STATUS_BITS` | 1 | M | bit 7 set/cleared by button edges in set-up |
| 70C3 | `MASTER_TOA_CORR` | 4 | M | master-only pulse-interval correction term, adjusted by `MASTER_CORR_ADJ`/`MASTER_CORR_ADD_3000`, added into the master's running sum by `ACCUM_SLOT_TOA` |
| 70C8 | `SW_D1`..`SW_D4` | 4 | H | GRI wheels as read (0BH = blank) |
| 70CC | `SW_HI`, `SW_LO` | 2 | H | latched wheels as two packed BCD bytes; also cascaded as BCD clock digits by `TICK_CLOCK_CASCADE` (unreconciled dual use, see firmware.md) |
| 70CE | `SW_LATCHED` | 1 | H | 1 after latching in set-up |
| 70CF | `PLOT_COL` | 1 | H | plot-mode column counter |
| 70D0 | `RPT_STATE` | 1 | H | report sequencer: FEH idle, FFH armed, 0..8 item |
| 70D1 | `PRTBUF_PTR` | 2 | H | see `PRTBUF` |
| 70D8 | `QUAL_LO`, `QUAL_HI` | 2 | H | signal-quality accumulators (saturate at 40H, good >= 28H) |
| 70DA | `TICK_HOOK` | 2 | H | optional routine called on every tick when non-zero |
| 70DC | `OUT_MODE` | 1 | H | 0 normal, 1 suppressed, 2 plot |
| 70DD | `PROTO_STATE` | 1 | H | serial selection state 0..6 |
| 70DE | `UNIT_ID` | 1 | H | address character, default '0' |
| 70DF | `OPTIONS` | 1 | H | report gating bits from configuration items 4..9 |
| 70E0 | `RX_STATE` | 1 | H | serial receive/transmit state |
| 70E1 | `RX_CHAR` | 1 | H | last received char / pending hex digit to send |
| 70E2 | `MON_PTR` | 2 | H | monitor address pointer |
| 70E4 | `MON_WORD` | 2 | H | monitor hex entry word |
| 70E6 | `MON_DIGIT_FLAG` | 1 | H | a hex digit has been entered since the last command |
| 70E7 | `MON_LAST` | 1 | H | last byte dumped by `M` |
| 70E8 | `PLOT_BASE` | 2 | H | B,C values for the current plot line |
| 70FC | (stack) | 4 | H | top of stack, 7100 = initial SP |

Addresses not listed are either untouched by any code, or touched only by
routines that are present in the fully-recovered ROM but not yet individually
analyzed - see [jump-graph.md](jump-graph.md)'s variable worklist for the
full list of those (`M_xxxx` names).
