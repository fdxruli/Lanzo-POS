import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';

// The runner accepts only a loopback PostgreSQL service. It reuses the existing
// Admin-support fixture and loads the latest canonical auth helpers from Git.
const psql = process.env.RECOVERY_TEST_PSQL || 'psql';
const base = new URL(process.env.RECOVERY_TEST_PGURL || 'postgresql://postgres@127.0.0.1:55432/postgres');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'LOCAL PostgreSQL required');
const database = `lanzo_staff_recovery_test_${process.pid}`;
const connection = new URL(base);
connection.pathname = `/${database}`;
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const directory = new URL('../../supabase/migrations/', import.meta.url);
const sources = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }));

function sql(statement, url = connection.href) {
  try {
    return execFileSync(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', url], {
      input: statement,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    throw new Error('PostgreSQL fixture or assertion failed; raw database output is suppressed.');
  }
}

function sqlAsync(statement) {
  return new Promise((resolve, reject) => {
    const child = spawn(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', connection.href], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    let stdout = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
    child.on('error', () => reject(new Error('Could not start local PostgreSQL client.')));
    child.on('close', (code) => code === 0
      ? resolve(stdout.trim())
      : reject(new Error('Concurrent PostgreSQL operation failed; raw database output is suppressed.')));
    child.stdin.end(statement);
  });
}

function latestFunction(name) {
  const escaped = name.replaceAll('.', '\\.');
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)[\\s\\S]*?\\1\\s*;`, 'gi');
  const definitions = sources.flatMap(({ sql: source }) => [...source.matchAll(pattern)].map((match) => match[0]));
  assert.ok(definitions.length, `Missing current canonical dependency ${name}`);
  return definitions.at(-1);
}

let databaseCreated = false;
before(() => {
  if (process.env.CI === 'true') {
    sql("alter system set log_statement = 'none';", base.href);
    sql("alter system set log_min_error_statement = 'panic';", base.href);
    assert.equal(sql('select pg_reload_conf();', base.href), 't');
    assert.equal(sql("select current_setting('log_statement') || ':' || current_setting('log_min_error_statement');", base.href), 'none:panic');
  }

  sql(`create database ${database};`, base.href);
  databaseCreated = true;
  sql(readFileSync(new URL('../../supabase/tests/fixtures/admin-support-recovery.sql', import.meta.url), 'utf8'));

  const foundation = sources.find(({ name }) => name === '20260722222305_license_admin_auth_1_foundation.sql').sql;
  sql(foundation.slice(0, foundation.indexOf('create or replace function private.require_active_admin_session')));
  sql('alter table public.license_admin_users add unique(id,license_id);');
  sql(readFileSync(new URL('../../supabase/tests/fixtures/admin-device-staff-only-recovery-r1.sql', import.meta.url), 'utf8'));

  for (const name of [
    'private.generate_license_realtime_topic',
    'private.create_admin_session',
    'private.require_active_admin_session',
    'public.enforce_pos_rpc_rate_limit_v2',
    'public.build_pos_rpc_rate_limited_response',
    'public.admin_login_on_device',
    'public.staff_login_on_device'
  ]) sql(latestFunction(name));

  const migration = readFileSync(new URL('../../supabase/migrations/20261127010000_admin_device_staff_only_recovery_r1.sql', import.meta.url));
  assert.equal(
    createHash('sha256').update(migration).digest('hex'),
    'a553e66bf943e7bd304f0d989cf90d4fb3ab4728a866494a2e0daba4dc39bbdd',
    'The reviewed recovery migration hash changed.'
  );
  sql(migration.toString('utf8'));
});

after(() => {
  if (databaseCreated) sql(`drop database ${database} with (force);`, base.href);
});

test('canonical recovery SQL contract on isolated PostgreSQL', () => {
  sql(readFileSync(new URL('../../supabase/tests/admin_device_staff_only_recovery_r1_test.sql', import.meta.url), 'utf8'));
});

test('concurrent owner recoveries serialize to one mode transition', async () => {
  const f = {
    license: randomUUID(),
    plan: randomUUID(),
    owner: randomUUID(),
    device: randomUUID(),
    staff: randomUUID(),
    key: `STAFF-RECOVERY-${randomUUID()}`,
    password: `ConcurrentOwner-${randomUUID()}9`,
    fingerprint: `staff-recovery-device-${randomUUID()}`,
    deviceToken: `old-device-proof-${randomUUID()}`,
    staffToken: `old-staff-session-${randomUUID()}`
  };

  sql(`insert into public.plans(id,code,name,max_devices,features)
      values (${quote(f.plan)},'pro_monthly','Disposable Pro',1,'{"staff_roles":true}'::jsonb);
    insert into public.licenses(id,license_key,license_type,plan_id,status,expires_at,max_devices,product_name,features)
      values (${quote(f.license)},${quote(f.key)},'pro',${quote(f.plan)},'active',now()+interval '30 days',1,'Disposable business','{"staff_roles":true}'::jsonb);
    insert into public.license_admin_users(id,license_id,username,display_name,password_hash,is_owner,is_active)
      values (${quote(f.owner)},${quote(f.license)},'owner_concurrent','Owner',extensions.crypt(${quote(f.password)},extensions.gen_salt('bf',4)),true,true);
    insert into public.license_staff_users(id,license_id,username,display_name,password_hash,role_name,permissions,is_active)
      values (${quote(f.staff)},${quote(f.license)},'staff_concurrent','Staff',extensions.crypt('staff-password',extensions.gen_salt('bf',4)),'staff','{"pos_access":true}'::jsonb,true);
    insert into public.license_devices(id,license_id,device_fingerprint,device_name,device_info,security_token,is_active,device_role,device_mode,staff_user_id)
      values (${quote(f.device)},${quote(f.license)},${quote(f.fingerprint)},'Disposable device','{}'::jsonb,${quote(f.deviceToken)},true,'staff','staff_only',${quote(f.staff)});
    insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash,expires_at,metadata)
      values (${quote(f.license)},${quote(f.staff)},${quote(f.device)},extensions.crypt(${quote(f.staffToken)},extensions.gen_salt('bf',4)),now()+interval '12 hours','{}'::jsonb);`);

  const call = `select public.admin_recover_staff_only_device(
    ${quote(f.key)},'owner_concurrent',${quote(f.password)},${quote(f.fingerprint)},${quote(f.deviceToken)});`;
  const results = await Promise.all([sqlAsync(call), sqlAsync(call)]);
  const outcomes = results.map((result) => JSON.parse(result));
  assert.equal(outcomes.filter((result) => result.success === true).length, 1);
  assert.equal(outcomes.filter((result) => result.code === 'DEVICE_MODE_ALREADY_ADMIN_ONLY').length, 1);
  assert.equal(sql(`select device_mode from public.license_devices where id=${quote(f.device)};`), 'admin_only');
  assert.equal(sql(`select count(*) from public.license_staff_sessions where device_id=${quote(f.device)} and revoked_at is not null;`), '1');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where device_id=${quote(f.device)} and revoked_at is null;`), '1');
  assert.equal(sql(`select count(*) from public.license_events where license_key=${quote(f.key)} and event_type='DEVICE_MODE_CHANGED'
    and metadata->>'change_source'='OWNER_DEVICE_RECOVERY';`), '1');
});
