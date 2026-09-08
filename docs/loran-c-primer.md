# Loran-C primer

A short conceptual grounding in Loran-C navigation itself, written for a
reader who knows 8085 assembly but not necessarily radio navigation. Every
other doc in this project assumes this background; this is where it comes
from. For how this specific receiver implements each concept, follow the
links inline - this page stays conceptual.

## What Loran-C is

**Lo**ng **Ra**nge **N**avigation, generation **C**: a terrestrial (not
satellite) hyperbolic radio navigation system, operated from the 1950s
through the 2010s (largely superseded by GPS, though some chains stayed
active into the 2020s as a backup). A **chain** of fixed land-based
transmitters - one **master** and 2-5 **secondaries** - broadcasts
precisely-timed pulse groups on a shared frequency (100 kHz). A receiver
measures the *arrival-time difference* between the master's signal and
each secondary's, and each such difference defines a curve of possible
positions. Two differences (from two different secondaries) intersect at
your actual position.

## The pieces

**GRI (Group Repetition Interval).** Every chain has its own repetition
rate, in tens of microseconds, given as a 4-5 digit number like `9940`
(meaning 99,400 microseconds between pulse groups) - this is literally the
number this receiver's operator dials on the GRI thumbwheels
([front-panel.md](front-panel.md)). All stations in one chain share this
GRI; a receiver identifies which chain it's listening to by which GRI it's
tuned for. `firmware.md`'s validation rule (first digit 4-9, i.e.
4000-9999) matches the real-world range of assigned Loran-C GRIs.

**Master and secondaries.** The master transmits first each cycle; each
secondary transmits after a fixed, published delay (its **coding delay**)
long enough that groups never overlap regardless of chain geometry. A
chain's secondaries are conventionally labeled `W`, `X`, `Y`, `Z` (in
transmission order) - see `src/emu/loran-chains.js`'s built-in chain 9940
data for a real example (Seneca NY master; Caribou ME/Nantucket MA/
Carolina Beach NC/Dana IN secondaries).

**Phase codes.** Within each GRI, stations alternate between two
sub-patterns per pulse group, called GRI-A and GRI-B, using specific
+/- pulse-polarity sequences unique to master vs. secondary. This lets a
receiver (a) tell a master's signal from a secondary's by pattern alone,
and (b) integrate multiple pulse groups coherently to pull a weak signal
out of noise. This firmware's phase-code constants (`0xCA`/`0x9F` for
master, `0xF9`/`0xAC` for secondaries) and its GRI-A/GRI-B alternator
(`PHASE_AB_SELECT`) are exactly this mechanism - see
[firmware.md](firmware.md)'s "Main program phases".

**TD (Time Difference).** The actual measurement: how much later a
secondary's pulse group arrives than the master's, in microseconds,
*including* that secondary's published coding delay (so real TDs are
large positive numbers - tens of thousands of microseconds - not the tiny
true propagation-difference the geometry alone would produce; see
[web-emulator.md](web-emulator.md#position-map-illustrative-only) for why
this matters to this project specifically). A receiver reports TDs to five
digits plus a tenth, exactly the six-BCD-digit format
[front-panel.md](front-panel.md)'s display layout uses.

**Line of position (LOP).** For a fixed master/secondary pair, every point
with the same TD lies on one branch of a hyperbola with foci at the two
stations - this is the textbook definition of a hyperbola (constant
difference of distances to two fixed points), which is exactly why the
system is called *hyperbolic* navigation. One TD alone only narrows your
position to a curve, not a point.

**Fix.** Two LOPs (from two different secondaries, or a secondary pair
independent of the master) intersect at (at most) one practical point:
your position. This is why the front panel has *two* readout rows
(`SEL_A`/`SEL_B`) - the operator picks two secondaries, the receiver
tracks TD-A and TD-B simultaneously, and a chart or computer downstream
(not this firmware) would combine them into a fix the way
[web-emulator.md](web-emulator.md)'s illustrative position map does.

**ASF (Additional Secondary Factor).** Real Loran-C signals travel faster
over seawater than over land, and the published station coordinates alone
don't capture that - a real chart-accurate receiver applies a published,
region-specific correction on top of raw TD. Nothing in this firmware
appears to apply ASF corrections (no per-region correction table has been
found in the ROM); this receiver reports raw TDs and leaves any further
correction to whatever consumes its serial output.

## How this maps onto the firmware

| Concept | Firmware mechanism | Doc |
|---|---|---|
| Tune to a chain | GRI thumbwheels, validated 4-9 first digit | front-panel.md |
| Identify master vs. secondary | Phase-code correlation (`MATCH_PULSES`, `SEARCH_LOOP`) | firmware.md |
| Acquire/lock a station | `ACQ_START` -> `SEARCH_LOOP` -> `SEARCH_VERIFY` -> `MASTER_FOUND` -> `SETTLE_LOOP` -> `TRACK_LOOP` | firmware.md, user-flows.md Flow B |
| Track multiple secondaries | Per-slot state machine, `SLOT_COUNT` slots derived from the GRI | firmware.md "Per-slot data" |
| Report TD | Packed-BCD `CUR_TOA`/station records, six-digit display, serial report | ram-map.md, serial-protocol.md |
| Pick which two stations to view | `SEL_A`/`SEL_B` thumbwheels | front-panel.md, user-flows.md Flow C |
| Turn two TDs into a position | Not done by this firmware - left to a downstream chart/computer; the emulator's position map illustrates the technique | web-emulator.md |

## Further reading

This page is deliberately short. For the real history, chain lists, and
the full hyperbolic-fix mathematics (including ASF tables this project
doesn't implement), the U.S. Coast Guard's Loran-C User Handbook is the
standard public reference - not reproduced here since this project's scope
is the *receiver*, not the navigation system in general.
