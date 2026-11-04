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
    auto: "Your request and recent messages go to GPT for routing. Depending on the route, Colibri may answer locally, GPT may inspect the selected project read-only, coding providers may work in a private copy, or Copilot may perform an audit or requested push.",
    colibri: "Your request, recent messages, selected text or PDF files, and images go to Colibri at its local endpoint on this computer.",
    claude: "GPT makes a read-only plan from a private project copy; Claude Code uses your signed-in subscription to implement in that copy. Changes wait for your review and approval.",
    codex: "Codex works in a private copy of the selected project and can propose edits. The original folder changes only after you apply the review.",
    copilot: "Copilot CLI may read the selected project for a security review. Write and shell tools are blocked.",
    push: "Copilot receives the push request, may read the selected project, and is limited to git status and git push. It cannot create commits or force-push."
  };
  $("run-state").textContent = state.lastRunStatus;
  $("permission-summary").textContent = `${summaries[mode]}\n\nProject access: ${scope}.`;
  const modelList = $("model-summary");
  modelList.replaceChildren();
  for (const [label, key] of [["Route Planning", "routePlanningPrimary"], ["Long Term Project planning", "longTermPlanningPrimary"], ["Coding", "codingPrimary"], ["Reviewing", "reviewPrimary"], ["Security audit", "securityPrimary"], ["UI Designer", "uiPrimary"], ["Art Asset generation", "artPrimary"], ["GitHub requests", "githubPrimary"], ["Quick questions", "quickPrimary"]]) {
    const item = document.createElement("li");
    const choice = state.modelPrefs[key] || "Provider default";
    const readable = state.modelCatalog?.all?.find((model) => model.id === choice)?.name || choice.replace("::", " — ");
    item.textContent = `${label}: ${readable}`;
    modelList.append(item);
  }
  const context = $("included-context");
  context.replaceChildren();
  const files = [
    ...state.attachments.map((file) => `${file.name}${file.mimeType?.startsWith("image/") ? " (image: Colibri only)" : " (text included)"}`),
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
  $("prompt").placeholder = !state.project ? "Choose a project first…" : state.project.scope === "all" ? "Ask a quick question or request an all-projects audit…" : "Ask Colibri or describe a coding task…";
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
    row.append(button, remove);
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
    description.textContent = "Colibri handles everyday chat locally and calls a coding CLI only when the task needs it.";
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
  for (const value of ["claude", "codex", "push"]) {
    const option = $("mode").querySelector(`option[value="${value}"]`);
    if (option) option.disabled = allProjects;
  }
  if (allProjects && ["claude", "codex", "push"].includes($("mode").value)) $("mode").value = "auto";
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
    colibri.replaceChildren(dot, document.createTextNode(result.colibri.online ? `Colibri · ${result.colibri.selectedModel}${selectedAvailable ? " ready" : " · desired model not listed"}` : "Colibri offline"));
    const labels = { claude: "Claude coder", codex: "GPT planner / Codex fallback", copilot: "Copilot audit / push" };
    cli.textContent = Object.keys(labels).map((id) => `${labels[id]}: ${result.commands[id]?.signIn || (result.commands[id]?.available ? "installed · sign-in unknown" : "not installed")}`).join("  ·  ");
    cli.title = "Sign-in check only reports readiness; credentials are never shown.";
    const settings = await request("/api/settings");
    state.modelPrefs = settings;
    renderInspector();
    if (!settings.configured && !state.settingsPrompted) {
      state.settingsPrompted = true;
      await openSettings();
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
      const choices = ["quick", "routePlanning"].includes(role) ? catalog.all : catalog.project;
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

loadProjects().catch((error) => { $("projects").textContent = error.message; });
loadSkills().catch((error) => { $("skills-list").textContent = error.message; });
refreshStatus();
refreshWindowsAccent();
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.theme === "system") applyTheme("system"); });
setInterval(refreshStatus, 30_000);
setInterval(refreshWindowsAccent, 15_000);
