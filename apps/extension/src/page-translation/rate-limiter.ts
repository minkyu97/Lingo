export interface RateLimiter {
  /**
   * Resolves when one more request may start: at most `perSecond` in any one
   * second. Callers are served in the order they asked. Rejects when the
   * signal aborts first.
   */
  acquire(perSecond: number, signal?: AbortSignal): Promise<void>;
}

interface Waiter {
  perSecond: number;
  grant(): void;
}

const WINDOW_MS = 1000;

export function createRateLimiter(now: () => number = Date.now): RateLimiter {
  /** When each request of the last second was let through. */
  const starts: number[] = [];
  const waiting: Waiter[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function serve() {
    clearTimeout(timer);
    timer = undefined;
    for (;;) {
      const next = waiting[0];
      if (!next) return;

      const time = now();
      while (starts[0] !== undefined && time - starts[0] >= WINDOW_MS) {
        starts.shift();
      }
      const oldest = starts[0];
      if (oldest !== undefined && starts.length >= next.perSecond) {
        // Full: look again when the oldest request leaves the window.
        timer = setTimeout(serve, oldest + WINDOW_MS - time);
        return;
      }
      starts.push(time);
      waiting.shift();
      next.grant();
    }
  }

  return {
    acquire(perSecond, signal) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const giveUp = () => {
          waiting.splice(waiting.indexOf(waiter), 1);
          reject(signal?.reason);
          // The one behind may have a higher limit, and not need to wait.
          serve();
        };
        const waiter: Waiter = {
          perSecond,
          grant() {
            signal?.removeEventListener("abort", giveUp);
            resolve();
          },
        };
        signal?.addEventListener("abort", giveUp, { once: true });
        waiting.push(waiter);
        if (timer === undefined) serve();
      });
    },
  };
}
