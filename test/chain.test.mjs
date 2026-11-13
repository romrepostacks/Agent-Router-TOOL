import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRoutePrompt, buildChainPrompt, parseRoute, parseChainPlan, buildStepsOverlap } from '../route-rules.mjs';

test('chain routing and bounded planner tasks', () => {
  assert.equal(parseRoute('ROUTE: CHAIN\nREASON: app spec').route, 'chain');
  assert.match(buildRoutePrompt([], ''), /CHAIN/);
  const plan = parseChainPlan(JSON.stringify({summary:'Build and check',steps:[{route:'code',task:'Backend',files:['src/api.js']},{route:'ui',task:'UI',files:['public/']},{route:'security',task:'Audit',files:[]}]}));
  // Security is never a chain step: a planner that adds one has it dropped; the user asks for it separately.
  assert.deepEqual(plan.steps.map((step) => step.route), ['code', 'ui']);
  assert.doesNotMatch(buildChainPrompt('build it and audit it'), /^- security:/m);
  assert.match(buildRoutePrompt([], ''), /never includes a security audit/);
  assert.equal(buildStepsOverlap(plan.steps), false);
  assert.equal(buildStepsOverlap([{route:'code',files:['public']},{route:'ui',files:['public/app.js']}]), true);
  assert.equal(buildStepsOverlap([{route:'code',files:[]}]), true);
  assert.throws(() => parseChainPlan('{"steps":[{"route":"github","task":"push"}]}'), /no tasks/);
  for (const file of ['../outside','C:/outside','/outside','src/../outside']) {
    assert.throws(() => parseChainPlan(JSON.stringify({steps:[{route:'code',task:'Build',files:[file]}]})), /relative project paths/);
  }
});

test('chain step prompts stay bounded as steps add results', async () => {
  const { chainStepPrompt, compactHandoff } = await import('../route-rules.mjs');
  const { compactMemory } = await import('../project-memory.mjs');
  const plan = parseChainPlan(JSON.stringify({summary:'Build then review',steps:[
    {route:'code',task:'Backend',files:['server.mjs']},{route:'ui',task:'UI',files:['public/']},{route:'review',task:'Check it',files:[]}]}));
  const huge = 'x'.repeat(50_000);
  const results = [{index:1,route:'code',content:huge + '\nFiles changed: server.mjs'},{index:2,route:'ui',content:huge,failed:true}];
  const prompt = chainStepPrompt('Do the thing', plan, plan.steps[2], results);
  assert.ok(prompt.length < 6000, `review prompt is ${prompt.length} chars`);
  assert.match(prompt, /Files changed: server\.mjs/); // the end of a report survives
  assert.match(prompt, /2\. ui \(failed\)/);
  assert.match(prompt, /3\. review \(you\)/);
  assert.match(prompt, /current project files/);
  assert.doesNotMatch(prompt, /Assigned paths/);
  const build = chainStepPrompt('Do the thing', plan, plan.steps[0], []);
  assert.match(build, /Assigned paths: server\.mjs/);
  assert.doesNotMatch(build, /Handoffs/);
  assert.equal(compactHandoff('short'), 'short');
  assert.equal(compactHandoff(huge).length < 1600, true);
  const memory = compactMemory(Array.from({length:12}, (_, i) => ({role:'review',kind:'review',provider:'p',task:huge,summary:huge,recordedAt:String(i)})));
  assert.equal(memory.length, 4);
  assert.equal(memory[3].recordedAt, '11');
  assert.ok(JSON.stringify(memory).length < 4000);
  assert.equal(memory[0].task, undefined);
});
