import type { CapturedContext } from "@lingo/core";
import { describe, expect, it } from "vitest";
import { applyLookupEvent, initialLookupState } from "./lookup-state.ts";
import type { LookupEvent } from "./messaging.ts";

const captured: CapturedContext = {
  selection: "bank",
  level: "paragraph",
  before: "the river ",
};

function after(...events: LookupEvent[]) {
  return events.reduce(
    applyLookupEvent,
    initialLookupState("translate", captured),
  );
}

describe("applyLookupEvent", () => {
  it("starts out loading with no text", () => {
    expect(after()).toEqual({
      mode: "translate",
      captured,
      status: "loading",
      text: "",
    });
  });

  it("records the context that was sent", () => {
    const sent: CapturedContext = { selection: "bank", level: "none" };
    const state = after({ type: "started", context: sent });
    expect(state.context).toEqual(sent);
    expect(state.status).toBe("loading");
  });

  it("appends text as it streams in", () => {
    const state = after(
      { type: "delta", text: "강" },
      { type: "delta", text: "둑" },
    );
    expect(state.text).toBe("강둑");
    expect(state.status).toBe("streaming");
  });

  it("finishes", () => {
    const state = after({ type: "delta", text: "강둑" }, { type: "done" });
    expect(state).toMatchObject({ status: "done", text: "강둑" });
  });

  it("keeps the error", () => {
    const state = after({ type: "error", kind: "auth", message: "rejected" });
    expect(state.status).toBe("error");
    expect(state.error).toEqual({ kind: "auth", message: "rejected" });
  });

  it("ignores pings", () => {
    const before = after({ type: "delta", text: "강" });
    expect(applyLookupEvent(before, { type: "ping" })).toBe(before);
  });
});
