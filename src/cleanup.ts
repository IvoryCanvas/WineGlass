/** Bound protocol cleanup so process termination can still run after a browser hangs. */
export async function settleWithin(operation: Promise<unknown>, milliseconds = 1500): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([operation.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, milliseconds); })]);
  } finally { clearTimeout(timer); }
}
