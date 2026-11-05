const $ = (id) => document.getElementById(id);
let recordingShortcut = false;
const state = { projects: [], project: null, sessions: [], session: null, busy: false, abortController: null, skills: [], categories: [], selectedSkills: loadSelectedSkills(), preapprovedSkillIds: [], pendingPreapprovedSkillIds: [], skillsLimit: -1, pendingSkillsLimit: -1, theme: "system", settingsRoot: "", settingsConfigured: false, settingsPrompted: false, attachments: [], contextIds: [], contextFiles: [], contextProjectId: null, retryRequest: null, proposal: null, proposals: {}, lastRunStatus: "Ready when you are.", modelPrefs: {}, modelCatalog: null };

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
    code: "The Coding provider works in a private copy of the selected project. Changes wait for your review before they touch the real folder.",
    review: "The Reviewing provider reads the selected project and reports findings. It cannot edit files.",
    security: "The Security audit provider reads the selected project and reports risks. It cannot edit files or run commands.",
    ui: "The UI Designer provider works in a private copy of the selected project. Changes wait for your review.",
    art: "The Art Asset provider creates assets in a private copy of the selected project. Changes wait for your review.",
    github: "The GitHub provider can read the project and run only git status, log, diff, branch, remote, push (never force) and gh issue/pr commands. Codex, local models and API-key models can only advise here.",
    quick: "The Quick questions provider answers without project access. Images are sent when that provider is a local or API-key model."
  };
  $("run-state").textContent = state.lastRunStatus;
  $("permission-summary").textContent = `${summaries[mode]}\n\nProject access: ${scope}.`;
  const modelList = $("model-summary");
  modelList.replaceChildren();
  for (const [label, key] of [["Route Planning", "routePlanningPrimary"], ["Long Term Project planning", "longTermPlanningPrimary"], ["Coding", "codingPrimary"], ["Reviewing", "reviewPrimary"], ["Security audit", "securityPrimary"], ["UI Designer", "uiPrimary"], ["Art Asset generation", "artPrimary"], ["GitHub requests", "githubPrimary"], ["Quick questions", "quickPrimary"]]) {
    const item = document.createElement("li");
    const choice = state.modelPrefs[key] || "Provider default";
    const [provider, model] = choice.split("::");
    const providerNames = { colibri: "Local model", claude: "Claude Code", codex: "Codex", copilot: "Copilot", openai: "OpenAI API", anthropic: "Anthropic API" };
    const readable = state.modelCatalog?.all?.find((entry) => entry.id === choice)?.name || (providerNames[provider] ? `${providerNames[provider]}${model ? ` — ${model}` : ""}` : choice);
    item.textContent = `${label}: ${readable}`;
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

function setBusy(busy) {
  state.busy = busy;
  $("send").disabled = busy ? false : !state.project;
  $("send").querySelector("span").textContent = busy ? "Stop" : "Send";
  $("send").title = busy ? "Stop this response" : "Send message";
  $("new-session").disabled = busy || !state.project;
  $("choose-context").disabled = busy || !state.project;
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
  for (const project of state.projects) {
    const button = document.createElement("button");
    button.className = `project-button${state.project?.id === project.id ? " selected" : ""}`;
    button.type = "button";
    const symbol = document.createElement("span");
    symbol.className = "project-symbol";
    symbol.textContent = "▰";
    const name = document.createElement("span");
    name.textContent = project.name;
    button.append(symbol, name);
    button.addEventListener("click", () => selectProject(project.id));
    list.append(button);
  }
  renderInspector();
}

function renderSessions() {
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
    row.append(button, merge, remove);
    list.append(row);
  }
}

function renderMessages() {
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
  if (role === "assistant" && route === "Router error" && state.retryRequest) {
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
  state.sessions = await request(`/api/sessions?${query}`);
  renderSessions();
}

let sessionSearchTimer;
function refreshSessionSearch() {
  clearTimeout(sessionSearchTimer);
  sessionSearchTimer = setTimeout(() => loadSessions().catch(() => {}), 220);
}

async function selectProject(id) {
  if (state.busy) return;
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
  renderProjects();
  renderMessages();
  setBusy(false);
  await loadSessions();
  if (state.project) loadContextFiles().catch((error) => { $("context-count").textContent = error.message; });
}

async function selectSession(id) {
  if (state.busy) return;
  const session = await request(`/api/sessions/${encodeURIComponent(id)}`);
  state.session = session;
  renderSessions();
  renderMessages();
}

async function newSession() {
  if (!state.project || state.busy) return;
  state.session = await request("/api/sessions", { method: "POST", body: JSON.stringify({ projectId: state.project.id }) });
  await loadSessions();
  renderMessages();
  $("prompt").focus();
}

async function importSessions({ quiet = false } = {}) {
  const status = $("import-status");
  if (!quiet) status.textContent = "Looking for Claude Code and Codex sessions…";
  try {
    const result = await request("/api/sessions/import", { method: "POST", body: "{}" });
    if (!quiet || result.added) status.textContent = result.added || result.updated
      ? `Imported ${result.added} new and refreshed ${result.updated} CLI sessions. Ones outside your project folders are under All Projects.`
      : "No new CLI sessions found.";
    if (state.project) await loadSessions();
  } catch (error) {
    if (!quiet) status.textContent = `Could not import: ${error.message}`;
  }
}

async function mergeSessions(ids) {
  if (state.busy || ids.length < 2) return;
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
  if (!confirm("Delete this local session?")) return;
  await request(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (state.session?.id === id) state.session = null;
  await loadSessions();
  renderMessages();
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

async function streamChat(payload, signal, onEvent) {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
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
      if (name === "error") throw new Error(value.error || "The request failed.");
      if (name === "done") result = value;
      else onEvent(name, value);
    }
    if (done) break;
  }
  if (!result) throw new Error("The response ended before it was complete.");
  return result;
}

async function submitRequest(requestData) {
  if (state.busy || !state.project) return;
  if (!state.session) await newSession();
  if (!state.session) return;
  const before = requestData.before;
  const attachmentNames = [...requestData.attachments.map((file) => file.name), ...requestData.contextIds.map((id) => {
    const file = state.contextFiles.find((item) => item.id === id);
    return file ? `${file.projectName}/${file.path}` : id;
  })];
  const userMessage = { role: "user", content: requestData.message, attachments: attachmentNames };
  const assistantMessage = { role: "assistant", content: "", route: "", status: "Starting…", temporary: true };
  state.session.messages = [...before, userMessage, assistantMessage];
  renderMessages();
  $("prompt").value = "";
  state.lastRunStatus = "Starting…";
  renderInspector();
  state.retryRequest = requestData;
  state.abortController = new AbortController();
  setBusy(true);
  try {
    const payload = {
      message: requestData.message,
      projectId: requestData.projectId,
      mode: requestData.mode,
      history: before.map(({ role, content }) => ({ role, content })),
      skillIds: requestData.skillIds,
      contextIds: requestData.contextIds,
      attachments: requestData.attachments,
    };
    const result = await streamChat(payload, state.abortController.signal, (event, value) => {
      if (event === "reset") assistantMessage.content = "";
      if (event === "delta") assistantMessage.content += value.text;
      if (event === "status") { assistantMessage.status = value.status; state.lastRunStatus = value.status; renderInspector(); }
      if (event === "delta" || event === "reset") {
        const text = $("messages").lastElementChild?.querySelector(".message-text");
        if (text) text.textContent = assistantMessage.content;
        $("messages").scrollTop = $("messages").scrollHeight;
      } else if (event === "status") {
        const status = $("messages").lastElementChild?.querySelector(".message-status");
        if (status) status.textContent = assistantMessage.status;
      }
    });
    state.lastRunStatus = result.route || "Completed";
    if (result.proposal) state.proposals[result.proposal.id] = result.proposal.status;
    await request(`/api/sessions/${encodeURIComponent(state.session.id)}/messages`, {
      method: "POST",
      body: JSON.stringify({ user: requestData.message, attachments: attachmentNames, materials: requestData.attachments, assistant: result.content, route: result.route, proposalId: result.proposal?.id }),
    });
    state.session = await request(`/api/sessions/${encodeURIComponent(state.session.id)}`);
    state.retryRequest = null;
    state.attachments = [];
    $("attachment-files").value = "";
    renderContextControls();
  } catch (error) {
    const stopped = error.name === "AbortError";
    state.lastRunStatus = stopped ? "Stopped" : `Could not complete: ${error.message}`;
    state.retryRequest = requestData;
    state.session.messages = [...before, userMessage, { role: "assistant", content: stopped ? "Stopped. You can retry this request." : error.message, route: "Router error" }];
  } finally {
    state.abortController = null;
    setBusy(false);
    renderMessages();
    await loadSessions();
  }
  renderInspector();
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.busy) { state.abortController?.abort(); return; }
  const message = $("prompt").value.trim();
  if (!message || !state.project) return;
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
  if (state.retryRequest && !state.busy) await submitRequest(state.retryRequest);
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
  const a = (before || "").split("\n");
  const b = (after || "").split("\n");
  if (a.length * b.length > 180_000) return [...a.map((line) => ["-", line]), ...b.map((line) => ["+", line])];
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
  const out = [];
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && a[i] === b[j]) out.push([" ", a[i++]]), j++;
    else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) out.push(["-", a[i++]]);
    else out.push(["+", b[j++]]);
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
  const preferred = state.projects.find((project) => project.id === saved) ||
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
  applyTheme($("theme-choice").value);
  selectSettingsTab("general");
  renderApprovedSkills();
  if (!$("settings-dialog").open) $("settings-dialog").showModal();
  await loadModelChoices(settings);
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
  });
  document.querySelectorAll("[data-settings-page]").forEach((page) => { page.hidden = page.dataset.settingsPage !== name; });
}

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
    const settings = await request("/api/settings", { method: "POST", body: JSON.stringify({ projectsRoot: $("projects-root").value, theme: $("theme-choice").value, skillsLimit, shortcut: $("shortcut-key").value, ...modelSettings, preapprovedSkillIds: state.pendingPreapprovedSkillIds }) });
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
$("open-settings").addEventListener("click", () => openSettings().catch((error) => { $("settings-status").textContent = error.message; $("settings-dialog").showModal(); }));
$("close-settings").addEventListener("click", () => $("settings-dialog").close());
$("save-settings").addEventListener("click", saveSettings);
$("refresh-models").addEventListener("click", () => loadModelChoices(state.modelPrefs, true, true));
document.querySelectorAll("[data-settings-tab]").forEach((button) => button.addEventListener("click", () => selectSettingsTab(button.dataset.settingsTab)));
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
$("theme-choice").addEventListener("change", () => applyTheme($("theme-choice").value));
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
$("refresh-projects").addEventListener("click", () => loadProjects().catch((error) => { $("projects").textContent = error.message; }));
for (const button of document.querySelectorAll(".suggestions button")) {
  button.addEventListener("click", () => { $("prompt").value = button.dataset.prompt || ""; $("prompt").focus(); });
}

$("choose-context").addEventListener("click", async () => {
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

loadProjects().then(() => importSessions({ quiet: true })).catch((error) => { $("projects").textContent = error.message; });
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
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.theme === "system") applyTheme("system"); });
setInterval(refreshStatus, 30_000);
setInterval(refreshWindowsAccent, 15_000);
