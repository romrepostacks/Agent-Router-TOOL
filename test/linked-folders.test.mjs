// node --test test/  — links one project folder to another and checks the linked files become readable context.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-linked-"));
const projects = path.join(root, "Projects");
await mkdir(path.join(projects, "alpha"), { recursive: true });
await mkdir(path.join(projects, "beta"), { recursive: true });
await writeFile(path.join(projects, "alpha", "app.js"), "// alpha\n");
await writeFile(path.join(projects, "beta", "api.md"), "# Beta API\n");
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects });
const { startServer, workspaceFiles } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("links other project folders read-only and drops invalid ones", async () => {
  const saved = await call("/api/projects/linked", { projectId: "alpha", linked: ["beta", "beta", "alpha", "missing", "../x"] });
  assert.deepEqual(saved.linked, ["beta"]);
  const list = await call("/api/projects");
  assert.deepEqual(list.find((item) => item.id === "alpha").linked, ["beta"]);
  assert.deepEqual(list.find((item) => item.id === "beta").linked, []);
  const { files } = await call("/api/context?projectId=alpha");
  assert.deepEqual(files.map((file) => file.id).sort(), ["alpha::app.js", "beta::api.md"]);
  assert.match((await call("/api/projects/linked", { projectId: "nope", linked: [] })).error, /project folder/);
});

test("links an outside folder from the picker; the page can drop it but not add new paths", async () => {
  const outside = path.join(root, "Elsewhere");
  await mkdir(outside);
  await writeFile(path.join(outside, "notes.md"), "# Notes\n");
  globalThis.routerPickFolder = async () => outside;
  assert.deepEqual((await call("/api/projects/linked/pick", { projectId: "alpha" })).linked, ["beta", outside]);
  const { files } = await call("/api/context?projectId=alpha");
  assert.ok(files.some((file) => file.projectName === "Elsewhere" && file.path === "notes.md"));
  assert.deepEqual((await call("/api/projects/linked", { projectId: "alpha", linked: [outside, path.join(root, "sneaky")] })).linked, [outside]);
  globalThis.routerPickFolder = async () => null;
  assert.equal((await call("/api/projects/linked/pick", { projectId: "alpha" })).cancelled, true);
  delete globalThis.routerPickFolder;
});

test("linked-folder copies skip files over the size cap", async () => {
  const source = path.join(root, "BigLinked");
  const copy = path.join(root, "BigLinkedCopy");
  await mkdir(source);
  await writeFile(path.join(source, "small.md"), "ok");
  await writeFile(path.join(source, "huge.bin"), "x".repeat(100));
  const files = await workspaceFiles(source, { copyTo: copy, hash: false, maxFileSize: 10 });
  assert.deepEqual([...files.keys()], ["small.md"]);
  assert.deepEqual((await readdir(copy)).sort(), ["small.md"]);
  // Default mode still hashes every file (streamed, so >2 GB files no longer fail).
  assert.equal((await workspaceFiles(source)).size, 2);
});

test.after(() => server.close());
