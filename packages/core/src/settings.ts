import { z } from "zod";
import {
  ENGINE_TASKS,
  type Engine,
  type EngineChoices,
  engineChoicesSchema,
  enginesSchema,
  PROVIDER_IDS,
  type ProviderId,
} from "./engines.ts";

export interface Settings {
  /** The engines the user has added, in the order they were added. */
  engines: Engine[];
  /**
   * The engine of each task, by ID. A task without an entry uses the first
   * engine.
   */
  engineFor: EngineChoices;
  /** BCP 47 tag of the language to translate into, such as "ko". */
  targetLanguage: string;
  /** Whether text around the selection is sent along with it. */
  contextAwareness: boolean;
  /** Upper bound on the surrounding text that is sent, in characters. */
  maxContextChars: number;
  /** Most page translation requests started in any one second. */
  pageRequestsPerSecond: number;
}

export const MAX_CONTEXT_CHARS_LIMIT = 4000;

/** The longest contexts offered in settings, in characters. */
export const CONTEXT_CHAR_PRESETS: readonly number[] = [500, 1000, 2000, 4000];

/** The request rates offered in settings, in requests per second. */
export const PAGE_REQUEST_RATE_PRESETS: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
];

/** The highest request rate that can be set, by typing it in. */
export const MAX_PAGE_REQUESTS_PER_SECOND = 100;

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
    engines: [],
    engineFor: {},
    targetLanguage: targetLanguageFor(locale),
    contextAwareness: true,
    maxContextChars: 1000,
    pageRequestsPerSecond: 3,
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
      engines: enginesSchema,
      engineFor: engineChoicesSchema,
      targetLanguage: z
        .string()
        .refine(isLanguageTag)
        .catch(defaults.targetLanguage),
      contextAwareness: z.boolean().catch(defaults.contextAwareness),
      maxContextChars: z
        .number()
        .transform(clampContextChars)
        .catch(defaults.maxContextChars),
      pageRequestsPerSecond: z
        .number()
        .transform(clampPageRequestRate)
        .catch(defaults.pageRequestsPerSecond),
    })
    .catch(defaults);

  const settings: Settings = schema.parse(value);
  // A choice of an engine that is gone is no choice.
  for (const task of ENGINE_TASKS) {
    const chosen = settings.engineFor[task];
    if (!settings.engines.some((engine) => engine.id === chosen)) {
      delete settings.engineFor[task];
    }
  }
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

/**
 * A language's name in that language, capitalized: "ko" becomes "한국어" and
 * "es" becomes "Español". Falls back to the English name.
 */
export function nativeLanguageName(tag: string): string {
  try {
    const name = new Intl.DisplayNames([tag], { type: "language" }).of(tag);
    if (!name) return languageName(tag);
    // Several languages write their own name in lower case.
    return name.charAt(0).toLocaleUpperCase(tag) + name.slice(1);
  } catch {
    return languageName(tag);
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

function clampPageRequestRate(value: number): number {
  return Math.min(MAX_PAGE_REQUESTS_PER_SECOND, Math.max(1, Math.round(value)));
}

function isLanguageTag(value: string): boolean {
  try {
    new Intl.Locale(value);
    return true;
  } catch {
    return false;
  }
}
