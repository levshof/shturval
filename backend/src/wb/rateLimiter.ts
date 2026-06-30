export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Per-key rate limiter. Wildberries statistics endpoints allow ~1 request per
 * minute *per method*, so we serialize calls per key and guarantee a minimum
 * spacing between them. Calls with different keys do not block each other.
 */
export class RateLimiter {
  private tail = new Map<string, Promise<unknown>>();
  private last = new Map<string, number>();

  constructor(private readonly minIntervalMs: number) {}

  /**
   * Serialize `fn` behind `key` and ensure a minimum spacing since the previous
   * call on the same key. `intervalMs` overrides the default for this call
   * (statistics endpoints need ~60s, content/ads are more lenient).
   */
  schedule<T>(key: string, fn: () => Promise<T>, intervalMs?: number): Promise<T> {
    const interval = intervalMs ?? this.minIntervalMs;
    const run = async (): Promise<T> => {
      const last = this.last.get(key) ?? 0;
      const wait = interval - (Date.now() - last);
      if (wait > 0) await sleep(wait);
      try {
        return await fn();
      } finally {
        this.last.set(key, Date.now());
      }
    };

    const prev = this.tail.get(key) ?? Promise.resolve();
    const next = prev.then(run, run); // run regardless of previous outcome
    // Keep the chain alive but swallow errors so one failure doesn't poison the queue.
    this.tail.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}
