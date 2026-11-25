import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "./rate-limiter.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Asks for `count` permits at once and records when each one is granted. */
function ask(count: number, perSecond: number) {
  const limiter = createRateLimiter();
  const start = Date.now();
  const granted: number[] = [];
  for (let i = 0; i < count; i++) {
    void limiter
      .acquire(perSecond)
      .then(() => granted.push(Date.now() - start));
  }
  return granted;
}

describe("createRateLimiter", () => {
  it("lets through as many requests per second as asked, and no more", async () => {
    const granted = ask(7, 3);

    await vi.advanceTimersByTimeAsync(0);
    expect(granted).toEqual([0, 0, 0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(granted).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(granted).toEqual([0, 0, 0, 1000, 1000, 1000]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(granted).toEqual([0, 0, 0, 1000, 1000, 1000, 2000]);
  });

  it("never has more than the limit inside any one second", async () => {
    const limiter = createRateLimiter();
    const start = Date.now();
    const granted: number[] = [];
    const acquire = () =>
      void limiter.acquire(2).then(() => granted.push(Date.now() - start));

    acquire();
    await vi.advanceTimersByTimeAsync(600);
    acquire();
    acquire();
    acquire();
    await vi.advanceTimersByTimeAsync(3000);

    // The third waits for the first to be a second old, the fourth for the second.
    expect(granted).toEqual([0, 600, 1000, 1600]);
  });

  it("serves in the order asked", async () => {
    const limiter = createRateLimiter();
    const order: string[] = [];
    for (const name of ["a", "b", "c"]) {
      void limiter.acquire(1).then(() => order.push(name));
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(order).toEqual(["a", "b", "c"]);
  });

  it("drops a request that is aborted while it waits", async () => {
    const limiter = createRateLimiter();
    const abort = new AbortController();
    const order: string[] = [];
    void limiter.acquire(1).then(() => order.push("first"));
    const dropped = limiter.acquire(1, abort.signal).then(
      () => order.push("dropped"),
      () => order.push("refused"),
    );
    void limiter.acquire(1).then(() => order.push("third"));

    await vi.advanceTimersByTimeAsync(0);
    abort.abort();
    await dropped;
    await vi.advanceTimersByTimeAsync(1000);

    // The aborted one did not use up a turn.
    expect(order).toEqual(["first", "refused", "third"]);
  });

  it("refuses at once when the signal has already aborted", async () => {
    const limiter = createRateLimiter();
    await expect(limiter.acquire(1, AbortSignal.abort())).rejects.toBeDefined();
  });
});
