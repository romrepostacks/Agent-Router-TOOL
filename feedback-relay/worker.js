// Anonymous feedback relay (Cloudflare Worker). The app POSTs { text, diagnostics }; this files a GitHub issue with
// the repo owner's token, so reporters need no account and the token never ships in the app.
// Secrets: GITHUB_TOKEN (fine-grained, this repo only, Issues: read and write). Vars: GITHUB_REPO ("owner/name").
// ponytail: no rate limit; add a Cloudflare rate-limiting rule on this route if spam shows up.
const fence = (value) => "```\n" + String(value).replace(/```/g, "'''") + "\n```"; // code blocks don't ping @mentions

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("POST only", { status: 405 });
    const raw = await request.text();
    if (raw.length > 30_000) return new Response("Too large", { status: 413 });
    let report;
    try { report = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
    const text = String(report?.text || "").trim();
    if (!text || text.length > 5000) return new Response("Bad text", { status: 400 });
    const version = String(report.diagnostics?.app?.version || "?").slice(0, 20);
    const title = `[feedback ${version}] ${text.split("\n")[0].slice(0, 80)}`;
    const body = `${fence(text)}\n\n<details><summary>Diagnostics</summary>\n\n${fence(JSON.stringify(report.diagnostics ?? {}, null, 2))}\n</details>\n\n_Sent anonymously from the app._`;
    const response = await fetch(`${env.GITHUB_API || "https://api.github.com"}/repos/${env.GITHUB_REPO}/issues`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "agent-router-feedback", "Content-Type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    return new Response(response.ok ? "ok" : "GitHub refused", { status: response.ok ? 201 : 502 });
  },
};
