/**
 * Looking something up: select text on a page, and read the answer in the
 * in-page panel.
 */
import {
  drawer,
  expect,
  expectFinishedEntry,
  openPageAndSelect,
  panel,
  recordedRequests,
  selectWord,
  setUp,
  type TabsApi,
  test,
  trigger,
} from "./extension.ts";

test("defines a selected word using its paragraph", async ({
  context,
  extensionId,
}, testInfo) => {
  await setUp(context, extensionId, { apiKey: "test-key" });
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
  await setUp(context, extensionId, { apiKey: "test-key" });
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
  await setUp(context, extensionId, { apiKey: "test-key", context: false });
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
  const settings = await setUp(context, extensionId, {
    provider: "OpenAI",
    apiKey: "test-key",
    language: "Japanese",
  });
  await expect(
    settings.getByRole("button", { name: /^Translation engines/ }),
  ).toContainText("1 engine");
  await expect(settings.getByText("日本語")).toBeVisible();
  await settings.screenshot({ path: testInfo.outputPath("settings.png") });
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
  // The key passed its check when it was entered, and was withdrawn since.
  const settings = await setUp(context, extensionId, { apiKey: "revoked-key" });
  await settings.close();
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();

  await expect(panel(page)).toContainText("rejected your API key");
  await page.screenshot({ path: testInfo.outputPath("error.png") });

  // The settings open in the same page, where the key can be corrected.
  await panel(page).getByRole("button", { name: "Open settings" }).click();
  await expect(
    drawer(page).getByRole("button", { name: /^Translation engines/ }),
  ).toContainText("1 engine");
});

test("asks for a key before the first lookup", async ({ context }) => {
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();

  await expect(panel(page)).toContainText(
    "Add a translation engine in settings",
  );
  expect(await recordedRequests(page)).toEqual([]);
});

test("closes on Escape and on a click outside", async ({
  context,
  extensionId,
}) => {
  await setUp(context, extensionId, { apiKey: "test-key" });
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
  await setUp(context, extensionId, { apiKey: "test-key" });
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
  await setUp(context, extensionId, { apiKey: "test-key" });
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
  await setUp(context, extensionId, { apiKey: "test-key" });
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

test("asks the provider once for the same lookup", async ({
  context,
  extensionId,
}) => {
  await setUp(context, extensionId, { apiKey: "test-key" });
  const page = await openPageAndSelect(context, "bank");
  await trigger(page).click();
  await expectFinishedEntry(page);
  expect(await recordedRequests(page)).toHaveLength(1);

  // The same word again, also in a page that was loaded anew.
  await page.reload();
  await page.locator("lingo-ui").waitFor({ state: "attached" });
  await selectWord(page, "bank");
  await trigger(page).click();
  await expectFinishedEntry(page);
  expect(await recordedRequests(page)).toHaveLength(1);

  // Another word is another request.
  await page.keyboard.press("Escape");
  await selectWord(page, "boats");
  await trigger(page).click();
  await expectFinishedEntry(page);
  expect(await recordedRequests(page)).toHaveLength(2);
});

test("clears the stored answers, and stops reusing them when turned off", async ({
  context,
  extensionId,
}, testInfo) => {
  const settings = await setUp(context, extensionId, { apiKey: "test-key" });
  const cacheRow = settings.getByRole("button", { name: /^Cache/ });
  await expect(cacheRow).toContainText("On · empty");

  const page = await openPageAndSelect(context, "bank");
  const lookUpAgain = async () => {
    await page.reload();
    await page.locator("lingo-ui").waitFor({ state: "attached" });
    await selectWord(page, "bank");
    await trigger(page).click();
    await expectFinishedEntry(page);
  };
  await trigger(page).click();
  await expectFinishedEntry(page);
  expect(await recordedRequests(page)).toHaveLength(1);

  // The settings say what is stored, and clearing it removes it.
  await cacheRow.click();
  await expect(settings.getByText(/^1 answer, 1 KB of 9 MB\./)).toBeVisible();
  await settings.screenshot({ path: testInfo.outputPath("cache.png") });
  await settings.getByRole("button", { name: "Clear cache" }).click();
  await expect(settings.getByText("Nothing is stored.")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "Cleared" }),
  ).toBeDisabled();
  await settings.screenshot({ path: testInfo.outputPath("cleared.png") });
  await lookUpAgain();
  expect(await recordedRequests(page)).toHaveLength(2);

  // Turned off, the answer that was just stored is kept and not used.
  await settings.getByRole("switch", { name: "Reuse answers" }).click();
  await settings.getByRole("button", { name: "Back" }).click();
  await expect(cacheRow).toContainText("Off");
  await lookUpAgain();
  expect(await recordedRequests(page)).toHaveLength(3);

  await cacheRow.click();
  await expect(
    settings.getByText(/^1 answer, .* They are kept, and not used/),
  ).toBeVisible();
});
