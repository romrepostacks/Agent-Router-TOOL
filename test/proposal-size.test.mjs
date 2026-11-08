// node --test test/*.test.mjs — stored change previews stay bounded without losing the newest one.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-proposals-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { trimProposals } = await import("../server.mjs");

const proposal = (id, chars) => ({ id, changes: [{ before: "a".repeat(chars / 2), after: "b".repeat(chars / 2) }] });

test("keeps at most 40 proposals", () => {
  const kept = trimProposals(Array.from({ length: 45 }, (_, i) => proposal(String(i), 10)));
  assert.equal(kept.length, 40);
  assert.equal(kept[0].id, "5");
});

test("drops oldest proposals once stored text passes the budget", () => {
  const kept = trimProposals([proposal("old", 5_000_000), proposal("mid", 5_000_000), proposal("new", 3_000_000)]);
  assert.deepEqual(kept.map((item) => item.id), ["mid", "new"]);
});

test("always keeps the newest proposal", () => {
  assert.deepEqual(trimProposals([proposal("huge", 20_000_000)]).map((item) => item.id), ["huge"]);
});
