# ROM dump status

**Both chips are now fully recovered.** This document is written
chronologically, as the recovery actually happened (NT3321 first, then
NT3322), and was never fully swept afterward - some sections below still
read as if NT3322 were outstanding. It isn't; `originals/*.BIN` are both
complete, correct 4 KB dumps. See `docs/PROGRESS.md` for the current status
and `docs/jump-graph.md` for what's left to *analyze* (as opposed to dump).

## Resolved: the correct read wiring for these EPROMs

The devices read correctly as a standard **2732** on a TL866-class programmer
**with three pins re-wired** relative to the normal ZIF mapping:

| Programmer pin | Goes to chip pin(s) |
|---|---|
| P21 | chip P18 |
| P18 | chip P20 **and** chip P21 |
| P20 | not connected |

This was found by breadboarding NT3321's pins 18/20/21 through all eight
0/1 combinations while reading the rest of the chip as a 2716, then checking
each result against the known-good lower half and against the predicted
continuation of `BIN_TO_BCD` (see "Evidence" below). The `0` `1` `0` combination
(in the `{p21}{p18}{p20}` order used for those test files) reproduced the known
lower half exactly when repeated, and produced fully coherent, correctly
cross-referencing 8085 code for the upper half - confirmed by re-running
`tools/dis8085.js` after dropping the corrected image into `originals/`: the
"unreached byte runs" gap at 0800-0FFF closed completely (4034 -> 6082 bytes of
code) and all 33 previously-external routine references (`X_0817`,
`SAVE_CUR_REC`, `FILL_ZERO`, etc.) resolved to real, sensible code.

`CN19229N NT3321 7943.BIN` in `originals/` is now the corrected, complete 4 KB
image (SHA-256 `8ac15a519a859381ef7720573f592ffe0690b838936f8b9117b6adb574eade7f`).
**NT3322 still needs the same treatment** - it is almost certainly the same
physical part, so the `010` wiring above should work directly, but it has not
yet been confirmed on that chip.

## What the images contained (before the fix above)

| File | Bytes | Programmed | Blank (FFH) |
|---|---|---|---|
| `CN19229N NT3321 7943.BIN` | 4096 | 0000-07FF | 0800-0FFF (now recovered, see above) |
| `CN19230N NT3322 7943.BIN` | 4096 | 1000-17FF | 1800-1FFF (now recovered, see above) |

Both images were dumped as 4 KB with an all-FFH upper half. That was not
padding: the programmed halves call into the blank halves, so the code there
exists and simply was not captured by a plain 2732 read.

## Evidence that the blank halves are real code

- `BIN_TO_BCD` at 07EF runs off the end of the dumped half; its last instruction
  is at 07FF and the routine must continue at 0800.
- 33 distinct routines in 0800-0FFF and 1800-1FFF are called from the dumped
  code (`X_0817`, `SAVE_CUR_REC`, `X_0DB3`, `X_0E1D`, `X_1878`, `X_1DBD`, ...).
- The code at 1000-10DA is the tail of a routine that begins somewhere in
  0F00-0FFF and jumps back to 0FE9, 0FBE and 0F6A.
- The `LXI H` instruction at 17FE is the last one in ROM 2's dumped half and its
  high operand byte lies at 1800, so its value (shown as 0FF56H) is unknown.
- `DISP_REFRESH` (13E7) and `ADJ_PULSES` (0698) are complete routines that no
  *then-dumped* code called: their callers turned out to be in the halves
  recovered later - `L_1CEA` for `DISP_REFRESH`, and `CALC_TD` for
  `ADJ_PULSES` (both now identified, see `docs/routines.md`).

The address layout also means the parts are not two 2 KB devices in a four-ROM
system: each chip's own upper half is what is missing.

## What actually happened

The date code 7943 (week 43 of 1979) puts these at the transition from 2716 to
2732 EPROMs, and the board is otherwise built entirely from Intel 8085-family
parts (8085A, two 8155s, an 8251A, an 8279/8275). Both facts pointed the same
direction, and it turned out to be right: **these are Intel 8332 masked ROMs**
(Intel's own mask-ROM equivalent of the 2732, the 4 KB counterpart to their
2Kx8 8316), not generic 2732-class EPROMs. They differ from a plain 2732 on
exactly the pins the initial hypothesis pointed at - 18, 20 and 21 - which is
why a stock "2732" read got the low half right and the high half deselected
(solid FFh) instead of, say, scrambled data.

The full, confirmed pin-remapping and read procedure is documented in
[../originals/README.md](../originals/README.md) - that is now the canonical
reference for reading one of these chips. In short: read as "2732" on the
programmer, but wire programmer-pin-21 to chip-pin-18, programmer-pin-18 to
both chip-pins 20 and 21, and leave programmer-pin-20 disconnected.

## What's left to do (done - kept for the historical record)

1. ~~**NT3322** still needs a fresh read using the wiring in
   `originals/README.md`.~~ Done: the same rewire worked directly on NT3322.
2. ~~Drop the corrected NT3322 image into `originals/`... and re-run
   `node tools/dis8085.js disasm/nt3321-22.json`.~~ Done: the listing filled
   in immediately, the same way it did for NT3321. `X_1804` is now
   `RPT_FMT_TD3` and `X_1878` is now `PRT_HEX_BYTE` - see `docs/jump-graph.md`
   for the current names of everything that was "missing" when this was written.

## Routines in the missing halves and what the callers tell us

**Superseded.** Both halves are now fully recovered and this table is the
pre-recovery guesswork, kept for the record. See `docs/routines.md`,
`docs/firmware.md` and `docs/ram-map.md` for the confirmed analysis. Notably:
the `X_1990`..`X_19A9` guess below was exactly right (now named `SW_ERR_SEL_A`,
`SW_ERR_SEL_B`, `SW_ERR_GRI1`..`SW_ERR_GRI4`); the `X_18C0` guess ("probably
`DISP_REFRESH` driver") was **wrong** - it's actually a cascading BCD tick
clock (`TICK_CLOCK_CASCADE`); the `X_1E4C` guess ("receiver hardware
initialisation") was also **wrong** - it's `ROM_SELFTEST`, an XOR checksum
over most of the ROM whose pass/fail result is never even tested by the
caller (see `disasm/nt3321-22.json`'s `1E4C` comment). Both wrong guesses
were architecturally reasonable calls-from-INIT/calls-from-tick, just not
what the actual decoded bytes turned out to do.

| Address | Name | Called from | Inferred purpose |
|---|---|---|---|
| 0800 | (tail of `BIN_TO_BCD`) | 07FF | RLC RLC RLC ADD H RET |
| 0808 | `HI_NIBBLE` | `BCD_TO_BIN` | A = high digit of B (7 bytes: MOV A,B RRC x4 ANI 0FH RET) |
| 080F | `FILL_ZERO` | INIT, `CLEAR_PULSES`, `SLOTREC_UPDATE` | zero B bytes at HL (8 bytes) |
| 0817 | `X_0817` | settle and track loops | per-epoch update, likely display of TDs |
| 0875 | `SAVE_CUR_REC` | `SLOT_SAVE_NEXT` | copy `CUR_REC` back to the slot record |
| 08A9 | `X_08A9` | `TRACK_SLOT_BIT6` | handle a slot in acquisition (flag bit 6) |
| 0B8D | `X_0B8D` | `CALC_TD` | 16-bit arithmetic on HL with BC = 1 |
| 0D79 | `X_0D79` | `SEARCH_VERIFY` (A = 0FH) | display fill / clear |
| 0DB3 | `X_0DB3` | acquisition (A = 0EH, 0FH) | display fill / clear |
| 0DE3 / 0DE6 | `X_0DE3`, `X_0DE6` | loops, BC = record | display a record's TD |
| 0E1A | `X_0E1A` | `ACQ_COUNT` == 0, `SLOT_ACQUIRE` | (re)initialise acquisition |
| 0E1D | `X_0E1D` | ISR at window end, `SLOT_TRACKING` | latch/capture the window measurement |
| 0E2D | `X_0E2D` | `SLOT_TRACKING` | prepare tracking window |
| 0EC1 | `X_0EC1` | HL = 4-byte BCD constant | add BCD constant to `CUR_TOA` |
| 0ED9 | `X_0ED9` | end of each loop pass | epoch housekeeping |
| 0EEE | `X_0EEE` | `TRACK_LOOP` | tracking-loop step |
| 0F08 / 0F31 | `X_0F08`, `X_0F31` | `DISP_MODE` 2 / 1 | display format handlers |
| 0F23 | `X_0F23` | after master lock | start secondary search |
| 0F6A, 0FBE, 0FE9 | | jumped to from 1000-1021 | body of the routine whose tail is at 1000 |
| 1804 | `X_1804` | `RPT_FORMAT` | continue report item formatting |
| 1878 / 189B | `X_1878`, `X_189B` | `RPT_FORMAT` | format report item into `PRTBUF` |
| 18C0 | `X_18C0` | tick | probably `DISP_REFRESH` driver |
| 1940 | `X_1940` | report complete | send terminator |
| 1990..19A9 | `X_1990`..`X_19A9` | switch validation | six 5-byte error stubs (MVI A,n / JMP) |
| 19E7 | `X_19E7` | every 20 ticks | slow periodic job (blink, timeout) |
| 1DBD | `X_1DBD` | selector validation | mark slot selected, carry = fail |
| 1E05 | `X_1E05` | acquisition, switch scan | evaluate slot, result to `SLOT_RESULT` |
| 1E4C | `X_1E4C` | INIT | receiver hardware initialisation |

Until the halves are recovered, the rebuild target can only be the dumped
halves; the listing marks the gaps explicitly.
