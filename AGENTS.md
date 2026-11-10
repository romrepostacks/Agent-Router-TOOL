# AGENTS.md

Guidance for any AI agent (Claude Code, Codex, Copilot, etc.) working on this repository. This file replaces CLAUDE.md; don't add one.

## Rules
- Update `PROJECT_STATUS.md` (current status + next steps) in the same change as any feature or fix.
- Bump `version` in `package.json` in the same change as any feature or fix: minor (0.12.0 → 0.13.0) for a feature, patch (0.12.0 → 0.12.1) for a fix. Skip it only if the current version has never been built into an installer (no `release\LocalAgentRouter-Setup-<version>.exe`, and for 0.15.0 and earlier no `release\make\squirrel.windows\x64\*-<version>-full.nupkg`). Two builds with the same version can't be told apart once installed. Tag the change in `PROJECT_STATUS.md` with the new version and add it to `RELEASE_NOTES.md`. `build-installer.cmd` refuses to build a version that was already built.
- Keep `README.md` accurate for end users; it is also the install guide.
- Commit on `main` with a clear message; the repo has no remote yet.

## Layout
- `electron-builder.config.cjs` + `build/installer.nsh` – Windows NSIS installer: install for me / everyone, folder choice, update in place, removal of old Squirrel installs (0.15.0 and earlier). Never change `appId`: the installer finds earlier installs by it.
- `desktop.cjs` – Electron main process: window, global shortcut, Windows-encrypted secrets (`safeStorage`), external links.
- `server.mjs` – local-only HTTP server (127.0.0.1) holding all logic: routes, providers, settings, setup, staging/diff proposals.
- `import-sessions.mjs` – reads Claude Code / Codex CLI history and Codex Cloud tasks for session import; merge ordering.
- `colibri.mjs` – Colibri's standard install (`%LOCALAPPDATA%\colibri\setup.json`): installed models, switching (`coli stop` + `coli setup --model-dir`), `colibriGate()` so only one model is loaded at a time, and finding the Model Manager.
- `route-rules.mjs` – route-selector prompt and parser. `lessons.md` – extra routing hints.
- `public/` – vanilla JS UI (`app.js`, `index.html`, `style.css`). No framework, no build step.
- User data: `%LOCALAPPDATA%\LocalAgentRouterData\` (settings, sessions, proposals, and the user's own `skills.md` + `skills/`). Skills are personal and never committed or bundled.

## How routing works
- Routes: route planning, quick, project, longterm, code, review, security, ui, art, github/push.
- The router passes no permission rules to CLI providers; each follows its own configuration. The one flag is Claude Code's `--permission-mode`, chosen per thread from the same four modes as Claude desktop (Ask permissions = `default`, Accept edits, Plan mode, Auto; `CLAUDE_MODES` in `server.mjs`, `POST /api/sessions/<id>/permission-mode`); an unset thread uses `permissions.defaultMode` from `~/.claude/settings.json`. Bypass permissions is not offered. Claude Code runs through `runClaudeStream()` (`cli-runner.mjs`, stream-json with `--permission-prompt-tool stdio`): every prompt its settings would show becomes an approval card (`askApproval()` in `server.mjs`, answered by `POST /api/runs/<session>/approvals/<card>`); no answer source means deny. Codex and Copilot can't prompt mid-run, so their config decides. `ACCESS` in `server.mjs` only shapes chat providers (inline files, file-block writes) and prompts. Edits go straight into the project unless the task asks for a staged copy (`STAGED_REQUEST`), which the user reviews before applying. Thread access and the project edit lock still apply.
- Providers: CLI tools (`claude`, `codex`, `copilot`) and chat providers (`colibri` = any OpenAI-compatible local server, `openai`, `anthropic`). Chat providers get project files inline and write edits as `<<<FILE path ... >>>END` blocks.
- `ROLE_PREFERENCES` decides the default provider per route; `runRoleTask` skips providers that aren't set up.

## Checks before committing
- `node --check server.mjs import-sessions.mjs public/app.js desktop.cjs`
- `node --test test/` (needs `npm install` first)
- Start the app (`npm start`) and exercise the changed screen. 

## Don'ts
- Don't add router-side bypasses of provider approvals (e.g. `--dangerously-skip-permissions`, `bypassPermissions`, auto-allowing approval cards). Safety settings live in each provider's own configuration.
- Don't store API keys in plain text; use `globalThis.routerEncrypt`.
- Don't run commands built from page input; setup commands are fixed in `SETUP_TOOLS`.
