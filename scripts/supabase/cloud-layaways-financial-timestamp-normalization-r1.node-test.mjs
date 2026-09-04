import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { canonicalFinancialRequestV1 } from '../../src/services/financial/financialCanonicalV1.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (relativePath) => readFileSync(join(repoRoot, relativePath), 'utf8').replace(/\r\n/gu, '\n');

const migrationName = '20260904161407_cloud_layaways_financial_timestamp_normalization_r1.sql';
const migration = read(`supabase/migrations/${migrationName}`);
const r2Migration = read('supabase/migrations/20260903180000_cloud_layaways_financial_response_serialization_hardening_r2.sql');
const serverMigration = read('supabase/migrations/20260902010950_cloud_layaways_server_contract_r1.sql');
const canonicalSource = read('src/services/financial/financialCanonicalV1.js');
const posLayawayModal = read('src/components/pos/LayawayModal.jsx');
const customerLayawayModal = read('src/components/customers/LayawayModal.jsx');

const functionBody = (source, marker, terminator = '$function$;') => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing function: ${marker}`);
  const end = source.indexOf(terminator, start);
  assert.ok(end > start, `incomplete function: ${marker}`);
  return source.slice(start, end + terminator.length);
};

const layawayRequest = (deadline, extraLayaway = {}) => ({
  layaway: {
    id: 'layaway-test-1',
    customer_id: 'customer-test-1',
    total_amount: '100.00',
    deadline,
    items: [],
    ...extraLayaway
  },
  initial_payment: null
});

test('normalization migration is forward-only, ordered after R2, and changes only the domain-date helper', () => {
  assert.ok(Number(migrationName.slice(0, 14)) > 20260903180000);
  assert.equal((migration.match(/^begin;$/gmu) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gmu) || []).length, 1);
  assert.doesNotMatch(migration, /\b(drop|truncate)\b/iu);
  assert.doesNotMatch(migration, /\bto_timestamp\s*\(/iu);
  assert.doesNotMatch(migration, /execute_sql|apply_migration|migration repair|--include-all|\bdb\s+(push|pull)\b/iu);
  assert.match(migration, /create or replace function private\.layaway_deadline_v1\(p_value jsonb\)/u);

  const deadline = functionBody(migration, 'create or replace function private.layaway_deadline_v1(');
  assert.match(deadline, /language plpgsql/u);
  assert.match(deadline, /immutable/u);
  assert.match(deadline, /set search_path = ''/u);
  assert.match(deadline, /if v_raw ~ '\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$'/u);
  assert.doesNotMatch(deadline, /if v_raw ~ '\^\\\\d/u);
  assert.match(deadline, /private\.financial_timestamp_v1\(to_jsonb\(v_raw \|\| 'T00:00:00\.000000Z'\)\)/u);
  assert.match(deadline, /return private\.financial_timestamp_v1\(to_jsonb\(v_raw\)\)/u);
  assert.match(serverMigration, /deadline timestamptz not null/u);

  // The existing ACL is owned by the historical migration and is intentionally
  // not recreated or weakened by this CREATE OR REPLACE.
  assert.match(serverMigration, /revoke all on function private\.layaway_deadline_v1\(jsonb\) from public, anon, authenticated;/u);
});

test('date-only deadlines and full timestamps use separate semantics', () => {
  const dateOnly = canonicalFinancialRequestV1('layaway.create', layawayRequest('2026-09-04'));
  assert.equal(dateOnly.layaway.deadline, '2026-09-04T00:00:00.000000Z');

  const fullTimestamp = canonicalFinancialRequestV1(
    'layaway.create',
    layawayRequest('2026-09-04T10:20:30.123456789-06:00')
  );
  assert.equal(fullTimestamp.layaway.deadline, '2026-09-04T16:20:30.123456Z');
  assert.match(canonicalSource, /const DATE_ONLY_PATTERN = \/\^/u);
  assert.match(canonicalSource, /deadline: layawayDeadline\(layaway\)/u);
  assert.doesNotMatch(canonicalSource, /deadline:\s*timestamp\(/u);
});

test('impossible, incomplete, null, and malformed dates fail before a financial request can be prepared', () => {
  for (const invalid of [
    '2026-2-4',
    '2026-02-30',
    '2026-13-01',
    '',
    null,
    'arbitrary text',
    '2026-09-04T00:00:00',
    '2026-09-04T25:00:00.000000Z',
    '2026-09-04T00:00:00.000000+24:00'
  ]) {
    assert.throws(
      () => canonicalFinancialRequestV1('layaway.create', layawayRequest(invalid)),
      /LAYAWAY_DEADLINE_REQUIRED|FINANCIAL_TIMESTAMP_INVALID/u,
      `invalid deadline was accepted: ${String(invalid)}`
    );
  }
});

test('client-supplied past/future operation timestamps do not replace the server creation timestamp', () => {
  const canonical = canonicalFinancialRequestV1(
    'layaway.create',
    layawayRequest('2026-09-04', {
      created_at: '2000-01-01T00:00:00.000000Z',
      timestamp: '2999-12-31T23:59:59.999999Z'
    })
  );
  assert.equal(canonical.layaway.created_at, undefined);
  assert.equal(canonical.layaway.timestamp, undefined);

  const create = functionBody(
    r2Migration,
    'create or replace function private.execute_layaway_create_financial_v1('
  );
  assert.ok(
    create.indexOf('LAYAWAY_DEADLINE_INVALID') < create.indexOf('insert into public.pos_layaways'),
    'deadline validation must precede the layaway insert'
  );
  assert.match(create, /created_at, updated_at, server_version, last_idempotency_key, metadata[\s\S]*now\(\), now\(\), 1/u);
});

test('invalid deadline validation precedes every financial side effect and R2 projections remain allowlisted', () => {
  const create = functionBody(
    r2Migration,
    'create or replace function private.execute_layaway_create_financial_v1('
  );
  const deadlineValidation = create.indexOf('LAYAWAY_DEADLINE_INVALID');
  const layawayInsert = create.indexOf('insert into public.pos_layaways');
  const reservationCall = create.indexOf('private.reserve_layaway_stock_v1(');
  const cashInsert = create.indexOf('insert into public.pos_cash_movements');
  assert.ok(deadlineValidation >= 0 && layawayInsert > deadlineValidation);
  assert.ok(reservationCall > layawayInsert);
  assert.ok(cashInsert > reservationCall);

  assert.match(r2Migration, /private\.financial_layaway_response_allowlist_v2/u);
  assert.match(r2Migration, /private\.public_financial_response_v1/u);
  assert.equal((migration.match(/\bto_jsonb\s*\(/gu) || []).length, 2);
  assert.doesNotMatch(migration, /\brow_to_json\s*\(/u);
});

test('date-picker default is formatted in the local calendar instead of UTC', () => {
  assert.match(posLayawayModal, /const formatLocalDateInputValue = \(date\) =>/u);
  assert.match(posLayawayModal, /setDeadline\(formatLocalDateInputValue\(date\)\)/u);
  assert.doesNotMatch(posLayawayModal, /date\.toISOString\(\)\.split\('T'\)\[0\]/u);
  assert.match(customerLayawayModal, /const getCalendarDateParts = \(value\) =>/u);
  assert.match(customerLayawayModal, /formatCalendarDate\(layaway\.deadline\)/u);
  assert.doesNotMatch(customerLayawayModal, /new Date\(layaway\.deadline\)/u);
});
