import {
  normalizeSettings,
  type ProviderId,
  perProviderTextSchema,
  type Settings,
} from "@lingo/core";
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";
import type { z } from "zod";
import {
  type PageTranslationOptions,
  pageTranslationOptionsSchema,
} from "./page-translation/protocol.ts";

/** One API key per provider, for the providers that have one. */
export type ApiKeys = z.infer<typeof perProviderTextSchema>;

/** What is in storage may be old or damaged. Anything unusable reads as no keys. */
const storedApiKeys = perProviderTextSchema.catch({});

const settingsItem = storage.defineItem<unknown>("local:settings");
const pageTranslationItem = storage.defineItem<unknown>(
  "local:pageTranslation",
);
const apiKeysItem = storage.defineItem<unknown>("local:apiKeys");

/** Reads the settings, falling back to defaults for anything missing or invalid. */
export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await settingsItem.getValue(), navigator.language);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsItem.setValue(settings);
}

/** Reads how page translation behaves, with defaults for what is not set. */
export async function loadPageTranslationOptions(): Promise<PageTranslationOptions> {
  return pageTranslationOptionsSchema.parse(
    (await pageTranslationItem.getValue()) ?? {},
  );
}

export async function loadApiKeys(): Promise<ApiKeys> {
  return storedApiKeys.parse(await apiKeysItem.getValue());
}

export async function loadApiKey(
  provider: ProviderId,
): Promise<string | undefined> {
  return (await loadApiKeys())[provider];
}

/** Replaces the stored keys. An empty or missing entry removes that key. */
export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  await apiKeysItem.setValue(perProviderTextSchema.parse(keys));
}

/**
 * Closes `storage.local` to content scripts, which run inside web pages.
 * After this only the background and the extension's own pages can read the
 * API keys.
 */
export async function restrictStorageToTrustedContexts(): Promise<void> {
  await browser.storage.local.setAccessLevel?.({
    accessLevel: "TRUSTED_CONTEXTS",
  });
}
