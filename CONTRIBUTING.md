# Contributing / methodology

The actual workflow this project follows for every change to the
disassembly, written down so a human contributor (or a future session
without this conversation's context) doesn't have to reconstruct it from
git history. See [docs/glossary.md](docs/glossary.md) for terminology this
assumes, and [docs/PROGRESS.md](docs/PROGRESS.md) for what's already done
vs. still open.

## The core loop: editing `disasm/nt3321-22.json`

This file is the single source of truth (see
[docs/glossary.md](docs/glossary.md#json-hints-file-structure-disasmnt3321-22json)
for its structure). Every one of its fields is hand-edited; nothing else
under `disasm/` is - `.lst`/`.asm`/`-refs.md` are generated output.

For every edit, in this order:

1. **Validate JSON syntax.**
   ```sh
   node -e "JSON.parse(require('fs').readFileSync('disasm/nt3321-22.json','utf8')); console.log('valid JSON')"
   ```
2. **Check for duplicate keys.** JSON.parse silently keeps the *last*
   value when a key repeats - the single most common mistake in this
   project's history is adding a new `labels`/`equates` entry for an
   address that already had a different one somewhere else in the file,
   and not noticing the old one got silently overridden (or is still
   winning).
   ```sh
   node -e "
   const cfg = JSON.parse(require('fs').readFileSync('disasm/nt3321-22.json','utf8'));
   for (const section of ['labels','equates']) {
     const seen = {};
     for (const k of Object.keys(cfg[section])) seen[k] = (seen[k]||0)+1;
     for (const [k,c] of Object.entries(seen)) if (c>1) console.log('DUP', section, k, c);
   }
   console.log('dup check done');
   "
   ```
3. **Regenerate.**
   ```sh
   node tools/dis8085.js disasm/nt3321-22.json
   ```
4. **Rebuild-verify.** This is non-negotiable - it's the only thing that
   actually proves a hints-file change didn't alter the assembled bytes.
   ```sh
   sh tools/rebuild.sh
   ```
   Must print `differences vs originals: 0`. If it doesn't, something
   about the edit changed how a byte assembles (wrong operand size, a
   label colliding with a reserved mnemonic, etc.) - fix it before doing
   anything else, including committing.

Do this after **every** substantive edit, not just at the end of a
session - catching a mistake immediately, with only one change to
suspect, is far cheaper than finding it after ten more edits have piled
on top.

## Naming discipline

- **Only rename something once you've actually read the code around it.**
  Every rename in this project's history cites specific addresses and
  instruction sequences, not just "this seems like it should be called
  X." If you can't point at the exact bytes that justify a name, it's not
  ready to be named yet - leave the placeholder.
- **A name should claim exactly as much as the evidence supports, no
  more.** If a routine's *mechanism* is clear but its *purpose* isn't
  (e.g. `SHR4_ROUND`, `BCD_COMPL_ADD_DEHL` - named for what they compute,
  not for a guessed role in a larger, unconfirmed algorithm), name it for
  the mechanism and say so in the comment. Don't invent a purpose-sounding
  name to make a routine feel more finished than it is.
- **Some placeholders should stay placeholders.** `VAR_6FCB`/`VAR_6FD9`
  (write-only, never read anywhere) and `D_1004` (likely an incidental
  byte pattern) were each individually investigated and deliberately left
  un-renamed - see `docs/PROGRESS.md`'s Update 6/7. A confident-sounding
  name for something you don't actually understand is worse than an
  honest placeholder.
- **Not everything needs a unique name.** `L_xxxx` local branch labels
  inside an already-well-understood, already-named routine don't need
  individual semantic names any more than a loop's closing brace does -
  see `docs/glossary.md`'s note on this. Only rename these when the
  *routine itself* is still under-analyzed and giving its internal
  control flow real names is part of actually understanding it (see
  Update 8's BCD-cluster pass for an example of when this was worth
  doing).
- **Preserve history, don't erase it.** When you rename something, prose
  elsewhere that already explained the old guess should usually become
  `"NEW_NAME (was OLD_NAME)"` plus a note on what was wrong about the old
  reading - not a silent replacement. See
  [docs/glossary.md](docs/glossary.md#historical-reference-convention-was-x_xxxx)
  for exactly when old names should and shouldn't survive in prose.

## Sweeping for stale references

Whenever a rename lands, other docs that mentioned the old name need
checking. This project's sweep pattern:

```sh
grep -rln "OLD_NAME" docs/*.md README.md 2>/dev/null
```

Then, for each hit, decide: is this a **live reference** (needs fixing to
the new name) or a **historical record** (a dated `PROGRESS.md` changelog
entry, or `rom-status.md`'s pre-recovery guess table - both explicitly
allowed to use names "in effect at the time")? Fixing a historical
record's names would make it *less* accurate, not more - it would erase
the actual history of what was believed and when. See
`docs/PROGRESS.md`'s several changelog entries for worked examples of
this distinction in practice, including one case (Update 6) where a
historical entry's *cross-reference* (not its name) had gone stale and
got a pointer-forward note added rather than being rewritten.

A periodic broader sweep is also worth running across the whole project
(not just addresses touched by the current change):

```sh
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir, out) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir,f); const st = fs.statSync(p); if (st.isDirectory()) walk(p, out); else if (f.endsWith('.md')) out.push(p); } }
const files = []; walk('docs', files); files.push('README.md');
const pat = /\b(X_|SUB_|M_|OLD_)[0-9A-F]{4}\b/g;
for (const f of files) { const text = fs.readFileSync(f,'utf8'); const lines = text.split('\n');
  lines.forEach((line,i) => { let m; pat.lastIndex=0; while ((m = pat.exec(line))) console.log(f+':'+(i+1)+': '+m[0]); });
}
"
```

Every hit needs a human judgment call (historical vs. stale) - this
finds candidates, it doesn't auto-fix anything.

## Checking every doc link still resolves

Cheap, worth running after any file move/rename:

```sh
node -e "
const fs = require('fs'); const path = require('path');
function walk(dir, out) { for (const f of fs.readdirSync(dir)) { const p = path.join(dir,f); const st = fs.statSync(p); if (st.isDirectory()) walk(p, out); else if (f.endsWith('.md')) out.push(p); } }
const files = []; walk('docs', files); files.push('README.md');
let bad = 0;
for (const f of files) { const text = fs.readFileSync(f,'utf8'); const dir = path.dirname(f);
  const re = /\]\(([^)]+)\)/g; let m;
  while ((m = re.exec(text))) { let t = m[1]; if (/^https?:\/\//.test(t)) continue; t = t.split('#')[0]; if (!t) continue;
    if (!fs.existsSync(path.resolve(dir,t))) { console.log(f+' -> broken link: '+t); bad++; } } }
console.log(bad+' broken links found');
"
```

## The emulator

`src/emu/` has its own test suite - run it before and after touching
anything under `src/emu/`:

```sh
npm test
```

If you change CPU/peripheral/decoder behavior, also re-check the
integration boot test's golden-state assertions in
`src/emu/test/boot.test.js` - a legitimate behavior change may need those
exact expected values updated (with a comment explaining why), while an
*unexpected* change failing that test is exactly the regression it's
there to catch. See [docs/emulator.md](docs/emulator.md#automated-tests).

If you touch the web front end, re-run the Playwright capture script to
refresh `docs/playbooks/`'s screenshots if the UI changed visibly:

```sh
node src/emu/playbooks/capture.js
```

## Updating `docs/PROGRESS.md`

It's structured as **Open items** (current TODO, kept at the top) plus a
**Change history** (dated log, newest first, old entries keep the names in
effect *at the time*). When you finish a substantive piece of work:

1. Add a new dated `### Update N` entry at the top of Change history,
   above the previous newest entry - not appended at the bottom.
2. Update **Open items** if the work closes or changes the status of
   anything listed there.
3. Don't rewrite older Change history entries' *names* to match current
   ones (see "Sweeping for stale references" above) - only fix an older
   entry if it makes a *factual claim* (not just a name) that's now known
   to be wrong, and even then prefer an addendum note over rewriting.

## Commit messages

This project's commits are deliberately detailed - they're often the only
record of *why* a change was made, not just what changed (git log serves
as a secondary history alongside `docs/PROGRESS.md`'s changelog). Explain
the reasoning and evidence, not just "renamed X to Y."
