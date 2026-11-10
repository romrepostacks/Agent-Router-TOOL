// Scans a skill from GitHub before it is installed: turns a GitHub link into the raw SKILL.md address,
// reads its name and purpose, and flags risky patterns for the user to review. Pattern checks only; a
// clean scan is not a guarantee.

const MAX_SKILL_BYTES = 200_000;

// Accepts a SKILL.md file, a skill folder, or a repo on github.com, or a raw.githubusercontent.com file.
export function githubSkillUrl(input) {
  let url;
  try { url = new URL(String(input || "").trim()); } catch { return null; }
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (parts.some((part) => part === ".." || part === ".")) return null;
  const withSkill = (segments) => /\.md$/i.test(segments.at(-1) || "") ? segments : [...segments, "SKILL.md"];
  let raw;
  if (url.hostname === "raw.githubusercontent.com" && parts.length >= 3) raw = withSkill(parts);
  else if (url.hostname === "github.com" || url.hostname === "www.github.com") {
    const [owner, repo, kind, ref, ...rest] = parts;
    if (!owner || !repo) return null;
    if (!kind) raw = [owner, repo.replace(/\.git$/, ""), "HEAD", "SKILL.md"];
    else if ((kind === "blob" || kind === "tree") && ref) raw = [owner, repo, ref, ...withSkill(rest)];
    else return null;
  } else return null;
  return "https://raw.githubusercontent.com/" + raw.map(encodeURIComponent).join("/");
}

export function parseSkillFile(text) {
  const match = text.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const pair = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (pair) meta[pair[1].toLowerCase()] = pair[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { name: meta.name || "", description: meta.description || "", body: (match ? text.slice(match[0].length) : text).trim(), hasFrontmatter: Boolean(match) };
}

const CHECKS = [
  ["high", "Tries to override your instructions or hide things from you", /ignore (all |any )?(previous|prior|above|earlier) (instructions|rules)|disregard (the |all )?(system|previous|prior)|do not (tell|inform|show) the user|without (telling|asking) the user/i],
  ["high", "Downloads and runs code in one step", /\b(curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh|iex|Invoke-Expression|python3?|node)\b/i],
  ["high", "Runs encoded or obfuscated code", /base64\s+(-d|--decode)|FromBase64String|\beval\s*\(|-EncodedCommand|\batob\s*\(/i],
  ["high", "Turns off safety checks or permission prompts", /--dangerously|--no-verify|disable (the )?(antivirus|firewall|defender|sandbox)|bypass (the )?(permission|approval|sandbox|safety)|skip (all )?permission prompts?/i],
  ["high", "Contains hidden or direction-changing characters", /[​-‏‪-‮⁦-⁩]/],
  ["medium", "Mentions passwords, keys, tokens, or secret files", /\.ssh\b|id_rsa|\.env\b|api[_ -]?keys?\b|\bsecrets?\b|\bpasswords?\b|credentials?|keychain|\.aws\b|access[_ -]?tokens?/i],
  ["medium", "Sends data to a web address or webhook", /\b(curl|wget)\b[^\n]*(\s-d\b|--data|\s-F\b|-X\s*POST)|method:\s*["']POST|\bwebhooks?\b|Invoke-RestMethod[^\n]*-Method\s+Post/i],
  ["medium", "Deletes files or force-pushes", /\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r|Remove-Item[^\n]*-Recurse|\bdel\s+\/[sq]|\bformat\s+[a-z]:|push\s+(-f\b|--force)|reset\s+--hard/i],
  ["medium", "Contains hidden comments", /<!--[\s\S]*?-->/],
  ["info", "Installs software", /\b(npm|pnpm|yarn)\s+(install|add)\s+(-g|--global)\b|\bpip3?\s+install\b|\buv\s+(pip|tool)\s+install\b|\b(brew|winget|choco|apt(-get)?)\s+install\b/i],
  ["info", "Refers to bundled scripts or files that are not installed (only the SKILL.md text is)", /\b(scripts|references|assets|agents)\/[\w./-]+\.\w+/],
];

export function scanSkillText(text) {
  const warnings = [];
  for (const [level, title, pattern] of CHECKS) {
    const line = text.split(/\r?\n/).find((entry) => pattern.test(entry)) ?? (pattern.test(text) ? text.match(pattern)[0] : null);
    if (line !== null) warnings.push({ level, title, example: line.trim().replace(/[​-‏‪-‮⁦-⁩]/g, "�").slice(0, 200) });
  }
  const parsed = parseSkillFile(text);
  if (!parsed.description) warnings.push({ level: "info", title: "No description in the skill header, so its purpose is a guess from the first line", example: "" });
  if (parsed.body.length > 18000) warnings.push({ level: "info", title: `Long skill: only the first 18,000 of ${parsed.body.length.toLocaleString("en-US")} characters are sent to providers`, example: "" });
  return warnings;
}

// The two outside reviewers (UPGRADE_LIST #3), run as installed command-line tools on a temp copy of the SKILL.md.
// SkillSpector runs static-only (--no-llm): no API key needed and no skill text leaves this computer.
// Each result stands alone; a reviewer that isn't installed is "unavailable", never a pass.
export const REVIEWERS = [
  {
    id: "skillspector", name: "NVIDIA SkillSpector", command: () => process.env.SKILLSPECTOR_CLI || "skillspector",
    // JSON on stdout: SkillSpector refuses --output on Windows ("Safe file output is unsupported on this platform").
    args: (dir) => ["scan", dir, "--no-llm", "--format", "json"], output: "stdout",
    parse: (data) => ({
      safe: data.risk_assessment?.recommendation === "SAFE",
      summary: `${String(data.risk_assessment?.recommendation || "UNKNOWN").replace(/_/g, " ").toLowerCase()} · risk ${data.risk_assessment?.score ?? "?"}/100`,
      findings: (data.issues || []).map((issue) => ({ severity: String(issue.severity || "").toLowerCase(), title: [issue.category, issue.pattern].filter(Boolean).join(": "), detail: issue.explanation || issue.finding || "", line: issue.location?.start_line ?? null })),
    }),
  },
  {
    id: "cisco", name: "Cisco Skill Scanner", command: () => process.env.SKILL_SCANNER_CLI || "skill-scanner",
    args: (dir) => ["scan", dir, "--format", "json"], output: "stdout",
    parse: (data) => ({
      safe: data.is_safe === true,
      summary: `${data.is_safe ? "safe" : "not safe"} · highest severity ${String(data.max_severity || "none").toLowerCase()}`,
      findings: (data.findings || []).map((finding) => ({ severity: String(finding.severity || "").toLowerCase(), title: finding.title || finding.rule_id || "", detail: finding.description || "", line: finding.line_number ?? null })),
    }),
  },
];

export async function runReviewers(text, workDir, { timeoutMs = 180_000 } = {}) {
  const { execFile } = await import("node:child_process");
  const { mkdir, readFile, rm, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const skillDir = path.join(workDir, "skill");
  await mkdir(skillDir, { recursive: true });
  await writeFile(path.join(skillDir, "SKILL.md"), text);
  try {
    return await Promise.all(REVIEWERS.map(async (reviewer) => {
      const out = path.join(workDir, `${reviewer.id}.json`);
      // Both tools exit non-zero when they find something; the JSON report decides, not the exit code.
      const result = await new Promise((resolve) => execFile(reviewer.command(), reviewer.args(skillDir, out), { timeout: timeoutMs, maxBuffer: 20_000_000, windowsHide: true }, (error, stdout, stderr) => resolve({ error, stdout, stderr })));
      const base = { id: reviewer.id, name: reviewer.name };
      if (result.error?.code === "ENOENT") return { ...base, status: "unavailable" };
      try {
        const raw = reviewer.output === "file" ? await readFile(out, "utf8") : result.stdout;
        return { ...base, status: "ok", ...reviewer.parse(JSON.parse(raw.slice(raw.indexOf("{")))) };
      } catch {
        const reason = result.error?.killed ? "timed out" : String(result.stderr || result.error?.message || "no report").trim().split(/\r?\n/).at(-1).slice(0, 300);
        return { ...base, status: "error", error: reason };
      }
    }));
  } finally { await rm(workDir, { recursive: true, force: true }); }
}

// Fetches only from raw.githubusercontent.com, never follows redirects, and caps the size.
export async function fetchGithubSkill(input, fetchImpl = fetch) {
  const rawUrl = githubSkillUrl(input);
  if (!rawUrl) throw Object.assign(new Error("Paste a GitHub link to a skill: a SKILL.md file, its folder, or the repo."), { status: 400 });
  const response = await fetchImpl(rawUrl, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { Accept: "text/plain" } });
  if (response.status === 404) throw Object.assign(new Error("No SKILL.md found at that link. Link to the skill's folder or its SKILL.md file."), { status: 404 });
  if (!response.ok) throw Object.assign(new Error(`GitHub answered ${response.status}. Check the link and try again.`), { status: 502 });
  const tooLarge = () => Object.assign(new Error("That skill is larger than 200 KB, which is too large to review."), { status: 413 });
  if (Number(response.headers?.get?.("content-length")) > MAX_SKILL_BYTES) throw tooLarge();
  // Stop reading once past the cap instead of buffering an oversized download.
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > MAX_SKILL_BYTES) throw tooLarge(); // leaving for-await cancels the stream
    chunks.push(Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.includes("\u0000")) throw Object.assign(new Error("That file is not a text skill."), { status: 415 });
  const parsed = parseSkillFile(text);
  const segments = new URL(rawUrl).pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const folder = segments.length > 4 ? segments.at(-2) : segments[1];
  const name = (parsed.name || folder || "Imported skill").replace(/[^A-Za-z0-9 _-]+/g, " ").replace(/\s+/g, " ").trim().replace(/^[^A-Za-z0-9]+/, "").slice(0, 60) || "Imported skill";
  const purpose = parsed.description || parsed.body.split(/\r?\n/).find((line) => line.trim() && !/^#/.test(line))?.trim().slice(0, 300) || "";
  return { source: rawUrl, name, purpose, instructions: parsed.body, warnings: scanSkillText(text), text };
}
