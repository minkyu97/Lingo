/**
 * Settings as they were stored before there were engines: one provider for
 * everything, a model per provider for lookups and one for pages, and one
 * API key per provider. They are turned into engines once, so that someone
 * who updates keeps what they had set up.
 */
import {
  type Engine,
  type EngineChoices,
  PROVIDER_IDS,
  type ProviderId,
  perProviderTextSchema,
} from "@lingo/core";
import { z } from "zod";

/** The models that answered when none was chosen, at the time. */
const OLD_DEFAULTS: Record<ProviderId, { lookup: string; page: string }> = {
  anthropic: { lookup: "claude-opus-5-5", page: "claude-haiku-5-5" },
  openai: { lookup: "gpt-6.2-sol", page: "gpt-6.2-sol" },
};

/** Names of the models that settings offered, to show until a list is asked for. */
const OLD_LABELS: Record<string, string> = {
  "claude-opus-5-5": "Claude Opus 5.5",
  "claude-sonnet-5-5": "Claude Sonnet 5.5",
  "claude-haiku-5-5": "Claude Haiku 5.5",
  "gpt-6.2-sol": "GPT-6.2 Sol",
  "gpt-6.2-astra": "GPT-6.2 Astra",
  "gpt-6-luna": "GPT-6 Luna",
};

const legacySettingsSchema = z.object({
  provider: z.enum(PROVIDER_IDS),
  models: perProviderTextSchema.catch({}),
  pageModels: perProviderTextSchema.catch({}),
});

export interface Migrated {
  engines: Engine[];
  engineFor: EngineChoices;
  /** The API key of each new engine, by engine ID. */
  keys: Record<string, string>;
}

/**
 * Turns settings of the old shape into engines. Returns `undefined` for
 * settings that are not of the old shape.
 *
 * Each provider with a key gets an engine for its lookup model. The provider
 * that was selected also gets one for its page model, when that is another
 * model, and its engines are the ones the tasks use.
 */
export function migrateLegacySettings(
  storedSettings: unknown,
  storedKeys: unknown,
): Migrated | undefined {
  const legacy = legacySettingsSchema.safeParse(storedSettings);
  if (!legacy.success) return undefined;
  const { provider: selected, models, pageModels } = legacy.data;
  const apiKeys = perProviderTextSchema.catch({}).parse(storedKeys);

  const migrated: Migrated = { engines: [], engineFor: {}, keys: {} };
  const add = (provider: ProviderId, model: string, key: string): string => {
    const id = `migrated-${migrated.engines.length + 1}`;
    migrated.engines.push({
      id,
      provider,
      model,
      modelLabel: OLD_LABELS[model],
    });
    migrated.keys[id] = key;
    return id;
  };

  // The selected provider first, so that its engine is the first one.
  const order = [selected, ...PROVIDER_IDS.filter((id) => id !== selected)];
  for (const provider of order) {
    const key = apiKeys[provider];
    if (!key) continue;
    const lookupModel = models[provider] ?? OLD_DEFAULTS[provider].lookup;
    const lookup = add(provider, lookupModel, key);
    if (provider !== selected) continue;

    const pageModel = pageModels[provider] ?? OLD_DEFAULTS[provider].page;
    const page =
      pageModel === lookupModel ? lookup : add(provider, pageModel, key);
    migrated.engineFor = { translate: lookup, define: lookup, page };
  }
  return migrated;
}
