import { describe, expect, it, vi } from "vitest";
import { answerCacheRequest } from "./cache-usage.ts";
import type { StoredResponseCache } from "./response-cache.ts";

function fakeCache(): StoredResponseCache {
  let entries = 3;
  return {
    get: vi.fn(),
    set: vi.fn(),
    clear: vi.fn(async () => {
      entries = 0;
    }),
    usage: async () => ({ entries, bytes: entries * 100 }),
  };
}

describe("answerCacheRequest", () => {
  it("says how much the cache holds and may hold", async () => {
    const cache = fakeCache();
    expect(await answerCacheRequest("usage", cache, 9000)).toEqual({
      entries: 3,
      bytes: 300,
      maxBytes: 9000,
    });
    expect(cache.clear).not.toHaveBeenCalled();
  });

  it("empties the cache first when asked to clear it", async () => {
    expect(await answerCacheRequest("clear", fakeCache(), 9000)).toEqual({
      entries: 0,
      bytes: 0,
      maxBytes: 9000,
    });
  });
});
