import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_FOCUSED_FAILURES,
  classifyFocusedEvidence,
  compareFullReports,
  deriveSemanticFailureFromLog,
  errorClass,
  isOpaqueFailureSignature,
  normalizeErrorSignature,
  normalizeFailures,
} from './pr127-global-comparison.mjs';

const DEFAULT_FILE = '/home/runner/work/Lanzo-POS/Lanzo-POS/pr/src/example.test.jsx';
const DEFAULT_TEST = 'example assertion';

function report(message, status = 'failed', options = {}) {
  const ancestorTitles = options.ancestorTitles || ['example suite'];
  const fullName = options.fullName || [...ancestorTitles, options.title || DEFAULT_TEST].join(' ');
  const assertion = {
    status,
    title: options.title || DEFAULT_TEST,
    fullName,
    ancestorTitles,
    failureMessages: status === 'failed' ? [message] : [],
  };
  const result = {
    name: options.name || DEFAULT_FILE,
    status: status === 'failed' ? 'failed' : 'passed',
    assertionResults: [assertion],
  };
  return summaryReport([result], status === 'failed' ? 1 : 0, status === 'passed' ? 1 : 0, 0, 1);
}

function summaryReport(testResults, failed, passed, pending, total) {
  return {
    testResults,
    numFailedTests: failed,
    numPassedTests: passed,
    numPendingTests: pending,
    numTotalTests: total,
  };
}

function emptyReport() {
  return summaryReport([], 0, 0, 0, 0);
}

function fileFailure(message, name = DEFAULT_FILE) {
  return summaryReport([{
    name,
    status: 'failed',
    assertionResults: [],
    message,
  }], 0, 0, 0, 0);
}

function duplicateReport(messages) {
  const ancestorTitles = ['example suite'];
  const assertions = messages.map((message) => ({
    status: 'failed',
    title: DEFAULT_TEST,
    fullName: [...ancestorTitles, DEFAULT_TEST].join(' '),
    ancestorTitles,
    failureMessages: [message],
  }));
  return summaryReport([{
    name: DEFAULT_FILE,
    status: 'failed',
    assertionResults: assertions,
  }], assertions.length, 0, 0, assertions.length);
}

function focusedEvidence(statuses, message = 'TypeError: boom', logText = '') {
  return statuses.map((status) => ({
    report: report(status === 'failed' ? message : '', status),
    logText,
    exitCode: status === 'failed' ? '1' : '0',
  }));
}

test('uses a stable test target when Vitest changes only internal stack frames', () => {
  const base = report('TypeError: boom\n    at runWithSuite (node_modules/@vitest/runner/dist/index.js:10:2)');
  const candidate = report('TypeError: boom\n    at startTests (node_modules/@vitest/runner/dist/chunk-artifact.js:20:3)');
  const comparison = compareFullReports(candidate, base);

  assert.equal(comparison.candidateOnlyTargets.length, 0);
  assert.equal(comparison.focusTargets.length, 0);
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
  assert.equal(comparison.diagnosticComparisons[0].classification, 'STACK_ONLY_CHANGE');
  assert.match(comparison.diagnosticComparisons[0].candidateFailure.originalStack, /chunk-artifact\.js/);
  assert.match(comparison.diagnosticComparisons[0].baseFailure.originalStack, /index\.js/);
});

test('retains a changed error class and queues its target for focused evidence', () => {
  const comparison = compareFullReports(
    report('ReferenceError: boom'),
    report('TypeError: boom'),
  );

  assert.equal(comparison.candidateOnlyTargets.length, 0);
  assert.equal(comparison.focusTargets.length, 1);
  assert.equal(comparison.diagnosticComparisons[0].classification, 'SEMANTIC_DIAGNOSTIC_CHANGE');
  assert.equal(comparison.diagnosticComparisons[0].baseFailure.runnerErrorClass, 'TypeError');
  assert.equal(comparison.diagnosticComparisons[0].candidateFailure.runnerErrorClass, 'ReferenceError');
});

test('keeps file and full test names in the stable failure identity', () => {
  const candidateFile = report('TypeError: boom', 'failed', { name: '/home/runner/work/Lanzo-POS/Lanzo-POS/pr/src/candidate.test.jsx' });
  const baseFile = report('TypeError: boom', 'failed', { name: '/home/runner/work/Lanzo-POS/Lanzo-POS/main/src/base.test.jsx' });
  assert.equal(compareFullReports(candidateFile, baseFile).candidateOnlyTargets.length, 1);

  const candidateTest = report('TypeError: boom', 'failed', { fullName: 'example suite candidate test' });
  const baseTest = report('TypeError: boom', 'failed', { fullName: 'example suite base test' });
  assert.equal(compareFullReports(candidateTest, baseTest).candidateOnlyTargets.length, 1);
});

test('does not equate an ENOENT diagnostic with an assertion failure', () => {
  const comparison = compareFullReports(
    report('AssertionError: expected the route'),
    report('Error: ENOENT: no such file or directory'),
  );

  assert.equal(comparison.diagnosticComparisons[0].classification, 'SEMANTIC_DIAGNOSTIC_CHANGE');
  assert.equal(comparison.diagnosticComparisons[0].baseFailure.errorClass, 'ENOENT');
  assert.equal(comparison.diagnosticComparisons[0].candidateFailure.errorClass, 'AssertionError');
});

test('does not treat a genuine assertion message change as stack noise', () => {
  const comparison = compareFullReports(
    report('AssertionError: expected 1 to be 3'),
    report('AssertionError: expected 1 to be 2'),
  );

  assert.equal(comparison.diagnosticComparisons[0].classification, 'SEMANTIC_DIAGNOSTIC_CHANGE');
  assert.equal(comparison.focusTargets.length, 1);
  assert.match(comparison.diagnosticComparisons[0].candidateFailure.originalMessage, /expected 1 to be 3/);
});

test('recognizes a narrowly evidenced Vitest matcher wrapper change without dropping either class', () => {
  const base = report(
    'AssertionError: expected value to match object\n    at _Assertion.<anonymous> (file:///node_modules/@vitest/expect/dist/index.js:10:2)',
  );
  const candidate = report(
    'Error: expected value to match object\n    at _Assertion.__VITEST_REJECTS__ (file:///node_modules/@vitest/expect/dist/index.js:20:3)',
  );
  const comparison = compareFullReports(candidate, base);
  const diagnostic = comparison.diagnosticComparisons[0];

  assert.equal(diagnostic.classification, 'VITEST_EXPECTATION_WRAPPER_CHANGE');
  assert.equal(diagnostic.baseFailure.runnerErrorClass, 'AssertionError');
  assert.equal(diagnostic.candidateFailure.runnerErrorClass, 'Error');
  assert.match(diagnostic.baseFailure.originalMessage, /^AssertionError:/);
  assert.match(diagnostic.candidateFailure.originalMessage, /^Error:/);
  assert.equal(comparison.focusTargets.length, 0);
});

test('recognizes only matching Vite SSR wrapper and binding changes from the generated import marker', () => {
  const base = fileFailure(
    '(0 , __vite_ssr_import_1__.createThing) is not a function\n    at run (node_modules/@vitest/runner/dist/index.js:10:2)',
  );
  const candidate = fileFailure(
    'createThing is not a function\n    at run (node_modules/@vitest/runner/dist/chunk-artifact.js:20:3)',
  );
  const comparison = compareFullReports(candidate, base);

  assert.equal(comparison.diagnosticComparisons[0].classification, 'VITE_SSR_IMPORT_WRAPPER_CHANGE');
  assert.equal(comparison.diagnosticComparisons[0].baseFailure.originalMessage.startsWith('(0 , __vite_ssr_import_1__.'), true);
  assert.equal(comparison.diagnosticComparisons[0].candidateFailure.originalMessage.startsWith('createThing'), true);
  assert.match(comparison.diagnosticComparisons[0].runnerEvidence.join(' '), /generated __vite_ssr_import/);
});

test('identifies a new failed target separately from diagnostics on common targets', () => {
  const comparison = compareFullReports(report('AssertionError: expected result'), emptyReport());

  assert.equal(comparison.candidateOnlyTargets.length, 1);
  assert.equal(comparison.candidateOnlyTargets[0].reason, 'CANDIDATE_ONLY_TARGET');
  assert.equal(comparison.diagnosticComparisons[0].classification, 'CANDIDATE_ONLY_TARGET');
  assert.equal(comparison.focusTargets.length, 1);
  assert.equal(comparison.focusTargets[0].file, 'src/example.test.jsx');
});

test('preserves duplicate failure multiplicity and focuses an additional occurrence', () => {
  const base = duplicateReport(['TypeError: boom']);
  const candidate = duplicateReport(['TypeError: boom', 'TypeError: boom']);
  const comparison = compareFullReports(candidate, base);

  assert.equal(comparison.candidateFailures.length, 2);
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
  assert.equal(comparison.candidateOnlyTargets.length, 0);
  assert.equal(comparison.diagnosticComparisons.filter((item) => item.classification === 'ADDITIONAL_FAILURE_OCCURRENCE').length, 1);
  assert.equal(comparison.focusTargets.length, 1);
});

test('uses a stable file-level target when collection or hooks fail before assertions run', () => {
  const base = fileFailure('Error: collection failed\n    at runWithSuite (node_modules/@vitest/runner/dist/index.js:1:2)');
  const candidate = fileFailure('Error: collection failed\n    at startTests (node_modules/@vitest/runner/dist/chunk-artifact.js:3:4)');
  const comparison = compareFullReports(candidate, base);

  assert.equal(comparison.candidateFailures[0].testName, '__FILE_FAILURE__');
  assert.equal(comparison.candidateOnlyTargets.length, 0);
  assert.equal(comparison.diagnosticComparisons[0].classification, 'STACK_ONLY_CHANGE');
});

test('preserves a failed file result even when its assertions are only skipped', () => {
  const reportWithSkippedAssertions = (message) => summaryReport([{
    name: DEFAULT_FILE,
    status: 'failed',
    message,
    assertionResults: [{
      status: 'skipped',
      title: DEFAULT_TEST,
      fullName: 'example suite ' + DEFAULT_TEST,
      ancestorTitles: ['example suite'],
      failureMessages: [],
    }],
  }], 0, 0, 1, 1);
  const comparison = compareFullReports(
    reportWithSkippedAssertions('{"status":"failed","error":"dist does not exist"}'),
    emptyReport(),
  );

  assert.equal(comparison.candidateFailures[0].testName, '__FILE_FAILURE__');
  assert.equal(comparison.candidateOnlyTargets.length, 1);
});

test('detects opaque JSON errors and resolves their semantic log evidence', () => {
  const opaque = report('Error: STACK_TRACE_ERROR\n    at task (file:///node_modules/@vitest/runner/dist/index.js:1:2)');
  const comparison = compareFullReports(opaque, emptyReport());
  const target = comparison.focusTargets;
  const classified = classifyFocusedEvidence(
    target,
    focusedEvidence(Array(10).fill('passed')),
    focusedEvidence(Array(10).fill('failed'), 'Error: STACK_TRACE_ERROR', 'Test timed out in 15000ms.'),
  );

  assert.equal(isOpaqueFailureSignature('Error: STACK_TRACE_ERROR'), true);
  assert.equal(errorClass('AssertionError: expected 1 to be 2'), 'AssertionError');
  assert.equal(deriveSemanticFailureFromLog('Test timed out in 15000ms.').semanticSignature, 'Test timed out in <duration>.');
  assert.equal(classified.status, 'OK');
  assert.equal(classified.classifications[0].classification, 'NEW_FAILURE');
  assert.equal(classified.classifications[0].semanticErrorClass, 'Timeout');
});

test('classifies matching opaque timeout evidence as a preexisting intermittent failure', () => {
  const opaque = report('Error: STACK_TRACE_ERROR');
  const target = compareFullReports(opaque, emptyReport()).focusTargets;
  const repetitions = Array(10).fill('failed');
  const classified = classifyFocusedEvidence(
    target,
    focusedEvidence(repetitions, 'Error: STACK_TRACE_ERROR', 'Test timed out in 15000ms.'),
    focusedEvidence(repetitions, 'Error: STACK_TRACE_ERROR', 'Test timed out in 15000ms.'),
  );

  assert.equal(classified.status, 'OK');
  assert.equal(classified.classifications[0].classification, 'PREEXISTING_FLAKY_BASELINE_FAILURE');
  assert.equal(classified.classifications[0].semanticSource, 'LOG');
});

test('does not collapse an opaque timeout into a different assertion log', () => {
  const opaque = report('Error: STACK_TRACE_ERROR');
  const target = compareFullReports(opaque, emptyReport()).focusTargets;
  const repetitions = Array(10).fill('failed');
  const classified = classifyFocusedEvidence(
    target,
    focusedEvidence(repetitions, 'Error: STACK_TRACE_ERROR', 'AssertionError: expected 1 to be 2'),
    focusedEvidence(repetitions, 'Error: STACK_TRACE_ERROR', 'Test timed out in 15000ms.'),
  );

  assert.equal(classified.classifications[0].classification, 'NEW_FAILURE');
  assert.equal(classified.newFailures.length, 1);
});

test('fails closed for incomplete JSON reports rather than treating missing results as a pass', () => {
  const comparison = compareFullReports({ testResults: [] }, emptyReport());

  assert.equal(comparison.reportValidationErrors.length, 1);
  assert.equal(comparison.reportValidationErrors[0].source, 'CANDIDATE');
  assert.equal(comparison.candidateFailures[0].runnerErrorClass, 'RunnerError');
  assert.match(comparison.reportValidationErrors[0].message, /summary field/);
});

test('represents missing runner output as a runner failure', () => {
  const failures = normalizeFailures(null, 'CANDIDATE');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].runnerErrorClass, 'RunnerError');
  assert.equal(failures[0].testName, 'invalid or incomplete JSON report');
});

test('classifies matching intermittent failures as preexisting only when rates do not increase', () => {
  const failedOnce = ['failed', ...Array(9).fill('passed')];
  const target = compareFullReports(report('TimeoutError: timed out in 15000ms'), emptyReport()).focusTargets;
  const classified = classifyFocusedEvidence(
    target,
    focusedEvidence(failedOnce, 'TimeoutError: timed out in 15000ms.'),
    focusedEvidence(failedOnce, 'TimeoutError: timed out in 15000ms.'),
  );

  assert.equal(classified.status, 'OK');
  assert.equal(classified.classifications[0].baseFailureCount, 1);
  assert.equal(classified.classifications[0].candidateFailureCount, 1);
  assert.equal(classified.classifications[0].classification, 'PREEXISTING_FLAKY_BASELINE_FAILURE');
});

test('fails when a matching failure becomes more frequent on the candidate', () => {
  const baseStatuses = ['failed', ...Array(9).fill('passed')];
  const candidateStatuses = ['failed', 'failed', ...Array(8).fill('passed')];
  const target = compareFullReports(report('TimeoutError: timed out in 15000ms'), emptyReport()).focusTargets;
  const classified = classifyFocusedEvidence(
    target,
    focusedEvidence(baseStatuses, 'TimeoutError: timed out in 15000ms.'),
    focusedEvidence(candidateStatuses, 'TimeoutError: timed out in 15000ms.'),
  );

  assert.equal(classified.classifications[0].classification, 'CANDIDATE_FAILURE_RATE_INCREASE');
  assert.equal(classified.newFailures.length, 1);
});

test('does not apply the focused target cap to raw stack-signature differences', () => {
  const baseAssertions = Array.from({ length: MAX_FOCUSED_FAILURES + 1 }, (_, index) => ({
    status: 'failed',
    title: 'case ' + index,
    fullName: 'suite case ' + index,
    ancestorTitles: ['suite'],
    failureMessages: ['TypeError: boom\n at baseFrame' + index + ' (node_modules/@vitest/runner/dist/index.js:1:2)'],
  }));
  const candidateAssertions = baseAssertions.map((assertion, index) => ({
    ...assertion,
    failureMessages: ['TypeError: boom\n at candidateFrame' + index + ' (node_modules/@vitest/runner/dist/chunk-artifact.js:2:3)'],
  }));
  const base = summaryReport([{ name: DEFAULT_FILE, status: 'failed', assertionResults: baseAssertions }], baseAssertions.length, 0, 0, baseAssertions.length);
  const candidate = summaryReport([{ name: DEFAULT_FILE, status: 'failed', assertionResults: candidateAssertions }], candidateAssertions.length, 0, 0, candidateAssertions.length);
  const comparison = compareFullReports(candidate, base);
  const classified = classifyFocusedEvidence(comparison.focusTargets, [], []);

  assert.equal(comparison.rawCandidateOnlyFailures.length, MAX_FOCUSED_FAILURES + 1);
  assert.equal(comparison.candidateOnlyTargets.length, 0);
  assert.equal(comparison.focusTargets.length, 0);
  assert.equal(classified.status, 'OK');
});

test('fails closed when genuine candidate-only focused targets exceed the safe limit', () => {
  const assertions = Array.from({ length: MAX_FOCUSED_FAILURES + 1 }, (_, index) => ({
    status: 'failed',
    title: 'case ' + index,
    fullName: 'suite case ' + index,
    ancestorTitles: ['suite'],
    failureMessages: ['TypeError: failure ' + index],
  }));
  const candidate = summaryReport([{ name: DEFAULT_FILE, status: 'failed', assertionResults: assertions }], assertions.length, 0, 0, assertions.length);
  const comparison = compareFullReports(candidate, emptyReport());
  const classified = classifyFocusedEvidence(comparison.focusTargets, [], []);

  assert.equal(comparison.focusTargets.length, MAX_FOCUSED_FAILURES + 1);
  assert.equal(classified.status, 'FAIL_CLOSED');
  assert.match(classified.diagnostic, /focused target count/);
});

test('fails closed when focused reports do not execute the target', () => {
  const target = compareFullReports(report('TypeError: boom'), emptyReport()).focusTargets;
  const classified = classifyFocusedEvidence(
    target,
    focusedEvidence(Array(10).fill('passed')),
    Array.from({ length: 10 }, () => ({ report: emptyReport(), logText: '', exitCode: '0' })),
  );

  assert.equal(classified.status, 'FAIL_CLOSED');
  assert.equal(classified.classifications[0].classification, 'SEMANTIC_IDENTITY_UNRESOLVED');
});

test('preserves the comparison result fields used by the existing PR #127 workflow', () => {
  const comparison = compareFullReports(report('TypeError: boom'), emptyReport());

  for (const key of ['candidateFailures', 'baseFailures', 'sharedFailures', 'rawCandidateOnlyFailures', 'resolvedFailures']) {
    assert.ok(Array.isArray(comparison[key]), 'missing legacy result field ' + key);
  }
  assert.equal(comparison.rawCandidateOnlyFailures.length, 1);
  assert.equal(comparison.candidateOnlyTargets.length, 1);
});

test('preserves existing path and line/column normalization', () => {
  assert.equal(
    normalizeErrorSignature('Error at C:\\work\\pr\\src\\example.test.jsx:10:3'),
    normalizeErrorSignature('Error at /home/runner/work/Lanzo-POS/Lanzo-POS/pr/src/example.test.jsx:42:9'),
  );
  assert.equal(normalizeErrorSignature('Error at helper:10:3'), 'Error at helper:<line>:<column>');
});

test('normalizes volatile Promise.all stack indexes without changing test identity', () => {
  const comparison = compareFullReports(
    report('ENOENT: file missing\n    at Promise.all (index 0)'),
    report('ENOENT: file missing\n    at Promise.all (index 1)'),
  );
  assert.equal(comparison.rawCandidateOnlyFailures.length, 0);
  assert.equal(comparison.sharedFailures.length, 1);
  assert.equal(comparison.candidateOnlyTargets.length, 0);
});

test('an empty differential requires no focused reruns', () => {
  const comparison = compareFullReports(emptyReport(), emptyReport());
  const classified = classifyFocusedEvidence(comparison.focusTargets, [], []);
  assert.equal(classified.status, 'OK');
  assert.equal(comparison.focusTargets.length, 0);
});
