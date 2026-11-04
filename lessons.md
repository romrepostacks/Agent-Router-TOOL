# Routing lessons

- If a request mentions “this project,” “this repo,” “this codebase,” its files, architecture, current status, or what to do next, choose `PROJECT`. Do not send it to Colibri as a context-free `QUICK` question.
- Choose `QUICK` only when the answer does not depend on the selected project or its files. Colibri handles this route locally.
- Choose `PROJECT` for read-only explanations, summaries, status, and next-step recommendations based on repository contents. GPT must inspect relevant project files and cite paths.
- Keep project analysis token-bounded: inspect documentation first, skip generated assets, binary files, dependencies, and build output, and read only a few relevant text files.
- GPT project analysis must be allowed to use read-only file commands such as `rg --files`, `rg -n`, and `Get-Content -LiteralPath`; do not forbid all commands and then expect it to read local files. If access fails, it must attempt a read, name the failed path, and continue with other accessible files.
- Choose `CODE` only when the user asks to implement, change, or debug code. GPT makes a read-only plan; Claude implements; Codex and then Copilot are coding fallbacks.
- Choose `SECURITY` for an explicit security audit or security-focused review. Copilot performs it read-only.
- Choose `PUSH` only when the user explicitly directs the router to push to GitHub. “How do I push?” is a question, not permission to push.
- In All Projects scope, project analysis and security review are read-only. Coding or pushing requires selecting one project.
- When unsure whether the answer needs project files, choose `PROJECT` rather than `QUICK`.

- All providers work in the same selected project directory and use `.agent-router/LOCAL_AGENT_ROUTER_HANDOFF.md` for the latest shared task, plan, result, and fallback status. Do not create provider-specific copies or worktrees.
- Requests to continue or resume project work should consult the shared handoff and current files; choose `CODE` only when the user asks for an implementation or fix.
