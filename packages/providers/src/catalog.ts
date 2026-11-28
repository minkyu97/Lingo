/**
 * What is known about each provider without asking it: its name, where to
 * get a key, and what the models Lingo knows by name accept. The models a
 * key can use are asked of the provider. This module imports no provider
 * SDK, so UI code can use it without bundling one.
 */
import type { ProviderId } from "@lingo/core";

export interface AnthropicModelTraits {
  label: string;
  /** Accepts `output_config.effort`. */
  effort: boolean;
  /** Has server-side fallback for requests the model declines. */
  fallbacks: boolean;
  /** Can be held to a JSON schema with `output_config.format`. */
  structuredOutput: boolean;
}

/**
 * Anthropic models that Lingo knows by name. Request parameters that some
 * models reject are sent to these, and to models whose provider said they
 * accept them. Any other model gets a plain request.
 */
export const ANTHROPIC_MODELS: Readonly<Record<string, AnthropicModelTraits>> =
  {
    "claude-opus-5-5": {
      label: "Claude Opus 5.5",
      effort: true,
      fallbacks: true,
      structuredOutput: true,
    },
    "claude-sonnet-5-5": {
      label: "Claude Sonnet 5.5",
      effort: true,
      fallbacks: true,
      structuredOutput: true,
    },
    "claude-haiku-5-5": {
      label: "Claude Haiku 5.5",
      effort: true,
      fallbacks: false,
      structuredOutput: true,
    },
  };

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

export interface OpenAIModelTraits {
  label: string;
  /** Can be held to a JSON schema with `text.format`. */
  structuredOutput: boolean;
}

/**
 * OpenAI models that Lingo knows by name. OpenAI does not say what a model
 * accepts, so parameters that some models reject are sent only to these.
 */
export const OPENAI_MODELS: Readonly<Record<string, OpenAIModelTraits>> = {
  "gpt-6.2-sol": { label: "GPT-6.2 Sol", structuredOutput: true },
  "gpt-6.2-astra": { label: "GPT-6.2 Astra", structuredOutput: true },
  "gpt-6-luna": { label: "GPT-6 Luna", structuredOutput: true },
};

export const OPENAI_DEFAULT_MODEL = "gpt-6.2-sol";

export interface ProviderInfo {
  label: string;
  /** Where a user creates an API key. */
  keysUrl: string;
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderInfo>> = {
  anthropic: {
    label: "Anthropic",
    keysUrl: "https://platform.claude.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    keysUrl: "https://platform.openai.com/api-keys",
  },
};
