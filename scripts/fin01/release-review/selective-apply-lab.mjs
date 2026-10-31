#!/usr/bin/env node
// Synthetic-lab prototype only. Connection is fixed to loopback by the
// adjacent helper; this program has no URL/DSN, host, port, credential, or
// Supabase project configuration path and refuses non-fixture database names.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';
import { splitAndTrim, transactionBody } from './supabase-migration-parser.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const report = {
  result: 'INCOMPLETE',
  mode: null,
  code_sha: null,
  project_id: null,
  database: null,
  postgres_version_num: null,
  baseline_ledger_count: null,
  before: null,
  after: null,
  migrations: [],
  transactions: [],
  failure: null
};
const expectedFiles = [
  {
    version: '20261022135915',
    name: 'fin01_historical_credit_owner_authorization',
    path: 'supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql',
    sha256: '855a25f313741d4181be90dede4925cbfdce59fce23a1ff34a5fff463eff5e9e'
  },
  {
    version: '20261029235906',
    name: 'fin01_pay_n01_atomic_rejection_v1',
    path: 'supabase/migrations/20261029235906_fin01_pay_n01_atomic_rejection_v1.sql',
    sha256: 'a53cc7865092737752949bfe5db455521290206c70907040e3b920223380b244'
  }
];
const lockKeys = [214801, 31591];
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const jsonLit = (value) => `${lit(JSON.stringify(value))}::jsonb`;

function parseArgs(argv) {
  const allowed = new Set(['--database', '--project-id', '--expected-sha', '--fault', '--report']);
  const values = {};
  for (const arg of argv) {
    const match = arg.match(/^(--[a-z-]+)=(.*)$/u);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(values, match[1])) {
      throw new Error(`UNSUPPORTED_OR_DUPLICATE_ARGUMENT:${arg.split('=')[0]}`);
    }
    values[match[1]] = match[2];
  }
  for (const required of ['--database', '--project-id', '--expected-sha']) {
    if (!values[required]) throw new Error(`REQUIRED_ARGUMENT:${required}`);
  }
  if (values['--fault'] && !['F', 'PAY', 'HASH'].includes(values['--fault'])) throw new Error('FAULT_MUST_BE_F_PAY_OR_HASH');
  if (!/^fin01_cert_[a-z0-9_]+$/u.test(values['--database'])) throw new Error('SYNTHETIC_DATABASE_REQUIRED');
  if (values['--project-id'] !== 'fin01-synthetic-replay') throw new Error('SYNTHETIC_PROJECT_ID_REQUIRED');
  if (!/^[0-9a-f]{40}$/u.test(values['--expected-sha'])) throw new Error('EXPECTED_GIT_SHA_REQUIRED');
  if (values['--report'] && !/^artifacts\/fin01\/[a-z0-9._/-]+\.json$/u.test(values['--report'])) {
    throw new Error('ARTIFACT_REPORT_PATH_REQUIRED');
  }
  return values;
}

function sqlArray(values) {
  return `ARRAY[${values.map((value) => `${lit(value)}::text`).join(',')}]::text[]`;
}

function parseVersionRows(rows) {
  assert.ok(Array.isArray(rows), 'LEDGER_ROWS_ARRAY_REQUIRED');
  return rows;
}

async function q(database, sql) {
  return queryLoopbackPostgres(sql, database);
}

async function getSnapshot(database) {
  const raw = await q(database, `
    select json_build_object(
      'database', current_database(),
      'current_user', current_user,
      'server_version_num', current_setting('server_version_num'),
      'client_addr', coalesce(inet_client_addr()::text, 'local-socket'),
      'project_id', (select project_id from fin01_lab.identity where identity_key='project'),
      'baseline_sha', (select baseline_sha from fin01_lab.identity where identity_key='base'),
      'ledger', coalesce((select json_agg(json_build_object(
        'version', version, 'name', name, 'statements', statements,
        'created_by', created_by, 'idempotency_key', idempotency_key, 'rollback', rollback
      ) order by version) from supabase_migrations.schema_migrations), '[]'::json)
    );
  `);
  return JSON.parse(raw);
}

function compareRows(actual, expected, label) {
  assert.deepEqual(actual, expected, `${label}_MISMATCH`);
}

function sortRows(rows) {
  return [...rows].sort((left, right) => left.version.localeCompare(right.version));
}

async function getFunctionProfile(database, expectedProfiles) {
  const signatures = Object.keys(expectedProfiles);
  const values = signatures.map((signature) => `(${lit(signature)}::text)`).join(',');
  const raw = await q(database, `
    with required(signature) as (values ${values})
    select coalesce(json_agg(json_build_object(
      'signature', r.signature,
      'md5_cr_removed', case when p.oid is null then null else md5(replace(pg_get_functiondef(p.oid), chr(13), '')) end,
      'owner', case when p.oid is null then null else pg_get_userbyid(p.proowner) end,
      'acl', case when p.oid is null then null else coalesce(p.proacl::text, '') end,
      'security_definer', p.prosecdef,
      'config', coalesce(to_json(p.proconfig), '[]'::json)
    ) order by r.signature), '[]'::json)
    from required r left join pg_proc p on p.oid = to_regprocedure(r.signature);
  `);
  return JSON.parse(raw);
}

async function assertFunctionProfile(database, contract, stage) {
  const expectedProfiles = contract.stages[stage];
  const actual = await getFunctionProfile(database, expectedProfiles);
  const bySignature = Object.fromEntries(actual.map((item) => [item.signature, item]));
  const mismatches = [];
  for (const [signature, expected] of Object.entries(expectedProfiles)) {
    const got = bySignature[signature];
    if (!got || Object.entries(expected).some(([key, value]) => JSON.stringify(got[key]) !== JSON.stringify(value))) {
      mismatches.push({ signature, expected, actual: got ?? null });
    }
  }
  assert.deepEqual(mismatches, [], `FUNCTION_PROFILE_${stage.toUpperCase()}_DRIFT`);
  return actual;
}

async function assertFPreconditions(database) {
  const expected = [
    ['public.pos_create_cloud_sale_credit_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)', 'e8f0fa18758e867c1b32b8076abae463'],
    ['public.pos_upsert_customer_unlimited(text,text,text,text,jsonb,integer,text)', 'c7e33d0905c0188cfea21ecc7dbcbb39'],
    ['public.pos_migrate_local_customer_credit_unlimited(text,text,text,text,jsonb,jsonb,text)', '16a2e7539918f7048247eae6e26bfc86'],
    ['private.require_active_admin_session(text,text,text,text)', '99a8293898a6200351a5d97027fc5c50'],
    ['private.validate_pos_sync_context(text,text,text,text)', '8f23a11866c54497f0a8e0f463152f4a']
  ];
  const values = expected.map(([signature, hash]) => `(${lit(signature)}::text,${lit(hash)}::text)`).join(',');
  const raw = await q(database, `
    with expected(signature, fingerprint) as (values ${values})
    select coalesce(json_agg(json_build_object('signature',e.signature,'expected',e.fingerprint,
      'actual',case when to_regprocedure(e.signature) is null then null else md5(pg_get_functiondef(to_regprocedure(e.signature))) end)
      order by e.signature), '[]'::json)
    from expected e;
  `);
  const actual = JSON.parse(raw);
  const mismatches = actual.filter((row) => row.actual !== row.expected);
  assert.deepEqual(mismatches, [], 'FIN01_F_EXACT_PRECONDITION_HASH_DRIFT');
  return actual;
}

function assertLedgerSchema(rows) {
  assert.deepEqual(rows.columns, [
    ['version', 'text', 'NO'],
    ['statements', 'ARRAY', 'YES'],
    ['name', 'text', 'YES'],
    ['created_by', 'text', 'YES'],
    ['idempotency_key', 'text', 'YES'],
    ['rollback', 'ARRAY', 'YES']
  ], 'LEDGER_COLUMN_SHAPE_MISMATCH');
  assert.equal(rows.owner, 'postgres', 'LEDGER_OWNER_MISMATCH');
  assert.equal(rows.rls, false, 'LEDGER_RLS_MISMATCH');
  assert.equal(rows.primary_key, true, 'LEDGER_PRIMARY_KEY_REQUIRED');
  assert.equal(rows.idempotency_unique, true, 'LEDGER_IDEMPOTENCY_UNIQUE_REQUIRED');
}

async function getLedgerSchema(database) {
  const raw = await q(database, `
    select json_build_object(
      'columns', coalesce((select json_agg(array[column_name,data_type,is_nullable] order by ordinal_position)
        from information_schema.columns where table_schema='supabase_migrations' and table_name='schema_migrations'),'[]'::json),
      'owner', (select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='supabase_migrations' and c.relname='schema_migrations'),
      'rls', (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='supabase_migrations' and c.relname='schema_migrations'),
      'primary_key', exists(select 1 from pg_constraint c where c.conrelid='supabase_migrations.schema_migrations'::regclass and c.contype='p' and pg_get_constraintdef(c.oid)='PRIMARY KEY (version)'),
      'idempotency_unique', exists(select 1 from pg_constraint c where c.conrelid='supabase_migrations.schema_migrations'::regclass and c.contype='u' and pg_get_constraintdef(c.oid)='UNIQUE (idempotency_key)')
    );
  `);
  const schema = JSON.parse(raw);
  assertLedgerSchema(schema);
  return schema;
}

function expectedVersionRow(migration) {
  return {
    version: migration.version,
    name: migration.name,
    statements: migration.statements,
    created_by: null,
    idempotency_key: null,
    rollback: null
  };
}

function assertKnownLedger(snapshot, baselineVersions, migrationByVersion) {
  const rows = sortRows(parseVersionRows(snapshot.ledger));
  const baseline = sortRows(rows.filter((row) => baselineVersions.includes(row.version)));
  assert.equal(baseline.length, baselineVersions.length, 'BASELINE_LEDGER_VERSION_COUNT_MISMATCH');
  compareRows(baseline.map((row) => row.version), [...baselineVersions].sort(), 'BASELINE_LEDGER_VERSION_SET');
  const nonBaseline = rows.filter((row) => !baselineVersions.includes(row.version));
  assert.ok(nonBaseline.every((row) => migrationByVersion.has(row.version)), 'UNEXPECTED_LEDGER_VERSION');
  assert.equal(nonBaseline.length <= 1, true, 'TOO_MANY_FIN01_MIGRATIONS_PRESENT');
  for (const row of nonBaseline) {
    compareRows(row, expectedVersionRow(migrationByVersion.get(row.version)), `MIGRATION_LEDGER_ROW_${row.version}`);
  }
  const hasPay = rows.some((row) => row.version === expectedFiles[1].version);
  assert.equal(hasPay, false, 'PAY_N01_ALREADY_PRESENT_OR_INCOMPATIBLE_SECOND_ATTEMPT');
  assert.ok(nonBaseline.length === 0 || nonBaseline[0].version === expectedFiles[0].version, 'PAY_N01_WITHOUT_F_REJECTED');
  return { rows, baseline, nonBaseline };
}

function expectedContractSql(contract, stage) {
  const profiles = Object.entries(contract.stages[stage]).map(([signature, profile]) => ({
    signature,
    md5_cr_removed: profile.md5_cr_removed,
    owner: profile.owner,
    acl: profile.acl,
    security_definer: profile.security_definer,
    config: profile.config
  }));
  const records = jsonLit(profiles);
  return `
    do $fin01_contract$
    declare e record; p pg_proc%rowtype; oid_value oid;
    begin
      for e in select * from jsonb_to_recordset(${records}) as x(
        signature text, md5_cr_removed text, owner text, acl text,
        security_definer boolean, config jsonb
      ) loop
        oid_value := to_regprocedure(e.signature);
        if oid_value is null then raise exception 'FIN01_FUNCTION_MISSING:%', e.signature using errcode='P0001'; end if;
        select * into p from pg_proc where oid=oid_value;
        if md5(replace(pg_get_functiondef(p.oid), chr(13), '')) is distinct from e.md5_cr_removed
          or pg_get_userbyid(p.proowner) is distinct from e.owner
          or coalesce(p.proacl::text, '') is distinct from e.acl
          or p.prosecdef is distinct from e.security_definer
          or coalesce(to_jsonb(p.proconfig), '[]'::jsonb) is distinct from e.config
        then raise exception 'FIN01_FUNCTION_PROFILE_DRIFT:%', e.signature using errcode='P0001'; end if;
      end loop;
    end $fin01_contract$;
  `;
}

function expectedVersionSql(versions) {
  return sqlArray(versions);
}

function ledgerSchemaPreflightSql() {
  return `
    do $fin01_ledger_preflight$
    declare actual_columns text[][]; ledger_oid oid;
    begin
      ledger_oid := to_regclass('supabase_migrations.schema_migrations');
      if ledger_oid is null then raise exception 'FIN01_LEDGER_TABLE_MISSING' using errcode='P0001'; end if;
      select coalesce(array_agg(array[column_name,data_type,is_nullable] order by ordinal_position),array[]::text[][])
        into actual_columns
        from information_schema.columns
        where table_schema='supabase_migrations' and table_name='schema_migrations';
      if actual_columns is distinct from array[
        array['version','text','NO'],
        array['statements','ARRAY','YES'],
        array['name','text','YES'],
        array['created_by','text','YES'],
        array['idempotency_key','text','YES'],
        array['rollback','ARRAY','YES']
      ]::text[][] then raise exception 'FIN01_LEDGER_COLUMN_SHAPE_MISMATCH' using errcode='P0001'; end if;
      if (select pg_get_userbyid(relowner) from pg_class where oid=ledger_oid) is distinct from 'postgres'
        or (select relrowsecurity from pg_class where oid=ledger_oid) is distinct from false
        or not exists(select 1 from pg_constraint where conrelid=ledger_oid and contype='p' and pg_get_constraintdef(oid)='PRIMARY KEY (version)')
        or not exists(select 1 from pg_constraint where conrelid=ledger_oid and contype='u' and pg_get_constraintdef(oid)='UNIQUE (idempotency_key)')
      then raise exception 'FIN01_LEDGER_CONSTRAINT_OR_OWNER_MISMATCH' using errcode='P0001'; end if;
    end $fin01_ledger_preflight$;
  `;
}

function preflightSql(database, projectId, baselineVersions, mode, contract) {
  const allowedVersions = [...baselineVersions];
  if (mode === 'resume') allowedVersions.push(expectedFiles[0].version);
  const ids = expectedVersionSql(allowedVersions);
  return `
    do $fin01_preflight$
    declare actual text[]; pgver integer; project text; recorded_base text;
    begin
      if current_database() is distinct from ${lit(database)} or current_user is distinct from 'postgres' then
        raise exception 'FIN01_LAB_DATABASE_IDENTITY_MISMATCH' using errcode='P0001';
      end if;
      select current_setting('server_version_num')::integer into pgver;
      if pgver not in (170006,170011) then raise exception 'FIN01_LAB_POSTGRES_VERSION_NOT_ALLOWED:%',pgver using errcode='P0001'; end if;
      select project_id into project from fin01_lab.identity where identity_key='project';
      select baseline_sha into recorded_base from fin01_lab.identity where identity_key='base';
      if project is distinct from ${lit(projectId)} or recorded_base is distinct from '1a0d758d09310f2914c475c37d358c4cf885cc01' then
        raise exception 'FIN01_LAB_PROJECT_OR_BASE_IDENTITY_MISMATCH' using errcode='P0001';
      end if;
      select coalesce(array_agg(version order by version),array[]::text[]) into actual from supabase_migrations.schema_migrations;
      if actual is distinct from ${ids} then raise exception 'FIN01_LEDGER_VERSION_SET_CHANGED_DURING_PREFLIGHT' using errcode='P0001'; end if;
    end $fin01_preflight$;
    ${ledgerSchemaPreflightSql()}
    ${expectedContractSql(contract, mode === 'fresh' ? 'post_3d14' : 'post_f')}
    ${mode === 'fresh' ? `
      do $fin01_f_preconditions$
      declare e record; actual text;
      begin
        for e in select * from (values
          ('public.pos_create_cloud_sale_credit_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)','e8f0fa18758e867c1b32b8076abae463'),
          ('public.pos_upsert_customer_unlimited(text,text,text,text,jsonb,integer,text)','c7e33d0905c0188cfea21ecc7dbcbb39'),
          ('public.pos_migrate_local_customer_credit_unlimited(text,text,text,text,jsonb,jsonb,text)','16a2e7539918f7048247eae6e26bfc86'),
          ('private.require_active_admin_session(text,text,text,text)','99a8293898a6200351a5d97027fc5c50'),
          ('private.validate_pos_sync_context(text,text,text,text)','8f23a11866c54497f0a8e0f463152f4a')
        ) as x(signature,fingerprint) loop
          if to_regprocedure(e.signature) is null then raise exception 'FIN01_F_PRECONDITION_FUNCTION_MISSING:%',e.signature using errcode='P0001'; end if;
          select md5(pg_get_functiondef(to_regprocedure(e.signature))) into actual;
          if actual is distinct from e.fingerprint then raise exception 'FIN01_F_PRECONDITION_HASH_DRIFT:%',e.signature using errcode='P0001'; end if;
        end loop;
      end $fin01_f_preconditions$;
    ` : ''}
  `;
}

function migrationExecution(migration, fault) {
  const statements = migration.bodyStatements.map((statement) => `${statement};`).join('\n');
  const injected = fault === migration.version ? "\nDO $fin01_failure$ BEGIN RAISE EXCEPTION 'FIN01_LAB_INJECTED_TRANSACTION_FAILURE'; END $fin01_failure$;\n" : '';
  return `
    begin;
    ${statements}
    ${injected}
    insert into supabase_migrations.schema_migrations(version,name,statements)
    values (${lit(migration.version)},${lit(migration.name)},${sqlArray(migration.statements)});
    ${expectedContractSqlPlaceholder(migration.version)}
    commit;
  `;
}

// The caller substitutes a profile assertion for the affected state so that
// both catalog guards and the migration ledger are inside the same transaction.
function expectedContractSqlPlaceholder(version) {
  const stage = version === expectedFiles[0].version ? 'post_f' : 'post_pay';
  const profiles = contractGlobal.stages[stage];
  return expectedContractSql(contractGlobal, stage) + `
    do $fin01_ledger_postflight$
    declare row_count integer;
    begin
      select count(*) into row_count from supabase_migrations.schema_migrations where version=${lit(version)};
      if row_count <> 1 then
        raise exception 'FIN01_LEDGER_POSTFLIGHT_ROW_MISSING:%',${lit(version)} using errcode='P0001';
      end if;
    end $fin01_ledger_postflight$;
  `;
}

let contractGlobal;

function verifyStatementsAndBuild(migration, source, isPay) {
  const statements = splitAndTrim(source);
  assert.ok(statements.length > 1, `MIGRATION_STATEMENT_LIST_EMPTY:${migration.path}`);
  const parsed = transactionBody(statements, migration.path);
  if (isPay) assert.equal(parsed.strippedOuterTransaction, false, 'PAY_MUST_NOT_HAVE_OUTER_TRANSACTION_WRAPPER');
  else assert.equal(parsed.strippedOuterTransaction, true, 'F_EXPECTED_VERIFIED_OUTER_TRANSACTION_WRAPPER');
  return { ...migration, statements, bodyStatements: parsed.statements, strippedOuterTransaction: parsed.strippedOuterTransaction };
}

async function readMigrationFiles(fault) {
  const migrations = [];
  for (const definition of expectedFiles) {
    const filePath = path.join(root, definition.path);
    const source = await fs.readFile(filePath, 'utf8');
    const sha256 = createHash('sha256').update(source, 'utf8').digest('hex');
    const expectedHash = fault === 'HASH' && definition.version === expectedFiles[0].version ? '0'.repeat(64) : definition.sha256;
    assert.equal(sha256, expectedHash, `MIGRATION_SHA256_MISMATCH:${definition.path}`);
    const parsed = verifyStatementsAndBuild(definition, source, definition.version === expectedFiles[1].version);
    migrations.push(parsed);
  }
  return migrations;
}

async function validateIdentityAndSchema(database, projectId, baseline, snapshot) {
  assert.equal(snapshot.database, database, 'SYNTHETIC_DATABASE_IDENTITY_MISMATCH');
  assert.equal(snapshot.current_user, 'postgres', 'SYNTHETIC_DATABASE_ROLE_REQUIRED');
  assert.equal(snapshot.project_id, projectId, 'SYNTHETIC_PROJECT_ID_MISMATCH');
  assert.equal(snapshot.baseline_sha, '1a0d758d09310f2914c475c37d358c4cf885cc01', 'SYNTHETIC_BASE_SHA_MISMATCH');
  assert.ok(['170006', '170011'].includes(snapshot.server_version_num), 'POSTGRES_17_6_OR_17_11_REQUIRED');
  assert.ok(snapshot.client_addr, 'SYNTHETIC_CLIENT_ADDRESS_EVIDENCE_REQUIRED');
  const ids = snapshot.ledger.map((row) => row.version).sort();
  compareRows(ids, [...baseline].sort(), 'BASELINE_VERSION_SET');
  await getLedgerSchema(database).then(assertLedgerSchema);
}

async function run(args) {
  report.database = args['--database'];
  report.project_id = args['--project-id'];
  const currentSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(currentSha, args['--expected-sha'], 'RELEASE_GIT_SHA_MISMATCH');
  if (process.env.GITHUB_SHA) assert.equal(currentSha, process.env.GITHUB_SHA, 'ACTIONS_SHA_MISMATCH');
  report.code_sha = currentSha;
  const migrations = await readMigrationFiles(args['--fault']);
  report.migrations = migrations.map((migration) => ({
    version: migration.version,
    name: migration.name,
    path: migration.path,
    sha256: migration.sha256,
    cli_statement_count: migration.statements.length,
    stripped_outer_transaction_for_execution: migration.strippedOuterTransaction
  }));
  const migrationByVersion = new Map(migrations.map((migration) => [migration.version, migration]));
  const contract = JSON.parse(await fs.readFile(path.join(root, 'docs/reports/fin01-r22/release-review/fixtures/post-3d14-contract.json'), 'utf8'));
  contractGlobal = contract;
  const baselineRecord = JSON.parse(await fs.readFile(path.join(root, 'docs/reports/fin01-r22/release-review/fixtures/production-ledger-versions.json'), 'utf8'));
  const baselineVersions = baselineRecord.versions;
  assert.equal(baselineVersions.length, 333, 'VERIFIED_BASELINE_LEDGER_COUNT_REQUIRED');
  assert.equal(Math.max(...baselineVersions.map(Number)).toString(), '20261026214837', 'VERIFIED_BASELINE_LEDGER_MAX_REQUIRED');
  assert.ok(baselineVersions.includes('20261006224032'), 'VERIFIED_3D1_HISTORICAL_ALIAS_REQUIRED');
  assert.ok(baselineVersions.includes('20261008030859'), 'VERIFIED_3D13_HISTORICAL_ALIAS_REQUIRED');
  assert.ok(!baselineVersions.includes(expectedFiles[0].version) && !baselineVersions.includes(expectedFiles[1].version), 'FIN01_TARGETS_MUST_BE_ABSENT');
  assert.ok(!baselineVersions.includes('20261008180000'), 'LEGAL_PREVIEW_MUST_NOT_BE_IN_BASELINE');

  const initial = await getSnapshot(args['--database']);
  report.postgres_version_num = initial.server_version_num;
  report.before = {
    project_id: initial.project_id,
    database: initial.database,
    current_user: initial.current_user,
    server_version_num: initial.server_version_num,
    client_addr: initial.client_addr,
    count: initial.ledger.length,
    max: initial.ledger.reduce((max, row) => row.version > max ? row.version : max, ''),
    version_sha256: createHash('sha256').update(initial.ledger.map((row) => row.version).sort().join('\n')).digest('hex')
  };
  report.baseline_ledger_count = baselineVersions.length;
  await validateIdentityAndSchema(args['--database'], args['--project-id'], baselineVersions, initial);
  const state = assertKnownLedger(initial, baselineVersions, migrationByVersion);
  const mode = state.nonBaseline.length === 0 ? 'fresh' : 'resume';
  report.mode = mode;
  await assertFunctionProfile(args['--database'], contract, mode === 'fresh' ? 'post_3d14' : 'post_f');
  if (mode === 'fresh') await assertFPreconditions(args['--database']);

  const expectedBeforeF = mode === 'fresh' ? baselineVersions : [...baselineVersions, expectedFiles[0].version];
  const expectedBeforePay = [...baselineVersions, expectedFiles[0].version];
  const preflight = preflightSql(args['--database'], args['--project-id'], expectedBeforeF, mode, contract);
  const chunks = [
    `do $fin01_lock$ begin if not pg_try_advisory_lock(${lockKeys[0]},${lockKeys[1]}) then raise exception 'FIN01_LAB_CONCURRENT_APPLY_REJECTED' using errcode='P0001'; end if; end $fin01_lock$;`,
    'begin read only;',
    preflight,
    'commit;'
  ];
  if (mode === 'fresh') chunks.push(migrationExecution(migrations[0], args['--fault'] === 'F' ? expectedFiles[0].version : null));
  chunks.push(`
    do $fin01_f_before_pay$
    declare actual text[];
    begin
      select coalesce(array_agg(version order by version),array[]::text[]) into actual from supabase_migrations.schema_migrations;
      if actual is distinct from ${expectedVersionSql(expectedBeforePay)} then raise exception 'FIN01_ONLY_F_MAY_PRECEDE_PAY_N01' using errcode='P0001'; end if;
    end $fin01_f_before_pay$;
    ${expectedContractSql(contract, 'post_f')}
  `);
  chunks.push(migrationExecution(migrations[1], args['--fault'] === 'PAY' ? expectedFiles[1].version : null));
  chunks.push(`select pg_advisory_unlock(${lockKeys[0]},${lockKeys[1]});`);

  await q(args['--database'], chunks.join('\n'));

  const after = await getSnapshot(args['--database']);
  const afterLedgerSchema = await getLedgerSchema(args['--database']);
  const rows = sortRows(parseVersionRows(after.ledger));
  const baselineAfter = rows.filter((row) => baselineVersions.includes(row.version));
  compareRows(baselineAfter, state.baseline, 'HISTORICAL_LEDGER_ROWS_CHANGED');
  const f = migrationByVersion.get(expectedFiles[0].version);
  const pay = migrationByVersion.get(expectedFiles[1].version);
  compareRows(rows.filter((row) => row.version === f.version), [expectedVersionRow(f)], 'F_LEDGER_ROW_POSTFLIGHT');
  compareRows(rows.filter((row) => row.version === pay.version), [expectedVersionRow(pay)], 'PAY_N01_LEDGER_ROW_POSTFLIGHT');
  assert.equal(rows.length, 335, 'FINAL_LEDGER_COUNT_MUST_BE_335');
  const functionProfiles = await assertFunctionProfile(args['--database'], contract, 'post_pay');
  report.after = {
    project_id: after.project_id,
    database: after.database,
    current_user: after.current_user,
    server_version_num: after.server_version_num,
    client_addr: after.client_addr,
    count: rows.length,
    max: rows.reduce((max, row) => row.version > max ? row.version : max, ''),
    target_versions: rows.filter((row) => [f.version, pay.version].includes(row.version)).map((row) => row.version),
    historical_rows_unchanged: true,
    ledger_schema: afterLedgerSchema,
    function_profiles: functionProfiles
  };
  report.transactions.push({
    migration: expectedFiles[0].version,
    atomic_unit: 'migration SQL + postflight + compatible ledger row',
    transaction_end: mode === 'fresh' ? 'COMMIT' : 'PREEXISTING_COMMIT',
    commit_evidence: mode === 'fresh' ? 'post-commit catalog and exact ledger snapshot' : 'preflight catalog and ledger snapshot verified before resume',
    recoverable_state_after_commit: 'exactly 333 baseline rows plus F'
  });
  report.transactions.push({ migration: expectedFiles[1].version, atomic_unit: 'migration SQL + postflight + compatible ledger row', transaction_end: 'COMMIT', commit_evidence: 'post-commit catalog and exact ledger snapshot', recoverable_state_after_commit: 'exactly 333 baseline rows plus F and PAY-N01' });
  report.preflight = {
    transaction: 'READ ONLY / COMMIT',
    exact_baseline_version_set: true,
    ledger_schema_owner_constraints_and_columns: 'verified',
    post_3d14_or_post_f_function_profile: 'verified',
    f_preconditions: mode === 'fresh' ? 'verified' : 'exact F resume state verified'
  };
  report.result = 'PASS';
  return args;
}

let args;
try {
  args = parseArgs(process.argv.slice(2));
  await run(args);
} catch (error) {
  report.result = 'FAIL';
  report.failure = { message: error.message, sqlstate: error.code ?? null };
  if (report.database && /^fin01_cert_[a-z0-9_]+$/u.test(report.database)) {
    try {
      const current = await getSnapshot(report.database);
      report.after = {
        project_id: current.project_id,
        database: current.database,
        server_version_num: current.server_version_num,
        count: current.ledger.length,
        target_versions: current.ledger.filter((row) => expectedFiles.some((item) => item.version === row.version)).map((row) => row.version),
        ledger_rows: current.ledger
      };
    } catch (snapshotError) {
      report.after = { snapshot_error: snapshotError.message };
    }
  }
}

const reportPath = args?.['--report'] ?? 'artifacts/fin01/selective-apply-report.json';
await fs.mkdir(path.dirname(path.join(root, reportPath)), { recursive: true });
await fs.writeFile(path.join(root, reportPath), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${report.result}${report.failure ? ` ${report.failure.message}` : ''}\n`);
if (report.result !== 'PASS') process.exitCode = 1;
