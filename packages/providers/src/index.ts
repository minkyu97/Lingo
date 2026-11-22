import type { LLMProvider, ProviderId } from "@lingo/core";
import {
  ANTHROPIC_DEFAULT_MODEL,
  ANTHROPIC_MODELS,
  createAnthropicProvider,
} from "./anthropic.ts";
import {
  createOpenAIProvider,
  OPENAI_DEFAULT_MODEL,
  OPENAI_MODELS,
} from "./openai.ts";

export interface ProviderInfo {
  label: string;
  defaultModel: string;
  /** Models to offer in settings. Other model IDs can still be used. */
  models: readonly { id: string; label: string }[];
  /** Where a user creates an API key. */
  keysUrl: string;
}

/** What a settings screen needs to know about each provider. */
export const PROVIDERS: Readonly<Record<ProviderId, ProviderInfo>> = {
  anthropic: {
    label: "Anthropic",
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    models: modelList(ANTHROPIC_MODELS),
    keysUrl: "https://platform.claude.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    defaultModel: OPENAI_DEFAULT_MODEL,
    models: modelList(OPENAI_MODELS),
    keysUrl: "https://platform.openai.com/api-keys",
  },
};

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

function modelList(
  models: Readonly<Record<string, { label: string }>>,
): { id: string; label: string }[] {
  return Object.entries(models).map(([id, { label }]) => ({ id, label }));
}
