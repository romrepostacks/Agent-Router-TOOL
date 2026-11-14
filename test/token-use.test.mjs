// node --test test/*.test.mjs — token use per provider and call, from each provider's own usage report.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { runClaudeStream } from "../cli-runner.mjs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-token-use-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { recordTokenUse, runTokens, codexTokens, openAiUsage, tokenSummary } = await import("../server.mjs");

test("Claude Code's result event usage is reported, cache reads and writes counted as input", async () => {
  const fake = path.join(root, "fake-claude.mjs");
  await writeFile(fake, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type === "control_request") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
  if (m.type === "user") out({ type: "result", is_error: false, result: "ok", usage: { input_tokens: 10, cache_read_input_tokens: 8000, cache_creation_input_tokens: 1000, output_tokens: 250 } });
}
`);
  const seen = [];
  assert.equal(await runClaudeStream(process.execPath, [fake], undefined, undefined, { prompt: "hi", onUsage: (u) => seen.push(u) }), "ok");
  assert.deepEqual(seen, [{ input: 9010, cached: 8000, output: 250 }]);
});

test("Codex token totals come from its last 'tokens used' line, both layouts", () => {
  assert.deepEqual(codexTokens("codex\nanswer\ntokens used\n12,345\n"), { total: 12345 });
  assert.deepEqual(codexTokens("[2026-01-01T00:00:00] tokens used: 900\n...\n[2026-01-01T00:01:00] tokens used: 1500"), { total: 1500 });
  assert.equal(codexTokens("exec\nGet-Content notes.md"), null);
});

test("OpenAI-style usage is normalised; missing usage is null", () => {
  assert.deepEqual(openAiUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 64 } }), { input: 100, cached: 64, output: 20 });
  assert.equal(openAiUsage(undefined), null);
  assert.equal(tokenSummary({ input: 1200, cached: 1000, output: 30 }), "1,200 tokens in (1,000 cached), 30 out");
  assert.equal(tokenSummary({ total: 5000 }), "5,000 tokens");
});

test("records calls per provider and model; unreported calls count as calls only", async () => {
  const file = path.join(root, "stats", "token-use.json");
  const calls = [
    { provider: "claude", model: "opus", input: 9000, cached: 8000, output: 300 },
    { provider: "codex", model: "", total: 4000 },
    { provider: "copilot", model: "" },
  ];
  assert.equal(runTokens(calls), 13300);
  assert.equal(runTokens([{ provider: "copilot" }]), null);
  await Promise.all([recordTokenUse(calls, file), recordTokenUse([calls[0]], file)]);
  const stats = JSON.parse(await readFile(file, "utf8"));
  const strip = ({ lastAt, ...rest }) => rest;
  assert.deepEqual(strip(stats["claude::opus"]), { calls: 2, measured: 2, input: 18000, cached: 16000, output: 600, total: 18600 });
  assert.deepEqual(strip(stats.codex), { calls: 1, measured: 1, input: 0, cached: 0, output: 0, total: 4000 });
  assert.deepEqual(strip(stats.copilot), { calls: 1, measured: 0, input: 0, cached: 0, output: 0, total: 0 });
});
