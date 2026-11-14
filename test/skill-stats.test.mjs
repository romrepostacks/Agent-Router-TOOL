// node --test test/*.test.mjs — per-skill usage stats: only skills a run actually opened count as used.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-skill-stats-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { recordSkillUse, skillUseWatcher, cliToolText } = await import("../server.mjs");

test("counts sent per skill, and runs, outcomes and prompt size only for used skills", async () => {
  const file = path.join(root, "stats", "skill-use.json");
  await Promise.all([
    recordSkillUse(["a/one", "b/two"], ["a/one"], "done", { promptChars: 1000, tokens: 4000 }, file),
    recordSkillUse(["a/one", "b/two"], ["a/one"], "failed", { promptChars: 500, tokens: 2000 }, file),
  ]);
  await recordSkillUse(["a/one"], ["a/one", "c/not-sent"], "stopped", { promptChars: 250, tokens: null }, file); // unsent ids ignored; no token report
  await recordSkillUse([], ["a/one"], "done", { promptChars: 9999 }, file); // nothing sent: nothing recorded
  await recordSkillUse(["a/one"], ["a/one"], "weird", { promptChars: 9999 }, file); // unknown outcome ignored
  const stats = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual({ ...stats["a/one"], lastUsed: undefined }, { sent: 3, runs: 3, done: 1, failed: 1, stopped: 1, promptChars: 1750, tokens: 6000, tokenRuns: 2, lastUsed: undefined });
  assert.deepEqual(stats["b/two"], { sent: 2, runs: 0, done: 0, failed: 0, stopped: 0, promptChars: 0, tokens: 0, tokenRuns: 0 });
  assert.equal(stats["c/not-sent"], undefined);
});

test("a skill counts as used only when its file is opened, not when the index is echoed", () => {
  const dir = "C:\\Data\\skills";
  const watcher = skillUseWatcher([
    { id: "eng/review", file: `${dir}\\synced\\review\\SKILL.md` },
    { id: "eng/caveman", file: `${dir}\\caveman\\SKILL.md` },
    { id: "gen/notes", file: `${dir}\\user-created\\general\\notes.md` },
    { id: "old/inline", file: "" },
  ]);
  // Codex echoes the prompt, index lines included: not use.
  watcher.see(`- Review (Eng): reviews code — ${dir}\\synced\\review\\SKILL.md\n- Caveman (Eng): terse — ${dir}\\caveman\\SKILL.md\n`);
  assert.deepEqual([...watcher.used], []);
  // Claude Code's Read tool line, split across two chunks.
  watcher.see("▸ Read C:\\Data\\skills\\synced\\rev");
  watcher.see("iew\\SKILL.md\n");
  // A folder skill's reference file counts too; JSON-escaped backslashes still match.
  watcher.see('exec: Get-Content "C:\\\\Data\\\\skills\\\\caveman\\\\references\\\\style.md"');
  assert.deepEqual([...watcher.used].sort(), ["eng/caveman", "eng/review"]);
  watcher.see(`cat c:/data/skills/user-created/general/notes.md`);
  assert.ok(watcher.used.has("gen/notes"));
});

// Shapes of real provider output for the live check in test/skill-tracking-live.md: a canary skill is opened,
// a decoy is only listed. runProviderTask() passes the watcher Claude Code tool calls as "<tool> <input JSON>";
// Codex's `codex exec` echoes the prompt on stderr and prints its answer there too, so only `exec` commands count.
const dir = "C:\\Users\\me\\AppData\\Local\\LocalAgentRouterData\\skills";
const liveSkills = () => [
  { id: "general/router-canary", file: `${dir}\\user-created\\general\\router-canary.md` },
  { id: "general/router-decoy", file: `${dir}\\user-created\\general\\router-decoy.md` },
  { id: "eng/review", file: `${dir}\\synced\\review\\SKILL.md` },
];
const index = `<shared-skills>\n- Router canary (General): canary check — ${dir}\\user-created\\general\\router-canary.md\n- Router decoy (General): decoy check — ${dir}\\user-created\\general\\router-decoy.md\n- Review (Eng): reviews code — ${dir}\\synced\\review\\SKILL.md\n</shared-skills>\n`;

test("Claude Code run: Read of the canary counts; Glob/Grep over the skills folder does not", () => {
  const watcher = skillUseWatcher(liveSkills());
  const tool = (name, input) => watcher.see(`${name} ${JSON.stringify(input)}`);
  tool("Glob", { pattern: "**/*.md", path: dir });
  tool("Grep", { pattern: "canary", path: dir });
  tool("Read", { file_path: `${dir}\\user-created\\general\\router-canary.md` });
  assert.deepEqual([...watcher.used], ["general/router-canary"]);
});

// Codex stderr, as runCli hands it over in chunks (one split mid-command).
const codexStderr = (answer) => [
  `OpenAI Codex v0.x (research preview)\n--------\nworkdir: C:\\Users\\me\\Projects\\agent-router\n--------\nuser\nTask:\ncanary check\n${index}`,
  `thinking\nThe canary skill applies; reading it at ${dir}\\user-created\\general\\router-canary.md.\n`,
  `exec\n"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Content -Raw '${dir}\\user-created\\gen`,
  `eral\\router-canary.md'" in C:\\Users\\me\\Projects\\agent-router\n succeeded in 210ms:\nsee also ${dir}\\user-created\\general\\router-decoy.md\n`,
  `codex\n${answer}\n`,
];

test("Codex run: only exec commands count, not the prompt echo, reasoning, command output or answer", () => {
  const watcher = skillUseWatcher(liveSkills());
  const toolText = cliToolText("codex");
  for (const chunk of codexStderr(`The code word is PINEAPPLE-42. The review skill is at ${dir}\\synced\\review\\SKILL.md.`)) watcher.see(toolText(chunk));
  assert.deepEqual([...watcher.used], ["general/router-canary"]);
});

test("Codex: older one-line `[ts] exec <cmd>` format counts too", () => {
  const watcher = skillUseWatcher(liveSkills());
  watcher.see(cliToolText("codex")(`[2025-01-01T00:00:00] exec bash -lc 'cat ${dir}/synced/review/SKILL.md' in /repo\n`));
  assert.deepEqual([...watcher.used], ["eng/review"]);
});