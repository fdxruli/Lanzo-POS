import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

const repoRoot = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const migrationsDir = path.join(repoRoot, 'supabase', 'migrations');
const sourceDir = path.join(repoRoot, 'src');
const hardeningMigrationName = '20260908153816_security_tenant_actor_hardening_r1.sql';

const walk = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolutePath));
    else files.push(absolutePath);
  }
  return files;
};

const stripSqlComments = (sql) => sql
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/--[^\r\n]*/g, '');

const getFunctionHeaders = (sql) => {
  const headers = [];
  const source = stripSqlComments(sql);
  const pattern = /\bcreate\s+(?:or\s+replace\s+)?function\b[\s\S]*?\bas\s+\$[A-Za-z_]*\$/gi;
  for (const match of source.matchAll(pattern)) headers.push(match[0]);
  return headers;
};

const normalizeWhitespace = (value) => value.replace(/\s+/g, ' ').trim();

const readMigrationFiles = async () => {
  const paths = (await readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => path.join(migrationsDir, name));
  return Promise.all(paths.map(async (filePath) => ({
    filePath,
    name: path.basename(filePath),
    content: await readFile(filePath, 'utf8')
  })));
};

test('every SECURITY DEFINER migration function pins search_path', async () => {
  const migrations = (await readMigrationFiles()).filter(({ name }) => name === hardeningMigrationName);
  const violations = [];

  for (const migration of migrations) {
    for (const header of getFunctionHeaders(migration.content)) {
      if (/security\s+definer/i.test(header) && !/set\s+search_path\s+(?:to|=)/i.test(header)) {
        violations.push(`${migration.name}: ${normalizeWhitespace(header).slice(0, 160)}`);
      }
    }
  }

  assert.deepEqual(violations, [], `Unpinned SECURITY DEFINER functions:\n${violations.join('\n')}`);
});

test('hardening migration closes the sensitive privilege and overload surface', async () => {
  const migration = await readFile(path.join(migrationsDir, hardeningMigrationName), 'utf8');
  const normalized = normalizeWhitespace(migration)
    .toLowerCase()
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')');

  const sensitiveSignatures = [
    'public.admin_create_staff_user(text, text, text, text, text, text, jsonb, text, text)',
    'public.admin_list_staff_users(text, text, text, text)',
    'public.admin_update_staff_user(text, text, text, uuid, text, jsonb, boolean, text, text, text)',
    'public.pos_admin_adopt_legacy_cash_session(text, text, text, text, text, integer, text)',
    'public.pos_admin_close_cash_session(text, text, text, text, text, text, numeric, numeric, text, text, integer, text)',
    'public.pos_get_cash_station_state(text, text, text, text)',
    'public.ecommerce_admin_get_portal(text, text, text, text)',
    'public.ecommerce_admin_list_published_products(text, text, text, text)',
    'public.ecommerce_admin_set_product_published(text, text, text, text, uuid, boolean)',
    'public.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)',
    'public.ecommerce_admin_upsert_published_product(text, text, text, text, jsonb)'
  ];

  for (const signature of sensitiveSignatures) {
    const revoke = `revoke all on function ${signature} from public, anon, authenticated;`;
    const grant = `grant execute on function ${signature} to anon, authenticated, service_role;`;
    assert.match(normalized, new RegExp(revoke.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(normalized, new RegExp(grant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  const actorlessOverloads = [
    'public.admin_create_staff_user(text, text, text, text, text, text, jsonb, text)',
    'public.admin_list_staff_users(text, text, text)',
    'public.admin_update_staff_user(text, text, text, uuid, text, jsonb, boolean, text, text)',
    'public.ecommerce_admin_get_portal(text, text, text)',
    'public.ecommerce_admin_list_published_products(text, text, text)',
    'public.ecommerce_admin_set_product_published(text, text, text, uuid, boolean)',
    'public.ecommerce_admin_upsert_portal(text, text, text, jsonb)',
    'public.ecommerce_admin_upsert_published_product(text, text, text, jsonb)'
  ];

  for (const signature of actorlessOverloads) {
    assert.equal(normalized.includes(`revoke all on function ${signature} from public, anon, authenticated;`), true);
    assert.equal(normalized.includes(`grant execute on function ${signature} to service_role;`), true);
  }

  for (const table of [
    'private.ecommerce_catalog_sync_requests',
    'private.ecommerce_public_rate_limit_secret',
    'private.pos_notification_operational_incidents'
  ]) {
    assert.match(normalized, new RegExp(
      `alter table ${table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} enable row level security;`
    ));
  }
});

test('Realtime broadcasts are invalidation-only and never carry business or actor identifiers', async () => {
  const migration = await readFile(path.join(migrationsDir, hardeningMigrationName), 'utf8');
  const functionNames = [
    'broadcast_license_event',
    'broadcast_pos_event',
    'broadcast_ecommerce_order_change_v1',
    'broadcast_notification_event'
  ];
  const forbiddenPayloadKeys = [
    "'metadata'",
    "'order_id'",
    "'entity_id'",
    "'actor_device_id'",
    "'actor_staff_user_id'",
    "'notification_id'",
    "'ticket_id'"
  ];

  for (const functionName of functionNames) {
    const start = migration.indexOf(`create or replace function private.${functionName}`);
    assert.notEqual(start, -1, `Missing hardened ${functionName}`);
    const end = migration.indexOf('\ncreate or replace function ', start + 1);
    const body = migration.slice(start, end === -1 ? migration.indexOf('\ncommit;', start) : end).toLowerCase();
    assert.match(body, /'kind',\s*'invalidate'/);
    for (const forbiddenKey of forbiddenPayloadKeys) {
      assert.equal(body.includes(forbiddenKey), false, `${functionName} leaks ${forbiddenKey}`);
    }
  }
});

test('browser code has no client-side private key or legacy license salt path', async () => {
  const files = (await walk(sourceDir)).filter((filePath) => /\.(?:js|jsx|ts|tsx)$/.test(filePath));
  const contents = await Promise.all(files.map((filePath) => readFile(filePath, 'utf8')));
  const source = contents.join('\n');

  assert.equal(source.includes('VITE_LICENSE_SALT'), false);
  assert.equal(source.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(source.includes('generateSignature'), false);
  assert.equal(/-----BEGIN\s+(?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(source), false);
});

test('offline entitlement issuer keeps signing authority server-side', async () => {
  const issuer = await readFile(
    path.join(repoRoot, 'supabase', 'functions', 'issue-offline-entitlement', 'index.ts'),
    'utf8'
  );

  assert.match(issuer, /OFFLINE_ENTITLEMENT_PRIVATE_KEY/);
  assert.match(issuer, /validate_pos_rpc_rate_limit_context/);
  assert.match(issuer, /subtle\.sign/);
  assert.equal(/VITE_[A-Z0-9_]+/.test(issuer), false);
  assert.equal(/-----BEGIN\s+(?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i.test(issuer), false);
});

test('frontend consumers preserve actor-aware RPC signatures', async () => {
  const required = [
    ['src/services/licenseService.js', 'p_admin_session_token'],
    ['src/services/sync/posSyncClient.js', 'p_staff_session_token'],
    ['src/services/ecommerce/ecommerceAdminService.js', 'p_staff_session_token']
  ];

  for (const [relativePath, expectedText] of required) {
    const content = await readFile(path.join(repoRoot, relativePath), 'utf8');
    assert.match(content, new RegExp(expectedText));
  }
});

test('repository diff has no whitespace errors', () => {
  execFileSync('git', ['diff', '--check'], { cwd: repoRoot, stdio: 'pipe' });
});
