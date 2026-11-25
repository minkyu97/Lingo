/**
 * What a settings screen needs to know about each provider: its name, its
 * models, and where to get a key. This module imports no provider SDK, so UI
 * code can use it without bundling one.
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
 * Anthropic models offered in settings. Request parameters that some models
 * reject are sent only to models listed here; a model ID typed in by hand
 * gets a plain request.
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

/**
 * The model that translates whole pages unless another is chosen. A page
 * takes many requests, and the reader waits for each, so it is the fast one.
 */
export const ANTHROPIC_DEFAULT_PAGE_MODEL = "claude-haiku-5-5";

export interface OpenAIModelTraits {
  label: string;
  /** Can be held to a JSON schema with `text.format`. */
  structuredOutput: boolean;
}

/**
 * OpenAI models offered in settings. As with Anthropic, parameters that some
 * models reject are sent only to models listed here.
 */
export const OPENAI_MODELS: Readonly<Record<string, OpenAIModelTraits>> = {
  "gpt-6.2-sol": { label: "GPT-6.2 Sol", structuredOutput: true },
  "gpt-6.2-astra": { label: "GPT-6.2 Astra", structuredOutput: true },
  "gpt-6-luna": { label: "GPT-6 Luna", structuredOutput: true },
};

export const OPENAI_DEFAULT_MODEL = "gpt-6.2-sol";

/**
 * The model that translates whole pages unless another is chosen. Here it is
 * the default for lookups: in a live run on 2026-11-25, neither of the other
 * two models translated a page faster.
 */
export const OPENAI_DEFAULT_PAGE_MODEL = "gpt-6.2-sol";

export interface ProviderInfo {
  label: string;
  defaultModel: string;
  /** The model for translating whole pages when none is chosen. */
  defaultPageModel: string;
  /** Models to offer in settings. Other model IDs can still be used. */
  models: readonly { id: string; label: string }[];
  /** Where a user creates an API key. */
  keysUrl: string;
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderInfo>> = {
  anthropic: {
    label: "Anthropic",
    defaultModel: ANTHROPIC_DEFAULT_MODEL,
    defaultPageModel: ANTHROPIC_DEFAULT_PAGE_MODEL,
    models: modelList(ANTHROPIC_MODELS),
    keysUrl: "https://platform.claude.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    defaultModel: OPENAI_DEFAULT_MODEL,
    defaultPageModel: OPENAI_DEFAULT_PAGE_MODEL,
    models: modelList(OPENAI_MODELS),
    keysUrl: "https://platform.openai.com/api-keys",
  },
};

function modelList(
  models: Readonly<Record<string, { label: string }>>,
): { id: string; label: string }[] {
  return Object.entries(models).map(([id, { label }]) => ({ id, label }));
}
