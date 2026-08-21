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
  'private.financial_canonical_json_v1',
  "convert_to(private.financial_canonical_json_v1",
  'FINANCIAL_CASH_SESSION_ID_REQUIRED',
  'private.resolve_financial_cash_station_v1',
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
  'private.canonical_financial_batch_allocations_v1',
  'private.canonical_financial_selected_modifiers_v1',
  'batches_used',
  'private.financial_payment_method_v1',
  'private.financial_execution_request_v1',
  'private.financial_first_value_v1',
  'private.financial_first_present_value_v1',
  'private.financial_first_nonblank_scalar_v1',
  'FINANCIAL_TIMESTAMP_INVALID',
  "raise exception 'FINANCIAL_INTERNAL_IDEMPOTENCY_COLLISION'",
  "raise exception 'FINANCIAL_INTERNAL_IDEMPOTENCY_INTEGRITY'",
  'private.public_financial_response_v1',
  'private.sanitize_financial_response_idempotency_v1',
  'private.assert_financial_response_no_internal_key_v1',
  'private.assert_financial_legacy_result_terminal_v1',
  "raise exception 'FINANCIAL_LEGACY_OPERATION_REJECTED:%'",
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
const exactReserveRevoke = 'revoke all on function private.reserve_financial_operation_v1(uuid, text, text, text, jsonb, text, uuid, text, text) from public, anon, authenticated;';
const obsoleteReserveRevoke = 'revoke all on function private.reserve_financial_operation_v1(uuid, text, text, text, jsonb, text, uuid, text) from public, anon, authenticated;';
if (!source.includes(exactReserveRevoke) || source.includes(obsoleteReserveRevoke)) {
  throw new Error('Reserve CREATE/REVOKE identity must be the exact nine-argument signature');
}
if (!reserveBody.includes('p_verified_cash_station_id text default null')) {
  throw new Error('Reserve CREATE identity must contain nine arguments');
}
const originStart = source.indexOf('create or replace function private.assert_financial_operation_origin_v1');
const originEnd = source.indexOf('create or replace function private.financial_decimal_v1');
const originBody = source.slice(originStart, originEnd);
if (!originBody.includes('p_operation.verified_cash_session_id is null\n     and p_operation.verified_cash_station_id is null then return')
  || !originBody.includes('s.status = \'active\'')) {
  throw new Error('Station-bound sessionless receipt authority is incomplete');
}
const completeStart = source.indexOf('create or replace function private.complete_financial_operation_v1');
const completeEnd = source.indexOf('create or replace function public.pos_execute_financial_operation_v1');
const completeBody = source.slice(completeStart, completeEnd);
if (!completeBody.includes("v_operation.operation_type = 'cash.open'")
  || !completeBody.includes('v_session.cash_station_id is distinct from v_operation.verified_cash_station_id')) {
  throw new Error('cash.open completion must prove the reserved and returned stations are equal');
}
if (!reserveBody.includes('v_operation_id uuid := extensions.gen_random_uuid()')
  || !reserveBody.includes('private.financial_operation_internal_key_v1(v_existing.operation_type, v_existing.id)')
  || reserveBody.includes('financial_operation_internal_key_v1(p_operation_type, p_idempotency_key)')) {
  throw new Error('Internal K must be server-generated from the strict operation UUID, never external K');
}
const executorBody = source.slice(source.indexOf('create or replace function public.pos_execute_financial_operation_v1'));
for (const dispatch of ["v_execution->'sale', v_execution->'items', v_execution->'payments'", "v_execution->>'cash_session_id'"]) {
  if (!executorBody.includes(dispatch)) throw new Error('Business dispatch must use the original execution payload, not hash projection');
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
  'FINANCIAL_R2_EXPECTED_INTERNAL_INTEGRITY',
  'FINANCIAL_R2_SALE_ALIAS_OR_NUMERIC_NORMALIZATION',
  'FINANCIAL_R2_SALE_ITEM_ORDER_NOT_SEMANTIC',
  'FINANCIAL_R3_BATCH_ALLOCATION_ALIAS_NORMALIZATION',
  'FINANCIAL_R3_BATCH_ALLOCATION_NOT_HASHED',
  'FINANCIAL_R3_EXECUTION_BATCHES_USED_NOT_PRESERVED',
  'FINANCIAL_R3_PAYMENT_ALIAS_NORMALIZATION',
  'FINANCIAL_R3_INTERNAL_KEY_OPERATION_OWNERSHIP',
  'FINANCIAL_R3_SUCCESS_FALSE_COMPLETED',
  'FINANCIAL_R4_NESTED_INTERNAL_KEY_SANITIZATION',
  'FINANCIAL_R4_SELECTED_MODIFIER_ALIAS_NORMALIZATION',
  'FINANCIAL_R4_SELECTED_MODIFIER_NOT_HASHED',
  'FINANCIAL_R6_RECEIPT_CROSS_ACTOR_NON_DISCLOSURE',
  'FINANCIAL_R6_FIXED_HASH_VECTOR_A',
  'FINANCIAL_R6_FIXED_HASH_VECTOR_B',
  'FINANCIAL_R6_FIXED_HASH_VECTOR_C',
  'FINANCIAL_R6_FIXED_HASH_VECTOR_D',
  'FINANCIAL_R6_FIXED_HASH_VECTOR_E',
  'FINANCIAL_R6_NULL_FALLBACK_CASH_OPEN',
  'FINANCIAL_R6_BLANK_FALLBACK_CUSTOMER',
  'FINANCIAL_R6_OFFSETLESS_TIMESTAMP_ACCEPTED',
  'FINANCIAL_R6_SALE_CASHIER_MISSING_SESSION',
  'FINANCIAL_R6_SALE_CASHIER_INVENTORY_MISSING_SESSION',
  'FINANCIAL_R6_SALE_CREDIT_MISSING_SESSION',
  'FINANCIAL_R6_CASH_OPEN_STATION_RESOLUTION',
  'FINANCIAL_R6_CASH_OPEN_STATION_HASH',
  'FINANCIAL_R6_CASH_OPEN_STATION_MISMATCH_COMPLETED',
  'FINANCIAL_R6_SESSIONLESS_STATION_AUTHORITY',
]) {
  if (!test.includes(expected)) throw new Error(`Executable SQL assertion missing: ${expected}`);
}
for (const expected of ['Start-Job', 'public.pos_execute_financial_operation_v1', 'cash.movement', 'pg_try_advisory_xact_lock', 'business-effect', 'LANZO_POS_TEST_ALLOW_FINANCIAL_MUTATION', 'LANZO_POS_TEST_DISPOSABLE_CASH_SESSION', "'postgres', 'postgresql'", "'localhost', '127.0.0.1', '::1'", "'host', 'hostaddr', 'service', 'servicefile'", 'pos_cash_audit_events', 'pos_sync_events', 'pos_idempotency_keys', 'baselineExact', 'PRIMARY TEST FAILURE', 'shared terminal financial receipt concurrency: PASS']) {
  if (!harness.includes(expected)) throw new Error(`Concurrency harness is incomplete: ${expected}`);
}
if (harness.includes('Start-Sleep')) throw new Error('Concurrency harness must use a deterministic lock barrier, not a timing delay');
console.log('shared terminal financial receipt R6 static contract: PASS');
