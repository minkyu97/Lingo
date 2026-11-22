import Anthropic from "@anthropic-ai/sdk";
import {
  type ChatRequest,
  LLMError,
  type LLMProvider,
  type StreamOptions,
} from "@lingo/core";

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to `ANTHROPIC_DEFAULT_MODEL`. */
  model?: string;
  baseURL?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
}

interface ModelTraits {
  label: string;
  /** Accepts `output_config.effort`. */
  effort: boolean;
  /** Has server-side fallback for requests the model declines. */
  fallbacks: boolean;
}

/**
 * Models offered in settings. Request parameters that some models reject are
 * sent only to models listed here; a model ID typed in by hand gets a plain
 * request.
 */
export const ANTHROPIC_MODELS: Readonly<Record<string, ModelTraits>> = {
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

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** A ceiling, not a target: lookups are short, and a cut-off answer is worse. */
const MAX_TOKENS = 16000;

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): LLMProvider {
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  const traits = ANTHROPIC_MODELS[model];
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: options.maxRetries,
    fetch: options.fetch,
    // The key belongs to the user and stays on their device. This flag also
    // makes the SDK send the header the API requires from browser origins.
    dangerouslyAllowBrowser: true,
  });

  async function* stream(
    request: ChatRequest,
    { signal }: StreamOptions = {},
  ): AsyncGenerator<string> {
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: request.messages,
      // Lookups are simple, so trade reasoning depth for a faster first token.
      ...(traits?.effort ? { output_config: { effort: "low" as const } } : {}),
    };

    try {
      const response = traits?.fallbacks
        ? client.beta.messages.stream(
            { ...params, betas: [FALLBACK_BETA], fallbacks: "default" },
            { signal },
          )
        : client.messages.stream(params, { signal });

      for await (const event of response) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          yield event.delta.text;
        }
      }

      const message = await response.finalMessage();
      if (message.stop_reason === "refusal") {
        throw new LLMError("refusal", "Claude declined this request.");
      }
    } catch (error) {
      throw toLLMError(error);
    }
  }

  return { stream };
}

function toLLMError(error: unknown): LLMError {
  if (error instanceof LLMError) return error;
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new LLMError("auth", "Anthropic rejected the API key.", {
      cause: error,
    });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new LLMError("rate_limit", "Anthropic rate limit reached.", {
      cause: error,
    });
  }
  // Checked before APIError, which it extends.
  if (error instanceof Anthropic.APIConnectionError) {
    return new LLMError("network", "Could not reach Anthropic.", {
      cause: error,
    });
  }
  if (error instanceof Anthropic.APIError) {
    return new LLMError("api", error.message, { cause: error });
  }
  return new LLMError("api", String(error), { cause: error });
}
