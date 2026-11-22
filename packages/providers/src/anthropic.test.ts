import { LLMError } from "@lingo/core";
import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "./anthropic.ts";
import {
  collect,
  errorResponse,
  fakeFetch,
  fixture,
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
