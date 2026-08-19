import fs from 'node:fs';
import path from 'node:path';

const [baseDir, candidateDir, markdownPath = 'full-suite-differential.md', jsonPath = 'full-suite-differential.json'] = process.argv.slice(2);

if (!baseDir || !candidateDir) {
  console.error('Usage: node scripts/compare-shared-terminal-full-suite.mjs <base-dir> <candidate-dir> [matrix.md] [summary.json]');
  process.exit(2);
}

const findReports = (dir, label) => {
  if (!fs.existsSync(dir)) throw new Error(`${label} report directory missing: ${dir}`);
  const paths = fs.readdirSync(dir)
    .filter((name) => /^full-suite-\d+\.json$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
  if (paths.length < 2) throw new Error(`${label} requires at least two full-suite repetitions; found ${paths.length}`);
  return paths;
};

const findFocusedReports = (dir, label) => {
  if (!fs.existsSync(dir)) throw new Error(`${label} report directory missing: ${dir}`);
  return fs.readdirSync(dir)
    .filter((name) => /^public-store-(?:bfcache|site-version)-\d+\.json$/.test(name))
    .sort()
    .map((name) => path.join(dir, name));
};

const readReport = (reportPath, label) => {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (!Array.isArray(report.testResults)) {
    throw new Error(`${label} report does not contain Vitest/Jest-compatible testResults: ${reportPath}`);
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
  return [...(assertion.ancestorTitles || []), assertion.title].filter(Boolean).join(' > ') || '<unnamed-test>';
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

const escapeCell = (value) => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', '<br>');
const keyOf = (failure) => `${failure.id}\u0000${failure.error}`;

const basePaths = findReports(baseDir, 'BASE');
const candidatePaths = findReports(candidateDir, 'CANDIDATE');
const baseFocusedPaths = findFocusedReports(baseDir, 'BASE');
const candidateFocusedPaths = findFocusedReports(candidateDir, 'CANDIDATE');
if (baseFocusedPaths.length !== candidateFocusedPaths.length) {
  throw new Error(`BASE/CANDIDATE focused BFCache evidence count differs: ${baseFocusedPaths.length} vs ${candidateFocusedPaths.length}`);
}
if (baseFocusedPaths.length > 0 && baseFocusedPaths.length < 10) {
  throw new Error(`Focused BFCache evidence requires at least 10 repetitions when present; found ${baseFocusedPaths.length}`);
}
const baseReports = basePaths.map((reportPath, index) => readReport(reportPath, `BASE#${index + 1}`));
const candidateReports = candidatePaths.map((reportPath, index) => readReport(reportPath, `CANDIDATE#${index + 1}`));
const baseFocusedReports = baseFocusedPaths.map((reportPath, index) => readReport(reportPath, `BASE focused PublicStore#${index + 1}`));
const candidateFocusedReports = candidateFocusedPaths.map((reportPath, index) => readReport(reportPath, `CANDIDATE focused PublicStore#${index + 1}`));
const baseFailuresByRun = baseReports.map(collectFailures);
const candidateFailuresByRun = candidateReports.map(collectFailures);
const baseFocusedFailuresByRun = baseFocusedReports.map(collectFailures);
const candidateFocusedFailuresByRun = candidateFocusedReports.map(collectFailures);

const observationMap = (runs) => {
  const byKey = new Map();
  const errorsById = new Map();
  runs.forEach((failures, runIndex) => {
    for (const failure of failures) {
      const key = keyOf(failure);
      const entry = byKey.get(key) || { ...failure, runs: [] };
      if (!entry.runs.includes(runIndex + 1)) entry.runs.push(runIndex + 1);
      byKey.set(key, entry);
      const errors = errorsById.get(failure.id) || new Set();
      errors.add(failure.error);
      errorsById.set(failure.id, errors);
    }
  });
  return { byKey, errorsById };
};

const baseObs = observationMap(baseFailuresByRun);
const candidateObs = observationMap(candidateFailuresByRun);
const baseFocusedObs = observationMap(baseFocusedFailuresByRun);
const candidateFocusedObs = observationMap(candidateFocusedFailuresByRun);

const matrix = [...candidateObs.byKey.values()].map((candidateFailure) => {
  const baseExact = baseObs.byKey.get(keyOf(candidateFailure));
  if (baseExact) {
    const stableInBase = baseExact.runs.length === baseReports.length;
    const stableInCandidate = candidateFailure.runs.length === candidateReports.length;
    const classification = stableInBase && stableInCandidate
      ? 'PREEXISTING_BASELINE_FAILURE'
      : 'PREEXISTING_FLAKY_BASELINE_FAILURE';
    return {
      ...candidateFailure,
      baseRuns: baseExact.runs,
      candidateRuns: candidateFailure.runs,
      base: `FAIL in repetition(s) ${baseExact.runs.join(',')}: ${baseExact.error}`,
      candidate: `FAIL in repetition(s) ${candidateFailure.runs.join(',')}: ${candidateFailure.error}`,
      classification
    };
  }

  const baseFocusedExact = baseFocusedObs.byKey.get(keyOf(candidateFailure));
  if (baseFocusedExact) {
    const candidateFocusedExact = candidateFocusedObs.byKey.get(keyOf(candidateFailure));
    return {
      ...candidateFailure,
      baseRuns: [],
      baseFocusedRuns: baseFocusedExact.runs,
      candidateRuns: candidateFailure.runs,
      candidateFocusedRuns: candidateFocusedExact?.runs || [],
      base: `PASS in all BASE full-suite repetitions; FAIL in focused BASE repetition(s) ${baseFocusedExact.runs.join(',')}: ${baseFocusedExact.error}`,
      candidate: `FAIL in full-suite repetition(s) ${candidateFailure.runs.join(',')}: ${candidateFailure.error}${candidateFocusedExact ? `; focused repetition(s) ${candidateFocusedExact.runs.join(',')}` : ''}`,
      classification: 'PREEXISTING_FLAKY_BASELINE_FAILURE'
    };
  }

  const baseErrors = baseObs.errorsById.get(candidateFailure.id);
  if (baseErrors?.size) {
    return {
      ...candidateFailure,
      baseRuns: [],
      candidateRuns: candidateFailure.runs,
      base: `FAIL with different normalized error(s): ${[...baseErrors].join(' || ')}`,
      candidate: `FAIL in repetition(s) ${candidateFailure.runs.join(',')}: ${candidateFailure.error}`,
      classification: 'POSSIBLE_PR_REGRESSION'
    };
  }

  return {
    ...candidateFailure,
    baseRuns: [],
    candidateRuns: candidateFailure.runs,
    base: 'PASS in all BASE repetitions',
    candidate: `FAIL in repetition(s) ${candidateFailure.runs.join(',')}: ${candidateFailure.error}`,
    classification: 'PR_REGRESSION'
  };
});

const candidateKeys = new Set(candidateObs.byKey.keys());
const incidentalImprovements = [...baseObs.byKey.values()]
  .filter((failure) => !candidateKeys.has(keyOf(failure)))
  .map((failure) => ({ ...failure, classification: 'INCIDENTAL_OR_BASELINE_FLAKE' }));

const regressionClasses = new Set(['PR_REGRESSION', 'POSSIBLE_PR_REGRESSION']);
const regressions = matrix.filter(({ classification }) => regressionClasses.has(classification));
const stablePreexisting = matrix.filter(({ classification }) => classification === 'PREEXISTING_BASELINE_FAILURE');
const flakyPreexisting = matrix.filter(({ classification }) => classification === 'PREEXISTING_FLAKY_BASELINE_FAILURE');
const baseRunCounts = baseReports.map(counts);
const candidateRunCounts = candidateReports.map(counts);
const baseFocusedRunCounts = baseFocusedReports.map(counts);
const candidateFocusedRunCounts = candidateFocusedReports.map(counts);

const summary = {
  base: baseRunCounts[0],
  candidate: candidateRunCounts[0],
  baseRuns: baseRunCounts,
  candidateRuns: candidateRunCounts,
  baseFocusedRuns: baseFocusedRunCounts,
  candidateFocusedRuns: candidateFocusedRunCounts,
  baseUniqueFailureObservationCount: baseObs.byKey.size,
  candidateUniqueFailureObservationCount: candidateObs.byKey.size,
  newRegressionCount: regressions.length,
  stablePreexistingCandidateFailureCount: stablePreexisting.length,
  flakyPreexistingCandidateFailureCount: flakyPreexisting.length,
  preexistingCandidateFailureCount: stablePreexisting.length + flakyPreexisting.length,
  incidentalImprovementCount: incidentalImprovements.length,
  matrix,
  incidentalImprovements
};

const runLine = (label, values) => values.map((value, index) => (
  `- ${label} repetition ${index + 1}: ${value.passed} passed / ${value.failed} failed / ${value.skipped} skipped / ${value.total} total`
));

const markdown = [
  '# Shared Terminal repeated full-suite differential',
  '',
  ...runLine('BASE', baseRunCounts),
  ...runLine('CANDIDATE', candidateRunCounts),
  ...(baseFocusedRunCounts.length
    ? [
        '',
        ...runLine('BASE focused PublicStore', baseFocusedRunCounts),
        ...runLine('CANDIDATE focused PublicStore', candidateFocusedRunCounts)
      ]
    : []),
  `- NEW/CHANGED REGRESSIONS: ${summary.newRegressionCount}`,
  `- STABLE PREEXISTING CANDIDATE FAILURES: ${summary.stablePreexistingCandidateFailureCount}`,
  `- PREEXISTING FLAKY CANDIDATE FAILURES: ${summary.flakyPreexistingCandidateFailureCount}`,
  `- INCIDENTAL/BASELINE-FLAKE OBSERVATIONS: ${summary.incidentalImprovementCount}`,
  '',
  '## Candidate failure matrix',
  '',
  '| Test / file | BASE repetitions | CANDIDATE repetitions | Classification |',
  '|---|---|---|---|',
  ...matrix.map((row) => `| ${escapeCell(row.id)} | ${escapeCell(row.base)} | ${escapeCell(row.candidate)} | ${row.classification} |`),
  '',
  '## BASE failure observations absent from all candidate repetitions',
  '',
  ...(incidentalImprovements.length
    ? incidentalImprovements.map((row) => `- ${row.id}: ${row.error} (${row.classification}; BASE repetitions ${row.runs.join(',')})`)
    : ['- None']),
  ''
].join('\n');

fs.writeFileSync(markdownPath, markdown);
fs.writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(markdown);

if (regressions.length > 0) {
  console.error(`Differential regression gate failed: ${regressions.length} candidate failure observation(s) were not reproduced with the same normalized error in any BASE repetition.`);
  process.exit(1);
}

console.log('Differential regression gate passed: every candidate failure observation is reproduced with the same normalized error in at least one exact BASE repetition.');
