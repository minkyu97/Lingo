import { PROVIDER_IDS } from "@lingo/core";
import { describe, expect, it } from "vitest";
import { createProvider, PROVIDERS } from "./index.ts";
import {
  collect,
  fakeFetch,
  fixture,
  sampleRequest,
  sseResponse,
} from "./testing.ts";

describe("PROVIDERS", () => {
  it("describes every provider the settings can select", () => {
    expect(Object.keys(PROVIDERS).sort()).toEqual([...PROVIDER_IDS].sort());
  });

  it("lists each default model among the offered models", () => {
    for (const info of Object.values(PROVIDERS)) {
      const offered = info.models.map((model) => model.id);
      expect(offered).toContain(info.defaultModel);
      expect(offered).toContain(info.defaultPageModel);
    }
  });
});

describe("createProvider", () => {
  it("routes to the Anthropic adapter", async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(fixture("anthropic-text.sse")),
    );
    const provider = createProvider({
      provider: "anthropic",
      apiKey: "k",
      fetch,
    });
    expect((await collect(provider, sampleRequest)).join("")).toBe(
      "안녕하세요",
    );
    expect(calls[0]?.url).toContain("api.anthropic.com");
  });

  it("routes to the OpenAI adapter with the given model", async () => {
    const { fetch, calls } = fakeFetch(() =>
      sseResponse(fixture("openai-text.sse")),
    );
    const provider = createProvider({
      provider: "openai",
      apiKey: "k",
      model: "gpt-6-luna",
      fetch,
    });
    expect((await collect(provider, sampleRequest)).join("")).toBe(
      "안녕하세요",
    );
    expect(calls[0]?.url).toContain("api.openai.com");
    expect(calls[0]?.body).toMatchObject({ model: "gpt-6-luna" });
  });
});
