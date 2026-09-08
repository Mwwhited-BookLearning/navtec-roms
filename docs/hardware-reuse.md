# Reusing this board: a general-purpose 8085 platform, Loran-C removed

A proposal, not a build log - **nothing in this document has been done or
tested.** It's a design starting point for treating this board as a
general-purpose Intel 8085 controller with a numeric keypad, a
display, and a multi-drop serial port, once you replace the two ROM
chips with your own firmware. Everything it claims about the hardware
comes from [hardware.md](hardware.md)'s code- and photo-derived
reconstruction; nothing here is more certain than that document already
is, and the same open questions apply. See
[peripheral-pinouts.md](peripheral-pinouts.md) for chip-level pin tables
if you're wiring anything new.

## The premise

"Total reprogramming without the Loran interface" is simpler than it
sounds, because almost nothing about this board is Loran-specific at the
*hardware* level - the specialization lives entirely in the two ROM chips'
contents and in what's connected to a handful of I/O pins. Swap the ROMs,
ignore those pins, and you have a fairly capable, fully-documented 1979-era
industrial controller: an 8085 at 5 MHz, 512 bytes of RAM, two programmable
timers, 14 bits of parallel I/O, a numeric keypad and display, and a
multi-drop RS-422/485 serial port with an addressing protocol already
worked out for you.

## What's reusable as-is (no rewiring, no new parts)

| Subsystem | What you get | Confirmed by |
|---|---|---|
| 8085 CPU (U40), 5.000 MHz | A full 8-bit CPU with the usual 8085 instruction set, 64 KB address space (8 KB used) | hardware.md |
| 2x 8155 (U22/U35) | 512 bytes RAM total, 14 bits of parallel I/O (3 ports), 2 independent 14-bit programmable timers | hardware.md |
| 8251A USART (U32) | Async serial, currently framed 7O2 (7 data, odd parity, 2 stop), baud selectable 110/300/1200/19200 via one 8155 timer - reprogram the mode byte for any framing you want | hardware.md, serial-protocol.md |
| AM26LS32DC line receiver + associated driver | RS-422/485-style differential signaling - multi-drop capable out of the box, not just RS-232 point-to-point | hardware.md "Physical board observations" |
| 8279 (U36) | 6 thumbwheel-style rotary switches (10-position) + 2 push-buttons for input; a 2-row x 6-digit (+1 extra byte) numeric display for output | front-panel.md |
| Precision 10 MHz TCXO | A temperature-compensated crystal oscillator - notably *more* precise than a garden-variety CPU crystal, useful for anything timing-sensitive | hardware.md |
| Expansion ROM socket(s) (`OPTION`, J8) | 4 KB more address space at 2000-2FFF if 8 KB isn't enough | hardware.md |
| `TRF`/`SAMPLER`/`IO/TLS` connectors | Unknown-purpose I/O headers, not yet traced - possibly more parallel I/O or analog signal access beyond what's described above | hardware.md checklist |

None of this depends on Loran-C in any way that requires a hardware
change to repurpose - it's all generic 8085-family peripheral silicon that
happens to have been *programmed* to do Loran-C reception.

## What's Loran-specific, and what "removing" it actually means

The Loran-specific parts are a handful of **wires and a firmware
convention**, not a subsystem you have to desolder:

- **8155 #2's port B/C** are wired to the receiver front end: port B bits
  2/4/5 (latch-reset/shift-clock/sample-ack strobes out) and port C bits
  2/3/4 (epoch flag, two serial data streams in) - see hardware.md's
  "Receiver front end" section. Electrically these are just 14 generic
  digital I/O lines with a specific firmware-side interpretation; a new
  program simply doesn't drive or read them that way. Whether anything
  external is even connected there once the analog front-end is
  disconnected doesn't matter - undriven CPU-side inputs just read
  whatever floats or whatever you *do* choose to wire there instead.
- **RST 6.5** is the receiver's "sample ready" strobe line. It's a
  perfectly ordinary 8085 hardware interrupt input from the CPU's
  perspective - a new program can use it for literally any external event
  it wants (or leave it permanently masked, as `SIM` allows).
- **8155 #1's port A/B** ("`REC_TO_FRONTEND`," hardware.md's corrected
  section) feed a station's TD value out in parallel, on the theory that
  something downstream (an external recorder, or another board in the
  larger Navtec system) wants it in binary rather than over the serial
  link. Again, just parallel output pins from the hardware's point of
  view - repurpose freely.
- **Whether the analog "SAMPLER" front-end circuitry lives on *this* board
  or a separate one in the larger system isn't confirmed** (hardware.md
  notes the board is silkscreened "PROCESSOR/FRONT PANEL" and the
  expansion-ROM hook implies "more system than this one board"). It
  doesn't actually matter for reuse purposes either way: if it's a
  separate board, just don't reconnect it; if it's a section of this same
  board, simply don't populate/power that section, or leave it
  disconnected from the digital side - either way, no cutting traces
  should be necessary, only choosing not to drive the relevant pins from
  new firmware.

## Getting new firmware onto the board

**The two main ROM sockets almost certainly accept genuine EPROMs
directly, no rewiring.** [rom-status.md](rom-status.md) and
[originals/README.md](../originals/README.md) found that reading these
chips on a generic programmer requires rewiring three pins (18/20/21) -
but that rewiring compensates for the *programmer's* "2732" profile not
knowing about the 8332 masked-ROM part's slightly different use of those
pins; it says nothing about the *board's* socket wiring. Intel built the
8332 specifically as a pin-compatible mask-ROM equivalent of the 2732
EPROM precisely so a production board could swap between them with zero
rewiring - that's the entire point of the "316/332 mask-ROM equivalent of
the 716/732 EPROM" product family. A genuine 2732 (or a 2732-footprint
EPROM emulator) should plug into these sockets and just work. **This
hasn't been tested in this project** - confirm with a meter (do the
socket's pins 18/20/21 route the way a standard 2732 expects?) or simply
try a blank, erased 2732 and see if the CPU fetches sensible NOPs/resets
before committing a real program to it.

Given that, your options, roughly in order of effort:

1. **Burn two 2732 EPROMs** with your new program (4 KB + 4 KB, sharing
   the 0000-0FFF/1000-1FFF split) and socket them in place of NT3321/
   NT3322. Simplest, most reversible (the original masked ROMs and their
   dumped images are preserved regardless - see `originals/`).
2. **Use a 2732-footprint EPROM emulator** (a small USB- or
   SRAM-based device that plugs into the ROM socket and lets you
   reflash without physical reprogramming) for fast iterate-test cycles
   during development.
3. **Use the expansion ROM socket(s) instead**, if you'd rather leave the
   original Loran-C ROMs in place and boot into new code via the existing
   `EXTROM_SIG`/`EXTROM_ENTRY` hook (checks for `A5H` at `2000H`, calls
   `2001H` if found) - lower effort if you want the *option* to still run
   the original firmware, higher effort if your new program needs more
   than 4 KB (the hook only gives you the expansion socket's own space;
   your code would still need to either fit in 4 KB or bank-switch
   further using the technique below).
4. **If 8 (or 12) KB isn't enough**, the PAL/CUPL decoder work in
   [pal-decoder.md](pal-decoder.md) is a real starting point for adding
   bank-switching: the PAL20R10 variant already has 2 spare outputs after
   the 8 chip-selects this project uses - wire one to a bank-select
   latch (e.g. a spare 8155 port bit) and you can page additional ROM
   banks into the same 4 KB window. Not designed or tested, but the
   decode logic and CUPL generation tooling (`src/emu/addr-decode.js`)
   are already there to extend.

## Memory/IO map for new firmware (unchanged from hardware.md)

| Range | What's there |
|---|---|
| `0000-0FFF` | ROM socket 1 (was NT3321) |
| `1000-1FFF` | ROM socket 2 (was NT3322) |
| `2000-2FFF` | Optional expansion ROM |
| `6F00-6FFF` | 8155 #1's 256 bytes RAM (mirrored through `6000-6FFF`) |
| `7000-70FF` | 8155 #2's 256 bytes RAM (mirrored through `7000-7FFF`) |
| `C000`/`C001` | 8251A USART (data/control) |
| `D000`/`D001` | 8279 keypad/display controller (data/command) |
| `E000-E005` | 8155 #1 registers (command/status, PA, PB, PC, timer lo/hi) |
| `F000-F005` | 8155 #2 registers (same layout) |

Full peripheral programming detail (command bytes, port bit meanings,
8279 sensor-matrix/display-RAM layout) is in
[hardware.md](hardware.md) and [front-panel.md](front-panel.md) - none of
it is Loran-specific, it's just how these three chip families are
programmed in general.

**One real constraint for new firmware:** no `IN`/`OUT` instructions are
used anywhere in the original firmware because everything is
memory-mapped (hardware.md) - that's a board wiring fact (the 8205
decoder's outputs feed chip-select, not the 8085's IO/M-qualified port
address space in the way `IN`/`OUT` would need), not a firmware choice, so
new code needs to follow the same memory-mapped-I/O convention.

## Concrete reuse project ideas

Picked for how well they fit the *exact* peripheral set already on the
board - not generic "any 8085 project" ideas.

### 1. Frequency / time-interval counter

The precision 10 MHz TCXO is a genuinely good timebase, and `RST 6.5`
is already a dedicated external "event happened" interrupt pin - exactly
the shape of a frequency counter's gate/count architecture (this is
functionally very close to what the *original* firmware already does with
that pin, just counting pulses instead of correlating phase codes). Feed
an external signal (buffered/conditioned) into `RST 6.5`, count events per
gate interval using one 8155 timer as the gate, display the result on the
existing 7-segment rows, and enter the desired gate time via the
thumbwheels. Needs: input conditioning circuitry (a comparator/Schmitt
trigger) ahead of `RST 6.5`, nothing else new.

### 2. Multi-drop remote instrument / data logger

`serial-protocol.md`'s existing addressing scheme (`ESC A <id>` to select
a unit on a shared line, `UNIT_ID` set from the front panel) is a solid,
already-designed multi-drop protocol - reuse the *idea* (or literally the
framing/addressing convention) for a bank of these boards each reporting
some sensor reading to a shared RS-422/485 bus, addressed and polled by a
host. The 8279's thumbwheels become the unit's local setpoint/threshold
entry, the display shows the current reading, and the two 8155s'
otherwise-idle parallel I/O ports read sensors or drive alarm outputs.

### 3. Vintage/homebrew computing trainer

Fully memory-mapped, fully documented (this whole project), with a
keypad and display already wired up - a genuinely good "here's a real
1979 industrial 8085 board, program it yourself" teaching platform, in
the spirit of classic single-board trainers (SDK-85, etc.) but with a
nicer front panel than most of those ever had. Pairs naturally with
[docs/emulator.md](emulator.md) - developing and testing on the emulator
first, then loading the same code onto real EPROMs, is a much faster
iteration loop than round-tripping a real board every time.

### 4. Amateur radio station accessory (clock, keyer, or rotator control)

The multi-drop serial port and the front panel's switches+display are a
good match for station-automation gear that traditionally gets built
around exactly this kind of controller: a UTC clock/net-timer (display +
a real-time clock chip added via the expansion socket or parallel I/O), a
CW keyer (thumbwheel-set speed, parallel-port key line), or an antenna
rotator controller (thumbwheel-set target heading, display of current
heading via feedback potentiometer through an added ADC). All of these
are traditionally hand-built one-off projects; this board already has the
input/output hardware such a project needs.

### 5. Process/annunciator panel

Thumbwheel-entered setpoints, a numeric display for the current process
value, and 14 bits of parallel I/O for relay/alarm outputs and contact
inputs - a workable shape for a simple industrial setpoint controller or
alarm annunciator, if you have (or add via the parallel I/O) whatever
sensor/actuator interface your process needs.

### 6. Serial protocol bridge / terminal

Simplest possible reuse: keep the multi-drop RS-422/485 side as-is and
write firmware that bridges it to something else entirely (a modern
serial device, a simple ASCII terminal using the display for local
echo/status) - minimal new firmware, mostly exercising the USART and
display.

## Harvested-parts and from-scratch breadboard projects

You don't need the assembled board at all for these - desolder (or just
buy fresh) the individual parts and breadboard them standalone.
[peripheral-pinouts.md](peripheral-pinouts.md) has the chip-level pin
tables you'd need.

### 7. A ground-up breadboard 8085 computer

The most direct "use the parts" project: breadboard the 8085 (U40) with
its own crystal/clock, a ROM/EPROM and some RAM, and build the system up
from nothing rather than reusing the assembled board's decode logic at
all. This project's own emulator (`src/emu/`) is a good companion here -
you get to choose your *own* memory map from scratch (see "What is the
max address space for I/O" below) rather than inheriting this board's,
and you can prototype firmware on the emulator before ever touching a
breadboard. Add the 8279 and/or an 8155 back in once the bare CPU is
running, using [peripheral-pinouts.md](peripheral-pinouts.md)'s tables -
this is literally how classic trainer boards (SDK-85 and similar) were
built, just with better documentation than most of those ever shipped
with.

One concrete design choice worth making deliberately for a from-scratch
build: the 8085 has two genuinely separate address spaces - up to 64 KB
memory-mapped (what this board's original firmware uses exclusively -
hardware.md: "No `IN`/`OUT` instructions appear anywhere") *or* a
completely separate 256-port I/O space addressed via `IN`/`OUT` (the
8-bit port number the 8085 puts on the bus during those instructions is
mirrored onto both halves of the 16-bit address bus, so a decoder only
needs to look at 8 lines to get the full 256 ports). A breadboard build
can use either or both - port-mapped I/O frees your entire 64 KB for
ROM/RAM if that matters to your project, at the cost of a much smaller
(256-device) I/O space.

### 8. Standalone 8279 keypad+display module

Just the 8279 plus a display and a switch/button matrix, driven by
*anything* with a parallel bus (another microcontroller, or the harvested
8085 itself) - a self-contained numeric-entry-and-readout front panel you
can bolt onto an unrelated project. [peripheral-pinouts.md](peripheral-pinouts.md)'s
8279 table is fully verified, so this is the lowest-risk single-chip reuse
here.

### 9. Standalone 8155 I/O+timer+RAM module

One 8155 gives a small microcontroller (or a bare breadboarded 8085) 256
bytes of RAM, 14 bits of parallel I/O, and a programmable timer in one
package - a compact "everything but the CPU" support chip for a minimal
system, independent of anything else on the original board.

## With two boards

Having a second, identical unit opens up projects that need two
independent nodes rather than one - the multi-drop protocol
([serial-protocol.md](serial-protocol.md)) was *designed* for exactly this
and has never actually been exercised with two real physical units talking
to each other.

### 10. Prove out the multi-drop protocol for real

The most direct dual-board project: reprogram both with the *original*
firmware (or a close variant), set different `UNIT_ID`s via the front
panel's config-item mode (front-panel.md), wire both onto one shared
RS-422/485 line, and drive them from a host issuing `ESC A <id>` to
address each in turn. This validates something that's only ever been
confirmed by reading the code, never by watching two real units share a
bus - the single most direct way to close the loop on
`serial-protocol.md`'s design.

### 11. Master/secondary pair for any of the single-board ideas above

Any of ideas 1-6 gets more interesting with two nodes: two frequency
counters cross-checking each other's count against a shared time base
(both TCXOs should agree closely - a nice way to characterize their
actual drift against each other), two data-logger nodes on one bus
demonstrating real addressed polling, or a "controller + remote display"
split where one board's front panel enters data that the *other* board's
display shows, sent over the multi-drop link - exercising the serial
protocol for something more interesting than diagnostics.

### 12. Redundant/failover controller

Run identical firmware on both, with one acting as a hot standby that
watches the multi-drop bus (or a direct line between the two) for the
primary's heartbeat and takes over the shared display/output duties if it
stops - a real (if small-scale) demonstration of a classic industrial
redundancy pattern, using hardware that's already there.

### 13. Double the address space or I/O, cleanly

If a single board's 8 KB ROM / 512 B RAM / 14 I/O bits genuinely isn't
enough for a project idea above, treating the second board as a
*coprocessor* - talking to the first over the serial link rather than
merging them into one bigger system - avoids inventing new shared-bus
hardware. Simpler and more reliable than trying to physically gang two
boards' address buses together, and it's exactly the multi-drop
architecture this firmware already assumes exists somewhere in the larger
Navtec system (hardware.md: "more system than this one board").

## Before you start

A few items from [hardware.md](hardware.md#physical-verification-checklist)
matter more for a reuse project than they did for understanding the
original firmware - worth confirming first if you're actually going to
build one of these:

- **Which 8155 is which** (checklist item 3) - matters if your new
  firmware's peripheral choices care which physical chip is `E000` vs.
  `F000`.
- **RST 7.5's source** (item 2) - if your new firmware wants a periodic
  timer tick (most of the project ideas above do), confirm it's really
  wired the way hardware.md guesses.
- **The 8205 (U45) output mapping** (item 4) - only matters if you're
  changing the address decode (e.g. adding bank-switching per the PAL
  section above); leave alone otherwise.
- **The crystal path** (item 1) - matters for anything timing-sensitive
  (the frequency-counter idea especially) - confirm the TCXO really
  drives the CPU directly at the assumed 5.000 MHz before relying on that
  number for a real measurement application.

Items about the U39/8212 conflict, the OPTION socket wiring, and the 8279
CLK source only matter if your chosen project needs the 8212 or the
expansion ROM socket specifically - skip them otherwise.

## What this document is not

Not a claim that any of this has been built, tested, or even attempted -
it's a proposal grounded in the confirmed hardware inventory, meant to
save whoever tries this the work of re-deriving "what's actually on this
board and how much of it is Loran-specific" from scratch. If you build one
of these, the emulator (`src/emu/`) is a reasonable place to prototype new
firmware before committing it to a real EPROM, once you adjust its
peripheral models for your new program's actual usage (it currently
assumes the original firmware's exact command bytes for the 8155s/8279 -
see [emulator-api.md](emulator-api.md) if you want to drive it
differently).
