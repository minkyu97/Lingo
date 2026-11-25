import { describe, expect, it } from "vitest";
import {
  isRuntimeMessage,
  keyCheckResultSchema,
  MAX_SELECTION_CHARS,
  parseLookupRequest,
} from "./messaging.ts";

describe("parseLookupRequest", () => {
  it("accepts a well-formed request", () => {
    const request = parseLookupRequest({
      type: "start",
      mode: "define",
      context: {
        selection: " bank ",
        level: "paragraph",
        before: "the river ",
        after: " was muddy",
        title: "A walk",
        url: "https://example.com/walk",
      },
    });
    expect(request).toEqual({
      type: "start",
      mode: "define",
      context: {
        selection: "bank",
        level: "paragraph",
        before: "the river ",
        after: " was muddy",
        title: "A walk",
        url: "https://example.com/walk",
      },
    });
  });

  it("derives the level from the text instead of trusting the sender", () => {
    const request = parseLookupRequest({
      type: "start",
      mode: "translate",
      context: { selection: "bank", level: "document" },
    });
    expect(request?.context.level).toBe("none");
  });

  it("drops fields of the wrong type", () => {
    const request = parseLookupRequest({
      type: "start",
      mode: "translate",
      context: { selection: "bank", before: 5, title: { a: 1 }, extra: "x" },
    });
    expect(request?.context).toEqual({ selection: "bank", level: "none" });
  });

  it.each([
    undefined,
    null,
    "start",
    { type: "other" },
    { type: "start", mode: "summarize", context: { selection: "x" } },
    { type: "start", mode: "translate" },
    { type: "start", mode: "translate", context: { selection: 5 } },
    { type: "start", mode: "translate", context: { selection: "   " } },
    {
      type: "start",
      mode: "translate",
      context: { selection: "x".repeat(MAX_SELECTION_CHARS + 1) },
    },
  ])("rejects %j", (value) => {
    expect(parseLookupRequest(value)).toBeUndefined();
  });
});

describe("isRuntimeMessage", () => {
  it("recognizes the known messages", () => {
    expect(isRuntimeMessage({ type: "lookup-selection" })).toBe(true);
    for (const action of ["toggle", "stop", "retry", "query"]) {
      expect(isRuntimeMessage({ type: "page-translation", action })).toBe(true);
    }
    expect(isRuntimeMessage({ type: "page-translation-set", on: true })).toBe(
      true,
    );
    expect(
      isRuntimeMessage({
        type: "page-translation-changed",
        tabId: 4,
        on: false,
      }),
    ).toBe(true);
    expect(isRuntimeMessage({ type: "settings-drawer-grant" })).toBe(true);
    for (const action of ["open", "close", "toggle"]) {
      expect(isRuntimeMessage({ type: "settings-drawer", action })).toBe(true);
    }
  });

  it("rejects everything else", () => {
    expect(isRuntimeMessage({ type: "nope" })).toBe(false);
    expect(isRuntimeMessage("lookup-selection")).toBe(false);
    expect(isRuntimeMessage({ type: "settings-drawer" })).toBe(false);
    expect(isRuntimeMessage({ type: "settings-drawer", action: "x" })).toBe(
      false,
    );
    expect(isRuntimeMessage(null)).toBe(false);
  });

  it("takes a key check only for a known provider and a real key", () => {
    const check = { type: "check-api-key", provider: "openai", apiKey: "k" };
    expect(isRuntimeMessage(check)).toBe(true);
    expect(isRuntimeMessage({ ...check, provider: "other" })).toBe(false);
    expect(isRuntimeMessage({ ...check, apiKey: "" })).toBe(false);
    expect(isRuntimeMessage({ ...check, apiKey: "k".repeat(1001) })).toBe(
      false,
    );
    expect(isRuntimeMessage({ type: "check-api-key" })).toBe(false);
  });
});

describe("keyCheckResultSchema", () => {
  it("passes on what the provider said", () => {
    for (const result of ["accepted", "rejected", "unreachable"]) {
      expect(keyCheckResultSchema.parse(result)).toBe(result);
    }
  });

  it("reads anything else as the provider not having been reached", () => {
    expect(keyCheckResultSchema.parse(undefined)).toBe("unreachable");
    expect(keyCheckResultSchema.parse({ ok: true })).toBe("unreachable");
  });
});
