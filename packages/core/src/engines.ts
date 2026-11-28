/**
 * Translation engines. An engine is a provider, one of its models, and the
 * API key to use it with, under a name. A user adds as many as they like and
 * chooses one for each task. The keys are stored apart from the engines, so
 * that settings can be shown where keys must not go.
 */
import { z } from "zod";

export const PROVIDER_IDS = ["anthropic", "openai"] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];

/** What Lingo does with a model: each task has an engine of its own. */
export const ENGINE_TASKS = ["translate", "define", "page"] as const;

export type EngineTask = (typeof ENGINE_TASKS)[number];

const optionalText = z.string().trim().min(1).optional().catch(undefined);

/** What a model can be asked for, as far as its provider says. */
const capabilitiesSchema = z
  .object({
    /** Accepts a setting for how much effort to spend on an answer. */
    effort: z.boolean().optional().catch(undefined),
    /** Can be held to a JSON schema. */
    structuredOutput: z.boolean().optional().catch(undefined),
  })
  .optional()
  .catch(undefined);

export type ModelCapabilities = NonNullable<z.infer<typeof capabilitiesSchema>>;

const engineSchema = z.object({
  /** Identifies the engine. Its API key is stored under the same ID. */
  id: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  /** The model's ID, as the provider's API takes it. */
  model: z.string().trim().min(1),
  /** The model's name as the provider gives it, when it gives one. */
  modelLabel: optionalText,
  /** A name the user gave the engine. Without one it goes by its model. */
  name: optionalText,
  capabilities: capabilitiesSchema,
  /** Merged into every request of this engine. */
  parameters: z.record(z.string(), z.unknown()).optional().catch(undefined),
});

export type Engine = z.infer<typeof engineSchema>;

/** A model that an API key can use, as listed by its provider. */
export interface ModelInfo {
  id: string;
  /** The name to show. The ID where the provider gives no name. */
  label: string;
  capabilities?: ModelCapabilities;
}

/** Stored engines. One that is unusable is left out, and the rest stay. */
export const enginesSchema = z
  .array(z.unknown())
  .transform((items) => {
    const engines: Engine[] = [];
    for (const item of items) {
      const parsed = engineSchema.safeParse(item);
      const taken = engines.some((engine) => engine.id === parsed.data?.id);
      if (parsed.success && !taken) engines.push(parsed.data);
    }
    return engines;
  })
  .catch([]);

/** Which engine each task uses, by engine ID. */
export type EngineChoices = Partial<Record<EngineTask, string>>;

export const engineChoicesSchema = z
  .object(
    Object.fromEntries(
      ENGINE_TASKS.map((task) => [task, optionalText]),
    ) as Record<EngineTask, typeof optionalText>,
  )
  .catch({});

/** The name an engine goes by: its own, or else its model's. */
export function engineName(engine: Engine): string {
  return engine.name ?? engine.modelLabel ?? engine.model;
}

interface WithEngines {
  engines: readonly Engine[];
  engineFor: EngineChoices;
}

/**
 * The engine a task uses: the one chosen for it, or the first engine while
 * none is chosen. Undefined when there is no engine at all.
 */
export function engineForTask(
  settings: WithEngines,
  task: EngineTask,
): Engine | undefined {
  const chosen = settings.engineFor[task];
  return (
    settings.engines.find((engine) => engine.id === chosen) ??
    settings.engines[0]
  );
}

/** Adds an engine, or replaces the one with the same ID. */
export function saveEngine<T extends WithEngines>(
  settings: T,
  engine: Engine,
): T {
  const exists = settings.engines.some(({ id }) => id === engine.id);
  const engines = exists
    ? settings.engines.map((other) => (other.id === engine.id ? engine : other))
    : [...settings.engines, engine];
  return { ...settings, engines };
}

/**
 * Moves an engine to another place in the list. The order is the one that
 * lists show, and the first engine is the one a task uses while none is
 * chosen for it. A place past either end counts as that end.
 */
export function moveEngine<T extends WithEngines>(
  settings: T,
  id: string,
  toIndex: number,
): T {
  const from = settings.engines.findIndex((engine) => engine.id === id);
  const moved = settings.engines[from];
  if (!moved) return settings;
  const engines = settings.engines.filter((engine) => engine.id !== id);
  const to = Math.min(engines.length, Math.max(0, toIndex));
  engines.splice(to, 0, moved);
  return { ...settings, engines };
}

/**
 * Removes an engine. A task that used it has no choice of its own after
 * that, and so falls to the first engine that is left.
 */
export function removeEngine<T extends WithEngines>(
  settings: T,
  id: string,
): T {
  const engineFor: EngineChoices = {};
  for (const task of ENGINE_TASKS) {
    const chosen = settings.engineFor[task];
    if (chosen && chosen !== id) engineFor[task] = chosen;
  }
  return {
    ...settings,
    engines: settings.engines.filter((engine) => engine.id !== id),
    engineFor,
  };
}
