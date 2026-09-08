# Web emulator playbooks

Step-by-step walkthroughs of the [web front end](../web-emulator.md), each
with real screenshots captured from a running instance. These are usage
guides, not test specs - if you change `src/emu/web/index.html` enough that
a flow no longer matches, regenerate the screenshots (see "Regenerating"
below) rather than hand-editing the images.

- [boot-and-display.md](boot-and-display.md) - starting the server, the
  power-up lamp test, and reading the 7-segment display.
- [front-panel-controls.md](front-panel-controls.md) - dialing in thumbwheel
  switches and the two push buttons.
- [serial-console.md](serial-console.md) - the periodic report, the
  quick-key control characters, and the firmware's own memory monitor.
- [receiver-front-end.md](receiver-front-end.md) - switching the synthetic
  Loran-C signal between master/secondary and adding noise.
- [machine-control.md](machine-control.md) - pause, resume, reset, and what
  reset does and doesn't clear.
- [loran-position-fix.md](loran-position-fix.md) - the illustrative
  hyperbolic position-fix map, and why it's a demonstration of the
  technique rather than a real position.

## Regenerating the screenshots

```sh
npm install               # once, installs the playwright devDependency
npx playwright install chromium   # once, downloads the browser binary
node src/emu/playbooks/capture.js
```

`capture.js` starts its own `web-emu.js` on port 8532 (so it won't collide
with one you already have running on the default port), drives a headless
Chromium through every flow below, and overwrites everything in
`docs/playbooks/screenshots/`. It takes about 15 seconds. See
`src/emu/playbooks/capture.js` for exactly which UI elements it clicks.
