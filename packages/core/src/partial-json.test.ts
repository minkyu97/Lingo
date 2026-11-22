import { describe, expect, it } from "vitest";
import { parsePartialJson } from "./partial-json.ts";

const sample = {
  headword: 'bank "the" \\ river',
  pronunciation: "/bæŋk/",
  note: "line one\nline two\ttabbed 😀 end",
  senses: [
    { partOfSpeech: "명사", meaning: "강둑, 제방", inContext: true, rank: 1 },
    { partOfSpeech: "명사", meaning: "은행", inContext: false, rank: 2.5 },
  ],
  empty: [],
  nothing: null,
  nested: { deep: { deeper: ["a", ["b"]] } },
};

/**
 * Whether `partial` could grow into `full`: strings are prefixes, containers
 * hold a subset of the members, and everything else is equal.
 */
function couldBecome(partial: unknown, full: unknown): boolean {
  if (typeof partial === "string") {
    return typeof full === "string" && full.startsWith(partial);
  }
  if (Array.isArray(partial)) {
    return (
      Array.isArray(full) &&
      partial.length <= full.length &&
      partial.every((item, index) => couldBecome(item, full[index]))
    );
  }
  if (typeof partial === "object" && partial !== null) {
    if (typeof full !== "object" || full === null || Array.isArray(full)) {
      return false;
    }
    const target = full as Record<string, unknown>;
    return Object.entries(partial).every(
      ([key, value]) => key in target && couldBecome(value, target[key]),
    );
  }
  return partial === full;
}

describe("parsePartialJson", () => {
  it("reads a complete document like JSON.parse", () => {
    for (const text of [
      JSON.stringify(sample),
      JSON.stringify(sample, null, 2),
      '{"a":[1,-2.5,3e2,true,false,null,"x"]}',
      "[]",
      "{}",
    ]) {
      expect(parsePartialJson(text)).toEqual(JSON.parse(text));
    }
  });

  it("reads every prefix of a document without contradicting the whole", () => {
    for (const text of [
      JSON.stringify(sample),
      JSON.stringify(sample, null, 2),
    ]) {
      // Stepping by UTF-16 code unit also cuts surrogate pairs in half.
      for (let length = 0; length <= text.length; length += 1) {
        const partial = parsePartialJson(text.slice(0, length));
        if (partial === undefined) continue;
        expect(couldBecome(partial, sample), `prefix of length ${length}`).toBe(
          true,
        );
      }
    }
  });

  it("returns an open string with the text it has so far", () => {
    expect(parsePartialJson('{"headword":"ba')).toEqual({ headword: "ba" });
    expect(parsePartialJson('{"headword":"')).toEqual({ headword: "" });
  });

  it("leaves out a key that is still being written or has no value yet", () => {
    expect(parsePartialJson('{"headword":"bank","pronun')).toEqual({
      headword: "bank",
    });
    expect(parsePartialJson('{"headword":"bank","pronunciation"')).toEqual({
      headword: "bank",
    });
    expect(parsePartialJson('{"headword":"bank","pronunciation":')).toEqual({
      headword: "bank",
    });
  });

  it("keeps the complete members of an open array and its partial last one", () => {
    expect(parsePartialJson('{"senses":[{"meaning":"강둑"},{"mean')).toEqual({
      senses: [{ meaning: "강둑" }, {}],
    });
    expect(parsePartialJson('{"senses":[{"meaning":"강')).toEqual({
      senses: [{ meaning: "강" }],
    });
  });

  it("waits for literals and numbers to be complete", () => {
    expect(parsePartialJson('{"a":tr')).toEqual({});
    expect(parsePartialJson('{"a":true')).toEqual({ a: true });
    expect(parsePartialJson('{"a":12')).toEqual({});
    expect(parsePartialJson('{"a":12,')).toEqual({ a: 12 });
    expect(parsePartialJson("[1,2")).toEqual([1]);
  });

  it("drops an escape sequence that is cut off", () => {
    expect(parsePartialJson('{"a":"x\\')).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x\\u00')).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x\\n')).toEqual({ a: "x\n" });
    expect(parsePartialJson('{"a":"x\\u00e9')).toEqual({ a: "xé" });
  });

  it("does not return half of a surrogate pair", () => {
    expect(parsePartialJson('{"a":"x\\ud83d')).toEqual({ a: "x" });
    expect(parsePartialJson('{"a":"x\\ud83d\\ude00')).toEqual({ a: "x😀" });
    const emoji = '{"a":"x😀';
    expect(parsePartialJson(emoji.slice(0, -1))).toEqual({ a: "x" });
    expect(parsePartialJson(emoji)).toEqual({ a: "x😀" });
  });

  it("skips text before the document, such as a code fence", () => {
    expect(parsePartialJson('```json\n{"a":"b"}\n```')).toEqual({ a: "b" });
    expect(parsePartialJson('Here you go: {"a":"b')).toEqual({ a: "b" });
  });

  it("returns undefined when there is no object or array", () => {
    expect(parsePartialJson("")).toBeUndefined();
    expect(parsePartialJson("강둑, 제방")).toBeUndefined();
    expect(parsePartialJson('"just a string"')).toBeUndefined();
  });

  it("keeps what came before malformed input and ignores the rest", () => {
    expect(parsePartialJson('{"a":"b" "c":"d"}')).toEqual({ a: "b" });
    expect(parsePartialJson('{"a":"b",oops,"c":"d"}')).toEqual({ a: "b" });
    expect(parsePartialJson('{"a":nope,"c":"d"}')).toEqual({});
    expect(parsePartialJson('{"a":"x\\q","c":"d"}')).toEqual({ a: "x" });
    expect(parsePartialJson("[1,,2]")).toEqual([1]);
  });

  it("treats a __proto__ key as plain data", () => {
    const parsed = parsePartialJson('{"__proto__":{"polluted":true}}') as {
      polluted?: boolean;
    };
    expect(parsed.polluted).toBeUndefined();
    expect(Object.keys(parsed)).toEqual(["__proto__"]);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it("stops at very deep nesting instead of overflowing the stack", () => {
    const deep = "[".repeat(10_000);
    expect(() => parsePartialJson(deep)).not.toThrow();
  });
});
