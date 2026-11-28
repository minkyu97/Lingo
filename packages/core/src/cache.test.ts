import { describe, expect, it } from "vitest";
import {
  type CacheIdentity,
  cacheKey,
  type ResponseCache,
  withCache,
} from "./cache.ts";
import { type ChatRequest, LLMError, type LLMProvider } from "./llm.ts";

const identity: CacheIdentity = { provider: "anthropic", model: "m" };
const request: ChatRequest = {
  system: "Translate into Korean.",
  messages: [{ role: "user", content: "bank" }],
};

function memoryCache() {
  const stored = new Map<string, string>();
  const cache: ResponseCache = {
    get: async (key) => stored.get(key),
    set: async (key, answer) => {
      stored.set(key, answer);
    },
  };
  return { cache, stored };
}

/** A provider that counts how often it is asked. */
function countingProvider(...chunks: string[]) {
  const calls: ChatRequest[] = [];
  const provider: Pick<LLMProvider, "stream"> = {
    async *stream(asked) {
      calls.push(asked);
      yield* chunks;
    },
  };
  return { provider, calls };
}

async function collect(stream: AsyncIterable<string>): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("cacheKey", () => {
  it("is the same for the same request to the same model", () => {
    const again = structuredClone(request);
    expect(cacheKey(identity, again)).toBe(cacheKey(identity, request));
  });

  it("does not depend on the order of an object's keys", () => {
    const a = cacheKey(
      { ...identity, parameters: { x: 1, y: { p: 1, q: 2 } } },
      request,
    );
    const b = cacheKey(
      { ...identity, parameters: { y: { q: 2, p: 1 }, x: 1 } },
      request,
    );
    expect(a).toBe(b);
  });

  it.each<[string, CacheIdentity, ChatRequest]>([
    ["another model", { ...identity, model: "n" }, request],
    ["another provider", { ...identity, provider: "openai" }, request],
    [
      "other parameters",
      { ...identity, parameters: { temperature: 0 } },
      request,
    ],
    [
      "other capabilities",
      { ...identity, capabilities: { effort: true } },
      request,
    ],
    [
      "other instructions",
      identity,
      { ...request, system: "Translate into Japanese." },
    ],
    [
      "another text",
      identity,
      { ...request, messages: [{ role: "user", content: "river" }] },
    ],
    [
      "a format",
      identity,
      { ...request, format: { name: "entry", schema: {} } },
    ],
  ])("differs for %s", (_what, otherIdentity, otherRequest) => {
    expect(cacheKey(otherIdentity, otherRequest)).not.toBe(
      cacheKey(identity, request),
    );
  });

  it("treats a parameter that is not set like one that is not there", () => {
    expect(cacheKey({ ...identity, parameters: undefined }, request)).toBe(
      cacheKey(identity, request),
    );
  });
});

describe("withCache", () => {
  it("asks the provider once, and answers from the cache after that", async () => {
    const { cache } = memoryCache();
    const { provider, calls } = countingProvider("강", "둑");
    const cached = withCache(provider, cache, identity);

    expect(await collect(cached.stream(request))).toEqual(["강", "둑"]);
    // The stored answer comes in one piece.
    expect(await collect(cached.stream(request))).toEqual(["강둑"]);
    expect(calls).toHaveLength(1);
  });

  it("asks again for another request, or another model", async () => {
    const { cache } = memoryCache();
    const { provider, calls } = countingProvider("강둑");
    await collect(withCache(provider, cache, identity).stream(request));
    await collect(
      withCache(provider, cache, identity).stream({
        ...request,
        system: "Other.",
      }),
    );
    await collect(
      withCache(provider, cache, { ...identity, model: "n" }).stream(request),
    );
    expect(calls).toHaveLength(3);
  });

  it("does not store an answer that failed on the way", async () => {
    const { cache, stored } = memoryCache();
    const failing: Pick<LLMProvider, "stream"> = {
      async *stream() {
        yield "강";
        throw new LLMError("network", "Cut off.");
      },
    };
    await expect(
      collect(withCache(failing, cache, identity).stream(request)),
    ).rejects.toThrow("Cut off.");
    expect(stored.size).toBe(0);
  });

  it("does not store an answer that the reader stopped reading", async () => {
    const { cache, stored } = memoryCache();
    const { provider } = countingProvider("강", "둑");
    for await (const _chunk of withCache(provider, cache, identity).stream(
      request,
    )) {
      break;
    }
    expect(stored.size).toBe(0);
  });

  it("does not store an answer that was cancelled, even one that ended quietly", async () => {
    const { cache, stored } = memoryCache();
    const abort = new AbortController();
    // Like the OpenAI SDK, which ends a cancelled stream without an error.
    const quiet: Pick<LLMProvider, "stream"> = {
      async *stream(_request, options) {
        yield "강";
        if (options?.signal?.aborted) return;
        yield "둑";
      },
    };
    for await (const _chunk of withCache(quiet, cache, identity).stream(
      request,
      { signal: abort.signal },
    )) {
      abort.abort();
    }
    expect(stored.size).toBe(0);
  });

  it("does not store an empty answer", async () => {
    const { cache, stored } = memoryCache();
    const { provider } = countingProvider();
    await collect(withCache(provider, cache, identity).stream(request));
    expect(stored.size).toBe(0);
  });

  it("still answers when the cache fails", async () => {
    const broken: ResponseCache = {
      get: async () => {
        throw new Error("no storage");
      },
      set: async () => {
        throw new Error("no storage");
      },
    };
    const { provider } = countingProvider("강둑");
    expect(
      await collect(withCache(provider, broken, identity).stream(request)),
    ).toEqual(["강둑"]);
  });
});
