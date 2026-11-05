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

// Merges messages from several sessions in time order. Messages without a time keep their place after the previous one.
export function mergeMessages(sessions) {
  let order = 0;
  return sessions
    .flatMap((session) => (session.messages || []).map((message) => ({ message, time: message.createdAt || session.updatedAt || "", order: order++ })))
    .sort((a, b) => a.time.localeCompare(b.time) || a.order - b.order)
    .map(({ message }) => message);
}
