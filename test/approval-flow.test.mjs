// node --test test/  — approval cards: Always allow, Allow, Deny. "Always" is only sent when Claude Code offered a rule
// it saves in its own settings (permission_suggestions); the router never answers later cards by itself.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runClaudeStream, savedPermissionSuggestions } from "../cli-runner.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "router-approval-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: path.join(root, "Projects") });
const { answerApproval } = await import("../server.mjs");

const RULE = { type: "addRules", rules: [{ toolName: "Bash", ruleContent: "npm test" }], behavior: "allow", destination: "localSettings" };
const fake = path.join(root, "fake-claude.mjs");
await writeFile(fake, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const suggestions = JSON.parse(process.argv[2]);
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type === "control_request" && m.request.subtype === "initialize") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
  if (m.type === "user") out({ type: "control_request", request_id: "ask-1", request: { subtype: "can_use_tool", tool_name: "Bash", input: { command: "npm test" }, tool_use_id: "tu-1", permission_suggestions: suggestions } });
  if (m.type === "control_response" && m.response.request_id === "ask-1") out({ type: "result", is_error: false, result: JSON.stringify(m.response.response) });
}
`);
const run = (suggestions, onApproval) => runClaudeStream(process.execPath, [fake, JSON.stringify(suggestions)], undefined, undefined, { prompt: "test", onApproval }).then(JSON.parse);

test("only saved, allow-type suggestions count for Always allow", () => {
  assert.deepEqual(savedPermissionSuggestions({ permission_suggestions: [RULE, { ...RULE, destination: "session" }, { ...RULE, behavior: "deny" }, null] }), [RULE]);
  assert.deepEqual(savedPermissionSuggestions({}), []);
});

test("Always allow sends Claude Code's own rule back as updatedPermissions", async () => {
  const seen = [];
  const reply = await run([RULE], async (card, extra) => { seen.push(extra); return "always"; });
  assert.deepEqual(seen, [{ canAlwaysAllow: true }]);
  assert.equal(reply.behavior, "allow");
  assert.deepEqual(reply.updatedPermissions, [RULE]);
});

test("Allow is this request only; Deny denies", async () => {
  const allow = await run([RULE], async () => "allow");
  assert.equal(allow.behavior, "allow");
  assert.equal(allow.updatedPermissions, undefined);
  assert.equal((await run([RULE], async () => "deny")).behavior, "deny");
});

test("Always allow without a provider rule is never widened to an allow", async () => {
  const seen = [];
  const reply = await run([{ ...RULE, destination: "session" }], async (card, extra) => { seen.push(extra); return "always"; });
  assert.deepEqual(seen, [{ canAlwaysAllow: false }]);
  assert.equal(reply.behavior, "deny");
});

test("the approval endpoint takes three decisions and refuses unsupported Always allow", () => {
  const settled = [];
  const card = (canAlwaysAllow) => ({ card: { id: "c1", canAlwaysAllow }, settle: (decision) => settled.push(decision) });
  assert.equal(answerApproval(undefined, { decision: "allow" }).status, 404);
  assert.equal(answerApproval(card(true), { decision: "maybe" }).status, 400);
  const refused = answerApproval(card(false), { decision: "always" });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.unsupported, true);
  assert.deepEqual(settled, [], "a refused Always allow leaves the card open");
  assert.deepEqual(answerApproval(card(true), { decision: "always" }).body, { id: "c1", decision: "always", allow: true });
  assert.equal(answerApproval(card(false), { decision: "allow" }).body.decision, "allow");
  assert.equal(answerApproval(card(false), { decision: "deny" }).body.allow, false);
  assert.equal(answerApproval(card(false), { allow: true }).body.decision, "allow", "older clients still work");
  assert.deepEqual(settled, ["always", "allow", "deny", "allow"]);
});
