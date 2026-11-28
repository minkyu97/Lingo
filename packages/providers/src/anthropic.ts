import Anthropic from "@anthropic-ai/sdk";
import {
  type ChatRequest,
  LLMError,
  type LLMProvider,
  type ModelCapabilities,
  type ModelInfo,
  type StreamOptions,
} from "@lingo/core";
import { ANTHROPIC_DEFAULT_MODEL, ANTHROPIC_MODELS } from "./catalog.ts";
import { KEY_CHECK_MAX_RETRIES, KEY_CHECK_TIMEOUT_MS } from "./key-check.ts";

export interface AnthropicProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to `ANTHROPIC_DEFAULT_MODEL`. */
  model?: string;
  /**
   * What the provider said the model accepts. Used for a model that the
   * catalog does not know.
   */
  capabilities?: ModelCapabilities;
  /** Merged into every request, over what the adapter sets itself. */
  parameters?: Record<string, unknown>;
  baseURL?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** More models than the API has, so that one page holds them all. */
const MODEL_LIST_LIMIT = 100;

/** The part of a listed model that says what it accepts. */
interface ListedModel {
  capabilities?: {
    effort?: { supported?: boolean };
    structured_outputs?: { supported?: boolean };
  };
}

/** A ceiling, not a target: lookups are short, and a cut-off answer is worse. */
const MAX_TOKENS = 16000;

export function createAnthropicProvider(
  options: AnthropicProviderOptions,
): LLMProvider {
  const model = options.model ?? ANTHROPIC_DEFAULT_MODEL;
  const known = ANTHROPIC_MODELS[model];
  const traits = {
    effort: known?.effort ?? options.capabilities?.effort ?? false,
    structuredOutput:
      known?.structuredOutput ??
      options.capabilities?.structuredOutput ??
      false,
    fallbacks: known?.fallbacks ?? false,
  };
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
    const outputConfig = {
      // Lookups are simple, so trade reasoning depth for a faster first token.
      ...(traits.effort ? { effort: "low" as const } : {}),
      // Hold the answer to the requested JSON schema where the model can be.
      ...(traits.structuredOutput && request.format
        ? {
            format: {
              type: "json_schema" as const,
              schema: request.format.schema,
            },
          }
        : {}),
    };
    const params = {
      model,
      max_tokens: MAX_TOKENS,
      system: request.system,
      messages: request.messages,
      ...(Object.keys(outputConfig).length > 0
        ? { output_config: outputConfig }
        : {}),
      ...options.parameters,
    };

    try {
      const response = traits.fallbacks
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

  async function listModels(): Promise<ModelInfo[]> {
    try {
      // Listing models needs a valid key and generates nothing, so it is free.
      const page = await client.models.list(
        { limit: MODEL_LIST_LIMIT },
        {
          timeout: KEY_CHECK_TIMEOUT_MS,
          maxRetries: options.maxRetries ?? KEY_CHECK_MAX_RETRIES,
        },
      );
      // The API lists the newest model first.
      return page.data.map((model) => {
        const { capabilities } = model as ListedModel;
        return {
          id: model.id,
          label: model.display_name || model.id,
          capabilities: capabilities && {
            effort: capabilities.effort?.supported,
            structuredOutput: capabilities.structured_outputs?.supported,
          },
        };
      });
    } catch (error) {
      throw toLLMError(error);
    }
  }

  return { stream, listModels };
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
