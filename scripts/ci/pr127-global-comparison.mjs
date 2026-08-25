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
    .replace(/\s+/g, ' ')
    .trim();
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
      failures.push({
        file: fileName,
        testName: normalizeTestName(assertion.fullName || assertion.title),
        errorClass: errorClass(message),
        signature: normalizeErrorSignature(message),
      });
    }
    if (file.status === 'failed' && assertions.length === 0) {
      const message = file.message || file.failureMessage || 'file-level failure';
      failures.push({ file: fileName, testName: '__FILE_FAILURE__', errorClass: errorClass(message), signature: normalizeErrorSignature(message) });
    }
  }
  return uniqueFailures(failures);
}

export const failureKey = (failure) => [failure.file, failure.testName, failure.errorClass, failure.signature].join('::');
export const targetKey = (failure) => [failure.file, failure.testName].join('::');
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

export function classifyFocusedEvidence(rawCandidateOnlyFailures, baseFocusedReports, candidateFocusedReports) {
  if (rawCandidateOnlyFailures.length > MAX_FOCUSED_FAILURES) {
    return { status: 'FAIL_CLOSED', diagnostic: `candidate-only failure count ${rawCandidateOnlyFailures.length} exceeds safe limit ${MAX_FOCUSED_FAILURES}`, classifications: [], newFailures: rawCandidateOnlyFailures };
  }
  if (rawCandidateOnlyFailures.length > 0 && (baseFocusedReports.length < rawCandidateOnlyFailures.length * 10 || candidateFocusedReports.length < rawCandidateOnlyFailures.length * 10)) {
    return {
      status: 'FAIL_CLOSED',
      diagnostic: `focused evidence requires at least 10 reports per target; found BASE=${baseFocusedReports.length}, CANDIDATE=${candidateFocusedReports.length}`,
      classifications: [],
      newFailures: rawCandidateOnlyFailures,
    };
  }
  const baseFailures = baseFocusedReports.flatMap((report) => normalizeFailures(report, 'BASE_FOCUSED'));
  const candidateFailures = candidateFocusedReports.flatMap((report) => normalizeFailures(report, 'CANDIDATE_FOCUSED'));
  const classifications = rawCandidateOnlyFailures.map((failure) => {
    const baseEvidence = baseFailures.filter((item) => failureKey(item) === failureKey(failure));
    const candidateEvidence = candidateFailures.filter((item) => failureKey(item) === failureKey(failure));
    return {
      ...failure,
      classification: baseEvidence.length > 0 ? 'PREEXISTING_FLAKY_BASELINE_FAILURE' : 'NEW_FAILURE',
      baseEvidenceCount: baseEvidence.length,
      candidateEvidenceCount: candidateEvidence.length,
      semanticSignatureMatch: baseEvidence.length > 0,
    };
  });
  return { status: 'OK', classifications, newFailures: classifications.filter((item) => item.classification === 'NEW_FAILURE') };
}

function readFocusedReports(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => /^focused-\d+(?:-\d+)?\.json$/.test(name))
    .sort()
    .map((name) => readJson(path.join(directory, name)));
}

function writeSummary(result, output) {
  const lines = [
    '# PR #127 global comparison', '',
    `- shared failures: ${result.sharedFailures.length}`,
    `- raw candidate-only failures: ${result.rawCandidateOnlyFailures.length}`,
    `- preexisting flaky baseline failures: ${result.preexistingFlakyFailures.length}`,
    `- new failures: ${result.newFailures.length}`,
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
  const focused = classifyFocusedEvidence(initial.rawCandidateOnlyFailures, readFocusedReports(baseFocused), readFocusedReports(candidateFocused));
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
