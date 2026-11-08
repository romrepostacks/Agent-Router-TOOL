// node --test test/*.test.mjs — Claude Code approval prompts pass through to the router (fake CLI, stream-json protocol).
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runClaudeStream } from "../cli-runner.mjs";

// Speaks Claude Code's stdio control protocol: ack initialize, ask once to run Bash, report the decision as the result.
const fake = path.join(await mkdtemp(path.join(os.tmpdir(), "router-claude-")), "fake-claude.mjs");
await writeFile(fake, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
let args = process.argv.slice(2).join(" ");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type === "control_request" && m.request.subtype === "initialize") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
  if (m.type === "user") out({ type: "control_request", request_id: "ask-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "rm -rf build" }, tool_use_id: "tu-1" } });
  if (m.type === "control_response" && m.response.request_id === "ask-1") {
    const r = m.response.response;
    out({ type: "assistant", message: { content: [{ type: "text", text: "decided" }] } });
    out({ type: "result", is_error: false, result: JSON.stringify({ behavior: r.behavior, command: r.updatedInput?.command, toolUseID: r.toolUseID, permissionTool: args.includes("--permission-prompt-tool stdio") }) });
  }
}
`);

const run = (options) => runClaudeStream(process.execPath, [fake], undefined, undefined, { prompt: "clean up", ...options }).then(JSON.parse);

test("a provider prompt reaches onApproval and Allow runs the tool unchanged", async () => {
  const asked = [];
  const texts = [];
  const result = await run({ onApproval: async (card) => { asked.push(card); return true; }, onText: (text) => texts.push(text) });
  assert.deepEqual(asked, [{ tool: "Bash", input: { command: "rm -rf build" }, reason: "" }]);
  assert.equal(result.behavior, "allow");
  assert.equal(result.command, "rm -rf build");
  assert.equal(result.toolUseID, "tu-1");
  assert.equal(result.permissionTool, true);
  assert.deepEqual(texts, ["decided"]);
});

test("Decline, a failing handler, or no handler all deny", async () => {
  assert.equal((await run({ onApproval: async () => false })).behavior, "deny");
  assert.equal((await run({ onApproval: async () => { throw new Error("page gone"); } })).behavior, "deny");
  assert.equal((await run({})).behavior, "deny");
});

test("waiting for the user doesn't trip the idle timeout", async () => {
  const result = await run({ idleTimeoutMs: 200, onApproval: () => new Promise((resolve) => setTimeout(() => resolve(true), 600)) });
  assert.equal(result.behavior, "allow");
});
