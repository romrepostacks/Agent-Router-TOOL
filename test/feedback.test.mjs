// node --test test/feedback.test.mjs — anonymous feedback: the diagnostics the app sends, and the relay that files the issue.
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import worker from "../feedback-relay/worker.js";

const root = await mkdtemp(path.join(os.tmpdir(), "router-feedback-"));
await mkdir(path.join(root, "Projects"), { recursive: true });
const received = [];
const fake = http.createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) });
  if (req.url.startsWith("/relay")) { // the app's relay, played by the worker itself
    const answer = await worker.fetch(new Request("http://x/", { method: "POST", body }), { GITHUB_TOKEN: "t0k", GITHUB_REPO: "o/r", GITHUB_API: `http://127.0.0.1:${fake.address().port}` });
    res.writeHead(answer.status); return res.end(await answer.text());
  }
  res.writeHead(201); res.end("{}");
});
await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
const secretKey = "sk-should-never-leave";
Object.assign(process.env, {
  USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: path.join(root, "Projects"),
  OPENAI_API_KEY: secretKey, COLIBRI_BASE_URL: "http://127.0.0.1:9/v1",
  AGENT_ROUTER_FEEDBACK_URL: `http://127.0.0.1:${fake.address().port}/relay`,
});
const { startServer } = await import("../server.mjs");
const router = await startServer(0);
const base = `http://127.0.0.1:${router.address().port}`;

test("diagnostics list models, providers, access type and machine specs, but no key, user or folder", async () => {
  const { relay, diagnostics } = await (await fetch(`${base}/api/feedback`)).json();
  assert.equal(relay, true);
  assert.equal(diagnostics.providers.openai.access, "API key");
  assert.equal(diagnostics.providers.openai.keySaved, true);
  assert.match(diagnostics.providers.claude.access, /subscription/);
  assert.equal(diagnostics.system.cores, os.cpus().length);
  assert.ok(diagnostics.system.memory.endsWith("GiB"));
  assert.ok(Array.isArray(diagnostics.routes.coding));
  const text = JSON.stringify(diagnostics);
  for (const secret of [secretKey, root, os.userInfo().username, os.hostname()]) assert.equal(text.includes(secret), false, secret);
});

test("Send feedback reaches GitHub through the relay without the user's account; mentions can't ping", async () => {
  const reply = await fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "Crash on load @someone ```" }) });
  assert.deepEqual(await reply.json(), { sent: true });
  const issue = received.find((item) => item.url === "/repos/o/r/issues");
  assert.equal(issue.auth, "Bearer t0k");
  assert.match(issue.body.title, /^\[feedback \d+\.\d+\.\d+\] Crash on load/);
  assert.match(issue.body.body, /^```\nCrash on load @someone '''\n```/);
  assert.match(issue.body.body, /"cores"/);
});

test("empty, oversized or non-POST feedback is refused", async () => {
  const post = (text) => fetch(`${base}/api/feedback`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  assert.equal((await post("  ")).status, 400);
  assert.equal((await worker.fetch(new Request("http://x/"), {})).status, 405);
  assert.equal((await worker.fetch(new Request("http://x/", { method: "POST", body: "x".repeat(40_000) }), {})).status, 413);
});

test.after(() => { router.close(); fake.close(); });
