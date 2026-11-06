# Local Agent Router — Project Status

## Current status (v0.11.0)

- **New-user setup.** First launch opens a 6-step setup guide: projects folder, AI tools (install / sign in / skip for Claude Code, Codex, Copilot, with Node.js offered when needed), local model (Ollama, LM Studio, Colibri presets), optional OpenAI/Anthropic API keys, and a review of which tool handles each route. Re-run from Settings.
- **Routes adapt to what's installed.** Defaults are picked from the tools that are set up, and a route whose tool is missing falls through to the next available one.
- **Providers:** Claude Code, Codex, Copilot (CLIs); any OpenAI-compatible local model; OpenAI and Anthropic via API key (keys encrypted with Windows). Every provider can take every route; access is set per route (none / read / edit in a private copy / git-only).
- **Installer:** Squirrel installer now creates Start-menu/desktop shortcuts on install and removes them on uninstall. Code signing is wired up but needs a certificate (`WINDOWS_CERTIFICATE_FILE`, `WINDOWS_CERTIFICATE_PASSWORD`).
- **UI:** Settings in the top bar; resizable, collapsible side panels; Routing menu = Auto + each route.
- **Clean-PC fixes (0.10.1):** Node.js install falls back to the download page when winget is missing (Windows Sandbox, older Windows); install/sign-in windows launch PowerShell directly with an encoded command, so no quoting breaks.
- **Clean-install test:** `test/clean-install.wsb` opens Windows Sandbox (a throwaway fresh Windows) with the built installer mapped in and runs it. Needs Windows 10/11 Pro, virtualization on, and the "Windows Sandbox" feature enabled.
- **Skills are per-user (0.10.1):** the skill index and files now live in `%LOCALAPPDATA%\LocalAgentRouterData\` (`skills.md`, `skills/`), survive updates, and are no longer in the repo or the installer. The repo history was cleaned of the previously imported personal skills before publishing.
- **GitHub:** public at https://github.com/romrepostacks/Agent-Router-TOOL. Releases carry the Windows installer (`Setup.exe`); v0.10.1 is the first. To release: bump `version` in package.json, `npm run make`, commit, push, add a section to `RELEASE_NOTES.md`, then create a GitHub release `vX.Y.Z` with `release\make\squirrel.windows\x64\*Setup.exe` attached.
- **CLI and cloud session import (0.11.0):** `import-sessions.mjs` reads Claude Code (`~/.claude/projects/*/*.jsonl`) and Codex (`~/.codex/sessions/**/rollout-*.jsonl`) history plus Codex Cloud tasks (`codex cloud list --json`) into app sessions, matched to a project by working directory (cloud tasks by repo name / git remote). Runs on start and from the ⤓ button. The app's own headless runs (`claude -p` = entrypoint `sdk-cli`, `codex exec` originator) are skipped. Claude Code web sessions have no listing command, so ☁ opens `claude --teleport` in the project folder and the next import picks the session up. Deleted imports are remembered in settings (`ignoredImports`).
- **Merge sessions (0.11.0):** ⇲ on a row folds it into the open session; ⇊ merges every listed session. Same project only; messages combined by time. Session cap raised from 80 to 400 messages so merges don't drop history.
- **Startup fix (0.11.0):** desktop.cjs no longer copies a bundled skills.md/skills/ into userData (they are not packaged since 0.10.1, so the installed app crashed with ENOENT); the server reads them from `%LOCALAPPDATA%\LocalAgentRouterData\` and handles them missing. Also `forge.config.cjs` no longer ignores `node_modules`: that ignore kept `@anthropic-ai/sdk` and `pdfjs-dist` out of the package (Forge already prunes devDependencies), so the 0.10.x installs could not start either.
- **Fallback error fix (unreleased):** a failed route no longer claims "reached a usage limit" unless the error really says so. `isUsageLimitError` checks only the last 12 lines (Codex echoes the prompt to stderr) and whole words (it used to match "architecture … capabilities"). When the primary fails, the status names the real error; a fallback that isn't running (e.g. the local model is off) is skipped; if the fallback fails too, both errors are shown. Local-model network errors now name the address instead of a bare "fetch failed".
- **Tests:** `node --test test/` runs an end-to-end import/merge test against the real server with fake CLI history.
- Repo is under git (`main`). Agent conventions live in `AGENTS.md`.

## Next steps

1. Run `test/clean-install.wsb` (rebuild first with `npm run make`) and fix anything the setup guide misses on a bare Windows.
2. Buy a code-signing certificate and sign the installer to remove the SmartScreen warning.
3. Extend the `node --test` suite to the diff/apply path, the file-block writer and route parsing.
6. Try session import on Kyle's PC with real Claude Code / Codex history and a signed-in `codex cloud list`; then release as 0.11.0.
7. Copilot CLI history isn't imported yet (its on-disk format wasn't checked).
4. Move `lessons.md` to the user data folder so it is editable in the installed app.
5. Split `server.mjs` into modules (providers, setup, proposals, routes).
