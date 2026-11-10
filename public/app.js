const pendingFollowups = new Map();
const $ = (id) => document.getElementById(id);
let recordingShortcut = false;
const state = { projects: [], project: null, sessions: [], session: null, busy: false, runs: new Map(), skills: [], categories: [], selectedSkills: loadSelectedSkills(), preapprovedSkillIds: [], pendingPreapprovedSkillIds: [], skillsLimit: -1, pendingSkillsLimit: -1, theme: "system", settingsRoot: "", settingsConfigured: false, settingsPrompted: false, attachments: [], contextIds: [], contextFiles: [], contextProjectId: null, proposal: null, proposals: {}, lastRunStatus: "Ready when you are.", modelPrefs: {}, modelCatalog: null };

function applyTheme(theme) {
  state.theme = theme;
  const active = theme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
  document.documentElement.dataset.theme = active;
  document.documentElement.style.colorScheme = active;
}

async function refreshWindowsAccent() {
  try {
    const { color } = await request("/api/windows-accent");
    if (/^#[\da-f]{6}$/i.test(color || "")) {
      document.documentElement.style.setProperty("--windows-accent", color);
      const channels = [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255).map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
      const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
      document.documentElement.style.setProperty("--accent-ink", luminance > 0.42 ? "#12202a" : "#ffffff");
    }
  } catch {}
}

function loadSelectedSkills() {
  try {
    const ids = JSON.parse(localStorage.getItem("agent-router-skills") || "[]");
    return Array.isArray(ids) ? ids : [];
  } catch {
    return [];
  }
}

function taskSkillSlots() {
  return state.skillsLimit === -1 ? Infinity : Math.max(0, state.skillsLimit - state.preapprovedSkillIds.length);
}

function renderInspector() {
  const mode = $("mode").value;
  const scope = state.project?.scope === "all" ? "All visible project folders" : state.project?.path || "No project selected";
  const summaries = {
    auto: "Route Planning reads your request and recent messages, picks a route, and the provider you set for that route in Settings runs it.",
    route: "Route Planning only reports which route it would choose. Nothing else runs.",
    longterm: "The Long Term Project planning provider reads the selected project and writes a phased plan. It cannot edit files.",
    chain: "Planning splits requests into build tasks, then parallel review and security checks. Results arrive together. Shared files run sequentially; staged mode produces one preview.",
    code: "The Coding provider edits the selected project directly and lists the files it changed. Ask for a staged copy to review changes before they're applied.",
    review: "The Reviewing provider reads the selected project and reports findings. It cannot edit files.",
    security: "The Security audit provider reads the selected project and reports risks. It cannot edit files or run commands.",
    ui: "The UI Designer provider edits the selected project directly. Ask for a staged copy to review first.",
    art: "The Art Asset provider creates assets in the selected project. Ask for a staged copy to review first.",
    github: "The GitHub provider can read the project and run only git status, log, diff, branch, remote, push (never force) and gh issue/pr commands. Codex, local models and API-key models can only advise here.",
    quick: "The Quick questions provider answers without project access. Images are sent when that provider is a local or API-key model."
  };
  $("route-label").textContent = $("mode").selectedOptions[0]?.textContent.replace(/ ·.*/, "") || "Auto";
  $("run-state").textContent = viewedRun()?.status || state.lastRunStatus;
  const linkedNames = state.project?.linked?.length ? `\nLinked folders (read-only): ${state.project.linked.join(", ")}.` : "";
  $("permission-summary").textContent = `${summaries[mode]}\n\nProject access: ${scope}.${linkedNames}`;
  renderLinkedFolders();
  const modelList = $("model-summary");
  modelList.replaceChildren();
  for (const [label, key] of [["Route Planning", "routePlanningPrimary"], ["Long Term Project planning", "longTermPlanningPrimary"], ["Coding", "codingPrimary"], ["Reviewing", "reviewPrimary"], ["Security audit", "securityPrimary"], ["UI Designer", "uiPrimary"], ["Art Asset generation", "artPrimary"], ["GitHub requests", "githubPrimary"], ["Quick questions", "quickPrimary"]]) {
    const item = document.createElement("li");
    item.textContent = `${label}: ${readableChoice(key)}`;
    modelList.append(item);
  }
  const context = $("included-context");
  context.replaceChildren();
  const files = [
    ...state.attachments.map((file) => `${file.name}${file.mimeType?.startsWith("image/") ? " (image: local/API models only)" : " (text included)"}`),
    ...state.contextIds.map((id) => { const file = state.contextFiles.find((item) => item.id === id); return file ? `${file.projectName}/${file.path}` : id; })
  ];
  if (!files.length) files.push("No extra files selected.");
  for (const item of files) { const li = document.createElement("li"); li.textContent = item; context.append(li); }
  const skills = $("included-skills");
  skills.replaceChildren();
  const ids = [...new Set([...state.preapprovedSkillIds, ...state.selectedSkills])];
  const activeIds = state.skillsLimit === 0 ? [] : state.skillsLimit === -1 ? ids : ids.slice(0, state.skillsLimit);
  const skillNames = activeIds.map((id) => state.skills.find((skill) => skill.id === id)?.name || id);
  if (!skillNames.length) skillNames.push("No skills selected.");
  for (const item of skillNames) { const li = document.createElement("li"); li.textContent = item; skills.append(li); }
}

function readableChoice(key) {
  const choice = state.modelPrefs[key] || "Provider default";
  const [provider, model] = choice.split("::");
  const providerNames = { colibri: "Local model", claude: "Claude Code", codex: "Codex", copilot: "Copilot", openai: "OpenAI API", anthropic: "Anthropic API" };
  return state.modelCatalog?.all?.find((entry) => entry.id === choice)?.name || (providerNames[provider] ? `${providerNames[provider]}${model ? ` — ${model}` : ""}` : choice);
}

// Route picker: a ChatGPT-style menu over the hidden #mode select, which stays the source of truth.
const ROUTE_INFO = {
  auto: ["Picks the best route for each task", null],
  route: ["Only shows which route Auto would pick", "routePlanningPrimary"],
  longterm: ["Writes a phased plan · read-only", "longTermPlanningPrimary"],
  chain: ["Plans, builds, then reviews with configured providers", "longTermPlanningPrimary"],
  code: ["Edits files in this project", "codingPrimary"],
  review: ["Finds bugs and risks · read-only", "reviewPrimary"],
  security: ["Security findings · read-only", "securityPrimary"],
  ui: ["Edits the interface in this project", "uiPrimary"],
  art: ["Creates image and design assets", "artPrimary"],
  github: ["Git status, push, issues and PRs", "githubPrimary"],
  quick: ["Fast answers, no project access", "quickPrimary"],
};

function setRouteMenu(open) {
  const menu = $("route-menu");
  if (open) {
    menu.replaceChildren();
    for (const option of $("mode").options) {
      const [description, key] = ROUTE_INFO[option.value] || ["", null];
      const item = document.createElement("button");
      item.type = "button";
      item.className = "route-item";
      item.setAttribute("role", "menuitemradio");
      item.setAttribute("aria-checked", String(option.selected));
      item.disabled = option.disabled;
      const name = document.createElement("span");
      name.className = "route-item-name";
      name.textContent = option.textContent.replace(/ ·.*/, "");
      const detail = document.createElement("span");
      detail.className = "route-item-detail";
      detail.textContent = key ? `${description} · ${readableChoice(key)}` : description;
      const check = document.createElement("span");
      check.className = "route-check";
      check.setAttribute("aria-hidden", "true");
      check.textContent = option.selected ? "✓" : "";
      item.append(name, check, detail);
      item.addEventListener("click", () => {
        $("mode").value = option.value;
        $("mode").dispatchEvent(new Event("change"));
        setRouteMenu(false);
        $("route-button").focus();
      });
      menu.append(item);
    }
  }
  menu.hidden = !open;
  $("route-button").setAttribute("aria-expanded", String(open));
  if (open) (menu.querySelector("[aria-checked='true']:not(:disabled)") || menu.querySelector(".route-item:not(:disabled)"))?.focus();
}

// Linked folders live in the composer's + menu: other projects as checkboxes, plus any outside folders picked with Link a folder….
function renderLinkedFolders() {
  const box = $("linked-folders");
  box.replaceChildren();
  $("pick-folder").disabled = state.busy || state.project?.scope !== "single";
  if (state.project?.scope !== "single") { box.textContent = "Choose one project folder to link others."; return; }
  const projectIds = state.projects.filter((item) => item.scope === "single" && !item.parent && item.id !== state.project.id).map((item) => item.id);
  // Saved entries that aren't project names are absolute paths from the folder picker.
  const outside = state.project.linked.filter((id) => !projectIds.includes(id));
  if (!outside.length && !projectIds.length) { box.textContent = "Nothing linked yet. Use Link a folder…"; return; }
  for (const id of [...outside, ...projectIds]) {
    const label = document.createElement("label");
    label.className = "linked-folder";
    label.title = id;
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = state.project.linked.includes(id);
    input.disabled = state.busy;
    input.addEventListener("change", async () => {
      const next = input.checked ? [...state.project.linked, id] : state.project.linked.filter((other) => other !== id);
      try { updateLinked((await request("/api/projects/linked", { method: "POST", body: JSON.stringify({ projectId: state.project.id, linked: next }) })).linked); }
      catch (error) { input.checked = !input.checked; state.lastRunStatus = error.message; renderInspector(); }
    });
    const name = outside.includes(id) ? id.split(/[\\/]/).filter(Boolean).pop() || id : id;
    label.append(input, ` ${name}`);
    if (outside.includes(id)) { const where = document.createElement("small"); where.textContent = ` ${id}`; label.append(where); }
    box.append(label);
  }
}

function updateLinked(linked) {
  state.project.linked = linked;
  state.contextProjectId = null;
  loadContextFiles().catch(() => {});
  renderInspector();
}

// Each session keeps its own run: live log, status, in-progress messages, and a retry request after a failure.
// The server owns each run; this page mirrors it and reattaches after a reload (reattachRuns).
const viewedRun = () => (state.session ? state.runs.get(state.session.id) : undefined);
const activeRuns = () => [...state.runs.values()].filter((run) => run.active);
const LIVE_PLACEHOLDER = "Output from the running agent shows up here as it works.";

function showLive() {
  const pane = $("live-output");
  pane.textContent = viewedRun()?.live || LIVE_PLACEHOLDER;
  pane.scrollTop = pane.scrollHeight;
}

// ponytail: rewrites the whole pane per chunk, capped at 200k chars per run; switch to appending text nodes if it gets slow.
function appendLive(run, text) {
  run.live = (run.live + text).slice(-200_000);
  if (state.session?.id !== run.sessionId) return;
  const pane = $("live-output");
  const atBottom = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 40;
  pane.textContent = run.live;
  if (atBottom) pane.scrollTop = pane.scrollHeight;
}

function renderActiveRuns() {
  const runs = activeRuns();
  $("active-runs-section").hidden = !runs.length;
  $("active-runs-count").textContent = runs.length ? `Running (${runs.length})` : "Running";
  const list = $("active-runs");
  list.replaceChildren();
  for (const run of runs) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-button active-run${state.session?.id === run.sessionId ? " selected" : ""}`;
    button.dataset.sessionId = run.sessionId;
    button.title = `Open ${run.title} in ${run.projectName}`;
    const text = document.createElement("span");
    text.className = "active-run-text";
    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = run.title;
    const where = document.createElement("span");
    where.className = "active-run-status";
    where.textContent = `${run.projectName} · ${run.status}`;
    text.append(title, where);
    const dot = document.createElement("i");
    dot.className = "run-dot";
    dot.setAttribute("aria-hidden", "true");
    button.append(dot, text);
    button.addEventListener("click", () => openRun(run));
    list.append(button);
  }
}

// Status ticks update text in place so a focused button in the list keeps focus.
function updateRunStatus(run) {
  const item = [...$("active-runs").children].find((child) => child.dataset.sessionId === run.sessionId);
  const where = item?.querySelector(".active-run-status");
  if (where) where.textContent = `${run.projectName} · ${run.status}`;
}

async function openRun(run) {
  if (state.project?.id !== run.projectId) await selectProject(run.projectId);
  await selectSession(run.sessionId);
}

function renderRunIndicators() {
  renderActiveRuns();
  renderProjects();
  renderSessions();
}

function setPlusMenu(open) {
  $("plus-menu").hidden = !open;
  $("plus-button").setAttribute("aria-expanded", String(open));
}

function loadContextIds(projectId) {
  try {
    const value = JSON.parse(localStorage.getItem(`agent-router-context-${projectId}`) || "[]");
    return Array.isArray(value) ? value.slice(0, 10) : [];
  } catch { return []; }
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status}).`);
  return data;
}

// state.busy means "the open session is running"; other sessions can run at the same time.
// A CLI provider asked before using a tool (its own settings require approval). Cards for the open session show above
// the composer; the run waits for an answer. Every page following the run sees it.
//   Always allow — the provider saves a permission rule in its own settings (Claude Code's permission suggestions),
//                  then allows this request. The router never answers later cards itself.
//   Allow        — this request only.        Deny — this request only.
// POST /api/runs/<session>/approvals/<card> { decision }. A server or provider that can't save the rule answers 4xx
// (`unsupported: true`) and leaves the card pending, so Allow or Deny still work. `card.canAlwaysAllow === false` means
// the provider offered no rule to save. Per-card UI state survives re-renders.
const APPROVAL_CHOICES = [
  { decision: "always", label: "Always allow", className: "always", busy: "Saving rule…" },
  { decision: "allow", label: "Allow", className: "approve", busy: "Allowing…" },
  { decision: "deny", label: "Deny", className: "decline", busy: "Denying…" },
];
const approvalUi = new Map(); // card id -> { busy: decision | "", message, error, unsupported }

// Kept identical in mobile/www/app.js; test/approval-ui.test.mjs checks both copies.
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

async function answerApproval(run, card, decision) {
  approvalUi.set(card.id, { ...approvalUi.get(card.id), busy: decision, error: false, message: "" });
  renderApprovals();
  try {
    const response = await fetch(`/api/runs/${encodeURIComponent(run.sessionId)}/approvals/${encodeURIComponent(card.id)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(approvalBody(decision)),
    });
    const result = approvalResult(decision, response.status, await response.json().catch(() => ({})));
    approvalUi.set(card.id, { ...(result.unsupported ? {} : approvalUi.get(card.id)), ...result, busy: "" });
  } catch (error) {
    approvalUi.set(card.id, { ...approvalUi.get(card.id), busy: "", error: true, message: `Couldn't reach the router: ${error.message}` });
  }
  renderApprovals();
}

function renderApprovals() {
  const box = $("approval-cards");
  const run = viewedRun();
  const cards = run?.approvals || [];
  const open = new Set([...state.runs.values()].flatMap((r) => (r.approvals || []).map((c) => c.id)));
  for (const id of approvalUi.keys()) if (!open.has(id)) approvalUi.delete(id);
  box.hidden = !cards.length;
  box.replaceChildren(...cards.map((card) => {
    const ui = approvalUi.get(card.id) || {};
    const item = document.createElement("article");
    item.className = "approval-card";
    item.setAttribute("aria-busy", String(Boolean(ui.busy)));
    const titleId = `approval-${card.id}`;
    item.setAttribute("aria-labelledby", titleId);
    const title = document.createElement("h3");
    title.id = titleId;
    title.textContent = card.title || `Allow ${card.tool}?`;
    const reason = document.createElement("p");
    reason.textContent = card.reason || "The provider's settings ask before this tool runs.";
    const detail = document.createElement("pre");
    detail.textContent = card.detail;
    const actions = document.createElement("div");
    actions.className = "approval-actions";
    const alwaysBlocked = card.canAlwaysAllow === false || ui.unsupported;
    for (const choice of APPROVAL_CHOICES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = choice.className;
      button.textContent = ui.busy === choice.decision ? choice.busy : choice.label;
      button.disabled = Boolean(ui.busy) || (choice.decision === "always" && alwaysBlocked);
      if (choice.decision === "always") button.title = alwaysBlocked
        ? "This provider can't save a permanent rule for this request."
        : "Saves a permission rule in the provider's own settings, then allows this request.";
      else button.title = choice.decision === "allow" ? "Allow this request only." : "Deny this request only.";
      button.addEventListener("click", () => answerApproval(run, card, choice.decision));
      actions.append(button);
    }
    const note = document.createElement("p");
    note.className = "approval-status" + (ui.error ? " error" : "");
    note.setAttribute("role", ui.error ? "alert" : "status");
    note.textContent = ui.message || (card.canAlwaysAllow === false ? "Always allow isn't available: the provider offered no rule to save for this request." : "");
    item.append(title, reason, detail, actions, note);
    return item;
  }));
}

function refreshRunControls() {
  const busy = Boolean(viewedRun()?.active);
  state.busy = busy;
  $("steer").hidden = !busy;
  $("send").disabled = busy ? false : !state.project;
  $("send").querySelector("span").textContent = busy ? "Queue / Stop" : "Send";
  $("send").title = busy ? "Stop this session's response" : "Send message";
  $("new-session").disabled = !state.project;
  $("choose-context").disabled = !state.project;
  $("inspector-live").hidden = !busy;
  renderApprovals();
  renderActiveRuns();
  $("prompt").placeholder = !state.project ? "Choose a project first…" : state.project.scope === "all" ? "Ask a quick question or request an all-projects audit…" : "Ask a question or describe a coding task…";
  renderInspector();
}

function renderProjects() {
  const list = $("projects");
  list.replaceChildren();
  if (!state.projects.length) {
    list.textContent = "No project folders found.";
    list.className = "project-list muted";
    return;
  }
  list.className = "project-list";
  const iconButton = (className, text, title, onClick) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = text;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", (event) => { event.stopPropagation(); onClick(); });
    return button;
  };
  // Folders merged into a parent project are listed under it; their sessions live with the parent.
  for (const project of state.projects.filter((item) => !item.parent)) {
    const row = document.createElement("div");
    row.className = "session-row";
    const button = document.createElement("button");
    button.className = `project-button${state.project?.id === project.id ? " selected" : ""}`;
    button.type = "button";
    const symbol = document.createElement("span");
    symbol.className = "project-symbol";
    symbol.textContent = "▰";
    const name = document.createElement("span");
    name.textContent = project.name;
    button.append(symbol, name);
    const running = activeRuns().filter((run) => run.projectId === project.id).length;
    if (running) {
      const badge = document.createElement("span");
      badge.className = "run-badge";
      badge.textContent = `${running} running`;
      button.append(badge);
    }
    button.addEventListener("click", () => selectProject(project.id));
    if (project.scope === "single") {
      button.addEventListener("dragover", (event) => {
        if (!event.dataTransfer.types.includes("application/x-agent-router-session")) return;
        event.preventDefault();
        button.classList.add("drop-target");
      });
      button.addEventListener("dragleave", () => button.classList.remove("drop-target"));
      button.addEventListener("drop", (event) => {
        event.preventDefault();
        button.classList.remove("drop-target");
        const id = event.dataTransfer.getData("application/x-agent-router-session");
        if (id) moveSession(id, project.id);
      });
    }
    row.append(button);
    if (project.scope === "single" && state.project?.scope === "single" && state.project.id !== project.id) {
      row.append(iconButton("merge-session", "⇲", `Merge ${project.name} into ${state.project.name}`, () => mergeProject(state.project.id, project.id)));
    }
    list.append(row);
    for (const member of project.members || []) {
      const memberRow = document.createElement("div");
      memberRow.className = "session-row project-member";
      const label = document.createElement("span");
      label.className = "project-button";
      label.textContent = `↳ ${member}`;
      label.title = `Part of ${project.name}: its sessions are here and its files are in ${project.name}'s obsolete folder`;
      memberRow.append(label, iconButton("delete-session", "⇱", `Split ${member} out of ${project.name}`, () => splitProject(member)));
      list.append(memberRow);
    }
  }
  renderInspector();
}

function blockedByRuns() {
  if (!activeRuns().length) return false;
  $("import-status").textContent = "Wait for running sessions to finish, or stop them, before merging or splitting projects.";
  return true;
}

async function mergeProject(parentId, childId) {
  if (blockedByRuns()) return;
  if (!confirm(`Merge ${childId} into ${parentId}? ${childId}'s sessions move to ${parentId} and new imports about it go there too. The ${childId} folder moves, with every file, into ${parentId}\\obsolete\\${childId}; nothing is deleted, and splitting it out later moves it back.`)) return;
  try {
    const result = await request("/api/projects/merge", { method: "POST", body: JSON.stringify({ parentId, childId }) });
    $("import-status").textContent = `Merged ${childId} into ${result.parentId}${result.moved ? `, moving ${result.moved} sessions` : ""}. Its files are now in ${result.folder}. Press ⟳ to merge sessions on the same topic.`;
    await reloadProjects(result.parentId);
  } catch (error) { $("import-status").textContent = error.message; }
}

async function splitProject(childId) {
  if (blockedByRuns()) return;
  try {
    await request("/api/projects/split", { method: "POST", body: JSON.stringify({ childId }) });
    $("import-status").textContent = `${childId} is its own project again and its folder is back in place. Its old sessions stay where they are.`;
    await reloadProjects(state.project?.id);
  } catch (error) { $("import-status").textContent = error.message; }
}

async function reloadProjects(selectId) {
  state.projects = await request("/api/projects");
  await selectProject(state.projects.some((project) => project.id === selectId) ? selectId : state.projects[0].id);
}

function renderSessions() {
  if (state.editingSessionRow) return; // background refreshes would wipe an open title box or picker
  const list = $("sessions");
  list.replaceChildren();
  if (!state.project) {
    list.textContent = "Choose a project to see its sessions.";
    list.className = "session-list muted";
    return;
  }
  if (!state.sessions.length) {
    list.textContent = "No sessions yet. Start one with +.";
    list.className = "session-list muted";
    return;
  }
  list.className = "session-list";
  for (const session of state.sessions) {
    const row = document.createElement("div");
    row.className = "session-row";
    const button = document.createElement("button");
    button.type = "button";
    button.className = `session-button${state.session?.id === session.id ? " selected" : ""}`;
    const title = document.createElement("span");
    title.className = "session-title";
    title.textContent = session.title || "New session";
    if (session.importedFrom || session.merged) {
      const source = document.createElement("span");
      source.className = "session-source";
      source.textContent = session.merged ? "merged" : { claude: "Claude", codex: "Codex", "codex-cloud": "Codex Cloud" }[session.importedFrom] || session.importedFrom;
      title.prepend(source);
    }
    const date = document.createElement("span");
    date.className = "session-date";
    date.textContent = session.hasPendingReview ? "Review" : new Date(session.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    if (state.runs.get(session.id)?.active) {
      button.classList.add("running");
      date.textContent = "Running";
    }
    button.append(title, date);
    button.addEventListener("click", () => selectSession(session.id));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-session";
    remove.title = "Delete session";
    remove.setAttribute("aria-label", `Delete ${session.title || "session"}`);
    remove.textContent = "×";
    remove.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteSession(session.id);
    });
    const merge = document.createElement("button");
    merge.type = "button";
    merge.className = "merge-session";
    merge.title = "Merge into the open session";
    merge.setAttribute("aria-label", `Merge ${session.title || "session"} into the open session`);
    merge.textContent = "⇲";
    merge.hidden = !state.session || state.session.id === session.id;
    merge.addEventListener("click", (event) => {
      event.stopPropagation();
      mergeSessions([state.session.id, session.id]);
    });
    const rename = document.createElement("button");
    rename.type = "button";
    rename.className = "merge-session";
    rename.title = "Rename session";
    rename.setAttribute("aria-label", `Rename ${session.title || "session"}`);
    rename.textContent = "✎";
    rename.addEventListener("click", (event) => { event.stopPropagation(); editSessionRow(row, session, "rename"); });
    row.append(button, rename);
    if (state.project.scope !== "single") {
      const move = document.createElement("button");
      move.type = "button";
      move.className = "merge-session";
      move.title = "Move to a project";
      move.setAttribute("aria-label", `Move ${session.title || "session"} to a project`);
      move.textContent = "⇥";
      move.addEventListener("click", (event) => { event.stopPropagation(); editSessionRow(row, session, "move"); });
      row.append(move);
    }
    row.append(merge, remove);
    // Drag a session onto a project in the Projects list to move it there.
    button.draggable = true;
    button.addEventListener("dragstart", (event) => {
      event.dataTransfer.setData("application/x-agent-router-session", session.id);
      event.dataTransfer.effectAllowed = "move";
    });
    list.append(row);
  }
}

// Replaces a session row with an inline title box or project picker (Electron has no prompt()).
function editSessionRow(row, session, mode) {
  const field = document.createElement(mode === "rename" ? "input" : "select");
  field.className = "session-edit";
  if (mode === "rename") {
    field.value = session.title || "";
    field.maxLength = 200;
    field.setAttribute("aria-label", "Session title");
  } else {
    field.setAttribute("aria-label", "Move to project");
    field.append(new Option("Move to…", ""));
    for (const project of moveTargets()) field.append(new Option(project.name, project.id));
  }
  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    state.editingSessionRow = false;
    try {
      if (save && mode === "rename" && field.value.trim() && field.value.trim() !== session.title) await renameSession(session.id, field.value.trim());
      if (save && mode === "move" && field.value) await moveSession(session.id, field.value);
    } finally { renderSessions(); }
  };
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); finish(true); }
    if (event.key === "Escape") { event.preventDefault(); finish(false); }
  });
  if (mode === "move") field.addEventListener("change", () => finish(true));
  field.addEventListener("blur", () => finish(mode === "rename"));
  state.editingSessionRow = true;
  row.replaceChildren(field);
  field.focus();
  if (mode === "rename") field.select();
}

function moveTargets() {
  return state.projects.filter((project) => project.scope === "single" && !project.parent);
}

async function renameSession(id, title) {
  try {
    const saved = await request(`/api/sessions/${encodeURIComponent(id)}/rename`, { method: "POST", body: JSON.stringify({ title }) });
    if (state.session?.id === id) state.session.title = saved.title;
    await loadSessions();
  } catch (error) { $("import-status").textContent = error.message; }
}

async function moveSession(id, projectId) {
  try {
    await request(`/api/sessions/${encodeURIComponent(id)}/project`, { method: "POST", body: JSON.stringify({ projectId }) });
    const name = state.projects.find((project) => project.id === projectId)?.name || projectId;
    $("import-status").textContent = `Moved the session to ${name}.`;
    await loadSessions();
  } catch (error) { $("import-status").textContent = error.message; }
}

function renderMessages() {
  $("thread-access").value = state.session?.accessLimit || "";
  $("permission-mode").value = state.session?.permissionMode || state.claudeDefaultMode || "default";
  const list = $("messages");
  list.replaceChildren();
  if (!state.session?.messages?.length) {
    const empty = document.createElement("div");
    empty.id = "empty-state";
    empty.className = "empty-state";
    const icon = document.createElement("div");
    icon.className = "empty-icon";
    icon.textContent = "✳";
    const heading = document.createElement("h1");
    heading.textContent = "What are we working on?";
    const description = document.createElement("p");
    description.textContent = "Ask anything. Each request goes to the AI tool you set up for that kind of work.";
    const suggestions = document.createElement("div");
    suggestions.className = "suggestions";
    for (const prompt of ["Explain the main parts of this project.", "Review the current changes for bugs and risks.", "Help me debug the current issue: "]) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = prompt.startsWith("Explain") ? "Explain this project" : prompt.startsWith("Review") ? "Review current changes" : "Debug an issue";
      button.addEventListener("click", () => { $("prompt").value = prompt; $("prompt").focus(); });
      suggestions.append(button);
    }
    empty.append(icon, heading, description, suggestions);
    list.append(empty);
    return;
  }
  for (const [index, message] of state.session.messages.entries()) addMessage(list, message, index);
  list.scrollTop = list.scrollHeight;
}

function addMessage(list, message, messageIndex) {
  const { role, content, route, feedback, temporary, attachments = [], proposalId } = message;
  const item = document.createElement("div");
  item.className = "message " + (role === "assistant" ? "assistant" : "user");
  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "assistant" ? "✳" : "You";
  const body = document.createElement("div");
  body.className = "message-content";
  if (route) {
    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = route;
    body.append(meta);
  }
  const text = document.createElement("div");
  text.className = "message-text";
  text.textContent = content;
  body.append(text);
  if (message.status) {
    const status = document.createElement("div");
    status.className = "message-status";
    status.textContent = message.status;
    body.append(status);
  }
  if (attachments.length) {
    const files = document.createElement("div");
    files.className = "message-status";
    files.textContent = "Context: " + attachments.join(", ");
    body.append(files);
  }
  if (message.attachmentsNotSaved) {
    const note = document.createElement("div");
    note.className = "message-status";
    note.textContent = "These files were used for this answer but couldn't be saved with the session. Attach them again to reuse them.";
    body.append(note);
  }
  if (role === "user" && Array.isArray(message.attachmentContext) && message.attachmentContext.length) {
    const reuse = document.createElement("button");
    reuse.type = "button";
    reuse.className = "retry-button";
    reuse.textContent = "Reuse these attachments";
    reuse.addEventListener("click", () => {
      const room = Math.max(0, 5 - state.attachments.length);
      const materials = message.attachmentContext.slice(0, room);
      if (state.attachments.reduce((sum, file) => sum + (file.dataUrl?.length || 0), 0) + materials.reduce((sum, file) => sum + (file.dataUrl?.length || 0), 0) > 700_000) {
        alert("These images are too large to restore together. Remove another image first.");
        return;
      }
      state.attachments.push(...materials);
      renderContextControls();
    });
    body.append(reuse);
  }
  if (role === "assistant" && proposalId) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "retry-button";
    button.textContent = state.proposals[proposalId] === "applied" ? "View applied changes" : "Review proposed changes";
    button.addEventListener("click", () => openProposal(proposalId));
    body.append(button);
  }
  if (role === "assistant" && route === "Router error" && viewedRun()?.retryRequest && !viewedRun().active) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "retry-button";
    button.textContent = "Retry";
    button.addEventListener("click", retryLastRequest);
    body.append(button);
  }
  if (role === "assistant" && !temporary && route && route !== "Router error") {
    const controls = document.createElement("div");
    controls.className = "message-feedback";
    const label = document.createElement("span");
    label.textContent = "Rate this answer";
    controls.append(label);
    for (const [rating, symbol, title] of [["good", "👍", "Good answer"], ["bad", "👎", "Bad answer"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "feedback-button" + (feedback?.rating === rating ? " selected" : "");
      button.textContent = symbol;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.setAttribute("aria-pressed", String(feedback?.rating === rating));
      button.disabled = state.busy;
      button.addEventListener("click", () => rateMessage(messageIndex, { rating }, controls));
      controls.append(button);
    }
    const status = document.createElement("span");
    status.className = "feedback-status";
    status.setAttribute("aria-live", "polite");
    status.textContent = feedback ? "Saved locally" : "";
    controls.append(status);
    body.append(controls);
    const routeControls = document.createElement("div");
    routeControls.className = "message-feedback";
    const routeLabel = document.createElement("span");
    routeLabel.textContent = `Was ${route} the right choice?`;
    routeControls.append(routeLabel);
    for (const [routing, symbol, title] of [["good", "👍", "Right provider"], ["bad", "👎", "Wrong provider"]]) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "feedback-button" + (feedback?.routing === routing ? " selected" : "");
      button.textContent = symbol;
      button.title = title;
      button.setAttribute("aria-label", title);
      button.setAttribute("aria-pressed", String(feedback?.routing === routing));
      button.disabled = state.busy;
      button.addEventListener("click", () => rateMessage(messageIndex, { routing }, routeControls));
      routeControls.append(button);
    }
    body.append(routeControls);
  }
  item.append(avatar, body);
  list.append(item);
}

async function rateMessage(messageIndex, feedback, controls) {
  if (state.busy || !state.session) return;
  for (const button of controls.querySelectorAll("button")) button.disabled = true;
  try {
    state.session = await request("/api/sessions/" + encodeURIComponent(state.session.id) + "/feedback", {
      method: "POST",
      body: JSON.stringify({ messageIndex, ...feedback }),
    });
    await loadSessions();
    renderMessages();
  } catch (error) {
    controls.querySelector(".feedback-status").textContent = error.message;
    for (const button of controls.querySelectorAll("button")) button.disabled = false;
  }
}

function renderSkills() {
  const list = $("skills-list");
  list.replaceChildren();
  $("skills-count").textContent = state.skillsLimit === 0
    ? "Skills off"
    : state.preapprovedSkillIds.length
      ? `${state.preapprovedSkillIds.length} approved · ${state.selectedSkills.length} for this task`
      : state.selectedSkills.length ? state.selectedSkills.length + (state.skillsLimit === -1 ? " selected · unlimited" : " selected") : "None selected";
  if (!state.skills.length) {
    list.textContent = "No shared skills yet. Add one below.";
    renderInspector();
    return;
  }
  for (const category of state.categories) {
    const skills = state.skills.filter((skill) => skill.category === category);
    if (!skills.length) continue;
    const heading = document.createElement("h4");
    heading.textContent = category;
    list.append(heading);
    for (const skill of skills) {
      const label = document.createElement("label");
      label.className = "skill-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      const always = state.preapprovedSkillIds.includes(skill.id);
      checkbox.checked = state.skillsLimit !== 0 && (always || state.selectedSkills.includes(skill.id));
      checkbox.disabled = state.skillsLimit === 0 || always || (!checkbox.checked && state.selectedSkills.length >= taskSkillSlots());
      checkbox.addEventListener("change", () => {
        state.selectedSkills = checkbox.checked
          ? [...state.selectedSkills, skill.id]
          : state.selectedSkills.filter((id) => id !== skill.id);
        localStorage.setItem("agent-router-skills", JSON.stringify(state.selectedSkills));
        renderSkills();
      });
      const text = document.createElement("span");
      text.textContent = skill.name + (always ? " · Pre-approved" : skill.description ? " — " + skill.description : "");
      label.append(checkbox, text);
      list.append(label);
    }
  }
  renderInspector();
}

async function loadSkills() {
  const [result, settings] = await Promise.all([request("/api/skills"), request("/api/settings")]);
  state.skills = result.skills;
  state.categories = result.categories;
  const available = new Set(state.skills.map((skill) => skill.id));
  state.skillsLimit = Number.isSafeInteger(settings.skillsLimit) ? settings.skillsLimit : -1;
  state.modelPrefs = settings;
  state.claudeDefaultMode = settings.claudeDefaultMode || "default";
  $("permission-mode").value = state.session?.permissionMode || state.claudeDefaultMode;
  state.pendingSkillsLimit = state.skillsLimit;
  state.preapprovedSkillIds = settings.preapprovedSkillIds.filter((id) => available.has(id));
  state.pendingPreapprovedSkillIds = [...state.preapprovedSkillIds];
  state.selectedSkills = state.selectedSkills.filter((id) => available.has(id) && !state.preapprovedSkillIds.includes(id)).slice(0, taskSkillSlots());
  state.theme = settings.theme || "system";
  state.settingsRoot = settings.projectsRoot;
  state.settingsConfigured = settings.configured;
  state.modelPrefs = settings;
  applyTheme(state.theme);
  localStorage.setItem("agent-router-skills", JSON.stringify(state.selectedSkills));
  $("skill-categories").replaceChildren(...state.categories.map((category) => {
    const option = document.createElement("option");
    option.value = category;
    return option;
  }));
  renderSkills();
  renderApprovedSkills();
}

function renderApprovedSkills() {
  const list = $("approved-skills");
  list.replaceChildren();
  const query = $("approved-skill-search").value.trim().toLowerCase();
  const matches = state.skills.filter((skill) => `${skill.category} ${skill.name} ${skill.description}`.toLowerCase().includes(query));
  if (!matches.length) { list.textContent = "No matching shared skills."; return; }
  for (const category of state.categories) {
    const skills = matches.filter((skill) => skill.category === category);
    if (!skills.length) continue;
    const heading = document.createElement("h4");
    heading.textContent = category;
    list.append(heading);
    for (const skill of skills) {
      const label = document.createElement("label");
      label.className = "approved-skill";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = state.pendingPreapprovedSkillIds.includes(skill.id);
      checkbox.addEventListener("change", () => {
        state.pendingPreapprovedSkillIds = checkbox.checked
          ? [...state.pendingPreapprovedSkillIds, skill.id]
          : state.pendingPreapprovedSkillIds.filter((id) => id !== skill.id);
        renderApprovedSkills();
      });
      const description = document.createElement("span");
      description.textContent = skill.name + (skill.description ? " — " + skill.description : "");
      label.append(checkbox, description);
      list.append(label);
    }
  }
  const count = document.createElement("div");
  count.className = "settings-help";
  count.textContent = state.pendingSkillsLimit === 0
    ? `${state.pendingPreapprovedSkillIds.length} approved · no skills will be sent while the limit is 0`
    : `${state.pendingPreapprovedSkillIds.length} approved · ${state.pendingSkillsLimit === -1 ? "unlimited" : `up to ${state.pendingSkillsLimit} sent per request`}`;
  list.append(count);
}

async function saveSkill() {
  const button = $("save-skill");
  const status = $("skill-form-status");
  button.disabled = true;
  status.textContent = "Saving…";
  try {
    const result = await request("/api/skills", {
      method: "POST",
      body: JSON.stringify({ name: $("skill-name").value, category: $("skill-category").value, instructions: $("skill-instructions").value }),
    });
    state.skills = result.skills;
    state.categories = result.categories;
    if (result.skill && state.selectedSkills.length < taskSkillSlots() && state.skillsLimit !== 0) state.selectedSkills.push(result.skill.id);
    localStorage.setItem("agent-router-skills", JSON.stringify(state.selectedSkills));
    $("skill-name").value = "";
    $("skill-instructions").value = "";
    $("skill-form").hidden = true;
    status.textContent = "Saved to skills.md";
    renderSkills();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

let skillScan = null;

function resetSkillScan(message = "") {
  skillScan = null;
  $("skill-scan-result").hidden = true;
  $("skill-scan-status").textContent = message;
}

async function scanSkill(event) {
  event.preventDefault();
  const button = $("scan-skill");
  resetSkillScan("Scanning…");
  button.disabled = true;
  try {
    skillScan = await request("/api/skills/scan", { method: "POST", body: JSON.stringify({ url: $("skill-url").value }) });
    $("scan-name").textContent = skillScan.name;
    $("scan-source").textContent = skillScan.source;
    $("scan-purpose").textContent = skillScan.purpose || "The skill does not say what it is for. Read the full skill before installing.";
    $("scan-instructions").textContent = skillScan.instructions;
    const levels = { high: "High risk", medium: "Check", info: "Note" };
    const warnings = [...skillScan.warnings].sort((a, b) => Object.keys(levels).indexOf(a.level) - Object.keys(levels).indexOf(b.level));
    $("scan-warnings").replaceChildren(...(warnings.length ? warnings.map((warning) => {
      const item = document.createElement("li");
      item.className = `scan-warning ${warning.level}`;
      const badge = document.createElement("strong");
      badge.textContent = levels[warning.level] || warning.level;
      item.append(badge, document.createTextNode(" " + warning.title));
      if (warning.example) {
        const example = document.createElement("code");
        example.textContent = warning.example;
        item.append(example);
      }
      return item;
    }) : [Object.assign(document.createElement("li"), { className: "scan-warning clean", textContent: "No warnings found. This is a pattern check, so still read the skill if you don't know its author." })]));
    $("skill-scan-result").hidden = false;
    $("skill-scan-status").textContent = "";
  } catch (error) {
    resetSkillScan(error.message);
  } finally {
    button.disabled = false;
  }
}

async function installScannedSkill() {
  if (!skillScan) return;
  const button = $("install-skill");
  button.disabled = true;
  $("skill-scan-status").textContent = "Installing…";
  try {
    const result = await request("/api/skills/install", { method: "POST", body: JSON.stringify({ scanId: skillScan.scanId, category: $("scan-category").value }) });
    state.skills = result.skills;
    state.categories = result.categories;
    state.preapprovedSkillIds = result.preapprovedSkillIds;
    if (!state.pendingPreapprovedSkillIds.includes(result.skill.id)) state.pendingPreapprovedSkillIds.push(result.skill.id);
    $("skill-url").value = "";
    resetSkillScan(`Installed ${result.skill.name} and pre-approved it for every provider.`);
    renderSkills();
    renderApprovedSkills();
  } catch (error) {
    $("skill-scan-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
}

function renderContextControls() {
  const count = state.attachments.length + state.contextIds.length;
  $("context-count").textContent = count ? `${count} context item${count === 1 ? "" : "s"} selected` : "No extra context";
  const list = $("attachment-list");
  list.replaceChildren();
  for (const [index, file] of state.attachments.entries()) {
    const chip = document.createElement("span");
    chip.className = "attachment-chip";
    chip.append(document.createTextNode(file.name));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${file.name}`);
    remove.addEventListener("click", () => { state.attachments.splice(index, 1); renderContextControls(); });
    chip.append(remove);
    list.append(chip);
  }
  renderInspector();
}

async function loadContextFiles() {
  if (!state.project) return;
  if (state.contextProjectId === state.project.id) return;
  const result = await request(`/api/context?projectId=${encodeURIComponent(state.project.id)}`);
  state.contextFiles = result.files;
  state.contextProjectId = state.project.id;
  state.contextIds = state.contextIds.filter((id) => state.contextFiles.some((file) => file.id === id)).slice(0, 10);
  localStorage.setItem(`agent-router-context-${state.project.id}`, JSON.stringify(state.contextIds));
  renderContextControls();
}

function renderContextPicker() {
  const list = $("context-file-list");
  const search = $("context-search").value.trim().toLowerCase();
  list.replaceChildren();
  const files = state.contextFiles.filter((file) => `${file.projectName}/${file.path}`.toLowerCase().includes(search));
  if (!files.length) {
    list.textContent = search ? "No matching text files." : "No selectable text files found.";
    return;
  }
  for (const file of files) {
    const label = document.createElement("label");
    label.className = "context-file-option";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.contextIds.includes(file.id);
    checkbox.disabled = !checkbox.checked && state.contextIds.length >= 10;
    checkbox.addEventListener("change", () => {
      state.contextIds = checkbox.checked ? [...state.contextIds, file.id] : state.contextIds.filter((id) => id !== file.id);
      localStorage.setItem(`agent-router-context-${state.project.id}`, JSON.stringify(state.contextIds));
      renderContextPicker();
      renderContextControls();
    });
    const name = document.createElement("span");
    name.textContent = file.path;
    const project = document.createElement("small");
    project.textContent = file.projectName;
    name.append(project);
    label.append(checkbox, name);
    list.append(label);
  }
  $("context-dialog-status").textContent = `${state.contextIds.length} of 10 selected`;
}

async function addAttachments(files) {
  const allowed = /\.(c|cc|cfg|conf|cpp|cs|css|csv|go|h|hpp|html|java|js|json|jsx|md|mjs|ps1|py|rb|rs|sh|sql|toml|ts|tsx|txt|xml|yaml|yml)$/i;
  const secret = /(^|[._-])(secret|credentials?|tokens?|passwords?|id_rsa|id_ed25519)([._-]|$)|\.(pem|key|pfx|p12)$/i;
  if (state.attachments.length + files.length > 5) throw new Error("Attach up to five files at a time.");
  const additions = [];
  for (const file of files) {
    if (file.type.startsWith("image/")) {
      if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error(`${file.name} must be a PNG, JPEG, or WebP image.`);
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      let dataUrl = canvas.toDataURL("image/jpeg", 0.78);
      while (dataUrl.length > 680_000 && canvas.width > 480) {
        const smaller = document.createElement("canvas");
        smaller.width = Math.round(canvas.width * 0.8);
        smaller.height = Math.round(canvas.height * 0.8);
        smaller.getContext("2d").drawImage(canvas, 0, 0, smaller.width, smaller.height);
        canvas.width = smaller.width;
        canvas.height = smaller.height;
        canvas.getContext("2d").drawImage(smaller, 0, 0);
        dataUrl = canvas.toDataURL("image/jpeg", 0.68);
      }
      if (dataUrl.length > 680_000) throw new Error(`${file.name} is too large after compression.`);
      additions.push({ name: file.name, mimeType: "image/jpeg", dataUrl });
      continue;
    }
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
      if (file.size > 15_000_000) throw new Error(`${file.name} is too large. Choose a PDF under 15 MB.`);
      const pdfjs = await import("/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
      const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false, enableXfa: false }).promise;
      if (pdf.numPages > 40) throw new Error(`${file.name} has more than 40 pages. Split it into smaller PDFs.`);
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const text = await page.getTextContent();
        pages.push(text.items.map((item) => item.str || "").join(" "));
        if (pages.join("\n").length > 95_000) throw new Error(`${file.name} contains too much text. Select a smaller part of the PDF.`);
      }
      const content = pages.map((text, index) => `Page ${index + 1}\n${text}`).join("\n\n").trim();
      if (!content) throw new Error(`${file.name} has no selectable text. Scanned PDFs need OCR before they can be used.`);
      additions.push({ name: file.name, content, kind: "pdf-text" });
      continue;
    }
    if (!allowed.test(file.name) || secret.test(file.name) || file.size > 30_000) throw new Error(`${file.name} is not a supported small text file.`);
    const content = await file.text();
    if (content.includes("\0")) throw new Error(`${file.name} is not plain text.`);
    additions.push({ name: file.name, content });
  }
  if ([...state.attachments.filter((file) => file.content), ...additions.filter((file) => file.content)].reduce((sum, file) => sum + file.content.length, 0) > 100_000) throw new Error("Selected text context is too large. Attach fewer or smaller files.");
  state.attachments.push(...additions);
  if (state.attachments.reduce((sum, file) => sum + (file.dataUrl?.length || 0), 0) > 700_000) {
    state.attachments.splice(state.attachments.length - additions.length, additions.length);
    throw new Error("Attached images are too large together. Remove an image or choose smaller ones.");
  }
  renderContextControls();
}

async function loadSessions() {
  if (!state.project) return;
  const query = new URLSearchParams({ projectId: state.project.id, q: $("session-search").value.trim(), pending: $("pending-only").checked ? "1" : "0" });
  const projectId = state.project.id;
  const sessions = await request(`/api/sessions?${query}`);
  if (state.project?.id !== projectId) return;
  state.sessions = sessions;
  renderSessions();
}

let sessionSearchTimer;
function refreshSessionSearch() {
  clearTimeout(sessionSearchTimer);
  sessionSearchTimer = setTimeout(() => loadSessions().catch(() => {}), 220);
}

// Bumped on every project/session switch so a slow fetch can't open a session the user has already left.
let selectTicket = 0;

async function selectProject(id) {
  selectTicket++;
  state.project = state.projects.find((project) => project.id === id) || null;
  state.contextIds = state.project ? loadContextIds(id) : [];
  state.contextProjectId = null;
  renderContextControls();
  state.session = null;
  localStorage.setItem("agent-router-project", id);
  $("project-name").textContent = state.project?.name || "Choose a project";
  $("project-path").textContent = state.project?.path || "";
  const allProjects = state.project?.scope === "all";
  $("workspace-note").textContent = allProjects
    ? "Read-only review across visible project folders. Choose one folder to code or push."
    : state.project ? "All providers share this folder and its latest handoff note." : "Choose a project before asking a question.";
  for (const value of ["code", "ui", "art", "github"]) {
    const option = $("mode").querySelector(`option[value="${value}"]`);
    if (option) option.disabled = allProjects;
  }
  if (allProjects && ["code", "ui", "art", "github"].includes($("mode").value)) $("mode").value = "auto";
  state.lastRunStatus = "Ready when you are.";
  renderProjects();
  renderMessages();
  showLive();
  refreshRunControls();
  await loadSessions();
  if (state.project) loadContextFiles().catch((error) => { $("context-count").textContent = error.message; });
}

async function selectSession(id) {
  const ticket = ++selectTicket;
  const session = await request(`/api/sessions/${encodeURIComponent(id)}`);
  if (ticket !== selectTicket) return;
  // A running or failed run holds messages the server hasn't saved yet (the live answer, or the error with Retry).
  const run = state.runs.get(id);
  if (run?.messages) session.messages = run.messages;
  state.session = session;
  state.lastRunStatus = "Ready when you are.";
  renderSessions();
  renderMessages();
  showLive();
  refreshRunControls();
}

async function newSession() {
  if (!state.project) return;
  selectTicket++;
  state.session = await request("/api/sessions", { method: "POST", body: JSON.stringify({ projectId: state.project.id }) });
  state.lastRunStatus = "Ready when you are.";
  await loadSessions();
  renderMessages();
  showLive();
  refreshRunControls();
  $("prompt").focus();
}

async function importSessions({ quiet = false, reindex = false } = {}) {
  const status = $("import-status");
  if (!quiet) status.textContent = reindex ? "Re-filing imported sessions by project and topic…" : "Looking for Claude Code and Codex sessions…";
  try {
    const result = await request("/api/sessions/import", { method: "POST", body: JSON.stringify({ reindex }) });
    if (reindex) status.textContent = `Re-filed imported sessions: ${result.added} new, ${result.updated} moved to a better project, ${result.merged} merged into topic threads.`;
    else if (!quiet || result.added) status.textContent = result.added || result.updated
      ? `Imported ${result.added} new and updated ${result.updated} CLI sessions, each in the project it works on or mentions most.${result.merged ? ` ${result.merged} joined a thread on the same topic.` : ""} Ones that match no project are under All Projects.`
      : "No new CLI sessions found.";
    if (state.project) await loadSessions();
  } catch (error) {
    if (!quiet) status.textContent = `Could not import: ${error.message}`;
  }
}

async function mergeSessions(ids) {
  if (ids.length < 2) return;
  if (ids.some((id) => state.runs.get(id)?.active)) {
    $("import-status").textContent = "A session you picked is still running. Wait for it to finish, or stop it, before merging.";
    return;
  }
  if (!confirm(`Merge ${ids.length} sessions into one? Their messages are combined in time order and the others are removed.`)) return;
  try {
    const merged = await request("/api/sessions/merge", { method: "POST", body: JSON.stringify({ ids }) });
    $("import-status").textContent = merged.droppedMessages ? `Merged. The oldest ${merged.droppedMessages} messages didn't fit and were left out.` : "Merged.";
    await loadSessions();
    await selectSession(merged.id);
  } catch (error) {
    $("import-status").textContent = error.message;
  }
}

async function deleteSession(id) {
  if (state.runs.get(id)?.active) {
    $("import-status").textContent = "This session is still running. Stop it before deleting it.";
    return;
  }
  if (!confirm("Delete this local session?")) return;
  await request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.runs.delete(id);
  if (state.session?.id === id) state.session = null;
  await loadSessions();
  renderMessages();
  showLive();
  refreshRunControls();
}

async function refreshStatus() {
  const colibri = $("colibri-status");
  const cli = $("cli-status");
  try {
    const result = await request("/api/status");
    const dot = document.createElement("i");
    dot.className = `status-dot ${result.colibri.online ? "online" : "offline"}`;
    const selectedAvailable = result.colibri.models.some((model) => model === result.colibri.selectedModel) || result.colibri.models.some((model) => /qwen3\.6|qwen36/i.test(model) && /35b.*a3b/i.test(model));
    colibri.replaceChildren(dot, document.createTextNode(result.colibri.online ? `Local model · ${result.colibri.selectedModel || "ready"}` : "Local model offline"));
    const labels = { claude: "Claude Code", codex: "Codex", copilot: "Copilot" };
    const apis = Object.entries({ openai: "OpenAI API", anthropic: "Anthropic API" }).filter(([id]) => result.apis?.[id]).map(([, name]) => `${name}: key saved`);
    cli.textContent = [...Object.keys(labels).map((id) => `${labels[id]}: ${result.commands[id]?.signIn || (result.commands[id]?.available ? "installed · sign-in unknown" : "not installed")}`), ...apis].join("  ·  ");
    cli.title = "Sign-in check only reports readiness; credentials are never shown.";
    const settings = await request("/api/settings");
    state.modelPrefs = settings;
    renderInspector();
    if (!settings.setupComplete && !state.settingsPrompted) {
      state.settingsPrompted = true;
      await openSetup(true);
    }
  } catch (error) {
    colibri.textContent = `Status unavailable: ${error.message}`;
  }
}

// Reads a run's event stream: a new run (POST /api/chat/stream) or one this page reattaches to (GET /api/runs/<id>/stream).
async function streamChat(responsePromise, onEvent) {
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
      const value = JSON.parse(data.join("\n"));
      if (name === "error") {
        const error = new Error(value.error || "The request failed.");
        if (value.cancelled) error.name = "AbortError";
        throw error;
      }
      if (name === "done") result = value;
      else onEvent(name, value);
    }
    if (done) break;
  }
  if (!result) throw new Error("The response ended before it was complete.");
  return result;
}

async function submitRequest(requestData) {
  if (!state.project || viewedRun()?.active) return;
  if (!state.session) await newSession();
  if (!state.session) return;
  const attachmentNames = [...requestData.attachments.map((file) => file.name), ...requestData.contextIds.map((id) => {
    const file = state.contextFiles.find((item) => item.id === id);
    return file ? `${file.projectName}/${file.path}` : id;
  })];
  const sessionId = state.session.id;
  const payload = {
    message: requestData.message,
    projectId: requestData.projectId,
    sessionId,
    mode: requestData.mode,
    history: requestData.before.map(({ role, content }) => ({ role, content })),
    skillIds: requestData.skillIds,
    contextIds: requestData.contextIds,
    attachments: requestData.attachments,
    attachmentNames,
  };
  // The composer is free for the next task right away; this run keeps its own copy of the attachments for Retry.
  $("prompt").value = "";
  state.attachments = [];
  $("attachment-files").value = "";
  renderContextControls();
  await followRun({
    sessionId,
    projectName: state.project.name,
    title: (state.session.title || requestData.message).slice(0, 60),
    requestData,
    attachmentNames,
    response: fetch("/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  });
}

// Runs belong to the server, so after a reload the page picks up every run still going (and any that failed or
// were stopped while it was away, so their error and Retry show again).
async function reattachRuns() {
  const runs = await request("/api/runs?all").catch(() => []);
  await Promise.all(runs.filter((run) => !pendingFollowups.has(run.sessionId) && !state.runs.get(run.sessionId)?.active && !(run.failed && state.runs.has(run.sessionId))).map(async (run) => {
    const session = await request(`/api/sessions/${encodeURIComponent(run.sessionId)}`).catch(() => null);
    // Not found: the run finished (and saved) between the list and now.
    const response = session && await fetch(`/api/runs/${encodeURIComponent(run.sessionId)}/stream`).catch(() => null);
    if (!response?.ok) return;
    const asked = run.request || {};
    followRun({ // not awaited: it resolves only when the run ends
      sessionId: run.sessionId,
      projectName: state.projects.find((project) => project.id === run.projectId)?.name || run.projectId || "All Projects",
      title: (session.title !== "New session" ? session.title : asked.message || "Session").slice(0, 60),
      requestData: {
        message: asked.message || "",
        projectId: run.projectId,
        mode: asked.mode || "auto",
        skillIds: asked.skillIds || [],
        contextIds: asked.contextIds || [],
        attachments: asked.attachments || [],
        before: session.messages,
      },
      attachmentNames: asked.attachmentNames || [],
      response,
    });
  }));
}

async function followRun({ sessionId, projectName, title, requestData, attachmentNames, response }) {
  const before = requestData.before;
  const userMessage = { role: "user", content: requestData.message, attachments: attachmentNames };
  const assistantMessage = { role: "assistant", content: "", route: "", status: "Starting…", temporary: true };
  const run = {
    sessionId,
    projectId: requestData.projectId,
    projectName,
    title,
    active: true,
    status: "Starting…",
    live: "",
    messages: [...before, userMessage, assistantMessage],
    retryRequest: requestData,
    approvals: [],
  };
  state.runs.set(sessionId, run);
  const viewing = () => state.session?.id === sessionId;
  if (viewing()) state.session.messages = run.messages;
  renderMessages();
  showLive();
  refreshRunControls();
  renderRunIndicators();
  try {
    const result = await streamChat(response, (event, value) => {
      if (event === "snapshot") {
        // Everything that happened before this page attached.
        assistantMessage.content = value.content;
        assistantMessage.status = run.status = value.status;
        run.live = value.live;
        run.approvals = value.approvals || [];
        updateRunStatus(run);
        if (viewing()) { renderMessages(); showLive(); renderInspector(); renderApprovals(); }
        return;
      }
      if (event === "approval" || event === "approved") {
        run.approvals = event === "approval" ? [...run.approvals, value] : run.approvals.filter((card) => card.id !== value.id);
        if (viewing()) renderApprovals();
        renderRunIndicators();
        return;
      }
      if (event === "activity") return appendLive(run, value.text);
      if (event === "reset") assistantMessage.content = "";
      if (event === "delta") assistantMessage.content += value.text;
      if (event === "status") {
        assistantMessage.status = run.status = value.status;
        appendLive(run, `• ${value.status}\n`);
        updateRunStatus(run);
        if (viewing()) renderInspector();
      }
      if (!viewing()) return;
      if (event === "delta" || event === "reset") {
        const text = $("messages").lastElementChild?.querySelector(".message-text");
        if (text) text.textContent = assistantMessage.content;
        $("messages").scrollTop = $("messages").scrollHeight;
      } else if (event === "status") {
        const status = $("messages").lastElementChild?.querySelector(".message-status");
        if (status) status.textContent = assistantMessage.status;
      }
    });
    run.status = result.route || "Completed";
    appendLive(run, `\n✓ Done${result.route ? ` · ${result.route}` : ""}\n`);
    if (result.proposal) state.proposals[result.proposal.id] = result.proposal.status;
    // The server saved the exchange when the run finished. Keep only the live log so it's still there on return.
    run.messages = null;
    run.retryRequest = null;
    if (viewing()) {
      const saved = await request(`/api/sessions/${encodeURIComponent(sessionId)}`);
      if (viewing()) state.session = saved;
    }
  } catch (error) {
    const stopped = error.name === "AbortError";
    run.status = stopped ? "Stopped" : `Could not complete: ${error.message}`;
    appendLive(run, `\n✕ ${run.status}\n`);
    run.retryRequest = requestData;
    run.messages = [...before, userMessage, { role: "assistant", content: stopped ? "Stopped. You can retry this request." : error.message, route: "Router error" }];
    if (viewing()) state.session.messages = run.messages;
  } finally {
    run.active = false;
    run.approvals = [];
    if (viewing()) {
      renderMessages();
      refreshRunControls();
    }
    renderRunIndicators();
    await loadSessions().catch(() => {});
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const running = viewedRun();
  // Stop goes through the server: closing a stream only detaches this page from the run.
  if (running?.active && !$("prompt").value.trim()) {
    await request(`/api/runs/${encodeURIComponent(running.sessionId)}/cancel`, { method: "POST" }).catch(() => {});
    return;
  }
  const message = $("prompt").value.trim();
  if (!message || !state.project) return;
  if (running?.active) return sendFollowup(event.submitter?.id === "steer" ? "steer" : "queue");
  await submitRequest({
    message,
    projectId: state.project.id,
    mode: $("mode").value,
    skillIds: [...state.selectedSkills],
    contextIds: [...state.contextIds],
    attachments: state.attachments.map((file) => ({ ...file })),
    before: [...(state.session?.messages || [])],
  });
}

async function retryLastRequest() {
  const run = viewedRun();
  if (run?.retryRequest && !run.active) await submitRequest(run.retryRequest);
}

async function openProposal(id) {
  try {
    state.proposal = await request(`/api/proposals/${encodeURIComponent(id)}`);
    renderProposal();
    $("proposal-dialog").showModal();
  } catch (error) {
    $("proposal-status").textContent = error.message;
    $("proposal-dialog").showModal();
  }
}

function lineDiff(before, after) {
  const allA = (before || "").split("\n");
  const allB = (after || "").split("\n");
  // Strip shared head and tail first so large files with small edits stay under the LCS budget.
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
  return collapseUnchanged(out);
}

// Show 3 lines of context around each change; long unchanged runs become one "…" row.
function collapseUnchanged(rows, context = 3) {
  const near = new Uint8Array(rows.length);
  rows.forEach(([kind], index) => {
    if (kind === " ") return;
    for (let k = Math.max(0, index - context); k <= Math.min(rows.length - 1, index + context); k++) near[k] = 1;
  });
  const out = [];
  for (let index = 0; index < rows.length;) {
    if (rows[index][0] !== " " || near[index]) { out.push(rows[index++]); continue; }
    let end = index;
    while (end < rows.length && rows[end][0] === " " && !near[end]) end++;
    if (end - index > 1) out.push(["…", `${end - index} unchanged lines`]);
    else out.push(rows[index]);
    index = end;
  }
  return out;
}

function renderProposal() {
  const proposal = state.proposal;
  const files = $("proposal-files");
  files.replaceChildren();
  $("proposal-summary").textContent = proposal
    ? `${proposal.changes.length} file${proposal.changes.length === 1 ? "" : "s"} · ${proposal.provider || proposal.route} · ${proposal.status}`
    : "Could not load this change preview.";
  $("proposal-status").textContent = proposal?.status === "applied" ? "These changes have already been applied." : "Nothing is applied until you approve it.";
  $("apply-proposal").disabled = !proposal || proposal.status !== "pending" || !proposal.changes.length;
  if (!proposal) return;
  for (const change of proposal.changes) {
    const details = document.createElement("details");
    details.className = "proposal-file";
    details.open = proposal.changes.length <= 5;
    const summary = document.createElement("summary");
    summary.textContent = `${change.action.toUpperCase()} · ${change.path}`;
    details.append(summary);
    const diff = document.createElement("div");
    diff.className = "proposal-diff";
    for (const [kind, line] of lineDiff(change.before, change.after)) {
      const row = document.createElement("div");
      row.className = `diff-line ${kind === "+" ? "added" : kind === "-" ? "removed" : "unchanged"}`;
      const mark = document.createElement("span");
      mark.textContent = kind;
      const text = document.createElement("code");
      text.textContent = line || " ";
      row.append(mark, text);
      diff.append(row);
    }
    details.append(diff);
    files.append(details);
  }
}

async function applyProposal() {
  if (!state.proposal || state.proposal.status !== "pending") return;
  const button = $("apply-proposal");
  button.disabled = true;
  $("proposal-status").textContent = "Applying approved changes…";
  try {
    const result = await request(`/api/proposals/${encodeURIComponent(state.proposal.id)}/approve`, { method: "POST", body: "{}" });
    state.proposal.status = "applied";
    state.proposals[state.proposal.id] = "applied";
    state.contextProjectId = null;
    await loadContextFiles().catch(() => {});
    await loadSessions();
    $("proposal-summary").textContent = `Applied ${result.files} file${result.files === 1 ? "" : "s"}.`;
    $("proposal-status").textContent = "The approved files are now in the project folder.";
    renderMessages();
  } catch (error) {
    $("proposal-status").textContent = error.message;
    button.disabled = false;
  }
}

async function loadProjects() {
  state.projects = await request("/api/projects");
  renderProjects();
  if (!state.projects.length) return;
  const saved = localStorage.getItem("agent-router-project");
  const preferred = state.projects.find((project) => project.id === saved && !project.parent) ||
    state.projects.find((project) => project.id === "ai-router-vscode") || state.projects[0];
  await selectProject(preferred.id);
}

async function openSettings() {
  if (!state.skills.length) await loadSkills();
  const settings = await request("/api/settings");
  state.settingsRoot = settings.projectsRoot;
  state.settingsConfigured = settings.configured;
  state.pendingPreapprovedSkillIds = [...settings.preapprovedSkillIds];
  state.pendingSkillsLimit = Number.isSafeInteger(settings.skillsLimit) ? settings.skillsLimit : -1;
  $("projects-root").value = settings.projectsRoot;
  $("theme-choice").value = settings.theme || "system";
  $("skills-limit").value = state.pendingSkillsLimit;
  $("shortcut-key").value = settings.shortcut ?? "Control+Shift+Space";
  $("auto-merge-imports").checked = Boolean(settings.autoMergeImports);
  $("local-only").checked = Boolean(settings.localOnly);
  $("local-models-status").textContent = "";
  loadLocalModels();
  applyTheme($("theme-choice").value);
  selectSettingsTab("general");
  renderApprovedSkills();
  if (!$("settings-dialog").open) $("settings-dialog").showModal();
  await loadModelChoices(settings);
}

// Colibri's installed models (folders next to the loaded one). Load switches the server now; routes switch on use.
async function loadLocalModels() {
  const list = $("local-models");
  list.replaceChildren();
  try {
    const data = await request("/api/local-models");
    if (!data.installed) $("local-models-status").textContent = "Colibri isn't set up on this computer. Run START-HERE.bat in the colibri folder.";
    $("open-model-manager").disabled = !data.installed;
    for (const model of data.models) {
      const item = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = model.name;
      item.append(name);
      if (model.inUse) {
        const badge = document.createElement("span");
        badge.className = "session-source";
        badge.textContent = "loaded";
        item.append(badge);
      } else {
        const load = document.createElement("button");
        load.type = "button";
        load.className = "context-button";
        load.textContent = "Load now";
        load.setAttribute("aria-label", `Load ${model.name} in Colibri now`);
        load.addEventListener("click", async () => {
          load.disabled = true;
          $("local-models-status").textContent = `Loading ${model.name}… a big model can take minutes.`;
          try { await request("/api/local-models/use", { method: "POST", body: JSON.stringify({ name: model.name }) }); $("local-models-status").textContent = `${model.name} is loaded.`; }
          catch (error) { $("local-models-status").textContent = error.message; }
          loadLocalModels();
        });
        item.append(load);
      }
      list.append(item);
    }
    if (data.installed && !data.models.length) $("local-models-status").textContent = "No models installed yet. Add one with the Model Manager.";
  } catch (error) { $("local-models-status").textContent = error.message; }
}

function fillModelSelect(id, choices, selected, emptyLabel, preserveMissing = true) {
  const select = $(id);
  select.replaceChildren();
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = emptyLabel;
  select.append(empty);
  for (const model of choices || []) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.name || model.id;
    select.append(option);
  }
  if (selected && ![...select.options].some((option) => option.value === selected) && preserveMissing) {
    const option = document.createElement("option");
    option.value = selected;
    option.textContent = `${selected} (saved; not currently listed)`;
    select.append(option);
  }
  select.value = selected || "";
}

async function loadModelChoices(settings = {}, refresh = true, useCurrent = false) {
  const status = $("model-catalog-status");
  const saved = {
    ...Object.fromEntries(["routePlanning", "longTermPlanning", "coding", "review", "security", "ui", "art", "github", "quick"].flatMap((role) => [[`${role}Primary`, useCurrent ? $(`${role}-primary`).value : settings[`${role}Primary`] || ""], [`${role}Fallback`, useCurrent ? $(`${role}-fallback`).value : settings[`${role}Fallback`] || ""]])),
  };
  status.textContent = "Checking models reported by installed providers…";
  try {
    const response = await request(`/api/models${refresh ? "?refresh=1" : ""}`);
    state.modelCatalog = response.models;
    const catalog = state.modelCatalog || {};
    const roles = ["routePlanning", "longTermPlanning", "coding", "review", "security", "ui", "art", "github", "quick"];
    for (const role of roles) {
      const choices = catalog.all;
      fillModelSelect(`${role}-primary`, choices, saved[`${role}Primary`], "Use this task's default provider");
      fillModelSelect(`${role}-fallback`, choices, saved[`${role}Fallback`], "Automatically choose another provider/model");
    }
    const count = (catalog.all || []).length;
    status.textContent = count ? `Loaded ${count} model choices from installed providers.` : "No providers reported models. Saved choices are preserved; refresh after starting them.";
  } catch (error) {
    status.textContent = `Could not refresh model list: ${error.message}`;
  }
}

function selectSettingsTab(name) {
  document.querySelectorAll("[data-settings-tab]").forEach((button) => {
    const selected = button.dataset.settingsTab === name;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll("[data-settings-page]").forEach((page) => { page.hidden = page.dataset.settingsPage !== name; });
  if (name === "remote") loadRemote();
}

// Settings → Remote access: GET/POST /api/remote, POST /api/remote/devices (token shown once), DELETE …/devices/<id>.
// Only the page on the server PC reaches these; a remote device gets 403.
function renderRemote(info) {
  $("remote-enabled").checked = info.enabled;
  $("remote-port").value = info.port;
  $("remote-status").textContent = info.error ? info.error
    : info.listening ? `On. Devices connect to ${info.url}`
    : info.enabled ? "On, but not listening yet." : "Off. Paired devices can't connect.";
  $("remote-status").classList.toggle("error-text", Boolean(info.error));
  const list = $("remote-devices");
  if (!info.devices.length) {
    const empty = document.createElement("li");
    empty.textContent = "No devices paired yet.";
    return list.replaceChildren(empty);
  }
  list.replaceChildren(...info.devices.map((device) => {
    const item = document.createElement("li");
    const text = document.createElement("span");
    text.textContent = device.name;
    const meta = document.createElement("small");
    meta.textContent = `Added ${new Date(device.createdAt).toLocaleDateString()} · ${device.lastSeenAt ? `last seen ${new Date(device.lastSeenAt).toLocaleString()}` : "not seen since the router started"}`;
    text.append(meta);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "context-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${device.name}`);
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove ${device.name}? It is cut off immediately and needs a new token to reconnect.`)) return;
      remove.disabled = true;
      try { await request(`/api/remote/devices/${encodeURIComponent(device.id)}`, { method: "DELETE" }); await loadRemote(); }
      catch (error) { $("remote-status").textContent = error.message; remove.disabled = false; }
    });
    const replace = document.createElement("button");
    replace.type = "button"; replace.textContent = "Replace key";
    replace.addEventListener("click", async () => {
      if (!confirm("Replace this device's key? Its old key will stop working.")) return;
      try { showDeviceKey(await request(`/api/remote/devices/${encodeURIComponent(device.id)}`, { method: "POST", body: "{}" })); }
      catch (error) { $("remote-status").textContent = error.message; }
    });
    item.append(text, replace, remove);
    return item;
  }));
}

async function loadRemote() {
  try { renderRemote(await request("/api/remote")); }
  catch (error) { $("remote-status").textContent = error.message; }
}

async function applyRemote() {
  const port = Number($("remote-port").value);
  $("remote-apply").disabled = $("remote-enabled").disabled = true;
  $("remote-status").textContent = "Applying…";
  try { renderRemote(await request("/api/remote", { method: "POST", body: JSON.stringify({ enabled: $("remote-enabled").checked, port }) })); }
  catch (error) { $("remote-status").textContent = error.message; await loadRemote(); }
  finally { $("remote-apply").disabled = $("remote-enabled").disabled = false; }
}

$("remote-enabled").addEventListener("change", applyRemote);
$("remote-apply").addEventListener("click", applyRemote);
$("remote-add-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("remote-add").disabled = true;
  try {
    const added = await request("/api/remote/devices", { method: "POST", body: JSON.stringify({ name: $("remote-device-name").value, token: $("remote-custom-key").value || undefined }) });
    showDeviceKey(added);
    $("remote-custom-key").value = "";
    $("remote-device-name").value = "";
    $("remote-copy").focus();
    await loadRemote();
  } catch (error) { $("remote-status").textContent = error.message; }
  finally { $("remote-add").disabled = false; }
});
$("remote-copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("remote-token-value").textContent); $("remote-copy").textContent = "Copied"; }
  catch { $("remote-copy").textContent = "Select and copy it"; }
});
// Clearing the shown token is the only copy of it leaving the page.
$("remote-token-done").addEventListener("click", () => {
  $("remote-token").hidden = true;
  $("remote-token-value").textContent = "";
  $("remote-copy").textContent = "Copy token";
});
$("settings-dialog").addEventListener("close", () => $("remote-token-done").click());

function captureShortcut(event) {
  if (!recordingShortcut) return;
  event.preventDefault();
  event.stopPropagation();
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
  const modifiers = [event.ctrlKey && "Control", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Super"].filter(Boolean);
  const key = event.code === "Space" ? "Space" : /^Key[A-Z]$/.test(event.code) ? event.code.slice(3) : /^Digit\d$/.test(event.code) ? event.code.slice(5) : event.key.length === 1 ? event.key.toUpperCase() : ({ Escape: "Escape", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" }[event.key] || event.key);
  if (!modifiers.length || !/^(?:[A-Z0-9]|F(?:[1-9]|1[0-2])|Space|Tab|Escape|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/.test(key)) return;
  $("shortcut-key").value = [...modifiers, key].join("+");
  recordingShortcut = false;
  $("shortcut-help").textContent = "Shortcut recorded. Save settings to apply it.";
}

async function saveSettings() {
  const button = $("save-settings");
  const skillsLimit = $("skills-limit").valueAsNumber;
  if (!Number.isSafeInteger(skillsLimit) || skillsLimit < -1) {
    $("settings-status").textContent = "Enter −1, 0, or a positive whole number.";
    return;
  }
  button.disabled = true;
  $("settings-status").textContent = "Saving…";
  try {
    const roles = ["routePlanning", "longTermPlanning", "coding", "review", "security", "ui", "art", "github", "quick"];
    const modelSettings = Object.fromEntries(roles.flatMap((role) => [[`${role}Primary`, $(`${role}-primary`).value], [`${role}Fallback`, $(`${role}-fallback`).value]]));
    const settings = await request("/api/settings", { method: "POST", body: JSON.stringify({ projectsRoot: $("projects-root").value, theme: $("theme-choice").value, skillsLimit, shortcut: $("shortcut-key").value, autoMergeImports: $("auto-merge-imports").checked, localOnly: $("local-only").checked, ...modelSettings, preapprovedSkillIds: state.pendingPreapprovedSkillIds }) });
    const rootChanged = state.settingsRoot !== settings.projectsRoot;
    state.settingsRoot = settings.projectsRoot;
    state.settingsConfigured = true;
    state.theme = settings.theme;
    state.modelPrefs = settings;
    state.skillsLimit = settings.skillsLimit;
    state.pendingSkillsLimit = settings.skillsLimit;
    state.preapprovedSkillIds = settings.preapprovedSkillIds;
    state.selectedSkills = state.selectedSkills.filter((id) => !state.preapprovedSkillIds.includes(id)).slice(0, taskSkillSlots());
    localStorage.setItem("agent-router-skills", JSON.stringify(state.selectedSkills));
    applyTheme(state.theme);
    renderSkills();
    renderInspector();
    $("settings-dialog").close();
    if (rootChanged) {
      localStorage.removeItem("agent-router-project");
      state.project = null;
      state.session = null;
      await loadProjects();
    }
    await refreshStatus();
  } catch (error) { $("settings-status").textContent = error.message; }
  finally { button.disabled = false; }
}

$("prompt-form").addEventListener("submit", sendMessage);
$("prompt").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    $("prompt-form").requestSubmit();
  }
});
$("new-session").addEventListener("click", newSession);
$("import-sessions").addEventListener("click", () => importSessions());
$("reindex-sessions").addEventListener("click", () => {
  if (confirm("Re-file every imported session you haven't continued or merged by hand: move each to the project it fits best, then merge ones on the same topic within each project?")) importSessions({ reindex: true });
});
$("open-model-manager").addEventListener("click", async () => {
  try { await request("/api/local-models/manager", { method: "POST" }); $("local-models-status").textContent = "The Model Manager opened on this computer. Refresh the model list when you're done."; }
  catch (error) { $("local-models-status").textContent = error.message; }
});
$("merge-sessions").addEventListener("click", () => {
  const ids = state.session && state.sessions.some((item) => item.id === state.session.id) ? [state.session.id, ...state.sessions.filter((item) => item.id !== state.session.id).map((item) => item.id)] : state.sessions.map((item) => item.id);
  if (ids.length < 2) { $("import-status").textContent = "There's only one session here to merge."; return; }
  mergeSessions(ids);
});
$("teleport-session").addEventListener("click", async () => {
  if (state.project?.scope !== "single") { $("import-status").textContent = "Choose a project folder first."; return; }
  try {
    await request("/api/sessions/teleport", { method: "POST", body: JSON.stringify({ projectId: state.project.id }) });
    $("import-status").textContent = "Pick the cloud session in the window that opened. When it has loaded, close the window and press ⤓ to import it.";
  } catch (error) { $("import-status").textContent = error.message; }
});
$("session-search").addEventListener("input", refreshSessionSearch);
$("pending-only").addEventListener("change", () => loadSessions().catch(() => {}));
for (const id of ["open-settings", "open-settings-top"]) $(id).addEventListener("click", () => openSettings().catch((error) => { $("settings-status").textContent = error.message; if (!$("settings-dialog").open) $("settings-dialog").showModal(); }));
$("route-button").addEventListener("click", () => setRouteMenu($("route-menu").hidden));
$("thread-access").addEventListener("change", async (event) => {
  const accessLimit = event.target.value;
  try {
    if (!state.session) await newSession();
    if (!state.session) { event.target.value = ""; return; }
    state.session = await request(`/api/sessions/${encodeURIComponent(state.session.id)}/access`, { method: "POST", body: JSON.stringify({ accessLimit }) });
  } catch (error) {
    event.target.value = state.session?.accessLimit || "";
    alert(error.message);
  }
});
// Same modes as Claude desktop's picker; the server passes the mode to Claude Code as --permission-mode.
$("permission-mode").addEventListener("change", async (event) => {
  const permissionMode = event.target.value;
  try {
    if (!state.session) await newSession();
    if (!state.session) { event.target.value = state.claudeDefaultMode || "default"; return; }
    state.session = await request(`/api/sessions/${encodeURIComponent(state.session.id)}/permission-mode`, { method: "POST", body: JSON.stringify({ permissionMode }) });
  } catch (error) {
    event.target.value = state.session?.permissionMode || state.claudeDefaultMode || "default";
    alert(error.message);
  }
});
$("route-menu").addEventListener("keydown", (event) => {
  if (event.key === "Escape") { setRouteMenu(false); $("route-button").focus(); return; }
  if (event.key === "Tab") { setRouteMenu(false); return; }
  const items = [...$("route-menu").querySelectorAll(".route-item:not(:disabled)")];
  const index = { Home: 0, End: items.length - 1 }[event.key] ?? (items.indexOf(document.activeElement) + ({ ArrowDown: 1, ArrowUp: -1 }[event.key] ?? NaN) + items.length) % items.length;
  if (Number.isNaN(index)) return;
  event.preventDefault();
  items[index]?.focus();
});
$("route-button").addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  setRouteMenu(true);
});
$("new-project").addEventListener("click", () => {
  $("new-project-name").value = "";
  $("new-project-status").textContent = "";
  $("new-project-where").textContent = `Creates an empty folder in ${state.settingsRoot || "your Projects folder"}.`;
  $("new-project-dialog").showModal();
});
$("close-new-project").addEventListener("click", () => $("new-project-dialog").close());
$("new-project-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("new-project-status").textContent = "Creating…";
  try {
    const project = await request("/api/projects", { method: "POST", body: JSON.stringify({ name: $("new-project-name").value }) });
    localStorage.setItem("agent-router-project", project.id);
    $("new-project-dialog").close();
    await loadProjects();
  } catch (error) { $("new-project-status").textContent = error.message; }
});
$("close-settings").addEventListener("click", () => $("settings-dialog").close());
$("save-settings").addEventListener("click", saveSettings);
$("refresh-models").addEventListener("click", () => { loadModelChoices(state.modelPrefs, true, true); loadLocalModels(); });
document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => selectSettingsTab(button.dataset.settingsTab)));
document.querySelector(".settings-tabs").addEventListener("keydown", (event) => {
  const tabs = [...document.querySelectorAll("[data-settings-tab]")];
  const current = tabs.indexOf(document.activeElement);
  const index = { Home: 0, End: tabs.length - 1 }[event.key] ?? (current + ({ ArrowDown: 1, ArrowUp: -1 }[event.key] ?? NaN) + tabs.length) % tabs.length;
  if (current < 0 || Number.isNaN(index)) return;
  event.preventDefault();
  selectSettingsTab(tabs[index].dataset.settingsTab);
  tabs[index].focus();
});
// Theme changes preview live; closing Settings without saving puts the saved theme back.
$("settings-dialog").addEventListener("close", () => applyTheme(state.theme));
$("record-shortcut").addEventListener("click", () => { recordingShortcut = true; $("shortcut-help").textContent = "Press a shortcut combination now. Escape cancels."; });
$("clear-shortcut").addEventListener("click", () => { recordingShortcut = false; $("shortcut-key").value = ""; $("shortcut-help").textContent = "Shortcut is off. Save settings to apply."; });
document.addEventListener("keydown", (event) => {
  if (recordingShortcut && event.key === "Escape") { event.preventDefault(); recordingShortcut = false; $("shortcut-help").textContent = "Shortcut change cancelled."; return; }
  captureShortcut(event);
});
const layout = (() => { try { return JSON.parse(localStorage.getItem("agent-router-layout")) || {}; } catch { return {}; } })();
const panels = { left: { button: "toggle-sidebar", bodyClass: "sidebar-hidden", label: "projects" }, right: { button: "toggle-inspector", bodyClass: "inspector-hidden", label: "details" } };
function applyLayout() {
  for (const [side, panel] of Object.entries(panels)) {
    if (layout[`${side}Width`]) document.documentElement.style.setProperty(`--${side}-w`, `${layout[`${side}Width`]}px`);
    else document.documentElement.style.removeProperty(`--${side}-w`);
    const hidden = Boolean(layout[`${side}Hidden`]);
    document.body.classList.toggle(panel.bodyClass, hidden);
    $(panel.button).textContent = `${hidden ? "Show" : "Hide"} ${panel.label}`;
    $(panel.button).setAttribute("aria-expanded", String(!hidden));
  }
}
function saveLayout() {
  try { localStorage.setItem("agent-router-layout", JSON.stringify(layout)); } catch {}
  applyLayout();
}
function resizePanel(side, width) {
  layout[`${side}Width`] = Math.round(Math.min(520, Math.max(180, width)));
  saveLayout();
}
for (const side of Object.keys(panels)) {
  $(panels[side].button).addEventListener("click", () => { layout[`${side}Hidden`] = !layout[`${side}Hidden`]; saveLayout(); });
}
for (const handle of document.querySelectorAll(".resizer")) {
  const side = handle.dataset.side;
  const current = () => layout[`${side}Width`] || (side === "left" ? 250 : 290);
  handle.addEventListener("pointerdown", (event) => {
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    const move = (moveEvent) => resizePanel(side, side === "left" ? moveEvent.clientX : window.innerWidth - moveEvent.clientX);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", () => { handle.removeEventListener("pointermove", move); handle.classList.remove("dragging"); }, { once: true });
  });
  handle.addEventListener("keydown", (event) => {
    const step = { ArrowLeft: -16, ArrowRight: 16 }[event.key];
    if (!step) return;
    event.preventDefault();
    resizePanel(side, current() + (side === "left" ? step : -step));
  });
  handle.addEventListener("dblclick", () => { delete layout[`${side}Width`]; saveLayout(); });
}
applyLayout();
$("mode").addEventListener("change", renderInspector);
$("approved-skill-search").addEventListener("input", renderApprovedSkills);
$("theme-choice").addEventListener("change", () => { const saved = state.theme; applyTheme($("theme-choice").value); state.theme = saved; });
$("skills-limit").addEventListener("input", () => {
  const limit = $("skills-limit").valueAsNumber;
  if (!Number.isSafeInteger(limit) || limit < -1) {
    $("settings-status").textContent = "Enter −1, 0, or a positive whole number.";
    return;
  }
  state.pendingSkillsLimit = limit;
  $("settings-status").textContent = "";
  renderApprovedSkills();
});
$("add-skill-toggle").addEventListener("click", () => {
  $("skill-form").hidden = !$("skill-form").hidden;
  $("skill-form-status").textContent = "";
  if (!$("skill-form").hidden) $("skill-name").focus();
});
$("cancel-skill").addEventListener("click", () => { $("skill-form").hidden = true; });
$("save-skill").addEventListener("click", saveSkill);
$("skill-scan-form").addEventListener("submit", scanSkill);
$("install-skill").addEventListener("click", installScannedSkill);
$("reject-skill").addEventListener("click", () => { $("skill-url").value = ""; resetSkillScan("Not installed."); $("skill-url").focus(); });
$("refresh-projects").addEventListener("click", () => loadProjects().catch((error) => { $("projects").textContent = error.message; }));
for (const button of document.querySelectorAll(".suggestions button")) {
  button.addEventListener("click", () => { $("prompt").value = button.dataset.prompt || ""; $("prompt").focus(); });
}

$("plus-button").addEventListener("click", () => setPlusMenu($("plus-menu").hidden));
document.addEventListener("click", (event) => {
  if (!event.target.closest(".plus-wrap")) setPlusMenu(false);
  if (!event.target.closest(".route-picker") && !$("route-menu").hidden) setRouteMenu(false);
});
$("plus-menu").addEventListener("keydown", (event) => { if (event.key === "Escape") { setPlusMenu(false); $("plus-button").focus(); } });
$("plus-menu").querySelector("label[for='attachment-files']").addEventListener("click", () => setPlusMenu(false));
$("pick-folder").addEventListener("click", async () => {
  setPlusMenu(false);
  try { updateLinked((await request("/api/projects/linked/pick", { method: "POST", body: JSON.stringify({ projectId: state.project.id }) })).linked); }
  catch (error) { state.lastRunStatus = error.message; $("context-count").textContent = error.message; renderInspector(); }
});
$("choose-context").addEventListener("click", async () => {
  setPlusMenu(false);
  $("context-dialog-status").textContent = "Loading project files…";
  $("context-search").value = "";
  $("context-dialog").showModal();
  try { await loadContextFiles(); renderContextPicker(); }
  catch (error) { $("context-dialog-status").textContent = error.message; }
});
$("context-search").addEventListener("input", renderContextPicker);
$("attachment-files").addEventListener("change", async (event) => {
  try { await addAttachments([...event.target.files]); }
  catch (error) { $("context-count").textContent = error.message; }
  finally { event.target.value = ""; }
});
$("close-proposal").addEventListener("click", () => $("proposal-dialog").close());
$("apply-proposal").addEventListener("click", applyProposal);

loadProjects().then(() => reattachRuns()).then(() => importSessions({ quiet: true })).catch((error) => { $("projects").textContent = error.message; });
loadSkills().catch((error) => { $("skills-list").textContent = error.message; });
// ---- First-run setup ----
const setup = { step: 0, data: null, skipped: new Set(), firstRun: false };
const SETUP_STEPS = [
  { title: "Welcome to Local Agent Router", subtitle: "Let's get you set up. This takes a few minutes." },
  { title: "Where are your projects?", subtitle: "Each folder inside this one shows up as a project." },
  { title: "Connect your AI tools", subtitle: "Install and sign in to the tools you have subscriptions for. Skip any you don't use." },
  { title: "Local model (optional)", subtitle: "Run a model on this PC for private quick questions. Skip if you don't have one." },
  { title: "API keys (optional)", subtitle: "Use an OpenAI or Anthropic API key instead of, or alongside, the tools above." },
  { title: "Review and finish", subtitle: "Here's which tool will handle each kind of work. You can change any of these later in Settings." },
];
const ROLE_LABELS = { routePlanning: "Route Planning", longTermPlanning: "Long Term Project planning", coding: "Coding", review: "Reviewing", security: "Security audit", ui: "UI Designer", art: "Art Asset generation", github: "GitHub requests", quick: "Quick questions" };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  node.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  return node;
}

async function openSetup(firstRun = false) {
  setup.firstRun = firstRun;
  setup.step = 0;
  $("setup-dialog").showModal();
  $("setup-status").textContent = "Checking this PC…";
  try { setup.data = await request("/api/setup"); $("setup-status").textContent = ""; }
  catch (error) { $("setup-status").textContent = error.message; }
  renderSetup();
}

async function refreshSetup(message = "Checking again…") {
  $("setup-status").textContent = message;
  try { setup.data = await request("/api/setup"); $("setup-status").textContent = ""; }
  catch (error) { $("setup-status").textContent = error.message; }
  renderSetup();
}

async function setupPost(url, body) {
  return request(url, { method: "POST", body: JSON.stringify(body) });
}

function toolStatus(tool) {
  if (!tool.installed) return ["Not installed", "missing"];
  if (tool.signIn === "signed in") return ["Ready", "ready"];
  if (tool.signIn === "sign-in needed") return ["Sign-in needed", "warn"];
  return ["Installed", "ready"];
}

async function openSetupTerminal(tool, action) {
  try {
    const result = await setupPost("/api/setup/terminal", { tool, action });
    $("setup-status").textContent = `A setup window opened. ${result.hint || "Follow it, then press Check again."}`;
  } catch (error) { $("setup-status").textContent = error.message; }
}

function setupToolCard(tool, isNode = false) {
  const [label, tone] = isNode ? (tool.installed ? ["Installed", "ready"] : ["Not installed", "missing"]) : toolStatus(tool);
  const skipped = setup.skipped.has(tool.id || "node");
  const id = tool.id || "node";
  return el("div", { class: `setup-card${skipped ? " skipped" : ""}` },
    el("div", { class: "setup-card-head" }, el("strong", {}, tool.name), el("span", { class: `setup-pill ${skipped ? "" : tone}` }, skipped ? "Skipped" : label)),
    el("p", {}, tool.why),
    skipped ? null : el("div", { class: "setup-card-actions" },
      !tool.installed ? el("button", { type: "button", class: "send-button", onclick: () => openSetupTerminal(id, "install") }, "Install") : null,
      !isNode && tool.installed && tool.signIn !== "signed in" ? el("button", { type: "button", class: "send-button", onclick: () => openSetupTerminal(id, "login") }, "Sign in") : null,
      el("a", { href: tool.guide, target: "_blank", rel: "noopener", class: "context-button" }, "Setup guide"),
      !tool.installed && tool.needsNode && !setup.data.node.installed ? el("span", { class: "setup-note" }, "Install Node.js first.") : null),
    el("button", { type: "button", class: "setup-skip", onclick: () => { skipped ? setup.skipped.delete(id) : setup.skipped.add(id); renderSetup(); } },
      skipped ? "Undo skip" : tool.installed ? "Skip, I'll leave this as is" : "Skip, I don't use this"),
    tool.install && !tool.installed && !skipped ? el("code", { class: "setup-command" }, tool.install) : null);
}

function renderSetup() {
  const step = SETUP_STEPS[setup.step];
  const data = setup.data;
  $("setup-title").textContent = step.title;
  $("setup-subtitle").textContent = step.subtitle;
  $("setup-step-count").textContent = `Step ${setup.step + 1} of ${SETUP_STEPS.length}`;
  $("setup-back").hidden = setup.step === 0;
  $("setup-next").textContent = setup.step === SETUP_STEPS.length - 1 ? "Finish setup" : setup.step === 0 ? "Get started" : "Next";
  const container = $("setup-body");
  container.replaceChildren();
  const body = { append: (...nodes) => container.append(...nodes.filter(Boolean)) };
  if (!data) return;
  if (setup.step === 0) {
    body.append(
      el("p", {}, "Local Agent Router sends each request to the AI tool that's best at it: planning, coding, reviews, security audits, design, GitHub and quick questions."),
      el("p", {}, "You'll choose your projects folder, then connect whichever AI tools you already pay for. Every step can be skipped and changed later in Settings."),
      el("ul", { class: "setup-list" },
        el("li", {}, "Command-line tools: Claude Code, Codex, GitHub Copilot"),
        el("li", {}, "A local model app such as Ollama or LM Studio (optional)"),
        el("li", {}, "OpenAI or Anthropic API keys (optional)")));
  } else if (setup.step === 1) {
    body.append(
      el("label", { class: "settings-field" }, "Projects folder", el("input", { id: "setup-root", type: "text", value: setup.root ?? data.projectsRoot, oninput: (event) => { setup.root = event.target.value; } })),
      el("label", { class: "setup-check" }, el("input", { id: "setup-create", type: "checkbox", checked: true }), " Create this folder if it doesn't exist"),
      el("p", { class: "settings-help" }, "AI tools only see the project you pick, and coding changes wait for your review before they touch your files."));
  } else if (setup.step === 2) {
    const needNode = !data.node.installed && data.tools.some((tool) => tool.needsNode && !tool.installed);
    body.append(el("div", { class: "setup-toolbar" }, el("button", { type: "button", class: "context-button", onclick: () => refreshSetup() }, "Check again"), el("span", { class: "settings-help" }, "Install opens a PowerShell window that runs the command shown. Sign in opens the tool so you can log in.")));
    if (needNode) body.append(setupToolCard(data.node, true));
    for (const tool of data.tools) body.append(setupToolCard(tool));
  } else if (setup.step === 3) {
    const local = data.local;
    body.append(
      el("div", { class: "setup-toolbar" }, ...local.presets.map((preset) => el("button", { type: "button", class: "context-button", onclick: () => { $("setup-local-url").value = preset.url; } }, preset.name))),
      el("label", { class: "settings-field" }, "Local model address", el("input", { id: "setup-local-url", type: "text", value: local.baseUrl })),
      el("div", { class: "setup-toolbar" },
        el("button", { type: "button", class: "send-button", onclick: async () => {
          $("setup-status").textContent = "Connecting…";
          try { setup.data = await setupPost("/api/setup/local", { baseUrl: $("setup-local-url").value, model: "" }); $("setup-status").textContent = setup.data.local.online ? "Connected." : "Nothing is answering at that address yet. Start the app and try again."; renderSetup(); }
          catch (error) { $("setup-status").textContent = error.message; }
        } }, "Connect"),
        el("span", { class: `setup-pill ${local.online ? "ready" : "missing"}` }, local.online ? `Connected · ${local.models.length} model${local.models.length === 1 ? "" : "s"}` : "Not connected")),
      local.online && local.models.length ? el("label", { class: "settings-field" }, "Model to use", el("select", { id: "setup-local-model", onchange: async (event) => {
        try { setup.data = await setupPost("/api/setup/local", { baseUrl: local.baseUrl, model: event.target.value }); $("setup-status").textContent = "Saved."; } catch (error) { $("setup-status").textContent = error.message; }
      } }, el("option", { value: "" }, "First available model"), ...local.models.map((model) => el("option", { value: model, selected: model === local.model }, model)))) : null,
      el("p", { class: "settings-help" }, "Don't have one? Ollama is the easiest: ", el("a", { href: "https://ollama.com/download", target: "_blank", rel: "noopener" }, "download Ollama"), ", run ", el("code", {}, "ollama pull llama3.2"), ", then press Ollama and Connect."));
  } else if (setup.step === 4) {
    if (!data.canStoreKeys) body.append(el("p", { class: "settings-help" }, "API keys can only be saved in the installed desktop app."));
    for (const [id, name, hint] of [["openai", "OpenAI API key", "https://platform.openai.com/api-keys"], ["anthropic", "Anthropic API key", "https://console.anthropic.com/settings/keys"]]) {
      body.append(el("label", { class: "settings-field" }, `${name} ${data.apiKeys[id] ? "(saved)" : ""}`, el("input", { id: `setup-key-${id}`, type: "password", autocomplete: "off", placeholder: data.apiKeys[id] ? "Saved. Paste a new key to replace it." : "Paste your key" })),
        el("p", { class: "settings-help" }, el("a", { href: hint, target: "_blank", rel: "noopener" }, `Get an ${name}`)));
    }
    body.append(el("p", { class: "settings-help" }, "Keys are encrypted by Windows and stored only on this PC. API use is billed by the provider."));
  } else {
    const names = data.providerNames;
    const rows = Object.entries(ROLE_LABELS).map(([role, label]) => {
      const choice = data.assignment[role] || "";
      const provider = choice.split("::")[0];
      return el("tr", {}, el("td", {}, label), el("td", { class: provider ? "" : "setup-missing" }, provider ? names[provider] : "No tool available"));
    });
    const none = !Object.values(data.assignment).some(Boolean);
    body.append(
      none ? el("p", { class: "setup-warning" }, "No AI tool is set up yet. Go back and install at least one, or finish now and run setup again later from Settings.") : null,
      el("table", { class: "setup-table" }, el("tbody", {}, rows)),
      el("p", { class: "settings-help" }, "If a tool stops working or isn't installed, the app automatically uses the next one that is."));
  }
}

async function setupNext() {
  const button = $("setup-next");
  button.disabled = true;
  try {
    if (setup.step === 1) setup.createFolder = $("setup-create").checked;
    if (setup.step === 4) {
      const keys = Object.fromEntries(["openai", "anthropic"].map((id) => [id, $(`setup-key-${id}`).value.trim()]).filter(([, value]) => value));
      if (Object.keys(keys).length) setup.data = await setupPost("/api/setup/keys", keys);
      else setup.data = await request("/api/setup");
    }
    if (setup.step === SETUP_STEPS.length - 1) {
      await setupPost("/api/setup/finish", { projectsRoot: setup.root ?? setup.data.projectsRoot, createFolder: setup.createFolder !== false });
      $("setup-dialog").close();
      state.settingsConfigured = true;
      await loadProjects();
      await refreshStatus();
      return;
    }
    setup.step += 1;
    $("setup-status").textContent = "";
    renderSetup();
  } catch (error) {
    $("setup-status").textContent = error.message;
  } finally { button.disabled = false; }
}

$("setup-next").addEventListener("click", setupNext);
$("setup-back").addEventListener("click", () => { setup.step = Math.max(0, setup.step - 1); $("setup-status").textContent = ""; renderSetup(); });
$("setup-dialog").addEventListener("cancel", (event) => { if (setup.firstRun) event.preventDefault(); });
$("run-setup").addEventListener("click", () => { $("settings-dialog").close(); openSetup(false); });

refreshStatus();
refreshWindowsAccent();
// The installer role ("server" or "client") follows the version so the two installs can be told apart.
// A Client window loads the server's page; the server echoes the Client's own label as `client`, so show that one.
// Remote devices can't manage pairing (the server answers 403), so the Remote access tab is hidden for them.
request("/api/version").then(({ version, role, client, remote }) => {
  const label = client || `${version}${role ? ` ${role}` : ""}`;
  $("app-version").textContent = `v${label}`;
  $("app-version").title = client ? `This Client is ${client}; the server is ${version} ${role || ""}`.trim() : "";
  if (remote) document.querySelector('[data-settings-tab="remote"]')?.remove();
}).catch(() => {});
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.theme === "system") applyTheme("system"); });
setInterval(refreshStatus, 30_000);
setInterval(refreshWindowsAccent, 15_000);

async function sendFollowup(delivery) {
  const sessionId = state.session.id;
  const originalRun = viewedRun();
  pendingFollowups.set(sessionId, (pendingFollowups.get(sessionId) || 0) + 1);
  const requestData = { message: $("prompt").value.trim(), projectId: state.project.id, mode: $("mode").value, skillIds: [...state.selectedSkills], contextIds: [...state.contextIds], attachments: state.attachments.map((f) => ({ ...f })) };
  $("prompt").value = ""; state.attachments = []; renderContextControls();
  $("context-count").textContent = delivery === "steer" ? "Restarting with your correction?" : "Message queued after this response.";
  try {
    const response = await fetch("/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...requestData, sessionId, delivery, attachmentNames: requestData.attachments.map((f) => f.name) }) });
    while (originalRun?.active) await new Promise((resolve) => setTimeout(resolve, 100));
    requestData.before = (await request(`/api/sessions/${encodeURIComponent(sessionId)}`)).messages;
    await followRun({ sessionId, projectName: state.projects.find((p) => p.id === requestData.projectId)?.name || "Project", title: requestData.message.slice(0, 60), requestData, attachmentNames: requestData.attachments.map((f) => f.name), response });
  } catch (error) { $("context-count").textContent = error.message; }
  finally { const left = pendingFollowups.get(sessionId) - 1; if (left) pendingFollowups.set(sessionId, left); else pendingFollowups.delete(sessionId); }
}
let syncingRuns = false;
setInterval(async () => {
  if (syncingRuns) return; syncingRuns = true;
  try { await reattachRuns(); await loadSessions(); } catch {} finally { syncingRuns = false; }
}, 2000);
function showDeviceKey(added) {
  $("remote-token-url").textContent = added.url || "Turn remote access on to get the address.";
  $("remote-token-value").textContent = added.token; $("remote-token").hidden = false;
}
$("remote-copy-connection").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(JSON.stringify({ server: $("remote-token-url").textContent, token: $("remote-token-value").textContent })); $("remote-copy-connection").textContent = "Copied"; }
  catch { $("remote-status").textContent = "Clipboard unavailable. Copy the address and key separately."; }
});
