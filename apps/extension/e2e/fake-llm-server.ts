/**
 * Stands in for the provider APIs in end-to-end tests. It also serves the
 * page the tests select text on.
 *
 * - `GET /v1/models` is what a key check calls. It accepts any key except
 *   the ones in `KEY_CHECKS`, which stand for the ways a check can go wrong.
 * - `POST /v1/messages` and `POST /v1/responses` stream a recorded answer
 *   from `spec/fixtures`: a dictionary entry as JSON when the request asks
 *   for a JSON schema, plain text otherwise. A key of `revoked-key` gets a
 *   401 here, like a key that passed its check and was withdrawn later.
 * - `GET /requests` returns every request body received so far, so a test can
 *   check what the extension sent. `DELETE /requests` clears the list.
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

/** A model list in a shape both the Anthropic and the OpenAI SDK accept. */
const MODELS = {
  object: "list",
  data: [{ id: "test-model", type: "model", object: "model" }],
  has_more: false,
  first_id: "test-model",
  last_id: "test-model",
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

interface RecordedRequest {
  path: string;
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
    response.writeHead(200, json).end(JSON.stringify(MODELS));
    return;
  }

  const streams = STREAMS[path];
  if (request.method === "POST" && streams) {
    const body: unknown = JSON.parse(await readBody(request));
    requests.push({ path, body });

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
