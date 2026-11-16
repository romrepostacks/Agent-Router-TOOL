import test from "node:test";
import assert from "node:assert/strict";
import { parseSse, summarize, report, tokens, checkOutput } from "../scripts/compare-backends.mjs";

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
  assert.match(text, /\| Tokens total \| not reported \| not reported \|/);
});

test("tokens sum every call, routing and subagents included, and the report shows them", () => {
  const usage = [{ provider: "claude", model: "opus", input: 1000, cached: 800, output: 50, costUsd: 0.1, turns: 3, apiMs: 2000, models: ["opus"] }, { provider: "colibri", input: 200, output: 10 }];
  assert.deepEqual(tokens(usage), { calls: 2, measured: true, input: 1200, cached: 800, output: 60, total: 1260, costUsd: 0.1, turns: 3, apiMs: 2000, models: ["opus"] });
  const run = summarize("Original", [{ event: "delta", data: { text: "a" }, at: 400 }, { event: "done", data: { content: "a", usage } }], 5000);
  assert.equal(run.firstOutputMs, 400);
  assert.match(report("p", "code", "x", [run]), /\| Tokens total \| 1,260 \|/);
});

test("checkOutput finds missing files, broken local links, external loads and source terms", () => {
  const checks = checkOutput({
    "site/index.html": '<link rel="stylesheet" href="https://fonts.example/x.css"><link href="style.css"><img src="shots/a.svg"><img src="shots/b.svg"><a href="https://github.com/x">GitHub</a><a href="#top">Top</a> Calderra',
    "site/style.css": "body { background: url('img/bg.svg') }",
    "site/shots/a.svg": "<svg/>",
  }, { required: ["site/index.html", "site/missing.css"], terms: ["Calderra", "Skyreach"] });
  assert.deepEqual(checks.missingRequired, ["site/missing.css"]);
  assert.deepEqual(checks.missingRefs, ["site/index.html → shots/b.svg", "site/style.css → img/bg.svg"]);
  assert.deepEqual(checks.externalRefs, ["https://fonts.example/x.css"]);
  assert.deepEqual(checks.termHits, ["Calderra"]);
});
