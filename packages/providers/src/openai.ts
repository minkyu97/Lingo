import {
  type ChatRequest,
  LLMError,
  type LLMProvider,
  type StreamOptions,
} from "@lingo/core";
import OpenAI from "openai";

export interface OpenAIProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to `OPENAI_DEFAULT_MODEL`. */
  model?: string;
  baseURL?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
}

/** Models offered in settings. Any other model ID can be typed in by hand. */
export const OPENAI_MODELS: Readonly<Record<string, { label: string }>> = {
  "gpt-6.2-sol": { label: "GPT-6.2 Sol" },
  "gpt-6.2-astra": { label: "GPT-6.2 Astra" },
  "gpt-6-luna": { label: "GPT-6 Luna" },
};

export const OPENAI_DEFAULT_MODEL = "gpt-6.2-sol";

export function createOpenAIProvider(
  options: OpenAIProviderOptions,
): LLMProvider {
  const model = options.model ?? OPENAI_DEFAULT_MODEL;
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: options.maxRetries,
    fetch: options.fetch,
    // The key belongs to the user and stays on their device.
    dangerouslyAllowBrowser: true,
  });

  async function* stream(
    request: ChatRequest,
    { signal }: StreamOptions = {},
  ): AsyncGenerator<string> {
    try {
      const events = await client.responses.create(
        {
          model,
          instructions: request.system,
          input: request.messages.map(({ role, content }) => ({
            role,
            content,
          })),
          stream: true,
          // Do not keep the user's text on OpenAI's side after the request.
          store: false,
        },
        { signal },
      );

      for await (const event of events) {
        switch (event.type) {
          case "response.output_text.delta":
            yield event.delta;
            break;
          case "response.refusal.done":
            throw new LLMError("refusal", event.refusal);
          case "response.failed":
            throw new LLMError(
              "api",
              event.response.error?.message ?? "The response failed.",
            );
          case "error":
            throw new LLMError("api", event.message);
        }
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
    error instanceof OpenAI.AuthenticationError ||
    error instanceof OpenAI.PermissionDeniedError
  ) {
    return new LLMError("auth", "OpenAI rejected the API key.", {
      cause: error,
    });
  }
  if (error instanceof OpenAI.RateLimitError) {
    return new LLMError("rate_limit", "OpenAI rate limit reached.", {
      cause: error,
    });
  }
  // Checked before APIError, which it extends.
  if (error instanceof OpenAI.APIConnectionError) {
    return new LLMError("network", "Could not reach OpenAI.", {
      cause: error,
    });
  }
  if (error instanceof OpenAI.APIError) {
    return new LLMError("api", error.message, { cause: error });
  }
  return new LLMError("api", String(error), { cause: error });
}
