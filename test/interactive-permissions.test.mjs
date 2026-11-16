import assert from "node:assert/strict";
import test from "node:test";
import { runCodexStream } from "../codex-runner.mjs";
import { runCopilotStream } from "../copilot-runner.mjs";
import { runCli } from "../cli-runner.mjs";

test("provider activity cannot restart the timer during an approval wait", async () => {
  const result = await runCli(process.execPath, ["-e", 'const t=setInterval(()=>process.stdout.write("waiting\\n"),50); process.stdin.once("data",()=>{clearInterval(t); process.exit(0)});'], process.cwd(), undefined, {
    idleTimeoutMs: 200,
    stdin: (io) => { void io.hold(new Promise((resolve) => setTimeout(resolve, 700))).then(() => io.write("answered")); },
  });
  assert.match(result, /waiting/);
});

// A real child process exercises initialization, request IDs, decisions and completion over stdio.
const fake = `
const out = m => process.stdout.write(JSON.stringify(m) + '\\n');
require('readline').createInterface({input:process.stdin}).on('line', line => {
 const m=JSON.parse(line);
 if(m.id==='initialize') out({id:m.id,result:{}});
 if(m.id==='thread') { if(m.params.approvalPolicy!=='on-request') process.exit(2); out({id:m.id,result:{thread:{id:'t'}}}); }
 if(m.id==='session') out({id:m.id,result:{sessionId:'s'}});
 if(m.id==='turn') out({id:42,method:'item/commandExecution/requestApproval',params:{command:'echo test',reason:'needs access'}});
 if(m.id==='prompt') out({id:42,method:'session/request_permission',params:{toolCall:{title:'shell'},options:[{kind:'allow_once',optionId:'yes'},{kind:'reject_once',optionId:'no'}]}});
 if(m.id===42) {
  if(m.result.decision) {
   out({method:'item/agentMessage/delta',params:{delta:m.result.decision}});
   out({method:'turn/completed',params:{turn:{status:'completed'}}});
  } else {
   out({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{type:'text',text:m.result.outcome.optionId || 'cancelled'}}}});
   out({id:'prompt',result:{stopReason:'end_turn'}});
  }
 }
});`;

for (const [name, run, accepted, denied] of [["Codex", runCodexStream, "accept", "decline"], ["Copilot", runCopilotStream, "yes", "no"]]) {
  test(`${name} passes approvals through and fails closed without an answer`, async () => {
    const invoke = (onApproval) => run(process.execPath, ["-e", fake, "--"], process.cwd(), undefined, { prompt: "test", onApproval, idleTimeoutMs: 3000 });
    let card;
    assert.equal(await invoke(async (request) => { card = request; return "allow"; }), accepted);
    assert.equal(card.canAlwaysAllow, false);
    assert.equal(await invoke(async () => "deny"), denied);
    assert.equal(await invoke(undefined), denied);
    assert.equal(await invoke(async () => { throw new Error("disconnected"); }), denied);
    assert.equal(await invoke(async () => "always"), denied);
  });
}
