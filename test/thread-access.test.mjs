// node --test test/*.test.mjs — a thread's access cap blocks routes before any provider runs.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-access-"));
const projects = path.join(root, "Projects");
await mkdir(path.join(projects, "alpha"), { recursive: true });
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects });
const { startServer, threadMode } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("thread access narrows routes and is stored on the session", async () => {
  const session = await call("/api/sessions", { projectId: "alpha" });
  assert.match((await call(`/api/sessions/${session.id}/access`, { accessLimit: "admin" })).error, /valid/);

  assert.equal((await call(`/api/sessions/${session.id}/access`, { accessLimit: "read" })).accessLimit, "read");
  const chat = (mode) => call("/api/chat", { message: "change app.js", projectId: "alpha", sessionId: session.id, mode });
  for (const mode of ["chain", "code", "ui", "art", "github"]) assert.equal((await chat(mode)).route, "Thread access");

  await call(`/api/sessions/${session.id}/access`, { accessLimit: "staged" });
  assert.equal((await chat("github")).route, "Thread access");

  await call(`/api/sessions/${session.id}/access`, { accessLimit: "none" });
  for (const mode of ["chain", "review", "longterm", "project", "code"]) assert.match((await chat(mode)).content, /No project access/);

  const cleared = await call(`/api/sessions/${session.id}/access`, { accessLimit: "" });
  assert.equal(cleared.accessLimit, undefined);
});

test("implementation follow-ups preserve workflow without widening thread limits", () => {
  const session = { workMode: "code" };
  assert.equal(threadMode("auto", session, "continue fixing the bug"), "code");
  assert.equal(threadMode("auto", session, "yes do it"), "code");
  assert.equal(threadMode("auto", session, "review the code"), "auto");
  assert.equal(threadMode("auto", session, "what should we do next?"), "auto");
  assert.equal(threadMode("auto", { ...session, accessLimit: "read" }, "fix it"), "auto");
  assert.equal(threadMode("auto", { ...session, accessLimit: "none" }, "fix it"), "auto");
  assert.equal(threadMode("review", session, "fix it"), "review");
});

test.after(() => server.close());
