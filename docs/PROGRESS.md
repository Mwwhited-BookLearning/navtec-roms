# Progress notes / session handoff (2026-09-06)

Written for picking this project back up without needing the conversation
that produced it. Read this first if you're resuming work here.

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

1. **Rebuild verification.** `tools/rebuild.sh` (assembles `disasm/nt3321-22.asm`
   with the AS macro assembler and diffs the result against `originals/`) has
   not been re-run against the two newly-completed images. The README's own
   rebuild claim ("0 differences over 8192 bytes") predates this session's
   fix and needs to be re-verified now that there's real data to check against
   in the previously-blank halves. This is the single most important next
   step - it's the actual proof that the disassembly's understanding of the
   missing halves (not just "it looks like code" but "it re-assembles back to
   the exact same bytes") is correct.
2. **Small remaining data regions.** After the fix, `nt3321-22-refs.md`'s
   "Unreached byte runs" table still lists several small chunks (a handful of
   bytes each, plus one 128-byte block at `1F80-1FFF`) that flow analysis
   didn't reach. These are very likely legitimate data tables (similar to the
   `db`-kind regions already declared elsewhere in `disasm/nt3321-22.json`),
   but haven't been individually classified/labeled yet.
3. **Physical-board cross-check.** `docs/hardware.md` now has a "Physical
   board observations" section from photos of the actual board (manufacturer
   ID, a candidate answer for the crystal-frequency open question, an
   RS-422/485 line receiver that corroborates the multi-drop serial protocol,
   silkscreened functional section names, two unpopulated `OPTION` ROM
   sockets). None of this has been traced with a meter against the schematic
   - it's corroborating context, not verified fact.
4. **`disasm/nt3321-22.json` cleanup.** The hints file's `entries`/`extraCode`
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
