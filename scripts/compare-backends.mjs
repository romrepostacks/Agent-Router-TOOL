// Sends one prompt to the original version and the Ruflo version side by side and writes a report.
//   node scripts/compare-backends.mjs --project agent-router --prompt "What does this project do?" [--mode project]
//   [--allow-tools "^mcp__ruflo__"]   approval cards whose tool matches are allowed; all others are denied
//   [--require "a/index.html,a/style.css"] [--terms "word,word"]   output checks on the proposed files
// Reports time, time to first output, tokens (every provider call, subagents included), cost, turns, approvals and
// output checks; raw metrics also go to a .json next to the .md.
// Both servers start on free ports with their usual data folders; each run uses a session deleted afterwards.
// Use a read-only mode (default: project).
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// One SSE chunk stream in, { event, data } records out. Keeps the unfinished tail for the next chunk.
export function parseSse(buffer) {
  const parts = buffer.split("\n\n");
  const rest = parts.pop();
  const events = parts.map((block) => {
    const event = /^event: (.*)$/m.exec(block)?.[1] || "message";
    const raw = block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
    try { return { event, data: JSON.parse(raw) }; } catch { return { event, data: raw }; }
  });
  return { events, rest };
}

// Sums the run's provider calls (the final event's `usage`; every call, routing and subagents included).
export function tokens(usage = []) {
  const sum = (key) => usage.reduce((total, call) => total + (call[key] || 0), 0);
  const measured = usage.some((call) => call.input !== undefined || call.total !== undefined);
  return {
    calls: usage.length, measured, input: sum("input"), cached: sum("cached"), output: sum("output"),
    total: usage.reduce((total, call) => total + (call.total ?? ((call.input || 0) + (call.output || 0))), 0),
    costUsd: usage.some((call) => typeof call.costUsd === "number") ? sum("costUsd") : null,
    turns: sum("turns"), apiMs: sum("apiMs"), models: [...new Set(usage.flatMap((call) => call.models || [call.model].filter(Boolean)))],
  };
}

export function summarize(name, events, ms) {
  const final = events.findLast((item) => item.event === "done" || item.event === "error");
  const result = final?.data || {};
  return {
    name, ms, outcome: final?.event || "no result",
    firstOutputMs: events.find((item) => item.event === "delta")?.at ?? null,
    approvalWaitMs: events.filter((item) => item.event === "approval").reduce((total, item) => total + (item.answeredIn || 0), 0),
    route: result.route || "", delegated: result.delegated || [], error: result.error || "", proposalId: result.proposal?.id || "", files: [],
    tokens: tokens(result.usage), checks: null,
    statuses: events.filter((item) => item.event === "status").map((item) => item.data.status),
    approvals: events.filter((item) => item.event === "approval").map((item) => `${item.data.tool}: ${item.data.title}`),
    content: result.content || events.filter((item) => item.event === "delta").map((item) => item.data.text).join(""),
  };
}

// Output checks on the proposed files ({ path: text }). Local references (src, href, url()) must resolve to a proposed
// file; anything loaded from http(s) counts as external. `terms`: project-specific words; distinct hits show how much
// of the page came from the source material rather than filler.
export function checkOutput(files, { required = [], terms = [] } = {}) {
  const paths = new Set(Object.keys(files));
  const missingRefs = new Set(), externalRefs = new Set(), termHits = new Set();
  let bytes = 0;
  for (const [file, text] of Object.entries(files)) {
    bytes += Buffer.byteLength(text);
    const lower = text.toLowerCase();
    for (const term of terms) if (lower.includes(term.toLowerCase())) termHits.add(term);
    if (!/\.(html?|css|svg)$/i.test(file)) continue;
    // An <a href> to a website is a link, not a load; src, url() and <link href> are loads.
    for (const [, tag, attr, ref] of text.matchAll(/(?:<(\w+)[^>]*?\b(src|href)\s*=\s*["']|url\(\s*["']?)([^"')\s#?]+)/gi)) {
      if (/^https?:|^\/\//i.test(ref)) { if (!(attr?.toLowerCase() === "href" && tag?.toLowerCase() === "a")) externalRefs.add(ref); continue; }
      if (/^(?:data|mailto|tel|javascript):/i.test(ref)) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), ref));
      if (!paths.has(target)) missingRefs.add(`${file} → ${ref}`);
    }
  }
  return {
    fileCount: paths.size, bytes, missingRequired: required.filter((file) => !paths.has(file)),
    missingRefs: [...missingRefs], externalRefs: [...externalRefs], termHits: [...termHits],
  };
}

export function report(prompt, mode, project, runs) {
  const row = (label, pick) => `| ${label} | ${runs.map((run) => String(pick(run)).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  const n = (value) => value.toLocaleString("en-US");
  const secs = (ms) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);
  const tok = (run, pick) => (run.tokens.measured ? pick(run.tokens) : "not reported");
  const chk = (run, pick) => (run.checks ? pick(run.checks) : "—");
  return [`# Backend comparison`, ``, `- Prompt: ${prompt}`, `- Mode: ${mode}`, `- Project: ${project}`, ``,
    `| | ${runs.map((run) => run.name).join(" | ")} |`, `|---|${runs.map(() => "---").join("|")}|`,
    row("Outcome", (run) => run.outcome), row("Time (wall)", (run) => secs(run.ms)),
    row("Time to first output", (run) => secs(run.firstOutputMs)), row("Model API time", (run) => (run.tokens.apiMs ? secs(run.tokens.apiMs) : "—")),
    row("Tokens total", (run) => tok(run, (t) => n(t.total))), row("Tokens in (cached)", (run) => tok(run, (t) => `${n(t.input)} (${n(t.cached)})`)),
    row("Tokens in, uncached", (run) => tok(run, (t) => n(t.input - t.cached))), row("Tokens out", (run) => tok(run, (t) => n(t.output))),
    row("Cost (API-equivalent)", (run) => (run.tokens.costUsd == null ? "—" : `$${run.tokens.costUsd.toFixed(2)}`)),
    row("Provider calls / turns", (run) => `${run.tokens.calls} / ${run.tokens.turns || "—"}`), row("Models", (run) => run.tokens.models.join(", ") || "—"),
    row("Route", (run) => run.route || "—"), row("Agents / decisions", (run) => run.delegated.length),
    row("Status updates", (run) => run.statuses.length), row("Approval prompts", (run) => run.approvals.length),
    row("Answer length", (run) => `${run.content.length} chars`), row("Files proposed", (run) => run.files.length),
    row("Output size", (run) => chk(run, (c) => `${n(c.bytes)} bytes`)), row("Required files missing", (run) => chk(run, (c) => c.missingRequired.join(", ") || "none")),
    row("Broken local links", (run) => chk(run, (c) => c.missingRefs.length)), row("External loads", (run) => chk(run, (c) => c.externalRefs.length)),
    row("Source terms used", (run) => chk(run, (c) => `${c.termHits.length}: ${c.termHits.join(", ")}`)), row("Error", (run) => run.error || "—"),
    ...runs.flatMap((run) => [``, `## ${run.name}`, ``, `### Decisions`, ...(run.delegated.length ? run.delegated.map((item) => `- ${String(item).slice(0, 400)}`) : ["- none"]),
      ``, `### Proposed files (saved, not applied)`, ...(run.files.length ? run.files.map((file) => `- ${file}`) : ["- none"]),
      ``, `### Approval prompts`, ...(run.approvals.length ? run.approvals.map((item) => `- ${item}`) : ["- none"]),
      ``, `### Answer`, ``, run.content || run.error || "(empty)"]), ``].join("\n");
}

function startServer(args) {
  const child = spawn(process.execPath, [path.join(ROOT, "server.mjs"), ...args], { cwd: ROOT, env: { ...process.env, AGENT_ROUTER_PORT: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  return new Promise((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => { out += chunk; const url = /http:\/\/127\.0\.0\.1:\d+/.exec(out)?.[0]; if (url) resolve({ child, url }); });
    child.stderr.on("data", (chunk) => process.stderr.write(chunk));
    child.on("exit", (code) => reject(new Error(`server ${args.join(" ")} exited (${code}) before listening`)));
  });
}

const post = (url, body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Each run gets a throwaway session so provider prompts arrive as approval cards. A card is allowed only when its
// tool matches the --allow-tools pattern the person running this chose; every other card is denied.
async function runOne(name, url, body, allowTools) {
  const started = Date.now();
  const session = await (await post(`${url}/api/sessions`, { projectId: body.projectId })).json();
  if (!session.id) return summarize(name, [{ event: "error", data: session }], 0);
  try {
    const res = await post(`${url}/api/chat/stream`, { ...body, sessionId: session.id });
    if (!res.ok) return summarize(name, [{ event: "error", data: await res.json().catch(() => ({ error: res.statusText })) }], Date.now() - started);
    const events = [];
    let buffer = "";
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
      const parsed = parseSse(buffer + chunk);
      buffer = parsed.rest;
      for (const item of parsed.events) {
        item.at = Date.now() - started;
        events.push(item);
        if (item.event === "status") console.log(`[${name}] ${item.data.status.slice(0, 300)}`);
        if (item.event === "approval") {
          const decision = allowTools?.test(item.data.tool || "") ? "allow" : "deny";
          item.data.title = `${item.data.title} → ${decision}`;
          console.log(`[${name}] approval ${item.data.tool}: ${decision}`);
          await post(`${url}/api/runs/${session.id}/approvals/${item.data.id}`, { decision });
          item.answeredIn = Date.now() - started - item.at;
        }
      }
    }
    return summarize(name, events, Date.now() - started);
  } finally {
    await fetch(`${url}/api/sessions/${session.id}`, { method: "DELETE" }).catch(() => {});
  }
}

async function main() {
  const arg = (flag, fallback) => { const i = process.argv.indexOf(flag); return i > 0 ? process.argv[i + 1] : fallback; };
  const project = arg("--project", path.basename(ROOT));
  const mode = arg("--mode", "project");
  const prompt = arg("--prompt", "In five bullets: what does this project do, and what are its two biggest risks?");
  const allow = arg("--allow-tools", "");
  const allowTools = allow ? new RegExp(allow) : null;
  const list = (flag) => arg(flag, "").split(",").map((item) => item.trim()).filter(Boolean);
  const required = list("--require"), terms = list("--terms"); // e.g. --require landing/index.html --terms "Calderra,Skyreach"
  const servers = await Promise.all([startServer([]), startServer(["--ruflo"])]);
  try {
    const body = { message: prompt, mode, projectId: project };
    const runs = await Promise.all([runOne("Original", servers[0].url, body, allowTools), runOne("Ruflo", servers[1].url, body, allowTools)]);
    const dir = path.join(ROOT, ".agent-router", "compare");
    const stamp = `compare-${new Date().toISOString().replace(/[:.]/g, "-")}`;
    // Staged edits come back as change proposals; save each run's proposed files for side-by-side viewing. Never applied.
    for (const [i, run] of runs.entries()) {
      if (!run.proposalId) continue;
      const proposal = await (await fetch(`${servers[i].url}/api/proposals/${run.proposalId}`)).json();
      run.checks = checkOutput(Object.fromEntries((proposal.changes || []).filter((change) => change.after != null).map((change) => [change.path.replaceAll("\\", "/"), change.after])), { required, terms });
      for (const change of proposal.changes || []) {
        if (change.after == null) continue;
        const out = path.resolve(dir, stamp, run.name, change.path);
        if (!out.startsWith(path.resolve(dir, stamp, run.name) + path.sep)) continue;
        await mkdir(path.dirname(out), { recursive: true });
        await writeFile(out, change.after);
        run.files.push(path.relative(dir, out).replaceAll("\\", "/"));
      }
    }
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${stamp}.md`);
    await writeFile(file, report(prompt, mode, project, runs));
    await writeFile(file.replace(/\.md$/, ".json"), JSON.stringify({ prompt, mode, project, runs }, null, 2)); // raw metrics for repeat-run averages
    console.log(`\nReport: ${file}`);
  } finally {
    for (const { child } of servers) child.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exit(1); });
