import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../../supabase/migrations/20260924051208_license_free_owner_device_takeover_r1.sql', import.meta.url),
  'utf8'
);
const sqlMatrix = readFileSync(
  new URL('../../../supabase/tests/license_free_owner_device_takeover_r1_test.sql', import.meta.url),
  'utf8'
);

const functionBody = (qualifiedName) => {
  const start = migration.indexOf(`create or replace function ${qualifiedName}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$function$;', start);
  expect(end).toBeGreaterThan(start);
  return migration.slice(start, end + '$function$;'.length);
};

describe('Free owner device takeover contract', () => {
  it('keeps login non-destructive and only offers recovery after owner authentication', () => {
    const login = functionBody('public.admin_login_on_device');
    const credentialCheck = login.indexOf("extensions.crypt(coalesce(p_password, ''), v_admin.password_hash)");
    const takeoverOffer = login.indexOf("'FREE_DEVICE_TAKEOVER_REQUIRED'");
    const deviceLimit = login.indexOf("'DEVICE_LIMIT_REACHED'");

    expect(login).toContain('u.is_owner is true');
    expect(login).toContain('u.is_active is true');
    expect(credentialCheck).toBeGreaterThan(0);
    expect(takeoverOffer).toBeGreaterThan(credentialCheck);
    expect(login).toContain("lower(coalesce(v_license.plan_code, '')) = 'free_trial'");
    expect(login).toContain('v_license.max_devices = 1');
    expect(login).toContain("e.event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER'");
    expect(deviceLimit).toBeGreaterThan(takeoverOffer);
    expect(login).not.toContain('update public.license_devices d\n    set is_active = false');
  });

  it('revalidates and serializes takeover server-side before changing device state', () => {
    const takeover = functionBody('public.admin_takeover_free_device');
    const licenseLock = takeover.indexOf('for update of l;');
    const passwordCheck = takeover.indexOf("extensions.crypt(coalesce(p_password, ''), v_admin.password_hash)");
    const evidence = takeover.indexOf('private.resolve_free_device_takeover_evidence_v1(p_license_key)');
    const displacement = takeover.indexOf('update public.license_devices d');

    expect(licenseLock).toBeGreaterThan(0);
    expect(passwordCheck).toBeGreaterThan(licenseLock);
    expect(evidence).toBeGreaterThan(passwordCheck);
    expect(displacement).toBeGreaterThan(evidence);
    expect(takeover).toContain("lower(coalesce(v_license.plan_code, '')) <> 'free_trial'");
    expect(takeover).toContain('v_license.max_devices <> 1');
    expect(takeover).toContain('u.is_owner is true');
    expect(takeover).toContain('u.is_active is true');
    expect(takeover).toContain("'FREE_DEVICE_TAKEOVER_NOT_ALLOWED'");
  });

  it('consumes one canonical downgrade event and makes winner retry idempotent', () => {
    const evidence = functionBody('private.resolve_free_device_takeover_evidence_v1');
    const takeover = functionBody('public.admin_takeover_free_device');

    expect(evidence).toContain("e.metadata->>'source' = 'enforce_license_plan_limits_after_change'");
    expect(evidence).toContain("e.metadata->>'reason' = 'PLAN_LIMITS_ENFORCED'");
    expect(evidence).toContain("e.metadata->>'plan' = 'free_trial'");
    expect(evidence).toContain("e.metadata->>'max_devices' = '1'");
    expect(evidence).toContain("e.metadata->>'over_limit_devices_blocked'");

    expect(takeover).toContain('v_recovery_consumed');
    expect(takeover).toContain('v_is_retry_winner');
    expect(takeover).toContain("'downgrade_event_id'");
    expect(takeover).toContain("'FREE_PRIMARY_DEVICE_TAKEOVER'");
    expect(takeover).toContain("'idempotent_retry', v_is_retry_winner");
  });

  it('revokes displaced sessions and stale device tokens, then creates one fresh Admin session', () => {
    const takeover = functionBody('public.admin_takeover_free_device');

    expect(takeover).toContain('security_token = null');
    expect(takeover).toContain('previous_security_token = null');
    expect(takeover).toContain('update public.license_admin_sessions');
    expect(takeover).toContain('update public.license_staff_sessions');
    expect(takeover).toContain("'revoked_reason', 'FREE_PRIMARY_DEVICE_TAKEOVER'");
    expect(takeover).toContain('private.create_admin_session(');
    expect(takeover).toContain('if v_active_count <> 1 then');
    expect(takeover).toContain('FREE_DEVICE_TAKEOVER_INVARIANT_ACTIVE_DEVICE_COUNT');
  });

  it('shares the existing Admin login rate-limit buckets instead of adding a cheaper password oracle', () => {
    const login = functionBody('public.admin_login_on_device');
    const takeover = functionBody('public.admin_takeover_free_device');

    for (const marker of [
      "'admin-user:'",
      "'admin-license-global'",
      "'admin-device:'",
      "'admin_login_on_device'",
      "'ADMIN_AUTH'",
      '10, 600, 900',
      '50, 900, 1800'
    ]) {
      expect(login).toContain(marker);
      expect(takeover).toContain(marker);
    }
  });

  it('does not contain financial mutations and versions the full A-J SQL matrix', () => {
    expect(migration).not.toMatch(/(?:update|insert\s+into|delete\s+from)\s+public\.pos_cash_sessions/iu);
    expect(migration).not.toContain('closed_at');
    expect(migration).not.toContain('counted_cash');
    expect(migration).not.toContain('cloud_cash_sync');

    for (const marker of [
      'Case A', 'Case B', 'Case C', 'Case D', 'Case E',
      'Case F', 'Case G', 'Case H', 'Case I', 'Case J'
    ]) {
      expect(sqlMatrix).toContain(marker);
    }

    expect(sqlMatrix).toMatch(/begin;/iu);
    expect(sqlMatrix).toMatch(/rollback;/iu);
    expect(sqlMatrix).toContain('public.verify_admin_session');
    expect(sqlMatrix).toContain('v_cash_after is distinct from v_cash_before');
    expect(sqlMatrix).toContain('FREE_DEVICE_TAKEOVER_REQUIRED');
    expect(sqlMatrix).toContain('DEVICE_LIMIT_REACHED');
    expect(sqlMatrix).toContain('FREE_DEVICE_TAKEOVER_NOT_ALLOWED');
  });
});
