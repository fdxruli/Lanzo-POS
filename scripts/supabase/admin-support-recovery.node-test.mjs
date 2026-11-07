import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { after, before, test } from 'node:test';

// Real PostgreSQL; intentionally rejects hosted databases. Production verification
// uses the reviewed migration and the owner's manual flow, never this fixture.
const psql = process.env.RECOVERY_TEST_PSQL || 'psql';
const base = new URL(process.env.RECOVERY_TEST_PGURL || 'postgresql://postgres@127.0.0.1:55432/postgres');
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'LOCAL PostgreSQL required');
const database = `lanzo_recovery_test_${process.pid}`;
const connection = new URL(base); connection.pathname = `/${database}`;
const quote = (value) => value === null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
function sql(statement, url = connection.href) {
  return execFileSync(psql, ['-X', '-qAt', '-v', 'ON_ERROR_STOP=1', url], {
    input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe']
  }).trim();
}
const json = (statement) => JSON.parse(sql(statement));
const migrationName = '20261106201326_admin_support_account_recovery_v1.sql';
const directory = new URL('../../supabase/migrations/', import.meta.url);
const sources = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
  .map((name) => ({ name, sql: readFileSync(new URL(name, directory), 'utf8') }));
function latestFunction(name) {
  const escaped = name.replaceAll('.', '\\.');
  const pattern = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+${escaped}\\s*\\([\\s\\S]*?\\bas\\s+(\\$\\w*\\$)[\\s\\S]*?\\1\\s*;`, 'gi');
  const definitions = sources.flatMap((source) => [...source.sql.matchAll(pattern)].map((match) => match[0]));
  assert.ok(definitions.length, `Missing canonical dependency ${name}`);
  return definitions.at(-1);
}

before(() => {
  sql(`create database ${database};`, base.href);
  sql(readFileSync(new URL('../../supabase/tests/fixtures/admin-support-recovery.sql', import.meta.url), 'utf8'));
  const foundation = sources.find(({ name }) => name === '20260722222305_license_admin_auth_1_foundation.sql').sql;
  sql(foundation.slice(0, foundation.indexOf('create or replace function private.require_active_admin_session')));
  sql('alter table public.license_admin_users add unique(id,license_id);');
  for (const name of ['private.generate_license_realtime_topic', 'private.create_admin_session',
    'private.require_active_admin_session', 'public.enforce_pos_rpc_rate_limit_v2',
    'public.build_pos_rpc_rate_limited_response', 'public.admin_login_on_device']) sql(latestFunction(name));
  sql(readFileSync(new URL(migrationName, directory), 'utf8'));
  sql(readFileSync(new URL('20261107004310_account_recovery_support_v2.sql', directory), 'utf8'));
});
after(() => sql(`drop database ${database} with (force);`, base.href));

function fixture(plan = 'free_trial') {
  const f = { license: randomUUID(), owner: randomUUID(), device: randomUUID(), session: randomUUID(), plan: randomUUID() };
  f.key = `TEST-${f.license}`; f.email = `owner-${f.owner}@example.com`;
  sql(`insert into public.plans values (${quote(f.plan)},${quote(plan)},'Test',${plan === 'free_trial' ? 1 : 3},'{}');
    insert into public.licenses(id,license_key,plan_id,max_devices,product_name) values
      (${quote(f.license)},${quote(f.key)},${quote(f.plan)},${plan === 'free_trial' ? 1 : 3},'Fixture');
    insert into public.license_devices(id,license_id,device_fingerprint,device_name,security_token)
      values (${quote(f.device)},${quote(f.license)},'device','Test device','device-token');
    insert into public.license_admin_users(id,license_id,username,display_name,password_hash)
      values (${quote(f.owner)},${quote(f.license)},'original-owner','Owner',extensions.crypt('Original123',extensions.gen_salt('bf',4)));
    insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash)
      values (${quote(f.session)},${quote(f.license)},${quote(f.owner)},${quote(f.device)},extensions.crypt('session-token',extensions.gen_salt('bf',4)));
    insert into public.business_profiles values (${quote(f.license)},'Test business',array['abarrotes']);
    insert into public.license_staff_sessions(device_id) values (${quote(f.device)});`);
  return f;
}
const auth = (f, token = 'session-token') => [f.key, 'device', 'device-token', token].map(quote).join(',');
const request = (f, password = 'Original123') => json(`select public.admin_request_recovery_contact(${auth(f)},${quote(password)},${quote(f.email)});`);
const issue = (f, purpose = 'password', requestId = null) => json(`select private.support_issue_admin_recovery_code(${quote(f.license)},${quote(purpose)},'operator@example.com','Verified backend request/contact',${quote(requestId)});`);
const redeemSql = (f, code, password = 'Recovered123') => `select public.admin_redeem_password_recovery(${quote(f.key)},${quote(code)},${quote(password)});`;
const redeem = (f, code, password) => json(redeemSql(f, code, password));
function verifiedFixture(plan) {
  const f = fixture(plan);
  const r = request(f); assert.equal(r.success, true);
  const c = issue(f, 'contact', r.request_id); assert.equal(c.success, true);
  assert.equal(json(`select public.admin_confirm_recovery_contact(${auth(f)},${quote(c.code)});`).success, true);
  // Advance only fixture audit timestamps to avoid real cooldown waits.
  sql(`update private.admin_recovery_audit set created_at=created_at-interval '61 seconds' where license_id=${quote(f.license)};`);
  return f;
}
const expectCode = (result, code) => { assert.equal(result.success, false); assert.equal(result.code, code); assert.equal(result.username, undefined); };

test('API roles cannot read recovery data, issue codes or invoke private verifier', () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal(sql(`select has_table_privilege('${role}','private.admin_recovery_contacts','select')
      or has_table_privilege('${role}','private.admin_recovery_challenges','select')
      or has_table_privilege('${role}','private.admin_recovery_audit','select')
      or has_function_privilege('${role}','private.support_issue_admin_recovery_code(uuid,text,text,text,uuid)','execute')
      or has_function_privilege('${role}','private.check_admin_recovery_code(text,text,text,uuid)','execute');`), 'f');
  }
  assert.equal(sql("select bool_and(relrowsecurity) from pg_class where oid in ('private.admin_recovery_contacts'::regclass,'private.admin_recovery_challenges'::regclass,'private.admin_recovery_audit'::regclass);"), 't');
});

test('contact enrollment requires a current owner session and fresh password; support checks backend evidence', () => {
  const f = fixture();
  expectCode(json(`select public.admin_request_recovery_contact(${auth(f, 'wrong')},'Original123',${quote(f.email)});`), 'ADMIN_SESSION_INVALID');
  expectCode(request(f, 'wrong'), 'RECOVERY_REAUTH_REQUIRED');
  expectCode(issue(f), 'RECOVERY_VERIFIED_CONTACT_REQUIRED');
  const r = request(f);
  expectCode(issue(f, 'contact', randomUUID()), 'RECOVERY_VERIFIED_REQUEST_REQUIRED');
  sql(`update public.license_admin_sessions set revoked_at=now() where id=${quote(f.session)};`);
  expectCode(issue(f, 'contact', r.request_id), 'RECOVERY_VERIFIED_REQUEST_REQUIRED');
});

test('contact verification is bound to the original session; verified contact cannot be overwritten', () => {
  const f = fixture(); const r = request(f); const c = issue(f, 'contact', r.request_id);
  sql(`insert into public.license_admin_sessions(license_id,admin_user_id,device_id,session_token_hash)
    values (${quote(f.license)},${quote(f.owner)},${quote(f.device)},extensions.crypt('other-session',extensions.gen_salt('bf',4)));`);
  expectCode(json(`select public.admin_confirm_recovery_contact(${auth(f, 'other-session')},${quote(c.code)});`), 'RECOVERY_REQUEST_SESSION_REQUIRED');
  assert.equal(json(`select public.admin_confirm_recovery_contact(${auth(f)},${quote(c.code)});`).success, true);
  expectCode(request(f), 'RECOVERY_CONTACT_ALREADY_VERIFIED');
  const status = json(`select public.admin_recovery_contact_status(${auth(f)});`);
  assert.equal(status.contact.email, f.email); assert.equal(status.pending, null);
});

for (const plan of ['free_trial', 'pro_monthly']) test(`${plan}: reset preserves identity/data and invalidates password and sessions; normal login still works`, () => {
  const f = verifiedFixture(plan); const c = issue(f);
  assert.equal(c.delivery_email, f.email); assert.match(c.code, /^[a-f0-9]{12}-[a-f0-9]{32}$/);
  sql(`insert into public.license_admin_sessions(license_id,admin_user_id,device_id,session_token_hash)
    values (${quote(f.license)},${quote(f.owner)},${quote(f.device)},extensions.crypt('another-session',extensions.gen_salt('bf',4)));`);
  const snapshot = () => sql(`select jsonb_build_object('license',(select to_jsonb(l) from public.licenses l where id=${quote(f.license)}),
    'owner',(select to_jsonb(u)-'password_hash'-'password_changed_at'-'updated_at' from public.license_admin_users u where id=${quote(f.owner)}),
    'devices',(select jsonb_agg(d) from public.license_devices d where license_id=${quote(f.license)}),
    'staff',(select jsonb_agg(s) from public.license_staff_sessions s where device_id=${quote(f.device)}),
    'profile',(select jsonb_agg(p) from public.business_profiles p where license_id=${quote(f.license)}));`);
  const beforeReset = snapshot();
  expectCode(redeem(f,c.code,'Original123'), 'RECOVERY_PASSWORD_UNCHANGED');
  const result = redeem(f,c.code); assert.equal(result.success,true); assert.equal(result.username,'original-owner');
  assert.equal(snapshot(),beforeReset);
  assert.equal(sql(`select count(*) from public.license_admin_sessions where admin_user_id=${quote(f.owner)} and revoked_at is null;`),'0');
  expectCode(redeem(f,c.code), 'RECOVERY_CODE_USED');
  expectCode(json(`select private.require_active_admin_session(${auth(f)});`),'ADMIN_SESSION_INVALID');
  const login = (password) => json(`select public.admin_login_on_device(${quote(f.key)},'original-owner',${quote(password)},'device','Test','{}');`);
  expectCode(login('Original123'),'INVALID_ADMIN_CREDENTIALS');
  const loggedIn = login('Recovered123'); assert.equal(loggedIn.success,true); assert.equal(loggedIn.admin_user.id,f.owner);
  const stored = json(`select jsonb_build_object('hash',encode(code_hash,'hex'),'remaining',extract(epoch from expires_at-issued_at),
    'audit', (select count(*) from private.admin_recovery_audit where challenge_id=c.id)) from private.admin_recovery_challenges c where id=${quote(c.request_id)};`);
  assert.equal(stored.remaining,900); assert.notEqual(stored.hash,c.code.replace('-','')); assert.ok(stored.audit>=2);
});

test('five incorrect attempts exhaust only the matching code; valid code then stays blocked', () => {
  const f=verifiedFixture(); const c=issue(f); const wrong=c.code.slice(0,13)+(c.code[13]==='a'?'b':'a')+c.code.slice(14);
  for(let i=0;i<5;i++) expectCode(redeem(f,wrong),i===4?'RECOVERY_ATTEMPTS_EXHAUSTED':'RECOVERY_CODE_INVALID');
  expectCode(redeem(f,c.code),'RECOVERY_ATTEMPTS_EXHAUSTED');
  assert.equal(sql(`select failed_attempts from private.admin_recovery_challenges where id=${quote(c.request_id)};`),'5');
});

test('expiry, purpose and license isolation do not disclose username or change credentials', () => {
  const f=verifiedFixture(); const other=fixture(); const c=issue(f);
  expectCode(redeem(other,c.code),'RECOVERY_CODE_INVALID');
  expectCode(redeem({key:'unknown'},c.code),'RECOVERY_CODE_INVALID');
  expectCode(json(`select public.admin_confirm_recovery_contact(${auth(other)},${quote(c.code)});`),'RECOVERY_CODE_INVALID');
  sql(`update private.admin_recovery_challenges set expires_at=now()-interval '1 second' where id=${quote(c.request_id)};`);
  expectCode(redeem(f,c.code),'RECOVERY_CODE_EXPIRED');
});

test('new issuance invalidates the previous code and enforces operator evidence and issuance limits', () => {
  const f=verifiedFixture(); const first=issue(f);
  expectCode(issue(f),'RECOVERY_RATE_LIMITED');
  expectCode(json(`select private.support_issue_admin_recovery_code(${quote(f.license)},'password','','');`),'RECOVERY_OPERATOR_EVIDENCE_REQUIRED');
  sql(`update private.admin_recovery_audit set created_at=created_at-interval '61 seconds' where license_id=${quote(f.license)};`);
  const second=issue(f); assert.notEqual(first.code,second.code);
  expectCode(redeem(f,first.code),'RECOVERY_CODE_INVALID');
  sql(`update private.admin_recovery_audit set created_at=created_at-interval '61 seconds' where license_id=${quote(f.license)};`);
  expectCode(issue(f),'RECOVERY_RATE_LIMITED');
});

test('weak/oversize passwords do not consume the code', () => {
  const f=verifiedFixture(); const c=issue(f);
  for(const password of ['short','onlyletters','a1'+'á'.repeat(36)]) expectCode(redeem(f,c.code,password),'RECOVERY_PASSWORD_WEAK');
  assert.equal(redeem(f,c.code).success,true);
});

test('daily emission limit survives hourly-window changes', () => {
  const f=verifiedFixture();
  for(let i=0;i<4;i++) {
    sql(`update private.admin_recovery_audit set created_at=created_at-interval '61 minutes' where license_id=${quote(f.license)};`);
    assert.equal(issue(f).success,true);
  }
  sql(`update private.admin_recovery_audit set created_at=created_at-interval '61 minutes' where license_id=${quote(f.license)};`);
  expectCode(issue(f),'RECOVERY_RATE_LIMITED');
});

test('an audit failure rolls back password, consumption and session revocation atomically', () => {
  const f=verifiedFixture(); const c=issue(f);
  sql(`create function private.recovery_test_fail_audit() returns trigger language plpgsql as $$ begin
    if new.action='password_recovered_sessions_revoked' then raise exception 'fixture failure'; end if;
    return new; end $$;
    create trigger recovery_test_audit_failure before insert on private.admin_recovery_audit
      for each row execute function private.recovery_test_fail_audit();`);
  try { assert.throws(()=>redeem(f,c.code)); }
  finally { sql('drop trigger recovery_test_audit_failure on private.admin_recovery_audit; drop function private.recovery_test_fail_audit();'); }
  assert.equal(sql(`select consumed_at is null from private.admin_recovery_challenges where id=${quote(c.request_id)};`),'t');
  assert.equal(sql(`select revoked_at is null from public.license_admin_sessions where id=${quote(f.session)};`),'t');
  assert.equal(redeem(f,c.code).success,true);
});

function concurrentSql(statement) {
  return new Promise((resolve,reject) => {
    const child=spawn(psql,['-X','-qAt','-v','ON_ERROR_STOP=1',connection.href]); let output=''; let failure='';
    child.stdout.on('data',chunk=>{output+=chunk;}); child.stderr.on('data',chunk=>{failure+=chunk;});
    child.on('error',reject); child.on('close',code=>code===0?resolve(JSON.parse(output.trim())):reject(new Error(failure)));
    child.stdin.end(statement);
  });
}
test('two real connections cannot redeem the same code successfully', async () => {
  const f=verifiedFixture(); const c=issue(f);
  const results=await Promise.all([concurrentSql(redeemSql(f,c.code,'Concurrent123')),concurrentSql(redeemSql(f,c.code,'Concurrent456'))]);
  assert.equal(results.filter(r=>r.success).length,1);
  expectCode(results.find(r=>!r.success),'RECOVERY_CODE_USED');
});

test('concurrent issuance returns one code and rate-limits the other', async () => {
  const f=verifiedFixture();
  const statement=`select private.support_issue_admin_recovery_code(${quote(f.license)},'password','operator@example.com','Verified contact before delivery');`;
  const results=await Promise.all([concurrentSql(statement),concurrentSql(statement)]);
  assert.equal(results.filter(r=>r.success).length,1);
  expectCode(results.find(r=>!r.success),'RECOVERY_RATE_LIMITED');
});

// V2: real database state machine; external evidence is explicitly a human
// attestation, not a mock of a payment provider or an identity verification API.
const evidence = [
  { kind:'provider_payment', reference:'TEST payment original receipt reference', checked_against:'TEST original merchant settlement ledger', independently_checked:true },
  { kind:'prior_contract', reference:'TEST signed prior contract archive', checked_against:'TEST historical vendor original contract', independently_checked:true }
];
const openSql = (f, entries=evidence, email='new-owner@example.com') => `select private.support_open_recovery_case(${quote(f.license)},${quote(email)},'reviewer-one','TEST case request independent checks',${quote(JSON.stringify(entries))}::jsonb);`;
const actionSql = (id, action, operator='reviewer-two', code=null) => `select private.support_recovery_case_action(${quote(id)},${quote(action)},${quote(operator)},'TEST independent review and delivery reference',${quote(code)});`;
const action = (...args) => json(actionSql(...args));
const caseIssue = (id,target='new') => json(`select private.support_issue_recovery_case_code(${quote(id)},${quote(target)},'reviewer-two','TEST mailbox delivery verified destination');`);
const requestChange = (f,password='Original123') => json(`select public.admin_request_recovery_contact_change(${auth(f)},${quote(password)},'changed@example.com');`);
const waitBudget = (f) => sql(`update private.admin_recovery_audit set created_at=created_at-interval '61 seconds' where license_id=${quote(f.license)};`);
const passSafetyWait = (id) => sql(`update private.admin_recovery_cases set not_before=now()-interval '1 second' where id=${quote(id)};`);

test('V2 evidence fails closed for declarations, missing checks, repeated types, and missing original owner', () => {
  const f=fixture();
  for(const entries of [[],{},null,[evidence[0]], [evidence[0],evidence[0]],
    [evidence[0],{...evidence[1],independently_checked:false}],
    [evidence[0],{kind:'prior_contract',reference:'TEST enough text',checked_against:'TEST enough text'}],
    [evidence[0],{...evidence[1],kind:'license_key'}]]) {
    expectCode(json(openSql(f,entries)),'RECOVERY_INDEPENDENT_EVIDENCE_REQUIRED');
  }
  sql(`update public.license_admin_users set is_active=false where id=${quote(f.owner)};`);
  expectCode(json(openSql(f)),'RECOVERY_OWNER_UNAVAILABLE');
  assert.equal(sql(`select count(*) from private.admin_recovery_cases where license_id=${quote(f.license)};`),'0');
});

for (const plan of ['free_trial','pro_monthly']) test(`V2 ${plan}: exceptional recovery preserves owner and device/plan; enforces approval, mailbox, delay, and v1 reset`, () => {
  const f=fixture(plan); const originalOwner=f.owner;
  const originalLicense=sql(`select to_jsonb(l) from public.licenses l where id=${quote(f.license)};`);
  const originalDevices=sql(`select jsonb_agg(d) from public.license_devices d where license_id=${quote(f.license)};`);
  const opened=json(openSql(f)); assert.equal(opened.success,true); const id=opened.case_id;
  expectCode(json(openSql(f)),'RECOVERY_CASE_ACTIVE');
  expectCode(issue(f),'RECOVERY_SUPPORT_HOLD');
  expectCode(action(id,'approve','reviewer-one'),'RECOVERY_SECOND_REVIEW_REQUIRED');
  expectCode(caseIssue(id),'RECOVERY_SECOND_REVIEW_REQUIRED');
  assert.equal(action(id,'approve').success,true);
  const approvedAt=sql(`select not_before from private.admin_recovery_cases where id=${quote(id)};`);
  assert.equal(action(id,'approve').already_approved,true);
  assert.equal(sql(`select not_before from private.admin_recovery_cases where id=${quote(id)};`),approvedAt);
  expectCode(action(id,'complete'),'RECOVERY_NEW_MAILBOX_REQUIRED');
  const c=caseIssue(id); assert.equal(c.delivery_email,'new-owner@example.com');
  assert.equal(action(id,'verify_new','reviewer-two',c.code).success,true);
  expectCode(action(id,'verify_new','reviewer-two',c.code),'RECOVERY_CODE_USED');
  expectCode(action(id,'complete'),'RECOVERY_SAFETY_WAIT');
  passSafetyWait(id);
  assert.equal(action(id,'complete').success,true);
  assert.equal(action(id,'complete').already_completed,true);
  assert.equal(sql(`select email from private.admin_recovery_contacts where license_id=${quote(f.license)};`),'new-owner@example.com');
  assert.equal(sql(`select id from public.license_admin_users where license_id=${quote(f.license)} and is_owner;`),originalOwner);
  assert.equal(sql(`select to_jsonb(l) from public.licenses l where id=${quote(f.license)};`),originalLicense);
  assert.equal(sql(`select jsonb_agg(d) from public.license_devices d where license_id=${quote(f.license)};`),originalDevices);
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.license)} and revoked_at is null;`),'0');
  waitBudget(f); const reset=issue(f); assert.equal(reset.delivery_email,'new-owner@example.com');
  assert.equal(redeem(f,reset.code).username,'original-owner');
  const diagnosis=json(`select private.support_recovery_status(${quote(f.license)});`);
  const serialized=JSON.stringify(diagnosis);
  for(const secret of ['code_hash','code_ref','password_hash','session_token_hash','security_token',c.code,reset.code]) assert.ok(!serialized.includes(secret));
  assert.equal(diagnosis.cases[0].state,'completed');
  assert.ok(diagnosis.history.some(e=>e.action==='password_recovered_sessions_revoked'));
});

test('V2 authenticated change requires password, shows reference after reload, verifies both mailboxes and revokes sessions', () => {
  const f=verifiedFixture();
  expectCode(requestChange(f,'wrong'),'RECOVERY_REAUTH_REQUIRED');
  const r=requestChange(f); assert.equal(r.success,true); const id=r.case_id;
  const status=json(`select public.admin_recovery_contact_status(${auth(f)});`);
  assert.equal(status.contact.email,f.email); assert.equal(status.pending_change.case_id,id);
  const newCode=caseIssue(id); assert.equal(action(id,'verify_new','operator',newCode.code).success,true);
  expectCode(action(id,'complete'),'RECOVERY_OLD_NOTICE_REQUIRED');
  assert.equal(action(id,'notice').success,true);
  expectCode(action(id,'complete'),'RECOVERY_SAFETY_WAIT');
  waitBudget(f); const oldCode=caseIssue(id,'old'); assert.equal(oldCode.delivery_email,f.email);
  assert.equal(action(id,'verify_old','operator',oldCode.code).success,true);
  assert.equal(action(id,'complete').success,true);
  assert.equal(sql(`select email from private.admin_recovery_contacts where license_id=${quote(f.license)};`),'changed@example.com');
  expectCode(json(`select private.require_active_admin_session(${auth(f)});`),'ADMIN_SESSION_INVALID');
  // Password stays unchanged for authenticated contact replacement.
  const login=json(`select public.admin_login_on_device(${quote(f.key)},'original-owner','Original123','device','Test','{}');`);
  assert.equal(login.success,true);
});

test('V2 lost old mailbox: delay starts at notice, expired original session cannot finish; cancel invalidates codes', () => {
  const f=verifiedFixture(); const {case_id:id}=requestChange(f); const c=caseIssue(id);
  action(id,'verify_new','operator',c.code); passSafetyWait(id); action(id,'notice');
  expectCode(action(id,'complete'),'RECOVERY_SAFETY_WAIT');
  passSafetyWait(id);
  sql(`update public.license_admin_sessions set expires_at=now()-interval '1 second' where id=${quote(f.session)};`);
  expectCode(action(id,'complete'),'RECOVERY_REQUEST_SESSION_REQUIRED');
  assert.equal(action(id,'cancel').success,true);
  assert.equal(sql(`select email from private.admin_recovery_contacts where license_id=${quote(f.license)};`),f.email);
});

test('V2 blocked suspicious case freezes issued v1 codes, revokes owner sessions, and requires explicit cancellation', () => {
  const f=verifiedFixture(); const code=issue(f); const id=json(openSql(f)).case_id;
  expectCode(redeem(f,code.code),'RECOVERY_SUPPORT_HOLD');
  assert.equal(action(id,'block').success,true);
  expectCode(action(id,'approve'),'RECOVERY_CASE_NOT_ACTIONABLE');
  expectCode(caseIssue(id),'RECOVERY_CASE_NOT_ACTIONABLE');
  assert.equal(sql(`select revoked_at is not null from public.license_admin_sessions where id=${quote(f.session)};`),'t');
  assert.equal(action(id,'cancel').success,true);
  expectCode(redeem(f,code.code),'RECOVERY_CODE_INVALID');
});

test('V2 codes isolate cases/licenses; reissue, five attempts and expiry retain v1 guarantees', () => {
  const f=fixture(),other=fixture(); const a=json(openSql(f)).case_id,b=json(openSql(other)).case_id;
  action(a,'approve'); action(b,'approve');
  const first=caseIssue(a); expectCode(action(b,'verify_new','operator',first.code),'RECOVERY_CODE_INVALID');
  waitBudget(f); const second=caseIssue(a); expectCode(action(a,'verify_new','operator',first.code),'RECOVERY_CODE_INVALID');
  const wrong=second.code.slice(0,13)+(second.code[13]==='a'?'b':'a')+second.code.slice(14);
  for(let i=0;i<5;i++) expectCode(action(a,'verify_new','operator',wrong),i===4?'RECOVERY_ATTEMPTS_EXHAUSTED':'RECOVERY_CODE_INVALID');
  expectCode(action(a,'verify_new','operator',second.code),'RECOVERY_ATTEMPTS_EXHAUSTED');
  const otherCode=caseIssue(b);
  sql(`update private.admin_recovery_challenges set expires_at=now()-interval '1 second' where id=(select new_challenge_id from private.admin_recovery_cases where id=${quote(b)});`);
  expectCode(action(b,'verify_new','operator',otherCode.code),'RECOVERY_CODE_EXPIRED');
});

test('V2 concurrent operators create one case, consume once, and complete once with idempotent result', async () => {
  const f=fixture(); const opened=await Promise.all([concurrentSql(openSql(f)),concurrentSql(openSql(f))]);
  assert.equal(opened.filter(r=>r.success).length,1); expectCode(opened.find(r=>!r.success),'RECOVERY_CASE_ACTIVE');
  const id=opened.find(r=>r.success).case_id; action(id,'approve'); const c=caseIssue(id);
  const verified=await Promise.all([concurrentSql(actionSql(id,'verify_new','operator',c.code)),concurrentSql(actionSql(id,'verify_new','operator',c.code))]);
  assert.equal(verified.filter(r=>r.success).length,1); expectCode(verified.find(r=>!r.success),'RECOVERY_CODE_USED');
  passSafetyWait(id);
  const completed=await Promise.all([concurrentSql(actionSql(id,'complete')),concurrentSql(actionSql(id,'complete'))]);
  assert.ok(completed.every(r=>r.success)); assert.equal(completed.filter(r=>r.already_completed).length,1);
  assert.equal(sql(`select count(*) from private.admin_recovery_audit where case_id=${quote(id)} and action='case_complete';`),'1');
});

test('V2 audit failure rolls contact, case completion and sessions back together', () => {
  const f=verifiedFixture(); const id=json(openSql(f)).case_id;
  action(id,'approve'); action(id,'notice'); const c=caseIssue(id); action(id,'verify_new','operator',c.code); passSafetyWait(id);
  sql(`create function private.recovery_test_fail_case_audit() returns trigger language plpgsql as $$ begin
    if new.action='case_complete' then raise exception 'fixture failure'; end if; return new; end $$;
    create trigger recovery_case_audit_failure before insert on private.admin_recovery_audit for each row execute function private.recovery_test_fail_case_audit();`);
  try { assert.throws(()=>action(id,'complete')); }
  finally { sql('drop trigger recovery_case_audit_failure on private.admin_recovery_audit; drop function private.recovery_test_fail_case_audit();'); }
  assert.equal(sql(`select email from private.admin_recovery_contacts where license_id=${quote(f.license)};`),f.email);
  assert.equal(sql(`select state from private.admin_recovery_cases where id=${quote(id)};`),'approved');
  assert.equal(sql(`select revoked_at is null from public.license_admin_sessions where id=${quote(f.session)};`),'t');
  assert.equal(action(id,'complete').success,true);
});

test('V2 ACL denies every private helper and table to PUBLIC/API roles; Staff device/session cannot request changes', () => {
  for(const role of ['anon','authenticated','service_role']) {
    const accessible=sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='private' and (p.proname like '%recovery%' or p.proname='check_admin_recovery_code')
      and has_function_privilege(${quote(role)},p.oid,'execute');`);
    assert.equal(accessible,'0',role);
    assert.equal(sql(`select has_table_privilege(${quote(role)},'private.admin_recovery_cases','select,insert,update,delete');`),'f');
    assert.throws(()=>sql(`set role ${role}; select private.support_recovery_case_action('${randomUUID()}','complete','operator','TEST attempted role escalation');`));
  }
  assert.equal(sql(`select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace, lateral aclexplode(p.proacl) a
    where n.nspname='private' and p.proname like '%recovery%' and a.grantee=0;`),'0');
  const f=verifiedFixture();
  expectCode(json(`select public.admin_request_recovery_contact_change(${auth(f,'staff-token')},'Original123','new@example.com');`),'ADMIN_SESSION_INVALID');
  sql(`update public.license_devices set device_mode='staff_only' where id=${quote(f.device)};`);
  assert.equal(requestChange(f).success,false);
});

test('V2 discovery distinguishes equal names, repeated contacts, historical unverified mail and ownerless licenses', () => {
  const f=verifiedFixture(),g=verifiedFixture();
  sql(`update private.admin_recovery_contacts set email='shared@example.com' where license_id in (${quote(f.license)},${quote(g.license)});
    update public.licenses set owner_email='history@example.com' where id=${quote(g.license)};
    update public.license_admin_users set is_active=false where id=${quote(g.owner)};`);
  const shared=json(`select jsonb_agg(a) from private.support_find_recovery_accounts('shared@example.com') a;`);
  assert.ok(shared.some(r=>r.license_id===f.license));
  const historical=json(`select jsonb_agg(a) from private.support_find_recovery_accounts('history@example.com') a;`);
  assert.equal(historical[0].owner_id,null); assert.equal(historical[0].verified_at,null);
  const byId=json(`select to_jsonb(a) from private.support_find_recovery_accounts(${quote(f.license)}) a;`);
  assert.equal(byId.license_id,f.license);
  assert.equal(sql("select count(*) from private.support_find_recovery_accounts('');"),'0');
});

test('V2 authenticated lost-mailbox route completes after notice delay; stale contact, expiry, and unknown code remain safe', () => {
  const f=verifiedFixture(); const c0=issue(f); const id=requestChange(f).case_id;
  // Unknown random references must not disclose an account's support hold.
  expectCode(redeem(f,'000000000000-00000000000000000000000000000000'),'RECOVERY_CODE_INVALID');
  expectCode(redeem(f,c0.code),'RECOVERY_SUPPORT_HOLD');
  waitBudget(f); const c=caseIssue(id); action(id,'verify_new','operator',c.code); action(id,'notice');
  expectCode(action(id,'complete'),'RECOVERY_SAFETY_WAIT'); passSafetyWait(id);
  assert.equal(action(id,'complete').success,true);
  const g=verifiedFixture(); const another=json(openSql(g)).case_id;
  action(another,'approve'); action(another,'notice'); const cc=caseIssue(another); action(another,'verify_new','operator',cc.code); passSafetyWait(another);
  sql(`update private.admin_recovery_contacts set verified_at=verified_at+interval '1 second' where license_id=${quote(g.license)};`);
  expectCode(action(another,'complete'),'RECOVERY_CONTACT_CHANGED');
  sql(`update private.admin_recovery_cases set expires_at=now()-interval '1 second' where id=${quote(another)};`);
  expectCode(action(another,'complete'),'RECOVERY_CASE_NOT_ACTIONABLE');
  assert.equal(action(another,'cancel').success,true);
});

test('V2 recovery never activates expired/suspended licenses; SQL templates use real interfaces', () => {
  const f=verifiedFixture(); sql(`update public.licenses set status='suspended',expires_at=now()-interval '1 day' where id=${quote(f.license)};`);
  const beforeLicense=sql(`select to_jsonb(l) from public.licenses l where id=${quote(f.license)};`);
  const code=issue(f); assert.equal(redeem(f,code.code).success,true);
  assert.equal(sql(`select to_jsonb(l) from public.licenses l where id=${quote(f.license)};`),beforeLicense);
  const login=json(`select public.admin_login_on_device(${quote(f.key)},'original-owner','Recovered123','device','Test','{}');`);
  assert.equal(login.success,false);
  const template=readFileSync(new URL('../support/account-recovery/01-buscar.sql',import.meta.url),'utf8').replace('BUSQUEDA',f.license);
  const found=sql(template); assert.ok(found.includes(f.license)); assert.ok(!found.includes('password_hash'));
  const statusTemplate=readFileSync(new URL('../support/account-recovery/02-diagnosticar.sql',import.meta.url),'utf8').replace('UUID_LICENCIA',f.license);
  assert.equal(JSON.parse(sql(statusTemplate)).account.license_id,f.license);
});

test('V2 evidence-free security freeze cannot become account recovery, invalidates outstanding code and is idempotent', () => {
  const f=verifiedFixture(); const oldCode=issue(f);
  const block=`select private.support_block_admin_recovery(${quote(f.license)},'security-reviewer','TEST confirmed suspicious recovery incident');`;
  const r=json(block); assert.equal(r.state,'blocked'); assert.equal(json(block).already_blocked,true);
  const state=json(`select to_jsonb(c) from private.admin_recovery_cases c where id=${quote(r.case_id)};`);
  assert.equal(state.kind,'security_hold'); assert.equal(state.new_email,null); assert.deepEqual(state.evidence,[]);
  for(const a of ['approve','notice','verify_new','verify_old','complete']) expectCode(action(r.case_id,a),'RECOVERY_CASE_NOT_ACTIONABLE');
  expectCode(caseIssue(r.case_id),'RECOVERY_CASE_NOT_ACTIONABLE');
  expectCode(issue(f),'RECOVERY_SUPPORT_HOLD'); expectCode(redeem(f,oldCode.code),'RECOVERY_CODE_INVALID');
  assert.equal(sql(`select count(*) from public.license_admin_sessions where license_id=${quote(f.license)} and revoked_at is null;`),'0');
  assert.equal(sql(`select email from private.admin_recovery_contacts where license_id=${quote(f.license)};`),f.email);
  assert.equal(action(r.case_id,'cancel').success,true);
  assert.equal(json(openSql(f)).success,true);
});
