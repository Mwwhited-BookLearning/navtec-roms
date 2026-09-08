# Device-address decoder: PAL emulation and CUPL source

The emulator ([docs/emulator.md](emulator.md)) models every peripheral as a
standalone component - each one (`Intel8155`, `Intel8251A`, `Intel8279`, ROM)
exposes a uniform `read8(addr)`/`write8(addr, val)` and decides for itself
which address bits matter to it, the same way a real chip only looks at the
pins actually wired to it. What decides *which* device answers a given
address - the board's device-mapping logic - is modeled separately, as its
own component: `src/emu/pal.js` + `src/emu/addr-decode.js`.

**This is presented as an emulated PAL16R8/20R10 standing in for the
board's real device-mapping logic. The real board's logic is TTL** - an
8205 (U45) 3-to-8 decoder plus glue, confirmed from the physical board (see
[hardware.md](hardware.md#chip-designators)). Modeling it here as a PAL is
an emulator/design-tool choice - a clean way to keep the decode logic in
one place and get real CUPL source out of it - not a claim that a PAL is
what's actually on the board. If you're using this as a design for an
actual hardware modification (replacing U45 + its glue with one PAL chip),
that's exactly what it's for; just don't read it back into hardware.md as
if it were a finding about the existing board.

## What it decodes

One product term per output, straight from hardware.md's "Address
decoding (inferred)" table - a pure 3-to-8 decode on `A14`, `A13`, `A12`,
matching the 8205's Y0-Y7 order:

| Output | Selects | Address group |
|---|---|---|
| `CS_ROM1` | ROM1 (NT3321) | 0000-0FFF |
| `CS_ROM2` | ROM2 (NT3322) | 1000-1FFF |
| `CS_EXPROM` | optional expansion ROM | 2000-2FFF |
| `CS_UNUSED` | nothing | 3000-3FFF |
| `CS_USART` | 8251A | C000-C001 (mirrored) |
| `CS_KDC` | 8279 | D000-D001 (mirrored) |
| `CS_PIO1` | 8155 #1 | 6F00-6FFF / E000-E005 |
| `CS_PIO2` | 8155 #2 | 7000-70FF / F000-F005 |

**`A15` (IO/M) is deliberately not a decoder input.** hardware.md's own
reconstruction has it wired directly into each 8155's own IO/M pin, not
through U45 - so `CS_PIO1`/`CS_PIO2` each cover *both* that 8155's RAM
window and its register window; the 8155 itself is what tells them apart
(`Intel8155.read8` checks bit 15 of the address it's handed). This matches
the real board's inferred wiring exactly, and it's why the decoder only
needs 3 inputs.

## Files

- `src/emu/pal.js` - `ProductTermPal`, a small generic sum-of-products
  evaluator (named input literals, AND within a term, OR across terms,
  active-low output). Not specific to this decoder; reusable for any future
  PAL-shaped logic in this project.
- `src/emu/addr-decode.js` - the actual 8-term decode table (`ADDR_DECODE_TERMS`),
  shared by the emulator's `Bus` and the CUPL generator so they can't drift
  apart, plus pin-assignment specs for PAL16R8 and PAL20R10 and the CUPL
  renderer itself. Run directly (`node src/emu/addr-decode.js`) to regenerate
  the `.pld` files below.
- `pal/addr_decoder_16r8.pld`, `pal/addr_decoder_20r10.pld` - generated
  CUPL source, committed like `disasm/*.asm`/`.lst` are: build artifacts of
  a tool in this repo, kept up to date by re-running that tool rather than
  hand-edited.

## Why two device options

- **PAL16R8** (20-pin, 8 registered outputs) is an exact fit: 8 outputs for
  8 chip-selects, nothing spare, nothing wasted - the direct one-for-one
  replacement for the 8205.
- **PAL20R10** (24-pin, 10 registered outputs) leaves 2 outputs spare after
  the same 8 chip-selects, for whenever the U39/8212 conflict is resolved
  (checklist item 6 in hardware.md) and it turns out to need its own
  select, or a second `OPTION` ROM socket needs one.

Both are generated from the exact same `ADDR_DECODE_TERMS` table, so they
can never disagree with each other or with the emulator's own decode logic.

## Known simplification: registered, not combinational

A real 8205 is purely combinational - outputs follow inputs immediately,
no clock involved. PAL16R8/20R10 outputs, by contrast, are *always*
registered (that's what distinguishes the R-series from the L-series
PAL16L8). Modeling this decoder on a 16R8/20R10 therefore means it's
inherently a clocked design, even though the function being replaced isn't.

The emulator doesn't currently model discrete T-states with separate
address-setup and clock-edge phases, so `ProductTermPal.clock()` is called
synchronously on every bus access and its result used immediately - there
is no observable one-clock latency in the emulation. A real registered PAL
built from this CUPL source *would* have that latency (one CLK period
before a newly-decoded address's chip-select becomes valid), which matters
for real hardware timing margins but has no equivalent to check against
here without a cycle-accurate bus model. If this project ever grows one,
that's the place to revisit this.

## Regenerating

```sh
node src/emu/addr-decode.js
```

Overwrites both `.pld` files from `ADDR_DECODE_TERMS`. Compiling them
(e.g. with WinCUPL or an equivalent) has not been done as part of this
project - the pin assignments are this project's own choice (there's no
real target socket to match), so anyone burning this into a physical part
to replace U45 should renumber pins to match their actual wiring first.
