import "./style.css";
import { createRoot } from "react-dom/client";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import { defineContentScript } from "wxt/utils/define-content-script";
import { LookupApp } from "./App.tsx";
import { PageTranslationBar } from "./PageTranslationBar.tsx";
import { setUpPageTranslation } from "./page-translation.ts";
import { SettingsDrawer } from "./SettingsDrawer.tsx";

export default defineContentScript({
  matches: ["<all_urls>"],
  // A selection can be inside an iframe, and each frame only sees its own.
  allFrames: true,
  // Put the styles inside the shadow root, where the page cannot reach them.
  cssInjectionMode: "ui",

  async main(ctx) {
    if (!document.body) return;

    const pageControl = setUpPageTranslation();
    // An update of the extension cuts this script off from it. The page gets
    // its own text back, since nothing here could finish or undo it later.
    ctx.onInvalidated(() => pageControl.dispose());

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
            {/* One drawer and one page bar, however many frames there are. */}
            {window.top === window && (
              <>
                <SettingsDrawer />
                <PageTranslationBar control={pageControl} />
              </>
            )}
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
