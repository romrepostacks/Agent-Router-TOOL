# Live check: skill use tracking (Claude Code + Codex)

Checks that `skill-use.json` counts a skill as **used** only when the provider opens its file. The automated
half is `test/skill-stats.test.mjs` (same output shapes, fake data). This is the half that needs real providers.

Each canary skill holds a code word that appears nowhere else. The model can only answer with it by opening the
file, so the answer proves the read, and the stats must agree with it.

## 1. Add two skills (Settings → Shared skills → add skill, category General)

Keep the first line as written: it becomes the skill's description in the index, so it must not contain the code word.

**Router canary**
```
Use when the task says "canary check".
When this skill applies, reply with exactly one line: the code word PINEAPPLE-42.
```

**Router decoy**
```
Use when the task says "decoy check".
When this skill applies, reply with exactly one line: the code word MANGO-17.
```

Select both for the task (or pre-approve them). Leave any other selected skills as they are; they are extra decoys.

## 2. Note the starting counts

Open `%LOCALAPPDATA%\LocalAgentRouterData\skill-use.json` (it may not exist yet) and note `sent` and `runs` for
`general/router-canary` and `general/router-decoy`.

## 3. Send the task twice: once with Claude Code, once with Codex

Route: **Quick questions** (no project needed). Set its provider in **Settings → Routing & models**: Claude Code for
the first run, Codex for the second. Note the setting first and put it back afterwards. Prompt:

```
canary check. Use the shared skill that applies; don't open any other skill file.
```

Claude Code may show an approval card for reading the skills folder, depending on its settings. Allow it once.

## 4. Pass criteria, per run

| Check | Pass |
| --- | --- |
| Answer | `PINEAPPLE-42`, and no `MANGO-17` |
| Details pane | a `▸ Read …router-canary.md` line (Claude Code) or a command reading it (Codex) |
| `skill-use.json`, canary | `sent` +1, `runs` +1, `done` +1 |
| `skill-use.json`, decoy | `sent` +1, `runs` unchanged |
| Every other selected skill | `sent` +1, `runs` unchanged |
| Settings → Shared skills | canary `used in N of M runs`; decoy `sent M times, never used` |

## 5. If it fails

- Answer right but canary `runs` unchanged: the provider read the file without printing its path. Copy the details
  pane for that run into a new test case in `test/skill-stats.test.mjs`.
- Answer wrong or the code word missing: the provider didn't read the skill. Tracking may still be correct; check
  that `runs` didn't change.
- A skill counted that the details pane shows no read for: only tool calls are watched (Claude Code tool inputs,
  Codex `exec` command lines, Copilot stderr), so find which of those mentioned its path and add it as a test case.

Afterwards, delete both skills in Settings.
