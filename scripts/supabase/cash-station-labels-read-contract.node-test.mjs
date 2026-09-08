import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(scriptDirectory, '../../supabase/migrations');
const migrationName = readdirSync(migrationDirectory)
  .filter((name) => /_cash_station_labels_read_r1\.sql$/.test(name))
  .sort()
  .at(-1);

assert.ok(migrationName, 'cash station label migration must exist');
const migration = readFileSync(join(migrationDirectory, migrationName), 'utf8');
const normalized = migration.replace(/--[^\n]*(?:\n|$)/g, ' ').replace(/\s+/g, ' ');
const labelProjection = normalized.slice(
  normalized.indexOf('create or replace function private.pos_cash_session_to_labeled_jsonb'),
  normalized.indexOf('create or replace function public.pos_get_current_cash_session')
);

test('projects only tenant-scoped human device labels', () => {
  assert.match(labelProjection, /left join public\.license_devices opening_device on opening_device\.id = coalesce\(p_session\.opened_by_device_id, p_session\.device_id\) and opening_device\.license_id = p_session\.license_id/i);
  assert.match(labelProjection, /'device_name', opening_device\.device_name/i);
  assert.match(labelProjection, /'opened_by_device_name', opening_device\.device_name/i);
  assert.match(labelProjection, /'opening_device_name', opening_device\.device_name/i);
  assert.doesNotMatch(labelProjection, /cash_station_id/i);
});

test('enriches every read route used by Caja', () => {
  for (const functionName of [
    'public.pos_get_current_cash_session',
    'public.pos_pull_cash_snapshot_unlimited',
    'public.pos_admin_list_cash_sessions_unlimited',
    'public.pos_admin_get_cash_session_detail_unlimited'
  ]) {
    assert.match(normalized, new RegExp(`create or replace function ${functionName.replaceAll('.', '\\.')}`), functionName);
    assert.match(normalized, new RegExp(`${functionName.split('.').at(-1)}[\\s\\S]*?pos_cash_session_to_labeled_jsonb`, 'i'), functionName);
  }
});

test('does not mutate cash data or expose the helper to API roles', () => {
  assert.doesNotMatch(normalized, /\b(insert|update|delete|truncate)\s+(into\s+)?/i);
  assert.match(normalized, /revoke all on function private\.pos_cash_session_to_labeled_jsonb\(public\.pos_cash_sessions\) from public, anon, authenticated/i);
});
