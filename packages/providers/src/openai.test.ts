import { LLMError } from "@lingo/core";
import { describe, expect, it } from "vitest";
import { createOpenAIProvider } from "./openai.ts";
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
  const provider = createOpenAIProvider({
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

describe("createOpenAIProvider", () => {
  it("yields the text deltas of a stream", async () => {
    const { provider } = providerFor(() =>
      sseResponse(fixture("openai-text.sse")),
    );
    expect(await collect(provider, sampleRequest)).toEqual(["안녕", "하세요"]);
  });

  it("sends a streaming Responses request that is not stored", async () => {
    const { provider, calls } = providerFor(() =>
      sseResponse(fixture("openai-text.sse")),
    );
    await collect(provider, sampleRequest);

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toContain("/responses");
    expect(call?.headers.get("authorization")).toBe("Bearer test-key");
    expect(call?.body).toEqual({
      model: "gpt-6.2-sol",
      instructions: sampleRequest.system,
      input: sampleRequest.messages,
      stream: true,
      store: false,
    });
  });

  it("uses the configured model", async () => {
    const { provider, calls } = providerFor(
      () => sseResponse(fixture("openai-text.sse")),
      "gpt-6-luna",
    );
    await collect(provider, sampleRequest);
    expect(calls[0]?.body).toMatchObject({ model: "gpt-6-luna" });
  });

  it("reports a refusal", async () => {
    const error = await failure(() =>
      sseResponse(fixture("openai-refusal.sse")),
    );
    expect(error.kind).toBe("refusal");
  });

  it("reports a failed response with the provider's message", async () => {
    const error = await failure(() =>
      sseResponse(fixture("openai-failed.sse")),
    );
    expect(error.kind).toBe("api");
    expect(error.message).toContain("failed to generate");
  });

  it("reports a rejected key", async () => {
    const error = await failure(() =>
      errorResponse(401, {
        error: {
          message: "Incorrect API key provided",
          type: "invalid_request_error",
        },
      }),
    );
    expect(error.kind).toBe("auth");
  });

  it("reports a rate limit", async () => {
    const error = await failure(() =>
      errorResponse(429, {
        error: { message: "Rate limit reached", type: "rate_limit_error" },
      }),
    );
    expect(error.kind).toBe("rate_limit");
  });

  it("reports a network failure", async () => {
    const provider = createOpenAIProvider({
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
