// node --test test/*.test.mjs — a chat provider (local model) on a project route gets the selected skill's text,
// not just its file path, which it can't open.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const prompts = [];
const model = http.createServer(async (req, res) => {
  if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "fake" }] }));
  let body = "";
  for await (const chunk of req) body += chunk;
  prompts.push(JSON.parse(body).messages.at(-1).content);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: "ok" } }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const root = await mkdtemp(path.join(os.tmpdir(), "router-chat-skills-"));
const projects = path.join(root, "Projects");
await mkdir(path.join(projects, "alpha"), { recursive: true });
await writeFile(path.join(projects, "alpha", "app.js"), "// alpha-file\n");
Object.assign(process.env, { AGENT_ROUTER_RUFLO: "0", USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects, COLIBRI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1` });
const { startServer } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("project route on the local model inlines the skill text", async () => {
  await call("/api/settings", { projectsRoot: projects, localOnly: true });
  const added = await call("/api/skills", { name: "Marker", category: "Testing", instructions: "Marker skill.\n\nSKILL-BODY-MARKER always do the thing." });
  assert.ok(added.skill?.id, JSON.stringify(added));
  const response = await fetch(base + "/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "review alpha", projectId: "alpha", mode: "review", skillIds: [added.skill.id] }) });
  const text = await response.text();
  assert.match(text, /event: done/, text);
  const prompt = prompts.find((item) => item.includes("review alpha"));
  assert.ok(prompt, "the local model got the task");
  assert.match(prompt, /Project files \(1\):\napp\.js/, "project files are included");
  assert.match(prompt, /SKILL-BODY-MARKER/, "the skill text is inlined");
});

test.after(() => { server.close(); model.close(); });
