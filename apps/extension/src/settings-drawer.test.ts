import { describe, expect, it, vi } from "vitest";
import type { RuntimeMessage } from "./messaging.ts";
import { createSettingsDrawer } from "./settings-drawer.ts";

interface Tab {
  /** What the top frame answers. Throws when nothing is there to answer. */
  answer?: () => unknown;
  /** How long the page stays loading before its content script starts. */
  loadsFor?: number;
  /** Whether a content script may be started there by hand. */
  scriptable?: boolean;
}

const nobody = () => {
  throw new Error("Receiving end does not exist.");
};

/** A drawer for one tab, with a clock that only moves when it is waited on. */
function setup({
  answer = () => "opened",
  loadsFor = 0,
  scriptable = true,
}: Tab = {}) {
  let time = 1_000;
  let listening = answer !== nobody && loadsFor === 0;
  const sent: [number, RuntimeMessage][] = [];
  const openOptionsPage = vi.fn(async () => {});
  const startContentScript = vi.fn(async () => {
    if (!scriptable) throw new Error("Cannot access this page.");
    listening = true;
  });
  const loadedAt = time + loadsFor;
  const drawer = createSettingsDrawer({
    sendToTopFrame: async (tabId, message) => {
      sent.push([tabId, message]);
      if (loadsFor > 0 && time >= loadedAt) listening = true;
      if (!listening) nobody();
      return answer === nobody ? "opened" : answer();
    },
    isLoading: async () => time < loadedAt,
    startContentScript,
    openOptionsPage,
    now: () => time,
    wait: async (ms) => {
      time += ms;
    },
  });
  return {
    drawer,
    sent,
    openOptionsPage,
    startContentScript,
    elapsed: () => time - 1_000,
    wait: (ms: number) => {
      time += ms;
    },
  };
}

describe("asking a tab for its drawer", () => {
  it("passes the action on to the top frame of the tab", async () => {
    const { drawer, sent, openOptionsPage, startContentScript } = setup();
    await drawer.request(7, "toggle");
    expect(sent).toEqual([[7, { type: "settings-drawer", action: "toggle" }]]);
    expect(startContentScript).not.toHaveBeenCalled();
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it("waits for a page that is still loading to start its content script", async () => {
    const { drawer, startContentScript, openOptionsPage, elapsed } = setup({
      loadsFor: 1_000,
    });
    await drawer.request(7, "toggle");
    expect(elapsed()).toBeGreaterThanOrEqual(1_000);
    expect(elapsed()).toBeLessThan(1_200);
    expect(startContentScript).not.toHaveBeenCalled();
    expect(openOptionsPage).not.toHaveBeenCalled();
    expect(drawer.claimGrant(7)).toBe(true);
  });

  it("starts a content script in a tab that has none", async () => {
    // As in a tab that was open before the extension was installed.
    const { drawer, startContentScript, openOptionsPage } = setup({
      answer: nobody,
    });
    await drawer.request(7, "toggle");
    expect(startContentScript).toHaveBeenCalledExactlyOnceWith(7);
    expect(openOptionsPage).not.toHaveBeenCalled();
    expect(drawer.claimGrant(7)).toBe(true);
  });

  it("opens the settings in a tab where no content script can run", async () => {
    const { drawer, openOptionsPage } = setup({
      answer: nobody,
      scriptable: false,
    });
    await drawer.request(7, "toggle");
    expect(openOptionsPage).toHaveBeenCalledOnce();
    expect(drawer.claimGrant(7)).toBe(false);
  });

  it("opens the settings in a tab when the answer makes no sense", async () => {
    const { drawer, openOptionsPage } = setup({
      answer: () => ({ open: true }),
    });
    await drawer.request(7, "toggle");
    expect(openOptionsPage).toHaveBeenCalledOnce();
    expect(drawer.claimGrant(7)).toBe(false);
  });

  it("opens the settings in a tab when there is no tab to ask", async () => {
    const { drawer, sent, openOptionsPage } = setup();
    await drawer.request(undefined, "open");
    expect(sent).toEqual([]);
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it("does nothing more when asked to close a drawer that is not there", async () => {
    const { drawer, sent, openOptionsPage, startContentScript } = setup({
      answer: nobody,
    });
    await drawer.request(7, "close");
    await drawer.request(undefined, "close");
    expect(sent).toHaveLength(1);
    expect(startContentScript).not.toHaveBeenCalled();
    expect(openOptionsPage).not.toHaveBeenCalled();
  });
});

describe("the grant for the page inside the drawer", () => {
  it("is given once, to the tab where a drawer was opened", async () => {
    const { drawer } = setup();
    await drawer.request(7, "toggle");
    expect(drawer.claimGrant(8)).toBe(false);
    expect(drawer.claimGrant(undefined)).toBe(false);
    expect(drawer.claimGrant(7)).toBe(true);
    expect(drawer.claimGrant(7)).toBe(false);
  });

  it("is there before the tab has answered", async () => {
    const granted: boolean[] = [];
    const drawer = createSettingsDrawer({
      // The page inside the drawer asks while the tab is still answering.
      sendToTopFrame: async () => {
        granted.push(drawer.claimGrant(7));
        return "opened";
      },
      isLoading: async () => false,
      startContentScript: async () => {},
      openOptionsPage: async () => {},
    });
    await drawer.request(7, "open");
    expect(granted).toEqual([true]);
  });

  it("is not given when no drawer was opened", async () => {
    for (const answer of ["closed", "unchanged"]) {
      const { drawer } = setup({ answer: () => answer });
      await drawer.request(7, "toggle");
      expect(drawer.claimGrant(7)).toBe(false);
    }
    const { drawer } = setup();
    expect(drawer.claimGrant(7)).toBe(false);
  });

  it("runs out", async () => {
    const { drawer, wait } = setup();
    await drawer.request(7, "open");
    wait(10_001);
    expect(drawer.claimGrant(7)).toBe(false);
  });
});
