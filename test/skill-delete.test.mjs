// node --test test/  — a skill added in the app can be deleted from Settings; imported skills can't.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-skill-delete-"));
const data = path.join(root, "local", "LocalAgentRouterData");
await mkdir(path.join(data, "skills", "imported"), { recursive: true });
await mkdir(path.join(root, "Projects"));
await writeFile(path.join(data, "skills", "imported", "outside.md"), "Imported skill.\n");
await writeFile(path.join(data, "skills.md"), "# Universal Skills\n\n## General\n\n- [Outside](skills/imported/outside.md) — Imported skill.\n");
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: path.join(root, "Projects") });
const { startServer } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: res.status, body: await res.json() };
};

test("deletes a user-added skill, its file and its approval; refuses imported skills", async () => {
  const added = await call("POST", "/api/skills", { name: "Router canary", category: "General", instructions: "Use when the task says \"canary check\".\nReply PINEAPPLE-42." });
  assert.equal(added.status, 201);
  assert.equal(added.body.skill.own, true);
  assert.equal(added.body.skills.find((skill) => skill.id === "general/outside").own, undefined);
  const file = path.join(data, "skills", "user-created", "general", "router-canary.md");
  await stat(file);
  const settings = (await call("GET", "/api/settings")).body;
  const saved = await call("POST", "/api/settings", { ...settings, preapprovedSkillIds: ["general/router-canary", "general/outside"] });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const removed = await call("DELETE", "/api/skills?id=general%2Frouter-canary");
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.skills.map((skill) => skill.id), ["general/outside"]);
  await assert.rejects(stat(file));
  assert.doesNotMatch(await readFile(path.join(data, "skills.md"), "utf8"), /Router canary/);
  assert.deepEqual((await call("GET", "/api/settings")).body.preapprovedSkillIds, ["general/outside"]);

  assert.equal((await call("DELETE", "/api/skills?id=general%2Foutside")).status, 404);
  assert.equal((await call("DELETE", "/api/skills?id=general%2Fmissing")).status, 404);
  await stat(path.join(data, "skills", "imported", "outside.md"));
});

test.after(() => server.close());
