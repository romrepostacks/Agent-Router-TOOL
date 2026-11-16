import path from "node:path";
import { access } from "node:fs/promises";
import { runClaudeStream, isUsageLimitError } from "./cli-runner.mjs";

// Ruflo supplies coordination through MCP; Claude Code is its execution host.
// Never launch hive-mind --claude: that path can skip provider permissions.
export function rufloArgs(entry, permissionMode = "default") {
  return ["-p", "--permission-mode", permissionMode, "--strict-mcp-config", "--mcp-config",
    JSON.stringify({ mcpServers: { ruflo: { command: "node", args: [entry, "mcp", "start"] } } }),
    "--append-system-prompt", "Ruflo is the sole coordinator. Before project work, discover and call Ruflo's routing tool. When the work needs more than one agent, initialize a Ruflo swarm before delegating; a single-agent plan may run without one. Let Ruflo select agents and models. Use its returned plan to drive execution with the host's Agent tool. Do not substitute your own router or claim queued tasks are completed work. If Ruflo is unavailable, stop and report the error. Respect thread access, staged copies, and provider approvals for every worker. Never launch detached workers or permission-bypassing commands. Report which agents/models actually executed, distinguishing selections from completed work."];
}

export function describeRufloTool(name, input = {}) {
  if (name.startsWith("mcp__ruflo__")) return `Ruflo ${name.slice(12)}: ${JSON.stringify(input).slice(0, 1500)}`;
  if (["Agent", "Task"].includes(name)) return `Agent requested: ${input.subagent_type || "default"}; model: ${input.model || "host default"}; ${String(input.description || "").slice(0, 200)}`;
  return null;
}

const RUFLO_ENTRY = path.join(import.meta.dirname, ".tools", "ruflo", "node_modules", "ruflo", "bin", "ruflo.js");
export const rufloInstalled = () => access(RUFLO_ENTRY).then(() => true, () => false);

export async function runRufloTask(command, prompt, project, env, options = {}, { run = runClaudeStream, check = access } = {}) {
  const entry = RUFLO_ENTRY;
  try { await check(entry); } catch { throw new Error("Ruflo is not installed. From the app folder run: npm install --prefix .tools/ruflo --no-save ruflo@3.77.1"); }
  const decisions = options.rufloDecisions || [];
  let routed = false;
  let swarm = false;
  let agents = 0;
  const pending = new Map();
  options.onStatus?.("Ruflo is planning the swarm (Claude Code execution host)…");
  options.onPrompt?.(prompt.length);
  const content = await run(command, rufloArgs(entry, options.permissionMode || "default"), project.path, env, {
    signal: options.signal, prompt,
    onApproval: (card, extra) => options.onApproval?.({ ...card, ...extra }) ?? "deny",
    onUsage: (usage) => options.onUsage?.({ ...usage, provider: "ruflo", model: "Claude Code host" }),
    onText: (text) => { options.onDelta?.(`${text}\n\n`); options.onActivity?.(`${text}\n`); },
    onLine: options.onActivity,
    onTool: (name, input, id) => {
      if (name.startsWith("mcp__ruflo__")) pending.set(id, name);
      if (["Agent", "Task"].includes(name)) agents += 1;
      const decision = describeRufloTool(name, input);
      if (decision) { decisions.push(decision); options.onStatus?.(decision); }
      options.onActivity?.(`${name}: ${JSON.stringify(input).slice(0, 4000)}\n`);
    },
    onToolResult: (id, result, isError) => {
      const name = pending.get(id);
      if (!name) return;
      pending.delete(id);
      if (!isError) {
        if (/route|orchestrat/i.test(name)) routed = true;
        if (/swarm.*init|hive.*init|orchestrat/i.test(name)) swarm = true;
      }
      const detail = `${name} ${isError ? "failed" : "returned"}: ${typeof result === "string" ? result : JSON.stringify(result)}`.slice(0, 4000);
      decisions.push(detail);
      options.onActivity?.(`${detail}\n`);
    },
  });
  if (isUsageLimitError(content) && String(content).length < 1000) throw new Error(content);
  // Every run needs Ruflo's routing decision. A swarm is required only when work fans out to more than one agent;
  // answers and small single-agent edits (Ruflo's own choice) finish without one.
  if (!routed || (!swarm && agents > 1)) throw new Error(`The execution host did not complete Ruflo routing${routed ? ` and swarm setup for ${agents} agents` : ""}. Inspect activity before retrying; no original-backend fallback was attempted.`);
  if (!swarm) decisions.push(`No swarm: Ruflo's plan ran on ${agents ? "one agent" : "the host alone"}.`);
  return content;
}
