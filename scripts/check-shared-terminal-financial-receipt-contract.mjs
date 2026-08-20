import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const migration = path.join(root, 'supabase/migrations/20260820165842_shared_terminal_financial_receipt_contract.sql');
const sqlTest = path.join(root, 'supabase/tests/shared_terminal_financial_receipt_contract_test.sql');
const source = fs.readFileSync(migration, 'utf8');
const test = fs.readFileSync(sqlTest, 'utf8');
const required = [
  'create table if not exists public.pos_financial_operations',
  'unique (license_id, idempotency_key)',
  "status in ('processing', 'completed')",
  "extensions.digest(",
  'private.canonical_financial_request_v1',
  'private.reserve_financial_operation_v1',
  "raise exception 'IDEMPOTENCY_CONFLICT'",
  "raise exception 'LEGACY_IDEMPOTENCY_UNVERIFIED'",
  'public.pos_execute_financial_operation_v1',
  'public.pos_get_financial_operation_receipt',
  "'NOT_FOUND'",
  "'CONFLICT'",
  "'PROCESSING'",
  "'COMPLETED'",
  'security definer',
  "set search_path = ''",
  'revoke all on table public.pos_financial_operations',
];
for (const expected of required) {
  if (!source.includes(expected)) throw new Error(`Missing financial receipt contract: ${expected}`);
}
for (const operation of ['cash.open', 'cash.movement', 'cash.adjust_initial_fund', 'cash.close', 'cash.admin_close', 'sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.cancel']) {
  if (!source.includes(`'${operation}'`)) throw new Error(`Operation is not wired: ${operation}`);
}
for (const expected of [
  'FINANCIAL_K_TENANT_UNIQUENESS_MISSING',
  'FINANCIAL_RECEIPT_SIDE_EFFECT',
  'legacy NULL-H',
  'concurrent same K/H',
  'K/different-H',
  'cross-tenant denial',
  'spoofed actor/session/station denial',
  'one caller transaction',
  'SET search_path',
]) {
  if (!test.includes(expected)) throw new Error(`SQL contract test lacks coverage marker: ${expected}`);
}
if (!source.includes('CUSTOMER_PAYMENT_SERVER_CONTRACT_UNVERIFIED') || source.includes("when 'customer.payment'")) {
  throw new Error('Customer payment recovery blocker is not explicit');
}
console.log('shared terminal financial receipt static contract: PASS');
