# Working in this repo

Navtec Loran-C receiver firmware (Intel 8085) - full disassembly analysis,
an 8085 emulator with a web front end, and operator-facing design docs.
**Read [CONTEXT.md](CONTEXT.md) first** - it's the current-state snapshot
kept up to date across sessions specifically so this file doesn't have to
be. This file is the stable operating rules; CONTEXT.md is what changed
most recently and what's next.

## Standing authorization

The user has given ongoing authorization to commit and push directly to
`main` for this project's normal work (documentation, disassembly hints,
emulator code) without asking each time - this has been the pattern for
every session so far. Still use judgment on genuinely destructive or
unusual operations (force-push, history rewriting, deleting tracked
files) - ask first for those, same as anywhere else.

## The one rule that matters most

**Never commit a change to `disasm/nt3321-22.json` without re-verifying
the rebuild.** The full workflow is in
[CONTRIBUTING.md](CONTRIBUTING.md#the-core-loop-editing-disasmnt3321-22json);
short version:

```sh
node -e "JSON.parse(require('fs').readFileSync('disasm/nt3321-22.json','utf8'))"   # valid JSON
node tools/dis8085.js disasm/nt3321-22.json                                        # regenerate
sh tools/rebuild.sh                                                                # must print "differences vs originals: 0"
```

Also check for duplicate JSON keys after editing (JSON.parse silently
keeps the last one) - see CONTRIBUTING.md for the exact script. This has
been the single most common mistake across this project's history.

If you touch `src/emu/`, run `npm test` before and after.

## Where things are

- `disasm/nt3321-22.json` - the single source of truth for the
  disassembly. Everything under `disasm/*.lst`/`.asm`/`-refs.md` is
  generated from it - never hand-edit those.
- `docs/glossary.md` - domain terms (GRI, TD, master/secondary, etc.) and
  this project's own naming conventions (`SUB_`/`X_`/`M_`/`L_`/`D_`/`VAR_`
  prefixes, confidence markers). Read this before renaming anything.
- `docs/loran-c-primer.md` - conceptual grounding in Loran-C navigation
  itself, if you need it.
- `CONTRIBUTING.md` - the actual edit/verify/sweep workflow.
- `docs/PROGRESS.md` - **Open items** (current TODO) at the top, then a
  dated **Change history** changelog. Add a new entry here for any
  substantive piece of work; update Open items if it changes.
- `src/emu/` - the 8085 emulator (`emu8085.js`), web front end
  (`web-emu.js` + `web/`), PAL/CUPL decoder (`pal.js`, `addr-decode.js`),
  Loran-C position math (`loran-chains.js`), and tests (`test/`). See
  `docs/emulator-api.md` for the programmatic surface.
- `pal/*.pld` - generated CUPL source; see `docs/pal-decoder.md` and
  `docs/pal-programming-guide.md`.
- `docs/playbooks/` - screenshotted web-UI walkthroughs, regenerable via
  `node src/emu/playbooks/capture.js`.

## Naming discipline (full version in CONTRIBUTING.md)

Only rename something once you've read the actual code around it and can
cite specific addresses. A name should claim exactly as much as the
evidence supports - if the mechanism is clear but the purpose isn't, name
it for the mechanism and say so. Some placeholders (`VAR_6FCB`,
`VAR_6FD9`, `D_1004`) are deliberately left un-renamed; don't "finish" them
without new evidence. Don't rename `L_xxxx` local branch labels inside
already-understood routines just to make the count look better - see
`docs/glossary.md`.

## Doc consistency

When you rename something, sweep for stale references
(`grep -rln "OLD_NAME" docs/*.md README.md`) and fix live docs, but leave
historical records (`docs/PROGRESS.md`'s dated entries,
`docs/rom-status.md`'s pre-recovery guess table) using the names in effect
at the time - see `docs/glossary.md`'s "(was X_xxxx)" convention.

## At the end of a substantial session

Update [CONTEXT.md](CONTEXT.md) with what changed and what's next, and add
a `docs/PROGRESS.md` changelog entry for anything substantive. Both are
what let a future session (here or elsewhere) resume without replaying
this conversation.
