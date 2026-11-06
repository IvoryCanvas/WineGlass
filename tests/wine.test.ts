import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { projectRoot } from '../src/paths.js';
import { chromium } from 'playwright';
import type { Browser } from 'playwright';

const runtime = process.env.WINEGLASS_TEST_RUNTIME;
function start(args: string[]) {
  const child = spawn(process.execPath, [join(projectRoot, 'dist/bin/wineglass.js'), ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += String(data); });
  child.stderr.on('data', data => { output += String(data); });
  const done = new Promise<number | null>((ok, fail) => { child.once('error', fail); child.once('exit', code => ok(code)); });
  return { child, done, output: () => output };
}
async function until(condition: () => boolean, output: () => string): Promise<void> {
  const deadline = Date.now() + 100000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`CLI timed out: ${output()}`);
    await delay(50);
  }
}

test('Wine CLI: live recapture, concurrency rejection, SIGINT and startup SIGTERM cleanup', { skip: !runtime, timeout: 180000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wineglass-wine-smoke-'));
  const runtimePath = resolve(runtime!);
  const viewer = start(['--demo', '--live', '--runtime', runtimePath, '--out', directory]);
  let inspector: Browser | undefined;
  try {
    await until(() => viewer.output().includes('Type c + Enter'), viewer.output);
    const first = await readdir(directory);
    assert.equal(first.length, 1);
    const logPath = /Wine log: ([^\r\n]+)/.exec(viewer.output())?.[1];
    assert.ok(logPath, viewer.output());
    const endpoint = /DevTools listening on (ws:\/\/[^\s]+)/.exec(await readFile(logPath, 'utf8'))?.[1];
    assert.ok(endpoint, 'Wine Chromium should expose its loopback DevTools endpoint');
    inspector = await chromium.connectOverCDP(endpoint);
    const page = inspector.contexts().flatMap(context => context.pages()).find(candidate => candidate.url().startsWith('http://127.0.0.1:'));
    assert.ok(page, 'the original Wine demo tab should remain open');
    await page.evaluate(() => {
      document.body.dataset.wineglassState = 'retained';
      document.body.style.backgroundColor = 'rgb(213, 37, 73)';
      localStorage.setItem('wineglass-session', 'retained');
    });
    const contender = start(['--demo', '--runtime', runtimePath, '--out', join(directory, 'contender')]);
    assert.equal(await contender.done, 1, contender.output());
    assert.match(contender.output(), /already in use/);
    viewer.child.stdin.write('c\n');
    await until(() => viewer.output().split('Type c + Enter').length === 3, viewer.output);
    const captures = await readdir(directory);
    assert.equal(captures.length, 2, viewer.output());
    assert.equal(await page.evaluate(() => document.body.dataset.wineglassState), 'retained');
    assert.equal(await page.evaluate(() => localStorage.getItem('wineglass-session')), 'retained');
    const second = captures.find(capture => !first.includes(capture));
    assert.ok(first[0] && second);
    assert.notDeepEqual(await readFile(join(directory, first[0], 'wine-windows.png')), await readFile(join(directory, second, 'wine-windows.png')));
    for (const capture of captures) {
      const metadata = JSON.parse(await readFile(join(directory, capture, 'metadata.json'), 'utf8')) as { captures: { platform: string; version: string }[] };
      assert.equal(metadata.captures[1]?.platform, 'Win32');
      assert.equal(metadata.captures[0]?.version, metadata.captures[1]?.version);
    }
    viewer.child.kill('SIGINT');
    assert.equal(await viewer.done, 130, viewer.output());
    await assert.rejects(access(join(runtimePath, '.wineglass-lock')));
    await promisify(execFile)(join(runtimePath, 'Wine Devel.app/Contents/Resources/wine/bin/wineserver'), ['-w'], { env: { ...process.env, WINEPREFIX: join(runtimePath, 'prefix') }, timeout: 5000 });
    const cancelled = start(['--demo', '--runtime', runtimePath, '--out', join(directory, 'cancelled')]);
    try {
      await until(() => cancelled.output().includes('Starting Windows Chromium'), cancelled.output);
      cancelled.child.kill('SIGTERM');
      assert.equal(await cancelled.done, 143, cancelled.output());
      await assert.rejects(access(join(runtimePath, '.wineglass-lock')));
      await assert.rejects(access(join(directory, 'cancelled')));
    } finally {
      if (cancelled.child.exitCode === null && cancelled.child.signalCode === null) cancelled.child.kill('SIGTERM');
      await cancelled.done;
    }
  } finally {
    await inspector?.close().catch(() => {});
    if (viewer.child.exitCode === null && viewer.child.signalCode === null) viewer.child.kill('SIGTERM');
    await viewer.done;
    await rm(directory, { recursive: true, force: true });
  }
});
