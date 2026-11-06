import { chromium } from 'playwright';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, open, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChildProcess } from 'node:child_process';
import type { Browser } from 'playwright';
import type { BrowserSession, CaptureMetadata, CaptureOptions, CapturePage, PlatformFont, WineSession } from './types.js';
import { abortable, throwIfAborted } from './lifecycle.js';
import { settleWithin } from './cleanup.js';

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const address = server.address();
  await new Promise<void>((ok, fail) => server.close(error => error ? fail(error) : ok()));
  if (!address || typeof address === 'string') throw new Error('No TCP address was assigned.');
  return address.port;
}

async function waitForCDP(port: number, child: ChildProcess, logPath: string, signal?: AbortSignal): Promise<string> {
  const endpoint = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Wine/Chromium exited before CDP was ready. See ${logPath}`);
    try {
      const response = await fetch(`${endpoint}/json/version`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(750)]) : AbortSignal.timeout(750) });
      if (response.ok) return endpoint;
    } catch { throwIfAborted(signal); }
    await delay(400, undefined, signal ? { signal } : {});
  }
  throw new Error(`Wine Chromium did not expose CDP within 90 seconds. See ${logPath}`);
}

// The caller holds the runtime lock until close() completes.
export async function launchWine({ runtime, headed = false, signal }: { runtime: string; headed?: boolean; signal?: AbortSignal }): Promise<WineSession> {
  throwIfAborted(signal);
  const wine = process.env.WINE_BIN || join(runtime, 'Wine Devel.app/Contents/Resources/wine/bin/wine');
  const executable = process.env.WINDOWS_CHROMIUM || join(runtime, 'chromium-win/chrome-win/chrome.exe');
  for (const file of [wine, executable]) {
    try { await access(file); } catch { throw new Error(`Missing ${file}. Run npm run setup:wine first, or set WINE_BIN and WINDOWS_CHROMIUM.`); }
  }
  const port = await unusedPort();
  const prefix = join(runtime, 'prefix');
  const logs = join(runtime, 'logs');
  await mkdir(prefix, { recursive: true });
  await mkdir(logs, { recursive: true });
  const runId = `${Date.now()}-${randomUUID()}`;
  const logPath = join(logs, `${runId}.log`);
  const args = [executable, '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', `--user-data-dir=C:\\wineglass-sessions\\${runId}`, `--remote-debugging-port=${port}`, 'about:blank'];
  if (!headed) args.splice(1, 0, '--headless=new');
  const env = { ...process.env, WINEPREFIX: prefix, WINEDEBUG: process.env.WINEGLASS_WINE_DEBUG || '-all,err+all', MVK_CONFIG_LOG_LEVEL: '0', WINEDLLOVERRIDES: 'mscoree,mshtml=' };
  // Recover this prefix's processes after an earlier uncatchable termination.
  try { await promisify(execFile)(join(dirname(wine), 'wineserver'), ['-k'], { env, timeout: 5000 }); } catch {}
  throwIfAborted(signal);
  const log = await open(logPath, 'wx');
  const child = spawn(wine, args, { env, stdio: ['ignore', log.fd, log.fd] });
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    try {
      if (browser) {
        await settleWithin(browser.close({ reason: 'WineGlass session ended' }));
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      // The exclusive runtime lock protects this WineGlass-owned prefix.
      try { await promisify(execFile)(join(dirname(wine), 'wineserver'), ['-k'], { env, timeout: 5000 }); } catch {}
      try { await promisify(execFile)(join(dirname(wine), 'wineserver'), ['-w'], { env, timeout: 5000 }); } catch {}
      if (child.exitCode === null && child.signalCode === null) {
        await Promise.race([new Promise<void>(ok => child.once('exit', () => ok())), delay(1500)]);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    } finally {
      await log.close();
      await rm(join(prefix, 'drive_c', 'wineglass-sessions', runId), { recursive: true, force: true });
    }
  })();
  try {
    await delay(150, undefined, signal ? { signal } : {});
    if (spawnError) throw spawnError;
    const endpoint = await waitForCDP(port, child, logPath, signal);
    const connecting = chromium.connectOverCDP(endpoint, { timeout: 15000 });
    void connecting.then(async connected => { if (signal?.aborted) await connected.close().catch(() => {}); }, () => {});
    browser = await abortable(connecting, signal);
    throwIfAborted(signal);
    return { browser, close, logPath };
  } catch (error) { await close(); throw error; }
}

export async function launchMac({ executable, headed = false, signal }: { executable?: string; headed?: boolean; signal?: AbortSignal }): Promise<BrowserSession> {
  throwIfAborted(signal);
  const launching = chromium.launchServer({ executablePath: executable || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: !headed, args: ['--disable-background-networking'], timeout: 30000, handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false });
  const stopServer = async (server: Awaited<typeof launching>): Promise<void> => {
    await settleWithin(server.close());
    const child = server.process();
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
    await settleWithin(server.kill());
  };
  const server = await abortable(launching, signal).catch(async (error: unknown) => {
    // Retain ownership until an in-progress launch yields a handle or times out.
    await launching.then(stopServer, () => {});
    throw error;
  });
  let browser: Browser | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    if (browser) await settleWithin(browser.close());
    await stopServer(server);
  })();
  try {
    browser = await abortable(chromium.connect(server.wsEndpoint(), { timeout: 15000 }), signal);
    throwIfAborted(signal);
    return { browser, close };
  } catch (error) { await close(); throw error; }
}

export async function openCapturePage(browser: Browser, { url, width, height, label, signal, timeout = 30000 }: Omit<CaptureOptions, 'file'>): Promise<CapturePage> {
  throwIfAborted(signal);
  const creating = browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light', reducedMotion: 'reduce' });
  void creating.then(async context => { if (signal?.aborted) await settleWithin(context.close()); }, () => {});
  const context = await abortable(creating, signal);
  try {
    const page = await abortable(context.newPage(), signal);
    page.setDefaultTimeout(timeout);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const response = await abortable(page.goto(url, { waitUntil: 'load' }), signal);
    if (response && !response.ok()) throw new Error(`Page returned HTTP ${response.status()}: ${url}`);
    return { browser, context, page, label, errors, close: () => context.close() };
  } catch (error) { await settleWithin(context.close()); throw error; }
}

export async function capturePage(session: CapturePage, { file, selector, delay: settle = 500, signal, timeout = 30000 }: Pick<CaptureOptions, 'file' | 'selector' | 'delay' | 'signal' | 'timeout'>): Promise<CaptureMetadata> {
  const { page, browser, label, errors, context } = session;
  throwIfAborted(signal);
  if (page.isClosed()) throw new Error(`${label}: the original capture tab is closed. Restart WineGlass to select a new page.`);
  const operation = (async () => {
    if (selector) await page.locator(selector).first().waitFor({ state: 'visible', timeout });
    await page.waitForFunction(() => document.fonts.status === 'loaded', undefined, { timeout });
    if (settle) await page.waitForTimeout(settle);
    const facts = await page.evaluate(() => ({
      url: location.href, platform: navigator.platform, userAgent: navigator.userAgent,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      scrollbarWidth: innerWidth - document.documentElement.clientWidth,
      bodyFont: getComputedStyle(document.body).fontFamily,
      documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    }));
    const cdp = await context.newCDPSession(page);
    const fonts = new Map<string, PlatformFont>();
    try {
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const dom = await cdp.send('DOM.getDocument', { depth: -1 });
      const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: dom.root.nodeId, selector: 'body *' });
      for (const nodeId of nodeIds.slice(0, 200)) {
        try {
          const result = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
          for (const font of result.fonts) {
            const key = `${font.familyName}/${font.postScriptName}/${font.isCustomFont}`;
            const previous = fonts.get(key);
            fonts.set(key, { ...font, glyphCount: font.glyphCount + (previous?.glyphCount || 0) });
          }
        } catch { throwIfAborted(signal); }
      }
    } finally { await cdp.detach().catch(() => {}); }
    await page.screenshot({ path: resolve(file), animations: 'disabled', caret: 'hide', fullPage: false, timeout });
    return { label, version: browser.version(), ...facts, platformFonts: [...fonts.values()], fontSampleLimit: 200, pageErrors: [...errors] };
  })();
  try { return await abortable(operation, signal); }
  catch (error) {
    if (signal?.aborted) await settleWithin(session.close());
    throw error;
  }
}

export async function capture(browser: Browser, options: CaptureOptions): Promise<CaptureMetadata> {
  const session = await openCapturePage(browser, options);
  try { return await capturePage(session, options); }
  finally { await settleWithin(session.close()); }
}
