export type ProviderId = "anthropic" | "openai";

export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openai"];

export interface Settings {
  /** The provider lookups are sent to. */
  provider: ProviderId;
  /** Model ID per provider. A missing entry means that provider's default. */
  models: Partial<Record<ProviderId, string>>;
  /** BCP 47 tag of the language to translate into, such as "ko". */
  targetLanguage: string;
  /** Whether text around the selection is sent along with it. */
  contextAwareness: boolean;
  /** Upper bound on the surrounding text that is sent, in characters. */
  maxContextChars: number;
}

export const MAX_CONTEXT_CHARS_LIMIT = 4000;

/** Languages offered as translation targets, as BCP 47 tags. */
export const TARGET_LANGUAGES: readonly string[] = [
  "en",
  "ko",
  "ja",
  "zh-Hans",
  "zh-Hant",
  "es",
  "fr",
  "de",
  "it",
  "pt",
  "ru",
  "ar",
  "hi",
  "id",
  "vi",
  "th",
  "tr",
  "pl",
  "nl",
  "uk",
];

/** Settings for a first run. The target language follows the given locale. */
export function defaultSettings(locale?: string): Settings {
  return {
    provider: "anthropic",
    models: {},
    targetLanguage: targetLanguageFor(locale),
    contextAwareness: true,
    maxContextChars: 1000,
  };
}

/**
 * Turns whatever was read from storage into valid settings. Unknown or
 * malformed fields fall back to their defaults, so old or hand-edited data
 * never breaks the app.
 */
export function normalizeSettings(value: unknown, locale?: string): Settings {
  const defaults = defaultSettings(locale);
  if (!isRecord(value)) return defaults;

  return {
    provider: isProviderId(value.provider) ? value.provider : defaults.provider,
    models: normalizeModels(value.models),
    targetLanguage: isLanguageTag(value.targetLanguage)
      ? value.targetLanguage
      : defaults.targetLanguage,
    contextAwareness:
      typeof value.contextAwareness === "boolean"
        ? value.contextAwareness
        : defaults.contextAwareness,
    maxContextChars: normalizeMaxContextChars(
      value.maxContextChars,
      defaults.maxContextChars,
    ),
  };
}

/** English name of a language tag, for use in prompts: "ko" becomes "Korean". */
export function languageName(tag: string): string {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "language" });
    return names.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

function targetLanguageFor(locale: string | undefined): string {
  if (!locale) return "en";
  try {
    const parsed = new Intl.Locale(locale);
    // Chinese needs its script: Simplified and Traditional are different targets.
    if (parsed.language === "zh") {
      return parsed.maximize().script === "Hant" ? "zh-Hant" : "zh-Hans";
    }
    return parsed.language;
  } catch {
    return "en";
  }
}

function normalizeModels(value: unknown): Settings["models"] {
  const models: Settings["models"] = {};
  if (!isRecord(value)) return models;
  for (const id of PROVIDER_IDS) {
    const model = value[id];
    if (typeof model === "string" && model.trim() !== "") {
      models[id] = model.trim();
    }
  }
  return models;
}

function normalizeMaxContextChars(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(MAX_CONTEXT_CHARS_LIMIT, Math.max(0, Math.round(value)));
}

function isProviderId(value: unknown): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

function isLanguageTag(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
