import { describe, expect, it, vi } from "vitest";
import type { RuntimeMessage } from "./messaging.ts";
import { createSettingsDrawer } from "./settings-drawer.ts";

/** A drawer whose tabs answer `answer`, or do not answer when it throws. */
function setup(answer: () => unknown = () => "opened") {
  let time = 1_000;
  const sent: [number, RuntimeMessage][] = [];
  const openOptionsPage = vi.fn(async () => {});
  const drawer = createSettingsDrawer({
    sendToTopFrame: async (tabId, message) => {
      sent.push([tabId, message]);
      return answer();
    },
    openOptionsPage,
    now: () => time,
  });
  return {
    drawer,
    sent,
    openOptionsPage,
    wait: (ms: number) => {
      time += ms;
    },
  };
}

describe("asking a tab for its drawer", () => {
  it("passes the action on to the top frame of the tab", async () => {
    const { drawer, sent, openOptionsPage } = setup();
    await drawer.request(7, "toggle");
    expect(sent).toEqual([[7, { type: "settings-drawer", action: "toggle" }]]);
    expect(openOptionsPage).not.toHaveBeenCalled();
  });

  it("opens the settings in a tab when no content script answers", async () => {
    const noAnswer = [
      () => {
        throw new Error("Receiving end does not exist.");
      },
      () => undefined,
      () => ({ open: true }),
    ];
    for (const answer of noAnswer) {
      const { drawer, openOptionsPage } = setup(answer);
      await drawer.request(7, "toggle");
      expect(openOptionsPage).toHaveBeenCalledOnce();
      expect(drawer.claimGrant(7)).toBe(false);
    }
  });

  it("opens the settings in a tab when there is no tab to ask", async () => {
    const { drawer, sent, openOptionsPage } = setup();
    await drawer.request(undefined, "open");
    expect(sent).toEqual([]);
    expect(openOptionsPage).toHaveBeenCalledOnce();
  });

  it("never opens anything when asked to close", async () => {
    const { drawer, openOptionsPage } = setup(() => {
      throw new Error("Receiving end does not exist.");
    });
    await drawer.request(7, "close");
    await drawer.request(undefined, "close");
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
      openOptionsPage: async () => {},
    });
    await drawer.request(7, "open");
    expect(granted).toEqual([true]);
  });

  it("is not given when no drawer was opened", async () => {
    for (const answer of ["closed", "unchanged"]) {
      const { drawer } = setup(() => answer);
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
