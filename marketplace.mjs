// Skill and MCP marketplaces for Settings → Marketplace (desktop) and Settings → Marketplace (phone).
// Skill sources are GitHub repos; one anonymous tree request lists every SKILL.md in a repo. Installing a listed
// skill goes through the existing scan (skill-scan.mjs) and review, the same as pasting its GitHub link.
// MCP sources are registries that speak the MCP Registry API (GET <base>?search=&cursor=&limit=&version=latest).

// The defaults the other desktop apps use (researched 2026-11-20):
// - Anthropic's public skills and plugin repositories (see docs/marketplace-research.md).
// - ChatGPT / Codex: openai/plugins (current) and openai/skills (the older curated list, now deprecated).
// - Hermes Agent: its official optional skills, in NousResearch/hermes-agent.
// LM Studio's documented integration is mcp.json and install links; no skills catalog was verified.
export const SKILL_SOURCES = [
  { repo: "anthropics/skills", label: "Anthropic skills", from: "Claude Code · Claude desktop" },
  { repo: "anthropics/knowledge-work-plugins", label: "Cowork plugins", from: "Claude desktop · Curated by Anthropic" },
  { repo: "anthropics/claude-plugins-official", label: "Claude Code plugins", from: "Claude desktop · Claude Code default" },
  { repo: "anthropics/financial-services", label: "Claude for Financial Services", from: "Claude desktop · Curated by Anthropic" },
  { repo: "anthropics/claude-for-legal", label: "Claude for Legal", from: "Claude desktop · Curated by Anthropic" },
  { repo: "anthropics/life-sciences", label: "Claude for Life Sciences", from: "Claude desktop · Curated by Anthropic" },
  { repo: "openai/plugins", label: "OpenAI plugins", from: "ChatGPT · Codex" },
  { repo: "openai/skills", label: "OpenAI curated skills", from: "Codex (deprecated list)" },
  { repo: "NousResearch/hermes-agent", label: "Hermes skills", from: "Hermes Agent" },
  ...["huggingface/skills", "NVIDIA/skills", "wandb/skills", "qdrant/skills", "pinecone-io/skills", "makenotion/skills", "Airtable/skills", "Shopify/Shopify-AI-Toolkit", "garrytan/gstack", "K-Dense-AI/scientific-agent-skills", "synthetic-sciences/openscience"].map((repo) => ({ repo, label: repo, from: "Hermes default GitHub tap; review before installing" })),
];

// Claude desktop's and ChatGPT's connector directories need their own sign-in, so they can't be listed here. The
// open MCP Registry is a separate public catalog, not a mirror of either signed-in directory.
export const MCP_REGISTRIES = [
  { id: "official", label: "MCP Registry", url: "https://registry.modelcontextprotocol.io/v0.1/servers", from: "modelcontextprotocol.io · open registry" },
  { id: "github", label: "GitHub MCP Registry", url: "https://api.mcp.github.com/v0.1/servers", from: "VS Code · GitHub Copilot" },
];

const REPO = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

// Accepts owner/repo or a github.com repo link. Returns "owner/repo" or null.
export function parseRepo(input) {
  const text = String(input || "").trim().replace(/\.git$/, "").replace(/\/+$/, "");
  const match = text.match(/^(?:https:\/\/(?:www\.)?github\.com\/)?([^/\s]+\/[^/\s]+)$/i);
  return match && REPO.test(match[1]) && !match[1].split("/").includes("..") ? match[1] : null;
}

// Every SKILL.md in a repo tree, as rows the UI can list. `group` is the plugin folder a skill belongs to.
export function skillsFromTree(repo, tree = []) {
  const seen = new Set();
  const rows = [];
  for (const entry of tree) {
    if (entry.type !== "blob" || !/(^|\/)SKILL\.md$/i.test(entry.path)) continue;
    const dir = entry.path.split("/").slice(0, -1);
    const name = dir.at(-1) || repo.split("/")[1];
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    // The folder holding the skill, or the plugin above a skills/ folder: bio/skills/x → bio, skills/.curated/x → curated.
    const parent = dir.at(-2) === "skills" ? dir.at(-3) : dir.at(-2);
    const group = (parent || "").replace(/^\./, "");
    rows.push({ name, group, path: entry.path, url: `https://github.com/${repo}/blob/HEAD/${entry.path.split("/").map(encodeURIComponent).join("/")}` });
  }
  return rows.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

// ponytail: in-memory cache, 1 hour. GitHub allows 60 anonymous requests an hour; persist the cache if that bites.
const treeCache = new Map();
export async function listSourceSkills(repo, { refresh = false, fetchImpl = fetch } = {}) {
  const clean = parseRepo(repo);
  if (!clean) throw Object.assign(new Error("Enter a GitHub repo as owner/repo."), { status: 400 });
  const hit = treeCache.get(clean);
  if (hit && !refresh && Date.now() - hit.at < 3_600_000) return hit.value;
  const response = await fetchImpl(`https://api.github.com/repos/${clean}/git/trees/HEAD?recursive=1`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "local-agent-router" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (response.status === 404) throw Object.assign(new Error(`GitHub has no public repo ${clean}.`), { status: 404 });
  if (response.status === 403 || response.status === 429) throw Object.assign(new Error("GitHub's hourly limit for anonymous requests was reached. Try again in a while."), { status: 429 });
  if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status}.`), { status: 502 });
  const data = await response.json();
  const value = { repo: clean, skills: skillsFromTree(clean, data.tree), truncated: Boolean(data.truncated), checkedAt: new Date().toISOString() };
  treeCache.set(clean, { at: Date.now(), value });
  return value;
}

const shortName = (name) => String(name || "server").split("/").at(-1).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "server";
const webAddress = (value) => { try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) ? url.href : ""; } catch { return ""; } };

// Turns one registry entry into a row: what it is, and the pass-through server it would add (`install`), plus what
// the user must still fill in (`needs`). Only remote HTTP servers and npm/PyPI stdio packages can be added here.
export function registryRow(item) {
  const s = item?.server || item || {};
  const github = s._meta?.["io.modelcontextprotocol.registry/publisher-provided"]?.github;
  const needs = [];
  let install = null;
  const remote = (s.remotes || []).find((r) => r.type === "streamable-http" || r.type === "http");
  const pkg = (s.packages || []).find((p) => (p.transport?.type || "stdio") === "stdio" && ["npm", "pypi"].includes(p.registryType));
  if (remote?.url && !(remote.headers || []).some((h) => h.isRequired)) install = { type: "http", url: remote.url };
  else if (pkg) {
    const pinned = pkg.version && pkg.version !== "latest";
    install = pkg.registryType === "npm"
      ? { type: "stdio", command: "npx", args: ["-y", pinned ? `${pkg.identifier}@${pkg.version}` : pkg.identifier] }
      : { type: "stdio", command: "uvx", args: [pinned ? `${pkg.identifier}==${pkg.version}` : pkg.identifier] };
    for (const arg of pkg.packageArguments || []) if (arg.isRequired) needs.push(`argument ${arg.name || arg.valueHint || "value"}${arg.description ? `: ${arg.description}` : ""}`);
    for (const env of pkg.environmentVariables || []) if (env.isRequired) needs.push(`environment variable ${env.name}${env.description ? `: ${env.description}` : ""}`);
  } else if (remote?.url) {
    install = { type: "http", url: remote.url };
    for (const h of remote.headers || []) if (h.isRequired) needs.push(`header ${h.name}${h.description ? `: ${h.description}` : ""}`);
  } else needs.push("no remote address or npm/PyPI package; add it by hand from its website");
  if (install?.type === "http") {
    if (!webAddress(install.url)) { install = null; needs.push("a valid HTTP server address"); }
    else {
      for (const [name, variable] of Object.entries(remote.variables || {})) if (!variable.default) needs.push(`address value ${name}`);
      if (/\{[^}]+\}/.test(install.url) && !needs.some((need) => need.startsWith("address value"))) needs.push("values for the address placeholders");
      if (remote.authorization || s.authorization) needs.push("authentication in the provider; Router does not sign in to this service");
    }
  }
  if (install?.type === "stdio") {
    for (const arg of pkg.runtimeArguments || []) if (arg.isRequired) needs.push(`runtime argument ${arg.name || arg.valueHint || "value"}`);
    if (/\s|[;&|<>`$]/.test(pkg.identifier || "") || String(pkg.identifier || "").startsWith("-")) { install = null; needs.push("a valid package identifier"); }
  }
  return {
    id: s.name || "", title: github?.displayName || s.title || shortName(s.name), description: String(s.description || "").slice(0, 400),
    version: s.version || "", website: webAddress(s.websiteUrl || s.repository?.url || (github?.nameWithOwner ? `https://github.com/${github.nameWithOwner}` : "")),
    install: install && { name: shortName(github?.name || s.name), ...install }, needs,
  };
}

export async function searchRegistry(id, { search = "", cursor = "", fetchImpl = fetch } = {}) {
  const registry = MCP_REGISTRIES.find((entry) => entry.id === id);
  if (!registry) throw Object.assign(new Error("Unknown MCP registry."), { status: 400 });
  const url = new URL(registry.url);
  url.searchParams.set("limit", "30");
  url.searchParams.set("version", "latest");
  if (search) url.searchParams.set("search", String(search).slice(0, 100));
  if (cursor) url.searchParams.set("cursor", String(cursor).slice(0, 500));
  const response = await fetchImpl(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw Object.assign(new Error(`${registry.label} answered ${response.status}.`), { status: 502 });
  const data = await response.json();
  const seen = new Set();
  const servers = (data.servers || []).map(registryRow).filter((row) => row.id && !seen.has(row.id) && seen.add(row.id));
  return { registry: registry.id, servers, nextCursor: data.metadata?.nextCursor || data.metadata?.next_cursor || "" };
}
