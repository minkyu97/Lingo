/**
 * Stands in for the provider APIs in end-to-end tests. It also serves the
 * page the tests select text on.
 *
 * - `GET /v1/models` is what a key check calls, and it lists the models of
 *   the provider that asks. It accepts any key except the ones in
 *   `KEY_CHECKS`, which stand for the ways a check can go wrong.
 * - `POST /v1/messages` and `POST /v1/responses` stream a recorded answer
 *   from `spec/fixtures`: a dictionary entry as JSON when the request asks
 *   for a JSON schema, plain text otherwise. A key of `revoked-key` gets a
 *   401 here, like a key that passed its check and was withdrawn later.
 *   A request for a page translation, which holds `<seg>` elements, gets
 *   an answer made up on the spot by `pretendToTranslate`.
 * - `GET /page` is the page the tests select text on. `GET /strict-page` is
 *   the same page under a content security policy that forbids frames.
 *   `GET /long-page` is a page many screens long, for page translation.
 *   `GET /slow-page` is the same page under another title. Translations of
 *   it take a second and a half, long enough to see text waiting for one.
 *   `GET /framed-page` is a page that holds `/page` in a frame.
 * - `GET /requests` returns every request body received so far and when it
 *   came in, so a test can check what the extension sent. `DELETE /requests`
 *   clears the list.
 */
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";

const PORT = 43117;

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>A walk by the water</title>
    <style>body { font: 18px/1.6 sans-serif; margin: 60px; }</style>
  </head>
  <body>
    <h1>Test page</h1>
    <p id="text">She sat on the river bank and watched the boats.</p>
    <p>A second paragraph that is not part of the context.</p>
  </body>
</html>`;

const FILLER_PARAGRAPHS = 60;
const LONG_TITLE = "<title>A long page</title>";
const SLOW_TITLE = "<title>A slow page</title>";

/**
 * A page many screens long. It has text in several styles, a link, code, a
 * button that adds comments, and a button that rewrites a paragraph.
 */
const LONG_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    ${LONG_TITLE}
    <style>
      body { font: 16px/1.5 sans-serif; margin: 40px; }
      .filler p { height: 120px; margin: 0 0 20px; }
      .big {
        font-size: 24px;
        color: rgb(200, 0, 0);
        background-color: rgb(255, 240, 150);
      }
    </style>
  </head>
  <body>
    <h1>Long page</h1>
    <p id="styled">Plain words, <b id="bold">bold words</b>, <i id="italic">italic words</i>, <u id="underlined">underlined words</u>, <span id="big" class="big">big red words</span>, and <a id="link" href="/page">a link</a>.</p>
    <p id="inline-code">Call <code>fetchData()</code> before rendering.</p>
    <pre id="code"><code>const total = add(1, 2); // adds numbers</code></pre>
    <p id="broken">This one comes back (broken) with <b>its tags</b> lost.</p>
    <p id="live">Words the page will rewrite.</p>
    <button id="rewrite" type="button">Rewrite</button>
    <section id="comments">
      <h2>Comments</h2>
      <p class="comment">First comment.</p>
    </section>
    <button id="more" type="button">Show more comments</button>
    <div class="filler">
${Array.from(
  { length: FILLER_PARAGRAPHS },
  (_, index) =>
    `      <p id="p${index + 1}">Paragraph ${index + 1} of the long page.</p>`,
).join("\n")}
    </div>
    <script>
      document.querySelector("#more").addEventListener("click", () => {
        for (const number of [2, 3, 4]) {
          const comment = document.createElement("p");
          comment.className = "comment";
          comment.innerHTML =
            "Comment number " + number + " has <em>emphasis</em>.";
          document.querySelector("#comments").append(comment);
        }
      });
      document.querySelector("#rewrite").addEventListener("click", () => {
        document.querySelector("#live").firstChild.data =
          "Fresh words from the page.";
      });
      window.clicks = 0;
      document.querySelector("#link").addEventListener("click", (event) => {
        event.preventDefault();
        window.clicks += 1;
      });
    </script>
  </body>
</html>`;

const FRAMED_PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>A page with a frame</title>
  </head>
  <body>
    <h1>Outer page</h1>
    <iframe src="/page" title="Inner page" width="600" height="300"></iframe>
  </body>
</html>`;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
};

/** Keys that a check does not simply accept, and what happens instead. */
const KEY_CHECKS: Record<string, "reject" | "drop" | "delay"> = {
  "bad-key": "reject",
  // The connection closes without an answer, as when the provider is down.
  "offline-key": "drop",
  // Accepted, but slowly enough for a test to see the check in progress.
  "slow-key": "delay",
};

const everything = {
  effort: { supported: true },
  structured_outputs: { supported: true },
};

/** What Anthropic lists for a key: newest first, with what each accepts. */
const ANTHROPIC_MODELS = {
  data: [
    ["claude-fable-5-2", "Claude Fable 5.2"],
    ["claude-haiku-5-5", "Claude Haiku 5.5"],
    ["claude-sonnet-5-5", "Claude Sonnet 5.5"],
    ["claude-opus-5-5", "Claude Opus 5.5"],
  ].map(([id, display_name]) => ({
    type: "model",
    id,
    display_name,
    capabilities: everything,
  })),
  has_more: false,
  first_id: "claude-fable-5-2",
  last_id: "claude-opus-5-5",
};

/** What OpenAI lists: every kind of model, in no order, by ID only. */
const OPENAI_MODELS = {
  object: "list",
  data: [
    ["tts-1", 500],
    ["gpt-6-luna", 200],
    ["gpt-image-2", 400],
    ["gpt-6.2-sol", 300],
    ["text-embedding-3-large", 100],
  ].map(([id, created]) => ({
    id,
    created,
    object: "model",
    owned_by: "system",
  })),
};

const UNAUTHORIZED = {
  type: "error",
  error: { type: "authentication_error", message: "invalid key" },
};

/** Recorded answers per endpoint: plain text, and JSON held to a schema. */
const STREAMS: Record<string, { text: string; json: string }> = {
  "/v1/messages": {
    text: "anthropic-text.sse",
    json: "anthropic-define.sse",
  },
  "/v1/responses": { text: "openai-text.sse", json: "openai-define.sse" },
};

/** Whether a request body asks for JSON in a schema, in either API's shape. */
function asksForJson(body: unknown): boolean {
  const request = body as {
    output_config?: { format?: unknown };
    text?: { format?: unknown };
  };
  return Boolean(request.output_config?.format ?? request.text?.format);
}

const SEGMENT = /<seg id="(\d+)">([\s\S]*?)<\/seg>/g;
/** What stays as it is: kept text with its tags, other tags, and entities. */
const NOT_WORDS = /<k(\d+)>[\s\S]*?<\/k\1>|<\/?[gx]\d+\s*\/?>|&\w+;/g;
const GROUP_TAG = /<(\/?)g\d+>/g;

/** The user message of a request, in either API's shape. */
function userMessage(body: unknown): string {
  const request = body as {
    messages?: { content?: unknown }[];
    input?: { content?: unknown }[];
  };
  const content = (request.messages ?? request.input)?.[0]?.content;
  return typeof content === "string" ? content : "";
}

/**
 * Stands in for a translation, in a way a test can predict: the words are
 * put in upper case, and inline tags stay around their words. In a segment
 * with several tags at the top level, the last one moves to the front, as
 * word order does in a real translation. A segment that says "(broken)"
 * comes back without its tags, like a model that lost them.
 */
function pretendToTranslate(text: string): string {
  if (text.includes("(broken)")) {
    return text.replace(/<\/?[gkx]\d+\s*\/?>/g, "").toUpperCase();
  }

  let translated = "";
  let position = 0;
  for (const match of text.matchAll(NOT_WORDS)) {
    translated += text.slice(position, match.index).toUpperCase() + match[0];
    position = match.index + match[0].length;
  }
  translated += text.slice(position).toUpperCase();

  // Where each top-level group starts and ends.
  const groups: { start: number; end: number }[] = [];
  let depth = 0;
  let start = 0;
  for (const tag of translated.matchAll(GROUP_TAG)) {
    if (tag[1] === "") {
      if (depth === 0) start = tag.index;
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0) groups.push({ start, end: tag.index + tag[0].length });
    }
  }
  const last = groups.at(-1);
  if (!last || groups.length < 2) return translated;
  return `${translated.slice(last.start, last.end)} ${translated.slice(0, last.start)}${translated.slice(last.end)}`;
}

const sseEvent = (name: string, data: object) =>
  `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

/** An Anthropic stream that answers with the given pieces of text. */
function anthropicStream(pieces: string[]): string[] {
  return [
    sseEvent("message_start", {
      type: "message_start",
      message: {
        id: "msg_page",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    }),
    sseEvent("content_block_start", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    }),
    ...pieces.map((text) =>
      sseEvent("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      }),
    ),
    sseEvent("content_block_stop", { type: "content_block_stop", index: 0 }),
    sseEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 1 },
    }),
    sseEvent("message_stop", { type: "message_stop" }),
  ];
}

/** The stream that answers a page translation request, segment by segment. */
function pageTranslationStream(message: string): string[] {
  const pieces: string[] = [];
  for (const [, id, text = ""] of message.matchAll(SEGMENT)) {
    const answer = `<seg id="${id}">${pretendToTranslate(text)}</seg>\n`;
    // In two pieces, so that the reader has to put a segment together.
    const middle = Math.floor(answer.length / 2);
    pieces.push(answer.slice(0, middle), answer.slice(middle));
  }
  return anthropicStream(pieces);
}

interface RecordedRequest {
  path: string;
  /** When the request came in, in milliseconds since the epoch. */
  time: number;
  body: unknown;
}

let requests: RecordedRequest[] = [];

function fixture(name: string): string {
  const url = new URL(`../../../spec/fixtures/${name}`, import.meta.url);
  return readFileSync(url, "utf8");
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const json = { ...CORS, "content-type": "application/json" };
  const key = request.headers.authorization?.replace("Bearer ", "") ?? "";

  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS).end();
    return;
  }

  if (request.method === "GET" && path === "/page") {
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(PAGE);
    return;
  }

  if (request.method === "GET" && path === "/long-page") {
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(LONG_PAGE);
    return;
  }

  if (request.method === "GET" && path === "/framed-page") {
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(FRAMED_PAGE);
    return;
  }

  if (request.method === "GET" && path === "/slow-page") {
    response
      .writeHead(200, { "content-type": "text/html; charset=utf-8" })
      .end(LONG_PAGE.replace(LONG_TITLE, SLOW_TITLE));
    return;
  }

  // The same page, from a site that allows no frames and no outside content.
  if (request.method === "GET" && path === "/strict-page") {
    response
      .writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'self'; style-src 'unsafe-inline'; frame-src 'none'",
      })
      .end(PAGE);
    return;
  }

  if (path === "/requests") {
    if (request.method === "DELETE") requests = [];
    response.writeHead(200, json).end(JSON.stringify(requests));
    return;
  }

  if (request.method === "GET" && path === "/v1/models") {
    const outcome = KEY_CHECKS[key];
    if (outcome === "drop") {
      request.socket.destroy();
      return;
    }
    if (outcome === "reject") {
      response.writeHead(401, json).end(JSON.stringify(UNAUTHORIZED));
      return;
    }
    if (outcome === "delay") await sleep(1500);
    // Only Anthropic's client says which version of the API it speaks.
    const models = request.headers["anthropic-version"]
      ? ANTHROPIC_MODELS
      : OPENAI_MODELS;
    response.writeHead(200, json).end(JSON.stringify(models));
    return;
  }

  const streams = STREAMS[path];
  if (request.method === "POST" && streams) {
    const body: unknown = JSON.parse(await readBody(request));
    requests.push({ path, time: Date.now(), body });

    if (key === "revoked-key") {
      response.writeHead(401, json).end(JSON.stringify(UNAUTHORIZED));
      return;
    }

    response.writeHead(200, {
      ...CORS,
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
    });
    // Send one event at a time, so the extension sees a real stream.
    const message = userMessage(body);
    if (path === "/v1/messages" && message.includes("<seg id=")) {
      if (message.includes(SLOW_TITLE)) await sleep(1500);
      for (const part of pageTranslationStream(message)) {
        response.write(part);
        await sleep(2);
      }
      response.end();
      return;
    }
    const recorded = asksForJson(body) ? streams.json : streams.text;
    for (const event of fixture(recorded).split("\n\n")) {
      if (event.trim() === "") continue;
      response.write(`${event}\n\n`);
      await sleep(5);
    }
    response.end();
    return;
  }

  response.writeHead(404, CORS).end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fake LLM server listening on http://127.0.0.1:${PORT}`);
});
