# ROM dump status: half of the firmware is missing

## What the images contain

| File | Bytes | Programmed | Blank (FFH) |
|---|---|---|---|
| `CN19229N NT3321 7943.BIN` | 4096 | 0000-07FF | 0800-0FFF |
| `CN19230N NT3322 7943.BIN` | 4096 | 1000-17FF | 1800-1FFF |

Both images are 4 KB and both have an all-FFH upper half. That is not padding:
the programmed halves call into the blank halves, so the code there exists and
was not captured.

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
  dumped code calls: their callers are in the missing halves.

The address layout also means the parts are not two 2 KB devices in a four-ROM
system: each chip's own upper half is what is missing.

## What probably happened

The date code 7943 (week 43 of 1979) puts these at the transition from 2716 to
2732 EPROMs. Two readings fit a 4 KB file with a blank upper half:

1. **The parts are 2732-class 4 KB EPROMs and the programmer failed to read the
   upper half.** Reading a TI TMS2532 with the programmer set to Intel 2732 (or
   vice versa) gives exactly this symptom, because the two devices swap the
   roles of pins 18, 20 and 21 (A11, CE/PD, Vpp). One half comes back valid, the
   other comes back FFH because the chip is deselected.
2. The parts are 2716s that were read as 2732s. This normally gives a duplicated
   half rather than a blank one, so it is less likely, but worth ruling out.

## What to do

1. Read the part number printed on the EPROM body (not the label): 2732,
   2732A, TMS2532, 2716, TMS2516, or a house number.
2. Re-read each device with the programmer set to that exact type. For a
   TMS2532 select "2532", not "2732".
3. Check the new dump: the bytes at 0000-07FF must be identical to the current
   file, and 0800-0FFF must not be all FFH. `BIN_TO_BCD` must continue with
   `07 07 07 84 C9` (RLC RLC RLC ADD H RET) at 0800-0804 if the analysis is
   right.
4. Drop the new files into `originals/` and re-run `node tools/dis8085.js
   disasm/nt3321-22.json`. The hints file already names the routines that live
   in the missing halves, so the listing will fill in immediately.

## Routines in the missing halves and what the callers tell us

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
