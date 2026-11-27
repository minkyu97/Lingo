import { LLMError, prepareLookup, type Settings } from "@lingo/core";
import { type EngineDeps, providerForTask } from "./engine-provider.ts";
import { type LookupEvent, parseLookupRequest } from "./messaging.ts";

/** The part of a runtime port the handler uses. */
export interface LookupPort {
  postMessage(event: LookupEvent): void;
  onMessage: { addListener(listener: (message: unknown) => void): void };
  onDisconnect: { addListener(listener: () => void): void };
}

export interface LookupDeps extends EngineDeps {
  loadSettings(): Promise<Settings>;
  pingIntervalMs?: number;
}

/**
 * Chrome stops an idle service worker after 30 seconds, and a message on an
 * open port counts as activity. Pinging keeps the worker alive while the
 * provider has not produced text yet.
 */
const PING_INTERVAL_MS = 20_000;

/**
 * Serves one lookup over a port opened by a content script: reads the
 * settings and key, sends the request, and streams the answer back. The
 * request is cancelled when the port closes.
 */
export function handleLookupPort(port: LookupPort, deps: LookupDeps): void {
  const abort = new AbortController();
  let started = false;

  const post = (event: LookupEvent) => {
    if (abort.signal.aborted) return;
    try {
      port.postMessage(event);
    } catch {
      // The port closed between the check and the call.
    }
  };

  port.onDisconnect.addListener(() => abort.abort());

  port.onMessage.addListener(async (message) => {
    const request = parseLookupRequest(message);
    if (!request || started) return;
    started = true;

    const ping = setInterval(
      () => post({ type: "ping" }),
      deps.pingIntervalMs ?? PING_INTERVAL_MS,
    );
    try {
      const settings = await deps.loadSettings();
      // Translating and defining each have an engine of their own.
      const { provider } = await providerForTask(request.mode, settings, deps);

      const prepared = prepareLookup(request.mode, request.context, settings);
      post({ type: "started", context: prepared.context });
      const chunks = provider.stream(prepared.request, {
        signal: abort.signal,
      });
      for await (const text of chunks) post({ type: "delta", text });
      post({ type: "done" });
    } catch (error) {
      const failure =
        error instanceof LLMError ? error : new LLMError("api", String(error));
      post({ type: "error", kind: failure.kind, message: failure.message });
    } finally {
      clearInterval(ping);
    }
  });
}
