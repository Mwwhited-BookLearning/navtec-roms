# Context snapshot

**Last updated:** 2026-09-07. This file is a living snapshot, overwritten
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

- **Disassembly: complete.** 0 of 137 routines and 0 of 175 variables
  remain generically named. 3 addresses (`VAR_6FCB`, `VAR_6FD9`, `D_1004`)
  are deliberately still placeholder-named - each individually
  investigated and left alone because the evidence doesn't support a
  confident name (see `docs/glossary.md`). Rebuild verified at 0
  differences over 8192 bytes as of the last commit.
- **Emulator: working.** `src/emu/emu8085.js` boots both real ROM images
  through `INIT`/self-test/`READ_SWITCHES` and, with a valid switch panel,
  into the real background tracking loop. 106/106 tests passing
  (`npm test`). Has not been driven to `MASTER_FOUND` - the synthetic
  receiver front end's bit protocol isn't verified against
  `SHIFT_IN16`/`MATCH_PULSES` (see Open item 2 below).
- **Web front end: working.** `src/emu/web-emu.js` + `src/emu/web/` -
  front panel, display, blinkenlights, serial console, and an illustrative
  (not real) Loran-C position-fix map. Six playbooks with screenshots in
  `docs/playbooks/`, regenerable via `node src/emu/playbooks/capture.js`.
- **PAL/CUPL decoder:** `src/emu/pal.js`/`addr-decode.js` model the
  board's device-mapping logic as an emulated PAL16R8/20R10, with
  generated CUPL source in `pal/*.pld`. Not compiled/burned to a real chip
  - see `docs/pal-programming-guide.md` if that's ever done.
- **Documentation:** 19 docs (see README.md's table) covering hardware,
  firmware, protocol, front panel, the emulator, and now (as of this
  session) a Loran-C primer, a glossary/naming-conventions reference, a
  CONTRIBUTING methodology doc, and an emulator API reference.

## Open items (canonical list: `docs/PROGRESS.md`)

Don't duplicate the list here - it drifts. As of this writing there are 4,
none urgent: physical-board verification (needs the real board + a
meter), receiver front-end bit-protocol verification (needs
`SHIFT_IN16`/`MATCH_PULSES` re-traced), optional `disasm/nt3321-22.json`
`entries`/`extraCode` cleanup, and a few open UX questions from
`docs/user-flows.md`. Check `docs/PROGRESS.md`'s "Open items" section for
the current, authoritative version.

## Most recent session's work (2026-09-07)

In order: captured the user's physical-board data (crystal, chip
designators) into `hardware.md`; built the PAL/CUPL decoder; built the
8085 emulator; built the web front end (front panel, display,
blinkenlights, serial console) and fixed a real bug enabling runtime
switch changes; added the illustrative Loran-C position map; captured six
screenshotted playbooks; wrote the `user-flows.md` operator design
document; added a `npm test` unit/integration suite (106 tests); traced
and renamed 9 of 11 `VAR_xxxx` placeholder variables (resolving a
previously-open "unreconciled dual use" ambiguity in `TICK_CLOCK_CASCADE`
along the way); named 9 of 10 `D_xxxx` auto-generated labels and 10
`L_xxxx` labels in the one remaining low-confidence cluster; restructured
`docs/PROGRESS.md` into Open-items-first-then-changelog; and added
`docs/loran-c-primer.md`, `docs/glossary.md`, `CONTRIBUTING.md`,
`docs/pal-programming-guide.md`, `docs/emulator-api.md`, and this
file plus `CLAUDE.md`.

## Quick health check

```sh
sh tools/rebuild.sh   # must print "differences vs originals: 0"
npm test              # must print 106+ passing, 0 failing
```

If either fails, something regressed since this snapshot was written -
trust the failing command over this file.
