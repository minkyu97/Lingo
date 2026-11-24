import { type DictionaryEntry, parseDictionaryEntry } from "@lingo/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DictionaryEntryView } from "./DictionaryEntryView.tsx";

afterEach(cleanup);

const entry: DictionaryEntry = {
  headword: "bank",
  pronunciation: "/bæŋk/",
  contextMeaning: "강둑. 그녀가 앉아 있던 강가의 땅을 가리킨다.",
  senses: [
    {
      partOfSpeech: "명사",
      meaning: "강둑, 제방",
      inContext: true,
      example: "the river bank",
      exampleTranslation: "강둑",
    },
    {
      partOfSpeech: "동사",
      meaning: "(돈을) 예금하다",
      inContext: false,
      example: "bank a check",
      exampleTranslation: "수표를 입금하다",
    },
    {
      partOfSpeech: "명사",
      meaning: "은행",
      inContext: false,
      example: "",
      exampleTranslation: "",
    },
  ],
};

describe("DictionaryEntryView", () => {
  it("shows the headword with its pronunciation", () => {
    render(<DictionaryEntryView entry={entry} />);
    expect(screen.getByText("bank")).toBeDefined();
    expect(screen.getByText("/bæŋk/")).toBeDefined();
  });

  it("sets the meaning in context apart under its own label", () => {
    render(<DictionaryEntryView entry={entry} />);
    const label = screen.getByText("In this context");
    expect(label.parentElement?.textContent).toContain("강가의 땅을 가리킨다");
  });

  it("lists the senses under one heading per part of speech", () => {
    render(<DictionaryEntryView entry={entry} />);
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "명사",
      "동사",
    ]);

    const [nouns, verbs] = screen.getAllByRole("list");
    expect(nouns?.textContent).toContain("강둑, 제방");
    expect(nouns?.textContent).toContain("은행");
    expect(verbs?.textContent).toContain("(돈을) 예금하다");
  });

  it("marks only the sense used in the passage", () => {
    render(<DictionaryEntryView entry={entry} />);
    const badges = screen.getAllByText("in context");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.closest("li")?.textContent).toContain("강둑, 제방");
  });

  it("shows an example with its translation, and nothing for a sense without one", () => {
    render(<DictionaryEntryView entry={entry} />);
    expect(screen.getByText("the river bank")).toBeDefined();
    expect(screen.getByText("강둑")).toBeDefined();

    const moneyBank = screen.getByText("은행").closest("li");
    expect(moneyBank?.querySelectorAll("p")).toHaveLength(1);
  });

  it("draws an entry that has only started to arrive", () => {
    const partial = parseDictionaryEntry('{"headword":"ba') as DictionaryEntry;
    const { container } = render(
      <DictionaryEntryView entry={partial} streaming />,
    );
    expect(screen.getByText("ba")).toBeDefined();
    expect(screen.queryByText("In this context")).toBeNull();
    expect(screen.queryAllByRole("list")).toEqual([]);
    expect(
      container.querySelector(".lingo-entry")?.getAttribute("data-streaming"),
    ).toBe("true");
  });

  it("draws every stage of a streaming entry without failing", () => {
    const json = JSON.stringify(entry);
    for (let length = 1; length <= json.length; length += 1) {
      const partial = parseDictionaryEntry(json.slice(0, length));
      if (!partial) continue;
      render(<DictionaryEntryView entry={partial} streaming />);
      cleanup();
    }
  });
});
