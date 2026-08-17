import fs from 'node:fs';
import path from 'node:path';

const [basePath, candidatePath, markdownPath = 'full-suite-differential.md', jsonPath = 'full-suite-differential.json'] = process.argv.slice(2);

if (!basePath || !candidatePath) {
  console.error('Usage: node scripts/compare-shared-terminal-full-suite.mjs <base.json> <candidate.json> [matrix.md] [summary.json]');
  process.exit(2);
}

const readReport = (reportPath, label) => {
  if (!fs.existsSync(reportPath)) {
    throw new Error(`${label} report missing: ${reportPath}`);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report.testResults)) {
    throw new Error(`${label} report does not contain Vitest/Jest-compatible testResults`);
  }
  return report;
};

const normalizeFile = (value = '') => {
  const normalized = String(value).replaceAll('\\', '/');
  const markers = ['/src/', '/scripts/', '/store/', '/tests/'];
  for (const marker of markers) {
    const index = normalized.lastIndexOf(marker);
    if (index >= 0) return normalized.slice(index + 1);
  }
  return path.basename(normalized) || '<unknown-file>';
};

const normalizeFailure = (value = '') => {
  const withoutAnsi = String(value).replace(/\u001b\[[0-9;]*m/g, '');
  const lines = withoutAnsi
    .split('\n')
    .map((line) => line.replace(/\/home\/runner\/work\/[^/]+\/[^/]+\//g, ''))
    .map((line) => line.replace(/\/tmp\/lanzo-pos-cutover-1-1-[A-Za-z0-9_-]+/g, '/tmp/lanzo-pos-cutover-1-1-<tmp>'))
    .map((line) => line.replace(/([A-Za-z0-9_./-]+\.(?:js|jsx|mjs|cjs|ts|tsx)):\d+:\d+/g, '$1:<line>:<col>'))
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '')
    .filter((line) => !/^\s*at\s/.test(line))
    .filter((line) => !/^\s*[❯>]\s/.test(line));
  return lines.slice(0, 12).join('\n').trim().slice(0, 2000);
};

const assertionName = (assertion) => {
  if (assertion.fullName) return assertion.fullName;
  const parts = [...(assertion.ancestorTitles || []), assertion.title].filter(Boolean);
  return parts.join(' > ') || '<unnamed-test>';
};

const collectFailures = (report) => {
  const failures = [];

  for (const fileResult of report.testResults) {
    const file = normalizeFile(fileResult.name || fileResult.testFilePath || '');
    const assertions = Array.isArray(fileResult.assertionResults) ? fileResult.assertionResults : [];
    const failedAssertions = assertions.filter((assertion) => assertion.status === 'failed');

    for (const assertion of failedAssertions) {
      const rawFailure = Array.isArray(assertion.failureMessages)
        ? assertion.failureMessages.join('\n')
        : assertion.failureMessage || assertion.message || '';
      failures.push({
        id: `${file} > ${assertionName(assertion)}`,
        file,
        test: assertionName(assertion),
        error: normalizeFailure(rawFailure)
      });
    }

    if (fileResult.status === 'failed' && failedAssertions.length === 0) {
      failures.push({
        id: `${file} > [file-level failure]`,
        file,
        test: '[file-level failure]',
        error: normalizeFailure(fileResult.message || fileResult.failureMessage || '')
      });
    }
  }

  return failures;
};

const counts = (report) => ({
  passed: Number(report.numPassedTests ?? 0),
  failed: Number(report.numFailedTests ?? 0),
  skipped: Number(report.numPendingTests ?? report.numTodoTests ?? 0),
  total: Number(report.numTotalTests ?? 0),
  suitesPassed: Number(report.numPassedTestSuites ?? 0),
  suitesFailed: Number(report.numFailedTestSuites ?? 0),
  suitesTotal: Number(report.numTotalTestSuites ?? 0)
});

const escapeCell = (value) => String(value ?? '')
  .replaceAll('|', '\\|')
  .replaceAll('\n', '<br>');

const base = readReport(basePath, 'BASE');
const candidate = readReport(candidatePath, 'CANDIDATE');
const baseFailures = collectFailures(base);
const candidateFailures = collectFailures(candidate);
const baseById = new Map(baseFailures.map((failure) => [failure.id, failure]));
const candidateById = new Map(candidateFailures.map((failure) => [failure.id, failure]));

const matrix = candidateFailures.map((candidateFailure) => {
  const baseFailure = baseById.get(candidateFailure.id);
  if (!baseFailure) {
    return {
      ...candidateFailure,
      base: 'PASS',
      candidate: `FAIL: ${candidateFailure.error}`,
      classification: 'PR_REGRESSION'
    };
  }
  if (baseFailure.error !== candidateFailure.error) {
    return {
      ...candidateFailure,
      base: `FAIL: ${baseFailure.error}`,
      candidate: `FAIL: ${candidateFailure.error}`,
      classification: 'POSSIBLE_PR_REGRESSION'
    };
  }
  return {
    ...candidateFailure,
    base: `FAIL: ${baseFailure.error}`,
    candidate: `FAIL: ${candidateFailure.error}`,
    classification: 'PREEXISTING_BASELINE_FAILURE'
  };
});

const incidentalImprovements = baseFailures
  .filter((failure) => !candidateById.has(failure.id))
  .map((failure) => ({ ...failure, classification: 'INCIDENTAL_IMPROVEMENT' }));

const regressions = matrix.filter(({ classification }) => classification !== 'PREEXISTING_BASELINE_FAILURE');
const summary = {
  base: counts(base),
  candidate: counts(candidate),
  baseFailureCount: baseFailures.length,
  candidateFailureCount: candidateFailures.length,
  newRegressionCount: regressions.length,
  preexistingCandidateFailureCount: matrix.length - regressions.length,
  incidentalImprovementCount: incidentalImprovements.length,
  matrix,
  incidentalImprovements
};

const markdown = [
  '# Shared Terminal full-suite differential',
  '',
  `- BASE: ${summary.base.passed} passed / ${summary.base.failed} failed / ${summary.base.skipped} skipped / ${summary.base.total} total`,
  `- CANDIDATE: ${summary.candidate.passed} passed / ${summary.candidate.failed} failed / ${summary.candidate.skipped} skipped / ${summary.candidate.total} total`,
  `- NEW/CHANGED REGRESSIONS: ${summary.newRegressionCount}`,
  `- PREEXISTING CANDIDATE FAILURES: ${summary.preexistingCandidateFailureCount}`,
  `- INCIDENTAL IMPROVEMENTS: ${summary.incidentalImprovementCount}`,
  '',
  '## Candidate failure matrix',
  '',
  '| Test / file | BASE | CANDIDATE | Classification |',
  '|---|---|---|---|',
  ...matrix.map((row) => `| ${escapeCell(row.id)} | ${escapeCell(row.base)} | ${escapeCell(row.candidate)} | ${row.classification} |`),
  '',
  '## Baseline failures absent from candidate',
  '',
  ...(incidentalImprovements.length
    ? incidentalImprovements.map((row) => `- ${row.id}: INCIDENTAL_IMPROVEMENT`)
    : ['- None']),
  ''
].join('\n');

fs.writeFileSync(markdownPath, markdown);
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(markdown);

if (regressions.length > 0) {
  console.error(`Differential regression gate failed: ${regressions.length} candidate failure(s) are new or changed versus base.`);
  process.exit(1);
}

console.log('Differential regression gate passed: candidate introduces zero new or changed full-suite failures.');
