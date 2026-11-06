#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { capturePage, openCapturePage, launchMac, launchWine } from '../src/capture.js';
import { startDemo } from '../src/demo.js';
import { projectRoot } from '../src/paths.js';
import { errorMessage } from '../src/errors.js';
import { acquireRuntimeLock, createShutdownController, ShutdownError, throwIfAborted } from '../src/lifecycle.js';
import { saveCapture } from '../src/output.js';
import { runLiveCommands } from '../src/live.js';
import { diagnoseRuntime } from '../src/doctor.js';
import { settleWithin } from '../src/cleanup.js';
import type { BrowserSession, CapturePage, DemoServer, WineSession } from '../src/types.js';
import type { RuntimeLock } from '../src/lifecycle.js';

const shutdown = createShutdownController();
let demo: DemoServer | undefined;
let mac: BrowserSession | undefined;
let wine: WineSession | undefined;
let lock: RuntimeLock | undefined;
const tabs: CapturePage[] = [];
try {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    demo: { type: 'boolean' }, out: { type: 'string', default: 'captures' }, runtime: { type: 'string', default: join(projectRoot, '.runtime') },
    width: { type: 'string', default: '1280' }, height: { type: 'string', default: '900' }, delay: { type: 'string', default: '500' },
    selector: { type: 'string' }, 'mac-browser': { type: 'string' }, headed: { type: 'boolean' }, live: { type: 'boolean' }, open: { type: 'boolean' }, help: { type: 'boolean' }
  } });
  if (values.help) {
    console.log('Usage: node dist/bin/wineglass.js http://localhost:3000 [--out captures] [--open]\n       node dist/bin/wineglass.js --demo [--live]\n       node dist/bin/wineglass.js doctor [--runtime /path/to/runtime]\n\nOptions: --width 1280 --height 900 --selector "main" --delay 500\n         --mac-browser /path/to/Chromium --runtime /path/to/runtime\n         --headed --live --open --help\n\n--live: c + Enter captures current tabs; q or Enter closes.\nEvery capture is saved in a new subdirectory under --out.\nWindows captures use Windows Chromium on Wine, not a real Windows OS.');
  } else if (positionals[0] === 'doctor') {
    if (positionals.length !== 1 || values.demo || values.live) throw new Error('Use doctor [--runtime /path/to/runtime].');
    const result = await diagnoseRuntime(resolve(values.runtime), { signal: shutdown.signal });
    console.log(`Runtime: ${resolve(values.runtime)}\nNode: ${result.versions.node}\nWine: ${result.versions.wine ?? 'unavailable'}\nmacOS Chromium: ${result.versions.macChromium ?? 'unavailable'}\nSelected files checked: ${result.checkedFiles}`);
    for (const issue of result.issues) console.log(`${issue.severity.toUpperCase()} [${issue.component}] ${issue.message}`);
    console.log(result.ok ? 'Runtime diagnostics passed.' : 'Runtime needs attention. Run npm run setup:wine -- --repair to repair damaged components.');
    if (!result.ok) process.exitCode = 1;
  } else {
    if (process.platform !== 'darwin') throw new Error('This prototype runs on macOS.');
    if (positionals.length > (values.demo ? 0 : 1)) throw new Error('Provide one local URL, or --demo.');
    const width = Number(values.width), height = Number(values.height), delay = Number(values.delay);
    if (![width, height].every(n => Number.isInteger(n) && n >= 320 && n <= 4096) || !Number.isFinite(delay) || delay < 0 || delay > 30000) throw new Error('Use a viewport of 320–4096 pixels and a delay of 0–30000 ms.');
    if (values.demo) demo = await startDemo();
    const target = demo?.url ?? positionals[0];
    if (!target) throw new Error('Provide a local URL or --demo. See --help for usage.');
    const url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http:// or https:// URL.');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('This prototype only visits local development servers (localhost, 127.0.0.1 or ::1). Wine Chromium runs with --no-sandbox.');
    const runtime = resolve(values.runtime);
    const output = resolve(values.out);
    lock = await acquireRuntimeLock(runtime, { signal: shutdown.signal });
    console.log('Starting Windows Chromium under Wine…');
    wine = await launchWine({ runtime, headed: Boolean(values.headed || values.live), signal: shutdown.signal });
    console.log(`Wine log: ${wine.logPath}`);
    console.log('Starting native macOS Chromium…');
    mac = await launchMac({ executable: values['mac-browser'] || join(runtime, 'chromium-mac/chrome-mac/Chromium.app/Contents/MacOS/Chromium'), headed: Boolean(values.headed || values.live), signal: shutdown.signal });
    const options = { url: url.href, width, height, delay, ...(values.selector ? { selector: values.selector } : {}), signal: shutdown.signal };
    const macTab = await openCapturePage(mac.browser, { ...options, label: 'macOS native' });
    tabs.push(macTab);
    const wineTab = await openCapturePage(wine.browser, { ...options, label: 'Windows Chromium on Wine (approximation)' });
    tabs.push(wineTab);
    const recapture = async (): Promise<void> => {
      const saved = await saveCapture(output, async directory => {
        console.log('Capturing current macOS page…');
        const macCapture = await capturePage(macTab, { ...options, file: join(directory, 'macos.png') });
        console.log('Capturing current Windows Chromium / Wine page…');
        const wineCapture = await capturePage(wineTab, { ...options, file: join(directory, 'wine-windows.png') });
        return [macCapture, wineCapture];
      }, shutdown.signal);
      console.log(`Report: ${join(saved.directory, 'index.html')}\nPixel difference: ${saved.metadata.changedPercent}% (informational, not a compatibility score)`);
      if (values.open) {
        const opener = spawn('/usr/bin/open', [join(saved.directory, 'index.html')], { stdio: 'ignore' });
        opener.on('error', error => console.error(`Could not open report: ${errorMessage(error)}`));
        opener.unref();
      }
    };
    await recapture();
    if (values.live) {
      const terminal = createInterface({ input: process.stdin, output: process.stdout });
      terminal.on('SIGINT', () => process.emit('SIGINT'));
      try { await runLiveCommands(terminal, recapture, console.log, shutdown.signal); }
      finally { terminal.close(); }
    }
    throwIfAborted(shutdown.signal);
  }
} catch (error) {
  const reason = shutdown.signal.aborted ? shutdown.signal.reason : error;
  console.error(`WineGlass: ${errorMessage(reason)}`);
  process.exitCode = reason instanceof ShutdownError ? reason.exitCode : 1;
} finally {
  for (const tab of tabs) await settleWithin(tab.close());
  if (mac) await mac.close().catch(() => {});
  if (wine) await wine.close().catch(() => {});
  if (demo) await demo.close().catch(() => {});
  if (lock) await lock.release().catch(error => { console.error(`Could not release runtime: ${errorMessage(error)}`); process.exitCode ||= 1; });
  shutdown.dispose();
}
