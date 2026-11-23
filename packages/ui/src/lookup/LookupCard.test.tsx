import type { CapturedContext } from "@lingo/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LookupCard, type LookupCardProps } from "./LookupCard.tsx";

afterEach(cleanup);

const context: CapturedContext = {
  selection: "bank",
  level: "paragraph",
  before: "She sat on the river ",
  after: " and watched the boats.",
};

function renderCard(props: Partial<LookupCardProps> = {}) {
  return render(
    <LookupCard mode="translate" status="done" text="강둑" {...props} />,
  );
}

describe("LookupCard", () => {
  it("shows the answer", () => {
    renderCard();
    expect(screen.getByText("강둑")).toBeDefined();
  });

  it("marks the text as streaming while it grows", () => {
    renderCard({ status: "streaming", text: "강" });
    expect(screen.getByText("강").getAttribute("data-streaming")).toBe("true");
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
  });

  it("shows a placeholder before the first chunk", () => {
    renderCard({ status: "loading", text: "" });
    expect(screen.getByText("Thinking…")).toBeDefined();
  });

  it("marks the active mode and reports a switch", () => {
    const onModeChange = vi.fn();
    renderCard({ onModeChange });

    const translate = screen.getByRole("button", { name: "Translate" });
    const define = screen.getByRole("button", { name: "Define" });
    expect(translate.getAttribute("aria-pressed")).toBe("true");
    expect(define.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(translate);
    expect(onModeChange).not.toHaveBeenCalled();
    fireEvent.click(define);
    expect(onModeChange).toHaveBeenCalledWith("define");
  });

  it("reveals the context that was sent on request", () => {
    renderCard({ context });
    expect(screen.queryByText("Sent with your selection:")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Paragraph context" }));
    expect(screen.getByText("Sent with your selection:")).toBeDefined();
    expect(screen.getByText("bank").tagName).toBe("MARK");
  });

  it("says so when only the selection was sent", () => {
    renderCard({ context: { selection: "bank", level: "none" } });
    expect(screen.getByText("Selection only")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Selection only" })).toBeNull();
  });

  it("points to settings when the key is missing or rejected", () => {
    for (const kind of ["missing_key", "auth"] as const) {
      const onOpenSettings = vi.fn();
      renderCard({
        status: "error",
        error: { kind, message: "raw" },
        onOpenSettings,
      });
      fireEvent.click(screen.getByRole("button", { name: "Open settings" }));
      expect(onOpenSettings).toHaveBeenCalledOnce();
      cleanup();
    }
  });

  it("offers a retry for other errors and shows the provider's message", () => {
    const onRetry = vi.fn();
    renderCard({
      status: "error",
      error: { kind: "api", message: "model: not found" },
      onRetry,
    });
    expect(screen.getByRole("alert").textContent).toContain("model: not found");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  describe("in define mode", () => {
    const entry = {
      headword: "bank",
      pronunciation: "/bæŋk/",
      contextMeaning: "강둑을 뜻한다.",
      senses: [
        {
          partOfSpeech: "명사",
          meaning: "강둑, 제방",
          inContext: true,
          example: "the river bank",
          exampleTranslation: "강둑",
        },
      ],
    };
    const json = JSON.stringify(entry);

    it("lays the answer out as a dictionary entry", () => {
      renderCard({ mode: "define", text: json });
      expect(screen.getByText("bank")).toBeDefined();
      expect(screen.getByText("In this context")).toBeDefined();
      expect(screen.getByRole("heading", { name: "명사" })).toBeDefined();
      expect(screen.queryByText(/"headword"/)).toBeNull();
    });

    it("shows the entry while it is still streaming", () => {
      renderCard({
        mode: "define",
        status: "streaming",
        text: '{"headword":"ba',
      });
      expect(screen.getByText("ba")).toBeDefined();
      expect(screen.queryByText("Thinking…")).toBeNull();
    });

    it("keeps the placeholder until the JSON holds something to show", () => {
      for (const text of ["{", '{"headword":"', "```json\n{"]) {
        renderCard({ mode: "define", status: "streaming", text });
        expect(screen.getByText("Thinking…")).toBeDefined();
        cleanup();
      }
    });

    it("falls back to plain text when the model ignored the format", () => {
      renderCard({ mode: "define", text: "bank: 강둑 또는 은행" });
      expect(screen.getByText("bank: 강둑 또는 은행")).toBeDefined();
    });

    it("copies the entry as readable text", async () => {
      const writeText = vi.fn(async () => {});
      vi.stubGlobal("navigator", { clipboard: { writeText } });
      renderCard({ mode: "define", text: json });

      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
      expect(writeText).toHaveBeenCalledWith(
        [
          "bank /bæŋk/",
          "In this context: 강둑을 뜻한다.",
          "",
          "명사",
          "1. 강둑, 제방",
          "   the river bank / 강둑",
        ].join("\n"),
      );
      await screen.findByRole("button", { name: "Copied" });
      vi.unstubAllGlobals();
    });
  });

  it("shows a translation as plain text even when it looks like JSON", () => {
    renderCard({ mode: "translate", text: '{"headword":"bank"}' });
    expect(screen.getByText('{"headword":"bank"}')).toBeDefined();
  });

  it("closes", () => {
    const onClose = vi.fn();
    renderCard({ onClose });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("copies the answer", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderCard();

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("강둑");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeDefined();
    vi.unstubAllGlobals();
  });
});
