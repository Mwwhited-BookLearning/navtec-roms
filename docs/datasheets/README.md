# Datasheet recreations

Own-words markdown versions (with PlantUML diagrams and tables) of the
datasheets for this board's main peripherals. Pin numbers and register
layouts were checked against the Intel scans; AC/DC timing tables are
abbreviated - use the originals for those.

| Part | File | Role on this board |
|---|---|---|
| 8085 | [8085.md](8085.md) | CPU (U40) |
| 8155H | [8155.md](8155.md) | I/O + RAM + timer (x2, E000 / F000) |
| 8205 | [8205.md](8205.md) | Address decoder (U45) |
| 8212 | [8212.md](8212.md) | 8-bit latch/port (U39, purpose unknown) |
| 8251A | [8251A.md](8251A.md) | Host serial port (C000) |
| 8279 | [8279.md](8279.md) | Keyboard/display controller (D000) |
| AM26LS32 | [AM26LS32.md](AM26LS32.md) | Quad differential line receiver |

All the board's identified peripheral ICs are now covered. Not covered: the
74-series counters/dividers (parts not yet read off the board), the TCXO and
the 8332 masked ROMs (see [../rom-status.md](../rom-status.md)). The 8205 and
8212 come from Intel's Component Data Catalog (Jan 1982); the AM26LS32 from
the TI AM26LS32A datasheet (compatible part). See
[../peripheral-pinouts.md](../peripheral-pinouts.md) for pins.
