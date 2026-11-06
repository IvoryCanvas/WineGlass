import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface LockOwner {
  version: 1;
  pid: number;
  token: string;
  createdAt: string;
}

export interface RuntimeLock {
  release(): Promise<void>;
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && 'code' in error && codes.includes(String(error.code));
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    // Permission denial and unknown failures do not establish that an owner died.
    return !hasCode(error, 'ESRCH');
  }
}

function invalidLock(path: string): Error {
  return new Error(`Runtime lock ${path} is incomplete or invalid. Verify that no WineGlass command is running before removing it.`);
}

/** Acquire one lease shared by setup and browser commands for this runtime. */
export async function acquireRuntimeLock(runtime: string, { signal }: { signal?: AbortSignal } = {}): Promise<RuntimeLock> {
  throwIfAborted(signal);
  await mkdir(runtime, { recursive: true });
  const lockPath = join(runtime, '.wineglass-lock');
  const token = randomUUID();
  const ownerName = `owner-${token}.json`;
  const staging = join(runtime, `.wineglass-lock-${token}.tmp`);
  const owner: LockOwner = { version: 1, pid: process.pid, token, createdAt: new Date().toISOString() };

  await mkdir(staging);
  try {
    await writeFile(join(staging, ownerName), JSON.stringify(owner), { flag: 'wx' });
    // Rename publishes a fully populated directory. An existing nonempty lock
    // cannot be replaced, and no empty initialization window needs guessing.
    for (let attempt = 0; attempt < 20; attempt++) {
      throwIfAborted(signal);
      try {
        await rename(staging, lockPath);
        let releasePromise: Promise<void> | undefined;
        const release = (): Promise<void> => releasePromise ??= (async () => {
          try { await unlink(join(lockPath, ownerName)); }
          catch (error) { if (hasCode(error, 'ENOENT')) return; throw error; }
          // A competing acquisition can replace the emptied directory. Its
          // distinct owner file makes rmdir fail instead of deleting its lease.
          try { await rmdir(lockPath); }
          catch (error) { if (!hasCode(error, 'ENOENT', 'ENOTEMPTY', 'EEXIST')) throw error; }
        })();
        if (signal?.aborted) { await release(); throwIfAborted(signal); }
        return { release };
      } catch (error) {
        if (!hasCode(error, 'EEXIST', 'ENOTEMPTY')) throw error;
      }

      let names: string[];
      try { names = await readdir(lockPath); }
      catch (error) { if (hasCode(error, 'ENOENT')) continue; throw error; }
      // Empty is possible briefly while another process releases its lease.
      if (names.length === 0) continue;
      const existingName = names[0];
      if (names.length !== 1 || !existingName || !/^owner-[\da-f-]{36}\.json$/.test(existingName)) throw invalidLock(lockPath);
      let existing: unknown;
      try { existing = JSON.parse(await readFile(join(lockPath, existingName), 'utf8')); }
      catch (error) { if (hasCode(error, 'ENOENT')) continue; throw invalidLock(lockPath); }
      if (typeof existing !== 'object' || !existing || !('version' in existing) || existing.version !== 1 ||
          !('pid' in existing) || typeof existing.pid !== 'number' || !Number.isSafeInteger(existing.pid) || existing.pid <= 0 ||
          !('token' in existing) || existingName !== `owner-${String(existing.token)}.json`) throw invalidLock(lockPath);
      if (processIsAlive(existing.pid)) throw new Error(`Runtime is already in use by WineGlass process ${existing.pid}. Close that command before using ${runtime}.`);

      // Remove only the dead owner's unique file. Another stale observer can
      // never unlink a newly acquired owner's differently named file.
      try { await unlink(join(lockPath, existingName)); }
      catch (error) { if (hasCode(error, 'ENOENT')) continue; throw error; }
      try { await rmdir(lockPath); }
      catch (error) { if (!hasCode(error, 'ENOENT', 'ENOTEMPTY', 'EEXIST')) throw error; }
    }
    throw new Error(`Runtime lock changed repeatedly. Retry when no WineGlass command is using ${runtime}.`);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export class ShutdownError extends Error {
  readonly exitCode: number;
  constructor(readonly signalName: 'SIGINT' | 'SIGTERM') {
    super(`Interrupted by ${signalName}.`);
    this.name = 'ShutdownError';
    this.exitCode = signalName === 'SIGINT' ? 130 : 143;
  }
}

/** Signals request cancellation; callers retain control of their finally blocks. */
export function createShutdownController(): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new ShutdownError('SIGINT'));
  const terminate = () => controller.abort(new ShutdownError('SIGTERM'));
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  return {
    signal: controller.signal,
    dispose() { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }
  };
}

export function throwIfAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

/** Stop awaiting an operation on cancellation; the operation must own its cleanup. */
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  return new Promise<T>((resolve, reject) => {
    const cancel = () => reject(signal.reason);
    const remove = () => signal.removeEventListener('abort', cancel);
    operation.then(value => { remove(); resolve(value); }, error => { remove(); reject(error); });
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
}
