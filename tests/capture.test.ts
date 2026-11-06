import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchMac, openCapturePage, capturePage } from '../src/capture.js';

const executable = process.env.WINEGLASS_TEST_BROWSER;
test('native browser: cancellation during launch retains ownership until cleanup', { skip: !executable }, async () => {
  const controller = new AbortController();
  const launch = launchMac({ executable: executable!, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(new Error('cancel native startup')), 10);
  try { await assert.rejects(launch, /cancel native startup/); }
  finally { clearTimeout(timer); }
});

test('native browser: HTTP failure, readiness timeout, current-state recapture and abort cleanup', { skip: !executable }, async () => {
  const output = await mkdtemp(join(tmpdir(), 'wineglass-browser-'));
  const server = createServer((request, response) => {
    if (request.url === '/fail') { response.writeHead(503).end('Unavailable'); return; }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end('<html><body><button id="button">Change state</button><div id="state">Initial</div><script>window.loads = (window.loads || 0) + 1; document.querySelector("button").onclick = () => {document.querySelector("#state").textContent = "Changed"; document.body.style.background = "red"; localStorage.setItem("session", "retained");};</script></body></html>');
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const browser = await launchMac({ executable: executable! });
  try {
    await assert.rejects(openCapturePage(browser.browser, { url: `${url}/fail`, width: 320, height: 320, label: 'test' }), /503/);
    assert.equal(browser.browser.contexts().length, 0);
    const page = await openCapturePage(browser.browser, { url, width: 320, height: 320, label: 'test' });
    await capturePage(page, { file: join(output, 'before.png'), delay: 0 });
    await page.page.click('#button');
    await capturePage(page, { file: join(output, 'after.png'), delay: 0 });
    assert.notDeepEqual(await readFile(join(output, 'before.png')), await readFile(join(output, 'after.png')));
    assert.equal(await page.page.locator('#state').textContent(), 'Changed');
    assert.equal(await page.page.evaluate(() => localStorage.getItem('session')), 'retained');
    await assert.rejects(capturePage(page, { file: join(output, 'missing.png'), selector: '#absent', timeout: 50 }), /Timeout/);
    assert.ok(!page.page.isClosed());
    const controller = new AbortController();
    const waiting = capturePage(page, { file: join(output, 'cancelled.png'), selector: '#absent', signal: controller.signal });
    controller.abort(new Error('cancelled wait'));
    await assert.rejects(waiting, /cancelled wait/);
    assert.equal(browser.browser.contexts().length, 0);
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise<void>(ok => server.close(() => ok()));
    await rm(output, { recursive: true, force: true });
  }
});
