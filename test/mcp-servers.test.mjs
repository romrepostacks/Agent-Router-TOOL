import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMcpServers, claudeMcpArgs, codexMcpArgs, copilotMcpArgs } from "../mcp-servers.mjs";
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
  const claude = JSON.parse(claudeMcpArgs(servers)[1]).mcpServers;
  assert.deepEqual(claude.docs, { type: "http", url: "https://example.com/mcp" });
  assert.equal(claude.memory.command, "npx");
  const copilot = JSON.parse(copilotMcpArgs(servers)[1]).mcpServers;
  assert.equal(copilot.memory.type, "local");
  assert.deepEqual(codexMcpArgs(servers), ["-c", 'mcp_servers.memory.command="npx"', "-c", 'mcp_servers.memory.args=["-y","@modelcontextprotocol/server-memory"]', "-c", 'mcp_servers.docs.url="https://example.com/mcp"']);
  assert.deepEqual([claudeMcpArgs([]), copilotMcpArgs([]), codexMcpArgs([])], [[], [], []]);
});

test("Ruflo keeps its own server alongside pass-through ones", () => {
  const args = rufloArgs("ruflo.js", "default", { memory: { command: "npx", args: [] }, ruflo: { command: "evil" } });
  const config = JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers;
  assert.deepEqual(Object.keys(config).sort(), ["memory", "ruflo"]);
  assert.equal(config.ruflo.command, "node");
});
