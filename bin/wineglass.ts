#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { capture, launchMac, launchWine } from '../src/capture.js';
import { writeReport } from '../src/report.js';
import { startDemo } from '../src/demo.js';
import { projectRoot } from '../src/paths.js';
import { errorMessage } from '../src/errors.js';
import type { BrowserSession, DemoServer, WineSession } from '../src/types.js';

const root = projectRoot;
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  demo: { type: 'boolean' }, out: { type: 'string', default: 'captures' }, runtime: { type: 'string', default: join(root, '.runtime') },
  width: { type: 'string', default: '1280' }, height: { type: 'string', default: '900' }, delay: { type: 'string', default: '500' },
  selector: { type: 'string' }, 'mac-browser': { type: 'string' }, headed: { type: 'boolean' }, live: { type: 'boolean' }, open: { type: 'boolean' }, help: { type: 'boolean' }
} });
if (values.help) {
  console.log('Usage: node dist/bin/wineglass.js http://localhost:3000 [--out captures] [--open]\n       node dist/bin/wineglass.js --demo [--open]\n\nOptions: --width 1280 --height 900 --selector "main" --delay 500 --live\n         --mac-browser /path/to/Chromium --runtime /path/to/runtime\n\n--live keeps both browser windows open until you press Enter.\nWindows captures use Windows Chromium on Wine, not a real Windows OS.');
  process.exit(0);
}

let demo: DemoServer | undefined;
let mac: BrowserSession | undefined;
let wine: WineSession | undefined;
try {
  if (process.platform !== 'darwin') throw new Error('This prototype runs on macOS.');
  if (values.demo) demo = await startDemo();
  const target = demo?.url ?? positionals[0];
  if (!target) throw new Error('Provide a local URL or --demo. See --help for usage.');
  const url = new URL(target);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http:// or https:// URL.');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('This prototype only visits local development servers (localhost, 127.0.0.1 or ::1). Wine Chromium runs with --no-sandbox.');
  const width = Number(values.width), height = Number(values.height), delay = Number(values.delay);
  if (![width, height].every(n => Number.isInteger(n) && n >= 320 && n <= 4096) || !Number.isFinite(delay) || delay < 0 || delay > 30000) throw new Error('Use a viewport of 320–4096 pixels and a delay of 0–30000 ms.');
  const output = resolve(values.out);
  await mkdir(output, { recursive: true });
  console.log('Starting Windows Chromium under Wine…');
  const runtime = resolve(values.runtime);
  wine = await launchWine({ runtime, headed: Boolean(values.headed || values.live) });
  console.log('Starting native macOS Chromium…');
  mac = await launchMac({ executable: values['mac-browser'] || join(runtime, 'chromium-mac/chrome-mac/Chromium.app/Contents/MacOS/Chromium'), headed: Boolean(values.headed || values.live) });
  const options = { url: url.href, width, height, delay, ...(values.selector ? { selector: values.selector } : {}), keepOpen: Boolean(values.live) };
  // Run sequentially so both browsers do not compete for rendering resources.
  console.log('Capturing macOS…');
  const macCapture = await capture(mac.browser, { ...options, label: 'macOS native', file: join(output, 'macos.png') });
  console.log('Capturing Windows Chromium / Wine…');
  const wineCapture = await capture(wine.browser, { ...options, label: 'Windows Chromium on Wine (approximation)', file: join(output, 'wine-windows.png') });
  const report = await writeReport(output, [macCapture, wineCapture]);
  console.log(`Report: ${join(output, 'index.html')}\nPixel difference: ${report.changedPercent}% (informational, not a compatibility score)`);
  if (values.open) { const opener = spawn('/usr/bin/open', [join(output, 'index.html')], { stdio: 'ignore' }); opener.unref(); }
  if (values.live) {
    const terminal = createInterface({ input: process.stdin, output: process.stdout });
    try { await terminal.question('Both browsers are open for inspection. Press Enter to close them. '); }
    finally { terminal.close(); }
  }
} catch (error) {
  console.error(`WineGlass: ${errorMessage(error)}`);
  process.exitCode = 1;
} finally {
  if (mac) await mac.close().catch(() => {});
  if (wine) await wine.close().catch(() => {});
  if (demo) await demo.close();
}
