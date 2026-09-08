# Web front end (`src/emu/web-emu.js`)

A browser UI for the emulator ([docs/emulator.md](emulator.md)): front-panel
switches you can actually turn while the machine runs, a 7-segment display,
a small blinkenlights panel, a serial console, and controls for the
synthetic Loran-C receiver front end. Same standing caveat as everything
else in this reconstruction: **never checked against a real board.**

## Running it

```sh
node src/emu/web-emu.js
```

Then open `http://localhost:8085/`. `--port N` picks a different port. No
external dependencies - plain Node `http`, served from `src/emu/web/index.html`.

The emulator starts already booted with a valid switch panel (selector
A=1, B=2, GRI 9940 - the same combination `docs/emulator.md` uses to reach
the tracking loop), running continuously in the background paced to
roughly the assumed 5 MHz CPU clock (see hardware.md's crystal
discussion). The page polls `/api/state` at 10 Hz and never blocks the
emulator loop - closing the browser tab doesn't stop it.

## What's on the page

- **Machine control**: run/pause/reset, a speed multiplier (0.1x-10x of
  the assumed 5 MHz), and a status line (PC with its symbol name from
  `disasm/nt3321-22.json`, SP, A, flags, cycle count).
- **Display**: decodes the 8279's display RAM exactly per
  [front-panel.md](front-panel.md)'s table - `rowA[i]` is the high nibble
  of `displayRAM[i]`, `rowB[i]` the low nibble, for `i` 0-5 (TD-A and TD-B,
  six digits each), plus the two nibbles of byte 6 ("extra" - front-panel.md
  says its meaning isn't known). Rendered as real 7-segment digits (CSS
  divs, not a font) so a raw nibble of `0xA`-`0xF` still shows *something*
  recognizable rather than nothing.
- **Blinkenlights**: seven indicators, each tied to a specific, named
  internal signal - no decorative fakes:
  - `IE` / `HLT` - the CPU's own interrupt-enable and halt state.
  - `BUSY` - 8155 #1 port C bit 0, hardware.md's "busy indicator /
    watchdog strobe" (set when the CPU starts work, cleared in the idle loop).
  - `SAMPLE` - the synthetic receiver's RST 6.5 strobe.
  - `TICK` - 8155 #1's timer output, hardware.md's *guessed* RST 7.5 source.
  - `TX` - a byte was sent out the emulated 8251A.
  - `KDC IRQ` - the 8279's IRQ output, wired to RST 5.5 per hardware.md's
    diagram. This is what makes turning a switch while running actually
    get noticed (see "Runtime switch changes" below) - previously (CLI-only
    version) switches were only ever read once, at cold boot.
  Fast, frequent signals (like `SAMPLE`, hundreds of times a second) will
  look essentially solid at a 10 Hz poll rate rather than visibly
  blinking; that's expected, not a bug - it's roughly how a real LED on a
  kHz-rate signal would look to the eye too.
- **Front panel**: six thumbwheel widgets (`SEL A`, `SEL B`, `GRI 1..4`)
  with +/- steppers cycling `0`-`9` then `blank`, matching the sensor-matrix
  encoding in front-panel.md (`SW_TO_DIGIT`'s 9's-complement code, blank =
  `0BH`), and two momentary push buttons. **Button semantics are
  unconfirmed** - front-panel.md's own "Not yet known" section says so; the
  UI just exposes the two matrix bits (row 6/7, bits 7 and 6) as "BTN A" /
  "BTN B" without claiming what they do.
- **Serial console**: shows everything the emulated 8251A has transmitted,
  a text box to send characters (mapped straight through `injectRx`), and
  quick-send buttons for the control characters serial-protocol.md
  documents (`ESC`, `DC2`, `DC4`, `ENQ`, `BEL`, `CR`) since typing raw
  control characters in a browser text box is awkward otherwise.
- **Receiver panel**: switch the synthetic front end between the master
  and secondary Loran-C phase codes, add bit-flip noise (0-100%, applied
  per shifted-out bit - see `ReceiverFrontEnd.applyNoise` in
  `src/emu/emu8085.js`) to exercise `QUAL_CHECK`'s rejection logic, and a
  running sample counter.

## Runtime switch changes now actually work

The CLI-only emulator (`node src/emu/emu8085.js --switches ...`) only ever
applied switch settings once, at process start, because nothing in the
emulator connected the 8279's IRQ output to the CPU's RST 5.5 pending
flag - `READ_SWITCHES` runs once at cold boot and the runtime
re-scan path (front-panel.md's "Run-time switch handling" diagram) never
triggers. Making the web UI's thumbwheels and buttons actually do
something at runtime required fixing that: `Bus.tick()` now continuously
syncs `cpu.I55` from the 8279's live `irqPending` state (RST 5.5 is
level-sensitive from an external pin, not something the CPU latches on
its own), and the web server calls `bus.kdc.raiseIrq()` whenever a switch
or button changes. That's a real emulator-correctness fix, not just a web
UI feature - see the updated "What's been checked" note in
[emulator.md](emulator.md).

## Position map (illustrative only)

A schematic map (plain `<canvas>`, no external map/tile service) showing
where the currently-displayed TD-A/TD-B readout would place a fix, using
real historical Loran-C chain geometry (built into
`src/emu/loran-chains.js`). **This is a demonstration of the hyperbolic
line-of-position technique, not a real position fix** - see the full
walkthrough in [playbooks/loran-position-fix.md](playbooks/loran-position-fix.md)
for why, in detail. Short version:

- The station coordinates (chain `9940`, "Northeast US") are real, from
  general public historical references - not independently re-verified in
  this project, but not invented either.
- The math (two-foci hyperbola per station pair, Newton-Raphson
  intersection) is the real, standard Loran-C hyperbolic-fix technique.
- The TD values feeding it come from a synthetic receiver front end that
  doesn't simulate real signal propagation (see "Known simplifications" in
  [emulator.md](emulator.md)), and no per-secondary coding delay is applied
  (none is known here) - so there is no physical reason to expect the
  computed fix to be anywhere near a real position. The raw TD is instead
  folded (via modulo) into the geometrically valid range for each station
  pair, purely so a fix can usually still be drawn.

Because the emulator hasn't been verified to reach a real signal lock (see
above), the live display usually won't produce two valid TD digit-groups
for this panel to use - when that's the case, it says so ("display not
showing valid BCD digits yet") rather than drawing a fix from garbage
digits. A manual TD-A/TD-B entry field lets you explore the fix math
directly regardless, bypassing the display entirely.

`GRI 1..4` (as currently dialed) selects the chain by number; `SEL A`/
`SEL B` (as currently dialed, "digit + 1" per front-panel.md) select which
of the chain's secondaries each TD is measured against. Only chain `9940`
has built-in geometry right now - dialing a different GRI shows "no known
station geometry for GRI ####" instead of a map. Adding another chain is a
matter of adding an entry to `CHAINS` in `src/emu/loran-chains.js`.

## What's *not* modeled, and why

The user interface panel's other silkscreened sections in hardware.md
(`PWR/DIM`, `IO/TLS`, `TRF`) and the 8212 (U39) aren't represented here.
Not because they were forgotten - the firmware's own code never reads or
writes anything that maps to them (no display-dimming register, no
addressable IO/TLS state, no 8212 chip-select in the reconstructed address
map - see hardware.md's checklist items 6-8). There's nothing in the ROM's
behavior to drive a UI control for, so adding one would just be decoration
with no firmware behind it. If the physical-verification checklist ever
turns up where the 8212 lives in the address space, wire it into `Bus`
first (see [pal-decoder.md](pal-decoder.md)) and a UI element can follow.

The expansion-ROM socket (`--exprom` on the CLI) also isn't exposed in the
web UI - it's a load-time option (which image to boot with), not something
meaningful to toggle while running.

## Architecture

```
src/emu/web-emu.js       Node http server: runs the emulator continuously in a
                          20ms-tick loop paced to ~5 MHz, exposes GET /api/state
                          and POST /api/{switch,button,serial,control,receiver,loran}
src/emu/web/index.html   the whole UI: inline CSS/JS, no build step, no
                          external dependencies or CDN fetches
src/emu/loran-chains.js  real Loran-C chain station geometry + hyperbolic-fix
                          math for the position map -- see "Position map" above
src/emu/playbooks/capture.js   Playwright script that drives every flow in
                                docs/playbooks/ and (re)captures its screenshots
```

The server holds `uiState` (current switch/button/receiver settings) as
its own source of truth, separate from the emulator's internal state, so
`reset` can tear down and rebuild the `Bus`/`Cpu8085`/`ReceiverFrontEnd`
from scratch and immediately reapply whatever the panel was set to,
without the browser needing to resend anything.

Polling (plain `fetch` every 100ms) was chosen over WebSockets/SSE to keep
the zero-dependency, single-file-server property of the rest of this
project's tooling. At 10 Hz it's plenty for digit/LED-level "blinkenlights"
observation; it is not trying to be a logic analyzer.
