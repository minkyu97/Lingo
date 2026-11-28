import { LLMError, type ModelInfo } from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";
import { describe, expect, it } from "vitest";
import { checkApiKey } from "./key-check.ts";

const models: ModelInfo[] = [
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol" },
  { id: "o3", label: "o3" },
];

/** A provider whose model list ends the given way. */
function depsWhere(listModels: () => Promise<ModelInfo[]>) {
  const created: CreateProviderOptions[] = [];
  return {
    created,
    createProvider(options: CreateProviderOptions) {
      created.push(options);
      return { listModels };
    },
  };
}

describe("checkApiKey", () => {
  it("accepts a key the provider accepts, and passes on its models", async () => {
    const deps = depsWhere(async () => models);
    expect(await checkApiKey("openai", "key-o", deps)).toEqual({
      status: "accepted",
      models,
    });
    expect(deps.created).toEqual([
      { provider: "openai", apiKey: "key-o", baseURL: undefined },
    ]);
  });

  it("rejects a key the provider refuses", async () => {
    const deps = depsWhere(async () => {
      throw new LLMError("auth", "Anthropic rejected the API key.");
    });
    expect(await checkApiKey("anthropic", "bad", deps)).toEqual({
      status: "rejected",
      models: [],
    });
  });

  it.each([
    new LLMError("network", "Could not reach Anthropic."),
    new LLMError("rate_limit", "Slow down."),
    new LLMError("api", "Overloaded"),
    new TypeError("something else"),
  ])("leaves the question open after %s", async (error) => {
    const deps = depsWhere(async () => {
      throw error;
    });
    expect(await checkApiKey("anthropic", "key", deps)).toEqual({
      status: "unreachable",
      models: [],
    });
  });

  it("checks against the address the tests point it at", async () => {
    const deps = {
      ...depsWhere(async () => []),
      baseURL: () => "http://127.0.0.1:1",
    };
    await checkApiKey("anthropic", "key", deps);
    expect(deps.created[0]?.baseURL).toBe("http://127.0.0.1:1");
  });
});
