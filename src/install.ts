import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { access, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, basename, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';

export async function runInstaller(file: string, args: string[], options: { signal?: AbortSignal; env?: NodeJS.ProcessEnv; timeout?: number } = {}): Promise<{ stdout: string; stderr: string }> {
  const { signal } = options;
  signal?.throwIfAborted();
  return new Promise((ok, fail) => {
    // Python can launch the compiler. Own the group so cancellation reaches both.
    const child = spawn(file, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...(options.env ? { env: options.env } : {}) });
    let stdout = '', stderr = '';
    let failure: unknown;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: unknown) => {
      if (failure) return;
      failure = reason;
      try { if (child.pid) process.kill(-child.pid, 'SIGTERM'); } catch {}
      killTimer = setTimeout(() => { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {} }, 2000);
      killTimer.unref();
    };
    const onAbort = () => stop(signal?.reason ?? new Error('Installation interrupted.'));
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop(new Error(`Installation command timed out: ${basename(file)}`)), options.timeout ?? 180000);
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); if (stdout.length > 1048576) stop(new Error('Installation output exceeded its limit.')); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); if (stderr.length > 1048576) stop(new Error('Installation output exceeded its limit.')); });
    child.on('error', error => { failure ??= error; });
    child.once('close', (code, exitSignal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal?.removeEventListener('abort', onAbort);
      if (failure) fail(failure);
      else if (code !== 0) fail(new Error(`${basename(file)} failed (${exitSignal ?? code}): ${stderr.trim()}`));
      else ok({ stdout, stderr });
    });
    if (signal?.aborted) onAbort();
  });
}

export async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function sha256(path: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path, signal ? { signal } : {})) hash.update(chunk);
  return hash.digest('hex');
}

export async function downloadVerified(url: string, path: string, expectedHash: string, options: { signal?: AbortSignal; fetcher?: typeof fetch } = {}): Promise<void> {
  const { signal, fetcher = fetch } = options;
  signal?.throwIfAborted();
  if (await exists(path) && await sha256(path, signal) === expectedHash) return;
  await mkdir(dirname(path), { recursive: true });
  const partial = `${path}.partial`;
  await rm(partial, { force: true });
  try {
    const requestSignal = AbortSignal.any([AbortSignal.timeout(300000), ...(signal ? [signal] : [])]);
    const response = await fetcher(url, { signal: requestSignal });
    if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status} (${url})`);
    // Node and DOM declarations disagree on BYOB ArrayBuffer types. Fetch still
    // returns a native byte stream; fromWeb also cancels a pending read on abort.
    const body = response.body as unknown as NodeReadableStream<Uint8Array>;
    await pipeline(Readable.fromWeb(body), createWriteStream(partial), { signal: requestSignal });
    if (await sha256(partial, signal) !== expectedHash) throw new Error(`Archive SHA-256 mismatch: ${basename(path)}. The incomplete download was discarded.`);
    signal?.throwIfAborted();
    await rename(partial, path);
  } finally { await rm(partial, { force: true }); }
}

function replacementPaths(destination: string): { staging: string; backup: string } {
  return { staging: `${destination}.wineglass-staging`, backup: `${destination}.wineglass-backup` };
}

// The caller holds the runtime lock. A backup always precedes publication.
export async function recoverReplacement(destination: string): Promise<void> {
  const { staging, backup } = replacementPaths(destination);
  if (await exists(backup)) {
    if (await exists(destination)) await rm(backup, { recursive: true, force: true });
    else await rename(backup, destination);
  }
  await rm(staging, { recursive: true, force: true });
}

export async function installDirectory(destination: string, prepare: (staging: string) => Promise<string>, validate: (candidate: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
  await recoverReplacement(destination);
  signal?.throwIfAborted();
  const { staging, backup } = replacementPaths(destination);
  await mkdir(staging, { recursive: true });
  let movedPrevious = false;
  let published = false;
  try {
    const candidate = resolve(await prepare(staging));
    const stagingRoot = resolve(staging);
    if (candidate !== stagingRoot && !candidate.startsWith(`${stagingRoot}${sep}`)) throw new Error('Installation candidate escaped its staging directory.');
    await validate(candidate);
    signal?.throwIfAborted();
    if (await exists(destination)) { await rename(destination, backup); movedPrevious = true; }
    await rename(candidate, destination);
    published = true;
    await rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (movedPrevious && !published) await rename(backup, destination);
    throw error;
  } finally { await rm(staging, { recursive: true, force: true }); }
}
