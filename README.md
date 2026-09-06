# Navtec Loran-C receiver firmware (Intel 8085)

Disassembly, analysis and (eventually) rebuildable source for the firmware of a
Navtec single-board 8085 system. The two EPROMs, NT3321 and NT3322 (date code
7943), hold a Loran-C receiver program: phase-code search, master and secondary
tracking, packed-BCD time-difference arithmetic, a two-row digit display driven
by an 8279, thumbwheel GRI entry, and a serial port with a multi-drop protocol,
a memory monitor and a strip-chart plot mode.

**Status:** the dumps contain only the lower 2 KB of each 4 KB device. The
upper halves are referenced by the code and must be re-read before the firmware
can be rebuilt completely. See [docs/rom-status.md](docs/rom-status.md).

## Layout

| Path | Contents |
|---|---|
| `originals/` | the ROM images exactly as received (do not edit) |
| `disasm/nt3321-22.json` | disassembly hints: load map, entry points, labels, comments, data regions |
| `disasm/nt3321-22.lst` | generated listing (address, bytes, source, cross references) |
| `disasm/nt3321-22.asm` | generated re-assemblable source |
| `disasm/nt3321-22-refs.md` | generated cross-reference report (RAM, I/O, call graph) |
| `tools/dis8085.js` | flow-tracing 8085 disassembler (Node.js, no dependencies) |
| `tools/lstrange.sh` | print a listing address range |
| `docs/` | analysis documents (Markdown with embedded PlantUML) |

## Documents

| Document | Subject |
|---|---|
| [docs/hardware.md](docs/hardware.md) | chips, memory map, peripheral programming, interrupts, receiver interface |
| [docs/firmware.md](docs/firmware.md) | boot, interrupt coroutine, main phases, data structures |
| [docs/serial-protocol.md](docs/serial-protocol.md) | 8251 set-up, selection protocol, monitor commands, plot and report output |
| [docs/front-panel.md](docs/front-panel.md) | 8279 sensor matrix, thumbwheel decoding, set-up mode, display layout |
| [docs/ram-map.md](docs/ram-map.md) | every RAM variable with its working name |
| [docs/routines.md](docs/routines.md) | subroutine catalog |
| [docs/rom-status.md](docs/rom-status.md) | the missing ROM halves and how to recover them |

## Regenerating the listing

```
node tools/dis8085.js disasm/nt3321-22.json
```

Edit the JSON to add or rename labels, add comments, mark data, or declare
further entry points; the listing, source and report are regenerated from it.

## Rebuilding and verifying

```
sh tools/rebuild.sh
```

This assembles `disasm/nt3321-22.asm` with the Macroassembler AS (`asl`),
converts the result to a binary image filled with FFH, and compares it byte for
byte against the two originals. The current source rebuilds to an exact match
(0 differences over 8192 bytes).

The assembler is not checked in. Unpack a Windows build of AS into
`tools/asl/` so that `tools/asl/bin/asl.exe` and `tools/asl/bin/p2bin.exe`
exist. Builds are published at
`http://john.ccac.rwth-aachen.de:8000/ftp/as/precompiled/i386-unknown-win32/`
(the file used here was `aswcurr-142-bld311.zip`).

## Why a custom disassembler

NASM and the other x86 tools cannot read 8080/8085 code: the 8086 is not
binary compatible with the 8080, only source-translatable. The 8085-capable
options are Ghidra (needs a JDK), the dz80 disassembler from the d52 suite, and
hand-written scripts. The script in `tools/` was chosen because it is driven by
a single hints file, regenerates the listing, the source and the cross-reference
report together, and copes with the half-blank images. The assembler side uses
the standard native tool (AS) so that the rebuild is independent of the script.

## Hardware in one paragraph

Intel 8085 with two 2732-class EPROMs at 0000-1FFF, an optional expansion ROM
at 2000, two 8155s (512 bytes RAM at 6F00-70FF plus ports and timers at
E000/F000), an 8251A USART at C000 (7 data, odd parity, 2 stop; 110/300/1200/
19200 baud from the 8155 #2 timer) and an 8279 at D000 running six thumbwheels
and two buttons as a sensor matrix and a 7-position two-nibble display. RST 6.5
is the receiver sample strobe, RST 7.5 a periodic tick, RST 5.5 the 8279 IRQ.
All peripherals are memory mapped; there are no IN/OUT instructions.
