import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, process.argv.find(a => a.startsWith('--out='))?.slice(6) || '.tmp/ecom-native-qa');
mkdirSync(out, { recursive: true });
if (existsSync(resolve(out, 'private-fixtures.json'))) throw new Error('Existing QA inventory must be cleaned and archived before generating another run');
const id = () => randomUUID();
const run = id();
const tenants = [0, 1].map(n => ({ id: id(), key: `QA-ECOM-SIGNAL-R2-1A2-${n}-${run}`, device: id(), device2: id(),
  fingerprint: `qa-1a2-${n}-${run}`, fingerprint2: `qa-1a2-${n}-secondary-${run}`, token: id(), admin: id(), session: id(), session2: id(), actorToken: id(),
  staff: id(), staffSession: id(), staffToken: id(), denied: id(), deniedSession: id(), deniedToken: id(), runtime: id() }));
const q = x => `'${String(x).replaceAll("'", "''")}'`;
const sql = tenants.map((t, n) => `
insert into public.licenses(id,license_key,license_type,status,max_devices,features)
 values(${q(t.id)},${q(t.key)},${q(n ? 'pro' : 'free')},'active',4,'{"ecommerce_portal_enabled":true,"ecommerce_order_inbox":true,"staff_roles":true}');
insert into public.license_devices(id,license_id,device_fingerprint,device_name,security_token,is_active,device_role,device_mode)
 values(${q(t.device)},${q(t.id)},${q(t.fingerprint)},'QA 1A2',${q(t.token)},true,'admin','shared'),
 (${q(t.device2)},${q(t.id)},${q(t.fingerprint2)},'QA 1A2 secondary',${q(t.token)},true,'admin','shared');
insert into public.license_admin_users(id,license_id,username,display_name,password_hash)
 values(${q(t.admin)},${q(t.id)},${q('qa-'+run)},'QA 1A2',extensions.crypt(${q(id())},extensions.gen_salt('bf',4)));
insert into public.license_admin_sessions(id,license_id,admin_user_id,device_id,session_token_hash,expires_at)
 values(${q(t.session)},${q(t.id)},${q(t.admin)},${q(t.device)},extensions.crypt(${q(t.actorToken)},extensions.gen_salt('bf',4)),clock_timestamp()+interval '2 hours'),
 (${q(t.session2)},${q(t.id)},${q(t.admin)},${q(t.device2)},extensions.crypt(${q(t.actorToken)},extensions.gen_salt('bf',4)),clock_timestamp()+interval '2 hours');
insert into public.license_staff_users(id,license_id,username,display_name,password_hash,permissions)
 values(${q(t.staff)},${q(t.id)},${q('qa-staff-'+run)},'QA 1A2 Ecommerce',extensions.crypt(${q(id())},extensions.gen_salt('bf',4)),'{"ecommerce":true,"settings":false}'),
 (${q(t.denied)},${q(t.id)},${q('qa-denied-'+run)},'QA 1A2 denied',extensions.crypt(${q(id())},extensions.gen_salt('bf',4)),'{"ecommerce":false}');
insert into public.license_staff_sessions(id,license_id,staff_user_id,device_id,session_token_hash,expires_at)
 values(${q(t.staffSession)},${q(t.id)},${q(t.staff)},${q(t.device)},extensions.crypt(${q(t.staffToken)},extensions.gen_salt('bf',4)),clock_timestamp()+interval '2 hours'),
 (${q(t.deniedSession)},${q(t.id)},${q(t.denied)},${q(t.device)},extensions.crypt(${q(t.deniedToken)},extensions.gen_salt('bf',4)),clock_timestamp()+interval '2 hours');
insert into lanzo_ecom_bridge_qa.qa_tenants values(${q(t.id)});
`).join('\n');
const captures = tenants.map(t => ({ license_key: t.key, device_fingerprint: t.fingerprint, security_token: t.token,
  actor_session_token: t.actorToken, runtime_id: t.runtime, actor_generation: 1, tenant_generation: 1 }));
writeFileSync(resolve(out, 'private-fixtures.json'), JSON.stringify({ run, tenants, captures }, null, 2));
writeFileSync(resolve(out, 'fixtures.sql'), sql);
writeFileSync(resolve(out, 'test-context.sql'), `create temp table ecom_native_context(p jsonb,device_a uuid,session_a uuid,denied_token text,other_license_key text);
insert into ecom_native_context values(${q(JSON.stringify(captures[0]))}::jsonb,${q(tenants[0].device)},${q(tenants[0].session)},${q(tenants[0].deniedToken)},${q(tenants[1].key)});`);
// Cleanup is selective and ordered. No CASCADE or real business identifiers.
writeFileSync(resolve(out, 'fixture-cleanup.sql'), tenants.map(t => `
delete from lanzo_ecom_bridge_qa.device_limits where device_id in (${q(t.device)},${q(t.device2)});
delete from lanzo_ecom_bridge_qa.qa_tenants where license_id=${q(t.id)};
delete from public.license_staff_sessions where id in (${q(t.staffSession)},${q(t.deniedSession)});
delete from public.license_admin_sessions where id in (${q(t.session)},${q(t.session2)});
delete from public.license_staff_users where id in (${q(t.staff)},${q(t.denied)});
delete from public.license_admin_users where id=${q(t.admin)};
delete from public.license_devices where id in (${q(t.device)},${q(t.device2)});
delete from public.licenses where id=${q(t.id)};
`).join('\n'));
console.log(JSON.stringify({ out, run, tenants: tenants.map(t => t.id), executed: false }));
