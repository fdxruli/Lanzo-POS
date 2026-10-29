import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Destructive setup is restricted to the named disposable loopback database.
// Never run against Supabase or an application database. Auth/rate and financial
// effect leaves are fixture doubles; actual installed writers/dispatcher and the
// candidate migrations execute on real PostgreSQL with observed lock barriers.
assert.ok(process.argv.includes('--isolated-fixture'));
assert.equal(process.env.PGHOST, '127.0.0.1');
assert.equal(process.env.PGDATABASE, 'lanzo_admin_supervision_fixture');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN);
const args = ['-X','-h','127.0.0.1','-p',process.env.PGPORT,'-U',process.env.PGUSER || 'postgres',
  '-d',process.env.PGDATABASE,'-q','-t','-A','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'];
const execute = query => {
  writeFileSync('.tmp-transition-query.sql', query);
  return spawnSync(process.env.PSQL_BIN, [...args, '-f', '.tmp-transition-query.sql'], { encoding: 'utf8', windowsHide: true });
};
const sql = query => { const r = execute(query); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
const denied = (query, code) => { const r = execute(query); assert.notEqual(r.status, 0, r.stdout); assert.match(r.stderr, new RegExp(code)); return r; };
assert.equal(sql('select current_database()'), process.env.PGDATABASE);
assert.equal(sql('select inet_server_port()'), process.env.PGPORT);
if (process.env.PR352_FIXTURE_MODE === 'github-actions-postgres-service') {
  assert.equal(process.env.PGPORT, '5432');
  assert.equal(sql('select current_setting(\'server_version_num\')'), process.env.PR352_EXPECTED_SERVER_VERSION_NUM);
  assert.equal(sql("select shobj_description(oid,'pg_database') from pg_database where datname=current_database()"),
    'LANZO_PR352_EPHEMERAL_PG17_SERVICE');
} else {
  assert.ok(['127.0.0.1', '127.0.0.1/32'].includes(sql('select inet_server_addr()')));
}
const source = readFileSync('.tmp-transition-mapper-payloads.json', 'utf8');
const { payloads, provenance } = JSON.parse(source);
assert.equal(provenance.production, 'a8547bfc34f483d1d72020114510c8ebea74aace');
assert.equal(provenance.pr338, 'fb17e9a43929d54087ab937cb760a8cd6e087c36');
sql('drop schema public cascade; drop schema private cascade; drop schema extensions cascade; create schema public;');
const load = file => sql('BEGIN;' + readFileSync(file, 'utf8') + 'COMMIT;');
load('supabase/tests/fixtures/restaurant_origin_cancel_3d13_setup.sql');
load('supabase/tests/fixtures/restaurant_admin_supervision_context.sql');
load('supabase/tests/fixtures/pr352_financial_dispatcher_context.sql');
sql(`create function public.enforce_pos_rpc_rate_limit_v2(p_license_key text,p_device_fingerprint text,
p_staff_session_token text,p_rpc_name text,p_scope text,p_max_attempts integer,p_window_seconds integer,
p_block_seconds integer,p_code text,p_metadata jsonb) returns jsonb language sql as $$ select '{"allowed":true}'::jsonb $$;
create function public.build_pos_rpc_rate_limited_response(jsonb) returns jsonb language sql as $$ select '{"success":false}'::jsonb $$;
create function private.is_restaurant_order_status(text) returns boolean language sql as $$
select lower(trim($1)) in ('pending','preparing','ready','delivered','cancelled') $$;`);
sql(`create or replace function public.pos_create_cloud_sale_cashier(
  p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,
  p_sale jsonb,p_items jsonb,p_payments jsonb,p_cash_session_id text,p_internal_idempotency_key text)
returns jsonb language plpgsql as $$
declare c jsonb; sale_id text;
begin
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  sale_id:=coalesce($5->>'id',$5->>'cloud_sale_id',$5->>'cloudSaleId');
  insert into public.pos_sales(id,local_order_id,total,license_id,local_sale_id,device_id,actor_key,
    cash_session_id,idempotency_key)
  values('sale-'||sale_id,sale_id,coalesce(($5->>'total')::numeric,0),(c->>'license_id')::uuid,
    sale_id,(c->>'device_id')::uuid,private.resolve_cash_actor_key(c),$8,$9);
  insert into public.pos_sale_payments(id) values('payment-'||sale_id);
  insert into public.pos_cash_movements(id) values('cash-'||sale_id);
  return jsonb_build_object('success',true,'sale',jsonb_build_object('id','sale-'||sale_id));
end $$;`);
sql(`create function private.pos_restaurant_order_to_jsonb(public.pos_restaurant_orders,jsonb) returns jsonb language sql as $$ select to_jsonb($1) $$;`);
load('supabase/tests/fixtures/restaurant_transition_production_writers.sql');
load('supabase/tests/fixtures/restaurant_hotfix_kitchen_wrappers.sql');
const license = '00000000-0000-0000-0000-000000000001';
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
const parent = id => JSON.parse(sql(`select to_jsonb(o) from public.pos_restaurant_orders o where license_id='${license}' and local_order_id=${quote(id)}`));
const upsert = (name, id, expected, actor = 'staff-a', device = 'A', key = `${name}-${id}-${expected}`, extra = {}) => {
  // Only scenario identity/version inputs vary; the real mapper supplies shape,
  // all commercial fields and item identities. No hand-built legacy payload.
  const original = structuredClone(payloads[name]);
  Object.assign(original.order, { localOrderId: id, saleId: id }, extra);
  if (name === 'transition') original.order.expectedParentVersion = expected;
  return `select public.${name === 'transition' ? 'pos_upsert_restaurant_order_versioned_v1' : 'pos_upsert_restaurant_order'}('fixture-license','${device}','valid','${actor}',${quote(JSON.stringify(original.order))},${quote(JSON.stringify(original.items))},${quote(key)})`;
};
const seed = id => { sql(upsert('production', id)); return parent(id); };
const contract = (actor = 'staff-a', licenseKey = 'fixture-license') => JSON.parse(sql(`select public.pos_restaurant_cloud_contract_v1('${licenseKey}','A','valid','${actor}')`));
const caps = (id, actor = 'staff-a', device = 'A') => JSON.parse(sql(`select public.pos_restaurant_transition_table_capabilities_v1('fixture-license','${device}','valid','${actor}',${quote(id)})`));
const cancel = (id, expected, actor = 'admin', device = 'B', key = `${id}-cancel`) => `select public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','${device}','valid','${actor}',${quote(id)},${quote(expected)},'Transition QA reason',${quote(key)})`;
const financial = (id, expected, operation = 'cashier', key = `${id}-payment`, actor = 'staff-a', device = 'A') => {
  const request = operation === 'split' ? { cash_session_id: 'cash-a', parent_order_id: id, parent_order_version: expected }
    : { cash_session_id: 'cash-a', sale: { id, total: 50 }, items: [], payments: [], restaurant_settlement: { parent_order_id: id, parent_order_version: expected } };
  return `select public.pos_execute_financial_operation_v1('fixture-license','${device}','valid','${actor}',${quote(key)},'fixture-hash','sale.${operation}',${quote(JSON.stringify(request))})`;
};
const results = { provenance, payloadHash: createHash('sha256').update(source).digest('hex'), matrix: [], races: [],
  limitations: 'REAL_POSTGRES_CONTROLLED_AUTH_RATE_FINANCIAL_LEAVES; NOT_INTEGRATED_AUTH_REALTIME_CASH_INVENTORY_QA' };

// SQL current: the old mapper really creates and updates without a parent token.
seed('matrix-historical');
sql(upsert('production', 'matrix-historical', null, 'staff-a', 'A', 'historical-update'));
sql(upsert('pr338', 'matrix-pr338'));
assert.equal(sql("select to_regprocedure('public.pos_restaurant_cloud_contract_v1(text,text,text,text)') is null"), 't');
denied(upsert('transition', 'matrix-historical', parent('matrix-historical').updated_at), 'does not exist');
results.matrix.push({ frontend: 'Production / PR338', backend: 'current', result: 'HISTORICAL_CREATE_UPDATE_PASS_UNVERSIONED' },
  { frontend: 'transition', backend: 'current', result: 'DISCOVERY_ABSENT_CLOUD_WRITE_BLOCKED_READ_LOCAL_DRAFT_ONLY' });
load('supabase/migrations/20261010013257_restaurant_cloud_transition_bridge_v1.sql');
assert.equal(contract().contractVersion, 1); assert.equal(contract('admin').adminSupervisionAvailable, false);
denied(`select private.set_restaurant_transition_policy_v1(false,'${license}',true)`, 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE');
sql(upsert('production', 'matrix-historical', null, 'staff-a', 'A', 'bridge-old-update'));
seed('matrix-bridge-create');
const old = parent('matrix-historical');
sql(upsert('transition', old.local_order_id, old.updated_at));
denied(upsert('transition', old.local_order_id, old.updated_at, 'staff-a', 'A', 'bridge-stale'), 'RESTAURANT_ORDER_VERSION_CONFLICT');
denied(upsert('transition', old.local_order_id, parent(old.local_order_id).updated_at, 'staff-b'), 'RESTAURANT_TABLE_OWNER_REQUIRED');
denied(upsert('production', old.local_order_id, null, 'staff-b', 'A', 'bridge-forged-old'), 'RESTAURANT_TABLE_OWNER_REQUIRED');
denied(upsert('production', old.local_order_id, null, 'staff-a', 'A', 'bridge-forged-id', { id: 'other-tenant-row' }), 'RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED');
denied(cancel(old.local_order_id, parent(old.local_order_id).updated_at), 'RESTAURANT_TABLE_OWNER_REQUIRED');
denied(`set role anon; select private.set_restaurant_transition_policy_v1(false)`, 'permission denied');
denied(`set role anon; update private.restaurant_cloud_contract_state set contract_version=2`, 'permission denied');
assert.equal(caps(old.local_order_id, 'admin').capabilities.canAdministerTable, false);
results.matrix.push({ frontend: 'Production', backend: 'bridge', result: 'ORIGIN_CREATE_UPDATE_PASS_ADMIN_OFF_UNSAFE_IDS_OWNERSHIP_CANCEL_DENIED' },
  { frontend: 'transition', backend: 'bridge', result: 'VERSIONED_CREATE_UPDATE_AUTHORITY_DISCOVERY_PASS' });

const openSession = name => {
  const child = spawn(process.env.PSQL_BIN, args, { env: { ...process.env, PGAPPNAME: name }, windowsHide: true });
  let output = ''; child.stdout.on('data', x => { output += x; }); child.stderr.on('data', x => { output += x; });
  return { child, done: new Promise(resolve => child.on('exit', code => resolve({ code, output }))) };
};
const waitFor = async query => {
  for (let i = 0; i < 80; i++) { if (sql(query) === 't') return; await new Promise(resolve => setTimeout(resolve, 25)); }
  assert.fail('Observed lock barrier was not reached');
};
const blocked = name => `select exists(select 1 from pg_stat_activity where application_name='${name}' and wait_event_type='Lock')`;
const idle = name => `select exists(select 1 from pg_stat_activity where application_name='${name}' and state='idle in transaction')`;
// R1: an actual old writer commits before the exclusive, atomic strict DDL.
seed('transition-cutover');
const before = openSession('transition-old-before-cutover');
before.child.stdin.write(`begin; ${upsert('production', 'transition-cutover', null, 'staff-a', 'A', 'cutover-old')};\n`);
await waitFor(idle('transition-old-before-cutover'));
const ddl = openSession('transition-strict-ddl');
ddl.child.stdin.end('BEGIN;' + readFileSync('supabase/migrations/20261010013258_restaurant_admin_supervision_r1.sql', 'utf8') + 'COMMIT;\n');
await waitFor(blocked('transition-strict-ddl'));
const queuedOld = openSession('transition-old-queued-across-ddl');
queuedOld.child.stdin.end(upsert('production', 'transition-cutover', null, 'staff-a', 'A', 'old-queued-cutover') + ';\n');
await waitFor(blocked('transition-old-queued-across-ddl'));
const forgedOld = openSession('transition-forged-contract-queued-across-ddl');
forgedOld.child.stdin.end(upsert('production', 'transition-cutover', null, 'staff-a', 'A', 'forged-queued-cutover', {
  localOrderId: null, local_order_id: 'transition-cutover', clientContractVersion: 2
}) + ';\n');
await waitFor(blocked('transition-forged-contract-queued-across-ddl'));
before.child.stdin.end('commit;\n');
for (const r of await Promise.all([before.done, ddl.done])) assert.equal(r.code, 0, r.output);
const obsoleteFrame = await queuedOld.done;
assert.notEqual(obsoleteFrame.code, 0, obsoleteFrame.output);
assert.match(obsoleteFrame.output, /RESTAURANT_CLIENT_UPGRADE_REQUIRED/);
const forgedFrame = await forgedOld.done;
assert.notEqual(forgedFrame.code, 0, forgedFrame.output);
assert.match(forgedFrame.output, /RESTAURANT_ORDER_VERSION_REQUIRED/);
assert.equal(contract().contractVersion, 2); assert.equal(contract().legacyWritesAllowed, false);
denied(upsert('production', 'transition-cutover', null, 'staff-a', 'A', 'old-after-cutover'), 'RESTAURANT_CLIENT_UPGRADE_REQUIRED');
const strict = parent('transition-cutover');
sql(upsert('transition', strict.local_order_id, strict.updated_at));
assert.equal(contract('admin').adminSupervisionAvailable, false);
denied(cancel('matrix-historical', parent('matrix-historical').updated_at), 'RESTAURANT_ADMIN_SUPERVISION_NOT_ACTIVE');
sql(`select private.set_restaurant_transition_policy_v1(false,'${license}',true)`);
assert.equal(contract('admin').adminSupervisionAvailable, true);
assert.equal(contract('admin','fixture-other').adminSupervisionAvailable, false);
results.races.push({ case: 'old_writer_vs_atomic_strict_cutover', result: 'DRAINED_COMMIT_THEN_LEGACY_REJECTED' });
results.matrix.push({ frontend: 'transition', backend: 'strict', result: 'VERSIONED_PASS_DEFAULT_ADMIN_DISABLED' },
  { frontend: '352', backend: 'strict activated license', result: 'ADMIN_GATED_SAME_TENANT_NO_REMOTE_EDIT' },
  { frontend: 'old bundle', backend: 'strict', result: 'SAFE_REJECTION_REQUIRES_COORDINATED_UPDATE_NOT_OPERATIONAL_COMPATIBILITY' });

// Durable financial ledger model around the actual dispatcher. These leaves
// deliberately model one durable sale/payment/cash/reservation effect each;
// they cannot certify the integrated Cash, Fiado or inventory implementations.
sql(`alter table public.pos_financial_operations add column fixture_license uuid;
create unique index transition_fixture_financial_key on public.pos_financial_operations(fixture_license,legacy_idempotency_key);
create table private.transition_fixture_releases(parent_id text primary key);
create or replace function private.reserve_financial_operation_v1(uuid,text,text,text,jsonb,text,uuid,text,text)
returns public.pos_financial_operations language plpgsql as $$ declare v public.pos_financial_operations; begin
perform pg_advisory_xact_lock(hashtextextended($1::text||':'||$2,0));
select * into v from public.pos_financial_operations where fixture_license=$1 and legacy_idempotency_key=$2 for update;
if found then return v; end if;
insert into public.pos_financial_operations(fixture_license,license_id,status,legacy_idempotency_key,operation_type,
  canonical_request,verified_actor_key,verified_device_id,verified_cash_session_id,request_hash)
values($1,$1,'processing',$2,$4,$5,$6,$7,$8,$3) returning * into v;
return v; end $$;
create or replace function private.complete_financial_operation_v1(uuid,text,jsonb) returns void language sql as $$
update public.pos_financial_operations set status='completed',response_payload=$3 where fixture_license=$1 and legacy_idempotency_key=$2 $$;
drop function public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text);
create function public.pos_close_restaurant_order_after_checkout_unlimited(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_local_order_id text,p_paid_sale_id text,p_paid_sale_folio text,p_paid_total numeric,p_payment_summary jsonb,p_idempotency_key text)
returns jsonb language plpgsql as $$ begin
perform private.enter_restaurant_transition_write_v1();
perform private.assert_restaurant_settlement_permit_v1(private.validate_pos_sync_context($1,$2,$3,$4),$5);
insert into private.transition_fixture_releases values($5);
update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id=$6,updated_at=now() where local_order_id=$5;
return jsonb_build_object('success',true,'found',true,'order',jsonb_build_object('status','delivered','fulfillment_status','delivered')); end $$;
create or replace function private.execute_split_sale_financial_v1(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_split jsonb,p_internal_idempotency_key text)
returns jsonb language plpgsql as $$ declare v public.pos_restaurant_orders; c jsonb; begin
perform private.enter_restaurant_transition_write_v1(); c:=private.validate_pos_sync_context($1,$2,$3,$4);
v:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,$5->>'parent_order_id');
perform private.assert_restaurant_table_actor_v1(c,v,'split'); perform private.assert_restaurant_settlement_permit_v1(c,v.local_order_id);
insert into public.pos_sales(id,local_order_id,total,license_id,local_sale_id,device_id,actor_key,cash_session_id,idempotency_key)
values('split-'||v.local_order_id,v.local_order_id,50,v.license_id,v.local_order_id,(c->>'device_id')::uuid,
  private.resolve_cash_actor_key(c),$5->>'cash_session_id',$6);
insert into private.transition_fixture_releases values(v.local_order_id);
update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id='split-'||v.local_order_id,updated_at=now() where id=v.id;
return jsonb_build_object('success',true); end $$;`);
const seedStrict = id => { sql(upsert('transition', id, null)); return parent(id); };
const race = async (name, id, first, second, expectedCode) => {
  const winner = openSession(name);
  // Shared policy lock must precede the parent barrier (the production order).
  winner.child.stdin.write(`begin; select private.enter_restaurant_transition_write_v1(); select private.lock_restaurant_order_settlement_v1('${license}',${quote(id)});\n`);
  await waitFor(idle(name));
  const loser = openSession(name + '-loser'); loser.child.stdin.end(second + ';\n');
  await waitFor(blocked(name + '-loser'));
  winner.child.stdin.end(first + '; commit;\n');
  const [win, lose] = await Promise.all([winner.done, loser.done]); assert.equal(win.code, 0, win.output);
  if (expectedCode) { assert.notEqual(lose.code, 0, lose.output); assert.match(lose.output, new RegExp(expectedCode)); }
  else assert.equal(lose.code, 0, lose.output);
  const sqlstate = lose.output.match(/ERROR:\s+([0-9A-Z]{5}):/i)?.[1] ?? null;
  if (expectedCode) assert.equal(sqlstate, 'P0001', lose.output);
  results.races.push({ case: name, result: expectedCode || 'ONE_DURABLE_EFFECT_SAME_RECEIPT',
    sqlstate, winnerExitCode: win.code, loserExitCode: lose.code });
};
let p = seedStrict('transition-kitchen');
const item = sql(`select id from public.pos_restaurant_order_items where restaurant_order_id=${quote(p.id)} limit 1`);
const kitchen = `select public.pos_update_restaurant_order_item_status('fixture-license','B','valid','kitchen',${quote(p.id)},${quote(item)},'preparing','transition-kitchen-item')`;
await race('transition-pos-vs-kitchen', p.local_order_id, kitchen, upsert('transition', p.local_order_id, p.updated_at), 'RESTAURANT_ORDER_VERSION_CONFLICT');
assert.equal(sql(`select status from public.pos_restaurant_order_items where id=${quote(item)}`), 'preparing');
p = seedStrict('transition-staff-admin');
await race('transition-staff-vs-admin', p.local_order_id, upsert('transition', p.local_order_id, p.updated_at), cancel(p.local_order_id, p.updated_at), 'RESTAURANT_ORDER_VERSION_CONFLICT');
p = seedStrict('transition-payment-cutover');
const payment = financial(p.local_order_id, p.updated_at);
await race('transition-payment-vs-policy', p.local_order_id, payment, 'select private.set_restaurant_transition_policy_v1(true)', null);
const pausedPaymentRetry = denied(payment, 'RESTAURANT_CONTRACT_MAINTENANCE');
assert.equal(pausedPaymentRetry.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/i)?.[1] ?? null, 'P0001', pausedPaymentRetry.stderr);
results.races.find(r => r.case === 'transition-payment-vs-policy').pausedRetrySqlstate = 'P0001';
assert.equal(sql(`select status from public.pos_financial_operations where legacy_idempotency_key='${p.local_order_id}-payment'`), 'completed');
sql('select private.set_restaurant_transition_policy_v1(false)');
sql(payment); // Lost response retry keeps the original key/version/request.
assert.equal(sql(`select count(*) from public.pos_sales where local_order_id='${p.local_order_id}'`), '1');
assert.equal(sql(`select count(*) from public.pos_cash_movements where id='cash-${p.local_order_id}'`), '1');
assert.equal(sql(`select count(*) from private.transition_fixture_releases where parent_id='${p.local_order_id}'`), '1');
p = seedStrict('transition-split-cancel');
await race('transition-split-vs-cancel', p.local_order_id, financial(p.local_order_id, p.updated_at, 'split', 'transition-split', 'admin', 'B'), cancel(p.local_order_id, p.updated_at, 'staff-a', 'A'), 'RESTAURANT_ORDER_ALREADY_PAID');
p = seedStrict('transition-identical-retry');
const retry = financial(p.local_order_id, p.updated_at);
await race('transition-idempotent-retry', p.local_order_id, retry, retry, null);
assert.equal(sql(`select count(*) from public.pos_sales where local_order_id='${p.local_order_id}'`), '1');
assert.equal(sql(`select count(*) from public.pos_cash_movements where id='cash-${p.local_order_id}'`), '1');
p = seedStrict('transition-admin-stale');
await race('transition-admin-intervention-vs-old-version', p.local_order_id, cancel(p.local_order_id, p.updated_at), upsert('transition', p.local_order_id, p.updated_at), 'RESTAURANT_ORDER_ALREADY_CANCELLED');
assert.equal(parent(p.local_order_id).created_by_staff_user_id, '00000000-0000-0000-0000-0000000000aa');
assert.equal(sql('select count(*) from private.restaurant_settlement_permits'), '0');
assert.equal(sql('select count(*) from private.restaurant_bridge_cancel_permits'), '0');
assert.equal(results.races.length, 7);
writeFileSync('.tmp-transition-sql-results.json', JSON.stringify(results, null, 2));
console.log('TRANSITION SQL PASS: actual mapper/backend matrix; seven observed multi-session races; financial fixture limits explicit');
