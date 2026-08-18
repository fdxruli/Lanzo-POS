import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  'supabase/migrations/20260818164207_shared_terminal_device_actor_auth.sql'
);
const sql = fs.readFileSync(migrationPath, 'utf8');

const requiredFragments = [
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

const missing = requiredFragments.filter((fragment) => !sql.includes(fragment));
if (missing.length > 0) {
  console.error('Missing SHARED.TERMINAL.2 migration contracts:');
  for (const fragment of missing) console.error(`- ${fragment}`);
  process.exit(1);
}

const forbiddenPatterns = [
  /update\s+public\.license_devices\s+set\s+device_mode\s*=\s*'shared'/i,
  /update\s+public\.license_devices\s+set\s+device_role\s*=\s*'staff'\s+where\s+device_mode\s*=\s*'shared'/i,
  /update\s+public\.license_devices\s+set\s+device_role\s*=\s*'admin'\s+where\s+device_mode\s*=\s*'shared'/i
];

for (const pattern of forbiddenPatterns) {
  if (pattern.test(sql)) {
    console.error(`Forbidden shared-device migration pattern detected: ${pattern}`);
    process.exit(1);
  }
}

console.log('SHARED.TERMINAL.2 migration contract: PASS');
