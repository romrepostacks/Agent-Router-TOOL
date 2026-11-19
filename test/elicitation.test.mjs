// node --test test/*.test.mjs — MCP servers asking the user (elicitations, e.g. computer use asking to control an app on
// this PC) reach an approval card instead of being refused as an unsupported request.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runClaudeStream, elicitationContent } from "../cli-runner.mjs";
import { runCodexStream } from "../codex-runner.mjs";
import { approvalTitle, approvalDetail } from "../server.mjs";

const dir = await mkdtemp(path.join(os.tmpdir(), "router-elicit-"));
const schema = { type: "object", properties: { allow: { type: "boolean" }, app: { type: "string", default: "Paint" } } };

const claude = path.join(dir, "fake-claude.mjs");
await writeFile(claude, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type === "control_request" && m.request.subtype === "initialize") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
  if (m.type === "user") out({ type: "control_request", request_id: "el-1", request: { subtype: "elicitation", mcp_server_name: "computer-use", message: "Allow control of Paint?", mode: "form", requested_schema: ${JSON.stringify(schema)} } });
  if (m.type === "control_response" && m.response.request_id === "el-1") out({ type: "result", is_error: false, result: JSON.stringify(m.response) });
}
`);

const codex = path.join(dir, "fake-codex.mjs");
await writeFile(codex, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const replies = [];
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.method === "initialize") out({ id: "initialize", result: {} });
  if (m.method === "thread/start") out({ id: "thread", result: { thread: { id: "t1" } } });
  if (m.method === "turn/start") {
    out({ id: 1, method: "mcpServer/elicitation/request", params: { threadId: "t1", serverName: "computer-use", mode: "form", message: "Allow control of Paint?", requestedSchema: ${JSON.stringify(schema)} } });
    out({ id: 2, method: "item/permissions/requestApproval", params: { threadId: "t1", turnId: "u1", itemId: "i1", cwd: ".", startedAtMs: 0, permissions: { network: { enabled: true } } } });
  }
  if (m.id === 1 || m.id === 2) {
    replies[m.id - 1] = m.result;
    if (replies.filter(Boolean).length === 2) {
      out({ method: "item/agentMessage/delta", params: { delta: JSON.stringify(replies) } });
      out({ method: "turn/completed", params: { turn: { status: "completed" } } });
    }
  }
}
`);

const runClaude = (onApproval) => runClaudeStream(process.execPath, [claude], undefined, undefined, { prompt: "go", onApproval }).then(JSON.parse);
const runCodex = (onApproval) => runCodexStream(process.execPath, [codex], undefined, undefined, { prompt: "go", onApproval }).then(JSON.parse);

test("Claude Code elicitation becomes a card; Allow accepts with defaults, Deny declines", async () => {
  const asked = [];
  const allowed = await runClaude(async (card) => { asked.push(card); return "allow"; });
  assert.equal(asked[0].tool, "mcp__computer-use");
  assert.equal(asked[0].input.message, "Allow control of Paint?");
  assert.deepEqual(allowed.response, { action: "accept", content: { allow: true, app: "Paint" } });
  assert.deepEqual((await runClaude(async () => "deny")).response, { action: "decline" });
  assert.deepEqual((await runClaude(undefined)).response, { action: "decline" });
});

test("Codex elicitation and permission requests become cards", async () => {
  const tools = [];
  const [elicit, perms] = await runCodex(async (card) => { tools.push(card.tool); return "allow"; });
  assert.deepEqual(tools.sort(), ["Codex permissions", "mcp__computer-use"]);
  assert.deepEqual(elicit, { action: "accept", content: { allow: true, app: "Paint" } });
  assert.deepEqual(perms, { permissions: { network: { enabled: true } }, scope: "turn" });
  assert.deepEqual(await runCodex(async () => "deny"), [{ action: "decline" }, { permissions: {} }]);
});

test("elicitation cards read as the server's message", () => {
  const input = { message: "Allow control of Paint?", url: "https://example.test/ok" };
  assert.equal(approvalTitle("mcp__computer-use", input), "computer-use is asking for your OK");
  assert.equal(approvalDetail("mcp__computer-use", input), "Allow control of Paint?\n\nhttps://example.test/ok");
  assert.equal(approvalTitle("mcp__remote__send_message", { message: "hi" }), "Allow mcp__remote__send_message?"); // a tool call, not a question
  assert.deepEqual(elicitationContent(undefined), {});
});
