import {
  normalizeSettings,
  PROVIDER_IDS,
  type ProviderId,
  type Settings,
} from "@lingo/core";
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";

export type ApiKeys = Partial<Record<ProviderId, string>>;

const settingsItem = storage.defineItem<unknown>("local:settings");
const apiKeysItem = storage.defineItem<unknown>("local:apiKeys");

/** Reads the settings, falling back to defaults for anything missing or invalid. */
export async function loadSettings(): Promise<Settings> {
  return normalizeSettings(await settingsItem.getValue(), navigator.language);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsItem.setValue(settings);
}

export async function loadApiKeys(): Promise<ApiKeys> {
  const stored = await apiKeysItem.getValue();
  const keys: ApiKeys = {};
  if (typeof stored !== "object" || stored === null) return keys;
  for (const provider of PROVIDER_IDS) {
    const key = (stored as Record<string, unknown>)[provider];
    if (typeof key === "string" && key.trim() !== "") {
      keys[provider] = key.trim();
    }
  }
  return keys;
}

export async function loadApiKey(
  provider: ProviderId,
): Promise<string | undefined> {
  return (await loadApiKeys())[provider];
}

/** Replaces the stored keys. An empty or missing entry removes that key. */
export async function saveApiKeys(keys: ApiKeys): Promise<void> {
  const cleaned: ApiKeys = {};
  for (const provider of PROVIDER_IDS) {
    const key = keys[provider]?.trim();
    if (key) cleaned[provider] = key;
  }
  await apiKeysItem.setValue(cleaned);
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
