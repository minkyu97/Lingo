import { beforeEach, describe, expect, it } from "vitest";
import { captureContext } from "./dom.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  document.title = "A walk by the water";
  document.getSelection()?.removeAllRanges();
});

/** Selects from `startOffset` in the first text node of `start` to `endOffset` in that of `end`. */
function select(
  start: Node,
  startOffset: number,
  end: Node = start,
  endOffset?: number,
) {
  const range = document.createRange();
  range.setStart(textNode(start), startOffset);
  range.setEnd(textNode(end), endOffset ?? textNode(end).data.length);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function textNode(node: Node): Text {
  return (node.nodeType === 3 ? node : node.firstChild) as Text;
}

function $(selector: string): Element {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`no element matches ${selector}`);
  return element;
}

describe("captureContext", () => {
  it("returns nothing without a selection", () => {
    document.body.innerHTML = "<p>She sat on the river bank.</p>";
    expect(captureContext()).toBeUndefined();
  });

  it("returns nothing for a selection of only whitespace", () => {
    document.body.innerHTML = "<p>one   two</p>";
    select($("p"), 3, $("p"), 6);
    expect(captureContext()).toBeUndefined();
  });

  it("captures the paragraph around a word", () => {
    document.body.innerHTML =
      "<p>First paragraph.</p><p>She sat on the river bank and watched the boats.</p>";
    const p = $("p:nth-of-type(2)");
    select(p, 21, p, 25);

    expect(captureContext()).toEqual({
      selection: "bank",
      level: "paragraph",
      before: "She sat on the river ",
      after: " and watched the boats.",
      title: "A walk by the water",
      url: expect.any(String),
    });
  });

  it("reads across inline elements", () => {
    document.body.innerHTML =
      '<p>She sat on the <a href="#">river <em>bank</em></a> and watched.</p>';
    select($("em"), 0);

    const context = captureContext();
    expect(context?.selection).toBe("bank");
    expect(context?.before).toBe("She sat on the river ");
    expect(context?.after).toBe(" and watched.");
  });

  it("collapses the whitespace of the source markup", () => {
    document.body.innerHTML =
      "<p>\n   She sat\n   on the bank\n   today.\n</p>";
    const p = $("p");
    const text = textNode(p).data;
    const start = text.indexOf("bank");
    select(p, start, p, start + 4);

    const context = captureContext();
    expect(context?.before).toBe("She sat on the ");
    expect(context?.after).toBe(" today.");
  });

  it("looks one block further out when the selection fills its block", () => {
    document.body.innerHTML =
      "<ul><li>apples</li><li>bank</li><li>cherries</li></ul>";
    document.body.innerHTML = `<div>${document.body.innerHTML}</div>`;
    select($("li:nth-of-type(2)"), 0);

    const context = captureContext();
    expect(context?.selection).toBe("bank");
    expect(context?.level).toBe("paragraph");
    expect(context?.before).toBe("apples");
    expect(context?.after).toBe("cherries");
  });

  it("does not widen to the whole page", () => {
    document.body.innerHTML = "<p>bank</p><p>Unrelated footer text.</p>";
    select($("p"), 0);

    expect(captureContext()).toMatchObject({
      selection: "bank",
      level: "none",
    });
    expect(captureContext()?.before).toBeUndefined();
  });

  it("captures a selection inside a textarea", () => {
    document.body.innerHTML = "<textarea>She sat on the river bank.</textarea>";
    const field = $("textarea") as HTMLTextAreaElement;
    field.focus();
    field.setSelectionRange(21, 25);

    expect(captureContext()).toMatchObject({
      selection: "bank",
      level: "paragraph",
      before: "She sat on the river ",
      after: ".",
    });
  });

  it("captures a selection inside a text input", () => {
    document.body.innerHTML = '<input type="text" value="river bank" />';
    const field = $("input") as HTMLInputElement;
    field.focus();
    field.setSelectionRange(6, 10);

    expect(captureContext()).toMatchObject({
      selection: "bank",
      before: "river ",
    });
  });

  it("never reads a password field", () => {
    document.body.innerHTML =
      '<input type="password" value="hunter2 secret" />';
    const field = $("input") as HTMLInputElement;
    field.focus();
    field.setSelectionRange(0, 7);

    expect(captureContext()).toBeUndefined();
  });

  it("leaves the query string and fragment out of the URL", () => {
    document.body.innerHTML = "<p>river bank</p>";
    select($("p"), 6);
    const url = captureContext()?.url;
    if (url !== undefined) {
      expect(url).not.toContain("?");
      expect(url).not.toContain("#");
    }
  });
});
