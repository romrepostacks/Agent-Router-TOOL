import test from "node:test";
import assert from "node:assert/strict";
import { parseSse, summarize, report } from "../scripts/compare-backends.mjs";

test("parseSse splits events and keeps the unfinished tail", () => {
  const { events, rest } = parseSse('event: status\ndata: {"status":"a"}\n\nevent: delta\ndata: {"text":"hi"}\n\nevent: do');
  assert.deepEqual(events, [{ event: "status", data: { status: "a" } }, { event: "delta", data: { text: "hi" } }]);
  assert.equal(rest, "event: do");
});

test("summarize and report show both backends side by side", () => {
  const original = summarize("Original", [{ event: "status", data: { status: "x" } }, { event: "done", data: { content: "A", route: "Project", delegated: ["codex"] } }], 1500);
  const ruflo = summarize("Ruflo", [{ event: "approval", data: { tool: "mcp__ruflo__swarm_init", title: "Use it?" } }, { event: "error", data: { error: "boom" } }], 900);
  assert.equal(original.outcome, "done");
  assert.equal(ruflo.approvals.length, 1);
  const text = report("p", "project", "agent-router", [original, ruflo]);
  assert.match(text, /\| Outcome \| done \| error \|/);
  assert.match(text, /\| Error \| — \| boom \|/);
});
