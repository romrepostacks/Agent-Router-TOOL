// node --test test/*.test.mjs — per-skill usage stats: only skills a run actually opened count as used.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-skill-stats-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { recordSkillUse, skillUseWatcher } = await import("../server.mjs");

test("counts sent per skill, and runs, outcomes and prompt size only for used skills", async () => {
  const file = path.join(root, "stats", "skill-use.json");
  await Promise.all([
    recordSkillUse(["a/one", "b/two"], ["a/one"], "done", 1000, file),
    recordSkillUse(["a/one", "b/two"], ["a/one"], "failed", 500, file),
  ]);
  await recordSkillUse(["a/one"], ["a/one", "c/not-sent"], "stopped", 250, file); // unsent ids ignored
  await recordSkillUse([], ["a/one"], "done", 9999, file); // nothing sent: nothing recorded
  await recordSkillUse(["a/one"], ["a/one"], "weird", 9999, file); // unknown outcome ignored
  const stats = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual({ ...stats["a/one"], lastUsed: undefined }, { sent: 3, runs: 3, done: 1, failed: 1, stopped: 1, promptChars: 1750, lastUsed: undefined });
  assert.deepEqual(stats["b/two"], { sent: 2, runs: 0, done: 0, failed: 0, stopped: 0, promptChars: 0 });
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
// a decoy is only listed. runProviderTask() feeds Claude Code tool calls as "▸ <tool> <path>" lines; Codex's
// `codex exec` echoes the prompt on stderr, then prints each command it runs.
const dir = "C:\\Users\\me\\AppData\\Local\\LocalAgentRouterData\\skills";
const liveSkills = () => [
  { id: "general/router-canary", file: `${dir}\\user-created\\general\\router-canary.md` },
  { id: "general/router-decoy", file: `${dir}\\user-created\\general\\router-decoy.md` },
  { id: "eng/review", file: `${dir}\\synced\\review\\SKILL.md` },
];
const index = `<shared-skills>\n- Router canary (General): canary check — ${dir}\\user-created\\general\\router-canary.md\n- Router decoy (General): decoy check — ${dir}\\user-created\\general\\router-decoy.md\n- Review (Eng): reviews code — ${dir}\\synced\\review\\SKILL.md\n</shared-skills>\n`;

test("Claude Code run: Read of the canary counts; Glob/Grep over the skills folder does not", () => {
  const watcher = skillUseWatcher(liveSkills());
  watcher.see(`\n── Claude Code · opus ──\n`);
  watcher.see(`▸ Glob ${dir}\\**\\*.md\n`);
  watcher.see(`▸ Grep canary\n`);
  watcher.see(`▸ Read ${dir}\\user-created\\general\\router-canary.md\n`);
  watcher.see("The code word is PINEAPPLE-42.\n");
  assert.deepEqual([...watcher.used], ["general/router-canary"]);
});

test("Codex run: prompt echo is ignored; the PowerShell read of the canary counts", () => {
  const watcher = skillUseWatcher(liveSkills());
  watcher.see(`OpenAI Codex v0.x (research preview)\n--------\nworkdir: C:\\Users\\me\\Projects\\agent-router\n--------\nuser\nTask:\ncanary check\n${index}`);
  watcher.see(`thinking\nThe canary skill applies; reading it.\n`);
  watcher.see(`exec\n"C:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -Command "Get-Content -Raw '${dir}\\user-created\\general\\router-canary.md'" in C:\\Users\\me\\Projects\\agent-router\n succeeded in 210ms:\n`);
  watcher.see("codex\nThe code word is PINEAPPLE-42.\n");
  assert.deepEqual([...watcher.used], ["general/router-canary"]);
});

// Known gap: answer text goes to the activity feed too (runProviderTask's onDelta/onText), so an answer that quotes
// a skill's path from the index counts as use without the file being opened.
test("an answer that only cites a skill's path is not use", { todo: "watch tool lines only, not answer text" }, () => {
  const watcher = skillUseWatcher(liveSkills());
  watcher.see(`I'd follow the review skill at ${dir}\\synced\\review\\SKILL.md.\n`);
  assert.deepEqual([...watcher.used], []);
});
