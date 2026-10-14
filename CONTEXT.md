# Context snapshot

**Last updated:** 2026-10-14. This file is a living snapshot, overwritten
each session - it's the "what's true right now" complement to
[docs/PROGRESS.md](docs/PROGRESS.md)'s permanent dated changelog. Read
[CLAUDE.md](CLAUDE.md) alongside this for the operating rules.

## What this project is

Full disassembly and analysis of a Navtec Loran-C receiver's Intel 8085
firmware (two 8332 masked ROMs), plus a from-scratch 8085 emulator with a
web front end, built on top of that analysis. See
[docs/loran-c-primer.md](docs/loran-c-primer.md) if the domain (Loran-C
navigation) is unfamiliar, and [README.md](README.md) for the full doc
index.

## Current state

- **Pre-hardware prep done (2026-10-14):** boot sequence
  (`docs/boot-sequence.md`), front-end sensitivity sweep, results sheet
  (`docs/board-trace-results.md`), blink bring-up ROM
  (`tools/make-blink-rom.js`). Open question: CLK is 5 MHz or 2.5 MHz
  (Open item 1b).
- **Datasheets:** `docs/datasheets/` holds own-words recreations of the
  8085, 8155, 8205, 8212, 8251A, 8279 and AM26LS32 datasheets. Pin numbers
  are verified against Intel/TI documents (see `docs/peripheral-pinouts.md`);
  8251A pp.18-25 are unread. Board work is gated on the user powering the
  bare board - see `docs/board-trace-plan.md`.

- **Disassembly: complete.** 0 of 137 routines and 0 of 175 variables
  remain generically named. 3 addresses (`VAR_6FCB`, `VAR_6FD9`, `D_1004`)
  are deliberately still placeholder-named - each individually
  investigated and left alone because the evidence doesn't support a
  confident name (see `docs/glossary.md`). Rebuild verified at 0
  differences over 8192 bytes as of the last commit.
- **Emulator: working.** `src/emu/emu8085.js` boots both real ROM images
  through `INIT`/self-test/`READ_SWITCHES` and, with a valid switch panel,
  into the real background tracking loop. 112/112 tests passing
  (`npm test`). **Now reaches `MASTER_FOUND` and `TRACK_LOOP`** against the
  rebuilt synthetic front end (a model; assumptions listed in
  `docs/emulator.md` limitation 5). Locked-state behaviour (moving TD,
  secondary mode, dropout) is untested.
- **Web front end: working.** `src/emu/web-emu.js` + `src/emu/web/` -
  front panel, display, blinkenlights, serial console, and an illustrative
  (not real) Loran-C position-fix map. Six playbooks with screenshots in
  `docs/playbooks/`, regenerable via `node src/emu/playbooks/capture.js`.
- **PAL/CUPL decoder:** `src/emu/pal.js`/`addr-decode.js` model the
  board's device-mapping logic as an emulated PAL16R8/20R10, with
  generated CUPL source in `pal/*.pld`. Not compiled/burned to a real chip
  - see `docs/pal-programming-guide.md` if that's ever done.
- **Documentation:** 22 docs (see README.md's table) covering hardware,
  firmware, protocol, front panel, the emulator, and now (as of this
  session) a Loran-C primer, a glossary/naming-conventions reference, a
  CONTRIBUTING methodology doc, and an emulator API reference.

## Open items (canonical list: `docs/PROGRESS.md`)

Don't duplicate the list here - it drifts. As of this writing there are 6,
none urgent: physical-board verification and the CLK-frequency check
(need the real board + a meter), front-end model verification/untested lock
paths, optional `disasm/nt3321-22.json` `entries`/`extraCode` cleanup,
datasheet gaps, and a few open UX questions from `docs/user-flows.md`. Check `docs/PROGRESS.md`'s "Open items" section for
the current, authoritative version.

## History

Per-session detail lives in `docs/PROGRESS.md`'s dated changelog; don't
duplicate it here.

## Quick health check

```sh
sh tools/rebuild.sh   # must print "differences vs originals: 0"
npm test              # must print 112+ passing, 0 failing
```

If either fails, something regressed since this snapshot was written -
trust the failing command over this file.
