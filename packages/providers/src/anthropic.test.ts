import { LLMError, parseDictionaryEntry } from "@lingo/core";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./anthropic.ts";
import {
  collect,
  errorResponse,
  fakeFetch,
  fixture,
  jsonRequest,
  jsonResponse,
  sampleRequest,
  sseResponse,
} from "./testing.ts";

function providerFor(respond: () => Response, model?: string) {
  const { fetch, calls } = fakeFetch(respond);
  const provider = createAnthropicProvider({
    apiKey: "test-key",
    model,
    fetch,
    maxRetries: 0,
  });
  return { provider, calls };
}

async function failure(respond: () => Response): Promise<LLMError> {
  const { provider } = providerFor(respond);
  const error = await collect(provider, sampleRequest).catch((e) => e);
  expect(error).toBeInstanceOf(LLMError);
  return error;
}

describe("createAnthropicProvider", () => {
  it("yields the text deltas of a stream", async () => {
    const { provider } = providerFor(() =>
      sseResponse(fixture("anthropic-text.sse")),
    );
    expect(await collect(provider, sampleRequest)).toEqual(["안녕", "하세요"]);
  });

  it("skips thinking blocks", async () => {
    const { provider } = providerFor(() =>
      sseResponse(fixture("anthropic-thinking-then-text.sse")),
    );
    expect(await collect(provider, sampleRequest)).toEqual(["강둑"]);
  });

  it("sends a streaming request for the default model", async () => {
    const { provider, calls } = providerFor(() =>
      sseResponse(fixture("anthropic-text.sse")),
    );
    await collect(provider, sampleRequest);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toContain("/v1/messages");
    expect(call?.headers.get("authorization")).toBe("Bearer test-key");
    expect(call?.headers.get("anthropic-dangerous-direct-browser-access")).toBe(
      "true",
    );
    expect(call?.body).toMatchObject({
      model: "claude-opus-5-5",
      stream: true,
      system: sampleRequest.system,
      messages: sampleRequest.messages,
      output_config: { effort: "low" },
      fallbacks: "default",
    });
    expect(call?.headers.get("anthropic-beta")).toContain(
      "server-side-fallback-2026-07-01",
    );
    expect(call?.body).not.toHaveProperty("temperature");
    expect(call?.body).not.toHaveProperty("thinking");
  });

  it("does not ask for a fallback on a model without one", async () => {
    const { provider, calls } = providerFor(
      () => sseResponse(fixture("anthropic-text.sse")),
      "claude-haiku-5-5",
    );
    await collect(provider, sampleRequest);

    expect(calls[0]?.body).toMatchObject({ output_config: { effort: "low" } });
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
    expect(calls[0]?.headers.get("anthropic-beta")).toBeNull();
  });

  it("sends a plain request to a model it does not know", async () => {
    const { provider, calls } = providerFor(
      () => sseResponse(fixture("anthropic-text.sse")),
      "some-custom-model",
    );
    await collect(provider, sampleRequest);

    expect(calls[0]?.body).toMatchObject({ model: "some-custom-model" });
    expect(calls[0]?.body).not.toHaveProperty("output_config");
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
  });

  it("holds a known model to the requested JSON schema", async () => {
    const { provider, calls } = providerFor(() =>
      sseResponse(fixture("anthropic-define.sse")),
    );
    const chunks = await collect(provider, jsonRequest);

    expect(calls[0]?.body).toMatchObject({
      output_config: {
        effort: "low",
        format: { type: "json_schema", schema: jsonRequest.format?.schema },
      },
    });
    expect(chunks.length).toBeGreaterThan(10);
    const entry = parseDictionaryEntry(chunks.join(""));
    expect(entry?.headword).toBe("bank");
    expect(entry?.senses).toHaveLength(3);
  });

  it("does not send a schema with a plain text request", async () => {
    const { provider, calls } = providerFor(() =>
      sseResponse(fixture("anthropic-text.sse")),
    );
    await collect(provider, sampleRequest);
    expect(calls[0]?.body).toMatchObject({ output_config: { effort: "low" } });
    expect(calls[0]?.body.output_config).not.toHaveProperty("format");
  });

  it("does not send a schema to a model it does not know", async () => {
    const { provider, calls } = providerFor(
      () => sseResponse(fixture("anthropic-define.sse")),
      "some-custom-model",
    );
    await collect(provider, jsonRequest);
    expect(calls[0]?.body).not.toHaveProperty("output_config");
  });

  it("asks a model it does not know for what its provider said it accepts", async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(fixture("anthropic-text.sse")),
    );
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      model: "claude-next",
      capabilities: { effort: true, structuredOutput: false },
      fetch,
      maxRetries: 0,
    });
    await collect(provider, {
      ...sampleRequest,
      format: { name: "f", schema: {} },
    });

    expect(calls[0]?.body).toMatchObject({
      model: "claude-next",
      output_config: { effort: "low" },
    });
    // No schema, since the model was not said to take one, and no fallback.
    expect(calls[0]?.body).not.toHaveProperty("output_config.format");
    expect(calls[0]?.body).not.toHaveProperty("fallbacks");
  });

  it("merges extra parameters into the request, over its own", async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(fixture("anthropic-text.sse")),
    );
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      model: "claude-next",
      parameters: { temperature: 0.3, max_tokens: 500 },
      fetch,
      maxRetries: 0,
    });
    await collect(provider, sampleRequest);
    expect(calls[0]?.body).toMatchObject({
      model: "claude-next",
      temperature: 0.3,
      max_tokens: 500,
    });
  });

  it("reports a refusal", async () => {
    const error = await failure(() =>
      sseResponse(fixture("anthropic-refusal.sse")),
    );
    expect(error.kind).toBe("refusal");
  });

  it("reports a rejected key", async () => {
    const error = await failure(() =>
      errorResponse(401, {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      }),
    );
    expect(error.kind).toBe("auth");
  });

  it("reports a rate limit", async () => {
    const error = await failure(() =>
      errorResponse(429, {
        type: "error",
        error: { type: "rate_limit_error", message: "slow down" },
      }),
    );
    expect(error.kind).toBe("rate_limit");
  });

  it("reports other API errors with the provider's message", async () => {
    const error = await failure(() =>
      errorResponse(400, {
        type: "error",
        error: { type: "invalid_request_error", message: "model: not found" },
      }),
    );
    expect(error.kind).toBe("api");
    expect(error.message).toContain("model: not found");
  });

  it("reports a network failure", async () => {
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await collect(provider, sampleRequest).catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("network");
  });
});

describe("listing the models of an Anthropic key", () => {
  const models = {
    data: [
      {
        type: "model",
        id: "claude-fable-5-2",
        display_name: "Claude Fable 5.2",
        capabilities: {
          effort: { supported: true },
          structured_outputs: { supported: true },
        },
      },
      {
        type: "model",
        id: "claude-haiku-4-5",
        display_name: "Claude Haiku 4.5",
        capabilities: {
          effort: { supported: false },
          structured_outputs: { supported: true },
        },
      },
      { type: "model", id: "claude-old", display_name: "" },
    ],
    has_more: false,
    first_id: "claude-fable-5-2",
    last_id: "claude-old",
  };

  it("returns them as listed, with what each one accepts", async () => {
    const { provider, calls } = providerFor(() => jsonResponse(models));
    expect(await provider.listModels()).toEqual([
      {
        id: "claude-fable-5-2",
        label: "Claude Fable 5.2",
        capabilities: { effort: true, structuredOutput: true },
      },
      {
        id: "claude-haiku-4-5",
        label: "Claude Haiku 4.5",
        capabilities: { effort: false, structuredOutput: true },
      },
      { id: "claude-old", label: "claude-old", capabilities: undefined },
    ]);

    // One request, which generates nothing.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/v1/models");
  });

  it("reports a rejected key", async () => {
    const { provider } = providerFor(() =>
      errorResponse(401, {
        type: "error",
        error: { type: "authentication_error", message: "invalid x-api-key" },
      }),
    );
    const error = await provider.listModels().catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("auth");
  });

  it("does not call a key rejected when the provider is failing", async () => {
    const { provider } = providerFor(() =>
      errorResponse(529, {
        type: "error",
        error: { type: "overloaded_error", message: "Overloaded" },
      }),
    );
    const error = await provider.listModels().catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).not.toBe("auth");
  });

  it("reports a network failure", async () => {
    const provider = createAnthropicProvider({
      apiKey: "test-key",
      maxRetries: 0,
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    const error = await provider.listModels().catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("network");
  });
});
