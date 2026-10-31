import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
const outputRoot = resolve(process.env.PR378_DIAGNOSTIC_ARTIFACTS || join(workspace, 'pr378-diagnostic-artifacts'));
const scratchRoot = resolve(process.env.RUNNER_TEMP || join(workspace, '.pr378-diagnostic-tmp'));
const sourceTest = 'src/pages/__tests__/PublicStoreCheckout.test.jsx';
const targetName = 'closes editing and recoverable checkout states without clearing the cart';
const related = [
  sourceTest,
  'src/pages/__tests__/PublicStorePage.test.jsx',
  'src/router/__tests__/preparePublicStoreDocument.resume.test.js',
  'src/components/ecommerce/public/__tests__/PublicCheckoutDialog.test.jsx',
];
const variants = [
  { name: 'individual', config: 'vite.pr378-diagnostic.config.mjs', args: [sourceTest, '-t', targetName] },
  { name: 'file', config: 'vite.pr378-diagnostic.config.mjs', args: [sourceTest] },
  { name: 'related', config: 'vite.pr378-diagnostic.config.mjs', args: related },
  { name: 'global', config: 'vite.pr378-diagnostic.config.mjs', args: [] },
];

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

const SAFE_TEST_ENV = [
  'PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'TZ', 'CI',
  'GITHUB_ACTIONS', 'GITHUB_WORKSPACE', 'GITHUB_REPOSITORY', 'GITHUB_RUN_ID',
  'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_REF', 'GITHUB_REF_NAME',
  'GITHUB_RUNNER_OS', 'GITHUB_RUNNER_ARCH', 'RUNNER_TEMP', 'RUNNER_TOOL_CACHE',
  'PR378_BASE_SHA', 'PR378_EXPECTED_HEAD_SHA', 'PR378_SOURCE_TEST_SHA256',
  'PR378_MAIN_LOCK_SHA256', 'PR378_CANDIDATE_LOCK_SHA256',
  'PR378_NODE_VERSION', 'PR378_NPM_VERSION',
];

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch { return null; }
}

function safeEvent(event) {
  if (event.event !== 'test-run-end') return event;
  const errors = event.unhandledErrors || [];
  const classes = [...new Set(errors.map(error => error.class || error.name || 'Error'))];
  return { ...event, unhandledErrorCount: errors.length, unhandledErrorClasses: classes };
}

function sanitizeJsonl(inputPath, outputPath) {
  let raw = '';
  try { raw = readFileSync(inputPath, 'utf8'); } catch {}
  const output = [];
  let malformedLines = 0;
  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    try { output.push(safeEvent(JSON.parse(line))); }
    catch { malformedLines += 1; }
  }
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output.map(event => JSON.stringify(event)).join('\n') + (output.length ? '\n' : ''));
  return malformedLines;
}

function summarizeReport(report, sideRoot) {
  if (!report) return null;
  const assertions = (report.testResults || []).flatMap(file => file.assertionResults || []);
  const target = assertions.find(assertion => {
    const fullName = [...(assertion.ancestorTitles || []), assertion.title || ''].join(' > ');
    return fullName.includes(targetName);
  });
  const failedTests = (report.testResults || []).flatMap(file =>
    (file.assertionResults || [])
      .filter(assertion => assertion.status === 'failed')
      .map(assertion => ({
        file: relative(sideRoot, file.name || '').replaceAll('\\', '/'),
        testName: [...(assertion.ancestorTitles || []), assertion.title || ''].join(' > '),
      }))
  ).sort((a, b) => (a.file + a.testName).localeCompare(b.file + b.testName));
  return {
    totalTestSuites: report.numTotalTestSuites ?? null,
    passedTestSuites: report.numPassedTestSuites ?? null,
    failedTestSuites: report.numFailedTestSuites ?? null,
    pendingTestSuites: report.numPendingTestSuites ?? null,
    totalTests: report.numTotalTests ?? null,
    passedTests: report.numPassedTests ?? null,
    failedTests: report.numFailedTests ?? null,
    pendingTests: report.numPendingTests ?? null,
    failedTestsDetailed: failedTests,
    target: target ? {
      state: target.status,
      durationMs: target.duration ?? null,
      assertionCount: target.assertionResults?.length ?? null,
    } : null,
  };
}

function walkFiles(root, prefix = '') {
  const found = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if (entry.isDirectory()) found.push(...walkFiles(full, name));
    else found.push(name);
  }
  return found.sort();
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });
const runs = [];
for (const side of ['candidate', 'main']) {
  const sideRoot = resolve(workspace, side);
  for (const variant of variants) {
    const temp = join(scratchRoot, side, variant.name);
    const artifact = join(outputRoot, side, variant.name);
    rmSync(temp, { recursive: true, force: true });
    mkdirSync(temp, { recursive: true });
    mkdirSync(artifact, { recursive: true });
    const jsonPath = join(temp, 'full-vitest.json');
    const workerPath = join(temp, 'test-worker.jsonl');
    const reporterPath = join(temp, 'vitest-reporter.jsonl');
    const logPath = join(temp, 'vitest.stdout');
    const env = Object.fromEntries(SAFE_TEST_ENV
      .filter(name => typeof process.env[name] === 'string')
      .map(name => [name, process.env[name]]));
    Object.assign(env, {
      PR378_DIAG_ENABLED: '1',
      PR378_DIAGNOSTIC_EVENTS_PATH: workerPath,
      PR378_DIAGNOSTIC_REPORT_PATH: reporterPath,
      PR378_DIAGNOSTIC_JSON_PATH: jsonPath,
    });
    const args = [
      'run', ...variant.args,
      '--config', variant.config,
      '--maxWorkers=4',
    ];
    const started = process.hrtime.bigint();
    const child = spawnSync(process.execPath, [join(sideRoot, 'node_modules/vitest/vitest.mjs'), ...args], {
      cwd: sideRoot,
      env,
      encoding: 'utf8',
      maxBuffer: 128 * 1024 * 1024,
      timeout: 25 * 60 * 1000,
    });
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    const stdout = (child.stdout || '') + (child.stderr || '');
    writeFileSync(logPath, stdout);
    const nativeExitCode = child.status == null ? 1 : child.status;
    writeFileSync(join(artifact, 'native-exit.txt'), String(nativeExitCode) + '\n');
    const malformedWorkerLines = sanitizeJsonl(workerPath, join(artifact, 'test-worker.jsonl'));
    const malformedReporterLines = sanitizeJsonl(reporterPath, join(artifact, 'vitest-reporter.jsonl'));
    const rawReport = readJson(jsonPath);
    const reportSummary = summarizeReport(rawReport, sideRoot);
    const reporterEvents = (() => {
      try { return readFileSync(reporterPath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
      catch { return []; }
    })();
    const targetReporter = reporterEvents.find(event => event.event === 'test-case-result');
    const run = {
      side,
      variant: variant.name,
      command: ['vitest', ...args],
      nativeExitCode,
      signal: child.signal || null,
      timedOut: child.error?.code === 'ETIMEDOUT',
      malformedWorkerLines,
      malformedReporterLines,
      spawnError: child.error?.message || null,
      elapsedMs,
      stdoutBytes: Buffer.byteLength(stdout),
      stdoutSha256: sha256(stdout),
      fullJsonBytes: statSync(jsonPath, { throwIfNoEntry: false })?.size ?? null,
      fullJsonSha256: rawReport ? sha256(readFileSync(jsonPath)) : null,
      report: reportSummary,
      reporterTargetState: targetReporter?.state || null,
      targetErrorClasses: targetReporter?.errors?.map(error => error.class) || [],
    };
    writeJson(join(artifact, 'result-summary.json'), run);
    runs.push(run);
    process.stdout.write(JSON.stringify({ side, variant: variant.name, nativeExitCode, report: reportSummary }) + '\n');
  }
}

const summary = {
  diagnosticSha: process.env.GITHUB_SHA || null,
  expectedPrHeadSha: process.env.PR378_EXPECTED_HEAD_SHA || null,
  expectedMainSha: process.env.PR378_BASE_SHA || null,
  node: process.version,
  npm: process.env.PR378_NPM_VERSION || null,
  maxWorkers: 4,
  testTimeoutMs: 15000,
  hookTimeoutMs: 10000,
  rawConsoleAndGlobalJsonPolicy: 'full outputs remain in the ephemeral runner temp directory; only target diagnostics and summaries are uploaded',
  runs,
};
writeJson(join(outputRoot, 'summary.json'), summary);

const checksumLines = [];
for (const name of walkFiles(outputRoot)) {
  if (name === 'SHA256SUMS') continue;
  const bytes = readFileSync(join(outputRoot, name));
  checksumLines.push(sha256(bytes) + '  ' + name);
}
writeFileSync(join(outputRoot, 'SHA256SUMS'), checksumLines.join('\n') + '\n');
process.stdout.write('PR378_DIAGNOSTIC_SUMMARY=' + JSON.stringify(summary.runs.map(run => ({
  side: run.side,
  variant: run.variant,
  nativeExitCode: run.nativeExitCode,
  failedTests: run.report?.failedTests,
  targetState: run.report?.target?.state || run.reporterTargetState,
}))) + '\n');
