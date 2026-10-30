import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCanonicalLedger } from './verify-canonical-migration-ledger.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/pr352-migration-cli-isolation.yml', import.meta.url), 'utf8');
const harness = fs.readFileSync(new URL('./pr352-migration-cli-isolation.sh', import.meta.url), 'utf8');
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const branch = 'qa/pr352-cli279-pg176-isolation-r3-20261029';

function bashPath(value) {
  if (process.platform !== 'win32') return value;
  const match = path.resolve(value).match(/^([A-Za-z]):\\(.*)$/);
  return match ? `/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}` : value;
}

function testBashExecutable() {
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Git', 'bin', 'bash.exe'), 'bash']
    : ['bash'];
  return candidates.find((candidate) => candidate === 'bash' || fs.existsSync(candidate));
}

function runReportWriter(tempDir, options = {}) {
  const embedded = harness.match(/node - "\$RESULTS_JSON"[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/);
  assert.ok(embedded, 'write_results_json must contain a testable JSON serializer');
  const destination = path.join(tempDir, options.filename || 'results.json');
  const casesFile = destination + '.cases.ndjson';
  const cases = options.cases || Array.from({ length: 10 }, (_, index) => ({
    caseId: 'CLI-' + String(index + 1).padStart(2, '0'),
    status: 'PASS',
    summary: 'synthetic report-unit-test fixture; no PostgreSQL was run',
  }));
  fs.writeFileSync(casesFile, options.casesContent ?? cases.map((item) => JSON.stringify(item)).join('\n') + '\n');
  const sha = options.sha ?? 'a'.repeat(40);
  const result = spawnSync(process.execPath, ['-', destination, casesFile,
    options.cliVersion ?? '2.79.0', options.pgVersion ?? '170006',
    options.runStatus ?? '0', options.cleanupStatus ?? '0', options.failure ?? '',
    options.failedCase ?? 'CLI-10', options.createdDatabases ?? 'pr352_cli_match',
    options.leakedSessions ?? '0'], {
    input: embedded[1],
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_REPOSITORY: options.repository ?? 'fdxruli/Lanzo-POS',
      GITHUB_REF: options.ref ?? 'refs/heads/' + branch,
      GITHUB_SHA: sha,
      PR352_STARTED_AT: '2026-10-29T00:00:00Z',
    },
  });
  const report = fs.existsSync(destination) ? JSON.parse(fs.readFileSync(destination, 'utf8')) : null;
  return { result, report, destination, sha };
}

function runHarnessPreflight(databaseUrl, extraEnv = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr352-r4-preflight-'));
  const binDir = path.join(tempDir, 'bin');
  const reportPath = path.join(tempDir, 'results.json');
  const cliSentinel = path.join(tempDir, 'supabase-invoked');
  const psqlSentinel = path.join(tempDir, 'psql-invoked');
  fs.mkdirSync(binDir);
  const fakeSupabase = path.join(binDir, 'supabase');
  fs.writeFileSync(fakeSupabase, '#!/usr/bin/env bash\nprintf invoked > "$CLI_SENTINEL"\nexit 97\n', { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'psql'), '#!/usr/bin/env bash\nprintf invoked > "$PSQL_SENTINEL"\nexit 98\n', { mode: 0o755 });
  fs.writeFileSync(path.join(binDir, 'node'), '#!/usr/bin/env bash\nexit 0\n', { mode: 0o755 });

  const bash = testBashExecutable();
  const inheritedEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^PG/i.test(name) && !/^SUPABASE_(ACCESS_TOKEN|DB_PASSWORD|PROJECT_ID|PROJECT_REF|URL|DB_URL|SERVICE_ROLE_KEY|SECRET_KEY|ANON_KEY|PUBLISHABLE_KEY|JWT_SECRET)$/i.test(name)));
  const result = spawnSync(bash, ['scripts/supabase/pr352-migration-cli-isolation.sh'], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 15_000,
    env: {
      ...inheritedEnv,
      PATH: binDir + path.delimiter + (inheritedEnv.PATH || ''),
      DATABASE_URL: databaseUrl,
      PR352_RESULTS_JSON: bashPath(reportPath),
      CLI_SENTINEL: bashPath(cliSentinel),
      PSQL_SENTINEL: bashPath(psqlSentinel),
      ...extraEnv,
    },
  });
  return { tempDir, result, cliSentinel, psqlSentinel, reportPath };
}

test('workflow triggers only the exact QA branch push and checks repository/ref in-job', () => {
  assert.match(workflow, /on:\s*\n\s+push:\s*\n\s+branches:\s*\n\s+- 'qa\/pr352-cli279-pg176-isolation-r3-20261029'/);
  assert.doesNotMatch(workflow, /pull_request_target|pull_request:|workflow_dispatch|schedule:|workflow_call:/i);
  assert.match(workflow, /ACTUAL_REPOSITORY:\s*\$\{\{\s*github\.repository\s*\}\}/);
  assert.match(workflow, /ACTUAL_REF:\s*\$\{\{\s*github\.ref\s*\}\}/);
  assert.match(workflow, /test "\$ACTUAL_REPOSITORY" = 'fdxruli\/Lanzo-POS'/);
  assert.match(workflow, /test "\$ACTUAL_REF" = 'refs\/heads\//);
  assert.ok(workflow.includes('refs/heads/' + branch));
  const jobSetup = workflow.match(/jobs:[\s\S]*?steps:/)?.[0] || '';
  assert.doesNotMatch(jobSetup, /runner\.temp/, 'runner context is not available in job-level env');
  assert.match(workflow, /\$RUNNER_TEMP\/pr352-cli-isolation-results\.json/);
});

test('workflow has read-only repository permission and disposable pinned PostgreSQL/CLI', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents:\s*read/);
  assert.match(workflow, /image:\s*postgres:17\.6\b/);
  assert.match(workflow, /127\.0\.0\.1:5432:5432/);
  assert.match(workflow, /POSTGRES_DB:\s*pr352_cli_bootstrap/);
  assert.match(workflow, /DATABASE_URL:\s*postgresql:\/\/postgres:pr352_synthetic_only@127\.0\.0\.1:5432\/pr352_cli_bootstrap/);
  assert.match(workflow, /version:\s*2\.79\.0\b/);
  assert.match(workflow, /actions\/checkout@[0-9a-f]{40}/);
  assert.match(workflow, /supabase\/setup-cli@[0-9a-f]{40}/);
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/);
  assert.match(workflow, /pr352_synthetic_only/);
  assert.doesNotMatch(workflow, /secrets\.|environment:\s*production|supabase link|vercel deploy|migration repair|db reset/i);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.match(workflow, /pr352-cli-isolation-results\.json/);
  assert.match(workflow, /path:\s*\$\{\{\s*runner\.temp\s*\}\}\/pr352-cli-isolation-results\.json/);
});

test('the shell harness fails closed unless every SQL-capable CLI operation targets marked loopback PostgreSQL', () => {
  assert.match(harness, /EXPECTED_PG_VERSION_NUM='170006'/);
  assert.match(harness, /EXPECTED_CLI_VERSION='2\.79\.0'/);
  assert.match(harness, /LANZO_PR352_CLI_EPHEMERAL/);
  assert.match(harness, /127\\\.0\\\.0\\\.1:5432/);
  assert.match(harness, /every SQL-capable CLI operation requires an explicit local --db-url/);
  assert.match(harness, /verify_db "\$database"/);
  assert.match(harness, /timeout -k 5s 90s supabase/);
  const cliFunction = harness.slice(harness.indexOf('cli() {'), harness.indexOf('\n}\n\ncli_project'));
  assert.ok(cliFunction.indexOf('verify_db "$database"') < cliFunction.indexOf('PGSSLMODE=disable timeout'));
  assert.match(harness, /PGSSLMODE=disable timeout -k 5s 90s supabase/);
  assert.match(harness, /Set the mode only after the URL has been proven to target marked loopback PostgreSQL/);
  assert.doesNotMatch(harness, /export\s+PGSSLMODE/);
  assert.match(harness, /unexpected PostgreSQL environment variable is present/);
  assert.match(harness, /PG\*\)/);
  const startupOffset = harness.indexOf(': "${DATABASE_URL:');
  const pgGuardOffset = harness.indexOf('PG*) fail', startupOffset);
  assert.ok(pgGuardOffset < harness.indexOf('command -v psql', startupOffset));
  assert.ok(pgGuardOffset < harness.indexOf('command -v supabase', startupOffset));
  assert.match(harness, /--linked\|--linked=\*\|--project-ref\|--project-ref=\*/);
  assert.match(harness, /DROP DATABASE IF EXISTS/);
  assert.match(harness, /pg_stat_activity/);
  assert.match(harness, /CREATED_DATABASES\+=\("\$database"\)/);
  assert.match(harness, /record_case/);
  assert.doesNotMatch(harness, /supabase\.co|supabase link|migration repair|db reset/i);
  for (const variable of ['SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID', 'SUPABASE_PROJECT_REF', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.ok(harness.includes(variable), 'missing fail-closed environment check for ' + variable);
  }
});

test('an unauthorized database URL is rejected before any Supabase CLI process can run', () => {
  const attempt = runHarnessPreflight('postgresql://postgres:synthetic@198.51.100.7:5432/not_synthetic?sslmode=disable');
  try {
    assert.equal(attempt.result.status, 1, attempt.result.stderr || attempt.result.error?.message);
    assert.match(attempt.result.stderr, /refusing a non-loopback or non-synthetic database URL/);
    assert.equal(fs.existsSync(attempt.cliSentinel), false, 'Supabase CLI ran before destination validation');
    assert.equal(fs.existsSync(attempt.psqlSentinel), false, 'psql ran before destination validation');
    assert.match(attempt.result.stdout, /PR352_CLI_ISOLATION_CLEANUP_PASS/);
  } finally {
    fs.rmSync(attempt.tempDir, { recursive: true, force: true });
  }
});

test('inherited PostgreSQL connection variables are rejected before CLI or psql can run', () => {
  const attempt = runHarnessPreflight(
    'postgresql://postgres:pr352_synthetic_only@127.0.0.1:5432/pr352_cli_bootstrap?sslmode=disable',
    { PGHOSTADDR: '198.51.100.7' },
  );
  try {
    assert.equal(attempt.result.status, 1, attempt.result.stderr || attempt.result.error?.message);
    assert.match(attempt.result.stderr, /unexpected PostgreSQL environment variable is present: PGHOSTADDR/);
    assert.equal(fs.existsSync(attempt.cliSentinel), false, 'Supabase CLI ran with an inherited PGHOSTADDR override');
    assert.equal(fs.existsSync(attempt.psqlSentinel), false, 'psql ran with an inherited PGHOSTADDR override');
    assert.match(attempt.result.stdout, /PR352_CLI_ISOLATION_CLEANUP_PASS/);
  } finally {
    fs.rmSync(attempt.tempDir, { recursive: true, force: true });
  }
});

test('expected CLI failures do not pollute unexpected failure state', () => {
  const onError = harness.match(/on_error\(\) \{[\s\S]*?\n\}/)?.[0];
  const expectedFailure = harness.match(/expect_cli_failure\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(onError, 'unexpected-error handler must be available to the test');
  assert.ok(expectedFailure, 'expected-failure helper must be available to the test');
  const shell = [
    'set -Eeuo pipefail',
    "FAIL_MESSAGE=''",
    'ERR_TRAP_COUNT=0',
    "trap 'ERR_TRAP_COUNT=$((ERR_TRAP_COUNT + 1)); on_error \"$LINENO\" \"$?\"' ERR",
    onError,
    expectedFailure,
    'cli_project() ( false )',
    'expect_cli_failure /dev/null cli_project',
    '[[ "$LAST_FAILURE_STATUS" == 1 ]]',
    '[[ -z "$FAIL_MESSAGE" ]]',
    '[[ "$ERR_TRAP_COUNT" == 0 ]]',
  ].join('\n');
  const result = spawnSync(testBashExecutable(), ['-c', shell], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /EXPECTED_FAILURE: null exit=1/);
});

test('unexpected errors trip the ERR handler, preserve a diagnostic, and terminate nonzero', () => {
  const onError = harness.match(/on_error\(\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(onError, 'unexpected-error handler must be available to the test');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr352-r4-err-trap-'));
  try {
    const diagnosticPath = path.join(tempDir, 'diagnostic.txt');
    const shell = [
      'set -Eeuo pipefail',
      "FAIL_MESSAGE=''",
      "trap 'on_error \"$LINENO\" \"$?\"' ERR",
      `trap 'printf "%s" "$FAIL_MESSAGE" > "${bashPath(diagnosticPath)}"' EXIT`,
      onError,
      'false',
    ].join('\n');
    const result = spawnSync(testBashExecutable(), ['-c', shell], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stderr || result.error?.message);
    const diagnostic = fs.readFileSync(diagnosticPath, 'utf8');
    assert.match(diagnostic, /command failed at line \d+ \(exit 1\)/);
    const report = runReportWriter(tempDir, { filename: 'unexpected-error.json', runStatus: '1', failure: diagnostic });
    assert.equal(report.result.status, 1);
    assert.equal(report.report.finalStatus, 'FAIL');
    assert.match(report.report.failure, /command failed at line \d+ \(exit 1\)/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('the matrix records every case and verifies rejected SQL caused no object or ledger change', () => {
  for (let caseNumber = 1; caseNumber <= 10; caseNumber += 1) {
    const padded = String(caseNumber).padStart(2, '0');
    const id = String(caseNumber).padStart(2, '0');
    assert.match(harness, new RegExp('# Case ' + caseNumber + ':'));
    assert.match(harness, new RegExp('CASE_' + padded + '_PASS:'));
    assert.match(harness, new RegExp("record_case 'CLI-" + id + "'"));
  }
  assert.match(harness, /migration fetch/);
  assert.match(harness, /db push --dry-run/);
  assert.match(harness, /SQLSTATE 22012/);
  assert.match(harness, /assert_remote_versions/);
  assert.match(harness, /to_regclass\('public\.pr352_remote_only'\) IS NULL/);
  assert.match(harness, /to_regclass\('public\.pr352_v2_must_rollback'\) IS NULL/);
  assert.match(harness, /to_regclass\('public\.pr352_v2_probe'\) IS NOT NULL/);
});

test('canonical ledger rejects an older pending file before any CLI phase is authorized', () => {
  assert.throws(() => assertCanonicalLedger({
    local: ['20000101000000', '20261025000000', '20261027000000'],
    remote: ['20000101000000', '20261027000000'],
    expected: ['20261025000000'],
  }), /pending versions must follow the latest applied remote version/);
});

test('sanitized JSON result builder keeps operation names, exit codes, and migration-state evidence aligned', () => {
  const embedded = harness.match(/node - "\$case_id"[\s\S]*?<<'NODE' >> "\$RESULTS_NDJSON"\n([\s\S]*?)\nNODE/);
  assert.ok(embedded, 'record_case must contain a testable JSON result builder');
  const scenarios = [
    ['CLI-01', '0,0', '0'], ['CLI-02', '1,0', '1'], ['CLI-03', '1,0', '1'],
    ['CLI-04', '0,0,0', '0'], ['CLI-05', '0,0,0,0', '0'], ['CLI-06', '0,0,0', '0,1'],
    ['CLI-07', '0,0', '1'], ['CLI-08', '0,0', '0,1'], ['CLI-09', '0,0,0,1', ''],
    ['CLI-10', '0,0,0', '0'],
  ];
  for (const [caseId, cliCodes, guardCodes] of scenarios) {
    const result = spawnSync(process.execPath, ['-', caseId, 'synthetic evidence', cliCodes, guardCodes, '', '20000101000000', '', ''], {
      input: embedded[1],
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, caseId + ' result builder rejected its operation map: ' + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.status, 'PASS');
    assert.deepEqual(report.cliOperations.map((operation) => operation.exitCode), cliCodes.split(',').map(Number));
    assert.deepEqual(report.guardChecks.map((check) => check.exitCode), guardCodes ? guardCodes.split(',').map(Number) : []);
    assert.equal(report.ledgerState, '20000101000000');
  }
});

test('final JSON writer rejects contradictory or incomplete evidence and preserves a coherent SHA', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr352-r4-report-'));
  try {
    const valid = runReportWriter(tempDir);
    assert.equal(valid.result.status, 0, valid.result.stderr);
    const report = valid.report;
    assert.equal(report.finalStatus, 'PASS');
    assert.equal(report.failure, null);
    assert.equal(report.repository, 'fdxruli/Lanzo-POS');
    assert.equal(report.ref, 'refs/heads/' + branch);
    assert.equal(report.commit, valid.sha);
    assert.equal(report.cliVersion, '2.79.0');
    assert.equal(report.postgresServerVersionNum, '170006');
    assert.equal(report.cases.length, 10);
    assert.deepEqual(report.cases.map((item) => item.caseId), Array.from({ length: 10 }, (_, index) => `CLI-${String(index + 1).padStart(2, '0')}`));
    assert.ok(report.cases.every((item) => item.status === 'PASS'));
    assert.deepEqual(report.cleanup.createdSyntheticDatabases, ['pr352_cli_match']);
    assert.equal(report.cleanup.status, 'PASS');
    assert.equal(report.cleanup.leakedSessionsAfterCleanup, 0);

    const duplicatedCases = report.cases.map((item, index) => index === 8 ? { ...item, caseId: 'CLI-10' } : item);
    const invalidReports = [
      ['unexpected diagnostic', { failure: 'command failed at line 283 (exit 1)' }, /command failed at line 283/],
      ['missing case', { cases: report.cases.slice(0, 9) }, /expected 10 case records/],
      ['duplicate case', { cases: duplicatedCases }, /case IDs are duplicated/],
      ['non-passing case', { cases: report.cases.map((item, index) => index === 4 ? { ...item, status: 'FAIL' } : item) }, /one or more cases did not pass/],
      ['wrong CLI version', { cliVersion: '2.80.0' }, /expected Supabase CLI 2.79.0/],
      ['wrong PostgreSQL version', { pgVersion: '170017' }, /expected PostgreSQL server 170006/],
      ['cleanup failure', { cleanupStatus: '1' }, /cleanup did not pass/],
      ['leaked session', { leakedSessions: '1' }, /cleanup did not pass/],
      ['missing SHA', { sha: 'bad-sha' }, /workflow SHA is missing or malformed/],
      ['wrong repository', { repository: 'another/repo' }, /workflow repository does not match/],
      ['wrong ref', { ref: 'refs/heads/main' }, /workflow ref does not match/],
      ['nonzero harness status', { runStatus: '1' }, /harness exited with status 1/],
      ['malformed case JSON', { casesContent: '{bad json\n' }, /case result file is invalid/],
    ];
    for (const [name, options, diagnostic] of invalidReports) {
      const attempt = runReportWriter(tempDir, { ...options, filename: `${name.replaceAll(' ', '-')}.json` });
      assert.equal(attempt.result.status, 1, `${name} should produce a failing process status`);
      assert.equal(attempt.report.finalStatus, 'FAIL', `${name} must never claim PASS`);
      assert.notEqual(attempt.report.failure, null, `${name} must include a diagnostic`);
      assert.match(attempt.report.failure, diagnostic, name);
      assert.equal(JSON.parse(fs.readFileSync(attempt.destination, 'utf8')).commit, attempt.sha);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('workflow rejects a missing, malformed, contradictory, or wrong-SHA result artifact', () => {
  assert.match(workflow, /test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  const verifier = workflow.match(/node - "\$RUNNER_TEMP\/pr352-cli-isolation-results\.json" "\$GITHUB_REPOSITORY" "\$GITHUB_REF" "\$GITHUB_SHA" <<'NODE'\r?\n([\s\S]*?)\r?\n\s+NODE/);
  assert.ok(verifier, 'workflow must validate the uploaded report for the exact event context');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr352-r4-workflow-report-'));
  try {
    const reportPath = path.join(tempDir, 'results.json');
    const expectedSha = 'b'.repeat(40);
    const report = runReportWriter(tempDir, { filename: 'workflow-results.json', sha: expectedSha }).report;
    fs.writeFileSync(reportPath, JSON.stringify(report));
    const invokeVerifier = (sha) => spawnSync(process.execPath, ['-', reportPath, 'fdxruli/Lanzo-POS', 'refs/heads/' + branch, sha], {
      input: verifier[1],
      encoding: 'utf8',
    });
    assert.equal(invokeVerifier(expectedSha).status, 0, 'matching workflow SHA should pass');
    assert.notEqual(invokeVerifier('c'.repeat(40)).status, 0, 'a different workflow SHA must fail');
    fs.writeFileSync(reportPath, '{malformed');
    assert.notEqual(invokeVerifier(expectedSha).status, 0, 'malformed JSON must fail');
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, failure: 'unexpected error' }));
    assert.notEqual(invokeVerifier(expectedSha).status, 0, 'a contradictory report must fail');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
