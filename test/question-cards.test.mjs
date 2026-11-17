// node --test test/  — Claude's AskUserQuestion reaches the user as a question card (questions + answer choices),
// and the answers go back to Claude as the tool's `answers` input. Skill families fold their members into one skill.
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { runClaudeStream } from "../cli-runner.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "router-questions-"));
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: path.join(root, "Projects") });
const { answerApproval, approvalQuestions, approvalTitle, approvalDetail, skillFamilies } = await import("../server.mjs");

const INPUT = { questions: [
  { question: "Which database?", header: "DB", multiSelect: false, options: [{ label: "Postgres", description: "Managed" }, { label: "SQLite" }] },
  { question: "Which extras?", header: "Extras", multiSelect: true, options: [{ label: "Auth" }, { label: "Billing" }] },
] };

test("an AskUserQuestion card carries its questions and options", () => {
  const questions = approvalQuestions("AskUserQuestion", INPUT);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions[0].options, [{ label: "Postgres", description: "Managed" }, { label: "SQLite" }]);
  assert.equal(questions[1].multiSelect, true);
  assert.equal(approvalQuestions("Bash", INPUT), null);
  assert.equal(approvalQuestions("AskUserQuestion", { questions: [] }), null);
  assert.equal(approvalTitle("AskUserQuestion", INPUT), "Claude has a question");
  assert.match(approvalDetail("AskUserQuestion", INPUT), /Which database\?\n- Postgres: Managed\n- SQLite/);
});

test("a long question keeps its full text, since Claude reads the answer back by it", () => {
  const question = `${"x".repeat(1500)}?`;
  assert.equal(approvalQuestions("AskUserQuestion", { questions: [{ question, options: [] }] })[0].question, question);
});

test("a question card needs every answer, or Skip", () => {
  const settled = [];
  const pending = { card: { id: "q1", canAlwaysAllow: false, questions: approvalQuestions("AskUserQuestion", INPUT) }, settle: (...args) => settled.push(args) };
  assert.equal(answerApproval(pending, { decision: "allow", answers: { "Which database?": "Postgres" } }).status, 400);
  assert.equal(answerApproval(pending, { decision: "allow" }).status, 400);
  assert.deepEqual(settled, []);
  const ok = answerApproval(pending, { decision: "allow", answers: { "Which database?": " Postgres ", "Which extras?": "Auth, Billing", extra: "ignored" } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.answered, true);
  assert.deepEqual(settled.pop(), ["allow", { "Which database?": "Postgres", "Which extras?": "Auth, Billing" }]);
  assert.equal(answerApproval(pending, { decision: "deny" }).status, 200);
  assert.deepEqual(settled.pop(), ["deny"]);
});

test("answers reach Claude Code as AskUserQuestion's answers input", async () => {
  const fake = path.join(root, "fake-claude.mjs");
  await writeFile(fake, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type === "control_request" && m.request.subtype === "initialize") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
  if (m.type === "user") out({ type: "control_request", request_id: "ask-1", request: { subtype: "can_use_tool", tool_name: "AskUserQuestion", input: ${JSON.stringify(INPUT)}, tool_use_id: "tu-1" } });
  if (m.type === "control_response" && m.response.request_id === "ask-1") out({ type: "result", is_error: false, result: JSON.stringify(m.response.response) });
}
`);
  const answers = { "Which database?": "SQLite", "Which extras?": "Auth" };
  const reply = JSON.parse(await runClaudeStream(process.execPath, [fake], undefined, undefined, { prompt: "test", onApproval: async () => ({ decision: "allow", answers }) }));
  assert.equal(reply.behavior, "allow");
  assert.deepEqual(reply.updatedInput, { ...INPUT, answers });
});

for (const file of ["public/app.js", "mobile/www/app.js"]) {
  test(`${file}: questionAnswers needs every question; multi-select and Other join`, async () => {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const pick = (name) => source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}\\r?$`, "m"))[0];
    const context = {};
    vm.runInNewContext(`${pick("questionAnswers")}\n${pick("approvalBody")}\nthis.questionAnswers = questionAnswers; this.approvalBody = approvalBody;`, context);
    const { questions } = INPUT;
    assert.equal(context.questionAnswers(questions, { "Which database?": { labels: ["SQLite"] } }), null);
    assert.deepEqual(JSON.parse(JSON.stringify(context.questionAnswers(questions, { "Which database?": { labels: [], other: " DuckDB " }, "Which extras?": { labels: ["Auth", "Billing"], other: "" } }))),
      { "Which database?": "DuckDB", "Which extras?": "Auth, Billing" });
    assert.deepEqual(JSON.parse(JSON.stringify(context.approvalBody("allow", { a: "b" }))), { decision: "allow", allow: true, answers: { a: "b" } });
  });
}

test("a skill family is one skill; members listed on their own fold into it", () => {
  const base = path.join(root, "data");
  const resolve = (file) => path.resolve(base, file);
  const family = { id: "planning/replica", name: "replica", file: "skills/user-created/replica/SKILL.md", instructions: "# replica\n\n## Child guidance\n\n- [replica-brand](../../imported/x/replica-brand.md)\n- [replica-build](../../imported/x/replica-build.md)\n" };
  const child = { id: "planning/replica-brand", name: "replica-brand", file: "skills/imported/x/replica-brand.md", instructions: "brand" };
  const other = { id: "general/imagegen", name: "imagegen", file: "skills/imported/codex/imagegen.md", instructions: "images" };
  const { skills, familyOf } = skillFamilies([family, child, other], resolve);
  assert.deepEqual(skills.map((skill) => skill.id), ["planning/replica", "general/imagegen"]);
  assert.deepEqual(skills[0].members.map((member) => member.name), ["replica-brand", "replica-build"]);
  assert.equal(skills[0].members[1].file, path.resolve(base, "skills/imported/x/replica-build.md"));
  assert.equal(familyOf.get("planning/replica-brand"), "planning/replica");
  assert.equal(familyOf.has("general/imagegen"), false);
});
