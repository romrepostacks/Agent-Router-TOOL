# Local Agent Router — Project Status

## Current status

The app provides a three-panel workspace with project/session navigation, chat, and task details. Settings sits in the top bar. Both side panels can be resized (drag the edge, arrow keys, double-click to reset) and hidden, and the layout is remembered.

Every installed provider (Colibri, Codex, Claude Code, Copilot) can be assigned to every route. Access is set by the route: no project access, read-only, edit in a private copy, or git-only (see README). The Routing menu offers Auto plus each route. The old provider-specific modes and their separate code path were removed.

The project is under git (`main`).

## Next steps

1. Rebuild the installer (`npm run make`) so the installed app matches the source; bump the version.
2. Add a small `node --test` suite for the diff/apply path and the Colibri file-block writer.
3. Move `lessons.md` to the user data folder so it is editable in the installed app.
4. Split `server.mjs` into modules (providers, proposals, routes) once the above is stable.
