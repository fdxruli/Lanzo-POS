import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  EVIDENCE_UNREADABLE, TARGET_EXECUTED_FAIL, TARGET_EXECUTED_PASS, TARGET_NOT_EXECUTED,
  classifyFocusedTargetReport, compareFocusedSummaries, readAndClassifyFocusedTarget, summarizeFocusedRuns,
} from './focused-target-evidence.mjs';

const target = { slug: 'example', file: 'src/example.test.jsx', testName: 'requested assertion' };
const report = (status, options = {}) => ({
  testResults: [{
    name: options.file || '/home/runner/work/repo/repo/src/example.test.jsx',
    assertionResults: [{
      title: 'requested assertion', fullName: 'example suite requested assertion', status,
      failureMessages: status === 'failed' ? ['AssertionError: expected 1 to be 2'] : [],
    }],
  }],
});

test('correct file + correct test + pass', () => {
  assert.equal(classifyFocusedTargetReport(report('passed'), target).status, TARGET_EXECUTED_PASS);
});
test('correct file + correct test + failure', () => {
  const result = classifyFocusedTargetReport(report('failed'), target);
  assert.equal(result.status, TARGET_EXECUTED_FAIL);
  assert.equal(result.failures[0].errorClass, 'AssertionError');
});
test('wrong file + test name not found', () => {
  assert.equal(classifyFocusedTargetReport(report('passed', { file: '/repo/src/wrong.test.jsx' }), target).status, TARGET_NOT_EXECUTED);
});
test('only skipped target evidence', () => {
  assert.equal(classifyFocusedTargetReport(report('skipped'), target).status, TARGET_NOT_EXECUTED);
});
test('missing/corrupt JSON', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'focused-target-evidence-'));
  const corrupt = path.join(directory, 'corrupt.json');
  fs.writeFileSync(corrupt, '{');
  assert.equal(readAndClassifyFocusedTarget(path.join(directory, 'missing.json'), target).status, EVIDENCE_UNREADABLE);
  assert.equal(readAndClassifyFocusedTarget(corrupt, target).status, EVIDENCE_UNREADABLE);
  fs.rmSync(directory, { recursive: true });
});

test('opaque JSON uses deterministic log semantics', () => {
  const opaque = report('failed');
  opaque.testResults[0].assertionResults[0].failureMessages = ['Error: STACK_TRACE_ERROR'];
  const result = classifyFocusedTargetReport(opaque, target, 'Test timed out in 15000ms.');
  assert.deepEqual(result.failures[0], {
    errorClass: 'Timeout', signature: 'Test timed out in <duration>.', semanticResolved: true, semanticSource: 'LOG',
  });
});
test('50/50 comparison accepts equivalent executed evidence', () => {
  const runs = Array.from({ length: 50 }, (_, index) => ({ slug: target.slug, repetition: index + 1, status: TARGET_EXECUTED_PASS, failures: [] }));
  const summary = summarizeFocusedRuns([target], runs, 50, 4);
  assert.equal(compareFocusedSummaries(summary, summary).candidateOnlySemanticRegressionCount, 0);
});

test('comparison fails closed on a not-executed run', () => {
  const runs = Array.from({ length: 50 }, (_, index) => ({ slug: target.slug, repetition: index + 1, status: index ? TARGET_EXECUTED_PASS : TARGET_NOT_EXECUTED, failures: [] }));
  const summary = summarizeFocusedRuns([target], runs, 50, 4);
  assert.throws(() => compareFocusedSummaries(summary, summary), /FOCUSED_TARGET_NOT_EXECUTED/);
});
test('comparison detects a materially higher candidate failure frequency', () => {
  const makeRuns = (failureCount) => Array.from({ length: 50 }, (_, index) => ({
    slug: target.slug,
    repetition: index + 1,
    status: index < failureCount ? TARGET_EXECUTED_FAIL : TARGET_EXECUTED_PASS,
    failures: index < failureCount ? [{ errorClass: 'Timeout', signature: 'Test timed out in <duration>.', semanticResolved: true, semanticSource: 'JSON' }] : [],
  }));
  const base = summarizeFocusedRuns([target], makeRuns(1), 50, 4);
  const candidate = summarizeFocusedRuns([target], makeRuns(10), 50, 4);
  const comparison = compareFocusedSummaries(base, candidate);
  assert.equal(comparison.candidateOnlySemanticRegressionCount, 0);
  assert.equal(comparison.candidateFailureRateRegressionCount, 1);
});
test('comparison fails closed when opaque failure semantics remain unresolved', () => {
  const opaque = report('failed');
  opaque.testResults[0].assertionResults[0].failureMessages = ['Error: STACK_TRACE_ERROR'];
  const classified = classifyFocusedTargetReport(opaque, target, 'JSON report written to /tmp/result.json');
  assert.equal(classified.failures[0].semanticResolved, false);
  const runs = Array.from({ length: 50 }, (_, index) => ({
    slug: target.slug, repetition: index + 1,
    ...(index ? { status: TARGET_EXECUTED_PASS, failures: [] } : classified),
  }));
  const summary = summarizeFocusedRuns([target], runs, 50, 4);
  assert.throws(() => compareFocusedSummaries(summary, summary), /SEMANTIC_IDENTITY_UNRESOLVED/);
});
