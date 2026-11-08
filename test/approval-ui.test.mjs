// The desktop page and the phone app answer approval cards with the same two helpers. Both copies are pulled out of
// the browser scripts and checked against the server's contract (answerApproval in server.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function helpers(file) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
  const pick = (name) => {
    const match = source.match(new RegExp(`^function ${name}\\([\\s\\S]*?^}\\r?$`, "m"));
    assert.ok(match, `${file} defines ${name}()`);
    return match[0];
  };
  const context = {};
  vm.runInNewContext(`${pick("approvalBody")}\n${pick("approvalResult")}\nthis.approvalBody = approvalBody; this.approvalResult = approvalResult;`, context);
  return { source, ...context };
}

for (const file of ["public/app.js", "mobile/www/app.js"]) {
  test(`${file}: three choices, Always allow never doubles as Allow`, async () => {
    const { source, approvalBody, approvalResult } = await helpers(file);
    const labels = [...source.matchAll(/decision: "(always|allow|deny)", label: "([^"]+)"/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(labels.map(([d]) => d).sort(), ["allow", "always", "deny"]);
    assert.deepEqual(Object.fromEntries(labels), { always: "Always allow", allow: "Allow", deny: "Deny" });

    assert.deepEqual(JSON.parse(JSON.stringify(approvalBody("always"))), { decision: "always" }); // no allow flag for old servers to fall back on
    assert.deepEqual(JSON.parse(JSON.stringify(approvalBody("allow"))), { decision: "allow", allow: true });
    assert.deepEqual(JSON.parse(JSON.stringify(approvalBody("deny"))), { decision: "deny", allow: false });

    assert.equal(approvalResult("always", 200, { id: "c", decision: "always", allow: true }).done, true);
    assert.equal(approvalResult("allow", 200, { id: "c", decision: "allow" }).message, "Allowed once.");
    assert.equal(approvalResult("deny", 200, { id: "c", decision: "deny" }).message, "Denied.");

    // Provider can't save a rule: server answers 409 and the card stays open for Allow or Deny.
    const refused = approvalResult("always", 409, { error: "This provider can't save a rule for this request. Choose Allow or Deny.", unsupported: true });
    assert.equal(refused.unsupported, true);
    assert.match(refused.message, /can't save a rule/);
    // A server from before `decision` existed answers 400; that is unsupported too, not an approval.
    assert.equal(approvalResult("always", 400, { error: "Send allow: true or false." }).unsupported, true);

    const gone = approvalResult("allow", 404, { error: "That approval was already answered or the run ended." });
    assert.equal(gone.error, true);
    assert.equal(gone.unsupported, undefined);
    assert.match(gone.message, /already answered/);
  });
}
