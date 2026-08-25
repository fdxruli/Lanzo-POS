import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_FOCUSED_FAILURES, classifyFocusedEvidence, compareFullReports } from './pr127-global-comparison.mjs';

const report = (message, status = 'failed') => ({ testResults: [{ name: '/home/runner/work/Lanzo-POS/pr/src/example.test.jsx', assertionResults: [{ status, fullName: 'example assertion', failureMessages: [message] }] }] });
const assertion = report('AssertionError: expected 1 to be 2\n    at C:\\work\\pr\\src\\example.test.jsx:10:3');

test('matches the same assertion error on both sides', () => {
  const comparison = compareFullReports(assertion, report('AssertionError: expected 1 to be 2\n    at /home/runner/work/Lanzo-POS/main/src/example.test.jsx:11:4'));
  assert.equal(comparison.sharedFailures.length, 1);
  assert.equal(comparison.rawCandidateOnlyFailures.length, 0);
});

test('does not collapse timeout and assertion errors', () => {
  const comparison = compareFullReports(assertion, report('Test timed out in 15000ms.'));
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
  const classified = classifyFocusedEvidence(comparison.rawCandidateOnlyFailures, [report('Test timed out in 15000ms.')], [assertion]);
  assert.equal(classified.newFailures.length, 1);
});

test('classifies a candidate-only assertion with equivalent focused base evidence as preexisting', () => {
  const comparison = compareFullReports(assertion, { testResults: [] });
  const classified = classifyFocusedEvidence(comparison.rawCandidateOnlyFailures, [assertion], [assertion]);
  assert.equal(classified.classifications[0].classification, 'PREEXISTING_FLAKY_BASELINE_FAILURE');
});

test('does not collapse ENOENT and assertion errors', () => {
  const comparison = compareFullReports(assertion, report('ENOENT: no such file or directory, open /tmp/file'));
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
});

test('an empty candidate-only set needs no focused evidence', () => {
  const comparison = compareFullReports({ testResults: [] }, { testResults: [] });
  assert.equal(comparison.rawCandidateOnlyFailures.length, 0);
});

test('fails closed above the focused evidence cap', () => {
  const failures = Array.from({ length: MAX_FOCUSED_FAILURES + 1 }, (_, index) => ({ file: `src/${index}.test.jsx`, testName: 'example', errorClass: 'AssertionError', signature: 'AssertionError: x' }));
  const classified = classifyFocusedEvidence(failures, [], []);
  assert.equal(classified.status, 'FAIL_CLOSED');
});

test('fails closed when focused evidence is incomplete', () => {
  const comparison = compareFullReports(assertion, { testResults: [] });
  const classified = classifyFocusedEvidence(comparison.rawCandidateOnlyFailures, [], []);
  assert.equal(classified.status, 'FAIL_CLOSED');
});
