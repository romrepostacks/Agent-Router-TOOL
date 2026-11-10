# Local Agent Router

Session integration (0.21.0): clients can POST a {title} to /api/sessions/:id/rename and a {projectId} to /api/sessions/:id/project. Titles must contain 1?200 characters; project assignment requires an unmerged project and no active or queued work. Both return the saved session. Existing thread access and permission settings are retained. Desktop controls are pending.


A Windows desktop app that sends each request to the AI tool best suited for it: Claude Code, Codex, GitHub Copilot, a local model (Ollama, LM Studio, Colibri), or an OpenAI / Anthropic API key.

## Install (for anyone, starting from nothing)

1. Run `LocalAgentRouter-Setup-<version>.exe` (in `release/` after a build). Windows may show a SmartScreen warning until the installer is code-signed: choose **More info → Run anyway**. The setup wizard first asks **Server or Client** (see [Server and Client](#server-and-client) below; pick **Server** if this is your only PC), then whether to install for you only or for everyone on the PC, then lets you pick the install folder. Updating keeps the earlier choice selected. Windows **Settings → Apps** shows the version with the choice, for example `0.18.0 server`. If Local Agent Router is already installed, setup says so and updates it in place; installs from 0.15.0 and earlier (the old one-click installer) are removed after the new version is in. Your settings, sessions and skills in `%LOCALAPPDATA%LocalAgentRouterData` are always kept. Setup adds Start-menu and desktop shortcuts and can open the app when it finishes. Uninstall from **Settings → Apps**.
2. A setup guide walks through:
   - **Projects folder** – created for you if it doesn't exist.
   - **AI tools** – for Claude Code, Codex and Copilot it shows whether each is installed and signed in. **Install** opens a PowerShell window running the official install command (Node.js is offered first if Codex or Copilot need it); **Sign in** opens the tool so you can log in; **Skip** if you already have it set up or don't use it. **Check again** re-detects without restarting.
   - **Local model (optional)** – one-click addresses for Ollama, LM Studio and Colibri, a Connect test, and a model picker.
   - **API keys (optional)** – OpenAI and Anthropic keys, encrypted by Windows and stored only on that PC.
   - **Review** – shows which tool will handle each route, picked from what is actually set up.
3. Run setup again any time from **Settings → General → Run setup again**.

If a route's tool is missing or not set up, the app automatically uses the next available tool for that route.

## Server and Client

- **Server** runs everything: the AI tools, your projects, sessions and settings. The setup guide above is for a Server. This is how the app always worked.
- **Client** is for another Windows PC. It shows the same window, but every task, file and setting lives on the server; nothing runs on the Client PC. The phone apps work the same way.

Both connect over **Tailscale** only. To connect a Client:

1. Install and sign in to Tailscale on both PCs (same tailnet).
2. On the **server PC**, open **Settings → Remote access**, turn it on (port `8766` by default), and press **Add device**. It shows the server address (`http://100.x.y.z:8766`) and a device token **once**. Windows Firewall may ask to allow Local Agent Router on the network the first time; allow it. The server listens only on its Tailscale address, never on your home network or the internet.
3. On the **Client PC**, open Local Agent Router, enter the address and token, and press **Connect**. The token is stored encrypted by Windows. Press **Ctrl+Shift+O** later to connect to a different server.

Each device has its own token. Remove a device on the server to cut it off at once. A Client or phone can do everything on the server except: add or remove devices, change remote access, enter API keys, open setup or sign-in windows on the server, use the server's folder picker, or pull Claude Code cloud sessions. Do those on the server PC.

A Client or phone with a token can run tasks on the server with the server's provider settings, so treat a token like a password and remove devices you no longer use.

Silent installs: `LocalAgentRouter-Setup-<version>.exe /S /ROLE=client` (or `/ROLE=server`).

### Remote API (for the phone apps)

Every request to `http://<server Tailscale address>:<port>` needs `Authorization: Bearer <device token>`; without a valid token the answer is `401`, and server-only actions answer `403`. Errors are `{ "error": "<message>" }`. Apps must be native HTTP clients (no browser CORS). Same endpoints as the desktop page, plus:

| Request | Answer |
| --- | --- |
| `GET /api/version` | `{ version, role: "server", label: "0.17.0 server", remote: true, device: { id, name }, client }`. `client` is the connecting app's own label from its `X-Router-Client` header (e.g. `0.17.0 client`), or `null`. Show `client` when set, else `label`. |
| `GET /api/projects` | `[{ id, name, path, scope: "all" \| "single", linked, parent?, members? }]` |
| `GET /api/sessions?projectId=&q=&pending=1` | `[{ id, title, projectId, createdAt, updatedAt, importedFrom, merged, running, messageCount, hasPendingReview }]` |
| `GET /api/sessions/<id>` | The session with `messages: [{ role, content, route?, proposalId?, createdAt }]` |
| `POST /api/sessions` `{ projectId }` | `201`, the new session |
| `POST /api/chat/stream` `{ message, projectId, sessionId, mode }` | Server-sent events: `status`, `delta`, `activity`, `reset`, `approval` (a card), `approved` `{ id, decision, allow }`, then `done` (result) or `error` `{ error, cancelled? }` |
| `GET /api/runs` (`?all` adds failed/stopped runs) | `[{ sessionId, projectId, startedAt, status, editing }]` |
| `GET /api/runs/<sessionId>` | `{ sessionId, projectId, startedAt, status, editing, running, content, live, approvals: [card], final: null \| { event, value } }`, or `404` once the answer is saved in the session |
| `GET /api/runs/<sessionId>/stream` | `snapshot` `{ content, live, status, approvals }`, then the events above |
| `POST /api/runs/<sessionId>/approvals/<cardId>` `{ decision: "always" \| "allow" \| "deny" }` | `{ id, decision, allow }`. `409 { error, unsupported: true }` when `always` is sent for a card with `canAlwaysAllow: false`; the card stays open. Older clients may still send `{ allow: true \| false }`. |
| `POST /api/runs/<sessionId>/cancel` | `{ cancelled: true, sessionId }` |
| `GET /api/settings`, `POST /api/settings` | The settings object (same as the desktop page) |
| `GET /api/notifications?after=<id>` | `{ boot, latest, items: [{ id, type: "approval" \| "done" \| "failed" \| "stopped", sessionId, projectId, title, text, cardId?, at }] }`. Poll with `after` = the last `latest`; if `boot` changes the server restarted, so start again from `after=0`. The last 200 events are kept in memory. |

An approval card is `{ id, tool, title, reason, canAlwaysAllow, detail, askedAt }`; `title` and `detail` are ready to show (for example "Approve this plan?" and the plan text). `POST /api/sessions/<id>/permission-mode` `{ permissionMode: "default" | "acceptEdits" | "plan" | "auto" | "" }` sets the thread's Claude Code mode. Offer **Always allow** only when `canAlwaysAllow` is `true`.

Server PC only (the desktop page, `127.0.0.1`): `GET /api/remote` → `{ enabled, port, listening, address, url, error, devices: [{ id, name, createdAt, lastSeenAt }] }`; `POST /api/remote` `{ enabled, port }`; `POST /api/remote/devices` `{ name }` → `201 { device, token, url }` (the only time the token is shown); `DELETE /api/remote/devices/<id>`.

## Phone apps (iPhone and Android)

The phone apps live in `mobile/` (Capacitor 7). **No APK or IPA has been built yet**; build them with the steps below. Both connect to a Server the same way a Client PC does: Tailscale on the phone, then the server address and a device token from **Settings → Remote access → Add device** on the server PC.

Known gap before the apps work against a real server: the server answers plain `http://` on its Tailscale address. Android blocks plain HTTP from apps by default and iOS App Transport Security does too, so the app needs an exception for the Tailscale address (or HTTPS) before it can connect.

### Android (APK)

You need a Windows, macOS or Linux PC with **Android Studio** (it includes the Java 21 and Android SDK that Capacitor 7 needs) and Node.js.

1. Build:
   ```
   cd mobile
   npm install
   npx cap add android
   npx cap sync android
   cd android
   gradlew assembleDebug
   ```
   The APK is `mobile/android/app/build/outputs/apk/debug/app-debug.apk`. A debug APK is signed with Android's debug key and is fine for your own phones.
2. Install it on the phone, either:
   - copy the APK to the phone, open it in **Files**, and allow **Install unknown apps** for Files when Android asks; or
   - turn on **Developer options → USB debugging**, connect the phone, and run `adb install -r app-debug.apk`.
3. For a release build to share, create your own signing key once (`keytool -genkeypair -v -keystore router.jks -alias router -keyalg RSA -keysize 2048 -validity 10000`), add it in Android Studio under **Build → Generate Signed App Bundle or APK → APK**, and keep the key file safe: updates must be signed with the same key.

### iPhone (IPA)

An IPA can only be built on a **Mac with Xcode 16 or later**. It can't be built on Windows.

1. On the Mac:
   ```
   cd mobile
   npm install
   npx cap add ios
   npx cap sync ios
   npx cap open ios
   ```
2. In Xcode, select the **App** target → **Signing & Capabilities**, pick your **Team** (sign in with your Apple ID under Xcode → Settings → Accounts), and keep or change the bundle id `com.localagentrouter.mobile`.
3. Pick how to install:
   - **Your own iPhone, no IPA file:** connect it, choose it as the run destination, and press **Run**. With a free Apple ID the app stops opening after 7 days; run it again from Xcode to renew. On the iPhone, turn on **Settings → Privacy & Security → Developer Mode** and trust your certificate under **Settings → General → VPN & Device Management** the first time.
   - **An IPA file:** this needs the paid **Apple Developer Program** ($99 a year). Register each iPhone's UDID in your developer account, then **Product → Archive → Distribute App → Release Testing (Ad Hoc)** and export. Install the `.ipa` by dragging it onto the iPhone in Finder (or Apple Configurator), or upload with **TestFlight** instead and install from the TestFlight app.

## Develop

Run `npm install` once (again after updating from 0.14.x, since the installer now uses electron-builder), then `start.cmd` (or `npm start`). Build the installer with `npm run make`, or double-click `build-installer.cmd`: it installs dependencies if needed, builds, and copies the installer to `LocalAgentRouter-Setup.exe` in the project root. To code-sign, set `WINDOWS_CERTIFICATE_FILE` and `WINDOWS_CERTIFICATE_PASSWORD` before `npm run make`. See `AGENTS.md` for conventions and `PROJECT_STATUS.md` for current state.

The left side lists an **All Projects** scope plus visible folders directly inside that folder. For individual projects, providers share one workspace and a latest-task note at `.agent-router/LOCAL_AGENT_ROUTER_HANDOFF.md`; the router refreshes this note after delegated work so the next provider can pick up context. The note is router-managed and may appear as an untracked hidden project file. All Projects supports local quick questions and read-only Copilot security audits across those folders; code changes and pushes require choosing one folder. Sessions are saved separately for each scope. Search sessions by title or message, or filter to sessions with pending change previews. Sessions and their messages are stored locally in `%LOCALAPPDATA%\LocalAgentRouterData\sessions.json`.

### Bring in CLI and cloud sessions

Chats you had in Claude Code or Codex before (or outside) this app show up too. On start, and whenever you press **⤓** above the session list, the app reads the history those tools keep on this computer (`%USERPROFILE%\.claude\projects`, `%USERPROFILE%\.codex\sessions`) and, if Codex is signed in with ChatGPT, your Codex Cloud tasks. Each one lands in the project it was run in (Codex Cloud tasks are matched by repository name). One that ran somewhere else goes to the project its chat refers to most: paths into the project folder, its repository name, or its folder name. If no project clearly wins, it stays under **All Projects**. Only the text of the conversation is imported; tool output is left out. Deleting an imported session keeps it out of later imports.

Claude Code web sessions (claude.ai/code) live in the cloud until Claude Code pulls them down. Choose a project, press **☁**, pick the session in the window that opens, then press **⤓**.

### Merge sessions

To combine work on the same project, open one session, hover another and press **⇲** to fold it in, or press **⇊** to merge every listed session (narrow the list with search first). Messages are combined in time order and the other sessions are removed. Only sessions in the same project can be merged.

To do this automatically, turn on **Settings → Sessions → Group imported sessions into threads**. Each new import then joins the thread in its project on the same topic (shared files and terms), so one project can have several threads. An import on a new topic stays on its own until a related one arrives. Merged sessions stop refreshing when you keep working in the CLI.

To tidy sessions you imported earlier, press **⟳** above the session list. Each imported session you haven't continued or merged yourself moves to the project it fits best, and sessions on the same topic within a project are merged into threads. This happens even when the setting above is off.

Saved imports are indexed even if their original CLI transcripts are no longer available. Automatic topic merges leave sessions separate when combining them would exceed the message limit, preserving their history.

### Merge projects

If several folders are one project at different stages, open the newest one, hover an older one in the Projects list and press **⇲**. The older folder then appears under the open project. Its sessions move there, new imports about it go there too, and providers can read its files but never edit them. The folders on disk stay as they are. Press **⇱** next to a folder to split it back out. Sessions that were already moved stay with the parent project.

For example, select **talonforge**, then press **⇲** on **reasense** and **rea-predatorsense-tool**. Press **⟳** to index earlier imports and combine matching topic threads under talonforge.

### New project

Press **+** next to **Projects** and type a name. The app creates an empty folder with that name in your Projects folder and opens it.

## Routing and providers

The route picker at the top left of the conversation (it shows **Auto** by default) offers **Auto** plus one entry per route, each with a one-line description and the provider set for it: Route Planning, Long Term Project planning, Coding, Reviewing, Security audit, UI Designer, Art Asset generation, GitHub requests, and Quick questions. Auto asks the Route Planning provider to pick a route (using the editable `lessons.md` guidance), then runs it. Choosing a route directly skips that step. Choosing **Route Planning** only reports which route it would pick.

Every installed provider (Colibri, Codex, Claude Code, Copilot) can be assigned to every route in **Settings → Routing & models**. The router no longer restricts what a command-line provider (Claude Code, Codex, Copilot) may do. Each one follows its own configuration, and the route only decides which provider gets the task. The table shows what each route is for:

| Route | Used for |
|---|---|
| Quick questions, Route Planning | No project access |
| Long Term planning, Reviewing, Security audit, project questions | Reading the project and reporting; no edits expected |
| Coding, UI Designer, Art Asset generation | Editing files in the project (in a private copy with a review step if you ask for one) |
| GitHub requests | git and GitHub work |

Each thread (session) can narrow this further with **Thread access** in the top bar: *Full* uses the table above, *Review edits first* sends every edit through a private copy you Apply and blocks git/GitHub, *Read-only* blocks editing and GitHub routes, and *No project access* allows only Quick questions. A thread can never get more access than its route.

**Permissions.** The **Permissions** picker in the top bar (the chip of the same name on the phone) sets Claude Code's mode for the thread, with the same four choices as Claude desktop: *Ask permissions* (asks before edits and commands its settings don't allow), *Accept edits* (file edits run without asking), *Plan mode* (Claude plans first; the plan comes up as an approval card before anything changes) and *Auto* (Claude decides, with its own checks on risky actions). A new thread starts on your Claude Code default mode (`permissions.defaultMode` in `~/.claude/settings.json`), or Ask permissions. Bypass permissions isn't offered. Codex and Copilot ignore this picker and follow their own settings.

**Approvals.** Claude Code uses your own settings (`~/.claude/settings.json` and the project's `.claude/settings*.json`): anything they allow runs, anything they deny is refused, and anything they would ask about shows up in the router as an approval card above the message box: the plan, the command, or the file and its new content (other tools show their exact input). The run waits until you choose one of three answers:

- **Always allow** – runs it and asks Claude Code to save the rule it suggested (for example `Bash(npm test:*)`) in its own settings file, so Claude Code stops asking for it. The router never remembers answers itself. Shown only when Claude Code offers a rule it can save; otherwise the card says Always allow isn't available for this request. In a staged copy the rule lands in the copy's `.claude/settings.local.json` and shows up in the change preview.
- **Allow** – runs it this once.
- **Deny** – refuses it. Stop denies every open card. Cards show for any open page following the run, including after a reload. Codex (`codex exec`) and Copilot can't ask during a run, so they do only what their own configuration allows (Codex: `sandbox_mode` and `approval_policy` in `~/.codex/config.toml`; Copilot: its tool approval settings) and refuse the rest. To limit what a provider can do, set it in that provider's configuration. Local models and API-key models have no file tools, so they receive the project's file list, key docs and any files your request names inline; for editing routes it returns whole files that the router writes into the private copy. Claude Code always uses your signed-in subscription (API key overrides are removed from its environment).

The app does not store provider credentials. Cloud agents receive the task and can inspect files in the selected project. Keep secrets out of prompts and project folders accessible to agents.

## Live work, context, and approvals

Responses stream as each provider makes text available. Select **Stop** to cancel a request, or **Retry** after a stopped or failed request. Attach small text/code files, PDFs, or PNG/JPEG/WebP images, or choose up to 10 text files from the current project. PDF text is extracted locally with PDF.js and included in prompts. Images are sent only to Colibri for vision input. Attachment material stays on this computer with the session and can be reused from the transcript; avoid choosing credentials or secrets.

**Linked folders:** when Project A needs to read another folder, select Project A and press **+** next to the message box. Tick another project under **Linked folders**, or choose **Link a folder…** to pick any folder on this PC. Linked folders are saved with the project, so they stay linked until you untick them. Every route with project access can then read them, and their files show up in **Choose project files…**. Only the selected project is ever edited: coding routes get a throwaway copy of each linked folder, so changes to it are discarded. Large linked folders make coding tasks slower to start, because they are copied for each task. Files over 50 MB (models, videos, disk images) are left out of that copy, and folders named `node_modules`, `.git`, `dist`, `build`, `release`, `venv` and similar are skipped. A top-level `build` folder that holds only files (installer scripts and icons, no subfolders) is kept, so staged changes to `build/installer.nsh` reach the project.

**Attaching files:** the same **+** menu has **Attach files…** (files from anywhere on this PC, sent with the next message) and **Choose project files…** (up to 10 files from the project and its linked folders).

Coding, UI and art tasks edit the project folder directly, and the reply lists the files that changed. What coding agents may run without asking is set in each provider's own configuration (see Approvals above). To review changes first, ask for it in the task (for example "use a staged copy" or "preview the changes"). The task then runs in a temporary copy, the app shows changed, removed, and unchanged lines for each file, and the real project is updated only after **Apply changes**. Before applying, the router checks that the original files still match the preview. Security reviews, quick questions, and explicit GitHub pushes keep their existing behavior.

## Shared skills

Skills are your own: they live in `%LOCALAPPDATA%\LocalAgentRouterData\skills.md` (the index) and `skills\` (one Markdown file per skill), so they survive updates and are never shipped with the app. Add more from the app's **Shared skills** panel, or from GitHub in **Settings → Add new skills**: paste a link to the skill (its SKILL.md, its folder, or the repo), press **Scan**, read its purpose and warnings, then choose **Install** or **Do not install**. Installed skills are pre-approved for every provider; untick them under **Shared skills** if you don't want that. Only the SKILL.md text is installed, never bundled scripts, and the scan is a pattern check, not a guarantee. In Settings, approve skills to include them automatically and set the per-request limit: `-1` means unlimited, `0` sends no skills, and a positive number sets the maximum. Approved skills are considered before task-selected skills. Imported skills retain source attribution, and providers are told to adapt tool-specific steps to their available tools. Rate answer quality and whether Auto chose the right route; both stay local and aggregate counts inform future GPT routing prompts. Provider status checks show installed and sign-in readiness without displaying credentials.

## Settings

Open **Settings** from the bottom of the left panel (or the ⚙ button in the top bar while the left panel is hidden). Sections are listed down the left side: **General**, **Appearance**, **Routing & models**, **Sessions**, **Shared skills** and **Add new skills**.

The desktop uses a three-area layout: projects and sessions on the left, the conversation in the center, and an agent output panel on the right. While a task runs, the panel streams what the agent is doing: status steps, the files Claude Code reads and edits, and the text each provider prints. **Task details** at the bottom of the panel shows the project scope, selected files, skills, and how the active route uses them. Collapse the panel with **Hide details**.

You can run several sessions at once, in the same project or in different ones. Start a task, then open another session or project and start work there; the first keeps running. Each session runs one request at a time and has its own output and **Stop**, and stopping one doesn't affect the others. Sessions keep running if you reload the window: when it comes back, running sessions reappear with everything they've written so far, and finished answers are saved even if no window was open. A session that failed or was stopped while you were away shows its error and **Retry** again for 30 minutes. Quitting the app stops all sessions.

Only one session can edit a project's files at a time. While a session is editing, the project is read-only for the others: you can still ask questions or request a review there, but an edit request gets a **Project locked** reply. To work on changes side by side, ask for a staged copy; you can apply it once the other edit has finished.

The **Routing & models** settings tab offers provider/model dropdowns populated from Colibri's live model endpoint, Codex's model catalog, and supported Claude Code and Copilot CLI choices when those tools are installed. Configure a preferred provider/model and a cross-provider fallback for Route Planning, Long Term Project planning, Coding, Reviewing, Security audit, UI Designer, Art Asset generation, GitHub requests, and Quick questions. A selected fallback is tried after a provider error; when a usage limit is reached and no fallback is selected, the router chooses another available provider/model. The art role creates project-ready assets such as SVG where supported; these CLI providers do not expose a shared raster image-generation endpoint. Provider plan limits can apply across models, so retries may still fail. **General** lets you set a system-wide keyboard shortcut to open the app and focus the message box, or turn it off. The default shortcut is `Control+Shift+Space`.

**Local models (Colibri).** If Colibri is installed the standard way (START-HERE.bat), Settings → Routing & models lists its installed models. Pick any of them for any task: Colibri holds one model at a time, so when a task needs a different one the router waits for running local requests, switches Colibri (`coli stop`, then `coli setup --model-dir`, keeping its port, backend and context size) and waits until the model has loaded. A stopped Colibri is started the same way. **Load now** switches right away; **Add or manage models…** opens Colibri's Model Manager to download, import, rename or delete models. **Local models only** keeps every step, including Route Planning and task chains, on Colibri: each task uses its Colibri choice (preferred, else fallback, else the default local model) and never falls back to a cloud provider.

Set `AGENT_ROUTER_PROJECTS_ROOT` to change the folder shown as the project list. Set `COLIBRI_BASE_URL` or `COLIBRI_MODEL` to override Colibri's local endpoint or model. The internal service listens only on this computer; the desktop app embeds the interface and does not open Chrome.

Run `node evaluate-routing.mjs` to score the GPT route selector against synthetic engineering and everyday prompts. The evaluator is read-only and does not invoke Claude or Copilot.

### Task chains

Choose **Task chain**, or use Auto for an app/spec request needing multiple roles. The planning provider splits the work into coding, UI, art and review tasks as needed. A security audit is never part of a chain: ask for one separately (Security route) when you want it. Build tasks with separate declared paths run together; overlapping tasks run sequentially. Reviews run after builds finish. Each task uses its configured role provider. The final response includes each result and any failures; findings are reported rather than automatically repaired. Select one project. Thread access still applies, and Review edits first produces one combined preview. Declared file ownership guides providers; it is not a separate filesystem sandbox per task.

### Persistent project memory (0.14.0)
Every project provider run now receives recent saved reports across threads and restarts. Review and security reports have a separate history so ordinary coding tasks do not crowd them out. Reports live in the app data folder under `project-memory/`, separate from the latest-task handoff. Reviews and security audits must reconcile earlier findings with current files and distinguish verified fixes from unverified claims; other routes get the history as background only, so their answers stay short. Recent context is bounded (12 records per history, 64 KB tail); full histories remain on disk. Memory contains provider reports, not independently verified security verdicts. Staged edits still require applying and verification.

CLI tasks may run longer than 15 minutes while producing output. After 15 minutes without stdout or stderr, the router stops the process tree and reports an inactivity timeout. Stop remains available. Provider usage limits require waiting for reset or using another provider.

### Mobile and cross-device updates (0.20.0)

Desktop discovers active phone requests about every two seconds. In mobile chat, Enter sends and Shift+Enter inserts a newline. The plus menu offers phone attachments, server project text files, and linking an existing server project folder.

While a response runs, submit a nonempty message to queue it. **Steer** stops the current provider run and restarts its task with your correction; it is not live provider input. Submit with an empty composer to stop. Queued work belongs to the running server and does not survive a server restart.

In server **Settings ? Remote access**, optionally enter a custom device key (24?128 printable characters, no spaces). Choose a unique, hard-to-guess key. **Replace key** on a paired device invalidates its previous key and shows a fresh one to copy. The original key cannot be recovered because only its hash is stored. **Copy connection code** includes address and key: paste it into the phone's Connect screen to fill both without typing the address. Treat that code like a password. Automatic network discovery remains pending.

Auto remembers an implementation workflow for implementation follow-ups while retaining saved thread limits. Explicit read-only threads remain read-only; questions and reviews still route normally. See [KNOWN_PROBLEMS.md](KNOWN_PROBLEMS.md) for remaining device acceptance.
