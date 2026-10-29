import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { queryLoopbackPostgres } from './loopback-postgres-client.mjs';

const outPath = 'docs/reports/fin01-r22/fin01-pay-n01-baseline.json';
const tenant = '10000000-0000-0000-0000-000000000001';
const customerId = `customer-${randomUUID()}`;
const key = `pay-n01-baseline-${randomUUID()}`;
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const q = (sql) => queryLoopbackPostgres(sql, 'fin01_cert_baseline');
const data = async (sql) => JSON.parse(await q(sql));
const report = {
  stage: 'PAY-N01-baseline',
  result: 'INCOMPLETE',
  postgres_version: null,
  input: { tenant_id: tenant, customer_id: customerId, debt: 100, payment: 125, credit_limit: 1000, ledger_before: 0 },
  function_sha256: null,
  before: null,
  response: null,
  sqlstate: null,
  transaction: null,
  after: null,
  retry_response: null,
  after_retry: null,
  assertions: {},
  failure: null
};

try {
  report.postgres_version = (await q('show server_version;')).trim();
  assert.match(report.postgres_version, /^17\./, 'PostgreSQL 17 is required');
  report.function_sha256 = (await q(`select encode(extensions.digest(convert_to(replace(pg_get_functiondef('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)'::regprocedure), chr(13), ''), 'UTF8'), 'sha256'), 'hex');`)).trim();
  assert.equal(report.function_sha256, '73ce2f73f985eada337800b1ed18b9242c1f57948a23c48a57542f522ead8bf4', 'Baseline function does not match the exact pre-fix candidate SQL hash');

  await q(`insert into public.pos_customers(id,license_id,name,debt,debt_cents,credit_limit) values(${lit(customerId)},${lit(tenant)},'Synthetic PAY-N01',0,0,1000);
    update public.pos_customers set debt=100,debt_cents=10000 where license_id=${lit(tenant)} and id=${lit(customerId)};`);

  const snapshot = () => data(`select jsonb_build_object(
    'customer',(select jsonb_build_object('debt',debt,'debt_cents',debt_cents) from public.pos_customers where license_id=${lit(tenant)} and id=${lit(customerId)}),
    'ledger',(select count(*) from public.pos_customer_ledger where license_id=${lit(tenant)} and customer_id=${lit(customerId)}),
    'initial_balance',(select count(*) from public.pos_customer_ledger where license_id=${lit(tenant)} and customer_id=${lit(customerId)} and type='INITIAL_BALANCE'),
    'initial_balance_rows',coalesce((select jsonb_agg(jsonb_build_object('amount',amount,'balance_after',balance_after,'debt_cents_after',debt_cents_after,'idempotency_key',idempotency_key,'metadata',metadata) order by created_at,id) from public.pos_customer_ledger where license_id=${lit(tenant)} and customer_id=${lit(customerId)} and type='INITIAL_BALANCE'),'[]'::jsonb),
    'payment',(select count(*) from public.pos_customer_ledger where license_id=${lit(tenant)} and customer_id=${lit(customerId)} and type='PAYMENT'),
    'events',(select count(*) from public.pos_sync_events where license_id=${lit(tenant)} and (entity_id=${lit(customerId)} or metadata->>'customer_id'=${lit(customerId)})),
    'cash',(select count(*) from public.pos_cash_movements where license_id=${lit(tenant)} and idempotency_key=${lit(key)}),
    'cash_status',(select status from public.pos_cash_sessions where license_id=${lit(tenant)} and id='cash-a'),
    'historical_receipts',(select count(*) from private.pos_historical_credit_receipts where license_id=${lit(tenant)} and customer_id=${lit(customerId)}),
    'idempotency',(select jsonb_build_object('status',status,'response_payload',response_payload) from public.pos_idempotency_keys where license_id=${lit(tenant)} and idempotency_key=${lit(key)})
  );`);

  report.before = await snapshot();
  assert.equal(report.before.customer.debt_cents, 10000);
  assert.equal(report.before.ledger, 0);
  assert.equal(report.before.initial_balance, 0);
  assert.deepEqual(report.before.initial_balance_rows, []);
  assert.equal(report.before.payment, 0);
  assert.equal(report.before.events, 0);
  assert.equal(report.before.cash, 0);
  assert.equal(report.before.historical_receipts, 0);
  assert.equal(report.before.idempotency, null);
  assert.equal(report.before.cash_status, 'open');

  const paymentSql = `begin; select public.pos_record_customer_payment('fixture-a','device-a','synthetic-device','owner-session-a',${lit(customerId)},125,'efectivo','cash-a','PAY-N01 synthetic baseline','[]',${lit(key)}); commit;`;
  let rawResponse;
  try {
    rawResponse = await q(paymentSql);
    report.transaction = 'COMMIT_SUCCEEDED';
    report.sqlstate = null;
    report.response = JSON.parse(rawResponse);
  } catch (error) {
    report.transaction = 'ROLLBACK_ON_SQL_ERROR_AND_CONNECTION_CLOSE';
    report.sqlstate = error.code ?? null;
    report.sql_error = error.message;
    throw error;
  }
  report.after = await snapshot();
  report.retry_response = await data(`begin; select public.pos_record_customer_payment('fixture-a','device-a','synthetic-device','owner-session-a',${lit(customerId)},125,'efectivo','cash-a','PAY-N01 synthetic baseline','[]',${lit(key)}); commit;`);
  report.after_retry = await snapshot();

  assert.equal(report.response.success, false);
  assert.equal(report.response.code, 'PAYMENT_EXCEEDS_DEBT');
  assert.equal(report.response.current_debt, 100);
  assert.equal(report.transaction, 'COMMIT_SUCCEEDED');
  assert.equal(report.sqlstate, null);
  assert.equal(report.after.initial_balance, 1, 'The exact defect requires one INITIAL_BALANCE row to persist');
  assert.equal(report.after.ledger, 1);
  assert.deepEqual(report.after.initial_balance_rows, [{
    amount: 100,
    balance_after: 100,
    debt_cents_after: 10000,
    idempotency_key: `customer_credit.initial_balance:auto:${customerId}`,
    metadata: { source: 'auto_initial_balance_before_payment' }
  }]);
  assert.deepEqual(report.after.customer, report.before.customer);
  assert.equal(report.after.payment, 0);
  assert.equal(report.after.events, 1);
  assert.equal(report.after.cash, 0);
  assert.equal(report.after.historical_receipts, 0);
  assert.equal(report.after.cash_status, 'open');
  assert.equal(report.after.idempotency.status, 'completed');
  assert.deepEqual(report.after.idempotency.response_payload, report.response);
  assert.deepEqual(report.retry_response, report.response);
  assert.deepEqual(report.after_retry, report.after);
  report.assertions = {
    exact_pre_fix_function_sha256: true,
    business_rejection: 'PAYMENT_EXCEEDS_DEBT',
    transaction: 'COMMIT_SUCCEEDED',
    sqlstate: null,
    unexpected_initial_balance_rows_persisted: 1,
    initial_balance_amount: 100,
    financial_payment_rows: 0,
    cash_movements: 0,
    idempotent_retry: true
  };
  report.result = 'DEFECT_REPRODUCED';
} catch (error) {
  report.result = 'FAIL';
  report.failure = { message: error.message, sqlstate: error.code ?? null };
} finally {
  await fs.writeFile(outPath, JSON.stringify(report, null, 2));
}

process.stdout.write(`${report.result}\n`);
if (report.result !== 'DEFECT_REPRODUCED') process.exitCode = 1;
