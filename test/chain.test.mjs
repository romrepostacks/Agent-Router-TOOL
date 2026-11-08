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
