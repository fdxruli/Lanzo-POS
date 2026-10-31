import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRestaurantCutoverConcurrency } from './pr352-r6-concurrency.mjs';
import { canonicalizePostgresAcl } from './pr352-r6-canonical-postgres-acl.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const fixture = path.join(root, 'supabase/tests/fixtures/pr338-real-financial');
const restaurantDependenciesFixture = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-dependencies.sql');
const restaurantWritersFixture = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql');
const restaurantWritersManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-writer-fingerprints.json');
const dispatcherManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/dispatcher-fingerprint.json');
const bridgePath = path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql');
const threeD14Path = path.join(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const psqlBin = process.env.PSQL_BIN || 'psql';
const connect = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.PGPORT || '5432', '-U', process.env.PGUSER || 'postgres', '-d', 'pr352_bridge_isolated'];
const env = { ...process.env, PGHOST: '127.0.0.1', PGDATABASE: 'pr352_bridge_isolated', PGCONNECT_TIMEOUT: '5' };
let currentStage = 'preflight';
let tempRoot = null;
let serverVersionNum = null;
let bridgeStatus = 'FAIL';
let failure = null;
let adminOffEvidence = null;
const completedChecks = [];
let concurrencyResults = [];
const writerChecks = [];

function passed(name, details = {}) {
  completedChecks.push({ name, status: 'PASS', ...details });
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function summarizeFunctionRows(rows) {
  return rows.map(({ signature, oid, sha256: digest, owner, security_definer, config, acl }) => ({
    signature, oid, sha256: digest, owner, security_definer, config, acl,
  }));
}

function firstTextDifference(left, right) {
  const limit = Math.min(left.length, right.length);
  for (let offset = 0; offset < limit; offset += 1) {
    if (left[offset] !== right[offset]) return { offset, kind: 'text' };
  }
  return left.length === right.length ? null : {
    offset: limit,
    kind: 'length',
    originalLength: left.length,
    recoveredLength: right.length,
  };
}

function evidenceDirectory() {
  return process.env.PR352_R6_EVIDENCE_DIR || path.join(os.tmpdir(), 'pr352-r6-evidence');
}

function runPsql(args, { timeout = 180_000 } = {}) {
  return execFileAsync(psqlBin, [...connect, ...args], {
    env,
    windowsHide: true,
    timeout,
    killSignal: 'SIGTERM',
    maxBuffer: 12_000_000,
  });
}

async function query(sql, timeout = 45_000) {
  const result = await runPsql(['-A', '-t', '-c', sql], { timeout });
  return result.stdout.trim();
}

async function runFile(file, label) {
  try {
    await runPsql(['-f', file]);
  } catch (error) {
    const detail = String(error.stderr || error.message || '').trim();
    throw new Error(`${label} failed: ${detail}`);
  }
}

async function runExpectedRollback(file, marker) {
  try {
    await runPsql(['--single-transaction', '-f', file], { timeout: 180_000 });
    throw new Error('The deliberately failed bridge transaction unexpectedly returned success');
  } catch (error) {
    const detail = String(error.stderr || error.message || '');
    assert.match(detail, new RegExp(marker), 'Expected the controlled rollback marker from PostgreSQL');
  }
}

async function runSql(sql, label) {
  if (!tempRoot) tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pr352-bridge-pg176-'));
  const file = path.join(tempRoot, `${label}.sql`);
  await writeFile(file, `\\set ON_ERROR_STOP on\n${sql}\n`);
  await runFile(file, label);
}

async function createLegacyOrder(localOrderId, idempotencyKey) {
  const result = JSON.parse(await query(`select public.pos_upsert_restaurant_order_unlimited(
    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
    jsonb_build_object('localOrderId',${quoteSql(localOrderId)},'tableLabel','R6 concurrency seed','status','pending',
      'fulfillmentStatus','pending','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId',${quoteSql(localOrderId + '-line')},
      'productId','bridge-restaurant-product','productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    ${quoteSql(idempotencyKey)})::text`));
  assert.equal(result.success, true, 'Synthetic legacy parent seed must succeed');
}

function quoteSql(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

async function writeEvidence() {
  const directory = evidenceDirectory();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const bridgeBytes = await readFile(bridgePath);
  const writerBytes = await readFile(restaurantWritersFixture);
  const report = {
    schemaVersion: 1,
    suite: 'PR352_R6_REAL_BRIDGE',
    commitSha: process.env.GITHUB_SHA ?? null,
    runId: process.env.GITHUB_RUN_ID ?? null,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT ?? null,
    status: bridgeStatus,
    database: 'pr352_bridge_isolated',
    postgresServerVersionNum: serverVersionNum,
    requiredPostgresServerVersionNum: '170006',
    threeD14: { path: 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql', gitBlob: 'e1ab62ed387a3da7798d03d46e2c0723d12526a8' },
    bridge: { path: 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql', sha256: sha256(bridgeBytes) },
    authenticWriterSnapshot: { sha256: sha256(writerBytes), expectedFunctions: 6 },
    checks: completedChecks,
    adminOff: adminOffEvidence,
    writerChecks,
    concurrency: concurrencyResults,
    mockedDependencies: [
      'Authentication and license/device/session rows are synthetic.',
      'private.ensure_default_preparation_station(uuid,uuid,uuid) is a no-op synthetic fixture dependency; preparation-station provisioning is outside this bridge authorization test.',
      'Schema, RLS, constraints, triggers, financial dispatcher, 3D.14 wrappers, six Restaurant writer bodies and bridge SQL execute in PostgreSQL.',
      'No Supabase Production connection or credentials are available to this job.',
    ],
    rawProductionRowsIncluded: false,
    productionConnections: 0,
    failedStage: failure ? currentStage : null,
    error: failure ? String(failure.message || failure) : null,
    errorStack: failure ? String(failure.stack || '').slice(0, 6000) : null,
  };
  await writeFile(path.join(directory, 'real-bridge.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
}

const targetFunctions = [
  {
    signature: 'public.pos_upsert_restaurant_order_unlimited(text,text,text,text,jsonb,jsonb,text)',
    instruction: 'perform private.prepare_restaurant_bridge_upsert_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order,p_items);',
  },
  {
    signature: 'public.pos_update_restaurant_order_status_unlimited(text,text,text,text,text,text,text)',
    instruction: "perform private.enter_restaurant_transition_write_v1(); if lower(btrim(p_status))='cancelled' then raise exception 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED'; end if;",
  },
  {
    signature: 'public.pos_update_restaurant_order_item_status_unlimited(text,text,text,text,text,text,text,text)',
    instruction: 'perform private.enter_restaurant_transition_write_v1();',
  },
  {
    signature: 'public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text)',
    instruction: 'perform private.enter_restaurant_transition_write_v1();',
  },
  {
    signature: 'public.pos_archive_restaurant_order_unlimited(text,text,text,text,text,text,jsonb,text)',
    instruction: 'perform private.enter_restaurant_transition_write_v1();',
  },
  {
    signature: 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)',
    instruction: 'perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_request);',
  },
  {
    signature: 'public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text)',
    instruction: 'perform private.prepare_restaurant_bridge_cancel_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_local_order_id,p_expected_parent_version);',
  },
  {
    signature: 'private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text)',
    instruction: "perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,jsonb_build_object('sale',p_sale));",
  },
  {
    signature: 'private.execute_split_sale_financial_v1(text,text,text,text,jsonb,text)',
    instruction: 'perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_split);',
  },
  {
    signature: 'private.recalculate_restaurant_order_status(uuid,text)',
    instruction: 'perform private.enter_restaurant_transition_write_v1();',
  },
];

async function captureFunctions(signatures) {
  const values = signatures.map((signature) => `('${signature.replaceAll("'", "''")}')`).join(',');
  const sql = `select coalesce(json_agg(json_build_object(
    'signature',required.signature,'oid',p.oid::text,'source',p.prosrc,'definition',pg_get_functiondef(p.oid),
    'sha256',encode(extensions.digest(replace(pg_get_functiondef(p.oid),chr(13),''),'sha256'),'hex'),
    'owner',r.rolname,'security_definer',p.prosecdef,'config',p.proconfig,'acl',coalesce(p.proacl::text,'<default>')
  ) order by required.signature),'[]'::json)::text
  from (values ${values}) as required(signature)
  join pg_proc p on p.oid=to_regprocedure(required.signature)::oid
  join pg_roles r on r.oid=p.proowner`;
  return JSON.parse(await query(sql));
}

async function run() {
  assert.equal(process.env.PGHOST || '127.0.0.1', '127.0.0.1', 'Only loopback PostgreSQL is permitted');
  assert.equal(process.env.PGDATABASE || 'pr352_bridge_isolated', 'pr352_bridge_isolated', 'Use the dedicated disposable database');
  const endpoint = await query("select current_database()||'|'||current_setting('server_version_num')");
  assert.equal(endpoint, 'pr352_bridge_isolated|170006', 'Expected the disposable PostgreSQL 17.6 service');
  serverVersionNum = endpoint.split('|')[1];
  const initialTables = await query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private','auth') and c.relkind in ('r','p')");
  assert.equal(initialTables, '0', 'Database must be empty before fixture installation');
  process.stdout.write(`PG176_ENDPOINT_PASS ${endpoint}\n`);
  passed('loopback disposable PostgreSQL 17.6 endpoint', { serverVersionNum });

  currentStage = 'install audited schema and function sources';
  await runFile(path.join(fixture, '01-schema.sql'), '01-schema.sql');
  const functionSources = JSON.parse(await readFile(path.join(fixture, '02-function-sources.json'), 'utf8'));
  if (!tempRoot) tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pr352-bridge-pg176-'));
  const generatedPath = path.join(tempRoot, 'production-function-snapshot.sql');
  await writeFile(generatedPath, '\\set ON_ERROR_STOP on\nSET check_function_bodies = off;\n' + functionSources.map((source) => `${source};`).join('\n'));
  await runFile(generatedPath, '02-function-sources.sql');
  for (const file of ['03-trigger-dependencies.sql', '04-constraints-indexes-triggers.sql', '05-policies.sql', '06-function-acl.sql']) {
    await runFile(path.join(fixture, file), file);
  }
  await runFile(restaurantDependenciesFixture, 'isolated nonfinancial Restaurant dependency stubs');
  await runFile(restaurantWritersFixture, 'audited Restaurant writer definitions');
  const expectedHashes = JSON.parse(await readFile(path.join(fixture, 'function-hashes.json'), 'utf8'));
  const functionNames = [...new Set(expectedHashes.map((row) => row.proname))];
  const namesSql = functionNames.map((name) => `'${name.replaceAll("'", "''")}'`).join(',');
  const actualHashes = JSON.parse(await query(`select coalesce(json_agg(json_build_object(
    'nspname',n.nspname,'proname',p.proname,'args',pg_get_function_identity_arguments(p.oid),
    'md5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
    'sha256',encode(extensions.digest(replace(pg_get_functiondef(p.oid),chr(13),''),'sha256'),'hex')
  ) order by n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::json)::text
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.proname in (${namesSql})`));
  assert.deepEqual(actualHashes, expectedHashes, 'Function source differs from its reviewed fixture');
  process.stdout.write(`REAL_FUNCTION_SNAPSHOT_PASS ${expectedHashes.length}\n`);
  passed('financial schema and captured function snapshot installed', { functionCount: expectedHashes.length });

  currentStage = 'apply 3D.14';
  await runFile(threeD14Path, '3D.14');
  const dispatcherAfterThreeD14 = (await captureFunctions([
    'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)',
  ]))[0];
  const dispatcherManifest = JSON.parse(await readFile(dispatcherManifestPath, 'utf8'));
  assert.equal(dispatcherManifest.postgresServerVersionNum, '170006');
  assert.equal(dispatcherManifest.rawDataIncluded, false);
  assert.equal(dispatcherManifest.credentialsIncluded, false);
  assert.equal(dispatcherManifest.entry.signature, dispatcherAfterThreeD14.signature);
  const threeD14MatchesCurrentProduction = dispatcherAfterThreeD14.sha256 === dispatcherManifest.entry.sha256;
  process.stdout.write(`THREED14_DISPATCHER_FINGERPRINT ${threeD14MatchesCurrentProduction ? 'MATCH' : 'DIVERGENCE'} applied=${dispatcherAfterThreeD14.sha256} production=${dispatcherManifest.entry.sha256}\n`);
  assert.equal(threeD14MatchesCurrentProduction, true,
    'The applied 3D.14 dispatcher body must match the current read-only Production fingerprint');
  passed('authentic 3D.14 dispatcher fingerprint matches reviewed read-only fingerprint', { sha256: dispatcherAfterThreeD14.sha256 });
  await runFile(path.join(fixture, 'seed-attempt-2.sql'), 'synthetic actors');
  const threeD14Functions = [
    'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)',
    'public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)',
  ];
  const allFunctionSignatures = [...new Set([...targetFunctions.map((row) => row.signature), ...threeD14Functions])];
  const beforeBridge = await captureFunctions(allFunctionSignatures);
  assert.equal(beforeBridge.length, allFunctionSignatures.length, 'Every exact 3D.14 target must exist before bridge installation');
  const writerManifest = JSON.parse(await readFile(restaurantWritersManifestPath, 'utf8'));
  assert.equal(writerManifest.rawDataIncluded, false);
  assert.equal(writerManifest.credentialsIncluded, false);
  assert.equal(writerManifest.entries.length, 6, 'Expected all six audited Restaurant writer definitions');
  const beforeBySignature = new Map(beforeBridge.map((row) => [row.signature, row]));
  for (const signature of threeD14Functions.slice(1)) {
    assert.match(beforeBySignature.get(signature).definition, /private\.assert_restaurant_sale_dispatcher_context_v1/,
      `Actual 3D.14 wrapper guard must be present before bridge: ${signature}`);
  }
  const liveDispatcher = beforeBySignature.get(dispatcherManifest.entry.signature);
  assert.equal(liveDispatcher.sha256, dispatcherManifest.entry.sha256, 'Bridge test must use the current read-only Production dispatcher body');
  assert.equal(liveDispatcher.owner, dispatcherManifest.entry.owner);
  assert.equal(liveDispatcher.security_definer, dispatcherManifest.entry.securityDefiner);
  assert.deepEqual(liveDispatcher.config, dispatcherManifest.entry.config);
  assert.deepEqual(canonicalizePostgresAcl(liveDispatcher.acl), canonicalizePostgresAcl(dispatcherManifest.entry.acl),
    '3D.14 dispatcher ACL grants differ from the reviewed Production snapshot');
  for (const expected of writerManifest.entries) {
    const actual = beforeBySignature.get(expected.signature);
    assert.ok(actual, `Missing current Production writer ${expected.signature}`);
    assert.equal(actual.sha256, expected.sha256, `Writer source fingerprint mismatch: ${expected.signature}`);
    assert.equal(actual.owner, expected.owner, `Production writer owner mismatch: ${expected.signature}`);
    assert.equal(actual.security_definer, expected.securityDefiner, `Production writer SECURITY DEFINER mismatch: ${expected.signature}`);
    assert.deepEqual(actual.config, expected.config, `Production writer settings mismatch: ${expected.signature}`);
    assert.deepEqual(canonicalizePostgresAcl(actual.acl), canonicalizePostgresAcl(expected.acl),
      `Production writer ACL mismatch: ${expected.signature}`);
  }
  assert.deepEqual(new Set(writerManifest.entries.map((row) => row.signature)), new Set([
    'private.recalculate_restaurant_order_status(uuid,text)',
    'public.pos_archive_restaurant_order_unlimited(text,text,text,text,text,text,jsonb,text)',
    'public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text)',
    'public.pos_update_restaurant_order_item_status_unlimited(text,text,text,text,text,text,text,text)',
    'public.pos_update_restaurant_order_status_unlimited(text,text,text,text,text,text,text)',
    'public.pos_upsert_restaurant_order_unlimited(text,text,text,text,jsonb,jsonb,text)',
  ]));
  process.stdout.write(`VERIFIED_RESTAURANT_WRITERS_PASS ${writerManifest.entries.length}\n`);
  passed('six authentic Restaurant writer bodies and security metadata match fingerprints', { writerCount: writerManifest.entries.length });

  currentStage = 'apply forward bridge migration';
  if (!tempRoot) tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pr352-bridge-pg176-'));
  const rollbackPath = path.join(tempRoot, 'bridge-v1-deliberate-rollback.sql');
  const bridgeSource = await readFile(bridgePath, 'utf8');
  await writeFile(rollbackPath, `${bridgeSource}\nDO $rollback_probe$ BEGIN RAISE EXCEPTION 'PR352_BRIDGE_ROLLBACK_PROBE' USING ERRCODE='P0001'; END $rollback_probe$;\n`);
  await runExpectedRollback(rollbackPath, 'PR352_BRIDGE_ROLLBACK_PROBE');
  assert.equal(await query("select count(*) from pg_class where oid in (to_regclass('private.restaurant_cloud_contract_state'),to_regclass('private.restaurant_admin_activation'),to_regclass('private.restaurant_bridge_cancel_permits'))"), '0',
    'Failed bridge migration must leave no created private tables');
  assert.equal(await query(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='private' and p.proname in ('enter_restaurant_transition_write_v1','set_restaurant_transition_policy_v1',
      'restaurant_admin_supervision_enabled_v1','assert_restaurant_bridge_actor_v1','prepare_restaurant_bridge_upsert_v1',
      'enter_restaurant_financial_transition_write_v1','prepare_restaurant_bridge_cancel_v1',
      'guard_restaurant_bridge_parent_v1','cleanup_restaurant_bridge_cancel_permit_v1'))
      or (n.nspname='public' and p.proname in ('pos_restaurant_cloud_contract_v1',
        'pos_restaurant_transition_table_capabilities_v1','pos_upsert_restaurant_order_versioned_v1'))`), '0',
    'Failed bridge transaction must remove every newly created bridge function and grant surface');
  const afterRollback = await captureFunctions(allFunctionSignatures);
  assert.deepEqual(summarizeFunctionRows(afterRollback), summarizeFunctionRows(beforeBridge),
    'Failed bridge migration must restore all function definitions and metadata fingerprints');
  assert.equal(await query("select count(*) from pg_trigger where tgname in ('restaurant_bridge_terminal_guard_v1','restaurant_bridge_cancel_permit_cleanup_v1') and not tgisinternal"), '0');
  process.stdout.write('BRIDGE_MIGRATION_TRANSACTION_ROLLBACK_PASS\n');
  passed('bridge installation transaction fully rolls back after induced failure');

  await runFile(bridgePath, 'bridge-v1');
  const afterBridge = await captureFunctions(allFunctionSignatures);
  assert.equal(afterBridge.length, beforeBridge.length, 'Bridge changed the number of protected functions');
  const afterBySignature = new Map(afterBridge.map((row) => [row.signature, row]));
  for (const target of targetFunctions) {
    const before = beforeBySignature.get(target.signature);
    const after = afterBySignature.get(target.signature);
    const insertion = `\n  ${target.instruction}`;
    const recoveredDefinition = after?.definition?.replace(insertion, '');
    const writerCheck = {
      signature: target.signature,
      originalFingerprint: before?.sha256 ?? null,
      postBridgeFingerprint: after?.sha256 ?? null,
      admissionInstruction: target.instruction,
      admissionOccurrences: after?.definition ? after.definition.split(target.instruction).length - 1 : 0,
      insertionPoint: 'first lexical outer BEGIN token identified by the migration scanner',
      bodyRecoveredExactly: recoveredDefinition === before?.definition,
      oidPreserved: after?.oid === before?.oid,
      ownerPreserved: after?.owner === before?.owner,
      securityDefinerPreserved: after?.security_definer === before?.security_definer,
      configurationPreserved: JSON.stringify(after?.config) === JSON.stringify(before?.config),
      aclSemanticallyPreserved: Boolean(before && after)
        && JSON.stringify(canonicalizePostgresAcl(after.acl)) === JSON.stringify(canonicalizePostgresAcl(before.acl)),
      status: 'FAIL',
    };
    try {
      assert.ok(before && after, `Missing function ${target.signature}`);
      assert.equal(after.oid, before.oid, `Function OID/dependencies changed for ${target.signature}`);
      assert.equal(after.owner, before.owner, `Owner changed for ${target.signature}`);
      assert.equal(after.security_definer, before.security_definer, `SECURITY DEFINER changed for ${target.signature}`);
      assert.deepEqual(after.config, before.config, `Function settings changed for ${target.signature}`);
      assert.deepEqual(canonicalizePostgresAcl(after.acl), canonicalizePostgresAcl(before.acl),
        `Function ACL grants changed for ${target.signature}`);
      assert.equal(writerCheck.admissionOccurrences, 1, `Admission statement missing or duplicated in ${target.signature}`);
      if (!writerCheck.bodyRecoveredExactly) {
        writerCheck.firstDifference = firstTextDifference(before.definition, recoveredDefinition);
        throw new Error(`Exact original body reconstruction failed for ${target.signature} at offset ${writerCheck.firstDifference?.offset ?? 'unknown'}`);
      }
      writerCheck.status = 'PASS';
    } catch (error) {
      writerCheck.failure = String(error.message || error).slice(0, 500);
      writerChecks.push(writerCheck);
      throw error;
    }
    writerChecks.push(writerCheck);
  }
  for (const signature of threeD14Functions.slice(1)) {
    if (afterBySignature.get(signature).definition !== beforeBySignature.get(signature).definition) {
      throw new Error(`3D.14 legacy guard body changed for ${signature}`);
    }
  }
  process.stdout.write(`BRIDGE_FUNCTION_INSTRUMENTATION_PASS ${targetFunctions.length}\n`);
  passed('bridge preserves function OIDs, owners, SECURITY DEFINER, settings, ACL and business bodies', { instrumentedFunctions: targetFunctions.length });

  currentStage = 'verify bridge ACL, RLS and default contract';
  const tableState = await query(`select json_agg(json_build_object(
    'name',c.relname,'rls',c.relrowsecurity,
    'anon_select',has_table_privilege('anon',c.oid,'select'),
    'authenticated_select',has_table_privilege('authenticated',c.oid,'select')
  ) order by c.relname)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('restaurant_cloud_contract_state','restaurant_admin_activation','restaurant_bridge_cancel_permits')`);
  const tables = JSON.parse(tableState);
  assert.equal(tables.length, 3, 'All private bridge tables must be installed');
  assert.ok(tables.every((row) => row.rls && !row.anon_select && !row.authenticated_select), 'Bridge tables must be RLS protected and unreadable to browser roles');
  const adminState = JSON.parse(await query(`select json_build_object(
    'contractVersion',s.contract_version,
    'writesPaused',s.writes_paused,
    'activeActivationRows',(select count(*) from private.restaurant_admin_activation)
  )::text from private.restaurant_cloud_contract_state s where singleton`));
  assert.deepEqual(adminState, { contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
    'Bridge must start at v1, unpaused and with Admin disabled');
  adminOffEvidence = { status: 'INCOMPLETE', initialState: adminState };
  passed('admin-off-initial-state', adminState);
  const contract = JSON.parse(await query("set role anon; select public.pos_restaurant_cloud_contract_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session')::text; reset role;"));
  assert.deepEqual({
    success: contract.success,
    contractVersion: contract.contractVersion,
    minimumSupportedClientVersion: contract.minimumSupportedClientVersion,
    strictParentVersionRequired: contract.strictParentVersionRequired,
    versionedWritesAvailable: contract.versionedWritesAvailable,
    versionedParentVersionRequired: contract.versionedParentVersionRequired,
    adminSupervisionAvailable: contract.adminSupervisionAvailable,
    legacyWritesAllowed: contract.legacyWritesAllowed,
    kitchenTerminalGuardEnabled: contract.kitchenTerminalGuardEnabled,
    writesPaused: contract.writesPaused,
    serverCapabilityGeneration: contract.serverCapabilityGeneration,
  }, {
    success: true,
    contractVersion: 1,
    minimumSupportedClientVersion: 1,
    strictParentVersionRequired: false,
    versionedWritesAvailable: true,
    versionedParentVersionRequired: true,
    adminSupervisionAvailable: false,
    legacyWritesAllowed: true,
    kitchenTerminalGuardEnabled: true,
    writesPaused: false,
    serverCapabilityGeneration: '1:0',
  }, 'The v1 bridge response must satisfy both legacy and versioned client negotiation while Admin stays unavailable');
  adminOffEvidence.contractResponse = {
    success: contract.success,
    contractVersion: contract.contractVersion,
    writesPaused: contract.writesPaused,
    adminSupervisionAvailable: contract.adminSupervisionAvailable,
  };
  passed('admin-off-contract-response', adminOffEvidence.contractResponse);
  let setterError = null;
  try {
    await runPsql(['-v', 'VERBOSITY=verbose', '-c', `begin; select private.set_restaurant_transition_policy_v1(false,'00000000-0000-0000-0000-000000000001',true); rollback;`]);
  } catch (error) {
    const detail = String(error.stderr || error.message || '');
    const match = detail.match(/ERROR:\s*(P0001):\s*(RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE)\b/);
    if (!match) throw new Error(`Admin activation setter failed unexpectedly: ${detail.slice(0, 800)}`);
    setterError = { sqlstate: match[1], message: match[2] };
  }
  assert.deepEqual(setterError, { sqlstate: 'P0001', message: 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE' },
    'The Admin activation setter must reject activation while the v1 backend is active');
  const adminStateAfterSetter = JSON.parse(await query(`select json_build_object(
    'contractVersion',s.contract_version,
    'writesPaused',s.writes_paused,
    'activeActivationRows',(select count(*) from private.restaurant_admin_activation)
  )::text from private.restaurant_cloud_contract_state s where singleton`));
  assert.deepEqual(adminStateAfterSetter, adminState,
    'The rejected Admin activation attempt must leave the bridge state unchanged');
  adminOffEvidence.setterAttempt = {
    attempted: true,
    rejected: setterError !== null,
    errorMessage: setterError.message,
    sqlstate: setterError.sqlstate,
    stateBefore: adminState,
    stateAfter: adminStateAfterSetter,
  };
  passed('admin-off-setter-rejected-no-state-change', adminOffEvidence.setterAttempt);
  process.stdout.write('BRIDGE_RLS_ACL_V1_ADMIN_OFF_PASS\n');
  const privilegeMatrix = await query(`select json_build_object(
    'anonContract',has_function_privilege('anon','public.pos_restaurant_cloud_contract_v1(text,text,text,text)','EXECUTE'),
    'authenticatedContract',has_function_privilege('authenticated','public.pos_restaurant_cloud_contract_v1(text,text,text,text)','EXECUTE'),
    'anonVersionedUpsert',has_function_privilege('anon','public.pos_upsert_restaurant_order_versioned_v1(text,text,text,text,jsonb,jsonb,text)','EXECUTE'),
    'authenticatedVersionedUpsert',has_function_privilege('authenticated','public.pos_upsert_restaurant_order_versioned_v1(text,text,text,text,jsonb,jsonb,text)','EXECUTE'),
    'anonPolicySetter',has_function_privilege('anon','private.set_restaurant_transition_policy_v1(boolean,uuid,boolean)','EXECUTE'),
    'authenticatedPolicySetter',has_function_privilege('authenticated','private.set_restaurant_transition_policy_v1(boolean,uuid,boolean)','EXECUTE'))::text`);
  const privileges = JSON.parse(privilegeMatrix);
  assert.deepEqual(privileges, {
    anonContract: true,
    authenticatedContract: true,
    anonVersionedUpsert: true,
    authenticatedVersionedUpsert: true,
    anonPolicySetter: false,
    authenticatedPolicySetter: false,
  }, 'Public client grants and private policy setter isolation must match the contract');
  const roleDenials = [];
  for (const role of ['anon', 'authenticated']) {
    let denial = null;
    try {
      await runPsql(['-v', 'VERBOSITY=verbose', '-c', `set role ${role}; select private.set_restaurant_transition_policy_v1(true,null,null);`]);
    } catch (error) {
      const detail = String(error.stderr || error.message || '');
      const match = detail.match(/ERROR:\s*([0-9A-Z]{5}):\s*(permission denied for (?:schema private|function set_restaurant_transition_policy_v1))\b/);
      if (!match) throw new Error(`Browser role ${role} setter denial was unexpected: ${detail.slice(0, 800)}`);
      denial = { role, denialSqlstate: match[1], denialMessage: match[2] };
    }
    assert.ok(denial, `Browser role ${role} must not execute the private Admin setter`);
    assert.equal(denial.denialSqlstate, '42501', `Browser role ${role} must be denied by PostgreSQL ACL`);
    const stateAfterDenial = JSON.parse(await query(`select json_build_object(
      'contractVersion',s.contract_version,
      'writesPaused',s.writes_paused,
      'activeActivationRows',(select count(*) from private.restaurant_admin_activation)
    )::text from private.restaurant_cloud_contract_state s where singleton`));
    assert.deepEqual(stateAfterDenial, adminState, `Browser role ${role} denial must have no Admin state effects`);
    const roleEvidence = { ...denial, stateAfter: stateAfterDenial };
    roleDenials.push(roleEvidence);
    passed(`admin-off-private-setter-denied-${role}`, roleEvidence);
  }
  adminOffEvidence.roleMatrix = {
    anonCanExecuteSetter: privileges.anonPolicySetter,
    authenticatedCanExecuteSetter: privileges.authenticatedPolicySetter,
    denials: roleDenials,
  };
  assert.equal(adminOffEvidence.roleMatrix.anonCanExecuteSetter, false);
  assert.equal(adminOffEvidence.roleMatrix.authenticatedCanExecuteSetter, false);
  assert.deepEqual(roleDenials.map(({ role, denialSqlstate, denialMessage }) => ({ role, denialSqlstate, denialMessage })), [
    { role: 'anon', denialSqlstate: '42501', denialMessage: roleDenials[0].denialMessage },
    { role: 'authenticated', denialSqlstate: '42501', denialMessage: roleDenials[1].denialMessage },
  ]);
  adminOffEvidence.status = 'PASS';
  passed('anon/authenticated public grants and private policy setter denial verified', { privilegeMatrix: privileges });

  currentStage = 'Staff ownership and invalid session authorization';
  const ownedOrder = 'bridge-staff-owned-parent';
  await runSql(`select public.pos_upsert_restaurant_order_unlimited(
    'lab-license-a','lab-device-b','lab-device-token-b','lab-staff-session',
    jsonb_build_object('localOrderId','${ownedOrder}','tableLabel','Staff owned','status','pending',
      'fulfillmentStatus','pending','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','${ownedOrder}-line','productId','bridge-restaurant-product',
      'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    'r6-staff-owner-seed');`, 'staff-owner-seed');
  const staffOwner = await query(`select created_by_staff_user_id::text||'|'||created_by_device_id::text
    from public.pos_restaurant_orders where local_order_id='${ownedOrder}'`);
  assert.equal(staffOwner, '00000000-0000-0000-0000-0000000000ab|00000000-0000-0000-0000-00000000000b');
  await runSql(`do $owner$ declare state text; message text; begin
    begin perform public.pos_upsert_restaurant_order_unlimited(
      'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
      jsonb_build_object('localOrderId','${ownedOrder}','tableLabel','Admin non-owner','status','pending',
        'fulfillmentStatus','pending','subtotal',10,'total',10),
      jsonb_build_array(jsonb_build_object('localLineId','${ownedOrder}-line','productId','bridge-restaurant-product',
        'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
      'r6-admin-non-owner');
      raise exception 'R6_ADMIN_NON_OWNER_UNEXPECTEDLY_ALLOWED';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if message='R6_ADMIN_NON_OWNER_UNEXPECTEDLY_ALLOWED' then raise; end if;
      if state<>'P0001' or message<>'RESTAURANT_TABLE_OWNER_REQUIRED' then raise; end if;
    end;
  end $owner$;`, 'admin-owner-denied');
  await runSql(`insert into public.license_devices(id,license_id,device_fingerprint,security_token,is_active,device_mode,device_role)
      values ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000001','lab-device-c','lab-device-token-c',true,'staff_only','staff');
    insert into public.license_staff_users(id,license_id,username,display_name,password_hash,role_name,permissions,is_active)
      values ('00000000-0000-0000-0000-0000000000ac','00000000-0000-0000-0000-000000000001','lab-staff-c','Lab Staff C',
        extensions.crypt('lab-only',extensions.gen_salt('bf')),'staff','{"pos":true}'::jsonb,true);
    insert into public.license_staff_sessions(id,license_id,staff_user_id,device_id,session_token_hash,expires_at,last_seen_at)
      values ('00000000-0000-0000-0000-0000000000c3','00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000ac','00000000-0000-0000-0000-00000000000c',
        extensions.crypt('lab-staff-session-c',extensions.gen_salt('bf')),now()+interval '1 day',now());`, 'second-synthetic-staff');
  await runSql(`do $owner$ declare state text; message text; begin
    begin perform public.pos_upsert_restaurant_order_unlimited(
      'lab-license-a','lab-device-c','lab-device-token-c','lab-staff-session-c',
      jsonb_build_object('localOrderId','${ownedOrder}','tableLabel','Staff C non-owner','status','pending',
        'fulfillmentStatus','pending','subtotal',10,'total',10),
      jsonb_build_array(jsonb_build_object('localLineId','${ownedOrder}-line','productId','bridge-restaurant-product',
        'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
      'r6-staff-c-non-owner');
      raise exception 'R6_STAFF_NON_OWNER_UNEXPECTEDLY_ALLOWED';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if message='R6_STAFF_NON_OWNER_UNEXPECTEDLY_ALLOWED' then raise; end if;
      if state<>'P0001' or message<>'RESTAURANT_TABLE_OWNER_REQUIRED' then raise; end if;
    end;
  end $owner$;`, 'staff-non-owner-denied');
  await runSql(`do $session$ declare state text; message text; begin
    begin perform public.pos_upsert_restaurant_order_unlimited(
      'lab-license-a','lab-device-b','lab-device-token-b','wrong-session',
      jsonb_build_object('localOrderId','bridge-invalid-session-parent','tableLabel','Invalid session','status','pending',
        'fulfillmentStatus','pending','subtotal',10,'total',10),
      jsonb_build_array(jsonb_build_object('localLineId','bridge-invalid-session-line','productId','bridge-restaurant-product',
        'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
      'r6-invalid-session');
      raise exception 'R6_INVALID_SESSION_UNEXPECTEDLY_ALLOWED';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if message='R6_INVALID_SESSION_UNEXPECTEDLY_ALLOWED' then raise; end if;
      if state not in ('P0001','42501') then raise; end if;
    end;
  end $session$;`, 'invalid-session-rejected');
  assert.equal(await query("select count(*) from public.pos_restaurant_orders where local_order_id='bridge-invalid-session-parent'"), '0');
  passed('Staff owner admitted; Admin and another Staff denied while Admin remains OFF; invalid session has no effect');

  currentStage = 'unrelated financial operation';
  await runFile(path.join(fixture, 'ordinary-sale.sql'), 'ordinary sale and replay');
  process.stdout.write('BRIDGE_UNRELATED_FINANCIAL_OPERATION_PASS\n');

  currentStage = 'synthetic Restaurant parent setup';
  await runSql(`begin;
    insert into public.pos_products(id,license_id,name,name_key,price,cost,stock,track_stock)
      values ('bridge-restaurant-product','00000000-0000-0000-0000-000000000001','Bridge synthetic product','bridge synthetic product',10,4,20,true);
    insert into public.pos_restaurant_orders(id,license_id,local_order_id,table_label,status,fulfillment_status,subtotal,total,updated_at)
      values ('bridge-restaurant-row-a','00000000-0000-0000-0000-000000000001','bridge-restaurant-a','Bridge A','ready','ready',20,20,'2026-10-30T00:00:00Z'),
             ('bridge-restaurant-row-b','00000000-0000-0000-0000-000000000001','bridge-restaurant-b','Bridge B','ready','ready',20,20,'2026-10-30T00:00:00Z');
    insert into public.pos_restaurant_order_items(id,license_id,restaurant_order_id,local_line_id,product_id,product_name,quantity,unit_price,line_total)
      values ('bridge-restaurant-item-a','00000000-0000-0000-0000-000000000001','bridge-restaurant-row-a','bridge-restaurant-line-a','bridge-restaurant-product','Bridge synthetic product',2,10,20);
    commit;`, 'seed-restaurant');

  currentStage = 'legacy and versioned client writes while bridge remains v1';
  const legacyUpsertSql = `set role service_role; select public.pos_upsert_restaurant_order_unlimited(
    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
    jsonb_build_object('localOrderId','bridge-legacy-client','tableLabel','Legacy client','status','pending',
      'fulfillmentStatus','pending','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','bridge-legacy-line','productId','bridge-restaurant-product',
      'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    'bridge-legacy-client-upsert')::text; reset role;`;
  const legacyUpsert = JSON.parse(await query(legacyUpsertSql));
  assert.equal(legacyUpsert.success, true, 'Old client payload without a contract-version marker must remain admitted in v1');
  const legacyReplay = JSON.parse(await query(legacyUpsertSql));
  assert.deepEqual(legacyReplay, legacyUpsert, 'A legitimate legacy replay must recover the exact receipt');
  assert.equal(await query("select count(*) from public.pos_restaurant_orders where local_order_id='bridge-legacy-client'"), '1');
  assert.equal(await query("select count(*) from public.pos_restaurant_order_items i join public.pos_restaurant_orders o on o.id=i.restaurant_order_id where o.local_order_id='bridge-legacy-client'"), '1');
  const versionedUpsertSql = `set role anon; select public.pos_upsert_restaurant_order_versioned_v1(
    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
    jsonb_build_object('localOrderId','bridge-versioned-client','clientContractVersion',2,'tableLabel','Versioned client',
      'status','pending','fulfillmentStatus','pending','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','bridge-versioned-line','productId','bridge-restaurant-product',
      'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    'bridge-versioned-client-upsert')::text; reset role;`;
  const versionedUpsert = JSON.parse(await query(versionedUpsertSql));
  assert.equal(versionedUpsert.success, true, 'New client contract version 2 payload must remain admitted during bridge v1');
  const versionedReplay = JSON.parse(await query(versionedUpsertSql));
  assert.deepEqual(versionedReplay, versionedUpsert, 'A legitimate versioned replay must recover the exact receipt');
  assert.equal(await query("select count(*) from public.pos_restaurant_orders where local_order_id='bridge-versioned-client'"), '1');
  process.stdout.write('BRIDGE_OLD_AND_NEW_CLIENTS_PASS legacy=accepted versioned_v2_payload=accepted bridge_contract=v1\n');

  currentStage = 'contradictory aliases';
  await runSql(`do $test$ declare req jsonb; h text; message text; state text; begin
    req:=jsonb_build_object('cash_session_id','lab-cash-a',
      'sale',jsonb_build_object('id','bridge-restaurant-a','subtotal',20,'total',20,'payment_method','cash','amount_paid',20,'balance_due',0,'change_amount',0),
      'items',jsonb_build_array(jsonb_build_object('id','bridge-alias-item','product_id','bridge-restaurant-product','product_name','Bridge synthetic product','quantity',2,'unit_price',10,'line_subtotal',20,'line_total',20)),
      'payments',jsonb_build_array(jsonb_build_object('id','bridge-alias-payment','method','cash','amount',20,'received_amount',20,'change_amount',0)),
      'restaurant_settlement',jsonb_build_object('parent_order_id','bridge-restaurant-b','parent_order_version','2026-10-30T00:00:00Z'));
    h:=private.financial_operation_hash('sale.cashier_inventory',private.canonical_financial_request_v1('sale.cashier_inventory',req),
      'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a');
    begin perform public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
      'bridge-alias-contradiction',h,'sale.cashier_inventory',req);
      raise exception 'CONTRADICTORY_PARENT_ALIAS_ACCEPTED';
    exception when others then get stacked diagnostics message=message_text, state=returned_sqlstate;
      if state<>'P0001' or message<>'RESTAURANT_ORDER_CONTEXT_MISMATCH' then raise; end if;
    end;
    if exists(select 1 from public.pos_financial_operations where legacy_idempotency_key='bridge-alias-contradiction')
      or exists(select 1 from public.pos_sales where id='bridge-restaurant-a')
      or exists(select 1 from public.pos_restaurant_orders where local_order_id in ('bridge-restaurant-a','bridge-restaurant-b') and payment_status='paid') then
      raise exception 'CONTRADICTORY_ALIAS_CAUSED_FINANCIAL_EFFECT';
    end if;
  end $test$;`, 'contradictory-aliases');
  process.stdout.write('BRIDGE_ALIAS_CONTRADICTION_PASS SQLSTATE=P0001 message=RESTAURANT_ORDER_CONTEXT_MISMATCH effects=0\n');

  currentStage = 'paused transition blocks a new Restaurant operation';
  await runSql('select private.set_restaurant_transition_policy_v1(true,null,null);', 'pause-transition');
  await runSql(`do $test$ declare req jsonb; message text; state text; begin
    req:=jsonb_build_object('cash_session_id','lab-cash-a',
      'sale',jsonb_build_object('id','bridge-restaurant-a','subtotal',20,'total',20,'payment_method','cash','amount_paid',20,'balance_due',0,'change_amount',0),
      'items',jsonb_build_array(jsonb_build_object('id','bridge-pause-item','product_id','bridge-restaurant-product','product_name','Bridge synthetic product','quantity',2,'unit_price',10,'line_subtotal',20,'line_total',20)),
      'payments',jsonb_build_array(jsonb_build_object('id','bridge-pause-payment','method','cash','amount',20,'received_amount',20,'change_amount',0)),
      'restaurant_settlement',jsonb_build_object('parent_order_id','bridge-restaurant-a','parent_order_version','2026-10-30T00:00:00Z'));
    begin perform public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
      'bridge-paused-write',repeat('0',64),'sale.cashier_inventory',req);
      raise exception 'PAUSED_RESTAURANT_WRITE_ACCEPTED';
    exception when others then get stacked diagnostics message=message_text, state=returned_sqlstate;
      if state<>'P0001' or message<>'RESTAURANT_CONTRACT_MAINTENANCE' then raise; end if;
    end;
    if exists(select 1 from public.pos_financial_operations where legacy_idempotency_key='bridge-paused-write')
      or exists(select 1 from public.pos_sales where id='bridge-restaurant-a') then
      raise exception 'PAUSED_RESTAURANT_WRITE_CAUSED_FINANCIAL_EFFECT';
    end if;
  end $test$;`, 'paused-write-rejected');
  await runSql('select private.set_restaurant_transition_policy_v1(false,null,null);', 'resume-transition');
  process.stdout.write('BRIDGE_PAUSE_REJECTION_PASS SQLSTATE=P0001 message=RESTAURANT_CONTRACT_MAINTENANCE effects=0\n');

  currentStage = 'cutover concurrency and unrelated rubric operation';
  concurrencyResults = await runRestaurantCutoverConcurrency({
    query,
    psqlBin,
    env,
    createLegacyOrder,
    runOtherRubricOperation: async () => {
      await runSql(`do $other$ declare req jsonb; h text; receipt jsonb; begin
        req:=jsonb_build_object('cash_session_id','lab-cash-a',
          'sale',jsonb_build_object('id','lab-ordinary-during-pause','subtotal',10,'total',10,
            'payment_method','cash','amount_paid',10,'balance_due',0,'change_amount',0),
          'items',jsonb_build_array(jsonb_build_object('id','lab-ordinary-during-pause-item',
            'product_id','lab-ordinary-product','product_name','Synthetic ordinary product',
            'quantity',1,'unit_price',10,'line_subtotal',10,'line_total',10)),
          'payments',jsonb_build_array(jsonb_build_object('id','lab-ordinary-during-pause-payment',
            'method','cash','amount',10,'received_amount',10,'change_amount',0)));
        h:=private.financial_operation_hash('sale.cashier_inventory',
          private.canonical_financial_request_v1('sale.cashier_inventory',req),
          'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a');
        receipt:=public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a',
          'lab-admin-session','lab-ordinary-during-pause-key',h,'sale.cashier_inventory',req);
        if coalesce((receipt->>'success')::boolean,false) is not true then raise exception 'R6_OTHER_RUBRIC_SALE_FAILED'; end if;
      end $other$;`, 'other-rubric-sale-during-pause');
    },
  });
  assert.equal(concurrencyResults.length, 4, 'All cutover, other-rubric and replay scenarios must execute');
  passed('cutover lock, concurrent commit/rollback, paused write rejection, replay and unrelated sale scenarios completed', {
    scenarios: concurrencyResults.map((row) => ({ name: row.name, status: row.status })),
  });

  currentStage = 'Restaurant financial settlement and replay';
  await runSql(`do $test$ declare req jsonb; h text; first_receipt jsonb; replay_receipt jsonb; begin
    req:=jsonb_build_object('cash_session_id','lab-cash-a',
      'sale',jsonb_build_object('id','bridge-restaurant-a','subtotal',20,'total',20,'payment_method','cash','amount_paid',20,'balance_due',0,'change_amount',0),
      'items',jsonb_build_array(jsonb_build_object('id','bridge-settlement-item','product_id','bridge-restaurant-product','product_name','Bridge synthetic product','quantity',2,'unit_price',10,'line_subtotal',20,'line_total',20)),
      'payments',jsonb_build_array(jsonb_build_object('id','bridge-settlement-payment','method','cash','amount',20,'received_amount',20,'change_amount',0)),
      'restaurant_settlement',jsonb_build_object('parent_order_id','bridge-restaurant-a','parent_order_version','2026-10-30T00:00:00Z'));
    h:=private.financial_operation_hash('sale.cashier_inventory',private.canonical_financial_request_v1('sale.cashier_inventory',req),
      'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a');
    first_receipt:=public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
      'bridge-restaurant-settlement',h,'sale.cashier_inventory',req);
    replay_receipt:=public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
      'bridge-restaurant-settlement',h,'sale.cashier_inventory',req);
    if first_receipt is distinct from replay_receipt or coalesce((first_receipt->>'success')::boolean,false) is not true then
      raise exception 'BRIDGE_SETTLEMENT_RECEIPT_REPLAY_FAILED';
    end if;
    if (select count(*) from public.pos_sales where id='bridge-restaurant-a')<>1
      or (select count(*) from public.pos_sale_payments where sale_id='bridge-restaurant-a')<>1
      or (select count(*) from public.pos_financial_operations where legacy_idempotency_key='bridge-restaurant-settlement')<>1
      or (select count(*) from public.pos_inventory_movements where product_id='bridge-restaurant-product')<>1
      or not exists(select 1 from public.pos_restaurant_orders where local_order_id='bridge-restaurant-a'
        and payment_status='paid' and paid_sale_id='bridge-restaurant-a') then
      raise exception 'BRIDGE_SETTLEMENT_EFFECT_COUNT_MISMATCH';
    end if;
  end $test$;`, 'restaurant-settlement-replay');
  process.stdout.write('BRIDGE_RESTAURANT_SETTLEMENT_REPLAY_PASS receipts=identical sales=1 payments=1 inventory_movements=1 parent=paid\n');

  currentStage = 'final disposable database checks';
  assert.equal(await query("select contract_version||'|'||writes_paused||'|'||(select count(*) from private.restaurant_admin_activation) from private.restaurant_cloud_contract_state where singleton"), '1|false|0');
  assert.equal(await query("select count(*) from pg_stat_activity where datname='pr352_bridge_isolated' and pid<>pg_backend_pid()"), '0', 'No child database sessions may remain');
  process.stdout.write('PR352_FORWARD_BRIDGE_PG176_PASS\n');
  passed('bridge integration assertions and zero-session cleanup complete');
}

run().catch((error) => {
  failure = error;
  process.stderr.write(`PR352_FORWARD_BRIDGE_PG176_FAIL stage=${currentStage}\n${error.stack || error.message}\n`);
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
  } catch (error) {
    failure ||= error;
    process.exitCode = 1;
    process.stderr.write(`PR352_FORWARD_BRIDGE_TEMP_CLEANUP_FAIL ${error.message}\n`);
  }
  bridgeStatus = failure ? 'FAIL' : 'PASS';
  try {
    await writeEvidence();
    process.stdout.write(`PR352_FORWARD_BRIDGE_STRUCTURED_EVIDENCE ${bridgeStatus} ${path.join(evidenceDirectory(), 'real-bridge.json')}\n`);
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write(`PR352_FORWARD_BRIDGE_EVIDENCE_WRITE_FAIL ${error.message}\n`);
  }
});
