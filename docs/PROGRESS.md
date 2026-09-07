# Progress notes / session handoff (2026-09-06, updated same day)

## Update 2: jump graph, worklist, and a real bug in the old analysis

Built `docs/jump-graph.md`: PlantUML sequence diagrams for the call structure
(system overview + two newly-decoded clusters) plus full tables of all 137
`CALL`ed jump targets and all 173 referenced RAM/IO addresses, each flagged
`named` or `needs analysis`. That table *is* the worklist going forward - see
its "What to tackle next, by cluster" section instead of duplicating it here.

Renamed/analyzed this pass (77 -> 62 generic routines, 6 new variable names):

- **The whole print-buffer formatting cluster (186D-19E7)**, previously all
  generic `SUB_`/`X_` names: `PRTBUF_PUT`, `NIBBLE_TO_HEX`, `BYTE_TO_HEX2`,
  `PRT_HEX_BYTE`, `PRT_HEX_HI_SP`, `PRT_TD_DOT`, `RPT_FMT_TD3`,
  `PRT_HEX_BYTE_A`, `PRT_DIGIT_LO`, `RPT_HEADER_LINE` - confirmed by tracing
  every call site in `REPORT_TASK`, not just inferred.
- **The six switch-validation error stubs**, confirmed exactly right (not
  just "most likely" as the old front-panel.md hedge had it): `SW_ERR_SEL_A`,
  `SW_ERR_SEL_B`, `SW_ERR_GRI1..GRI4`, plus the shared `SW_ERR_SHOW` and its
  `ERR_DASH_TBL` data table.
- **`TICK_CLOCK_CASCADE`** (was `X_18C0`): NOT a display-refresh driver (the
  old guess) - it's a cascading BCD tick clock (HH:MM:SS-shaped) written into
  `SW_LO`/`SW_HI`/`VAR_704F` and a second one gated by `STATUS_BITS` bit 7.
  This conflicts with those same cells' other documented role as latched
  thumbwheel values and is flagged, unresolved, in firmware.md.
- **`DISP_ROW_A`/`DISP_ROW_B`/`DISP_EXTRA`** (7034/7037/703A): promoted from
  ram-map.md's unnamed "(display)" placeholder rows to real equates.
- **A real bug fix, not just a rename:** `0515` (was `OLD_MUL10`, documented
  repo-wide as "dead code left by an in-place patch") turned out to have 11
  live `CALL` xrefs - a forced `db` override in the hints file was hiding it
  as data despite being reachable code. It's `MUL10_INDEX`, a genuine sibling
  of `MUL9_INDEX` for a different (10-byte-stride) family of tables. Fixed in
  `disasm/nt3321-22.json`, `docs/firmware.md`'s patch-evidence table, and
  `docs/ram-map.md`'s `SLOTREC_CNT` note (which had cited the wrong evidence
  for its own, correct, 9-byte-stride claim).
- Swept and fixed **8 stale "in the missing half" comments** in the hints
  file, and 3 more in `docs/front-panel.md`/`docs/serial-protocol.md` - all
  left over from before both ROM halves were recovered, some (like
  `DISP_REFRESH`'s "never reached from the dumped halves") now simply wrong
  since the routine is fully present and reachable.

Rebuild re-verified after every change in this pass; still 0 differences over
8192 bytes. `docs/rom-status.md`'s old pre-recovery guess table is marked
superseded rather than deleted, with a note on which guesses were right
(`X_1990..X_19A9`) and wrong (`X_18C0`).

# Progress notes / session handoff (2026-09-06)

Written for picking this project back up without needing the conversation
that produced it. Read this first if you're resuming work here.

## Update (later same day)

Both of the top two open items from the previous handoff are now done:

1. **Rebuild verification.** Downloaded the precompiled AS build into
   `tools/asl/` (gitignored, per the README's instructions) and ran
   `sh tools/rebuild.sh` against the now-complete ROM images: **0 differences
   over 8192 bytes.** The disassembly's understanding of the previously-missing
   halves is confirmed correct.
2. **Small remaining data regions.** All entries in the "Unreached byte runs"
   table are now individually labeled/commented in `disasm/nt3321-22.json`:
   - `0x1018` was actually misclassified - it's a real `POP PSW` reached from
     three jumps (`0FC5`/`0FCA`/`0FD4`) into `SLOT_INC_CHK`; removing its
     stale forced-`db` hint let flow analysis reclassify it as code
     (code coverage 7968 -> 7969 bytes).
   - `0x0031`'s block comment previously claimed "three orphan bytes (never
     reached)", which was wrong - its first byte *is* read (at `1A33`). Fixed
     to say only the other two bytes are true orphans.
   - `198A-198F` (`COL_INIT_TBL`): a real 6-byte data table, confirmed via its
     consumer loop at `L_19C1`.
   - `19AE-19B7` (`X_19AE`/`X_19B3`): two more `MVI B,nn / JMP L_19B8` stubs
     continuing the `X_1990..X_19A9` pattern, but never called - genuinely dead.
   - `1A4D-1A50` (`D_1A4D`/`D_1A4E`): a companion byte to `0x0031` (both `30H`,
     ASCII `'0'`) plus a 3-byte table consumed by `SUB_1CF3`.
   - `1E1C-1E22` (`OLD_SUB_1E23`): dead code from an in-place patch - an older,
     shorter entry point into what's now `SUB_1E23`.
   - `1E6D-1E72` (`ORPHAN_1E6D`): a self-contained dead-code island (`CNZ 19AE`
     / `JMP 1E6D`, an infinite self-loop) that calls the also-dead `X_19AE`.
   - `1F80-1FFF` (128 bytes): manually decoded (kept as `DB` since it's not in
     live flow) as a cluster of superseded routine bodies from the same
     patch/reorg that left behind `OLD_MUL10` and `OLD_LOAD_REC` - see the
     `1F80` block comment in the JSON for the four sub-fragments.

   Rebuild re-verified after each change; still 0 differences over 8192 bytes.

What's left is items 3 and 4 below (physical-board meter cross-check, and
optional `entries`/`extraCode` cleanup in the JSON) - neither is urgent.

## Where things stand

**Both ROMs are fully recovered.** The chips are Intel 8332 masked ROMs (the
4Kx8 mask-ROM equivalent of the 2716/8316 pair, one step up), not generic
2732-class EPROMs - that's why a plain 2732 read only ever got half of each
chip. The exact fix (a 3-pin rewire on a TL866-class programmer, still using
its "2732" profile) is documented in [../originals/README.md](../originals/README.md).
Both `originals/*.BIN` files now contain complete, correct dumps.

After dropping the corrected images in and removing the now-stale `"blank"`
region entries from `disasm/nt3321-22.json`, re-running
`node tools/dis8085.js disasm/nt3321-22.json` took the disassembly from
roughly half-classified to essentially complete: 7968 of 8192 bytes are now
reached by flow analysis, and every one of the ~33 routines the original
analysis had flagged as "referenced but missing" resolved to real, coherent,
correctly cross-referencing code (spot-checked several by hand: `FILL_ZERO`,
`X_0817`, `SAVE_CUR_REC`, `X_1804`, `X_1878`, `X_1DBD`, `X_1E4C`).

The 8279 vs. 8275 chip-identification question that came up during this
session is resolved in favor of **8279** - the existing code-analysis
evidence (`hardware.md`) already had this as "certain" from actual 8279
command bytes seen in the firmware, which is stronger evidence than a photo
read of two easily-confused part numbers.

## What's NOT done yet

Items 1 and 2 from the original version of this list (rebuild verification,
small remaining data regions) are done - see "Update (later same day)" above.
Renumbered remaining items:

1. **Physical-board cross-check.** `docs/hardware.md` now has a "Physical
   board observations" section from photos of the actual board (manufacturer
   ID, a candidate answer for the crystal-frequency open question, an
   RS-422/485 line receiver that corroborates the multi-drop serial protocol,
   silkscreened functional section names, two unpopulated `OPTION` ROM
   sockets). None of this has been traced with a meter against the schematic
   - it's corroborating context, not verified fact.
2. **`disasm/nt3321-22.json` cleanup.** The hints file's `entries`/`extraCode`
   lists may be worth revisiting now that flow analysis reaches so much more
   of the image directly - some entries added earlier specifically to force
   discovery of code in the (then-missing) upper halves might now be
   redundant, though leaving them is harmless.

## Quick orientation if you're new to this repo

- `originals/` - the ROM dumps, plus the read-procedure README. Don't hand-edit
  the `.BIN` files; if a dump needs correcting, replace the whole file (it's
  git-tracked, so any mistake is recoverable).
- `disasm/nt3321-22.json` is the single source of truth for disassembly hints
  (entry points, data regions, labels, comments). Everything else in `disasm/`
  is generated from it by `tools/dis8085.js` - edit the JSON, not the `.lst`/
  `.asm`/`-refs.md` files directly.
- `docs/rom-status.md` has the full story of the ROM-reading problem and its
  resolution, including the diagnostic reasoning (not just the answer) in
  case a similar problem comes up with a different chip.
- `docs/hardware.md` is the memory map / peripheral-programming reference;
  now has both the code-derived analysis and the photo-derived board notes.
