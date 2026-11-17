import test from "node:test";
import assert from "node:assert/strict";
import { rufloArgs, describeRufloTool, runRufloTask } from "../ruflo-runner.mjs";

test("Ruflo has one MCP backend and preserves provider permissions", () => {
  const args = rufloArgs("C:/app with spaces/ruflo.js", "plan");
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]);
  assert.deepEqual(Object.keys(config.mcpServers), ["ruflo"]);
  assert.deepEqual(config.mcpServers.ruflo.args, ["C:/app with spaces/ruflo.js", "mcp", "start"]);
  assert.ok(!args.includes("--strict-mcp-config"));
  assert.equal(args[args.indexOf("--permission-mode") + 1], "plan");
  assert.ok(!args.join(" ").includes("dangerously-skip"));
  assert.match(describeRufloTool("Agent", { subagent_type: "reviewer", model: "sonnet" }), /reviewer; model: sonnet/);
});

test("Ruflo forwards approvals, cancellation, returned decisions and usage", async () => {
  const decisions = [], activity = [], usage = [];
  const signal = new AbortController().signal;
  const result = await runRufloTask("claude", "task", { path: "/project" }, {}, {
    signal, rufloDecisions: decisions, onActivity: (text) => activity.push(text), onUsage: (value) => usage.push(value),
    onApproval: (card) => { assert.equal(card.canAlwaysAllow, true); return "deny"; },
  }, { check: async () => {}, run: async (command, args, cwd, env, callbacks) => {
    assert.equal(command, "claude"); assert.equal(cwd, "/project"); assert.equal(callbacks.signal, signal);
    assert.equal(await callbacks.onApproval({ tool: "Write" }, { canAlwaysAllow: true }), "deny");
    callbacks.onTool("mcp__ruflo__hooks_route", { task: "task" }, "route1");
    callbacks.onToolResult("route1", [{ type: "text", text: '{"agent":"coder","model":"sonnet"}' }], false);
    callbacks.onTool("mcp__ruflo__swarm_init", {}, "swarm1");
    callbacks.onToolResult("swarm1", "initialized", false);
    callbacks.onUsage({ input: 10, output: 2 });
    return "answer";
  } });
  assert.equal(result, "answer"); assert.ok(decisions.some((text) => text.includes("coder")));
  assert.ok(activity.some((text) => text.includes("returned"))); assert.equal(usage[0].provider, "ruflo");
});

test("missing or failed Ruflo never falls back to the original backend", async () => {
  await assert.rejects(runRufloTask("claude", "task", { path: "/project" }, {}, {}, {
    check: async () => { throw new Error("missing"); }, run: async () => assert.fail("must not execute"),
  }), /Ruflo is not installed/);
  for (const failed of [false, true]) await assert.rejects(runRufloTask("claude", "task", { path: "/project" }, {}, {}, {
    check: async () => {}, run: async (command, args, cwd, env, cb) => {
      if (failed) { cb.onTool("mcp__ruflo__hooks_route", {}, "r"); cb.onToolResult("r", "unavailable", true); }
      assert.equal(await cb.onApproval({ tool: "Write" }), "deny");
      return "not coordinated";
    },
  }), /did not complete Ruflo/);
});

test("Ruflo needs a swarm only when work fans out to several agents", async () => {
  const routed = (agentCount) => async (command, args, cwd, env, cb) => {
    cb.onTool("mcp__ruflo__hooks_route", {}, "r"); cb.onToolResult("r", '{"agent":"coder"}', false);
    for (let i = 0; i < agentCount; i++) cb.onTool("Agent", { subagent_type: "coder" }, `a${i}`);
    return "answer";
  };
  const deps = (run) => ({ check: async () => {}, run });
  for (const count of [0, 1]) {
    const decisions = [];
    assert.equal(await runRufloTask("claude", "q", { path: "/p" }, {}, { rufloDecisions: decisions }, deps(routed(count))), "answer");
    assert.ok(decisions.some((text) => text.startsWith("No swarm")));
  }
  await assert.rejects(runRufloTask("claude", "q", { path: "/p" }, {}, {}, deps(routed(2))), /swarm setup for 2 agents/);
  await assert.rejects(runRufloTask("claude", "q", { path: "/p" }, {}, {}, deps(async () => "x")), /did not complete Ruflo routing\./);
});

test("Ruflo preserves a host limit response before checking coordination", async () => {
  await assert.rejects(runRufloTask("claude", "task", { path: "/p" }, {}, {}, {
    check: async () => {}, run: async () => "You've hit your 5-hour limit · resets 7pm",
  }), /5-hour limit/);
});
