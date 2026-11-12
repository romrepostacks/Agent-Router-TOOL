# Release notes

## 0.21.0

- **Rename sessions** with ✎ on a session row, and **move sessions** out of All Projects by dragging them onto a project (or ⇥ → Move to…).
- **Merging projects keeps every file:** the merged folder moves into `<project>\obsolete\<name>`, the move is written to `obsolete\MOVED.md`, and agents are told the new location. Splitting moves it back.
- **More local models (Colibri):** Settings → Routing & models lists every model installed in Colibri. Any task can use any of them; Colibri switches to the right model (and starts if stopped) before the task runs. **Add or manage models…** opens Colibri's Model Manager.
- **Skill reviewers:** scanning a skill from GitHub now also runs NVIDIA SkillSpector and Cisco Skill Scanner and shows each verdict and its findings separately. If one isn't installed, **Install the missing reviewers…** sets them up.
- **Send feedback:** Settings → General → Feedback sends a report anonymously with the app version, models, providers (subscription, API key or local), routes and basic machine specs (OS, CPU, memory, GPUs). **What's sent with it** shows exactly that before sending; no names, folders, keys, chats or files.
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
