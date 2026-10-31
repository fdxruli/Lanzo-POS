import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const container = process.env.PG_CONTAINER_ID;
if (!container) throw new Error('FIN01_EPHEMERAL_POSTGRES_CONTAINER_REQUIRED');
const expectedSha = process.env.GITHUB_SHA ?? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
if (!/^[0-9a-f]{40}$/u.test(expectedSha)) throw new Error('FIN01_GIT_SHA_REQUIRED');
const versionNum = (await queryLoopbackPostgres('show server_version_num;', 'fin01_cert_template')).trim();
const versionLabel = versionNum === '170011' ? '17.11' : versionNum === '170006' ? '17.6' : `unsupported-${versionNum}`;
const suffix = versionNum === '170011' ? '1711' : '176';
const template = 'fin01_cert_template';
const successDb = `fin01_cert_success_${suffix}`;
const results = [];
const contract = JSON.parse(await fs.readFile(path.join(root, 'docs/reports/fin01-r22/release-review/fixtures/post-3d14-contract.json'), 'utf8'));
const baseline = JSON.parse(await fs.readFile(path.join(root, 'docs/reports/fin01-r22/release-review/fixtures/production-ledger-versions.json'), 'utf8')).versions;
const targetVersions = ['20261022135915', '20261029235906'];
const appPath = path.join(root, 'scripts/fin01/release-review/selective-apply-lab.mjs');
const q = (database, sql) => queryLoopbackPostgres(sql, database);

function record(name, status, detail = null) { results.push({ name, status, detail }); }

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  return result;
}

function docker(args, options = {}) {
  const result = run('docker', ['exec', container, ...args], options);
  if (result.status !== 0) throw new Error(`DOCKER_COMMAND_FAILED:${args[0]}:${result.stderr || result.stdout}`);
  return result;
}

function createDb(name) {
  assert.match(name, /^fin01_cert_[a-z0-9_]+$/u);
  docker(['createdb', '-U', 'postgres', '--template', template, name]);
}

async function snapshot(database) {
  return JSON.parse(await q(database, `select json_build_object(
    'database',current_database(),
    'server_version_num',current_setting('server_version_num'),
    'ledger',coalesce((select json_agg(json_build_object('version',version,'name',name,'statements',statements,'created_by',created_by,'idempotency_key',idempotency_key,'rollback',rollback) order by version) from supabase_migrations.schema_migrations),'[]'::json)
  );`));
}

async function functionProfiles(database, profiles) {
  const signatures = Object.keys(profiles);
  const required = signatures.map((signature) => `('${signature.replaceAll("'", "''")}')`).join(',');
  return JSON.parse(await q(database, `with required(signature) as (values ${required})
    select coalesce(json_agg(json_build_object(
      'signature',r.signature,
      'hash',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
      'owner',pg_get_userbyid(p.proowner),
      'acl',coalesce(p.proacl::text,''),
      'security_definer',p.prosecdef,
      'config',coalesce(to_json(p.proconfig),'[]'::json)
    ) order by r.signature),'[]'::json)
    from required r join pg_proc p on p.oid=to_regprocedure(r.signature);`));
}

function assertFunctionProfiles(actual, expected, label) {
  assert.equal(actual.length, Object.keys(expected).length, `${label}_FUNCTION_COUNT`);
  for (const profile of actual) {
    const expectedProfile = expected[profile.signature];
    assert.ok(expectedProfile, `${label}_UNEXPECTED_FUNCTION:${profile.signature}`);
    assert.equal(profile.hash, expectedProfile.md5_cr_removed, `${label}_HASH:${profile.signature}`);
    assert.equal(profile.owner, expectedProfile.owner, `${label}_OWNER:${profile.signature}`);
    assert.equal(profile.acl, expectedProfile.acl, `${label}_ACL:${profile.signature}`);
    assert.equal(profile.security_definer, expectedProfile.security_definer, `${label}_SECURITY:${profile.signature}`);
    assert.deepEqual(profile.config, expectedProfile.config, `${label}_CONFIG:${profile.signature}`);
  }
}

async function applierReport(label) {
  return JSON.parse(await fs.readFile(path.join(root, `artifacts/fin01/applier-${label}.json`), 'utf8'));
}

function apply(database, { fault, projectId = 'fin01-synthetic-replay', expected = expectedSha, unsupported = false, label } = {}) {
  const report = `artifacts/fin01/applier-${label ?? database}.json`;
  const args = [appPath, `--database=${database}`, `--project-id=${projectId}`, `--expected-sha=${expected}`, `--report=${report}`];
  if (fault) args.push(`--fault=${fault}`);
  if (unsupported) args.push('--migration=20261008180000');
  return run(process.execPath, args, { env: { ...process.env, GITHUB_SHA: expectedSha } });
}

async function expect(name, body) {
  try {
    const detail = await body();
    record(name, 'PASS', detail ?? null);
  } catch (error) {
    record(name, 'FAIL', { message: error.message, sqlstate: error.code ?? null });
  }
}

await fs.mkdir(path.join(root, 'artifacts/fin01'), { recursive: true });

await expect('PG service version is exactly PostgreSQL 17.11 or 17.6', async () => {
  assert.ok(['170011', '170006'].includes(versionNum), `POSTGRES_VERSION_REJECTED:${versionNum}`);
  return { server_version_num: versionNum, postgres: versionLabel };
});

await expect('fresh state applies only F then PAY-N01 and preserves all 333 original ledger rows', async () => {
  createDb(successDb);
  const before = await snapshot(successDb);
  assert.equal(before.ledger.length, 333);
  assert.deepEqual(before.ledger.map((row) => row.version).sort(), [...baseline].sort());
  const first = apply(successDb, { label: 'success-first' });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const after = await snapshot(successDb);
  assert.equal(after.ledger.length, 335);
  assert.deepEqual(after.ledger.filter((row) => targetVersions.includes(row.version)).map((row) => row.version), targetVersions);
  assert.deepEqual(after.ledger.filter((row) => baseline.includes(row.version)), before.ledger);
  const rows = after.ledger.filter((row) => targetVersions.includes(row.version));
  assert.deepEqual(rows.map(({ version, name, statements, created_by, idempotency_key, rollback }) => ({ version, name, statements, created_by, idempotency_key, rollback })), [
    { version: '20261022135915', name: 'fin01_historical_credit_owner_authorization', statements: rows[0].statements, created_by: null, idempotency_key: null, rollback: null },
    { version: '20261029235906', name: 'fin01_pay_n01_atomic_rejection_v1', statements: rows[1].statements, created_by: null, idempotency_key: null, rollback: null }
  ]);
  assert.ok(rows[0].statements.length === 20 && rows[1].statements.length === 8);
  const evidence = await applierReport('success-first');
  assert.equal(evidence.result, 'PASS');
  assert.deepEqual(evidence.transactions.map(({ transaction_end }) => transaction_end), ['COMMIT', 'COMMIT']);
  assert.equal(evidence.after.count, 335);
  return { database: successDb, before: 333, after: 335, targets: targetVersions, statement_counts: rows.map((row) => row.statements.length), commit_evidence: evidence.transactions };
});

await expect('a second completed invocation is rejected without changing the ledger', async () => {
  const before = await snapshot(successDb);
  const second = apply(successDb, { label: 'second-attempt' });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr + second.stdout, /PAY_N01_ALREADY_PRESENT|MIGRATION_LEDGER_ROW|UNEXPECTED_LEDGER_VERSION|TOO_MANY_FIN01_MIGRATIONS_PRESENT/);
  assert.deepEqual(await snapshot(successDb), before);
  return { database: successDb, rejected: true, rows_unchanged: true };
});

await expect('wrong migration SHA is rejected before any database write', async () => {
  const db = `fin01_cert_hash_${suffix}`;
  createDb(db);
  const before = await snapshot(db);
  const result = apply(db, { fault: 'HASH', label: 'wrong-migration-hash' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /MIGRATION_SHA256_MISMATCH/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, ledger_rows_unchanged: true };
});

await expect('wrong release SHA is rejected before any database write', async () => {
  const db = `fin01_cert_release_sha_${suffix}`;
  createDb(db);
  const before = await snapshot(db);
  const result = apply(db, { expected: '0'.repeat(40), label: 'wrong-release-sha' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /RELEASE_GIT_SHA_MISMATCH/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, ledger_rows_unchanged: true };
});

await expect('unexpected project identity is rejected before any database write', async () => {
  const db = `fin01_cert_project_${suffix}`;
  createDb(db);
  const before = await snapshot(db);
  const result = apply(db, { projectId: 'production-project', label: 'wrong-project' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /SYNTHETIC_PROJECT_ID_REQUIRED/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, ledger_rows_unchanged: true };
});

await expect('unexpected version is rejected before any migration runs', async () => {
  const db = `fin01_cert_unexpected_${suffix}`;
  createDb(db);
  await q(db, `insert into supabase_migrations.schema_migrations(version,name,statements) values('20990101000000','unexpected-fixture',array[]::text[]);`);
  const before = await snapshot(db);
  const result = apply(db, { label: 'unexpected-version' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /UNEXPECTED_LEDGER_VERSION/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, added_version_preserved: '20990101000000' };
});

await expect('3D14 function drift is rejected before any migration runs', async () => {
  const db = `fin01_cert_drift_${suffix}`;
  createDb(db);
  await q(db, `create or replace function private.assert_restaurant_sale_dispatcher_context_v1(
    p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
    p_sale jsonb,p_cash_session_id text,p_internal_idempotency_key text,p_operation_type text
  ) returns void language plpgsql set search_path to '' as $fin01_drift$ begin return; end $fin01_drift$;`);
  const before = await snapshot(db);
  const result = apply(db, { label: 'function-drift' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FUNCTION_PROFILE_POST_3D14_DRIFT/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, reason: '3D14 dispatcher helper drift' };
});

await expect('3D14 dispatcher signature drift is rejected before any migration runs', async () => {
  const db = `fin01_cert_signature_${suffix}`;
  createDb(db);
  await q(db, `alter function private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text) rename to assert_restaurant_sale_dispatcher_context_v1_changed;`);
  const before = await snapshot(db);
  const result = apply(db, { label: 'signature-drift' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FUNCTION_PROFILE_POST_3D14_DRIFT/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, reason: 'required dispatcher signature missing' };
});

await expect('3D14 dispatcher ACL drift is rejected before any migration runs', async () => {
  const db = `fin01_cert_acl_${suffix}`;
  createDb(db);
  await q(db, `grant execute on function private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text) to anon;`);
  const before = await snapshot(db);
  const result = apply(db, { label: 'acl-drift' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FUNCTION_PROFILE_POST_3D14_DRIFT/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, reason: 'dispatcher ACL changed' };
});

await expect('failure inside F rolls back all F SQL and leaves the original 333-row ledger intact', async () => {
  const db = `fin01_cert_fault_f_${suffix}`;
  createDb(db);
  const before = await snapshot(db);
  const result = apply(db, { fault: 'F', label: 'fault-f' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FIN01_LAB_INJECTED_TRANSACTION_FAILURE/);
  const application = await applierReport('fault-f');
  assert.equal(application.failure.sqlstate, 'P0001');
  const after = await snapshot(db);
  assert.deepEqual(after, before);
  const profiles = await functionProfiles(db, contract.stages.post_3d14);
  assertFunctionProfiles(profiles, contract.stages.post_3d14, 'F_ROLLBACK_CATALOG');
  return { database: db, sqlstate: application.failure.sqlstate, transaction: 'ROLLBACK', ledger_before: before.ledger.length, ledger_after: after.ledger.length, catalog_unchanged: true };
});

await expect('failure inside PAY-N01 retains only completed F; retry resumes PAY-N01 safely', async () => {
  const db = `fin01_cert_fault_pay_${suffix}`;
  createDb(db);
  const before = await snapshot(db);
  const failed = apply(db, { fault: 'PAY', label: 'fault-pay' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr + failed.stdout, /FIN01_LAB_INJECTED_TRANSACTION_FAILURE/);
  const application = await applierReport('fault-pay');
  assert.equal(application.failure.sqlstate, 'P0001');
  const afterFailure = await snapshot(db);
  assert.equal(afterFailure.ledger.length, 334);
  assert.deepEqual(afterFailure.ledger.filter((row) => baseline.includes(row.version)), before.ledger);
  assert.deepEqual(afterFailure.ledger.filter((row) => targetVersions.includes(row.version)).map((row) => row.version), ['20261022135915']);
  const afterFailureProfiles = await functionProfiles(db, contract.stages.post_f);
  assertFunctionProfiles(afterFailureProfiles, contract.stages.post_f, 'PAY_ROLLBACK_CATALOG');
  const retry = apply(db, { label: 'retry-pay' });
  assert.equal(retry.status, 0, retry.stderr || retry.stdout);
  const afterRetry = await snapshot(db);
  assert.equal(afterRetry.ledger.length, 335);
  assert.deepEqual(afterRetry.ledger.filter((row) => targetVersions.includes(row.version)).map((row) => row.version), targetVersions);
  assert.deepEqual(afterRetry.ledger.filter((row) => baseline.includes(row.version)), before.ledger);
  const retryEvidence = await applierReport('retry-pay');
  assert.equal(retryEvidence.result, 'PASS');
  return { database: db, sqlstate: application.failure.sqlstate, failed_transaction: 'ROLLBACK', committed_prior_state: 'baseline plus F', retry_transaction: 'COMMIT', retry_state: 'baseline plus F and PAY-N01', catalog_preserved_after_failed_pay: true };
});

await expect('advisory session lock rejects a concurrent applier before writes', async () => {
  const db = `fin01_cert_concurrent_${suffix}`;
  createDb(db);
  const before = await snapshot(db);
  const lockQuery = q(db, 'select pg_advisory_lock(214801,31591); select pg_sleep(3); select pg_advisory_unlock(214801,31591);');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const result = apply(db, { label: 'concurrent-attempt' });
  await lockQuery;
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /FIN01_LAB_CONCURRENT_APPLY_REJECTED/);
  assert.deepEqual(await snapshot(db), before);
  return { database: db, rejected: true, ledger_rows_unchanged: true };
});

await expect('unsupported migration selection is rejected; only F and PAY-N01 are selectable', async () => {
  const result = apply(`fin01_cert_unsupported_${suffix}`, { unsupported: true, label: 'unsupported-version' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /UNSUPPORTED_OR_DUPLICATE_ARGUMENT/);
  return { requested_version: '20261008180000', rejected: true, allowed: targetVersions };
});

await expect('synthetic backup restores the 335-row ledger and guarded post-PAY catalog', async () => {
  const dumpPath = path.join(os.tmpdir(), `fin01-cert-pg${versionLabel}-${process.env.GITHUB_RUN_ID ?? 'local'}-post-pay.dump`);
  const dump = run('docker', ['exec', container, 'pg_dump', '-Fc', '-U', 'postgres', '-d', successDb], { encoding: null, maxBuffer: 64 * 1024 * 1024 });
  if (dump.status !== 0) throw new Error(`PG_DUMP_FAILED:${dump.stderr?.toString()}`);
  await fs.writeFile(dumpPath, dump.stdout);
  const restoreDb = `fin01_cert_restore_${suffix}`;
  docker(['createdb', '-U', 'postgres', restoreDb]);
  const restore = run('docker', ['exec', '-i', container, 'pg_restore', '-U', 'postgres', '-d', restoreDb, '--no-owner', '--no-privileges', '--exit-on-error'], { input: dump.stdout });
  assert.equal(restore.status, 0, restore.stderr || restore.stdout);
  const restored = await snapshot(restoreDb);
  const restoredLedgerSchema = await (async () => {
    const raw = await q(restoreDb, `select json_build_object(
      'columns',coalesce((select json_agg(array[column_name,data_type,is_nullable] order by ordinal_position) from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations'),'[]'::json),
      'owner',(select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='supabase_migrations' and c.relname='schema_migrations'),
      'rls',(select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='supabase_migrations' and c.relname='schema_migrations'),
      'primary_key',exists(select 1 from pg_constraint c where c.conrelid='supabase_migrations.schema_migrations'::regclass and c.contype='p' and pg_get_constraintdef(c.oid)='PRIMARY KEY (version)'),
      'idempotency_unique',exists(select 1 from pg_constraint c where c.conrelid='supabase_migrations.schema_migrations'::regclass and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (idempotency_key)')
    );`);
    return JSON.parse(raw);
  })();
  assert.deepEqual(restoredLedgerSchema.columns, [
    ['version', 'text', 'NO'], ['statements', 'ARRAY', 'YES'], ['name', 'text', 'YES'],
    ['created_by', 'text', 'YES'], ['idempotency_key', 'text', 'YES'], ['rollback', 'ARRAY', 'YES']
  ]);
  assert.equal(restoredLedgerSchema.owner, 'postgres');
  assert.equal(restoredLedgerSchema.rls, false);
  assert.equal(restoredLedgerSchema.primary_key, true);
  assert.equal(restoredLedgerSchema.idempotency_unique, true);
  assert.equal(restored.ledger.length, 335);
  assert.deepEqual(restored.ledger.filter((row) => targetVersions.includes(row.version)).map((row) => row.version), targetVersions);
  const profiles = contract.stages.post_pay;
  const profileRows = await functionProfiles(restoreDb, profiles);
  assertFunctionProfiles(profileRows, profiles, 'RESTORED');
  await fs.rm(dumpPath, { force: true });
  return { backup: path.basename(dumpPath), bytes: dump.stdout.length, restored_database: restoreDb, restored_ledger_rows: 335, guarded_functions: profileRows.length };
});

const summary = {
  postgres: versionLabel,
  server_version_num: versionNum,
  code_sha: expectedSha,
  template_database: template,
  success_database: successDb,
  executed: results.length,
  passed: results.filter((result) => result.status === 'PASS').length,
  failed: results.filter((result) => result.status === 'FAIL').length,
  results
};
await fs.writeFile(path.join(root, `artifacts/fin01/selective-apply-tests-${versionLabel}.json`), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ postgres: versionLabel, ...summary, results: undefined })}\n`);
if (summary.failed) process.exitCode = 1;
process.stdout.write(`SUCCESS_DATABASE=${successDb}\n`);
