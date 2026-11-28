import { browser } from "wxt/browser";
import {
  type CacheAction,
  type CacheUsage,
  cacheUsageSchema,
  type RuntimeMessage,
} from "./messaging.ts";
import type { StoredResponseCache } from "./response-cache.ts";

/**
 * The background side: says how much the cache holds, after emptying it
 * when that is what was asked for.
 */
export async function answerCacheRequest(
  action: CacheAction,
  cache: StoredResponseCache,
  maxBytes: number,
): Promise<CacheUsage> {
  if (action === "clear") await cache.clear();
  return { ...(await cache.usage()), maxBytes };
}

/**
 * The settings side: asks the background, which is where answers are stored
 * and removed, so that the two never happen at once.
 */
export async function requestCacheUsage(
  action: CacheAction,
): Promise<CacheUsage> {
  const message: RuntimeMessage = { type: "response-cache", action };
  const answer: unknown = await browser.runtime
    .sendMessage(message)
    .catch(() => undefined);
  return cacheUsageSchema.parse(answer);
}
