import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizePostgresAcl } from './pr352-r6-canonical-postgres-acl.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bridgePath = path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql');
const threeD14Path = path.join(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const writerManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-writer-fingerprints.json');
const dispatcherManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/dispatcher-fingerprint.json');
const writersPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql');
const workflowPath = path.join(root, '.github/workflows/pr352-real-bridge-pg176-r6.yml');
const runnerPath = path.join(root, 'scripts/supabase/pr352-r6-real-bridge-pg176-test.mjs');
const concurrencyPath = path.join(root, 'scripts/supabase/pr352-r6-concurrency.mjs');
const overlayPath = path.join(root, 'scripts/supabase/pr352-r6-synthetic-ledger-overlay.mjs');

test('bridge candidate stays out of the canonical migration set and runs after 3D.14', async () => {
  const sql = await readFile(bridgePath, 'utf8');
  assert.equal(existsSync(path.join(root, 'supabase/migrations/20261030182733_restaurant_cloud_transition_bridge_v1.sql')), false);
  assert.equal(existsSync(path.join(root, 'supabase/tests/fixtures/pr352-r6/bridge-v1-candidate.sql')), false);
  assert.match(sql, /BRIDGE_REQUIRES_3D14_DISPATCHER_GUARD/);
  assert.match(sql, /BRIDGE_REQUIRED_FUNCTION_MISSING/);
  assert.match(sql, /BRIDGE_FUNCTION_OVERLOAD_UNSUPPORTED/);
  assert.match(sql, /BRIDGE_FUNCTION_SECURITY_DRIFT/);
  assert.match(sql, /pg_get_functiondef\(target_oid\)/);
  assert.match(sql, /private\.pr352_r6_outer_begin_position_v1/);
  assert.match(sql, /private\.pr352_r6_inject_writer_admission_v1/);
  assert.doesNotMatch(sql, /definition:=regexp_replace\(definition/,
    'Writer admission must not use an unbounded regular expression over deparsed SQL');
  for (const lexicalState of ['line_comment', 'block_comment', 'single_quote', 'double_quote', 'dollar_quote']) {
    assert.ok(sql.includes(`v_state='${lexicalState}'`), `PostgreSQL scanner must handle ${lexicalState}`);
  }
  assert.match(sql, /BRIDGE_DOUBLE_INJECTION_UNEXPECTEDLY_ALLOWED/);
  assert.match(sql, /BRIDGE_WRITER_BODY_MATCH_AMBIGUOUS/);
  assert.match(sql, /BRIDGE_WRITER_BODY_UNSUPPORTED: no unambiguous outer BEGIN/);
  assert.match(sql, /first\\nBEGIN\\nlast/);
  assert.match(sql, /\$literal\$first\\nBEGIN\\nlast\$literal\$/);
  assert.match(sql, /v_value text;\\nbegin\\n\\tperform 1;/);
  assert.match(sql, /pg_advisory_xact_lock_shared\(pg_catalog\.hashtextextended\('restaurant_contract_cutover_v1',0\)\)/);
  assert.match(sql, /contract_version integer not null default 1/);
  assert.doesNotMatch(sql, /set contract_version\s*=\s*2/i);
  assert.match(sql, /'adminSupervisionAvailable',s\.contract_version=2 and coalesce\(a\.enabled,false\) and not s\.writes_paused/);
  assert.match(sql, /if \(select contract_version from private\.restaurant_cloud_contract_state where singleton\)=2 then[\s\S]*clientContractVersion' is distinct from '2'/);
  assert.match(sql, /RESTAURANT_PARENT_ORDER_REQUIRED/);
  assert.match(sql, /RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED/);
  assert.match(sql, /RESTAURANT_ORDER_LINE_ID_CONFLICT/);
  assert.match(sql, /RESTAURANT_ORDER_ALREADY_PAID/);
  assert.match(sql, /RESTAURANT_CONTRACT_MAINTENANCE/);
  const policyStart = sql.indexOf('create function private.set_restaurant_transition_policy_v1');
  assert.ok(policyStart > 0);
  assert.doesNotMatch(sql.slice(0, policyStart), /insert\s+into\s+private\.restaurant_admin_activation\s*\(/i);
});

test('historical 3D.14 remains the exact reviewed blob and dispatcher fingerprint', async () => {
  const blob = execFileSync('git', ['hash-object', threeD14Path], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(blob, 'e1ab62ed387a3da7798d03d46e2c0723d12526a8');
  const dispatcher = JSON.parse(await readFile(dispatcherManifestPath, 'utf8'));
  assert.equal(dispatcher.postgresServerVersionNum, '170006');
  assert.equal(dispatcher.rawDataIncluded, false);
  assert.equal(dispatcher.credentialsIncluded, false);
  assert.equal(dispatcher.entry.signature, 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)');
  const source = await readFile(threeD14Path, 'utf8');
  const match = source.replaceAll('\r', '').match(/create or replace function public\.pos_execute_financial_operation_v1\([\s\S]*?\n\$function\$;/i)?.[0];
  assert.ok(match);
  const pgGetFunctionDefSerialization = match.slice(0, -1) + '\n';
  assert.equal(createHash('sha256').update(pgGetFunctionDefSerialization).digest('hex'), dispatcher.entry.sha256);
});

test('six authentic writer definitions are fingerprinted without row data or credentials', async () => {
  const manifest = JSON.parse(await readFile(writerManifestPath, 'utf8'));
  assert.equal(manifest.postgresServerVersionNum, '170006');
  assert.equal(manifest.rawDataIncluded, false);
  assert.equal(manifest.credentialsIncluded, false);
  assert.equal(manifest.entries.length, 6);
  assert.equal(new Set(manifest.entries.map((entry) => entry.signature)).size, 6);
  assert.ok(manifest.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  assert.ok(manifest.entries.every((entry) => entry.owner === 'postgres' && entry.securityDefiner === true));
  assert.ok(manifest.entries.every((entry) => entry.config.includes('search_path=""')));
  const source = await readFile(writersPath, 'utf8');
  assert.equal((source.match(/create or replace function/gi) || []).length, 6);
  assert.doesNotMatch(source, /(eyJ[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|postgres(?:ql)?:\/\/[^\s"']+|password\s*[:=]\s*['"][^'"]{6,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
});

test('PostgreSQL ACL comparisons ignore display order but preserve the exact grant set', async () => {
  const expected = '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}';
  const actual = '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  assert.deepEqual(canonicalizePostgresAcl(actual), canonicalizePostgresAcl(expected));
  const expectedSet = canonicalizePostgresAcl(expected);
  const driftCases = [
    ['missing grant', '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'],
    ['additional role', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,unexpected=X/postgres}'],
    ['different grantee', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,other_role=X/postgres}'],
    ['different grantor', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/other_grantor}'],
    ['different privilege', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=U/postgres}'],
    ['grant option drift', '{postgres=X*/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'],
    ['PUBLIC confused with a named role', '{=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'],
  ];
  for (const [description, acl] of driftCases) {
    assert.notDeepEqual(canonicalizePostgresAcl(acl), expectedSet, description);
  }

  const duplicateGrant = canonicalizePostgresAcl('{postgres=X/postgres,postgres=X/postgres}');
  assert.equal(duplicateGrant.length, 2, 'Duplicate ACL entries must not be silently removed');
  assert.notDeepEqual(duplicateGrant, canonicalizePostgresAcl('{postgres=X/postgres}'));

  const quotedIdentifiers = String.raw`{"\"role,with,comma\"=X/postgres","\"role\"\"quoted\"=X/postgres"}`;
  const quotedIdentifiersReordered = String.raw`{"\"role\"\"quoted\"=X/postgres","\"role,with,comma\"=X/postgres"}`;
  assert.deepEqual(canonicalizePostgresAcl(quotedIdentifiers), [
    '"role""quoted"=X/postgres', '"role,with,comma"=X/postgres',
  ]);
  assert.deepEqual(canonicalizePostgresAcl(quotedIdentifiers), canonicalizePostgresAcl(quotedIdentifiersReordered),
    'Quoted and escaped identifiers must survive array decoding while order is ignored');
  assert.notDeepEqual(canonicalizePostgresAcl(quotedIdentifiers),
    canonicalizePostgresAcl(String.raw`{"\"other,role\"=X/postgres","\"role\"\"quoted\"=X/postgres"}`),
    'A quoted grantee change must remain visible');

  assert.deepEqual(canonicalizePostgresAcl('<default>'), ['<default>']);
  assert.throws(() => canonicalizePostgresAcl('not-an-acl'), /brace-delimited array literal/);
  assert.throws(() => canonicalizePostgresAcl(null), /brace-delimited array literal/);
  const runner = await readFile(runnerPath, 'utf8');
  assert.match(runner, /canonicalizePostgresAcl\(liveDispatcher\.acl\)/);
  assert.match(runner, /canonicalizePostgresAcl\(actual\.acl\)/);
  assert.match(runner, /canonicalizePostgresAcl\(after\.acl\)/);
  assert.match(runner, /writerChecks,/);
  assert.match(runner, /originalFingerprint:/);
  assert.match(runner, /postBridgeFingerprint:/);
  assert.match(runner, /bodyRecoveredExactly:/);
  assert.match(runner, /firstTextDifference/);
  assert.doesNotMatch(runner, /after\.definition\.replace\(insertion, '\\n'\)/,
    'Post-bridge comparison must remove only the injected guard without normalizing original SQL');
});

test('real PostgreSQL runner applies 3D.14 before the bridge and proves finite loopback-only setup', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const concurrency = await readFile(concurrencyPath, 'utf8');
  assert.ok(runner.indexOf("currentStage = 'apply 3D.14'") < runner.indexOf("currentStage = 'apply forward bridge migration'"));
  assert.match(runner, /server_version_num/);
  assert.match(runner, /170006/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /pr352_bridge_isolated/);
  assert.match(runner, /set_restaurant_transition_policy_v1/);
  assert.match(concurrency, /pg_locks/);
  assert.match(concurrency, /pg_stat_activity/);
  assert.match(concurrency, /statement_timeout|lock_timeout|timeout/);
  assert.match(concurrency, /finish\('commit;'\)/);
  assert.match(concurrency, /newWriteWaiting/);
  assert.match(runner, /SERVICE_ROLE|service_role|anon|authenticated/);
  assert.doesNotMatch(runner, /SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD/);
  assert.match(runner, /commitSha:\s*process\.env\.GITHUB_SHA\s*\?\?\s*null/);
});

test('isolated workflow runs only on the exact QA push branch without secrets or dispatch', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /branches:\s*\n\s*-\s*qa\/pr352-real-bridge-pg176-r6-20261030/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /image:\s*postgres:17\.6/);
  assert.match(workflow, /PGHOST:\s*127\.0\.0\.1/);
  assert.match(workflow, /PGDATABASE:\s*pr352_bridge_isolated/);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request_target|environment:\s*production|secrets\./i);
  assert.doesNotMatch(workflow, /supabase db push|migration fetch|vercel deploy|--prod/i);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /upload-artifact/);
  assert.match(workflow, /postgresServerVersionNum !== "170006"/);
  assert.match(workflow, /overlay\.expectedLedgerRows !== 333/);
  assert.match(workflow, /real-bridge\.json/);
  assert.match(workflow, /synthetic-overlay\.json/);
  assert.match(workflow, /EXPECTED_EXECUTION_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /bridge\.commitSha !== expectedSha \|\| overlay\.commitSha !== expectedSha/);
  assert.match(workflow, /bridge\.writerChecks\.length !== 10/);
  assert.match(workflow, /writer\.bodyRecoveredExactly && writer\.oidPreserved/);
  assert.match(workflow, /bridge\.concurrency\.length !== 4/);
  assert.match(workflow, /overlay\.cases\.length !== overlay\.caseCount/);
  assert.match(workflow, /overlay\.productionConnections !== 0 \|\| overlay\.cleanupFailures !== 0/);
  assert.doesNotMatch(workflow, /^\s{6}PR352_R6_EVIDENCE_DIR:/m, 'runner context is not valid in job-level env');
  assert.equal((workflow.match(/^\s{10}PR352_R6_EVIDENCE_DIR: \$\{\{ runner\.temp \}\}\/pr352-r6-evidence$/gm) || []).length, 2,
    'runner temp path must be scoped to the two steps that write JSON evidence');
});

test('structured evidence gate binds both reports to this SHA and rejects failed or missing evidence', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const match = workflow.match(/node --input-type=module -e '\r?\n([\s\S]*?)\r?\n[ \t]{10}'/);
  assert.ok(match, 'workflow evidence gate JavaScript must be extractable');
  const gateSource = match[1].split(/\r?\n/).map((line) => line.replace(/^ {12}/, '')).join('\n');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pr352-r6-evidence-gate-'));
  const evidenceRoot = path.join(tempRoot, 'pr352-r6-evidence');
  await mkdir(evidenceRoot, { mode: 0o700 });
  const bridgePath = path.join(evidenceRoot, 'real-bridge.json');
  const overlayPath = path.join(evidenceRoot, 'synthetic-overlay.json');
  const commitSha = 'a'.repeat(40);
  const bridge = {
    commitSha,
    status: 'PASS',
    checks: [{ status: 'PASS' }],
    writerChecks: Array.from({ length: 10 }, () => ({
      status: 'PASS',
      admissionOccurrences: 1,
      bodyRecoveredExactly: true,
      oidPreserved: true,
      ownerPreserved: true,
      securityDefinerPreserved: true,
      configurationPreserved: true,
      aclSemanticallyPreserved: true,
    })),
    concurrency: Array.from({ length: 4 }, () => ({ status: 'PASS' })),
    postgresServerVersionNum: '170006',
    productionConnections: 0,
  };
  const overlay = {
    commitSha,
    status: 'PASS',
    expectedLedgerRows: 333,
    cases: Array.from({ length: 13 }, () => ({ status: 'PASS' })),
    caseCount: 13,
    passed: 13,
    failed: 0,
    productionConnections: 0,
    cleanupFailures: 0,
    sqlContentsEmitted: false,
  };
  const writeReports = async () => {
    await writeFile(bridgePath, JSON.stringify(bridge));
    await writeFile(overlayPath, JSON.stringify(overlay));
  };
  const runGate = () => execFileSync(process.execPath, ['--input-type=module', '-e', gateSource], {
    cwd: root,
    env: { ...process.env, RUNNER_TEMP: tempRoot, EXPECTED_EXECUTION_SHA: commitSha },
    encoding: 'utf8',
  });

  try {
    await writeReports();
    assert.match(runGate(), /PR352_R6_EVIDENCE_PASS/);

    bridge.commitSha = 'b'.repeat(40);
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'wrong commit SHA must fail closed');

    bridge.commitSha = commitSha;
    bridge.writerChecks[3].bodyRecoveredExactly = false;
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'writer body drift must fail closed');
    bridge.writerChecks[3].bodyRecoveredExactly = true;

    overlay.cases[4].status = 'FAIL';
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'failed case status must fail closed');

    overlay.cases[4].status = 'PASS';
    await writeReports();
    await rm(overlayPath);
    assert.throws(runGate, (error) => error.status === 1, 'missing report must fail closed');

    await writeFile(overlayPath, '{malformed');
    assert.throws(runGate, (error) => error.status === 1, 'malformed JSON must fail closed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('synthetic overlay helper is self-contained and never embeds the remote ledger', async () => {
  const source = await readFile(overlayPath, 'utf8');
  const runner = await readFile(path.join(root, 'scripts/supabase/pr352-r6-synthetic-ledger-overlay-test.mjs'), 'utf8');
  assert.match(runner, /report\.commitSha = process\.env\.GITHUB_SHA\s*\?\?\s*null/);
  assert.match(source, /synthetic-only/);
  assert.match(source, /canonicalLedgerRepresentation/);
  assert.match(source, /fingerprint mismatch/);
  assert.match(source, /drift detected/);
  assert.match(source, /exactly one approved candidate migration/);
  assert.match(source, /0700/);
  assert.doesNotMatch(source, /productionProjectRef|pr352-r5-production-ledger-fingerprint-manifest|DELETE\s+FROM/i);
});
