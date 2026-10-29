import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';

const workflowTriggers = workflow => workflow.on ?? workflow[true];

for (const name of ['runtime', 'scoped-storage']) {
  test(`manual ${name} resolves one base and executes the complete differential`, () => {
    const workflow = yaml.load(readFileSync(`.github/workflows/shared-terminal-actor-${name}.yml`, 'utf8'));
    const triggers = workflowTriggers(workflow);
    assert.equal(triggers.workflow_dispatch.inputs.base_ref.required, true);
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

test('manual PR127 accepts an immutable BASE instead of assuming main', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/pr127-global-comparison.yml', 'utf8'));
  const triggers = workflowTriggers(workflow);
  assert.equal(triggers.workflow_dispatch.inputs.base_ref.required, true);
  const job = workflow.jobs['compare-global-suite'];
  assert.match(job.steps[1].with.ref, /PR127_BASE_REF/);
  assert.equal(job.steps[1].with.path, 'base');
  assert.ok(job.steps.some(step => /Validate immutable comparison refs/.test(step.name || '')));
  assert.match(job.steps.find(step => /Extract error-aware/.test(step.name || '')).run, /global-base\.json/);
  assert.match(job.steps.find(step => /Normalize and compare/.test(step.name || '')).run, /focused\/base/);
});

test('PR352 SQL workflow parses as an isolated, read-only PostgreSQL 17 check', () => {
  const workflow = yaml.load(readFileSync('.github/workflows/pr352-financial-postgres.yml', 'utf8'));
  const pullRequest = workflowTriggers(workflow).pull_request;
  assert.ok(pullRequest.types.includes('edited'));
  assert.deepEqual(pullRequest.branches, ['main']);
  assert.ok(pullRequest.paths.includes('.github/workflows/pr352-financial-postgres.yml'));
  assert.ok(pullRequest.paths.includes('scripts/ci/restaurant-transition-workflows.node-test.mjs'));
  const job = workflow.jobs['isolated-postgres-17'];
  assert.equal(job.permissions.contents, 'read');
  assert.equal(job.services.postgres.image, 'postgres:17.11-bookworm');
  assert.equal(job.env.PR352_EXPECTED_SERVER_VERSION_NUM, '170011');
  assert.match(job.if, /pull_request\.number\s*==\s*352/);
  const verifyServiceStep = job.steps.find(step => /Verify and mark/.test(step.name || ''));
  assert.match(verifyServiceStep.run, /PR352_EXPECTED_SERVER_VERSION_NUM/);
  assert.match(verifyServiceStep.run, /actual=%s expected=%s/);

  for (const path of [
    'scripts/supabase/restaurant-admin-supervision-test.mjs',
    'scripts/supabase/restaurant-transition-test.mjs'
  ]) {
    const harness = readFileSync(path, 'utf8');
    assert.match(harness, /process\.env\.PR352_EXPECTED_SERVER_VERSION_NUM/);
    assert.doesNotMatch(harness, /171100/u);
  }
});
