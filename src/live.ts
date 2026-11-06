import { abortable, throwIfAborted } from './lifecycle.js';
import { errorMessage } from './errors.js';

export const livePrompt = 'Inspect each original tab independently. Type c + Enter to capture current pages; q or Enter to close.';

export async function runLiveCommands(lines: AsyncIterable<string>, recapture: () => Promise<void>, log: (message: string) => void, signal?: AbortSignal): Promise<void> {
  log(livePrompt);
  const iterator = lines[Symbol.asyncIterator]();
  try {
    while (true) {
      throwIfAborted(signal);
      const next = await abortable(iterator.next(), signal);
      throwIfAborted(signal);
      if (next.done) return;
      const command = next.value.trim().toLowerCase();
      if (!command || command === 'q' || command === 'quit') return;
      if (command !== 'c' && command !== 'capture') { log(livePrompt); continue; }
      try { await recapture(); }
      catch (error) {
        throwIfAborted(signal);
        log(`Capture failed: ${errorMessage(error)} Previous reports are unchanged. You can retry with c.`);
      }
      log(livePrompt);
    }
  } finally {
    // The CLI owns and closes readline; an aborted pending next() must not block cleanup.
    if (!signal?.aborted) await iterator.return?.();
  }
}
