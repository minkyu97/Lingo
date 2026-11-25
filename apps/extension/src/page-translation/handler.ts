import {
  buildPageTranslationRequest,
  createSegmentReader,
  LLMError,
  type LLMProvider,
  languageName,
  type ProviderId,
  type Settings,
} from "@lingo/core";
import type { CreateProviderOptions } from "@lingo/providers";
import { PROVIDERS } from "@lingo/providers/catalog";
import {
  type PageEvent,
  type PageRequest,
  type PageTranslationOptions,
  parsePageRequest,
} from "./protocol.ts";
import type { RateLimiter } from "./rate-limiter.ts";

/** The part of a runtime port the handler uses. */
export interface PageTranslationPort {
  postMessage(event: PageEvent): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface PageTranslationDeps {
  loadSettings(): Promise<Settings>;
  loadOptions(): Promise<PageTranslationOptions>;
  loadApiKey(provider: ProviderId): Promise<string | undefined>;
  createProvider(options: CreateProviderOptions): Pick<LLMProvider, "stream">;
  /** Shared by every port, so that the rate holds over all tabs and frames. */
  limiter: RateLimiter;
  /** Overrides the provider's API address. Used by end-to-end tests. */
  baseURL?(provider: ProviderId): string | undefined;
  pingIntervalMs?: number;
}

/** See `PING_INTERVAL_MS` of the lookup handler. */
const PING_INTERVAL_MS = 20_000;

type TranslateRequest = Extract<PageRequest, { type: "translate" }>;

/**
 * Serves the page translation of one frame over a port opened by its content
 * script. It tells the script its options, lets requests through at the
 * configured rate, and streams each translated segment back as soon as the
 * model has finished it. Everything in progress is cancelled when the port
 * closes.
 */
export function handlePageTranslationPort(
  port: PageTranslationPort,
  deps: PageTranslationDeps,
): void {
  const abort = new AbortController();
  let running = 0;
  let ping: ReturnType<typeof setInterval> | undefined;

  const post = (event: PageEvent) => {
    if (abort.signal.aborted) return;
    try {
      port.postMessage(event);
    } catch {
      // The port closed between the check and the call.
    }
  };

  async function translate(request: TranslateRequest) {
    running += 1;
    ping ??= setInterval(
      () => post({ type: "ping" }),
      deps.pingIntervalMs ?? PING_INTERVAL_MS,
    );
    const { batch } = request;
    try {
      const settings = await deps.loadSettings();
      const apiKey = await deps.loadApiKey(settings.provider);
      if (!apiKey) throw new LLMError("missing_key", "No API key is set.");

      const provider = deps.createProvider({
        provider: settings.provider,
        apiKey,
        model: settings.models[settings.provider],
        baseURL: deps.baseURL?.(settings.provider),
      });
      const chunks = provider.stream(
        buildPageTranslationRequest({
          segments: request.segments,
          targetLanguage: languageName(settings.targetLanguage),
          title: request.title,
        }),
        { signal: abort.signal },
      );
      const reader = createSegmentReader();
      for await (const chunk of chunks) {
        for (const segment of reader.push(chunk)) {
          post({ type: "segment", batch, ...segment });
        }
      }
      post({ type: "done", batch });
    } catch (error) {
      const failure =
        error instanceof LLMError ? error : new LLMError("api", String(error));
      post({
        type: "error",
        batch,
        kind: failure.kind,
        message: failure.message,
      });
    } finally {
      running -= 1;
      if (running === 0) {
        clearInterval(ping);
        ping = undefined;
      }
    }
  }

  port.onDisconnect.addListener(() => abort.abort());

  port.onMessage.addListener(async (message) => {
    const request = parsePageRequest(message);
    if (!request) return;
    if (request.type === "translate") {
      void translate(request);
      return;
    }
    try {
      const { requestsPerSecond } = await deps.loadOptions();
      await deps.limiter.acquire(requestsPerSecond, abort.signal);
      post({ type: "permit" });
    } catch {
      // The port closed while it was waiting for its turn.
    }
  });

  void Promise.all([deps.loadOptions(), deps.loadSettings()]).then(
    ([options, settings]) =>
      post({
        type: "config",
        options,
        targetLanguage: settings.targetLanguage,
        provider: PROVIDERS[settings.provider].label,
      }),
  );
}
