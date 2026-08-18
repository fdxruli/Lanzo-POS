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

const foundationSql = fs.readFileSync(foundationPath, 'utf8');
const legacyCutoverSql = fs.readFileSync(legacyCutoverPath, 'utf8');
const secondaryContextSql = fs.readFileSync(secondaryContextPath, 'utf8');

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

const groups = [
  ['foundation', foundationSql, requiredFoundationFragments],
  ['legacy cutover', legacyCutoverSql, requiredLegacyCutoverFragments],
  ['secondary actor context', secondaryContextSql, requiredSecondaryContextFragments]
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
  const start = secondaryContextSql.indexOf(`function ${functionName}`);
  const next = start >= 0 ? secondaryContextSql.indexOf('\ncreate or replace function ', start + 20) : -1;
  const body = start >= 0
    ? secondaryContextSql.slice(start, next >= 0 ? next : secondaryContextSql.length)
    : '';

  if (!body.includes('resolve_device_actor_session')) {
    console.error(`Secondary context does not resolve actor session: ${functionName}`);
    process.exit(1);
  }
}

console.log('SHARED.TERMINAL.2 migration contract: PASS');
