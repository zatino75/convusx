const POLLING_INTERVAL_MS = 3000;
const POLLING_MAX_ATTEMPTS = 120;
const POLLING_BACKOFF_MULTIPLIER = 1.2;
const POLLING_MAX_INTERVAL_MS = 15000;

interface PollOptions {
  interval?: number;
  maxAttempts?: number;
  backoffMultiplier?: number;
  maxInterval?: number;
  signal?: AbortSignal;
}

export async function pollUntilDone<T>(
  checkFn: () => Promise<{ done: boolean; result?: T; error?: string }>,
  options: PollOptions = {}
): Promise<T> {
  const {
    interval = POLLING_INTERVAL_MS,
    maxAttempts = POLLING_MAX_ATTEMPTS,
    backoffMultiplier = POLLING_BACKOFF_MULTIPLIER,
    maxInterval = POLLING_MAX_INTERVAL_MS,
    signal,
  } = options;

  let currentInterval = interval;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException("Polling aborted", "AbortError");
    const { done, result, error } = await checkFn();
    if (done) {
      if (error) throw new Error(error);
      return result as T;
    }
    currentInterval = Math.min(currentInterval * backoffMultiplier, maxInterval);
    await new Promise(resolve => setTimeout(resolve, currentInterval));
  }
  throw new Error(`Polling timed out after ${maxAttempts} attempts`);
}
