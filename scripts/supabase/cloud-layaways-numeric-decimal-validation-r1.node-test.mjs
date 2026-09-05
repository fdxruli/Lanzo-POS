import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { canonicalFinancialRequestV1 } from '../../src/services/financial/financialCanonicalV1.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');

const migrationName = '20260905053610_cloud_layaways_numeric_decimal_validation_r1.sql';
const migration = read(`supabase/migrations/${migrationName}`);
const canonicalMigration = read('supabase/migrations/20260905020312_cloud_layaways_financial_request_canonicalization_r1.sql');
const numericBody = migration.slice(
  migration.indexOf('create or replace function private.layaway_request_numeric_v1('),
  migration.indexOf('$function$;', migration.indexOf('create or replace function private.layaway_request_numeric_v1(')) + '$function$;'.length
);

const numericPattern = /^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)$/u;

test('numeric decimal migration is forward-only and replaces only the historical helper', () => {
  assert.ok(Number(migrationName.slice(0, 14)) > 20260905020312);
  assert.equal((migration.match(/create or replace function/giu) || []).length, 1);
  assert.match(migration, /create or replace function private\.layaway_request_numeric_v1\(/u);
  assert.doesNotMatch(migration, /\b(drop|truncate|insert|update|delete|alter\s+table)\b/iu);
  assert.doesNotMatch(migration, /execute\s+immediate|format\s*\(/iu);
  assert.doesNotMatch(migration, /VITE_ENABLE_CLOUD_LAYAWAYS|cloud_layaways\s*[:=]/iu);
});

test('numeric helper preserves signature, defaults, error contract, and hardened search path', () => {
  assert.ok(numericBody.includes('p_payload jsonb,\n  p_keys text[],\n  p_default numeric default null'));
  assert.match(numericBody, /returns numeric/u);
  assert.match(numericBody, /language plpgsql/u);
  assert.match(numericBody, /immutable/u);
  assert.match(numericBody, /set search_path = ''/u);
  assert.match(numericBody, /if jsonb_typeof\(p_payload\) <> 'object' then\s+return p_default/u);
  assert.match(numericBody, /v_value := nullif\(btrim\(coalesce\(p_payload->>v_key, ''\)\), ''\)/u);
  assert.ok(numericBody.includes("v_value !~ '^[+-]?([0-9]+([.][0-9]+)?|[.][0-9]+)$'"));
  assert.doesNotMatch(numericBody, /\\\\\./u);
  assert.match(numericBody, /raise exception 'LAYAWAY_NUMERIC_INVALID:%', v_key using errcode = 'P0001'/u);
  assert.match(numericBody, /return v_value::numeric/u);
});

test('SQL numeric contract accepts required decimals and rejects malformed spellings', () => {
  for (const value of ['20', '20.00', '1750.50', '0.50', '+20', '-20', '-0.50', '.50']) {
    assert.match(value, numericPattern, `valid numeric spelling rejected by contract: ${value}`);
  }
  for (const value of ['', 'abc', '20..00', '1,000', '$20', 'NaN', 'Infinity', 'not-a-timestamp']) {
    assert.doesNotMatch(value, numericPattern, `invalid numeric spelling accepted by contract: ${value}`);
  }
});

test('frontend and server request contracts preserve totalAmount aliases and decimal normalization', () => {
  assert.match(canonicalMigration, /array\['total_amount','totalAmount','total'\]/u);
  assert.match(read('src/hooks/pos/useLayawayFlow.js'), /totalAmount: total/u);

  for (const [field, value, expected] of [
    ['total_amount', '20.00', '20'],
    ['totalAmount', '1750.50', '1750.5'],
    ['total', '0.50', '0.5']
  ]) {
    const canonical = canonicalFinancialRequestV1('layaway.create', {
      layaway: { id: `numeric-${field}`, [field]: value, deadline: '2026-09-05', items: [] },
      initial_payment: null
    });
    assert.equal(canonical.layaway.total_amount, expected);
  }

  const nullTotal = canonicalFinancialRequestV1('layaway.create', {
    layaway: { id: 'numeric-null', totalAmount: null, deadline: '2026-09-05', items: [] },
    initial_payment: null
  });
  assert.equal(nullTotal.layaway.total_amount, undefined);
});
