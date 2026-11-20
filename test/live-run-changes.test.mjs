// node --test test/*.test.mjs — mid-run permission mode, skill and folder changes reach a running Claude Code task.
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runClaudeStream } from "../cli-runner.mjs";
import { folderChangeNote, skillChangeNote, PUSH_RELEASE_RULE } from "../server.mjs";

// Records mode changes and user messages; finishes once it has the prompt, a note and a mode change.
const fake = path.join(await mkdtemp(path.join(os.tmpdir(), "router-live-")), "fake-claude.mjs");
await writeFile(fake, `
import readline from "node:readline";
const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
const seen = { modes: [], users: [] };
for await (const line of readline.createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.type === "control_request" && m.request.subtype === "initialize") out({ type: "control_response", response: { subtype: "success", request_id: m.request_id } });
  if (m.type === "control_request" && m.request.subtype === "set_permission_mode") seen.modes.push(m.request.mode);
  if (m.type === "user") seen.users.push(m.message.content);
  if (seen.modes.length && seen.users.length === 2) out({ type: "result", is_error: false, result: JSON.stringify(seen) });
}
`);

test("a running Claude Code task takes a mode change and a note, and the handle goes away when it ends", async () => {
  const handles = [];
  let first;
  const result = JSON.parse(await runClaudeStream(process.execPath, [fake], undefined, undefined, {
    prompt: "build it",
    onControl: (handle) => {
      handles.push(handle);
      if (handle && !first) { first = handle; handle.setPermissionMode("acceptEdits"); handle.say("note"); }
    },
  }));
  assert.deepEqual(result.modes, ["acceptEdits"]);
  assert.deepEqual(result.users.sort(), ["build it", "note"]);
  assert.equal(handles.at(-1), null);
  assert.equal(first.say("too late"), false);
  assert.equal(first.setPermissionMode("plan"), false);
});

test("change notes keep linked folders read-only and name removed skills", () => {
  const folders = folderChangeNote([{ name: "docs", path: "C:\\docs" }], [{ name: "old", path: "C:\\old" }]);
  assert.match(folders, /read-only/);
  assert.match(folders, /Now linked: docs — C:\\docs/);
  assert.match(folders, /stop using it: old/);
  assert.match(skillChangeNote("", [{ name: "lean-build" }]), /stop following it: lean-build/);
});

test("the push rule updates the release and deletes older ones but keeps tags", () => {
  assert.match(PUSH_RELEASE_RULE, /gh release create/);
  assert.match(PUSH_RELEASE_RULE, /gh release delete <tag> --yes/);
  assert.match(PUSH_RELEASE_RULE, /never pass --cleanup-tag/);
});
