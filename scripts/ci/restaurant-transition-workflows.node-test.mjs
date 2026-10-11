import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

for (const name of ['runtime', 'scoped-storage']) {
  test(`manual ${name} resolves one base and executes the complete differential`, () => {
    const workflow = yaml.load(readFileSync(`.github/workflows/shared-terminal-actor-${name}.yml`, 'utf8'));
    assert.equal(workflow.on.workflow_dispatch.inputs.base_ref.required, true);
    const resolve = workflow.jobs['resolve-pr-base'];
    assert.match(resolve.steps[0].with.ref, /inputs\.base_ref/);
    for (const key of ['full-suite-baseline', 'full-suite-candidate']) {
      const job = workflow.jobs[key];
      if (job.if) assert.match(job.if, /workflow_dispatch/);
      assert.ok(job.steps.some(step => /vitest|suite/i.test(step.name || '')));
    }
    const gate = workflow.jobs['differential-regression-gate'];
    assert.match(gate.if, /always\(\)/);
    assert.ok(gate.needs.includes('full-suite-baseline') && gate.needs.includes('full-suite-candidate'));
    if (name === 'scoped-storage') {
      assert.ok(gate.needs.includes('resolve-pr-base'));
      assert.match(gate.env.SHARED_TERMINAL_3_COMPARISON_BASE_SHA, /needs\.resolve-pr-base\.outputs\.sha/);
    }
    assert.ok(gate.steps.some(step => String(step.run).includes('compare-shared-terminal-full-suite.mjs')));
    assert.ok(gate.steps.some(step => String(step.run).includes('compare-focused-target-evidence.mjs')));
  });
}
