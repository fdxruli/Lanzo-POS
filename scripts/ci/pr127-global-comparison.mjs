import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FOCUSED_FAILURES = 10;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const SUMMARY_FIELDS = ['numFailedTests', 'numPassedTests', 'numPendingTests', 'numTotalTests'];

export function normalizeFileName(fileName) {
  const normalized = String(fileName || 'unknown file').replaceAll('\\', '/');
  const checkoutMarkers = ['/pr/', '/main/'];
  for (const marker of checkoutMarkers) {
    const checkoutIndex = normalized.lastIndexOf(marker);
    if (checkoutIndex >= 0) return normalized.slice(checkoutIndex + marker.length);
  }
  const sourceIndex = normalized.lastIndexOf('/src/');
  if (sourceIndex >= 0) return normalized.slice(sourceIndex + 1);
  return normalized.replace(/^\.\//, '');
}

export function normalizeTestName(name) {
  return String(name || 'unknown test')
    .replace(/\b\d+(?:\.\d+)?%/g, '<percentage>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSuiteIdentity(suite) {
  return Array.isArray(suite) ? suite.map((part) => normalizeTestName(part)) : [];
}

export function errorClass(message) {
  const value = String(message || '');
  if (/\bRunnerError\b/.test(value)) return 'RunnerError';
  if (/\b(?:Test )?timed out\b|\bTimeout(?:Error)?\b/i.test(value)) return 'Timeout';
  if (/\bENOENT\b/i.test(value)) return 'ENOENT';
  if (/\b(?:ERR_MODULE_NOT_FOUND|Cannot find module|Failed to load (?:url|module)|import .* failed)\b/i.test(value)) return 'ModuleImportError';
  if (/\bUnhandled(?: Promise)? Rejection\b|\bunhandledRejection\b/i.test(value)) return 'UnhandledRejection';
  if (/\b(?:beforeAll|afterAll|beforeEach|afterEach)\b.*\b(?:failed|error)|\bhook\b.*\b(?:failed|error)/i.test(value)) return 'HookFailure';
  if (/\bAssertionError\b|\bexpect\(.+\)\.(?:to|not)\b|\bexpected\b.+\b(?:to be|to equal|to match)\b/i.test(value)) return 'AssertionError';
  for (const name of ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'Error']) {
    if (new RegExp('\\b' + name + '\\b').test(value)) return name;
  }
  return 'OtherError';
}

export function runnerErrorClass(message, explicitName = null) {
  if (typeof explicitName === 'string' && explicitName.trim()) return explicitName.trim();
  const firstLine = String(message || '').replace(/\u001b\[[0-9;]*m/g, '').split(/\r?\n/).find((line) => line.trim()) || '';
  const match = firstLine.match(/^\s*([A-Za-z_$][\w.$]*):\s*/);
  return match ? match[1] : 'OtherError';
}

export function isOpaqueFailureSignature(message, detectedClass = errorClass(message)) {
  const value = String(message || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  if (!value || value === 'missing failure message') return true;
  if (/\bSTACK_TRACE_ERROR\b/i.test(value)) return true;
  if (detectedClass === 'RunnerError') return true;
  const withoutInternalFrames = value
    .replace(/^Error:\s*$/gim, '')
    .replace(/^\s*at .*?(?:node_modules\/@vitest|vitest\/dist|@vitest\/runner).*$/gim, '')
    .replace(/^\s*at (?:task|chain|runWithSuite|collectTests|startTests|run)\b.*$/gim, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (detectedClass === 'Error' || detectedClass === 'OtherError')
    && (!withoutInternalFrames || /^(?:Error:?)$/i.test(withoutInternalFrames));
}

export function normalizeErrorSignature(message) {
  return String(message || 'missing failure message')
    .replaceAll('\\', '/')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/[A-Za-z]:\/[^\s)]+/g, '<workspace-path>')
    .replace(/\/(?:home|tmp|runner|github|__w)\/[^\s)]+/g, '<workspace-path>')
    .replace(/:(\d+):(\d+)\b/g, ':<line>:<column>')
    .replace(/\b\d+(?:\.\d+)?(?:ms|s)\b/gi, '<duration>')
    .replace(/\b(?:20\d{2}-\d{2}-\d{2}[T ][^\s]+|\d{2}:\d{2}:\d{2}\.\d{3})\b/g, '<timestamp>')
    .replace(/\b(?:tmp|vitest)-[A-Za-z0-9_-]+\b/g, '<temp>')
    .replace(/Promise\.all \(index \d+\)/g, 'Promise.all (index <index>)')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractPrimaryMessage(message) {
  return String(message || '')
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*at\s/.test(line))
    .join('\n')
    .trim();
}

function normalizeCheckoutPaths(message) {
  return String(message || '')
    .replace(/\/home\/runner\/work\/[^/\s)]+\/[^/\s)]+\/(?:main|pr)\//g, '<checkout>/')
    .replace(/(['"])<checkout>\/([^'"]+)\1/g, '<checkout>/$2');
}

function normalizePrimaryMessage(message) {
  return normalizeCheckoutPaths(extractPrimaryMessage(message))
    .replace(/\s+/g, ' ')
    .trim();
}

function removeLeadingErrorClass(message) {
  return String(message || '').replace(/^\s*[A-Za-z_$][\w.$]*:\s*/, '');
}

const signatureLinePatterns = {
  Timeout: /.*(?:Test timed out|timed out in).*/i,
  AssertionError: /.*(?:AssertionError|expect\(|expected\b).*/i,
  TypeError: /.*TypeError.*/i,
  ReferenceError: /.*ReferenceError.*/i,
  SyntaxError: /.*SyntaxError.*/i,
  RangeError: /.*RangeError.*/i,
  ENOENT: /.*ENOENT.*/i,
  ModuleImportError: /.*(?:ERR_MODULE_NOT_FOUND|Cannot find module|Failed to load (?:url|module)|import .* failed).*/i,
  UnhandledRejection: /.*(?:Unhandled(?: Promise)? Rejection|unhandledRejection).*/i,
  HookFailure: /.*(?:beforeAll|afterAll|beforeEach|afterEach|hook).*?(?:failed|error).*/i,
};

export function deriveSemanticFailureFromLog(logText) {
  const value = String(logText || '');
  const detectedClass = errorClass(value);
  if (isOpaqueFailureSignature(value, detectedClass)) {
    return { semanticErrorClass: null, semanticRunnerErrorClass: null, semanticSignature: null, semanticSource: 'UNRESOLVED' };
  }
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pattern = signatureLinePatterns[detectedClass];
  const meaningfulLine = pattern
    ? lines.find((line) => pattern.test(line))
    : lines.find((line) => !/\b(?:@vitest|vitest\/dist|node_modules)\b/i.test(line));
  if (!meaningfulLine || isOpaqueFailureSignature(meaningfulLine, detectedClass)) {
    return { semanticErrorClass: null, semanticRunnerErrorClass: null, semanticSignature: null, semanticSource: 'UNRESOLVED' };
  }
  return {
    semanticErrorClass: detectedClass,
    semanticRunnerErrorClass: runnerErrorClass(meaningfulLine),
    semanticSignature: normalizeErrorSignature(normalizePrimaryMessage(meaningfulLine)),
    semanticSource: 'LOG',
  };
}

function validateVitestReport(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.testResults)) {
    return 'missing or invalid testResults array';
  }
  for (const field of SUMMARY_FIELDS) {
    if (!Number.isInteger(report[field]) || report[field] < 0) return 'missing or invalid summary field ' + field;
  }
  const total = report.numFailedTests + report.numPassedTests + report.numPendingTests;
  if (total !== report.numTotalTests) {
    return 'inconsistent Vitest test totals: failed + passed + pending does not equal total';
  }
  if (report.testResults.some((file) => !file || typeof file !== 'object' || typeof file.name !== 'string')) {
    return 'invalid test result entry';
  }
  return null;
}

const failureMessage = (assertion) => [
  ...(Array.isArray(assertion.failureMessages) ? assertion.failureMessages : []),
  assertion.failureMessage,
  assertion.error?.message,
].filter(Boolean).join('\n');

function targetRecord(file, testName, suiteIdentity = []) {
  return { file, testName, suiteIdentity: normalizeSuiteIdentity(suiteIdentity) };
}

function makeFailure({ file, testName, suiteIdentity, message, explicitErrorClass, source, occurrence }) {
  const runnerClass = runnerErrorClass(message, explicitErrorClass);
  const semanticClass = errorClass(message);
  const originalStack = String(message || '').split(/\r?\n/).filter((line) => /^\s*at\s/.test(line)).join('\n');
  const normalizedSignature = normalizeErrorSignature(message);
  return {
    ...targetRecord(file, testName, suiteIdentity),
    errorClass: semanticClass,
    runnerErrorClass: runnerClass,
    signature: normalizedSignature,
    normalizedSignature,
    originalMessage: String(message || ''),
    primaryMessage: extractPrimaryMessage(message),
    normalizedMessage: normalizePrimaryMessage(message),
    messageWithoutClass: removeLeadingErrorClass(normalizePrimaryMessage(message)),
    originalStack,
    opaqueJson: isOpaqueFailureSignature(message, semanticClass),
    source,
    occurrence,
  };
}

function runnerFailure(source, message) {
  return [makeFailure({
    file: '__' + source + '_RUNNER__',
    testName: 'invalid or incomplete JSON report',
    suiteIdentity: [],
    message: 'RunnerError: ' + message,
    explicitErrorClass: 'RunnerError',
    source,
    occurrence: 0,
  })];
}

export function normalizeFailures(report, source = 'RUNNER') {
  const validationError = validateVitestReport(report);
  if (validationError) return runnerFailure(source, validationError);

  const failures = [];
  for (let fileIndex = 0; fileIndex < report.testResults.length; fileIndex += 1) {
    const file = report.testResults[fileIndex];
    const fileName = normalizeFileName(file.name);
    const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
    let failedAssertions = 0;
    for (let assertionIndex = 0; assertionIndex < assertions.length; assertionIndex += 1) {
      const assertion = assertions[assertionIndex];
      if (!assertion || typeof assertion !== 'object' || typeof assertion.status !== 'string') {
        return runnerFailure(source, 'invalid assertion result in ' + fileName);
      }
      if (assertion.status !== 'failed') continue;
      failedAssertions += 1;
      const suiteIdentity = normalizeSuiteIdentity(assertion.ancestorTitles);
      const title = normalizeTestName(assertion.title);
      const fullName = normalizeTestName(assertion.fullName || [...suiteIdentity, title].filter(Boolean).join(' ') || title);
      failures.push({
        ...makeFailure({
          file: fileName,
          testName: fullName,
          suiteIdentity,
          message: failureMessage(assertion) || 'missing failure message',
          explicitErrorClass: assertion.error?.name,
          source,
          occurrence: assertionIndex,
        }),
        assertionIndex,
        fileIndex,
      });
    }

    if (file.status === 'failed' && failedAssertions === 0) {
      const message = file.message || file.failureMessage || 'file-level failure';
      failures.push({
        ...makeFailure({
          file: fileName,
          testName: '__FILE_FAILURE__',
          suiteIdentity: [],
          message,
          explicitErrorClass: file.failureDetails?.[0]?.name,
          source,
          occurrence: fileIndex,
        }),
        fileIndex,
      });
    }
  }
  return failures;
}

export const targetKey = (failure) => JSON.stringify([
  failure.file,
  normalizeSuiteIdentity(failure.suiteIdentity),
  failure.testName,
]);
export const failureKey = (failure) => JSON.stringify([
  targetKey(failure),
  failure.runnerErrorClass || '',
  failure.errorClass || '',
  failure.signature || failure.normalizedSignature || '',
]);
const semanticKey = (failure) => JSON.stringify([
  targetKey(failure),
  failure.semanticRunnerErrorClass || failure.runnerErrorClass || '',
  failure.semanticErrorClass || failure.errorClass || '',
  failure.semanticSignature || failure.normalizedMessage || failure.signature || '',
]);

function groupFailures(failures) {
  const groups = new Map();
  for (const failure of failures) {
    const key = targetKey(failure);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(failure);
  }
  return groups;
}

function takeMatchingFailure(failures, key) {
  const index = failures.findIndex((failure) => key(failure));
  return index < 0 ? null : failures.splice(index, 1)[0];
}

function hasVitestExpectationFrame(failure) {
  return /node_modules\/@vitest\/expect\/dist\/index\.js/.test(failure.originalStack || '');
}

function isVitestExpectationWrapperChange(baseFailure, candidateFailure) {
  const classPair = (baseFailure.runnerErrorClass === 'AssertionError' && candidateFailure.runnerErrorClass === 'Error')
    || (baseFailure.runnerErrorClass === 'Error' && candidateFailure.runnerErrorClass === 'AssertionError');
  return classPair
    && baseFailure.messageWithoutClass === candidateFailure.messageWithoutClass
    && hasVitestExpectationFrame(baseFailure)
    && hasVitestExpectationFrame(candidateFailure);
}

function getSsrImportBinding(message) {
  const baseMatch = String(message || '').match(/^\(0\s*,\s*__vite_ssr_import_\d+__\.([A-Za-z_$][\w$]*)\)\s+is not a function$/);
  if (baseMatch) return { kind: 'wrapped', binding: baseMatch[1] };
  const candidateMatch = String(message || '').match(/^([A-Za-z_$][\w$]*)\s+is not a function$/);
  return candidateMatch ? { kind: 'direct', binding: candidateMatch[1] } : null;
}

function isViteSsrImportWrapperChange(baseFailure, candidateFailure) {
  const baseBinding = getSsrImportBinding(removeLeadingErrorClass(baseFailure.normalizedMessage));
  const candidateBinding = getSsrImportBinding(removeLeadingErrorClass(candidateFailure.normalizedMessage));
  return Boolean(baseBinding && candidateBinding)
    && baseBinding.kind === 'wrapped'
    && candidateBinding.kind === 'direct'
    && baseBinding.binding === candidateBinding.binding;
}

function compareDiagnosticPair(baseFailure, candidateFailure) {
  if (!baseFailure) {
    return {
      classification: 'CANDIDATE_ONLY_TARGET',
      rawCandidateOnly: true,
      baseFailure: null,
      candidateFailure,
      runnerEvidence: [],
    };
  }

  if (failureKey(baseFailure) === failureKey(candidateFailure)) {
    return {
      classification: 'IDENTICAL_DIAGNOSTIC',
      rawCandidateOnly: false,
      baseFailure,
      candidateFailure,
      runnerEvidence: [],
    };
  }

  if (isVitestExpectationWrapperChange(baseFailure, candidateFailure)) {
    return {
      classification: 'VITEST_EXPECTATION_WRAPPER_CHANGE',
      rawCandidateOnly: true,
      baseFailure,
      candidateFailure,
      runnerEvidence: [
        'same normalized matcher message after removing only the explicit Error class prefix',
        'both original stacks point to @vitest/expect/dist/index.js',
        'the original error classes are preserved on both diagnostics',
      ],
    };
  }

  if (isViteSsrImportWrapperChange(baseFailure, candidateFailure)) {
    return {
      classification: 'VITE_SSR_IMPORT_WRAPPER_CHANGE',
      rawCandidateOnly: true,
      baseFailure,
      candidateFailure,
      runnerEvidence: [
        'base message contains the generated __vite_ssr_import_N__ binding marker',
        'candidate message names the same binding and the same "is not a function" condition',
        'the JSON report contains no file-level stack; both original messages are retained',
      ],
    };
  }

  const sameClasses = baseFailure.runnerErrorClass === candidateFailure.runnerErrorClass
    && baseFailure.errorClass === candidateFailure.errorClass;
  if (sameClasses && baseFailure.normalizedMessage === candidateFailure.normalizedMessage) {
    const basePrimary = extractPrimaryMessage(baseFailure.originalMessage);
    const candidatePrimary = extractPrimaryMessage(candidateFailure.originalMessage);
    const pathNormalizedBase = normalizeCheckoutPaths(basePrimary);
    const pathNormalizedCandidate = normalizeCheckoutPaths(candidatePrimary);
    if (pathNormalizedBase === pathNormalizedCandidate && basePrimary !== candidatePrimary) {
      return {
        classification: 'CHECKOUT_PATH_ONLY_CHANGE',
        rawCandidateOnly: true,
        baseFailure,
        candidateFailure,
        runnerEvidence: ['only the main/pr checkout prefix differs; both exact original paths are retained'],
      };
    }
    if (basePrimary === candidatePrimary) {
      return {
        classification: 'STACK_ONLY_CHANGE',
        rawCandidateOnly: true,
        baseFailure,
        candidateFailure,
        runnerEvidence: ['normalized primary messages and error classes match; full original stacks are retained'],
      };
    }
    return {
      classification: 'RUNNER_MESSAGE_FORMAT_CHANGE',
      rawCandidateOnly: true,
      baseFailure,
      candidateFailure,
      runnerEvidence: ['primary message differs only after ANSI/whitespace normalization; both originals are retained'],
    };
  }

  return {
    classification: 'SEMANTIC_DIAGNOSTIC_CHANGE',
    rawCandidateOnly: true,
    baseFailure,
    candidateFailure,
    runnerEvidence: [],
  };
}

function diagnosticTarget(file, testName, suiteIdentity) {
  return { file, testName, suiteIdentity: normalizeSuiteIdentity(suiteIdentity) };
}

function compareTargetDiagnostics(baseFailures, candidateFailures, target) {
  const baseRemaining = [...baseFailures];
  const targetWasAbsentFromBase = baseFailures.length === 0;
  const candidateRemaining = [...candidateFailures];
  const comparisons = [];

  while (candidateRemaining.length > 0) {
    const candidateFailure = candidateRemaining.shift();
    const exact = takeMatchingFailure(baseRemaining, (baseFailure) => failureKey(baseFailure) === failureKey(candidateFailure));
    if (exact) {
      comparisons.push({
        ...diagnosticTarget(target.file, target.testName, target.suiteIdentity),
        ...compareDiagnosticPair(exact, candidateFailure),
      });
      continue;
    }

    const safeMatchIndex = baseRemaining.findIndex((baseFailure) => {
      const result = compareDiagnosticPair(baseFailure, candidateFailure);
      return [
        'STACK_ONLY_CHANGE',
        'CHECKOUT_PATH_ONLY_CHANGE',
        'RUNNER_MESSAGE_FORMAT_CHANGE',
        'VITEST_EXPECTATION_WRAPPER_CHANGE',
        'VITE_SSR_IMPORT_WRAPPER_CHANGE',
      ].includes(result.classification);
    });
    if (safeMatchIndex >= 0) {
      const baseFailure = baseRemaining.splice(safeMatchIndex, 1)[0];
      comparisons.push({
        ...diagnosticTarget(target.file, target.testName, target.suiteIdentity),
        ...compareDiagnosticPair(baseFailure, candidateFailure),
      });
      continue;
    }

    if (baseRemaining.length > 0) {
      const baseFailure = baseRemaining.shift();
      comparisons.push({
        ...diagnosticTarget(target.file, target.testName, target.suiteIdentity),
        ...compareDiagnosticPair(baseFailure, candidateFailure),
      });
      continue;
    }

    comparisons.push({
      ...diagnosticTarget(target.file, target.testName, target.suiteIdentity),
      classification: targetWasAbsentFromBase ? 'CANDIDATE_ONLY_TARGET' : 'ADDITIONAL_FAILURE_OCCURRENCE',
      rawCandidateOnly: true,
      baseFailure: null,
      candidateFailure,
      runnerEvidence: [],
    });
  }

  for (const baseFailure of baseRemaining) {
    comparisons.push({
      ...diagnosticTarget(target.file, target.testName, target.suiteIdentity),
      classification: 'BASE_ONLY_DIAGNOSTIC',
      rawCandidateOnly: false,
      baseFailure,
      candidateFailure: null,
      runnerEvidence: [],
    });
  }
  return comparisons;
}

function distinctTargets(targets) {
  const unique = new Map();
  for (const target of targets) {
    const key = targetKey(target);
    if (!unique.has(key)) unique.set(key, target);
  }
  return [...unique.values()];
}

function subtractExactFailures(candidateFailures, baseFailures) {
  const baseRemaining = [...baseFailures];
  const sharedFailures = [];
  const rawCandidateOnlyFailures = [];
  for (const candidateFailure of candidateFailures) {
    const matched = takeMatchingFailure(baseRemaining, (baseFailure) => failureKey(baseFailure) === failureKey(candidateFailure));
    if (matched) sharedFailures.push(candidateFailure);
    else rawCandidateOnlyFailures.push(candidateFailure);
  }
  return { sharedFailures, rawCandidateOnlyFailures, resolvedFailures: baseRemaining };
}

export function compareFullReports(candidateReport, baseReport) {
  const candidateValidation = validateVitestReport(candidateReport);
  const baseValidation = validateVitestReport(baseReport);
  const candidateFailures = normalizeFailures(candidateReport, 'CANDIDATE');
  const baseFailures = normalizeFailures(baseReport, 'BASE');
  const exact = subtractExactFailures(candidateFailures, baseFailures);
  const baseGroups = groupFailures(baseFailures);
  const candidateGroups = groupFailures(candidateFailures);
  const allTargetKeys = [...new Set([...baseGroups.keys(), ...candidateGroups.keys()])].sort();
  const diagnosticComparisons = [];
  const candidateOnlyTargets = [];
  const resolvedTargets = [];

  for (const key of allTargetKeys) {
    const baseTargetFailures = baseGroups.get(key) || [];
    const candidateTargetFailures = candidateGroups.get(key) || [];
    const sample = candidateTargetFailures[0] || baseTargetFailures[0];
    const target = diagnosticTarget(sample.file, sample.testName, sample.suiteIdentity);
    if (baseTargetFailures.length === 0) {
      candidateOnlyTargets.push({
        ...target,
        occurrenceCount: candidateTargetFailures.length,
        reason: 'CANDIDATE_ONLY_TARGET',
      });
      diagnosticComparisons.push(...compareTargetDiagnostics([], candidateTargetFailures, target));
      continue;
    }
    if (candidateTargetFailures.length === 0) {
      resolvedTargets.push({
        ...target,
        occurrenceCount: baseTargetFailures.length,
        reason: 'BASE_ONLY_TARGET',
      });
      diagnosticComparisons.push(...compareTargetDiagnostics(baseTargetFailures, [], target));
      continue;
    }
    diagnosticComparisons.push(...compareTargetDiagnostics(baseTargetFailures, candidateTargetFailures, target));
  }

  const unresolvedDiagnosticComparisons = diagnosticComparisons.filter((item) => (
    item.classification === 'SEMANTIC_DIAGNOSTIC_CHANGE'
    || item.classification === 'ADDITIONAL_FAILURE_OCCURRENCE'
  ));
  const focusTargets = distinctTargets([
    ...candidateOnlyTargets.map((target) => ({ ...target, focusReason: target.reason })),
    ...unresolvedDiagnosticComparisons.map((item) => ({
      file: item.file,
      testName: item.testName,
      suiteIdentity: item.suiteIdentity,
      focusReason: item.classification,
    })),
  ]);
  const rawCandidateOnlyClassificationCounts = {};
  for (const item of diagnosticComparisons) {
    if (!item.rawCandidateOnly) continue;
    rawCandidateOnlyClassificationCounts[item.classification] =
      (rawCandidateOnlyClassificationCounts[item.classification] || 0) + 1;
  }
  const reportValidationErrors = [];
  if (candidateValidation) reportValidationErrors.push({ source: 'CANDIDATE', message: candidateValidation });
  if (baseValidation) reportValidationErrors.push({ source: 'BASE', message: baseValidation });

  return {
    candidateFailures,
    baseFailures,
    sharedFailures: exact.sharedFailures,
    rawCandidateOnlyFailures: exact.rawCandidateOnlyFailures,
    resolvedFailures: exact.resolvedFailures,
    candidateOnlyTargets,
    resolvedTargets,
    diagnosticComparisons,
    unresolvedDiagnosticComparisons,
    rawCandidateOnlyClassificationCounts,
    focusTargets,
    reportValidationErrors,
  };
}

function focusedFailures(evidence, source) {
  return evidence.flatMap(({ report, logText, jsonPath, logPath, exitCode }) => normalizeFailures(report, source).map((failure) => {
    const semantic = failure.opaqueJson
      ? deriveSemanticFailureFromLog(logText)
      : {
        semanticErrorClass: failure.errorClass,
        semanticRunnerErrorClass: failure.runnerErrorClass,
        semanticSignature: failure.normalizedMessage,
        semanticSource: 'JSON',
      };
    return { ...failure, ...semantic, jsonPath, logPath, exitCode };
  }));
}

function rawSemanticIdentity(failure) {
  return failure.opaqueJson
    ? {
      semanticErrorClass: null,
      semanticRunnerErrorClass: null,
      semanticSignature: null,
      semanticSource: 'UNRESOLVED',
    }
    : {
      semanticErrorClass: failure.errorClass,
      semanticRunnerErrorClass: failure.runnerErrorClass,
      semanticSignature: failure.normalizedMessage,
      semanticSource: 'JSON',
    };
}

function focusedTargetOutcomes(evidence, target) {
  const outcomes = [];
  for (const item of evidence) {
    const validationError = validateVitestReport(item.report);
    if (validationError) {
      outcomes.push({ status: 'INVALID_REPORT', message: validationError, report: item });
      continue;
    }

    let matchingAssertions = [];
    let fileFailure = null;
    for (const file of item.report.testResults) {
      const fileName = normalizeFileName(file.name);
      if (fileName !== target.file) continue;
      const assertions = Array.isArray(file.assertionResults) ? file.assertionResults : [];
      if (target.testName === '__FILE_FAILURE__' && file.status === 'failed' && assertions.length === 0) {
        fileFailure = normalizeFailures(item.report, 'FOCUSED').find((failure) => targetKey(failure) === targetKey(target)) || null;
        break;
      }
      matchingAssertions = assertions.filter((assertion) => {
        const suiteIdentity = normalizeSuiteIdentity(assertion.ancestorTitles);
        const title = normalizeTestName(assertion.title);
        const testName = normalizeTestName(assertion.fullName || [...suiteIdentity, title].filter(Boolean).join(' ') || title);
        return targetKey({ file: fileName, testName, suiteIdentity }) === targetKey(target);
      });
      if (matchingAssertions.length > 0) break;
    }

    if (fileFailure) {
      const normalized = normalizeFailures(item.report, 'FOCUSED').find((failure) => targetKey(failure) === targetKey(target));
      outcomes.push({ status: 'FAILED', failures: normalized ? [{ ...normalized, ...rawSemanticIdentity(normalized), logText: item.logText }] : [], report: item });
      continue;
    }
    if (matchingAssertions.some((assertion) => assertion.status === 'failed')) {
      const failures = focusedFailures([item], 'FOCUSED').filter((failure) => targetKey(failure) === targetKey(target));
      outcomes.push({ status: 'FAILED', failures, report: item });
      continue;
    }
    if (matchingAssertions.some((assertion) => assertion.status === 'passed')) {
      outcomes.push({ status: 'PASSED', failures: [], report: item });
      continue;
    }
    if (matchingAssertions.some((assertion) => ['skipped', 'pending', 'todo'].includes(assertion.status))) {
      outcomes.push({ status: 'NOT_EXECUTED', failures: [], report: item });
      continue;
    }
    outcomes.push({ status: 'NOT_EXECUTED', failures: [], report: item });
  }
  return outcomes;
}

export function classifyFocusedEvidence(focusTargets, baseFocusedEvidence, candidateFocusedEvidence) {
  const targets = distinctTargets(focusTargets);
  if (targets.length > MAX_FOCUSED_FAILURES) {
    return {
      status: 'FAIL_CLOSED',
      diagnostic: 'focused target count ' + targets.length + ' exceeds safe limit ' + MAX_FOCUSED_FAILURES,
      classifications: [],
      newFailures: targets,
    };
  }
  if (targets.length > 0 && (baseFocusedEvidence.length < targets.length * 10 || candidateFocusedEvidence.length < targets.length * 10)) {
    return {
      status: 'FAIL_CLOSED',
      diagnostic: 'focused evidence requires at least 10 reports per target; found BASE=' + baseFocusedEvidence.length + ', CANDIDATE=' + candidateFocusedEvidence.length,
      classifications: [],
      newFailures: targets,
    };
  }

  const allBaseFailures = focusedFailures(baseFocusedEvidence, 'BASE_FOCUSED');
  const allCandidateFailures = focusedFailures(candidateFocusedEvidence, 'CANDIDATE_FOCUSED');
  const unresolvedFailures = [];
  const classifications = targets.map((target) => {
    const baseOutcomes = focusedTargetOutcomes(baseFocusedEvidence, target);
    const candidateOutcomes = focusedTargetOutcomes(candidateFocusedEvidence, target);
    const invalidOrMissing = [...baseOutcomes, ...candidateOutcomes].filter((item) => item.status === 'INVALID_REPORT' || item.status === 'NOT_EXECUTED');
    const baseFailures = allBaseFailures.filter((failure) => targetKey(failure) === targetKey(target));
    const candidateFailures = allCandidateFailures.filter((failure) => targetKey(failure) === targetKey(target));
    const candidateSemanticKeys = [...new Set(candidateFailures
      .filter((failure) => failure.semanticSource !== 'UNRESOLVED')
      .map(semanticKey))];
    const candidateHasUnresolved = candidateFailures.some((failure) => failure.semanticSource === 'UNRESOLVED');
    const baseHasUnresolved = baseFailures.some((failure) => failure.semanticSource === 'UNRESOLVED');
    const baseFailCount = baseOutcomes.filter((item) => item.status === 'FAILED').length;
    const candidateFailCount = candidateOutcomes.filter((item) => item.status === 'FAILED').length;
    const basePassCount = baseOutcomes.filter((item) => item.status === 'PASSED').length;
    const candidatePassCount = candidateOutcomes.filter((item) => item.status === 'PASSED').length;

    const missingSemanticEvidence = invalidOrMissing.length > 0
      || candidateHasUnresolved
      || (candidateFailCount > 0 && candidateSemanticKeys.length !== 1);
    if (missingSemanticEvidence || candidateFailCount === 0) {
      unresolvedFailures.push(target);
      return {
        ...target,
        classification: missingSemanticEvidence ? 'SEMANTIC_IDENTITY_UNRESOLVED' : 'CANDIDATE_FAILURE_NOT_REPRODUCED',
        baseEvidenceCount: baseOutcomes.length,
        candidateEvidenceCount: candidateOutcomes.length,
        basePassCount,
        baseFailureCount: baseFailCount,
        candidatePassCount,
        candidateFailureCount: candidateFailCount,
        notExecutedCount: invalidOrMissing.length,
        semanticErrorClass: null,
        semanticRunnerErrorClass: null,
        semanticSignature: null,
        semanticSource: 'UNRESOLVED',
      };
    }

    const candidateSemantic = candidateFailures.find((failure) => failure.semanticSource !== 'UNRESOLVED');
    const matchingBaseFailures = baseFailures.filter((failure) => semanticKey(failure) === semanticKey(candidateSemantic));
    if (baseHasUnresolved && matchingBaseFailures.length === 0) {
      unresolvedFailures.push(target);
      return {
        ...target,
        ...candidateSemantic,
        classification: 'SEMANTIC_IDENTITY_UNRESOLVED',
        baseEvidenceCount: baseOutcomes.length,
        candidateEvidenceCount: candidateOutcomes.length,
        basePassCount,
        baseFailureCount: baseFailCount,
        candidatePassCount,
        candidateFailureCount: candidateFailCount,
        semanticSignatureMatch: false,
      };
    }

    const candidateRate = candidateOutcomes.length ? candidateFailCount / candidateOutcomes.length : 0;
    const baseRate = baseOutcomes.length ? baseFailCount / baseOutcomes.length : 0;
    const classification = matchingBaseFailures.length > 0 && candidateRate <= baseRate
      ? 'PREEXISTING_FLAKY_BASELINE_FAILURE'
      : matchingBaseFailures.length > 0
        ? 'CANDIDATE_FAILURE_RATE_INCREASE'
        : 'NEW_FAILURE';
    return {
      ...target,
      ...candidateSemantic,
      classification,
      baseEvidenceCount: baseOutcomes.length,
      candidateEvidenceCount: candidateOutcomes.length,
      basePassCount,
      baseFailureCount: baseFailCount,
      candidatePassCount,
      candidateFailureCount: candidateFailCount,
      baseFailureRate: baseRate,
      candidateFailureRate: candidateRate,
      matchingBaseFailureCount: matchingBaseFailures.length,
      semanticSignatureMatch: matchingBaseFailures.length > 0,
    };
  });
  const newFailures = classifications.filter((item) => item.classification !== 'PREEXISTING_FLAKY_BASELINE_FAILURE');
  return {
    status: unresolvedFailures.length > 0 ? 'FAIL_CLOSED' : 'OK',
    diagnostic: unresolvedFailures.length > 0
      ? 'focused target evidence was incomplete, non-reproducible, or lacked one stable semantic failure'
      : undefined,
    classifications,
    newFailures,
    unresolvedFailures,
  };
}

function readFocusedEvidence(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^focused-\d+(?:-\d+)?\.json$/.test(name))
    .sort()
    .map((name) => {
      const jsonPath = path.join(directory, name);
      const stem = name.replace(/\.json$/, '');
      const logPath = path.join(directory, stem + '.log');
      const exitPath = path.join(directory, stem + '.exit');
      return {
        report: readJson(jsonPath),
        logText: fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '',
        jsonPath,
        logPath,
        exitCode: fs.existsSync(exitPath) ? fs.readFileSync(exitPath, 'utf8').trim() : null,
      };
    });
}

function writeSummary(result, output) {
  const lines = [
    '# PR #127 global comparison',
    '',
    '- shared exact failure signatures: ' + result.sharedFailures.length,
    '- raw candidate-only failure signatures: ' + result.rawCandidateOnlyFailures.length,
    '- candidate-only stable targets: ' + result.candidateOnlyTargets.length,
    '- focused targets requiring repetitions: ' + (result.focusTargets?.length || 0),
    '- semantic diagnostic changes requiring review: ' + (result.unresolvedDiagnosticComparisons?.length || 0),
    '- raw candidate-only classification counts: ' + JSON.stringify(result.rawCandidateOnlyClassificationCounts || {}),
    '- preexisting flaky baseline failures: ' + (result.preexistingFlakyFailures?.length || 0),
    '- new failures: ' + (result.newFailures?.length || 0),
    '- unresolved semantic identities: ' + (result.unresolvedFailures?.length || 0),
    result.diagnostic ? '- diagnostic: ' + result.diagnostic : '',
  ].filter(Boolean);
  fs.writeFileSync(output, lines.join('\n') + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}

function extract({ candidate, base, output }) {
  const comparison = compareFullReports(readJson(candidate), readJson(base));
  const targets = comparison.focusTargets.map(({ file, testName, suiteIdentity }) => ({ file, testName, suiteIdentity }));
  const result = {
    ...comparison,
    targets,
    diagnostic: comparison.reportValidationErrors.length > 0
      ? comparison.reportValidationErrors.map((item) => item.source + ': ' + item.message).join('; ')
      : comparison.focusTargets.length > MAX_FOCUSED_FAILURES
        ? 'focused target count ' + comparison.focusTargets.length + ' exceeds safe limit ' + MAX_FOCUSED_FAILURES
        : undefined,
  };
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeJson(output, result);
  writeJson(path.join(path.dirname(output), 'targets.json'), targets);
  return result;
}

function classify({ phase, baseFocused, candidateFocused, output }) {
  const initial = readJson(phase);
  const targets = initial.focusTargets || initial.targets || initial.rawCandidateOnlyFailures;
  const focused = classifyFocusedEvidence(targets, readFocusedEvidence(baseFocused), readFocusedEvidence(candidateFocused));
  const result = {
    ...initial,
    ...focused,
    preexistingFlakyFailures: focused.classifications.filter((item) => item.classification === 'PREEXISTING_FLAKY_BASELINE_FAILURE'),
  };
  writeJson(output, result);
  writeSummary(result, output.replace(/\.json$/, '.md'));
  return result;
}

const argument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
};

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  const options = {
    candidate: argument('--candidate'),
    base: argument('--base'),
    output: argument('--output'),
    phase: argument('--phase'),
    baseFocused: argument('--base-focused'),
    candidateFocused: argument('--candidate-focused'),
  };
  const result = command === 'extract'
    ? extract(options)
    : command === 'classify'
      ? classify(options)
      : null;
  if (!result) throw new Error('usage: pr127-global-comparison.mjs <extract|classify> [options]');
  if (result.diagnostic || result.newFailures?.length > 0) process.exitCode = 1;
}
