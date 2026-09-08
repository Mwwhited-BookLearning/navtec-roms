# 8085 emulator (`src/emu/emu8085.js`)

A from-scratch Intel 8085 interpreter plus the memory-mapped peripherals
reconstructed in [hardware.md](hardware.md), able to boot the real ROM
images end to end. **It has never been checked against a real board** -
everything here follows from the ROM analysis and the physical notes in
hardware.md, the same "as well as you can assume" basis the rest of this
project's hardware reconstruction rests on. Where it had to guess, it says
so below; treat every guess as a hypothesis the physical board can confirm
or kill, not a verified fact.

## What it does

- Full 8085 instruction set, including the eleven undocumented opcodes
  (`DSUB`, `ARHL`, `RDEL`, `LDHI`, `LDSI`, `RSTV`, `SHLX`, `LHLX`, `JNK`,
  `JK`, and `RIM`/`SIM`'s bit layout). Verified booting both ROM images from
  RESET through `INIT`, the 8279 setup, `ROM_SELFTEST`, `READ_SWITCHES`, and
  into the steady-state loop (`SERIAL_POLL` / `WAIT_SAMPLE` /
  `MATCH_PULSES` / `TICK_TASK`) without hitting an unimplemented opcode or
  an exception - see "What's been checked" below.
- Memory map and address decoding exactly as documented in hardware.md's
  "Address decoding (inferred)" table: two 4 KB ROM images at 0000/1000, an
  optional expansion ROM at 2000, and the two 8155s' RAM/register mirroring
  behavior (256-byte RAM windows at x000-x0FF mirrored through xFFF, 6-word
  register blocks mirrored through the I/O-side 4 KB window).
- Peripheral models for both 8155s, the 8251A USART, and the 8279
  keyboard/display controller, built directly from the command bytes and
  bit tables in hardware.md and front-panel.md.
- A synthetic Loran-C receiver front end that drives 8155 #2's port B/C
  handshake lines well enough to make `WAIT_SAMPLE` and the phase-code
  shift-in logic actually run.
- A CLI with tracing, breakpoints, symbol resolution (reuses
  `disasm/nt3321-22.json`'s labels/equates - the same source of truth the
  disassembler and every doc use), and an interactive monitor, plus a
  stdin/stdout bridge to the emulated 8251A so you can talk to the
  firmware's own serial monitor (see [serial-protocol.md](serial-protocol.md))
  the way a real terminal would.

## What's been checked

Booting with no arguments (default reset state, all switch rows read as
0) runs indefinitely through `ROM_SELFTEST` → `READ_SWITCHES` (fails
validation since row 0 isn't a valid selector digit) → the six
`SW_ERR_*`/`SW_ERR_SHOW` error-display stubs → `TICK_TASK` → back to
`READ_SWITCHES`, exactly the retry loop front-panel.md describes for bad
switch settings - itself a decent piece of evidence the CPU core, the 8279
sensor-RAM path, and the display-write path are all behaving.

Booting with `--switches 1,2,9,9,4,0` (a selector/GRI combination that
satisfies `READ_SWITCHES`'s documented validation: selectors 1..9, GRI
digit 1 in 4..9) clears validation on the first pass and settles into the
real background loop, cycling through `SERIAL_POLL`, `TX_SERVICE`,
`WAIT_SAMPLE`, `MP_NEXT_SAMPLE` (part of `MATCH_PULSES`) and `TICK_TASK` -
confirming the RST 6.5 interrupt path, the 8155 timer/RST 7.5 path, and the
8279 switch-read path all work together well enough to reach the
acquisition code. It has not been driven all the way to `MASTER_FOUND`;
see "Known limitations" below for why.

Running under [the web front end](web-emulator.md) with that same switch
combination reaches `REPORT_TASK`'s periodic serial output (real formatted
report lines over the emulated 8251A) and shows the classic all-segments
"88888888" lamp-test pattern on the display shortly after boot.

**Fixed while building the web front end:** nothing previously connected
the 8279's IRQ output to the CPU's RST 5.5 pending flag, so a switch
changed after cold boot was never noticed - `READ_SWITCHES` only runs
once, and front-panel.md's runtime re-scan path is gated on that IRQ.
`Bus.tick()` now continuously syncs `cpu.I55` from the 8279's live
`irqPending` (RST 5.5 is level-sensitive from an external pin per
hardware.md's diagram, not something to latch and clear by hand). See
[web-emulator.md](web-emulator.md#runtime-switch-changes-now-actually-work).

One real bug found and fixed this way: the 8279's `writeCommand` case for
the `CDH` (clear) command originally cleared `sensorRAM` along with
`displayRAM`. On real hardware, sensor-matrix-mode sensor RAM is a live
mirror of the external switch matrix (continuously re-scanned by the
chip), not internal state software can erase - clearing it made every
switch setting silently vanish and read back as an invalid all-zero row
forever. Fixed by only clearing `displayRAM` on that command.

## Architecture

```
src/emu/emu8085.js
  Cpu8085          registers, flags, the full opcode dispatch table, interrupts
  RomDevice, UnusedDevice, Intel8155 x2, Intel8251A, Intel8279
                   standalone devices: each exposes read8(addr)/write8(addr,val)
                   and decides for itself which address bits matter to it
  Bus              wires the devices to an emulated PAL device-address
                   decoder (see below) and dispatches accesses to whichever
                   device's chip-select the decoder asserts
  ReceiverFrontEnd synthetic Loran-C signal generator (see below)
  CLI / REPL       argument parsing, tracing, breakpoints, interactive monitor

src/emu/pal.js           generic PAL/GAL-style sum-of-products evaluator
src/emu/addr-decode.js   this board's specific decode table + CUPL generator
src/emu/web-emu.js       HTTP server: runs the emulator continuously, serves the web UI
src/emu/web/index.html   the browser front end -- see docs/web-emulator.md
```

The CPU/bus/peripherals live in one file, matching `tools/dis8085.js`'s
existing convention; the PAL decoder is split out into its own two small
modules since it's also used standalone to generate CUPL source - see
[pal-decoder.md](pal-decoder.md) for why the decoder is modeled as a PAL at
all and what that does and doesn't claim about the real board. `module.exports`
exposes the classes for scripting/tests.

## Known simplifications and best-effort choices

These are the specific places this emulator diverges from a fully
hardware-verified model, and why:

1. **8155 port-C mode is collapsed to a binary choice.** The official
   Intel ALT1-4 modes (bits 2-3 of the command register) distinguish plain
   input, plain output, and two handshake modes with interrupt-driven
   `BF`/`STB`/`INTR` lines on port C. This firmware only ever programs
   `0xC3` (decodes to ALT1, PC input) and `0xCF` (decodes to ALT4 by the
   official bit meanings, but with `IEA`/`IEB` = 0 - no handshake
   interrupts enabled - and hardware.md's own code-derived read of that
   command byte's effect is "PC out", not "PC handshake"). Since no
   handshake behavior is ever exercised, the emulator treats PC-mode bits
   `00` as input and anything else as plain output. A different firmware
   image that actually used ALT2/ALT3 handshaking would need a real
   implementation of those modes.
2. **8155 timer models only continuous auto-reload square-wave output.**
   The real chip's 4 timer modes (single square wave, single pulse,
   auto-reload square wave, auto-reload pulse) aren't distinguished; every
   `Start` command reloads and free-runs. This matches the one documented
   use (`mode 01`, "continuous square wave") for both chips, but a
   single-shot timer program would not behave correctly.
3. **Undocumented-opcode semantics (`DSUB`, `ARHL`, `RDEL`, `LDHI`,
   `LDSI`, `RSTV`, `SHLX`, `LHLX`, `JNK`, `JK`) are implemented from general
   8085 undocumented-instruction references, not from an Intel datasheet.**
   The disassembler's flow tracer never needed to execute through any of
   these in the ROM's reachable code (they only ever appear as skip-lengths
   over data bytes), so this ROM's behavior does not depend on them being
   exactly right.
4. **The 8212 (U39) is not memory-mapped anywhere.** hardware.md's own
   checklist item 8 says its purpose is still untraced on the physical
   board; nothing in the reconstructed address-decode table gives it a
   chip-select, so there was nothing to wire it to. If tracing the board
   turns up where it lives in the address space, add it to `Bus`.
5. **The synthetic receiver front end is a plausible stimulus generator,
   not a verified protocol implementation.** It hooks 8155 #2's port B
   writes (bit 2 = latch/reset, bit 4 = shift clock, bit 5 = sample ack per
   hardware.md) and shifts out the master phase-code bytes (`0xCA`, `0x9F`)
   MSB-first on port C bits 4/3, and raises RST 6.5 on a fixed T-state
   interval (`ReceiverFrontEnd.sampleInterval`, currently 20000 T-states -
   picked to keep the emulator responsive, not derived from a real Loran-C
   GRI timing budget). `SHIFT_IN16`'s exact bit-ordering expectations
   haven't been re-verified against the disassembly for this project, so
   getting the firmware to actually declare `MASTER_FOUND` would need that
   verification plus tuning the strobe timing against `WAIT_EPOCH`/
   `MATCH_PULSES`'s real windowing logic - a good next research step, not
   done here.
6. **`OUT`/`IN` (8085's port-mapped I/O instructions) are stubbed as
   no-ops / open-bus reads.** hardware.md confirms the firmware never uses
   them ("No `IN`/`OUT` instructions appear anywhere. All peripherals are
   memory mapped"), so this only matters if you feed the emulator different
   code.
7. **T-state cycle counts (`CYCLES` table) are approximate**, filled in for
   the common opcodes and defaulting to 7 for the rest. They pace the 8155
   timers and the receiver front end's sample clock, not anything that
   affects instruction-level correctness.

## Usage

```sh
# Free-run from reset, symbol-resolved trace to stderr redirected off, stop after 1e6 instructions:
node src/emu/emu8085.js --steps 1000000

# Boot with a valid switch panel (selector A=1, selector B=2, GRI 9940) and
# drop into the interactive monitor once it settles:
node src/emu/emu8085.js --switches 1,2,9,9,4,0 --repl

# Talk to the firmware's own serial monitor over the emulated 8251A, live:
node src/emu/emu8085.js --switches 1,2,9,9,4,0 --serial

# Trace every instruction with symbol names, breaking at a specific address:
node src/emu/emu8085.js --trace --break 12D
```

REPL commands: `s[N]` step N instructions (default 1), `c [addr]` run
until a given PC or forever, `r` show registers, `m addr [len]` hex-dump
memory, `tx <hex bytes>` inject bytes into the emulated 8251A's receive
queue, `q` quit.

See the top-of-file comment in `src/emu/emu8085.js` for the full option
list.

## Suggested next steps

- Re-verify `SHIFT_IN16` (04AE) and `MATCH_PULSES` (05C2) bit-for-bit
  against `disasm/nt3321-22.json` and tune `ReceiverFrontEnd` to match, to
  actually drive the emulator to `MASTER_FOUND` and into `TRACK_LOOP`.
- Once the [physical-verification checklist](hardware.md#physical-verification-checklist)
  is done, fold real answers back in here: the RST 7.5 source (item 2), the
  U39/8212 purpose and address if any (item 8), and the crystal path (item
  1) all affect whether specific simplifications above are actually correct
  or just convenient guesses.
- A small regression harness (run N steps from reset, assert PC visits a
  known set of routines) would catch peripheral regressions like the
  sensor-RAM bug found above without needing a human to eyeball a trace.
