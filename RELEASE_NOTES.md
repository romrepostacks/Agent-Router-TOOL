# v0.36.0 MCP servers and free providers

- Settings → MCP servers: add your own MCP servers (a command or an HTTP address). Claude Code, Codex, Copilot and Ruflo runs get them on top of their own MCP settings, and still ask before using their tools.
- Ruflo runs now load all of Claude Code's own MCP servers too (including plugin servers), not only Ruflo and your list.
- Free-tier API providers in setup: Groq, Cerebras, Google Gemini, OpenRouter (free models), Mistral, SambaNova, NVIDIA NIM and Hugging Face. Free tiers have rate limits and some use prompts for training.
- Phone apps: the APK and IPA now carry the same version as the desktop app (0.36.0), and a newer APK installs over an older one.

# v0.35.0 polish

- Settings → AI tools shows Node.js and Ruflo with their status.
- The output panel shows readable Codex steps (commands, edited files) instead of raw messages.
- The session list fills the sidebar.
- Send stays off until you type a message.
- All Projects threads say "Read-only (all projects)" in the access picker instead of "Full access".
- Fixed: the router's own route-planning runs were imported as sessions.

# v0.34.1 skill family fix

- Fixed: a skill family disappeared from Shared skills when one of its members, listed on its own, had the same name in the same category.

# v0.34.0 question cards and skill families

- When Claude asks you something (its AskUserQuestion tool, including under Ruflo), the card now shows each question with its answer choices and an Other answer, on the desktop and the phone. Your answers go back to Claude; before, the card only offered Always allow / Allow / Deny and Claude never got an answer.
- Skill families: a skill whose file lists members under `## Child guidance` is one skill in Shared skills, with its member names shown under it and included in search. Members also listed on their own fold into the family, including saved selections and approvals. Using any member counts as using the family.
- Fixed: answers to very long questions, "Denied" shown for answered questions, the phone's question notification title, saved skill picks of family members being dropped, and families being deletable through the API.

# v0.33.0 installer and UI

- The installer includes the Ruflo backend runtime, and installs Node.js, Claude Code, Codex and GitHub Copilot on every Server install (no longer optional; failed installs can be retried or skipped).
- Fixed: oversized primary buttons in setup and Settings, truncated session titles, "not currently listed" provider-default models after setup, token counts joined to output text, overlapping sidebar in narrow windows, faint dialog backdrop.

# v0.33.0 Ruflo backend

- Ruflo is the backend of the normal app. The separate Ruflo version (`--ruflo`, its own data folder, ports and profile) and the backend comparison script are removed.
- The built-in router handles requests Ruflo can't run (Local models only, no single project, no project access, Ruflo or Claude Code missing) and Ruflo usage limits. Fixed: that usage-limit fallback was refused before any provider ran.

# v0.33.0 usage-limit fix

- Ruflo host usage limits fail over visibly to original routing with another provider. Short limit-only responses no longer count as successful work.

# v0.33.0

- Comparison reports distinguish provider completion from passing output checks; missing proposals count as empty deliverables and expose missing required files.

- Added `node scripts/compare-backends.mjs` to send the same prompt to the original and Ruflo versions and write a side-by-side report.
- The Android APK now builds on GitHub Actions (`android-debug` workflow), alongside the iOS IPA.
- Ruflo's `.claude-flow/` project state is git-ignored.
- Ruflo runs need a swarm only when work fans out to more than one agent. Answers and small single-agent edits finish after Ruflo's routing step; Activity notes "No swarm" when none started.
- Fixed: approval prompts from Claude Code subagents failed with "Stream closed" once the main turn ended. Subagents now run in the foreground (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS`), so every write they ask for reaches an approval card.
- The comparison script saves each version's proposed files from staged edits under `.agent-router/compare/<run>/<version>/` (never applied).
- Token counts for Claude Code runs now include subagents (from Claude Code's per-model totals), plus API-equivalent cost, turns and model API time. A finished or failed run's final event carries its per-call `usage`.
- The comparison report adds tokens, cost, turns, models, time to first output, output size, missing required files, broken local links, external loads and source-term coverage (`--require`, `--terms`), and saves raw metrics as `.json`.

# v0.32.0

- Added a separately launched Ruflo version using the existing desktop/mobile front end, with isolated sessions and settings for side-by-side comparison.
- Ruflo coordinates tasks through MCP with Claude Code as execution host. Original routing and provider fallback are excluded; observed agent requests and returned decisions are shown in Activity.
- Preserved approval cards, Stop, read-only workflows, project locks and staged proposals. Requires a separately installed pinned Ruflo runtime; see README.

# v0.31.2

- Removed the task-chain commit prohibition and the rules editor commit restriction example.

- GitHub requests allow explicitly requested commits and other Git actions; provider approvals and thread limits still apply.

- Codex and Copilot pass interactive command/file permission requests to approval cards across sessions and routes.
- Approval waits stay exempt from the inactivity timeout even during provider activity.

# Release notes

## 0.31.1

- **Changed files go to an action log, not the chat.** Replies no longer end with a `Files changed:` line. Each edit run that changed files adds an entry to `action-log.md` in `%LOCALAPPDATA%\LocalAgentRouterData\`.

## 0.31.0

- **Pick your theme: Harbor, Moss or Ember**, on both the desktop and the phone apps. Harbor is cool slate with your Windows accent color (the desktop's default), Moss is sage green with rounded headings, and Ember is amber with monospace headings (the phone's default).
- **Light, dark or follow the system, for every theme.** Desktop: **Settings → Appearance → Theme** and **Mode**. Phone: **Settings → Appearance**, saved on that phone. The phone's System setting now switches straight away when the phone changes between light and dark.

## 0.30.0

- **New look for the phone apps: "Ember".** Ink-dark by default with an amber accent and monospace titles and labels; a warm light version is under **Settings → Appearance**. Both pass the WCAG AA contrast check.
- **Floating chat screen on the phone.** No top bar in a chat: Back and **Output** float over the messages. Answers read as plain text with a small route label, your messages sit in soft bubbles, and approval cards have an amber edge.
- **One rounded task box.** The text sits on top, with **+**, the route/skills/access chips and a round Send button below it. Send stays grey until you type. While a response runs, Send turns into a square **Stop** button and **Queue** / **Steer** float just above the box.
- Desktop app unchanged apart from the version, which now matches the phone apps.

## 0.29.0

- **Sessions name themselves.** A new session is titled from your first message, cut down to the task: "We should add automatic session naming. Let's also…" becomes "Add automatic session naming". Rename it from **⋯** as before.
- **Calmer chat layout with a new "Harbor" palette.** Cool slate greys replace the warm ones (dark mode too). Answers read as plain text without avatars, your messages sit in soft bubbles on the right, and the rating buttons show when you point at an answer. The start screen has a time-of-day greeting, the composer is larger, grows as you type, and sends with a round arrow button. The selected project and session are highlighted in grey instead of the accent color.

## 0.28.4

- **Node.js download no longer fails with 404 on PCs without winget.** Windows PowerShell 5.1 read the nodejs.org release list wrongly, so the download address had no version in it. Codex and Copilot failed after it. Fixed in Setup and in **Settings → AI tools**.

## 0.28.3

- **Claude Code installs from Setup again.** Setup started the 32-bit PowerShell, and Claude Code's installer refused it as "32-bit Windows". Setup now uses the 64-bit PowerShell.
- **Codex and Copilot install on PCs without winget** (Windows Sandbox, LTSC, older Windows). Node.js, which they need for npm, is now downloaded from nodejs.org and installed when winget isn't there, both in Setup and in **Settings → AI tools**.

## 0.28.2

- **Skills reach the local model again on project routes.** Since 0.23.0 skills go out as a short index with file paths, and chat providers (local model, OpenAI and Anthropic API) get the skill text inlined because they can't open files. On routes that read the project (Review, Project, Code and the rest) that inlined text was thrown away, so those providers saw only file paths they couldn't open. Fixed, with a test (`test/chat-provider-skills.test.mjs`).
- Phone apps rebuilt as 0.28.2 so the desktop and phone versions match.

## 0.28.1

- **Dropdown lists follow dark mode.** The Thread access and permission pickers (and every other dropdown) opened a light list in dark mode. They now use the dark colors.

## 0.28.0

- **Phone apps (APK and IPA) catch up with the desktop app as of 0.27.** The phone app's version is now the same as the desktop app's again.
  - **Rename and move sessions:** **⋯** on a session row opens a sheet to rename it, move it to another project, or delete it.
  - **Queue, Steer and Stop buttons** while a response runs, the same as the desktop. Enter steers. An empty message no longer stops the run; use **Stop**.
  - **Skills sheet:** each skill shows its usage line (used in X of Y runs, average tokens per run, 👍/👎). Skills you added in the app can be deleted with **×**.
  - **Settings:** **Local models only**, **Rules for every task** (saved only when you tap **Save rules**) and **Token use by provider**.
- README → Phone apps now lists what the phone app does and builds with `npm run build:android` / `npm run build:ios`.
- **Thin windows no longer overlap.** When the main area is narrow (small window, or both side panels open), **Thread access** and the Claude Code permission picker fold into a **⋯** menu next to **+**, so Queue, Steer and Stop have room. The top bar shows the status as dots (hover for details), hides the project path, and shortens a long route name instead of pushing buttons off. The **+** and route menus no longer stick out past the window.

## 0.27.0

- **Cleaner main screen.** The top bar is one slim row: panel buttons, the route menu, the project name, and small ready dots for the local model and AI tools. Hover a dot for the details. The separate status bar is gone.
- **Everything for the task is in the task box.** The **+** button is at the bottom left and now holds files, linked folders, **Shared skills** and the privacy note. **Thread access** and the Claude Code permission mode are small pickers beside it.
- **Session tools in one menu.** Import, pull from the cloud, re-file, merge and **Pending reviews only** are in the **⋯** menu above the session list.

## 0.26.0

- **AI tools in the installer:** a Server install now has an optional **AI tools** page. Tick Claude Code, Codex and/or GitHub Copilot and setup installs them after the app, in a PowerShell window. Node.js is installed first if Codex or Copilot need it, and tools already installed are skipped. Silent installs take `/TOOLS=claude,codex,copilot`.
- **Settings → AI tools:** installing and signing in to Claude Code, Codex and Copilot moved out of the first-run setup guide into its own Settings tab. The setup guide keeps the projects folder, local model and API key steps.

## 0.25.0

- **Real token counts:** every provider call in a task now records the tokens the provider itself reports: Claude Code and the Anthropic API (input, cached, output), OpenAI and local models that report usage, and Codex (total only). Copilot doesn't report tokens; its calls are counted without them.
- **Where you see them:** each call's tokens appear in the task's details pane. **Settings → Shared skills → Token use by provider** shows calls and tokens per provider and model. Each skill's usage line now shows average tokens per run instead of prompt characters, once a run that used it reported tokens.

## 0.24.0

- **Delete skills you added:** under **Settings → Shared skills**, each skill you added in the app's **Shared skills** panel now has a **Delete** button. It removes the skill and its always-on approval; its usage counts are kept. Skills installed from GitHub or imported from other tools have no Delete button.
- **Fresh skill counts:** opening Settings now reloads each skill's usage line, so counts from tasks you just ran show without restarting the app.

## 0.23.0

- **Smaller prompts with many skills:** selected and pre-approved skills are now sent as a one-line-each list with each skill's file path instead of their full text. CLI providers read a skill only when it applies; local and API-key models still get the text, shortened in task chains. With 37 pre-approved skills this cuts well over 100,000 characters from every prompt and every chain step.
- **rules.md:** short rules in `%LOCALAPPDATA%\LocalAgentRouterData\rules.md` are sent with every request, whatever the route or provider. Edit them in **Settings → General → Rules for every task**.
- **Skill usage in Settings:** each skill under **Shared skills** now shows its size, how many tasks it went out with, and how many of those actually used it (Claude Code, Codex or Copilot opened its file; an answer that only mentions a skill's path doesn't count). For the tasks that used it: how they ended (done, failed, stopped), their average prompt size, and the thumbs up/down given to their answers. Skills that went out but were never used say so. Local and API-key models get skill text inlined, so their use isn't counted. Counts start with this version.
- **Merged projects are hidden from the Projects list.** A folder merged into another project no longer shows under it. To split folders back out, right-click the project and choose **Unmerge projects…**, then split out one folder or all of them.

## 0.22.2

- **Fix: merging sessions failed with "EPERM: operation not permitted, rename … sessions.json".** Saving now waits and retries when Windows briefly has the file open elsewhere (for example antivirus or another read), instead of failing at once. This applies to sessions, settings, change previews and project files.

## 0.22.1

- **Separate Queue, Steer and Stop buttons:** while a response runs, the composer shows three buttons instead of one combined "Queue / Stop" button. Steer is blue and is what Enter does; Queue sends after the response; Stop ends it. Queue and Steer stay disabled until you type something.

## 0.22.0

- **Task chains fit local models:** chain steps no longer resend the full plan and every earlier result. Each step gets its own task, a one-line list of the other steps and a short handoff from each earlier step (the start and end of its report, including changed files). Reviews are told to check the current files. Full results still appear in the final chain report.
- **Smaller chain context:** planner and step prompts carry only the latest 4 project-memory reports, shortened and without their old task text, and chat providers (Colibri) get at most ~12,000 characters of project files instead of 40,000. Chain steps no longer repeat the shared handoff note.

## 0.21.0

- **Rename sessions** with ✎ on a session row, and **move sessions** out of All Projects by dragging them onto a project (or ⇥ → Move to…).
- **Merging projects keeps every file:** the merged folder moves into `<project>\obsolete\<name>`, the move is written to `obsolete\MOVED.md`, and agents are told the new location. Splitting moves it back.
- **More local models (Colibri):** Settings → Routing & models lists every model installed in Colibri. Any task can use any of them; Colibri switches to the right model (and starts if stopped) before the task runs. **Add or manage models…** opens Colibri's Model Manager.
- **Skill reviewers:** scanning a skill from GitHub now also runs NVIDIA SkillSpector and Cisco Skill Scanner and shows each verdict and its findings separately. If one isn't installed, **Install the missing reviewers…** sets them up.
- **Send feedback:** Settings → General → Feedback sends a report anonymously with the app version, models, providers (subscription, API key or local), routes and basic machine specs (OS, CPU, memory, GPUs). **What's sent with it** shows exactly that before sending; no names, folders, keys, chats or files.
- **Uninstall:** Start menu → Uninstall Local Agent Router (or Windows Settings → Apps). It asks whether to also delete your settings, chat history, saved keys and paired devices; the answer defaults to keeping them. Updates never delete them.
- **Local models only:** one switch keeps every step, including Route Planning and task chains, on Colibri, with no cloud fallback. Each task uses its own Colibri model.


## 0.20.0

- Desktop discovers mobile-started work while open.
- Mobile keyboard Send, server project context and linked-folder choices.
- Optional custom pairing keys, replacement keys, and copyable connection codes.
- Queue follow-ups or restart a running task with Steer; implementation follow-ups retain their route within thread access limits.
- Automatic network discovery and native-device acceptance remain tracked in KNOWN_PROBLEMS.md.

## 0.19.0

- **Fixed: the installer wouldn't build.** electron-builder stopped with a `builder-util` error; the cause was the Server/Client setup page using an installer macro that isn't loaded yet at that point. The page now sets its heading directly.
- **Permissions like Claude desktop:** each thread has a **Permissions** picker with Claude desktop's four modes: Ask permissions, Accept edits, Plan mode and Auto. New threads start on your Claude Code default mode.
- **Clearer approval cards:** cards show the plan ("Approve this plan?"), the command, or the file and its content instead of raw JSON, on the desktop and the phone.
- **Task chains no longer include a security audit.** Ask for one separately with the Security route.
- **Shorter answers:** "what's next" answers lead with the best next task and list at most three, and every route keeps its next steps to three short lines. Only reviews and security audits report on earlier findings now.

## 0.18.0

- **Fixed: setup didn't ask Server or Client.** The 0.17.0 installer was built with the old setup script, because the router left the `build/` folder out of staged changes and the new Server/Client page never reached the project. The page is back: Server or Client first, then install for me / everyone, then the folder. Updates keep the earlier choice. Staged changes now keep a top-level `build/` folder that holds only files (installer scripts, icons).
- **Approval cards have three answers:** **Always allow** (Claude Code saves the rule it suggested in its own settings and stops asking), **Allow** (this once) and **Deny**. Always allow appears only when Claude Code offers a rule it can save; the router never remembers answers itself.
- **Phone apps:** README → Phone apps explains how to build and install the Android APK and the iPhone IPA. None has been built yet: an APK needs Android Studio, an IPA needs a Mac with Xcode.

## 0.17.0

- **Server or Client:** setup now asks first whether this PC is the **Server** (runs the AI tools and projects, as before) or a **Client** (same window, connects to your server over Tailscale; nothing runs on the Client PC). Then it asks for the install folder as before. Updates keep the earlier choice selected. The version shows the choice, e.g. `0.17.0 client` in Windows Settings → Apps.
- **Remote access over Tailscale:** the server can accept Client PCs and the phone apps on its Tailscale address only. Each device gets its own token, shown once; removing the device cuts it off at once. Adding devices, API keys and setup windows stay on the server PC.
- **For the phone apps:** a plain-JSON run snapshot (`GET /api/runs/<session>`) and a notifications feed (`GET /api/notifications`) for finished, failed and stopped runs and approval requests. See README → Remote API.

## 0.16.0

- **Providers decide, you approve:** the router no longer adds its own allow and block lists to Claude Code, Codex or Copilot. Each follows its own configuration.
- **Approval cards:** when Claude Code's settings would ask before a tool runs, the question appears in the router with the tool and its exact input. The run waits for **Allow** or **Decline**; Stop declines. Cards come back after a reload.
- Codex and Copilot can't ask during a run, so they do only what their own configuration allows. Set limits there.

## 0.15.1

- Active CLI tasks continue past 15 minutes; the timer now measures time without output. Windows timeout stops the process tree.
- Recognize Claude numeric hour usage limits for automatic fallback.

## 0.15.0

### What's new
- **A real setup wizard:** choose whether to install for just you or everyone on the PC, and pick the install folder. If Local Agent Router is already installed, setup tells you and updates it in place. Copies installed by the old one-click installer are removed after the new version is in. Your settings, sessions and skills are kept. Uninstall from Windows Settings → Apps.
- **Run several sessions at once:** a session keeps running while you start work in another session or project. Each session has its own run, output and Stop; stopping or finishing one doesn't touch the others. A session can run one request at a time.
- **Runs survive a reload:** reloading the window no longer stops running sessions. The page picks them back up with their output so far, and the server saves each answer when it finishes, even with no window open. A run that failed or was stopped while the page was away still shows its error and Retry for 30 minutes. Only Stop (or quitting the app) ends a run.
- **One editor per project:** while one session is editing a project's files, that project is read-only for every other session. Questions and reviews still work; an edit request gets a "Project locked" reply instead of clashing with the running edit. Staged copies still work side by side, but applying one waits until the edit finishes.

### Fixes
- **No lost messages when runs finish together:** saving sessions and change previews is now done one at a time, so two answers saved at the same moment are both kept.

## 0.14.1

### Fixes
- **Fewer blocked commands in Claude Code runs:** allowed check commands (for example `git status`) were refused when a command hook such as RTK rewrote them to `rtk git status`. Both forms are now allowed, and force-push stays blocked in both forms.
- **Review and security routes can read git history:** they may run `git status`, `git diff`, `git log`, `git show` and `git blame` (Claude Code and Copilot). They still cannot edit files or run other commands.
- **Claude Code runs behave more like an approved interactive session:** every project route can read files outside the project and linked folders and use WebFetch and WebSearch. Code, UI and art tasks can run any shell command (Bash or PowerShell) except deletes, package installs and history rewrites such as `git reset --hard` or force-push. Copilot code tasks get the same shell rules. Credential files (`.ssh`, `.env`, Claude, Codex and GitHub CLI logins) stay unreadable. Staged-copy tasks keep the short list of check commands so their edits can't skip your review. MCP tools are still not allowed automatically.

## 0.14.0

- Task chain routing: planning delegates build tasks, then reviews and security checks the completed workspace. Results are collected into one report; staged threads get one change preview.

## 0.13.1

### Fixes
- **Skill scan size limit:** Scan now stops downloading a skill as soon as it passes 200 KB, instead of downloading the whole file first.

## 0.13.0

### What's new
- **Add new skills from GitHub:** Settings → Add new skills. Paste a link, press Scan, review the skill's purpose and warnings, then Install (green) or Do not install (red). Installed skills are pre-approved for every provider.

### Fixed
- **Linked folders with big files:** editing tasks no longer fail with a "file size greater than 2 GB" error. Files over 50 MB in a linked folder are left out of the read-only copy the provider sees, and project files are hashed in pieces instead of loaded whole.

## 0.12.1

### Fixed
- **Route picker:** Arrow Down/Up on the button opens the menu; Home/End jump to the first/last route; Tab closes it.
- **Settings tabs:** Arrow Up/Down, Home and End move between tabs; only the selected tab is in the Tab order.
- **Theme:** closing Settings without saving now puts the saved theme back instead of keeping the preview.

## 0.12.0

### What's new
- **Thread access:** set each thread to Full, Review edits first, Read-only, or No project access from the top bar.
- **Linked folders and + menu:** link other folders as read-only references; attach files and pick project files from the composer's **+** button.
- **Live agent output:** the right panel streams what the running agent is doing.
- **UI refresh:** new palette, vertical Settings tabs, route picker, and **+** to create a project.
- **Smarter session import:** imports are filed to the best-matching project and grouped into topic threads; projects can be merged and split.
- **Direct edits:** Coding, UI and Art edit the project in place and can run checks like `node --check` and `node --test`; ask for a staged copy to review first.
- **Fixed:** "This change set is too large to preview" for edits to large files; diffs now show only the changed lines.
- **Fixed:** false "usage limit" errors, CLI runs failing in the installed app with no project selected, and local model name mismatches.
- **Fixed:** rebuilding the installer without a version bump left the old app installed. The build script now refuses to rebuild a version it already built.

## 0.11.0

### What's new
- **Import your existing history:** Claude Code and Codex CLI sessions, plus Codex Cloud tasks, show up as app sessions, matched to their project. Import runs on start and from the ⤓ button in the Sessions header.
- **Claude Code web sessions:** ☁ pulls a web session into the project with `claude --teleport`; the next import picks it up.
- **Merge sessions:** ⇲ on a row folds it into the open session, and ⇊ merges every listed session. Only sessions in the same project are merged, and messages are combined in time order.
- **Fixed:** installed app failed to start looking for a bundled skills.md.
- **Fixed:** the installer left out the app's runtime packages (Anthropic SDK, PDF viewer), so the installed app could not start.

## 0.10.1

First public release of Local Agent Router, a Windows desktop app that sends each request to the AI tool best suited for it: Claude Code, Codex, Copilot, a local model, or OpenAI and Anthropic API keys.

### Install
1. Download **Local Agent Router-0.10.1 Setup.exe** below and run it. The installer isn't code-signed yet, so Windows SmartScreen may warn you: click **More info**, then **Run anyway**.
2. On first launch, a 6-step setup guide walks you through your projects folder, installing or signing in to the AI tools you use (skip any you don't have), an optional local model, and optional API keys.

### What's in 0.10.1
- First-run setup guide with Install, Sign in and Skip for each AI tool, plus Node.js when needed.
- Routes pick from the tools you actually have and fall through to the next one when a tool is missing.
- OpenAI and Anthropic API keys, encrypted with Windows.
- Any OpenAI-compatible local model (Ollama, LM Studio, Colibri).
- Start menu and desktop shortcuts.
- Your skills live in your own data folder (`%LOCALAPPDATA%\LocalAgentRouterData`) and survive updates.

### 0.14.0 additional changes
- Persist project provider reports across threads and restarts, including separate review/security history. Later reviews must reconcile earlier findings with current evidence and state what remains unverified.
