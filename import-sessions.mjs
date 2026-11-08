// Reads chat history that the Claude Code and Codex CLIs keep on this computer (including cloud sessions
// they have pulled down) and Codex Cloud tasks, so the app can show sessions that started outside it.
import { execFile } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
export const MAX_MESSAGES = 400;
const MAX_CHARS = 20_000;

const clip = (text) => text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n…(cut)" : text;
// CLI-injected context (system reminders, command echoes, environment blocks) starts with a tag.
const isNoise = (text) => !text || /^\s*(<[a-z_-]+[\s>]|Caveat:|# AGENTS\.md)/i.test(text);

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => ["text", "input_text", "output_text"].includes(part?.type) && typeof part.text === "string").map((part) => part.text).join("\n");
}

function pushMessage(messages, role, text, createdAt) {
  text = text.trim();
  if (isNoise(text)) return;
  const last = messages.at(-1);
  // Claude writes one line per content block; join consecutive turns from the same side.
  if (last?.role === role) last.content = clip(`${last.content}\n\n${text}`);
  else messages.push({ role, content: clip(text), ...(createdAt ? { createdAt } : {}) });
}

function lines(text) {
  return text.split(/\r?\n/).flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
}

export function parseClaudeTranscript(text) {
  const result = { id: "", cwd: "", title: "", entrypoint: "", messages: [] };
  for (const entry of lines(text)) {
    if (entry.type === "summary" && entry.summary && !result.title) result.title = entry.summary;
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.isMeta || entry.isSidechain) continue;
    result.id ||= entry.sessionId || "";
    result.cwd ||= entry.cwd || "";
    result.entrypoint ||= entry.entrypoint || "";
    pushMessage(result.messages, entry.type, textOf(entry.message?.content), entry.timestamp);
  }
  return result;
}

export function parseCodexRollout(text) {
  const result = { id: "", cwd: "", title: "", originator: "", messages: [] };
  for (const entry of lines(text)) {
    const item = entry.payload ?? entry;
    if (entry.type === "session_meta" || (!entry.type && item.id && item.timestamp && !item.role)) {
      result.id ||= item.id || "";
      result.cwd ||= item.cwd || "";
      result.originator ||= item.originator || "";
      continue;
    }
    if (item.type === "message" && (item.role === "user" || item.role === "assistant")) pushMessage(result.messages, item.role, textOf(item.content), entry.timestamp);
  }
  return result;
}

async function jsonlFiles(dir, depth) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && depth > 0) return jsonlFiles(full, depth - 1);
    return entry.isFile() && entry.name.endsWith(".jsonl") ? [full] : [];
  }));
  return nested.flat();
}

function toSession(source, parsed, file, mtime) {
  if (!parsed.id || !parsed.messages.some((message) => message.role === "user")) return null;
  const firstUser = parsed.messages.find((message) => message.role === "user").content;
  const messages = parsed.messages.slice(-MAX_MESSAGES).map((message) => ({ ...message, ...(message.role === "assistant" ? { route: source === "claude" ? "Claude Code" : "Codex" } : {}) }));
  return {
    source, sourceId: parsed.id, cwd: parsed.cwd, file,
    title: (parsed.title || firstUser).replace(/\s+/g, " ").slice(0, 64),
    createdAt: parsed.messages[0].createdAt || mtime,
    updatedAt: parsed.messages.at(-1).createdAt || mtime,
    messages,
  };
}

// skip(parsed) lets the caller drop runs the app itself started (headless `claude -p` / `codex exec`).
export async function scanLocalCliSessions({ home = os.homedir(), skip = () => false } = {}) {
  const sources = [
    ["claude", path.join(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), "projects"), 1, parseClaudeTranscript],
    ["codex", path.join(process.env.CODEX_HOME || path.join(home, ".codex"), "sessions"), 3, parseCodexRollout],
  ];
  const sessions = [];
  for (const [source, dir, depth, parse] of sources) {
    for (const file of await jsonlFiles(dir, depth)) {
      try {
        const mtime = (await stat(file)).mtime.toISOString();
        const parsed = parse(await readFile(file, "utf8"));
        if (skip(source, parsed)) continue;
        const session = toSession(source, parsed, file, mtime);
        if (session) sessions.push(session);
      } catch { /* unreadable transcript: ignore */ }
    }
  }
  return sessions;
}

export function codexCloudTasksToSessions(payload) {
  return (Array.isArray(payload?.tasks) ? payload.tasks : []).filter((task) => task?.id).map((task) => {
    const summary = task.summary || {};
    const updatedAt = task.updated_at || new Date().toISOString();
    return {
      source: "codex-cloud", sourceId: String(task.id), label: task.environment_label || "",
      title: String(task.title || "Codex Cloud task").replace(/\s+/g, " ").slice(0, 64),
      createdAt: updatedAt, updatedAt,
      messages: [
        { role: "user", content: String(task.title || "Codex Cloud task"), createdAt: updatedAt },
        { role: "assistant", route: "Codex Cloud", createdAt: updatedAt, content: [
          `Codex Cloud task: ${task.status || "unknown status"}${task.environment_label ? ` in ${task.environment_label}` : ""}.`,
          `${summary.files_changed ?? 0} files changed (+${summary.lines_added ?? 0} / -${summary.lines_removed ?? 0}).`,
          task.url ? `Open it: ${task.url}` : "",
          `To bring the changes here, run: codex cloud apply ${task.id}`,
        ].filter(Boolean).join("\n") },
      ],
    };
  });
}

// Needs a Codex CLI signed in with ChatGPT; returns [] when it isn't.
export async function fetchCodexCloudSessions(codexCommand, pages = 5) {
  const sessions = [];
  let cursor = "";
  for (let page = 0; page < pages; page++) {
    const args = ["cloud", "list", "--json", "--limit", "20", ...(cursor ? ["--cursor", cursor] : [])];
    const { stdout } = await execFileAsync(codexCommand, args, { timeout: 30_000, maxBuffer: 5_000_000, windowsHide: true });
    const payload = JSON.parse(stdout.replace(/^﻿/, ""));
    sessions.push(...codexCloudTasksToSessions(payload));
    if (!payload.cursor) break;
    cursor = String(payload.cursor);
  }
  return sessions;
}

const sessionText = (session, limit = 60_000) => (session.messages || []).map((message) => message.content || "").join("\n").slice(0, limit).toLowerCase();
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MIN_PROJECT_SCORE = 3;

// Ranks project folders by how familiar a session is with them: its working folder or Codex Cloud repo counts most,
// then paths into the folder, the repo name and the folder name mentioned in the chat. projects: [{ id, remote, repos }].
export function rankProjects(session, projects, root) {
  const text = sessionText(session);
  const cwd = session.cwd ? path.resolve(session.cwd).toLowerCase() : "";
  const label = String(session.label || "").toLowerCase();
  const count = (pattern) => Math.min(10, (text.match(pattern) || []).length);
  return projects.map((project) => {
    const name = project.id.toLowerCase();
    const folder = path.join(path.resolve(root), project.id).toLowerCase();
    let score = 0;
    if (cwd && (cwd === folder || cwd.startsWith(folder + path.sep))) score += 100;
    if (label && (label.split("/").pop() === name || (project.remote || "").includes(label))) score += 100;
    score += 3 * count(new RegExp(`[\\\\/]${escapeRegex(name)}(?=[\\\\/\\s"'\`]|$)`, "g"));
    if (name.length >= 4) score += count(new RegExp(`(?<![\\w-])${escapeRegex(name)}(?![\\w-])`, "g"));
    for (const repo of project.repos || []) if (repo !== name) score += 2 * count(new RegExp(`(?<![\\w-])${escapeRegex(repo)}(?![\\w-])`, "g"));
    return { id: project.id, score };
  }).filter((rank) => rank.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// The best project, or null when nothing scores high enough or two projects tie. parentOf maps a folder merged into a
// parent project to that parent, so its score counts toward the parent.
export function bestProject(session, projects, root, parentOf = {}) {
  const totals = new Map();
  for (const { id, score } of rankProjects(session, projects, root)) {
    const owner = parentOf[id] || id;
    totals.set(owner, (totals.get(owner) || 0) + score);
  }
  const [first, second] = [...totals].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return first && first.score >= MIN_PROJECT_SCORE && first.score !== second?.score ? first.id : null;
}

const STOP_WORDS = new Set("this that with from have what when will your there their about would should could which into them then than these those were been just like make made more some only also other here they does done need want using used please thanks okay sure still again want know think look looks going being doing very much each every same work works".split(" "));
const FILE_REF = /[\w-]+\.(?:m?[jt]sx?|cjs|py|md|json|css|html|cs|go|rs|java|ya?ml|toml|sql|sh|ps1)\b/g;

function termCounts(session) {
  const text = sessionText(session);
  const counts = new Map();
  const add = (term, n) => counts.set(term, (counts.get(term) || 0) + n);
  for (const file of text.match(FILE_REF) || []) add(`file:${file}`, 3);
  for (const word of text.match(/[a-z][a-z0-9_-]{3,}/g) || []) if (!STOP_WORDS.has(word)) add(word, 1);
  return counts;
}

// Indexes sessions by topic: each session's top terms by tf-idf over the corpus. Terms used by one session only, or
// by most of them, say nothing about which sessions belong together, so they're left out.
export function topicIndex(corpus, size = 40) {
  const counts = new Map(corpus.map((session) => [session, termCounts(session)]));
  const df = new Map();
  for (const terms of counts.values()) for (const term of terms.keys()) df.set(term, (df.get(term) || 0) + 1);
  const most = Math.max(2, corpus.length / 2);
  return (session) => new Set([...(counts.get(session) || termCounts(session))]
    .filter(([term]) => (df.get(term) || 0) >= 2 && df.get(term) <= most)
    .map(([term, tf]) => [term, tf * Math.log((corpus.length + 1) / df.get(term))])
    .sort((a, b) => b[1] - a[1]).slice(0, size).map(([term]) => term));
}

const jaccard = (a, b) => {
  let shared = 0;
  for (const term of a) if (b.has(term)) shared++;
  return shared ? shared / (a.size + b.size - shared) : 0;
};

// Groups new sessions into threads by topic. Each existing session (a thread or a lone import) can take new ones;
// a new session joins the closest group it is similar enough to, otherwise starts its own. Returns only groups that
// gained something to merge, existing session first.
// ponytail: greedy single-link clustering on top terms, fine for hundreds of sessions; embeddings if topics blur.
export function groupSessions(fresh, existing, termsOf, threshold = 0.15) {
  const groups = existing.map((session) => [{ session, terms: termsOf(session) }]);
  for (const session of [...fresh].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))) {
    const terms = termsOf(session);
    let best = null, bestScore = threshold;
    for (const group of groups) {
      const score = Math.max(...group.map((member) => jaccard(terms, member.terms)));
      if (score >= bestScore) { best = group; bestScore = score; }
    }
    if (best) best.push({ session, terms });
    else groups.push([{ session, terms }]);
  }
  return groups.filter((group) => group.length > 1).map((group) => group.map((member) => member.session));
}

// Merges messages from several sessions in time order. Messages without a time keep their place after the previous one.
export function mergeMessages(sessions) {
  let order = 0;
  return sessions
    .flatMap((session) => (session.messages || []).map((message) => ({ message, time: message.createdAt || session.updatedAt || "", order: order++ })))
    .sort((a, b) => a.time.localeCompare(b.time) || a.order - b.order)
    .map(({ message }) => message);
}
