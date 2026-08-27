import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FOCUSED_FAILURES = 10;

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJson = (file, value) => fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);

export function normalizeFileName(fileName) {
  const normalized = String(fileName || 'unknown file').replaceAll('\\', '/');
  const checkoutMatch = normalized.match(/\/(?:pr|main)\/(.*)$/);
  if (checkoutMatch) return checkoutMatch[1];
  const sourceIndex = normalized.indexOf('/src/');
  return sourceIndex >= 0 ? normalized.slice(sourceIndex + 1) : normalized;
}

export function normalizeTestName(name) {
  return String(name || 'unknown test')
    .replace(/\b\d+(?:\.\d+)?%/g, '<percentage>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function errorClass(message) {
  const value = String(message || '');
  if (/\b(?:Test )?timed out\b|\bTimeout(?:Error)?\b/i.test(value)) return 'Timeout';
  if (/\bENOENT\b/i.test(value)) return 'ENOENT';
  if (/\b(?:ERR_MODULE_NOT_FOUND|Cannot find module|Failed to load (?:url|module)|import .* failed)\b/i.test(value)) return 'ModuleImportError';
  if (/\bUnhandled(?: Promise)? Rejection\b|\bunhandledRejection\b/i.test(value)) return 'UnhandledRejection';
  if (/\b(?:beforeAll|afterAll|beforeEach|afterEach)\b.*\b(?:failed|error)|\bhook\b.*\b(?:failed|error)/i.test(value)) return 'HookFailure';
  if (/\bAssertionError\b|\bexpect\(.+\)\.(?:to|not)\b|\bexpected\b.+\b(?:to be|to equal|to match)\b/i.test(value)) return 'AssertionError';
  for (const name of ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'Error']) {
    if (new RegExp(`\\b${name}\\b`).test(value)) return name;
  }
  return 'OtherError';
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
    return { semanticErrorClass: null, semanticSignature: null, semanticSource: 'UNRESOLVED' };
  }
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const pattern = signatureLinePatterns[detectedClass];
  const meaningfulLine = pattern ? lines.find((line) => pattern.test(line)) : lines.find((line) => !/\b(?:@vitest|vitest\/dist|node_modules)\b/i.test(line));
  if (!meaningfulLine || isOpaqueFailureSignature(meaningfulLine, detectedClass)) {
    return { semanticErrorClass: null, semanticSignature: null, semanticSource: 'UNRESOLVED' };
  }
  return {
    semanticErrorClass: detectedClass,
    semanticSignature: normalizeErrorSignature(meaningfulLine),
    semanticSource: 'LOG',
  };
}

const failureMessage = (assertion) => [
  ...(Array.isArray(assertion.failureMessages) ? assertion.failureMessages : []),
  assertion.failureMessage,
  assertion.error?.message,
].filter(Boolean).join('\n');

export function normalizeFailures(report, source = 'RUNNER') {
  if (!report) return [{ file: `__${source}_RUNNER__`, testName: 'missing json report', errorClass: 'RunnerError', signature: 'missing json report' }];
  const failures = [];
  for (const file of report.testResults || []) {
    const fileName = normalizeFileName(file.name);
    const assertions = file.assertionResults || [];
    for (const assertion of assertions) {
      if (assertion.status !== 'failed') continue;
      const message = failureMessage(assertion);
      const jsonErrorClass = errorClass(message);
      const jsonSignature = normalizeErrorSignature(message);
      failures.push({
        file: fileName,
        testName: normalizeTestName(assertion.fullName || assertion.title),
        errorClass: jsonErrorClass,
        signature: jsonSignature,
        jsonErrorClass,
        jsonSignature,
        opaqueJson: isOpaqueFailureSignature(message, jsonErrorClass),
      });
    }
    if (file.status === 'failed' && assertions.length === 0) {
      const message = file.message || file.failureMessage || 'file-level failure';
      const jsonErrorClass = errorClass(message);
      const jsonSignature = normalizeErrorSignature(message);
      failures.push({ file: fileName, testName: '__FILE_FAILURE__', errorClass: jsonErrorClass, signature: jsonSignature, jsonErrorClass, jsonSignature, opaqueJson: isOpaqueFailureSignature(message, jsonErrorClass) });
    }
  }
  return uniqueFailures(failures);
}

export const failureKey = (failure) => [failure.file, failure.testName, failure.errorClass, failure.signature].join('::');
export const targetKey = (failure) => [failure.file, failure.testName].join('::');
const semanticKey = (failure) => [failure.file, failure.testName, failure.semanticErrorClass, failure.semanticSignature].join('::');
const uniqueFailures = (failures) => [...new Map(failures.map((failure) => [failureKey(failure), failure])).values()].sort((a, b) => failureKey(a).localeCompare(failureKey(b)));

export function compareFullReports(candidateReport, baseReport) {
  const candidateFailures = normalizeFailures(candidateReport, 'CANDIDATE');
  const baseFailures = normalizeFailures(baseReport, 'BASE');
  const baseKeys = new Set(baseFailures.map(failureKey));
  const candidateKeys = new Set(candidateFailures.map(failureKey));
  return {
    candidateFailures,
    baseFailures,
    sharedFailures: candidateFailures.filter((failure) => baseKeys.has(failureKey(failure))),
    rawCandidateOnlyFailures: candidateFailures.filter((failure) => !baseKeys.has(failureKey(failure))),
    resolvedFailures: baseFailures.filter((failure) => !candidateKeys.has(failureKey(failure))),
  };
}

function focusedFailures(evidence, source) {
  return evidence.flatMap(({ report, logText, jsonPath, logPath, exitCode }) => normalizeFailures(report, source).map((failure) => {
    const semantic = failure.opaqueJson
      ? deriveSemanticFailureFromLog(logText)
      : { semanticErrorClass: failure.jsonErrorClass, semanticSignature: failure.jsonSignature, semanticSource: 'JSON' };
    return { ...failure, ...semantic, jsonPath, logPath, exitCode };
  }));
}

function rawSemanticIdentity(failure) {
  return failure.opaqueJson
    ? { semanticErrorClass: null, semanticSignature: null, semanticSource: 'UNRESOLVED' }
    : { semanticErrorClass: failure.jsonErrorClass || failure.errorClass, semanticSignature: failure.jsonSignature || failure.signature, semanticSource: 'JSON' };
}

export function classifyFocusedEvidence(rawCandidateOnlyFailures, baseFocusedEvidence, candidateFocusedEvidence) {
  if (rawCandidateOnlyFailures.length > MAX_FOCUSED_FAILURES) {
    return { status: 'FAIL_CLOSED', diagnostic: `candidate-only failure count ${rawCandidateOnlyFailures.length} exceeds safe limit ${MAX_FOCUSED_FAILURES}`, classifications: [], newFailures: rawCandidateOnlyFailures };
  }
  if (rawCandidateOnlyFailures.length > 0 && (baseFocusedEvidence.length < rawCandidateOnlyFailures.length * 10 || candidateFocusedEvidence.length < rawCandidateOnlyFailures.length * 10)) {
    return {
      status: 'FAIL_CLOSED',
      diagnostic: `focused evidence requires at least 10 reports per target; found BASE=${baseFocusedEvidence.length}, CANDIDATE=${candidateFocusedEvidence.length}`,
      classifications: [],
      newFailures: rawCandidateOnlyFailures,
    };
  }
  const baseFailures = focusedFailures(baseFocusedEvidence, 'BASE_FOCUSED');
  const candidateFailures = focusedFailures(candidateFocusedEvidence, 'CANDIDATE_FOCUSED');
  const unresolvedFailures = [];
  const classifications = rawCandidateOnlyFailures.map((failure) => {
    const candidateEvidence = candidateFailures.filter((item) => targetKey(item) === targetKey(failure));
    const baseTargetEvidence = baseFailures.filter((item) => targetKey(item) === targetKey(failure));
    let semantic = rawSemanticIdentity(failure);
    if (failure.opaqueJson) {
      const resolvedCandidateEvidence = candidateEvidence.filter((item) => item.semanticSource !== 'UNRESOLVED');
      const candidateSemanticKeys = [...new Set(resolvedCandidateEvidence.map(semanticKey))];
      const candidateHasUnresolvedEvidence = candidateEvidence.some((item) => item.semanticSource === 'UNRESOLVED');
      if (candidateHasUnresolvedEvidence || candidateSemanticKeys.length !== 1) {
        unresolvedFailures.push(failure);
        return { ...failure, classification: 'SEMANTIC_IDENTITY_UNRESOLVED', baseEvidenceCount: 0, candidateEvidenceCount: candidateEvidence.length, semanticSignatureMatch: false, semanticErrorClass: null, semanticSignature: null, semanticSource: 'UNRESOLVED' };
      }
      semantic = resolvedCandidateEvidence[0];
    }
    const baseHasUnresolvedEvidence = baseTargetEvidence.some((item) => item.semanticSource === 'UNRESOLVED');
    const baseEvidence = baseTargetEvidence.filter((item) => semanticKey(item) === semanticKey({ ...failure, ...semantic }));
    if (baseHasUnresolvedEvidence && baseEvidence.length === 0) {
      unresolvedFailures.push(failure);
      return { ...failure, ...semantic, classification: 'SEMANTIC_IDENTITY_UNRESOLVED', baseEvidenceCount: 0, candidateEvidenceCount: candidateEvidence.length, semanticSignatureMatch: false };
    }
    return {
      ...failure,
      ...semantic,
      classification: baseEvidence.length > 0 ? 'PREEXISTING_FLAKY_BASELINE_FAILURE' : 'NEW_FAILURE',
      baseEvidenceCount: baseEvidence.length,
      candidateEvidenceCount: candidateEvidence.length,
      semanticSignatureMatch: baseEvidence.length > 0,
    };
  });
  const newFailures = classifications.filter((item) => item.classification !== 'PREEXISTING_FLAKY_BASELINE_FAILURE');
  return {
    status: unresolvedFailures.length > 0 ? 'FAIL_CLOSED' : 'OK',
    diagnostic: unresolvedFailures.length > 0 ? `semantic identity unresolved for ${unresolvedFailures.length} opaque candidate-only failure(s)` : undefined,
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
      const logPath = path.join(directory, `${stem}.log`);
      const exitPath = path.join(directory, `${stem}.exit`);
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
    '# PR #127 global comparison', '',
    `- shared failures: ${result.sharedFailures.length}`,
    `- raw candidate-only failures: ${result.rawCandidateOnlyFailures.length}`,
    `- preexisting flaky baseline failures: ${result.preexistingFlakyFailures.length}`,
    `- new failures: ${result.newFailures.length}`,
    `- unresolved semantic identities: ${result.unresolvedFailures?.length || 0}`,
    `- resolved failures: ${result.resolvedFailures.length}`,
    result.diagnostic ? `- diagnostic: ${result.diagnostic}` : '',
  ].filter(Boolean);
  fs.writeFileSync(output, `${lines.join('\n')}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function extract({ candidate, base, output }) {
  const comparison = compareFullReports(readJson(candidate), readJson(base));
  const result = { ...comparison, targets: comparison.rawCandidateOnlyFailures.map(({ file, testName }) => ({ file, testName })) };
  if (result.rawCandidateOnlyFailures.length > MAX_FOCUSED_FAILURES) result.diagnostic = `candidate-only failure count ${result.rawCandidateOnlyFailures.length} exceeds safe limit ${MAX_FOCUSED_FAILURES}`;
  fs.mkdirSync(path.dirname(output), { recursive: true });
  writeJson(output, result);
  writeJson(path.join(path.dirname(output), 'targets.json'), result.targets);
  return result;
}

function classify({ phase, baseFocused, candidateFocused, output }) {
  const initial = readJson(phase);
  const focused = classifyFocusedEvidence(initial.rawCandidateOnlyFailures, readFocusedEvidence(baseFocused), readFocusedEvidence(candidateFocused));
  const result = {
    ...initial,
    ...focused,
    preexistingFlakyFailures: focused.classifications.filter((item) => item.classification === 'PREEXISTING_FLAKY_BASELINE_FAILURE'),
  };
  writeJson(output, result);
  writeSummary(result, output.replace(/\.json$/, '.md'));
  return result;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const command = process.argv[2];
  const options = {
    candidate: argument('--candidate'), base: argument('--base'), output: argument('--output'),
    phase: argument('--phase'), baseFocused: argument('--base-focused'), candidateFocused: argument('--candidate-focused'),
  };
  const result = command === 'extract' ? extract(options) : command === 'classify' ? classify(options) : null;
  if (!result) throw new Error('usage: pr127-global-comparison.mjs <extract|classify> [options]');
  if (result.diagnostic || result.newFailures?.length > 0) process.exitCode = 1;
}
