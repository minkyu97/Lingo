import { describe, expect, it } from "vitest";
import type { RuntimeMessage } from "../messaging.ts";
import { createPageSwitch } from "./switch.ts";

function setup(topFrame: (message: RuntimeMessage) => unknown) {
  const toAllFrames: [number, RuntimeMessage][] = [];
  const toOwnPages: RuntimeMessage[] = [];
  const pageSwitch = createPageSwitch({
    sendToTopFrame: async (_tabId, message) => topFrame(message),
    sendToAllFrames: async (tabId, message) => {
      toAllFrames.push([tabId, message]);
    },
    tellOwnPages: async (message) => {
      toOwnPages.push(message);
      // Nobody is listening, which the switch has to put up with.
      throw new Error("Receiving end does not exist.");
    },
  });
  return { pageSwitch, toAllFrames, toOwnPages };
}

describe("createPageSwitch", () => {
  it("passes a request to the top frame, and spreads what came of it", async () => {
    const asked: RuntimeMessage[] = [];
    const { pageSwitch, toAllFrames, toOwnPages } = setup((message) => {
      asked.push(message);
      return { on: true };
    });

    expect(await pageSwitch.request(7, "toggle")).toEqual({
      on: true,
      tabId: 7,
    });

    expect(asked).toEqual([{ type: "page-translation", action: "toggle" }]);
    expect(toAllFrames).toEqual([
      [7, { type: "page-translation-set", on: true }],
    ]);
    expect(toOwnPages).toEqual([
      { type: "page-translation-changed", tabId: 7, on: true },
    ]);
  });

  it("only asks, when asked how things stand", async () => {
    const { pageSwitch, toAllFrames, toOwnPages } = setup(() => ({ on: true }));
    expect(await pageSwitch.request(7, "query")).toEqual({
      on: true,
      tabId: 7,
    });
    expect(toAllFrames).toEqual([]);
    expect(toOwnPages).toEqual([]);
  });

  it("reads no answer, or a strange one, as not translating", async () => {
    const silent = setup(() => undefined);
    expect(await silent.pageSwitch.request(7, "stop")).toEqual({
      on: false,
      tabId: 7,
    });
    expect(silent.toAllFrames).toEqual([
      [7, { type: "page-translation-set", on: false }],
    ]);
  });

  it("says so when no content script runs in the tab", async () => {
    const { pageSwitch, toAllFrames } = setup(() => {
      throw new Error("Could not establish connection.");
    });
    expect(await pageSwitch.request(7, "toggle")).toEqual({
      on: false,
      tabId: 7,
    });
    expect(toAllFrames).toEqual([]);
  });

  it("does nothing without a tab", async () => {
    const { pageSwitch, toAllFrames } = setup(() => ({ on: true }));
    expect(await pageSwitch.request(undefined, "toggle")).toEqual({
      on: false,
    });
    expect(toAllFrames).toEqual([]);
  });
});
