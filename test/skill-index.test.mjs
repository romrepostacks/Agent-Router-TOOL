// node --test test/*.test.mjs — skills go out as a linked index; chat providers get the text inlined, capped.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-skills-"));
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { expandSkillIndex } = await import("../server.mjs");

test("inlines skill files from the skills folder and leaves other paths alone", async () => {
  const dir = path.join(root, "skills");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "tdd.md");
  await writeFile(file, "Write the failing test first. ".repeat(50), "utf8");
  const outside = path.join(root, "secret.md");
  await writeFile(outside, "do not inline", "utf8");
  const prompt = `Task.\n\n<shared-skills>\nRead a skill's file only when it applies to this task:\n- tdd (Coding): tests first — ${file}\n- evil (X): y — ${outside}\n</shared-skills>\nEnd.`;
  const out = await expandSkillIndex(prompt, 100, dir);
  assert.match(out, /- tdd \(Coding\): tests first\n<shared-skill>\nWrite the failing test first\./);
  assert.ok(!out.includes(file), "the path is replaced by the text");
  assert.ok(out.includes(outside) && !out.includes("do not inline"), "files outside the skills folder are never read");
  assert.ok(out.split("<shared-skill>\n")[1].split("\n</shared-skill>")[0].length <= 100, "text is capped");
  assert.ok(out.startsWith("Task.") && out.endsWith("</shared-skills>\nEnd."));
  assert.equal(await expandSkillIndex("no skills here", 100, dir), "no skills here");
});
