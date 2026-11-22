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
 * Opens the test page and selects one word the way a user would, by
 * double-clicking it. Resolves once the Lingo button has appeared.
 */
async function openPageAndSelect(context: BrowserContext, word: string) {
  const page = await context.newPage();
  await page.goto(`${SERVER}/page`);
  // The content script mounts after the page has loaded.
  await page.locator("lingo-lookup").waitFor({ state: "attached" });

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
  return page;
}

const panel = (page: Page) =>
  page.getByRole("region", { name: "Lingo lookup" });

test("defines a selected word using its paragraph", async ({
  context,
  extensionId,
}, testInfo) => {
  await saveSettings(context, extensionId, async (options) => {
    await options.getByLabel("Anthropic API key").fill("test-key");
  });
  const page = await openPageAndSelect(context, "bank");

  await trigger(page).click();

  await expect(panel(page)).toContainText("안녕하세요");
  await expect(
    panel(page).getByRole("button", { name: "Define" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByRole("button", { name: "Copy" })).toBeVisible();

  // The panel tells the user what was sent along with the selection.
  await panel(page).getByRole("button", { name: "Paragraph context" }).click();
  await expect(panel(page)).toContainText("She sat on the river");
  await page.screenshot({ path: testInfo.outputPath("panel.png") });

  const [sent] = await recordedRequests(page);
  expect(sent?.path).toBe("/v1/messages");
  expect(sent?.body.model).toBe("claude-opus-5-5");
  expect(sent?.body.fallbacks).toBe("default");
  expect(sent?.body.system).toContain("dictionary");
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
  await expect(panel(page)).toContainText("안녕하세요");

  await panel(page).getByRole("button", { name: "Translate" }).click();

  await expect(
    panel(page).getByRole("button", { name: "Translate" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(panel(page).getByRole("button", { name: "Copy" })).toBeVisible();
  const requests = await recordedRequests(page);
  expect(requests).toHaveLength(2);
  expect(requests[1]?.body.system).toContain("translator");
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

  await expect(panel(page)).toContainText("안녕하세요");
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

  await expect(panel(page)).toContainText("안녕하세요");
  const [sent] = await recordedRequests(page);
  expect(sent?.path).toBe("/v1/responses");
  expect(sent?.body.model).toBe("gpt-6.2-sol");
  expect(sent?.body.instructions).toContain("Japanese");
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

  await expect(panel(page)).toContainText("안녕하세요");
});
