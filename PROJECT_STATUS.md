# Local Agent Router — Project Status

## Current status (v0.10.1)

- **New-user setup.** First launch opens a 6-step setup guide: projects folder, AI tools (install / sign in / skip for Claude Code, Codex, Copilot, with Node.js offered when needed), local model (Ollama, LM Studio, Colibri presets), optional OpenAI/Anthropic API keys, and a review of which tool handles each route. Re-run from Settings.
- **Routes adapt to what's installed.** Defaults are picked from the tools that are set up, and a route whose tool is missing falls through to the next available one.
- **Providers:** Claude Code, Codex, Copilot (CLIs); any OpenAI-compatible local model; OpenAI and Anthropic via API key (keys encrypted with Windows). Every provider can take every route; access is set per route (none / read / edit in a private copy / git-only).
- **Installer:** Squirrel installer now creates Start-menu/desktop shortcuts on install and removes them on uninstall. Code signing is wired up but needs a certificate (`WINDOWS_CERTIFICATE_FILE`, `WINDOWS_CERTIFICATE_PASSWORD`).
- **UI:** Settings in the top bar; resizable, collapsible side panels; Routing menu = Auto + each route.
- **Clean-PC fixes (0.10.1):** Node.js install falls back to the download page when winget is missing (Windows Sandbox, older Windows); install/sign-in windows launch PowerShell directly with an encoded command, so no quoting breaks.
- **Clean-install test:** `test/clean-install.wsb` opens Windows Sandbox (a throwaway fresh Windows) with the built installer mapped in and runs it. Needs Windows 10/11 Pro, virtualization on, and the "Windows Sandbox" feature enabled.
- **Skills are per-user (0.10.1):** the skill index and files now live in `%LOCALAPPDATA%\LocalAgentRouterData\` (`skills.md`, `skills/`), survive updates, and are no longer in the repo or the installer. The repo history was cleaned of the previously imported personal skills before publishing.
- **GitHub:** public at https://github.com/romrepostacks/Agent-Router-TOOL. Releases carry the Windows installer (`Setup.exe`); v0.10.1 is the first. To release: bump `version` in package.json, `npm run make`, commit, push, then create a GitHub release `vX.Y.Z` with `release\make\squirrel.windows\x64\*Setup.exe` attached.
- Repo is under git (`main`). Agent conventions live in `AGENTS.md`.

## Next steps

1. Run `test/clean-install.wsb` (rebuild first with `npm run make`) and fix anything the setup guide misses on a bare Windows.
2. Buy a code-signing certificate and sign the installer to remove the SmartScreen warning.
3. Add a small `node --test` suite for the diff/apply path, the file-block writer and route parsing.
4. Move `lessons.md` to the user data folder so it is editable in the installed app.
5. Split `server.mjs` into modules (providers, setup, proposals, routes).
