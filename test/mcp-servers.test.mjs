import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMcpServers, claudeMcpArgs, codexMcpArgs, copilotMcpArgs, windowsLaunch } from "../mcp-servers.mjs";
import { rufloArgs } from "../ruflo-runner.mjs";

const servers = normalizeMcpServers([
  { name: "memory", type: "stdio", command: " npx ", args: ["-y", "@modelcontextprotocol/server-memory"] },
  { name: "docs", type: "http", url: "https://example.com/mcp" },
]);

test("pass-through MCP servers are validated", () => {
  assert.deepEqual(servers[0], { name: "memory", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] });
  for (const bad of [[{ name: "ruflo", command: "x" }], [{ name: "a b", command: "x" }], [{ name: "a", command: "" }], [{ name: "a", type: "http", url: "file:///c" }], [{ name: "a", command: "x\nrm" }], [{ name: "a", command: "x" }, { name: "A", command: "y" }], "nope"]) {
    assert.throws(() => normalizeMcpServers(bad));
  }
});

test("each CLI gets the servers in its own format", () => {
  const memory = process.platform === "win32"
    ? { command: "cmd", args: ["/c", "npx", "-y", "@modelcontextprotocol/server-memory"] }
    : { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] };
  const claude = JSON.parse(claudeMcpArgs(servers)[1]).mcpServers;
  assert.deepEqual(claude.docs, { type: "http", url: "https://example.com/mcp" });
  assert.deepEqual(claude.memory, memory);
  const copilot = JSON.parse(copilotMcpArgs(servers)[1]).mcpServers;
  assert.deepEqual(copilot.memory, { type: "local", ...memory, tools: ["*"] });
  assert.deepEqual(codexMcpArgs(servers), ["-c", `mcp_servers.memory.command=${JSON.stringify(memory.command)}`, "-c", `mcp_servers.memory.args=${JSON.stringify(memory.args)}`, "-c", 'mcp_servers.docs.url="https://example.com/mcp"']);
  assert.deepEqual([claudeMcpArgs([]), copilotMcpArgs([]), codexMcpArgs([])], [[], [], []]);
});

test("Ruflo keeps its own server alongside pass-through ones", () => {
  const args = rufloArgs("ruflo.js", "default", { memory: { command: "npx", args: [] }, ruflo: { command: "evil" } });
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers;
  assert.deepEqual(Object.keys(config).sort(), ["memory", "ruflo"]);
  assert.equal(config.ruflo.command, "node");
});

test("Windows runs npx-style servers through cmd /c", () => {
  const rea = { command: "npx", args: ["-y", "rea-agents@6.9.0", "mcp"] };
  assert.deepEqual(windowsLaunch(rea), { command: "cmd", args: ["/c", "npx", "-y", "rea-agents@6.9.0", "mcp"] });
  assert.deepEqual(windowsLaunch({ command: "C:/tools/uvx.CMD", args: [] }), { command: "cmd", args: ["/c", "C:/tools/uvx.CMD"] });
  for (const kept of [{ command: "C:/nodejs/node.exe", args: ["rea.mjs", "mcp"] }, { command: "cmd", args: ["/c", "npx"] }, { command: "npx", args: ["https://x.test/?a=1&b=2"] }]) {
    assert.deepEqual(windowsLaunch(kept), kept);
  }
});
