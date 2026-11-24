import { LLMError } from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";
import { describe, expect, it } from "vitest";
import { checkApiKey } from "./key-check.ts";

/** A provider whose key check ends the given way. */
function depsWhere(check: () => Promise<void>) {
  const created: CreateProviderOptions[] = [];
  return {
    created,
    createProvider(options: CreateProviderOptions) {
      created.push(options);
      return { checkKey: check };
    },
  };
}

describe("checkApiKey", () => {
  it("accepts a key the provider accepts", async () => {
    const deps = depsWhere(async () => {});
    expect(await checkApiKey("openai", "key-o", deps)).toBe("accepted");
    expect(deps.created).toEqual([
      { provider: "openai", apiKey: "key-o", baseURL: undefined },
    ]);
  });

  it("rejects a key the provider refuses", async () => {
    const deps = depsWhere(async () => {
      throw new LLMError("auth", "Anthropic rejected the API key.");
    });
    expect(await checkApiKey("anthropic", "bad", deps)).toBe("rejected");
  });

  it("leaves the question open when the provider could not be asked", async () => {
    for (const failure of [
      new LLMError("network", "Could not reach Anthropic."),
      new LLMError("rate_limit", "Anthropic rate limit reached."),
      new LLMError("api", "Overloaded"),
      new Error("boom"),
    ]) {
      const deps = depsWhere(async () => {
        throw failure;
      });
      expect(await checkApiKey("anthropic", "key", deps)).toBe("unreachable");
    }
  });

  it("sends the check where the lookups go", async () => {
    const deps = {
      ...depsWhere(async () => {}),
      baseURL: (provider: string) => `http://localhost/${provider}`,
    };
    await checkApiKey("anthropic", "key", deps);
    expect(deps.created[0]?.baseURL).toBe("http://localhost/anthropic");
  });
});
