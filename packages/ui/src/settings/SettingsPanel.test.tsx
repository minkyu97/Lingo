import { defaultSettings, type Engine, type Settings } from "@lingo/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsPanel } from "./SettingsPanel.tsx";
import type { KeyCheck, SettingsPanelProps } from "./types.ts";

afterEach(cleanup);

const providers: SettingsPanelProps["providers"] = {
  anthropic: { label: "Anthropic", keysUrl: "https://keys.example/anthropic" },
  openai: { label: "OpenAI", keysUrl: "https://keys.example/openai" },
};

const sol: Engine = { id: "sol", provider: "openai", model: "gpt-6.2-sol" };
const fable: Engine = {
  id: "fable",
  provider: "anthropic",
  model: "claude-fable-5-2",
  modelLabel: "Claude Fable 5.2",
  capabilities: { effort: true, structuredOutput: true },
};
const sonnet: Engine = {
  id: "sonnet",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  modelLabel: "Claude Sonnet 5.5",
  name: "Pages",
};

const settings: Settings = {
  ...defaultSettings("ko"),
  engines: [sol, fable, sonnet],
  engineFor: { define: "fable", page: "sonnet" },
};

/** What the provider lists for a key that it accepts. */
const anthropicModels: KeyCheck = {
  status: "accepted",
  models: [
    {
      id: "claude-fable-5-2",
      label: "Claude Fable 5.2",
      capabilities: { effort: true, structuredOutput: true },
    },
    { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
  ],
};

function renderPanel(props: Partial<SettingsPanelProps> = {}) {
  const handlers = {
    onSettingsChange: vi.fn(),
    onCheckKey: vi.fn(async (): Promise<KeyCheck> => anthropicModels),
    onEngineSave: vi.fn(),
    onEngineRemove: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onClose: vi.fn(),
  };
  const cache = {
    usage: { entries: 412, bytes: 3_355_443, maxBytes: 9 * 1024 * 1024 },
    onRefresh: vi.fn(),
    onClear: vi.fn(),
  };
  const all: SettingsPanelProps = {
    settings,
    providers,
    engineKeys: { sol: "key-o", fable: "key-a", sonnet: "key-a" },
    shortcuts: ["⌥⇧L", "⌥⇧P"],
    version: "0.1.0",
    sourceUrl: "https://source.example/lingo",
    cache,
    ...handlers,
    ...props,
  };
  const view = render(<SettingsPanel {...all} />);
  const rerender = (next: Partial<SettingsPanelProps>) =>
    view.rerender(<SettingsPanel {...all} {...next} />);
  // A test may bring its own check, which then stands in for the default.
  const onCheckKey = (props.onCheckKey ??
    handlers.onCheckKey) as typeof handlers.onCheckKey;
  return { ...handlers, cache, onCheckKey, rerender };
}

const open = (row: string) =>
  fireEvent.click(screen.getByRole("button", { name: new RegExp(row) }));
const row = (name: string) =>
  screen.getByRole("button", { name: new RegExp(name) }).textContent;
const title = () => screen.getByRole("heading", { level: 1 }).textContent;
const radios = () =>
  screen
    .getAllByRole("radio")
    .map((radio) => radio.closest("label")?.textContent);
const checked = (name: RegExp | string) =>
  (screen.getByRole("radio", { name }) as HTMLInputElement).checked;
const keyField = () => screen.getByLabelText("API key") as HTMLInputElement;

/** Types a key and leaves the field, which is what has it checked. */
function enterKey(key: string) {
  fireEvent.change(keyField(), { target: { value: key } });
  fireEvent.blur(keyField());
}

describe("the row for the page in front", () => {
  it("is not there when the panel stands on its own", () => {
    renderPanel();
    expect(screen.queryByText("Translate this page")).toBeNull();
  });

  it("offers to translate the page", () => {
    const onToggle = vi.fn();
    renderPanel({ page: { translating: false, onToggle } });

    expect(screen.getByText("Translate this page")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("offers the original while the page is translated", () => {
    const onToggle = vi.fn();
    renderPanel({ page: { translating: true, onToggle } });

    expect(screen.getByText("Translating into 한국어")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Translate" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show original" }));
    expect(onToggle).toHaveBeenCalledOnce();
  });
});

describe("the main screen", () => {
  it("shows each setting with its current value", () => {
    renderPanel();

    expect(title()).toBe("Settings");
    expect(row("Translation engines")).toContain("3 engines");
    expect(row("Context")).toContain("On · 1,000 chars");
    expect(row("Request rate")).toContain("3 per second");
    expect(row("Cache")).toContain("On · 3.2 MB");
    expect(row("Translate into")).toContain("한국어");
    expect(row("Keyboard shortcuts")).toContain("⌥⇧L · ⌥⇧P");
    expect(screen.getByText("Lingo 0.1.0")).toBeDefined();
  });

  it("says so when no engine has been added yet", () => {
    renderPanel({ settings: { ...settings, engines: [], engineFor: {} } });
    const value = screen.getByText("Not set");
    expect(value.getAttribute("data-warning")).toBe("true");
  });

  it("counts a single engine as one", () => {
    renderPanel({ settings: { ...settings, engines: [sol], engineFor: {} } });
    expect(row("Translation engines")).toMatch(/1 engine$/);
  });

  it("shows that context is off, and that no shortcut is set", () => {
    renderPanel({
      settings: { ...settings, contextAwareness: false },
      shortcuts: [],
    });
    expect(row("Context")).toContain("Off");
    expect(row("Keyboard shortcuts")).toContain("Not set");
  });

  it("leads to each detail screen and back", () => {
    renderPanel();
    for (const [name, heading] of [
      ["Translation engines", "Translation engines"],
      ["Context", "Context"],
      ["Request rate", "Request rate"],
      ["Translate into", "Translate into"],
    ]) {
      open(`^${name}`);
      expect(title()).toBe(heading);
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(title()).toBe("Settings");
    }
  });

  it("hands the shortcuts over to the host and links to the source", () => {
    const { onOpenShortcuts } = renderPanel();
    open("Keyboard shortcuts");
    expect(onOpenShortcuts).toHaveBeenCalledOnce();

    const source = screen.getByRole("link", { name: /Source code/ });
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

describe("the translation engines screen", () => {
  it("shows which engine each task uses, and the engines by name", () => {
    renderPanel();
    open("^Translation engines");

    // No engine is chosen for translation, so the first one does it.
    expect(row("^Translation")).toContain("gpt-6.2-sol");
    expect(row("^Definition")).toContain("Claude Fable 5.2");
    expect(row("^Page translation")).toContain("Pages");

    expect(row("^gpt-6.2-sol")).toContain("OpenAI");
    expect(row("^Claude Fable 5.2")).toContain("Anthropic");
    expect(row("^Pages")).toContain("Anthropic");
  });

  it("starts with an invitation while there is no engine", () => {
    renderPanel({ settings: { ...settings, engines: [], engineFor: {} } });
    open("^Translation engines");

    expect(screen.getByText(/Add an engine: a provider/)).toBeDefined();
    expect(screen.queryByText("Engine for")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add engine" }));
    expect(title()).toBe("Add engine");
  });

  it("lets a task use another engine, of any provider", () => {
    const { onSettingsChange } = renderPanel();
    open("^Translation engines");
    open("^Page translation");

    expect(title()).toBe("Page translation");
    expect(radios()).toEqual([
      "gpt-6.2-solOpenAI",
      "Claude Fable 5.2Anthropic",
      "PagesAnthropic",
    ]);
    expect(checked(/Pages/)).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: /gpt-6.2-sol/ }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      engineFor: { define: "fable", page: "sol" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(title()).toBe("Translation engines");
  });
});

describe("the order of the engines", () => {
  const handle = (name: string) =>
    screen.getByRole("button", { name: `Move ${name}` });
  const order = (call: unknown) =>
    (call as Settings).engines.map((engine) => engine.id);

  it("moves an engine with the arrow keys on its handle", () => {
    const { onSettingsChange } = renderPanel();
    open("^Translation engines");

    fireEvent.keyDown(handle("Pages"), { key: "ArrowUp" });
    expect(order(onSettingsChange.mock.lastCall?.[0])).toEqual([
      "sol",
      "sonnet",
      "fable",
    ]);
    expect(screen.getByRole("status").textContent).toBe("Pages is now 2 of 3.");

    fireEvent.keyDown(handle("gpt-6.2-sol"), { key: "ArrowDown" });
    expect(order(onSettingsChange.mock.lastCall?.[0])).toEqual([
      "fable",
      "sol",
      "sonnet",
    ]);
  });

  it("does not move an engine past either end", () => {
    const { onSettingsChange } = renderPanel();
    open("^Translation engines");
    fireEvent.keyDown(handle("gpt-6.2-sol"), { key: "ArrowUp" });
    fireEvent.keyDown(handle("Pages"), { key: "ArrowDown" });
    fireEvent.keyDown(handle("Pages"), { key: "Enter" });
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it("moves an engine to where its handle is dragged", () => {
    const { onSettingsChange } = renderPanel();
    open("^Translation engines");

    // Rows are 48px tall: two rows up, and a little more.
    fireEvent.pointerDown(handle("Pages"), { clientY: 300 });
    fireEvent.pointerMove(handle("Pages"), { clientY: 195 });
    expect(document.querySelector(".lingo-engine-list__lifted")).not.toBeNull();
    expect(onSettingsChange).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle("Pages"), { clientY: 195 });

    expect(order(onSettingsChange.mock.lastCall?.[0])).toEqual([
      "sonnet",
      "sol",
      "fable",
    ]);
    expect(document.querySelector(".lingo-engine-list__lifted")).toBeNull();
  });

  it("leaves the order alone when the handle is let go where it was", () => {
    const { onSettingsChange } = renderPanel();
    open("^Translation engines");
    fireEvent.pointerDown(handle("Pages"), { clientY: 300 });
    fireEvent.pointerMove(handle("Pages"), { clientY: 310 });
    fireEvent.pointerUp(handle("Pages"), { clientY: 310 });
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it("still opens an engine from its row", () => {
    renderPanel();
    open("^Translation engines");
    open("^Pages");
    expect(title()).toBe("Pages");
  });
});

describe("duplicating an engine", () => {
  it("opens the form for a new engine, filled in from the old one", async () => {
    const custom: Engine = {
      ...sonnet,
      parameters: { temperature: 0.3 },
    };
    const { onEngineSave } = renderPanel({
      settings: { ...settings, engines: [sol, fable, custom] },
    });
    open("^Translation engines");
    open("^Pages");
    await waitFor(() => expect(keyField().disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate" }));

    expect(title()).toBe("Add engine");
    expect(keyField().value).toBe("key-a");
    await screen.findByText("The same key as Pages.");
    await waitFor(() => expect(checked("Claude Sonnet 5.5")).toBe(true));
    expect(
      (screen.getByLabelText("Extra parameters") as HTMLTextAreaElement).value,
    ).toContain('"temperature": 0.3');
    // The name is the one thing that is not copied.
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("");
    // Nothing is added until it is asked for.
    expect(onEngineSave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: "Claude Haiku 5.5" }));
    fireEvent.click(screen.getByRole("button", { name: "Add engine" }));

    const [engine, key] = onEngineSave.mock.calls[0] ?? [];
    expect(engine).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      name: undefined,
      parameters: { temperature: 0.3 },
    });
    expect(engine?.id).not.toBe("sonnet");
    expect(key).toBe("key-a");
  });
});

describe("adding an engine", () => {
  function openForm(props: Partial<SettingsPanelProps> = {}) {
    const panel = renderPanel(props);
    open("^Translation engines");
    fireEvent.click(screen.getByRole("button", { name: "Add engine" }));
    return panel;
  }
  /** The form with a key that its provider has accepted, and so its models. */
  async function openFormWithKey(props: Partial<SettingsPanelProps> = {}) {
    const panel = openForm(props);
    enterKey("key-new");
    await screen.findByText("Anthropic accepted this key.");
    return panel;
  }
  const fresh = { settings: { ...settings, engines: [], engineFor: {} } };
  const addButton = () =>
    screen.getByRole("button", { name: "Add engine" }) as HTMLButtonElement;

  it("asks for the key first, and lists no model before it", () => {
    const { onCheckKey } = openForm({ ...fresh, engineKeys: {} });

    expect(keyField().value).toBe("");
    expect(
      screen.getByText("Enter the API key to see the models it can use."),
    ).toBeDefined();
    expect(radios()).toEqual(["Other…"]);
    expect(addButton().disabled).toBe(true);
    expect(onCheckKey).not.toHaveBeenCalled();
  });

  it("lists the models of the key once the provider has accepted it", async () => {
    const { onCheckKey } = openForm({ ...fresh, engineKeys: {} });
    enterKey("  key-new  ");

    expect(onCheckKey).toHaveBeenCalledWith("anthropic", "key-new");
    await screen.findByText("Anthropic accepted this key.");
    expect(radios()).toEqual([
      "Claude Fable 5.2",
      "Claude Haiku 5.5",
      "Claude Sonnet 5.5",
      "Other…",
    ]);
    // Nothing is chosen for the user.
    expect(
      screen
        .getAllByRole("radio")
        .some((radio) => checked(radio.closest("label")?.textContent ?? "")),
    ).toBe(false);
    expect(addButton().disabled).toBe(true);
  });

  it("adds the engine with what the provider said about its model", async () => {
    const { onEngineSave } = openForm({ ...fresh, engineKeys: {} });
    enterKey("key-new");
    await screen.findByText("Anthropic accepted this key.");
    fireEvent.click(screen.getByRole("radio", { name: "Claude Fable 5.2" }));
    fireEvent.change(screen.getByLabelText("Extra parameters"), {
      target: { value: '{ "temperature": 0.3 }' },
    });
    fireEvent.click(addButton());

    expect(onEngineSave).toHaveBeenCalledOnce();
    const [engine, key] = onEngineSave.mock.calls[0] ?? [];
    expect(engine).toEqual({
      id: expect.any(String),
      provider: "anthropic",
      model: "claude-fable-5-2",
      modelLabel: "Claude Fable 5.2",
      name: undefined,
      capabilities: { effort: true, structuredOutput: true },
      parameters: { temperature: 0.3 },
    });
    expect(key).toBe("key-new");
    // Back at the list.
    expect(title()).toBe("Translation engines");
  });

  it("starts without a key, whatever engines there are already", () => {
    const { onCheckKey } = openForm();

    expect(keyField().value).toBe("");
    expect(onCheckKey).not.toHaveBeenCalled();
    expect(radios()).toEqual(["Other…"]);

    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(keyField().value).toBe("");
    expect(onCheckKey).not.toHaveBeenCalled();
  });

  it("forgets the key when the provider is changed", async () => {
    await openFormWithKey();
    fireEvent.click(screen.getByRole("button", { name: "OpenAI" }));
    expect(keyField().value).toBe("");
    expect(radios()).toEqual(["Other…"]);
  });

  it("takes a model ID typed by hand", async () => {
    const { onEngineSave } = await openFormWithKey();
    fireEvent.click(screen.getByRole("radio", { name: "Other…" }));
    expect(addButton().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: " claude-opus-4-8 " },
    });
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Old faithful" },
    });
    fireEvent.click(addButton());

    expect(onEngineSave.mock.calls[0]?.[0]).toMatchObject({
      model: "claude-opus-4-8",
      modelLabel: undefined,
      name: "Old faithful",
      capabilities: undefined,
    });
  });

  it("does not add an engine whose key was refused", async () => {
    const { onEngineSave } = openForm({
      ...fresh,
      engineKeys: {},
      onCheckKey: async () => ({ status: "rejected", models: [] }),
    });
    enterKey("bad");

    const message = await screen.findByRole("alert");
    expect(message.textContent).toContain("Anthropic rejected this key.");
    expect(keyField().getAttribute("aria-invalid")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Other…" }));
    fireEvent.change(screen.getByLabelText("Model ID"), {
      target: { value: "m" },
    });
    expect(addButton().disabled).toBe(true);
    expect(onEngineSave).not.toHaveBeenCalled();
  });

  it("offers another try when the provider could not be reached", async () => {
    let reachable = false;
    const onCheckKey = vi.fn(
      async (): Promise<KeyCheck> =>
        reachable ? anthropicModels : { status: "unreachable", models: [] },
    );
    openForm({ ...fresh, engineKeys: {}, onCheckKey });
    enterKey("key-new");
    await screen.findByText(/could not reach Anthropic/);

    reachable = true;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Anthropic accepted this key.");
    expect(onCheckKey).toHaveBeenCalledTimes(2);
  });

  it("dims the field while the key is being checked", () => {
    openForm({
      ...fresh,
      engineKeys: {},
      onCheckKey: () => new Promise(() => {}),
    });
    enterKey("key-new");
    expect(keyField().disabled).toBe(true);
    expect(screen.getByText("Checking the key with Anthropic…")).toBeDefined();
    expect(
      screen.getByText("Asking which models this key can use…"),
    ).toBeDefined();
  });

  it("refuses extra parameters that are not a JSON object", async () => {
    await openFormWithKey();
    fireEvent.click(screen.getByRole("radio", { name: "Claude Haiku 5.5" }));
    expect(addButton().disabled).toBe(false);

    for (const text of ["{ nope", "[1, 2]", '"text"']) {
      fireEvent.change(screen.getByLabelText("Extra parameters"), {
        target: { value: text },
      });
      expect(screen.getByRole("alert").textContent).toContain(
        "This is not a JSON object.",
      );
      expect(addButton().disabled).toBe(true);
    }
  });

  it("offers a search once the list of models is long", async () => {
    const many: KeyCheck = {
      status: "accepted",
      models: Array.from({ length: 12 }, (_, index) => ({
        id: `gpt-${index}`,
        label: `gpt-${index}`,
      })),
    };
    openForm({ onCheckKey: async () => many });
    enterKey("key-new");
    const search = await screen.findByLabelText("Search models");
    fireEvent.change(search, { target: { value: "gpt-11" } });
    expect(radios()).toEqual(["gpt-11", "Other…"]);
  });

  it("keeps a short list free of a search field", async () => {
    await openFormWithKey();
    expect(screen.queryByLabelText("Search models")).toBeNull();
  });
});

describe("an engine that exists", () => {
  async function openEngine(
    name: string,
    props: Partial<SettingsPanelProps> = {},
  ) {
    const panel = renderPanel(props);
    open("^Translation engines");
    open(`^${name}`);
    await waitFor(() => expect(panel.onCheckKey).toHaveBeenCalled());
    await waitFor(() => expect(keyField().disabled).toBe(false));
    return panel;
  }

  it("shows what it is made of, with its key hidden until asked", async () => {
    const { onCheckKey, onEngineSave } = await openEngine("Pages");

    expect(title()).toBe("Pages");
    expect(keyField().value).toBe("key-a");
    expect(keyField().type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show key" }));
    expect(keyField().type).toBe("text");

    expect(onCheckKey).toHaveBeenCalledWith("anthropic", "key-a");
    expect(checked("Claude Sonnet 5.5")).toBe(true);
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Pages",
    );
    expect(screen.getByText(/Used for page translation\./)).toBeDefined();
    // Opening it changes nothing.
    expect(onEngineSave).not.toHaveBeenCalled();
  });

  it("stores each change as it is made", async () => {
    const { onEngineSave } = await openEngine("Pages");

    fireEvent.click(screen.getByRole("radio", { name: "Claude Haiku 5.5" }));
    expect(onEngineSave).toHaveBeenLastCalledWith(
      {
        id: "sonnet",
        provider: "anthropic",
        model: "claude-haiku-5-5",
        modelLabel: "Claude Haiku 5.5",
        name: "Pages",
        capabilities: undefined,
        parameters: undefined,
      },
      "key-a",
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "" } });
    expect(onEngineSave.mock.lastCall?.[0]).toMatchObject({ name: undefined });
  });

  it("stores a new key only once its provider has accepted it", async () => {
    let answer: KeyCheck = anthropicModels;
    const { onEngineSave } = await openEngine("Pages", {
      onCheckKey: vi.fn(async () => answer),
    });

    answer = { status: "rejected", models: [] };
    enterKey("bad");
    await screen.findByText(/rejected this key/);
    expect(onEngineSave).not.toHaveBeenCalled();

    answer = anthropicModels;
    enterKey("key-better");
    await screen.findByText("Anthropic accepted this key.");
    expect(onEngineSave).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: "sonnet" }),
      "key-better",
    );
  });

  it("can still be renamed while its provider cannot be reached", async () => {
    const { onEngineSave } = await openEngine("Pages", {
      onCheckKey: vi.fn(
        async (): Promise<KeyCheck> => ({
          status: "unreachable",
          models: [],
        }),
      ),
    });
    // The one model it has is shown, for want of a list.
    expect(radios()).toEqual(["Claude Sonnet 5.5", "Other…"]);

    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Reading" },
    });
    expect(onEngineSave.mock.lastCall?.[0]).toMatchObject({ name: "Reading" });
  });

  it("shows a model that its key does not list under Other", async () => {
    const custom: Engine = {
      id: "c",
      provider: "anthropic",
      model: "claude-next",
    };
    await openEngine("claude-next", {
      settings: { ...settings, engines: [custom], engineFor: {} },
      engineKeys: { c: "key-a" },
    });
    await waitFor(() => expect(checked("Other…")).toBe(true));
    expect((screen.getByLabelText("Model ID") as HTMLInputElement).value).toBe(
      "claude-next",
    );
  });

  it("does not store parameters that are not a JSON object", async () => {
    const { onEngineSave } = await openEngine("Pages");
    fireEvent.change(screen.getByLabelText("Extra parameters"), {
      target: { value: "{ nope" },
    });
    expect(screen.getByRole("alert").textContent).toContain("Not stored.");
    expect(onEngineSave).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Extra parameters"), {
      target: { value: '{"temperature": 0}' },
    });
    expect(onEngineSave.mock.lastCall?.[0]).toMatchObject({
      parameters: { temperature: 0 },
    });
  });

  it("says which tasks it does", async () => {
    await openEngine("gpt-6.2-sol");
    expect(screen.getByText(/Used for translation\./)).toBeDefined();
  });

  it("can be removed", async () => {
    const { onEngineRemove } = await openEngine("Pages");
    fireEvent.click(screen.getByRole("button", { name: "Remove engine" }));
    expect(onEngineRemove).toHaveBeenCalledWith("sonnet");
    expect(title()).toBe("Translation engines");
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

describe("the request rate screen", () => {
  const field = () =>
    screen.getByRole("textbox", {
      name: "Requests per second",
    }) as HTMLInputElement;

  it("offers the rates from 1 to 10 and stores the chosen one", () => {
    const { onSettingsChange } = renderPanel();
    open("Request rate");

    expect(title()).toBe("Request rate");
    expect(radios()).toEqual([
      "1",
      "2",
      "3Default",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "Other…",
    ]);
    expect(checked(/^3/)).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "7" }));
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      pageRequestsPerSecond: 7,
    });
  });

  it("takes any other rate that is typed in", () => {
    const { onSettingsChange } = renderPanel();
    open("Request rate");
    fireEvent.click(screen.getByRole("radio", { name: "Other…" }));
    // Nothing changes before there is a number.
    expect(onSettingsChange).not.toHaveBeenCalled();

    fireEvent.change(field(), { target: { value: "25" } });
    expect(onSettingsChange).toHaveBeenLastCalledWith({
      ...settings,
      pageRequestsPerSecond: 25,
    });
  });

  it("does not store what is not a rate, and says so", () => {
    const { onSettingsChange } = renderPanel();
    open("Request rate");
    fireEvent.click(screen.getByRole("radio", { name: "Other…" }));

    for (const text of ["0", "101", "2.5", "fast", "-3"]) {
      fireEvent.change(field(), { target: { value: text } });
      expect(screen.getByRole("alert").textContent).toContain(
        "Enter a whole number from 1 to 100.",
      );
      expect(field().getAttribute("aria-invalid")).toBe("true");
    }
    expect(onSettingsChange).not.toHaveBeenCalled();

    fireEvent.change(field(), { target: { value: "" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows a stored rate that is not on the list under Other", () => {
    renderPanel({ settings: { ...settings, pageRequestsPerSecond: 40 } });
    expect(row("Request rate")).toContain("40 per second");
    open("Request rate");
    expect(checked("Other…")).toBe(true);
    expect(field().value).toBe("40");
  });
});

describe("the cache screen", () => {
  const usage = { entries: 412, bytes: 3_355_443, maxBytes: 9 * 1024 * 1024 };
  const clearButton = () =>
    screen.getByRole("button", { name: /^Clear/ }) as HTMLButtonElement;

  it("says on the main screen whether it is on and how much it holds", () => {
    const { cache, rerender } = renderPanel();
    expect(row("Cache")).toContain("On · 3.2 MB");

    rerender({
      cache: { ...cache, usage: { ...usage, entries: 0, bytes: 0 } },
    });
    expect(row("Cache")).toContain("On · empty");

    // Before the host knows how much is stored.
    rerender({ cache: { ...cache, usage: undefined } });
    expect(row("Cache")).toMatch(/CacheOn$/);

    rerender({ settings: { ...settings, cacheResponses: false } });
    expect(row("Cache")).toMatch(/CacheOff$/);
  });

  it("turns the reuse of answers off and on", () => {
    const { onSettingsChange, cache } = renderPanel();
    open("Cache");

    expect(title()).toBe("Cache");
    // What was stored since the panel opened is counted when the screen is.
    expect(cache.onRefresh).toHaveBeenCalledOnce();
    const reuse = screen.getByRole("switch", { name: "Reuse answers" });
    expect(reuse.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(reuse);
    expect(onSettingsChange).toHaveBeenCalledWith({
      ...settings,
      cacheResponses: false,
    });
  });

  it("says how much is stored, and what becomes of it", () => {
    const { rerender } = renderPanel();
    open("Cache");
    expect(
      screen.getByText(
        "412 answers, 3.2 MB of 9 MB. When it is full, the answers used longest ago make room.",
      ),
    ).toBeDefined();

    rerender({ settings: { ...settings, cacheResponses: false } });
    expect(
      screen.getByText(
        "412 answers, 3.2 MB of 9 MB. They are kept, and not used, while this is off.",
      ),
    ).toBeDefined();
  });

  it("counts one answer as one, and small sizes in KB", () => {
    const { cache, rerender } = renderPanel();
    open("Cache");
    rerender({
      cache: { ...cache, usage: { ...usage, entries: 1, bytes: 2600 } },
    });
    expect(screen.getByText(/^1 answer, 3 KB of 9 MB\./)).toBeDefined();
  });

  it("clears the cache at once, and says so for a moment", () => {
    vi.useFakeTimers();
    try {
      const { cache, rerender } = renderPanel();
      open("Cache");
      fireEvent.click(clearButton());

      expect(cache.onClear).toHaveBeenCalledOnce();
      expect(clearButton().textContent).toBe("Cleared");
      expect(clearButton().disabled).toBe(true);

      rerender({
        cache: { ...cache, usage: { ...usage, entries: 0, bytes: 0 } },
      });
      expect(screen.getByText("Nothing is stored.")).toBeDefined();

      act(() => void vi.advanceTimersByTime(2000));
      expect(clearButton().textContent).toBe("Clear cache");
      // There is nothing left to clear.
      expect(clearButton().disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
