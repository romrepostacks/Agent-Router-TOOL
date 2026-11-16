// node --test test/*.test.mjs: the desktop theme (Harbor / Moss / Ember) is saved with the mode and rejects unknown names.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-palette-"));
const projects = path.join(root, "Projects");
await mkdir(projects, { recursive: true });
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects });
const { startServer } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const post = (body) => fetch(base + "/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectsRoot: projects, ...body }) });

test("theme palette defaults to Harbor, saves, survives a save without it, and rejects unknown names", async () => {
  assert.equal((await (await fetch(base + "/api/settings")).json()).palette, "harbor");
  assert.equal((await (await post({ palette: "ember", theme: "dark" })).json()).palette, "ember");
  assert.equal((await (await post({ localOnly: false })).json()).palette, "ember");
  assert.equal((await post({ palette: "neon" })).status, 400);
  const saved = await (await fetch(base + "/api/settings")).json();
  assert.deepEqual([saved.palette, saved.theme], ["ember", "dark"]);
});

test.after(() => server.close());
