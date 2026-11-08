// node --test test/  — a staged copy keeps the installer resources in build/ but still skips build output.
// 0.17.0 lost its Server/Client page because staging skipped build/installer.nsh.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-staging-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: path.join(root, "Projects") });
const { workspaceFiles } = await import("../server.mjs");

test("top-level build/ with only resource files is staged; build output folders are not", async () => {
  const project = path.join(root, "app");
  await mkdir(path.join(project, "build"), { recursive: true });
  await mkdir(path.join(project, "web", "build", "static"), { recursive: true });
  await writeFile(path.join(project, "build", "installer.nsh"), "!macro customInit\n!macroend\n");
  await writeFile(path.join(project, "web", "build", "static", "main.js"), "generated");
  await writeFile(path.join(project, "index.js"), "x");
  const copy = path.join(root, "copy");
  const files = await workspaceFiles(project, { copyTo: copy });
  const keys = [...files.keys()].map((file) => file.replaceAll("\\", "/")).sort();
  assert.deepEqual(keys, ["build/installer.nsh", "index.js"]);
  assert.match(await readFile(path.join(copy, "build", "installer.nsh"), "utf8"), /customInit/);
});

test("a top-level build/ with subfolders is treated as output and skipped", async () => {
  const project = path.join(root, "out-app");
  await mkdir(path.join(project, "build", "release"), { recursive: true });
  await writeFile(path.join(project, "build", "release", "app.bin"), "x");
  await writeFile(path.join(project, "main.js"), "x");
  assert.deepEqual([...(await workspaceFiles(project)).keys()], ["main.js"]);
});
