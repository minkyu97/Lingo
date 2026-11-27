import { LLMError, parseDictionaryEntry } from "@lingo/core";
import { describe, expect, it } from "vitest";
import { createOpenAIProvider } from "./openai.ts";
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

  it("holds a known model to the requested JSON schema", async () => {
    const { provider, calls } = providerFor(() =>
      sseResponse(fixture("openai-define.sse")),
    );
    const chunks = await collect(provider, jsonRequest);

    expect(calls[0]?.body).toMatchObject({
      text: {
        format: {
          type: "json_schema",
          name: "dictionary_entry",
          schema: jsonRequest.format?.schema,
          strict: true,
        },
      },
    });
    expect(chunks.length).toBeGreaterThan(10);
    const entry = parseDictionaryEntry(chunks.join(""));
    expect(entry?.headword).toBe("bank");
    expect(entry?.senses).toHaveLength(3);
  });

  it("does not send a schema to a model it does not know", async () => {
    const { provider, calls } = providerFor(
      () => sseResponse(fixture("openai-define.sse")),
      "some-custom-model",
    );
    await collect(provider, jsonRequest);
    expect(calls[0]?.body).not.toHaveProperty("text");
  });

  it("merges extra parameters into the request, and still streams", async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(fixture("openai-text.sse")),
    );
    const provider = createOpenAIProvider({
      apiKey: "test-key",
      model: "gpt-next",
      parameters: { temperature: 0.3, store: true, stream: false },
      fetch,
      maxRetries: 0,
    });
    expect((await collect(provider, sampleRequest)).join("")).toBe(
      "안녕하세요",
    );
    expect(calls[0]?.body).toMatchObject({
      model: "gpt-next",
      temperature: 0.3,
      store: true,
      stream: true,
    });
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

describe("listing the models of an OpenAI key", () => {
  const model = (id: string, created: number) => ({
    id,
    created,
    object: "model",
    owned_by: "system",
  });
  const models = {
    object: "list",
    data: [
      model("gpt-5.4-mini", 100),
      model("tts-1", 400),
      model("gpt-6.2-sol", 300),
      model("gpt-image-2", 500),
      model("text-embedding-3-large", 600),
      model("o3", 50),
      model("gpt-realtime-2", 700),
      model("gpt-6-luna", 200),
    ],
  };

  it("returns the models that answer text, newest first", async () => {
    const { provider, calls } = providerFor(() => jsonResponse(models));
    expect(await provider.listModels()).toEqual([
      { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
      { id: "gpt-6-luna", label: "GPT-6 Luna" },
      { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
      { id: "o3", label: "o3" },
    ]);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/v1/models");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-key");
  });

  it("reports a rejected key", async () => {
    const { provider } = providerFor(() =>
      errorResponse(401, {
        error: {
          message: "Incorrect API key provided",
          code: "invalid_api_key",
        },
      }),
    );
    const error = await provider.listModels().catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).toBe("auth");
  });

  it("does not call a key rejected when the provider is failing", async () => {
    const { provider } = providerFor(() =>
      errorResponse(503, { error: { message: "Service unavailable" } }),
    );
    const error = await provider.listModels().catch((e) => e);
    expect(error).toBeInstanceOf(LLMError);
    expect(error.kind).not.toBe("auth");
  });

  it("reports a network failure", async () => {
    const provider = createOpenAIProvider({
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
