import { spawn, execFile } from "node:child_process";

export function runCli(command, args, cwd, env, { signal, onDelta, onActivity, stdin, idleTimeoutMs = 15 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const append = (current, text) => (current + text).slice(-24_000);
    let timer;
    let closed = false;
    const stop = () => {
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => { if (error) child.kill(); });
      } else child.kill();
    };
    const resetTimer = () => {
      clearTimeout(timer);
      if (!closed) timer = setTimeout(() => { timedOut = true; stop(); }, idleTimeoutMs);
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
        hold: async (promise) => { clearTimeout(timer); try { return await promise; } finally { resetTimer(); } },
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
export async function runClaudeStream(command, args, cwd, env, { prompt, onText, onTool, onLine, onApproval, ...options } = {}) {
  const initId = `init-${Date.now()}`;
  let io = null;
  let result = null;
  let buffer = "";
  const send = (message) => io?.write(`${JSON.stringify(message)}
`);
  const answer = async (id, request) => {
    if (request.subtype !== "can_use_tool") return send({ type: "control_response", response: { subtype: "error", request_id: id, error: `Unsupported control request: ${request.subtype}` } });
    const input = request.input && typeof request.input === "object" ? request.input : {};
    const saved = savedPermissionSuggestions(request);
    let decision = "deny";
    try {
      const reply = onApproval && await io.hold(onApproval({ tool: String(request.tool_name || "tool"), input, reason: String(request.decision_reason || request.blocked_path || "") }, { canAlwaysAllow: saved.length > 0 }));
      decision = reply === true ? "allow" : reply === "allow" || (reply === "always" && saved.length) ? reply : "deny";
    } catch {}
    send({ type: "control_response", response: { subtype: "success", request_id: id, response: decision !== "deny"
      ? { behavior: "allow", updatedInput: input, toolUseID: request.tool_use_id, ...(decision === "always" ? { updatedPermissions: saved } : {}) }
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
      if (event.type === "result") { result = event; io?.end(); } // one prompt per run: closing stdin lets the CLI exit
      if (event.type !== "assistant") continue;
      for (const part of event.message?.content || []) {
        if (part.type === "text" && part.text) onText?.(part.text);
        if (part.type === "tool_use") onTool?.(part.name, part.input || {});
      }
    }
  };
  const fullArgs = [...args, "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-prompt-tool", "stdio"];
  try {
    await runCli(command, fullArgs, cwd, env, { ...options, onDelta: read, stdin: (handle) => { io = handle; send({ type: "control_request", request_id: initId, request: { subtype: "initialize" } }); } });
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

