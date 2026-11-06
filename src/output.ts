import { mkdir, mkdtemp, rename, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { writeReport } from './report.js';
import { throwIfAborted } from './lifecycle.js';
import type { CapturePair, ComparisonMetadata } from './types.js';

export interface SavedCapture {
  directory: string;
  metadata: ComparisonMetadata;
}

/** Publish a complete set by directory rename; failures leave prior reports intact. */
export async function saveCapture(output: string, collect: (directory: string) => Promise<CapturePair>, signal?: AbortSignal): Promise<SavedCapture> {
  throwIfAborted(signal);
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(output, '.capture-'));
  try {
    const captures = await collect(staging);
    throwIfAborted(signal);
    const metadata = await writeReport(staging, captures);
    throwIfAborted(signal);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = join(output, `${timestamp}-${basename(staging).slice('.capture-'.length)}`);
    await rename(staging, directory);
    return { directory, metadata };
  } finally { await rm(staging, { recursive: true, force: true }); }
}
