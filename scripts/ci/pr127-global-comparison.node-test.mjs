import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_FOCUSED_FAILURES,
  classifyFocusedEvidence,
  compareFullReports,
  deriveSemanticFailureFromLog,
  isOpaqueFailureSignature,
  normalizeErrorSignature,
} from './pr127-global-comparison.mjs';

const report = (message, status = 'failed', { name = '/home/runner/work/Lanzo-POS/pr/src/example.test.jsx', fullName = 'example assertion' } = {}) => ({
  testResults: [{
    name,
    assertionResults: [{ status, fullName, failureMessages: [message] }],
  }],
});
const assertion = report('AssertionError: expected 1 to be 2\n    at C:\\work\\pr\\src\\example.test.jsx:10:3');
const opaque = report('Error: STACK_TRACE_ERROR\n    at task (file:///home/runner/work/Lanzo-POS/pr/node_modules/@vitest/runner/dist/index.js:796:27)');
const evidence = (jsonReport, logText) => Array.from({ length: 10 }, () => ({ report: jsonReport, logText }));

test('detects STACK_TRACE_ERROR JSON as opaque while retaining meaningful JSON errors', () => {
  assert.equal(isOpaqueFailureSignature('Error: STACK_TRACE_ERROR'), true);
  assert.equal(isOpaqueFailureSignature('AssertionError: expected 1 to be 2'), false);
  assert.deepEqual(deriveSemanticFailureFromLog('Test timed out in 15000ms.'), {
    semanticErrorClass: 'Timeout',
    semanticSignature: 'Test timed out in <duration>.',
    semanticSource: 'LOG',
  });
});

test('classifies matching opaque timeout logs as preexisting', () => {
  const comparison = compareFullReports(opaque, { testResults: [] });
  const classified = classifyFocusedEvidence(
    comparison.rawCandidateOnlyFailures,
    evidence(opaque, 'Test timed out in 15000ms.'),
    evidence(opaque, 'Test timed out in 15000ms.'),
  );
  assert.equal(classified.status, 'OK');
  assert.equal(classified.classifications[0].classification, 'PREEXISTING_FLAKY_BASELINE_FAILURE');
  assert.equal(classified.classifications[0].semanticSource, 'LOG');
});

test('does not collapse opaque timeout and assertion evidence', () => {
  const comparison = compareFullReports(opaque, { testResults: [] });
  const classified = classifyFocusedEvidence(
    comparison.rawCandidateOnlyFailures,
    evidence(opaque, 'AssertionError: expected 1 to be 2'),
    evidence(opaque, 'Test timed out in 15000ms.'),
  );
  assert.equal(classified.status, 'OK');
  assert.equal(classified.newFailures.length, 1);
  assert.equal(classified.classifications[0].classification, 'NEW_FAILURE');
});

test('fails closed when opaque JSON and focused logs cannot establish a semantic identity', () => {
  const comparison = compareFullReports(opaque, { testResults: [] });
  const internalLog = 'Error: STACK_TRACE_ERROR\n    at task (file:///node_modules/@vitest/runner/dist/index.js:796:27)';
  const classified = classifyFocusedEvidence(
    comparison.rawCandidateOnlyFailures,
    evidence(opaque, internalLog),
    evidence(opaque, internalLog),
  );
  assert.equal(classified.status, 'FAIL_CLOSED');
  assert.equal(classified.classifications[0].classification, 'SEMANTIC_IDENTITY_UNRESOLVED');
});

test('preserves normal assertion comparison behavior', () => {
  const comparison = compareFullReports(assertion, { testResults: [] });
  const classified = classifyFocusedEvidence(comparison.rawCandidateOnlyFailures, evidence(assertion, ''), evidence(assertion, ''));
  assert.equal(classified.status, 'OK');
  assert.equal(classified.classifications[0].classification, 'PREEXISTING_FLAKY_BASELINE_FAILURE');
});

test('does not collapse meaningful assertion and timeout errors', () => {
  const comparison = compareFullReports(assertion, { testResults: [] });
  const classified = classifyFocusedEvidence(
    comparison.rawCandidateOnlyFailures,
    evidence(report('Test timed out in 15000ms.'), ''),
    evidence(assertion, ''),
  );
  assert.equal(classified.status, 'OK');
  assert.equal(classified.newFailures.length, 1);
});

test('does not collapse ENOENT and assertion errors', () => {
  const comparison = compareFullReports(assertion, report('ENOENT: no such file or directory, open /tmp/file'));
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
  assert.equal(comparison.candidateFailures[0].errorClass, 'AssertionError');
  assert.equal(comparison.baseFailures[0].errorClass, 'ENOENT');
});

test('normalizes volatile Promise.all stack indices without changing failure identity', () => {
  const comparison = compareFullReports(
    report('ENOENT: no such file or directory, open /tmp/file\n    at Promise.all (index 0)'),
    report('ENOENT: no such file or directory, open /tmp/file\n    at Promise.all (index 1)'),
  );
  assert.equal(comparison.rawCandidateOnlyFailures.length, 0);
  assert.equal(comparison.sharedFailures.length, 1);
});

test('preserves genuinely different assertion messages', () => {
  const comparison = compareFullReports(
    report('AssertionError: expected 1 to be 2\n    at Promise.all (index 0)'),
    report('AssertionError: expected 1 to be 3\n    at Promise.all (index 1)'),
  );
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
  assert.equal(comparison.rawCandidateOnlyFailures[0].signature.includes('expected 1 to be 2'), true);
});

test('preserves different test and file identities', () => {
  const fileComparison = compareFullReports(
    report('AssertionError: expected 1 to be 2', 'failed', { name: '/home/runner/work/Lanzo-POS/pr/src/first.test.jsx' }),
    report('AssertionError: expected 1 to be 2', 'failed', { name: '/home/runner/work/Lanzo-POS/main/src/second.test.jsx' }),
  );
  assert.equal(fileComparison.rawCandidateOnlyFailures.length, 1);

  const testComparison = compareFullReports(
    report('AssertionError: expected 1 to be 2', 'failed', { fullName: 'first assertion' }),
    report('AssertionError: expected 1 to be 2', 'failed', { fullName: 'second assertion' }),
  );
  assert.equal(testComparison.rawCandidateOnlyFailures.length, 1);
});

test('preserves existing path and line/column normalization', () => {
  assert.equal(
    normalizeErrorSignature('Error at C:\\work\\pr\\src\\example.test.jsx:10:3'),
    normalizeErrorSignature('Error at /home/runner/work/Lanzo-POS/pr/src/example.test.jsx:42:9'),
  );
  assert.equal(normalizeErrorSignature('Error at helper:10:3'), 'Error at helper:<line>:<column>');
});

test('an empty candidate-only set needs no focused semantic parsing', () => {
  const comparison = compareFullReports({ testResults: [] }, { testResults: [] });
  const classified = classifyFocusedEvidence(comparison.rawCandidateOnlyFailures, [], []);
  assert.equal(classified.status, 'OK');
  assert.equal(classified.newFailures.length, 0);
});

test('fails closed above the focused evidence cap', () => {
  const failures = Array.from({ length: MAX_FOCUSED_FAILURES + 1 }, (_, index) => ({ file: `src/${index}.test.jsx`, testName: 'example', errorClass: 'AssertionError', signature: 'AssertionError: x', jsonErrorClass: 'AssertionError', jsonSignature: 'AssertionError: x', opaqueJson: false }));
  const classified = classifyFocusedEvidence(failures, [], []);
  assert.equal(classified.status, 'FAIL_CLOSED');
});

test('fails closed when focused evidence is incomplete', () => {
  const comparison = compareFullReports(assertion, { testResults: [] });
  const classified = classifyFocusedEvidence(comparison.rawCandidateOnlyFailures, [], []);
  assert.equal(classified.status, 'FAIL_CLOSED');
});
