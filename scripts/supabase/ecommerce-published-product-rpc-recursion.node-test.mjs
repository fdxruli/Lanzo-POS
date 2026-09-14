import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migrationsDir = join(repoRoot, 'supabase', 'migrations');
const migrationName = '20260914215627_ecommerce_published_product_rpc_recursion_r1.sql';
const hotfix = readFileSync(join(migrationsDir, migrationName), 'utf8');
const migrationFiles = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(join(migrationsDir, name), 'utf8'));

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function extractDefinitions(sql, qualifiedName) {
  const startPattern = new RegExp(
    `create\\s+or\\s+replace\\s+function\\s+${escapeRegExp(qualifiedName)}\\s*\\(`,
    'giu'
  );
  const definitions = [];
  for (const match of sql.matchAll(startPattern)) {
    const bodyMarker = sql.indexOf('as $function$', match.index);
    if (bodyMarker < 0) continue;
    const bodyEnd = sql.indexOf('$function$;', bodyMarker + 'as $function$'.length);
    if (bodyEnd < 0) continue;
    definitions.push({
      body: sql.slice(bodyMarker + 'as $function$'.length, bodyEnd),
      declaration: sql.slice(match.index, bodyEnd + '$function$;'.length)
    });
  }
  return definitions;
}

function latestDefinition(qualifiedName) {
  const definitions = migrationFiles.flatMap((sql) => extractDefinitions(sql, qualifiedName));
  assert.ok(definitions.length > 0, `missing definition for ${qualifiedName}`);
  return definitions.at(-1);
}

const core = extractDefinitions(
  hotfix,
  'private.ecommerce_admin_upsert_published_product_core'
)[0];
const v2 = extractDefinitions(
  hotfix,
  'public.ecommerce_admin_upsert_published_product_v2'
)[0];
const legacy = extractDefinitions(
  hotfix,
  'public.ecommerce_admin_upsert_published_product'
);
const v3 = latestDefinition('public.ecommerce_admin_upsert_published_product_v3');

test('effective published-product call graph is acyclic and canonical', () => {
  assert.ok(core);
  assert.ok(v2);
  assert.equal(legacy.length, 2, 'both legacy overloads must remain aliases');

  assert.match(v3.body, /public\.ecommerce_admin_upsert_published_product_v2\s*\(/iu);
  assert.doesNotMatch(v3.body, /public\.ecommerce_admin_upsert_published_product\s*\(/iu);

  assert.match(v2.body, /private\.ecommerce_admin_upsert_published_product_core\s*\(/iu);
  assert.doesNotMatch(v2.body, /public\.ecommerce_admin_upsert_published_product\s*\(/iu);

  assert.doesNotMatch(
    core.body,
    /public\.ecommerce_admin_upsert_published_product(?:_v2|_v3)?\s*\(/iu
  );
  for (const alias of legacy) {
    assert.match(alias.body, /public\.ecommerce_admin_upsert_published_product_v3\s*\(/iu);
    assert.doesNotMatch(alias.body, /private\.ecommerce_admin_upsert_published_product_core\s*\(/iu);
  }
});

test('core preserves the writer lock protocol and private security boundary', () => {
  const portalLock = core.body.indexOf('limit 1 for update');
  const productLock = core.body.indexOf('limit 1 for update', portalLock + 1);
  const persistence = core.body.search(/\b(?:insert|update)\s+public\.ecommerce_published_products\b/iu);
  assert.ok(portalLock >= 0, 'portal lock must be acquired');
  assert.ok(productLock > portalLock, 'product lock must follow the portal lock');
  assert.ok(persistence > productLock, 'persistence must follow the parent locks');
  assert.match(core.declaration, /security\s+invoker\s+set\s+search_path\s+to\s+''/iu);
  assert.match(
    hotfix,
    /revoke\s+all\s+on\s+function\s+private\.ecommerce_admin_upsert_published_product_core\([\s\S]*?from\s+public,\s+anon,\s+authenticated,\s+service_role/iu
  );
  assert.match(hotfix, /alter\s+function\s+private\.ecommerce_admin_upsert_published_product_core\([\s\S]*?owner\s+to\s+postgres/iu);
});

test('v2 keeps configuration validation and v3 keeps publication hardening', () => {
  assert.match(v2.body, /configurationSourceRevision/iu);
  assert.match(v2.body, /private\.ecommerce_apply_product_configuration_checked\s*\(/iu);
  assert.match(v3.body, /private\.ecommerce_publication_eligibility\s*\(/iu);
  assert.match(v3.body, /app\.ecommerce_simple_override_reconcile/iu);
  assert.match(v3.body, /private\.ecommerce_apply_wholesale_tiers\s*\(/iu);
  assert.match(v3.body, /private\.ecommerce_reconcile_published_product_capability\s*\(/iu);
});

test('hotfix migration contains no data repair or unrelated table mutation', () => {
  assert.doesNotMatch(hotfix, /(?:insert|update|delete|truncate)\s+public\.(?:licenses|pos_products)\b/iu);
  assert.doesNotMatch(hotfix, /delete\s+from\s+public\.ecommerce_(?:published_products|published_product_variants)\b/iu);
});
