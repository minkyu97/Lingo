import {
  type ChatRequest,
  LLMError,
  type LLMProvider,
  type StreamOptions,
} from "@lingo/core";
import OpenAI from "openai";
import { OPENAI_DEFAULT_MODEL, OPENAI_MODELS } from "./catalog.ts";
import { KEY_CHECK_MAX_RETRIES, KEY_CHECK_TIMEOUT_MS } from "./key-check.ts";

export interface OpenAIProviderOptions {
  apiKey: string;
  /** Model ID. Defaults to `OPENAI_DEFAULT_MODEL`. */
  model?: string;
  baseURL?: string;
  maxRetries?: number;
  fetch?: typeof fetch;
}

export function createOpenAIProvider(
  options: OpenAIProviderOptions,
): LLMProvider {
  const model = options.model ?? OPENAI_DEFAULT_MODEL;
  const traits = OPENAI_MODELS[model];
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
          // Hold the answer to the requested JSON schema where the model can be.
          ...(traits?.structuredOutput && request.format
            ? {
                text: {
                  format: {
                    type: "json_schema" as const,
                    name: request.format.name,
                    schema: request.format.schema,
                    strict: true,
                  },
                },
              }
            : {}),
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

  async function checkKey(): Promise<void> {
    try {
      // Listing models needs a valid key and generates nothing, so it is free.
      await client.models.list({
        timeout: KEY_CHECK_TIMEOUT_MS,
        maxRetries: options.maxRetries ?? KEY_CHECK_MAX_RETRIES,
      });
    } catch (error) {
      throw toLLMError(error);
    }
  }

  return { stream, checkKey };
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
