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
│  ├─ core/        @lingo/core: domain types, the LLM port, prompt builder, lookup use case, page translation protocol
│  ├─ providers/   @lingo/providers: Anthropic and OpenAI adapters, and what is known about their models
│  └─ ui/          @lingo/ui: design tokens and React components shared by the extension and the desktop app
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

| Module            | What it holds                                                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `context.ts`      | `CapturedContext` and `ContextLevel`; `clampContext` and `withoutContext`                                                                     |
| `llm.ts`          | The `LLMProvider` port (streaming an answer, checking a key), `ChatRequest` with its optional JSON `format`, and `LLMError` with its kinds    |
| `prompt.ts`       | `buildLookupRequest`: a system prompt from `spec/prompts.json` plus the user message, and the JSON format for definitions                     |
| `dictionary.ts`   | `DictionaryEntry` and its schema, `parseDictionaryEntry` for a complete or still-streaming answer, and sense grouping                         |
| `partial-json.ts` | `parsePartialJson`: reads as much of a JSON document as has arrived so far                                                                    |
| `mode.ts`         | `chooseMode`: define a word or short phrase, translate anything longer                                                                        |
| `settings.ts`     | `Settings`, its defaults, `normalizeSettings` with its schema, the offered target languages with their names, and the offered context lengths |
| `lookup.ts`       | `prepareLookup`: the use case that applies the settings to a captured context and builds the request                                          |

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
  // The models the API key can use, newest first. Generates nothing, and
  // is also how a key is checked.
  listModels(): Promise<ModelInfo[]>;
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

| Data                                    | Schema                                            | On bad input                                                        |
| --------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------- |
| Messages from a content script          | `apps/extension/src/messaging.ts`                 | The message is rejected. Optional fields that are wrong are dropped |
| Page translation requests               | `apps/extension/src/page-translation/protocol.ts` | The request is ignored. A request that is too large counts as wrong |
| Stored tuning of page translation       | `apps/extension/src/page-translation/protocol.ts` | Each wrong value falls back to its default                          |
| Answers to a message                    | `apps/extension/src/messaging.ts`                 | An unexpected answer, or none, reads as "could not be done"         |
| Stored settings                         | `normalizeSettings` in `core`                     | Each wrong field falls back to its default                          |
| Stored engines                          | `enginesSchema` in `core`                         | An engine that is unusable is left out, and the rest stay           |
| Stored API keys                         | `apps/extension/src/stores.ts`                    | Wrong entries are left out                                          |
| Settings from before there were engines | `apps/extension/src/legacy-settings.ts`           | Anything of another shape is not converted                          |
| A model's dictionary entry              | `packages/core/src/dictionary.ts`                 | Each missing or wrong field reads as empty                          |

Schemas use the regular `zod` API, chosen for readability over size. It adds about 83 kB to the content script, which is injected into every frame of every page. The tree-shakable `zod/mini` would add about 23 kB, at the cost of a wordier, function-style notation.

Not everything typed `unknown` needs a schema:

- `parsePartialJson` is a parser. Its result is what the dictionary schema checks.
- The adapters classify a thrown error by the SDK's error classes, which is not a question of shape.
- Events from the background to a content script over a port are typed but not checked, because the sender is the extension itself.
- A translated segment of a page is read by `parseMarkup`, and its tags are then checked one by one against the page's own elements. See [Page translation protocol](#page-translation-protocol).

### Use cases

| Use case            | What it does                                                                                                                            | Status  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Translate selection | Translates the selection, using context when present                                                                                    | Done    |
| Define in context   | For a word or short phrase: a dictionary entry with the meaning in this sentence when context exists, and the general senses either way | Done    |
| Refine              | Continues the conversation: the original request, the result, and the user's follow-up instructions                                     | Planned |
| Translate page      | Translates the text of a page near the viewport, in batches of paragraph-sized segments (extension only)                                | Done    |

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

The prompt for page translation is in the same file, under `pageTranslation`. It has no golden cases, because page translation exists in the extension only.

### Page translation protocol

A page is translated in segments: one paragraph-sized piece of text each. `packages/core/src/page-translation.ts` defines how a segment travels to the model and back. It handles text only and knows nothing of the DOM.

Formatting and links inside a segment become numbered inline tags, so that the model can move them to where they belong in the translated sentence:

```
<seg id="1">To <g1>start the server</g1>, run <k2>npm start</k2>.<x3/></seg>
```

- `<gN>…</gN>` is a group: text with its own formatting, or a link. Its text is translated.
- `<kN>…</kN>` is kept text, such as code. The model sees it, so that the sentence around it comes out right, and copies it unchanged.
- `<xN/>` stands for something that is not text, such as an image or a line break.
- The characters `<`, `>` and `&` of the page's own text are escaped, so a tag can always be told from text.

A request holds several segments in page order, and the page's title for reference. The answer holds the same segments, translated. `createSegmentReader` reads them out of the stream as each one is completed, and ignores anything outside a segment. `parseMarkup` turns the text of a segment into a tree of text and tags.

## Shared UI

`packages/ui` holds the design system as code: tokens, controls, and the two things built from them. It uses no browser extension API, so the desktop app can render the same components.

| Path            | What it holds                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/styles/`   | `tokens.css` (color, space, radius, shadow, and type, as CSS custom properties with light and dark values) and one stylesheet per group below |
| `src/controls/` | Button, text button, icon button, segmented control, switch, badge, callout, text field, search field, messages                               |
| `src/lookup/`   | `LookupCard`, `DictionaryEntryView`, and `LookupTrigger`                                                                                      |
| `src/settings/` | `SettingsPanel`: a list of settings and a screen for each one that needs more than a row                                                      |
| `src/page/`     | What page translation shows in a page: `PageBar`, and the tones and the timing of the text placeholder                                        |
| `src/Logo.tsx`  | The logo, an apple, with and without a face                                                                                                   |

- **Tokens.** Every component tree starts at an element with the class `lingo`, which sets the tokens. Their names and values mirror the variables of the Lingo design file, so a design and its implementation use the same words.
- **Stylesheets.** `@lingo/ui/lookup.css` and `@lingo/ui/settings.css` each bring the tokens and the controls. The content script, which is injected into every page, imports the first, and after it `@lingo/ui/page.css`, which holds the page bar and relies on what the first one brought.
- **Icons** come from `lucide-react`, drawn at the design's stroke weight by the `Icon` component.
- **No state of its own.** `SettingsPanel` is given the settings and reports each change. The app stores them, which is why there is no Save button to wire up.

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
- The key is typed and shown only in the extension's own pages: the settings in a tab, or the same settings in an iframe inside a web page. Neither the page nor the content script that draws the iframe can read into it.
- A key is stored only after its provider has accepted it. The settings page hands the key to the background, which asks the provider, so the settings page bundles no provider SDK. A key the provider refuses, or that could not be checked, is not stored.
- On startup the background calls `storage.local.setAccessLevel("TRUSTED_CONTEXTS")`, so only the background and the extension's own pages can read storage. Chrome applies this to `storage.local` from version 140, which is why the manifest sets `minimum_chrome_version` to 140 ([Chrome](https://developer.chrome.com/docs/extensions/reference/api/storage)).
- The background validates every message from a content script with a Zod schema before using it, and chooses the provider URL itself.
- Keys are stored in `storage.local`, never in synced storage.

Desktop open decision: either the webview calls providers through the shared TypeScript adapters, fetching the key from the Rust side at call time, or a Rust command proxies the HTTP request and injects the key so it never enters JavaScript. The first shares more code; the second keeps the key further from the UI layer.

### Engines

A user sets up engines, and chooses one for each task. `packages/core/src/engines.ts` defines them.

- **An engine** is a provider, one of its models, and an API key, under a name. It can also carry extra request parameters. A user adds as many as they like, also several of one provider.
- **A task** is one of the things Lingo does with a model: translating a selection, defining a word or phrase, and translating a page. Each has an engine of its own, and they need not share a provider. A task for which none is chosen uses the first engine, so the first engine that is added does everything.
- **Keys are stored apart from engines**, by engine ID, so that the settings can go where a key must not. A new engine of a provider that already has one starts with that engine's key filled in.
- **The model list comes from the key.** The settings ask the provider which models the key can use, and offer those, newest first. Lingo keeps no list of its own to fall behind. A model ID can also be typed by hand.
- **What a model accepts** is stored with the engine when the model is picked from the list, where the provider says it. See the adapters below for how it is used.
- **Removing an engine** hands its tasks to the first engine that is left.
- **Before there were engines** the settings held one provider for everything, a model per provider, and a key per provider. On the first read after an update those become engines, and the old keys are removed: the selected provider's lookup model and page model become its engines and take over the tasks, and another provider with a key becomes an engine too.

Not offered: a custom API address for an engine. Each address needs access to its site granted, so it belongs with local model support.

### Provider adapters

| Adapter                                  | Covers                                                        | Status                                          |
| ---------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------- |
| Anthropic                                | Claude models, through the official TypeScript SDK            | Done                                            |
| OpenAI                                   | OpenAI models, through the official SDK and the Responses API | Done                                            |
| OpenAI-compatible with a custom base URL | Local LLMs (Ollama, LM Studio and similar)                    | Planned. The adapters already accept a base URL |

`packages/providers/src/catalog.ts` holds what is known about a provider without asking it: its name, where to get a key, and what the models Lingo knows by name accept. It imports no SDK, so UI code can use it without bundling one. Which models a key can use is asked of the provider. See [Engines](#engines).

Both hosted APIs permit cross-origin calls from an extension. In Chrome, calls from the service worker to origins in `host_permissions` skip CORS entirely ([Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)).

What the Anthropic adapter does. A live run of `pnpm smoke` confirmed these against the API on 2026-11-21:

- The model is the engine's. Without one, as in a key check, it is `claude-opus-5-5`.
- The client is created with `dangerouslyAllowBrowser`, which also makes the SDK send the `anthropic-dangerous-direct-browser-access` header the API requires from browser origins.
- Requests stream through `messages.stream`. Only text deltas are passed on; thinking blocks are skipped.
- `output_config.effort` is set to `low`, since lookups are simple and a fast first token matters. `thinking` and sampling parameters are not sent.
- When a request has a `format`, its schema is sent as `output_config.format`, which holds the answer to it. This works together with streaming and with the fallback below.
- A refused request (`stop_reason: "refusal"`) becomes an `LLMError` of kind `refusal`. On Opus 5.5 and Sonnet 5.5 the adapter also turns on server-side fallback (`fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta), so a declined request is retried on another model before it fails. Haiku 5.5 has no server-side fallback, so the parameter is not sent to it.
- `effort` and `format` go to models in the catalog, and to models that the provider's own list says accept them. `fallbacks` goes only to models in the catalog. Any other model gets a plain request, because some models reject these parameters.

What the OpenAI adapter does, confirmed the same way:

- The model is the engine's. Without one it is `gpt-6.2-sol`. OpenAI does not say what a model accepts, so a schema is sent only to the models in the catalog.
- Requests stream through the Responses API with `store: false`, so the user's text is not kept on OpenAI's side.
- When a request has a `format`, its schema is sent as `text.format` with `strict: true`.

Listing models, in both adapters: `listModels` asks the provider which models the key can use. That needs a valid key and generates nothing, so it costs nothing, and it is also how a key is checked. It waits 10 seconds and tries again once at most, because someone is watching a spinner. A refusal becomes an `LLMError` of kind `auth`; any other failure leaves the question open. Anthropic lists text models only, newest first, with a name for each and what each accepts. OpenAI lists every model of the account by ID only, speech and image models among them, so the adapter keeps the ones that answer text and sorts them by date. A live run of `pnpm smoke` confirmed on 2026-11-26 that a real key lists its models (14 for Anthropic, 52 text models for OpenAI) and that a made-up key is refused.

Extra parameters: an engine can carry a JSON object that is merged into every request, over what the adapter sets itself. It is for what Lingo offers no setting for, such as a temperature. The OpenAI adapter still asks for a stream whatever the parameters say, because that is how it reads the answer.

Not done yet: prompt caching. It matters for page translation, where many requests share a prefix. It needs a shared prefix of at least 512 tokens on current Claude models, so the short lookup prompts would not benefit.

There is no official Anthropic SDK for Swift, so the iOS port calls the HTTP API directly. The recorded streams in `spec/fixtures` are its test vectors.

Local servers may need origin configuration before they accept requests from an extension `[inferred]`.

## Surface notes

### Browser extension

Implemented: translate or define the selection, through an in-page floating button or a keyboard shortcut, in a popup that can be moved and pinned; settings that open in a panel inside the page; and page translation, turned on from that panel or a keyboard shortcut, with paragraphs shown as gray bars while they wait and a bar at the bottom of the page for turning it off again.

Planned: chat refinement, Safari.

How a lookup flows:

1. The content script (`entrypoints/content`) sees a new selection on `mouseup` and shows a small button next to it. The keyboard shortcut (`Alt+Shift+L` by default) skips the button: the background receives the command and messages the tab.
2. `src/context/dom.ts` captures the selection, the text of its enclosing block, the page title, and the URL without its query string.
3. The content script opens a port named `lingo:lookup` to the background and sends `{ type: "start", mode, context }`.
4. `src/lookup-handler.ts` in the background validates the message, loads the settings and the key, calls `prepareLookup`, and streams from the provider.
5. Events come back over the port: `started` (with the context that was actually sent), `delta` for each chunk, then `done` or `error`. A `ping` every 20 seconds keeps the service worker alive while the provider is silent, because Chrome stops a worker after 30 idle seconds.
6. The popup renders the shared `LookupCard` from `@lingo/ui`, which shows a translation as text and a definition as a dictionary entry. Closing the port, by closing the popup or leaving the page, cancels the request.

The popup:

- **Moving.** Dragging the header moves the popup; six dots in the middle of the header say so. A moved popup stays where it was put, also when its mode is switched.
- **Pinning.** A popup normally closes on Escape or on a click outside it. While pinned it closes only from its Close button, and a new lookup shows in it where it already is. There is one popup per frame at a time.

How the settings open:

1. The toolbar button has no popup, so pressing it fires `action.onClicked` in the background.
2. The background asks the top frame of that tab to toggle its settings drawer (`src/settings-drawer.ts`). When nothing answers, it waits a moment for a page that is still loading, and then starts the content script in that tab itself. That is the case in a tab that was open before the extension was installed or updated. Only where no script may run, as on a browser page, does it open the settings in a tab instead.
3. The content script draws the drawer: a panel on the right edge of the page that holds an iframe of `settings-drawer.html`, an extension page.
4. That page asks the background whether a drawer was just opened in its tab, and shows the settings only if so. See "The settings drawer" below for why.
5. The drawer closes on a second press of the toolbar button, on Escape, or from its Close button. The lookup popup's "Open settings" button opens the same drawer.

The settings have no Save button. Each change is stored as it is made. A new engine is the exception: it exists once "Add engine" is pressed, and an API key is stored only after its provider has accepted it.

How a page is translated:

1. The first row of the settings panel, or the keyboard shortcut (`Alt+Shift+P` by default), asks the background to translate the page. The background passes that to the top frame of the tab, which turns its translation on, and then tells the other frames of the tab to do the same. Each frame translates its own text. See "One switch per tab" below.
2. The frame's content script opens a port named `lingo:page-translation`. The background answers with the options, and the script splits the text of the page into units (`src/page-translation/units.ts`). Each run of text and inline elements between two block-level elements is one unit, roughly a paragraph. Code, form fields, and what the page marks as not to be translated (`translate="no"`, `notranslate`) are left out.
3. An `IntersectionObserver` says which units are on screen or within one screen of it. Only those are queued. A unit that is scrolled past before its turn comes is taken off the queue again.
4. Before each request the content script asks the background for a permit. The background grants permits at the rate in the settings, three per second by default, from one limiter for all tabs and frames, since they share one API key. With a permit, the script picks the units closest to the viewport, up to about 1,500 characters of text, and sends them as segments. Units with the same text share a segment.
5. `src/page-translation/handler.ts` in the background loads the settings and the key, builds the request, and streams from the provider, with the model chosen for pages. Each translated segment goes back over the port as soon as the model has finished it, so paragraphs fill in one by one.
6. `src/page-translation/rewrite.ts` writes the translation into the page. See "The page's own nodes" below.
7. A `MutationObserver` follows the page. New content, such as more comments, is split into units and translated when it comes near. A unit that the page itself rewrites is put back and read again.
8. While the page is translated, a bar floats at the bottom of the top frame. It names the language and offers "Show original". When translation cannot go on, the bar says why and offers the way out: the settings for a missing or rejected key, another try when the provider could not be reached.
9. Turning translation off puts every unit back: the same nodes, in the same order, with the same text. Translations are remembered for as long as the page lives, so turning it on again needs no request.

Where things are in `apps/extension`:

| Path                                          | Role                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entrypoints/background.ts`                   | Registers listeners: the lookup port, the shortcut, the toolbar button, key checks, and the settings drawer                                                         |
| `entrypoints/content/`                        | Selection detection, the button, the popup, the settings drawer, and the page bar, mounted in a shadow root. Also sets up page translation for its frame            |
| `entrypoints/options/`                        | The settings as a page of their own, in a tab                                                                                                                       |
| `entrypoints/settings-drawer/`                | The settings as shown inside the in-page drawer                                                                                                                     |
| `src/settings/`                               | `SettingsApp`: the shared settings panel connected to storage and to the background. Both settings pages render it                                                  |
| `src/messaging.ts`                            | The message types shared by the content script, the pages, and the background, and their validation                                                                 |
| `src/lookup-handler.ts`                       | The background side of a lookup, written against a small port interface so it is tested without a browser                                                           |
| `src/lookup-client.ts`, `src/lookup-state.ts` | The content-script side: opening the port, and folding events into popup state                                                                                      |
| `src/key-check.ts`                            | Checking an API key and listing its models: the background side, which asks the provider, and the settings side, which asks the background                          |
| `src/engine-provider.ts`                      | Building the provider for a task from the engine chosen for it and that engine's key                                                                                |
| `src/legacy-settings.ts`                      | Turning settings from before there were engines into engines, once                                                                                                  |
| `src/settings-drawer.ts`                      | The background side of the drawer: passing requests to the top frame, falling back to a tab, and the grant for the page in the drawer                               |
| `src/context/dom.ts`                          | DOM context capture                                                                                                                                                 |
| `src/page-translation/units.ts`               | Splitting a page into units, and writing each unit as text with inline tags                                                                                         |
| `src/page-translation/rewrite.ts`             | Writing a translation into the page's own nodes, and putting the original back                                                                                      |
| `src/page-translation/translator.ts`          | The content-script side of page translation: what is near the viewport, the queue, following the page as it changes, and turning off                                |
| `src/page-translation/placeholders.ts`        | The gray bars over text that is waiting for its translation                                                                                                         |
| `src/page-translation/switch.ts`              | The background side of turning page translation on and off: the top frame decides, and the other frames and the settings are told                                   |
| `src/page-translation/bar.ts`                 | What the page bar says for each state of a translation, and the one thing it offers to do                                                                           |
| `src/page-translation/handler.ts`             | The background side: permits at the configured rate from `rate-limiter.ts`, and the stream of translated segments                                                   |
| `src/page-translation/protocol.ts`            | The messages of the page translation port, the options, and their validation                                                                                        |
| `src/stores.ts`                               | Storage of the settings, and of one API key per engine                                                                                                              |
| `src/position.ts`, `src/drag.ts`              | Where the button and the popup go. The popup opens below the selection or above it, or where it was dragged, and stays in the viewport                              |
| `e2e/`                                        | Playwright tests, the helpers they share, and the fake LLM server they run against. Also the live check of page translation, which is not a test and is run by hand |

Design points:

- **Shadow root.** The UI is mounted with WXT's `createShadowRootUi`, and its styles are injected into the shadow root, so page styles and Lingo's styles cannot affect each other. Sizes are in px, because rem would follow the page's root font size.
- **All frames.** The content script runs in every frame, since a frame only sees its own selection. The popup appears in the frame that holds the selection. The settings drawer belongs to the top frame only.
- **The settings drawer.** The settings hold an API key, so they are an extension page in an iframe and not part of the content script's own UI. A web page can only hold an extension page in an iframe when it is listed in `web_accessible_resources`, and that lets any page do so, for instance to trick someone into pressing things in it. So the background notes the tab each time it opens a drawer, and the page inside shows the settings only when the background confirms it, once, within ten seconds. Any other frame shows a button that opens the settings in a tab. Only `settings-drawer.html` is listed; the options page cannot be framed. A page's content security policy does not stop the drawer: an end-to-end test opens it under `frame-src 'none'`.
- **Starting the content script by hand.** The manifest asks for `activeTab` and `scripting` for one purpose: pressing the toolbar button grants access to that tab, and the background uses it to start the content script where the browser did not. A second copy of the script replaces the first, so the stale one in an updated tab is cleaned up.
- **Context edge cases.** Selections in text fields are read through the field's own selection API. Context is not captured in the built-in PDF viewer, in canvas editors such as Google Docs, or inside closed shadow roots; lookups there send the selection only. See the [research](research/context-awareness.md#browser-extension-chrome-mv3).
- **Explicit imports.** WXT's auto-imports are off. They would also rewrite the workspace packages that the app consumes as source.
- **End-to-end build.** `wxt build --mode e2e` reads `.env.e2e`, which points the adapters at the fake server. The production build has no such override.

Design points of page translation:

- **The page's own nodes.** A translation is written into the text nodes the page already has, and the page's inline elements are moved to follow the new word order. No node of the page is removed or given another parent. So every style, link, and event listener stays, and the page's own scripts find their nodes where they left them, which matters on a site built with a framework. Elements are moved with `moveBefore` where the browser has it, which does not reset them. The translator's own changes do not count as changes of the page: it throws away the mutation records of what it wrote.
- **Tags that do not fit.** A model does not always return the tags it was given. A tag that the segment did not have, a tag used twice, or a tag inside the wrong tag is taken off, and its words stay. A translation that lacks a tag cannot be mended, because there is no telling where that element belongs. The unit is then sent once more, in a request of its own. If the second answer lacks a tag too, it is used all the same: the paragraph shows translated, and an element whose tag is missing stays in the page after the text, a link or bold text without its words, kept text or an image as it is.
- **An engine for pages.** Page translation has an engine of its own, apart from the ones for lookups, because the tasks pull in different directions: a lookup is one short request that deserves the strongest model, and a page is many requests that someone is waiting to read. In live runs a screen and the one below it took about 5 seconds with Claude Haiku 5.5 and about 11 with Claude Opus 5.5. Nothing picks a fast engine for the user: the first engine does every task until another is chosen.
- **One setting, two knobs.** The settings panel offers the request rate (1, 2, 3, 5, or 10 per second). How far ahead of the viewport text is translated, and how much text goes into one request, are not settings. They are stored apart, as tuning, with defaults that are meant to be right, and end-to-end tests change them to make a small page behave like a large one.
- **One switch per tab.** Whether a page is translated is decided in its top frame, where the page bar is. The panel, the page bar, and the shortcut all send the same message, `page-translation`, to the background, and `src/page-translation/switch.ts` passes it to the top frame. What comes of it goes to the other frames (`page-translation-set`) and to the extension's own pages (`page-translation-changed`), so that the panel's row follows a change made with the shortcut. A frame that loads later asks, and joins in. When an API key is saved in the panel, the panel asks for another try, so a translation that stopped for want of a key goes on by itself.
- **Text that is waiting.** A paragraph shows as gray bars from the moment it is queued until its translation is written, so the reader sees what is on its way. The bars are CSS custom highlights (`placeholders.ts`): the browser paints them on the text itself, one bar per line and exactly as wide, and they scroll, clip, and stack as the text does. Nothing is added to the page's elements; the rules go in through `adoptedStyleSheets`. A highlight cannot be animated, so the pulse is made by moving each group of text from one color to the next every 170 ms, with neighbouring paragraphs a step apart. The bars have square corners and one flat color for the same reason. With reduced motion they hold still.
- **Looking ahead.** The observer's margin is set as `scrollMargin`, in pixels. That widens the viewport and every scrolling box inside the page alike. A `rootMargin` on top of it would count twice for the page itself: an end-to-end test caught text five screens away being translated.
- **Coming back after the worker stops.** The browser stops an idle service worker, which closes the port. The content script then opens a new port and sends again what was in progress. After three closings in a row it gives up.
- **A page that never rests.** An element whose text the page rewrites again and again is read at most eight more times, and then left alone. Without that, a clock or a counter would be translated without end.
- **Failures.** When the provider says to slow down, or cannot be reached, the queue waits five seconds and tries once more. A second failure of that kind, a missing or rejected API key, or any other error of the provider stops the queue: what was waiting shows its own text again, the page bar says what is wrong, and nothing more is sent until the user has acted. A paragraph that the model declines is skipped, and the rest goes on.

Not built yet: showing what a page costs, prompt caching for the instructions that every request repeats, a cap on requests in progress at once, and skipping text that is already in the target language.

A live run on 2026-11-24, with real models on real pages (`pnpm live:page-translation`), from English into Korean:

| Model             | Segments with tags that came back wrong | Paragraphs left untranslated | Screen and one screen ahead, translated |
| ----------------- | --------------------------------------- | ---------------------------- | --------------------------------------- |
| Claude Haiku 5.5  | 10 of 67                                | 2 of 132                     | 4.9 s                                   |
| Claude Sonnet 5.5 | 2 of 48                                 | 1 of 117                     | 8.2 s                                   |
| Claude Opus 5.5   | 0 of 48                                 | 0                            | 11.1 s                                  |
| GPT-6.2 Sol       | 0 of 49                                 | 0                            | 13.5 s                                  |

These are from a Wikipedia article, where a paragraph can hold twenty links. At the time of the run a paragraph whose second answer lacked a tag was left untranslated; it is now shown translated without what the tag stood for. On an MDN page, a Hacker News thread, and react.dev, Claude Haiku 5.5 returned every tag. Links and code came through unchanged on all four, and so did the restored page. On react.dev, following a link that swaps the content without loading a page caused no error, and the new content was translated.

A second run on 2026-11-25, with the finished feature and its default model for pages, Claude Haiku 5.5, on the same four pages: every paragraph near the viewport was translated, and no page raised an error. On the Wikipedia article 4 of 130 paragraphs were shown without a link that the model had lost twice; the other three pages lost nothing. A screen and the one below it took 4 to 7 seconds.

Safari on iOS and iPadOS will be built from the same code with WXT's Safari target, then packaged with `xcrun safari-web-extension-packager` ([Apple](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari)) into the `apps/apple` project. Constraints that affect design:

- The background script is non-persistent and Safari unloads it ([Apple](https://developer.apple.com/documentation/safariservices/optimizing-your-web-extension-for-safari)). Developers report it being killed after 30–45 seconds and long fetches failing ([thread](https://developer.apple.com/forums/thread/758346), [thread](https://developer.apple.com/forums/thread/764482)). Keep each request short. Page translation already sends again what was in progress when its port closes.
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
   - Done: the workspace, `core`, `providers`, `ui`, CI, the extension's selection lookup (translate and define with context) in a popup that can be moved and pinned, and settings that open inside the page.
   - Done as well: page translation, with its page bar, its row in the panel, and its settings.
   - Next: chat refinement.
2. **Desktop spike (one week).** On both macOS and Windows: hotkey → selection and paragraph → a panel that leaves focus in the source app. Outcome: stay on Tauri or switch to Electron.
3. **Desktop MVP.**
4. **iOS and iPadOS.** The SwiftUI app, the default-translation extension, and the Safari extension reusing the build from step 1.
5. **Later.** Local LLMs, OCR-based context, desktop-to-extension context sharing, Android.

## Open risks

| Risk                                                                                                                                                                                                  | Plan                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tauri cannot deliver a focus-preserving panel on Windows                                                                                                                                              | The desktop spike; Electron fallback                                                                                                                                                                              |
| The macOS panel depends on a single-maintainer plugin                                                                                                                                                 | Same spike; the plugin is small enough to fork or replace                                                                                                                                                         |
| Accessibility coverage is lower than estimated in key apps                                                                                                                                            | Measure during the spike; selection-only fallback always works                                                                                                                                                    |
| Safari kills the background script mid-request                                                                                                                                                        | Short requests. Page translation sends again what was in progress when its port closes                                                                                                                            |
| App Store rejects a bring-your-own-key app                                                                                                                                                            | Build the iOS app last; keep the extension and desktop independent of it                                                                                                                                          |
| Default-translation extension limits are undocumented                                                                                                                                                 | Prototype early in step 4                                                                                                                                                                                         |
| The content script loads React, Zod, and the page translation engine into every frame of every page, about 366 kB                                                                                     | Measure the effect on page load. If it matters, load the UI on first use, switch to a lighter renderer, or move the schemas to `zod/mini`                                                                         |
| Automated tests do not press the real Chrome shortcut, or call a real provider from the service worker                                                                                                | Check both by hand before a release. The toolbar button is pressed for real, through the browser's debugging protocol. `pnpm smoke` covers the adapters against the real APIs from Node                           |
| A web page can imitate the settings drawer to ask for a key, or cover the real one                                                                                                                    | Accepted for now. A page cannot read the real drawer or the stored key, but nothing stops it from drawing a fake one. Revisit before a public release                                                             |
| After an install or update, the selection button and the page translation shortcut do not work in tabs that were already open, until the tab is reloaded or the toolbar button is pressed there       | Accepted for now. Starting the content script in every open tab would need access to all sites up front `[inferred]`                                                                                              |
| Claude Opus 5.5 at low effort once wrote its reasoning into a translation, inside `<thinking>` tags (seen in `pnpm smoke` on 2026-11-24)                                                              | Not fixed for lookups. Find out how often it happens, then tighten the translate prompt or strip the tags, and make the smoke check fail on it. Page translation ignores what a model writes outside its segments |
| A small model leaves out or repeats inline tags in a paragraph with many links, and such a paragraph loses a link or some formatting when it is translated (see the live run under Browser extension) | Mending and a second try bring it down to about one paragraph in a hundred on such a page. What is lost comes back with Show original. A stronger model can be chosen for pages in the settings                   |
| Page translation writes into nodes that a page's own scripts manage                                                                                                                                   | No node is removed or given another parent, and a paragraph the page rewrites is read again. Checked by hand on one site built with React. Check more sites before a release                                      |
| Every page translation request repeats its instructions, about 600 tokens                                                                                                                             | Prompt caching, once a request's shared prefix is long enough for it `[inferred]`                                                                                                                                 |
| A content script on every page lengthens Chrome Web Store review                                                                                                                                      | Accepted: the button has to appear wherever text is selected                                                                                                                                                      |
