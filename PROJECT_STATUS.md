# Local Agent Router — Project Status

## Current status (v0.10.0)

- **New-user setup.** First launch opens a 6-step setup guide: projects folder, AI tools (install / sign in / skip for Claude Code, Codex, Copilot, with Node.js offered when needed), local model (Ollama, LM Studio, Colibri presets), optional OpenAI/Anthropic API keys, and a review of which tool handles each route. Re-run from Settings.
- **Routes adapt to what's installed.** Defaults are picked from the tools that are set up, and a route whose tool is missing falls through to the next available one.
- **Providers:** Claude Code, Codex, Copilot (CLIs); any OpenAI-compatible local model; OpenAI and Anthropic via API key (keys encrypted with Windows). Every provider can take every route; access is set per route (none / read / edit in a private copy / git-only).
- **Installer:** Squirrel installer now creates Start-menu/desktop shortcuts on install and removes them on uninstall. Code signing is wired up but needs a certificate (`WINDOWS_CERTIFICATE_FILE`, `WINDOWS_CERTIFICATE_PASSWORD`).
- **UI:** Settings in the top bar; resizable, collapsible side panels; Routing menu = Auto + each route.
- Repo is under git (`main`). Agent conventions live in `AGENTS.md`.

## Next steps

1. Test the installer on a clean Windows PC/VM (no Node, no CLIs) and fix anything the setup guide misses.
2. Buy a code-signing certificate and sign the installer to remove the SmartScreen warning.
3. Add a small `node --test` suite for the diff/apply path, the file-block writer and route parsing.
4. Move `lessons.md` to the user data folder so it is editable in the installed app.
5. Split `server.mjs` into modules (providers, setup, proposals, routes).
