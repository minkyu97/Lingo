import {
  type Engine,
  type EngineTask,
  engineForTask,
  LLMError,
  type LLMProvider,
  type ProviderId,
  type ResponseCache,
  type Settings,
  withCache,
} from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";

export interface EngineDeps {
  loadEngineKey(engineId: string): Promise<string | undefined>;
  /** A task only streams, so that is all it asks of a provider. */
  createProvider(options: CreateProviderOptions): Pick<LLMProvider, "stream">;
  /** Overrides the provider's API address. Used by end-to-end tests. */
  baseURL?(provider: ProviderId): string | undefined;
  /** Where answers are kept. Used while the settings ask for it. */
  cache?: ResponseCache;
}

/**
 * The provider that does a task: built from the engine chosen for it and
 * that engine's API key. Throws an `LLMError` of kind `missing_key` when no
 * engine has been added, or the engine has no key.
 */
export async function providerForTask(
  task: EngineTask,
  settings: Settings,
  deps: EngineDeps,
): Promise<{ engine: Engine; provider: Pick<LLMProvider, "stream"> }> {
  const engine = engineForTask(settings, task);
  if (!engine) {
    throw new LLMError("missing_key", "No translation engine is set up.");
  }
  const apiKey = await deps.loadEngineKey(engine.id);
  if (!apiKey) throw new LLMError("missing_key", "No API key is set.");

  const created = deps.createProvider({
    provider: engine.provider,
    apiKey,
    model: engine.model,
    capabilities: engine.capabilities,
    parameters: engine.parameters,
    baseURL: deps.baseURL?.(engine.provider),
  });
  // Every task asks its provider here, so this is where answers are reused.
  const provider =
    deps.cache && settings.cacheResponses
      ? withCache(created, deps.cache, {
          provider: engine.provider,
          model: engine.model,
          capabilities: engine.capabilities,
          parameters: engine.parameters,
        })
      : created;
  return { engine, provider };
}
