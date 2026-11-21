import { describe, expect, it } from "vitest";
import type { CapturedContext } from "./context.ts";
import { type LookupSettings, prepareLookup } from "./lookup.ts";

const captured: CapturedContext = {
  selection: "bank",
  level: "paragraph",
  before: "She sat on the river ",
  after: " and watched the boats.",
  title: "A walk",
  url: "https://example.com/walk",
};

const settings: LookupSettings = {
  targetLanguage: "ko",
  contextAwareness: true,
  maxContextChars: 1000,
};

describe("prepareLookup", () => {
  it("sends the captured context when context awareness is on", () => {
    const { request, context } = prepareLookup("translate", captured, settings);
    expect(context).toEqual(captured);
    expect(request.system).toContain("Korean");
    expect(request.messages[0]?.content).toContain(
      "She sat on the river [[bank]] and watched the boats.",
    );
  });

  it("sends only the selection when context awareness is off", () => {
    const { request, context } = prepareLookup("translate", captured, {
      ...settings,
      contextAwareness: false,
    });
    expect(context).toEqual({ selection: "bank", level: "none" });
    expect(request.messages[0]?.content).toBe("<selection>bank</selection>");
    expect(request.system).not.toContain("<context>");
  });

  it("limits the context to the configured length", () => {
    const { request, context } = prepareLookup("define", captured, {
      ...settings,
      maxContextChars: 10,
    });
    expect(context.before).toBe("iver ");
    expect(context.after).toBe(" and ");
    expect(request.messages[0]?.content).toContain(
      "<passage>iver [[bank]] and </passage>",
    );
  });

  it("answers in the configured language", () => {
    const { request } = prepareLookup("define", captured, {
      ...settings,
      targetLanguage: "ja",
    });
    expect(request.system).toContain("Japanese");
  });
});
