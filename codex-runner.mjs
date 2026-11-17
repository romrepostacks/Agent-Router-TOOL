import { runCli } from "./cli-runner.mjs";

// One readable line for the output panel per app-server item, instead of its raw JSON.
// Messages and reasoning stream as text already, so they add no line.
export function describeCodexItem(item = {}) {
  const oneLine = (value) => String(value ?? "").replace(/\s*\r?\n\s*/g, " ⏎ ").trim();
  switch (item.type) {
    case "agentMessage": case "reasoning": case "userMessage": return "";
    case "commandExecution": return `$ ${oneLine(Array.isArray(item.command) ? item.command.join(" ") : item.command)}`;
    case "fileChange": return `Edit ${(item.changes || []).map((change) => change.path).filter(Boolean).join(", ") || "files"}`;
    case "mcpToolCall": return `Tool ${[item.server, item.tool].filter(Boolean).join(": ")}`;
    case "webSearch": return `Search ${oneLine(item.query)}`;
    default: return item.type ? oneLine(item.type) : "";
  }
}

// One app-server connection per run keeps approvals and cancellation isolated.
export async function runCodexStream(command, args, cwd, env, { prompt, model, onApproval, onDelta, onActivity, onUsage, ...options } = {}) {
  let io, buffer = "", text = "", failure, completed = false;
  const send = (message) => io.write(`${JSON.stringify(message)}\n`);
  const request = (id, method, params) => send({ id, method, params });
  const approve = async (event) => {
    if (!["item/commandExecution/requestApproval", "item/fileChange/requestApproval"].includes(event.method)) {
      send({ id: event.id, error: { code: -32601, message: `Unsupported request: ${event.method}` } });
      return;
    }
    let decision = "deny";
    try {
      decision = await io.hold(Promise.resolve(onApproval?.({ tool: event.method, input: event.params, reason: event.params?.reason || "", canAlwaysAllow: false })));
    } catch {}
    send({ id: event.id, result: { decision: decision === "allow" || decision === true ? "accept" : "decline" } });
  };
  const read = (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { onActivity?.(`${line.replace(/\r$/, "")}\n`); continue; }
      if (event.method && event.id !== undefined) { void approve(event); continue; }
      if (event.error) { failure = new Error(event.error.message || "Codex request failed."); io.end(); continue; }
      if (event.id === "initialize") {
        send({ method: "initialized", params: {} });
        request("thread", "thread/start", { cwd, approvalPolicy: "on-request", ...(model ? { model } : {}) });
      }
      if (event.id === "thread") request("turn", "turn/start", { threadId: event.result.thread.id, input: [{ type: "text", text: prompt }] });
      if (event.method === "item/agentMessage/delta") { text += event.params.delta; onDelta?.(event.params.delta); }
      if (event.method === "item/started") {
        const line = describeCodexItem(event.params.item);
        if (line) onActivity?.(`${line}\n`);
      }
      if (event.method === "thread/tokenUsage/updated") {
        const usage = event.params.tokenUsage?.total;
        if (usage) onUsage?.({ input: usage.inputTokens || 0, cached: usage.cachedInputTokens || 0, output: usage.outputTokens || 0 });
      }
      if (event.method === "turn/completed") {
        completed = true;
        if (event.params.turn.status !== "completed") failure = new Error(event.params.turn.error?.message || "Codex turn did not complete.");
        io.end();
      }
    }
  };
  await runCli(command, [...args, "app-server"], cwd, env, {
    ...options, onActivity, onDelta: read,
    stdin: (handle) => {
      io = handle;
      request("initialize", "initialize", { clientInfo: { name: "local_agent_router", version: "1.0.0" } });
    },
  });
  read("\n");
  if (failure) throw failure;
  if (!completed) throw new Error("Codex disconnected before completing the turn.");
  return text.trim() || "The CLI completed without a text response.";
}
