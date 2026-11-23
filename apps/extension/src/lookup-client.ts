import { type Browser, browser } from "wxt/browser";
import {
  LOOKUP_PORT,
  type LookupEvent,
  type LookupRequest,
} from "./messaging.ts";

/**
 * Runs one lookup from a content script. Opens a port to the background,
 * sends the request, and reports every event until the lookup finishes.
 * Returns a function that cancels it.
 */
export function openLookup(
  request: LookupRequest,
  onEvent: (event: LookupEvent) => void,
): () => void {
  let finished = false;
  let port: Browser.runtime.Port | undefined;

  const report = (event: LookupEvent) => {
    if (finished || event.type === "ping") return;
    if (event.type === "done" || event.type === "error") {
      finished = true;
      port?.disconnect();
    }
    onEvent(event);
  };

  try {
    port = browser.runtime.connect({ name: LOOKUP_PORT });
  } catch {
    // The extension was reloaded or updated under this page.
    report({
      type: "error",
      kind: "api",
      message: "Lingo was updated. Reload this page to keep using it.",
    });
    return () => {};
  }

  port.onMessage.addListener(report);
  port.onDisconnect.addListener(() =>
    report({
      type: "error",
      kind: "api",
      message: "The connection to Lingo was interrupted. Try again.",
    }),
  );
  port.postMessage(request);

  return () => {
    if (finished) return;
    finished = true;
    port?.disconnect();
  };
}
