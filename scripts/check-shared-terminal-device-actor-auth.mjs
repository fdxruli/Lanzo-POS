import fs from 'node:fs';
import path from 'node:path';

const foundationPath = path.resolve(
  'supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql'
);
const legacyCutoverPath = path.resolve(
  'supabase/migrations/20260818165736_shared_terminal_legacy_admin_fail_closed.sql'
);
const secondaryContextPath = path.resolve(
  'supabase/migrations/20260818170333_shared_terminal_secondary_actor_context.sql'
);
const occupancyFixPath = path.resolve(
  'supabase/migrations/20260818234329_shared_terminal_staff_occupancy_fix.sql'
);
const occupancyTestPath = path.resolve(
  'supabase/tests/shared_terminal_staff_occupancy_test.sql'
);
const uploadEdgePath = path.resolve(
  'supabase/functions/authorize-image-upload/index.ts'
);
const uploadClientPath = path.resolve(
  'src/services/storage/imageUploadService.js'
);
const uploadHistoricalTestPath = path.resolve(
  'src/services/storage/__tests__/imageUploadService.test.js'
);

const foundationSql = fs.readFileSync(foundationPath, 'utf8');
const legacyCutoverSql = fs.readFileSync(legacyCutoverPath, 'utf8');
const secondaryContextSql = fs.readFileSync(secondaryContextPath, 'utf8');
const occupancyFixSql = fs.readFileSync(occupancyFixPath, 'utf8');
const occupancyTestSql = fs.readFileSync(occupancyTestPath, 'utf8');
const uploadEdge = fs.readFileSync(uploadEdgePath, 'utf8');
const uploadClient = fs.readFileSync(uploadClientPath, 'utf8');
const uploadHistoricalTest = fs.readFileSync(uploadHistoricalTestPath, 'utf8');

const requiredFoundationFragments = [
  "when 'admin' then 'admin_only'",
  "when 'staff' then 'staff_only'",
  "device_mode in ('shared', 'admin_only', 'staff_only')",
  'ACTOR_SESSION_AMBIGUOUS',
  'ACTOR_SESSION_INVALID',
  'DEVICE_MODE_STAFF_NOT_ALLOWED',
  'DEVICE_MODE_ADMIN_NOT_ALLOWED',
  'admin_set_device_mode',
  "d.device_mode in ('admin_only', 'shared')",
  "actor_key', v_actor_type || ':' || v_actor_id::text",
  'DEVICE_MODE_UNEXPECTED_AUTOMATIC_SHARED'
];

const requiredLegacyCutoverFragments = [
  'private.admin_create_staff_user_impl',
  'private.admin_list_staff_users_impl',
  'private.admin_update_staff_user_impl',
  'ADMIN_SESSION_REQUIRED',
  'private.require_active_admin_session',
  "d.device_mode = 'staff_only'",
  'release_device_anon_unlimited',
  'LEGACY_RELEASE_NOT_FAIL_CLOSED',
  'LEGACY_ADMIN_DEVICE_ROLE_AUTHORITY_REMAINS',
  'ADMIN_STAFF_CANONICAL_SESSION_GUARD_MISSING'
];

const requiredSecondaryContextFragments = [
  'private.resolve_device_actor_session',
  'ACTOR_SESSION_AMBIGUOUS',
  'ACTOR_SESSION_INVALID',
  'ecommerce_admin_authorize_v2',
  'get_support_ticket_context',
  'validate_pos_rpc_rate_limit_context',
  'get_ai_agent_usage_unlimited',
  'refresh_operational_notifications',
  'SECONDARY_CONTEXT_DEVICE_ROLE_AUTHORITY_REMAINS',
  'SECONDARY_CONTEXT_ACTOR_RESOLVER_MISSING'
];

const requiredOccupancyFixFragments = [
  'staff_login_on_device_unlimited',
  "d.staff_user_id = v_staff_user.id and d.device_mode = 'staff_only' and d.is_active is true",
  'from public.license_staff_sessions ss join public.license_devices d on d.id = ss.device_id',
  'ss.revoked_at is null and ss.expires_at > now()',
  'uq_license_devices_one_active_device_per_staff',
  "device_mode = 'staff_only'",
  'STAFF_ACTIVE_SESSION_GUARD_MISSING',
  'STAFF_ONLY_RESERVATION_INDEX_UNEXPECTED'
];

const groups = [
  ['foundation', foundationSql, requiredFoundationFragments],
  ['legacy cutover', legacyCutoverSql, requiredLegacyCutoverFragments],
  ['secondary actor context', secondaryContextSql, requiredSecondaryContextFragments],
  ['staff occupancy fix', occupancyFixSql, requiredOccupancyFixFragments]
];

let missingAny = false;
for (const [label, sql, required] of groups) {
  for (const fragment of required) {
    if (!sql.includes(fragment)) {
      console.error(`Missing ${label} contract: ${fragment}`);
      missingAny = true;
    }
  }
}
if (missingAny) process.exit(1);

const forbiddenFoundationPatterns = [
  /update\s+public\.license_devices\s+set\s+device_mode\s*=\s*'shared'/i,
  /update\s+public\.license_devices\s+set\s+device_role\s*=\s*'staff'\s+where\s+device_mode\s*=\s*'shared'/i,
  /update\s+public\.license_devices\s+set\s+device_role\s*=\s*'admin'\s+where\s+device_mode\s*=\s*'shared'/i
];

for (const pattern of forbiddenFoundationPatterns) {
  if (pattern.test(foundationSql)) {
    console.error(`Forbidden shared-device migration pattern detected: ${pattern}`);
    process.exit(1);
  }
}

const forbiddenOccupancyPatterns = [
  /update\s+public\.license_devices[\s\S]*?set\s+staff_user_id\s*=\s*null[\s\S]*?device_mode\s*=\s*'shared'/i,
  /delete\s+from\s+public\.license_devices/i,
  /delete\s+from\s+public\.license_staff_sessions/i,
  /set\s+device_mode\s*=\s*'shared'/i
];
for (const pattern of forbiddenOccupancyPatterns) {
  if (pattern.test(occupancyFixSql)) {
    console.error(`Forbidden occupancy migration pattern detected: ${pattern}`);
    process.exit(1);
  }
}

const canonicalAdminOverloads = [
  /create or replace function public\.admin_create_staff_user\([\s\S]*?p_admin_session_token text[\s\S]*?private\.require_active_admin_session/i,
  /create or replace function public\.admin_list_staff_users\([\s\S]*?p_admin_session_token text[\s\S]*?private\.require_active_admin_session/i,
  /create or replace function public\.admin_update_staff_user\([\s\S]*?p_admin_session_token text[\s\S]*?private\.require_active_admin_session/i
];

for (const pattern of canonicalAdminOverloads) {
  if (!pattern.test(legacyCutoverSql)) {
    console.error(`Canonical Admin session overload missing: ${pattern}`);
    process.exit(1);
  }
}

for (const functionName of [
  'ecommerce_admin_authorize_v2',
  'get_support_ticket_context',
  'validate_pos_rpc_rate_limit_context',
  'get_ai_agent_usage_unlimited',
  'refresh_operational_notifications'
]) {
  const privateMarker = `function private.${functionName}`;
  const publicMarker = `function public.${functionName}`;
  const privateStart = secondaryContextSql.indexOf(privateMarker);
  const publicStart = secondaryContextSql.indexOf(publicMarker);
  const start = [privateStart, publicStart].filter((value) => value >= 0).sort((a, b) => a - b)[0] ?? -1;
  const next = start >= 0
    ? secondaryContextSql.indexOf('\ncreate or replace function ', start + 20)
    : -1;
  const body = start >= 0
    ? secondaryContextSql.slice(start, next >= 0 ? next : secondaryContextSql.length)
    : '';

  if (!body.includes('resolve_device_actor_session')) {
    console.error(`Secondary context does not resolve actor session: ${functionName}`);
    process.exit(1);
  }
}

const requiredOccupancyTestFragments = [
  'TEST_A_EXPECTED_STAFF_ALREADY_IN_USE',
  "set device_mode = 'shared'",
  'staff_logout_session_unlimited',
  'TEST_B_EXPECTED_LOGIN_B_PASS',
  'TEST_C_EXPECTED_LOGIN_B_PASS',
  'TEST_D_EXPECTED_ACTIVE_SESSION_BLOCK',
  'TEST_E_EXPECTED_STAFF_Y_PASS',
  'rollback;'
];
for (const fragment of requiredOccupancyTestFragments) {
  if (!occupancyTestSql.includes(fragment)) {
    console.error(`Staff occupancy integration fixture missing: ${fragment}`);
    process.exit(1);
  }
}

const requiredUploadEdgeFragments = [
  "supabase.rpc('validate_pos_rpc_rate_limit_context'",
  'p_staff_session_token: validation.actorSessionToken',
  "actorContext?.success !== true",
  "actorContext?.allowed !== true",
  "cleanText(actorContext?.actor_type)",
  "cleanText(actorContext?.actor_key)",
  "!['admin', 'staff'].includes(actorType)",
  "!['admin_only', 'staff_only', 'shared'].includes(deviceMode)"
];

for (const fragment of requiredUploadEdgeFragments) {
  if (!uploadEdge.includes(fragment)) {
    console.error(`Image upload edge actor contract missing: ${fragment}`);
    process.exit(1);
  }
}

for (const forbidden of [
  'verify_device_license_unified',
  'verify_staff_session'
]) {
  if (uploadEdge.includes(forbidden)) {
    console.error(`Image upload edge still uses legacy actor authority: ${forbidden}`);
    process.exit(1);
  }
}

const requiredUploadClientFragments = [
  'getActorSessionToken()',
  'if (!deviceFingerprint || !securityToken || !actorSessionToken)',
  'staff_session_token: actorSessionToken'
];
for (const fragment of requiredUploadClientFragments) {
  if (!uploadClient.includes(fragment)) {
    console.error(`Image upload client actor contract missing: ${fragment}`);
    process.exit(1);
  }
}

for (const forbidden of [
  'reintentando autorización sin sesión de actor',
  'staff_session_token: null'
]) {
  if (uploadClient.includes(forbidden)) {
    console.error(`Image upload client can drop actor authority: ${forbidden}`);
    process.exit(1);
  }
}

if (!uploadHistoricalTest.includes("getActorSessionToken.mockResolvedValue('staff-session-fixture')")) {
  console.error('Historical image upload success fixtures do not provide an actor session token.');
  process.exit(1);
}

console.log('SHARED.TERMINAL.2-R1 migration + actor authorization + occupancy contract: PASS');
