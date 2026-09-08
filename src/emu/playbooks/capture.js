#!/usr/bin/env node
'use strict';
/*
 * capture.js -- drives the web emulator (src/emu/web-emu.js) through the
 * user flows documented in docs/playbooks/*.md with Playwright, saving a
 * screenshot at each step into docs/playbooks/screenshots/.
 *
 * Usage: node src/emu/playbooks/capture.js
 *
 * Requires the "playwright" devDependency and its Chromium browser to be
 * installed (see the repo root package.json / `npx playwright install
 * chromium`). Not part of the normal build -- run manually whenever the UI
 * changes enough that the playbooks' screenshots go stale.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const base = path.resolve(__dirname, '..', '..', '..');
const shotDir = path.join(base, 'docs', 'playbooks', 'screenshots');
fs.mkdirSync(shotDir, { recursive: true });

const PORT = 8532;
const URL = `http://localhost:${PORT}/`;

function waitForServer(url, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      fetch(url).then(() => resolve()).catch(() => {
        if (Date.now() - start > timeoutMs) reject(new Error('server did not come up in time'));
        else setTimeout(tryOnce, 200);
      });
    };
    tryOnce();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  const server = spawn(process.execPath, [path.join(base, 'src', 'emu', 'web-emu.js'), '--port', String(PORT)], {
    cwd: base, stdio: ['ignore', 'ignore', 'inherit'],
  });
  const stop = () => { try { server.kill(); } catch (e) { /* already gone */ } };
  process.on('exit', stop);

  try {
    await waitForServer(`http://localhost:${PORT}/api/state`, 10000);

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1180, height: 1000 } });
    await page.goto(URL);
    await page.waitForTimeout(500);

    async function shot(name) {
      await page.screenshot({ path: path.join(shotDir, name), fullPage: true });
      console.error(`capture: wrote ${name}`);
    }

    // ---- 01: fresh boot ----
    await shot('01-boot.png');

    // ---- 02: steady state after self-test/lamp-test settles, reports flowing ----
    await page.waitForTimeout(3000);
    await shot('02-steady-state.png');

    // ---- 03/04: front-panel switches ----
    await shot('03-switches-default.png');
    const gri4 = page.locator('.wheel').nth(5); // SEL A, SEL B, GRI1, GRI2, GRI3, GRI4 -> index 5
    for (let i = 0; i < 3; i++) {
      await gri4.getByRole('button', { name: '+', exact: true }).click();
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(300);
    await shot('04-switches-changed.png');

    // ---- 05: push button ----
    const btnA = page.locator('#btnA');
    await btnA.dispatchEvent('mousedown');
    await page.waitForTimeout(200);
    await shot('05-button-pressed.png');
    await btnA.dispatchEvent('mouseup');
    await page.waitForTimeout(200);

    // ---- 06: serial quick-keys ----
    await page.locator('button[data-ch="27"]').click(); // ESC
    await page.waitForTimeout(100);
    await page.fill('#serialIn', ',0');
    await page.locator('#serialIn').press('Enter');
    await page.waitForTimeout(500);
    await shot('06-serial-quickkeys.png');

    // ---- 07: serial monitor memory dump (read-only: examine 7034, no 'G') ----
    await page.fill('#serialIn', '7034S');
    await page.locator('#serialIn').press('Enter');
    await page.waitForTimeout(300);
    await page.fill('#serialIn', 'M');
    await page.locator('#serialIn').press('Enter');
    await page.waitForTimeout(1000);
    await shot('07-serial-monitor-dump.png');
    // leave monitor mode so the rest of the demo goes back to normal reporting
    await page.fill('#serialIn', String.fromCharCode(18)); // DC2 reset
    await page.locator('#serialIn').press('Enter');

    // ---- 08/09: receiver panel ----
    await shot('08-receiver-default.png');
    await page.locator('input[name=rxmode][value=secondary]').check();
    const noise = page.locator('#noise');
    await noise.fill('40');
    await noise.dispatchEvent('input');
    await page.waitForTimeout(1500);
    await shot('09-receiver-secondary-noise.png');

    // ---- 10/11: machine control ----
    await page.locator('#btnPause').click();
    await page.waitForTimeout(300);
    await shot('10-paused.png');
    await page.locator('#btnRun').click();
    await page.waitForTimeout(200);
    await page.locator('#btnReset').click();
    await page.waitForTimeout(300);
    await shot('11-reset.png');

    // ---- 12/13: position map ----
    // Restore GRI 9940 (changed to 9943 back in the switches step) so the
    // chain lookup in loran-chains.js actually finds station geometry.
    await gri4.getByRole('button', { name: '-', exact: true }).click();
    await gri4.getByRole('button', { name: '-', exact: true }).click();
    await gri4.getByRole('button', { name: '-', exact: true }).click();
    await page.waitForTimeout(200);
    await shot('12-loran-no-fix.png'); // display isn't showing valid BCD digits yet even so
    await page.fill('#ovTdA', '27939.0');
    await page.fill('#ovTdB', '31500.5');
    await page.locator('#ovApply').click();
    await page.waitForTimeout(500);
    await shot('13-loran-manual-fix.png');
    await page.locator('#ovClear').click();
    await page.waitForTimeout(200);

    await browser.close();
    console.error('capture: done');
  } finally {
    stop();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
