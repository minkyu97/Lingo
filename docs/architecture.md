# Architecture

Status: in development. Roadmap step 1 is under way: the shared packages and the first slice of the browser extension exist. The sections on the desktop and mobile apps still describe plans.

Background research:

- [Context awareness feasibility](research/context-awareness.md)
- [Platform strategy](research/platform-strategy.md)

`[inferred]` marks points that were not confirmed from a source and need checking during implementation.

## Decisions at a glance

| Topic              | Decision                                                                                                         |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Repository         | One repo for all surfaces, organized as a pnpm workspace                                                         |
| Toolchain          | Node and pnpm versions are pinned in `mise.toml`. Local setup and CI both install from it                        |
| Lint and format    | Biome with its recommended rules, for every language it supports                                                 |
| Tests              | Vitest for unit tests. Playwright for end-to-end tests of the extension                                          |
| Validation         | Zod schemas wherever untyped data becomes typed: messages, stored data, and model output                         |
| Browser extension  | WXT + React + TypeScript; Chrome MV3 first, Safari from the same code. Requires Chrome 140 or later              |
| Desktop            | Tauri 2 for macOS and Windows, sharing the React UI and TypeScript core. Electron is the fallback                |
| iOS / iPadOS       | Native SwiftUI app with a default-translation extension and a Safari Web Extension                               |
| Shared logic       | TypeScript packages for extension and desktop; a thin Swift port for iOS; shared prompts and fixtures in `spec/` |
| LLM access         | Bring your own key. The app calls provider APIs directly; there is no Lingo server                               |
| macOS distribution | Developer ID + notarization, outside the Mac App Store                                                           |
| Build order        | Extension → desktop spike → desktop → iOS                                                                        |

## Repository layout

```
Lingo/
├─ packages/
│  ├─ core/        @lingo/core: domain types, the LLM port, prompt builder, lookup use case
│  ├─ providers/   @lingo/providers: Anthropic and OpenAI adapters, model catalog
│  └─ ui/          @lingo/ui: React components shared by the extension and the desktop app
├─ apps/
│  ├─ extension/   @lingo/extension: WXT app for Chrome, Safari later
│  ├─ desktop/     planned: Tauri 2 for macOS and Windows
│  └─ apple/       planned: Xcode project for iOS/iPadOS, its extensions, and the Swift core
├─ spec/           @lingo/spec: prompt templates, golden prompt cases, provider stream fixtures
└─ docs/
```

Workspace packages export their TypeScript source directly. Nothing is built ahead of time; the consuming app's bundler compiles them.

Releases are tagged per surface: `ext-v*`, `desktop-v*`, `ios-v*`.

## Hexagonal core

`packages/core` holds the domain and defines the ports. It has no platform or provider code: its only dependencies are `@lingo/spec`, which is data, and Zod, for validation. Its `tsconfig.json` leaves the DOM library out, so page and browser APIs do not type-check there.

| Module            | What it holds                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `context.ts`      | `CapturedContext` and `ContextLevel`; `clampContext` and `withoutContext`                                                 |
| `llm.ts`          | The `LLMProvider` port, `ChatRequest` with its optional JSON `format`, and `LLMError` with its kinds                      |
| `prompt.ts`       | `buildLookupRequest`: a system prompt from `spec/prompts.json` plus the user message, and the JSON format for definitions |
| `dictionary.ts`   | `DictionaryEntry` and its schema, `parseDictionaryEntry` for a complete or still-streaming answer, and sense grouping     |
| `partial-json.ts` | `parsePartialJson`: reads as much of a JSON document as has arrived so far                                                |
| `mode.ts`         | `chooseMode`: define a word or short phrase, translate anything longer                                                    |
| `settings.ts`     | `Settings`, its defaults, `normalizeSettings` with its schema, and the offered target languages                           |
| `lookup.ts`       | `prepareLookup`: the use case that applies the settings to a captured context and builds the request                      |

Each app supplies the adapters:

| Port                      | Extension                                          | Desktop (planned)                         | iOS (planned)                         |
| ------------------------- | -------------------------------------------------- | ----------------------------------------- | ------------------------------------- |
| `LLMProvider` (streaming) | `@lingo/providers`                                 | `@lingo/providers`                        | Swift port over URLSession + SSE      |
| Context capture           | DOM, in `apps/extension/src/context/dom.ts`        | Accessibility / UI Automation / clipboard | Selection only; DOM in Safari         |
| Settings and key storage  | `storage.local`, in `apps/extension/src/stores.ts` | App settings file and the OS keychain     | App Group and a shared Keychain group |

Only `LLMProvider` is an interface in `core` today. Context capture and storage are plain functions in the extension that return core types. They become interfaces in `core` when a second app needs to share the code that calls them.

The central types:

```ts
type ContextLevel = "none" | "sentence" | "paragraph" | "document";

interface CapturedContext {
  selection: string;
  level: ContextLevel;
  before?: string; // text immediately before the selection
  after?: string; // text immediately after the selection
  title?: string; // page or window title
  url?: string;
  appName?: string;
}

interface LLMProvider {
  stream(
    request: ChatRequest,
    options?: { signal?: AbortSignal },
  ): AsyncIterable<string>;
}

type LLMErrorKind =
  | "missing_key"
  | "auth"
  | "rate_limit"
  | "refusal"
  | "network"
  | "api";
```

Adapters turn every provider failure into an `LLMError` with one of those kinds, so a UI can react without knowing any SDK.

### Validation

Data that arrives without a trustworthy type goes through a Zod schema, and the TypeScript type is inferred from that schema where the schema defines the shape. This keeps a type and its check from drifting apart.

| Data                           | Schema                            | On bad input                                                        |
| ------------------------------ | --------------------------------- | ------------------------------------------------------------------- |
| Messages from a content script | `apps/extension/src/messaging.ts` | The message is rejected. Optional fields that are wrong are dropped |
| Stored settings                | `normalizeSettings` in `core`     | Each wrong field falls back to its default                          |
| Stored API keys and model IDs  | `perProviderTextSchema` in `core` | Wrong entries are left out                                          |
| A model's dictionary entry     | `packages/core/src/dictionary.ts` | Each missing or wrong field reads as empty                          |

Schemas use the regular `zod` API, chosen for readability over size. It adds about 83 kB to the content script, which is injected into every frame of every page. The tree-shakable `zod/mini` would add about 23 kB, at the cost of a wordier, function-style notation.

Not everything typed `unknown` needs a schema:

- `parsePartialJson` is a parser. Its result is what the dictionary schema checks.
- The adapters classify a thrown error by the SDK's error classes, which is not a question of shape.
- Events from the background to a content script are typed but not checked, because the sender is the extension itself.

### Use cases

| Use case            | What it does                                                                                                                            | Status  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Translate selection | Translates the selection, using context when present                                                                                    | Done    |
| Define in context   | For a word or short phrase: a dictionary entry with the meaning in this sentence when context exists, and the general senses either way | Done    |
| Refine              | Continues the conversation: the original request, the result, and the user's follow-up instructions                                     | Planned |
| Translate page      | Translates a page in batches (extension only)                                                                                           | Planned |

Translate and define share one use case, `prepareLookup`. They differ in the prompt and in the answer: a translation is plain text, and a definition is a dictionary entry as JSON. Chat-based refinement needs no separate mechanism: a lookup is the first turn of a conversation, and refining appends turns to it.

### Context model

Context capture is graded, because platforms differ in what they can provide (see the [feasibility matrix](research/context-awareness.md#feasibility-matrix)).

- Each platform captures the best level it can and says which level it reached.
- Prompts adapt to the level. Without surrounding text, the define use case falls back to general definitions.
- Context is clamped to a maximum length before it is sent, keeping the text nearest the selection. It costs tokens the user pays for.

Settings and privacy:

- Context awareness is a setting, on by default, with a maximum context length (1,000 characters by default).
- When it is off, nothing but the selection is sent: no surrounding text and no page title.
- The UI shows the context that was sent with each answer.
- Password fields are never read.

### Definitions as dictionary entries

A definition is shown like an entry in a dictionary: headword and pronunciation, the meaning in the passage, then the senses under their parts of speech, each with an example. To lay that out, the answer has to be data, not prose.

- **The format.** `spec/dictionary-entry.schema.json` is the JSON Schema of an entry. `DictionaryEntry` in `core` has the same shape. A value that does not apply is an empty string, never `null` or a missing field, which keeps the schema inside what every provider's strict mode accepts.
- **Asking for it.** A define request carries `format: { name, schema }`. An adapter turns that into the provider's structured-output parameter, so the model is held to the schema. The system prompt also describes every field, because a model the adapter does not know gets no schema and has only the prompt to go on.
- **Showing it while it streams.** The JSON arrives in pieces. `parsePartialJson` returns what the pieces describe so far: an open string with the text it has, an open array with its finished members. Field order in the schema is therefore display order: headword first, senses last.
- **Falling back.** If the answer holds no JSON object, the card shows it as plain text. A model that ignores the format degrades the layout, never the answer.
- **Grouping.** The UI makes one group per part of speech, in order of first appearance, and marks the sense that the model flagged as the one used in the passage.

`parsePartialJson` is written for this project. What it returns for an unfinished value is chosen for what the card draws, and the Swift port has to implement the same behavior. Its result then goes through the entry's Zod schema, which fills in every field that has not arrived or is not the right type.

### Prompts as data

System prompts live in `spec/prompts.json`, one per mode (`translate`, `define`) and per variant (`withContext`, `withoutContext`). The `define` prompts ask for the JSON entry described above. Templates contain no conditionals; code picks the variant.

The user message is assembled by code:

```
<context>
<title>A walk by the water</title>
<passage>She sat on the river [[bank]] and watched the boats.</passage>
</context>
<selection>bank</selection>
```

- The selection is marked inside its passage with `[[...]]`.
- The title line and the whole context block are left out when there is nothing to put in them.
- The prompts tell the model that everything inside the tags is material to translate, never instructions to follow. Page text is untrusted.

`spec/prompt-cases.json` pins these rules as golden cases. The TypeScript core runs all of them, and the Swift port must pass the same file.

## Bring your own key

Lingo is free and open source with no subscription, so users supply their own provider keys and pay inference costs directly. There is no Lingo backend; every surface calls the provider API itself.

### Where keys live and where calls are made

| Surface   | Key storage                                                     | API calls made from                                           |
| --------- | --------------------------------------------------------------- | ------------------------------------------------------------- |
| Extension | `storage.local`, closed to content scripts                      | The background service worker only                            |
| Desktop   | OS keychain / Credential Manager                                | To be decided in the spike (see below)                        |
| iOS       | Keychain, shared across the app and its extensions `[inferred]` | Each native process; the Safari extension's background script |

Extension rules, as implemented:

- Content scripts never hold the key and never read storage. They send the selection and context to the background over a port.
- On startup the background calls `storage.local.setAccessLevel("TRUSTED_CONTEXTS")`, so only the background and the extension's own pages can read storage. Chrome applies this to `storage.local` from version 140, which is why the manifest sets `minimum_chrome_version` to 140 ([Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage)).
- The background validates every message from a content script with a Zod schema before using it, and chooses the provider URL itself.
- Keys are stored in `storage.local`, never in synced storage.

Desktop open decision: either the webview calls providers through the shared TypeScript adapters, fetching the key from the Rust side at call time, or a Rust command proxies the HTTP request and injects the key so it never enters JavaScript. The first shares more code; the second keeps the key further from the UI layer.

### Provider adapters

| Adapter                                  | Covers                                                        | Status                                          |
| ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Anthropic                                | Claude models, through the official TypeScript SDK            | Done                                            |
| OpenAI                                   | OpenAI models, through the official SDK and the Responses API | Done                                            |
| OpenAI-compatible with a custom base URL | Local LLMs (Ollama, LM Studio and similar)                    | Planned. The adapters already accept a base URL |

`packages/providers/src/catalog.ts` lists the models offered in settings and imports no SDK, so UI code can use it without bundling one. A model ID can also be typed in by hand.

Both hosted APIs permit cross-origin calls from an extension. In Chrome, calls from the service worker to origins in `host_permissions` skip CORS entirely ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)).

What the Anthropic adapter does. A live run of `pnpm smoke` confirmed these against the API on 2026-11-21:

- The default model is `claude-opus-5-5`. Sonnet 5.5 and Haiku 5.5 are offered as alternatives.
- The client is created with `dangerouslyAllowBrowser`, which also makes the SDK send the `anthropic-dangerous-direct-browser-access` header the API requires from browser origins.
- Requests stream through `messages.stream`. Only text deltas are passed on; thinking blocks are skipped.
- `output_config.effort` is set to `low`, since lookups are simple and a fast first token matters. `thinking` and sampling parameters are not sent.
- When a request has a `format`, its schema is sent as `output_config.format`, which holds the answer to it. This works together with streaming and with the fallback below.
- A refused request (`stop_reason: "refusal"`) becomes an `LLMError` of kind `refusal`. On Opus 5.5 and Sonnet 5.5 the adapter also turns on server-side fallback (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta), so a declined request is retried on another model before it fails. Haiku 5.5 has no server-side fallback, so the parameter is not sent to it.
- `effort`, `format`, and `fallbacks` go only to models in the catalog. A model ID typed in by hand gets a plain request, because some models reject these parameters.

What the OpenAI adapter does, confirmed the same way:

- The default model is `gpt-6.2-sol`. `gpt-6.2-astra` and `gpt-6-luna` are offered as alternatives.
- Requests stream through the Responses API with `store: false`, so the user's text is not kept on OpenAI's side.
- When a request has a `format`, its schema is sent as `text.format` with `strict: true`.

Not done yet: prompt caching. It matters for page translation, where many requests share a prefix. It needs a shared prefix of at least 512 tokens on current Claude models, so the short lookup prompts would not benefit.

There is no official Anthropic SDK for Swift, so the iOS port calls the HTTP API directly. The recorded streams in `spec/fixtures` are its test vectors.

Local servers may need origin configuration before they accept requests from an extension `[inferred]`.

## Surface notes

### Browser extension

Implemented: translate or define the selection, through an in-page floating button or a keyboard shortcut, with a settings page.

Planned: chat refinement, full-page translation, Safari.

How a lookup flows:

1. The content script (`entrypoints/content`) sees a new selection on `mouseup` and shows a small button next to it. The keyboard shortcut (`Alt+Shift+L` by default) skips the button: the background receives the command and messages the tab.
2. `src/context/dom.ts` captures the selection, the text of its enclosing block, the page title, and the URL without its query string.
3. The content script opens a port named `lingo:lookup` to the background and sends `{ type: "start", mode, context }`.
4. `src/lookup-handler.ts` in the background validates the message, loads the settings and the key, calls `prepareLookup`, and streams from the provider.
5. Events come back over the port: `started` (with the context that was actually sent), `delta` for each chunk, then `done` or `error`. A `ping` every 20 seconds keeps the service worker alive while the provider is silent, because Chrome stops a worker after 30 idle seconds.
6. The panel renders the shared `LookupCard` from `@lingo/ui`, which shows a translation as text and a definition as a dictionary entry. Closing the port, by closing the panel or leaving the page, cancels the request.

Where things are in `apps/extension`:

| Path                                          | Role                                                                                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoints/background.ts`                   | Registers listeners: the lookup port, the shortcut, and opening settings                                                               |
| `entrypoints/content/`                        | Selection detection, the button, and the panel, mounted in a shadow root                                                               |
| `entrypoints/options/`                        | The settings page                                                                                                                      |
| `src/messaging.ts`                            | The message types shared by content script and background, and their validation                                                        |
| `src/lookup-handler.ts`                       | The background side of a lookup, written against a small port interface so it is tested without a browser                              |
| `src/lookup-client.ts`, `src/lookup-state.ts` | The content-script side: opening the port, and folding events into panel state                                                         |
| `src/context/dom.ts`                          | DOM context capture                                                                                                                    |
| `src/stores.ts`                               | Settings and key storage                                                                                                               |
| `src/position.ts`                             | Where the button and the panel go. The panel opens below the selection or above it, and its height is limited to the room on that side |
| `e2e/`                                        | Playwright tests and the fake LLM server they run against                                                                              |

Design points:

- **Shadow root.** The UI is mounted with WXT's `createShadowRootUi`, and its styles are injected into the shadow root, so page styles and Lingo's styles cannot affect each other. Sizes are in px, because rem would follow the page's root font size.
- **All frames.** The content script runs in every frame, since a frame only sees its own selection. The UI appears in the frame that holds the selection.
- **Context edge cases.** Selections in text fields are read through the field's own selection API. Context is not captured in the built-in PDF viewer, in canvas editors such as Google Docs, or inside closed shadow roots; lookups there send the selection only. See the [research](research/context-awareness.md#browser-extension-chrome-mv3).
- **Explicit imports.** WXT's auto-imports are off. They would also rewrite the workspace packages that the app consumes as source.
- **End-to-end build.** `wxt build --mode e2e` reads `.env.e2e`, which points the adapters at the fake server. The production build has no such override.

Page translation, when it is built: translate what is near the viewport first rather than the whole page at once, batch paragraphs, cap concurrency, cache by text and target language, and show the user what a page is costing. Details are open.

Safari on iOS and iPadOS will be built from the same code with WXT's Safari target, then packaged with `xcrun safari-web-extension-packager` ([Apple](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)) into the `apps/apple` project. Constraints that affect design:

- The background script is non-persistent and Safari unloads it ([Apple](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)). Developers report it being killed after 30–45 seconds and long fetches failing ([thread](https://developer.apple.com/forums/thread/758346), [thread](https://developer.apple.com/forums/thread/764482)). Keep each request short and make page translation resumable.
- `contextMenus`, `webRequest`, `windows.create` and `side_panel` are unavailable, and `storage.sync` does not sync ([Apple](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)).
- The native text-selection menu cannot be hidden and can cover a page-drawn toolbar. Position Lingo's control away from it.
- Users grant site access per site ([Apple](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions)).
- `sendNativeMessage` works from the background script and extension pages, not from content scripts, and the containing app cannot message the extension's JavaScript ([Apple](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)).
- `storage.local.setAccessLevel` is available for all storage areas from Safari 27.2.

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

| Target                         | Role                                                                         |
| ------------------------------ | ---------------------------------------------------------------------------- |
| App (SwiftUI)                  | Settings, API keys, chat and history                                         |
| Translation provider extension | Makes Lingo selectable as the default translation app                        |
| Safari Web Extension           | Wraps the browser extension build                                            |
| Swift core package             | The Swift port of prompts and provider adapters, shared by the targets above |

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

1. **Foundation and extension MVP.** In progress.
   - Done: the workspace, `core`, `providers`, `ui`, CI, and the extension's selection lookup (translate and define with context).
   - Next: chat refinement, then page translation.
2. **Desktop spike (one week).** On both macOS and Windows: hotkey → selection and paragraph → a panel that leaves focus in the source app. Outcome: stay on Tauri or switch to Electron.
3. **Desktop MVP.**
4. **iOS and iPadOS.** The SwiftUI app, the default-translation extension, and the Safari extension reusing the build from step 1.
5. **Later.** Local LLMs, OCR-based context, desktop-to-extension context sharing, Android.

## Open risks

| Risk                                                                                                  | Plan                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri cannot deliver a focus-preserving panel on Windows                                              | The desktop spike; Electron fallback                                                                                                      |
| The macOS panel depends on a single-maintainer plugin                                                 | Same spike; the plugin is small enough to fork or replace                                                                                 |
| Accessibility coverage is lower than estimated in key apps                                            | Measure during the spike; selection-only fallback always works                                                                            |
| Safari kills the background script mid-request                                                        | Short requests, resumable page translation                                                                                                |
| App Store rejects a bring-your-own-key app                                                            | Build the iOS app last; keep the extension and desktop independent of it                                                                  |
| Default-translation extension limits are undocumented                                                 | Prototype early in step 4                                                                                                                 |
| The content script loads React and Zod into every frame of every page, about 330 kB                   | Measure the effect on page load. If it matters, load the UI on first use, switch to a lighter renderer, or move the schemas to `zod/mini` |
| Automated tests do not press the real Chrome shortcut or call a real provider from the service worker | Check both by hand before a release. `pnpm smoke` covers the adapters against the real APIs from Node                                     |
| A content script on every page lengthens Chrome Web Store review                                      | Accepted: the button has to appear wherever text is selected                                                                              |
