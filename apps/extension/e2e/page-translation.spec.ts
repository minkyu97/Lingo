/**
 * Translating a whole page: only what is near the viewport, more as the page
 * is scrolled or grows, and all of it undone on request. The fake server
 * "translates" by putting words in upper case.
 */
import type { BrowserContext, Page, Worker } from "@playwright/test";
import {
  addEngine,
  drawer,
  expect,
  openTestPage,
  pressToolbarButton,
  recordedRequests,
  type TabsApi,
  test,
  waitUntilListening,
} from "./extension.ts";

interface StorageApi {
  local: { set(items: object): Promise<void> };
}

interface ExtensionApi {
  tabs: TabsApi;
  storage: StorageApi;
}

interface Progress {
  active: boolean;
  units: number;
  translated: number;
  pending: number;
  failed: number;
  requests: number;
  reused: number;
  lossy: number;
  failures: Record<string, number>;
}

interface Configuration {
  /** How page translation is tuned, to make a small page act like a large one. */
  tuning?: object;
  /** Settings to store over the ones a test starts with. */
  settings?: object;
  /** `false` starts without an engine, as right after an install. */
  engine?: false;
}

/**
 * Puts into storage what a test needs to be there before it starts: one
 * engine with its key, unless told otherwise.
 */
async function configure(
  worker: Worker,
  { tuning = {}, settings = {}, engine }: Configuration = {},
) {
  const engines =
    engine === false
      ? []
      : [{ id: "opus", provider: "anthropic", model: "claude-opus-5-5" }];
  await worker.evaluate(
    async (items) => {
      const { storage } = (globalThis as unknown as { chrome: ExtensionApi })
        .chrome;
      await storage.local.set(items);
    },
    {
      pageTranslation: tuning,
      settings: { engines, ...settings },
      engineKeys: engine === false ? {} : { opus: "test-key" },
    },
  );
}

/**
 * Asks the top frame of the tab in front to turn page translation on or
 * off, as the background does when the keyboard shortcut is pressed.
 */
async function toggleTranslation(worker: Worker) {
  await worker.evaluate(async () => {
    const { tabs } = (globalThis as unknown as { chrome: ExtensionApi }).chrome;
    const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error("No tab is in front");
    await tabs.sendMessage(tab.id, {
      type: "page-translation",
      action: "toggle",
    });
  });
}

/** The bar at the bottom of a page that is being translated. */
const pageBar = (page: Page) =>
  page.getByRole("region", { name: "Lingo page translation" });

async function openLongPage(
  context: BrowserContext,
  worker: Worker,
  path = "/long-page",
) {
  const page = await openTestPage(context, path);
  await waitUntilListening(page, worker);
  return page;
}

/**
 * The gray bars over text that is waiting for its translation: how many
 * stretches of text they cover, and whether they cover the given element.
 */
const placeholders = (page: Page, selector: string) =>
  page.evaluate((target) => {
    const element = document.querySelector(target);
    const ranges = [...CSS.highlights]
      .filter(([name]) => name.startsWith("lingo-placeholder-"))
      .flatMap(([, highlight]) => [...highlight] as Range[]);
    return {
      stretches: ranges.length,
      covers:
        element !== null &&
        ranges.some((range) => range.intersectsNode(element)),
      styleSheets: document.adoptedStyleSheets.length,
    };
  }, selector);

const progress = (page: Page): Promise<Progress | undefined> =>
  page.evaluate(() => {
    const value = document.documentElement.dataset.lingoPageTranslation;
    return value ? JSON.parse(value) : undefined;
  });

/** Waits until every request has been answered and nothing waits for one. */
async function expectSettled(page: Page) {
  await expect
    .poll(async () => {
      const now = await progress(page);
      return now !== undefined && now.translated > 0 && now.pending === 0;
    })
    .toBe(true);
}

const text = (page: Page, selector: string) =>
  page.locator(selector).first().textContent();

test("translates what is near the viewport, and more when scrolled", async ({
  context,
  worker,
}) => {
  await configure(worker, { tuning: { aheadViewports: 1 } });
  const page = await openLongPage(context, worker);

  await toggleTranslation(worker);
  await expectSettled(page);

  expect(await text(page, "h1")).toBe("LONG PAGE");
  expect(await text(page, "#p1")).toBe("PARAGRAPH 1 OF THE LONG PAGE.");
  // One screen below the fold is translated ahead of time.
  const ahead = await page.evaluate(() => {
    const below = (id: string) =>
      (document.querySelector(id)?.getBoundingClientRect().top ?? 0) -
      window.innerHeight;
    return { p5: below("#p5"), p20: below("#p20") };
  });
  expect(ahead.p5).toBeGreaterThan(0);
  expect(ahead.p5).toBeLessThan(720);
  expect(await text(page, "#p5")).toBe("PARAGRAPH 5 OF THE LONG PAGE.");
  // Further down, nothing was sent.
  expect(ahead.p20).toBeGreaterThan(720);
  expect(await text(page, "#p20")).toBe("Paragraph 20 of the long page.");
  expect(await text(page, "#p60")).toBe("Paragraph 60 of the long page.");
  const sentBefore = (await recordedRequests(page)).flatMap(
    (request) => request.body.messages?.[0]?.content ?? "",
  );
  expect(sentBefore.join("\n")).not.toContain("Paragraph 20 of");

  // Jump to the end. What is there is translated; what was skipped is not.
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect(page.locator("#p60")).toHaveText(
    "PARAGRAPH 60 OF THE LONG PAGE.",
  );
  await expectSettled(page);
  expect(await text(page, "#p30")).toBe("Paragraph 30 of the long page.");

  // Scrolling back to it translates it.
  await page.locator("#p30").scrollIntoViewIfNeeded();
  await expect(page.locator("#p30")).toHaveText(
    "PARAGRAPH 30 OF THE LONG PAGE.",
  );
});

test("keeps styles, links, and listeners, and leaves code alone", async ({
  context,
  worker,
}, testInfo) => {
  await configure(worker);
  const page = await openLongPage(context, worker);

  const STYLED = ["#bold", "#italic", "#underlined", "#big", "#link"];
  const styles = () =>
    page.evaluate((selectors) => {
      const read = (selector: string) => {
        const style = getComputedStyle(
          document.querySelector(selector) as Element,
        );
        return [
          style.fontSize,
          style.fontWeight,
          style.fontStyle,
          style.color,
          style.backgroundColor,
          style.textDecorationLine,
        ].join(" | ");
      };
      return selectors.map(read);
    }, STYLED);
  const before = await styles();
  // Marks the elements, to tell later whether they are still the same ones.
  await page.evaluate((selectors) => {
    for (const selector of selectors) {
      (document.querySelector(selector) as Element & { mark?: string }).mark =
        selector;
    }
  }, STYLED);
  await page.screenshot({ path: testInfo.outputPath("before.png") });

  await toggleTranslation(worker);
  await expectSettled(page);
  await page.screenshot({ path: testInfo.outputPath("after.png") });

  // The link moved to the front, as a translation moves words around.
  expect(await text(page, "#styled")).toBe(
    "A LINK PLAIN WORDS, BOLD WORDS, ITALIC WORDS, UNDERLINED WORDS, BIG RED WORDS, AND .",
  );
  expect(await text(page, "#bold")).toBe("BOLD WORDS");
  expect(await text(page, "#big")).toBe("BIG RED WORDS");
  expect(await styles()).toEqual(before);
  expect(before[3]).toBe(
    "24px | 400 | normal | rgb(200, 0, 0) | rgb(255, 240, 150) | none",
  );

  // The same elements, so the page's own listener on the link still runs.
  const marks = await page.evaluate(
    (selectors) =>
      selectors.map(
        (selector) =>
          (document.querySelector(selector) as Element & { mark?: string })
            .mark,
      ),
    STYLED,
  );
  expect(marks).toEqual(STYLED);
  expect(await page.locator("#link").getAttribute("href")).toBe("/page");
  await page.locator("#link").click();
  expect(
    await page.evaluate(() => (window as { clicks?: number }).clicks),
  ).toBe(1);

  // Code is not translated: neither a block, nor code inside a sentence.
  expect(await text(page, "#code")).toBe(
    "const total = add(1, 2); // adds numbers",
  );
  expect(await text(page, "#inline-code")).toBe(
    "CALL fetchData() BEFORE RENDERING.",
  );
  const sent = (await recordedRequests(page))
    .flatMap((request) => request.body.messages?.[0]?.content ?? "")
    .join("\n");
  expect(sent).not.toContain("const total");
  expect(sent).toContain("Call <k1>fetchData()</k1> before rendering.");

  // A translation that comes back twice without its tags is shown without
  // the formatting they stood for. The element is still in the page.
  expect(await text(page, "#broken")).toBe(
    "THIS ONE COMES BACK (BROKEN) WITH ITS TAGS LOST.",
  );
  expect(await text(page, "#broken b")).toBe("");
  expect(await progress(page)).toMatchObject({ lossy: 1, failed: 0 });
});

test("shows gray bars over text that is waiting for its translation", async ({
  context,
  worker,
}, testInfo) => {
  await configure(worker);
  const page = await openLongPage(context, worker, "/slow-page");
  expect(await placeholders(page, "#p1")).toMatchObject({ stretches: 0 });

  await toggleTranslation(worker);

  // What is near the viewport is covered, and what is far away is not.
  await expect
    .poll(async () => (await placeholders(page, "#p1")).covers)
    .toBe(true);
  expect((await placeholders(page, "#p60")).covers).toBe(false);
  expect((await placeholders(page, "#code")).covers).toBe(false);
  expect(await text(page, "#p1")).toBe("Paragraph 1 of the long page.");
  await page.screenshot({ path: testInfo.outputPath("waiting.png") });

  // The bars go as the translations come, and leave nothing behind.
  await expect(page.locator("#p1")).toHaveText("PARAGRAPH 1 OF THE LONG PAGE.");
  await expectSettled(page);
  expect(await placeholders(page, "#p1")).toEqual({
    stretches: 0,
    covers: false,
    styleSheets: 0,
  });
});

test("sends no more requests per second than the settings allow", async ({
  context,
  worker,
}) => {
  // One paragraph per request, and enough of them near to need many.
  await configure(worker, {
    settings: { pageRequestsPerSecond: 2 },
    tuning: { batchChars: 1, aheadViewports: 2 },
  });
  const page = await openLongPage(context, worker);

  await toggleTranslation(worker);
  await expect
    .poll(async () => (await recordedRequests(page)).length, {
      timeout: 15_000,
    })
    .toBeGreaterThanOrEqual(9);

  const times = (
    (await recordedRequests(page)) as unknown as { time: number }[]
  ).map((request) => request.time);
  // Any three requests in a row span at least a second, give or take the
  // time a request takes to arrive.
  for (let index = 2; index < times.length; index++) {
    const span = (times[index] ?? 0) - (times[index - 2] ?? 0);
    expect(span).toBeGreaterThan(900);
  }
});

test("translates what the page adds and rewrites", async ({
  context,
  worker,
}) => {
  await configure(worker);
  const page = await openLongPage(context, worker);
  await toggleTranslation(worker);
  await expectSettled(page);
  await expect(page.locator(".comment")).toHaveText(["FIRST COMMENT."]);

  // Like a page that loads more comments.
  await page.locator("#more").click();
  await expect(page.locator(".comment")).toHaveText([
    "FIRST COMMENT.",
    "COMMENT NUMBER 2 HAS EMPHASIS.",
    "COMMENT NUMBER 3 HAS EMPHASIS.",
    "COMMENT NUMBER 4 HAS EMPHASIS.",
  ]);
  await expect(page.locator(".comment em")).toHaveText([
    "EMPHASIS",
    "EMPHASIS",
    "EMPHASIS",
  ]);

  // Like a page that renders a paragraph again with other text.
  await expect(page.locator("#live")).toHaveText(
    "WORDS THE PAGE WILL REWRITE.",
  );
  await page.locator("#rewrite").click();
  await expect(page.locator("#live")).toHaveText("FRESH WORDS FROM THE PAGE.");
});

test("puts the page back exactly as it was", async ({ context, worker }) => {
  await configure(worker);
  const page = await openLongPage(context, worker);
  const original = await page.evaluate(() => document.body.innerHTML);
  await page.evaluate(() => {
    (document.querySelector("#link") as Element & { mark?: string }).mark =
      "same";
  });

  await toggleTranslation(worker);
  await expectSettled(page);
  expect(await page.evaluate(() => document.body.innerHTML)).not.toBe(original);

  await toggleTranslation(worker);
  await expect.poll(async () => (await progress(page))?.active).toBe(false);
  expect(await page.evaluate(() => document.body.innerHTML)).toBe(original);
  expect(
    await page.evaluate(
      () =>
        (document.querySelector("#link") as Element & { mark?: string }).mark,
    ),
  ).toBe("same");

  // Turning it on again costs nothing: the answers are remembered.
  const requests = (await recordedRequests(page)).length;
  await toggleTranslation(worker);
  await expect(page.locator("h1")).toHaveText("LONG PAGE");
  await expectSettled(page);
  expect(await text(page, "#p1")).toBe("PARAGRAPH 1 OF THE LONG PAGE.");
  expect((await recordedRequests(page)).length).toBe(requests);
});

test("is turned on from the panel, and off from the page bar", async ({
  context,
  worker,
  extensionId,
}, testInfo) => {
  await configure(worker);
  const page = await openLongPage(context, worker);
  await expect(pageBar(page)).toHaveCount(0);

  // The first row of the panel is about the page in front.
  await pressToolbarButton(page, extensionId);
  const panel = drawer(page);
  await expect(panel.getByText("Translate this page")).toBeVisible();
  await panel.getByRole("button", { name: "Translate", exact: true }).click();

  await expect(page.locator("h1")).toHaveText("LONG PAGE");
  await expect(panel.getByText("Translating into English")).toBeVisible();
  await expect(pageBar(page)).toContainText("Translating into English");
  await page.screenshot({ path: testInfo.outputPath("translated.png") });

  // The bar sits at the bottom center of the viewport.
  const box = await pageBar(page).boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("The page bar has no place");
  expect(box.x + box.width / 2).toBeCloseTo(viewport.width / 2, 0);
  expect(viewport.height - (box.y + box.height)).toBeCloseTo(20, 0);

  await pageBar(page).getByRole("button", { name: "Show original" }).click();

  await expect(page.locator("h1")).toHaveText("Long page");
  await expect(pageBar(page)).toHaveCount(0);
  // The panel heard of it too.
  await expect(panel.getByText("Translate this page")).toBeVisible();
});

test("says so in the page bar when there is no engine, and goes on once there is", async ({
  context,
  worker,
}, testInfo) => {
  await configure(worker, { engine: false });
  const page = await openLongPage(context, worker);

  await toggleTranslation(worker);

  await expect(pageBar(page)).toContainText(
    "Add a translation engine to translate pages",
  );
  // Nothing is left looking as if it were on its way.
  await expect
    .poll(async () => (await placeholders(page, "#p1")).stretches)
    .toBe(0);
  expect(await text(page, "h1")).toBe("Long page");
  await pageBar(page).screenshot({ path: testInfo.outputPath("no-key.png") });

  // The way out is one press away, and translation goes on by itself.
  await pageBar(page).getByRole("button", { name: "Open settings" }).click();
  const panel = drawer(page);
  await panel.getByRole("button", { name: /^Translation engines/ }).click();
  await addEngine(panel, { apiKey: "test-key" });

  await expect(page.locator("h1")).toHaveText("LONG PAGE");
  await expect(pageBar(page)).toContainText("Translating into English");
});

test("stops when the close button of a problem is pressed", async ({
  context,
  worker,
}) => {
  await configure(worker, { engine: false });
  const page = await openLongPage(context, worker);
  await toggleTranslation(worker);
  await expect(pageBar(page)).toContainText("Add a translation engine");

  await pageBar(page).getByRole("button", { name: "Stop translating" }).click();

  await expect(pageBar(page)).toHaveCount(0);
});

test("translates the frames inside a page along with it", async ({
  context,
  worker,
  extensionId,
}) => {
  await configure(worker);
  const page = await openTestPage(context, "/framed-page");
  await waitUntilListening(page, worker);
  const inner = page.frameLocator('iframe[title="Inner page"]');
  await expect(inner.locator("h1")).toHaveText("Test page");

  await pressToolbarButton(page, extensionId);
  await drawer(page)
    .getByRole("button", { name: "Translate", exact: true })
    .click();

  await expect(page.locator("h1")).toHaveText("OUTER PAGE");
  await expect(inner.locator("h1")).toHaveText("TEST PAGE");
  // One bar for the page, however many frames it has.
  await expect(pageBar(page)).toHaveCount(1);
  await expect(
    inner.getByRole("region", { name: "Lingo page translation" }),
  ).toHaveCount(0);

  await pageBar(page).getByRole("button", { name: "Show original" }).click();

  await expect(page.locator("h1")).toHaveText("Outer page");
  await expect(inner.locator("h1")).toHaveText("Test page");
});

test("uses the engine chosen for pages, and the request rate from the settings", async ({
  context,
  worker,
  extensionId,
}, testInfo) => {
  await configure(worker);
  const page = await openLongPage(context, worker);
  await pressToolbarButton(page, extensionId);
  const panel = drawer(page);
  const row = (name: RegExp) => panel.getByRole("button", { name });

  await expect(row(/^Translation engines/)).toContainText("1 engine");
  await expect(row(/^Request rate/)).toContainText("3 per second");
  await expect(row(/^Keyboard shortcuts/)).toBeVisible();

  // A second engine starts without a key, also for a provider that has one.
  await row(/^Translation engines/).click();
  await panel.getByRole("button", { name: "Add engine" }).click();
  await expect(panel.getByLabel("API key")).toHaveValue("");
  await page.screenshot({ path: testInfo.outputPath("add-engine.png") });
  await panel.getByRole("button", { name: "Back" }).click();
  await addEngine(panel, { apiKey: "test-key", model: "Claude Sonnet 5.5" });

  // Every task starts on the first engine. Pages get the new one.
  await expect(row(/^Page translation/)).toContainText("claude-opus-5-5");
  await row(/^Page translation/).click();
  await panel.getByRole("radio", { name: /Claude Sonnet 5.5/ }).check();
  await page.screenshot({ path: testInfo.outputPath("engine-for-pages.png") });
  await panel.getByRole("button", { name: "Back" }).click();
  await expect(row(/^Page translation/)).toContainText("Claude Sonnet 5.5");
  await expect(row(/^Translation/).first()).toContainText("claude-opus-5-5");
  await page.screenshot({ path: testInfo.outputPath("engines.png") });
  await panel.getByRole("button", { name: "Back" }).click();

  await row(/^Request rate/).click();
  await panel.getByRole("radio", { name: "7", exact: true }).check();
  // Any other rate can be typed in.
  await panel.getByRole("radio", { name: "Other…" }).check();
  await panel.getByRole("textbox", { name: "Requests per second" }).fill("25");
  await page.screenshot({ path: testInfo.outputPath("request-rate.png") });
  await panel.getByRole("button", { name: "Back" }).click();
  await expect(row(/^Request rate/)).toContainText("25 per second");

  // The page is translated by the engine chosen for pages.
  await panel.getByRole("button", { name: "Translate", exact: true }).click();
  await expect(page.locator("h1")).toHaveText("LONG PAGE");
  const [sent] = await recordedRequests(page);
  expect(sent?.body.model).toBe("claude-sonnet-5-5");
});
