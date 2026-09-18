import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const migrationUrl = new URL(
  '../../supabase/migrations/20260918055709_license_grace_runtime_realtime_r1.sql',
  import.meta.url
);
const handoffMigrationUrl = new URL(
  '../../supabase/migrations/20260918061146_license_expiry_verified_handoff_r1.sql',
  import.meta.url
);

const [migration, handoffMigration] = await Promise.all([
  readFile(migrationUrl, 'utf8'),
  readFile(handoffMigrationUrl, 'utf8')
]);

const functionBody = (qualifiedName) => {
  const start = migration.indexOf(`create or replace function ${qualifiedName}`);
  assert.ok(start >= 0, `${qualifiedName} must be versioned`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(end > start, `${qualifiedName} must have a complete body`);
  return migration.slice(start, end + '$function$;'.length);
};

test('POS and license Realtime admission consume canonical effective entitlement', () => {
  const pos = functionBody('private.can_access_pos_realtime_topic');
  const license = functionBody('private.can_access_license_realtime_topic');

  for (const body of [pos, license]) {
    assert.match(body, /license_entitlement_state_v1/u);
    assert.match(body, /entitlement\.is_entitled is true/u);
    assert.match(body, /d\.is_active is true/u);
    assert.match(body, /d\.security_token is not null/u);
    assert.doesNotMatch(body, /l\.expires_at/u);
    assert.doesNotMatch(body, /l\.status/u);
  }

  assert.match(pos, /effective_features->>'cloud_pos_sync'/u);
  assert.match(license, /effective_features->>'realtime_license_sync'/u);
});

test('private helpers stay closed and existing Realtime wrappers/policies are not rewritten', () => {
  assert.match(migration, /revoke all on function private\.can_access_pos_realtime_topic\(text\)[\s\S]+from public, anon, authenticated/iu);
  assert.match(migration, /revoke all on function private\.can_access_license_realtime_topic\(text\)[\s\S]+from public, anon, authenticated/iu);
  assert.doesNotMatch(migration, /create\s+(or\s+replace\s+)?function\s+realtime\./iu);
  assert.doesNotMatch(migration, /create\s+policy/iu);
  assert.doesNotMatch(migration, /alter\s+table\s+realtime\.messages/iu);
});

test('end-of-grace handoff is token-verified, internal, and reuses the idempotent primitive', () => {
  assert.match(handoffMigration, /materialize_expired_license_after_verified_device_v1/u);
  assert.match(handoffMigration, /d\.is_active is true/u);
  assert.match(handoffMigration, /d\.security_token is not null/u);
  assert.match(handoffMigration, /d\.security_token = p_security_token or d\.previous_security_token = p_security_token/u);
  assert.match(handoffMigration, /license_entitlement_state_v1\(v_license_id\)/u);
  assert.match(handoffMigration, /v_entitlement\.lifecycle_state <> 'expired'/u);
  assert.match(handoffMigration, /materialize_expired_license_to_free_v1\(v_license_id\)/u);
  assert.match(handoffMigration, /perform private\.materialize_expired_license_after_verified_device_v1/u);
  assert.match(handoffMigration, /revoke all on function private\.materialize_expired_license_after_verified_device_v1[\s\S]+from public, anon, authenticated/iu);
  assert.doesNotMatch(handoffMigration, /grant execute on function private\.materialize_expired_license_after_verified_device_v1/iu);
});
