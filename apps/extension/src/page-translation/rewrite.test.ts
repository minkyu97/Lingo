import { beforeEach, describe, expect, it } from "vitest";
import { applyTranslation, restoreUnit } from "./rewrite.ts";
import { type ScanOptions, scanHost, type Unit } from "./units.ts";

const OPTIONS: ScanOptions = { keepLinkText: false };

beforeEach(() => {
  document.body.innerHTML = "";
});

/** Puts HTML in the page and returns the units of its first element. */
function unitsOf(html: string, options = OPTIONS): Unit[] {
  document.body.innerHTML = html;
  const host = document.body.firstElementChild;
  if (!host) throw new Error("The HTML has no element");
  return scanHost(host, options).units;
}

function unitOf(html: string, options = OPTIONS): Unit {
  const [unit, ...others] = unitsOf(html, options);
  if (!unit || others.length > 0) throw new Error("Expected one unit");
  return unit;
}

const html = () => document.body.innerHTML;

describe("scanHost", () => {
  it("sends plain text as it is", () => {
    expect(unitOf("<p>Hello,   world.\n</p>").source).toBe("Hello, world.");
  });

  it("tags inline elements, nested as they are", () => {
    const unit = unitOf(
      '<p>Read <b>the <a href="/docs">docs</a></b> and <i>enjoy</i>.</p>',
    );
    expect(unit.source).toBe(
      "Read <g1>the <g2>docs</g2></g1> and <g3>enjoy</g3>.",
    );
  });

  it("keeps code as it is, and shows it to the model", () => {
    const unit = unitOf("<p>Call <code>fetch(a &lt; b)</code> first.</p>");
    expect(unit.source).toBe("Call <k1>fetch(a &lt; b)</k1> first.");
  });

  it("marks what is not text as a void", () => {
    const unit = unitOf('<p>One<br>two <img src="x.png" alt=""> three</p>');
    expect(unit.source).toBe("One<x1/>two <x2/> three");
  });

  it("keeps an element that holds no words", () => {
    const unit = unitOf('<p>Water boils<sup><a href="#n1">[1]</a></sup>.</p>');
    expect(unit.source).toBe("Water boils<k1>[1]</k1>.");
  });

  it("gives an element that only wraps another one a single tag", () => {
    const unit = unitOf('<p>See <b><a href="/x">this page</a></b> now.</p>');
    expect(unit.source).toBe("See <g1>this page</g1> now.");
  });

  it("needs no tag for a run that is one element", () => {
    const unit = unitOf('<li><a href="/"><span>Home</span></a></li>');
    expect(unit.source).toBe("Home");
    expect(unit.root.parent).toBe(document.querySelector("span"));
  });

  it("can keep the text of links", () => {
    const options = { keepLinkText: true };
    const unit = unitOf('<p>See the <a href="/d">docs</a> first.</p>', options);
    expect(unit.source).toBe("See the <k1>docs</k1> first.");
    // A run that is nothing but a link has nothing left to translate.
    expect(unitsOf('<li><a href="/">Home</a></li>', options)).toEqual([]);
  });

  it("skips text without words", () => {
    expect(unitsOf("<p>12:30 — 3.5%</p>")).toEqual([]);
    expect(unitsOf("<p>   </p>")).toEqual([]);
  });

  it("splits the text around block-level children into runs", () => {
    document.body.innerHTML =
      "<div>Before <b>it</b><p>Inside</p>After<pre>code()</pre></div>";
    const host = document.body.firstElementChild as Element;
    const scan = scanHost(host, OPTIONS);

    expect(scan.units.map((unit) => unit.source)).toEqual([
      "Before <g1>it</g1>",
      "After",
    ]);
    // The paragraph is scanned on its own. The code block is not.
    expect(scan.children.map((child) => child.localName)).toEqual(["p"]);
  });

  it("leaves out what the page marks as not to be translated", () => {
    expect(unitsOf('<p translate="no">Brand</p>')).toEqual([]);
    expect(unitsOf('<p class="notranslate">Brand</p>')).toEqual([]);
    expect(unitsOf('<div contenteditable="true">Draft</div>')).toEqual([]);
    expect(
      unitOf('<p>By <span translate="no">Lingo</span> team</p>').source,
    ).toBe("By <k1>Lingo</k1> team");
  });

  it("escapes text that looks like a tag", () => {
    expect(unitOf("<p>Write &lt;g1&gt; &amp; go</p>").source).toBe(
      "Write &lt;g1&gt; &amp; go",
    );
  });
});

describe("applyTranslation", () => {
  it("writes into the page's own text node", () => {
    const unit = unitOf("<p>Hello, world.</p>");
    const text = document.querySelector("p")?.firstChild;

    expect(applyTranslation(unit, "안녕, 세상.")).toBeUndefined();

    expect(html()).toBe("<p>안녕, 세상.</p>");
    expect(document.querySelector("p")?.firstChild).toBe(text);
  });

  it("moves the page's own elements to follow the word order", () => {
    const unit = unitOf(
      '<p>Click <a href="/go" class="cta">here</a> to <b style="color: red">start</b> it.</p>',
    );
    const link = document.querySelector("a");
    const bold = document.querySelector("b");

    expect(
      applyTranslation(unit, "<g2>시작</g2>하려면 <g1>여기</g1>를 누르세요."),
    ).toBeUndefined();

    expect(html()).toBe(
      '<p><b style="color: red">시작</b>하려면 <a href="/go" class="cta">여기</a>를 누르세요.</p>',
    );
    // The same elements, so their styles and listeners come along.
    expect(document.querySelector("a")).toBe(link);
    expect(document.querySelector("b")).toBe(bold);
  });

  it("fills nested elements", () => {
    const unit = unitOf("<p>A <b>big <i>red</i> dog</b> ran.</p>");
    expect(
      applyTranslation(unit, "<g1><g2>빨간</g2> 큰 개</g1>가 달렸다."),
    ).toBeUndefined();
    expect(html()).toBe("<p><b><i>빨간</i> 큰 개</b>가 달렸다.</p>");
  });

  it("leaves kept text and voids untouched, wherever they move", () => {
    const unit = unitOf(
      '<p>Call <code>fetch()</code> to load<img src="x.png"> data.</p>',
    );
    expect(
      applyTranslation(
        unit,
        "데이터<x2/>를 불러오려면 <k1>가져오기()</k1>를 호출하세요.",
      ),
    ).toBeUndefined();
    expect(html()).toBe(
      '<p>데이터<img src="x.png">를 불러오려면 <code>fetch()</code>를 호출하세요.</p>',
    );
  });

  it("fills the innermost element of a run that is one element", () => {
    const unit = unitOf('<li><a href="/"><span>Home</span></a></li>');
    expect(applyTranslation(unit, "홈")).toBeUndefined();
    expect(html()).toBe('<li><a href="/"><span>홈</span></a></li>');
  });

  it("translates one run and leaves its block-level siblings alone", () => {
    const [before, after] = unitsOf("<div>Before<p>Inside</p>After</div>");
    if (!before || !after) throw new Error("Expected two units");

    expect(applyTranslation(after, "뒤")).toBeUndefined();
    expect(html()).toBe("<div>Before<p>Inside</p>뒤</div>");
    expect(applyTranslation(before, "앞")).toBeUndefined();
    expect(html()).toBe("<div>앞<p>Inside</p>뒤</div>");
  });

  it("removes no node of the page", () => {
    const unit = unitOf("<p>One <b>two</b> three <i>four</i> five</p>");
    const paragraph = document.querySelector("p") as Element;
    const before = [...paragraph.childNodes];

    // Fewer pieces of text than the page had.
    expect(
      applyTranslation(unit, "<g1>둘</g1><g2>넷</g2> 하나"),
    ).toBeUndefined();

    expect(paragraph.textContent).toBe("둘넷 하나");
    for (const node of before) expect(node.parentNode).toBe(paragraph);
  });

  it.each([
    ["unpaired", "<g1>여기"],
    ["missing", "여기 <g2>굵게</g2>"],
    // The link ended up inside the bold text, where it cannot go.
    ["missing", "<g2>굵게 <g1>여기</g1></g2>"],
    ["missing", "<g1>여기</g1> <k2>굵게</k2>"],
  ])(
    "refuses a translation with %s tags and leaves the page alone",
    (reason, translation) => {
      const source = '<p>Go <a href="/x">here</a> and be <b>bold</b>.</p>';
      const unit = unitOf(source);
      expect(applyTranslation(unit, translation)).toBe(reason);
      expect(html()).toBe(source);
      expect(unit.translated).toBe(false);
    },
  );

  it("takes off a tag that the text did not have, and keeps its words", () => {
    const unit = unitOf('<p>Go <a href="/x">here</a> now.</p>');
    expect(
      applyTranslation(unit, "지금 <g1>여기</g1>로 <g7>가세요</g7>."),
    ).toBeUndefined();
    expect(html()).toBe('<p>지금 <a href="/x">여기</a>로 가세요.</p>');
  });

  it("uses a tag once when the translation has it twice", () => {
    const unit = unitOf('<p>Go <a href="/x">here</a> now.</p>');
    expect(
      applyTranslation(unit, "<g1>여기</g1>로, 바로 <g1>여기</g1>로."),
    ).toBeUndefined();
    expect(html()).toBe('<p><a href="/x">여기</a>로, 바로 여기로.</p>');
  });

  it("refuses to write where the page has taken a node away", () => {
    const unit = unitOf("<p>One <b>two</b> three</p>");
    document.querySelector("b")?.remove();
    expect(applyTranslation(unit, "하나 <g1>둘</g1> 셋")).toBe("detached");
  });

  it("puts back the whitespace around text that the page preserves", () => {
    const unit = unitOf(
      '<p style="white-space: pre-wrap">\n  Hello\nthere  </p>',
    );
    expect(unit.source).toBe("Hello\nthere");
    expect(applyTranslation(unit, "안녕\n거기")).toBeUndefined();
    expect(document.querySelector("p")?.textContent).toBe("\n  안녕\n거기  ");
  });
});

describe("restoreUnit", () => {
  it("puts back every node and text exactly as the page had them", () => {
    const source =
      '<p>Click <a href="/go">here <i>now</i></a> to <b>start</b><!-- note --> it<br>today.</p>';
    const unit = unitOf(source);
    const paragraph = document.querySelector("p") as Element;
    const nodes = [...paragraph.childNodes];

    expect(
      applyTranslation(
        unit,
        "오늘<x4/><g3>시작</g3>하려면 <g1><g2>지금</g2> 여기</g1>를 누르세요.",
      ),
    ).toBeUndefined();
    expect(paragraph.textContent).toBe("오늘시작하려면 지금 여기를 누르세요.");

    restoreUnit(unit);

    expect(html()).toBe(source);
    expect([...paragraph.childNodes]).toEqual(nodes);
    expect(unit.translated).toBe(false);
  });

  it("can be translated again after a restore", () => {
    const unit = unitOf("<p>One <b>two</b></p>");
    applyTranslation(unit, "<g1>둘</g1> 하나 더");
    restoreUnit(unit);
    expect(applyTranslation(unit, "하나 <g1>둘</g1>")).toBeUndefined();
    expect(html()).toBe("<p>하나 <b>둘</b></p>");
  });

  it("does not bring back a node the page removed", () => {
    const source = "<p>One <b>two</b> three</p>";
    const unit = unitOf(source);
    applyTranslation(unit, "<g1>둘</g1> 하나 셋");
    document.querySelector("b")?.remove();

    restoreUnit(unit);

    expect(html()).toBe("<p>One  three</p>");
  });
});
