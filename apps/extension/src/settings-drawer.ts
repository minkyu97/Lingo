import {
  type DrawerAction,
  drawerAnswerSchema,
  type RuntimeMessage,
} from "./messaging.ts";

/**
 * How long after opening a drawer the page inside it may claim to be that
 * drawer. The page asks as soon as it has loaded.
 */
const GRANT_MS = 10_000;

export interface SettingsDrawerDeps {
  /** Sends a message to the top frame of a tab and resolves with its answer. */
  sendToTopFrame(tabId: number, message: RuntimeMessage): Promise<unknown>;
  /** Opens the settings as a tab of their own. */
  openOptionsPage(): Promise<void>;
  now?(): number;
}

/**
 * The background side of the in-page settings drawer.
 *
 * The drawer is drawn by the content script in the top frame of a tab, and it
 * shows an extension page in an iframe. Any web page could put that extension
 * page in an iframe of its own, so the page shows the settings only when the
 * background confirms that it opened a drawer in that tab a moment ago.
 */
export function createSettingsDrawer(deps: SettingsDrawerDeps) {
  const now = deps.now ?? Date.now;
  /** Tabs where a drawer was just opened, and until when that counts. */
  const grants = new Map<number, number>();

  /**
   * Opens, closes, or toggles the drawer in a tab. Where no content script
   * answers, such as on a browser page, the settings open in a tab instead.
   */
  async function request(
    tabId: number | undefined,
    action: DrawerAction,
  ): Promise<void> {
    const wantsSettings = action !== "close";
    if (tabId === undefined) {
      if (wantsSettings) await deps.openOptionsPage();
      return;
    }

    // Granted before the tab is asked, so the page inside the drawer cannot
    // get its question in first.
    if (wantsSettings) grants.set(tabId, now() + GRANT_MS);
    const answer = drawerAnswerSchema.safeParse(
      await deps
        .sendToTopFrame(tabId, { type: "settings-drawer", action })
        .catch(() => undefined),
    );
    if (answer.success && answer.data === "opened") return;

    grants.delete(tabId);
    if (!answer.success && wantsSettings) await deps.openOptionsPage();
  }

  /**
   * Whether a drawer was just opened in the tab. It can be claimed once, by
   * the page inside that drawer.
   */
  function claimGrant(tabId: number | undefined): boolean {
    if (tabId === undefined) return false;
    const until = grants.get(tabId);
    grants.delete(tabId);
    return until !== undefined && now() <= until;
  }

  return { request, claimGrant };
}
