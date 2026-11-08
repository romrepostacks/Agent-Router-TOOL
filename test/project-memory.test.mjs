import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { remember, recall, memorySection } from "../project-memory.mjs";

test("project memory survives reloads and concurrent reports without losing findings", async () => {
  const dir = await mkdtemp(path.resolve(".memory-test-"));
  try {
    const file = path.join(dir, "alpha.jsonl");
    assert.deepEqual(await recall(file), []);
    await Promise.all([
      remember(file, { kind: "security", summary: "High: unsafe command" }),
      remember(file, { kind: "review", summary: "No findings" }),
    ]);
    const entries = await recall(file);
    assert.equal(entries.length, 2);
    assert.ok(entries.some(item => item.summary.includes("unsafe command")));
    assert.deepEqual(await recall(path.join(dir, "beta.jsonl")), []);
    assert.match(memorySection(entries), /not verified/);
    assert.match(memorySection(entries), /not proof a fix was applied/);
    assert.match(memorySection(entries, "security"), /not verified/);
    // Coding and project questions get the history as background only: no "prior findings" section in their answers.
    for (const kind of ["code", "project", "longterm", "ui"]) assert.doesNotMatch(memorySection(entries, kind), /Reconcile|not verified/);
    for (let i = 0; i < 20; i++) await remember(file, { summary: "x".repeat(6000), kind: "code" });
    assert.ok((await recall(file)).length > 0);
    assert.ok((await recall(file)).length <= 12);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
