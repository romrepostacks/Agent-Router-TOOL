import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { MCP_REGISTRIES, SKILL_SOURCES, listSourceSkills, parseRepo, registryRow, searchRegistry, skillsFromTree } from "../marketplace.mjs";
import { importMcpConfig, normalizeMcpServers } from "../mcp-servers.mjs";

test("default sources match what Claude desktop, Codex and Hermes use", () => {
  const repos = SKILL_SOURCES.map((source) => source.repo);
  for (const repo of ["anthropics/skills", "anthropics/knowledge-work-plugins", "anthropics/claude-plugins-official", "anthropics/financial-services", "anthropics/claude-for-legal", "anthropics/life-sciences", "openai/plugins", "NousResearch/hermes-agent"]) assert.ok(repos.includes(repo), repo);
  assert.deepEqual(MCP_REGISTRIES.map((registry) => registry.id), ["official", "github"]);
});

test("parseRepo accepts owner/repo and github links only", () => {
  assert.equal(parseRepo("anthropics/skills"), "anthropics/skills");
  assert.equal(parseRepo("https://github.com/openai/plugins.git"), "openai/plugins");
  assert.equal(parseRepo("https://github.com/openai/plugins/"), "openai/plugins");
  for (const bad of ["", "nope", "https://evil.com/a/b", "a/b/c", "../x", "a/..", "-x/y"]) assert.equal(parseRepo(bad), null, bad);
});

test("skillsFromTree lists SKILL.md folders grouped by plugin", () => {
  const rows = skillsFromTree("o/r", [
    { type: "blob", path: "bio/skills/scvi-tools/SKILL.md" },
    { type: "blob", path: "skills/.curated/aspnet-core/SKILL.md" },
    { type: "blob", path: "README.md" },
    { type: "tree", path: "x/SKILL.md" },
    { type: "blob", path: "SKILL.md" },
  ]);
  assert.deepEqual(rows.map((row) => [row.group, row.name]), [["", "r"], ["bio", "scvi-tools"], ["curated", "aspnet-core"]]);
  assert.equal(rows[1].url, "https://github.com/o/r/blob/HEAD/bio/skills/scvi-tools/SKILL.md");
});

test("listSourceSkills caches and maps GitHub errors", async () => {
  let calls = 0;
  const ok = async () => { calls++; return { ok: true, status: 200, json: async () => ({ tree: [{ type: "blob", path: "a/SKILL.md" }] }) }; };
  const first = await listSourceSkills("cache/test", { fetchImpl: ok });
  await listSourceSkills("cache/test", { fetchImpl: ok });
  assert.equal(calls, 1);
  assert.equal(first.skills[0].name, "a");
  await assert.rejects(listSourceSkills("limit/test", { fetchImpl: async () => ({ ok: false, status: 403 }) }), /hourly limit/);
  await assert.rejects(listSourceSkills("bad repo"), /owner\/repo/);
});

test("registryRow builds pass-through entries and lists what is still needed", () => {
  const remote = registryRow({ server: { name: "io.example/remote", remotes: [{ type: "streamable-http", url: "https://x.example/mcp" }] } });
  assert.deepEqual(remote.install, { name: "remote", type: "http", url: "https://x.example/mcp" });
  assert.deepEqual(remote.needs, []);
  const npm = registryRow({ server: { name: "io.example/fs", packages: [{ registryType: "npm", identifier: "@x/fs", version: "1.2.0", transport: { type: "stdio" }, environmentVariables: [{ name: "ROOT", isRequired: true }] }] } });
  assert.deepEqual(npm.install, { name: "fs", type: "stdio", command: "npx", args: ["-y", "@x/fs@1.2.0"] });
  assert.match(npm.needs[0], /ROOT/);
  const pypi = registryRow({ server: { name: "a/b", packages: [{ registryType: "pypi", identifier: "b-mcp", version: "latest" }] } });
  assert.deepEqual(pypi.install.args, ["b-mcp"]);
  assert.equal(registryRow({ server: { name: "a/c", packages: [{ registryType: "nuget", identifier: "C" }] } }).install, null);
  const keyed = registryRow({ server: { name: "a/d", remotes: [{ type: "streamable-http", url: "https://d.example", headers: [{ name: "Authorization", isRequired: true }] }] } });
  assert.match(keyed.needs[0], /Authorization/);
  // Every one-click entry passes the same validation as the Settings form.
  assert.equal(normalizeMcpServers([remote.install, npm.install, pypi.install]).length, 3);
});

test("searchRegistry asks for latest versions and drops duplicates", async () => {
  let asked;
  const fetchImpl = async (url) => { asked = String(url); return { ok: true, json: async () => ({ servers: [{ server: { name: "a/x", remotes: [{ type: "streamable-http", url: "https://x" }] } }, { server: { name: "a/x" } }], metadata: { nextCursor: "n1" } }) }; };
  const result = await searchRegistry("official", { search: "git", fetchImpl });
  assert.match(asked, /^https:\/\/registry\.modelcontextprotocol\.io\/v0\.1\/servers\?/);
  assert.match(asked, /version=latest/);
  assert.match(asked, /search=git/);
  assert.equal(result.servers.length, 1);
  assert.equal(result.nextCursor, "n1");
  await assert.rejects(searchRegistry("nope"), /Unknown/);
});

test("registry setup cannot hide required runtime arguments or unsafe addresses", () => {
  const runtime = registryRow({ name: "example/tool", packages: [{ registryType: "npm", identifier: "@example/tool", runtimeArguments: [{ name: "root", isRequired: true }] }] });
  assert.match(runtime.needs.join(), /runtime argument root/);
  const template = registryRow({ name: "example/remote", websiteUrl: "javascript:alert(1)", remotes: [{ type: "streamable-http", url: "https://example.com/{tenant}/mcp" }] });
  assert.match(template.needs.join(), /placeholders/);
  assert.equal(template.website, "");
  assert.equal(registryRow({ name: "example/bad", remotes: [{ type: "http", url: "file:///tmp/server" }] }).install, null);
  assert.equal(registryRow({ name: "example/pkg", packages: [{ registryType: "npm", identifier: "--help" }] }).install, null);
});

test("importMcpConfig reads mcp.json, VS Code and LM Studio / Cursor links", () => {
  const claude = importMcpConfig(JSON.stringify({ mcpServers: { memory: { command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"], env: { KEY: "x" } }, web: { url: "https://w.example/mcp" } } }));
  assert.deepEqual(claude.servers, [{ name: "memory", type: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-memory"] }, { name: "web", type: "http", url: "https://w.example/mcp" }]);
  assert.match(claude.notes[0], /memory: environment variables/);
  assert.equal(JSON.stringify(claude).includes('"x"'), false, "env values are never kept");
  assert.equal(importMcpConfig('{"servers":{"a":{"command":"uvx","args":["a"]}}}').servers[0].command, "uvx");
  const config = Buffer.from(JSON.stringify({ command: "npx", args: ["-y", "pkg"] })).toString("base64");
  assert.deepEqual(importMcpConfig(`lmstudio://add_mcp?name=pkg&config=${encodeURIComponent(config)}`).servers, [{ name: "pkg", type: "stdio", command: "npx", args: ["-y", "pkg"] }]);
  assert.equal(importMcpConfig(`cursor://anysphere.cursor-deeplink/mcp/install?name=c&config=${config}`).servers[0].name, "c");
  assert.throws(() => importMcpConfig("not json"), /Paste the JSON/);
  assert.throws(() => importMcpConfig("[]"), /No MCP servers/);
});

test("server keeps MCP import and source changes on the PC, browsing open to phones", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const LOCAL_ONLY = eval(source.match(/const LOCAL_ONLY_PATHS = (\/.*\/);/)[1]);
  for (const local of ["/api/mcp", "/api/mcp/import", "/api/marketplace/sources"]) assert.ok(LOCAL_ONLY.test(local), local);
  for (const open of ["/api/marketplace", "/api/marketplace/skills", "/api/marketplace/mcp"]) assert.ok(!LOCAL_ONLY.test(open), open);
});

// Mobile freeze: a native poll snapshot must patch the streaming bubble, not rebuild the whole chat.
test("mobile snapshot patches the streaming bubble in place", async () => {
  const code = await readFile(new URL("../mobile/www/app.js", import.meta.url), "utf8");
  const start = code.indexOf("function patchStreamingBubble(");
  const fn = code.slice(start, code.indexOf("\nfunction bubble(", start));
  const node = (classes = []) => ({ classList: { contains: (name) => classes.includes(name) }, textContent: "", children: [], querySelector(selector) { return this.children.find((child) => child.selector === selector) || null; }, after(next) { this.parent.children.push(next); } });
  const make = (streaming) => {
    const last = node(streaming ? ["bubble", "assistant", "streaming"] : ["bubble", "assistant"]);
    const text = Object.assign(node(), { selector: ".bubble-text", parent: last });
    last.children.push(text);
    const list = { lastElementChild: last, scrollHeight: 1000, scrollTop: 900, clientHeight: 100 };
    return { list, last, text };
  };
  const context = { el: () => Object.assign(node(), { selector: ".bubble-status" }), $: () => current.list };
  let current = make(true);
  vm.createContext(context);
  vm.runInContext(fn, context);
  assert.equal(context.patchStreamingBubble({ content: "hello", status: "Working" }), true);
  assert.equal(current.text.textContent, "hello");
  assert.equal(current.last.querySelector(".bubble-status").textContent, "Working");
  assert.equal(current.list.scrollTop, 1000, "stays pinned to the bottom");
  Object.defineProperty(current.list, "scrollHeight", { get() { throw new Error("Unchanged snapshot forced layout"); } });
  assert.equal(context.patchStreamingBubble({ content: "hello", status: "Working" }), true);
  current = make(false);
  assert.equal(context.patchStreamingBubble({ content: "x" }), false, "never overwrites a finished answer");
  assert.equal(current.text.textContent, "");
  const handler = code.slice(code.indexOf('if (event === "snapshot")'), code.indexOf('if (event === "approval")'));
  assert.doesNotMatch(handler, /renderChat\(\)/, "snapshot must not rebuild every bubble");
});

test("skill refresh ignores stale responses even when the selected repo stays the same", async () => {
  const code = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = code.indexOf("async function loadMarketSkills(");
  const nodes = new Map();
  const pending = [];
  const context = { market: { skillTicket: 0, sources: [], skills: [] },
    $: (id) => { if (!nodes.has(id)) nodes.set(id, { value: "example/repo" }); return nodes.get(id); },
    request: () => new Promise((resolve) => pending.push(resolve)), renderMarketSkills: () => {} };
  vm.createContext(context);
  vm.runInContext(code.slice(start, code.indexOf("\nfunction renderMarketSkills", start)), context);
  const older = context.loadMarketSkills();
  const newer = context.loadMarketSkills(true);
  pending[1]({ skills: [{ name: "new" }] }); await newer;
  pending[0]({ skills: [{ name: "old" }] }); await older;
  assert.equal(context.market.skills[0].name, "new");
});
