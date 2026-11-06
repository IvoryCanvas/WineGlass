import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { abortable, acquireRuntimeLock } from '../src/lifecycle.js';

const lifecycleUrl = new URL('../src/lifecycle.js', import.meta.url).href;

async function temporaryRuntime(t: TestContext): Promise<string> {
  const runtime = await mkdtemp(join(tmpdir(), 'wineglass-lock-'));
  t.after(() => rm(runtime, { recursive: true, force: true }));
  return runtime;
}

async function childReady(child: ChildProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`Child did not become ready: ${output}`)); }, 5000);
    const cleanup = () => { clearTimeout(timeout); child.stdout?.off('data', data); child.off('exit', exited); child.off('error', failed); };
    const data = (chunk: Buffer) => { output += chunk.toString(); if (output.includes('ready\n')) { cleanup(); resolve(); } };
    const exited = () => { cleanup(); reject(new Error(`Child exited before readiness: ${output}`)); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    child.stdout?.on('data', data);
    child.once('exit', exited);
    child.once('error', failed);
  });
}

test('concurrent acquisition admits one owner and release is idempotent', async t => {
  const runtime = await temporaryRuntime(t);
  const results = await Promise.allSettled([acquireRuntimeLock(runtime), acquireRuntimeLock(runtime)]);
  const owners = results.filter(result => result.status === 'fulfilled');
  assert.equal(owners.length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const owner = owners[0];
  assert.ok(owner && owner.status === 'fulfilled');
  await owner.value.release();
  await owner.value.release();
  const next = await acquireRuntimeLock(runtime);
  await next.release();
  assert.deepEqual(await readdir(runtime), []);
});

test('a lease left by a killed process is recovered', async t => {
  const runtime = await temporaryRuntime(t);
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { acquireRuntimeLock } from ${JSON.stringify(lifecycleUrl)};
    await acquireRuntimeLock(${JSON.stringify(runtime)});
    console.log('ready');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  await childReady(child);
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  const lease = await acquireRuntimeLock(runtime);
  await lease.release();
  assert.deepEqual(await readdir(runtime), []);
});

test('an old release never deletes a replacement owner', async t => {
  const runtime = await temporaryRuntime(t);
  const old = await acquireRuntimeLock(runtime);
  const lockPath = join(runtime, '.wineglass-lock');
  await rm(lockPath, { recursive: true });
  const replacement = await acquireRuntimeLock(runtime);
  const before = await readdir(lockPath);
  await old.release();
  assert.deepEqual(await readdir(lockPath), before);
  await assert.rejects(acquireRuntimeLock(runtime), /already in use/);
  await replacement.release();
});

test('invalid ownership is preserved instead of being reclaimed', async t => {
  const runtime = await temporaryRuntime(t);
  const lockPath = join(runtime, '.wineglass-lock');
  await mkdir(lockPath);
  const name = `owner-${randomUUID()}.json`;
  await writeFile(join(lockPath, name), '{incomplete');
  await assert.rejects(acquireRuntimeLock(runtime), /incomplete or invalid/);
  assert.equal(await readFile(join(lockPath, name), 'utf8'), '{incomplete');
});

test('cancellation rejects without leaking the runtime lease', async t => {
  const runtime = await temporaryRuntime(t);
  const controller = new AbortController();
  const reason = new Error('cancelled before acquisition');
  controller.abort(reason);
  await assert.rejects(acquireRuntimeLock(runtime, { signal: controller.signal }), error => error === reason);
  const lease = await acquireRuntimeLock(runtime);
  await lease.release();
  await assert.rejects(abortable(Promise.resolve('unused'), controller.signal), error => error === reason);
});

for (const signalName of ['SIGINT', 'SIGTERM'] as const) {
  test(`${signalName} allows finally cleanup before the child exits`, async t => {
    const runtime = await temporaryRuntime(t);
    const child = spawn(process.execPath, ['--input-type=module', '-e', `
      import { acquireRuntimeLock, createShutdownController, abortable, ShutdownError } from ${JSON.stringify(lifecycleUrl)};
      const shutdown = createShutdownController();
      const keepAlive = setInterval(() => {}, 1000);
      let lease;
      try {
        lease = await acquireRuntimeLock(${JSON.stringify(runtime)}, { signal: shutdown.signal });
        console.log('ready');
        await abortable(new Promise(() => {}), shutdown.signal);
      } catch (error) {
        process.exitCode = error instanceof ShutdownError ? error.exitCode : 1;
      } finally {
        await lease?.release();
        shutdown.dispose();
        clearInterval(keepAlive);
      }
    `], { stdio: ['ignore', 'pipe', 'pipe'] });
    t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
    await childReady(child);
    const exited = once(child, 'exit');
    child.kill(signalName);
    const [code, signal] = await exited;
    assert.equal(signal, null);
    assert.equal(code, signalName === 'SIGINT' ? 130 : 143);
    const next = await acquireRuntimeLock(runtime);
    await next.release();
  });
}
