# Platform Strategy: Repository Layout and Framework Choice

Researched 2026-11-21.

Lingo has three surfaces: a browser extension, a desktop app for macOS and Windows, and a mobile app for iOS and iPadOS (Android later). This document answers two questions:

1. One repository, or one per surface?
2. One cross-platform framework for macOS, Windows, iOS and iPadOS, or native apps with a shared core?

**Reading the claims.** Statements with a link were checked against that source. `[inferred]` marks reasoning or recollection that was not confirmed from a source.

## Decisions

- **One repository** for all surfaces.
- **A hybrid stack**: a TypeScript browser extension, a Tauri 2 desktop app that shares TypeScript and React code with the extension, and a native SwiftUI app for iOS and iPadOS.
- **No FFI-based shared core.** The extension and desktop app share TypeScript packages. iOS gets a thin Swift port, kept in step through shared prompt templates and test fixtures.

Two constraints shaped these:

- macOS and Windows must ship together from the first desktop release.
- The browser extension is built first.

## What each surface needs

| Surface | Needs |
|---|---|
| Browser extension (Chrome MV3, Safari on iOS) | Full-page translation; translate or define the selection through a hotkey and an in-page floating component |
| Desktop (macOS, Windows) | Global hotkey; read the selection and surrounding text from any app; a floating window that does not steal focus from the source app; menu-bar or tray presence; settings; streaming chat; secure key storage |
| Mobile (iOS, iPadOS) | A main app for settings, keys and chat; an extension that registers Lingo as the system default translation app; a Safari Web Extension |

## Repository: one repo

Reasons:

- **Atomic changes.** A prompt or provider-adapter change lands in the extension and the desktop app in one commit.
- **The Safari extension is the Chrome extension.** The iOS project's Safari Web Extension target wraps the extension's build output. In one repo that is a relative path.
- **One spec for two languages.** The TypeScript and Swift implementations test against the same prompt templates and fixtures in `spec/`.
- **One place for a solo open-source project.** Issues, pull requests and CI are not split across repos.

Costs, and how to contain them:

- Three toolchains (Node, Cargo, Xcode) make CI more involved. Use path filters so each surface builds only when its inputs change.
- Releases are per surface. Use tag prefixes: `ext-v*`, `desktop-v*`, `ios-v*`.

Precedents:

- openai-translator builds its browser extension, Tauri desktop app and Safari target from one TypeScript repo ([source tree](https://github.com/openai-translator/openai-translator/tree/main/src)).
- Bitwarden and Signal split clients across repos while sharing a Rust library ([Bitwarden SDK](https://github.com/bitwarden/sdk-internal), [libsignal](https://github.com/signalapp/libsignal)). They have separate teams per client, which does not apply here `[inferred]`.

The layout is in [architecture.md](../architecture.md).

## Framework options

| Option | Desktop system integration | iOS extension fit | Code shared with the browser extension | Solo-developer effort |
|---|---|---|---|---|
| (a) Tauri 2 for desktop and mobile | Good on macOS, fair on Windows | Poor: extensions are Swift regardless | High | Medium, plus a hidden Swift cost |
| (b) Electron, desktop only | Good | — | High | Low to medium; large binary |
| (c) Flutter | Poor to fair | Poor | None | High |
| (d) React Native with desktop forks | Fair | Poor | Logic only | High |
| (e) Kotlin Multiplatform / Compose | Poor to fair (JVM) | Fair, logic only | Low | High |
| (f) Native per platform + Rust core | Excellent | Excellent | Core only, via WASM | Highest |
| **(g) Hybrid — chosen** | Good | Excellent | High: core and UI | Medium |

### (a) Tauri 2 everywhere

- The non-activating panel on macOS comes from the community plugin `tauri-nspanel`. It is actively maintained (v2.1.1 on 2026-10-08) and appears to have a single maintainer ([commits](https://github.com/ahkohd/tauri-nspanel/commits/v2.1)).
- On Windows, tao 0.34.1 added unfocusable windows ([release](https://v2.tauri.app/release/tao/v0.34.1/)). Whether this keeps focus in the source app with WebView2 is not confirmed.
- Global shortcuts are an official plugin ([docs](https://v2.tauri.app/plugin/global-shortcut/)).
- Reading selected text is the weak spot. Pot's `selection` crate was archived on 2026-09-07 ([repo](https://github.com/pot-app/Selection)). `get-selected-text` last released in May 2024 and on Windows only simulates Ctrl+C ([lib.rs](https://lib.rs/crates/get-selected-text)). `selection-capture` 0.1.5 lists its Windows UI Automation support as beta ([docs.rs](https://docs.rs/crate/selection-capture/latest)).
- Tauri has no official iOS app-extension support. Community plugins tell you to add the extension target by hand in Xcode ([example](https://docs.rs/crate/tauri-plugin-mobile-sharetarget/latest)). Apple's default-translation sample is a SwiftUI scene ([Apple](https://developer.apple.com/documentation/translationuiprovider/preparing-your-app-to-be-the-default-translation-app)). On iOS, Tauri would cover only the main app's UI, while the extensions that carry most of the value stay in Swift `[inferred]`.

### (b) Electron, desktop only

- `BrowserWindow({type: 'panel'})` creates an NSPanel natively ([gist](https://gist.github.com/ibash/2c9894a8038b71456aeabe413e532c19)), and Electron fixed panels activating the app after macOS Sonoma ([commit](https://ayakael.net/mirrors/electron/commit/1b6e7768fed40acb137e0a7dd0ecb4ce70be7d64)).
- TypeScript code moves over unchanged. Accessibility and UI Automation access would need Node native addons `[inferred]`.
- The costs are binary size and memory, which matter for an always-running utility `[inferred]`.

### (c) Flutter

- Desktop multi-window was only previewed in Flutter 3.44; on stable the windowing classes are internal ([Flutter](https://flutter.dev/blog/whats-new-in-flutter-3-44)).
- Flutter's own docs say to modify an app extension's UI only when the extension supports at least 100 MB of memory ([docs](https://docs.flutter.dev/platform-integration/ios/app-extensions)).
- Nothing is shared with the browser extension, and it adds a third language.

### (d) React Native with desktop forks

- react-native-windows 0.85 (October 2026) requires Visual Studio 2026 and .NET 10 ([article](https://visualstudiomagazine.com/articles/2026/10/27/react-native-windows-0-85-removes-legacy-architecture.aspx)). react-native-macos is at 0.83.0 and trails it ([releases](https://github.com/microsoft/react-native-macos/releases)).
- React Native's footprint is a known problem within share-extension memory limits ([write-up](https://medium.com/kraaft-co/how-i-reached-the-limits-of-react-native-by-implementing-an-ios-share-extension-4f312b534f22)).

### (e) Kotlin Multiplatform / Compose Multiplatform

- Compose for iOS has been stable since 1.8.0 ([JetBrains](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/)).
- Desktop runs on the JVM, so the panel, Accessibility and UI Automation would all need JNI/JNA work `[inferred]`.
- Consuming a Kotlin core from a TypeScript extension is awkward.

### (f) Native per platform with a Rust core

- UniFFI supports async functions and async foreign traits for Swift and Kotlin ([docs](https://mozilla.github.io/uniffi-rs/latest/futures.html)). There is no first-class stream type, so token streaming means a callback interface or polling `[inferred]`.
- The C# bindings describe themselves as young, with unclear stability ([repo](https://github.com/NordSecurity/uniffi-bindgen-cs)).
- WASM in an MV3 extension needs `'wasm-unsafe-eval'` in the extension-pages CSP, which the Chrome Web Store allows ([docs](https://developer.chrome.com/docs/extensions/mv3/manifest/content_security_policy/)).
- This is three UI stacks plus an FFI toolchain.

### (g) Hybrid — chosen

| Surface | Stack | Why |
|---|---|---|
| Browser extension | WXT + React + TypeScript | See "Extension framework" below |
| Desktop (macOS + Windows) | Tauri 2, sharing the React UI and TypeScript core with the extension | Simultaneous support needs one desktop codebase. A lighter runtime suits an always-running utility |
| iOS / iPadOS | Native SwiftUI | The value is in the extensions, and those are Swift under any framework |
| Android | Deferred; native Kotlin when it happens | — |

## Why not a shared FFI core

The shareable core is thin: prompt templates, HTTP+SSE provider adapters, a settings schema, and history. That is perhaps 2,000–4,000 lines `[inferred]`.

The hard, product-defining code is platform-specific and no shared core reaches it: selection capture through Accessibility and UI Automation, the non-activating panel, Keychain and Credential Manager, the default-translation extension, and the Safari extension.

A Rust or Kotlin core means a permanent cost in build pipelines (xcframeworks, wasm-pack), streaming through callbacks, and debugging across the FFI boundary, to avoid porting a few thousand lines once.

Bitwarden, 1Password and Signal pay that cost because their cryptography must behave identically everywhere ([Bitwarden SDK](https://github.com/bitwarden/sdk-internal), [1Password](https://1password.com/blog/1password-8-the-story-so-far), [libsignal](https://github.com/signalapp/libsignal)). Lingo has no such requirement.

The cheaper way to keep two implementations aligned is to treat the spec as data:

- prompt templates as files in `spec/`
- provider request/response and SSE fixtures as golden test vectors

The TypeScript and Swift implementations both run against them.

## The main risk, and how to retire it

The desktop flow of "translate the selection without stealing focus" rests on small community pieces:

- No maintained Rust crate reads selections well on both systems, so Lingo writes its own Accessibility and UI Automation module.
- The macOS panel depends on a single-maintainer plugin.
- Non-activating WebView2 windows on Windows are unconfirmed.

**Mitigation: a one-week spike before the desktop MVP.** Prove, on both macOS and Windows: global hotkey → read selection and paragraph → show a panel that leaves focus in the source app.

**Fallback: Electron.** If Tauri gets in the way, swap the shell. The shared TypeScript and React code is unaffected.

**Runner-up, not chosen.** An Apple-first plan would build macOS, iOS and iPadOS from one SwiftUI codebase and add Windows later as a thin WebView2 shell reusing the extension's UI. Raycast 2.0 took a similar route, with native shells on each OS hosting one shared React UI ([Raycast](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast.md)). It gives the best macOS integration, but it means two desktop codebases, which conflicts with shipping macOS and Windows together as a solo developer.

## Extension framework

| Framework | Status (GitHub, 2026-11) | Safari |
|---|---|---|
| WXT | Active: v0.21.5 on 2026-10-26 | Has a `safari` build target; packaging is a manual step with Apple's tool ([guide](https://github.com/wxt-dev/wxt/blob/main/docs/guide/essentials/publishing.md)) |
| Plasmo | Last release 2025-05-17; effectively unmaintained | — |
| CRXJS | vite-plugin v2.7.0 in June 2026, still receiving commits | Not confirmed |

**Decision: WXT.** It is the most actively maintained and documents a Safari flow. read-frog, an open-source translation extension, uses it.

## Precedents

| Product | Structure |
|---|---|
| openai-translator | One TypeScript repo building Chromium, Firefox, Tauri desktop and userscript targets, with a Safari folder ([tree](https://github.com/openai-translator/openai-translator/tree/main/src)). The closest precedent to Lingo's plan |
| Pot | Tauri desktop only. Archived 2026-09-07 ([repo](https://github.com/pot-app/pot-desktop)) |
| Easydict | Native Swift, macOS only ([repo](https://github.com/tisfeng/Easydict)) |
| Bitwarden | Moved mobile from Xamarin/.NET MAUI to native Swift and Kotlin for performance and deeper native integration ([article](https://www.helpnetsecurity.com/2025/01/17/bitwarden-native-mobile-applications/)). Shares a Rust SDK through UniFFI and WASM |
| 1Password 8 | Rust core, Electron on desktop including macOS, SwiftUI on iOS ([blog](https://1password.com/blog/1password-8-the-story-so-far)) |
| Signal | Rust `libsignal` exposed to Java, Swift and TypeScript; separate repos per client ([repo](https://github.com/signalapp/libsignal)) |
| Raycast 2.0 | Native shells (Swift/AppKit, C#/WPF) hosting one shared React UI. They rejected Electron and Tauri for lack of native control ([blog](https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast.md)) |

A pattern across these: products with deep OS extensions on mobile end up native there, whatever they use on desktop.

## Not confirmed

- Whether a non-activating Tauri window on Windows keeps focus in the source app.
- Whether `tauri ios init` preserves hand-added extension targets (not relevant under the chosen plan, since iOS is native).
- WASM bundle sizes in MV3.
- The memory limit for default-translation extensions.
