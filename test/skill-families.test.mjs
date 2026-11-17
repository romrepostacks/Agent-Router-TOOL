// node --test test/*.test.mjs — skill families: the project's own skills.md and folding edge cases.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-families-"));
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local") });
const { skillFamilies } = await import("../server.mjs");
const project = path.resolve(import.meta.dirname, "..");

test("the project's skills.md lists each family once and every member exists", () => {
  const resolve = (file) => path.resolve(project, file);
  const skills = [...readFileSync(path.join(project, "skills.md"), "utf8").matchAll(/^- \[([^\]]+)\]\(([^)]+)\)/gm)]
    .map(([, name, file]) => ({ id: name, name, file, instructions: readFileSync(resolve(file), "utf8") }));
  const { skills: shown, familyOf } = skillFamilies(skills, resolve);
  const families = shown.filter((skill) => skill.members);
  assert.deepEqual(families.map((skill) => skill.name).sort(), ["caveman", "comfy", "compliance", "context-mode", "replica", "static-analysis"]);
  for (const family of families) for (const member of family.members) assert.ok(existsSync(member.file), `${family.name}: ${member.file}`);
  assert.equal(familyOf.size, 0, `listed on their own: ${[...familyOf.keys()]}`);
  // Every imported file belongs to exactly one family or is listed on its own.
  const used = [...shown.map((skill) => resolve(skill.file)), ...families.flatMap((family) => family.members.map((member) => member.file))];
  assert.equal(new Set(used.map((file) => file.toLowerCase())).size, used.length, "a file is listed twice");
});

test("CRLF files and case-different paths fold into the family", () => {
  const resolve = (file) => path.resolve(root, file);
  const family = { id: "x/fam", name: "fam", file: "skills/fam/SKILL.md", instructions: "# fam\r\n\r\n## Child guidance\r\n\r\n- [a](../A.md)\r\n- [b](../b.md)\r\n" };
  const a = { id: "x/a", name: "a", file: "skills/a.md", instructions: "a" };
  const { skills, familyOf } = skillFamilies([family, a], resolve);
  assert.deepEqual(skills.map((skill) => skill.id), ["x/fam"]);
  assert.deepEqual(skills[0].members.map((member) => member.name), ["a", "b"]);
  assert.equal(familyOf.get("x/a"), "x/fam");
});
