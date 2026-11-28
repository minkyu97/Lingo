import { describe, expect, it } from "vitest";
import { type CacheArea, createResponseCache } from "./response-cache.ts";

/** A storage area in memory, which counts bytes the way the cache does. */
function memoryArea(quota = Number.POSITIVE_INFINITY) {
  const items = new Map<string, unknown>();
  const bytes = () =>
    [...items].reduce(
      (sum, [key, value]) =>
        sum + new TextEncoder().encode(key + JSON.stringify(value)).length,
      0,
    );
  const area: CacheArea = {
    async get(keys) {
      const wanted = keys === null ? [...items.keys()] : [keys].flat();
      return Object.fromEntries(
        wanted
          .filter((key) => items.has(key))
          .map((key) => [key, items.get(key)]),
      );
    },
    async set(added) {
      const before = new Map(items);
      for (const [key, value] of Object.entries(added)) items.set(key, value);
      if (bytes() > quota) {
        items.clear();
        for (const [key, value] of before) items.set(key, value);
        throw new Error("QUOTA_BYTES quota exceeded");
      }
    },
    async remove(keys) {
      for (const key of keys) items.delete(key);
    },
    getBytesInUse: async () => bytes(),
  };
  return { area, items, bytes };
}

/** A clock that moves on by one each time it is read. */
function ticking() {
  let time = 0;
  return () => ++time;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createResponseCache", () => {
  it("returns what was stored under a key, and nothing for another", async () => {
    const { area } = memoryArea();
    const cache = createResponseCache({ area, maxBytes: 10_000 });
    await cache.set("a long key ".repeat(500), "강둑");
    expect(await cache.get("a long key ".repeat(500))).toBe("강둑");
    expect(await cache.get("another key")).toBeUndefined();
  });

  it("stores each answer under a short name of its own", async () => {
    const { area, items } = memoryArea();
    const cache = createResponseCache({ area, maxBytes: 10_000 });
    await cache.set("x".repeat(5000), "one");
    await cache.set("y".repeat(5000), "two");
    expect([...items.keys()]).toHaveLength(2);
    for (const name of items.keys())
      expect(name).toMatch(/^cache:[0-9a-f]{64}$/);
  });

  it("removes the answers used longest ago when the area is full", async () => {
    const { area, bytes } = memoryArea();
    const cache = createResponseCache({ area, maxBytes: 1000, now: ticking() });
    const answer = "x".repeat(150);
    for (const key of ["a", "b", "c", "d"]) await cache.set(key, answer);
    // Reading the oldest one makes it the newest.
    expect(await cache.get("a")).toBe(answer);
    await settle();

    await cache.set("e", answer);
    await cache.set("f", answer);

    expect(bytes()).toBeLessThanOrEqual(1000);
    expect(await cache.get("b")).toBeUndefined();
    expect(await cache.get("a")).toBe(answer);
    expect(await cache.get("f")).toBe(answer);
  });

  it("leaves what else is in the area alone", async () => {
    const { area, items } = memoryArea();
    items.set("settings", { targetLanguage: "ko" });
    items.set("engineKeys", { a: "key" });
    const cache = createResponseCache({ area, maxBytes: 600, now: ticking() });
    for (const key of ["a", "b", "c", "d", "e", "f"]) {
      await cache.set(key, "x".repeat(150));
    }
    await cache.clear();
    expect([...items.keys()].sort()).toEqual(["engineKeys", "settings"]);
  });

  it("makes room and tries again when the browser's own limit comes first", async () => {
    const { area } = memoryArea(700);
    // The cache thinks it has more room than the area gives it.
    const cache = createResponseCache({ area, maxBytes: 600, now: ticking() });
    const answer = "x".repeat(150);
    for (const key of ["a", "b", "c", "d", "e"]) await cache.set(key, answer);
    expect(await cache.get("e")).toBe(answer);
    expect(await cache.get("a")).toBeUndefined();
  });

  it("does not keep an answer that is larger than the cache", async () => {
    const { area, items } = memoryArea();
    const cache = createResponseCache({ area, maxBytes: 500 });
    await cache.set("a", "x".repeat(2000));
    expect(items.size).toBe(0);
  });

  it("reports and clears what it holds", async () => {
    const { area } = memoryArea();
    const cache = createResponseCache({ area, maxBytes: 10_000 });
    await cache.set("a", "one");
    await cache.set("b", "two");
    expect(await cache.usage()).toMatchObject({ entries: 2 });
    expect((await cache.usage()).bytes).toBeGreaterThan(150);

    await cache.clear();
    expect(await cache.usage()).toEqual({ entries: 0, bytes: 0 });
    expect(await cache.get("a")).toBeUndefined();
  });

  it("does not put back an answer that was cleared just after it was read", async () => {
    const { area, items } = memoryArea();
    let clearing: Promise<void> | undefined;
    const racing: CacheArea = {
      ...area,
      async get(keys) {
        const found = await area.get(keys);
        // The first answer read is cleared before the read is over.
        if (typeof keys === "string") clearing ??= cache.clear();
        return found;
      },
    };
    const cache = createResponseCache({ area: racing, maxBytes: 10_000 });
    await cache.set("a", "one");

    expect(await cache.get("a")).toBe("one");
    await clearing;
    await settle();
    expect(items.size).toBe(0);
  });

  it("reads a damaged item as no answer", async () => {
    const { area, items } = memoryArea();
    const cache = createResponseCache({ area, maxBytes: 10_000 });
    await cache.set("a", "one");
    const [name] = items.keys();
    items.set(name ?? "", "not an entry");
    expect(await cache.get("a")).toBeUndefined();
  });
});
