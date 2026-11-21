# Architecture

Status: design. No code exists yet; this document records the decisions the first implementation should follow.

Background research:

- [Context awareness feasibility](research/context-awareness.md)
- [Platform strategy](research/platform-strategy.md)

`[inferred]` marks points that were not confirmed from a source and need checking during implementation.

## Decisions at a glance

| Topic | Decision |
|---|---|
| Repository | One repo for all surfaces |
| Browser extension | WXT + React + TypeScript; Chrome MV3 first, Safari from the same code |
| Desktop | Tauri 2 for macOS and Windows, sharing the React UI and TypeScript core. Electron is the fallback |
| iOS / iPadOS | Native SwiftUI app with a default-translation extension and a Safari Web Extension |
| Shared logic | TypeScript packages for extension and desktop; a thin Swift port for iOS; shared prompts and fixtures in `spec/` |
| LLM access | Bring your own key. The app calls provider APIs directly; there is no Lingo server |
| macOS distribution | Developer ID + notarization, outside the Mac App Store |
| Build order | Extension → desktop spike → desktop → iOS |

## Repository layout

```
Lingo/
├─ packages/
│  ├─ core/        TypeScript: domain types, ports, prompt builder, use cases
│  ├─ providers/   TypeScript: LLM adapters (Anthropic, OpenAI, OpenAI-compatible)
│  └─ ui/          React: translation card, chat thread, settings forms
├─ apps/
│  ├─ extension/   WXT: Chrome MV3 and Safari builds
│  ├─ desktop/     Tauri 2: macOS and Windows
│  └─ apple/       Xcode: iOS/iPadOS app, its extensions, and the Swift core package
├─ spec/           Prompt templates and SSE fixtures, used as test vectors by TypeScript and Swift
└─ docs/
```

Releases are tagged per surface: `ext-v*`, `desktop-v*`, `ios-v*`.

## Hexagonal core

`packages/core` holds the domain and defines ports. It imports no platform API and no provider SDK. Each app supplies adapters.

| Port | Extension | Desktop | iOS |
|---|---|---|---|
| `LLMProvider` (streaming) | `packages/providers` | `packages/providers` | Swift port over URLSession + SSE |
| `ContextSource` | DOM | Accessibility / UI Automation / clipboard | Selection only; DOM in Safari |
| `SecretStore` | Extension storage | OS keychain / Credential Manager | Shared Keychain group |
| `SettingsStore` | Extension storage | App settings file | App Group |

A sketch of the central types. Names and shapes are a starting point, not a contract:

```ts
type ContextLevel = 'none' | 'sentence' | 'paragraph' | 'document';

interface CapturedContext {
  selection: string;
  level: ContextLevel;
  before?: string;    // text preceding the selection, clamped to a maximum length
  after?: string;     // text following the selection, clamped
  title?: string;     // page or window title
  url?: string;
  appName?: string;
}

interface ContextSource {
  capture(): Promise<CapturedContext>;
}

interface LLMProvider {
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<string>;
}
```

### Use cases

| Use case | What it does |
|---|---|
| Translate selection | Translates the selection, using context when present |
| Define in context | For a word or short phrase: the meaning in this sentence when context exists, general definitions otherwise |
| Translate page | Translates a page in batches (extension only) |
| Refine | Continues the conversation: the original request, the result, and the user's follow-up instructions |

Chat-based refinement needs no separate mechanism. A translation is the first turn of a conversation, and refining appends turns to it.

### Context model

Context capture is graded, because platforms differ in what they can provide (see the [feasibility matrix](research/context-awareness.md#feasibility-matrix)).

- Each `ContextSource` returns the best level it can and says which level it reached.
- Prompts adapt to the level. With `none`, the define use case falls back to general definitions.
- Context is clamped to a maximum length before it is sent. It costs tokens the user pays for.

Settings and privacy:

- A toggle for context awareness.
- A maximum context length.
- The UI shows what context was sent with a request.
- Password fields and secure text fields are never read.

## Bring your own key

Lingo is free and open source with no subscription, so users supply their own provider keys and pay inference costs directly. There is no Lingo backend; every surface calls the provider API itself.

### Where keys live and where calls are made

| Surface | Key storage | API calls made from |
|---|---|---|
| Extension | Extension storage | The background service worker only |
| Desktop | OS keychain / Credential Manager | To be decided in the spike (see below) |
| iOS | Keychain, shared across the app and its extensions `[inferred]` | Each native process; the Safari extension's background script |

Extension rules:

- Content scripts never hold the key. They send text and context to the background script by message.
- The background script decides which provider URL to call. A content script cannot supply one.
- Chrome's `storage.local` persists but is readable from content scripts by default, while `storage.session` is in-memory and hidden from content scripts but cleared on browser restart ([Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage)). Use `storage.local` and restrict it to trusted contexts if the API allows `[inferred: confirm setAccessLevel support in Chrome and Safari]`.

Desktop open decision: either the webview calls providers through the shared TypeScript adapters, fetching the key from the Rust side at call time, or a Rust command proxies the HTTP request and injects the key so it never enters JavaScript. The first shares more code; the second keeps the key further from the UI layer.

### Provider adapters

Three adapters cover the plan:

| Adapter | Covers |
|---|---|
| Anthropic | Claude models |
| OpenAI | OpenAI models |
| OpenAI-compatible with a custom base URL | Local LLMs later (Ollama, LM Studio and similar). Not part of the MVP; the adapter slot exists so adding it is not a redesign |

Both hosted APIs permit cross-origin calls from an extension (checked with live preflight requests on 2026-11-21). In Chrome, calls from the service worker to origins in `host_permissions` skip CORS entirely ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)).

Notes for the Anthropic adapter. Confirm each against current documentation when implementing:

- Use the official TypeScript SDK in `packages/providers`. There is no official Swift SDK, so the iOS port calls the HTTP API directly.
- Browser-origin requests must send `anthropic-dangerous-direct-browser-access: true` ([background](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access)). The SDK has to be explicitly opted in to browser use.
- Default model: `claude-opus-5-5`. The model is a user setting, and it can differ per feature, since page translation is far higher volume than selection lookups. Current list prices per million tokens (input / output), as of 2026-11: Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50.
- Thinking cannot be disabled on Opus 5.5. Control latency with `output_config.effort`, starting at `"low"` for translation.
- Do not send `temperature`, `top_p` or `top_k`; current models reject them.
- Always stream.
- Check `stop_reason` before reading content, and handle `"refusal"`. Server-side fallbacks (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta) can retry a refused request on another model.
- Page translation needs output mapped back to page segments. Use structured outputs for that; assistant prefill is not available on current models.
- Prompt caching only applies when the shared prefix is at least 512 tokens on current models. A short translation system prompt will not cache by itself. For page translation, put the stable instructions and any page-level context first, the per-batch text last, and confirm with `usage.cache_read_input_tokens`.

OpenAI adapter: use the official SDK; confirm request shape and model names against current documentation when implementing.

Local servers may need origin configuration before they accept requests from an extension `[inferred]`.

## Surface notes

### Browser extension

Features: full-page translation; translate or define the selection through a hotkey and an in-page floating component.

- **Selection UI.** Render the floating component inside a shadow root so page styles cannot leak in.
- **Context.** DOM-based, with the edge cases listed in the [research](research/context-awareness.md#browser-extension-chrome-mv3).
- **Page translation.** Translate what is near the viewport first rather than the whole page at once, batch paragraphs, cap concurrency, cache by text and target language, and show the user what a page is costing. Details are open.
- **Safari on iOS and iPadOS.** Built from the same code with WXT's Safari target, then packaged with `xcrun safari-web-extension-packager` ([Apple](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)) into the `apps/apple` project. Constraints that affect design:
  - The background script is non-persistent and Safari unloads it ([Apple](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)). Developers report it being killed after 30–45 seconds and long fetches failing ([thread](https://developer.apple.com/forums/thread/758346), [thread](https://developer.apple.com/forums/thread/764482)). Keep each request short and make page translation resumable.
  - `contextMenus`, `webRequest`, `windows.create` and `side_panel` are unavailable, and `storage.sync` does not sync ([Apple](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)).
  - The native text-selection menu cannot be hidden and can cover a page-drawn toolbar. Position Lingo's control away from it.
  - Users grant site access per site ([Apple](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions)).
  - `sendNativeMessage` works from the background script and extension pages, not from content scripts, and the containing app cannot message the extension's JavaScript ([Apple](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)).

### Desktop (macOS and Windows)

Feature: translate or define text selected in any app, triggered by a global hotkey, shown in a dedicated floating window.

Flow:

1. A global hotkey fires.
2. Capture the selection and context from the frontmost app.
   - macOS: Accessibility API. Windows: UI Automation.
   - Always include the app name and window title.
   - If that fails, simulate copy and take the selection only, saving and restoring the clipboard.
3. Show a floating panel near the cursor without taking focus from the source app.
4. Stream the result into the panel. The chat field takes focus only when the user clicks into it.

Supporting pieces: menu-bar or tray presence, a settings window, secure key storage, and auto-update.

Capture code is written for Lingo rather than taken from a crate, because the available crates are archived, stale, or clipboard-only on Windows. See the [risk section](research/platform-strategy.md#the-main-risk-and-how-to-retire-it).

Distribution:

- macOS: Developer ID signing and notarization. The Mac App Store is ruled out because the Accessibility API is unavailable to sandboxed apps.
- Windows: no store restriction identified `[inferred]`. Elevated windows cannot be read from a normal process.

### iOS and iPadOS

Feature: translate or define selected text anywhere, with Lingo set as the system default translation app.

Targets in `apps/apple`:

| Target | Role |
|---|---|
| App (SwiftUI) | Settings, API keys, chat and history |
| Translation provider extension | Makes Lingo selectable as the default translation app |
| Safari Web Extension | Wraps the browser extension build |
| Swift core package | The Swift port of prompts and provider adapters, shared by the targets above |

The default translation app API (TranslationUIProvider):

- Available on iOS and iPadOS 18.4 and later, worldwide ([Apple](https://developer.apple.com/documentation/translationuiprovider/preparing-your-app-to-be-the-default-translation-app), [Apple Support](https://support.apple.com/en-us/121430)). It is not available on macOS or Mac Catalyst.
- It is an ExtensionKit extension with the entitlement `com.apple.developer.translation-app` ([Apple](https://developer.apple.com/documentation/bundleresources/entitlements/com.apple.developer.translation-app)). The entitlement appears to be self-serve through Xcode's capabilities `[inferred]`.
- Network access needs the Info.plist key `com.apple.developer.translation-ui-provider.network-access`.
- The system presents the extension's SwiftUI view in a sheet and passes a context with this surface:

  ```swift
  protocol TranslationUIProviderContext: Observable {
      var inputText: AttributedString? { get }
      var allowsReplacement: Bool { get }
      func finish(translation: AttributedString?)
      func expandSheet()
  }
  ```

  Apple's article calls `finish(replacingWithTranslation:)`; the SDK method is `finish(translation:)`.
- Streaming LLM calls and interactive UI inside the sheet are proven by a shipping app ([Scripting](https://scriptingapp.github.io/guide/TranslationUIProvider)).
- It receives the selection only, so context awareness is not available here. See the [research](research/context-awareness.md#ios-and-ipados) for a possible bridge from the Safari extension.
- It handles the system "Translate" action on selected text. Apps with their own translation feature keep it.
- Memory and time limits are undocumented.

Sharing between the app and its extensions: settings through an App Group, keys through a shared Keychain access group `[inferred]`. The Safari extension's JavaScript gets what it needs through `sendNativeMessage`.

App Store review: bring-your-own-key apps have been approved ([Pal Chat](https://apps.apple.com/us/app/pal-chat-ai-chat-client/id6447545085)), and some developers report rejections under guideline 3.1.1 ([thread](https://developer.apple.com/forums/thread/763884)). Treat review as a risk.

### Android

Deferred. `ACTION_PROCESS_TEXT` provides the selected text only, so the feature set would match the iOS default-translation path without context.

## Roadmap

1. **Foundation and extension MVP.** Scaffold the repo, build `core` and `providers`, then the Chrome extension: selection translate and define with context, then chat refinement, then page translation.
2. **Desktop spike (one week).** On both macOS and Windows: hotkey → selection and paragraph → a panel that leaves focus in the source app. Outcome: stay on Tauri or switch to Electron.
3. **Desktop MVP.**
4. **iOS and iPadOS.** The SwiftUI app, the default-translation extension, and the Safari extension reusing the build from step 1.
5. **Later.** Local LLMs, OCR-based context, desktop-to-extension context sharing, Android.

## Open risks

| Risk | Plan |
|---|---|
| Tauri cannot deliver a focus-preserving panel on Windows | The desktop spike; Electron fallback |
| The macOS panel depends on a single-maintainer plugin | Same spike; the plugin is small enough to fork or replace |
| Accessibility coverage is lower than estimated in key apps | Measure during the spike; selection-only fallback always works |
| Safari kills the background script mid-request | Short requests, resumable page translation |
| App Store rejects a bring-your-own-key app | Build the iOS app last; keep the extension and desktop independent of it |
| Default-translation extension limits are undocumented | Prototype early in step 4 |
