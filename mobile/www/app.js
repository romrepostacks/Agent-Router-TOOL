"use strict";
// Mobile client for a Local Agent Router server install. Same API as the desktop page (public/app.js), shown one
// panel at a time: Projects → Sessions → Chat, plus Running, Inbox and Settings tabs. Vanilla JS, no build step.

const $ = (id) => document.getElementById(id);

const ROUTES = [
  ["auto", "Auto", "Route Planning picks the route, then that route's provider runs it."],
  ["route", "Route Planning", "Plan which route fits, without running it."],
  ["longterm", "Long Term Project planning", "Plan multi-step project work."],
  ["chain", "Task chain", "Plan, build, review and audit in sequence."],
  ["code", "Coding", "Edits the project folder."],
  ["review", "Reviewing", "Read-only review of changes."],
  ["security", "Security audit", "Read-only security review."],
  ["ui", "UI Designer", "Edits the interface."],
  ["art", "Art Asset generation", "Creates image assets."],
  ["github", "GitHub requests", "Commits, pushes and GitHub tasks."],
  ["quick", "Quick questions", "Fast answers, images allowed."],
];
const EDIT_ROUTES = new Set(["code", "ui", "art", "github"]);
const ROLES = { routePlanning: "Route Planning", longTermPlanning: "Long Term Project planning", coding: "Coding", review: "Reviewing", security: "Security audit", ui: "UI Designer", art: "Art Asset generation", github: "GitHub requests", quick: "Quick questions" };
// Claude Code permission modes, the same choices as Claude desktop's picker (server passes --permission-mode).
const PERMISSION_MODES = [["default", "Ask permissions", "Claude asks before edits and commands."], ["acceptEdits", "Accept edits", "File edits run without asking."], ["plan", "Plan mode", "Claude plans first and asks before acting."], ["auto", "Auto", "Claude decides; risky actions are still checked."]];
const permissionMode = () => state.session?.permissionMode || state.claudeDefaultMode || "default";
const ACCESS = [["", "Full access", "The route's own access."], ["staged", "Review edits first", "Edits go to a copy you approve."], ["read", "Read-only", "No edits in this thread."], ["none", "No project access", "Chat only."]];

// ---- Native bridge ------------------------------------------------------------------------------------------
// In the iOS/Android app, Capacitor's native HTTP (capacitor.config.json → CapacitorHttp) carries every fetch, so
// requests to the server aren't cross-origin and need no CORS. Native HTTP buffers responses, so live progress comes
// from polling GET /api/runs/<session> (followRun). In a browser (preview.html, or the server's own page) fetch streams.
const Cap = window.Capacitor;
const NATIVE = Boolean(Cap?.isNativePlatform?.());
const plugin = (name) => (NATIVE && Cap.isPluginAvailable?.(name) ? (Cap.registerPlugin?.(name) || Cap.Plugins?.[name] || null) : null);
const SecureStorage = plugin("SecureStoragePlugin"); // capacitor-secure-storage-plugin: iOS Keychain, Android Keystore
const LocalNotifications = plugin("LocalNotifications");
const AppPlugin = plugin("App");

// The device token is a password for the server. Native: Keychain/Keystore only; if that plugin is missing the token
// is kept for this launch and never written to disk. Browser preview: localStorage (that browser profile only).
const tokenStore = {
  async get() {
    if (!NATIVE) return localStorage.getItem("ar-token") || "";
    const legacy = localStorage.getItem("ar-token"); // saved by builds before secure storage
    if (legacy && SecureStorage) { await this.set(legacy); localStorage.removeItem("ar-token"); return legacy; }
    if (!SecureStorage) return "";
    try { return (await SecureStorage.get({ key: "ar-token" })).value || ""; } catch { return ""; } // throws when unset
  },
  async set(token) {
    if (!NATIVE) return localStorage.setItem("ar-token", token);
    if (!SecureStorage) return false;
    await SecureStorage.set({ key: "ar-token", value: token });
    return true;
  },
  async clear() {
    localStorage.removeItem("ar-token");
    if (SecureStorage) await SecureStorage.remove({ key: "ar-token" }).catch(() => {});
  },
};

const conn = { url: localStorage.getItem("ar-server") || (/^https?:$/.test(location.protocol) && !NATIVE ? location.origin : ""), token: "", ok: false, version: "", appVersion: "" };

// Same rule as the desktop Client: only Tailscale addresses (100.64.0.0/10 or *.ts.net), or this PC in a browser preview.
function serverUrlProblem(value) {
  let url;
  try { url = new URL(value); } catch { return "Enter the full address, like http://100.101.102.103:8766."; }
  if (!/^https?:$/.test(url.protocol)) return "The address must start with http:// or https://.";
  const host = url.hostname.toLowerCase();
  const [a, b] = host.split(".").map(Number);
  if ((a === 100 && b >= 64 && b <= 127 && /^\d+\.\d+\.\d+\.\d+$/.test(host)) || host.endsWith(".ts.net")) return "";
  if (!NATIVE && (host === "127.0.0.1" || host === "localhost")) return "";
  return "Use the server's Tailscale address (100.x.x.x or a .ts.net name), shown in its Settings → Remote access.";
}
const state = {
  projects: [], project: null, sessions: [], session: null, runs: new Map(), attaching: new Set(),
  inbox: [], unread: 0, proposals: {}, skills: [], selectedSkills: [], skillsLimit: -1, preapproved: [],
  mode: localStorage.getItem("ar-mode") || "auto", attachments: [], settings: null, sheet: null,
};
const nav = { tab: "projects", stacks: { projects: ["projects"], running: ["running"], inbox: ["inbox"], settings: ["settings"] } };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((child) => child != null && child !== false));
  return node;
}

// ---- Device and platform ------------------------------------------------------------------------------------
// ?device= lets preview.html frame the app as an iPhone 16 Pro Max (iOS 26) or Galaxy Note20; a real phone uses
// env(safe-area-inset-*) from the system.
const DEVICES = { iphone: { platform: "ios", top: 62, bottom: 34 }, note20: { platform: "android", top: 32, bottom: 16 } };
(() => {
  const device = DEVICES[new URLSearchParams(location.search).get("device")];
  const platform = device?.platform || (/android/i.test(navigator.userAgent) ? "android" : /iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios" : "ios");
  document.documentElement.classList.add(platform);
  if (device) {
    document.documentElement.style.setProperty("--safe-top", `${device.top}px`);
    document.documentElement.style.setProperty("--safe-bottom", `${device.bottom}px`);
  }
  const appearance = localStorage.getItem("ar-appearance") || "system";
  document.documentElement.dataset.theme = appearance;
  // Keep the composer above the on-screen keyboard where the browser doesn't resize the page for it.
  const vv = window.visualViewport;
  vv?.addEventListener("resize", () => document.documentElement.style.setProperty("--kb", `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`));
})();

// ---- API ----------------------------------------------------------------------------------------------------
const apiUrl = (path) => conn.url.replace(/\/+$/, "") + path;
const headers = (extra = {}) => ({ "Content-Type": "application/json", ...(conn.token ? { Authorization: `Bearer ${conn.token}` } : {}), ...extra });
const stream = (path, options = {}) => fetch(apiUrl(path), { ...options, headers: headers(options.headers) });

async function request(path, options = {}) {
  const response = await stream(path, options);
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    const error = new Error(data.error || "The server didn't accept this access code.");
    error.auth = true;
    throw error;
  }
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

// Same event-stream reader as the desktop page.
async function readStream(responsePromise, onEvent) {
  const response = await responsePromise;
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result = null;
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      let name = "message";
      const data = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) name = line.slice(6).trim();
        if (line.startsWith("data:")) data.push(line.slice(5).trim());
      }
      if (!data.length) continue;
      const parsed = JSON.parse(data.join("\n"));
      if (name === "error") {
        const error = new Error(parsed.error || "The request failed.");
        if (parsed.cancelled) error.name = "AbortError";
        throw error;
      }
      if (name === "done") result = parsed;
      else onEvent(name, parsed);
    }
    if (done) break;
  }
  if (!result) throw new Error("The response ended before it was complete.");
  return result;
}

// ---- Navigation: one panel at a time, a stack per tab ------------------------------------------------------
const current = () => (conn.ok ? nav.stacks[nav.tab].at(-1) : "connect");

function show(direction = "") {
  const view = current();
  for (const section of document.querySelectorAll(".view")) {
    const on = section.dataset.view === view;
    if (on && section.hidden) {
      section.hidden = false;
      section.classList.remove("forward", "back");
      void section.offsetWidth; // restart the entrance animation
      if (direction) section.classList.add(direction);
    } else if (!on) section.hidden = true;
  }
  document.body.dataset.view = view;
  $("views").scrollTop = 0;
  document.body.classList.remove("scrolled");
  for (const tab of document.querySelectorAll("[data-tab]")) tab.setAttribute("aria-current", tab.dataset.tab === nav.tab ? "page" : "false");
  syncTabBar();
  renderNav();
  ({ projects: renderProjects, sessions: renderSessions, chat: renderChat, running: renderRunning, inbox: renderInbox, settings: loadSettingsView })[view]?.();
}

function push(view) {
  const stack = nav.stacks[nav.tab];
  if (stack.at(-1) === view) return show();
  stack.push(view);
  history.pushState({ view }, "");
  show("forward");
}

function back() {
  const stack = nav.stacks[nav.tab];
  if (stack.length > 1) { stack.pop(); show("back"); }
  else if (nav.tab !== "projects") selectTab("projects");
}

function selectTab(tab) {
  if (nav.tab === tab && nav.stacks[tab].length > 1) nav.stacks[tab].length = 1; // tap the open tab: back to its top
  nav.tab = tab;
  if (tab === "inbox") { state.unread = 0; renderBadges(); }
  show();
}

function navButton(label, aria, onClick, extraClass = "") {
  return el("button", { type: "button", class: `nav-button ${extraClass}`, "aria-label": aria, onclick: onClick }, label);
}

function renderNav() {
  const view = current();
  const stack = nav.stacks[nav.tab];
  const backButton = $("nav-back");
  backButton.hidden = !conn.ok || stack.length < 2;
  const previous = stack.at(-2);
  $("nav-back-label").textContent = previous === "sessions" ? (state.project?.name || "Sessions") : previous ? ({ projects: "Projects", running: "Running", inbox: "Inbox" }[previous] || "Back") : "";
  const titles = { connect: "Connect", projects: "Projects", sessions: state.project?.name || "Sessions", chat: state.session?.title || "New session", running: "Running", inbox: "Inbox", settings: "Settings" };
  $("nav-title").textContent = titles[view] ?? "";
  const actions = $("nav-actions");
  actions.replaceChildren();
  if (view === "projects") actions.append(navButton("+", "New project", openNewProject, "icon"));
  if (view === "sessions") actions.append(navButton("+", "New session", () => newSession().catch(toastError), "icon"));
  if (view === "chat") {
    const run = viewedRun();
    actions.append(navButton(el("span", {}, run?.active ? el("i", { class: "live-dot", "aria-hidden": "true" }) : null, "Output"), "Agent output and task details", openLiveSheet, "pill"));
  }
}

// Large titles shrink into the bar as the page scrolls, like iOS.
$("views").addEventListener("scroll", () => document.body.classList.toggle("scrolled", $("views").scrollTop > 24), { passive: true });

// Edge swipe from the left goes back (iOS); Android's back gesture arrives as popstate.
let swipe = null;
document.addEventListener("touchstart", (event) => {
  const touch = event.touches[0];
  swipe = touch.clientX < 24 && nav.stacks[nav.tab].length > 1 ? { x: touch.clientX, y: touch.clientY } : null;
}, { passive: true });
document.addEventListener("touchend", (event) => {
  if (!swipe) return;
  const touch = event.changedTouches[0];
  if (touch.clientX - swipe.x > 70 && Math.abs(touch.clientY - swipe.y) < 60) history.back();
  swipe = null;
}, { passive: true });
addEventListener("popstate", () => { if (state.sheet) hideSheet(); else back(); });
$("nav-back").addEventListener("click", () => history.back());
for (const tab of document.querySelectorAll("[data-tab]")) tab.addEventListener("click", () => selectTab(tab.dataset.tab));

// The tab bar slides away in Chat, Connect and under a sheet; `inert` also takes it out of keyboard and screen-reader
// reach there, and the views behind an open sheet go inert too.
function syncTabBar() {
  const view = current();
  $("tab-bar").inert = view === "chat" || view === "connect" || Boolean(state.sheet);
  $("views").inert = $("nav-bar").inert = Boolean(state.sheet);
}

// ---- Sheets and toasts --------------------------------------------------------------------------------------
let sheetOpener = null;
function openSheet(title, kind, ...content) {
  if (!state.sheet) { history.pushState({ sheet: kind }, ""); sheetOpener = document.activeElement; } // the back gesture closes the sheet first
  state.sheet = kind;
  $("sheet-title").textContent = title;
  $("sheet-body").replaceChildren(...content);
  $("sheet").hidden = $("sheet-backdrop").hidden = false;
  syncTabBar();
  requestAnimationFrame(() => document.body.classList.add("sheet-open"));
  $("sheet-close").focus();
}
const closeSheet = () => { if (state.sheet) history.back(); };
function hideSheet() {
  state.sheet = null;
  syncTabBar();
  sheetOpener?.focus?.();
  sheetOpener = null;
  document.body.classList.remove("sheet-open");
  setTimeout(() => { if (!state.sheet) $("sheet").hidden = $("sheet-backdrop").hidden = true; }, 320);
}
$("sheet-close").addEventListener("click", closeSheet);
$("sheet-backdrop").addEventListener("click", closeSheet);

let toastTimer;
function toast(text) {
  const box = $("toast");
  box.textContent = text;
  box.hidden = false;
  requestAnimationFrame(() => box.classList.add("show"));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.classList.remove("show"); setTimeout(() => { box.hidden = true; }, 300); }, 3200);
}
const toastError = (error) => { if (error?.auth) return lostConnection(error); toast(error.message || String(error)); };

// ---- Connect ------------------------------------------------------------------------------------------------
async function connect(quiet = false) {
  const status = $("connect-status");
  if (!conn.url) { conn.ok = false; return show(); }
  const problem = serverUrlProblem(conn.url);
  if (problem) { conn.ok = false; status.textContent = problem; return show(); }
  if (!quiet) status.textContent = "Connecting…";
  try {
    const { version, role } = await request("/api/version");
    conn.version = `v${version}${role ? ` ${role}` : ""}`;
    conn.ok = true;
    localStorage.setItem("ar-server", conn.url);
    const saved = await tokenStore.set(conn.token).catch(() => false);
    if (saved === false) toast("This app can't save the access code securely, so you'll enter it again next launch.");
    status.textContent = "";
    show();
    await Promise.all([loadProjects(), loadSkills().catch(() => {})]);
    syncRuns();
    reconcileNotifications();
  } catch (error) {
    conn.ok = false;
    status.textContent = error.auth ? error.message : `Couldn't reach the server: ${error.message}. Check that Tailscale is on and the address is right.`;
    show();
  }
}

function lostConnection(error) {
  conn.ok = false;
  $("connect-status").textContent = error.message;
  show();
}

$("connect-form").addEventListener("submit", (event) => {
  event.preventDefault();
  conn.url = $("server-url").value.trim().replace(/\/+$/, "");
  conn.token = $("server-token").value.trim();
  connect();
});
$("disconnect").addEventListener("click", async () => {
  await tokenStore.clear();
  conn.token = "";
  $("server-token").value = "";
  conn.ok = false;
  state.runs.clear();
  show();
});

// ---- Projects -----------------------------------------------------------------------------------------------
async function loadProjects() {
  state.projects = await request("/api/projects");
  if (current() === "projects") renderProjects();
  refreshStatusChips().catch(() => {});
}

async function refreshStatusChips() {
  const result = await request("/api/status");
  const chips = [el("span", { class: `chip ${result.colibri?.online ? "online" : "offline"}` }, el("i", { class: "dot" }), result.colibri?.online ? `Local model · ${result.colibri.selectedModel || "ready"}` : "Local model offline")];
  for (const [id, name] of [["claude", "Claude Code"], ["codex", "Codex"], ["copilot", "Copilot"]]) {
    if (result.commands?.[id]?.available) chips.push(el("span", { class: "chip online" }, el("i", { class: "dot" }), name));
  }
  $("status-chips").replaceChildren(...chips);
}

function renderProjects() {
  const list = $("project-list");
  const projects = state.projects.filter((project) => !project.parent);
  if (!projects.length) return list.replaceChildren(el("p", { class: "empty" }, "No project folders found on the server."));
  list.replaceChildren(...projects.map((project) => {
    const running = activeRuns().filter((run) => run.projectId === project.id).length;
    return el("button", { type: "button", class: "row", onclick: () => openProject(project.id) },
      el("span", { class: "row-icon", "aria-hidden": "true" }, project.scope === "all" ? "◎" : "▰"),
      el("span", { class: "row-text" }, el("span", { class: "row-title" }, project.name), el("span", { class: "row-sub" }, project.scope === "all" ? "Read-only across all projects" : (project.members?.length ? `+ ${project.members.join(", ")}` : project.path || ""))),
      running ? el("span", { class: "tag live" }, `${running} running`) : null,
      el("span", { class: "chevron", "aria-hidden": "true" }, "›"));
  }));
}

function openNewProject() {
  const input = el("input", { type: "text", maxLength: 80, required: true, autocomplete: "off", placeholder: "my-new-app", "aria-label": "Project name" });
  const status = el("p", { class: "hint", "aria-live": "polite" });
  const form = el("form", { class: "form-card", onsubmit: async (event) => {
    event.preventDefault();
    status.textContent = "Creating…";
    try {
      const project = await request("/api/projects", { method: "POST", body: JSON.stringify({ name: input.value }) });
      closeSheet();
      await loadProjects();
      openProject(project.id);
    } catch (error) { status.textContent = error.message; }
  } }, el("label", { class: "field" }, "Project name", input), el("p", { class: "hint" }, "Creates an empty folder in the server's Projects folder."), el("button", { type: "submit", class: "primary-button" }, "Create project"), status);
  openSheet("New project", "project", form);
  input.focus();
}

async function openProject(id) {
  state.project = state.projects.find((project) => project.id === id) || null;
  state.sessions = [];
  $("session-search").value = "";
  push("sessions");
  await loadSessions().catch(toastError);
}

// ---- Sessions -----------------------------------------------------------------------------------------------
async function loadSessions() {
  const project = state.project;
  if (!project) return;
  const query = new URLSearchParams({ projectId: project.id, q: $("session-search").value.trim(), pending: $("pending-only").checked ? "1" : "0" });
  const sessions = await request(`/api/sessions?${query}`);
  if (state.project?.id !== project.id) return; // the user moved to another project meanwhile
  state.sessions = sessions;
  if (current() === "sessions") renderSessions();
}

function renderSessions() {
  $("sessions-title").textContent = state.project?.name || "Sessions";
  const list = $("session-list");
  if (!state.sessions.length) return list.replaceChildren(el("p", { class: "empty" }, "No sessions yet. Start one with +."));
  list.replaceChildren(...state.sessions.map((session) => {
    const running = state.runs.get(session.id)?.active || session.running;
    const source = session.merged ? "merged" : { claude: "Claude", codex: "Codex", "codex-cloud": "Codex Cloud" }[session.importedFrom] || session.importedFrom;
    return el("div", { class: "row-wrap" },
      el("button", { type: "button", class: `row${running ? " running" : ""}`, onclick: () => openSession(session.id) },
        el("span", { class: "row-text" },
          el("span", { class: "row-title" }, source ? el("span", { class: "tag" }, source) : null, session.title || "New session"),
          el("span", { class: "row-sub" }, running ? "Running" : session.hasPendingReview ? "Changes waiting for review" : `${new Date(session.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · ${session.messageCount || 0} messages`)),
        running ? el("i", { class: "live-dot", "aria-hidden": "true" }) : el("span", { class: "chevron", "aria-hidden": "true" }, "›")),
      el("button", { type: "button", class: "row-action", "aria-label": `Delete ${session.title || "session"}`, onclick: () => deleteSession(session.id) }, "×"));
  }));
}

let searchTimer;
$("session-search").addEventListener("input", () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => loadSessions().catch(toastError), 250); });
$("pending-only").addEventListener("change", () => loadSessions().catch(toastError));
$("import-sessions").addEventListener("click", async () => {
  const status = $("sessions-status");
  status.textContent = "Looking for Claude Code and Codex sessions on the server…";
  try {
    const result = await request("/api/sessions/import", { method: "POST", body: JSON.stringify({ reindex: false }) });
    status.textContent = result.added || result.updated ? `Imported ${result.added} new and updated ${result.updated} sessions.` : "No new CLI sessions found.";
    await loadSessions();
  } catch (error) { status.textContent = `Could not import: ${error.message}`; }
});

async function deleteSession(id) {
  if (state.runs.get(id)?.active) return toast("This session is still running. Stop it first.");
  if (!confirm("Delete this session?")) return;
  try {
    await request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    state.runs.delete(id);
    if (state.session?.id === id) state.session = null;
    await loadSessions();
  } catch (error) { toastError(error); }
}

let openTicket = 0;
async function openSession(id) {
  const ticket = ++openTicket;
  try {
    const session = await request(`/api/sessions/${encodeURIComponent(id)}`);
    if (ticket !== openTicket) return;
    const run = state.runs.get(id);
    if (run?.messages) session.messages = run.messages;
    state.session = session;
    state.project = state.projects.find((project) => project.id === session.projectId) || state.project;
    push("chat");
  } catch (error) { toastError(error); }
}

async function newSession() {
  if (!state.project) return null;
  openTicket++;
  state.session = await request("/api/sessions", { method: "POST", body: JSON.stringify({ projectId: state.project.id }) });
  loadSessions().catch(() => {});
  push("chat");
  $("prompt").focus();
  return state.session;
}

// ---- Chat ---------------------------------------------------------------------------------------------------
const viewedRun = () => (state.session ? state.runs.get(state.session.id) : undefined);
const activeRuns = () => [...state.runs.values()].filter((run) => run.active);
const viewing = (sessionId) => state.session?.id === sessionId && current() === "chat";

function renderChat() {
  renderMessages();
  renderApprovals();
  refreshComposer();
}

function renderMessages() {
  const list = $("messages");
  const messages = state.session?.messages || [];
  if (!messages.length) {
    list.replaceChildren(el("div", { class: "empty-chat" },
      el("div", { class: "empty-orb", "aria-hidden": "true" }, "✳"),
      el("h2", {}, "What are we working on?"),
      el("p", {}, "Each request goes to the AI tool the server uses for that kind of work."),
      el("div", { class: "suggestions" }, ...[["Explain this project", "Explain the main parts of this project."], ["Review current changes", "Review the current changes for bugs and risks."], ["Debug an issue", "Help me debug the current issue: "]].map(([label, prompt]) =>
        el("button", { type: "button", class: "chip-button glass", onclick: () => { $("prompt").value = prompt; growPrompt(); $("prompt").focus(); } }, label)))));
    return;
  }
  list.replaceChildren(...messages.map((message, index) => bubble(message, index)));
  list.scrollTop = list.scrollHeight;
}

function bubble(message, index) {
  const { role, content, route, status, attachments = [], proposalId, feedback, temporary } = message;
  const assistant = role === "assistant";
  const body = el("div", { class: "bubble-body" },
    route ? el("div", { class: "bubble-meta" }, route) : null,
    el("div", { class: "bubble-text" }, content),
    status ? el("div", { class: "bubble-status" }, status) : null,
    attachments.length ? el("div", { class: "bubble-status" }, `Context: ${attachments.join(", ")}`) : null);
  if (assistant && proposalId) body.append(el("button", { type: "button", class: "chip-button accent", onclick: () => openProposal(proposalId) }, state.proposals[proposalId] === "applied" ? "View applied changes" : "Review proposed changes"));
  const run = viewedRun();
  if (assistant && route === "Router error" && run?.retryRequest && !run.active) body.append(el("button", { type: "button", class: "chip-button accent", onclick: () => submitRequest(run.retryRequest) }, "Retry"));
  if (assistant && !temporary && route && route !== "Router error") {
    const rate = (key, value, label, symbol) => el("button", { type: "button", class: `rate${feedback?.[key] === value ? " selected" : ""}`, "aria-label": label, "aria-pressed": String(feedback?.[key] === value), disabled: Boolean(run?.active), onclick: () => rateMessage(index, { [key]: value }) }, symbol);
    body.append(el("div", { class: "rating" }, el("span", {}, "Answer"), rate("rating", "good", "Good answer", "👍"), rate("rating", "bad", "Bad answer", "👎"), el("span", {}, `${route}?`), rate("routing", "good", "Right provider", "👍"), rate("routing", "bad", "Wrong provider", "👎")));
  }
  return el("article", { class: `bubble ${assistant ? "assistant" : "user"}` }, body);
}

async function rateMessage(messageIndex, feedback) {
  try {
    state.session = await request(`/api/sessions/${encodeURIComponent(state.session.id)}/feedback`, { method: "POST", body: JSON.stringify({ messageIndex, ...feedback }) });
    renderMessages();
  } catch (error) { toastError(error); }
}

function renderApprovals() {
  const box = $("approvals");
  const cards = viewedRun()?.approvals || [];
  box.hidden = !cards.length;
  box.replaceChildren(...cards.map((card) => approvalCard(viewedRun().sessionId, card)));
}

// Same three answers as the desktop card (public/app.js): Always allow asks the provider to save a rule in its own
// settings; the server answers 409 `unsupported` when it can't, and the card stays open for Allow or Deny.
const APPROVAL_CHOICES = [
  { decision: "always", label: "Always allow", className: "secondary-button always", busy: "Saving rule…" },
  { decision: "deny", label: "Deny", className: "secondary-button deny", busy: "Denying…" },
  { decision: "allow", label: "Allow", className: "primary-button", busy: "Allowing…" },
];
const approvalUi = new Map(); // card id -> { busy, message, error, unsupported }

function rerenderApprovals() {
  if (current() === "chat") renderApprovals();
  if (current() === "inbox") renderInbox();
}

// Kept identical in public/app.js; test/approval-ui.test.mjs checks both copies.
// Always allow sends no `allow` flag, so a server that doesn't know `decision` rejects it instead of allowing once.
function approvalBody(decision) {
  return decision === "always" ? { decision } : { decision, allow: decision === "allow" };
}
function approvalResult(decision, status, data = {}) {
  if (status >= 200 && status < 300 && (decision !== "always" || data.decision === "always")) {
    return { done: true, message: { always: "Always allowed. The provider saved the rule in its own settings.", allow: "Allowed once.", deny: "Denied." }[decision] };
  }
  if (decision === "always" && (data.unsupported || [400, 409, 501].includes(status) || (status >= 200 && status < 300))) {
    return { unsupported: true, error: true, message: data.unsupported && data.error ? data.error : "This provider can't save a permanent rule for this request. Choose Allow or Deny." };
  }
  return { error: true, message: data.error || `Couldn't send your answer (${status}).` };
}

async function answerApproval(sessionId, card, decision) {
  approvalUi.set(card.id, { ...approvalUi.get(card.id), busy: decision, error: false, message: "" });
  rerenderApprovals();
  try {
    const response = await stream(`/api/runs/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(card.id)}`, { method: "POST", body: JSON.stringify(approvalBody(decision)) });
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) return lostConnection(new Error(data.error || "The server didn't accept this access code."));
    const result = approvalResult(decision, response.status, data);
    approvalUi.set(card.id, { ...(result.unsupported ? {} : approvalUi.get(card.id)), ...result, busy: "" });
    if (result.done) navigator.vibrate?.(15);
  } catch (error) {
    approvalUi.set(card.id, { ...approvalUi.get(card.id), busy: "", error: true, message: `Couldn't reach the server: ${error.message}` });
  }
  rerenderApprovals();
}

function approvalCard(sessionId, card) {
  const ui = approvalUi.get(card.id) || {};
  const alwaysBlocked = card.canAlwaysAllow === false || ui.unsupported;
  const actions = el("div", { class: "approval-actions three" }, ...APPROVAL_CHOICES.map((choice) => el("button", {
    type: "button", class: choice.className,
    disabled: Boolean(ui.busy) || (choice.decision === "always" && alwaysBlocked),
    "aria-describedby": `approval-note-${card.id}`,
    onclick: () => answerApproval(sessionId, card, choice.decision),
  }, ui.busy === choice.decision ? choice.busy : choice.label)));
  const note = ui.message || (card.canAlwaysAllow === false ? "Always allow isn't available: the provider offered no rule to save." : "Always allow saves a rule in the provider's own settings.");
  return el("article", { class: "approval glass", "aria-busy": String(Boolean(ui.busy)), "aria-labelledby": `approval-title-${card.id}` },
    el("h3", { id: `approval-title-${card.id}` }, card.title || `Allow ${card.tool}?`),
    el("p", {}, card.reason || "The provider's settings ask before this tool runs."),
    el("pre", {}, card.detail || ""), actions,
    el("p", { id: `approval-note-${card.id}`, class: `approval-note${ui.error ? " error" : ""}`, role: ui.error ? "alert" : "status" }, note));
}

function refreshComposer() {
  const run = viewedRun();
  const busy = Boolean(run?.active);
  const send = $("send");
  send.classList.toggle("stop", busy);
  send.setAttribute("aria-label", busy ? "Stop this session's response" : "Send");
  send.firstElementChild.textContent = busy ? "■" : "↑";
  send.disabled = !busy && !state.project;
  const allProjects = state.project?.scope === "all";
  if (allProjects && EDIT_ROUTES.has(state.mode)) state.mode = "auto";
  $("mode-chip").textContent = ROUTES.find(([id]) => id === state.mode)?.[1] || "Auto";
  const limit = state.session?.accessLimit || "";
  $("access-chip").textContent = ACCESS.find(([id]) => id === limit)?.[1] || "Full access";
  $("permission-chip").textContent = PERMISSION_MODES.find(([id]) => id === permissionMode())?.[1] || "Ask permissions";
  const skillCount = state.selectedSkills.length + state.preapproved.length;
  $("skills-chip").textContent = state.skillsLimit === 0 ? "Skills off" : skillCount ? `${skillCount} skills` : "Skills";
  $("prompt").placeholder = allProjects ? "Ask a question across all projects…" : "Ask or describe a task…";
  renderAttachments();
  renderNav();
}

function growPrompt() {
  const prompt = $("prompt");
  prompt.style.height = "auto";
  prompt.style.height = `${Math.min(prompt.scrollHeight, 168)}px`;
}
$("prompt").addEventListener("input", growPrompt);

$("mode-chip").addEventListener("click", () => {
  const allProjects = state.project?.scope === "all";
  openSheet("Routing", "mode", el("div", { class: "list glass", role: "radiogroup" }, ...ROUTES.map(([id, label, help]) => {
    const disabled = allProjects && EDIT_ROUTES.has(id);
    return el("button", { type: "button", class: "row", role: "radio", "aria-checked": String(state.mode === id), disabled, onclick: () => { state.mode = id; localStorage.setItem("ar-mode", id); closeSheet(); refreshComposer(); } },
      el("span", { class: "row-text" }, el("span", { class: "row-title" }, label), el("span", { class: "row-sub" }, disabled ? "Choose one project folder to use this route." : help)),
      el("span", { class: "check", "aria-hidden": "true" }, state.mode === id ? "✓" : ""));
  })));
});

$("access-chip").addEventListener("click", () => {
  openSheet("Thread access", "access", el("p", { class: "hint" }, "Limits what any route may do in this thread. It can only narrow a route's own access."), el("div", { class: "list glass", role: "radiogroup" }, ...ACCESS.map(([id, label, help]) =>
    el("button", { type: "button", class: "row", role: "radio", "aria-checked": String((state.session?.accessLimit || "") === id), onclick: async () => {
      try {
        if (!state.session) await newSession();
        state.session = { ...state.session, ...(await request(`/api/sessions/${encodeURIComponent(state.session.id)}/access`, { method: "POST", body: JSON.stringify({ accessLimit: id }) })) };
        closeSheet();
        refreshComposer();
      } catch (error) { toastError(error); }
    } }, el("span", { class: "row-text" }, el("span", { class: "row-title" }, label), el("span", { class: "row-sub" }, help)), el("span", { class: "check", "aria-hidden": "true" }, (state.session?.accessLimit || "") === id ? "✓" : "")))));
});

$("permission-chip").addEventListener("click", () => {
  openSheet("Permissions", "permissions", el("p", { class: "hint" }, "Claude Code permission mode for this thread, the same choices as Claude desktop. Codex and Copilot follow their own settings."), el("div", { class: "list glass", role: "radiogroup" }, ...PERMISSION_MODES.map(([id, label, help]) =>
    el("button", { type: "button", class: "row", role: "radio", "aria-checked": String(permissionMode() === id), onclick: async () => {
      try {
        if (!state.session) await newSession();
        state.session = { ...state.session, ...(await request(`/api/sessions/${encodeURIComponent(state.session.id)}/permission-mode`, { method: "POST", body: JSON.stringify({ permissionMode: id }) })) };
        closeSheet();
        refreshComposer();
      } catch (error) { toastError(error); }
    } }, el("span", { class: "row-text" }, el("span", { class: "row-title" }, label), el("span", { class: "row-sub" }, help)), el("span", { class: "check", "aria-hidden": "true" }, permissionMode() === id ? "✓" : "")))));
});

async function loadSkills() {
  const [result, settings] = await Promise.all([request("/api/skills"), request("/api/settings")]);
  state.skills = result.skills || [];
  const available = new Set(state.skills.map((skill) => skill.id));
  state.skillsLimit = Number.isSafeInteger(settings.skillsLimit) ? settings.skillsLimit : -1;
  state.claudeDefaultMode = settings.claudeDefaultMode || "default";
  state.preapproved = (settings.preapprovedSkillIds || []).filter((id) => available.has(id));
  const saved = JSON.parse(localStorage.getItem("ar-skills") || "[]");
  state.selectedSkills = (Array.isArray(saved) ? saved : []).filter((id) => available.has(id) && !state.preapproved.includes(id));
}
const skillSlots = () => (state.skillsLimit === -1 ? Infinity : Math.max(0, state.skillsLimit - state.preapproved.length));

$("skills-chip").addEventListener("click", () => {
  const render = () => {
    const groups = [...new Set(state.skills.map((skill) => skill.category || "General"))];
    $("sheet-body").replaceChildren(
      el("p", { class: "hint" }, state.skillsLimit === 0 ? "Skills are turned off in Settings." : "Choose skills for this task. Pre-approved skills are always included."),
      ...groups.map((group) => el("div", {}, el("div", { class: "group-label" }, group), el("div", { class: "list glass" }, ...state.skills.filter((skill) => (skill.category || "General") === group).map((skill) => {
        const always = state.preapproved.includes(skill.id);
        const checked = state.skillsLimit !== 0 && (always || state.selectedSkills.includes(skill.id));
        const box = el("input", { type: "checkbox", checked, disabled: state.skillsLimit === 0 || always || (!checked && state.selectedSkills.length >= skillSlots()), onchange: () => {
          state.selectedSkills = box.checked ? [...state.selectedSkills, skill.id] : state.selectedSkills.filter((id) => id !== skill.id);
          localStorage.setItem("ar-skills", JSON.stringify(state.selectedSkills));
          render();
          refreshComposer();
        } });
        return el("label", { class: "row" }, el("span", { class: "row-text" }, el("span", { class: "row-title" }, skill.name), el("span", { class: "row-sub" }, always ? "Pre-approved" : skill.description || "")), box);
      })))));
  };
  openSheet("Shared skills", "skills");
  render();
});

// Attachments: small text files and images, the same limits as the desktop page. PDFs need the desktop app.
$("attach").addEventListener("click", () => $("attachment-files").click());
$("attachment-files").addEventListener("change", async (event) => {
  try { await addAttachments([...event.target.files]); } catch (error) { toast(error.message); }
  event.target.value = "";
});

async function addAttachments(files) {
  const allowed = /\.(c|cc|cfg|conf|cpp|cs|css|csv|go|h|hpp|html|java|js|json|jsx|md|mjs|ps1|py|rb|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/i;
  const secret = /(^|[._-])(secret|credentials?|tokens?|passwords?|id_rsa|id_ed25519)([._-]|$)|\.(pem|key|pfx|p12)$/i;
  if (state.attachments.length + files.length > 5) throw new Error("Attach up to five files at a time.");
  const additions = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`${file.name} must be a PNG, JPEG, or WebP image.`);
      const bitmap = await createImageBitmap(file);
      let scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      let dataUrl = "";
      do {
        const canvas = el("canvas", { width: Math.max(1, Math.round(bitmap.width * scale)), height: Math.max(1, Math.round(bitmap.height * scale)) });
        canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        dataUrl = canvas.toDataURL("image/jpeg", 0.72);
        scale *= 0.8;
      } while (dataUrl.length > 680_000 && scale * Math.max(bitmap.width, bitmap.height) > 480);
      bitmap.close();
      if (dataUrl.length > 680_000) throw new Error(`${file.name} is too large after compression.`);
      additions.push({ name: file.name, mimeType: "image/jpeg", dataUrl });
      continue;
    }
    if (file.type === "application/pdf" || /\.pdf$/i.test(file.name)) throw new Error("Attach PDFs from the desktop app; it extracts their text.");
    if (!allowed.test(file.name) || secret.test(file.name) || file.size > 30_000) throw new Error(`${file.name} is not a supported small text file.`);
    const content = await file.text();
    if (content.includes("\0")) throw new Error(`${file.name} is not plain text.`);
    additions.push({ name: file.name, content });
  }
  const all = [...state.attachments, ...additions];
  if (all.reduce((sum, file) => sum + (file.content?.length || 0), 0) > 100_000) throw new Error("Selected text is too large. Attach fewer or smaller files.");
  if (all.reduce((sum, file) => sum + (file.dataUrl?.length || 0), 0) > 700_000) throw new Error("Attached images are too large together.");
  state.attachments = all;
  renderAttachments();
}

function renderAttachments() {
  $("attachment-list").replaceChildren(...state.attachments.map((file, index) => el("span", { class: "attachment" }, file.name,
    el("button", { type: "button", "aria-label": `Remove ${file.name}`, onclick: () => { state.attachments.splice(index, 1); renderAttachments(); } }, "×"))));
}

$("composer").addEventListener("submit", async (event) => {
  event.preventDefault();
  const running = viewedRun();
  if (running?.active) {
    await request(`/api/runs/${encodeURIComponent(running.sessionId)}/cancel`, { method: "POST" }).catch(toastError);
    return;
  }
  const message = $("prompt").value.trim();
  if (!message || !state.project) return;
  await submitRequest({ message, projectId: state.project.id, mode: state.mode, skillIds: [...state.selectedSkills], contextIds: [], attachments: state.attachments.map((file) => ({ ...file })), before: state.session?.messages || [] }).catch(toastError);
});

async function submitRequest(requestData) {
  if (!state.project || viewedRun()?.active) return;
  if (!state.session) await newSession();
  if (!state.session) return;
  const sessionId = state.session.id;
  const attachmentNames = requestData.attachments.map((file) => file.name);
  const payload = { message: requestData.message, projectId: requestData.projectId, sessionId, mode: requestData.mode, history: requestData.before.map(({ role, content }) => ({ role, content })), skillIds: requestData.skillIds, contextIds: requestData.contextIds, attachments: requestData.attachments, attachmentNames };
  $("prompt").value = "";
  growPrompt();
  state.attachments = [];
  renderAttachments();
  await followRun({ sessionId, projectId: requestData.projectId, title: (state.session.title !== "New session" ? state.session.title : requestData.message).slice(0, 60), requestData, attachmentNames,
    response: stream("/api/chat/stream", { method: "POST", body: JSON.stringify(payload) }) });
}

// ---- Runs: follow a stream, reattach to runs started on other devices ---------------------------------------
async function followRun({ sessionId, projectId, title, requestData, attachmentNames, response }) {
  const before = requestData.before;
  const userMessage = { role: "user", content: requestData.message, attachments: attachmentNames };
  const assistantMessage = { role: "assistant", content: "", route: "", status: "Starting…", temporary: true };
  const run = { sessionId, projectId, title, active: true, status: "Starting…", live: "", messages: [...before, userMessage, assistantMessage], retryRequest: requestData, approvals: [] };
  state.runs.set(sessionId, run);
  if (viewing(sessionId)) { state.session.messages = run.messages; renderChat(); }
  renderRunState();
  try {
    const result = await (NATIVE ? pollRun : readStream)(response, (event, value) => {
      if (event === "snapshot") {
        assistantMessage.content = value.content || "";
        assistantMessage.status = run.status = value.status || run.status;
        run.live = value.live || "";
        run.approvals = value.approvals || [];
        dropAnswered(sessionId, run.approvals);
        for (const card of run.approvals) notify({ kind: "approval", sessionId, title: card.title || `Allow ${card.tool}?`, body: title, card });
        if (viewing(sessionId)) renderChat();
        renderRunState();
        return;
      }
      if (event === "approval") {
        run.approvals = [...run.approvals, value];
        notify({ kind: "approval", sessionId, title: `Allow ${value.tool}?`, body: title, card: value });
      }
      if (event === "approved") {
        run.approvals = run.approvals.filter((card) => card.id !== value.id);
        dropAnswered(sessionId, run.approvals);
      }
      if (event === "approval" || event === "approved") {
        if (viewing(sessionId)) renderApprovals();
        return renderRunState();
      }
      if (event === "activity") return appendLive(run, value.text);
      if (event === "reset") assistantMessage.content = "";
      if (event === "delta") assistantMessage.content += value.text;
      if (event === "status") {
        assistantMessage.status = run.status = value.status;
        appendLive(run, `• ${value.status}\n`);
        renderRunState();
      }
      if (!viewing(sessionId)) return;
      const last = $("messages").lastElementChild;
      if (event === "delta" || event === "reset") {
        const text = last?.querySelector(".bubble-text");
        if (text) text.textContent = assistantMessage.content;
        const list = $("messages");
        if (list.scrollHeight - list.scrollTop - list.clientHeight < 160) list.scrollTop = list.scrollHeight;
      } else if (event === "status") {
        const status = last?.querySelector(".bubble-status");
        if (status) status.textContent = assistantMessage.status;
      }
    }, sessionId);
    run.status = result.route || "Completed";
    appendLive(run, `\n✓ Done${result.route ? ` · ${result.route}` : ""}\n`);
    if (result.proposal) {
      state.proposals[result.proposal.id] = result.proposal.status;
      notify({ kind: "review", sessionId, title: "Changes waiting for review", body: title });
    } else notify({ kind: "done", sessionId, title: "Session finished", body: title });
    run.messages = null;
    run.retryRequest = null;
    if (viewing(sessionId)) {
      const saved = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (viewing(sessionId)) state.session = saved;
    }
  } catch (error) {
    const stopped = error.name === "AbortError";
    run.status = stopped ? "Stopped" : `Could not complete: ${error.message}`;
    appendLive(run, `\n✕ ${run.status}\n`);
    run.retryRequest = requestData;
    run.messages = [...before, userMessage, { role: "assistant", content: stopped ? "Stopped. You can retry this request." : error.message, route: "Router error" }];
    if (viewing(sessionId)) state.session.messages = run.messages;
    if (!stopped) notify({ kind: "failed", sessionId, title: "Session couldn't finish", body: `${title}: ${error.message}` });
  } finally {
    seenFinal.set(sessionId, Date.now());
    run.active = false;
    run.approvals = [];
    dropAnswered(sessionId, []);
    state.inbox = state.inbox.filter((entry) => !(entry.kind === "approval" && entry.sessionId === sessionId));
    if (viewing(sessionId)) renderChat();
    renderRunState();
    loadSessions().catch(() => {});
  }
}

// Inbox cards and per-card state for approvals no longer pending (answered here or elsewhere, or the run ended).
function dropAnswered(sessionId, pending) {
  const open = new Set([...state.runs.values()].flatMap((r) => (r.approvals || []).map((card) => card.id)).concat(pending.map((card) => card.id)));
  const before = state.inbox.length;
  state.inbox = state.inbox.filter((entry) => !(entry.kind === "approval" && entry.sessionId === sessionId && !open.has(entry.card?.id)));
  for (const id of approvalUi.keys()) if (!open.has(id)) approvalUi.delete(id);
  if (before !== state.inbox.length && current() === "inbox") renderInbox();
}

// Native follow: the POST (or reattach stream) is buffered by native HTTP, so poll GET /api/runs/<session> once a
// second for progress and cards, and take the result from `final` or from the buffered response when it lands.
// The buffered response can time out during a long quiet wait (iOS drops a request after 60 s without data); once the
// run has been seen, that error is ignored and polling decides.
// ponytail: 1 s polling per open run; move to a native streaming plugin if phones lag or batteries complain.
async function pollRun(responsePromise, onEvent, sessionId) {
  let settled = null;
  Promise.resolve(responsePromise).then((response) => readStream(response, () => {})).then((result) => { settled = { result }; }, (error) => { settled = { error }; });
  let seen = false;
  let missing = 0;
  let last = "";
  while (true) {
    if (settled?.result) return settled.result;
    if (settled?.error && (settled.error.name === "AbortError" || !seen)) throw settled.error; // stopped, or refused before it ran
    const response = await stream(`/api/runs/${encodeURIComponent(sessionId)}`).catch(() => null);
    if (response?.status === 401 || response?.status === 403) {
      const error = new Error("The server didn't accept this access code.");
      error.auth = true;
      throw error;
    }
    if (response?.ok) {
      const snap = await response.json();
      seen = true;
      missing = 0;
      if (snap.final) {
        if (snap.final.event === "done") return snap.final.value;
        const error = new Error(snap.final.value?.error || "The request failed.");
        if (snap.final.value?.cancelled) error.name = "AbortError";
        throw error;
      }
      const key = JSON.stringify([snap.content?.length, snap.live?.length, snap.status, (snap.approvals || []).map((card) => card.id)]);
      if (key !== last) { last = key; onEvent("snapshot", snap); }
    } else if (response?.status === 404) {
      missing++;
      // Ended and cleared between polls: the server already saved the answer to the session, which followRun reloads.
      if (seen && missing >= 3) return settled?.result || { route: "", content: "" };
      if (!seen && missing > 30) throw settled?.error || new Error("The server didn't start this request.");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

let liveFrame = 0;
function appendLive(run, text) {
  run.live = (run.live + text).slice(-60_000);
  if (state.sheet === "live" && viewedRun() === run && !liveFrame) liveFrame = requestAnimationFrame(() => { liveFrame = 0; renderLiveSheet(); });
}

function renderRunState() {
  const count = activeRuns().length;
  const badge = $("running-badge");
  badge.hidden = !count;
  badge.textContent = count;
  const view = current();
  if (view === "running") renderRunning();
  if (view === "projects") renderProjects();
  if (view === "sessions") renderSessions();
  if (view === "chat") { refreshComposer(); if (state.sheet === "live") renderLiveSheet(); }
}

// Picks up runs started from the desktop or another phone, and runs this page lost on reload.
async function syncRuns() {
  if (!conn.ok || document.hidden) return;
  const runs = await request("/api/runs").catch((error) => { if (error.auth) lostConnection(error); return []; });
  await Promise.all(runs.filter((run) => !state.runs.get(run.sessionId)?.active && !state.attaching.has(run.sessionId)).map(async (run) => {
    state.attaching.add(run.sessionId);
    try {
      const session = await request(`/api/sessions/${encodeURIComponent(run.sessionId)}`).catch(() => null);
      if (!session) return;
      // Native HTTP buffers the whole stream, so don't wait on it; pollRun follows the run instead.
      const path = `/api/runs/${encodeURIComponent(run.sessionId)}/stream`;
      const response = NATIVE ? stream(path) : await stream(path).catch(() => null);
      if (!NATIVE && !response?.ok) return;
      const runsAll = await request("/api/runs?all").catch(() => []);
      const asked = runsAll.find((item) => item.sessionId === run.sessionId)?.request || {};
      followRun({ sessionId: run.sessionId, projectId: run.projectId, title: (session.title !== "New session" ? session.title : asked.message || "Session").slice(0, 60),
        requestData: { message: asked.message || "", projectId: run.projectId, mode: asked.mode || "auto", skillIds: asked.skillIds || [], contextIds: asked.contextIds || [], attachments: asked.attachments || [], before: session.messages },
        attachmentNames: asked.attachmentNames || [], response });
    } finally { state.attaching.delete(run.sessionId); }
  }));
}
setInterval(syncRuns, 5000);
const resumed = () => { if (!document.hidden) { syncRuns(); reconcileNotifications(); } };
document.addEventListener("visibilitychange", resumed);
AppPlugin?.addListener("appStateChange", ({ isActive }) => { if (isActive) resumed(); });

// Approvals and finished runs this app missed while closed or in the background. Nothing here runs while iOS or
// Android has the app suspended, so there is no closed-app push; this catches up on resume and every 15 s while open.
// GET /api/notifications?after=<latest>; a new `boot` means the server restarted and its list started over.
const seenFinal = new Map(); // sessionId -> ms when this app saw the run end itself
let reconciling = false;
async function reconcileNotifications() {
  if (!conn.ok || reconciling || document.hidden) return;
  reconciling = true;
  try {
    const saved = JSON.parse(localStorage.getItem("ar-notified") || "null");
    const fresh = !saved || saved.server !== conn.url;
    let data = await request(`/api/notifications?after=${fresh ? 0 : saved.latest || 0}`);
    if (!fresh && data.boot !== saved.boot) data = await request("/api/notifications?after=0");
    localStorage.setItem("ar-notified", JSON.stringify({ server: conn.url, boot: data.boot, latest: data.latest }));
    if (fresh) return; // first connection to this server: start from now rather than replaying old events
    let approvals = false;
    for (const item of data.items || []) {
      if (item.type === "approval") { approvals = true; continue; } // syncRuns attaches the run and shows the live card
      if ((seenFinal.get(item.sessionId) || 0) >= Date.parse(item.at) - 10_000) continue; // this app already said so
      const title = { done: "Session finished", failed: "Session couldn't finish", stopped: "Session stopped" }[item.type] || "Session update";
      notify({ kind: item.type === "done" ? "done" : "failed", sessionId: item.sessionId, title, body: item.text ? `${item.title}: ${item.text}` : item.title });
    }
    if (approvals) syncRuns();
  } catch (error) { if (error.auth) lostConnection(error); }
  finally { reconciling = false; }
}
setInterval(reconcileNotifications, 15_000);

function renderRunning() {
  const list = $("running-list");
  const runs = activeRuns();
  if (!runs.length) return list.replaceChildren(el("p", { class: "empty" }, "Nothing is running. Runs started on any device show here."));
  list.replaceChildren(...runs.map((run) => el("div", { class: "row-wrap" },
    el("button", { type: "button", class: "row running", onclick: () => openSession(run.sessionId) },
      el("i", { class: "live-dot", "aria-hidden": "true" }),
      el("span", { class: "row-text" }, el("span", { class: "row-title" }, run.title), el("span", { class: "row-sub" }, `${state.projects.find((project) => project.id === run.projectId)?.name || run.projectId || "All Projects"} · ${run.approvals.length ? "Waiting for approval" : run.status}`))),
    el("button", { type: "button", class: "row-action", "aria-label": `Stop ${run.title}`, onclick: () => request(`/api/runs/${encodeURIComponent(run.sessionId)}/cancel`, { method: "POST" }).catch(toastError) }, "■"))));
}

// ---- Live output sheet --------------------------------------------------------------------------------------
function openLiveSheet() {
  openSheet("Agent output", "live");
  renderLiveSheet();
}
function renderLiveSheet() {
  const run = viewedRun();
  const body = $("sheet-body");
  const pre = body.querySelector("pre");
  const stick = !pre || pre.scrollHeight - pre.scrollTop - pre.clientHeight < 80;
  const route = ROUTES.find(([id]) => id === state.mode)?.[1];
  body.replaceChildren(
    el("p", { class: "run-state" }, run ? [run.active ? el("i", { class: "live-dot", "aria-hidden": "true" }) : null, run.status] : "Ready when you are."),
    el("pre", { class: "live-output", tabIndex: 0, "aria-label": "Live output from the running agent" }, run?.live || "Output from the running agent shows up here as it works."),
    el("div", { class: "group-label" }, "Task details"),
    el("div", { class: "card glass" },
      el("div", { class: "row-line" }, el("span", {}, "Project"), el("span", { class: "value" }, state.project?.name || "")),
      el("div", { class: "row-line" }, el("span", {}, "Routing"), el("span", { class: "value" }, route || "Auto")),
      el("div", { class: "row-line" }, el("span", {}, "Permissions"), el("span", { class: "value" }, PERMISSION_MODES.find(([id]) => id === permissionMode())?.[1])),
      el("div", { class: "row-line" }, el("span", {}, "Thread access"), el("span", { class: "value" }, ACCESS.find(([id]) => id === (state.session?.accessLimit || ""))?.[1])),
      el("div", { class: "row-line" }, el("span", {}, "Skills"), el("span", { class: "value" }, state.skills.filter((skill) => state.selectedSkills.includes(skill.id) || state.preapproved.includes(skill.id)).map((skill) => skill.name).join(", ") || "None"))));
  const next = body.querySelector("pre");
  if (stick) next.scrollTop = next.scrollHeight;
}

// ---- Proposals ----------------------------------------------------------------------------------------------
async function openProposal(id) {
  openSheet("Proposed changes", "proposal", el("p", { class: "hint" }, "Loading…"));
  let proposal;
  try { proposal = await request(`/api/proposals/${encodeURIComponent(id)}`); } catch (error) { return $("sheet-body").replaceChildren(el("p", { class: "hint" }, error.message)); }
  const status = el("p", { class: "hint", "aria-live": "polite" }, proposal.status === "applied" ? "These changes have already been applied." : "Nothing is applied until you approve it.");
  const apply = el("button", { type: "button", class: "primary-button", disabled: proposal.status !== "pending" || !proposal.changes.length, onclick: async () => {
    apply.disabled = true;
    status.textContent = "Applying approved changes…";
    try {
      const result = await request(`/api/proposals/${encodeURIComponent(id)}/approve`, { method: "POST", body: "{}" });
      state.proposals[id] = "applied";
      status.textContent = `Applied ${result.files} file${result.files === 1 ? "" : "s"}.`;
      renderMessages();
      loadSessions().catch(() => {});
    } catch (error) { status.textContent = error.message; apply.disabled = false; }
  } }, "Apply changes");
  $("sheet-body").replaceChildren(
    el("p", { class: "hint" }, `${proposal.changes.length} file${proposal.changes.length === 1 ? "" : "s"} · ${proposal.provider || proposal.route} · ${proposal.status}`),
    ...proposal.changes.map((change) => el("details", { class: "diff-file glass", open: proposal.changes.length <= 3 },
      el("summary", {}, `${change.action.toUpperCase()} · ${change.path}`),
      el("div", { class: "diff" }, ...lineDiff(change.before, change.after).map(([kind, line]) => el("div", { class: `diff-line ${kind === "+" ? "added" : kind === "-" ? "removed" : "same"}` }, el("span", {}, kind), el("code", {}, line || " ")))))),
    status, apply);
}

// Same line diff as the desktop page.
function lineDiff(before, after) {
  const allA = (before || "").split("\n");
  const allB = (after || "").split("\n");
  let head = 0;
  while (head < allA.length && head < allB.length && allA[head] === allB[head]) head++;
  let tail = 0;
  while (tail < allA.length - head && tail < allB.length - head && allA[allA.length - 1 - tail] === allB[allB.length - 1 - tail]) tail++;
  const a = allA.slice(head, allA.length - tail);
  const b = allB.slice(head, allB.length - tail);
  const out = allA.slice(0, head).map((line) => [" ", line]);
  if (a.length * b.length > 180_000) out.push(...a.map((line) => ["-", line]), ...b.map((line) => ["+", line]));
  else {
    const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    for (let i = 0, j = 0; i < a.length || j < b.length;) {
      if (i < a.length && j < b.length && a[i] === b[j]) out.push([" ", a[i++]]), j++;
      else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) out.push(["-", a[i++]]);
      else out.push(["+", b[j++]]);
    }
  }
  out.push(...allA.slice(allA.length - tail).map((line) => [" ", line]));
  const near = new Uint8Array(out.length);
  out.forEach(([kind], index) => { if (kind !== " ") for (let k = Math.max(0, index - 3); k <= Math.min(out.length - 1, index + 3); k++) near[k] = 1; });
  const collapsed = [];
  for (let index = 0; index < out.length;) {
    if (out[index][0] !== " " || near[index]) { collapsed.push(out[index++]); continue; }
    let end = index;
    while (end < out.length && out[end][0] === " " && !near[end]) end++;
    collapsed.push(end - index > 1 ? ["…", `${end - index} unchanged lines`] : out[index]);
    index = end;
  }
  return collapsed;
}

// ---- Inbox and alerts ---------------------------------------------------------------------------------------
function notify(entry) {
  if (entry.card && state.inbox.some((item) => item.card?.id === entry.card.id)) return;
  state.inbox.unshift({ ...entry, at: new Date() });
  state.inbox.length = Math.min(state.inbox.length, 100);
  if (nav.tab !== "inbox" && !viewing(entry.sessionId)) state.unread++;
  renderBadges();
  if (current() === "inbox") renderInbox();
  if (!viewing(entry.sessionId) && !document.hidden) toast(`${entry.title} · ${entry.body}`);
  navigator.vibrate?.(entry.kind === "approval" ? [20, 60, 20] : 20);
  if (!document.hidden || localStorage.getItem("ar-notify") !== "1") return;
  if (LocalNotifications) {
    LocalNotifications.schedule({ notifications: [{ id: Math.floor(Math.random() * 2 ** 31), title: entry.title, body: entry.body, extra: { sessionId: entry.sessionId } }] }).catch(() => {});
  } else if ("Notification" in window && Notification.permission === "granted") {
    const alert = new Notification(entry.title, { body: entry.body, tag: entry.card?.id || entry.sessionId });
    alert.onclick = () => { focus(); openSession(entry.sessionId); };
  }
}

function renderBadges() {
  const badge = $("inbox-badge");
  badge.hidden = !state.unread;
  badge.textContent = state.unread;
}

function renderInbox() {
  const list = $("inbox-list");
  if (!state.inbox.length) return list.replaceChildren(el("p", { class: "empty" }, "Nothing new."));
  list.replaceChildren(...state.inbox.map((entry) => {
    if (entry.kind === "approval") return el("div", { class: "inbox-approval" }, el("button", { type: "button", class: "text-button", onclick: () => openSession(entry.sessionId) }, entry.body), approvalCard(entry.sessionId, entry.card));
    return el("button", { type: "button", class: `notice glass ${entry.kind}`, onclick: () => openSession(entry.sessionId) },
      el("span", { class: "notice-icon", "aria-hidden": "true" }, { done: "✓", review: "◧", failed: "!" }[entry.kind] || "•"),
      el("span", { class: "row-text" }, el("span", { class: "row-title" }, entry.title), el("span", { class: "row-sub" }, entry.body)),
      el("time", { class: "row-sub", dateTime: entry.at.toISOString() }, entry.at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })));
  }));
}

// ---- Settings -----------------------------------------------------------------------------------------------
async function loadSettingsView() {
  $("settings-server").textContent = conn.url;
  $("settings-version").textContent = conn.appVersion ? `App ${conn.appVersion} · Server ${conn.version}` : `Server ${conn.version}`;
  $("appearance").value = localStorage.getItem("ar-appearance") || "system";
  $("notify-toggle").checked = localStorage.getItem("ar-notify") === "1";
  $("notify-toggle").disabled = !LocalNotifications && !("Notification" in window);
  try {
    const [settings, status, models] = await Promise.all([request("/api/settings"), request("/api/status"), request("/api/models").catch(() => ({ models: {} }))]);
    state.settings = settings;
    $("projects-root").value = settings.projectsRoot || "";
    $("skills-limit").value = Number.isSafeInteger(settings.skillsLimit) ? settings.skillsLimit : -1;
    const lines = [["Local model", status.colibri?.online ? status.colibri.selectedModel || "Online" : "Offline"]];
    for (const [id, name] of [["claude", "Claude Code"], ["codex", "Codex"], ["copilot", "Copilot"]]) lines.push([name, status.commands?.[id]?.signIn || (status.commands?.[id]?.available ? "Installed" : "Not installed")]);
    $("server-status").replaceChildren(...lines.map(([label, value]) => el("div", { class: "row-line" }, el("span", {}, label), el("span", { class: "value" }, value))));
    const choices = models.models?.all || [];
    const select = (id, selected, empty) => {
      const node = el("select", { id }, el("option", { value: "" }, empty), ...choices.map((model) => el("option", { value: model.id }, model.name || model.id)));
      if (selected && !choices.some((model) => model.id === selected)) node.append(el("option", { value: selected }, `${selected} (saved)`));
      node.value = selected || "";
      return node;
    };
    $("routing").replaceChildren(...Object.entries(ROLES).map(([role, label]) => el("details", { class: "role" },
      el("summary", {}, el("span", {}, label), el("span", { class: "value" }, (settings[`${role}Primary`] || "Default").split("::").filter(Boolean).join(" · "))),
      el("label", { class: "field" }, "Preferred provider and model", select(`${role}-primary`, settings[`${role}Primary`], "This task's default")),
      el("label", { class: "field" }, "Fallback", select(`${role}-fallback`, settings[`${role}Fallback`], "Choose automatically")))));
  } catch (error) { $("settings-status").textContent = error.message; }
}

$("appearance").addEventListener("change", (event) => {
  localStorage.setItem("ar-appearance", event.target.value);
  document.documentElement.dataset.theme = event.target.value;
});
$("notify-toggle").addEventListener("change", async (event) => {
  if (event.target.checked && LocalNotifications) event.target.checked = (await LocalNotifications.requestPermissions().catch(() => ({}))).display === "granted";
  else if (event.target.checked && Notification.permission !== "granted") event.target.checked = (await Notification.requestPermission()) === "granted";
  localStorage.setItem("ar-notify", event.target.checked ? "1" : "0");
});
$("save-settings").addEventListener("click", async () => {
  const status = $("settings-status");
  const skillsLimit = $("skills-limit").valueAsNumber;
  if (!Number.isSafeInteger(skillsLimit) || skillsLimit < -1) { status.textContent = "Enter −1, 0, or a positive whole number."; return; }
  status.textContent = "Saving…";
  try {
    const routing = Object.fromEntries(Object.keys(ROLES).flatMap((role) => [[`${role}Primary`, $(`${role}-primary`)?.value ?? state.settings?.[`${role}Primary`] ?? ""], [`${role}Fallback`, $(`${role}-fallback`)?.value ?? state.settings?.[`${role}Fallback`] ?? ""]]));
    state.settings = await request("/api/settings", { method: "POST", body: JSON.stringify({ projectsRoot: $("projects-root").value, skillsLimit, ...routing }) });
    state.skillsLimit = state.settings.skillsLimit;
    status.textContent = "Saved.";
    loadProjects().catch(() => {});
  } catch (error) { status.textContent = error.message; }
});

// ---- Start --------------------------------------------------------------------------------------------------
LocalNotifications?.addListener("localNotificationActionPerformed", ({ notification }) => {
  if (notification.extra?.sessionId) openSession(notification.extra.sessionId);
});
history.replaceState({ view: "root" }, "");
$("server-url").value = conn.url;
(async () => {
  conn.token = await tokenStore.get();
  conn.appVersion = (await AppPlugin?.getInfo().catch(() => null))?.version || "";
  connect(true);
})();
