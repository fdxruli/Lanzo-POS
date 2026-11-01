import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runRestaurantCutoverConcurrency, runVersionedUpsertIdempotencyRaces } from './pr352-r6-concurrency.mjs';
import { runRestaurantFinancialRaces } from './pr352-r6-financial-races.mjs';
import { runRestaurantCancellationScenarios } from './pr352-r6-cancellation.mjs';
import { assertRestaurantOrderItemRelationship, restaurantOrderItemSnapshotSql, runPreparationStationBehavior } from './pr352-r6-preparation-station.mjs';
import { canonicalizePostgresAcl } from './pr352-r6-canonical-postgres-acl.mjs';
import { assertEquivalentPreparationStationCatalog } from './pr352-r6-canonical-postgres-constraints.mjs';
import { assertRateLimitedRestaurantUpsertCatalog } from './pr352-r6-wrapper-catalog.mjs';

const execFileAsync = promisify(execFile);
const root = process.cwd();
const fixture = path.join(root, 'supabase/tests/fixtures/pr338-real-financial');
const restaurantDependenciesFixture = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-dependencies.sql');
const preparationStationManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/preparation-station-fingerprints.json');
const restaurantWritersFixture = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql');
const restaurantWritersManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-writer-fingerprints.json');
const rateLimitedUpsertWrapperFixture = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.sql');
const rateLimitedUpsertWrapperManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.json');
const dispatcherManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/dispatcher-fingerprint.json');
const bridgePath = path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql');
const threeD14Path = path.join(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const versionedUpsertCall = 'public.pos_upsert_restaurant_order_versioned_v1(';
const psqlBin = process.env.PSQL_BIN || 'psql';
const connect = ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.PGPORT || '5432', '-U', process.env.PGUSER || 'postgres', '-d', 'pr352_bridge_isolated'];
const env = { ...process.env, PGHOST: '127.0.0.1', PGDATABASE: 'pr352_bridge_isolated', PGCONNECT_TIMEOUT: '5' };
let currentStage = 'preflight';
let tempRoot = null;
let serverVersionNum = null;
let bridgeStatus = 'FAIL';
let failure = null;
let adminOffEvidence = null;
let preparationStationEvidence = null;
let idempotencyEvidence = null;
const completedChecks = [];
let concurrencyResults = [];
let idempotencyConcurrencyResults = [];
let financialRaceResults = [];
let cancellationResults = [];
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
  const statementBatch = sql.trim();
  assert.ok(statementBatch.endsWith(';'), `${label} must end with a SQL terminator before psql -f`);
  await writeFile(file, `\\set ON_ERROR_STOP on\n${statementBatch}\n`);
  await runFile(file, label);
}

async function assertSqlFailure(sql, expectedState, expectedMessage, label) {
  let failureResult = null;
  try {
    await runPsql(['-A', '-t', '-v', 'VERBOSITY=verbose', '-c', sql]);
  } catch (error) {
    failureResult = error;
  }
  assert.ok(failureResult, `${label} must be rejected by PostgreSQL`);
  const stderr = String(failureResult.stderr || failureResult.message || '');
  assert.match(stderr, new RegExp(`ERROR:\\s+${expectedState}:`), `${label} SQLSTATE must be observed from PostgreSQL`);
  assert.ok(stderr.includes(expectedMessage), `${label} must fail with ${expectedMessage}; stderr=${stderr}`);
  return { sqlstate: expectedState, message: expectedMessage, stderr: stderr.slice(0, 1000) };
}

async function createLegacyOrder(localOrderId, idempotencyKey) {
  const result = JSON.parse(await query(`select public.pos_upsert_restaurant_order_unlimited(
    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
    jsonb_build_object('localOrderId',${quoteSql(localOrderId)},'tableLabel','R6 concurrency seed','status','pending',
      'fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId',${quoteSql(localOrderId + '-line')},
      'productId','bridge-restaurant-product','productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    ${quoteSql(idempotencyKey)})::text`));
  assert.equal(result.success, true, 'Synthetic legacy parent seed must succeed');
  assert.equal(result.order?.localOrderId, localOrderId, 'Seed receipt must identify the intended local order');
  assert.ok(typeof result.order?.id === 'string' && result.order.id.length > 0,
    'Seed receipt must contain the internal Restaurant order id');
  assert.notEqual(result.order.id, localOrderId, 'Concurrency seed must exercise distinct internal and local ids');
  return result.order.id;
}

function quoteSql(value) {
  return "'" + String(value).replaceAll("'", "''") + "'";
}

function versionedClientUpsertSql({
  licenseKey = 'lab-license-a', device = 'lab-device-a', deviceToken = 'lab-device-token-a',
  staffSession = 'lab-admin-session', role = 'anon', localOrderId, idempotencyKey, lineId,
  tableLabel = 'Versioned client', itemName = 'Bridge synthetic product', quantity = 1,
  expectedParentVersion = null, physicalOrderId = null, physicalLineId = null,
}) {
  const orderPairs = [
    "'localOrderId'", quoteSql(localOrderId), "'clientContractVersion'", '2',
    "'tableLabel'", quoteSql(tableLabel), "'status'", "'pending'",
    "'fulfillmentStatus'", "'pending'", "'source'", "'tables'", "'subtotal'", '10', "'total'", '10',
  ];
  if (expectedParentVersion !== null) {
    orderPairs.push("'expectedParentVersion'", quoteSql(expectedParentVersion));
  }
  if (physicalOrderId !== null) orderPairs.push("'id'", quoteSql(physicalOrderId));
  const itemPairs = ["'localLineId'", quoteSql(lineId)];
  if (physicalLineId !== null) itemPairs.push("'id'", quoteSql(physicalLineId));
  itemPairs.push("'productId'", "'bridge-restaurant-product'", "'productName'", quoteSql(itemName),
    "'quantity'", String(Number(quantity)), "'unitPrice'", '10', "'lineTotal'", '10');
  return `set role ${role}; select ${versionedUpsertCall}
    ${quoteSql(licenseKey)},${quoteSql(device)},${quoteSql(deviceToken)},${quoteSql(staffSession)},
    jsonb_build_object(${orderPairs.join(',')}),
    jsonb_build_array(jsonb_build_object(${itemPairs.join(',')})),
    ${quoteSql(idempotencyKey)})::text; reset role;`;
}

async function captureVersionedOrderState(localOrderId, idempotencyKey) {
  return JSON.parse(await query(`select json_build_object(
    'parent', (select json_build_object('id',id,'serverVersion',server_version,'updatedAt',updated_at,
      'status',status,'paymentStatus',payment_status,'paidAt',paid_at,'paidSaleId',paid_sale_id,
      'cancelledAt',cancelled_at,'deletedAt',deleted_at,'archivedAt',archived_at,'checkoutClosedAt',checkout_closed_at)
      from public.pos_restaurant_orders
      where license_id='00000000-0000-0000-0000-000000000001' and local_order_id=${quoteSql(localOrderId)}),
    'items', (select json_agg(json_build_object('id',id,'serverVersion',server_version,'updatedAt',updated_at,
      'quantity',quantity) order by id) from public.pos_restaurant_order_items
      where license_id='00000000-0000-0000-0000-000000000001' and restaurant_order_id=(select id from public.pos_restaurant_orders
        where license_id='00000000-0000-0000-0000-000000000001' and local_order_id=${quoteSql(localOrderId)})),
    'eventsForKey',(select count(*) from public.pos_sync_events where license_id='00000000-0000-0000-0000-000000000001'
      and idempotency_key=${quoteSql(idempotencyKey)}),
    'ledgerRowsForKey',(select count(*) from public.pos_idempotency_keys where license_id='00000000-0000-0000-0000-000000000001'
      and idempotency_key=${quoteSql(idempotencyKey)}),
    'proofRowsForKey',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id='00000000-0000-0000-0000-000000000001'
      and idempotency_key=${quoteSql(idempotencyKey)}),
    'sales',(select count(*) from public.pos_sales),
    'cashMovements',(select count(*) from public.pos_cash_movements),
    'inventoryMovements',(select count(*) from public.pos_inventory_movements),
    'customerLedger',(select count(*) from public.pos_customer_ledger),
    'financialOperations',(select count(*) from public.pos_financial_operations)
  )::text`));
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
    idempotencyConcurrency: idempotencyConcurrencyResults,
    financialRaces: financialRaceResults,
    cancellation: cancellationResults,
    preparationStationDependencies: preparationStationEvidence,
    idempotency: idempotencyEvidence,
    mockedDependencies: [
      'Authentication and license/device/session rows are synthetic.',
      'Cocina station schema and six direct Restaurant helper bodies are matched to read-only Production pg_catalog fingerprints; station rows and actor IDs are synthetic.',
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
    'returnType',pg_catalog.format_type(p.prorettype,NULL),'language',l.lanname,
    'owner',r.rolname,'security_definer',p.prosecdef,'config',p.proconfig,'acl',coalesce(p.proacl::text,'<default>')
  ) order by required.signature),'[]'::json)::text
  from (values ${values}) as required(signature)
  join pg_proc p on p.oid=to_regprocedure(required.signature)::oid
  join pg_language l on l.oid=p.prolang
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
  await runFile(restaurantDependenciesFixture, 'Production-matched synthetic Cocina schema and functions');
  const preparationStationManifest = JSON.parse(await readFile(preparationStationManifestPath, 'utf8'));
  assert.equal(preparationStationManifest.postgresServerVersionNum, '170006');
  assert.equal(preparationStationManifest.source.rawRowsIncluded, false);
  assert.equal(preparationStationManifest.source.credentialsIncluded, false);
  const preparationStationActual = JSON.parse(await query(`select json_build_object(
    'table',json_build_object(
      'name','public.pos_preparation_stations',
      'owner',(select pg_get_userbyid(c.relowner) from pg_class c where c.oid='public.pos_preparation_stations'::regclass),
      'acl',(select regexp_replace(c.relacl::text,'[{}]','','g') from pg_class c where c.oid='public.pos_preparation_stations'::regclass),
      'rolePrivileges',(select json_agg(json_build_object(
        'role',role_name,'select',has_table_privilege(role_name,'public.pos_preparation_stations','SELECT'),
        'insert',has_table_privilege(role_name,'public.pos_preparation_stations','INSERT'),
        'update',has_table_privilege(role_name,'public.pos_preparation_stations','UPDATE'),
        'delete',has_table_privilege(role_name,'public.pos_preparation_stations','DELETE')
      ) order by role_name) from unnest(ARRAY['anon','authenticated','postgres','service_role']) AS role_name),
      'rlsEnabled',(select c.relrowsecurity from pg_class c where c.oid='public.pos_preparation_stations'::regclass),
      'rlsForced',(select c.relforcerowsecurity from pg_class c where c.oid='public.pos_preparation_stations'::regclass),
      'columns',(select json_agg(json_build_object('name',column_name,'type',data_type,'nullable',is_nullable,'default',column_default) order by ordinal_position)
        from information_schema.columns where table_schema='public' and table_name='pos_preparation_stations'),
      'constraints',(select json_agg(json_build_object('name',conname,'type',contype,'definition',pg_get_constraintdef(oid,true)) order by conname)
        from pg_constraint where conrelid='public.pos_preparation_stations'::regclass),
      'indexes',(select json_agg(json_build_object('name',indexrelid::regclass::text,'definition',pg_get_indexdef(indexrelid)) order by indexrelid::regclass::text)
        from pg_index where indrelid='public.pos_preparation_stations'::regclass)
    ),
    'triggers',(select coalesce(json_agg(json_build_object('name',tgname,'definition',pg_get_triggerdef(oid,true)) order by tgname),'[]'::json)
      from pg_trigger where tgrelid='public.pos_preparation_stations'::regclass and not tgisinternal),
    'policies',(select coalesce(json_agg(json_build_object('name',polname,'command',polcmd,'roles',polroles,'qual',polqual,'withCheck',polwithcheck) order by polname),'[]'::json)
      from pg_policy where polrelid='public.pos_preparation_stations'::regclass),
    'functions',(select json_agg(json_build_object(
      'signature',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
      'returnType',pg_get_function_result(p.oid),'language',l.lanname,'securityDefiner',p.prosecdef,
      'config',coalesce(to_json(p.proconfig),'[]'::json),'owner',r.rolname,
      'acl',regexp_replace(p.proacl::text,'[{}]','','g'),
      'bodySha256',encode(extensions.digest(p.prosrc,'sha256'),'hex')
    ) order by p.proname)
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
      join pg_roles r on r.oid=p.proowner
      where n.nspname='private' and p.proname in ('ensure_default_preparation_station','is_restaurant_order_status',
        'normalize_pos_preparation_station_name_key','normalize_restaurant_order_status','resolve_restaurant_order_station','safe_jsonb_numeric'))
  )::text`));
  assertEquivalentPreparationStationCatalog(preparationStationActual, {
    table: preparationStationManifest.table,
    triggers: preparationStationManifest.triggers,
    policies: preparationStationManifest.policies,
    functions: preparationStationManifest.functions,
  });
  passed('Cocina schema and six direct Restaurant helper functions match read-only Production catalog metadata', {
    tableColumnCount: preparationStationActual.table.columns.length,
    constraintCount: preparationStationActual.table.constraints.length,
    indexCount: preparationStationActual.table.indexes.length,
    functionCount: preparationStationActual.functions.length,
  });
  await runFile(restaurantWritersFixture, 'audited Restaurant writer definitions');
  const rateLimitedUpsertManifest = JSON.parse(await readFile(rateLimitedUpsertWrapperManifestPath, 'utf8'));
  assert.equal(rateLimitedUpsertManifest.postgresServerVersionNum, '170006');
  assert.equal(rateLimitedUpsertManifest.rawDataIncluded, false);
  assert.equal(rateLimitedUpsertManifest.credentialsIncluded, false);
  await runFile(rateLimitedUpsertWrapperFixture, 'read-only Production-matched rate-limited client wrapper');
  const rateLimitedUpsert = await captureFunctions([rateLimitedUpsertManifest.entry.signature]);
  assertRateLimitedRestaurantUpsertCatalog(rateLimitedUpsert, rateLimitedUpsertManifest.entry);
  passed('authentic rate-limited public upsert wrapper required by versioned client is present', {
    signature: rateLimitedUpsertManifest.entry.signature,
    prosrcSha256: rateLimitedUpsertManifest.entry.prosrcSha256,
    returnType: rateLimitedUpsert[0].returnType,
    language: rateLimitedUpsert[0].language,
    owner: rateLimitedUpsert[0].owner,
    securityDefiner: rateLimitedUpsert[0].security_definer,
  });
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
  const preparationStationInitialCount = Number(await query('select count(*) from public.pos_preparation_stations'));
  assert.equal(preparationStationInitialCount, 0,
    'No Kitchen station row may exist before the first authenticated Restaurant writer invocation');
  preparationStationEvidence = { initialStationCountBeforeStaffWriter: preparationStationInitialCount, status: 'PARTIAL', cases: [] };
  passed('synthetic Cocina table starts empty before the Staff writer creates its default station', {
    stationCount: preparationStationInitialCount,
  });
  const threeD14Functions = [
    'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)',
    'public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)',
  ];
  const preparationStationFunctions = [
    'private.ensure_default_preparation_station(uuid,uuid,uuid)',
    'private.is_restaurant_order_status(text)',
    'private.normalize_pos_preparation_station_name_key(text)',
    'private.normalize_restaurant_order_status(text)',
    'private.resolve_restaurant_order_station(uuid,text,text,uuid,uuid)',
    'private.safe_jsonb_numeric(jsonb,text,numeric)',
  ];
  const allFunctionSignatures = [...new Set([...targetFunctions.map((row) => row.signature), ...threeD14Functions, ...preparationStationFunctions])];
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
  assert.equal(await query("select count(*) from pg_class where oid in (to_regclass('private.restaurant_cloud_contract_state'),to_regclass('private.restaurant_admin_activation'),to_regclass('private.restaurant_bridge_cancel_permits'),to_regclass('private.restaurant_order_upsert_replay_proofs_v1'))"), '0',
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
  assert.equal(await query(`select (to_regclass('private.restaurant_cloud_contract_state') is not null
    and to_regprocedure('public.pos_restaurant_cloud_contract_v1(text,text,text,text)') is not null)::text`), 'true',
    'Bridge migration must be installed and committed before behavioral checks');
  passed('forward bridge v1 migration installed and committed in disposable PostgreSQL', {
    contractStateTablePresent: true, contractReaderPresent: true,
  });
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
    'anon_insert',has_table_privilege('anon',c.oid,'insert'),
    'anon_update',has_table_privilege('anon',c.oid,'update'),
    'anon_delete',has_table_privilege('anon',c.oid,'delete'),
    'authenticated_select',has_table_privilege('authenticated',c.oid,'select'),
    'authenticated_insert',has_table_privilege('authenticated',c.oid,'insert'),
    'authenticated_update',has_table_privilege('authenticated',c.oid,'update'),
    'authenticated_delete',has_table_privilege('authenticated',c.oid,'delete'),
    'service_role_select',has_table_privilege('service_role',c.oid,'select'),
    'service_role_insert',has_table_privilege('service_role',c.oid,'insert'),
    'service_role_update',has_table_privilege('service_role',c.oid,'update'),
    'service_role_delete',has_table_privilege('service_role',c.oid,'delete'),
    'anon_truncate',has_table_privilege('anon',c.oid,'truncate'),
    'authenticated_truncate',has_table_privilege('authenticated',c.oid,'truncate'),
    'service_role_truncate',has_table_privilege('service_role',c.oid,'truncate'),
    'publicAnyPrivilege',exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) acl where acl.grantee=0),
    'policyCount',(select count(*) from pg_policy pol where pol.polrelid=c.oid)
  ) order by c.relname)::text from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='private' and c.relname in ('restaurant_cloud_contract_state','restaurant_admin_activation','restaurant_bridge_cancel_permits',
    'restaurant_order_upsert_replay_proofs_v1')`);
  const tables = JSON.parse(tableState);
  assert.equal(tables.length, 4, 'All private bridge tables must be installed');
  const effectiveTablePrivilegeKeys = Object.keys(tables[0]).filter((key) =>
    /^(anon|authenticated|service_role)_(select|insert|update|delete|truncate)$/.test(key));
  assert.ok(tables.every((row) => row.rls && effectiveTablePrivilegeKeys.every((key) => row[key] === false)),
    'Bridge private tables must be RLS enabled and have no effective read, write or truncate grants to browser/service roles');
  assert.ok(tables.every((row) => row.publicAnyPrivilege === false && row.policyCount === 0),
    'Private bridge tables must have no PUBLIC ACL entry and no row policy that could expose rows');
  const privateSchemaUsage = JSON.parse(await query(`select json_build_object(
    'anon',has_schema_privilege('anon','private','usage'),
    'authenticated',has_schema_privilege('authenticated','private','usage'),
    'service_role',has_schema_privilege('service_role','private','usage'))::text`));
  assert.deepEqual(privateSchemaUsage,{anon:false,authenticated:false,service_role:false},
    'Browser and service roles must not have direct schema access to private bridge tables');
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
      'fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','${ownedOrder}-line','productId','bridge-restaurant-product',
      'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    'r6-staff-owner-seed');`, 'staff-owner-seed');
  currentStage = 'authentic Cocina station behavior';
  const preparationStationCases = await runPreparationStationBehavior({ query, runSql, psqlBin, env });
  preparationStationEvidence = {
    initialStationCountBeforeStaffWriter: preparationStationInitialCount,
    status: 'PASS',
    cases: preparationStationCases,
  };
  passed('authentic Cocina provisioning, resolution, attribution, license isolation, rollback and concurrency checks completed', {
    cases: preparationStationCases.map(({ name, status }) => ({ name, status })),
  });
  const staffOwner = await query(`select created_by_staff_user_id::text||'|'||created_by_device_id::text
    from public.pos_restaurant_orders where license_id='00000000-0000-0000-0000-000000000001'::uuid
      and local_order_id='${ownedOrder}' and deleted_at is null`);
  assert.equal(staffOwner, '00000000-0000-0000-0000-0000000000ab|00000000-0000-0000-0000-00000000000b');
  await runSql(`do $owner$ declare state text; message text; begin
    begin perform public.pos_upsert_restaurant_order_unlimited(
      'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
      jsonb_build_object('localOrderId','${ownedOrder}','tableLabel','Admin non-owner','status','pending',
        'fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
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
        'fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
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
        'fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
      jsonb_build_array(jsonb_build_object('localLineId','bridge-invalid-session-line','productId','bridge-restaurant-product',
        'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
      'r6-invalid-session');
      raise exception 'R6_INVALID_SESSION_UNEXPECTEDLY_ALLOWED';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if message='R6_INVALID_SESSION_UNEXPECTEDLY_ALLOWED' then raise; end if;
      if state<>'P0001' or message<>'ACTOR_SESSION_INVALID' then raise; end if;
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
      'fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','bridge-legacy-line','productId','bridge-restaurant-product',
      'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    'bridge-legacy-client-upsert')::text; reset role;`;
  const legacyUpsert = JSON.parse(await query(legacyUpsertSql));
  assert.equal(legacyUpsert.success, true, 'Old client payload without a contract-version marker must remain admitted in v1');
  const legacyReplay = JSON.parse(await query(legacyUpsertSql));
  assert.deepEqual(legacyReplay, legacyUpsert, 'A legitimate legacy replay must recover the exact receipt');
  const clientLicenseId = '00000000-0000-0000-0000-000000000001';
  const legacyRelation = assertRestaurantOrderItemRelationship(
    JSON.parse(await query(restaurantOrderItemSnapshotSql(clientLicenseId, 'bridge-legacy-client', 'bridge-legacy-line'))),
    { licenseId: clientLicenseId, localOrderId: 'bridge-legacy-client', localLineId: 'bridge-legacy-line' },
  );
  assert.equal(legacyUpsert.order?.id, legacyRelation.parentId, 'Legacy receipt must identify its persisted parent');
  assert.equal(legacyUpsert.order?.localOrderId, legacyRelation.localOrderId);
  const versionedUpsertSql = `set role anon; select public.pos_upsert_restaurant_order_versioned_v1(
    'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
    jsonb_build_object('localOrderId','bridge-versioned-client','clientContractVersion',2,'tableLabel','Versioned client',
      'status','pending','fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','bridge-versioned-line','productId','bridge-restaurant-product',
      'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10)),
    'bridge-versioned-client-upsert')::text; reset role;`;
  const canonicalVersionedSql = versionedUpsertSql;
  const versionedUpsert = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(versionedUpsert.success, true, 'New client contract version 2 payload must remain admitted during bridge v1');
  const versionedRelation = assertRestaurantOrderItemRelationship(
    JSON.parse(await query(restaurantOrderItemSnapshotSql(clientLicenseId, 'bridge-versioned-client', 'bridge-versioned-line'))),
    { licenseId: clientLicenseId, localOrderId: 'bridge-versioned-client', localLineId: 'bridge-versioned-line' },
  );
  assert.equal(versionedUpsert.order?.id, versionedRelation.parentId, 'Versioned receipt must identify its persisted parent');
  assert.equal(versionedUpsert.order?.localOrderId, versionedRelation.localOrderId);

  const xidProbeSql = `begin; ${versionedClientUpsertSql({ localOrderId:'bridge-r20-xid-probe',
    idempotencyKey:'bridge-r20-xid-probe-key',lineId:'bridge-r20-xid-probe-line' })}
    select json_build_object('xminType',pg_typeof(i.xmin)::text,
      'currentXid8Type',pg_typeof(pg_current_xact_id())::text,
      'sameTransaction',i.xmin=pg_current_xact_id()::xid)::text
    from public.pos_idempotency_keys i where i.license_id=${quoteSql(clientLicenseId)}::uuid
      and i.idempotency_key='bridge-r20-xid-probe-key'; rollback;`;
  const xidProbeRun = await runPsql(['-A','-t','-c',xidProbeSql]);
  const xidProbeRows = xidProbeRun.stdout.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('{'));
  assert.equal(xidProbeRows.length, 2, 'The same-transaction XID probe must return both the RPC receipt and catalog observation');
  const xidProbeReceipt = JSON.parse(xidProbeRows[0]);
  const xidProbe = JSON.parse(xidProbeRows[1]);
  assert.equal(xidProbeReceipt.success, true, 'The XID probe must execute the real versioned writer');
  assert.deepEqual(xidProbe,{ xminType:'xid',currentXid8Type:'xid8',sameTransaction:true },
    'PostgreSQL must expose xmin as xid, pg_current_xact_id as xid8, and the cast must identify this transaction');
  const xidRollbackState = JSON.parse(await query(`select json_build_object(
    'parents',(select count(*) from public.pos_restaurant_orders where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-r20-xid-probe'),
    'items',(select count(*) from public.pos_restaurant_order_items where license_id=${quoteSql(clientLicenseId)}::uuid and local_line_id='bridge-r20-xid-probe-line'),
    'ledger',(select count(*) from public.pos_idempotency_keys where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-r20-xid-probe-key'),
    'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-r20-xid-probe-key'),
    'events',(select count(*) from public.pos_sync_events where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-r20-xid-probe-key'))::text`));
  assert.deepEqual(xidRollbackState,{parents:0,items:0,ledger:0,proofs:0,events:0},
    'A top-level ROLLBACK after the writer has inserted its proof must remove every effect visible to a new connection');

  currentStage = 'R20 failure during idempotency completion';
  const completionFailureKey = 'bridge-r20-completion-failure-key';
  try {
    await runSql(`create function private.pr352_test_fail_idempotency_completion_v1()
      returns trigger language plpgsql set search_path='' as $function$
      begin
        if new.idempotency_key=${quoteSql(completionFailureKey)} and new.status='completed' then
          raise exception 'R20_TEST_IDEMPOTENCY_COMPLETION_FAILURE' using errcode='P0001';
        end if;
        return new;
      end; $function$;
      create trigger pr352_test_fail_idempotency_completion_v1 before update on public.pos_idempotency_keys
        for each row execute function private.pr352_test_fail_idempotency_completion_v1();`,
    'install-completion-fault-injection');
    await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-r20-completion-failure',
      idempotencyKey:completionFailureKey,lineId:'bridge-r20-completion-failure-line' }),
      'P0001','R20_TEST_IDEMPOTENCY_COMPLETION_FAILURE','injected completion failure after parent/item/event writes');
    const completionFailureState = JSON.parse(await query(`select json_build_object(
      'parents',(select count(*) from public.pos_restaurant_orders where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-r20-completion-failure'),
      'items',(select count(*) from public.pos_restaurant_order_items where license_id=${quoteSql(clientLicenseId)}::uuid and local_line_id='bridge-r20-completion-failure-line'),
      'ledger',(select count(*) from public.pos_idempotency_keys where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(completionFailureKey)}),
      'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(completionFailureKey)}),
      'events',(select count(*) from public.pos_sync_events where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(completionFailureKey)}))::text`));
    assert.deepEqual(completionFailureState,{parents:0,items:0,ledger:0,proofs:0,events:0},
      'A failure while completing idempotency must roll back the entire operation');
  } finally {
    await runSql(`drop trigger if exists pr352_test_fail_idempotency_completion_v1 on public.pos_idempotency_keys;
      drop function if exists private.pr352_test_fail_idempotency_completion_v1();`, 'remove-completion-fault-injection');
  }

  currentStage = 'R20 failure after private replay proof insert';
  const proofFailureKey = 'bridge-r20-proof-failure-key';
  try {
    await runSql(`create function private.pr352_test_fail_after_replay_proof_v1()
      returns trigger language plpgsql set search_path='' as $function$
      begin
        if new.idempotency_key=${quoteSql(proofFailureKey)} then
          raise exception 'R20_TEST_PROOF_INSERT_FAILURE' using errcode='P0001';
        end if;
        return new;
      end; $function$;
      create trigger pr352_test_fail_after_replay_proof_v1 after insert on private.restaurant_order_upsert_replay_proofs_v1
        for each row execute function private.pr352_test_fail_after_replay_proof_v1();`,
    'install-proof-fault-injection');
    await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-r20-proof-failure',
      idempotencyKey:proofFailureKey,lineId:'bridge-r20-proof-failure-line' }),
      'P0001','R20_TEST_PROOF_INSERT_FAILURE','injected failure after private proof insertion');
    const proofFailureState = JSON.parse(await query(`select json_build_object(
      'parents',(select count(*) from public.pos_restaurant_orders where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-r20-proof-failure'),
      'items',(select count(*) from public.pos_restaurant_order_items where license_id=${quoteSql(clientLicenseId)}::uuid and local_line_id='bridge-r20-proof-failure-line'),
      'ledger',(select count(*) from public.pos_idempotency_keys where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(proofFailureKey)}),
      'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(proofFailureKey)}),
      'events',(select count(*) from public.pos_sync_events where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(proofFailureKey)}))::text`));
    assert.deepEqual(proofFailureState,{parents:0,items:0,ledger:0,proofs:0,events:0},
      'A failure after proof insertion must roll back the proof and every operation effect');
  } finally {
    await runSql(`drop trigger if exists pr352_test_fail_after_replay_proof_v1 on private.restaurant_order_upsert_replay_proofs_v1;
      drop function if exists private.pr352_test_fail_after_replay_proof_v1();`, 'remove-proof-fault-injection');
  }

  currentStage = 'R20 canonical fingerprint and post-commit retry';
  const orderExpr = `jsonb_build_object('localOrderId','bridge-versioned-client','clientContractVersion',2,
    'tableLabel','Versioned client','status','pending','fulfillmentStatus','pending','source','tables','subtotal',10,'total',10)
    || jsonb_build_object('clientContractVersion',2)`;
  const itemsExpr = `jsonb_build_array(jsonb_build_object('localLineId','bridge-versioned-line','productId','bridge-restaurant-product',
    'productName','Bridge synthetic product','quantity',1,'unitPrice',10,'lineTotal',10))`;
  const fingerprintText = `(${orderExpr})::text||'|'||(${itemsExpr})::text`;
  const ledgerProof = JSON.parse(await query(`select json_build_object(
    'operation',i.operation_type,'entityType',i.entity_type,'entityId',i.entity_id,'status',i.status,
    'requestHashMatches',i.request_hash=md5(${fingerprintText}),
    'responseMatches',i.response_payload=${quoteSql(JSON.stringify(versionedUpsert))}::jsonb,
    'responseKeyMatches',i.response_payload->>'idempotency_key'=i.idempotency_key,
    'responseOrderMatches',i.response_payload->'order'->>'id'=i.entity_id,
    'proofCount',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 p
      where p.license_id=i.license_id and p.idempotency_key=i.idempotency_key),
    'proofMatches',p.request_sha256=encode(extensions.digest(convert_to(${fingerprintText},'UTF8'),'sha256'),'hex'),
    'proofResponseMatches',p.response_sha256=encode(extensions.digest(convert_to(i.response_payload::text,'UTF8'),'sha256'),'hex'),
    'proofParentMatches',p.local_order_id='bridge-versioned-client' and p.restaurant_order_id=i.entity_id,
    'proofActorMatches',p.actor_type='admin' and p.actor_id='00000000-0000-0000-0000-0000000000aa'::uuid
      and p.device_id='00000000-0000-0000-0000-00000000000a'::uuid,
    'expiresAtPresent',i.expires_at is not null
  )::text from public.pos_idempotency_keys i join private.restaurant_order_upsert_replay_proofs_v1 p
    on p.license_id=i.license_id and p.idempotency_key=i.idempotency_key
  where i.license_id=${quoteSql(clientLicenseId)}::uuid and i.idempotency_key='bridge-versioned-client-upsert'`));
  assert.deepEqual(ledgerProof, {
    operation: 'restaurant_order.upsert', entityType: 'restaurant_order', entityId: versionedUpsert.order.id,
    status: 'completed', requestHashMatches: true, responseMatches: true, responseKeyMatches: true,
    responseOrderMatches: true, proofCount: 1, proofMatches: true, proofResponseMatches: true, proofParentMatches: true,
    proofActorMatches: true, expiresAtPresent: true,
  }, 'The replay proof must match the writer JSONB hash input, ledger receipt and actor binding');
  const beforeReplayState = await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert');
  const versionedReplay = JSON.parse(await query(canonicalVersionedSql));
  const afterReplayState = await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert');
  assert.deepEqual(versionedReplay, versionedUpsert, 'A post-COMMIT request with lost version/response must recover its original receipt');
  assert.deepEqual(afterReplayState, beforeReplayState,
    'An exact replay must not modify the parent, lines, sync events, sales, cash, inventory or credit');
  const replayRateCount = await query(`select request_count from public.pos_rpc_rate_limits where license_key='lab-license-a'
    and device_fingerprint='lab-device-a' and rpc_name='pos_upsert_restaurant_order' and scope='POS_WRITE'
    and staff_session_hash=encode(extensions.digest('lab-admin-session','sha256'),'hex')`);
  assert.equal(replayRateCount, '2', 'The original write and its exact replay must each consume one authentic rate-limit attempt');

  const changedOrderReplay = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line',tableLabel:'Changed payload' })));
  assert.equal(changedOrderReplay.success,false);
  assert.equal(changedOrderReplay.code,'IDEMPOTENCY_CONFLICT');
  assert.equal('order' in changedOrderReplay,false,'Changed payload must not receive the stored receipt');
  const changedItemReplay = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line',itemName:'Different item' })));
  assert.equal(changedItemReplay.code,'IDEMPOTENCY_CONFLICT','Changed articles must not receive the stored receipt');
  assert.deepEqual(await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert'),beforeReplayState,
    'Payload conflicts must leave every business row unchanged');

  currentStage = 'R20 same-key different-parent conflict';
  const secondParent = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-versioned-second-parent',
    idempotencyKey:'bridge-versioned-second-parent-key',lineId:'bridge-versioned-second-line' })));
  assert.equal(secondParent.success,true);
  const otherParentConflict = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-versioned-second-parent',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-second-line' })));
  assert.equal(otherParentConflict.success,false);
  assert.equal(otherParentConflict.code,'IDEMPOTENCY_CONFLICT');
  assert.equal('order' in otherParentConflict,false,'A key bound to another parent must not return the first parent receipt');

  currentStage = 'R20 version checks and physical ID isolation';
  const noVersionError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-new-key-no-version',lineId:'bridge-versioned-line' }),
    'P0001','RESTAURANT_ORDER_VERSION_REQUIRED','new key on existing parent without version');
  const staleVersionError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-stale-key',lineId:'bridge-versioned-line',expectedParentVersion:'2000-01-01T00:00:00Z' }),
    'P0001','RESTAURANT_ORDER_VERSION_CONFLICT','stale parent version');
  const physicalParentError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-physical-id',lineId:'bridge-versioned-line',physicalOrderId:versionedUpsert.order.id }),
    'P0001','RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED','physical parent ID injection');
  const currentVersion = JSON.parse(await query(`select json_build_object('updatedAt',updated_at)::text
    from public.pos_restaurant_orders where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-versioned-client'`)).updatedAt;
  const physicalLineError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-physical-line-id',lineId:'bridge-versioned-line',expectedParentVersion:currentVersion,
    physicalLineId:'bridge-versioned-line' }),
    'P0001','RESTAURANT_ORDER_LINE_ID_CONFLICT','physical line ID injection');
  assert.deepEqual(await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert'),beforeReplayState,
    'Version and physical ID rejections must leave the original successful write unchanged');

  currentStage = 'R20 authorization and license isolation';
  const foreignDeviceError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line',device:'lab-device-b',
    deviceToken:'lab-device-token-b',staffSession:'lab-staff-session' }),
    'P0001','RESTAURANT_TABLE_OWNER_REQUIRED','non-owner Staff replay');
  const invalidSessionError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line',staffSession:'invalid-session' }),
    'P0001','ACTOR_SESSION_INVALID','invalid-session replay');
  const wrongDeviceSessionError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line',device:'lab-device-b',
    deviceToken:'lab-device-token-b',staffSession:'lab-admin-session' }),
    'P0001','ACTOR_SESSION_INVALID','Admin session replayed from a different device');
  await runSql(`begin;
    insert into public.license_devices(id,license_id,device_fingerprint,security_token,is_active,device_mode,device_role)
      values ('00000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-000000000002',
        'lab-device-b-license-b','lab-device-token-b-license-b',true,'admin_only','admin');
    insert into public.license_admin_users(id,license_id,username,display_name,password_hash,is_owner,is_active)
      values ('00000000-0000-0000-0000-0000000000ae','00000000-0000-0000-0000-000000000002','lab-admin-b','Lab Admin B',
        extensions.crypt('lab-only',extensions.gen_salt('bf')),true,true);
    insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
      values ('00000000-0000-0000-0000-0000000000be','00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-0000000000ae','00000000-0000-0000-0000-00000000000e',
        extensions.crypt('lab-admin-session-b',extensions.gen_salt('bf')),now()+interval '1 day');
    insert into public.pos_products(id,license_id,name,name_key,price,cost,stock,track_stock)
      values ('bridge-restaurant-product-b','00000000-0000-0000-0000-000000000002','Bridge synthetic product B',
        'bridge synthetic product b',10,4,20,true);
    commit;`, 'second-synthetic-license');
  const independentLicenseReceipt = JSON.parse(await query(versionedClientUpsertSql({ licenseKey:'lab-license-b',
    device:'lab-device-b-license-b',deviceToken:'lab-device-token-b-license-b',staffSession:'lab-admin-session-b',
    localOrderId:'bridge-versioned-client',idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line-b' })
    .replaceAll("'bridge-restaurant-product'", "'bridge-restaurant-product-b'")));
  assert.equal(independentLicenseReceipt.success,true,'The ledger key namespace is per license');
  assert.notEqual(independentLicenseReceipt.order.id,versionedUpsert.order.id,
    'A different license must create its own receipt and never receive the first license receipt');

  const staffOwnedVersioned = JSON.parse(await query(versionedClientUpsertSql({ device:'lab-device-b',
    deviceToken:'lab-device-token-b',staffSession:'lab-staff-session',localOrderId:'bridge-r20-staff-owned',
    idempotencyKey:'bridge-r20-staff-owned-key',lineId:'bridge-r20-staff-owned-line' })));
  assert.equal(staffOwnedVersioned.success,true);
  const staffOwnedSessionId = await query(`select id::text from public.license_staff_sessions
    where license_id=${quoteSql(clientLicenseId)}::uuid and device_id='00000000-0000-0000-0000-00000000000b'::uuid
      and session_token_hash=extensions.crypt('lab-staff-session',session_token_hash) and revoked_at is null limit 1`);
  const staffOwnedStateBeforeRevokedReplay = await captureVersionedOrderState('bridge-r20-staff-owned','bridge-r20-staff-owned-key');
  await runSql(`update public.license_staff_sessions set revoked_at=clock_timestamp()
    where id=${quoteSql(staffOwnedSessionId)}::uuid;`, 'revoke-versioned-owner-session');
  let revokedStaffSessionError;
  try {
    revokedStaffSessionError = await assertSqlFailure(versionedClientUpsertSql({ device:'lab-device-b',
      deviceToken:'lab-device-token-b',staffSession:'lab-staff-session',localOrderId:'bridge-r20-staff-owned',
      idempotencyKey:'bridge-r20-staff-owned-key',lineId:'bridge-r20-staff-owned-line' }),
      'P0001','ACTOR_SESSION_INVALID','revoked Staff session replay');
  } finally {
    await runSql(`update public.license_staff_sessions set revoked_at=null
      where id=${quoteSql(staffOwnedSessionId)}::uuid;`, 'restore-versioned-owner-session');
  }
  assert.deepEqual(await captureVersionedOrderState('bridge-r20-staff-owned','bridge-r20-staff-owned-key'),
    staffOwnedStateBeforeRevokedReplay,'A revoked session must not receive a receipt or change any stored state');
  const otherStaffReplayError = await assertSqlFailure(versionedClientUpsertSql({ device:'lab-device-c',
    deviceToken:'lab-device-token-c',staffSession:'lab-staff-session-c',localOrderId:'bridge-r20-staff-owned',
    idempotencyKey:'bridge-r20-staff-owned-key',lineId:'bridge-r20-staff-owned-line' }),
    'P0001','RESTAURANT_TABLE_OWNER_REQUIRED','different Staff replay');
  const adminOffReplayError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-r20-staff-owned',
    idempotencyKey:'bridge-r20-staff-owned-key',lineId:'bridge-r20-staff-owned-line' }),
    'P0001','RESTAURANT_TABLE_OWNER_REQUIRED','Admin OFF replay of Staff-owned parent');
  await runSql(`update public.license_staff_users set permissions='{}'::jsonb
    where id='00000000-0000-0000-0000-0000000000ab'::uuid;`, 'revoke-staff-pos-permission-synthetic');
  let revokedPermissionError;
  try {
    revokedPermissionError = await assertSqlFailure(versionedClientUpsertSql({ device:'lab-device-b',
      deviceToken:'lab-device-token-b',staffSession:'lab-staff-session',localOrderId:'bridge-r20-staff-owned',
      idempotencyKey:'bridge-r20-staff-owned-key',lineId:'bridge-r20-staff-owned-line' }),
      'P0001','POS_PERMISSION_DENIED','revoked Staff POS permission replay');
  } finally {
    await runSql(`update public.license_staff_users set permissions='{"pos":true,"cash_register":true}'::jsonb
      where id='00000000-0000-0000-0000-0000000000ab'::uuid;`, 'restore-staff-pos-permission-synthetic');
  }

  currentStage = 'R20 processing and damaged ledger rejection';
  await runSql(`insert into public.pos_idempotency_keys(license_id,idempotency_key,operation_type,entity_type,entity_id,request_hash,status,expires_at)
    values (${quoteSql(clientLicenseId)}::uuid,'bridge-r20-processing-key','restaurant_order.upsert','restaurant_order',
      'bridge-r20-processing-order',null,'processing',now()+interval '1 day');`, 'seed-processing-idempotency');
  const processingReplay = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-processing-order',
    idempotencyKey:'bridge-r20-processing-key',lineId:'bridge-r20-processing-line' })));
  assert.equal(processingReplay.code,'IDEMPOTENCY_PROCESSING');
  assert.equal('order' in processingReplay,false);
  const savedProof = JSON.parse(await query(`select json_build_object(
    'licenseId',license_id,'idempotencyKey',idempotency_key,'localOrderId',local_order_id,
    'restaurantOrderId',restaurant_order_id,'requestSha256',request_sha256,'responseSha256',response_sha256,
    'actorType',actor_type,'actorId',actor_id,'deviceId',device_id)::text
    from private.restaurant_order_upsert_replay_proofs_v1
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert'`));
  await runSql(`delete from private.restaurant_order_upsert_replay_proofs_v1
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'remove-versioned-replay-proof');
  const missingProof = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(missingProof.code,'IDEMPOTENCY_CONFLICT','A completed ledger receipt without its private proof must fail closed');
  assert.equal('order' in missingProof,false,'A missing proof must not disclose the stored receipt');
  await runSql(`insert into private.restaurant_order_upsert_replay_proofs_v1(
      license_id,idempotency_key,local_order_id,restaurant_order_id,request_sha256,response_sha256,actor_type,actor_id,device_id)
    values (${quoteSql(savedProof.licenseId)}::uuid,${quoteSql(savedProof.idempotencyKey)},${quoteSql(savedProof.localOrderId)},
      ${quoteSql(savedProof.restaurantOrderId)},${quoteSql(savedProof.requestSha256)},${quoteSql(savedProof.responseSha256)},
      ${quoteSql(savedProof.actorType)},${quoteSql(savedProof.actorId)}::uuid,${quoteSql(savedProof.deviceId)}::uuid);`, 'restore-versioned-replay-proof');
  await runSql(`update private.restaurant_order_upsert_replay_proofs_v1 set request_sha256=repeat('0',64)
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'corrupt-versioned-request-proof');
  const inconsistentProof = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(inconsistentProof.code,'IDEMPOTENCY_CONFLICT','An inconsistent strong request proof must fail closed');
  assert.equal('order' in inconsistentProof,false,'An inconsistent proof must not disclose the receipt');
  await runSql(`update private.restaurant_order_upsert_replay_proofs_v1 set request_sha256=${quoteSql(savedProof.requestSha256)}
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'restore-versioned-request-proof');
  const savedReceiptSql = quoteSql(JSON.stringify(versionedUpsert));
  await runSql(`update public.pos_idempotency_keys set response_payload=null where license_id=${quoteSql(clientLicenseId)}::uuid
    and idempotency_key='bridge-versioned-client-upsert';`, 'corrupt-receipt-synthetic');
  const missingReceipt = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(missingReceipt.code,'IDEMPOTENCY_CONFLICT','A completed ledger row without its receipt must not replay');
  assert.equal('order' in missingReceipt,false);
  await runSql(`update public.pos_idempotency_keys set response_payload=${savedReceiptSql}::jsonb
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'restore-receipt-synthetic');
  await runSql(`update public.pos_idempotency_keys set response_payload=response_payload-'success'
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'remove-receipt-success-field-synthetic');
  const missingSuccess = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(missingSuccess.code,'IDEMPOTENCY_CONFLICT','A malformed receipt missing its success flag must not be returned');
  assert.equal('order' in missingSuccess,false);
  await runSql(`update public.pos_idempotency_keys set response_payload=${savedReceiptSql}::jsonb
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'restore-success-field-synthetic');
  await runSql(`update public.pos_idempotency_keys
    set response_payload=jsonb_set(response_payload,'{order,tableLabel}',to_jsonb('tampered receipt'::text),true)
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'tamper-valid-receipt-synthetic');
  const tamperedReceipt = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(tamperedReceipt.code,'IDEMPOTENCY_CONFLICT',
    'A structurally valid but altered receipt must fail its private response SHA-256 proof');
  assert.equal('order' in tamperedReceipt,false,'A receipt hash mismatch must not expose the altered payload');
  await runSql(`update public.pos_idempotency_keys set response_payload=${savedReceiptSql}::jsonb
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'restore-tampered-receipt-synthetic');
  await runSql(`update public.pos_idempotency_keys set operation_type='restaurant_order.cancel_from_pos'
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'alter-operation-binding-synthetic');
  const otherOperation = JSON.parse(await query(canonicalVersionedSql));
  assert.equal(otherOperation.code,'IDEMPOTENCY_CONFLICT','A key stored for another operation must not return the upsert receipt');
  assert.equal('order' in otherOperation,false);
  await runSql(`update public.pos_idempotency_keys set operation_type='restaurant_order.upsert'
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'restore-operation-binding-synthetic');

  currentStage = 'R20 rollback of first attempt';
  const rollbackSql = versionedClientUpsertSql({ localOrderId:'bridge-r20-rollback-order',
    idempotencyKey:'bridge-r20-rollback-key',lineId:'bridge-r20-rollback-line' });
  await runSql(`begin; ${rollbackSql} rollback;`, 'r20-first-attempt-rollback');
  const rolledBackState = JSON.parse(await query(`select json_build_object(
    'parents',(select count(*) from public.pos_restaurant_orders where local_order_id='bridge-r20-rollback-order'),
    'items',(select count(*) from public.pos_restaurant_order_items where local_line_id='bridge-r20-rollback-line'),
    'ledger',(select count(*) from public.pos_idempotency_keys where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-r20-rollback-key'),
    'proofs',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1 where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-r20-rollback-key'),
    'events',(select count(*) from public.pos_sync_events where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-r20-rollback-key')
  )::text`));
  assert.deepEqual(rolledBackState,{parents:0,items:0,ledger:0,proofs:0,events:0},
    'A rolled-back first attempt must leave no receipt, proof, parent, item or event');
  const afterRollbackRetry = JSON.parse(await query(rollbackSql));
  assert.equal(afterRollbackRetry.success,true,'Retry after the first transaction rollback must execute as a new operation');

  currentStage = 'R20 concurrent identical and conflicting requests';
  idempotencyConcurrencyResults = await runVersionedUpsertIdempotencyRaces({ query, psqlBin, env });
  assert.deepEqual(idempotencyConcurrencyResults.map((row) => row.name),[
    'versioned-idempotency-identical','versioned-idempotency-conflict','versioned-same-key-distinct-parents',
    'versioned-same-parent-distinct-keys',
    'versioned-cutover-rate-limit-order',
  ],'RC-03/04 identical-key replay, same-key cross-parent serialization, RC-05 distinct-key parent serialization and cutover/rate-lock ordering must all run independently');

  currentStage = 'R20 terminal parent replay and real rate-limit rejection';
  const beforeCancellationVersion = JSON.parse(await query(`select json_build_object('updatedAt',updated_at)::text
    from public.pos_restaurant_orders where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-versioned-client'`)).updatedAt;
  await query(`select public.pos_cancel_restaurant_order_from_pos_v1('lab-license-a','lab-device-a','lab-device-token-a',
    'lab-admin-session','bridge-versioned-client',${quoteSql(beforeCancellationVersion)},'R20 synthetic terminal check','bridge-r20-terminal-cancel')::text`);
  const terminalBeforeReplay = await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert');
  assert.equal(terminalBeforeReplay.parent.status,'cancelled');
  const terminalReplay = JSON.parse(await query(canonicalVersionedSql));
  const terminalAfterReplay = await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert');
  assert.deepEqual(terminalReplay,versionedUpsert,'An exact authorized retry may recover its old receipt after a later terminal transition');
  assert.deepEqual(terminalAfterReplay,terminalBeforeReplay,'Terminal replay must not reopen, edit or duplicate anything');
  const terminalNewKeyError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-r20-terminal-new-key',lineId:'bridge-versioned-line',expectedParentVersion:beforeCancellationVersion }),
    'P0001','RESTAURANT_ORDER_ALREADY_CANCELLED','new write against terminal parent');

  const paidReceipt = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-paid-terminal',
    idempotencyKey:'bridge-r20-paid-terminal-key',lineId:'bridge-r20-paid-terminal-line' })));
  assert.equal(paidReceipt.success,true);
  await runSql(`update public.pos_restaurant_orders set payment_status='paid',paid_at=clock_timestamp()
    where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-r20-paid-terminal';`,
  'mark-paid-terminal-parent-synthetic');
  const paidBeforeReplay = await captureVersionedOrderState('bridge-r20-paid-terminal','bridge-r20-paid-terminal-key');
  const paidReplay = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-paid-terminal',
    idempotencyKey:'bridge-r20-paid-terminal-key',lineId:'bridge-r20-paid-terminal-line' })));
  const paidAfterReplay = await captureVersionedOrderState('bridge-r20-paid-terminal','bridge-r20-paid-terminal-key');
  assert.deepEqual(paidReplay,paidReceipt,'An exact authorized retry may recover the receipt after the parent is marked paid');
  assert.deepEqual(paidAfterReplay,paidBeforeReplay,'Paid-parent receipt recovery must be read-only');
  const paidNewKeyError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-r20-paid-terminal',
    idempotencyKey:'bridge-r20-paid-terminal-new-key',lineId:'bridge-r20-paid-terminal-line' }),
    'P0001','RESTAURANT_ORDER_ALREADY_PAID','new write against paid parent');

  const archivedReceipt = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-archived-terminal',
    idempotencyKey:'bridge-r20-archived-terminal-key',lineId:'bridge-r20-archived-terminal-line' })));
  assert.equal(archivedReceipt.success,true);
  await runSql(`update public.pos_restaurant_orders set archived_at=clock_timestamp(),deleted_at=clock_timestamp(),
      checkout_closed_at=clock_timestamp()
    where license_id=${quoteSql(clientLicenseId)}::uuid and local_order_id='bridge-r20-archived-terminal';`,
  'mark-archived-soft-deleted-and-checkout-closed-synthetic');
  const archivedBeforeReplay = await captureVersionedOrderState('bridge-r20-archived-terminal','bridge-r20-archived-terminal-key');
  const archivedReplay = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-archived-terminal',
    idempotencyKey:'bridge-r20-archived-terminal-key',lineId:'bridge-r20-archived-terminal-line' })));
  const archivedAfterReplay = await captureVersionedOrderState('bridge-r20-archived-terminal','bridge-r20-archived-terminal-key');
  assert.deepEqual(archivedReplay,archivedReceipt,'An exact replay may retrieve the receipt for an authorized archived/tombstoned parent');
  assert.deepEqual(archivedAfterReplay,archivedBeforeReplay,'Archived/tombstoned replay must not reopen or mutate the parent');
  const archivedNewKeyError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:'bridge-r20-archived-terminal',
    idempotencyKey:'bridge-r20-archived-terminal-new-key',lineId:'bridge-r20-archived-terminal-line' }),
    'P0001','RESTAURANT_ORDER_NOT_ACTIVE','new write against archived/deleted/checkout-closed parent');

  const physicallyDeletedReceipt = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-physical-delete',
    idempotencyKey:'bridge-r20-physical-delete-key',lineId:'bridge-r20-physical-delete-line' })));
  assert.equal(physicallyDeletedReceipt.success,true);
  await runSql(`delete from public.pos_restaurant_orders where license_id=${quoteSql(clientLicenseId)}::uuid
    and local_order_id='bridge-r20-physical-delete';`, 'delete-versioned-parent-synthetically');
  const physicallyDeletedReplay = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-r20-physical-delete',
    idempotencyKey:'bridge-r20-physical-delete-key',lineId:'bridge-r20-physical-delete-line' })));
  assert.equal(physicallyDeletedReplay.code,'IDEMPOTENCY_CONFLICT',
    'A deleted parent no longer proves authorization or receipt-parent correspondence and must fail closed');
  assert.equal('order' in physicallyDeletedReplay,false,"A physically deleted parent's receipt must not be disclosed");

  const staffSessionId = await query(`select id::text from public.license_staff_sessions
    where license_id=${quoteSql(clientLicenseId)}::uuid and device_id='00000000-0000-0000-0000-00000000000b'::uuid
      and session_token_hash=extensions.crypt('lab-staff-session',session_token_hash) and revoked_at is null limit 1`);
  assert.ok(staffSessionId, 'The valid Staff session must exist for the limiter order check');
  await runSql(`update public.license_staff_sessions set last_seen_at=clock_timestamp()-interval '1 minute'
    where id=${quoteSql(staffSessionId)}::uuid;`, 'age-staff-session-before-blocked-request');
  const staffSessionHash = await query(`select encode(extensions.digest('lab-staff-session','sha256'),'hex')`);
  await runSql(`delete from public.pos_rpc_rate_limits
    where license_key='lab-license-a' and device_fingerprint='lab-device-b'
      and rpc_name='pos_upsert_restaurant_order'
      and staff_session_hash=${quoteSql(staffSessionHash)};`, 'clear-authentic-rate-limit-window');
  await runSql(`insert into public.pos_rpc_rate_limits(
      license_key,device_fingerprint,staff_session_hash,rpc_name,window_start,window_seconds,request_count,
      created_at,updated_at,scope,blocked_until,last_limited_at,metadata)
    values ('lab-license-a','lab-device-b',${quoteSql(staffSessionHash)},'pos_upsert_restaurant_order',
      to_timestamp(floor(extract(epoch from now())/600)*600),600,120,now(),now(),'POS_WRITE',null,null,'{}'::jsonb);`,
  'seed-authentic-rate-limit-window');
  const lastSeenBeforeBlocked = await query(`select last_seen_at::text from public.license_staff_sessions where id=${quoteSql(staffSessionId)}::uuid`);
  const staffOwnedStateBeforeBlockedReplay = await captureVersionedOrderState('bridge-r20-staff-owned','bridge-r20-staff-owned-key');
  const blockedReplay = JSON.parse(await query(versionedClientUpsertSql({ device:'lab-device-b',
    deviceToken:'lab-device-token-b',staffSession:'lab-staff-session',localOrderId:'bridge-r20-staff-owned',
    idempotencyKey:'bridge-r20-staff-owned-key',lineId:'bridge-r20-staff-owned-line' })));
  assert.equal(blockedReplay.success,false);
  assert.equal(blockedReplay.code,'RPC_RATE_LIMITED');
  assert.equal('order' in blockedReplay,false,'Rate-limit rejection must not expose the stored receipt');
  const blockedRateState = JSON.parse(await query(`select json_build_object(
    'requestCount',request_count,'isBlocked',blocked_until>clock_timestamp())::text
    from public.pos_rpc_rate_limits where license_key='lab-license-a' and device_fingerprint='lab-device-b'
      and rpc_name='pos_upsert_restaurant_order' and scope='POS_WRITE'
      and staff_session_hash=${quoteSql(staffSessionHash)}`));
  assert.deepEqual(blockedRateState,{ requestCount:121,isBlocked:true },
    'The real 120-attempt limiter must record and block the 121st request');
  const lastSeenAfterBlocked = await query(`select last_seen_at::text from public.license_staff_sessions where id=${quoteSql(staffSessionId)}::uuid`);
  assert.equal(lastSeenAfterBlocked,lastSeenBeforeBlocked,
    'A blocked request must be rejected before validation touches the Staff session');
  assert.deepEqual(await captureVersionedOrderState('bridge-r20-staff-owned','bridge-r20-staff-owned-key'),staffOwnedStateBeforeBlockedReplay,
    'A rate-limited replay must not modify its target parent, items, receipts or financial state');
  await runSql(`delete from public.pos_rpc_rate_limits where license_key='lab-license-a'
    and device_fingerprint='lab-device-b' and rpc_name='pos_upsert_restaurant_order' and scope='POS_WRITE'
    and staff_session_hash=${quoteSql(staffSessionHash)};`, 'cleanup-versioned-rate-limit');

  await runSql(`update public.pos_idempotency_keys set expires_at=clock_timestamp()-interval '1 second'
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key='bridge-versioned-client-upsert';`, 'expire-replay-ledger-synthetic');
  const expiredReplay = JSON.parse(await query(canonicalVersionedSql));
  assert.deepEqual(expiredReplay,versionedUpsert,
    'The shared ledger does not enforce expires_at for completed receipts; an uncollected row remains replayable');
  assert.deepEqual(await captureVersionedOrderState('bridge-versioned-client','bridge-versioned-client-upsert'),terminalBeforeReplay,
    'A receipt replay after expires_at passes must remain read-only on a terminal parent');
  const expiredConflict = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:'bridge-versioned-client',
    idempotencyKey:'bridge-versioned-client-upsert',lineId:'bridge-versioned-line',tableLabel:'Different after expiry' })));
  assert.equal(expiredConflict.code,'IDEMPOTENCY_CONFLICT',
    'An expired marker must not silently release the key while its unique ledger row remains');
  assert.equal('order' in expiredConflict,false);

  const ledgerDeletionLocalId = 'bridge-r20-ledger-deletion';
  const ledgerDeletionKey = 'bridge-r20-ledger-deletion-key';
  const ledgerDeletionLineId = 'bridge-r20-ledger-deletion-line';
  const ledgerDeletionReceipt = JSON.parse(await query(versionedClientUpsertSql({ localOrderId:ledgerDeletionLocalId,
    idempotencyKey:ledgerDeletionKey,lineId:ledgerDeletionLineId })));
  assert.equal(ledgerDeletionReceipt.success,true);
  const ledgerDeletionBefore = await captureVersionedOrderState(ledgerDeletionLocalId,ledgerDeletionKey);
  await runSql(`delete from public.pos_idempotency_keys where license_id=${quoteSql(clientLicenseId)}::uuid
    and idempotency_key=${quoteSql(ledgerDeletionKey)};`, 'delete-shared-ledger-row-synthetic');
  const orphanProofCount = await query(`select count(*)::text from private.restaurant_order_upsert_replay_proofs_v1
    where license_id=${quoteSql(clientLicenseId)}::uuid and idempotency_key=${quoteSql(ledgerDeletionKey)}`);
  assert.equal(orphanProofCount,'0','Deleting the shared ledger row must cascade-delete its private proof');
  const deletedLedgerRetryError = await assertSqlFailure(versionedClientUpsertSql({ localOrderId:ledgerDeletionLocalId,
    idempotencyKey:ledgerDeletionKey,lineId:ledgerDeletionLineId }),
    'P0001','RESTAURANT_ORDER_VERSION_REQUIRED','retry after retained ledger row deletion');
  const ledgerDeletionAfter = await captureVersionedOrderState(ledgerDeletionLocalId,ledgerDeletionKey);
  assert.deepEqual(ledgerDeletionAfter,{...ledgerDeletionBefore,ledgerRowsForKey:0,proofRowsForKey:0},
    'After ledger deletion, the orphan proof is gone and a stale no-version request cannot recreate or mutate the parent');

  idempotencyEvidence = {
    status:'PASS',
    firstWrite: 'R20-01 PASS', postCommitLostResponseReplay: 'R20-02/R20-03 PASS',
    noDuplicateBusinessEffects: 'PASS', rateLimitBlockedReplay: 'PASS',
    concurrent: idempotencyConcurrencyResults, rollbackRetry: 'PASS',
    atomicity: {
      explicitTopLevelRollbackAfterProof: 'PASS',
      injectedFailureDuringLedgerCompletion: 'PASS',
      injectedFailureAfterProofInsert: 'PASS',
      checkedFromSeparateConnection: true,
    },
    conflictCases: ['changed order payload','changed articles','different parent','other operation','processing row','missing receipt',
      'missing proof','corrupt request proof','tampered receipt','foreign Staff/device','Admin session on another device','different Staff','revoked Staff session','Admin OFF','revoked POS permission','invalid session','physical parent ID','physical line ID','new key without version',
      'stale version','terminal parent new write','different payload after expiry','ledger deletion cascades proof and stale retry requires parent refresh'],
    terminalReplay: 'exact authorized receipt returned read-only after cancellation, paid marker, and archived/soft-deleted/checkout-closed markers',
    physicalDeleteReplay: 'IDEMPOTENCY_CONFLICT without receipt when canonical parent row is physically absent',
    paidStateSetup: 'synthetic terminal marker only; no cashier, payment, inventory, credit, or ledger operation is claimed',
    expirationPolicy: 'expires_at is a legacy retention marker; completed rows remain replayable and keys are not reusable while retained',
    ledgerDeletionPolicy: 'deleting a ledger row cascades its proof; a stale no-version retry cannot recreate a key on an existing parent',
    otherLicense: 'same key used in a separate license namespace; separate parent/receipt created',
    errors: [noVersionError,staleVersionError,physicalParentError,physicalLineError,foreignDeviceError,revokedStaffSessionError,
      invalidSessionError,wrongDeviceSessionError,terminalNewKeyError,otherStaffReplayError,adminOffReplayError,revokedPermissionError,deletedLedgerRetryError],
    hash: { legacyWriter: 'MD5 cross-check only', bridgeProof: 'SHA-256 of exact writer JSONB text hash input' },
  };
  passed('versioned idempotency binds the strong request proof, preserves the authentic rate-limit and rejects conflicts',
    idempotencyEvidence);

  passed('legacy and versioned clients persist and replay one correctly licensed parent and item', {
    legacy: { role: 'service_role', relationship: legacyRelation },
    versioned: { role: 'anon', relationship: versionedRelation },
  });
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
  passed('Restaurant settlement and replay materialize one sale, payment, operation and inventory movement', {
    receiptsIdentical: true, sales: 1, payments: 1, operations: 1, inventoryMovements: 1, parentPaid: true,
  });

  currentStage = 'concurrent settlement versus cancellation and concurrent replay';
  financialRaceResults = await runRestaurantFinancialRaces({ query, psqlBin, env, createLegacyOrder });
  assert.deepEqual(financialRaceResults.map((row) => row.name), ['F1', 'F2']);
  passed('financial settlement races completed with observed parent locks', { scenarios: financialRaceResults.map((row) => row.name) });

  currentStage = 'Restaurant cancellation and rollback';
  cancellationResults = await runRestaurantCancellationScenarios({ query, createLegacyOrder, paidOrderId: 'r6-f2-parent' });
  assert.equal(financialRaceResults[0].status, 'PASS');
  const cancellationRace = financialRaceResults[0];
  cancellationResults.push({ name: 'C5', status: cancellationRace.status, financialRace: 'F1',
    operation: cancellationRace.sql.contender, actor: cancellationRace.actor, parentId: cancellationRace.stateBefore.parentId,
    localOrderId: cancellationRace.stateBefore.localOrderId,
    stateBefore: cancellationRace.stateBefore, stateAfter: cancellationRace.finalState,
    financialEffects: cancellationRace.finalState, sqlstate: cancellationRace.sqlstate,
    cleanup: { pendingProcesses: cancellationRace.pendingProcesses, pendingDatabaseSessions: cancellationRace.pendingDatabaseSessions,
      permitRows: cancellationRace.finalState.permits } });
  passed('Restaurant cancellation scenarios completed', { scenarios: cancellationResults.map((row) => row.name) });

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
