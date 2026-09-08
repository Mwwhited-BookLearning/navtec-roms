# Emulator API reference

The programmatic surface of `src/emu/*.js`, for anyone scripting against
the emulator (writing more tests, building new tooling, driving it from
something other than the CLI/web front end) rather than just running it.
This documents what each module `module.exports`s and its public
methods/properties; see [emulator.md](emulator.md) for architecture and
what's been verified, and the source itself for implementation detail this
page intentionally leaves out (exact opcode semantics, etc.).

## `src/emu/emu8085.js`

```js
const { Cpu8085, Bus, Intel8155, Intel8251A, Intel8279,
        RomDevice, UnusedDevice, ReceiverFrontEnd, loadSymbols } = require('./emu8085.js');
```

### `class Cpu8085`

`new Cpu8085(bus)` - `bus` must implement `read8(addr)`, `write8(addr,
val)`, and `tick(tstates)` (see `Bus`, or `src/emu/test/helpers.js` for a
minimal bare-RAM stub used in unit tests).

| Member | Description |
|---|---|
| `.A .B .C .D .E .H .L` | 8-bit registers (0-255) |
| `.SP .PC` | 16-bit stack pointer / program counter |
| `.flagS .flagZ .flagAC .flagP .flagCY .flagV` | individual flag booleans (`flagV` is the undocumented 8085 overflow/"K" flag) |
| `.IE` | interrupt-enable flag |
| `.M55 .M65 .M75` | interrupt masks (`true` = masked/disabled) |
| `.I55 .I65 .I75` | interrupt pending flags |
| `.halted` | true after `HLT`, until woken by an unmasked interrupt |
| `.cycles` | running T-state counter |
| `.trace` | set `true` to `console.log` every fetched instruction (symbol-resolved if `.symbols` is set) |
| `.symbols` | optional `Map<number,string>` (address -> name), used by `.symFor()` and trace output; see `loadSymbols()` below |
| `.unknownOpcodeAt` | `null` normally; set to the address of an unimplemented opcode if one is ever fetched (should never happen against real 8085 code) |
| `.step()` | executes exactly one instruction, handling any pending interrupt acceptance first. **Accepting an interrupt and executing the first instruction at its vector happen in the same `step()` call** - see `emulator-api.md`'s note below and `src/emu/test/cpu.test.js` for worked examples |
| `.requestInterrupt(name)` | `name` is `'5.5'`, `'6.5'`, or `'7.5'` - sets that line's pending flag. For `'5.5'`, prefer wiring it through `Bus.tick()`'s live sync instead (see `Bus`) since it's level-sensitive on real hardware, not edge-triggered |
| `.reset()` | resets `PC`/`SP`/`IE`/masks/pending flags/`halted` to power-on state (does *not* clear registers `A`-`L`) |
| `.symFor(addr)` | returns `` " (NAME+offset)" `` for trace/display, or `''` if no symbol covers `addr` |

**The one-`step()`-per-instruction rule and interrupts:** `step()` always
executes exactly one real instruction. If an interrupt is accepted at the
top of a call, that's forced vectoring (a push + `PC` change), not itself
an instruction - the same `step()` call then fetches and executes whatever
is at the vector. This means a single `step()` right after an interrupt
becomes pending can both vector *and* run the ISR's first instruction; see
`src/emu/test/cpu.test.js`'s interrupt tests for how to structure
assertions around this (put a `HLT` or a known instruction at the vector
address rather than expecting `PC` to equal the vector exactly after one
`step()`).

### `class Bus`

`new Bus()` - no arguments; load ROM images after constructing.

| Member | Description |
|---|---|
| `.rom1 .rom2` | `RomDevice` instances for 0000-0FFF / 1000-1FFF |
| `.expRomDevice` | `RomDevice` once `loadExpRom()` is called, else an `UnusedDevice` |
| `.pio1 .pio2` | the two `Intel8155` instances (E000/6F00 and F000/7000) |
| `.usart` | the `Intel8251A` instance |
| `.kdc` | the `Intel8279` instance |
| `.decoder` | the `ProductTermPal` instance doing address decode (see `pal.js`) |
| `.frontEnd` | `null` by default; assign a `ReceiverFrontEnd` to wire it into `.tick()` |
| `.loadRom(buf, org)` | `org` must be `0` or `0x1000`; throws otherwise |
| `.loadExpRom(buf)` | loads an optional expansion ROM image at 2000-2FFF |
| `.attachCpu(cpu)` | wires a `Cpu8085` in for RST 7.5 (8155 #1 timer) and RST 5.5 (8279 IRQ) delivery - **required** for interrupts to reach the CPU |
| `.read8(addr) .write8(addr, val)` | full 16-bit address bus access, routes through `.decoder` to the right device |
| `.deviceFor(addr)` | returns the selected device for a given address without performing the access - mostly for introspection/tests |
| `.tick(tstates)` | advances both 8155 timers and the receiver front end by `tstates`, and syncs `cpu.I55` from the 8279's live IRQ pin. Called automatically once per instruction by `Cpu8085.step()` |

### `class Intel8155`

`new Intel8155(name)` - `name` is just a human-readable label, not
functionally used.

| Member | Description |
|---|---|
| `.ram` | `Uint8Array(256)` |
| `.PA .PB .PC` | port output latches |
| `.paIn .pbIn .pcIn` | external input latches (drive these when a port is configured as input) |
| `.paDir .pbDir .pcOutput` | derived from the last command byte |
| `.timerReload .timerCurrent .timerRunning .toutLevel` | timer state |
| `.onPAWrite(v) .onPBWrite(v) .onPCWrite(v)` | optional callbacks fired on a port write |
| `.onTimerOut(level)` | optional callback fired each time the timer output toggles |
| `.writeCommand(v) .readReg(i) .writeReg(i, v)` | direct register-level access (`i` 0-5: command/status, PA, PB, PC, timer-lo, timer-hi) |
| `.read8(addr) .write8(addr, val)` | standalone-component interface - decides RAM vs. register access from bit 15 of `addr` itself |
| `.tick(tstates)` | advances the timer |

### `class Intel8251A`

`new Intel8251A()`.

| Member | Description |
|---|---|
| `.mode .command` | last-written mode/command bytes |
| `.expectingMode` | internal state-machine flag (true until the first control write after construction or a reset command) |
| `.rxQueue` | array of pending received bytes |
| `.onTx(byte)` | optional callback fired on every transmitted byte |
| `.injectRx(byte)` | queues a byte as if received from the serial line |
| `.readByAddr(addr) .writeByAddr(addr, v)` | dispatches by `addr & 1` (data vs. control/status) |
| `.read8(addr) .write8(addr, val)` | aliases of the above, for the standalone-component interface |

### `class Intel8279`

`new Intel8279()`.

| Member | Description |
|---|---|
| `.displayRAM` | `Uint8Array(16)` |
| `.sensorRAM` | `Uint8Array(8)` - one byte per sensor-matrix row; **not** cleared by the `CDH` command (see `emulator.md`'s sensor-RAM bug note) |
| `.irqPending` | the chip's live IRQ output state |
| `.onDisplayWrite(addr, v)` | optional callback fired on every display-RAM write |
| `.setSensorRow(row, val)` | sets a sensor-matrix row's raw byte (this is how you simulate a switch/button change) |
| `.raiseIrq()` | sets `.irqPending = true` (simulate a sensor-matrix change being detected) |
| `.writeCommand(v)` | dispatches by the top 3 bits per the 8279's command encoding |
| `.read8(addr) .write8(addr, val)` | standalone-component interface, dispatches by `addr & 1` |

### `class ReceiverFrontEnd`

`new ReceiverFrontEnd(cpu, pio2, which)` - `which` is `'master'` or
`'secondary'`; `pio2` must be an `Intel8155` instance (normally `bus.pio2`).

| Member | Description |
|---|---|
| `.mode` | current phase-code mode |
| `.noise` | 0-1, per-bit flip probability |
| `.sampleTotal` | cumulative synthetic sample count |
| `.sampleInterval` | T-states between samples (default 20000 - see `emulator.md`'s caveat that this isn't derived from real Loran-C timing) |
| `.onSample()` | optional callback fired once per synthetic sample strobe |
| `.setMode(which) .setNoise(level)` | reconfigure at runtime; invalid `which` is silently ignored |
| `.tick(tstates)` | call from `Bus.tick()` (already wired if you set `bus.frontEnd = ...`) |

### `class RomDevice` / `class UnusedDevice`

Minimal standalone devices. `RomDevice(size)` has `.load(buf, offset)`,
`.read8(addr)` (masked into `size`), and a no-op `.write8()`.
`UnusedDevice` just returns `0xFF` from every read and ignores writes -
used for the expansion-ROM slot before anything is loaded, and for
unmapped address groups.

### `loadSymbols(jsonPath)`

Reads a disassembly hints JSON file (normally
`disasm/nt3321-22.json`) and returns a `Map<number,string>` combining its
`labels` and `equates`, for use as `cpu.symbols`. Returns `null` if the
file can't be read/parsed (symbol resolution then just silently no-ops).

## `src/emu/pal.js`

```js
const { ProductTermPal } = require('./pal.js');
```

`new ProductTermPal(terms)` - `terms` is `[{ name, pins: ['!A14', 'A13',
...] }, ...]`, one product term (AND of its `pins`, `!`-prefixed for
negation) per output.

| Member | Description |
|---|---|
| `.evaluate(env)` | returns `{ name: boolean }` - `true` = that output's term is satisfied (before any active-low inversion) |
| `.clock(env)` | returns `{ name: boolean }` with active-low inversion applied (`false` = electrically asserted/low) and latches it onto `.q` |
| `.q` | the result of the last `.clock()` call |
| `ProductTermPal.literal(lit, env)` (static) | evaluates one literal against an environment object |
| `ProductTermPal.term(pins, env)` (static) | evaluates a whole AND-term |

Not specific to the address decoder - reusable for any future PAL-shaped
logic.

## `src/emu/addr-decode.js`

```js
const { CS, ADDR_DECODE_TERMS, DEVICE_SPECS, generateCupl } = require('./addr-decode.js');
```

| Export | Description |
|---|---|
| `CS` | `{ ROM1, ROM2, EXPROM, UNUSED, USART, KDC, PIO1, PIO2 }` - the 8 output names as constants |
| `ADDR_DECODE_TERMS` | the actual decode table (8 entries, one `ProductTermPal` term each) - shared between the emulator's `Bus` and the CUPL generator |
| `DEVICE_SPECS` | `{ '16R8': {...}, '20R10': {...} }` - pin assignments and metadata for CUPL generation |
| `generateCupl(deviceKey, opts)` | returns the full CUPL source text for `'16R8'` or `'20R10'`; `opts` can override `designer`/`company`/`date`. Throws on an unknown `deviceKey` |

Run `node src/emu/addr-decode.js` directly to regenerate both `.pld` files
under `pal/`.

## `src/emu/loran-chains.js`

```js
const loran = require('./loran-chains.js');
```

| Export | Description |
|---|---|
| `CHAINS` | built-in chain geometry database, currently just `'9940'` (see [web-emulator.md](web-emulator.md#position-map-illustrative-only)) |
| `C_KM_S` | speed of light, km/s |
| `VELOCITY_FACTOR` | rough groundwave velocity factor (no ASF applied) |
| `project(chain)` | returns `{ toXY(lat,lon), fromXY(x,y) }` - a local equirectangular projection centered on the chain's master |
| `secondaryForIndex(chain, idx)` | maps a 1-based station index (front-panel.md's `SEL_A`/`SEL_B` convention) onto the chain's secondary letters, cycling if needed; returns `null` for `idx < 1` |
| `wrapToBaseline(d, maxAbs)` | folds a distance-difference into `(-maxAbs, maxAbs]` via modulo |
| `hyperbolaPoints(mXY, sXY, dKm, n)` | returns `n+1` points (default 80) along the one hyperbola branch satisfying `dist(P,mXY) - dist(P,sXY) = dKm`; `[]` if `dKm` is out of range for the given foci separation |
| `solveFix(mXY, s1XY, d1Km, s2XY, d2Km, guess)` | Newton-Raphson intersection of two such hyperbolas; returns `{x,y}` or `null` if it doesn't converge |

All coordinates in these functions are in the local `{x,y}` km frame from
`project()`, not raw lat/lon - convert with `toXY`/`fromXY` at the
boundary.

## Where these are actually used

- `src/emu/emu8085.js`'s own `main()` (the CLI) and `src/emu/web-emu.js`
  (the web server) are the two reference consumers of this whole API - read
  either as a worked example of wiring everything together.
- `src/emu/test/*.test.js` exercises nearly every method listed above in
  isolation; if you're unsure how something behaves, there's likely a test
  for it already.
