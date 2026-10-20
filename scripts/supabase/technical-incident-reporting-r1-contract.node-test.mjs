import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDirectory = join(repoRoot, 'supabase', 'migrations');
const canonicalMigrationPath = join(
  migrationsDirectory,
  '20261015134821_technical_incident_reporting_r1.sql'
);
const deferredMigrationPath = join(
  repoRoot,
  'supabase',
  'archive',
  'unresolved-migrations',
  '20261015134821_technical_incident_reporting_r1.sql'
);
const sql = readFileSync(deferredMigrationPath, 'utf8').replace(/\r\n/gu, '\n');
const submitMarker = 'create or replace function public.submit_technical_incident_report(';
const purgeMarker = 'create or replace function private.purge_technical_incident_reports()';

const extractBlock = (source, marker) => {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing SQL block: ${marker}`);
  const end = source.indexOf('$function$;', start);
  assert.notEqual(end, -1, `incomplete SQL function: ${marker}`);
  return source.slice(start, end + '$function$;'.length);
};

const submitSql = extractBlock(sql, submitMarker);
const purgeSql = extractBlock(sql, purgeMarker);

test('keeps technical incident reporting SQL out of the canonical migration set', () => {
  const applicableIncidentMigrations = readdirSync(migrationsDirectory)
    .filter((filename) => /technical[_-]incident[_-]reporting/iu.test(filename));

  assert.deepEqual(applicableIncidentMigrations, []);
  assert.equal(existsSync(canonicalMigrationPath), false);
  assert.equal(existsSync(deferredMigrationPath), true);
});

test('stores only a private, RLS-protected technical report record', () => {
  assert.match(sql, /create table if not exists private\.technical_incident_reports/u);
  assert.match(sql, /alter table private\.technical_incident_reports enable row level security;/u);
  assert.match(sql, /revoke all on table private\.technical_incident_reports from public, anon, authenticated, service_role;/u);
  assert.match(sql, /create policy technical_incident_reports_owner_access[\s\S]+?to postgres[\s\S]+?using \(true\)[\s\S]+?with check \(true\);/u);
  assert.match(sql, /unique \(license_id, incident_id\)/u);
  assert.match(sql, /expires_at timestamptz not null default \(now\(\) \+ interval '90 days'\)/u);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete|all)\s+on\s+table\s+private\.technical_incident_reports/iu);
});

test('validates the exact versioned allowlist and derives tenant identity from the server context', () => {
  const keyBlock = submitSql.match(/v_allowed_keys text\[\] := array\[([\s\S]*?)\];/u)?.[1];
  assert.ok(keyBlock, 'versioned input key allowlist must be declared');
  const allowedKeys = [...keyBlock.matchAll(/'([a-z_]+)'/gu)].map((match) => match[1]);
  assert.deepEqual(allowedKeys, [
    'app_version', 'browser_family', 'build_commit', 'category', 'correlation_id',
    'fingerprint', 'incident_id', 'module', 'network_status', 'occurred_at', 'platform',
    'recovery_status', 'safe_code', 'safe_route', 'schema_version', 'severity', 'source',
    'user_description'
  ]);
  assert.match(submitSql, /private\.validate_pos_sync_context\s*\(/u);
  assert.match(submitSql, /v_license_id := nullif\(v_context->>'license_id', ''\)::uuid;/u);
  assert.doesNotMatch(submitSql.slice(0, submitSql.indexOf('returns jsonb')), /p_(?:tenant|business|license)_id/iu);
  assert.match(submitSql, /p_incident::text\) > 10000/u);
  assert.match(submitSql, /p_consent, false\) is not true/u);
  assert.match(submitSql, /pg_catalog\.char_length\(v_user_description\) > 500/u);
  assert.match(submitSql, /r\.received_at >= now\(\) - interval '1 hour'/u);
  assert.match(submitSql, /if v_recent_count >= 10 then/u);
  assert.match(submitSql, /request_digest is distinct from v_request_digest/u);
});

test('limits API execution to the narrow RPC and hardens SECURITY DEFINER search paths', () => {
  assert.match(submitSql, /security definer\s+set search_path = ''/u);
  assert.match(sql, /revoke all on function public\.submit_technical_incident_report\(text, text, text, text, jsonb, boolean\)\s+from public, anon, authenticated, service_role;/u);
  assert.match(sql, /grant execute on function public\.submit_technical_incident_report\(text, text, text, text, jsonb, boolean\)\s+to anon, authenticated;/u);
  assert.match(purgeSql, /security definer\s+set search_path = ''/u);
  assert.match(sql, /revoke all on function private\.purge_technical_incident_reports\(\) from public, anon, authenticated, service_role;/u);
  assert.match(sql, /cron\.schedule\(/u);
  assert.match(sql, /if pg_catalog\.to_regclass\('cron\.job'\) is null then/u);
  assert.doesNotMatch(submitSql, /support_center|support_tickets|support_channel|feature.*pro/iu);
  assert.doesNotMatch(submitSql, /(?:insert\s+into|update|delete\s+from)\s+(?:public\.)?(?:sales|cash|payments|orders|financial_operations)\b/iu);
});

test('the migration does not change production data or commercial financial flows', () => {
  assert.doesNotMatch(sql, /^\s*(?:insert|update|delete)\s+(?:public\.)?(?:sales|cash|payments|orders)\b/imu);
  assert.doesNotMatch(sql, /drop\s+(?:table|schema|database)\s+(?:public\.)?(?:sales|cash|payments|orders)\b/iu);
  assert.doesNotMatch(sql, /service_role\s*[:=]/iu);
  assert.doesNotMatch(sql, /create\s+extension/iu);
});
