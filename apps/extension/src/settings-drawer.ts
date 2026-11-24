import {
  type DrawerAction,
  type DrawerAnswer,
  drawerAnswerSchema,
  type RuntimeMessage,
} from "./messaging.ts";

/**
 * How long after opening a drawer the page inside it may claim to be that
 * drawer. The page asks as soon as it has loaded.
 */
const GRANT_MS = 10_000;

/** How long to keep asking a tab whose content script may just be starting. */
const STARTING_MS = 300;
/** How long to wait for a page that is still loading to start it. */
const LOADING_MS = 3_000;
/** How long a content script that was started by hand gets to answer. */
const STARTED_MS = 2_000;
/** The pause between two attempts to ask. */
const RETRY_MS = 50;

export interface SettingsDrawerDeps {
  /** Sends a message to the top frame of a tab and resolves with its answer. */
  sendToTopFrame(tabId: number, message: RuntimeMessage): Promise<unknown>;
  /** Whether the tab's page is still loading. */
  isLoading(tabId: number): Promise<boolean>;
  /**
   * Starts the content script in the top frame of a tab. Rejects where that
   * is not allowed, such as on a browser page.
   */
  startContentScript(tabId: number): Promise<unknown>;
  /** Opens the settings as a tab of their own. */
  openOptionsPage(): Promise<void>;
  now?(): number;
  wait?(ms: number): Promise<void>;
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
  const wait =
    deps.wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  /** Tabs where a drawer was just opened, and until when that counts. */
  const grants = new Map<number, number>();

  /** Asks the top frame once. Undefined when nothing there answers. */
  async function ask(
    tabId: number,
    action: DrawerAction,
  ): Promise<DrawerAnswer | undefined> {
    const answer = await deps
      .sendToTopFrame(tabId, { type: "settings-drawer", action })
      .catch(() => undefined);
    return drawerAnswerSchema.safeParse(answer).data;
  }

  /** Keeps asking until something answers, the time is up, or `giveUp` says so. */
  async function askFor(
    ms: number,
    tabId: number,
    action: DrawerAction,
    giveUp: () => Promise<boolean> = async () => false,
  ): Promise<DrawerAnswer | undefined> {
    const deadline = now() + ms;
    for (;;) {
      const answer = await ask(tabId, action);
      if (answer || now() >= deadline || (await giveUp())) return answer;
      await wait(RETRY_MS);
    }
  }

  /**
   * Gets an answer out of a tab where nothing answered at first: by waiting
   * for its content script to start, or by starting one.
   */
  async function reach(
    tabId: number,
    action: DrawerAction,
  ): Promise<DrawerAnswer | undefined> {
    // A page that has only just loaded starts its content script a moment
    // later, and a page that is still loading has not started it yet.
    const soon = await askFor(STARTING_MS, tabId, action);
    if (soon) return soon;
    if (await deps.isLoading(tabId)) {
      const loaded = await askFor(LOADING_MS, tabId, action, async () => {
        return !(await deps.isLoading(tabId));
      });
      if (loaded) return loaded;
    }

    // A tab that was open before the extension was installed or updated has
    // no content script that can answer, until it is given a new one. Pressing
    // the toolbar button is what allows that.
    const started = await deps.startContentScript(tabId).then(
      () => true,
      () => false,
    );
    return started ? askFor(STARTED_MS, tabId, action) : undefined;
  }

  /**
   * Opens, closes, or toggles the drawer in a tab. Where the page cannot hold
   * a drawer, such as a browser page, the settings open in a tab instead.
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
    let answer = await ask(tabId, action);
    if (!answer && wantsSettings) answer = await reach(tabId, action);
    if (answer === "opened") return;

    grants.delete(tabId);
    if (!answer && wantsSettings) await deps.openOptionsPage();
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
