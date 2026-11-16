import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isUsageLimitError, runClaudeStream } from "../cli-runner.mjs";
const source = (await readFile(new URL("../server.mjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const roleSource = source.slice(source.indexOf("async function runRoleTask("), source.indexOf("// Edits go straight"));
function roleRunner(settings, invoke, statuses = []) {
  return new Function("readSettings", "roleChoices", "runProviderTask", "providerReady", "readyProviders", "bestChoice", "choiceParts", "isUsageLimitError", "PROVIDER_NAMES", "errorTail", "availableModelCatalog", `${roleSource}; return runRoleTask;`)(
    async () => settings, s => ({ primary: s.primary, fallback: s.fallback || "" }), invoke,
    async () => true, async () => new Set(["claude", "codex", "copilot"]), (role, ready) => `${[...ready][0]}::auto`,
    choice => { const [provider, model] = String(choice).split("::"); return { provider, model }; },
    isUsageLimitError, { claude: "Claude", codex: "Codex", copilot: "Copilot" }, e => e.message,
    async () => ({ all: [{ id: "claude::opus" }, { id: "copilot::auto" }] }));
}
test("limit text triggers fallback instead of being saved as successful work", async () => {
  const calls = [];
  const run = roleRunner({ primary: "claude::opus", fallback: "codex::auto" }, async choice => {
    calls.push(choice); return calls.length === 1 ? "You've hit your 5-hour limit · resets 7pm" : "completed";
  });
  assert.equal(await run("coding", "claude::opus", "task", null, "code"), "completed");
  assert.deepEqual(calls, ["claude::opus", "codex::auto"]);
});
test("Ruflo continuation skips its exhausted host, including a configured Claude fallback", async () => {
  const calls = [];
  const run = roleRunner({ primary: "claude::opus", fallback: "claude::sonnet" }, async choice => { calls.push(choice); return "completed"; });
  await run("coding", "claude::opus", "task", null, "code", { failedProvider: "claude" });
  assert.deepEqual(calls, ["codex::auto"]);
});
test("Ruflo switches routers only on usage limits and preserves run options", async () => {
  const start = source.indexOf('  if (options.ruflo && !options.failedProvider)');
  const block = source.slice(start, source.indexOf('  if (route === "chain")', start));
  for (const failure of ["You've hit your 5-hour limit", "coordination unavailable", "stopped"]) {
    const options = { ruflo: true, signal: { aborted: failure === "stopped" }, editLock: {}, staged: true };
    let retries = 0;
    const run = new Function("isUsageLimitError", "implementWithRole", "runRoute", `return async function(options) { const route="code", task="task", project={}, skillText="", localSkillText="", messages=[], via=""; ${block} };`)(isUsageLimitError,
      async () => { throw Error(failure); }, async (...args) => { retries++; assert.equal(args[5].failedProvider, "claude"); assert.equal(args[5].editLock, options.editLock); assert.equal(args[5].signal, options.signal); assert.equal(args[5].staged, true); return "continued"; });
    if (failure.startsWith("You've")) assert.equal(await run(options), "continued");
    else await assert.rejects(run(options), new RegExp(failure));
    assert.equal(retries, failure.startsWith("You've") ? 1 : 0);
  }
});

test("Claude streamed limits trigger fallback on error, nonzero exit and limit-only success", async () => {
  for (const [isError, exitCode] of [[true, 0], [true, 1], [false, 0]]) {
    const calls = [], statuses = [], usage = [];
    const options = { onStatus: value => statuses.push(value), onUsage: value => usage.push(value) };
    const result = { type: "result", is_error: isError, result: "You've hit your 5-hour limit", usage: { input_tokens: 10, output_tokens: 2 } };
    // Real child process, synthetic Claude protocol; no account or app-data access.
    const script = `process.stdin.once('data', () => { process.stdout.write(${JSON.stringify(JSON.stringify(result) + "\n")}); process.exitCode = ${exitCode}; process.stdin.resume(); });`;
    const run = roleRunner({ primary: "claude::opus", fallback: "codex::auto" }, async (choice, prompt, project, kind, forwarded) => {
      calls.push(choice);
      assert.equal(forwarded, options);
      return choice.startsWith("claude::")
        ? runClaudeStream(process.execPath, ["-e", script, "--"], process.cwd(), {}, { prompt, onUsage: forwarded.onUsage })
        : "completed by fallback";
    });
    assert.equal(await run("coding", "claude::opus", "task", null, "code", options), "completed by fallback");
    assert.deepEqual(calls, ["claude::opus", "codex::auto"]);
    assert.ok(statuses.some(value => /usage limit.*retrying with Codex/.test(value)));
    assert.equal(usage.length, 1);
  }
});

test("cancellation never starts fallback even when the error is a usage limit", async () => {
  const controller = new AbortController(), calls = [];
  const run = roleRunner({ primary: "claude::opus", fallback: "codex::auto" }, async choice => {
    calls.push(choice);
    controller.abort();
    throw Error("You've hit your 5-hour limit");
  });
  await assert.rejects(run("coding", "claude::opus", "task", null, "code", { signal: controller.signal }), /5-hour limit/);
  assert.deepEqual(calls, ["claude::opus"]);
});
