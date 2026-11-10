# Known problems and upgrade list

One list for reported problems and planned upgrades. Updated for v0.20.0 (2026-11-09).
This file replaces `UPGRADE_LIST.md`; its items are in **Upgrade list** below with their current status.
Checked items have source fixes and automated regression coverage where noted; native-device and in-app acceptance is listed separately at the end.

## Mobile app

- [x] Requests from mobile do not appear on desktop simultaneously. Desktop now discovers and follows server-owned runs every two seconds, including the request and streaming answer; session lists refresh too. A project-switch guard prevents background refresh from replacing another project's sessions.
- [x] Cannot recopy a device key after sign-out. Remote access now offers **Replace key** on each existing device, showing a fresh key to copy without deleting the device. Replacement invalidates the old key. Existing keys are hashes and cannot be recovered verbatim. Regression: `test/remote-client.test.mjs`.
- [x] Custom remote access keys are not allowed. Device creation accepts an optional unique 24–128-character printable key without spaces; only its hash is saved. Short and duplicate keys are rejected. Regression: `test/remote-client.test.mjs`.
- [x] Keyboard Send inserts a newline. Enter submits, Shift+Enter adds a newline, and composition input is left alone; the input requests a Send keyboard action. Regression: `test/mobile-composer.test.mjs`.
- [ ] Detect server rather than manually typing its address. **Partial:** copying a connection code from desktop Remote access and pasting it into Connect fills and validates both address and key. Automatic network discovery is not implemented. Regression covers code parsing and rejected hosts. Native discovery and device testing remain required.
- [x] Plus button only attaches phone files. It now offers phone attachments, server project text files, and linking an existing server project folder. The desktop-only arbitrary folder picker remains local to the server PC.
- [ ] Completion notifications on iOS can arrive late or not at all while the app is outside the foreground. Check delivery timing on a real device and make events as timely as iOS allows; reconcile missed completions on resume. Closed-app push delivery is also tracked in Upgrade list #8.

## Desktop and mobile

- [x] Cannot steer or queue a new message. A nonempty submission while running queues after the current response; **Steer** aborts the current provider run and restarts with its original task plus the correction. An empty submission still stops. Queue entries serialize on the server and reload saved history before execution. Native polling correlates queued requests by ID. Regressions: `test/concurrent-sessions.test.mjs`, `test/mobile-composer.test.mjs`.
- [x] Read-only/full-access behavior changes between implementation messages. Sessions remember their implementation workflow. Auto reuses that route for implementation continuations; questions/reviews still route normally. Saved read-only/no-access thread limits, All Projects scope, project edit locks, and provider permissions continue to apply. Regressions: `test/thread-access.test.mjs`.

## Sessions

- [x] Sessions cannot be renamed. Desktop: ✎ on a session row opens an inline title box (Enter saves, Escape cancels, leaving the box saves) using `POST /api/sessions/:id/rename`. Tested in Chromium against a sandboxed server. The phone app has no rename control yet.
- [x] Sessions in **All Projects** cannot be dragged and dropped into their matching project once reviewed. Desktop: drag a session onto a project in the Projects list, or (keyboard) ⇥ on a row in All Projects opens a Move to… picker; both use `POST /api/sessions/:id/project`. Tested in Chromium (drag, picker, list refresh).

## Projects

- [x] Merging projects moves their sessions but leaves separate folders in the Projects work tree. Merge now moves the whole folder into `<destination>\obsolete\<name>` (a `-2` suffix if taken; nothing deleted), records old → new in `settings.projectMoves` and `obsolete\MOVED.md`, and adds the move to every provider prompt for that project so agents find the files and fix old references. Refused while either project is running or edit-locked, and if the folder is in use nothing changes. Split moves it back if the old place is free. Tests: `test/import-sessions.test.mjs`; UI merge/split and the prompt note checked in Chromium against a sandboxed server.

## Upgrade list

Numbers match the old `UPGRADE_LIST.md`, which earlier `PROJECT_STATUS.md` entries cite as `UPGRADE_LIST #N`.

1. [x] **Per-thread permission levels.** Thread access (Full / Review edits first / Read-only / No project access), plus Claude Code permission modes per thread since 0.19.0. Regressions: `test/thread-access.test.mjs`, `test/permission-modes.test.mjs`. Not yet checked in the app.
2. [x] **UI cleanup.** 0.12.0 refresh (tokens, settings tabs, route picker) and 0.12.1 keyboard/theme fixes. Not yet checked in the app.
3. [ ] **Skill searcher from GitHub links.** **Partial:** 0.13.0 Settings → Add new skills scans a link with the built-in pattern scanner before install. Still to do: run NVIDIA SkillSpector and Cisco Skill Scanner (the list called both "NVIDIA") and show each result, with an "unavailable" state when one is missing. Neither is installed; their CLIs and output formats are unchecked.
4. [x] **Server and Client installers.** One installer with a Server/Client page (0.17.0–0.19.0); `LocalAgentRouter-Setup-0.19.0.exe` built. Not yet clicked through or installed over an earlier version.
5. [ ] **iOS app for iPhone 16 Pro Max.** **Partial:** unsigned IPA built on GitHub Actions (0.19.0, AltStore sideload); Android debug APK also built. Not yet tested on an iPhone. App Store release needs the Apple Developer Program, a signed App Store archive on a Mac, and an App Store Connect listing.
6. [x] **Tailscale networking.** Remote listener on the Tailscale address with paired-device keys (0.17.0); clients and the phone only accept Tailscale addresses. Not yet tested over a real Tailscale connection.
7. [x] **Add more local LLMs.** Built on the standardized Colibri install (`setup.json` + model folders) and its Model Manager (`colibri\model_adder`). Settings → Routing & models lists installed models (Load now, Add or manage models…); every route can pick any of them; `colibri.mjs` switches Colibri to the requested model, or starts it, and waits for `/health`. Tests: `test/colibri.test.mjs` (fake Colibri). Not yet run against the real Colibri on the PC.
8. [ ] **Phone notifications.** **Partial:** finished runs and approval requests are polled from `GET /api/notifications` while the app is open or resumed. Push notifications (APNs/FCM) for a closed app are not implemented.
9. [x] **Local models only mode.** Settings → Routing & models → Local models only. Every step (route planning, chains, coding, review…) uses its route's Colibri model and never a cloud provider or fallback; Colibri switches models between steps. Test: Auto request plans on one model and reviews on another, no cloud CLI started. Not yet run against the real Colibri. Original note: A setting that keeps every step of a task chain on Colibri, with no cloud provider and no fallback to one. Each step (route planning, coding, review, and so on) should use the local model best suited to it, so Colibri must switch which model is loaded between steps. Today the router only lists Colibri's models (`GET /v1/models`) and uses the configured or loaded one; it never loads or swaps a model. Needs a per-route local model choice and a way to ask Colibri to load a model and wait until it is ready. Depends on #7, which is paused until Colibri installation is standardized.

General goals from the old list (secure links between components, Tailscale compatibility, phone performance, error handling and logging, room to grow) apply to every item above.

## Remaining acceptance

- [ ] Automatic server discovery over the supported remote network.
- [ ] Exercise connection, plus menu, cross-device streaming, queue/steer and permissions on iOS and Android.
- [ ] Visual desktop/mobile walkthrough. Playwright download failed with EACCES; installed Electron could not start because Windows denied its sandbox token access to the runtime directory. No system ACL changes were made.

The automated test suite uses synthetic projects, keys, and providers. No real credentials or provider accounts are required.

## Current stop (0.21.0, 2026-11-10)

Everything that could be built and tested without a person is done (session rename/move, folder-preserving merges, more local models, Local models only). What's left needs a decision or hands:

- **#3 skill scanners:** installing the scanners was refused by the agent's safety check (third-party code). Cisco's is on PyPI as `cisco-ai-skill-scanner` (2.3.2); NVIDIA SkillSpector isn't on PyPI and its GitHub page wasn't reachable from the cloud session. Needs the owner's OK to install them and the SkillSpector source.
- **Desktop app acceptance on the PC:** `npm.cmd start` still fails on Electron's sandbox ACL for `node_modules\electron\dist`; fixing it is a Windows permission change the owner has to make or approve.
- **Real Colibri run:** the Colibri switching was tested against a fake Colibri only; it needs one run on the PC (pick a different installed model for Quick, ask something, watch Colibri switch).
- **Automatic server discovery** and **iOS notification timing:** need a design choice for discovery over Tailscale and a real iPhone.
