import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertCanonicalLedger } from './verify-canonical-migration-ledger.mjs';

const workflow = fs.readFileSync(new URL('../../.github/workflows/pr352-migration-cli-isolation.yml', import.meta.url), 'utf8');
const harness = fs.readFileSync(new URL('./pr352-migration-cli-isolation.sh', import.meta.url), 'utf8');
const branch = 'qa/pr352-cli279-pg176-isolation-r3-20261029';

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

test('final JSON artifact writer serializes only synthetic, versioned matrix evidence', () => {
  const embedded = harness.match(/node - "\$RESULTS_JSON"[\s\S]*?<<'NODE'\n([\s\S]*?)\nNODE/);
  assert.ok(embedded, 'write_results_json must contain a testable JSON serializer');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr352-r4-report-'));
  try {
    const destination = path.join(tempDir, 'results.json');
    const casesFile = destination + '.cases.ndjson';
    fs.writeFileSync(casesFile, Array.from({ length: 10 }, (_, index) => JSON.stringify({
      caseId: 'CLI-' + String(index + 1).padStart(2, '0'),
      status: 'PASS',
    })).join('\n') + '\n');
    const result = spawnSync(process.execPath, ['-', destination, casesFile, '2.79.0', '170006', '0', '0', '', 'CLI-10', 'pr352_cli_match', '0'], {
      input: embedded[1],
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_REPOSITORY: 'fdxruli/Lanzo-POS',
        GITHUB_REF: 'refs/heads/' + branch,
        GITHUB_SHA: 'a'.repeat(40),
        PR352_STARTED_AT: '2026-10-29T00:00:00Z',
      },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(fs.readFileSync(destination, 'utf8'));
    assert.equal(report.finalStatus, 'PASS');
    assert.equal(report.cliVersion, '2.79.0');
    assert.equal(report.postgresServerVersionNum, '170006');
    assert.equal(report.cases.length, 10);
    assert.deepEqual(report.cleanup.createdSyntheticDatabases, ['pr352_cli_match']);
    assert.equal(report.cleanup.leakedSessionsAfterCleanup, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
