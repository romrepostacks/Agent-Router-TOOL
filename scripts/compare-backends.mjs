// Sends one prompt to the original version and the Ruflo version side by side and writes a report.
//   node scripts/compare-backends.mjs --project agent-router --prompt "What does this project do?" [--mode project]
//   [--allow-tools "^mcp__ruflo__"]   approval cards whose tool matches are allowed; all others are denied
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

export function summarize(name, events, ms) {
  const final = events.findLast((item) => item.event === "done" || item.event === "error");
  const result = final?.data || {};
  return {
    name, ms, outcome: final?.event || "no result",
    route: result.route || "", delegated: result.delegated || [], error: result.error || "",
    statuses: events.filter((item) => item.event === "status").map((item) => item.data.status),
    approvals: events.filter((item) => item.event === "approval").map((item) => `${item.data.tool}: ${item.data.title}`),
    content: result.content || events.filter((item) => item.event === "delta").map((item) => item.data.text).join(""),
  };
}

export function report(prompt, mode, project, runs) {
  const row = (label, pick) => `| ${label} | ${runs.map((run) => String(pick(run)).replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ")} |`;
  return [`# Backend comparison`, ``, `- Prompt: ${prompt}`, `- Mode: ${mode}`, `- Project: ${project}`, ``,
    `| | ${runs.map((run) => run.name).join(" | ")} |`, `|---|${runs.map(() => "---").join("|")}|`,
    row("Outcome", (run) => run.outcome), row("Time", (run) => `${(run.ms / 1000).toFixed(1)} s`),
    row("Route", (run) => run.route || "—"), row("Agents / decisions", (run) => run.delegated.length),
    row("Status updates", (run) => run.statuses.length), row("Approval prompts", (run) => run.approvals.length),
    row("Answer length", (run) => `${run.content.length} chars`), row("Error", (run) => run.error || "—"),
    ...runs.flatMap((run) => [``, `## ${run.name}`, ``, `### Decisions`, ...(run.delegated.length ? run.delegated.map((item) => `- ${String(item).slice(0, 400)}`) : ["- none"]),
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
        events.push(item);
        if (item.event === "status") console.log(`[${name}] ${item.data.status.slice(0, 300)}`);
        if (item.event === "approval") {
          const decision = allowTools?.test(item.data.tool || "") ? "allow" : "deny";
          item.data.title = `${item.data.title} → ${decision}`;
          console.log(`[${name}] approval ${item.data.tool}: ${decision}`);
          await post(`${url}/api/runs/${session.id}/approvals/${item.data.id}`, { decision });
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
  const servers = await Promise.all([startServer([]), startServer(["--ruflo"])]);
  try {
    const body = { message: prompt, mode, projectId: project };
    const runs = await Promise.all([runOne("Original", servers[0].url, body, allowTools), runOne("Ruflo", servers[1].url, body, allowTools)]);
    const dir = path.join(ROOT, ".agent-router", "compare");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `compare-${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    await writeFile(file, report(prompt, mode, project, runs));
    console.log(`\nReport: ${file}`);
  } finally {
    for (const { child } of servers) child.kill();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exit(1); });
