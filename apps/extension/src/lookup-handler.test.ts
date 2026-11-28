import {
  type ChatRequest,
  defaultSettings,
  type Engine,
  LLMError,
  type LLMProvider,
  type Settings,
} from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";
import { describe, expect, it, vi } from "vitest";
import {
  handleLookupPort,
  type LookupDeps,
  type LookupPort,
} from "./lookup-handler.ts";
import type { LookupEvent, LookupRequest } from "./messaging.ts";

function fakePort() {
  const events: LookupEvent[] = [];
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: LookupPort = {
    postMessage: (event) => {
      events.push(event);
    },
    onMessage: { addListener: (listener) => (onMessage = listener) },
    onDisconnect: { addListener: (listener) => (onDisconnect = listener) },
  };
  return {
    port,
    events,
    send: (message: unknown) => onMessage(message),
    disconnect: () => onDisconnect(),
  };
}

/** The part of a provider that a lookup uses. */
type StreamingProvider = Pick<LLMProvider, "stream">;

function providerYielding(...chunks: string[]): StreamingProvider {
  return {
    async *stream() {
      yield* chunks;
    },
  };
}

const opus: Engine = {
  id: "opus",
  provider: "anthropic",
  model: "claude-opus-5-5",
};
const luna: Engine = {
  id: "luna",
  provider: "openai",
  model: "gpt-6-luna",
  capabilities: { structuredOutput: true },
  parameters: { temperature: 0.3 },
};

interface Setup {
  settings?: Partial<Settings>;
  /** The key of every engine. `null` for engines without a key. */
  apiKey?: string | null;
  provider?: StreamingProvider;
  baseURL?: LookupDeps["baseURL"];
  cache?: LookupDeps["cache"];
}

function setup({
  settings,
  apiKey = "key",
  provider,
  baseURL,
  cache,
}: Setup = {}) {
  const created: CreateProviderOptions[] = [];
  const requests: ChatRequest[] = [];
  const inner = provider ?? providerYielding("강", "둑");
  const deps: LookupDeps = {
    loadSettings: async () => ({
      ...defaultSettings("ko"),
      engines: [opus],
      ...settings,
    }),
    loadEngineKey: async (id) => (apiKey ? `${apiKey}-${id}` : undefined),
    createProvider: (options) => {
      created.push(options);
      return {
        stream(request, options) {
          requests.push(request);
          return inner.stream(request, options);
        },
      };
    },
    baseURL,
    cache,
  };
  const fake = fakePort();
  handleLookupPort(fake.port, deps);
  return { ...fake, created, requests };
}

const start: LookupRequest = {
  type: "start",
  mode: "translate",
  context: {
    selection: "bank",
    level: "paragraph",
    before: "She sat on the river ",
    after: " and watched the boats.",
  },
};

/** Waits until the handler has posted its last event. */
async function settled(events: LookupEvent[]) {
  await vi.waitFor(() => {
    const last = events.at(-1)?.type;
    expect(last === "done" || last === "error").toBe(true);
  });
}

describe("handleLookupPort", () => {
  it("streams the answer back and finishes", async () => {
    const { send, events, created } = setup();
    send(start);
    await settled(events);

    expect(events).toEqual([
      { type: "started", context: start.context },
      { type: "delta", text: "강" },
      { type: "delta", text: "둑" },
      { type: "done" },
    ]);
    expect(created).toEqual([
      {
        provider: "anthropic",
        apiKey: "key-opus",
        model: "claude-opus-5-5",
        capabilities: undefined,
        parameters: undefined,
        baseURL: undefined,
      },
    ]);
  });

  it("uses the engine chosen for the mode, and the configured language", async () => {
    const { send, events, created, requests } = setup({
      settings: {
        engines: [opus, luna],
        engineFor: { translate: "luna" },
        targetLanguage: "ja",
      },
    });
    send(start);
    await settled(events);

    expect(created[0]).toEqual({
      provider: "openai",
      apiKey: "key-luna",
      model: "gpt-6-luna",
      capabilities: { structuredOutput: true },
      parameters: { temperature: 0.3 },
      baseURL: undefined,
    });
    expect(requests[0]?.system).toContain("Japanese");
  });

  it("defines with the engine for definitions, which may be another one", async () => {
    const { send, events, created } = setup({
      settings: { engines: [opus, luna], engineFor: { translate: "luna" } },
    });
    send({ ...start, mode: "define" });
    await settled(events);
    // None is chosen for definitions, so the first engine does them.
    expect(created[0]).toMatchObject({ model: "claude-opus-5-5" });
  });

  it("answers a lookup it has answered before from the cache", async () => {
    const stored = new Map<string, string>();
    const cache = {
      get: async (key: string) => stored.get(key),
      set: async (key: string, answer: string) => {
        stored.set(key, answer);
      },
    };
    const first = setup({ cache });
    first.send(start);
    await settled(first.events);
    expect(first.requests).toHaveLength(1);

    // Another lookup of the same text, in another port.
    const second = setup({ cache });
    second.send(start);
    await settled(second.events);
    expect(second.requests).toHaveLength(0);
    expect(second.events).toEqual([
      { type: "started", context: start.context },
      { type: "delta", text: "강둑" },
      { type: "done" },
    ]);

    // Another mode is another request.
    const third = setup({ cache });
    third.send({ ...start, mode: "define" });
    await settled(third.events);
    expect(third.requests).toHaveLength(1);

    // With the setting off, the cache is neither read nor written.
    const off = setup({ cache, settings: { cacheResponses: false } });
    off.send(start);
    await settled(off.events);
    expect(off.requests).toHaveLength(1);
  });

  it("asks for an engine before the first one is added", async () => {
    const { send, events, created } = setup({ settings: { engines: [] } });
    send(start);
    await settled(events);
    expect(events).toEqual([
      {
        type: "error",
        kind: "missing_key",
        message: "No translation engine is set up.",
      },
    ]);
    expect(created).toEqual([]);
  });

  it("sends only the selection when context awareness is off", async () => {
    const { send, events, requests } = setup({
      settings: { contextAwareness: false },
    });
    send(start);
    await settled(events);

    expect(events[0]).toEqual({
      type: "started",
      context: { selection: "bank", level: "none" },
    });
    expect(requests[0]?.messages[0]?.content).toBe(
      "<selection>bank</selection>",
    );
  });

  it("reports a missing key without calling a provider", async () => {
    const { send, events, created } = setup({ apiKey: null });
    send(start);
    await settled(events);

    expect(events).toEqual([
      { type: "error", kind: "missing_key", message: "No API key is set." },
    ]);
    expect(created).toEqual([]);
  });

  it("reports a provider error with its kind", async () => {
    const { send, events } = setup({
      provider: {
        // biome-ignore lint/correctness/useYield: fails before producing anything
        async *stream() {
          throw new LLMError("auth", "Anthropic rejected the API key.");
        },
      },
    });
    send(start);
    await settled(events);

    expect(events.at(-1)).toEqual({
      type: "error",
      kind: "auth",
      message: "Anthropic rejected the API key.",
    });
  });

  it("wraps unexpected failures as API errors", async () => {
    const { send, events } = setup({
      provider: {
        // biome-ignore lint/correctness/useYield: fails before producing anything
        async *stream() {
          throw new Error("boom");
        },
      },
    });
    send(start);
    await settled(events);

    expect(events.at(-1)).toMatchObject({ type: "error", kind: "api" });
  });

  it("ignores malformed and repeated start messages", async () => {
    const { send, events, created } = setup();
    send({ type: "start", mode: "translate" });
    expect(events).toEqual([]);

    send(start);
    send(start);
    await settled(events);
    expect(created).toHaveLength(1);
  });

  it("cancels the request and goes quiet when the port closes", async () => {
    let signal: AbortSignal | undefined;
    let release = () => {};
    const { send, disconnect, events } = setup({
      provider: {
        async *stream(_request, options) {
          signal = options?.signal;
          yield "강";
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield "둑";
        },
      },
    });
    send(start);
    await vi.waitFor(() => expect(events).toHaveLength(2));

    disconnect();
    expect(signal?.aborted).toBe(true);
    release();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(events.map((event) => event.type)).toEqual(["started", "delta"]);
  });

  it("pings while the provider is silent", async () => {
    let release = () => {};
    const fake = fakePort();
    handleLookupPort(fake.port, {
      loadSettings: async () => ({ ...defaultSettings("ko"), engines: [opus] }),
      loadEngineKey: async () => "key",
      createProvider: () => ({
        async *stream() {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
          yield "강둑";
        },
      }),
      pingIntervalMs: 5,
    });
    fake.send(start);
    await vi.waitFor(() =>
      expect(fake.events.some((event) => event.type === "ping")).toBe(true),
    );
    release();
    await settled(fake.events);
    expect(fake.events.at(-1)).toEqual({ type: "done" });
  });

  it("passes the base URL override to the provider", async () => {
    const { send, events, created } = setup({
      baseURL: (provider) => `http://localhost/${provider}`,
    });
    send(start);
    await settled(events);
    expect(created[0]?.baseURL).toBe("http://localhost/anthropic");
  });
});
