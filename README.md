# Lingo

An LLM-based, all-in-one translation app for the browser, the desktop, and mobile.

**Status: early development.** The browser extension can translate or define selected text on any page, and translate a whole page. Chat refinement, the desktop app, and the mobile app are not built yet.

## What makes it different

- **LLM-based.** Translation runs on large language models, not on a traditional engine such as Google Translate or Papago.
- **Bring your own key.** Lingo is free and open source with no subscription. You register your own API key (OpenAI, Claude, and others) and pay the provider directly. Local LLM support is planned after the first release.
- **Hexagonal architecture.** The LLM is an external dependency behind a port. Commercial APIs and local models plug in as adapters.
- **Context awareness.** Lingo can send the text around your selection so the model translates in context. Select a single word and it explains what the word means in that sentence, not only its dictionary senses. This sends more than you selected, so it is a setting you control. How much context is available depends on the platform.
- **Chat-based translation.** A translation is the start of a conversation. Ask for a different tone, a shorter version, or an explanation.

## Surfaces

| Surface           | Platforms                   | Features                                                                                                      |
| ----------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Browser extension | Chrome, Safari on iOS       | Full-page translation. Translate or define selected text through a shortcut and an in-page floating component |
| Desktop app       | macOS, Windows              | Translate or define text selected in any app, through a global shortcut and a dedicated floating window       |
| Mobile app        | iOS, iPadOS (Android later) | Translate or define selected text, with Lingo set as the system default translation app                       |

## Stack

| Surface           | Stack                                                |
| ----------------- | ---------------------------------------------------- |
| Browser extension | WXT, React, TypeScript                               |
| Desktop           | Tauri 2, sharing UI and core code with the extension |
| iOS / iPadOS      | Native SwiftUI                                       |

All three live in this one repository. The browser extension is built first; the desktop and mobile apps are planned.

## Try the extension

You need [mise](https://mise.jdx.dev) and Chrome 140 or later.

1. Install the toolchain and the dependencies: `mise install`, then `pnpm install`.
2. Build the extension: `pnpm build`.
3. Open `chrome://extensions`, turn on developer mode, choose "Load unpacked", and select `apps/extension/.output/chrome-mv3`.
4. The settings open in a tab. Under "Translation engine", enter an Anthropic or OpenAI API key. Lingo checks the key with the provider and then stores it in your browser.
5. Select text on any page and press the Lingo button that appears next to it, or press Alt+Shift+L.
6. To translate a whole page, press the Lingo button in the browser's toolbar and then "Translate", or press Alt+Shift+P. Lingo translates what is on screen and a little beyond it, and goes on as you scroll. "Show original" in the bar at the bottom of the page puts the page back.
7. The same toolbar button opens the settings, in a panel inside the page.

For the development commands and conventions, see [AGENTS.md](AGENTS.md).

## Documents

- [Architecture](docs/architecture.md) — decisions, repository layout, ports and adapters, roadmap
- [Context awareness research](docs/research/context-awareness.md) — how much surrounding text each platform can provide
- [Platform strategy research](docs/research/platform-strategy.md) — one repo or several, and cross-platform framework versus native
- [AGENTS.md](AGENTS.md) — conventions for contributors and coding agents: repository map, git workflow, commit messages

## License

[MIT](LICENSE)
