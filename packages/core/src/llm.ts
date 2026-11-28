import type { ModelInfo } from "./engines.ts";

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Asks for an answer that is one JSON document matching a schema. */
export interface ResponseFormat {
  /** A short identifier for the format, such as "dictionary_entry". */
  name: string;
  /** The JSON Schema the answer must follow. */
  schema: Record<string, unknown>;
}

/** A provider-neutral request: instructions plus a conversation. */
export interface ChatRequest {
  /** Instructions for the model, kept apart from the conversation. */
  system: string;
  messages: ChatMessage[];
  /**
   * When set, the answer is JSON in this format instead of free text. An
   * adapter enforces the schema where the model supports it. Either way the
   * instructions must also describe the format, since some models only have
   * those to go on.
   */
  format?: ResponseFormat;
}

export interface StreamOptions {
  signal?: AbortSignal;
}

/** Port for a streaming chat model. Adapters live in `@lingo/providers`. */
export interface LLMProvider {
  /** Yields the response text in chunks as the model generates it. */
  stream(request: ChatRequest, options?: StreamOptions): AsyncIterable<string>;
  /**
   * Lists the models the API key can use, newest first, and generates
   * nothing. This is also how a key is checked: it rejects with an `LLMError`
   * of kind `auth` when the provider turned the key down, and of any other
   * kind when the question could not be settled, as when the provider is
   * unreachable.
   */
  listModels(): Promise<ModelInfo[]>;
}

/**
 * Why a request failed, in terms a UI can act on:
 * - `missing_key`: no API key is configured for the provider
 * - `auth`: the provider rejected the key
 * - `rate_limit`: too many requests, or the account is out of quota
 * - `refusal`: the model declined to answer
 * - `network`: the provider could not be reached
 * - `api`: any other provider error
 */
export type LLMErrorKind =
  | "missing_key"
  | "auth"
  | "rate_limit"
  | "refusal"
  | "network"
  | "api";

export class LLMError extends Error {
  readonly kind: LLMErrorKind;

  constructor(kind: LLMErrorKind, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LLMError";
    this.kind = kind;
  }
}
