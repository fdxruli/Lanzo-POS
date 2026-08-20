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
  'private.canonical_financial_sale_v1',
  'private.canonical_financial_sale_item_v1',
  'private.canonical_financial_payment_v1',
  'private.financial_first_value_v1',
  "raise exception 'FINANCIAL_INTERNAL_IDEMPOTENCY_COLLISION'",
  "raise exception 'FINANCIAL_INTERNAL_IDEMPOTENCY_INTEGRITY'",
  'private.public_financial_response_v1',
  "raise exception 'FINANCIAL_LEGACY_RESPONSE_NONTERMINAL'",
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
const reserveStart = source.indexOf('create or replace function private.reserve_financial_operation_v1');
const reserveEnd = source.indexOf('create or replace function private.public_financial_response_v1');
const reserveBody = source.slice(reserveStart, reserveEnd);
const currentHash = reserveBody.indexOf('v_expected_hash := private.financial_operation_hash(');
const hashGuard = reserveBody.indexOf("raise exception 'FINANCIAL_REQUEST_HASH_INVALID'");
const replayLookup = reserveBody.indexOf('select * into v_existing from public.pos_financial_operations o');
const lock = reserveBody.indexOf('perform private.lock_financial_operation_v1');
if (currentHash < 0 || hashGuard < currentHash || replayLookup < hashGuard || lock < hashGuard) {
  throw new Error('Current request H must be derived and enforced before lock/replay inspection');
}
if (!reserveBody.includes('v_existing.legacy_idempotency_key is distinct from\n       private.financial_operation_internal_key_v1')
  || !reserveBody.includes('where k.license_id = p_license_id and k.idempotency_key = v_internal_idempotency_key')) {
  throw new Error('Strict internal-key integrity and preexisting internal collision guards are required');
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
  'FINANCIAL_R2_EXPECTED_STALE_HASH_DENIAL',
  'FINANCIAL_R2_EXPECTED_INTERNAL_COLLISION',
  'FINANCIAL_R2_EXPECTED_INTERNAL_INTEGRITY',
  'FINANCIAL_R2_SALE_ALIAS_OR_NUMERIC_NORMALIZATION',
  'FINANCIAL_R2_SALE_ITEM_ORDER_NOT_SEMANTIC',
]) {
  if (!test.includes(expected)) throw new Error(`Executable SQL assertion missing: ${expected}`);
}
for (const expected of ['Start-Job', 'public.pos_execute_financial_operation_v1', 'cash.movement', 'pg_try_advisory_xact_lock', 'business-effect', 'shared terminal financial receipt concurrency: PASS']) {
  if (!harness.includes(expected)) throw new Error(`Concurrency harness is incomplete: ${expected}`);
}
if (harness.includes('Start-Sleep')) throw new Error('Concurrency harness must use a deterministic lock barrier, not a timing delay');
console.log('shared terminal financial receipt R2 static contract: PASS');
