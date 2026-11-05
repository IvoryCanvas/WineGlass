import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, open } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';

async function unusedPort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const port = server.address().port;
  await new Promise(ok => server.close(ok));
  return port;
}

async function waitForCDP(port, process, logPath) {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null || process.signalCode !== null) throw new Error(`Wine/Chromium exited before CDP was ready. See ${logPath}`);
    try { const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(750) }); if (r.ok) return endpoint; } catch {}
    await new Promise(ok => setTimeout(ok, 400));
  }
  throw new Error(`Wine Chromium did not expose CDP within 90 seconds. See ${logPath}`);
}

export async function launchWine({ runtime, headed = false }) {
  const wine = process.env.WINE_BIN || join(runtime, 'Wine Devel.app/Contents/Resources/wine/bin/wine');
  const executable = process.env.WINDOWS_CHROMIUM || join(runtime, 'chromium-win/chrome-win/chrome.exe');
  for (const file of [wine, executable]) {
    try { await access(file); } catch { throw new Error(`Missing ${file}. Run node bin/setup-wine.mjs first, or set WINE_BIN and WINDOWS_CHROMIUM.`); }
  }
  const port = await unusedPort();
  const prefix = join(runtime, 'prefix');
  const logPath = join(runtime, 'wine.log');
  await mkdir(prefix, { recursive: true });
  const log = await open(logPath, 'w');
  const args = [executable, '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--user-data-dir=C:\\wineglass-browser', `--remote-debugging-port=${port}`, 'about:blank'];
  if (!headed) args.splice(1, 0, '--headless=new');
  const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: process.env.WINEGLASS_WINE_DEBUG || '-all,err+all', MVK_CONFIG_LOG_LEVEL: '0', WINEDLLOVERRIDES: 'mscoree,mshtml=' };
  const child = spawn(wine, args, { env, stdio: ['ignore', log.fd, log.fd] });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  let browser;
  const close = async () => {
    if (browser) { try { const cdp = await browser.newBrowserCDPSession(); await cdp.send('Browser.close'); } catch {} }
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    // This prefix belongs only to WineGlass. Stop its background Wine processes.
    try { await promisify(execFile)(join(dirname(wine), 'wineserver'), ['-k'], { env, timeout: 5000 }); } catch {}
    await log.close();
  };
  try {
    await new Promise(ok => setTimeout(ok, 150));
    if (spawnError) throw spawnError;
    const endpoint = await waitForCDP(port, child, logPath);
    browser = await chromium.connectOverCDP(endpoint);
    return { browser, close, logPath };
  } catch (error) { await close(); throw error; }
}

export async function launchMac({ executable, headed = false }) {
  const browser = await chromium.launch({ executablePath: executable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !headed, args: ['--disable-background-networking'] });
  return { browser, close: () => browser.close() };
}

export async function capture(browser, { url, file, width, height, label, selector, delay = 500, keepOpen = false }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light', reducedMotion: 'reduce' });
  let captured = false;
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await page.goto(url, { waitUntil: 'load' });
    if (response && !response.ok()) throw new Error(`Page returned HTTP ${response.status()}: ${url}`);
    if (selector) await page.locator(selector).first().waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    if (delay) await page.waitForTimeout(delay);
    const facts = await page.evaluate(() => ({
      url: location.href, platform: navigator.platform, userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scrollbarWidth: innerWidth - document.documentElement.clientWidth,
      bodyFont: getComputedStyle(document.body).fontFamily,
      documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    }));
    // CDP returns the fonts actually used for glyphs, unlike document.fonts.check().
    // Query each visible text-bearing node (up to a bounded 200-node sample).
    const cdp = await context.newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const document = await cdp.send('DOM.getDocument', { depth: -1 });
    const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: document.root.nodeId, selector: 'body *' });
    const fonts = new Map();
    for (const nodeId of nodeIds.slice(0, 200)) {
      try {
        const result = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
        for (const f of result.fonts) {
          const key = `${f.familyName}/${f.postScriptName}/${f.isCustomFont}`;
          const prev = fonts.get(key);
          fonts.set(key, { ...f, glyphCount: f.glyphCount + (prev?.glyphCount || 0) });
        }
      } catch {}
    }
    await page.screenshot({ path: resolve(file), animations: 'disabled', caret: 'hide', fullPage: false });
    captured = true;
    return { label, version: browser.version(), ...facts, platformFonts: [...fonts.values()], fontSampleLimit: 200, pageErrors: errors };
  } finally { if (!keepOpen || !captured) await context.close(); }
}
