// node --test test/*.test.mjs — the change preview diff stays readable for large files with small edits.
// public/app.js is a browser script, so the two pure diff helpers are lifted out of its source.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const grab = (name) => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.slice(start).search(/\r?\n\}\r?\n/);
  assert.ok(start >= 0 && end > 0, `${name} not found in public/app.js`);
  return source.slice(start, start + end) + "\n}";
};
const lineDiff = new Function(`${grab("lineDiff")}\n${grab("collapseUnchanged")}\nreturn lineDiff;`)();

test("a one-line edit in a 3000-line file shows only that change plus context", () => {
  const before = Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n");
  const rows = lineDiff(before, before.replace("line 1500\n", "line 1500 changed\n"));
  assert.deepEqual(rows.filter(([kind]) => kind === "-").map(([, line]) => line), ["line 1500"]);
  assert.deepEqual(rows.filter(([kind]) => kind === "+").map(([, line]) => line), ["line 1500 changed"]);
  assert.ok(rows.length < 12, `expected a collapsed diff, got ${rows.length} rows`);
  assert.equal(rows[0][0], "…");
});

test("new files show every line as added", () => {
  assert.deepEqual(lineDiff(null, "x\ny"), [["-", ""], ["+", "x"], ["+", "y"]]);
});
