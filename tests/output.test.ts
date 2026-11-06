import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { saveCapture } from '../src/output.js';
import { runLiveCommands } from '../src/live.js';
import type { CaptureMetadata, CapturePair } from '../src/types.js';

function metadata(platform: string, url = 'http://localhost:3000/'): CaptureMetadata {
  return { label: platform, version: '159.0.8144.0', url, platform, userAgent: 'test', viewport: { width: 320, height: 320, devicePixelRatio: 1 }, scrollbarWidth: 0, bodyFont: 'system-ui', documentSize: { width: 320, height: 320 }, platformFonts: [], fontSampleLimit: 200, pageErrors: [] };
}
async function collect(directory: string, differentSize = false): Promise<CapturePair> {
  const image = new PNG({ width: 320, height: 320 });
  image.data.fill(255);
  await writeFile(join(directory, 'macos.png'), PNG.sync.write(image));
  await writeFile(join(directory, 'wine-windows.png'), PNG.sync.write(differentSize ? new PNG({ width: 321, height: 320 }) : image));
  return [metadata('MacIntel'), metadata('Win32')];
}

test('complete captures publish independently; failed capture and comparison preserve previous reports', async () => {
  const output = await mkdtemp(join(tmpdir(), 'wineglass-output-'));
  try {
    const first = await saveCapture(output, collect);
    const original = await readFile(join(first.directory, 'index.html'), 'utf8');
    await assert.rejects(saveCapture(output, async directory => {
      await writeFile(join(directory, 'macos.png'), 'partial');
      throw new Error('Windows tab crashed');
    }), /Windows tab crashed/);
    await assert.rejects(saveCapture(output, directory => collect(directory, true)), /dimensions differ/);
    assert.equal(await readFile(join(first.directory, 'index.html'), 'utf8'), original);
    assert.equal((await readdir(output)).length, 1);
    const second = await saveCapture(output, collect);
    assert.notEqual(first.directory, second.directory);
    assert.equal(second.metadata.changedPixels, 0);
    assert.deepEqual((await readdir(second.directory)).sort(), ['difference.png', 'index.html', 'macos.png', 'metadata.json', 'wine-windows.png']);
    assert.equal((await readdir(output)).length, 2);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('cancellation before publication removes staging and keeps prior output', async () => {
  const output = await mkdtemp(join(tmpdir(), 'wineglass-cancel-output-'));
  const controller = new AbortController();
  try {
    const first = await saveCapture(output, collect);
    await assert.rejects(saveCapture(output, async directory => {
      const pair = await collect(directory);
      controller.abort(new Error('cancel capture'));
      return pair;
    }, controller.signal), /cancel capture/);
    assert.deepEqual(await readdir(output), [first.directory.slice(output.length + 1)]);
  } finally { await rm(output, { recursive: true, force: true }); }
});

test('report escapes captured URLs and distinguishes sample observations from installed-font checks', async () => {
  const output = await mkdtemp(join(tmpdir(), 'wineglass-report-'));
  try {
    const result = await saveCapture(output, async directory => {
      await collect(directory);
      return [metadata('MacIntel', 'http://localhost:3000/?x=<script>attack</script>'), { ...metadata('Win32'), version: 'another' }];
    });
    const html = await readFile(join(result.directory, 'index.html'), 'utf8');
    assert.ok(!html.includes('<script>attack</script>'));
    assert.ok(html.includes('&lt;script&gt;attack&lt;/script&gt;'));
    assert.ok(html.includes('두 탭의 URL이 다릅니다'));
    assert.ok(html.includes('브라우저 버전이 다릅니다'));
    assert.ok(html.includes('설치 여부를 판정하는 검사는 아닙니다'));
  } finally { await rm(output, { recursive: true, force: true }); }
});

async function* commands(...lines: string[]): AsyncIterable<string> { yield* lines; }

test('live commands retry a failed capture and close without an extra capture', async () => {
  let calls = 0;
  const messages: string[] = [];
  await runLiveCommands(commands('unknown', 'c', 'capture', 'q', 'c'), async () => {
    if (++calls === 1) throw new Error('tab not ready');
  }, message => messages.push(message));
  assert.equal(calls, 2);
  assert.ok(messages.some(message => message.includes('tab not ready') && message.includes('Previous reports are unchanged')));
});

test('live wait stops promptly when interrupted', async () => {
  const controller = new AbortController();
  const pending: AsyncIterable<string> = { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) };
  const operation = runLiveCommands(pending, async () => {}, () => {}, controller.signal);
  controller.abort(new Error('stop viewer'));
  await assert.rejects(operation, /stop viewer/);
});
