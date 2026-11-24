import { LLMError, type LLMProvider, type ProviderId } from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";
import { browser } from "wxt/browser";
import {
  type KeyCheckResult,
  keyCheckResultSchema,
  type RuntimeMessage,
} from "./messaging.ts";

export interface KeyCheckDeps {
  createProvider(options: CreateProviderOptions): Pick<LLMProvider, "checkKey">;
  /** Overrides the provider's API address. Used by end-to-end tests. */
  baseURL?(provider: ProviderId): string | undefined;
}

/**
 * The background side: asks the provider whether it accepts the key. Only a
 * refusal by the provider counts as rejected. Any other failure leaves the
 * question open, so the key is neither stored nor called wrong.
 */
export async function checkApiKey(
  provider: ProviderId,
  apiKey: string,
  deps: KeyCheckDeps,
): Promise<KeyCheckResult> {
  try {
    const baseURL = deps.baseURL?.(provider);
    await deps.createProvider({ provider, apiKey, baseURL }).checkKey();
    return "accepted";
  } catch (error) {
    const refused = error instanceof LLMError && error.kind === "auth";
    return refused ? "rejected" : "unreachable";
  }
}

/**
 * The settings side: has the background check a key. Provider calls are made
 * in the background only, so the settings page bundles no provider SDK.
 */
export async function requestKeyCheck(
  provider: ProviderId,
  apiKey: string,
): Promise<KeyCheckResult> {
  const message: RuntimeMessage = { type: "check-api-key", provider, apiKey };
  const answer: unknown = await browser.runtime
    .sendMessage(message)
    .catch(() => undefined);
  return keyCheckResultSchema.parse(answer);
}
