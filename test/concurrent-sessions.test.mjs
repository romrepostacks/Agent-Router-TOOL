// node --test test/*.test.mjs — two sessions run at once; each finishes, streams and stops on its own.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Fake local model: each chat waits until the test releases it by the user's message text.
const waiting = new Map();
const model = http.createServer(async (req, res) => {
  if (req.url.endsWith("/models")) return res.end(JSON.stringify({ data: [{ id: "fake" }] }));
  let body = "";
  for await (const chunk of req) body += chunk;
  const prompt = JSON.parse(body).messages.at(-1).content;
  const key = ["alpha-task", "beta-task"].filter((name) => prompt.includes(name)).sort((a, b) => prompt.lastIndexOf(b) - prompt.lastIndexOf(a))[0];
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: `${key} started ` } }] })}\n\n`);
  waiting.set(key, (text) => res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`));
});
await new Promise((resolve) => model.listen(0, "127.0.0.1", resolve));

const root = await mkdtemp(path.join(os.tmpdir(), "router-concurrent-"));
const projects = path.join(root, "Projects");
for (const name of ["alpha", "beta"]) await mkdir(path.join(projects, name), { recursive: true });
Object.assign(process.env, { USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects, COLIBRI_BASE_URL: `http://127.0.0.1:${model.address().port}/v1` });
const { startServer } = await import("../server.mjs");
const server = await startServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

// Starts a streamed run and collects its events until it ends.
function stream(sessionId, projectId, message, delivery) {
  const events = [];
  const done = fetch(base + "/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, projectId, sessionId, mode: "quick", delivery }) })
    .then(async (response) => {
      if (!response.ok) return { status: response.status, ...(await response.json()) };
      for (const block of (await response.text()).split("\n\n").filter(Boolean)) {
        const [, name] = block.match(/^event: (\w+)/m);
        events.push({ name, value: JSON.parse(block.match(/^data: (.*)$/m)[1]) });
      }
      return events.at(-1);
    });
  return { events, done };
}
const until = async (check) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 10)); assert.ok(check()); };

test("two sessions run at once and finish independently", async () => {
  const a = await call("/api/sessions", { projectId: "alpha" });
  const b = await call("/api/sessions", { projectId: "beta" });
  const runA = stream(a.id, "alpha", "alpha-task");
  const runB = stream(b.id, "beta", "beta-task");
  await until(() => waiting.has("alpha-task") && waiting.has("beta-task"));

  const running = await call("/api/runs");
  assert.deepEqual(running.map((run) => run.sessionId).sort(), [a.id, b.id].sort());
  assert.equal(running.find((run) => run.sessionId === b.id).projectId, "beta");
  assert.ok((await call("/api/sessions")).filter((session) => session.running).length === 2);

  // A second run in a busy session is refused; switching to another session doesn't need one.
  const twice = await stream(a.id, "alpha", "alpha-task again").done;
  assert.equal(twice.status, 409);

  waiting.get("beta-task")("beta answer");
  const doneB = await runB.done;
  assert.equal(doneB.name, "done");
  assert.match(doneB.value.content, /beta-task started beta answer/);
  assert.doesNotMatch(doneB.value.content, /alpha/);
  assert.deepEqual((await call("/api/runs")).map((run) => run.sessionId), [a.id]);

  waiting.get("alpha-task")("alpha answer");
  const doneA = await runA.done;
  assert.match(doneA.value.content, /alpha-task started alpha answer/);
  assert.doesNotMatch(doneA.value.content, /beta/);
  assert.deepEqual(await call("/api/runs"), []);
});

test("cancelling one session leaves the other running", async () => {
  waiting.clear();
  const a = await call("/api/sessions", { projectId: "alpha" });
  const b = await call("/api/sessions", { projectId: "beta" });
  const runA = stream(a.id, "alpha", "alpha-task");
  const runB = stream(b.id, "beta", "beta-task");
  await until(() => waiting.has("alpha-task") && waiting.has("beta-task"));

  assert.equal((await call(`/api/runs/${a.id}/cancel`, {})).cancelled, true);
  const stopped = await runA.done;
  assert.equal(stopped.name, "error");
  assert.equal(stopped.value.cancelled, true);
  assert.deepEqual((await call("/api/runs")).map((run) => run.sessionId), [b.id]);
  assert.match((await call(`/api/runs/${a.id}/cancel`, {})).error, /isn't running/);

  waiting.get("beta-task")("still going");
  assert.match((await runB.done).value.content, /still going/);
});

test("a run survives its page closing and a new page can pick it up", async () => {
  waiting.clear();
  const a = await call("/api/sessions", { projectId: "alpha" });
  const page = new AbortController();
  const first = await fetch(base + "/api/chat/stream", { method: "POST", signal: page.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "alpha-task survive", projectId: "alpha", sessionId: a.id, mode: "quick", attachmentNames: ["notes.txt"] }) });
  assert.equal(first.status, 200);
  await until(() => waiting.has("alpha-task"));
  page.abort(); // the page reloads
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual((await call("/api/runs")).map((run) => run.sessionId), [a.id]);

  const again = fetch(base + `/api/runs/${a.id}/stream`).then((response) => response.text());
  await new Promise((resolve) => setTimeout(resolve, 50));
  waiting.get("alpha-task")("finished alone");
  const blocks = (await again).split("\n\n").filter(Boolean);
  assert.match(blocks[0], /^event: snapshot/);
  assert.match(blocks[0], /alpha-task started/);
  assert.match(blocks.at(-1), /^event: done[\s\S]*finished alone/);

  // Saved by the server, not the page.
  const saved = await call(`/api/sessions/${a.id}`);
  assert.deepEqual(saved.messages.map((message) => message.role), ["user", "assistant"]);
  assert.match(saved.messages[1].content, /finished alone/);
  assert.deepEqual(saved.messages[0].attachments, ["notes.txt"]);
  assert.deepEqual(await call("/api/runs"), []);
});

test("a stopped run stays listed so a reloaded page can show it", async () => {
  waiting.clear();
  const a = await call("/api/sessions", { projectId: "alpha" });
  const run = stream(a.id, "alpha", "alpha-task stop me");
  await until(() => waiting.has("alpha-task"));
  await call(`/api/runs/${a.id}/cancel`, {});
  await run.done;
  const all = await call("/api/runs?all");
  assert.equal(all.find((item) => item.sessionId === a.id).failed, true);
  assert.equal(all.find((item) => item.sessionId === a.id).request.message, "alpha-task stop me");
  assert.match(await (await fetch(base + `/api/runs/${a.id}/stream`)).text(), /event: error[\s\S]*"cancelled":true/);
  assert.equal((await call("/api/sessions")).find((session) => session.id === a.id).running, false);
});

test("unknown session ids can't start or cancel a run", async () => {
  assert.equal((await stream("not-a-session", "alpha", "alpha-task").done).status, 404);
  assert.match((await call("/api/runs/not-a-session/cancel", {})).error, /isn't running/);
});

test("a project being edited is read-only for other sessions", async () => {
  const { claimEditLock } = await import("../server.mjs");
  const editor = await call("/api/sessions", { projectId: "alpha" });
  const other = await call("/api/sessions", { projectId: "alpha" });
  const lock = claimEditLock({ path: path.join(projects, "alpha") }, editor.id);
  assert.ok(claimEditLock({ path: path.join(projects, "alpha") }).held, "a second edit lock on the same folder is refused");
  const beta = claimEditLock({ path: path.join(projects, "beta") });
  assert.ok(!beta.held, "another project can still be edited");
  beta.release();

  // Mode "code" hits the lock before any provider is called.
  const res = await fetch(base + "/api/chat/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "edit server.mjs", projectId: "alpha", sessionId: other.id, mode: "code" }) });
  const last = (await res.text()).split("\n\n").filter(Boolean).at(-1);
  assert.match(last, /^event: done[\s\S]*read-only[\s\S]*"route":"Project locked"/);

  lock.release();
  const again = claimEditLock({ path: path.join(projects, "alpha") }, other.id);
  assert.ok(!again.held, "the lock is free once the editing run ends");
  again.release();
});

test("results saved at the same moment are both kept", async () => {
  const a = await call("/api/sessions", { projectId: "alpha" });
  const b = await call("/api/sessions", { projectId: "beta" });
  await Promise.all([a, b, a, b].map((session, index) => call(`/api/sessions/${session.id}/messages`, { user: `q${index}`, assistant: `a${index}`, route: "Quick questions" })));
  assert.equal((await call(`/api/sessions/${a.id}`)).messages.length, 4);
  assert.equal((await call(`/api/sessions/${b.id}`)).messages.length, 4);
});

test("queued messages run in order with saved history", async () => {
  waiting.clear();
  const session = await call("/api/sessions", { projectId: "alpha" });
  const first = stream(session.id, "alpha", "alpha-task");
  await until(() => waiting.has("alpha-task"));
  const queued = stream(session.id, "alpha", "beta-task", "queue");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(waiting.has("beta-task"), false);
  waiting.get("alpha-task")("first done");
  await first.done;
  await until(() => waiting.has("beta-task"));
  waiting.get("beta-task")("second done");
  assert.equal((await queued.done).name, "done");
  const saved = await call(`/api/sessions/${session.id}`);
  assert.deepEqual(saved.messages.filter((m) => m.role === "user").map((m) => m.content), ["alpha-task", "beta-task"]);
});

test("multiple queued messages serialize without a busy-session rejection", async () => {
  waiting.clear();
  const session = await call("/api/sessions", { projectId: "alpha" });
  const first = stream(session.id, "alpha", "alpha-task");
  await until(() => waiting.has("alpha-task"));
  const second = stream(session.id, "alpha", "beta-task second", "queue");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const third = stream(session.id, "alpha", "alpha-task third", "queue");
  waiting.get("alpha-task")("first"); waiting.delete("alpha-task");
  await first.done; await until(() => waiting.has("beta-task"));
  assert.equal(waiting.has("alpha-task"), false);
  waiting.get("beta-task")("second"); await second.done;
  await until(() => waiting.has("alpha-task")); waiting.get("alpha-task")("third");
  assert.equal((await third.done).name, "done");
  assert.equal((await call(`/api/sessions/${session.id}`)).messages.length, 6);
});

test("steering stops the old run before starting the correction", async () => {
  waiting.clear();
  const session = await call("/api/sessions", { projectId: "alpha" });
  const first = stream(session.id, "alpha", "alpha-task");
  await until(() => waiting.has("alpha-task"));
  waiting.delete("alpha-task");
  const steering = stream(session.id, "alpha", "use smaller output", "steer");
  assert.equal((await first.done).value.cancelled, true);
  await until(() => waiting.has("alpha-task"));
  waiting.get("alpha-task")("corrected");
  assert.equal((await steering.done).name, "done");
  const saved = await call(`/api/sessions/${session.id}`);
  assert.match(saved.messages[0].content, /Original task:[\s\S]*alpha-task[\s\S]*Correction:[\s\S]*use smaller output/);
});

test.after(() => { server.close(); model.close(); });
