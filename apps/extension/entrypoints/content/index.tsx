import "./style.css";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { isRuntimeMessage } from "../../src/messaging.ts";
import { PAGE_TRANSLATION_PORT } from "../../src/page-translation/protocol.ts";
import {
  createPageTranslator,
  type PageTranslationProgress,
} from "../../src/page-translation/translator.ts";
import { LookupApp } from "./App.tsx";
import { SettingsDrawer } from "./SettingsDrawer.tsx";

/**
 * Set only in end-to-end test builds, like the address of the fake server in
 * the background. A production build never writes to the page for a test.
 */
const E2E = Boolean(import.meta.env.WXT_E2E_LLM_BASE_URL);

/** Puts the numbers of a page translation where a test can read them. */
function publishProgress(progress: PageTranslationProgress) {
  document.documentElement.dataset.lingoPageTranslation =
    JSON.stringify(progress);
}

export default defineContentScript({
  matches: ["<all_urls>"],
  // A selection can be inside an iframe, and each frame only sees its own.
  allFrames: true,
  // Put the styles inside the shadow root, where the page cannot reach them.
  cssInjectionMode: "ui",

  async main(ctx) {
    if (!document.body) return;

    // Page translation is turned on and off with its keyboard shortcut. Each
    // frame translates its own text.
    const translator = createPageTranslator({
      connect: () => browser.runtime.connect({ name: PAGE_TRANSLATION_PORT }),
      onProgress: E2E ? publishProgress : undefined,
    });
    browser.runtime.onMessage.addListener((message) => {
      if (!isRuntimeMessage(message)) return;
      if (message.type !== "toggle-page-translation") return;
      if (translator.active) translator.stop();
      else translator.start();
    });
    ctx.onInvalidated(() => translator.stop());

    const ui = await createShadowRootUi(ctx, {
      name: "lingo-ui",
      position: "inline",
      anchor: "body",
      onMount(container, _shadow, host) {
        const wrapper = document.createElement("div");
        container.append(wrapper);
        const root = createRoot(wrapper);
        root.render(
          <>
            <LookupApp host={host} />
            {/* One drawer for the page, however many frames it has. */}
            {window.top === window && <SettingsDrawer />}
          </>,
        );
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
