import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');
const migration = read('supabase/migrations/20260929091708_restaurant_payment_split_financial_r1.sql');
const packageJson = JSON.parse(read('package.json'));

const functionBody = (source, marker, terminator = '$function$;') => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${marker}`);
  const end = source.indexOf(terminator, start);
  assert.ok(end > start, `incomplete function: ${marker}`);
  return source.slice(start, end + terminator.length);
};

test('monetary split migration is a forward-only contract change with no live data mutation', () => {
  assert.equal((migration.match(/create or replace function/giu) || []).length, 4);
  assert.doesNotMatch(migration, /\b(drop|truncate|insert\s+into|update\s+public\.|delete\s+from|alter\s+table|create\s+table)\b/iu);
  assert.match(migration, /revoke all on function private\.canonical_financial_request_v1\(text, jsonb\) from public, anon, authenticated;/u);
  assert.match(migration, /revoke all on function private\.execute_split_sale_financial_v1\(text, text, text, text, jsonb, text\) from public, anon, authenticated;/u);
  assert.match(packageJson.scripts['test:restaurant-split-payment-contract'], /restaurant-split-payment-contract-r1\.node-test\.mjs/u);
});

test('canonical identity pins monetary intent, payer cents, and stable payment-to-payer IDs', () => {
  const canonicalRequest = functionBody(migration, 'create or replace function private.canonical_financial_request_v1(');
  const canonicalPayment = functionBody(migration, 'create or replace function private.canonical_financial_payment_v1(');
  const payerCanonical = functionBody(migration, 'create or replace function private.canonical_financial_split_payer_v1(');
  assert.match(canonicalRequest, /v_split_intent in \('equal_payment', 'custom_payment'\)/u);
  assert.match(canonicalRequest, /v_split_child_count <> 1/u);
  assert.match(canonicalRequest, /'split_intent', v_split_intent/u);
  assert.match(canonicalRequest, /'split_payers'/u);
  assert.match(payerCanonical, /'payer_id'/u);
  assert.match(payerCanonical, /'amount'/u);
  assert.match(payerCanonical, /'payment_method'/u);
  assert.match(canonicalPayment, /'split_payer_id'/u);
  assert.match(canonicalPayment, /p_payment->'metadata'/u);
});

test('one-sale monetary executor validates payer tenders and reuses atomic sale plus table-close effects', () => {
  const executor = functionBody(migration, 'create or replace function private.execute_split_sale_financial_v1(');
  assert.match(executor, /language plpgsql\s+security definer\s+set search_path = ''/u);
  assert.match(executor, /v_child_count <> 1/u);
  assert.match(executor, /FINANCIAL_SPLIT_EQUAL_DISTRIBUTION_INVALID/u);
  assert.match(executor, /FINANCIAL_SPLIT_PAYER_PAYMENT_MISMATCH/u);
  assert.match(executor, /FINANCIAL_SPLIT_PAYER_TOTAL_MISMATCH/u);
  assert.match(executor, /v_payment->'metadata'->>'splitPayerId'/u);
  assert.match(executor, /public\.pos_create_cloud_sale_cashier_unlimited\(/u);
  assert.match(executor, /public\.pos_create_cloud_sale_cashier_inventory_unlimited\(/u);
  assert.match(executor, /public\.pos_create_cloud_sale_credit_unlimited\(/u);
  assert.match(executor, /public\.pos_close_restaurant_order_after_checkout_unlimited\(/u);
  assert.match(executor, /'splitPayers', case when v_split_intent/u);
});
