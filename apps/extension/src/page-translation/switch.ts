import {
  type PageSwitchAction,
  type PageSwitchAnswer,
  pageSwitchAnswerSchema,
  type RuntimeMessage,
} from "../messaging.ts";

export interface PageSwitchDeps {
  /** Sends to the top frame of a tab. Rejects when nothing listens there. */
  sendToTopFrame(tabId: number, message: RuntimeMessage): Promise<unknown>;
  /** Sends to every frame of a tab. */
  sendToAllFrames(tabId: number, message: RuntimeMessage): Promise<unknown>;
  /** Sends to the extension's own pages. Rejects when none is open. */
  tellOwnPages(message: RuntimeMessage): Promise<unknown>;
}

/**
 * The background side of turning page translation on and off.
 *
 * The top frame of a tab decides: whether its page is translated is what
 * the tab's page bar and the settings show. The background passes each
 * request on to it, and then spreads what came of it: to the other frames
 * of the tab, which translate their own text, and to the extension's own
 * pages, where the settings may be showing that tab's state.
 */
export function createPageSwitch(deps: PageSwitchDeps) {
  return {
    async request(
      tabId: number | undefined,
      action: PageSwitchAction,
    ): Promise<PageSwitchAnswer> {
      if (tabId === undefined) return { on: false };

      let on: boolean;
      try {
        const message: RuntimeMessage = { type: "page-translation", action };
        const answer = await deps.sendToTopFrame(tabId, message);
        on = pageSwitchAnswerSchema.parse(answer).on;
      } catch {
        // No content script runs there, as on a browser page.
        return { on: false, tabId };
      }

      if (action !== "query") {
        deps
          .sendToAllFrames(tabId, { type: "page-translation-set", on })
          .catch(() => {});
        deps
          .tellOwnPages({ type: "page-translation-changed", tabId, on })
          .catch(() => {});
      }
      return { on, tabId };
    },
  };
}
