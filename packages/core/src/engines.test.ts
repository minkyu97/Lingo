import { describe, expect, it } from "vitest";
import {
  type Engine,
  engineForTask,
  engineName,
  removeEngine,
  saveEngine,
} from "./engines.ts";

const sol: Engine = { id: "sol", provider: "openai", model: "gpt-6.2-sol" };
const fable: Engine = {
  id: "fable",
  provider: "anthropic",
  model: "claude-fable-5-2",
  modelLabel: "Claude Fable 5.2",
};
const sonnet: Engine = {
  id: "sonnet",
  provider: "anthropic",
  model: "claude-sonnet-5-5",
  modelLabel: "Claude Sonnet 5.5",
  name: "Pages",
};
const settings = {
  engines: [sol, fable, sonnet],
  engineFor: { define: "fable", page: "sonnet" },
};

describe("engineName", () => {
  it("is the name the user gave, or else the model's", () => {
    expect(engineName(sonnet)).toBe("Pages");
    expect(engineName(fable)).toBe("Claude Fable 5.2");
    expect(engineName(sol)).toBe("gpt-6.2-sol");
  });
});

describe("engineForTask", () => {
  it("is the engine chosen for the task", () => {
    expect(engineForTask(settings, "define")).toBe(fable);
    expect(engineForTask(settings, "page")).toBe(sonnet);
  });

  it("is the first engine while none is chosen", () => {
    expect(engineForTask(settings, "translate")).toBe(sol);
    expect(
      engineForTask({ engines: [fable], engineFor: { page: "gone" } }, "page"),
    ).toBe(fable);
  });

  it("is nothing when there is no engine", () => {
    expect(
      engineForTask({ engines: [], engineFor: {} }, "page"),
    ).toBeUndefined();
  });
});

describe("saveEngine", () => {
  it("adds a new engine at the end", () => {
    const added: Engine = { id: "new", provider: "openai", model: "o3" };
    expect(saveEngine(settings, added).engines).toEqual([
      sol,
      fable,
      sonnet,
      added,
    ]);
  });

  it("replaces the engine with the same ID, in place", () => {
    const changed = { ...fable, name: "Dictionary" };
    expect(saveEngine(settings, changed).engines).toEqual([
      sol,
      changed,
      sonnet,
    ]);
  });
});

describe("removeEngine", () => {
  it("hands the tasks of a removed engine to the first one left", () => {
    const after = removeEngine(settings, "sonnet");
    expect(after.engines).toEqual([sol, fable]);
    expect(after.engineFor).toEqual({ define: "fable" });
    expect(engineForTask(after, "page")).toBe(sol);
  });

  it("leaves the other choices as they are", () => {
    expect(removeEngine(settings, "sol").engineFor).toEqual(settings.engineFor);
  });
});
