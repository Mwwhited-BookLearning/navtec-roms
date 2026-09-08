# Glossary and naming conventions

Two things in one page, since they're both "vocabulary you need before the
other docs make sense": Loran-C domain terms, and this project's own
naming/confidence conventions. Skim once, then use as a lookup reference.

## Loran-C domain terms

See [loran-c-primer.md](loran-c-primer.md) for the full explanations these
summarize.

| Term | Meaning |
|---|---|
| **Loran-C** | Long Range Navigation, generation C - a hyperbolic radio navigation system using fixed land transmitters |
| **Chain** | One master + 2-5 secondary stations sharing a GRI |
| **GRI** | Group Repetition Interval - the chain's pulse-repetition rate, in tens of microseconds (e.g. `9940` = 99,400 us); also how a receiver identifies which chain it's tuned to |
| **Master** | The chain's timing reference station; transmits first each GRI |
| **Secondary** | A chain's other stations (conventionally `W`/`X`/`Y`/`Z`), each transmitting after its own fixed coding delay |
| **Phase code** | The GRI-A/GRI-B pulse-polarity pattern that identifies master vs. secondary and enables coherent integration |
| **TD (Time Difference)** | Measured arrival-time difference between a secondary and the master, in microseconds, including that secondary's coding delay |
| **Coding delay** | A fixed per-secondary transmission delay, published per chain, that keeps pulse groups from overlapping and is baked into every TD reading |
| **LOP (Line of Position)** | The hyperbola of all points sharing one TD value, foci at the master and that secondary |
| **Fix** | The intersection of two LOPs - an actual position |
| **ASF (Additional Secondary Factor)** | A published correction for the seawater-vs-land propagation speed difference; not applied anywhere found in this firmware |
| **Envelope/cycle** | The two levels of timing a real receiver locks onto (coarse envelope timing, then fine RF-cycle timing) - not separately modeled in this reconstruction; this firmware's "sample"/"phase code" abstraction sits above that detail |

## This project's confidence markers

Used throughout `docs/*.md` and `disasm/nt3321-22.json`'s comments to say
*how sure* a claim is, not just what it is:

| Marker | Meaning |
|---|---|
| **H** (ram-map.md) / **(confirmed)** (user-flows.md, others) | Directly evidenced by traced code - every call site checked, not just plausible |
| **M** / **(inferred)** | A consistent, reasonable reading of the code, but not independently verified from multiple angles |
| **L** / placeholder name | A real, confirmed variable or address whose *purpose* isn't confidently known - see "Placeholder names," below |
| **(open)** / **(guess)** | A genuine gap - the code doesn't say, and only the physical board (or further analysis) could settle it |

## Auto-generated placeholder name prefixes

`tools/dis8085.js` fills in a positional name for anything not given a real
one in `disasm/nt3321-22.json`. Recognizing these tells you at a glance
whether something has been looked at yet:

| Prefix | Means | Current count |
|---|---|---|
| `SUB_xxxx` | An unnamed `CALL` target | 0 (eliminated - the "every routine named" milestone) |
| `X_xxxx` | A jump/call target outside the loaded ROM image | 0 (both ROM halves are fully recovered, so this can no longer occur) |
| `M_xxxx` | An unnamed RAM/IO variable (memory operand at an address *not* present in the ROM) | 0 (eliminated - the "every variable named" milestone) |
| `L_xxxx` | A jump/branch target that's never `CALL`ed - i.e. a purely local label within a routine | ~134 - **not** part of either milestone; see below |
| `D_xxxx` | An `LXI`-loaded address that happens to fall *inside* the ROM image (so it looks like a data reference) | 1 (`D_1004` - flagged as likely incidental, not confirmed real data) |
| `VAR_xxxx` | This project's own placeholder: a confirmed real RAM variable that's been examined but not confidently named | 2 (`VAR_6FCB`, `VAR_6FD9` - both write-only, never read back anywhere) |

**Why `L_xxxx` isn't a gap to close:** these are the "loop:"/"else:"/
"done:" structural labels every assembly listing has, inside routines that
already have real names and comments. A handful *were* worth naming - the
ones sitting inside the ROM's one still-under-analyzed cluster (the
extended-precision BCD math around `1E9B-1F20`) got real names once that
cluster was traced. The other ~134 don't need individual names any more
than a `for` loop's closing brace needs a comment - the owning routine's
documentation already explains them. See `docs/PROGRESS.md`'s Update 7/8
for the reasoning and the specific ones that did get named.

**Why 3 addresses are still placeholder-named on purpose:** `VAR_6FCB`,
`VAR_6FD9`, and `D_1004` were each individually investigated and left
alone because the evidence only supports "real, but purpose unconfirmed" -
inventing a purpose-sounding name would overclaim. See `docs/PROGRESS.md`'s
Update 6/7 for what was actually found (write-only, no consumer; or a
likely incidental byte pattern).

## Historical-reference convention: `(was X_xxxx)`

When a routine or variable gets renamed, old docs and even *live* doc
prose sometimes need to refer to its previous name - e.g. to explain a
correction ("the old guess was wrong") or to preserve a historical
decision log. The convention:

- `"NEW_NAME (was OLD_NAME)"` inline in prose is always fine, anywhere -
  it's explicitly marking history, not asserting the old name is current.
- `docs/PROGRESS.md`'s dated changelog entries and `docs/rom-status.md`'s
  pre-recovery guess table are allowed to use old names throughout,
  un-annotated, because they're describing *what was true at that time* -
  treat both as historical records, not current references.
- Anywhere else, a bare old name with no `(was ...)` marker and no
  historical framing is a bug - it means a rename happened and a doc
  wasn't updated. This project runs a periodic sweep for exactly this
  (grep every doc for the `X_`/`SUB_`/`M_`/`OLD_` + hex pattern, inspect
  each hit, fix genuine staleness) - see `docs/PROGRESS.md`'s changelog
  for when these sweeps happened.

## JSON hints file structure (`disasm/nt3321-22.json`)

The single source of truth for the disassembly. Quick field reference (see
[CONTRIBUTING.md](../CONTRIBUTING.md) for the actual edit workflow):

| Field | Purpose |
|---|---|
| `images` | which `.BIN` files load at which addresses |
| `entries` | code entry points to start flow-tracing from |
| `extraCode` | additional forced entry points (rarely needed now that flow analysis reaches nearly everything) |
| `labels` | names for addresses *present in the ROM* - routines, jump targets, in-ROM data |
| `equates` | names for addresses *not present in the ROM* - RAM, I/O, and coincidental constants outside the ROM's range |
| `data` | forced-data region overrides (bytes that are data, not code, even though they're reachable) |
| `comments` | single-line comments keyed by address |
| `blockComments` | multi-line prose blocks keyed by address, for routine/cluster-level explanations |
| `opConst` | addresses whose operand is a plain number, not a memory reference - suppresses auto-labeling for that one occurrence |
| `jumpTables` | known jump/dispatch tables |

## Other abbreviations used throughout

| Abbreviation | Meaning |
|---|---|
| BCD | Binary-Coded Decimal (this ROM uses *packed* BCD - two digits per byte) throughout for TD/time values |
| ISR | Interrupt Service Routine |
| RST | The 8085's restart instructions/interrupt inputs (`RST 5.5`/`6.5`/`7.5`) |
| PIO | Programmable I/O - this project's shorthand for the two 8155 RAM/IO/timer chips |
| CS | Chip Select (hardware) - also, confusingly, "Coast Guard Station" in Loran-C literature generally, not used that way here |
| PAL / CUPL | Programmable Array Logic / Compiler for Universal Programmable Logic - see [pal-decoder.md](pal-decoder.md) |
| JEDEC | The standard fuse-map file format a PAL programmer consumes, produced by compiling CUPL source |
