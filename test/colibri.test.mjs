// node --test test/*.test.mjs — installed Colibri models load on demand; Local models only never leaves Colibri.
// A fake Colibri: setup.json + model folders like the standard install, a fake `coli` (run with node instead of
// python) that stops/starts a fake OpenAI-compatible server, which answers as whichever model folder it loaded.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "router-colibri-"));
const home = path.join(root, "colibri-home"), models = path.join(root, "colibri-models");
for (const [name, marker] of [["alpha", "config.json"], ["beta", "gguf.json"], ["gamma", "model_index.json"], ["junk", "readme.txt"], [".hidden", "config.json"]]) {
  await mkdir(path.join(models, name), { recursive: true });
  await writeFile(path.join(models, name, marker), "{}");
}
await mkdir(home, { recursive: true });

// The fake server: /health and /v1/* only while a model is loaded; loading takes a moment, like the real one.
let loaded = null, loading = null;
const log = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/_control/stop") { loaded = null; return res.end("ok"); }
  if (url.pathname === "/_control/load") {
    loading = path.basename(url.searchParams.get("dir"));
    setTimeout(() => { loaded = loading; log.push(`load ${loaded}`); }, 150);
    return res.end("ok");
  }
  if (!loaded) { res.writeHead(503); return res.end(); }
  if (url.pathname === "/health") return res.end(JSON.stringify({ status: "ok" }));
  if (url.pathname === "/v1/models") return res.end(JSON.stringify({ data: [{ id: `served-${loaded}` }] }));
  let body = "";
  for await (const chunk of req) body += chunk;
  const prompt = JSON.parse(body).messages.at(-1).content;
  const answer = /ROUTE:/.test(prompt) ? "ROUTE: REVIEW" : `answer from ${loaded}`;
  log.push(`chat ${loaded}`);
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\ndata: [DONE]\n\n`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;

const coli = path.join(root, "coli.mjs");
await writeFile(coli, `import { readFile, writeFile } from "node:fs/promises";
const [cmd, ...rest] = process.argv.slice(2);
const cfgFile = ${JSON.stringify(path.join(home, "setup.json"))};
if (cmd === "stop") { await fetch("http://127.0.0.1:${port}/_control/stop"); process.exit(0); }
if (cmd === "setup") {
  const dir = rest[rest.indexOf("--model-dir") + 1];
  const cfg = JSON.parse(await readFile(cfgFile, "utf8"));
  await writeFile(cfgFile, JSON.stringify({ ...cfg, model_dir: dir }));
  await fetch("http://127.0.0.1:${port}/_control/load?dir=" + encodeURIComponent(dir));
}
`);
await writeFile(path.join(home, "setup.json"), JSON.stringify({ version: 1, model_dir: path.join(models, "alpha"), launcher: coli, host: "127.0.0.1", port }));
await fetch(`http://127.0.0.1:${port}/_control/load?dir=alpha`);
await new Promise((resolve) => setTimeout(resolve, 200));

const projects = path.join(root, "Projects");
await mkdir(path.join(projects, "demo"), { recursive: true });
const cliMarker = path.join(root, "cloud-cli-ran");
const fakeCli = path.join(root, "fake-cli.mjs");
await writeFile(fakeCli, `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(cliMarker)}, "ran"); console.log("ROUTE: REVIEW");`);
Object.assign(process.env, {
  USERPROFILE: root, HOME: root, LOCALAPPDATA: path.join(root, "local"), AGENT_ROUTER_PROJECTS_ROOT: projects,
  CODEX_CLI: fakeCli, CLAUDE_CLI: fakeCli, COPILOT_CLI: fakeCli, // a cloud CLI that runs leaves a marker file
  COLI_SETUP_HOME: home, COLIBRI_PYTHON: process.execPath, COLIBRI_BASE_URL: `http://127.0.0.1:${port}/v1`,
});
const { colibriGate, colibriModels, colibriSetup, managerScript, switchCommands } = await import("../colibri.mjs");
const { startServer } = await import("../server.mjs");
const router = await startServer(0);
const base = `http://127.0.0.1:${router.address().port}`;
const call = async (url, body) => (await fetch(base + url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();

test("lists installed model folders like Colibri's Models page", async () => {
  const listed = await colibriModels(await colibriSetup());
  assert.deepEqual(listed.map((model) => [model.name, model.inUse]), [["alpha", true], ["beta", false], ["gamma", false]]);
  assert.deepEqual(await call("/api/local-models"), { installed: true, models: [{ name: "alpha", inUse: true }, { name: "beta", inUse: false }, { name: "gamma", inUse: false }] });
  const [stop, setup] = switchCommands({ launcher: "coli", host: "127.0.0.1", port: 8000, requested_backend: "vulkan", ctx: 65536 }, "D:\\m\\beta", { COLIBRI_PYTHON: "py" });
  assert.deepEqual(stop, ["py", ["coli", "stop"]]);
  assert.deepEqual(setup, ["py", ["coli", "setup", "--model-dir", "D:\\m\\beta", "--yes", "--background", "--no-browser", "--host", "127.0.0.1", "--port", "8000", "--backend", "vulkan", "--ctx", "65536"]]);
});

test("finds the Model Manager next to the launcher or in Projects\\colibri", async () => {
  const folder = path.join(projects, "colibri");
  assert.equal(await managerScript({ launcher: coli }, [folder]), null);
  await mkdir(path.join(folder, "model_adder"), { recursive: true });
  await writeFile(path.join(folder, "model_adder", "model_adder.py"), "");
  assert.equal(await managerScript({ launcher: path.join(root, "runtime", "bin", "coli") }, [folder]), path.join(folder, "model_adder", "model_adder.py"));
  assert.deepEqual(await call("/api/local-models/manager", {}), { opened: true });
});

test("a request for another installed model waits for running ones, then switches once", async () => {
  const switches = [];
  let current = "alpha";
  const acquire = colibriGate({ env: process.env, switchTo: async (name) => { switches.push(name); current = name; } });
  const releaseA = await acquire("alpha");
  let gotBeta = false;
  const beta = acquire("beta").then((release) => { gotBeta = true; return release; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(gotBeta, false, "waits while alpha is in use");
  releaseA();
  (await beta)();
  assert.deepEqual(switches, ["beta"]);
  assert.equal(current, "beta");
  const releaseServed = await acquire("served-alpha"); // not a folder name: no switch while the server answers
  releaseServed();
  assert.deepEqual(switches, ["beta"]);
});

test("a route set to an installed model switches Colibri to it and answers from it", async () => {
  await call("/api/settings", { projectsRoot: projects, quickPrimary: "colibri::beta", quickFallback: "" });
  const reply = await call("/api/chat", { message: "hello", mode: "quick" });
  assert.equal(reply.content, "answer from beta");
  assert.equal(path.basename((await colibriSetup()).model_dir), "beta");
  assert.deepEqual((await call("/api/local-models")).models.find((model) => model.inUse), { name: "beta", inUse: true });
});

test("Local models only: Auto plans and reviews on Colibri, each step on its own model, no cloud CLI", async () => {
  await call("/api/settings", { projectsRoot: projects, localOnly: true, routePlanningPrimary: "codex::", routePlanningFallback: "colibri::gamma", reviewPrimary: "colibri::alpha", reviewFallback: "codex::" });
  assert.equal((await call("/api/settings")).localOnly, true);
  log.length = 0;
  const reply = await call("/api/chat", { message: "review the demo project", projectId: "demo", mode: "auto" });
  assert.equal(reply.content.includes("answer from alpha"), true, JSON.stringify(reply));
  assert.deepEqual(log, ["load gamma", "chat gamma", "load alpha", "chat alpha"]);
  await assert.rejects(readFile(cliMarker), "no cloud CLI was started");
});

test("Local models only with Colibri stopped and not set up: a clear error, no cloud fallback", async () => {
  await fetch(`http://127.0.0.1:${port}/_control/stop`);
  process.env.COLI_SETUP_HOME = path.join(root, "nowhere");
  const reply = await call("/api/chat", { message: "hello", mode: "quick" });
  assert.match(reply.error || reply.content, /Local models only is on/);
  await assert.rejects(readFile(cliMarker));
  process.env.COLI_SETUP_HOME = home;
});

test("a stopped standard install starts on first use", async () => {
  await call("/api/settings", { projectsRoot: projects, localOnly: false, quickPrimary: "colibri::alpha" });
  const reply = await call("/api/chat", { message: "hello", mode: "quick" });
  assert.equal(reply.content, "answer from alpha");
});

test.after(() => { router.close(); server.close(); });
