import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, access, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadVerified, installDirectory, recoverReplacement, runInstaller } from '../src/install.js';
import { inspectRuntime, ORIGINAL_CHROME_SHA256, PATCHED_CHROME_SHA256 } from '../src/runtime.js';

const digest = (content: string) => createHash('sha256').update(content).digest('hex');
async function temporary(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'wineglass-install-'));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('corrupt cached downloads are replaced only after SHA-256 validation', async () => temporary(async directory => {
  const archive = join(directory, 'browser.zip');
  await writeFile(archive, 'corrupt');
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return new Response('verified archive'); };
  await downloadVerified('https://example.invalid/browser.zip', archive, digest('verified archive'), { fetcher });
  assert.equal(await readFile(archive, 'utf8'), 'verified archive');
  await downloadVerified('https://example.invalid/browser.zip', archive, digest('verified archive'), { fetcher });
  assert.equal(calls, 1, 'a verified cache avoids a second download');
}));

test('download checksum failure leaves the previous file and removes partial output', async () => temporary(async directory => {
  const archive = join(directory, 'browser.zip');
  await writeFile(archive, 'previous cache');
  const fetcher: typeof fetch = async () => new Response('truncated');
  await assert.rejects(downloadVerified('https://example.invalid/browser.zip', archive, digest('complete'), { fetcher }), /SHA-256 mismatch/);
  assert.equal(await readFile(archive, 'utf8'), 'previous cache');
  await assert.rejects(access(`${archive}.partial`));
}));

test('aborted download removes its partial file', async () => temporary(async directory => {
  const archive = join(directory, 'browser.zip');
  const controller = new AbortController();
  const fetcher: typeof fetch = async () => new Response(new ReadableStream<Uint8Array>({ start(stream) { stream.enqueue(new TextEncoder().encode('incomplete')); } }));
  const work = downloadVerified('https://example.invalid/browser.zip', archive, digest('complete'), { fetcher, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(new Error('cancel download')), 30);
  try { await assert.rejects(work); } finally { clearTimeout(timer); }
  await assert.rejects(access(archive));
  await assert.rejects(access(`${archive}.partial`));
}));

test('failed staging validation preserves the installed component', async () => temporary(async directory => {
  const component = join(directory, 'component');
  await mkdir(component); await writeFile(join(component, 'binary'), 'working');
  await assert.rejects(installDirectory(component, async staging => {
    await writeFile(join(staging, 'binary'), 'truncated'); return staging;
  }, async () => { throw new Error('invalid extraction'); }), /invalid extraction/);
  assert.equal(await readFile(join(component, 'binary'), 'utf8'), 'working');
  await assert.rejects(access(`${component}.wineglass-staging`));
  await assert.rejects(access(`${component}.wineglass-backup`));
}));

test('publication failure rolls the old component back', async () => temporary(async directory => {
  const component = join(directory, 'component');
  await mkdir(component); await writeFile(join(component, 'binary'), 'working');
  await assert.rejects(installDirectory(component, async staging => join(staging, 'missing'), async () => {}));
  assert.equal(await readFile(join(component, 'binary'), 'utf8'), 'working');
  await assert.rejects(access(`${component}.wineglass-backup`));
}));

test('interrupted replacement restores a backup and discards incomplete staging', async () => temporary(async directory => {
  const component = join(directory, 'component');
  await mkdir(`${component}.wineglass-backup`); await writeFile(join(`${component}.wineglass-backup`, 'binary'), 'working');
  await mkdir(`${component}.wineglass-staging`); await writeFile(join(`${component}.wineglass-staging`, 'binary'), 'incomplete');
  await recoverReplacement(component);
  assert.equal(await readFile(join(component, 'binary'), 'utf8'), 'working');
  await assert.rejects(access(`${component}.wineglass-staging`));
}));

test('runtime diagnostics identify missing files, invalid revision and changed shim', async () => temporary(async directory => {
  const browser = join(directory, 'chromium-win', 'chrome-win');
  await mkdir(browser, { recursive: true });
  await writeFile(join(directory, 'chromium-revision.txt'), 'wrong');
  await writeFile(join(browser, 'WGUI32.dll'), 'changed shim');
  await writeFile(join(browser, 'wineglass-compat.json'), JSON.stringify({ originalSHA256: ORIGINAL_CHROME_SHA256, patchedSHA256: PATCHED_CHROME_SHA256, shimSHA256: digest('original shim') }));
  const result = await inspectRuntime(directory);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some(issue => issue.code === 'missing_file' && issue.component === 'wine'));
  assert.ok(result.issues.some(issue => issue.code === 'revision_mismatch'));
  assert.ok(result.issues.some(issue => issue.code === 'hash_mismatch' && issue.component === 'shim'));
}));

test('aborted external install command is reaped', async () => {
  const controller = new AbortController();
  const work = runInstaller(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal });
  const timer = setTimeout(() => controller.abort(new Error('cancel installer')), 100);
  try { await assert.rejects(work, /cancel installer/); } finally { clearTimeout(timer); }
});

test('runtime diagnostics flag a native executable with missing execute permission', async () => temporary(async directory => {
  const bin = join(directory, 'Wine Devel.app/Contents/Resources/wine/bin');
  await mkdir(bin, { recursive: true });
  await writeFile(join(bin, 'wine'), 'fixture');
  await chmod(join(bin, 'wine'), 0o600);
  const result = await inspectRuntime(directory);
  assert.ok(result.issues.some(issue => issue.code === 'not_executable' && issue.component === 'wine'));
}));
