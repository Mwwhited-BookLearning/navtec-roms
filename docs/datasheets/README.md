# Datasheet recreations

Own-words markdown versions (with PlantUML diagrams and tables) of the
datasheets for this board's main peripherals. Pin numbers and register
layouts were checked against the Intel scans; AC/DC timing tables are
abbreviated - use the originals for those.

| Part | File | Role on this board |
|---|---|---|
| 8155H | [8155.md](8155.md) | I/O + RAM + timer (x2, E000 / F000) |
| 8251A | [8251A.md](8251A.md) | Host serial port (C000) |
| 8279 | [8279.md](8279.md) | Keyboard/display controller (D000) |

Not yet written (no readable source found): 8085, 8205, 8212, AM26LS32.
See [../peripheral-pinouts.md](../peripheral-pinouts.md) for their pins.
