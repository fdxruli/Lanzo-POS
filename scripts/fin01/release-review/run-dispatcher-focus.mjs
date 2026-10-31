import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const values = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = arg.match(/^(--[a-z-]+)=(.*)$/u);
  if (!match) throw new Error(`UNSUPPORTED_ARGUMENT:${arg.split('=')[0]}`);
  return [match[1], match[2]];
}));
if (Object.keys(values).some((key) => !['--database', '--report'].includes(key))) throw new Error('UNSUPPORTED_ARGUMENT');
if (!/^fin01_cert_success_[a-z0-9_]+$/u.test(values['--database'] ?? '')) throw new Error('SYNTHETIC_DATABASE_REQUIRED');
if (!/^artifacts\/fin01\/dispatcher-[a-z0-9-]+\.json$/u.test(values['--report'] ?? '')) throw new Error('ARTIFACT_REPORT_PATH_REQUIRED');
if (!/^[0-9a-f]{40}$/u.test(process.env.GITHUB_SHA ?? '')) throw new Error('ACTIONS_SHA_REQUIRED');

const database = values['--database'];
const q = (sql) => queryLoopbackPostgres(sql, database);
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const serverVersion = (await q('show server_version_num;')).trim();
assert.ok(['170006', '170011'].includes(serverVersion), `POSTGRES_VERSION_NOT_ALLOWED:${serverVersion}`);
const tenant = '10000000-0000-0000-0000-000000000001';
const device = '20000000-0000-0000-0000-000000000001';
const actor = '30000000-0000-0000-0000-000000000001';
const suffix = process.env.GITHUB_SHA.slice(0, 12);
const saleId = `restaurant-sale-${suffix}`;
const restaurantOrderId = `restaurant-order-${suffix}`;
const key = `restaurant-dispatcher-${suffix}`;
const operationId = `60000000-0000-4000-a000-${suffix}`;
const results = [];

const effects = async () => JSON.parse(await q(`select jsonb_build_object(
  'sales',(select count(*) from public.pos_sales),
  'payments',(select count(*) from public.pos_sale_payments),
  'ledger',(select count(*) from public.pos_customer_ledger),
  'cash',(select count(*) from public.pos_cash_movements),
  'inventory',(select count(*) from public.pos_inventory_movements),
  'idempotency',(select count(*) from public.pos_idempotency_keys)
);`));

const call = ({ securityToken = 'synthetic-device', staffSession = 'owner-session-a', cashSession = 'cash-a', inputSale = saleId } = {}) =>
  `select private.assert_restaurant_sale_dispatcher_context_v1(
    'fixture-a','device-a',${lit(securityToken)},${lit(staffSession)},
    ${lit(JSON.stringify({ id: inputSale, local_sale_id: inputSale }))}::jsonb,
    ${lit(cashSession)},${lit(key)},'sale.cashier'
  );`;

async function expectReject(name, sql, expected) {
  let error;
  try { await q(sql); } catch (caught) { error = caught; }
  assert.ok(error, `${name}_EXPECTED_REJECTION`);
  assert.equal(error.code, 'P0001', `${name}_SQLSTATE`);
  assert.match(error.message, expected, `${name}_ERROR_MESSAGE`);
  results.push({ name, status: 'PASS', sqlstate: error.code, message: error.message });
}

await q(`do $fin01_dispatcher_fixture_preflight$
begin
  if to_regclass('public.pos_restaurant_orders') is null
     or to_regclass('public.pos_financial_operations') is null
     or not exists(select 1 from public.licenses where id=${lit(tenant)}::uuid)
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pos_restaurant_orders' and column_name='local_order_id')
     or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='pos_financial_operations' and column_name='idempotency_key') then
    raise exception 'DISPATCHER_FINANCIAL_SCHEMA_REQUIRED' using errcode='P0001';
  end if;
  if exists(select 1 from public.pos_restaurant_orders where id=${lit(restaurantOrderId)})
     or exists(select 1 from public.pos_financial_operations where id=${lit(operationId)}::uuid)
     or exists(select 1 from public.pos_financial_operations where license_id=${lit(tenant)}::uuid and idempotency_key=${lit(key)}) then
    raise exception 'DISPATCHER_SYNTHETIC_ID_COLLISION' using errcode='P0001';
  end if;
end $fin01_dispatcher_fixture_preflight$;
insert into public.pos_restaurant_orders(id,license_id,local_order_id)
values (${lit(restaurantOrderId)},${lit(tenant)}::uuid,${lit(saleId)});`);

let failure = null;
try {
  const before = await effects();
  await expectReject('valid owner auth without in-flight financial operation is blocked', call(), /RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED/u);

  await q(`insert into public.pos_financial_operations(
    id,license_id,idempotency_key,legacy_idempotency_key,request_hash,request_contract_version,
    operation_type,status,canonical_request,verified_actor_key,verified_device_id,verified_cash_session_id
  ) values (
    ${lit(operationId)}::uuid,${lit(tenant)}::uuid,${lit(key)},${lit(key)},
    ${lit(`sha256:${'a'.repeat(64)}`)},1,'sale.cashier','processing',
    ${lit(JSON.stringify({ sale: { id: saleId } }))}::jsonb,
    ${lit(`admin:${actor}`)},${lit(device)}::uuid,'cash-a'
  );`);
  await q(call());
  results.push({ name: 'exact owner-bound in-flight operation is accepted by 3D14 guard', status: 'PASS', sqlstate: null });

  await expectReject('operation with mismatched Caja session is blocked', call({ cashSession: 'cash-b' }), /RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED/u);
  await expectReject('invalid actor session is blocked before dispatch', call({ staffSession: 'not-a-session' }), /ACTOR_SESSION_INVALID/u);
  const after = await effects();
  assert.deepEqual(after, before, 'DISPATCHER_GUARD_MUST_NOT_CREATE_FINANCIAL_EFFECTS');
  results.push({ name: 'dispatcher checks created no sales, payments, debt, Caja, inventory, or idempotency effects', status: 'PASS', before, after });
} catch (error) {
  failure = { message: error.message, sqlstate: error.code ?? null };
} finally {
  await q(`delete from public.pos_financial_operations where id=${lit(operationId)}::uuid;
           delete from public.pos_restaurant_orders where id=${lit(restaurantOrderId)} and license_id=${lit(tenant)}::uuid;`);
}

const report = {
  result: failure ? 'FAIL' : 'PASS',
  code_sha: process.env.GITHUB_SHA,
  database,
  postgres_version_num: serverVersion,
  state: 'post-3D14 then F then PAY-N01; functions also verified by the selective applier',
  executed: results.length,
  passed: results.length,
  failed: failure ? 1 : 0,
  failure,
  results
};
await fs.mkdir(path.dirname(path.join(root, values['--report'])), { recursive: true });
await fs.writeFile(path.join(root, values['--report']), `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);
if (failure) process.exitCode = 1;
