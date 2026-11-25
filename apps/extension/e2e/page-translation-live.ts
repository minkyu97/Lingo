/**
 * Live check of page translation: real pages, translated by a real model.
 *
 * It needs your own API key and costs money, so it is run by hand and never
 * in CI. The fake server must not be running, because this script takes its
 * place:
 *
 *   pnpm live:page-translation \
 *     [--provider anthropic] [--model claude-haiku-5-5] [--language ko] \
 *     [--scrolls 3] [--click selector] [--keep-link-text] \
 *     [--out test-results/page-translation-live] [url ...]
 *
 * The end-to-end build sends its requests to a local address. This script
 * listens there and relays them to the provider, adding the API key from
 * ANTHROPIC_API_KEY or OPENAI_API_KEY. The key never enters the browser.
 *
 * For each page it reports how much was translated, whether the model kept
 * the inline tags, what the requests cost in tokens and time, and whether
 * links, code, and the restored page came through unchanged.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type MarkupNode, parseMarkup } from "@lingo/core";
import { chromium, type Page, type Worker } from "@playwright/test";

const PORT = 43117;
const EXTENSION = fileURLToPath(
  new URL("../.output/chrome-mv3-e2e", import.meta.url),
);

const DEFAULT_URLS = [
  "https://en.wikipedia.org/wiki/Translation",
  "https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch",
  "https://news.ycombinator.com/item?id=8863",
  "https://react.dev/learn",
];

const { values: flags, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: "string", default: "anthropic" },
    model: { type: "string", default: "claude-haiku-5-5" },
    language: { type: "string", default: "ko" },
    scrolls: { type: "string", default: "3" },
    out: { type: "string", default: "test-results/page-translation-live" },
    "keep-link-text": { type: "boolean", default: false },
    /** A selector to click once the page is translated. */
    click: { type: "string" },
    "requests-per-second": { type: "string", default: "3" },
  },
});
const urls = positionals.length > 0 ? positionals : DEFAULT_URLS;

// ---- The relay --------------------------------------------------------------

const UPSTREAMS: Record<
  string,
  { origin: string; headers(key: string): Record<string, string>; key?: string }
> = {
  "/v1/messages": {
    origin: "https://api.anthropic.com",
    headers: (key) => ({ "x-api-key": key }),
    key: process.env.ANTHROPIC_API_KEY,
  },
  "/v1/responses": {
    origin: "https://api.openai.com",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    key: process.env.OPENAI_API_KEY,
  },
};

/** Request headers that are passed on. The API key is not among them. */
const PASSED_ON = ["content-type", "anthropic-version", "anthropic-beta"];

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

interface Exchange {
  status: number;
  segments: { id: number; text: string }[];
  /** The text the model wrote, put together from the stream. */
  answer: string;
  inputTokens: number;
  outputTokens: number;
  /** Until the first translated segment was complete, and until the end. */
  firstSegmentMs: number;
  totalMs: number;
}

let exchanges: Exchange[] = [];

const SEGMENT = /<seg id="(\d+)">([\s\S]*?)<\/seg>/g;

function segmentsOf(text: string) {
  return [...text.matchAll(SEGMENT)].map((match) => ({
    id: Number(match[1]),
    text: match[2] ?? "",
  }));
}

/** Reads the text and the token counts out of either provider's stream. */
function readStream(stream: string) {
  let answer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  for (const line of stream.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    const delta = data.delta as { text?: string } | string | undefined;
    if (data.type === "content_block_delta" && typeof delta === "object") {
      answer += delta.text ?? "";
    }
    if (
      data.type === "response.output_text.delta" &&
      typeof delta === "string"
    ) {
      answer += delta;
    }
    const usage = (data.usage ??
      (data.message as { usage?: unknown } | undefined)?.usage ??
      (data.response as { usage?: unknown } | undefined)?.usage) as
      | { input_tokens?: number; output_tokens?: number }
      | undefined;
    inputTokens = Math.max(inputTokens, usage?.input_tokens ?? 0);
    outputTokens = Math.max(outputTokens, usage?.output_tokens ?? 0);
  }
  return { answer, inputTokens, outputTokens };
}

const relay = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS).end();
    return;
  }
  const upstream = UPSTREAMS[url.pathname];
  if (request.method !== "POST" || !upstream?.key) {
    response.writeHead(404, CORS).end();
    return;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks).toString("utf8");
  const sent = JSON.parse(body) as {
    messages?: { content: string }[];
    input?: { content: string }[];
  };
  const message = (sent.messages ?? sent.input)?.[0]?.content ?? "";

  const headers: Record<string, string> = upstream.headers(upstream.key);
  for (const name of PASSED_ON) {
    const value = request.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const started = performance.now();
  const answer = await fetch(`${upstream.origin}${url.pathname}${url.search}`, {
    method: "POST",
    headers,
    body,
  });
  response.writeHead(answer.status, {
    ...CORS,
    "content-type": answer.headers.get("content-type") ?? "text/plain",
  });

  let stream = "";
  let firstSegmentMs = 0;
  const decoder = new TextDecoder();
  for await (const chunk of answer.body ?? []) {
    response.write(chunk);
    stream += decoder.decode(chunk as Uint8Array, { stream: true });
    // The stream is JSON, in which a quote or a slash may be escaped.
    if (firstSegmentMs === 0 && /<\\?\/seg>/.test(stream)) {
      firstSegmentMs = performance.now() - started;
    }
  }
  response.end();
  if (answer.status !== 200) {
    console.log(
      `  ! the provider answered ${answer.status}: ${stream.slice(0, 300)}`,
    );
  }
  exchanges.push({
    status: answer.status,
    segments: segmentsOf(message),
    ...readStream(stream),
    firstSegmentMs,
    totalMs: performance.now() - started,
  });
});

// ---- Checking what the model wrote ---------------------------------------

/** Which tags a segment has, and which tag each one is inside of. */
function tagLayout(
  nodes: MarkupNode[],
  parent = 0,
  layout = new Map<string, number>(),
) {
  for (const node of nodes) {
    if (node.type === "text") continue;
    const name = `${node.type}${node.id}`;
    // A tag that is there twice gets a name of its own, so it shows up.
    layout.set(layout.has(name) ? `${name} (again)` : name, parent);
    if (node.type === "group") tagLayout(node.children, node.id, layout);
  }
  return layout;
}

function sameTags(source: string, translation: string): boolean {
  const before = parseMarkup(source);
  const after = parseMarkup(translation);
  if (!before || !after) return false;
  const expected = tagLayout(before);
  const actual = tagLayout(after);
  if (expected.size !== actual.size) return false;
  for (const [name, parent] of expected) {
    if (actual.get(name) !== parent) return false;
  }
  return true;
}

const hasTags = (text: string) => /<[gkx]\d+/.test(text);

function summarize(done: Exchange[]) {
  let segments = 0;
  let tagged = 0;
  let unanswered = 0;
  const broken: { source: string; translation: string }[] = [];
  for (const exchange of done) {
    const answers = new Map(
      segmentsOf(exchange.answer).map((segment) => [segment.id, segment.text]),
    );
    for (const segment of exchange.segments) {
      segments += 1;
      if (hasTags(segment.text)) tagged += 1;
      const translation = answers.get(segment.id);
      if (translation === undefined) unanswered += 1;
      else if (!sameTags(segment.text, translation)) {
        broken.push({ source: segment.text, translation });
      }
    }
  }
  const sum = (pick: (exchange: Exchange) => number) =>
    done.reduce((total, exchange) => total + pick(exchange), 0);
  const middle = (values: number[]) =>
    values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  return {
    requests: done.length,
    failedRequests: done.filter((exchange) => exchange.status !== 200).length,
    segments,
    segmentsWithTags: tagged,
    unanswered,
    brokenTags: broken.length,
    inputTokens: sum((exchange) => exchange.inputTokens),
    outputTokens: sum((exchange) => exchange.outputTokens),
    medianFirstSegmentMs: Math.round(
      middle(done.map((exchange) => exchange.firstSegmentMs)),
    ),
    medianTotalMs: Math.round(middle(done.map((exchange) => exchange.totalMs))),
    broken,
  };
}

// ---- The browser ------------------------------------------------------------

interface ExtensionApi {
  tabs: {
    query(filter: object): Promise<{ id?: number }[]>;
    sendMessage(tabId: number, message: unknown): Promise<unknown>;
  };
  storage: { local: { set(items: object): Promise<void> } };
}

interface Progress {
  active: boolean;
  units: number;
  translated: number;
  pending: number;
  failed: number;
  requests: number;
  reused: number;
  failures: Record<string, number>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function toggle(page: Page, worker: Worker) {
  await page.bringToFront();
  await worker.evaluate(async () => {
    const { tabs } = (globalThis as unknown as { chrome: ExtensionApi }).chrome;
    const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error("No tab is in front");
    await tabs.sendMessage(tab.id, { type: "toggle-page-translation" });
  });
}

const progressOf = (page: Page): Promise<Progress | undefined> =>
  page.evaluate(() => {
    const value = document.documentElement.dataset.lingoPageTranslation;
    return value ? JSON.parse(value) : undefined;
  });

/** Waits until nothing has been waiting for a request for a moment. */
async function settle(page: Page) {
  const deadline = Date.now() + 120_000;
  let quietSince = 0;
  while (Date.now() < deadline) {
    const progress = await progressOf(page);
    const quiet = progress !== undefined && progress.pending === 0;
    if (!quiet) quietSince = 0;
    else if (quietSince === 0) quietSince = Date.now();
    else if (Date.now() - quietSince > 1500) return;
    await sleep(250);
  }
  console.log("  ! still translating after two minutes");
}

/** What must be the same before and after: links, code, and visible text. */
const facts = (page: Page) =>
  page.evaluate(() => {
    const hangul = /[\uAC00-\uD7A3]/;
    const visible: string[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue?.trim() ?? "";
      const parent = node.parentElement;
      if (!/\p{L}{2}/u.test(text) || !parent) continue;
      // Code is not translated, so it does not count as text to translate.
      if (parent.closest("script, style, noscript, pre, code, lingo-ui")) {
        continue;
      }
      const rect = parent.getBoundingClientRect();
      const onScreen =
        rect.width > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
      if (onScreen) visible.push(text);
    }
    return {
      links: [...document.querySelectorAll("a[href]")]
        .map((link) => link.getAttribute("href"))
        .sort()
        .join("\n"),
      code: [...document.querySelectorAll("pre")]
        .map((block) => block.textContent)
        .join("\n---\n"),
      text: document.body.textContent,
      // These two hold on a page that changes by itself, where a comparison
      // of before and after does not.
      codeInKorean: [...document.querySelectorAll("pre, code")].filter((code) =>
        hangul.test(code.textContent ?? ""),
      ).length,
      korean: (document.body.textContent?.match(/[\uAC00-\uD7A3]/g) ?? [])
        .length,
      onScreen: visible.length,
      onScreenInKorean: visible.filter((text) => hangul.test(text)).length,
    };
  });

async function run() {
  mkdirSync(flags.out, { recursive: true });
  await new Promise<void>((resolve) =>
    relay.listen(PORT, "127.0.0.1", resolve),
  );

  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    viewport: { width: 1280, height: 800 },
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
    ],
  });
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await worker.evaluate(
    async ({ provider, model, language, pageTranslation }) => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi })
        .chrome;
      await storage.local.set({
        // The relay puts the real key in. The browser only has this one.
        apiKeys: { [provider]: "set-by-the-relay" },
        settings: {
          provider,
          models: { [provider]: model },
          targetLanguage: language,
          contextAwareness: true,
          maxContextChars: 1000,
        },
        pageTranslation,
      });
    },
    {
      provider: flags.provider,
      model: flags.model,
      language: flags.language,
      pageTranslation: {
        keepLinkText: flags["keep-link-text"],
        requestsPerSecond: Number(flags["requests-per-second"]),
      },
    },
  );

  console.log(`${flags.provider} / ${flags.model} into ${flags.language}\n`);
  for (const [index, url] of urls.entries()) {
    console.log(url);
    exchanges = [];
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await page.goto(url, { waitUntil: "load", timeout: 60_000 });
      await page.locator("lingo-ui").waitFor({ state: "attached" });
      // Give the page's own scripts time to finish building it.
      await sleep(2500);
      const errorsBefore = errors.length;
      const before = await facts(page);
      const shot = (name: string) =>
        page.screenshot({ path: `${flags.out}/${index + 1}-${name}.png` });
      await shot("0-original");

      const started = Date.now();
      await toggle(page, worker);
      await settle(page);
      const firstScreenMs = Date.now() - started - 1500;
      await shot("1-translated");
      const top = await facts(page);

      for (let scroll = 1; scroll <= Number(flags.scrolls); scroll++) {
        await page.mouse.wheel(0, 700);
        await sleep(400);
        await settle(page);
        if (scroll === 1) await shot("2-scrolled");
      }
      const after = await facts(page);

      // Follow a link inside the page, as on a site that swaps its content
      // without loading a new page.
      let afterClick: string | undefined;
      if (flags.click) {
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.locator(flags.click).first().click();
        await sleep(1500);
        await settle(page);
        await shot("2-clicked");
        const clicked = await facts(page);
        afterClick = `${clicked.onScreenInKorean} of ${clicked.onScreen} pieces of text in Korean at ${page.url()}`;
      }
      const progress = await progressOf(page);
      const summary = summarize(exchanges);

      await toggle(page, worker);
      await sleep(500);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(500);
      await shot("3-restored");
      const restored = await facts(page);

      // Everything that was sent and answered, to look into afterwards.
      writeFileSync(
        `${flags.out}/${index + 1}-exchanges.json`,
        JSON.stringify(exchanges, null, 2),
      );
      const { broken, ...numbers } = summary;
      console.log({
        firstScreenMs,
        onScreenInKorean: `${top.onScreenInKorean} of ${top.onScreen} pieces of text`,
        progress,
        ...numbers,
        afterClick,
        linksUnchanged: after.links === before.links,
        codeUnchanged: after.code === before.code,
        codeBlocksInKorean: `${after.codeInKorean} (${before.codeInKorean} before)`,
        restoredTextUnchanged: restored.text === before.text,
        koreanLettersAfterRestore: `${restored.korean} (${before.korean} before, ${after.korean} translated)`,
        pageErrorsWhileTranslated: errors.slice(errorsBefore),
      });
      for (const example of broken.slice(0, 5)) {
        console.log("  broken tags:");
        console.log(`    source:      ${example.source.slice(0, 400)}`);
        console.log(`    translation: ${example.translation.slice(0, 400)}`);
      }
    } catch (error) {
      console.log(`  ! ${String(error).slice(0, 300)}`);
    }
    await page.close();
    console.log();
  }

  await context.close();
  relay.close();
}

await run();
