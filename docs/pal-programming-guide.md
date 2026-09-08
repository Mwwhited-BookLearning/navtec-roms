# Compiling and burning the PAL decoder

A step-by-step guide for actually turning `pal/addr_decoder_16r8.pld` or
`pal/addr_decoder_20r10.pld` (see [pal-decoder.md](pal-decoder.md) for what
these are and why they exist) into a programmed physical chip. **This
project has not done this step** - nothing here has been executed or
verified against real hardware; it's a guide for whoever does it next.

Read [pal-decoder.md](pal-decoder.md) first if you haven't - in particular
its point that this stands in for the board's real TTL-based decode logic
(the 8205 at U45 + glue), and isn't a claim about what's actually on the
board.

## What you need

- **WinCUPL** (free, from Microchip/Atmel - CUPL's current owner). Windows
  only; runs fine under Wine or a VM if you're not on Windows.
- **A PAL programmer that supports PAL16R8 and/or PAL20R10.** This project
  already used a TL866-class programmer for the ROM chips
  ([originals/README.md](../originals/README.md)) - most TL866-family
  programmers (and their software, e.g. Xgpro/MiniPro) support both PAL
  families directly, no special wiring rediscovery needed the way the
  8332 masked ROMs required.
- A **blank PAL16R8 or PAL20R10** (bipolar, fuse-based - not a GAL/CMOS
  reprogrammable part, unless your programmer's software explicitly maps
  a GAL equivalent's fuse map the same way for these device names).

## 1. Compile the `.pld` to a JEDEC file

In WinCUPL:

1. Open `pal/addr_decoder_16r8.pld` (or the `20r10` variant) as a new
   project source.
2. Run the compiler ("Compile" / F9 in WinCUPL's UI). It should report the
   device as `P16R8` (or `P20R10`) and compile cleanly - straightforward
   combinational-into-registered equations, nothing exotic in this design.
3. This produces a `.jed` file (the JEDEC fuse-map format every PAL
   programmer consumes) alongside the source.
4. Also worth checking WinCUPL's generated `.doc`/simulation output against
   the truth table in [pal-decoder.md](pal-decoder.md#what-it-decodes) -
   confirming the compiler produced the decode you expect before ever
   touching a real chip costs nothing and catches typos early.

## 2. Renumber pins to match your actual wiring first

**Do this before programming, not after.** The pin assignments in the
`.pld` files are this project's own arbitrary choice (there's no real
target socket to match) - ascending order, inputs/CLK first, then OE, then
outputs in `CS_ROM1`...`CS_PIO2` order:

| Signal | 16R8 pin | 20R10 pin |
|---|---|---|
| `CLK` | 1 | 1 |
| `A12` | 2 | 2 |
| `A13` | 3 | 3 |
| `A14` | 4 | 4 |
| `OE` | 11 | 13 |
| `CS_ROM1` | 12 | 14 |
| `CS_ROM2` | 13 | 15 |
| `CS_EXPROM` | 14 | 16 |
| `CS_UNUSED` | 15 | 17 |
| `CS_USART` | 16 | 18 |
| `CS_KDC` | 17 | 19 |
| `CS_PIO1` | 18 | 20 |
| `CS_PIO2` | 19 | 21 |

If you're building this as a real replacement for U45 on the physical
board, you need to either (a) rewire the socket to match this pinout, or
(b) edit the `PIN` statements in the `.pld` source to match whatever
wiring you're actually committing to, then recompile. Regenerate from
`src/emu/addr-decode.js` (see below) rather than hand-editing the compiled
`.pld` if you want the change to persist across future regenerations.

## 3. Program the chip

With the `.jed` file and your programmer's software:

1. Select the exact device (PAL16R8 or PAL20R10 - not a similarly-named
   GAL unless you've confirmed your programmer treats the fuse map
   identically).
2. Load the `.jed` file.
3. Program, then use the programmer's verify/read-back function to confirm
   the fuse map matches what you loaded - don't skip this, it's the only
   check that the part actually took the programming correctly.

## 4. Test before installing

Before soldering/socketing this into the actual board:

- **Truth-table test on the bench.** Apply `A12`/`A13`/`A14` combinations
  (via a switch bank or a second, known-good part) and a clock signal to
  `CLK`, and confirm each of the 8 `CS_*` outputs goes active-low for
  exactly the combination `pal-decoder.md`'s table predicts, and only
  that one.
- **Remember it's registered, not combinational** (see
  [pal-decoder.md](pal-decoder.md#known-simplification-registered-not-combinational)) -
  outputs update one clock edge after the inputs change, not immediately.
  If you're driving `CLK` from the same source the real 8205 would have
  used (or not used at all, since it's purely combinational), confirm your
  test setup actually toggles `CLK` - a PAL16R8/20R10 output holds its
  last state indefinitely without a clock edge, which looks like "stuck"
  if you're expecting instant combinational response.

## 5. If you want to regenerate with different pin numbers

Edit the `DEVICE_SPECS` pin tables in `src/emu/addr-decode.js`, then:

```sh
node src/emu/addr-decode.js
```

This regenerates both `.pld` files from the same `ADDR_DECODE_TERMS` table
the emulator itself evaluates - the decode logic can't drift from what the
emulator models even if you change the pin numbering. See
[pal-decoder.md](pal-decoder.md#files) for the full file layout.
