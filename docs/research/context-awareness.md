# Context Awareness: How Much Surrounding Text Can Each Platform Give Us?

Researched 2026-11-21.

"Context awareness" means sending the LLM more than the user's selection: the enclosing sentence or paragraph, and where available the page title, URL, or app name. With it, selecting a single word can return what the word means *in this sentence*, not only its dictionary senses.

This document answers how far that is technically possible on each surface.

**Reading the claims.** Statements with a link were checked against that source. `[inferred]` marks reasoning or recollection that was not confirmed from a source and should be tested before we rely on it.

## Bottom line

- **Browser extension: fully feasible.** A content script can read the selection, its enclosing block, the whole document, the title and the URL. A handful of page types are exceptions.
- **Desktop: feasible in most apps, not all.** The macOS Accessibility API and Windows UI Automation can both expand a selection to its paragraph. Coverage depends on how well each app implements accessibility. A rough estimate is paragraph-level context for 70–85% of everyday text, and selection-only for most of the rest `[inferred]`.
- **iOS system-wide (default translation app): not feasible.** The system hands the extension the selected text and nothing else.
- **iOS Safari: feasible** through the Safari Web Extension, which has the same DOM access as the Chrome extension.
- None of the open-source select-to-translate tools we looked at capture surrounding context. This is a real differentiator, and it is achievable.

## Feasibility matrix

| Surface / method | Context beyond the selection | Permission | Reliability | Distribution impact |
|---|---|---|---|---|
| Chrome MV3 content script (DOM) | Paragraph, whole document, title, URL | Host permissions | High on normal pages. Low in the built-in PDF viewer and canvas editors | Chrome Web Store is fine. Broad host permissions show an install warning `[inferred]` |
| Safari Web Extension (iOS/iPadOS) | Same as Chrome | Per-site grant by the user | Same DOM access; the UI is the hard part (see below) | Needs a containing iOS app |
| macOS Accessibility, native AppKit text | Paragraph, whole document, window title. No URL | Accessibility (TCC) | High `[inferred]` | Rules out the Mac App Store |
| macOS Accessibility, Safari/Chrome web content | Sometimes selection only. Paragraph may be reachable through private text-marker attributes (untested) | Accessibility | Low to medium | Same |
| macOS Accessibility, Electron apps | Selection and some paragraph context, after setting `AXManualAccessibility` | Accessibility | Medium; the tree is often sparse | Same |
| macOS AppleScript/JXA `do JavaScript` | Full DOM | Automation (TCC) plus a per-browser user toggle | High once enabled; Safari and Chromium browsers only | — |
| macOS simulated Cmd+C | None (selection only) | Accessibility, to post events | High coverage; overwrites the clipboard and can beep | — |
| macOS ScreenCaptureKit + Vision OCR | Visible lines only | Screen Recording, with periodic re-confirmation | Medium | — |
| Windows UI Automation `TextPattern` | Paragraph, whole document, window title, app | None at medium integrity. Elevated windows are blocked | Medium to high | No store blocker `[inferred]` |
| Windows simulated Ctrl+C | None (selection only) | None. Elevated targets are blocked | High coverage; clipboard side effects | — |
| `Windows.Media.Ocr` | Visible text only | Docs say package identity is required (evidence conflicts) | Medium | May need MSIX packaging |
| iOS default translation app | **None** | Entitlement | — | — |
| iOS Action/Share extension on a Safari page | DOM, via the JavaScript preprocessing file `[inferred]` | — | Share-sheet flow, not the Translate menu | — |
| iOS custom keyboard | About 200 characters around the cursor, editable fields only | "Full Access" for network | Partial | — |
| Android `ACTION_PROCESS_TEXT` | None | — | — | — |

## Browser extension (Chrome MV3)

The baseline is standard DOM: take `getSelection().getRangeAt(0)`, walk up to the nearest block element, read its text, and add `document.title` and `location` `[inferred, standard DOM]`.

The cases where that does not work, and what to do about each:

| Case | Problem | Approach |
|---|---|---|
| `<input>` / `<textarea>` | `getSelection()` does not reliably cover text inside form fields ([Mozilla bug](https://bugzilla.mozilla.org/show_bug.cgi?id=1527627)) | Use `el.value` with `selectionStart`/`selectionEnd` ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/selectionStart)); the whole field is the context |
| Cross-origin iframes | The top frame cannot read into them | `all_frames: true` ([docs](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)); each frame runs its own script and messages the result `[inferred]` |
| Closed Shadow DOM | Content scripts cannot see closed shadow roots by default ([thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/JaHhogJuBOk)) | `chrome.dom.openOrClosedShadowRoot()` ([docs](https://developer.chrome.com/docs/extensions/reference/api/dom)), then `getComposedRanges({shadowRoots})`. Sources disagree on whether closed roots are honoured ([Lexical](https://lexical.dev/docs/concepts/shadow-dom) says no), so test it |
| Built-in PDF viewer | Content sits behind a closed shadow root with no public text API ([thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/3Way1EhUjo0)) | Selection only. For context, fetch the PDF and parse it with pdf.js `[inferred]` |
| Google Docs | Renders to canvas since 2021 ([Google](https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html)); text access needs an allowlist that Google grants on application ([thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/dLnxATEOcqg)) | Treat as unsupported |

## macOS desktop

### Accessibility API

The recipe for native text views: get the focused element, read `kAXSelectedTextRangeAttribute`, then call `kAXStringForRangeParameterizedAttribute` over a wider range. `AXLineForIndex` and `AXRangeForLine` snap the range to line boundaries ([Apple](https://developer.apple.com/documentation/appkit/text-specific-parameterized-attributes.md)).

App types behave differently:

- **WebKit and Chromium web content** use text markers instead of integer ranges: `AXSelectedTextMarkerRange` → `AXStringForTextMarkerRange` ([list](https://lists.apple.com/archives/accessibility-dev/2014/May/msg00001.html)). Both engines define private `AXParagraphTextMarkerRangeForTextMarker` and `AXSentenceTextMarkerRangeForTextMarker` attributes ([WebKit](https://bugs.webkit.org/show_bug.cgi?id=130906), [Chromium](https://chromium.googlesource.com/chromium/src/+/eb6a38f/content/browser/accessibility/browser_accessibility_cocoa.mm)). They are undocumented and we have not tested them. Easydict reports that "Safari does not support Accessibility word selection" ([FAQ](https://github.com/tisfeng/Easydict/wiki/FAQ)).
- **Chrome** builds its accessibility tree on demand ([commit](https://chromium.googlesource.com/chromium/src/+/34d5b59a67da7b0ea1a3eb90835467eb63e7262e)).
- **Electron apps** keep accessibility off by default. A third-party client should set `AXManualAccessibility` on the app ([Electron](https://www.electronjs.org/docs/latest/tutorial/accessibility)). `AXEnhancedUserInterface` also works but breaks window managers ([list](https://lists.apple.com/archives/accessibility-dev/2020/Sep/msg00007.html)).
- **Known failures**: PopClip's compatibility list shows failures in all Adobe apps including Acrobat, Kindle, Apple Books, emacs/vim and virtual machines, and partial support in JetBrains IDEs ([PopClip](https://www.popclip.app/kb/troubleshooting)). One paper estimates that only 33% of macOS apps have full accessibility support ([arXiv](https://arxiv.org/abs/2507.16704)).
- **Not confirmed**: per-app behaviour for Preview, Office for Mac, and Java/Qt apps. Terminal and iTerm do expose their text, since ChatGPT reads them this way.

### Permission and distribution

The app needs the user to grant Accessibility access.

Apple support engineers state that "It's not possible to use the Accessibility APIs from a sandboxed app" and that Developer ID distribution is the only path ([thread](https://developer.apple.com/forums/thread/805556), [thread](https://developer.apple.com/forums/thread/756130)). One developer claims two Mac App Store apps do use it; that is unverified.

**Decision: the macOS app ships outside the Mac App Store, signed with Developer ID and notarized.**

### Fallbacks

- **Simulated Cmd+C.** Selection only. It overwrites the clipboard and can make the system beep; libraries save and restore the clipboard and mute alerts around it ([get-selected-text](https://docs.rs/crate/get-selected-text/latest/source/src/macos.rs)). Non-text clipboard contents may be lost `[inferred]`. One Mac App Store app was rejected under guideline 2.4.5 for `CGEvent.post` ([forum](https://developer.apple.com/forums/thread/820594)), which does not affect Developer ID distribution.
- **Screenshot + OCR.** Vision's `RecognizeDocumentsRequest` groups recognised text into paragraphs ([Apple](https://developer.apple.com/documentation/vision/recognizedocumentsrequest.md)). It needs Screen Recording permission, which comes with periodic re-prompts ([9to5Mac](https://9to5mac.com/2024/08/14/macos-sequoia-screen-recording-prompt-monthly/), [MacRumors](https://www.macrumors.com/2024/10/07/apple-screen-recording-popup-update/)). Whether macOS 26 changed the re-prompt policy is not confirmed. OCR sees only what is on screen, and the app has to locate the highlighted selection itself.
- **Asking the browser via AppleScript/JXA.** Gives the full DOM, but the user must enable "Allow JavaScript from Apple Events" in each browser ([Chromium](https://www.chromium.org/developers/applescript/), [Keyboard Maestro wiki](https://wiki.keyboardmaestro.com/assistance/Web_Browser_Automation)) and grant Automation permission.

## Windows desktop

### UI Automation

`TextPattern.GetSelection()` returns the selected range. `ITextRangeProvider.ExpandToEnclosingUnit` normalises it to a unit such as Paragraph. If a control does not support the requested unit it falls back to the next larger one, so the result may be a page or the whole document ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/api/uiautomationcore/nf-uiautomationcore-itextrangeprovider-expandtoenclosingunit)). Clamp the length ourselves.

Coverage:

- **Chrome and Edge**: native UI Automation is on by default since Chrome 138 ([blog](https://developer.chrome.com/blog/windows-uia-support-update)).
- **Word**: the document and each page implement `TextPattern` ([Microsoft](https://learn.microsoft.com/en-us/office/uia/word/wordcustompatterns)).
- **Notepad and classic Edit controls**: only when the client creates `CUIAutomation8` ([Microsoft blog](https://learn.microsoft.com/en-us/archive/blogs/winuiautomation/how-come-i-cant-find-a-text-pattern-for-notepad-when-inspect-tells-me-its-there)).
- **Windows Terminal**: exposes a UI Automation text provider that screen readers use ([NVDA](https://www.mintlify.com/nvaccess/nvda/development/advanced/ui-automation)).
- **Weak**: Java Swing goes through Java Access Bridge, not UI Automation ([OpenJDK](https://mail.openjdk.org/pipermail/openjfx-dev/2023-March/039066.html)). WPF, WinUI, Qt 6 and Electron are untested `[inferred]`.

### Permission

No permission prompt is needed, but a normal medium-integrity process cannot read elevated windows. `uiAccess` would lift that; it requires Authenticode signing and installation under Program Files, and is intended for assistive technology ([Microsoft](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-securityoverview)).

### OCR

Microsoft's docs say `Windows.Media.Ocr` needs package identity ([Microsoft](https://learn.microsoft.com/uwp/api/windows.media.ocr)), but pot ships it in an unpackaged Tauri app ([Cargo.toml](https://raw.githubusercontent.com/pot-app/pot-desktop/master/src-tauri/Cargo.toml)). Test before relying on either.

## iOS and iPadOS

| Entry point | Text beyond the selection? | Notes |
|---|---|---|
| Default translation app (TranslationUIProvider) | **No** | The context object exposes `inputText` and `allowsReplacement` only ([Apple](https://developer.apple.com/documentation/translationuiprovider/translationuiprovidercontext)). No surrounding text, source app, URL, or language hints |
| Safari Web Extension | **Yes** | Full DOM, same as Chrome |
| Action/Share extension on a Safari page | Yes `[inferred]` | The JavaScript preprocessing file runs in the page and can return arbitrary values ([Apple](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html)). Apple's sample only returns the URL. Reached through the share sheet |
| Action/Share extension on plain text | No `[inferred]` | Selection only |
| Custom keyboard | Partial | `documentContextBeforeInput`/`AfterInput`, editable fields only, about 200 characters per developer reports ([forum](https://developer.apple.com/forums/thread/772158)). Needs "Full Access" for network ([Apple](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/CustomKeyboard.html)) |
| App Intents / Shortcuts | No `[inferred]` | Whatever is shared in |
| Visual Intelligence (iOS 26+) | Screenshot pixels | Results appear as a search-results list, not a translation sheet ([Apple](https://developer.apple.com/documentation/visualintelligence/integrating-your-app-with-visual-intelligence)) |

So on iOS, context awareness is available in Safari and nowhere else that matters. The system-wide "Translate" action works on the selection alone.

**An idea worth testing** `[inferred]`: the Safari extension could store the most recent selection and its context in the shared App Group. When the default-translation extension is invoked with an `inputText` that matches a fresh entry, it uses the stored context. That would make the system Translate menu context-aware inside Safari. Open questions are how reliably the extension can write on `selectionchange` given Safari's background lifetime, and how to present this to users as a privacy choice.

## Android

`ACTION_PROCESS_TEXT` delivers the selected text and a read-only flag, and can return replacement text. It carries no surrounding text and no information about the source app ([Android Developers](https://medium.com/androiddevelopers/custom-text-selection-actions-with-action-process-text-191f792d2999)). Android is low priority for Lingo.

## What existing apps do

Open-source select-to-translate tools read the selection only:

| App | Mechanism |
|---|---|
| Easydict | Accessibility, then AppleScript for browsers, then forced Cmd+C ([FAQ](https://github.com/tisfeng/Easydict/wiki/FAQ)). Its SelectedTextKit returns the selection only ([repo](https://github.com/tisfeng/SelectedTextKit)) |
| Pot (`selection` crate) | macOS: `kAXSelectedText`, falling back to Cmd+C ([source](https://docs.rs/crate/selection/latest/source/src/macos.rs)). Windows: `GetSelection()` with no expansion, falling back to Ctrl+C ([source](https://docs.rs/crate/selection/latest/source/src/windows.rs)) |
| openai-translator (`get-selected-text` crate) | macOS: `kAXSelectedText`, falling back to AppleScript Cmd+C. Windows: clipboard only ([source](https://docs.rs/crate/get-selected-text/latest/source/src/windows.rs)) |
| PopClip | Accessibility first, clipboard fallback ([forum](https://forum.popclip.app/t/word-count-bug-when-footnotes-are-present-in-selected-text/3640)) |
| DeepL desktop | Double Cmd+C ([support](https://support.deepl.com/hc/en-us/articles/360020613059-Use-DeepL-shortcuts-for-desktop-apps)) |

Commercial tools that do read context show the approach works:

- **ChatGPT for Mac ("Work with Apps")** reads through the Accessibility API: "If you select text in a pane, ChatGPT focuses on the selection and includes neighboring text up to a truncation limit" ([OpenAI](https://help.openai.com/en/articles/10119604-work-with-apps-on-macos)).
- **Raycast Screen Awareness** combines Accessibility (selection, window text, focused field), a screenshot (Screen Recording), and a companion browser extension for page content ([manual](https://manual.raycast.com/ai/screen-awareness.md)).

## Design implications

1. **One port, graded results.** A `ContextSource` returns the selection plus whatever context it could get, tagged with a level: `none`, `sentence`, `paragraph`, or `document`. See [architecture.md](../architecture.md).
2. **Degrade, don't disable.** When there is no context, a single-word lookup shows general definitions instead of "meaning in this sentence", and the chat lets the user paste context in.
3. **Desktop capture order.** Accessibility or UI Automation for selection and paragraph, always adding app name and window title. Fall back to simulated copy for selection only, saving and restoring the clipboard. OCR is a later, opt-in addition.
4. **Browsers on desktop.** Accessibility context is weakest inside browsers, which is exactly where the extension is strongest. A later step is to have the desktop app ask the Lingo extension for context `[inferred: native messaging]`.
5. **User control.** A settings toggle, a maximum context length (context costs tokens the user pays for), a way to see exactly what was sent, and exclusion of password fields.

## Open questions to test

- Do the private WebKit/Chromium paragraph text-marker attributes work from a third-party client?
- How do Preview, Office for Mac, Qt and Java apps behave under Accessibility? WPF, WinUI, Qt and Electron under UI Automation?
- Does `getComposedRanges` return ranges inside closed shadow roots for an extension?
- Does `Windows.Media.Ocr` work from an unpackaged app?
- Is the App Group bridge between the Safari extension and the default-translation extension practical?
