// node --test test/*.test.mjs — per-skill usage stats: runs, outcomes and prompt characters add up per skill.
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-skill-stats-"));
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { recordSkillUse } = await import("../server.mjs");

test("counts runs, outcomes and prompt size per skill", async () => {
  const file = path.join(root, "stats", "skill-stats.json");
  await Promise.all([
    recordSkillUse(["a/one", "b/two"], "done", 1000, file),
    recordSkillUse(["a/one"], "failed", 500, file),
  ]);
  await recordSkillUse(["a/one"], "stopped", 250, file);
  await recordSkillUse([], "done", 9999, file); // nothing selected: nothing recorded
  await recordSkillUse(["a/one"], "weird", 9999, file); // unknown outcome ignored
  const stats = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual({ ...stats["a/one"], lastUsed: undefined }, { runs: 3, done: 1, failed: 1, stopped: 1, promptChars: 1750, lastUsed: undefined });
  assert.equal(stats["b/two"].runs, 1);
  assert.equal(stats["b/two"].promptChars, 1000);
});
