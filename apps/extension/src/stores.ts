import { normalizeSettings, type Settings } from "@lingo/core";
import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";
import { z } from "zod";
import { migrateLegacySettings } from "./legacy-settings.ts";
import {
  type PageTranslationOptions,
  pageTranslationOptionsSchema,
} from "./page-translation/protocol.ts";

/** The API key of each engine that has one, by engine ID. */
export type EngineKeys = Record<string, string>;

/** What is in storage may be old or damaged. Anything unusable reads as no keys. */
const storedEngineKeys = z
  .record(z.string(), z.unknown())
  .transform((entries) => {
    const keys: EngineKeys = {};
    for (const [id, value] of Object.entries(entries)) {
      const key = typeof value === "string" ? value.trim() : "";
      if (key) keys[id] = key;
    }
    return keys;
  })
  // A new object each time, since callers add to what they are given.
  .catch(() => ({}));

const settingsItem = storage.defineItem<unknown>("local:settings");
const pageTranslationItem = storage.defineItem<unknown>(
  "local:pageTranslation",
);
const engineKeysItem = storage.defineItem<unknown>("local:engineKeys");
/** One key per provider, from before there were engines. */
const legacyKeysItem = storage.defineItem<unknown>("local:apiKeys");

/**
 * Turns settings from before there were engines into engines, once. The old
 * keys are removed after they have been handed to the new engines.
 */
async function migrate(stored: unknown): Promise<unknown> {
  const migrated = migrateLegacySettings(
    stored,
    await legacyKeysItem.getValue(),
  );
  if (!migrated) return stored;

  const { keys, ...engines } = migrated;
  const settings = { ...(stored as object), ...engines };
  await engineKeysItem.setValue({ ...(await loadEngineKeys()), ...keys });
  await settingsItem.setValue(normalizeSettings(settings, navigator.language));
  await legacyKeysItem.removeValue();
  return settings;
}

/** Reads the settings, falling back to defaults for anything missing or invalid. */
export async function loadSettings(): Promise<Settings> {
  const stored = await migrate(await settingsItem.getValue());
  return normalizeSettings(stored, navigator.language);
}

export async function saveSettings(settings: Settings): Promise<void> {
  await settingsItem.setValue(settings);
}

/** Reads how page translation is tuned, with defaults for what is not set. */
export async function loadPageTranslationOptions(): Promise<PageTranslationOptions> {
  return pageTranslationOptionsSchema.parse(
    (await pageTranslationItem.getValue()) ?? {},
  );
}

export async function loadEngineKeys(): Promise<EngineKeys> {
  return storedEngineKeys.parse(await engineKeysItem.getValue());
}

export async function loadEngineKey(
  engineId: string,
): Promise<string | undefined> {
  return (await loadEngineKeys())[engineId];
}

/** Stores the key of an engine. An empty or missing key removes it. */
export async function saveEngineKey(
  engineId: string,
  key: string | undefined,
): Promise<void> {
  const keys = await loadEngineKeys();
  delete keys[engineId];
  if (key?.trim()) keys[engineId] = key.trim();
  await engineKeysItem.setValue(keys);
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
