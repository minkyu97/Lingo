import { describe, expect, it } from "vitest";
import {
  buildPageTranslationRequest,
  createSegmentReader,
  escapeMarkupText,
  parseMarkup,
} from "./page-translation.ts";

describe("buildPageTranslationRequest", () => {
  it("lists the segments in order under the page's title", () => {
    const request = buildPageTranslationRequest({
      targetLanguage: "Korean",
      title: "Cats & dogs",
      segments: [
        { id: 1, text: "A <g1>bold</g1> word." },
        { id: 2, text: "Second." },
      ],
    });

    expect(request.system).toContain("into Korean");
    expect(request.system).not.toContain("{{");
    expect(request.messages).toEqual([
      {
        role: "user",
        content: [
          "<title>Cats &amp; dogs</title>",
          '<seg id="1">A <g1>bold</g1> word.</seg>',
          '<seg id="2">Second.</seg>',
        ].join("\n"),
      },
    ]);
  });

  it("leaves the title out when there is none", () => {
    const request = buildPageTranslationRequest({
      targetLanguage: "Korean",
      segments: [{ id: 7, text: "Only." }],
    });
    expect(request.messages[0]?.content).toBe('<seg id="7">Only.</seg>');
  });
});

describe("createSegmentReader", () => {
  it("returns each segment once the stream has completed it", () => {
    const reader = createSegmentReader();
    expect(reader.push('<seg id="1">안녕')).toEqual([]);
    expect(reader.push('하세요</seg>\n<seg id="2">둘')).toEqual([
      { id: 1, text: "안녕하세요" },
    ]);
    expect(reader.push("</se")).toEqual([]);
    expect(reader.push("g>")).toEqual([{ id: 2, text: "둘" }]);
  });

  it("returns several segments that arrive in one chunk", () => {
    const reader = createSegmentReader();
    expect(reader.push('<seg id="3">a</seg><seg id="4">b</seg>')).toEqual([
      { id: 3, text: "a" },
      { id: 4, text: "b" },
    ]);
  });

  it("ignores what a model writes outside the segments", () => {
    const reader = createSegmentReader();
    const text =
      '<thinking>bank → 강둑</thinking>\n\n<seg id="1">강둑</seg>\nDone.';
    expect(reader.push(text)).toEqual([{ id: 1, text: "강둑" }]);
  });

  it("keeps line breaks inside a segment", () => {
    const reader = createSegmentReader();
    expect(reader.push('<seg id="1">one\ntwo</seg>')).toEqual([
      { id: 1, text: "one\ntwo" },
    ]);
  });
});

describe("parseMarkup", () => {
  it("reads text without tags as one piece of text", () => {
    expect(parseMarkup("Hello")).toEqual([{ type: "text", text: "Hello" }]);
  });

  it("reads groups, kept text, and voids, nested as written", () => {
    expect(
      parseMarkup("A <g1>b <g2>c</g2></g1> d <k3>fetch()</k3><x4/>"),
    ).toEqual([
      { type: "text", text: "A " },
      {
        type: "group",
        id: 1,
        children: [
          { type: "text", text: "b " },
          { type: "group", id: 2, children: [{ type: "text", text: "c" }] },
        ],
      },
      { type: "text", text: " d " },
      { type: "keep", id: 3 },
      { type: "void", id: 4 },
    ]);
  });

  it("unescapes the page's own angle brackets and ampersands", () => {
    expect(parseMarkup("a &lt;b&gt; &amp;amp; c")).toEqual([
      { type: "text", text: "a <b> &amp; c" },
    ]);
  });

  it("takes anything that is not one of its tags as text", () => {
    expect(parseMarkup("x <b>y</b> <g>z")).toEqual([
      { type: "text", text: "x <b>y</b> <g>z" },
    ]);
  });

  it("accepts the ways a model may write a void", () => {
    const one = [{ type: "void", id: 1 }];
    expect(parseMarkup("<x1/>")).toEqual(one);
    expect(parseMarkup("<x1 />")).toEqual(one);
    expect(parseMarkup("<x1>")).toEqual(one);
    expect(parseMarkup("<x1></x1>")).toEqual(one);
  });

  it("rejects tags that do not pair up", () => {
    expect(parseMarkup("<g1>open")).toBeUndefined();
    expect(parseMarkup("close</g1>")).toBeUndefined();
    expect(parseMarkup("<g1><g2>crossed</g1></g2>")).toBeUndefined();
    expect(parseMarkup("<g1>wrong kind</k1>")).toBeUndefined();
  });
});

describe("escapeMarkupText", () => {
  it("makes text that looks like a tag read as text", () => {
    const escaped = escapeMarkupText("use <g1> & </seg>");
    expect(escaped).toBe("use &lt;g1&gt; &amp; &lt;/seg&gt;");
    expect(parseMarkup(escaped)).toEqual([
      { type: "text", text: "use <g1> & </seg>" },
    ]);
  });
});
