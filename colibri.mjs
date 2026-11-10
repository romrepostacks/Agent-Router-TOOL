// Colibri's standard install (START-HERE.bat / `coli setup`): its settings live in setup.json under
// %LOCALAPPDATA%\colibri (COLI_SETUP_HOME overrides), and every installed model is a folder next to the one the
// server uses (`model_dir`). The server holds one model at a time; switching = `coli stop`, then
// `coli setup --model-dir <folder>` keeping host, port, backend and context, as colibri.ps1 `colibri use` and
// model_adder/server_switch.py do. Nothing here downloads or deletes models: that is the Model Manager's job.
import { spawn } from "node:child_process";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const MARKERS = ["config.json", "gguf.json", "model_index.json"]; // what Colibri's Models page looks for

export function colibriHome(env = process.env) {
  if (env.COLI_SETUP_HOME) return path.resolve(env.COLI_SETUP_HOME);
  return path.join(env.LOCALAPPDATA || path.join(env.USERPROFILE || env.HOME || ".", "AppData", "Local"), "colibri");
}

export async function colibriSetup(env = process.env) {
  try {
    const cfg = JSON.parse((await readFile(path.join(colibriHome(env), "setup.json"), "utf8")).replace(/^﻿/, ""));
    return cfg && typeof cfg.model_dir === "string" ? cfg : null;
  } catch { return null; }
}

const exists = (file) => stat(file).then(() => true, () => false);

export async function colibriModels(cfg) {
  if (!cfg) return [];
  const root = path.dirname(cfg.model_dir);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const models = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = path.join(root, entry.name);
    if ((await Promise.all(MARKERS.map((marker) => exists(path.join(dir, marker))))).some(Boolean)) {
      models.push({ name: entry.name, path: dir, inUse: path.resolve(dir) === path.resolve(cfg.model_dir) });
    }
  }
  return models.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

// `py -3` first on Windows, as START-HERE.bat does; COLIBRI_PYTHON overrides (tests use it).
function python(env) {
  if (env.COLIBRI_PYTHON) return [env.COLIBRI_PYTHON];
  return process.platform === "win32" ? ["py", "-3"] : ["python3"];
}

export function switchCommands(cfg, modelDir, env = process.env) {
  const [exe, ...pre] = python(env);
  const coli = [...pre, cfg.launcher];
  const setup = [...coli, "setup", "--model-dir", modelDir, "--yes", "--background", "--no-browser",
    "--host", String(cfg.host || "127.0.0.1"), "--port", String(cfg.port || 8000)];
  if (cfg.requested_backend) setup.push("--backend", String(cfg.requested_backend));
  if (cfg.ctx) setup.push("--ctx", String(cfg.ctx));
  return [[exe, [...coli, "stop"]], [exe, setup]];
}

// The Model Manager GUI that ships in the colibri folder (model_adder/model_adder.py). setup.json's launcher may
// be in a downloaded runtime folder rather than colibri\c, so the caller can name other colibri folders to try.
export async function managerScript(cfg, folders = []) {
  const candidates = [path.dirname(path.dirname(cfg.launcher || ".")), ...folders].map((dir) => path.join(dir, "model_adder", "model_adder.py"));
  for (const file of candidates) if (await exists(file)) return file;
  return null;
}

export function openManager(script, env = process.env) {
  const [exe, ...pre] = python(env);
  const child = spawn(exe, [...pre, script], { cwd: path.dirname(script), detached: true, stdio: "ignore", windowsHide: false });
  child.on("error", () => {});
  child.unref();
}

// The background server inherits the child's handles, so wait for the setup process itself to exit
// (stdio ignored: a pipe would stay open as long as the server runs), not for its output to close.
function run(exe, args) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { stdio: "ignore", windowsHide: true });
    child.on("error", (error) => resolve({ code: -1, error }));
    child.on("exit", (code) => resolve({ code }));
  });
}

export async function colibriHealthy(cfg) {
  const host = ["0.0.0.0", "", undefined].includes(cfg.host) ? "127.0.0.1" : cfg.host;
  try {
    const response = await fetch(`http://${host}:${cfg.port || 8000}/health`, { signal: AbortSignal.timeout(3000) });
    return response.ok && (await response.json()).status === "ok";
  } catch { return false; }
}

export async function waitReady(cfg, { signal, timeoutMs = 20 * 60_000, intervalMs = 1500 } = {}) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (signal?.aborted) throw signal.reason || new Error("Stopped.");
    if (await colibriHealthy(cfg)) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Colibri didn't become ready within ${Math.round(timeoutMs / 60_000)} minutes. Check \`colibri logs\`.`);
}

export async function switchModel(name, { env = process.env, signal, onStatus = () => {} } = {}) {
  const cfg = await colibriSetup(env);
  if (!cfg) throw new Error(`Colibri isn't set up on this computer (no ${path.join(colibriHome(env), "setup.json")}). Run START-HERE.bat in the colibri folder.`);
  if (!cfg.launcher || !(await exists(cfg.launcher))) throw new Error("Colibri's setup.json names no launcher that exists. Run START-HERE.bat again.");
  const model = (await colibriModels(cfg)).find((item) => item.name === name);
  if (!model) throw new Error(`Colibri has no model "${name}". Add it with the Model Manager first.`);
  const [stop, setup] = switchCommands(cfg, model.path, env);
  onStatus(model.inUse ? `Starting Colibri on ${name}…` : `Switching Colibri to ${name}…`);
  await run(...stop); // non-zero when it was already stopped; setup reports real problems
  const result = await run(...setup);
  if (result.code !== 0) throw new Error(`Colibri couldn't start ${name} (coli setup ${result.error ? result.error.message : `exited ${result.code}`}). Check \`colibri logs\`.`);
  onStatus(`Loading ${name} in Colibri (a big model can take minutes)…`);
  await waitReady(await colibriSetup(env) || cfg, { signal });
  onStatus(`Colibri is ready on ${name}.`);
}

// One model at a time: a request for a different installed model waits until running local requests finish,
// then switches. Names that aren't installed Colibri folders (a served model id, another server's model) pass
// straight through. Returns a release function the caller must call when its request ends.
export function colibriGate({ env = process.env, switchTo = switchModel } = {}) {
  let users = 0, switching = null;
  const idle = [];
  const wanted = async (name) => {
    const cfg = await colibriSetup(env);
    const models = await colibriModels(cfg);
    const current = models.find((model) => model.inUse);
    // Any other name (a served model id, or none) means "whatever is loaded": start that if the server is down.
    if (!models.some((model) => model.name === name)) return current && !users && !(await colibriHealthy(cfg)) ? current.name : null;
    // The model already in use needs no switch, unless the server is stopped: then "switching" starts it.
    return current?.name === name && (users || await colibriHealthy(cfg)) ? null : name;
  };
  return async function acquire(name, options = {}) {
    for (;;) {
      if (switching) { await switching.catch(() => {}); continue; }
      const target = await wanted(name);
      if (switching) continue;
      if (!target) return hold();
      if (users) { options.onStatus?.(`Waiting for the running local request to finish before switching Colibri to ${target}…`); await new Promise((resolve) => idle.push(resolve)); if (options.signal?.aborted) throw options.signal.reason || new Error("Stopped."); continue; }
      switching = switchTo(target, { env, ...options }).finally(() => { switching = null; });
      await switching;
      return hold(); // switchTo returns once the model answers
    }
  };
  function hold() {
    users++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--users === 0) idle.splice(0).forEach((resolve) => resolve());
    };
  }
}

