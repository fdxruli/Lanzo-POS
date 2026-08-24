import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260824101231_allow_terminal_admin_cash_close_refresh_results.sql'
);
const historicalReceiptPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260820165842_shared_terminal_financial_receipt_contract.sql'
);
const rollbackTestPath = join(
  repoRoot,
  'supabase',
  'tests',
  'admin_cash_close_financial_terminal_test.sql'
);

const migrationSql = readFileSync(migrationPath, 'utf8');
const historicalReceiptSql = readFileSync(historicalReceiptPath, 'utf8');
const rollbackTestSql = readFileSync(rollbackTestPath, 'utf8');
const functionMarker = 'create or replace function private.assert_financial_legacy_result_terminal_v1(';
const allowlistBlock = `    if p_response->'success' = 'false'::jsonb
       and p_operation_type = 'cash.admin_close'
       and v_code in ('VERSION_CONFLICT', 'CASH_TOTALS_CHANGED') then
      return;
    end if;
`;

function normalizeNewlines(value) {
  return value.replace(/\r\n/gu, '\n');
}

function extractFunction(source, marker) {
  const normalized = normalizeNewlines(source);
  const start = normalized.indexOf(marker);
  assert.notEqual(start, -1, `missing function marker: ${marker}`);
  const end = normalized.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `incomplete function body: ${marker}`);
  return normalized.slice(start, end + '\n$$;'.length);
}

export function validateAdminCloseFinancialTerminalMigration(source) {
  const normalized = normalizeNewlines(source);
  assert.equal(
    normalized.split(functionMarker).length - 1,
    1,
    'the forward migration must replace exactly one private terminal assertion'
  );
  const functionSql = extractFunction(normalized, functionMarker);

  for (const required of [
    'returns void',
    'language plpgsql',
    'immutable',
    "set search_path = ''",
    "if jsonb_typeof(p_response) <> 'object' then",
    "raise exception 'FINANCIAL_LEGACY_RESPONSE_INVALID'",
    "v_code := nullif(btrim(p_response->>'code'), '');",
    "if v_code = 'IDEMPOTENCY_PROCESSING' then",
    "raise exception 'FINANCIAL_LEGACY_RESPONSE_NONTERMINAL'",
    "if (p_response->>'success')::boolean is not true then",
    allowlistBlock,
    "raise exception 'FINANCIAL_LEGACY_OPERATION_REJECTED:%', coalesce(v_code, 'SUCCESS_FALSE')"
  ]) {
    assert.ok(functionSql.includes(required), `terminal assertion contract missing: ${required}`);
  }

  const nonterminalGuard = functionSql.indexOf("if v_code = 'IDEMPOTENCY_PROCESSING' then");
  const falseGuard = functionSql.indexOf("if (p_response->>'success')::boolean is not true then");
  const allowlist = functionSql.indexOf(allowlistBlock);
  const rejection = functionSql.indexOf("raise exception 'FINANCIAL_LEGACY_OPERATION_REJECTED:%'", allowlist);
  assert.ok(
    nonterminalGuard >= 0 && falseGuard > nonterminalGuard && allowlist > falseGuard && rejection > allowlist,
    'nonterminal rejection, exact allowlist, and arbitrary failure rejection must remain ordered'
  );
  assert.equal(
    [...functionSql.matchAll(/v_code\s+in\s*\(([^)]*)\)/gu)].length,
    1,
    'only one terminal failure-code allowlist is permitted'
  );

  for (const forbiddenReplacement of [
    'public.pos_execute_financial_operation_v1(',
    'public.pos_get_financial_operation_receipt(',
    'private.reserve_financial_operation_v1(',
    'private.complete_financial_operation_v1(',
    'private.canonical_financial_request_v1(',
    'private.assert_financial_operation_origin_v1('
  ]) {
    assert.ok(
      !normalized.includes(`create or replace function ${forbiddenReplacement}`),
      `narrow compatibility migration must not replace ${forbiddenReplacement}`
    );
  }
  assert.doesNotMatch(normalized, /\b(?:alter|create)\s+table\b/iu, 'compatibility migration must not change tables');
  assert.doesNotMatch(normalized, /^\s*(?:insert|update|delete)\s+/imu, 'compatibility migration must not mutate data');
  assert.ok(
    normalized.includes(
      'revoke all on function private.assert_financial_legacy_result_terminal_v1(text, jsonb) from public, anon, authenticated;'
    ),
    'private helper execution must remain revoked from API roles'
  );
  assert.doesNotMatch(normalized, /\bgrant\s+execute\b/iu, 'compatibility migration must not broaden execution grants');

  const repairedWithoutAllowlist = functionSql.replace(allowlistBlock, '');
  const authoritativeFunction = extractFunction(historicalReceiptSql, functionMarker);
  assert.equal(
    repairedWithoutAllowlist,
    authoritativeFunction,
    'the original fail-closed helper must be preserved exactly outside the narrow allowlist'
  );

  const executor = extractFunction(
    historicalReceiptSql,
    'create or replace function public.pos_execute_financial_operation_v1('
  );
  const reserve = executor.indexOf('v_operation := private.reserve_financial_operation_v1(');
  const completedReplay = executor.indexOf("if v_operation.status = 'completed' then return v_operation.response_payload; end if;");
  const adminDispatch = executor.indexOf("when 'cash.admin_close' then");
  const publicResponse = executor.indexOf('v_response := private.public_financial_response_v1(');
  const completion = executor.indexOf('perform private.complete_financial_operation_v1(');
  assert.ok(
    reserve >= 0
      && completedReplay > reserve
      && adminDispatch > completedReplay
      && publicResponse > adminDispatch
      && completion > publicResponse,
    'existing executor must retain K/H reservation, replay-before-dispatch, sanitization, and durable completion order'
  );
}

export function validateRollbackContract(source) {
  const normalized = normalizeNewlines(source);
  assert.match(normalized, /^begin;/mu, 'rollback test must begin a transaction');
  assert.match(normalized, /rollback;\s*$/u, 'rollback test must roll back every fixture');
  assert.doesNotMatch(normalized, /^\s*commit\s*;/imu, 'rollback test must never commit');
  assert.ok(
    (normalized.match(/public\.pos_execute_financial_operation_v1\(/gu) ?? []).length >= 6,
    'rollback test must exercise first dispatch and exact replay through the public executor'
  );
  for (const marker of [
    'ADMIN_CLOSE_ARBITRARY_SUCCESS_FALSE_ACCEPTED',
    'OWNER_CLOSE_VERSION_CONFLICT_ALLOWLISTED',
    'ADMIN_CLOSE_MISSING_SUCCESS_ALLOWLISTED',
    'ADMIN_CLOSE_TOTALS_CHANGED_NOT_DURABLE',
    'ADMIN_CLOSE_TOTALS_CHANGED_SESSION_STATE_INVALID',
    'ADMIN_CLOSE_TOTALS_CHANGED_EMITTED_CLOSE_EFFECT',
    'ADMIN_CLOSE_TOTALS_CHANGED_FINANCIAL_RECEIPT_MISSING',
    'ADMIN_CLOSE_TOTALS_CHANGED_RECEIPT_MISMATCH',
    'ADMIN_CLOSE_TOTALS_CHANGED_REPLAY_MISMATCH',
    'ADMIN_CLOSE_VERSION_CONFLICT_NOT_DURABLE',
    'ADMIN_CLOSE_VERSION_CONFLICT_RECEIPT_MISMATCH',
    'ADMIN_CLOSE_VERSION_CONFLICT_REPLAY_MISMATCH',
    'ADMIN_CLOSE_VERSION_CONFLICT_CHANGED_SESSION',
    'ADMIN_CLOSE_REFRESHED_SUCCESS_FAILED',
    'ADMIN_CLOSE_REFRESHED_K_H_NOT_NEW',
    'ADMIN_CLOSE_REFRESHED_SUCCESS_PROVENANCE_INVALID',
    'ADMIN_CLOSE_REFRESHED_REPLAY_DUPLICATED_AUDIT',
    'ADMIN_CLOSE_REFRESHED_REPLAY_DUPLICATED_SYNC',
    "s.actor_key = v_owner_actor_key",
    "s.closed_by_actor_key = v_admin_actor_key",
    "a.event_type in ('ADMIN_CLOSED_AUDITED', 'ADMIN_CLOSED_UNVERIFIED')",
    "e.operation = 'close'",
    'public.pos_get_financial_operation_receipt('
  ]) {
    assert.ok(normalized.includes(marker), `rollback SQL assertion missing: ${marker}`);
  }
}

test('migration narrowly allows only terminal Admin close refresh responses', () => {
  assert.doesNotThrow(() => validateAdminCloseFinancialTerminalMigration(migrationSql));
});

test('contract rejects allowlisting VERSION_CONFLICT for every operation', () => {
  const broken = migrationSql.replace("       and p_operation_type = 'cash.admin_close'\n", '');
  assert.throws(
    () => validateAdminCloseFinancialTerminalMigration(broken),
    /terminal assertion contract missing|original fail-closed helper/u
  );
});

test('contract rejects broadening the terminal failure-code allowlist', () => {
  const broken = migrationSql.replace(
    "v_code in ('VERSION_CONFLICT', 'CASH_TOTALS_CHANGED')",
    "v_code in ('VERSION_CONFLICT', 'CASH_TOTALS_CHANGED', 'CASH_SESSION_NOT_OPEN')"
  );
  assert.throws(
    () => validateAdminCloseFinancialTerminalMigration(broken),
    /terminal assertion contract missing|original fail-closed helper/u
  );
});

test('contract rejects treating a missing success flag as terminal', () => {
  const broken = migrationSql.replace("p_response->'success' = 'false'::jsonb", "p_response->>'success' is null");
  assert.throws(
    () => validateAdminCloseFinancialTerminalMigration(broken),
    /terminal assertion contract missing|original fail-closed helper/u
  );
});

test('contract rejects removal of arbitrary success=false rejection', () => {
  const broken = migrationSql.replace(
    "    raise exception 'FINANCIAL_LEGACY_OPERATION_REJECTED:%', coalesce(v_code, 'SUCCESS_FALSE') using errcode = 'P0001';\n",
    ''
  );
  assert.throws(
    () => validateAdminCloseFinancialTerminalMigration(broken),
    /terminal assertion contract missing|arbitrary failure rejection/u
  );
});

test('rollback SQL covers durable refresh results, exact replay, and one successful close', () => {
  assert.doesNotThrow(() => validateRollbackContract(rollbackTestSql));
});
