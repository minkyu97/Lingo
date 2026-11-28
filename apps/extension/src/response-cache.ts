import type { ResponseCache } from "@lingo/core";
import { z } from "zod";

/** The part of a storage area the cache uses. `storage.local` is one. */
export interface CacheArea {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
  /** How much the whole area holds, in bytes. */
  getBytesInUse(keys: null): Promise<number>;
}

export interface ResponseCacheOptions {
  area: CacheArea;
  /**
   * How much the area may hold before the cache makes room, in bytes. It
   * counts everything in the area, since the browser's limit does too.
   */
  maxBytes: number;
  now?: () => number;
}

export interface StoredResponseCache extends ResponseCache {
  /** Removes every stored answer. */
  clear(): Promise<void>;
  /** How many answers are stored, and how many bytes they take. */
  usage(): Promise<{ entries: number; bytes: number }>;
}

/** What is stored for one request. */
const entrySchema = z.object({
  answer: z.string(),
  /** When the answer was stored or last read, in milliseconds. */
  used: z.number(),
});

type Entry = z.infer<typeof entrySchema>;

const PREFIX = "cache:";

/** When room is made, it is made down to this share of the limit. */
const KEEP_SHARE = 0.8;

/** Stored data may be damaged. Anything of another shape is no answer. */
const isEntry = (value: unknown): value is Entry =>
  entrySchema.safeParse(value).success;

/** A short, fixed-length name for a key of any length. */
async function hash(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

const sizeOf = (name: string, entry: Entry) =>
  new TextEncoder().encode(name + JSON.stringify(entry)).length;

/**
 * Keeps answers in a storage area, one item per answer. When the area holds
 * more than it may, the answers that were used longest ago go first.
 */
export function createResponseCache({
  area,
  maxBytes,
  now = Date.now,
}: ResponseCacheOptions): StoredResponseCache {
  /** Writes wait for one another, so that room is not made twice at once. */
  let writing: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(task: () => Promise<T>): Promise<T> => {
    const done = writing.then(task, task);
    writing = done.catch(() => {});
    return done;
  };

  async function entries(): Promise<[string, Entry][]> {
    const all = await area.get(null);
    return Object.entries(all).filter(
      (item): item is [string, Entry] =>
        item[0].startsWith(PREFIX) && isEntry(item[1]),
    );
  }

  /**
   * Removes the answers used longest ago until the area holds no more than
   * `target` bytes, or no answers are left. `bytes` is what it holds now.
   */
  async function evict(bytes: number, target: number): Promise<void> {
    const oldestFirst = (await entries()).sort(
      ([, a], [, b]) => a.used - b.used,
    );
    const gone: string[] = [];
    for (const [name, entry] of oldestFirst) {
      if (bytes <= target) break;
      gone.push(name);
      bytes -= sizeOf(name, entry);
    }
    if (gone.length > 0) await area.remove(gone);
  }

  /** Marks an answer as just used, unless it was removed in the meantime. */
  async function touch(name: string): Promise<void> {
    const entry = (await area.get(name))[name];
    if (isEntry(entry)) await area.set({ [name]: { ...entry, used: now() } });
  }

  return {
    async get(key) {
      const name = PREFIX + (await hash(key));
      const entry = (await area.get(name))[name];
      if (!isEntry(entry)) return undefined;
      // Reading an answer is what keeps it from being the next to go. It is
      // read again in turn, so that an answer removed since is not put back.
      void inTurn(() => touch(name)).catch(() => {});
      return entry.answer;
    },

    async set(key, answer) {
      const name = PREFIX + (await hash(key));
      const entry: Entry = { answer, used: now() };
      const size = sizeOf(name, entry);
      // An answer that would not fit even into an empty cache is not kept.
      if (size > maxBytes * KEEP_SHARE) return;
      await inTurn(async () => {
        try {
          await area.set({ [name]: entry });
        } catch {
          // The browser's own limit came first, as when the rest of the area
          // takes more room than was left for it. Make room for this answer
          // as if the cache's own limit had been reached, and try once more.
          const bytes = await area.getBytesInUse(null);
          await evict(bytes, Math.min(bytes, maxBytes) * KEEP_SHARE - size);
          await area.set({ [name]: entry });
        }
        const bytes = await area.getBytesInUse(null);
        if (bytes > maxBytes) await evict(bytes, maxBytes * KEEP_SHARE);
      });
    },

    clear: () =>
      inTurn(async () => {
        await area.remove((await entries()).map(([name]) => name));
      }),

    async usage() {
      const all = await entries();
      return {
        entries: all.length,
        bytes: all.reduce((sum, [name, entry]) => sum + sizeOf(name, entry), 0),
      };
    },
  };
}
