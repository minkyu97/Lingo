/**
 * Drives the built extension in a real browser against the fake LLM server:
 * save a key in the options page, select text on a page, and read the answer
 * in the in-page panel.
 */
import { fileURLToPath } from "node:url";
import {
  type BrowserContext,
  test as base,
  chromium,
  expect,
  type Page,
  type Worker,
} from "@playwright/test";

const SERVER = "http://127.0.0.1:43117";
const EXTENSION = fileURLToPath(
  new URL("../.output/chrome-mv3-e2e", import.meta.url),
);

interface Fixtures {
  context: BrowserContext;
  worker: Worker;
  extensionId: string;
}

const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires a destructured first argument
  context: async ({}, use) => {
    // Extensions need a persistent context, and only the bundled Chromium
    // still loads unpacked ones from the command line.
    const context = await chromium.launchPersistentContext("", {
      channel: "chromium",
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
      ],
    });
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    await use(worker);
  },
  extensionId: async ({ worker }, use) => {
    await use(new URL(worker.url()).host);
  },
});

/** The part of the extension API the shortcut test calls inside the service worker. */
interface TabsApi {
  query(filter: object): Promise<{ id?: number }[]>;
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

interface RecordedRequest {
  path: string;
  body: {
    model: string;
    system?: string;
    instructions?: string;
    fallbacks?: string;
    messages?: { role: string; content: string }[];
    input?: { role: string; content: string }[];
    /** Anthropic's place for a JSON schema. */
    output_config?: { format?: { type: string } };
    /** OpenAI's place for a JSON schema. */
    text?: { format?: { type: string; name: string } };
  };
}

async function recordedRequests(page: Page): Promise<RecordedRequest[]> {
  return (await page.request.get(`${SERVER}/requests`)).json();
}

test.beforeEach(async ({ request }) => {
  await request.delete(`${SERVER}/requests`);
});

async function saveSettings(
  context: BrowserContext,
  extensionId: string,
  fill: (options: Page) => Promise<void>,
) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await fill(options);
  await options.getByRole("button", { name: "Save" }).click();
  await expect(options.getByText("Saved")).toBeVisible();
  return options;
}

const trigger = (page: Page) =>
  page.getByRole("button", { name: "Look up with Lingo" });

/**
 * Selects one word of the test page the way a user would, by double-clicking
 * it. Resolves once the Lingo button has appeared.
 */
async function selectWord(page: Page, word: string) {
  const box = await page.evaluate((target) => {
    const node = document.querySelector("#text")?.firstChild as Text;
    const start = node.data.indexOf(target);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + target.length);
    const rect = range.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, word);

  // The host element is attached a moment before its listeners are.
  await expect(async () => {
    await page.mouse.dblclick(box.x, box.y);
    await expect(trigger(page)).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  expect(await page.evaluate(() => getSelection()?.toString())).toBe(word);
}

/** Opens the test page and selects one word on it. */
async function openPageAndSelect(context: BrowserContext, word: string) {
  const page = await context.newPage();
  await page.goto(`${SERVER}/page`);
  // The content script mounts after the page has loaded.
  await page.locator("lingo-lookup").waitFor({ state: "attached" });
  await selectWord(page, word);
  return page;
}

const panel = (page: Page) =>
  page.getByRole("region", { name: "Lingo lookup" });

/** Waits until the panel shows a finished dictionary entry. */
async function expectFinishedEntry(page: Page) {
  await expect(panel(page).getByText("In this context")).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Copy" })).toBeVisible();
}

test("defines a selected word using its paragraph", async ({
  context,
  extensionId,
}, testInfo) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "bank");

  await trigger(page).click();

  await expect(
    panel(page).getByRole("button", { name: "Define" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectFinishedEntry(page);

  // The answer is laid out as a dictionary entry, not printed as JSON.
  const entry = panel(page).locator(".lingo-entry");
  await expect(entry.locator(".lingo-entry__headword")).toHaveText("bank");
  await expect(entry).toContainText("/bæŋk/");
  await expect(entry).toContainText("강가의 땅을 가리킨다");
  await expect(entry.getByRole("heading", { level: 3 })).toHaveText([
    "명사",
    "동사",
  ]);
  await expect(entry.getByText("in context", { exact: true })).toHaveCount(1);
  await expect(
    entry.getByRole("listitem").filter({ hasText: "in context" }),
  ).toContainText("강둑, 제방");
  await expect(entry).toContainText('open a "savings" bank account');
  await expect(entry).toContainText("은행 계좌를 만들다");
  await expect(panel(page)).not.toContainText('"headword"');
  await page.screenshot({ path: testInfo.outputPath("entry.png") });

  // The panel tells the user what was sent along with the selection.
  await panel(page).getByRole("button", { name: "Paragraph context" }).click();
  await expect(panel(page)).toContainText("She sat on the river");
  await page.screenshot({ path: testInfo.outputPath("panel.png") });

  const [sent] = await recordedRequests(page);
  expect(sent?.path).toBe("/v1/messages");
  expect(sent?.body.model).toBe("claude-opus-5-5");
  expect(sent?.body.fallbacks).toBe("default");
  expect(sent?.body.system).toContain("dictionary");
  expect(sent?.body.output_config?.format?.type).toBe("json_schema");
  expect(sent?.body.messages?.[0]?.content).toContain(
    "<passage>She sat on the river [[bank]] and watched the boats.</passage>",
  );
  expect(sent?.body.messages?.[0]?.content).toContain(
    "<title>A walk by the water</title>",
  );
});

test("switching the mode runs the lookup again", async ({
  context,
  extensionId,
}) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();
  await expectFinishedEntry(page);

  await panel(page).getByRole("button", { name: "Translate" }).click();

  await expect(
    panel(page).getByRole("button", { name: "Translate" }),
  ).toHaveAttribute("aria-pressed", "true");
  // A translation is plain text, with no dictionary layout.
  await expect(panel(page)).toContainText("안녕하세요");
  await expect(panel(page).locator(".lingo-entry")).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: "Copy" })).toBeVisible();
  const requests = await recordedRequests(page);
  expect(requests).toHaveLength(2);
  expect(requests[1]?.body.system).toContain("translator");
  expect(requests[1]?.body.output_config?.format).toBeUndefined();
});

test("sends only the selection when context awareness is off", async ({
  context,
  extensionId,
}) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
    await options.getByLabel("Send the text around my selection").uncheck();
  });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();

  await expectFinishedEntry(page);
  await expect(panel(page)).toContainText("Selection only");
  const [sent] = await recordedRequests(page);
  expect(sent?.body.messages?.[0]?.content).toBe("<selection>bank</selection>");
});

test("uses OpenAI when it is the chosen provider", async ({
  context,
  extensionId,
}, testInfo) => {
  const options = await saveSettings(context, extensionId, async (page) => {
    await page.getByLabel("OpenAI", { exact: true }).check();
    await page.getByLabel("OpenAI API key").fill("test-key");
    await page.getByLabel("Translate into").selectOption("ja");
  });
  await options.screenshot({
    path: testInfo.outputPath("options.png"),
    fullPage: true,
  });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();

  await expectFinishedEntry(page);
  await expect(panel(page).locator(".lingo-entry__headword")).toHaveText(
    "bank",
  );
  const [sent] = await recordedRequests(page);
  expect(sent?.path).toBe("/v1/responses");
  expect(sent?.body.model).toBe("gpt-6.2-sol");
  expect(sent?.body.instructions).toContain("Japanese");
  expect(sent?.body.text?.format).toMatchObject({
    type: "json_schema",
    name: "dictionary_entry",
  });
  expect(sent?.body.input?.[0]?.content).toContain("[[bank]]");
});

test("explains a rejected key and leads back to settings", async ({
  context,
  extensionId,
}, testInfo) => {
  const options = await saveSettings(context, extensionId, async (page) => {
    await page.getByLabel("Anthropic API key").fill("bad-key");
  });
  await options.close();
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();

  await expect(panel(page)).toContainText("rejected your API key");
  await page.screenshot({ path: testInfo.outputPath("error.png") });

  const opened = context.waitForEvent("page");
  await panel(page).getByRole("button", { name: "Open settings" }).click();
  await expect((await opened).url()).toContain("options.html");
});

test("asks for a key before the first lookup", async ({ context }) => {
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();

  await expect(panel(page)).toContainText("Add an API key in settings");
  expect(await recordedRequests(page)).toEqual([]);
});

test("closes on Escape and on a click outside", async ({
  context,
  extensionId,
}) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();
  await expect(panel(page)).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();

  const second = await openPageAndSelect(context, "river");
  await trigger(second).click();
  await expect(panel(second)).toBeVisible();
  await second.mouse.click(5, 5);
  await expect(panel(second)).toBeHidden();
});

test("stays open while pinned, until Close is pressed", async ({
  context,
  extensionId,
}) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();
  await expectFinishedEntry(page);

  const pin = panel(page).getByRole("button", { name: "Pin" });
  await pin.click();
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  // What closes an unpinned panel leaves this one alone.
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
  await expect(panel(page)).toBeVisible();

  // A new lookup shows in the pinned panel, where it already is.
  const place = await panel(page).boundingBox();
  await selectWord(page, "boats");
  await trigger(page).click();
  await expect(trigger(page)).toBeHidden();
  await expect.poll(async () => (await recordedRequests(page)).length).toBe(2);
  const [, second] = await recordedRequests(page);
  expect(second?.body.messages?.[0]?.content).toContain("[[boats]]");
  await expectFinishedEntry(page);
  expect(await panel(page).boundingBox()).toEqual(place);
  await expect(pin).toHaveAttribute("aria-pressed", "true");

  await panel(page).getByRole("button", { name: "Close" }).click();
  await expect(panel(page)).toBeHidden();

  // The next panel starts unpinned.
  await selectWord(page, "river");
  await trigger(page).click();
  await expect(pin).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Escape");
  await expect(panel(page)).toBeHidden();
});

test("moves when its header is dragged, and stays there", async ({
  context,
  extensionId,
}) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();
  await expectFinishedEntry(page);

  const corner = async () => {
    const box = await panel(page).boundingBox();
    if (!box) throw new Error("The panel is not on screen");
    return { x: box.x, y: box.y };
  };
  const before = await corner();
  const header = await panel(page).locator("header").boundingBox();
  if (!header) throw new Error("The panel has no header");
  // The middle of the header, between its controls, is where the handle is.
  const grip = {
    x: header.x + header.width / 2,
    y: header.y + header.height / 2,
  };
  await page.mouse.move(grip.x, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 200, grip.y + 120, { steps: 5 });
  await page.mouse.up();

  const after = await corner();
  expect(after.x - before.x).toBeCloseTo(200, 0);
  expect(after.y - before.y).toBeCloseTo(120, 0);
  // Dragging neither closed the panel nor dropped the page's selection.
  expect(await page.evaluate(() => getSelection()?.toString())).toBe("bank");

  // Asking again in the other mode leaves the panel where it was put.
  await panel(page).getByRole("button", { name: "Translate" }).click();
  await expect(panel(page)).toContainText("안녕하세요");
  expect(await corner()).toEqual(after);
});

test("looks up the selection when the shortcut message arrives", async ({
  context,
  extensionId,
  worker,
}) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "boats");
  await page.bringToFront();

  // Playwright cannot press a browser-level extension shortcut, so send the
  // message the background sends when the command fires.
  await worker.evaluate(async () => {
    const { tabs } = (globalThis as unknown as { chrome: { tabs: TabsApi } })
      .chrome;
    const [tab] = await tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id !== undefined) {
      await tabs.sendMessage(tab.id, { type: "lookup-selection" });
    }
  });

  await expectFinishedEntry(page);
});
