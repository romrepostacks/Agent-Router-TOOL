import assert from 'node:assert/strict';
import test from 'node:test';
import { runCli, isUsageLimitError } from '../cli-runner.mjs';

test('active CLI runs outlast the inactivity window on either output channel', async () => {
  for (const channel of ['stdout', 'stderr']) {
    const result = await runCli(process.execPath, ['-e', `let n=0; const t=setInterval(()=>{process.${channel}.write('working\\n'); if(++n===8) clearInterval(t);},100);`], undefined, undefined, { idleTimeoutMs: 500 });
    assert.match(result, /working/);
  }
});
test('silent CLI is stopped after inactivity', async () => {
  await assert.rejects(runCli(process.execPath, ['-e', 'setInterval(()=>{},1000)'], undefined, undefined, { idleTimeoutMs: 300 }), /without output/);
});
test('Stop still cancels an active CLI', async () => {
  const controller = new AbortController();
  const result = runCli(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("working"),50)'], undefined, undefined, { signal: controller.signal, idleTimeoutMs: 1000, onDelta: () => controller.abort() });
  await assert.rejects(result, /Request stopped/);
});
test('numeric hour limits are recognized without matching unrelated errors', () => {
  assert.equal(isUsageLimitError(new Error("You've hit your 5-hour limit · resets 7pm (America/Phoenix)")), true);
  assert.equal(isUsageLimitError(new Error('You have reached your 1 hour limit')), true);
  assert.equal(isUsageLimitError(new Error('The CLI task timed out after 15 minutes.')), false);
  assert.equal(isUsageLimitError(new Error('architecture failed')), false);
});
