/**
 * Translating a whole page: only what is near the viewport, more as the page
 * is scrolled or grows, and all of it undone on request. The fake server
 * "translates" by putting words in upper case.
 */
import type { BrowserContext, Page, Worker } from "@playwright/test";
import {
  expect,
  openTestPage,
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
  failures: Record<string, number>;
}

/** Stores an API key and the page translation options, as settings would. */
async function configure(worker: Worker, options: object = {}) {
  await worker.evaluate(async (pageTranslation) => {
    const { storage } = (globalThis as unknown as { chrome: ExtensionApi })
      .chrome;
    await storage.local.set({
      apiKeys: { anthropic: "test-key" },
      pageTranslation,
    });
  }, options);
}

/** Does what the keyboard shortcut does, in the tab in front. */
async function toggleTranslation(worker: Worker) {
  await worker.evaluate(async () => {
    const { tabs } = (globalThis as unknown as { chrome: ExtensionApi }).chrome;
    const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined) throw new Error("No tab is in front");
    await tabs.sendMessage(tab.id, { type: "toggle-page-translation" });
  });
}

async function openLongPage(context: BrowserContext, worker: Worker) {
  const page = await openTestPage(context, "/long-page");
  await waitUntilListening(page, worker);
  return page;
}

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
  await configure(worker, { aheadViewports: 1 });
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

  // A translation whose tags do not fit is not used.
  expect(await text(page, "#broken")).toBe(
    "This one comes back (broken) with its tags lost.",
  );
  expect((await progress(page))?.failures).toEqual({ missing: 1 });
});

test("can leave the text of links as it is", async ({ context, worker }) => {
  await configure(worker, { keepLinkText: true });
  const page = await openLongPage(context, worker);

  await toggleTranslation(worker);
  await expectSettled(page);

  expect(await text(page, "#link")).toBe("a link");
  expect(await text(page, "#bold")).toBe("BOLD WORDS");
  expect(await page.locator("#link").getAttribute("href")).toBe("/page");
});

test("sends no more requests per second than the settings allow", async ({
  context,
  worker,
}) => {
  // One paragraph per request, and enough of them near to need many.
  await configure(worker, {
    requestsPerSecond: 2,
    batchChars: 1,
    aheadViewports: 2,
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
  // Only the paragraph whose answer was unusable is asked for again: once
  // with whatever else is waiting, and once on its own.
  expect((await recordedRequests(page)).length).toBe(requests + 2);
});
