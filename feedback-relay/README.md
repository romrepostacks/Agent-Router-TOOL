# Feedback relay

Receives anonymous reports from Settings → General → Feedback and files them as GitHub issues titled `[feedback <version>] …`.

One-time setup (free Cloudflare account):

1. GitHub → Settings → Developer settings → Fine-grained tokens → new token: only `Agent-Router-TOOL`, permission **Issues: Read and write**.
2. In this folder: `npx wrangler login`, then `npx wrangler secret put GITHUB_TOKEN` (paste the token), then `npx wrangler deploy`.
3. Put the printed `https://agent-router-feedback.<you>.workers.dev` URL in `FEEDBACK_URL` in `server.mjs` and rebuild. Deployed 2026-11-12: `https://agent-router-feedback.kylemeadows-522.workers.dev`.

Test locally: `node --test test/feedback.test.mjs` runs this worker against a fake GitHub.
