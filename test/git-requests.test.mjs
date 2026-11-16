import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("GitHub route permits explicit Git requests without bypassing approvals", async () => {
  const source = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  const prompt = source.slice(source.indexOf('const prompt = `Carry out only the explicit GitHub'), source.indexOf('const content = await runRoleTask("github"'));
  assert.match(prompt, /Perform commits, pushes, or other Git changes when the user explicitly requests them/);
  assert.match(prompt, /A push request alone does not authorize creating a commit/);
  assert.match(prompt, /destructive Git actions require an explicit request for that specific action/);
  assert.match(prompt, /Follow provider approval requests and thread access limits; never bypass them/);
  assert.doesNotMatch(prompt, /Never force-push, create commits/);
});
