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
    },
    "claude-sonnet-5-5": {
      label: "Claude Sonnet 5.5",
      effort: true,
      fallbacks: true,
    },
    "claude-haiku-5-5": {
      label: "Claude Haiku 5.5",
      effort: true,
      fallbacks: false,
    },
  };

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/** OpenAI models offered in settings. */
export const OPENAI_MODELS: Readonly<Record<string, { label: string }>> = {
  "gpt-6.2-sol": { label: "GPT-6.2 Sol" },
  "gpt-6.2-astra": { label: "GPT-6.2 Astra" },
  "gpt-6-luna": { label: "GPT-6 Luna" },
};

export const OPENAI_DEFAULT_MODEL = "gpt-6.2-sol";

export interface ProviderInfo {
  label: string;
  defaultModel: string;
  /** Models to offer in settings. Other model IDs can still be used. */
  models: readonly { id: string; label: string }[];
  /** Where a user creates an API key. */
  keysUrl: string;
}

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

function modelList(
  models: Readonly<Record<string, { label: string }>>,
): { id: string; label: string }[] {
  return Object.entries(models).map(([id, { label }]) => ({ id, label }));
}
