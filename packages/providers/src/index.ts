import type { LLMProvider, ProviderId } from "@lingo/core";
import { createAnthropicProvider } from "./anthropic.ts";
import { createOpenAIProvider } from "./openai.ts";

export { PROVIDERS, type ProviderInfo } from "./catalog.ts";

export interface CreateProviderOptions {
  provider: ProviderId;
  apiKey: string;
  /** Model ID. Defaults to the provider's default model. */
  model?: string;
  baseURL?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
}

/** Builds the adapter for the chosen provider. */
export function createProvider(options: CreateProviderOptions): LLMProvider {
  const { provider, ...rest } = options;
  switch (provider) {
    case "anthropic":
      return createAnthropicProvider(rest);
    case "openai":
      return createOpenAIProvider(rest);
  }
}
