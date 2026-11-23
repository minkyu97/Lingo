import { defaultSettings, type Settings } from "@lingo/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel.tsx";
import type { SettingsPanelProps } from "./types.ts";

afterEach(cleanup);

const providers: SettingsPanelProps["providers"] = {
  anthropic: {
    label: "Anthropic",
    defaultModel: "claude-opus-5-5",
    models: [
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    ],
    keysUrl: "https://keys.example/anthropic",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-6.2-sol",
    models: [{ id: "gpt-6.2-sol", label: "GPT-6.2 Sol" }],
    keysUrl: "https://keys.example/openai",
  },
};

const settings: Settings = defaultSettings("ko");

function renderPanel(props: Partial<SettingsPanelProps> = {}) {
  const handlers = {
    onSettingsChange: vi.fn(),
    onApiKeySubmit: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onClose: vi.fn(),
  };
  const all: SettingsPanelProps = {
    settings,
    providers,
    apiKeys: { anthropic: "sk-stored" },
    keyStatus: "idle",
    shortcut: "⌥⇧L",
    version: "0.1.0",
    sourceUrl: "https://source.example/lingo",
    ...handlers,
    ...props,
  };
  const view = render(<SettingsPanel {...all} />);
  const rerender = (next: Partial<SettingsPanelProps>) =>
    view.rerender(<SettingsPanel {...all} {...next} />);
  return { ...handlers, rerender };
}

const open = (row: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(row) }));
const title = () => screen.getByRole("heading", { level: 1 }).textContent;

describe("the main screen", () => {
  it("shows each setting with its current value", () => {
    renderPanel();
    const row = (name: string) =>
      screen.getByRole("button", { name: new RegExp(name) }).textContent;

    expect(title()).toBe("Settings");
    expect(row("Translation engine")).toContain("Claude Opus 5.5");
    expect(row("Context")).toContain("On · 1,000 chars");
    expect(row("Translate into")).toContain("한국어");
    expect(row("Keyboard shortcut")).toContain("⌥⇧L");
    expect(screen.getByText("Lingo 0.1.0")).toBeDefined();
  });

  it("says so when the chosen provider has no key yet", () => {
    renderPanel({ apiKeys: { openai: "sk-other-provider" } });
    const value = screen.getByText("Not set");
    expect(value.getAttribute("data-warning")).toBe("true");
    expect(screen.queryByText("Claude Opus 5.5")).toBeNull();
  });

  it("shows a model ID that was typed in by hand as it is", () => {
    renderPanel({
      settings: { ...settings, models: { anthropic: "claude-next" } },
    });
    expect(screen.getByText("claude-next")).toBeDefined();
  });

  it("shows that context is off, and that no shortcut is set", () => {
    renderPanel({
      settings: { ...settings, contextAwareness: false },
      shortcut: "",
    });
    expect(screen.getByText("Off")).toBeDefined();
    expect(screen.getByText("Not set")).toBeDefined();
  });

  it("leads to each detail screen and back", () => {
    renderPanel();
    for (const name of ["Translation engine", "Context", "Translate into"]) {
      open(name);
      expect(title()).toBe(name);
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(title()).toBe("Settings");
    }
  });

  it("hands the shortcut over to the host and links to the source", () => {
    const { onOpenShortcuts } = renderPanel();
    open("Keyboard shortcut");
    expect(onOpenShortcuts).toHaveBeenCalledOnce();
    expect(title()).toBe("Settings");

    const source = screen.getByRole("link", { name: "Source code" });
    expect(source.getAttribute("href")).toBe("https://source.example/lingo");
    expect(source.getAttribute("target")).toBe("_blank");
  });

  it("closes only where the host can close it", () => {
    const { onClose, rerender } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender({ onClose: undefined });
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });
});

describe("the translation engine screen", () => {
  const key = () => screen.getByLabelText("API key") as HTMLInputElement;

  it("switches the provider", () => {
    const { onSettingsChange } = renderPanel();
    open("Translation engine");

    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      provider: "openai",
    });
  });

  it("shows the stored key hidden until asked", () => {
    renderPanel();
    open("Translation engine");
    expect(key().value).toBe("sk-stored");
    expect(key().type).toBe("password");

    fireEvent.click(screen.getByRole("button", { name: "Show key" }));
    expect(key().type).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: "Hide key" }));
    expect(key().type).toBe("password");
  });

  it("shows each provider its own key", () => {
    const { rerender } = renderPanel();
    open("Translation engine");
    rerender({ settings: { ...settings, provider: "openai" } });
    expect(key().value).toBe("");
  });

  it("submits a changed key once, when the field is left", () => {
    const { onApiKeySubmit } = renderPanel();
    open("Translation engine");

    fireEvent.blur(key());
    expect(onApiKeySubmit).not.toHaveBeenCalled();

    fireEvent.change(key(), { target: { value: " sk-new " } });
    fireEvent.blur(key());
    expect(onApiKeySubmit).toHaveBeenCalledWith("anthropic", "sk-new");

    fireEvent.blur(key());
    expect(onApiKeySubmit).toHaveBeenCalledOnce();
  });

  it("submits on Enter, and an empty field to remove the key", () => {
    const { onApiKeySubmit } = renderPanel();
    open("Translation engine");

    fireEvent.change(key(), { target: { value: "" } });
    fireEvent.keyDown(key(), { key: "Enter" });
    expect(onApiKeySubmit).toHaveBeenCalledWith("anthropic", "");
  });

  it("explains where the key is kept and where to get one", () => {
    renderPanel();
    open("Translation engine");
    expect(screen.getByText(/Stored only in this browser/)).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Create a key" }).getAttribute("href"),
    ).toBe("https://keys.example/anthropic");
  });

  it("dims the field while the key is being checked", () => {
    renderPanel({ keyStatus: "checking" });
    open("Translation engine");
    expect(key().disabled).toBe(true);
    expect(screen.getByText("Checking the key with Anthropic…")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Show key" })).toBeNull();
  });

  it("says when the key was saved", () => {
    renderPanel({ keyStatus: "saved" });
    open("Translation engine");
    expect(screen.getByRole("status").textContent).toBe(
      "Saved. Anthropic accepted this key.",
    );
    expect(key().getAttribute("aria-invalid")).toBe("false");
  });

  it("says when the provider rejected the key", () => {
    renderPanel({ keyStatus: "rejected" });
    open("Translation engine");
    expect(screen.getByRole("alert").textContent).toBe(
      "Not saved. Anthropic rejected this key.",
    );
    expect(key().getAttribute("aria-invalid")).toBe("true");
    expect(key().disabled).toBe(false);
  });

  it("offers another try when the provider could not be reached", () => {
    const { onApiKeySubmit, rerender } = renderPanel();
    open("Translation engine");
    fireEvent.change(key(), { target: { value: "sk-new" } });
    fireEvent.blur(key());
    rerender({ keyStatus: "unreachable" });

    expect(screen.getByRole("alert").textContent).toContain(
      "Not saved. Lingo could not reach Anthropic.",
    );
    // The field keeps what was typed.
    expect(key().value).toBe("sk-new");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onApiKeySubmit).toHaveBeenCalledTimes(2);
    expect(onApiKeySubmit).toHaveBeenLastCalledWith("anthropic", "sk-new");
  });

  it("marks the default model and stores another choice", () => {
    const { onSettingsChange } = renderPanel();
    open("Translation engine");

    const opus = screen.getByRole("radio", { name: /Claude Opus 5.5/ });
    expect((opus as HTMLInputElement).checked).toBe(true);
    expect(opus.parentElement?.textContent).toContain("Default");

    fireEvent.click(screen.getByRole("radio", { name: "Claude Haiku 5.5" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      models: { anthropic: "claude-haiku-5-5" },
    });
  });

  it("takes any other model ID", () => {
    const { onSettingsChange } = renderPanel();
    open("Translation engine");
    expect(screen.queryByLabelText("Model ID")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Other…" }));
    const field = screen.getByLabelText("Model ID");
    fireEvent.change(field, { target: { value: " claude-next " } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      models: { anthropic: "claude-next" },
    });

    // An empty field falls back to the provider's default model.
    fireEvent.change(field, { target: { value: "" } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      models: {},
    });
    expect(
      (screen.getByRole("radio", { name: "Other…" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("shows a stored model that is not on the list under Other", () => {
    renderPanel({
      settings: { ...settings, models: { anthropic: "claude-next" } },
    });
    open("Translation engine");
    expect(
      (screen.getByRole("radio", { name: "Other…" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    expect((screen.getByLabelText("Model ID") as HTMLInputElement).value).toBe(
      "claude-next",
    );
  });
});

describe("the language screen", () => {
  const names = () =>
    screen
      .getAllByRole("radio")
      .map((radio) => radio.parentElement?.textContent);

  it("lists each language by its own name and marks the current one", () => {
    renderPanel();
    open("Translate into");

    expect(names()).toContain("日本語Japanese");
    expect(names()).toContain("English");
    const korean = screen.getByRole("radio", { name: /한국어/ });
    expect((korean as HTMLInputElement).checked).toBe(true);
  });

  it("stores another language", () => {
    const { onSettingsChange } = renderPanel();
    open("Translate into");
    fireEvent.click(screen.getByRole("radio", { name: /Japanese/ }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      targetLanguage: "ja",
    });
  });

  it("filters by either name", () => {
    renderPanel();
    open("Translate into");
    const search = screen.getByLabelText("Search languages");

    fireEvent.change(search, { target: { value: "jap" } });
    expect(names()).toEqual(["日本語Japanese"]);

    fireEvent.change(search, { target: { value: "한국" } });
    expect(names()).toEqual(["한국어Korean"]);

    fireEvent.change(search, { target: { value: "klingon" } });
    expect(screen.queryAllByRole("radio")).toEqual([]);
    expect(screen.getByText("No language matches.")).toBeDefined();
  });

  it("keeps a stored language that is not on the list", () => {
    renderPanel({ settings: { ...settings, targetLanguage: "sv" } });
    open("Translate into");
    const swedish = screen.getByRole("radio", { name: /Swedish/ });
    expect((swedish as HTMLInputElement).checked).toBe(true);
  });
});

describe("the context screen", () => {
  it("turns context on and off", () => {
    const { onSettingsChange } = renderPanel();
    open("Context");

    const toggle = screen.getByRole("switch", {
      name: "Send the text around my selection",
    });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(toggle);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      contextAwareness: false,
    });
  });

  it("offers the context lengths and stores the chosen one", () => {
    const { onSettingsChange } = renderPanel();
    open("Context");

    const lengths = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(lengths.map((radio) => radio.parentElement?.textContent)).toEqual([
      "500 characters",
      "1,000 charactersDefault",
      "2,000 characters",
      "4,000 characters",
    ]);
    expect(lengths.map((radio) => radio.checked)).toEqual([
      false,
      true,
      false,
      false,
    ]);

    fireEvent.click(screen.getByRole("radio", { name: "2,000 characters" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      maxContextChars: 2000,
    });
  });

  it("sets the lengths aside while context is off", () => {
    renderPanel({ settings: { ...settings, contextAwareness: false } });
    open("Context");
    for (const radio of screen.getAllByRole("radio") as HTMLInputElement[]) {
      expect(radio.disabled).toBe(true);
    }
  });
});
