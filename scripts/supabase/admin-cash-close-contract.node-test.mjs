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
  '20260824085526_fix_shared_terminal_admin_cash_close_actor_key.sql'
);
const authoritativeBodyPath = join(
  repoRoot,
  'supabase',
  'migrations',
  '20260814133721_cash_admin_close_recalc_guard.sql'
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const authoritativeBodySql = readFileSync(authoritativeBodyPath, 'utf8');

const functionMarker = 'create or replace function public.pos_admin_close_cash_session_unlimited(';

function requireFragment(source, fragment, message) {
  assert.ok(source.includes(fragment), message);
}

function extractUnlimitedFunction(source) {
  const start = source.indexOf(functionMarker);
  assert.notEqual(start, -1, 'the authoritative unlimited Admin close function must be replaced');
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, 'the unlimited Admin close function body must be complete');
  return source.slice(start, end + '\n$$;'.length);
}

export function validateAdminCashCloseMigration(source) {
  assert.equal(
    source.split(functionMarker).length - 1,
    1,
    'the forward repair must install exactly one authoritative unlimited function definition'
  );

  const functionSql = extractUnlimitedFunction(source);
  const declareStart = functionSql.indexOf('\ndeclare\n');
  const executableBegin = functionSql.indexOf('\nbegin\n', declareStart);
  assert.ok(declareStart >= 0 && executableBegin > declareStart, 'PL/pgSQL declaration block is required');
  const declarations = functionSql.slice(declareStart, executableBegin);

  assert.match(declarations, /\bv_actor_key\s+text\s*;/u, 'v_actor_key must be declared before use');
  assert.equal(
    [...functionSql.matchAll(/v_actor_key\s*:=\s*private\.resolve_cash_actor_key\(v_context\)\s*;/gu)].length,
    1,
    'v_actor_key must be resolved exactly once from the validated context'
  );

  const contextValidation = functionSql.indexOf('v_context := private.validate_pos_sync_context(');
  const cloudCashValidation = functionSql.indexOf('perform private.assert_cloud_cash_sync_enabled(v_context);');
  const adminResolution = functionSql.indexOf('v_admin_auth := private.require_active_admin_session(');
  const adminSuccessGuard = functionSql.indexOf("if coalesce((v_admin_auth->>'success')::boolean, false) is not true then", adminResolution);
  const adminGuardEnd = functionSql.indexOf('end if;', adminSuccessGuard);
  const actorResolution = functionSql.indexOf('v_actor_key := private.resolve_cash_actor_key(v_context);');
  assert.ok(
    contextValidation >= 0
      && cloudCashValidation > contextValidation
      && adminResolution > cloudCashValidation
      && adminSuccessGuard > adminResolution
      && adminGuardEnd > adminSuccessGuard
      && actorResolution > adminGuardEnd,
    'actor provenance must be resolved only after sync/cloud-cash validation and successful Admin authorization'
  );
  requireFragment(functionSql, "coalesce(v_admin_auth->>'code', 'ADMIN_SESSION_REQUIRED')", 'Admin authorization must fail closed');

  const expectedVersionGuard = functionSql.indexOf('if p_expected_version is null or p_expected_version <> v_session.server_version then');
  const versionConflict = functionSql.indexOf("'code', 'VERSION_CONFLICT'", expectedVersionGuard);
  const recalculate = functionSql.indexOf('v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);');
  const recalculationGuard = functionSql.indexOf('if v_session.expected_cash_total is distinct from v_expected_before', recalculate);
  const totalsChanged = functionSql.indexOf("'code', 'CASH_TOTALS_CHANGED'", recalculationGuard);
  const closingUpdate = functionSql.indexOf("update public.pos_cash_sessions\n  set status = 'closed'");
  assert.ok(
    expectedVersionGuard >= 0
      && versionConflict > expectedVersionGuard
      && recalculate > versionConflict
      && recalculationGuard > recalculate
      && totalsChanged > recalculationGuard
      && closingUpdate > totalsChanged,
    'expected-version and CASH_TOTALS_CHANGED guards must run before closure'
  );
  for (const snapshot of [
    'v_expected_before := v_session.expected_cash_total;',
    'v_entries_before := v_session.cash_entries_total;',
    'v_exits_before := v_session.cash_exits_total;'
  ]) {
    requireFragment(functionSql, snapshot, `recalculation snapshot is required: ${snapshot}`);
  }

  const closingUpdateEnd = functionSql.indexOf('returning * into v_session;', closingUpdate);
  assert.ok(closingUpdateEnd > closingUpdate, 'cash-session closure update must return the updated session');
  const closingAssignments = functionSql.slice(closingUpdate, closingUpdateEnd);
  requireFragment(closingAssignments, 'closed_by_actor_key = v_actor_key,', 'the current Admin actor must be recorded separately');
  assert.doesNotMatch(
    closingAssignments,
    /^\s*(?:set\s+)?actor_key\s*=\s*v_actor_key\b/mu,
    'administrative close must never rewrite the historical session owner actor_key'
  );
  requireFragment(
    functionSql,
    "jsonb_build_object('cash_session_id', v_session.id, 'actor_key', v_session.actor_key",
    'sync events must continue to report the historical session owner'
  );

  for (const required of [
    'security definer',
    "set search_path = ''",
    "v_mode not in ('admin_audited', 'admin_unverified')",
    "v_reason not in ('historical_test', 'device_replaced', 'device_lost', 'abandoned_session', 'operational_error', 'other')",
    'ADMIN_CLOSE_COMMENT_REQUIRED',
    'ADMIN_CLOSE_COUNTED_AMOUNT_REQUIRED',
    'ADMIN_CLOSE_UNVERIFIED_COUNTED_FORBIDDEN',
    'NEXT_SHIFT_FUND_EXCEEDS_COUNTED',
    "private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'cash.admin_close'",
    "v_idem.status = 'completed' and v_idem.response_payload is not null",
    'private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response)',
    'insert into public.pos_cash_audit_events',
    'private.record_pos_sync_event(',
    'closed_by_device_id = v_device_id',
    'closed_by_admin_user_id = v_admin_user_id',
    'server_version = server_version + 1',
    'last_idempotency_key = p_idempotency_key'
  ]) {
    requireFragment(functionSql, required, `authoritative Admin close contract is missing: ${required}`);
  }

  assert.doesNotMatch(
    source,
    /create or replace function public\.pos_admin_close_cash_session\s*\(/iu,
    'the forward repair must not replace or bypass the existing rate-limited wrapper'
  );
  requireFragment(
    source,
    'revoke all on function public.pos_admin_close_cash_session_unlimited(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) from public, anon, authenticated;',
    'direct unlimited execution must remain revoked'
  );
  requireFragment(
    source,
    'grant execute on function public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text) to anon, authenticated;',
    'the existing rate-limited wrapper must remain the granted client entry point'
  );
}

test('forward migration restores Admin actor provenance without changing cash ownership', () => {
  assert.doesNotThrow(() => validateAdminCashCloseMigration(migrationSql));
});

test('repair preserves the latest complete recalculation-guarded function body exactly', () => {
  const repairedFunction = extractUnlimitedFunction(migrationSql);
  const authoritativeFunction = extractUnlimitedFunction(authoritativeBodySql);
  const repairWithoutActorProvenance = repairedFunction
    .replace('  v_actor_key text;\n', '')
    .replace(
      '  -- Resolve performed-by provenance only after both the sync context and the\n'
        + '  -- active Admin session have been validated. This is distinct from the\n'
        + '  -- historical owner stored in v_session.actor_key.\n'
        + '  v_actor_key := private.resolve_cash_actor_key(v_context);\n',
      ''
    )
    .replace('      closed_by_actor_key = v_actor_key,\n', '');
  assert.equal(
    repairWithoutActorProvenance.replace(/\r\n/gu, '\n'),
    authoritativeFunction.replace(/\r\n/gu, '\n')
  );
});

test('contract rejects the historical unresolved actor-variable shape', () => {
  const broken = migrationSql
    .replace('  v_actor_key text;\n', '')
    .replace('  v_actor_key := private.resolve_cash_actor_key(v_context);\n', '');
  assert.throws(() => validateAdminCashCloseMigration(broken), /v_actor_key must be declared/u);
});

test('contract rejects actor resolution before successful Admin authorization', () => {
  const actorLine = '  v_actor_key := private.resolve_cash_actor_key(v_context);\n';
  const broken = migrationSql
    .replace(actorLine, '')
    .replace(
      '  v_admin_auth := private.require_active_admin_session(',
      `${actorLine}  v_admin_auth := private.require_active_admin_session(`
    );
  assert.throws(() => validateAdminCashCloseMigration(broken), /only after sync\/cloud-cash validation and successful Admin authorization/u);
});

test('contract rejects removal of active Admin session authorization', () => {
  const broken = migrationSql.replace(
    'v_admin_auth := private.require_active_admin_session(',
    'v_admin_auth := private.unverified_admin_context('
  );
  assert.throws(() => validateAdminCashCloseMigration(broken), /successful Admin authorization/u);
});

test('contract rejects removal of the expected-version guard', () => {
  const broken = migrationSql.replace(
    'if p_expected_version is null or p_expected_version <> v_session.server_version then',
    'if false then'
  );
  assert.throws(() => validateAdminCashCloseMigration(broken), /expected-version and CASH_TOTALS_CHANGED guards/u);
});

test('contract rejects removal of recalculation and CASH_TOTALS_CHANGED guards', () => {
  const noRecalculation = migrationSql.replace(
    'v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);',
    'v_session := v_session;'
  );
  assert.throws(() => validateAdminCashCloseMigration(noRecalculation), /expected-version and CASH_TOTALS_CHANGED guards/u);

  const noTotalsGuard = migrationSql.replace("'code', 'CASH_TOTALS_CHANGED'", "'code', 'UNGUARDED_CLOSE'");
  assert.throws(() => validateAdminCashCloseMigration(noTotalsGuard), /expected-version and CASH_TOTALS_CHANGED guards/u);
});

test('contract rejects administrative ownership rewrites', () => {
  const broken = migrationSql.replace('closed_by_actor_key = v_actor_key,', 'actor_key = v_actor_key,');
  assert.throws(() => validateAdminCashCloseMigration(broken), /current Admin actor|historical session owner/u);
});
