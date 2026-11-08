// node --test test/*.test.mjs — per-thread Claude Code permission modes (Claude desktop's four) and readable approval cards.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-modes-"));
const projects = path.join(root, "Projects");
await mkdir(path.join(projects, "alpha"), { recursive: true });
await mkdir(path.join(root, ".claude"), { recursive: true });
await writeFile(path.join(root, ".claude", "settings.json"), JSON.stringify({ permissions: { defaultMode: "acceptEdits" } }));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects });
const { startServer, approvalTitle, approvalDetail } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("a thread stores one of Claude desktop's modes; Bypass permissions is refused", async () => {
  // An unset thread follows the user's Claude Code default mode.
  assert.equal((await call("/api/settings")).claudeDefaultMode, "acceptEdits");
  const session = await call("/api/sessions", { projectId: "alpha" });
  for (const mode of ["default", "acceptEdits", "plan", "auto"]) assert.equal((await call(`/api/sessions/${session.id}/permission-mode`, { permissionMode: mode })).permissionMode, mode);
  for (const mode of ["bypassPermissions", "dontAsk", "yolo"]) assert.match((await call(`/api/sessions/${session.id}/permission-mode`, { permissionMode: mode })).error, /Ask permissions/);
  assert.equal((await call(`/api/sessions/${session.id}/permission-mode`, { permissionMode: "" })).permissionMode, undefined);
});

test("approval cards show the plan, command or file instead of raw JSON", () => {
  assert.equal(approvalTitle("ExitPlanMode", { plan: "# Plan" }), "Approve this plan?");
  assert.equal(approvalDetail("ExitPlanMode", { plan: "# Plan\n- step" }), "# Plan\n- step");
  assert.equal(approvalTitle("Bash", { command: "npm test" }), "Run this command?");
  assert.equal(approvalDetail("Bash", { command: "npm test", description: "Run tests" }), "npm test\n\nRun tests");
  assert.equal(approvalTitle("Write", { file_path: "C:\\p\\notes.txt", content: "hi" }), "Write notes.txt?");
  assert.equal(approvalDetail("Write", { file_path: "notes.txt", content: "hi" }), "notes.txt\n\nhi");
  assert.equal(approvalTitle("mcp__x__send", {}), "Allow mcp__x__send?");
  assert.equal(approvalDetail("mcp__x__send", { to: "a" }), JSON.stringify({ to: "a" }, null, 2));
});

test.after(() => server.close());
