// Pass-through MCP servers: the user's own list from Settings → MCP servers, handed to every CLI provider run
// (Claude Code, Codex, Copilot, Ruflo's Claude Code host). The router never starts these servers itself; each CLI
// launches them under its own permissions and approval prompts. Chat providers (local model, API keys) get none.

const NAME = /^[A-Za-z0-9_-]{1,40}$/;

// Validates the list saved from Settings. Throws a user-facing message on the first bad entry.
export function normalizeMcpServers(list) {
  if (!Array.isArray(list) || list.length > 30) throw new Error("Add up to 30 MCP servers.");
  const seen = new Set();
  return list.map((item) => {
    const name = String(item?.name || "").trim();
    if (!NAME.test(name)) throw new Error("MCP server names use letters, numbers, - and _ only (up to 40).");
    if (name.toLowerCase() === "ruflo" || seen.has(name.toLowerCase())) throw new Error(`The MCP server name "${name}" is already used.`);
    seen.add(name.toLowerCase());
    if (item.type === "http") {
      let url;
      try { url = new URL(String(item.url || "").trim()); } catch { throw new Error(`${name}: enter an address like https://example.com/mcp`); }
      if (!["http:", "https:"].includes(url.protocol)) throw new Error(`${name}: the address must start with http:// or https://`);
      return { name, type: "http", url: url.href };
    }
    const command = String(item.command || "").trim();
    const args = Array.isArray(item.args) ? item.args.map((arg) => String(arg)) : [];
    if (!command || command.length > 300 || /[\r\n]/.test(command)) throw new Error(`${name}: enter the command that starts the server, like npx.`);
    if (args.length > 40 || args.some((arg) => arg.length > 500 || /[\r\n]/.test(arg))) throw new Error(`${name}: too many or too long arguments.`);
    return { name, type: "stdio", command, args };
  });
}

// Reads servers from the formats other apps share: an mcp.json / claude_desktop_config.json ({ mcpServers: {...} }),
// VS Code's { servers: {...} }, a bare { name: {...} } map, or an "Add to LM Studio" / Cursor install link
// (lmstudio://add_mcp?name=…&config=<base64 JSON>). Environment variables and headers are not imported, since
// they often hold keys; the returned notes say which servers had them. Validation happens in normalizeMcpServers.
export function importMcpConfig(text) {
  const input = String(text || "").trim();
  let map;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input) && !/^https?:/i.test(input)) {
    const link = new URL(input);
    const name = link.searchParams.get("name");
    const config = link.searchParams.get("config")?.replace(/ /g, "+"); // an unencoded base64 "+" reads back as a space
    if (!name || !config) throw new Error("That install link has no name or config.");
    let decoded;
    try { decoded = JSON.parse(Buffer.from(config, "base64").toString("utf8")); } catch { decoded = JSON.parse(config); }
    map = { [name]: decoded };
  } else {
    let data;
    try { data = JSON.parse(input); } catch { throw new Error("Paste the JSON from an mcp.json file, or an Add to LM Studio / Cursor install link."); }
    map = data?.mcpServers || data?.servers || data;
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) throw new Error("No MCP servers found in that text.");
  const notes = [];
  const servers = Object.entries(map).map(([name, entry]) => {
    if (entry?.env && Object.keys(entry.env).length || entry?.headers && Object.keys(entry.headers).length) notes.push(`${name}: environment variables and headers were not imported; set them in Windows if the server needs them.`);
    return entry?.url ? { name, type: "http", url: entry.url } : { name, type: "stdio", command: entry?.command, args: entry?.args || [] };
  });
  if (!servers.length) throw new Error("No MCP servers found in that text.");
  return { servers, notes };
}

// Windows: npx, npm, uvx and other .cmd shims can't be started directly by Claude Code (its docs require `cmd /c`)
// or by a plain spawn, so a bare name or .cmd/.bat runs through cmd.exe. Args with cmd metacharacters stay
// unwrapped, since cmd would re-read them; .exe paths and cmd itself are left alone.
export function windowsLaunch({ command, args }) {
  const wrap = !/^cmd(\.exe)?$/i.test(command) && (!/\.[a-z0-9]+$/i.test(command) || /\.(cmd|bat)$/i.test(command))
    && !args.some((arg) => /[&|<>^%!"()]/.test(arg));
  return wrap ? { command: "cmd", args: ["/c", command, ...args] } : { command, args };
}
const launch = (s) => process.platform === "win32" ? windowsLaunch(s) : { command: s.command, args: s.args };

// Claude Code's --mcp-config shape (also used by Ruflo's host, merged with its own server).
export function claudeMcpServers(servers = []) {
  return Object.fromEntries(servers.map((s) => [s.name, s.type === "http" ? { type: "http", url: s.url } : launch(s)]));
}

export const claudeMcpArgs = (servers = []) => servers.length ? ["--mcp-config", JSON.stringify({ mcpServers: claudeMcpServers(servers) })] : [];

// Copilot CLI: --additional-mcp-config adds to ~/.copilot/mcp-config.json for this run.
export const copilotMcpArgs = (servers = []) => servers.length ? ["--additional-mcp-config", JSON.stringify({
  mcpServers: Object.fromEntries(servers.map((s) => [s.name, s.type === "http" ? { type: "http", url: s.url, tools: ["*"] } : { type: "local", ...launch(s), tools: ["*"] }])),
})] : [];

// Codex: -c overrides of mcp_servers.<name>. JSON strings and arrays are valid TOML values.
export const codexMcpArgs = (servers = []) => servers.flatMap((s) => {
  if (s.type === "http") return ["-c", `mcp_servers.${s.name}.url=${JSON.stringify(s.url)}`];
  const { command, args } = launch(s);
  return ["-c", `mcp_servers.${s.name}.command=${JSON.stringify(command)}`, "-c", `mcp_servers.${s.name}.args=${JSON.stringify(args)}`];
});
