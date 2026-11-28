/**
 * Caching of model answers, at the port: a provider wrapped by `withCache`
 * answers a request it has answered before from a store, without asking
 * the model again. Every task goes through the port, so every task is
 * cached the same way, and none of them knows.
 */
import type { ModelCapabilities } from "./engines.ts";
import type { ChatRequest, LLMProvider } from "./llm.ts";

/** Port for a store of answers. Adapters decide where they are kept. */
export interface ResponseCache {
  /** The answer stored under a key, if there is one. */
  get(key: string): Promise<string | undefined>;
  set(key: string, answer: string): Promise<void>;
}

/**
 * What decides the answer to a request, apart from the request itself. An
 * engine's ID and name are not part of it, and neither is its API key: two
 * engines that ask the same model the same way share their answers, and an
 * engine that is given another model does not get the old model's.
 */
export interface CacheIdentity {
  provider: string;
  model: string;
  capabilities?: ModelCapabilities;
  parameters?: Record<string, unknown>;
}

/** Raised when an answer stored under this version is no longer good. */
const CACHE_VERSION = 1;

/** JSON in which the order of an object's keys does not matter. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object" || value === null) {
    return JSON.stringify(value) ?? "null";
  }
  const entries = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, member]) => `${JSON.stringify(key)}:${canonical(member)}`);
  return `{${entries.join(",")}}`;
}

/**
 * The key of a request: everything that decides its answer, as text. The
 * request holds the instructions, so a changed prompt or another target
 * language makes another key. A store may shorten the key, as with a hash.
 */
export function cacheKey(
  identity: CacheIdentity,
  request: ChatRequest,
): string {
  return canonical({ version: CACHE_VERSION, ...identity, request });
}

/**
 * Wraps a provider so that a request it has answered before is answered
 * from the cache. Only an answer that came through whole is stored: not one
 * that failed, was refused, or was cancelled on the way. A cache that fails
 * is treated as empty, so it can never cost an answer.
 *
 * An answer the model cut short at its output limit is stored like a whole
 * one, since the adapters end such a stream without an error.
 */
export function withCache(
  provider: Pick<LLMProvider, "stream">,
  cache: ResponseCache,
  identity: CacheIdentity,
): Pick<LLMProvider, "stream"> {
  return {
    async *stream(request, options) {
      const key = cacheKey(identity, request);
      const stored = await cache.get(key).catch(() => undefined);
      if (stored !== undefined) {
        yield stored;
        return;
      }

      let answer = "";
      for await (const chunk of provider.stream(request, options)) {
        answer += chunk;
        yield chunk;
      }
      // Reached only when the stream ended without an error, and without the
      // reader stopping. A cancelled stream can end like that too: the OpenAI
      // SDK ends one quietly instead of throwing. Its answer is not whole.
      if (answer === "" || options?.signal?.aborted) return;
      // The answer has been given, so it does not wait for the store.
      void cache.set(key, answer).catch(() => {});
    },
  };
}
