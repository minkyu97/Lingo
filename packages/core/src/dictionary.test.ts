import { describe, expect, it } from "vitest";
import {
  type DictionaryEntry,
  type DictionarySense,
  dictionaryEntryToText,
  groupSenses,
  hasDictionaryContent,
  parseDictionaryEntry,
} from "./dictionary.ts";

const riverBank: DictionarySense = {
  partOfSpeech: "명사",
  meaning: "강둑, 제방",
  inContext: true,
  example: "the river bank",
  exampleTranslation: "강둑",
};

const moneyBank: DictionarySense = {
  partOfSpeech: "명사",
  meaning: "은행",
  inContext: false,
  example: "open a bank account",
  exampleTranslation: "은행 계좌를 만들다",
};

const deposit: DictionarySense = {
  partOfSpeech: "동사",
  meaning: "(돈을) 예금하다",
  inContext: false,
  example: "bank a check",
  exampleTranslation: "수표를 입금하다",
};

const entry: DictionaryEntry = {
  headword: "bank",
  pronunciation: "/bæŋk/",
  contextMeaning: "강둑. 그녀가 앉아 있던 강가의 땅을 가리킨다.",
  senses: [riverBank, moneyBank, deposit],
};

const json = JSON.stringify(entry);

describe("parseDictionaryEntry", () => {
  it("reads a complete entry", () => {
    expect(parseDictionaryEntry(json)).toEqual(entry);
  });

  it("reads an entry wrapped in a code fence", () => {
    expect(parseDictionaryEntry(`\`\`\`json\n${json}\n\`\`\``)).toEqual(entry);
  });

  it("fills in what has not arrived yet with empty values", () => {
    expect(parseDictionaryEntry('{"headword":"ba')).toEqual({
      headword: "ba",
      pronunciation: "",
      contextMeaning: "",
      senses: [],
    });
  });

  it("returns a sense as soon as it starts arriving", () => {
    const partial = parseDictionaryEntry(
      '{"headword":"bank","pronunciation":"/bæŋk/","contextMeaning":"강둑","senses":[{"partOfSpeech":"명사","meaning":"강',
    );
    expect(partial?.senses).toEqual([
      {
        partOfSpeech: "명사",
        meaning: "강",
        inContext: false,
        example: "",
        exampleTranslation: "",
      },
    ]);
  });

  it("never throws on any prefix of an entry", () => {
    for (let length = 0; length <= json.length; length += 1) {
      const partial = parseDictionaryEntry(json.slice(0, length));
      if (!partial) continue;
      expect(entry.headword.startsWith(partial.headword)).toBe(true);
      expect(partial.senses.length).toBeLessThanOrEqual(entry.senses.length);
    }
  });

  it("returns undefined for an answer that is not JSON", () => {
    expect(parseDictionaryEntry("")).toBeUndefined();
    expect(parseDictionaryEntry("bank: 강둑, 은행")).toBeUndefined();
    expect(parseDictionaryEntry('["bank"]')).toBeUndefined();
  });

  it("ignores fields of the wrong type", () => {
    expect(
      parseDictionaryEntry(
        '{"headword":5,"pronunciation":null,"contextMeaning":["x"],"senses":["x",{"meaning":"m","inContext":"yes","partOfSpeech":7}],"extra":1}',
      ),
    ).toEqual({
      headword: "",
      pronunciation: "",
      contextMeaning: "",
      senses: [
        {
          partOfSpeech: "",
          meaning: "m",
          inContext: false,
          example: "",
          exampleTranslation: "",
        },
      ],
    });
    expect(parseDictionaryEntry('{"senses":"none"}')?.senses).toEqual([]);
  });
});

describe("hasDictionaryContent", () => {
  it("is false until a field with text arrives", () => {
    const empty = parseDictionaryEntry("{") as DictionaryEntry;
    expect(hasDictionaryContent(empty)).toBe(false);
    expect(hasDictionaryContent({ ...empty, pronunciation: "/bæŋk/" })).toBe(
      false,
    );
  });

  it("is true once there is a headword, a context meaning, or a sense", () => {
    const empty = parseDictionaryEntry("{") as DictionaryEntry;
    expect(hasDictionaryContent({ ...empty, headword: "b" })).toBe(true);
    expect(hasDictionaryContent({ ...empty, contextMeaning: "강" })).toBe(true);
    expect(hasDictionaryContent({ ...empty, senses: [riverBank] })).toBe(true);
  });
});

describe("groupSenses", () => {
  it("makes one group per part of speech", () => {
    const groups = groupSenses(entry.senses);
    expect(groups.map((group) => group.partOfSpeech)).toEqual(["명사", "동사"]);
    expect(groups[0]?.senses.map((sense) => sense.meaning)).toEqual([
      "강둑, 제방",
      "은행",
    ]);
  });

  it("joins senses of one part of speech that arrive apart", () => {
    const groups = groupSenses([riverBank, deposit, moneyBank]);
    expect(groups.map((group) => group.partOfSpeech)).toEqual(["명사", "동사"]);
    expect(groups[0]?.senses).toEqual([riverBank, moneyBank]);
  });

  it("leaves out senses whose meaning has not arrived", () => {
    const pending = { ...riverBank, meaning: "" };
    expect(groupSenses([pending])).toEqual([]);
  });
});

describe("dictionaryEntryToText", () => {
  it("renders the entry as readable text", () => {
    expect(dictionaryEntryToText(entry)).toBe(
      [
        "bank /bæŋk/",
        "In this context: 강둑. 그녀가 앉아 있던 강가의 땅을 가리킨다.",
        "",
        "명사",
        "1. 강둑, 제방",
        "   the river bank / 강둑",
        "2. 은행",
        "   open a bank account / 은행 계좌를 만들다",
        "",
        "동사",
        "1. (돈을) 예금하다",
        "   bank a check / 수표를 입금하다",
      ].join("\n"),
    );
  });

  it("leaves out the parts that are empty", () => {
    expect(
      dictionaryEntryToText({
        headword: "bank",
        pronunciation: "",
        contextMeaning: "",
        senses: [
          {
            partOfSpeech: "",
            meaning: "은행",
            inContext: false,
            example: "",
            exampleTranslation: "",
          },
        ],
      }),
    ).toBe("bank\n\n1. 은행");
  });
});
