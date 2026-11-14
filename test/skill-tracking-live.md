# Live check: skill use tracking (Claude Code + Codex)

**Status: resolved 2026-11-14.** The owner ran both checks in 0.24.0; both returned PINEAPPLE-42. Keep this doc for
re-checking after changes to `skillUseWatcher()` or `cliToolText()`.

Checks that a skill counts as **used** only when the provider opens its file. The automated half is
`test/skill-stats.test.mjs` (same output shapes, fake data). This half needs real providers. Every step is done in the
app (0.24.0 or later); no files need opening.

Each test skill holds a code word that appears nowhere else. The model can only answer with it by opening the
file, so the answer proves the read, and the counts in Settings must agree with it.

## 1. Add two skills (task box → + menu → Shared skills)

Press **+** at the bottom left of the task box, scroll to **Shared skills**, and press **Add a shared skill**. Category: `General`.
Keep the first line of each as written: it becomes the skill's description in the list sent to the model, so it must
not contain the code word. Press **Save skill** after each.

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

A saved skill is ticked for the task automatically. Check both are ticked in the panel. If one isn't (the skill limit
is full), raise the limit in **Settings → Shared skills** or untick another task skill. Your pre-approved skills
stay as they are; they are extra decoys.

## 2. Note the starting counts (Settings → Shared skills)

Under **Always-on shared skills**, type `router` in **Find a skill**. Both new skills should say `not used yet`.
Leave them unticked there; they're already ticked for the task. Close Settings.

## 3. Send the task twice: once with Claude Code, once with Codex

1. **Settings → Routing & models → Quick questions:** note the current preferred and fallback providers. Set the
   preferred provider to Claude Code. Press **Save settings**.
2. Choose any project in the left panel (Quick questions never reads it). In the top bar, open the route menu
   (`Auto ⌄`) and choose **Quick questions**.
3. Open **Task details** in the right panel: **Skills for this task** must list both Router skills.
4. Send:
   ```
   canary check. Use the shared skill that applies; don't open any other skill file.
   ```
   Claude Code may show an approval card for reading the skills folder, depending on its settings. Allow it once.
5. Check the run (table below), then repeat steps 1, 4 and the checks with **Codex** as the preferred provider.

If the preferred provider fails, the fallback runs instead. The agent output panel names the provider that answered;
if it's the fallback, that run doesn't count for this check.

## 4. Pass criteria, per run

Reopen **Settings → Shared skills** after each run and find `router` again. N is 1 after the first run, 2 after the second.

| Check | Pass |
| --- | --- |
| Answer | `PINEAPPLE-42`, and no `MANGO-17` |
| Agent output panel | a `▸ Read …router-canary.md` line (Claude Code) or a command reading it (Codex) |
| Router canary | `used in N of N runs: N done, 0 failed, 0 stopped` |
| Router decoy | `sent N times, never used` |
| Other pre-approved skills | the `sent` count went up by 1; their `used in` count didn't change |

## 5. If it fails

- Answer right but canary still `sent … never used`: the provider read the file without printing its path. Copy the
  agent output for that run into a new test case in `test/skill-stats.test.mjs`.
- Answer wrong or the code word missing: the provider didn't read the skill. Tracking may still be correct; check
  that the canary's `used in` count didn't change.
- A skill shows as used but the agent output shows no read of it: only tool calls are watched (Claude Code tool
  inputs, Codex `exec` command lines, Copilot stderr), so find which of those mentioned its path and add it as a
  test case.

## 6. Clean up

- **Settings → Shared skills:** find `router` and press **Delete** on both skills. Their counts stay in
  `skill-use.json` but no longer show.
- **Settings → Routing & models → Quick questions:** put back the providers you noted. Press **Save settings**.
- Set the route menu back to what you use (usually **Auto**).
