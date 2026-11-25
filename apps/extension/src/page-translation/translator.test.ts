import type { LLMErrorKind } from "@lingo/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type PageEvent,
  type PageRequest,
  pageTranslationOptionsSchema,
} from "./protocol.ts";
import {
  createPageTranslator,
  type PageTranslationProgress,
  type PageTranslationStatus,
  type PageTranslator,
  type TranslatorPort,
} from "./translator.ts";

/** Stands in for the browser's observer: a test says what is near the viewport. */
class FakeIntersectionObserver {
  static latest: FakeIntersectionObserver | undefined;
  readonly targets = new Set<Element>();
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.latest = this;
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }

  report(selector: string, isIntersecting: boolean) {
    const entries = [...document.querySelectorAll(selector)]
      .filter((target) => this.targets.has(target))
      .map((target) => ({ target, isIntersecting }));
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

/** Scrolls the elements into view, as far as the translator can tell. */
const show = (selector: string) =>
  FakeIntersectionObserver.latest?.report(selector, true);
const hide = (selector: string) =>
  FakeIntersectionObserver.latest?.report(selector, false);

type TranslateRequest = Extract<PageRequest, { type: "translate" }>;

/** Stands in for the background: records what is sent, and answers on request. */
function fakeBackground() {
  const sent: PageRequest[] = [];
  let connections = 0;
  let deliver: (event: PageEvent) => void = () => {};
  let closed: () => void = () => {};
  let refuse = false;

  const connect = (): TranslatorPort => {
    if (refuse) throw new Error("Extension context invalidated.");
    connections += 1;
    return {
      postMessage: (request) => {
        sent.push(request);
      },
      disconnect: () => {},
      onMessage: { addListener: (listener) => (deliver = listener) },
      onDisconnect: { addListener: (listener) => (closed = listener) },
    };
  };
  const emit = (event: PageEvent) => deliver(event);
  const translations = () =>
    sent.filter((request): request is TranslateRequest => {
      return request.type === "translate";
    });

  return {
    connect,
    sent,
    emit,
    translations,
    get connections() {
      return connections;
    },
    permits: () => sent.filter((request) => request.type === "permit").length,
    configure: (options: object = {}) =>
      emit({
        type: "config",
        options: pageTranslationOptionsSchema.parse(options),
        targetLanguage: "ko",
        provider: "Anthropic",
      }),
    /** Fails a request the way the provider did. */
    fail(request: TranslateRequest | undefined, kind: LLMErrorKind) {
      if (!request) throw new Error("There is no request to fail");
      emit({ type: "error", batch: request.batch, kind, message: kind });
    },
    /** Grants a permit, and returns the request that it let through. */
    permit(): TranslateRequest | undefined {
      const before = translations().length;
      emit({ type: "permit" });
      return translations()[before];
    },
    /** Answers a request, segment by segment, with the given translations. */
    answer(request: TranslateRequest | undefined, texts: string[]) {
      if (!request) throw new Error("There is no request to answer");
      texts.forEach((text, index) => {
        const id = request.segments[index]?.id ?? -1;
        emit({ type: "segment", batch: request.batch, id, text });
      });
      emit({ type: "done", batch: request.batch });
    },
    close: () => closed(),
    refuseConnections: () => {
      refuse = true;
    },
  };
}

let background: ReturnType<typeof fakeBackground>;
let translator: PageTranslator;
let progress: PageTranslationProgress | undefined;
let status: PageTranslationStatus | undefined;
/** The text of what is waiting for its translation, as the page was told. */
let pending: Set<string>;

/** Lets observers and queued reports run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function page(html: string) {
  document.body.innerHTML = html;
  background = fakeBackground();
  progress = undefined;
  status = undefined;
  pending = new Set();
  translator = createPageTranslator({
    connect: background.connect,
    onProgress: (latest) => {
      progress = latest;
    },
    onStatus: (latest) => {
      status = latest;
    },
    onPending: (unit, waiting) => {
      if (waiting) pending.add(unit.source);
      else pending.delete(unit.source);
    },
  });
}

function startWith(html: string, options: object = {}) {
  page(html);
  translator.start();
  background.configure(options);
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  document.title = "A test page";
});

afterEach(() => {
  translator?.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("createPageTranslator", () => {
  it("translates text once it is near the viewport", () => {
    startWith('<p id="a">Hello</p><p id="b">Far away</p>');
    expect(background.sent).toEqual([]);

    show("#a");
    expect(background.sent).toEqual([{ type: "permit" }]);

    const request = background.permit();
    expect(request).toMatchObject({
      type: "translate",
      title: "A test page",
      segments: [{ id: 1, text: "Hello" }],
    });
    background.answer(request, ["안녕"]);

    expect(document.body.innerHTML).toBe(
      '<p id="a">안녕</p><p id="b">Far away</p>',
    );
    // Nothing else is near, so nothing else is asked for.
    expect(background.permits()).toBe(1);
  });

  it("puts what is near into one request, in page order", () => {
    startWith('<h1>Title</h1><p>One <b>bold</b> word</p><p id="far">Far</p>');
    show("h1, p:not(#far)");

    const request = background.permit();
    expect(request?.segments).toEqual([
      { id: 1, text: "Title" },
      { id: 2, text: "One <g1>bold</g1> word" },
    ]);
    background.answer(request, ["제목", "<g1>굵은</g1> 낱말 하나"]);

    expect(document.body.innerHTML).toBe(
      '<h1>제목</h1><p><b>굵은</b> 낱말 하나</p><p id="far">Far</p>',
    );
  });

  it("starts another request for what does not fit into one", () => {
    startWith("<p>First paragraph</p><p>Second paragraph</p>", {
      batchChars: 20,
    });
    show("p");

    expect(background.permit()?.segments).toEqual([
      { id: 1, text: "First paragraph" },
    ]);
    // Asked for the next permit at once, without waiting for the answer.
    expect(background.permits()).toBe(2);
    expect(background.permit()?.segments).toEqual([
      { id: 1, text: "Second paragraph" },
    ]);
  });

  it("asks once for text that appears several times", () => {
    startWith("<ul><li>Reply</li><li>Share</li><li>Reply</li></ul>");
    show("li");

    const request = background.permit();
    expect(request?.segments).toEqual([
      { id: 1, text: "Reply" },
      { id: 2, text: "Share" },
    ]);
    background.answer(request, ["답글", "공유"]);

    expect(document.body.innerHTML).toBe(
      "<ul><li>답글</li><li>공유</li><li>답글</li></ul>",
    );
  });

  it("does not ask for text that left before its turn came", () => {
    startWith('<p id="a">Hello</p>');
    show("#a");
    hide("#a");

    expect(background.permit()).toBeUndefined();
    expect(document.body.innerHTML).toBe('<p id="a">Hello</p>');
  });

  it("sends a paragraph again, on its own, when its answer does not fit", () => {
    startWith('<p>Read <a href="/x">this</a> now</p><p>Bye</p>');
    show("p");

    // The link is missing from the first answer.
    background.answer(background.permit(), ["지금 이것을 읽어라", "안녕"]);
    expect(document.body.innerHTML).toBe(
      '<p>Read <a href="/x">this</a> now</p><p>안녕</p>',
    );

    const again = background.permit();
    expect(again?.segments).toEqual([
      { id: 1, text: "Read <g1>this</g1> now" },
    ]);
    background.answer(again, ["지금 <g1>이것</g1>을 읽어라"]);
    expect(document.body.innerHTML).toBe(
      '<p>지금 <a href="/x">이것</a>을 읽어라</p><p>안녕</p>',
    );
  });

  it("shows a second answer that does not fit either, without what it lost", async () => {
    startWith('<p>Read <a href="/x">this</a> now</p>');
    show("p");

    background.answer(background.permit(), ["지금 이것을 읽어라"]);
    background.answer(background.permit(), ["지금 이것을 읽어라"]);
    await settle();

    // Translated, at the cost of the link's words.
    expect(document.body.innerHTML).toBe(
      '<p>지금 이것을 읽어라<a href="/x"></a></p>',
    );
    expect(background.permits()).toBe(2);
    expect(progress).toMatchObject({ translated: 1, lossy: 1, failed: 0 });

    // The same text elsewhere gets the same translation, without a request.
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p id="b">Read <a href="/y">this</a> now</p>',
    );
    await settle();
    show("#b");
    expect(document.querySelector("#b")?.textContent).toBe(
      "지금 이것을 읽어라",
    );
    expect(background.permits()).toBe(2);
  });

  it("asks again for a segment that the answer left out", () => {
    startWith("<p>One</p><p>Two</p>");
    show("p");

    background.answer(background.permit(), ["하나"]);

    expect(background.permit()?.segments).toEqual([{ id: 1, text: "Two" }]);
  });

  it("translates what the page adds", async () => {
    startWith('<div id="comments"><p>First</p></div>');
    show("p");
    background.answer(background.permit(), ["첫째"]);

    const comment = document.createElement("p");
    comment.innerHTML = "A <em>new</em> comment";
    document.querySelector("#comments")?.append(comment);
    await settle();
    show("p");

    const request = background.permit();
    expect(request?.segments).toEqual([
      { id: 1, text: "A <g1>new</g1> comment" },
    ]);
    background.answer(request, ["<g1>새</g1> 댓글"]);
    expect(document.body.innerHTML).toBe(
      '<div id="comments"><p>첫째</p><p><em>새</em> 댓글</p></div>',
    );
  });

  it("translates again what the page rewrites", async () => {
    startWith("<p>Old words</p>");
    show("p");
    background.answer(background.permit(), ["옛 말"]);

    // The page writes into the same text node, as a framework does.
    const text = document.querySelector("p")?.firstChild as Text;
    text.data = "New words";
    await settle();

    // Still near, so it is asked for without being shown again.
    const request = background.permit();
    expect(request?.segments).toEqual([{ id: 1, text: "New words" }]);
    background.answer(request, ["새 말"]);
    expect(document.body.innerHTML).toBe("<p>새 말</p>");
  });

  it("leaves alone what the page changes inside kept text", async () => {
    startWith("<p>Count: <code>1</code> so far</p>");
    show("p");
    background.answer(background.permit(), ["지금까지 <k1>1</k1>개"]);
    const permits = background.permits();

    const code = document.querySelector("code")?.firstChild as Text;
    code.data = "2";
    await settle();

    expect(document.body.innerHTML).toBe("<p>지금까지 <code>2</code>개</p>");
    expect(background.permits()).toBe(permits);
  });

  it("gives up on an element that the page keeps rewriting", async () => {
    startWith("<p>Tick 0</p>");
    show("p");
    const text = document.querySelector("p")?.firstChild as Text;

    for (let tick = 1; tick <= 12; tick++) {
      const request = background.permit();
      if (request) background.answer(request, [`틱 ${tick}`]);
      text.data = `Tick ${tick}`;
      await settle();
    }

    // After a while the page's own text is left in place.
    expect(document.body.innerHTML).toBe("<p>Tick 12</p>");
    expect(background.translations().length).toBeLessThan(12);
  });

  it("sends what was in progress again when the background went away", () => {
    startWith("<p>Hello</p>");
    show("p");
    expect(background.permit()?.segments).toHaveLength(1);

    background.close();

    // A new port, and the paragraph is in line again.
    expect(background.connections).toBe(2);
    background.configure();
    const again = background.permit();
    expect(again?.segments).toEqual([{ id: 1, text: "Hello" }]);
    background.answer(again, ["안녕"]);
    expect(document.body.innerHTML).toBe("<p>안녕</p>");
  });

  it("holds back for a while when the provider says to slow down", async () => {
    vi.useFakeTimers();
    startWith("<p>Hello</p>");
    show("p");
    background.fail(background.permit(), "rate_limit");
    expect(background.permits()).toBe(1);
    // Still on its way, as far as the page can tell.
    expect(pending).toEqual(new Set(["Hello"]));
    expect(status?.problem).toBeUndefined();

    await vi.advanceTimersByTimeAsync(5000);

    expect(background.permits()).toBe(2);
    background.answer(background.permit(), ["안녕"]);
    expect(document.body.innerHTML).toBe("<p>안녕</p>");
  });

  it("stops and says so when the provider fails twice, until told to go on", async () => {
    vi.useFakeTimers();
    startWith("<p>Hello</p>");
    show("p");
    background.fail(background.permit(), "network");
    await vi.advanceTimersByTimeAsync(5000);
    background.fail(background.permit(), "network");

    expect(status).toMatchObject({ active: true, problem: "network" });
    expect(pending).toEqual(new Set());
    await vi.advanceTimersByTimeAsync(60_000);
    expect(background.permits()).toBe(2);

    translator.retry();

    expect(status?.problem).toBeUndefined();
    expect(pending).toEqual(new Set(["Hello"]));
    background.answer(background.permit(), ["안녕"]);
    expect(document.body.innerHTML).toBe("<p>안녕</p>");
  });

  it("stops at once when there is no usable API key", async () => {
    startWith('<p id="a">Hello</p><p id="b">Bye</p>', { batchChars: 1 });
    show("#a, #b");
    expect(pending).toEqual(new Set(["Hello", "Bye"]));

    background.fail(background.permit(), "missing_key");

    // Nothing is left looking as if it were on its way.
    expect(status).toMatchObject({ active: true, problem: "missing_key" });
    expect(pending).toEqual(new Set());
    await settle();
    expect(progress).toMatchObject({ pending: 0, failed: 0 });

    // With a key in place, it goes on with both paragraphs.
    translator.retry();
    expect(pending).toEqual(new Set(["Hello", "Bye"]));
    background.answer(background.permit(), ["안녕"]);
    expect(document.querySelector("#a")?.textContent).toBe("안녕");
  });

  it("goes on with the rest of the page when the model declines a paragraph", () => {
    startWith('<p id="a">Hello</p><p id="b">Bye</p>', { batchChars: 1 });
    show("#a, #b");

    background.fail(background.permit(), "refusal");

    expect(status?.problem).toBeUndefined();
    background.answer(background.permit(), ["잘 가"]);
    expect(document.body.innerHTML).toBe(
      '<p id="a">Hello</p><p id="b">잘 가</p>',
    );
  });

  it("gives up when the background keeps going away", () => {
    startWith("<p>Hello</p>");
    show("p");
    for (let closing = 0; closing < 4; closing++) {
      background.permit();
      background.close();
    }
    expect(status).toMatchObject({ active: true, problem: "interrupted" });
    expect(pending).toEqual(new Set());
  });

  it("says what it was told when it starts, and that it stopped", () => {
    page("<p>Hello</p>");
    translator.start();
    expect(status).toEqual({ active: true });

    background.configure();
    expect(status).toMatchObject({
      active: true,
      config: { targetLanguage: "ko", provider: "Anthropic" },
    });

    translator.stop();
    expect(status).toEqual({ active: false });
  });

  it("tells the page which text is waiting for its translation", () => {
    startWith('<p id="a">Hello</p><p id="b">Bye</p><p id="c">Far</p>', {
      batchChars: 1,
    });
    show("#a, #b");
    expect(pending).toEqual(new Set(["Hello", "Bye"]));

    // One is sent and one still waits its turn: both count as on their way.
    const request = background.permit();
    expect(pending).toEqual(new Set(["Hello", "Bye"]));

    background.answer(request, ["안녕"]);
    expect(pending).toEqual(new Set(["Bye"]));

    hide("#b");
    expect(pending).toEqual(new Set());

    show("#b");
    translator.stop();
    expect(pending).toEqual(new Set());
  });

  it("says so when the extension is gone", () => {
    page("<p>Hello</p>");
    background.refuseConnections();
    translator.start();
    expect(background.connections).toBe(0);
    expect(document.body.innerHTML).toBe("<p>Hello</p>");
    expect(status).toMatchObject({ active: true, problem: "updated" });
  });

  it("puts the page back when it stops, and remembers the translations", async () => {
    const source = '<p>Read <a href="/x">this</a> now</p><p>Bye</p>';
    startWith(source);
    const link = document.querySelector("a");
    show("p");
    background.answer(background.permit(), [
      "지금 <g1>이것</g1>을 읽어라",
      "안녕",
    ]);
    const translated = document.body.innerHTML;
    expect(translated).not.toBe(source);

    translator.stop();
    expect(document.body.innerHTML).toBe(source);
    expect(document.querySelector("a")).toBe(link);
    expect(translator.active).toBe(false);

    // Turned on again: no request is needed for what was translated before.
    const requests = background.sent.length;
    translator.start();
    background.configure();
    show("p");
    await settle();
    expect(document.body.innerHTML).toBe(translated);
    expect(background.sent.length).toBe(requests);
    expect(progress).toMatchObject({ translated: 2, reused: 2 });
  });

  it("leaves code blocks and its own interface alone", () => {
    startWith(
      "<p>Text</p><pre><code>let a = 1;</code></pre><lingo-ui>Panel</lingo-ui>",
    );
    show("p, pre, code, lingo-ui");
    expect(background.permit()?.segments).toEqual([{ id: 1, text: "Text" }]);
  });
});
