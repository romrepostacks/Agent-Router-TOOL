# Local Agent Router

A Windows desktop app that sends each request to the AI tool best suited for it: Claude Code, Codex, GitHub Copilot, a local model (Ollama, LM Studio, Colibri), or an OpenAI / Anthropic API key.

## Install (for anyone, starting from nothing)

1. Run `Local Agent Router-<version> Setup.exe` (in `release/make/squirrel.windows/x64/` after a build). Windows may show a SmartScreen warning until the installer is code-signed: choose **More info → Run anyway**. The app installs, adds Start-menu and desktop shortcuts, and opens.
2. A setup guide walks through:
   - **Projects folder** – created for you if it doesn't exist.
   - **AI tools** – for Claude Code, Codex and Copilot it shows whether each is installed and signed in. **Install** opens a PowerShell window running the official install command (Node.js is offered first if Codex or Copilot need it); **Sign in** opens the tool so you can log in; **Skip** if you already have it set up or don't use it. **Check again** re-detects without restarting.
   - **Local model (optional)** – one-click addresses for Ollama, LM Studio and Colibri, a Connect test, and a model picker.
   - **API keys (optional)** – OpenAI and Anthropic keys, encrypted by Windows and stored only on that PC.
   - **Review** – shows which tool will handle each route, picked from what is actually set up.
3. Run setup again any time from **Settings → General → Run setup again**.

If a route's tool is missing or not set up, the app automatically uses the next available tool for that route.

## Develop

Run `npm install` once, then `start.cmd` (or `npm start`). Build the installer with `npm run make`. To code-sign, set `WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD` before `npm run make`. See `AGENTS.md` for conventions and `PROJECT_STATUS.md` for current state.

The left side lists an **All Projects** scope plus visible folders directly inside that folder. For individual projects, providers share one workspace and a latest-task note at `.agent-router/LOCAL_AGENT_ROUTER_HANDOFF.md`; the router refreshes this note after delegated work so the next provider can pick up context. The note is router-managed and may appear as an untracked hidden project file. All Projects supports local quick questions and read-only Copilot security audits across those folders; code changes and pushes require choosing one folder. Sessions are saved separately for each scope. Search sessions by title or message, or filter to sessions with pending change previews. Sessions and their messages are stored locally in `%LOCALAPPDATA%\LocalAgentRouterData\sessions.json`.

## Routing and providers

The **Routing** menu offers **Auto** plus one entry per route: Route Planning, Long Term Project planning, Coding, Reviewing, Security audit, UI Designer, Art Asset generation, GitHub requests, and Quick questions. Auto asks the Route Planning provider to pick a route (using the editable `lessons.md` guidance), then runs it. Choosing a route directly skips that step. Choosing **Route Planning** only reports which route it would pick.

Every installed provider (Colibri, Codex, Claude Code, Copilot) can be assigned to every route in **Settings → Routing & models**. What a provider may do is set by the route, not the provider:

| Route | Access |
|---|---|
| Quick questions, Route Planning | No project access |
| Long Term planning, Reviewing, Security audit, project questions | Read project files only |
| Coding, UI Designer, Art Asset generation | Edit files in a private copy; you review and apply the diff |
| GitHub requests | Read files and run only `git status/log/diff/branch/remote/push` (never force) and `gh issue`, `gh pr`, `gh repo view` |

Claude Code and Copilot enforce these with their tool permissions, Codex with its sandbox. Codex cannot be limited to git commands, so on the GitHub route it runs read-only and tells you the commands to run. Local models and API-key models have no file tools, so they receive the project's file list, key docs and any files your request names inline; for editing routes it returns whole files that the router writes into the private copy. Claude Code always uses your signed-in subscription (API key overrides are removed from its environment).

The app does not store provider credentials. Cloud agents receive the task and can inspect files in the selected project. Keep secrets out of prompts and project folders accessible to agents.

## Live work, context, and approvals

Responses stream as each provider makes text available. Select **Stop** to cancel a request, or **Retry** after a stopped or failed request. Attach small text/code files, PDFs, or PNG/JPEG/WebP images, or choose up to 10 text files from the current project. PDF text is extracted locally with PDF.js and included in prompts. Images are sent only to Colibri for vision input. Attachment material stays on this computer with the session and can be reused from the transcript; avoid choosing credentials or secrets.

Coding tasks run in a temporary project copy. The app shows changed, removed, and unchanged lines for each changed file. The real project is updated only after **Apply changes**; before applying, the router checks that the original files still match the preview. Security reviews, quick questions, and explicit GitHub pushes keep their existing behavior.

## Shared skills

Skills are your own: they live in `%LOCALAPPDATA%\LocalAgentRouterData\skills.md` (the index) and `skills\` (one Markdown file per skill), so they survive updates and are never shipped with the app. Add more from the app's **Shared skills** panel. In Settings, approve skills to include them automatically and set the per-request limit: `-1` means unlimited, `0` sends no skills, and a positive number sets the maximum. Approved skills are considered before task-selected skills. Imported skills retain source attribution, and providers are told to adapt tool-specific steps to their available tools. Rate answer quality and whether Auto chose the right route; both stay local and aggregate counts inform future GPT routing prompts. Provider status checks show installed and sign-in readiness without displaying credentials.

## Settings

The desktop uses a three-area layout: projects and sessions on the left, the conversation in the center, and a task details panel on the right. The details panel shows the current provider status, the project scope, selected files, skills, and how the active route uses them. Collapse it with **Hide details**.

The **Routing & models** settings tab offers provider/model dropdowns populated from Colibri's live model endpoint, Codex's model catalog, and supported Claude Code and Copilot CLI choices when those tools are installed. Configure a preferred provider/model and a cross-provider fallback for Route Planning, Long Term Project planning, Coding, Reviewing, Security audit, UI Designer, Art Asset generation, GitHub requests, and Quick questions. A selected fallback is tried after a provider error; when a usage limit is reached and no fallback is selected, the router chooses another available provider/model. The art role creates project-ready assets such as SVG where supported; these CLI providers do not expose a shared raster image-generation endpoint. Provider plan limits can apply across models, so retries may still fail. **General** lets you set a system-wide keyboard shortcut to open the app and focus the message box, or turn it off. The default shortcut is `Control+Shift+Space`.

Set `AGENT_ROUTER_PROJECTS_ROOT` to change the folder shown as the project list. Set `COLIBRI_BASE_URL` or `COLIBRI_MODEL` to override Colibri's local endpoint or model. The internal service listens only on this computer; the desktop app embeds the interface and does not open Chrome.

Run `node evaluate-routing.mjs` to score the GPT route selector against synthetic engineering and everyday prompts. The evaluator is read-only and does not invoke Claude or Copilot.
