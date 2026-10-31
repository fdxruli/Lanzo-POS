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
import { runPreparationStationBehavior } from './pr352-r6-preparation-station.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bridgePath = path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql');
const threeD14Path = path.join(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const writerManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-writer-fingerprints.json');
const dispatcherManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/dispatcher-fingerprint.json');
const writersPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql');
const restaurantDependenciesFixturePath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-dependencies.sql');
const preparationStationManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/preparation-station-fingerprints.json');
const workflowPath = path.join(root, '.github/workflows/pr352-real-bridge-pg176-r6.yml');
const runnerPath = path.join(root, 'scripts/supabase/pr352-r6-real-bridge-pg176-test.mjs');
const preparationStationTestPath = path.join(root, 'scripts/supabase/pr352-r6-preparation-station.mjs');
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

test('Staff bridge authorization matches validate_pos_sync_context session fields', async () => {
  const sql = await readFile(bridgePath, 'utf8');
  const functionSources = JSON.parse(await readFile(
    path.join(root, 'supabase/tests/fixtures/pr338-real-financial/02-function-sources.json'), 'utf8'));
  const validator = functionSources.find((source) => /CREATE OR REPLACE FUNCTION private\.validate_pos_sync_context\(/i.test(source));
  assert.ok(validator, 'The reviewed auth context function must be present in the PostgreSQL fixture');
  assert.match(validator, /'actor_session_id',\s*v_actor_session_id/);
  assert.doesNotMatch(validator, /'staff_session_id'/,
    'validate_pos_sync_context exports the validated Staff session as actor_session_id');

  const staffGuard = sql.match(/create function private\.assert_restaurant_bridge_actor_v1\([\s\S]*?\$function\$;/i)?.[0];
  assert.ok(staffGuard, 'The bridge actor guard must be present');
  assert.match(staffGuard, /nullif\(c->>'staff_user_id',''\)\s+is distinct from c->>'actor_id'/);
  assert.match(staffGuard, /nullif\(c->>'actor_id',''\)\s+is null/);
  assert.match(staffGuard, /nullif\(c->>'actor_session_id',''\)\s+is null/);
  assert.doesNotMatch(staffGuard, /c->>'staff_session_id'/,
    'The guard must not read a Staff session field that the validated context does not return');
});

test('Cocina fixture matches production station schema and helper function fingerprints', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const fixture = await readFile(restaurantDependenciesFixturePath, 'utf8');
  const manifest = JSON.parse(await readFile(preparationStationManifestPath, 'utf8'));
  assert.match(runner, /Production-matched synthetic Cocina schema and functions/);
  assert.match(runner, /preparationStationActual\.functions, preparationStationManifest\.functions/);
  assert.match(fixture, /create table public\.pos_preparation_stations\s*\(/i);
  assert.match(fixture, /alter table public\.pos_preparation_stations enable row level security/i);
  assert.match(fixture, /grant all on table public\.pos_preparation_stations to service_role/i);
  assert.match(fixture, /create unique index pos_preparation_stations_license_code_uidx/i);
  assert.match(fixture, /create unique index pos_preparation_stations_license_name_key_uidx/i);
  assert.match(fixture, /references public\.license_devices\(id\) on delete set null/i);
  assert.match(fixture, /references public\.license_staff_users\(id\) on delete set null/i);
  assert.match(fixture, /references public\.licenses\(id\) on delete cascade/i);
  assert.match(fixture, /returns public\.pos_preparation_stations\s+language plpgsql\s+security definer\s+set search_path to ''/i);
  assert.match(fixture, /select \* into v_station[\s\S]*?for update;/i);
  assert.match(fixture, /exception when unique_violation then[\s\S]*?where license_id = p_license_id[\s\S]*?and code = 'kitchen'/i);
  assert.match(fixture, /create or replace function private\.resolve_restaurant_order_station/i);
  assert.match(fixture, /perform private\.ensure_default_preparation_station\(p_license_id, p_device_id, p_staff_user_id\)/);
  assert.match(fixture, /revoke all on function private\.ensure_default_preparation_station\(uuid,uuid,uuid\)\s+from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(fixture, /returns void\s+language plpgsql\s+security definer[\s\S]*?begin\s+return;\s+end;/i,
    'The prior no-op helper must not remain as the writer dependency');
  assert.equal(manifest.source.rawRowsIncluded, false);
  assert.equal(manifest.source.credentialsIncluded, false);
  assert.equal(manifest.table.columns.length, 18);
  assert.equal(manifest.table.constraints.length, 9);
  assert.equal(manifest.table.indexes.length, 5);
  assert.equal(manifest.table.acl, 'postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres');
  assert.equal(manifest.functions.length, 6);
  assert.equal(manifest.functions.find((fn) => fn.signature.startsWith('private.ensure_default')).bodySha256,
    'e1066fb33e7d039894e7e00a72022c60aa8bfd6d76ffe66588660ca1915cf354');
  for (const name of ['is_restaurant_order_status', 'normalize_restaurant_order_status', 'safe_jsonb_numeric']) {
    assert.ok(manifest.functions.some((fn) => fn.signature.startsWith(`private.${name}(`)),
      `Missing authentic direct writer helper ${name}`);
  }
  for (const fn of manifest.functions) {
    const start = fixture.indexOf(`CREATE OR REPLACE FUNCTION ${fn.signature.split('(')[0]}`);
    assert.ok(start >= 0, `Missing source function ${fn.signature}`);
    const delimiter = 'AS $function$\n';
    const bodyStart = fixture.indexOf(delimiter, start);
    assert.ok(bodyStart >= 0, `Missing function body delimiter ${fn.signature}`);
    const bodyEnd = fixture.indexOf('\n$function$;', bodyStart + delimiter.length);
    assert.ok(bodyEnd >= 0, `Missing function body end ${fn.signature}`);
    const exactProsrc = `\n${fixture.slice(bodyStart + delimiter.length, bodyEnd)}\n`;
    assert.equal(createHash('sha256').update(exactProsrc).digest('hex'), fn.bodySha256,
      `The fixture body must match the read-only Production prosrc hash: ${fn.signature}`);
  }
});

test('station behavior test covers independent PG sessions and Cocina invariants A-H', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const testSource = await readFile(preparationStationTestPath, 'utf8');
  assert.equal(typeof runPreparationStationBehavior, 'function', 'The imported PostgreSQL behavior suite must parse and load in CI');
  for (const name of [
    'A/G: first authenticated Staff write creates and attributes Kitchen',
    'B: active station reuse and authentic resolver fallback',
    'C: inactive station reactivation',
    'D: incomplete station fields repaired without rewriting metadata',
    'E: concurrent creation, independent psql sessions',
    'F: different licenses keep distinct default stations',
    'H: failed transaction rolls back station initialization',
  ]) assert.ok(testSource.includes(name), `Missing runtime Cocina assertion ${name}`);
  assert.match(runner, /runPreparationStationBehavior\(\{ query, runSql, psqlBin, env \}\)/);
  assert.match(runner, /statementBatch\.endsWith\(';'\)/);
  assert.match(testSource, /spawn\(psqlBin/);
  assert.match(testSource, /'-h', '127\.0\.0\.1'/);
  assert.match(testSource, /'-d', 'pr352_bridge_isolated'/);
  assert.match(testSource, /child\.stdin\.end\(\)/);
  assert.match(testSource, /pg_stat_activity/);
  assert.match(testSource, /pg_locks/);
  assert.match(testSource, /wait_event_type/);
  assert.match(testSource, /controller\.finish\('COMMIT;'\)/);
  assert.match(testSource, /finally\s*\{[\s\S]*?controller\.finish\('ROLLBACK;'\)/);
  assert.match(testSource, /pendingConcurrencySessions/);
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
  assert.match(runner, /adminOff: adminOffEvidence/);
  assert.match(runner, /const adminState = JSON\.parse\(await query/);
  assert.match(runner, /adminOffEvidence\.status = 'PASS'/);
  assert.doesNotMatch(runner, /adminOffEvidence = \{ status: 'PASS', contractVersion:/,
    'Admin OFF evidence must be derived from executed PostgreSQL observations');
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
  assert.match(runner, /runId:\s*process\.env\.GITHUB_RUN_ID\s*\?\?\s*null/);
  assert.match(runner, /runAttempt:\s*process\.env\.GITHUB_RUN_ATTEMPT\s*\?\?\s*null/);
  assert.match(runner, /VERBOSITY=verbose/);
  assert.match(runner, /denialSqlstate: match\[1\]/);
  assert.match(runner, /denialMessage: match\[2\]/);
  assert.match(runner, /assert\.deepEqual\(stateAfterDenial, adminState/);
  assert.doesNotMatch(runner, /passed\(`admin-off-private-setter-denied-\$\{role\}`,\s*\{\s*role,\s*denialSqlstate:\s*'42501'/,
    'Runtime role evidence must contain SQLSTATE read from PostgreSQL, not a fixed pass value');
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
  assert.match(workflow, /EXPECTED_RUN_ID:\s*\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /EXPECTED_RUN_ATTEMPT:\s*\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /bridge\.commitSha !== expectedSha \|\| overlay\.commitSha !== expectedSha/);
  assert.match(workflow, /bridge\.writerChecks\.length !== 10/);
  assert.match(workflow, /writer\.bodyRecoveredExactly && writer\.oidPreserved/);
  assert.match(workflow, /state\.activeActivationRows === 0/);
  for (const check of ['admin-off-initial-state', 'admin-off-contract-response', 'admin-off-setter-rejected-no-state-change',
    'admin-off-private-setter-denied-anon', 'admin-off-private-setter-denied-authenticated']) {
    assert.ok(workflow.includes(check), `evidence gate must require the executed check ${check}`);
  }
  assert.match(workflow, /contractResponse\.adminSupervisionAvailable !== false/);
  assert.match(workflow, /setterAttempt\.errorMessage !== "RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE"/);
  assert.match(workflow, /roleMatrix\.authenticatedCanExecuteSetter !== false/);
  assert.match(workflow, /bridge\.concurrency\.length !== 4/);
  assert.match(workflow, /overlay\.cases\.length !== overlay\.caseCount/);
  assert.match(workflow, /overlay\.productionConnections !== 0 \|\| overlay\.cleanupFailures !== 0/);
  assert.doesNotMatch(workflow, /^\s{6}PR352_R6_EVIDENCE_DIR:/m, 'runner context is not valid in job-level env');
  assert.equal((workflow.match(/^\s{10}PR352_R6_EVIDENCE_DIR: \$\{\{ runner\.temp \}\}\/pr352-r6-evidence$/gm) || []).length, 2,
    'runner temp path must be scoped to the two steps that write JSON evidence');
});

test('structured evidence gate binds the Admin report to this run and SHA and rejects malformed evidence', async () => {
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
  const runId = '1234567890';
  const runAttempt = '2';
  let bridge = {
    commitSha,
    runId,
    runAttempt,
    status: 'PASS',
    failedStage: null,
    error: null,
    errorStack: null,
    checks: [
      { name: 'admin-off-initial-state', status: 'PASS', contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
      { name: 'admin-off-contract-response', status: 'PASS', success: true, contractVersion: 1, writesPaused: false, adminSupervisionAvailable: false },
      { name: 'admin-off-setter-rejected-no-state-change', status: 'PASS', attempted: true, rejected: true, errorMessage: 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE', sqlstate: 'P0001', stateBefore: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 }, stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      { name: 'admin-off-private-setter-denied-anon', status: 'PASS', role: 'anon', denialSqlstate: '42501', denialMessage: 'permission denied for schema private', stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      { name: 'admin-off-private-setter-denied-authenticated', status: 'PASS', role: 'authenticated', denialSqlstate: '42501', denialMessage: 'permission denied for schema private', stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
    ],
    adminOff: {
      status: 'PASS',
      initialState: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
      contractResponse: { success: true, contractVersion: 1, writesPaused: false, adminSupervisionAvailable: false },
      setterAttempt: { attempted: true, rejected: true, errorMessage: 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE', sqlstate: 'P0001', stateBefore: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 }, stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      roleMatrix: {
        anonCanExecuteSetter: false,
        authenticatedCanExecuteSetter: false,
        denials: ['anon', 'authenticated'].map((role) => ({
          role,
          denialSqlstate: '42501',
          denialMessage: 'permission denied for schema private',
          stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
        })),
      },
    },
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
    env: {
      ...process.env,
      RUNNER_TEMP: tempRoot,
      EXPECTED_EXECUTION_SHA: commitSha,
      EXPECTED_RUN_ID: runId,
      EXPECTED_RUN_ATTEMPT: runAttempt,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const rejectBridgeMutation = async (description, mutate) => {
    const validBridge = structuredClone(bridge);
    mutate(bridge);
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, description);
    bridge = validBridge;
  };

  try {
    await writeReports();
    assert.match(runGate(), /PR352_R6_EVIDENCE_PASS/);

    await rejectBridgeMutation('wrong commit SHA must fail closed', (report) => { report.commitSha = 'b'.repeat(40); });
    await rejectBridgeMutation('wrong workflow run ID must fail closed', (report) => { report.runId = '1234567891'; });
    await rejectBridgeMutation('wrong workflow run attempt must fail closed', (report) => { report.runAttempt = '1'; });
    await rejectBridgeMutation('missing Admin check must fail closed', (report) => {
      report.checks = report.checks.filter((check) => check.name !== 'admin-off-private-setter-denied-anon');
    });
    await rejectBridgeMutation('duplicate Admin check must fail closed', (report) => {
      report.checks.push(structuredClone(report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon')));
    });
    await rejectBridgeMutation('unknown Admin check ID must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-initial-state').name = 'admin-off-initial-state-unknown';
    });
    await rejectBridgeMutation('unknown extra Admin check ID must fail closed', (report) => {
      report.checks.push({ name: 'admin-off-unexpected', status: 'PASS' });
    });
    await rejectBridgeMutation('FAIL Admin status must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').status = 'FAIL';
    });
    await rejectBridgeMutation('string boolean must fail closed', (report) => {
      report.adminOff.initialState.writesPaused = 'false';
      report.checks.find((check) => check.name === 'admin-off-initial-state').writesPaused = 'false';
    });
    await rejectBridgeMutation('wrong contract version must fail closed', (report) => {
      report.adminOff.initialState.contractVersion = 2;
      report.checks.find((check) => check.name === 'admin-off-initial-state').contractVersion = 2;
    });
    await rejectBridgeMutation('wrong endpoint contract version must fail closed', (report) => {
      report.adminOff.contractResponse.contractVersion = 2;
      report.checks.find((check) => check.name === 'admin-off-contract-response').contractVersion = 2;
    });
    await rejectBridgeMutation('activation rows above zero must fail closed', (report) => {
      report.adminOff.initialState.activeActivationRows = 1;
      report.checks.find((check) => check.name === 'admin-off-initial-state').activeActivationRows = 1;
    });
    await rejectBridgeMutation('endpoint Admin enabled must fail closed', (report) => {
      report.adminOff.contractResponse.adminSupervisionAvailable = true;
      report.checks.find((check) => check.name === 'admin-off-contract-response').adminSupervisionAvailable = true;
    });
    await rejectBridgeMutation('missing endpoint capability must fail closed', (report) => {
      delete report.adminOff.contractResponse.adminSupervisionAvailable;
    });
    await rejectBridgeMutation('setter success must fail closed', (report) => {
      report.adminOff.setterAttempt.rejected = false;
      report.checks.find((check) => check.name === 'admin-off-setter-rejected-no-state-change').rejected = false;
    });
    await rejectBridgeMutation('unexpected setter rejection must fail closed', (report) => {
      report.adminOff.setterAttempt.errorMessage = 'arbitrary exception';
      report.checks.find((check) => check.name === 'admin-off-setter-rejected-no-state-change').errorMessage = 'arbitrary exception';
    });
    await rejectBridgeMutation('unexpected setter SQLSTATE must fail closed', (report) => {
      report.adminOff.setterAttempt.sqlstate = '42501';
      report.checks.find((check) => check.name === 'admin-off-setter-rejected-no-state-change').sqlstate = '42501';
    });
    await rejectBridgeMutation('contradictory post-rejection state must fail closed', (report) => {
      report.adminOff.setterAttempt.stateAfter.activeActivationRows = 1;
    });
    await rejectBridgeMutation('anon denial mutation must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon').denialSqlstate = '00000';
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'anon').denialSqlstate = '00000';
    });
    await rejectBridgeMutation('anon denial message mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'anon').denialMessage = 'an unrelated error';
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon').denialMessage = 'an unrelated error';
    });
    await rejectBridgeMutation('anon denial state mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'anon').stateAfter.activeActivationRows = 1;
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon').stateAfter.activeActivationRows = 1;
    });
    await rejectBridgeMutation('anon role privilege mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.anonCanExecuteSetter = true;
    });
    await rejectBridgeMutation('authenticated denial mutation must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').denialSqlstate = '00000';
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'authenticated').denialSqlstate = '00000';
    });
    await rejectBridgeMutation('authenticated denial message mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'authenticated').denialMessage = 'an unrelated error';
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').denialMessage = 'an unrelated error';
    });
    await rejectBridgeMutation('authenticated denial state mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'authenticated').stateAfter.activeActivationRows = 1;
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').stateAfter.activeActivationRows = 1;
    });
    await rejectBridgeMutation('authenticated role privilege mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.authenticatedCanExecuteSetter = true;
    });
    await rejectBridgeMutation('PASS with failure diagnostics must fail closed', (report) => {
      report.failedStage = 'synthetic failure';
      report.error = 'synthetic error';
      report.errorStack = 'synthetic stack';
    });
    await rejectBridgeMutation('missing Admin evidence report must fail closed', (report) => { delete report.adminOff; });

    await rejectBridgeMutation('writer body drift must fail closed', (report) => { report.writerChecks[3].bodyRecoveredExactly = false; });

    const originalBridgeBytes = await readFile(bridgePath);
    await rm(bridgePath);
    assert.throws(runGate, (error) => error.status === 1, 'missing bridge report must fail closed');
    await writeFile(bridgePath, originalBridgeBytes);

    await writeFile(bridgePath, '{malformed');
    assert.throws(runGate, (error) => error.status === 1, 'malformed bridge JSON must fail closed');

    const originalOverlayBytes = await readFile(overlayPath);
    await rm(overlayPath);
    assert.throws(runGate, (error) => error.status === 1, 'missing overlay report must fail closed');
    await writeFile(overlayPath, originalOverlayBytes);

    overlay.cases[4].status = 'FAIL';
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'failed case status must fail closed');

    overlay.cases[4].status = 'PASS';
    await writeReports();
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
