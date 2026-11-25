import { browser } from "wxt/browser";
import {
  isRuntimeMessage,
  type PageSwitchAction,
  type PageSwitchAnswer,
  pageSwitchAnswerSchema,
  type RuntimeMessage,
} from "../../src/messaging.ts";
import { createPlaceholders } from "../../src/page-translation/placeholders.ts";
import { PAGE_TRANSLATION_PORT } from "../../src/page-translation/protocol.ts";
import {
  createPageTranslator,
  type PageTranslationProgress,
  type PageTranslationStatus,
} from "../../src/page-translation/translator.ts";
import { rangeOf } from "../../src/page-translation/units.ts";

/**
 * Set only in end-to-end test builds, like the address of the fake server in
 * the background. A production build never writes to the page for a test.
 */
const E2E = Boolean(import.meta.env.WXT_E2E_LLM_BASE_URL);

/** Puts the numbers of a page translation where a test can read them. */
function publishProgress(progress: PageTranslationProgress) {
  document.documentElement.dataset.lingoPageTranslation =
    JSON.stringify(progress);
}

/** What the page bar needs: where translation stands, and how to act on it. */
export interface PageControl {
  subscribe(listener: () => void): () => void;
  getStatus(): PageTranslationStatus;
  /** Shows the original again, in every frame of the tab. */
  stop(): void;
  /** Goes on after a problem. */
  retry(): void;
  /** Puts this frame back as it was, without a word to the others. */
  dispose(): void;
}

function ask(action: PageSwitchAction): Promise<PageSwitchAnswer> {
  const message: RuntimeMessage = { type: "page-translation", action };
  return browser.runtime
    .sendMessage(message)
    .catch(() => undefined)
    .then((answer) => pageSwitchAnswerSchema.parse(answer));
}

/**
 * Sets up page translation for this frame. Each frame translates its own
 * text. The top frame decides whether the page is translated, because that
 * is where the page bar is; the frames inside it follow.
 */
export function setUpPageTranslation(): PageControl {
  const isTopFrame = window.top === window;
  let status: PageTranslationStatus = { active: false };
  const listeners = new Set<() => void>();

  const placeholders = createPlaceholders();
  const translator = createPageTranslator({
    connect: () => browser.runtime.connect({ name: PAGE_TRANSLATION_PORT }),
    // Text that is waiting for its translation shows as pulsing gray bars.
    onPending(unit, pending) {
      const range = pending ? rangeOf(unit) : undefined;
      if (range) placeholders.show(unit, range);
      else placeholders.hide(unit);
    },
    onStatus(next) {
      status = next;
      for (const listener of listeners) listener();
    },
    onProgress: E2E ? publishProgress : undefined,
  });

  const turn = (on: boolean) => {
    if (!on) translator.stop();
    else if (translator.active) translator.retry();
    else translator.start();
  };

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender: unknown,
      sendResponse: (answer: PageSwitchAnswer) => void,
    ) => {
      if (!isRuntimeMessage(message)) return;
      if (message.type === "page-translation" && isTopFrame) {
        if (message.action === "toggle") turn(!translator.active);
        else if (message.action === "stop") turn(false);
        else if (message.action === "retry") translator.retry();
        sendResponse({ on: translator.active });
      } else if (message.type === "page-translation-set" && !isTopFrame) {
        turn(message.on);
      }
    },
  );

  // A frame that loads into a page that is being translated joins in.
  if (!isTopFrame) {
    void ask("query").then(({ on }) => {
      if (on) translator.start();
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getStatus: () => status,
    // Through the background, so that the other frames hear of it too.
    stop: () => void ask("stop"),
    retry: () => void ask("retry"),
    dispose: () => translator.stop(),
  };
}
