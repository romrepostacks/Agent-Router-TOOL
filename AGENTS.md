# AGENTS.md

Guidance for any AI agent (Claude Code, Codex, Copilot, etc.) working on this repository. This file replaces CLAUDE.md; don't add one.

## Rules
- Update `PROJECT_STATUS.md` (current status + next steps) in the same change as any feature or fix.
- Keep `README.md` accurate for end users; it is also the install guide.
- Commit on `main` with a clear message; the repo has no remote yet.

## Layout
- `desktop.cjs` – Electron main process: window, Squirrel install events, global shortcut, Windows-encrypted secrets (`safeStorage`), external links.
- `server.mjs` – local-only HTTP server (127.0.0.1) holding all logic: routes, providers, settings, setup, staging/diff proposals.
- `import-sessions.mjs` – reads Claude Code / Codex CLI history and Codex Cloud tasks for session import; merge ordering.
- `route-rules.mjs` – route-selector prompt and parser. `lessons.md` – extra routing hints.
- `public/` – vanilla JS UI (`app.js`, `index.html`, `style.css`). No framework, no build step.
- User data: `%LOCALAPPDATA%\LocalAgentRouterData\` (settings, sessions, proposals, and the user's own `skills.md` + `skills/`). Skills are personal and never committed or bundled.

## How routing works
- Routes: route planning, quick, project, longterm, code, review, security, ui, art, github/push.
- `ACCESS` in `server.mjs` sets what each route may do (none / read / edit / git). Every provider adapter enforces it; edits always happen in a staged copy that the user reviews before applying.
- Providers: CLI tools (`claude`, `codex`, `copilot`) and chat providers (`colibri` = any OpenAI-compatible local server, `openai`, `anthropic`). Chat providers get project files inline and write edits as `<<<FILE path ... >>>END` blocks.
- `ROLE_PREFERENCES` decides the default provider per route; `runRoleTask` skips providers that aren't set up.

## Checks before committing
- `node --check server.mjs import-sessions.mjs public/app.js desktop.cjs`
- `node --test test/` (needs `npm install` first)
- Start the app (`npm start`) and exercise the changed screen. 

## Don'ts
- Don't widen a route's access (e.g. shell for review routes, force-push for GitHub).
- Don't store API keys in plain text; use `globalThis.routerEncrypt`.
- Don't run commands built from page input; setup commands are fixed in `SETUP_TOOLS`.
