import {
  type ChatRequest,
  defaultSettings,
  LLMError,
  type LLMProvider,
  type Settings,
} from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";
import { describe, expect, it, vi } from "vitest";
import {
  handlePageTranslationPort,
  type PageTranslationDeps,
  type PageTranslationPort,
} from "./handler.ts";
import {
  type PageEvent,
  type PageTranslationOptions,
  pageTranslationOptionsSchema,
} from "./protocol.ts";
import { createRateLimiter } from "./rate-limiter.ts";

function fakePort() {
  const events: PageEvent[] = [];
  let onMessage: (message: unknown) => void = () => {};
  let onDisconnect: () => void = () => {};
  const port: PageTranslationPort = {
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

type StreamingProvider = Pick<LLMProvider, "stream">;

function providerYielding(...chunks: string[]): StreamingProvider {
  return {
    async *stream() {
      yield* chunks;
    },
  };
}

interface Setup {
  settings?: Partial<Settings>;
  options?: Partial<PageTranslationOptions>;
  apiKey?: string | null;
  provider?: StreamingProvider;
}

function setup({ settings, options, apiKey = "key", provider }: Setup = {}) {
  const created: CreateProviderOptions[] = [];
  const requests: ChatRequest[] = [];
  const inner = provider ?? providerYielding('<seg id="1">안녕</seg>');
  const deps: PageTranslationDeps = {
    loadSettings: async () => ({ ...defaultSettings("ko"), ...settings }),
    loadOptions: async () => pageTranslationOptionsSchema.parse(options ?? {}),
    loadApiKey: async () => apiKey ?? undefined,
    createProvider: (providerOptions) => {
      created.push(providerOptions);
      return {
        stream(request, streamOptions) {
          requests.push(request);
          return inner.stream(request, streamOptions);
        },
      };
    },
    limiter: createRateLimiter(),
  };
  const fake = fakePort();
  handlePageTranslationPort(fake.port, deps);
  return { ...fake, created, requests };
}

const translate = {
  type: "translate",
  batch: 7,
  title: "A walk",
  segments: [
    { id: 1, text: "Hello" },
    { id: 2, text: "Read <g1>this</g1>" },
  ],
};

const ofType = (events: PageEvent[], type: PageEvent["type"]) =>
  events.filter((event) => event.type === type);

/** Waits until the handler has answered the request one way or the other. */
async function finished(events: PageEvent[]) {
  await vi.waitFor(() => {
    const last = events.at(-1)?.type;
    expect(last === "done" || last === "error").toBe(true);
  });
}

describe("handlePageTranslationPort", () => {
  it("tells the content script its options as soon as the port opens", async () => {
    const { events } = setup({ options: { requestsPerSecond: 5 } });
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]).toEqual({
      type: "config",
      options: {
        requestsPerSecond: 5,
        aheadViewports: 1,
        batchChars: 1500,
        keepLinkText: false,
      },
    });
  });

  it("sends each translated segment as the stream completes it", async () => {
    const { events, send, requests } = setup({
      provider: providerYielding(
        '<seg id="1">안',
        '녕</seg>\n<seg id="2"><g1>이것</g1>을',
        " 읽어라</seg>",
      ),
    });
    send(translate);
    await finished(events);

    expect(events.slice(1)).toEqual([
      { type: "segment", batch: 7, id: 1, text: "안녕" },
      { type: "segment", batch: 7, id: 2, text: "<g1>이것</g1>을 읽어라" },
      { type: "done", batch: 7 },
    ]);
    expect(requests[0]?.system).toContain("into Korean");
    expect(requests[0]?.messages[0]?.content).toBe(
      [
        "<title>A walk</title>",
        '<seg id="1">Hello</seg>',
        '<seg id="2">Read <g1>this</g1></seg>',
      ].join("\n"),
    );
  });

  it("uses the provider and model from the settings", async () => {
    const { events, send, created } = setup({
      settings: { provider: "openai", models: { openai: "gpt-6-luna" } },
    });
    send(translate);
    await finished(events);
    expect(created[0]).toMatchObject({
      provider: "openai",
      apiKey: "key",
      model: "gpt-6-luna",
    });
  });

  it("serves several requests on one port at the same time", async () => {
    const { events, send } = setup();
    send({ ...translate, batch: 1 });
    send({ ...translate, batch: 2 });
    await vi.waitFor(() => expect(ofType(events, "done")).toHaveLength(2));
    expect(ofType(events, "done")).toEqual([
      { type: "done", batch: 1 },
      { type: "done", batch: 2 },
    ]);
  });

  it("reports a missing key for the request that needed it", async () => {
    const { events, send, created } = setup({ apiKey: null });
    send(translate);
    await finished(events);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      batch: 7,
      kind: "missing_key",
    });
    expect(created).toEqual([]);
  });

  it("passes on why the provider failed", async () => {
    const { events, send } = setup({
      provider: {
        // biome-ignore lint/correctness/useYield: a provider that fails before it has any text
        async *stream() {
          throw new LLMError("rate_limit", "Slow down.");
        },
      },
    });
    send(translate);
    await finished(events);
    expect(events.at(-1)).toEqual({
      type: "error",
      batch: 7,
      kind: "rate_limit",
      message: "Slow down.",
    });
  });

  it("grants permits at the rate in the options", async () => {
    vi.useFakeTimers();
    try {
      const { events, send } = setup({ options: { requestsPerSecond: 2 } });
      for (let i = 0; i < 3; i++) send({ type: "permit" });

      await vi.advanceTimersByTimeAsync(10);
      expect(ofType(events, "permit")).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1000);
      expect(ofType(events, "permit")).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores messages that are not requests", async () => {
    const { events, send } = setup();
    send({ type: "translate", batch: 1, segments: [] });
    send({ type: "translate", batch: "one", segments: [{ id: 1, text: "a" }] });
    send("permit");
    await vi.waitFor(() => expect(events).toHaveLength(1));
    expect(events[0]?.type).toBe("config");
  });

  it("cancels what is in progress when the port closes", async () => {
    let signal: AbortSignal | undefined;
    const { events, send, disconnect } = setup({
      provider: {
        async *stream(_request, options) {
          signal = options?.signal;
          yield '<seg id="1">안녕</seg>';
          await new Promise((resolve) =>
            signal?.addEventListener("abort", resolve),
          );
          yield '<seg id="2">늦음</seg>';
        },
      },
    });
    send(translate);
    await vi.waitFor(() => expect(ofType(events, "segment")).toHaveLength(1));

    disconnect();
    await vi.waitFor(() => expect(signal?.aborted).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Nothing is posted to a port that has closed.
    expect(ofType(events, "segment")).toHaveLength(1);
    expect(ofType(events, "done")).toEqual([]);
  });
});
