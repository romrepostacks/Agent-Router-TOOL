// node --test test/  — imports fake Claude Code / Codex history through the real server, then merges.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
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
  assert.deepEqual(await call("/api/sessions/import", {}), { added: 3 + n, updated: 0, merged: 0, scanned: 3 + n, cloud: n });
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

const claudeSession = (id, text, time, at = cwd) => writeFile(path.join(claudeDir, `${id}.jsonl`), jsonl([{ type: "user", sessionId: id, cwd: at, entrypoint: "cli", timestamp: time, message: { role: "user", content: text } }]));

test("a session started outside the project folders goes to the project its chat refers to", async () => {
  await claudeSession("m1", `Rename the handler in ${path.join(projects, "alpha", "src", "app.js")}`, "2026-01-20T10:00:00Z", path.join(root, "elsewhere"));
  await claudeSession("m2", "Talk about alpha in general", "2026-01-21T10:00:00Z", path.join(root, "elsewhere"));
  assert.equal((await call("/api/sessions/import", {})).added, 2);
  const titles = async (id) => (await call(`/api/sessions?projectId=${id}`)).map((s) => s.title);
  assert.ok((await titles("alpha")).some((t) => t.startsWith("Rename the handler")), "path into the folder assigns it");
  assert.ok((await titles("__all_projects__")).includes("Talk about alpha in general"), "one bare name mention is not enough");
});

test("auto-merge groups each project's new imports into threads by topic", async () => {
  assert.equal((await call("/api/settings", { projectsRoot: projects, autoMergeImports: true })).autoMergeImports, true);
  await claudeSession("c3", "Fix the oauth token refresh in session.mjs", "2026-02-01T10:00:00Z");
  await claudeSession("c4", "The oauth token refresh in session.mjs fails again", "2026-02-02T10:00:00Z");
  await claudeSession("c5", "Pricing page colours", "2026-02-03T10:00:00Z");
  assert.equal((await call("/api/sessions/import", {})).merged, 2, "the two oauth sessions merge; pricing waits alone");
  await claudeSession("c6", "Pricing page colours wrong on mobile", "2026-02-04T10:00:00Z");
  await claudeSession("c7", "oauth token refresh once more", "2026-02-05T10:00:00Z");
  assert.equal((await call("/api/sessions/import", {})).merged, 2, "each joins its own topic");
  const threads = (await call("/api/sessions?projectId=alpha")).filter((s) => s.merged);
  const contents = (await Promise.all(threads.map(async (s) => (await call(`/api/sessions/${s.id}`)).messages.map((m) => m.content)))).filter((c) => c[0] !== "Fix the login bug");
  assert.deepEqual(contents.sort((a, b) => a[0].localeCompare(b[0])), [
    ["Fix the oauth token refresh in session.mjs", "The oauth token refresh in session.mjs fails again", "oauth token refresh once more"],
    ["Pricing page colours", "Pricing page colours wrong on mobile"],
  ]);
  assert.ok(threads.some((s) => s.title === "Pricing page colours"), "a new thread keeps its first session's title");
});

test("New project creates a folder by name and rejects paths and bad names", async () => {
  assert.equal((await call("/api/projects", { name: "beta" })).id, "beta");
  assert.match((await call("/api/projects", { name: "beta" })).error, /already exists/);
  for (const name of ["", "..\\evil", "a/b", ".hidden", "con", "trail.", "x:y"]) assert.ok((await call("/api/projects", { name })).error, name);
  assert.ok((await call("/api/projects")).some((p) => p.id === "beta"));
});

test("merging a project folder into a parent moves its sessions; reindex threads them by topic", async () => {
  await call("/api/settings", { projectsRoot: projects, autoMergeImports: false });
  const beta = path.join(projects, "beta");
  await claudeSession("b1", "Widget cache invalidation in cache.mjs is broken", "2026-03-01T10:00:00Z", beta);
  await claudeSession("b2", "Widget cache invalidation in cache.mjs still stale", "2026-03-02T10:00:00Z", beta);
  assert.equal((await call("/api/sessions/import", {})).added, 2);
  assert.equal((await call("/api/sessions?projectId=beta")).length, 2);

  assert.match((await call("/api/projects/merge", { parentId: "alpha", childId: "alpha" })).error, /itself/);
  await writeFile(path.join(beta, "keep.txt"), "beta file");
  const movedTo = path.join(projects, "alpha", "obsolete", "beta");
  assert.deepEqual(await call("/api/projects/merge", { parentId: "alpha", childId: "beta" }), { parentId: "alpha", moved: 2, folder: movedTo });
  assert.equal(await readFile(path.join(movedTo, "keep.txt"), "utf8"), "beta file", "files kept, moved under obsolete/");
  assert.equal(existsSync(beta), false);
  assert.match(await readFile(path.join(projects, "alpha", "obsolete", "MOVED.md"), "utf8"), /beta.*→.*obsolete/);
  const list = await call("/api/projects");
  assert.equal(list.some((p) => p.id === "beta"), false, "moved folder is no longer a top-level project");
  assert.equal((await call("/api/sessions?projectId=beta")).length, 0);

  await claudeSession("b3", "Widget cache invalidation in cache.mjs once more", "2026-03-03T10:00:00Z", beta);
  await call("/api/sessions/import", {});
  assert.ok((await call("/api/sessions?projectId=alpha")).some((s) => s.title.endsWith("once more")), "new imports from a member go to the parent");

  assert.ok((await call("/api/sessions/import", { reindex: true })).merged >= 3);
  const threads = await Promise.all((await call("/api/sessions?projectId=alpha")).map(async (s) => (await call(`/api/sessions/${s.id}`)).messages.map((m) => m.content)));
  assert.ok(threads.some((c) => c.filter((text) => text.startsWith("Widget cache")).length === 3), "the three widget sessions became one thread");

  await mkdir(beta);
  assert.match((await call("/api/projects/split", { childId: "beta" })).error, /exists again/, "never overwrites a folder");
  await rm(beta, { recursive: true });
  assert.deepEqual(await call("/api/projects/split", { childId: "beta" }), { split: "beta" });
  assert.equal(await readFile(path.join(beta, "keep.txt"), "utf8"), "beta file", "split moves the folder back");
  assert.equal((await call("/api/projects")).find((p) => p.id === "beta").parent, undefined);
  assert.match((await call("/api/projects/split", { childId: "beta" })).error, /isn't part/);
});

test("bestProject counts a member folder's score toward its parent", async () => {
  const { bestProject } = await import("../import-sessions.mjs");
  const session = { messages: [{ content: "see /old/main.js and /mid/a.js and /new/b.js" }] };
  const folders = [{ id: "old" }, { id: "mid" }, { id: "new" }, { id: "other" }];
  assert.equal(bestProject(session, folders, projects), null, "three-way tie");
  assert.equal(bestProject(session, folders, projects, { old: "new", mid: "new" }), "new");
});

test("reindex assigns saved imports even when their CLI transcripts are gone", async () => {
  await call("/api/settings", { projectsRoot: projects, autoMergeImports: false });
  for (const id of ["offline1", "offline2"]) {
    await claudeSession(id, `Repair offline widget cache in ${path.join(projects, "gamma", "cache.mjs")} ${id}`, "2026-04-01T10:00:00Z", root);
  }
  await call("/api/sessions/import", {});
  await call("/api/projects", { name: "gamma" });
  for (const id of ["offline1", "offline2"]) await unlink(path.join(claudeDir, `${id}.jsonl`));
  const result = await call("/api/sessions/import", { reindex: true });
  assert.ok(result.updated >= 2);
  const saved = await call("/api/sessions?projectId=gamma");
  assert.equal(saved.length, 1);
  const thread = await call(`/api/sessions/${saved[0].id}`);
  assert.equal(thread.messages.length, 2);
  assert.equal(thread.sources.length, 2);
  assert.equal((await call("/api/sessions/import", { reindex: true })).added, 0);
});

test.after(() => server.close());
