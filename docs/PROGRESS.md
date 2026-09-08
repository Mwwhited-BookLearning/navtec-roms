# Progress notes / session handoff (2026-09-06/07)

## Update 5: hardware data, PAL/CUPL decoder, an 8085 emulator with a web
front end, and an operator user-flow design document

Follows on from Update 4 (below), which finished the renaming milestone.
This update is a different kind of work: turning the finished analysis into
running code and operator-facing documentation, plus folding in the first
real physical-board data from the user.

- **Physical hardware data incorporated.** The user confirmed: a single
  10 MHz TCXO on the board (resolves the crystal-frequency open question -
  the 8085's internal /2 gives exactly 5.000 MHz, matching the baud-rate
  table's already-preferred fit); chip designators for all seven ICs
  (U22/U35 = the two 8155s, U32 = 8251A, U36 = 8279, U40 = 8085, U45 = 8205
  decoder, U39 = 8212); and that U45 being an 8205 confirms the
  code-inferred "single 3-to-8 decoder" theory. Flagged (not silently
  resolved) a conflict between an earlier photo pass and the new
  designator data over where the `OPTION` ROM sockets actually sit. Added a
  9-item physical-verification checklist to `hardware.md` for whoever has
  the board next.
- **An emulated PAL16R8/20R10 device-address decoder with matching CUPL
  source** (`src/emu/pal.js`, `src/emu/addr-decode.js`,
  `pal/addr_decoder_16r8.pld`, `pal/addr_decoder_20r10.pld`) - explicitly a
  design-tool/hardware-modification artifact standing in for the board's
  real TTL-based decode (8205 + glue), not a claim about what's physically
  on the board. See `docs/pal-decoder.md`.
- **A from-scratch 8085 emulator** (`src/emu/emu8085.js`): full documented +
  undocumented instruction set, all peripherals as standalone components
  (each exposes `read8`/`write8` and decides for itself which address bits
  matter to it), a synthetic Loran-C receiver front end. Verified booting
  both real ROM images through `INIT`/self-test/`READ_SWITCHES` and, with a
  valid switch panel, into the real background tracking loop. See
  `docs/emulator.md` for what's been checked and every place it had to
  guess.
- **A web front end** (`src/emu/web-emu.js` + `src/emu/web/index.html`):
  thumbwheels, push-buttons, a real CSS 7-segment display, a blinkenlights
  panel tied to named internal signals, a serial console, receiver
  controls, and an illustrative Loran-C hyperbolic position-fix map
  (`src/emu/loran-chains.js`, real chain-9940 geometry, explicitly *not* a
  real position - see `docs/web-emulator.md`). Building and testing this
  surfaced and fixed three real bugs: the 8279's clear command was wiping
  the live switch-matrix sensor RAM instead of just display RAM; nothing
  connected the 8279's IRQ output to RST 5.5, so a switch changed after
  cold boot was never noticed; and the position map's hyperbola-curve
  parametrization divided by a value that could be near zero and blew up.
- **Six screenshotted playbooks** (`docs/playbooks/`) walking through the
  web UI's user flows, captured by a Playwright script
  (`src/emu/playbooks/capture.js`) that can regenerate every screenshot in
  about 15 seconds. Added `playwright` as this project's first root
  `package.json` devDependency.
- **An operator user-flow design document** (`docs/user-flows.md`)
  synthesizing the *experience* (cold start, station selection, set-up
  mode, error recovery, the four serial-host flows) from the existing
  *mechanism* docs, with per-claim confirmed/inferred/open confidence
  markers. Surfaced one previously-undocumented mechanism in the process
  (`ram-map.md`'s `DISP_SCAN_SLOT`/`DISP_SCAN_START` describe an
  auto-scanning display mode that hadn't been written up as a flow before)
  and named the single biggest real gap: what the display actually shows
  *during* acquisition/tracking isn't established by any traced code path.

## Update 4: every jump target AND every variable in the ROM now has a name

Finished what Update 3 started: **0 of 137 routines and 0 of 175 variables
remain generically named.** Two more passes closed out the last 25
variables:

- A breakthrough on the previously-lowest-confidence routine,
  `SLOT_STATE_DISPATCH` (now `MASTER_SEC_PULSE_HANDOFF`): its two mystery
  operands turned out to be exactly `REC_MASTER`+9 and `REC_SEC[0]`+9 (both
  confirmed by address arithmetic) - the master's and first secondary's
  `CUR_PULSES` fields. The routine is a 2-3 stage pulse-position handoff
  between them, gated on flag-bit milestones. Raised from low to high
  confidence. The same pass resolved `REC_MASTER_4`, `REC_MASTER_18`,
  `CUR_TOA_3`, `SLOTREC_1`, `SLOTREC_6` - all confirmed record-offset
  aliases, following the existing `REC_MASTER_14`/`REC_SEC_14` naming
  convention already in the codebase.
- A second breakthrough: `M_6FBC`, flagged "role untraced" earlier in the
  session, turned out not to be an independent variable at all - it's
  `PHASE_REF`'s own high byte (`PHASE_REF_HI`, confirmed by address
  arithmetic: `PHASE_REF` is 2 bytes at 6FBB-6FBC). `EPOCH_PHASE_UPDATE`
  copies it into `PHASE_REF`'s low byte every epoch, meaning the two
  channel references end up forced equal each epoch - the *why* is still
  open, but the mechanism is now fully traced instead of mysterious.
- A quality-tracking cluster inside `PHASE_QUALITY_UPDATE`'s own body
  (`PHASE_QUAL_UPDATE_CNT`, `QUAL_STREAK_DIV5`, `MATCH_SCORE_HI`,
  `QUAL_STREAK_CNT`) - a second, faster-response confidence accumulator for
  channel 2, paralleling `PHASE_QUAL_A`/`PHASE_QUAL_B`.
- The last handful of confirmed `LXI`-immediate arithmetic constants got
  descriptive names too (`NEG_200`, `NEG_128`, `NEG_64`, `NEG_100`,
  `PAIR_80_20`, `PHASE_PAIR_A`, `PHASE_PAIR_B`, `TAG_2002`, `TAG_2010`) -
  named for readability even though their own comments are explicit that
  they are not real memory locations, just single-use immediate operands.

Four names remain honestly flagged low/medium-confidence rather than fully
proven (`MASTER_SEC_PULSE_HANDOFF`'s `REC_MASTER_18` threshold, the
`1E9B-1F20` BCD cluster's semantic purpose, the channel-2 quality-streak
cluster's exact pass/fail semantics, `DISP_TEST_TICK`'s non-test path) - see
`docs/jump-graph.md`'s "What to tackle next" for specifics. Every one of
them already has real names and a comment describing exactly what's
confirmed vs. not; there is no more "needs analysis" backlog, only
confidence-raising on an explicitly-marked handful.

Rebuild re-verified after every change in both passes: still 0 differences
over 8192 bytes.

## Update 3: every jump target in the ROM now has a name

Starting from Update 2's worklist (77 of 137 `CALL`ed jump targets generic),
worked through the entire list cluster by cluster - **0 remain generic.**
39 of 175 variables still do (mostly scattered `M_xxxx` bytes near the
now-understood clusters, plus a handful of confirmed `LXI`-immediate
artifacts that were never real variables at all).

Highlights, in the order they were found (see git log for one commit per
cluster, each with its own rebuild re-verification):

- Two real bugs, not just renames: `MUL10_INDEX` and `PHASE_AB_SELECT` were
  both documented as "dead code from an in-place patch," but both have real
  `CALL` xrefs - a stale forced-`db` override in the hints file was hiding
  live code as data in both cases.
- Three wrong guesses corrected across the docs: `ROM_SELFTEST` (was
  "receiver init" - it's an XOR checksum whose result nothing ever tests),
  `TICK_CLOCK_CASCADE` (was "display refresh" - it's a BCD clock),
  `INIT_REC_FROM_TOA`/`INIT_REC_AND_SEND` (were "display fill/clear",
  repeated in three docs - neither touches the display).
- The GRI-A/GRI-B phase alternator (`PHASE_AB_SELECT`), the pulse-interval
  TOA-correction family (`PULSE_ALIGN_ADJ` and friends, corrections in whole
  multiples of the ~1000us inter-pulse spacing), two saturating phase-quality
  accumulators that trigger pulse realignment (`PHASE_QUALITY_UPDATE`), and
  the SEL_A/SEL_B-driven display-column and blink pipeline
  (`CHECK_SEL_RANGE`/`COMMIT_DISP_ROWS`/`APPLY_DISP_BLINK`/`BLINK_ROW_BLANK`).
- Found that the firmware pre-stages the *next* tracking slot's station
  record a full epoch ahead and commits it to `PIO1`/`PIO2` parallel ports
  precisely at the RST 6.5 sample-window boundary (`FIND_NEXT_TRACK_SLOT`/
  `LATCH_REC_TO_PIO2PB`/`REC_TO_FRONTEND`) - strong evidence for a
  feed-forward timing hint to the analog front end, previously only a
  hedged hypothesis.
- A held-thumbwheel display self-test sequence (`DISP_TEST_TICK`, flashes
  "88.88.88").
- Two names left deliberately low-confidence rather than guessed:
  `SLOT_STATE_DISPATCH` (the hardest routine in the ROM) and the `1E9B-1F20`
  extended-precision BCD cluster (named mechanically, not semantically -
  plausibly TD-to-plot-column scaling, not confirmed).

`docs/jump-graph.md`'s tables and "What to tackle next" section are the
current worklist - now reframed around raising confidence on the low-
confidence names and naming the remaining variables, rather than first-pass
routine naming.

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
The physical-board cross-check and JSON-cleanup items are still open, plus
new items from Update 5:

1. **Physical-board verification, now itemized.** The crystal question is
   effectively resolved (Update 5) and the 8205/decoder theory is
   confirmed, but `docs/hardware.md`'s "Physical-verification checklist"
   (9 items - RST 7.5 source, which 8155 is which, the U39/8212 conflict,
   the OPTION socket wiring, the 8279 CLK source, etc.) is still open and
   needs someone with the actual board and a meter.
2. **Receiver front-end bit-protocol verification.** The emulator's
   synthetic Loran-C front end (Update 5) hasn't been driven all the way to
   `MASTER_FOUND` - `SHIFT_IN16`/`MATCH_PULSES`'s exact bit ordering needs
   re-verification against the disassembly and the front end's timing
   needs tuning to match, per `docs/emulator.md`'s suggested next step.
3. **`disasm/nt3321-22.json` cleanup.** The hints file's `entries`/`extraCode`
   lists may be worth revisiting now that flow analysis reaches so much more
   of the image directly - some entries added earlier specifically to force
   discovery of code in the (then-missing) upper halves might now be
   redundant, though leaving them is harmless.
4. **Open UX questions from the user-flow synthesis** (`docs/user-flows.md`):
   what the two push-buttons do outside set-up mode, whether display
   dimming is firmware-controlled at all, and what the display shows during
   acquisition/tracking before a station locks.

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
  now has both the code-derived analysis and the photo-derived board notes,
  plus the physical-verification checklist mentioned above.
- `src/emu/` is the 8085 emulator and its web front end (Update 5) - start
  at `docs/emulator.md` and `docs/web-emulator.md`; `docs/playbooks/` has
  screenshotted usage walkthroughs.
- `docs/user-flows.md` is the operator-facing design document - what someone
  in front of the unit or on the serial line actually experiences, as
  opposed to the mechanism-focused docs everything else here is.
