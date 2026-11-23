# AGENTS.md

Conventions for coding agents and human contributors working in this repository. Read this before making changes.

## Project

Lingo is an LLM-based, all-in-one translation app. It is free and open source, and users bring their own LLM API key. It has three surfaces:

- a browser extension (Chrome, Safari on iOS)
- a desktop app (macOS, Windows)
- a mobile app (iOS, iPadOS; Android later)

**Status: early development.** Roadmap step 1 in [docs/architecture.md](docs/architecture.md#roadmap) is in progress: the shared packages and the first slice of the browser extension.

## Repository map

Only the files a new session needs in order to find its way are listed here.

Documents:

- `README.md`: product overview. What makes Lingo different, features per surface, planned stack.
- `AGENTS.md`: this file.
- `docs/architecture.md`: the reference for decisions and structure. Decisions table, repository layout, ports and adapters, key-handling rules, notes per surface, roadmap, open risks. Read it before any structural change.
- `docs/research/context-awareness.md`: research on how much text around a selection each platform can provide.
- `docs/research/platform-strategy.md`: research on one repo or several, framework options, and why the hybrid stack was chosen.
- `LICENSE`: MIT License.

Configuration:

- `mise.toml`: toolchain versions (Node, pnpm). Local setup and CI both install from it.
- `package.json`, `pnpm-workspace.yaml`: pnpm workspace root. Repo-wide scripts, member packages, and the shared dependency catalog.
- `tsconfig.base.json`: compiler options every TypeScript package extends.
- `biome.json`: lint and format rules for TypeScript, JSON, CSS, HTML, Markdown, and YAML.
- `.editorconfig`: indentation, line endings, and charset for every file. Biome reads it.
- `.gitattributes`: checks text files out with LF line endings on every platform.
- `.github/workflows/ci.yml`: CI. Runs lint, typecheck, unit tests, the build, and the end-to-end tests on every pull request.
- `.gitignore`: ignore rules for OS files, secrets, Node, build output, test output, Rust/Tauri, and Xcode.

Code:

- `packages/core`: `@lingo/core`. Domain types, ports, and use cases in plain TypeScript, with no platform or provider dependencies.
- `packages/providers`: `@lingo/providers`. LLM adapters for Anthropic and OpenAI behind the core's `LLMProvider` port, and the list of models offered in settings.
- `packages/ui`: `@lingo/ui`. React components and styles shared by the extension and, later, the desktop app.
- `apps/extension`: `@lingo/extension`. The browser extension, built with WXT. Entry points are in `entrypoints/`, logic and unit tests in `src/`, end-to-end tests in `e2e/`, and the build output goes to `.output/`.
- `spec/`: `@lingo/spec`. Prompt templates and test vectors as data, shared by every implementation of the core.

Planned but not yet created: `apps/desktop` and `apps/apple`. See [the planned layout](docs/architecture.md#repository-layout).

## Keeping this file current

This file is loaded into every agent session, so keep it short and keep it true.

- When you add, move, rename, or remove an important file or directory, update the repository map **in the same change**.
- "Important" means: documents, top-level directories, the root of each package or app (one line each), and configuration that affects the whole repo (workspace, CI, lint and format, toolchain versions). Do not list individual source files.
- **Code-level structure belongs in [docs/architecture.md](docs/architecture.md)**, not here: modules, key source files, data flow, how to add an adapter. This file links to it. As code lands, replace the planned layout in that document with the actual one.
- If a change departs from a decision recorded in `docs/architecture.md`, update that document in the same change and say so in the pull request.
- Keep the Commands section in step with the scripts in the root `package.json`.
- Remove a "planned" note as soon as the thing it describes exists.

## Commands

Run `mise install` once to get the pinned Node and pnpm, then `pnpm install`. If your shell does not activate mise, prefix commands with `mise x --`.

| Command                              | What it does                                                                                                                                                                  |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                          | Checks formatting, lint rules, and import order without changing files. CI runs it                                                                                            |
| `pnpm format`                        | Applies formatting and safe lint fixes                                                                                                                                        |
| `pnpm typecheck`                     | Type-checks every package                                                                                                                                                     |
| `pnpm test`                          | Runs the unit tests of every package                                                                                                                                          |
| `pnpm build`                         | Builds the extension into `apps/extension/.output/chrome-mv3`                                                                                                                 |
| `pnpm e2e`                           | Builds the extension in end-to-end mode and drives it in Chromium against a fake LLM server. Run `pnpm --filter @lingo/extension exec playwright install chromium` once first |
| `pnpm --filter @lingo/extension dev` | Rebuilds the extension on change into `.output/chrome-mv3-dev`. Load that folder in `chrome://extensions` with developer mode on                                              |
| `pnpm smoke`                         | Calls the real provider APIs through the adapters. Needs API keys in `.env.local`, costs a few cents, and is not part of CI                                                   |

## Code style

Formatting and linting are automated. Run the tools instead of formatting by hand.

- **Biome** formats and lints TypeScript, JavaScript, JSON, CSS, HTML, Markdown, and YAML with its recommended rule set. Its configuration is `biome.json`.
- **`.editorconfig`** holds the formatting baseline: 2-space indent, LF line endings, UTF-8, final newline. Biome reads it, so change those values there and not in `biome.json`.
- Run `pnpm format` before committing. `pnpm lint` must pass, and CI enforces it.
- Fix a lint finding in the code. Suppress one only with a `biome-ignore` comment that gives the reason. Do not turn a rule off for the whole repo to get a change through.
- **A new language brings its formatter and linter with it.** The change that adds the first Rust or Swift file also adds that language's standard tools with their default rules (`rustfmt` and Clippy for Rust, `swift-format` for Swift), their config files, a CI check, and a line in this section.

## Ground rules

- **Everything in the repo is written in English**: documents, code comments, commit messages, and identifiers. This holds whatever language the conversation is in.
- In documents, mark any claim that was not confirmed from a source as `[inferred]`.
- `packages/core` imports no platform API and no provider SDK. Platform and provider code lives in adapters.
- API keys never appear in content scripts, logs, test fixtures, or commits.
- Data that arrives without a trustworthy type (a message from another context, stored data, model output) becomes typed through a Zod schema. Infer the type from the schema instead of declaring it a second time. See [Validation](docs/architecture.md#validation).

## Git workflow

### Branching: GitHub Flow

- `main` is the only long-lived branch. It always builds.
- Do work on a short-lived branch created from the latest `main`, one concern per branch.
- Name branches `<type>/<short-description>` in kebab-case, using the commit types below:
  - `feat/extension-selection-popup`
  - `fix/providers-refusal-handling`
  - `docs/agents-md`
  - with an issue number when there is one: `feat/12-selection-popup`
- Merge through a pull request, using **squash merge**, then delete the branch. The pull request title follows the commit convention, because it becomes the commit on `main`.
- Bring a branch up to date by rebasing it onto `main`. Only rewrite history on your own branch.
- Do not commit directly to `main`.
- Never force-push `main`.

### Releases

- Each surface is released separately with an annotated tag on `main`, using semantic versioning:
  - `ext-v1.2.0` for the browser extension
  - `desktop-v0.3.1` for the desktop app
  - `ios-v1.0.0` for the iOS and iPadOS app
- There are no release branches. Fix forward on `main` and tag a patch release. Introduce a `release/…` branch only if an older release line has to be patched after `main` has moved on.

### Commit messages

Keep commits short. A commit message is normally a single line in Conventional Commits form:

```
<type>(<scope>): <subject>
```

- **type**: `feat`, `fix`, `docs`, `refactor`, `test`, or `chore`. Use `chore` for build, CI, dependencies, and tooling.
- **scope** (optional): the package or app touched: `core`, `providers`, `ui`, `extension`, `desktop`, `apple`, `spec`, or `repo` for root-level tooling. Omit it when a change spans several.
- **subject**: imperative, lowercase, no period, 50 characters or fewer.

```
feat(extension): add selection popup
fix(providers): handle refusal stop reason
docs: add agent conventions
chore(repo): add pnpm workspace
```

- Leave the body out unless the reason for the change is not clear from the subject and the diff. When one is needed, keep it to a sentence or two.
- Mark a breaking change with `!` after the type or scope: `feat(core)!: return context level`.
- Put issue references and longer explanations in the pull request, not the commit.
- One logical change per commit.

### Rules for agents

- Commit, push, or open a pull request only when the user asks.
- Do not add `Co-Authored-By` or any other attribution trailer to a commit message.
- If the current branch is `main`, create a branch before committing.
- Stage the files you changed by name. Do not use `git add -A` or `git add .`.
- Never commit secrets, never bypass hooks with `--no-verify`, and never force-push `main`.

## Testing and CI

CI runs on GitHub Actions.

- **Every test runs in CI on every pull request**, when it is opened and each time it is updated (the `pull_request` trigger).
- When you add tests, whether a new suite or a new package or app that has tests, wire them into the CI workflow **in the same change**. A test that does not run in CI is not finished.
- A pull request is ready to merge only when CI passes. Do not skip, disable, or weaken a failing test to make it pass.
- Path filters may limit a job to the surfaces a change can affect. Tests are never skipped for any other reason.
- The one check outside CI is `pnpm smoke`. It sends real requests with your own API keys and costs money, so run it by hand after changing a provider adapter.
- The workflow is `.github/workflows/ci.yml`. It installs the toolchain from `mise.toml`, so local and CI versions match.

## Agent tooling

Claude Code loads `AGENTS.md` as project instructions when the project has no `CLAUDE.md`. Do not add a `CLAUDE.md`. If one ever becomes necessary, have it import this file with `@AGENTS.md` so the two cannot drift apart.
