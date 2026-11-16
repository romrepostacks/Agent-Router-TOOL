import { runCli } from "./cli-runner.mjs";

export async function runCopilotStream(command, args, cwd, env, { prompt, onApproval, onDelta, onActivity, ...options } = {}) {
  let io, buffer = "", text = "", failure, completed = false;
  const send = (message) => io.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const request = (id, method, params) => send({ id, method, params });
  const approve = async (event) => {
    if (event.method !== "session/request_permission") {
      send({ id: event.id, error: { code: -32601, message: `Unsupported request: ${event.method}` } });
      return;
    }
    const choices = event.params.options || [];
    const allow = choices.find((item) => item.kind === "allow_once");
    const deny = choices.find((item) => item.kind === "reject_once");
    let decision;
    try {
      decision = await io.hold(Promise.resolve(onApproval?.({ tool: event.params.toolCall?.title || "Copilot tool", input: event.params.toolCall || {}, reason: "", canAlwaysAllow: false })));
    } catch {}
    const choice = decision === "allow" || decision === true ? allow : deny;
    send({ id: event.id, result: { outcome: choice ? { outcome: "selected", optionId: choice.optionId } : { outcome: "cancelled" } } });
  };
  const read = (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { onActivity?.(`${line}\n`); continue; }
      if (event.method && event.id !== undefined) { void approve(event); continue; }
      if (event.error) { failure = new Error(event.error.message || "Copilot request failed."); io.end(); continue; }
      if (event.id === "initialize") request("session", "session/new", { cwd, mcpServers: [] });
      if (event.id === "session") request("prompt", "session/prompt", { sessionId: event.result.sessionId, prompt: [{ type: "text", text: prompt }] });
      if (event.method === "session/update") {
        const update = event.params.update;
        if (update.sessionUpdate === "agent_message_chunk" && update.content?.type === "text") { text += update.content.text; onDelta?.(update.content.text); }
        if (["tool_call", "tool_call_update"].includes(update.sessionUpdate)) onActivity?.(`${JSON.stringify(update)}\n`);
      }
      if (event.id === "prompt") { completed = true; io.end(); }
    }
  };
  await runCli(command, [...args, "--acp"], cwd, env, {
    ...options, onActivity, onDelta: read,
    stdin: (handle) => { io = handle; request("initialize", "initialize", { protocolVersion: 1, clientCapabilities: {} }); },
  });
  read("\n");
  if (failure) throw failure;
  if (!completed) throw new Error("Copilot disconnected before completing the turn.");
  return text.trim() || "The CLI completed without a text response.";
}
