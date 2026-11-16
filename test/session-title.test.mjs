// node --test test/*.test.mjs — new sessions get a short title from their first message.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-title-"));
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: path.join(root, "Projects") });
const { sessionTitle } = await import("../server.mjs");

test("drops lead-ins and keeps the first sentence", () => {
  assert.equal(sessionTitle("We should add automatic session naming. Let's also improve the UI."), "Add automatic session naming");
  assert.equal(sessionTitle("hey, can you please fix the login bug?"), "Fix the login bug");
  assert.equal(sessionTitle("ok so let's review the diff"), "Review the diff");
  assert.equal(sessionTitle("\n\n  explain server.mjs\nmore detail here"), "Explain server.mjs");
});

test("cuts long titles at a word and falls back when empty", () => {
  const title = sessionTitle("refactor the provider fallback so that partial work from the first provider is passed along");
  assert.ok(title.length <= 49 && title.endsWith("…"), title);
  assert.ok(!/\s…$/.test(title), title);
  assert.equal(sessionTitle("   "), "New session");
  assert.equal(sessionTitle("please?"), "New session");
});
