// node --test test/*.test.mjs — atomic saves survive the target being briefly held open (Windows EPERM on rename).
import assert from "node:assert/strict";
import { mkdtemp, open, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-replace-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { replaceFile } = await import("../server.mjs");

test("replaces a file that another reader holds open for a moment", async () => {
  const file = path.join(root, "sessions.json");
  await writeFile(file, "old", "utf8");
  const handle = await open(file, "r");
  setTimeout(() => handle.close(), 150);
  await replaceFile(file, "new");
  assert.equal(await readFile(file, "utf8"), "new");
  assert.deepEqual((await readdir(root)).filter((name) => name.endsWith(".tmp")), []);
});
