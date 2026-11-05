// node --test test/  — imports fake Claude Code / Codex history through the real server, then merges.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-import-"));
const home = path.join(root, "home"), projects = path.join(root, "Projects");
await mkdir(path.join(projects, "alpha", ".git"), { recursive: true });
await mkdir(path.join(projects, "alpha", "src"), { recursive: true });
await writeFile(path.join(projects, "alpha", ".git", "config"), '[remote "origin"]\n\turl = https://github.com/me/Alpha-Repo.git\n');
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join("\n");

const claudeDir = path.join(home, ".claude", "projects", "alpha");
await mkdir(claudeDir, { recursive: true });
const cwd = path.join(projects, "alpha", "src");
await writeFile(path.join(claudeDir, "c1.jsonl"), jsonl([
  { type: "user", sessionId: "c1", cwd, entrypoint: "cli", timestamp: "2026-01-01T10:00:00Z", message: { role: "user", content: "Fix the login bug" } },
  { type: "user", sessionId: "c1", cwd, isMeta: true, timestamp: "2026-01-01T10:00:01Z", message: { role: "user", content: "meta" } },
  { type: "assistant", sessionId: "c1", cwd, timestamp: "2026-01-01T10:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "Looking." }, { type: "tool_use", name: "Read" }] } },
  { type: "user", sessionId: "c1", cwd, timestamp: "2026-01-01T10:00:03Z", message: { role: "user", content: [{ type: "tool_result", content: "file" }] } },
  { type: "assistant", sessionId: "c1", cwd, timestamp: "2026-01-01T10:00:04Z", message: { role: "assistant", content: [{ type: "text", text: "Fixed it." }] } },
]));
// The app's own headless run: must be skipped.
await writeFile(path.join(claudeDir, "c2.jsonl"), jsonl([{ type: "user", sessionId: "c2", cwd, entrypoint: "sdk-cli", message: { content: "router prompt" } }]));

const codexDir = path.join(home, ".codex", "sessions", "2026", "01", "02");
await mkdir(codexDir, { recursive: true });
await writeFile(path.join(codexDir, "rollout-x.jsonl"), jsonl([
  { timestamp: "2026-01-02T09:00:00Z", type: "session_meta", payload: { id: "x1", cwd: path.join(projects, "alpha"), originator: "codex_cli_rs" } },
  { timestamp: "2026-01-02T09:00:01Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>noise</environment_context>" }] } },
  { timestamp: "2026-01-02T09:00:02Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add tests for login" }] } },
  { timestamp: "2026-01-02T09:00:03Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Added." }] } },
]));
await writeFile(path.join(codexDir, "rollout-elsewhere.jsonl"), jsonl([
  { type: "session_meta", payload: { id: "x2", cwd: path.join(root, "elsewhere") } },
  { timestamp: "2026-01-03T09:00:00Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Unrelated" }] } },
]));

// Fake Codex CLI for `codex cloud list --json` (POSIX shells only; on Windows the cloud part is skipped).
const fakeCodex = path.join(root, "codex");
await writeFile(fakeCodex, `#!/bin/sh\necho '${JSON.stringify({ tasks: [{ id: "task_1", title: "Refactor auth", status: "ready", updated_at: "2026-01-04T00:00:00Z", environment_label: "me/Alpha-Repo", url: "https://chatgpt.com/codex/tasks/task_1", summary: { files_changed: 2, lines_added: 10, lines_removed: 3 } }], cursor: null })}'\n`, { mode: 0o755 });
const hasCloud = process.platform !== "win32";
Object.assign(process.env, { USERPROFILE: home, HOME: home, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects, CODEX_CLI: hasCloud ? fakeCodex : "codex-not-installed", CLAUDE_CONFIG_DIR: "", CODEX_HOME: "" });
delete process.env.CLAUDE_CONFIG_DIR; delete process.env.CODEX_HOME;
const { startServer } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("imports CLI sessions into matching projects, skips the app's own runs, and merges", async () => {
  const n = hasCloud ? 1 : 0;
  assert.deepEqual(await call("/api/sessions/import", {}), { added: 3 + n, updated: 0, scanned: 3 + n, cloud: n });
  assert.equal((await call("/api/sessions/import", {})).added, 0, "second import adds nothing");
  const alpha = await call("/api/sessions?projectId=alpha");
  assert.deepEqual(alpha.map((s) => s.importedFrom).sort(), ["claude", "codex", ...(hasCloud ? ["codex-cloud"] : [])], "cloud task matched by git remote");
  assert.equal((await call("/api/sessions?projectId=__all_projects__")).length, 1);
  const claude = await call(`/api/sessions/${alpha.find((s) => s.importedFrom === "claude").id}`);
  assert.deepEqual(claude.messages.map((m) => [m.role, m.content]), [["user", "Fix the login bug"], ["assistant", "Looking.\n\nFixed it."]]);

  const merged = await call("/api/sessions/merge", { ids: alpha.map((s) => s.id) });
  assert.deepEqual(merged.messages.map((m) => m.content).slice(0, 4), ["Fix the login bug", "Looking.\n\nFixed it.", "Add tests for login", "Added."]);
  if (hasCloud) assert.match(merged.messages.at(-1).content, /codex cloud apply task_1/);
  const after = await call("/api/sessions?projectId=alpha");
  assert.equal(after.length, 1);
  assert.equal(after[0].merged, true);
  assert.equal((await call("/api/sessions/import", {})).added, 0, "merged sources are not re-imported");

  const other = (await call("/api/sessions?projectId=__all_projects__"))[0];
  assert.match((await call("/api/sessions/merge", { ids: [after[0].id, other.id] })).error, /same project/);

  await fetch(`${base}/api/sessions/${other.id}`, { method: "DELETE" });
  assert.equal((await call("/api/sessions/import", {})).added, 0, "deleted imports stay deleted");
});

test.after(() => server.close());
