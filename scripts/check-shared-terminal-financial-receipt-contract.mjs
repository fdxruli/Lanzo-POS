import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = path.join(root, 'supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql');
const sqlTest = path.join(root, 'supabase/tests/shared_terminal_financial_receipt_contract_test.sql');
const concurrencyHarness = path.join(root, 'scripts/test-shared-terminal-financial-receipt-concurrency.ps1');
const source = fs.readFileSync(migration, 'utf8');
const test = fs.readFileSync(sqlTest, 'utf8');
const harness = fs.readFileSync(concurrencyHarness, 'utf8');

const requireSource = [
  'create table if not exists public.pos_financial_operations',
  'legacy_idempotency_key text not null',
  'unique (license_id, idempotency_key)',
  'unique (license_id, legacy_idempotency_key)',
  'references public.pos_cash_sessions(license_id, id)',
  'private.financial_operation_internal_key_v1',
  "return 'financial-v1:' || p_operation_type",
  'private.lock_financial_operation_v1',
  'pg_advisory_xact_lock(',
  'private.assert_financial_request_hash_v1(p_request_hash)',
  "raise exception 'FINANCIAL_REQUEST_HASH_REQUIRED'",
  "p_request_hash !~ '^sha256:[0-9a-f]{64}$'",
  'request_hash is distinct from p_request_hash',
  'private.assert_financial_operation_origin_v1',
  "raise exception 'FINANCIAL_OPERATION_ORIGIN_MISMATCH'",
  "raise exception 'IDEMPOTENCY_CONFLICT'",
  "raise exception 'LEGACY_IDEMPOTENCY_UNVERIFIED'",
  'private.financial_decimal_v1',
  'trim_scale(',
  "'verified_origin'",
  'security definer',
  "set search_path = ''",
  'revoke all on table public.pos_financial_operations',
  'public.pos_get_financial_operation_receipt',
];
for (const expected of requireSource) {
  if (!source.includes(expected)) throw new Error(`Missing R1 structural contract: ${expected}`);
}
const financialBeforeLegacy = source.indexOf('select * into v_existing from public.pos_financial_operations o');
const legacyClassification = source.indexOf("raise exception 'LEGACY_IDEMPOTENCY_UNVERIFIED'");
if (financialBeforeLegacy < 0 || legacyClassification < financialBeforeLegacy) {
  throw new Error('Financial K/H precedence must be evaluated before legacy external-K classification');
}
const receiptBody = source.slice(source.indexOf('create or replace function public.pos_get_financial_operation_receipt'));
if (receiptBody.includes(':= public.pos_execute_financial_operation_v1(') || receiptBody.includes('perform public.pos_execute_financial_operation_v1(')) {
  throw new Error('Receipt RPC must not dispatch a financial mutation');
}
for (const operation of ['cash.open', 'cash.movement', 'cash.adjust_initial_fund', 'cash.close', 'cash.admin_close', 'sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.cancel']) {
  if (!source.includes(`'${operation}'`)) throw new Error(`Operation is not wired: ${operation}`);
}
if (!source.includes('CUSTOMER_PAYMENT_SERVER_CONTRACT_UNVERIFIED') || source.includes("when 'customer.payment'")) {
  throw new Error('Customer payment recovery blocker is not explicit');
}
for (const expected of [
  'FINANCIAL_R1_SAME_K_H_REPLAY',
  'FINANCIAL_R1_EXPECTED_K_H_CONFLICT',
  'FINANCIAL_R1_EXPECTED_LEGACY_DENIAL',
  'FINANCIAL_R1_EXPECTED_ACTOR_DENIAL',
  'FINANCIAL_R1_NUMERIC_NORMALIZATION',
  'FINANCIAL_R1_DIRECT_TABLE_ACCESS',
  'FINANCIAL_REQUEST_HASH_REQUIRED',
]) {
  if (!test.includes(expected)) throw new Error(`Executable SQL assertion missing: ${expected}`);
}
for (const expected of ['Start-Job', 'private.reserve_financial_operation_v1', 'IDEMPOTENCY_CONFLICT', 'shared terminal financial receipt concurrency: PASS']) {
  if (!harness.includes(expected)) throw new Error(`Concurrency harness is incomplete: ${expected}`);
}
console.log('shared terminal financial receipt R1 static contract: PASS');
