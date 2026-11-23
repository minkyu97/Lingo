import { z } from "zod";

export const PROVIDER_IDS = ["anthropic", "openai"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

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

/** Text with something in it. Anything else reads as absent. */
const optionalText = z.string().trim().min(1).optional().catch(undefined);

/**
 * One optional piece of text per provider, such as a model ID or an API key.
 * An entry that is missing, blank, or not text is left out.
 */
export const perProviderTextSchema = z
  .object(
    Object.fromEntries(PROVIDER_IDS.map((id) => [id, optionalText])) as Record<
      ProviderId,
      typeof optionalText
    >,
  )
  .transform((entries) => {
    const present: Partial<Record<ProviderId, string>> = {};
    for (const id of PROVIDER_IDS) {
      const value = entries[id];
      if (value !== undefined) present[id] = value;
    }
    return present;
  });

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
  // The schema is built per call, because the defaults depend on the locale.
  const defaults = defaultSettings(locale);
  const schema = z
    .object({
      provider: z.enum(PROVIDER_IDS).catch(defaults.provider),
      models: perProviderTextSchema.catch({}),
      targetLanguage: z
        .string()
        .refine(isLanguageTag)
        .catch(defaults.targetLanguage),
      contextAwareness: z.boolean().catch(defaults.contextAwareness),
      maxContextChars: z
        .number()
        .transform(clampContextChars)
        .catch(defaults.maxContextChars),
    })
    .catch(defaults);

  const settings: Settings = schema.parse(value);
  return settings;
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

function clampContextChars(value: number): number {
  return Math.min(MAX_CONTEXT_CHARS_LIMIT, Math.max(0, Math.round(value)));
}

function isLanguageTag(value: string): boolean {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}
