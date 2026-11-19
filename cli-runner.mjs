import { spawn, execFile } from "node:child_process";

// Claude Code's result event → { input, cached, output, models }. `usage` covers the main thread only; `modelUsage`
// (when present) is the whole session per model, subagents included, so it wins. Cache reads and writes count as input.
export function claudeUsage(u = {}, modelUsage) {
  const per = Object.entries(modelUsage || {});
  if (!per.length) return { input: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), cached: u.cache_read_input_tokens || 0, output: u.output_tokens || 0 };
  const sum = (pick) => per.reduce((total, [, m]) => total + (pick(m) || 0), 0);
  return {
    input: sum((m) => (m.inputTokens || 0) + (m.cacheReadInputTokens || 0) + (m.cacheCreationInputTokens || 0)),
    cached: sum((m) => m.cacheReadInputTokens), output: sum((m) => m.outputTokens), models: per.map(([name]) => name),
  };
}

export function runCli(command, args, cwd, env, { signal, onDelta, onActivity, stdin, idleTimeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, text) => (current + text).slice(-24_000);
    let timer;
    let closed = false;
    let holds = 0;
    const stop = () => {
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => { if (error) child.kill(); });
      } else child.kill();
    };
    const resetTimer = () => {
      clearTimeout(timer);
      if (!closed && !holds) timer = setTimeout(() => { timedOut = true; stop(); }, idleTimeoutMs);
    };
    resetTimer();
    if (signal?.aborted) stop();
    signal?.addEventListener("abort", stop, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    if (stdin !== undefined) child.stdin.on("error", () => {});
    // A function keeps stdin open for a conversation with the CLI. `hold` pauses the idle timer while the user decides.
    if (typeof stdin === "function") {
      stdin({
        write: (text) => { if (child.stdin.writable) child.stdin.write(text); },
        end: () => child.stdin.end(),
        hold: async (promise) => { holds++; clearTimeout(timer); try { return await promise; } finally { holds--; resetTimer(); } },
      });
    } else if (stdin !== undefined) child.stdin.end(stdin);
    child.stdout.on("data", (text) => { resetTimer(); stdout = append(stdout, text); onDelta?.(text); });
    child.stderr.on("data", (text) => { resetTimer(); stderr = append(stderr, text); onActivity?.(text); });
    child.on("error", (error) => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      reject(error);
    });
    child.on("close", (code) => {
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", stop);
      if (signal?.aborted) return reject(new Error("Request stopped."));
      if (timedOut) return reject(new Error("The CLI task stopped after 15 minutes without output. Retry the task or choose another provider."));
      if (code !== 0) return reject(new Error((stderr || stdout || `CLI exited with code ${code}`).slice(-4000)));
      resolve((stdout || stderr).trim() || "The CLI completed without a text response.");
    });
  });
}

// Claude Code print mode, stream-json both ways. The router adds no permission rules: Claude Code applies the user's
// own settings, and anything those settings would ask about arrives as a `can_use_tool` control request
// (`--permission-prompt-tool stdio`). onApproval({ tool, input, reason }, { canAlwaysAllow }) resolves to "allow",
// "always" or "deny" (true / false also work); without it, deny. "always" is only honoured when Claude Code itself
// offered a rule it can save to its own settings file (permission_suggestions); the router never remembers answers.
const SAVED_DESTINATIONS = new Set(["userSettings", "projectSettings", "localSettings"]);
export function savedPermissionSuggestions(request) {
  return (Array.isArray(request?.permission_suggestions) ? request.permission_suggestions : [])
    .filter((item) => item && typeof item === "object" && SAVED_DESTINATIONS.has(item.destination) && (item.type !== "addRules" || item.behavior === "allow"));
}
// An MCP server asking the user something (elicitation), e.g. computer use asking to control an app on this PC.
// It becomes an ordinary approval card: the message (and URL, if any) is shown, Allow accepts, Deny declines.
export function elicitationCard(server, { message, url, requestedSchema } = {}) {
  return { tool: `mcp__${server || "server"}`, input: { message: String(message || ""), ...(url ? { url: String(url) } : {}), ...(requestedSchema ? { requestedSchema } : {}) }, reason: String(message || ""), canAlwaysAllow: false };
}
// Accepted form answers: each field's default, and true for a yes/no field without one.
// ponytail: fields with no default aren't asked for; add form inputs to the card if an MCP server needs typed answers.
export function elicitationContent(schema) {
  const content = {};
  for (const [key, field] of Object.entries(schema?.properties || {})) {
    if (field?.default !== undefined && field.default !== null) content[key] = field.default;
    else if (field?.type === "boolean") content[key] = true;
  }
  return content;
}
const allowed = (reply) => reply === true || reply === "allow" || reply === "always" || reply?.decision === "allow";

export async function runClaudeStream(command, args, cwd, env, { prompt, onText, onTool, onToolResult, onLine, onApproval, onUsage, ...options } = {}) {
  const initId = `init-${Date.now()}`;
  let io = null;
  let result = null;
  let buffer = "";
  const send = (message) => io?.write(`${JSON.stringify(message)}
`);
  const answer = async (id, request) => {
    if (request.subtype === "elicitation") {
      let reply = "deny";
      try { if (onApproval) reply = await io.hold(Promise.resolve(onApproval(elicitationCard(request.mcp_server_name, { message: request.message, url: request.url, requestedSchema: request.requested_schema }), { canAlwaysAllow: false }))); } catch {}
      return send({ type: "control_response", response: { subtype: "success", request_id: id, response: allowed(reply)
        ? { action: "accept", ...(request.mode === "url" ? {} : { content: elicitationContent(request.requested_schema) }) }
        : { action: "decline" } } });
    }
    // A dialog Claude Code asks the host to show. The router declares only refusal_fallback_prompt (the model refused;
    // retry on the fallback model?): Allow retries, Deny or no answer cancels, which is Claude Code's no-dialog behaviour.
    // Undeclared kinds get no answer, as the protocol requires; Claude Code cancels them itself.
    if (request.subtype === "request_user_dialog") {
      if (request.dialog_kind !== "refusal_fallback_prompt") return;
      const p = request.payload || {};
      let reply = "deny";
      try { if (onApproval) reply = await io.hold(Promise.resolve(onApproval({ tool: "Model fallback", input: { originalModel: String(p.originalModel || ""), fallbackModel: String(p.fallbackModel || ""), message: String(p.guidanceText || `${p.originalModel || "The model"} declined this request. Retry it on ${p.fallbackModel || "the fallback model"}?`) }, reason: "" }, { canAlwaysAllow: false }))); } catch {}
      return send({ type: "control_response", response: { subtype: "success", request_id: id, response: allowed(reply) ? { behavior: "completed", result: "retry_fallback" } : { behavior: "cancelled" } } });
    }
    // Only sent to hosts that attached a Remote Control bridge with a work secret; the router never does and holds none.
    if (request.subtype === "remote_control_work_secret") return send({ type: "control_response", response: { subtype: "error", request_id: id, error: "Local Agent Router does not attach Remote Control and has no work secret to give." } });
    if (request.subtype !== "can_use_tool") return send({ type: "control_response", response: { subtype: "error", request_id: id, error: `Unsupported control request: ${request.subtype}` } });
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const saved = savedPermissionSuggestions(request);
    let decision = "deny";
    let answers = null; // AskUserQuestion: { [question]: answer } from the card, passed back as the tool's input
    try {
      let reply = onApproval && await io.hold(onApproval({ tool: String(request.tool_name || "tool"), input, reason: String(request.decision_reason || request.blocked_path || "") }, { canAlwaysAllow: saved.length > 0 }));
      if (reply && typeof reply === "object") ({ decision: reply, answers = null } = reply);
      decision = reply === true ? "allow" : reply === "allow" || (reply === "always" && saved.length) ? reply : "deny";
    } catch {}
    send({ type: "control_response", response: { subtype: "success", request_id: id, response: decision !== "deny"
      ? { behavior: "allow", updatedInput: answers ? { ...input, answers } : input, toolUseID: request.tool_use_id, ...(decision === "always" ? { updatedPermissions: saved } : {}) }
      : { behavior: "deny", message: "The user declined this in Local Agent Router.", toolUseID: request.tool_use_id } } });
  };
  const read = (chunk) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { onLine?.(`${line}\n`); continue; }
      if (event.type === "control_response" && event.response?.request_id === initId) send({ type: "user", message: { role: "user", content: prompt }, parent_tool_use_id: null });
      if (event.type === "control_request" && typeof event.request_id === "string" && event.request) answer(event.request_id, event.request);
      if (event.type === "result") { // one prompt per run: closing stdin lets the CLI exit
        result = event;
        io?.end();
        const u = event.usage;
        const extra = Object.entries({ costUsd: event.total_cost_usd, turns: event.num_turns, apiMs: event.duration_api_ms }).filter(([, value]) => typeof value === "number");
        if (u) onUsage?.({ ...claudeUsage(u, event.modelUsage), ...Object.fromEntries(extra) });
      }
      if (event.type === "user") for (const part of event.message?.content || []) {
        if (part.type === "tool_result") onToolResult?.(part.tool_use_id, part.content, Boolean(part.is_error));
      }
      if (event.type !== "assistant") continue;
      for (const part of event.message?.content || []) {
        if (part.type === "text" && part.text) onText?.(part.text);
        if (part.type === "tool_use") onTool?.(part.name, part.input || {}, part.id);
      }
    }
  };
  const fullArgs = [...args, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "stdio"];
  // stdin closes at the first result, so a background subagent still running after it could never get an approval
  // answered ("Stream closed"). Keep subagents in the foreground; parallel Agent calls in one turn still run together.
  const runEnv = { ...(env || process.env), CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" };
  try {
    await runCli(command, fullArgs, cwd, runEnv, { ...options, onDelta: read, stdin: (handle) => { io = handle; send({ type: "control_request", request_id: initId, request: { subtype: "initialize", supportedDialogKinds: ["refusal_fallback_prompt"] } }); } });
    read("\n");
  } catch (error) {
    read("\n");
    throw result?.result ? new Error(result.result) : error;
  }
  if (result?.is_error) throw new Error(result.result || "Claude Code reported an error.");
  return String(result?.result || "").trim() || "The CLI completed without a text response.";
}

export function isUsageLimitError(error) {
  const tail = String(error?.message || error).split("\n").slice(-12).join("\n");
  return /\b(?:hit|reached|exceeded)\b[^\n]{0,40}\b\d+[ -]hours?\s+limit\b|\b(?:usage|request|premium request|ai credit|credit|message)s? (?:limit|quota|cap)\b[^\n]*\b(?:reached|exceeded|exhausted|resets?|wait|try again)\b|\b(?:hit|reached|exceeded|out of)\b[^\n]{0,80}\b(?:usage|monthly|weekly|daily|request|premium request|ai credit|credit|rate)[ -]?(?:limits?|quota|cap)\b|\binsufficient_quota\b|\bresource_exhausted\b|\bbilling_hard_limit\b|\brate.?limit[^\n]*\b(?:reached|exceeded)\b|\b429\b[^\n]*\b(?:quota|credit|usage|limit)/i.test(tail);
}
