import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';

// The suite creates and drops a disposable database on loopback only. It has no
// production connection path and never prints test codes, passwords or tokens.
const psql = process.env.ONBOARDING_TEST_PSQL || 'psql';
const base = new URL(process.env.ONBOARDING_TEST_PGURL || 'postgresql://postgres@127.0.0.1:55432/postgres');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'LOCAL PostgreSQL REQUIRED');
const database = `lanzo_onboarding_test_${process.pid}`;
const connection = new URL(base); connection.pathname = `/${database}`;
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const json = (statement) => JSON.parse(sql(statement));

function sql(statement, url = connection.href) {
  try {
    return execFileSync(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', url], {
      input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
    }).trim();
  } catch {
    throw new Error('PostgreSQL setup/assertion statement failed. Raw database output is suppressed.');
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
      : reject(new Error('PostgreSQL operation failed; raw database output is suppressed.')));
    child.stdin.end(statement);
  });
}

async function expectSqlFailure(statement) {
  await assert.rejects(sqlAsync(statement), /PostgreSQL operation failed/);
}

const migrationName = '20261107152500_license_admin_initial_owner_onboarding_v1.sql';
const migrationDirectory = new URL('../../supabase/migrations/', import.meta.url);
const sourceFiles = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, migrationDirectory), 'utf8') }));
function latestFunction(name) {
  const escaped = name.replaceAll('.', '\\.');
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)[\\s\\S]*?\\1\\s*;`, 'gi');
  const definitions = sourceFiles.flatMap(({ sql: source }) => [...source.matchAll(pattern)].map((match) => match[0]));
  assert.ok(definitions.length, `Missing current canonical dependency ${name}`);
  return definitions.at(-1);
}

let databaseCreated = false;
before(() => {
  sql(`create database ${database};`, base.href);
  databaseCreated = true;
  sql(readFileSync(new URL('../../supabase/tests/fixtures/license-admin-onboarding.sql', import.meta.url), 'utf8'));
  for (const name of [
    'private.generate_license_realtime_topic',
    'private.create_admin_session',
    'public.build_pos_rpc_rate_limited_response',
    'public.enforce_pos_rpc_rate_limit_v2',
    'public.activate_license_on_device_unlimited',
    'public.admin_login_on_device'
  ]) sql(latestFunction(name));
  sql(readFileSync(new URL(migrationName, migrationDirectory), 'utf8'));
});
after(() => {
  if (databaseCreated) sql(`drop database ${database} with (force);`, base.href);
});

function seedLicense({ plan = 'free_trial', status = 'active', maxDevices = plan === 'free_trial' ? 1 : 3 } = {}) {
  const f = { id: randomUUID(), planId: randomUUID(), key: `TEST-${randomUUID()}`, plan, maxDevices };
  sql(`insert into public.plans(id,code,name,max_devices,features)
    values (${quote(f.planId)},${quote(plan)},'Disposable ${plan}',${maxDevices},'{}'::jsonb);
    insert into public.licenses(id,license_key,plan_id,status,max_devices,product_name)
    values (${quote(f.id)},${quote(f.key)},${quote(f.planId)},${quote(status)},${maxDevices},'Disposable business');
    insert into public.business_profiles(license_id,business_name,business_type)
    values (${quote(f.id)},'Disposable business',array['abarrotes']);`);
  return f;
}

function issue(f) {
  return json(`select private.issue_license_onboarding_invitation(${quote(f.key)});`);
}

function revoke(f) {
  return json(`select private.revoke_license_onboarding_invitation(${quote(f.key)});`);
}

function enrollSql(f, code, { username = 'owner.qa', fingerprint = `device-${randomUUID()}` } = {}) {
  return `select public.admin_enroll_owner_with_invitation(
    ${quote(f.key)}, ${quote(code)}, ${quote(fingerprint)}, 'QA Android', '{}'::jsonb,
    ${quote(username)}, 'OwnerPass123', 'Owner QA'
  );`;
}

function enroll(f, code, options) { return json(enrollSql(f, code, options)); }
function assertFailure(result, code) {
  assert.equal(result.success, false);
  assert.equal(result.code, code);
}

test('private issuance/revocation is privileged, invitation storage is hash-only, and activation hides invitation existence', () => {
  const f = seedLicense();
  const before = json(`select public.activate_license_on_device(${quote(f.key)},'activation-device','QA','{}'::jsonb);`);
  assert.equal(before.code, 'ADMIN_INITIAL_SETUP_REQUIRED');
  const issued = issue(f);
  assert.equal(issued.success, true);
  assert.match(issued.invitation_code, /^[0-9a-f]{64}$/);
  const after = json(`select public.activate_license_on_device(${quote(f.key)},'activation-device','QA','{}'::jsonb);`);
  assert.equal(after.code, before.code);
  assert.equal(after.message, before.message);
  assert.ok(Date.parse(issued.expires_at) - Date.now() <= 24 * 60 * 60 * 1000 + 5000);
  assert.ok(Date.parse(issued.expires_at) - Date.now() >= 23 * 60 * 60 * 1000);
  assert.equal(sql(`select encode(token_hash,'hex') = encode(extensions.digest(${quote(issued.invitation_code)},'sha256'),'hex')
    from private.license_onboarding_invitations where license_id=${quote(f.id)};`), 't');
  assert.equal(sql(`select count(*) from information_schema.columns
    where table_schema='private' and table_name='license_onboarding_invitations'
      and column_name in ('token','invitation_code','secret');`), '0');
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(sql(`select has_table_privilege('${role}','private.license_onboarding_invitations','select')
      or has_function_privilege('${role}','private.issue_license_onboarding_invitation(text)','execute')
      or has_function_privilege('${role}','private.revoke_license_onboarding_invitation(text)','execute');`), 'f');
  }
  assert.equal(sql(`select has_function_privilege('postgres','private.issue_license_onboarding_invitation(text)','execute')
    and has_function_privilege('postgres','private.revoke_license_onboarding_invitation(text)','execute');`), 't');
  assert.equal(sql("select has_function_privilege('anon','public.admin_enroll_owner_with_invitation(text,text,text,text,jsonb,text,text,text)','execute');"), 't');
  assert.equal(sql("select relrowsecurity from pg_class where oid='private.license_onboarding_invitations'::regclass;"), 't');
  const publicFailure = json(`set role anon;
    select public.admin_enroll_owner_with_invitation('UNKNOWN',${quote('0'.repeat(64))},'unknown-device','QA','{}'::jsonb,'owner.qa','OwnerPass123','Owner QA');
    reset role;`);
  assertFailure(publicFailure, 'ADMIN_ONBOARDING_INVALID');
  assert.equal(sql(`select count(*) from private.license_onboarding_invitations where license_id=${quote(f.id)}
    and revoked_at is null and consumed_at is null;`), '1');
});

test('reissuing serializes and invalidates the previous code; revocation prevents consumption', async () => {
  const f = seedLicense();
  const [firstText, secondText] = await Promise.all([
    sqlAsync(`select private.issue_license_onboarding_invitation(${quote(f.key)});`),
    sqlAsync(`select private.issue_license_onboarding_invitation(${quote(f.key)});`)
  ]);
  const first = JSON.parse(firstText); const second = JSON.parse(secondText);
  assert.equal(first.success, true); assert.equal(second.success, true);
  assert.equal(sql(`select count(*) from private.license_onboarding_invitations where license_id=${quote(f.id)}
    and consumed_at is null and revoked_at is null;`), '1');
  const winning = sql(`select encode(token_hash,'hex') from private.license_onboarding_invitations
    where license_id=${quote(f.id)} and revoked_at is null and consumed_at is null;`);
  const matchingCode = [first.invitation_code, second.invitation_code]
    .find((code) => sql(`select encode(extensions.digest(${quote(code)},'sha256'),'hex');`) === winning);
  const replacedCode = [first.invitation_code, second.invitation_code].find((code) => code !== matchingCode);
  assert.ok(matchingCode); assert.ok(replacedCode);
  assertFailure(enroll(f, replacedCode), 'ADMIN_ONBOARDING_INVALID');
  assert.equal(revoke(f).revoked, true);
  assertFailure(enroll(f, matchingCode), 'ADMIN_ONBOARDING_INVALID');
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)};`), '0');
});

test('valid invitation creates exactly one owner, admin-only device and verified-session material, then cannot be reused', () => {
  const f = seedLicense(); const issued = issue(f); const fingerprint = `device-${randomUUID()}`;
  const result = enroll(f, issued.invitation_code, { fingerprint });
  assert.equal(result.success, true);
  assert.equal(result.code, 'ADMIN_OWNER_ENROLLED');
  assert.equal(result.admin_user.is_owner, true);
  assert.equal(result.details.plan_code, 'free_trial');
  assert.equal(result.details.max_devices, 1);
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)} and is_owner;`), '1');
  assert.equal(sql(`select count(*) from public.license_devices where license_id=${quote(f.id)} and is_active;`), '1');
  assert.equal(sql(`select device_mode || ':' || device_role from public.license_devices where license_id=${quote(f.id)};`), 'admin_only:admin');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.id)} and revoked_at is null;`), '1');
  assert.equal(json(`select public.activate_license_on_device(${quote(f.key)},${quote(fingerprint)},'QA Android','{}'::jsonb);`).code,
    'ADMIN_OR_STAFF_LOGIN_REQUIRED');
  assert.equal(sql(`select extensions.crypt(${quote(result.admin_session_token)},session_token_hash)=session_token_hash
    from public.license_admin_sessions where id=${quote(result.admin_session_id)};`), 't');
  assert.equal(sql(`select extensions.crypt('OwnerPass123',password_hash)=password_hash
    from public.license_admin_users where license_id=${quote(f.id)};`), 't');
  assert.equal(sql(`select consumed_at is not null and consumed_device_id is not null
    from private.license_onboarding_invitations where license_id=${quote(f.id)};`), 't');
  assert.equal(sql(`select count(*) from public.license_events where license_key=${quote(f.key)}
    and event_type='ADMIN_OWNER_ENROLLED' and metadata::text not like '%'||${quote(issued.invitation_code)}||'%'
    and metadata::text not like '%OwnerPass123%' and metadata::text not like '%'||${quote(result.admin_session_token)}||'%'
    and metadata::text not like '%'||${quote(result.device_security_token)}||'%';`), '1');
  assertFailure(enroll(f, issued.invitation_code, { fingerprint: `other-${randomUUID()}`, username: 'owner.two' }), 'ADMIN_OWNER_ALREADY_ENROLLED');
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)} and is_owner;`), '1');
  assert.equal(sql(`select count(*) from public.license_devices where license_id=${quote(f.id)} and is_active;`), '1');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.id)} and revoked_at is null;`), '1');
  // Simulate an installation that discards its successful RPC response, then
  // prove the consumed invitation cannot create another identity or session.
  sql(`delete from public.license_devices where license_id=${quote(f.id)};
    delete from public.license_admin_users where license_id=${quote(f.id)};`);
  assertFailure(enroll(f, issued.invitation_code, { fingerprint: `reuse-${randomUUID()}`, username: 'owner.reuse' }), 'ADMIN_ONBOARDING_INVALID');
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)};`), '0');
  assert.equal(sql(`select count(*) from public.license_devices where license_id=${quote(f.id)};`), '0');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.id)} and revoked_at is null;`), '0');
});

test('an inactive owner, expired/revoked code, suspended license and cross-license code all fail closed', () => {
  const activeOwner = seedLicense();
  sql(`insert into public.license_admin_users(license_id,username,display_name,password_hash,is_owner,is_active)
    values (${quote(activeOwner.id)},'current-owner','Current owner',extensions.crypt('CurrentPass123',extensions.gen_salt('bf',4)),true,true);`);
  assertFailure(issue(activeOwner), 'ADMIN_OWNER_ALREADY_ENROLLED');

  const inactiveOwner = seedLicense();
  sql(`insert into public.license_admin_users(license_id,username,display_name,password_hash,is_owner,is_active)
    values (${quote(inactiveOwner.id)},'old-owner','Old owner',extensions.crypt('OldPass123',extensions.gen_salt('bf',4)),true,false);`);
  assertFailure(issue(inactiveOwner), 'ADMIN_OWNER_ALREADY_ENROLLED');

  const ownerAddedAfterIssue = seedLicense(); const preexistingInvite = issue(ownerAddedAfterIssue);
  sql(`insert into public.license_admin_users(license_id,username,display_name,password_hash,is_owner,is_active)
    values (${quote(ownerAddedAfterIssue.id)},'old-owner','Old owner',extensions.crypt('OldPass123',extensions.gen_salt('bf',4)),true,false);`);
  assertFailure(enroll(ownerAddedAfterIssue, preexistingInvite.invitation_code), 'ADMIN_ONBOARDING_INVALID');
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(ownerAddedAfterIssue.id)} and is_owner;`), '1');

  const expired = seedLicense(); const expiredInvite = issue(expired);
  sql(`update private.license_onboarding_invitations
    set issued_at=now()-interval '2 seconds', expires_at=now()-interval '1 second'
    where license_id=${quote(expired.id)};`);
  assertFailure(enroll(expired, expiredInvite.invitation_code), 'ADMIN_ONBOARDING_INVALID');

  const revoked = seedLicense(); const revokedInvite = issue(revoked); revoke(revoked);
  assertFailure(enroll(revoked, revokedInvite.invitation_code), 'ADMIN_ONBOARDING_INVALID');

  const suspended = seedLicense(); const suspendedInvite = issue(suspended);
  sql(`update public.licenses set status='suspended' where id=${quote(suspended.id)};`);
  assertFailure(enroll(suspended, suspendedInvite.invitation_code), 'LICENSE_NOT_ACTIVE');

  const first = seedLicense(); const firstInvite = issue(first); const other = seedLicense();
  assertFailure(enroll(other, firstInvite.invitation_code), 'ADMIN_ONBOARDING_INVALID');
  assertFailure(enroll(seedLicense(), firstInvite.invitation_code), 'ADMIN_ONBOARDING_INVALID');
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id in (${quote(other.id)});`), '0');
});

test('missing license, invalid code and attempt limits produce bounded failures without creating identities', () => {
  const f = seedLicense(); const fingerprint = `attempt-${randomUUID()}`;
  const invalid = `select public.admin_enroll_owner_with_invitation(${quote(f.key)},${quote('f'.repeat(64))},
    ${quote(fingerprint)},'QA','{}'::jsonb,'owner.qa','OwnerPass123','Owner QA');`;
  for (let i = 0; i < 5; i += 1) assertFailure(json(invalid), 'ADMIN_ONBOARDING_INVALID');
  assertFailure(json(invalid), 'ADMIN_ONBOARDING_RATE_LIMITED');
  assertFailure(json(`select public.admin_enroll_owner_with_invitation('MISSING-KEY',${quote('0'.repeat(64))},
    ${quote(`missing-${randomUUID()}`)},'QA','{}'::jsonb,'owner.qa','OwnerPass123','Owner QA');`), 'ADMIN_ONBOARDING_INVALID');
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)};`), '0');
  assert.equal(sql(`select count(*) from public.license_devices where license_id=${quote(f.id)};`), '0');
});

test('transaction rollback leaves invitation reusable when an intermediate audit write fails', async () => {
  const f = seedLicense(); const issued = issue(f);
  sql(`create function private.fail_onboarding_audit() returns trigger language plpgsql as $$
    begin if new.event_type='ADMIN_OWNER_ENROLLED' then raise exception 'injected rollback test'; end if; return new; end $$;
    create trigger fail_onboarding_audit before insert on public.license_events
      for each row execute function private.fail_onboarding_audit();`);
  await assert.rejects(sqlAsync(enrollSql(f, issued.invitation_code)));
  assert.equal(sql(`select (select count(*) from public.license_admin_users where license_id=${quote(f.id)})||':'||
    (select count(*) from public.license_devices where license_id=${quote(f.id)})||':'||
    (select count(*) from public.license_admin_sessions where license_id=${quote(f.id)})||':'||
    (select count(*) from private.license_onboarding_invitations where license_id=${quote(f.id)} and consumed_at is null);`), '0:0:0:1');
  sql('drop trigger fail_onboarding_audit on public.license_events; drop function private.fail_onboarding_audit();');
  assert.equal(enroll(f, issued.invitation_code).success, true);
});

test('concurrent claims of one invitation commit one owner, device and active session', async () => {
  const f = seedLicense(); const issued = issue(f);
  sql(`create function private.slow_owner_insert() returns trigger language plpgsql as $$
    begin perform pg_sleep(0.8); return new; end $$;
    create trigger slow_owner_insert before insert on public.license_admin_users
      for each row execute function private.slow_owner_insert();`);
  const one = sqlAsync(enrollSql(f, issued.invitation_code, { username: 'owner.one', fingerprint: `one-${randomUUID()}` }));
  await new Promise((resolve) => setTimeout(resolve, 120));
  const two = sqlAsync(enrollSql(f, issued.invitation_code, { username: 'owner.two', fingerprint: `two-${randomUUID()}` }));
  const results = await Promise.all([one, two]).then((raw) => raw.map(JSON.parse));
  sql('drop trigger slow_owner_insert on public.license_admin_users; drop function private.slow_owner_insert();');
  assert.equal(results.filter((result) => result.success).length, 1);
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)} and is_owner;`), '1');
  assert.equal(sql(`select count(*) from public.license_devices where license_id=${quote(f.id)} and is_active;`), '1');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.id)} and revoked_at is null;`), '1');
  assert.equal(sql(`select count(*) from private.license_onboarding_invitations where license_id=${quote(f.id)} and consumed_at is not null;`), '1');
});

test('a committed enrollment whose response is lost is recovered by the current password login contract', () => {
  const f = seedLicense(); const issued = issue(f); const fingerprint = `lost-response-${randomUUID()}`;
  // Discard the successful RPC response to simulate a broken client connection.
  sql(enrollSql(f, issued.invitation_code, { fingerprint }));
  const firstOwnerId = sql(`select id from public.license_admin_users where license_id=${quote(f.id)} and is_owner;`);
  const login = json(`select public.admin_login_on_device(${quote(f.key)},'owner.qa','OwnerPass123',${quote(fingerprint)},
    'QA Android','{}'::jsonb);`);
  assert.equal(login.success, true);
  assert.equal(sql(`select id from public.license_admin_users where license_id=${quote(f.id)} and is_owner;`), firstOwnerId);
  assert.equal(sql(`select count(*) from public.license_admin_users where license_id=${quote(f.id)} and is_owner;`), '1');
  assert.equal(sql(`select count(*) from public.license_devices where license_id=${quote(f.id)} and is_active;`), '1');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.id)} and revoked_at is null;`), '1');
  assert.equal(sql(`select count(*) from private.license_onboarding_invitations where license_id=${quote(f.id)} and consumed_at is not null;`), '1');
});

test('PRO onboarding preserves the plan device limit and never promotes a Staff device', () => {
  const f = seedLicense({ plan: 'pro_monthly', maxDevices: 5 }); const issued = issue(f);
  const result = enroll(f, issued.invitation_code);
  assert.equal(result.success, true);
  assert.equal(result.details.max_devices, 5);
  assert.equal(sql(`select device_mode || ':' || device_role from public.license_devices where license_id=${quote(f.id)};`), 'admin_only:admin');

  const withActiveStaff = seedLicense({ plan: 'pro_monthly', maxDevices: 5 });
  sql(`insert into public.license_devices(license_id,device_fingerprint,device_name,is_active,device_role,device_mode,staff_user_id)
    values (${quote(withActiveStaff.id)},'staff-device','Existing Staff',true,'staff','shared',${quote(randomUUID())});`);
  assertFailure(issue(withActiveStaff), 'LICENSE_DEVICE_ALREADY_ACTIVE');
  assert.equal(sql(`select device_mode || ':' || device_role from public.license_devices where license_id=${quote(withActiveStaff.id)};`), 'shared:staff');

  const authorizedAdminDevice = seedLicense();
  sql(`insert into public.license_devices(license_id,device_fingerprint,device_name,is_active,device_role,device_mode)
    values (${quote(authorizedAdminDevice.id)},'preauthorized-admin','Existing Admin',true,'admin','admin_only');`);
  assert.equal(json(`select public.activate_license_on_device(${quote(authorizedAdminDevice.key)},'preauthorized-admin','QA','{}'::jsonb);`).code,
    'ADMIN_ENROLLMENT_REQUIRED');
});
