import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const migrationDir = resolve(root, 'supabase/migrations');
const migrationName = '20260825214805_20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql';
const strictMigrationName = '20260825233834_20260825232859_admin_staff_rbac_r2c_strict_ai_agent_boolean_authority.sql';
const migration = readFileSync(resolve(migrationDir, migrationName), 'utf8');
const strictMigration = readFileSync(resolve(migrationDir, strictMigrationName), 'utf8');
const normalizedMigration = migration
  .split(String.fromCharCode(13) + String.fromCharCode(10))
  .join(String.fromCharCode(10));
const normalizedStrictMigration = strictMigration
  .split(String.fromCharCode(13) + String.fromCharCode(10))
  .join(String.fromCharCode(10));
const edgeFunction = readFileSync(resolve(root, 'supabase/functions/lanzo-ai-agent/index.ts'), 'utf8');
const edgeTest = readFileSync(resolve(root, 'supabase/functions/lanzo-ai-agent/index.test.ts'), 'utf8');
const aiService = readFileSync(resolve(root, 'src/services/aiService.js'), 'utf8');
const usageService = readFileSync(resolve(root, 'src/services/aiAgentUsageService.js'), 'utf8');

test('R2C has one canonical migration and fail-closed ai_agents defaults', () => {
  const candidates = readdirSync(migrationDir)
    .filter((name) => name.includes('r2c_ai_agent_authority'));
  assert.deepEqual(candidates, [migrationName, strictMigrationName]);
  assert.ok(migration.includes("and (v_actor->'actor_permissions')->>'ai_agents' is distinct from 'true'"));
  assert.ok(strictMigration.includes("and not coalesce("));
  assert.ok(migration.includes("'ai_agents', false"));
  assert.ok(migration.includes("'support_center', 'ai_agents'"));
  assert.ok(migration.includes("jsonb_typeof(p_permissions -> v_key) = 'boolean'"));
});

test('R2C gates Staff before period and usage work', () => {
  const gate = strictMigration.indexOf("v_actor->>'actor_type' = 'staff'");
  const period = strictMigration.indexOf('v_pid := public.ensure_current_license_period', gate);
  const usageCount = strictMigration.indexOf('select count(*)::integer into v_used', gate);
  assert.ok(gate >= 0);
  assert.ok(period > gate);
  assert.ok(usageCount > gate);
  assert.ok(strictMigration.includes(
    "jsonb_typeof((v_actor->'actor_permissions')->'ai_agents') = 'boolean'"
  ));
  assert.ok(strictMigration.includes(
    "and (v_actor->'actor_permissions')->'ai_agents' = 'true'::jsonb"
  ));
  const beforeGate = strictMigration.slice(0, gate).toLowerCase();
  assert.equal(beforeGate.includes('insert into'), false);
  assert.equal(beforeGate.includes('update '), false);
  assert.equal(beforeGate.includes('delete '), false);
});

test('R2C closes internal helper ACL and preserves service-role cleanup path', () => {
  for (const sql of [normalizedMigration, normalizedStrictMigration]) {
    assert.ok(sql.includes(
      'revoke all on function public.get_ai_agent_usage_unlimited(text, text, text, text)' +
      String.fromCharCode(10) +
      '  from public, anon, authenticated;'
    ));
    assert.ok(sql.includes(
      'grant execute on function public.get_ai_agent_usage_unlimited(text, text, text, text)' +
      String.fromCharCode(10) +
      '  to service_role;'
    ));
  }
  assert.equal(migration.includes('complete_ai_agent_analysis'), false);
});

test('R2C keeps the client actor fence and provider-before-reservation order', () => {
  assert.ok(aiService.includes("actorRuntimeController.assertGranted('ai_agents')"));
  assert.ok(aiService.includes("actorType === 'admin' ? 'admin_session_token' : 'staff_session_token'"));
  assert.ok(usageService.includes("actorRuntimeController.assertGranted('ai_agents')"));
  assert.ok(usageService.includes("actorType === 'admin' ? 'admin_session_token' : 'staff_session_token'"));
  assert.ok(edgeFunction.includes('AI_AGENT_PERMISSION_REQUIRED'));
  assert.ok(edgeFunction.includes('begin_ai_agent_analysis'));
  assert.ok(edgeTest.includes('ai_agents requerido antes del proveedor'));
  assert.ok(edgeTest.includes('assertEquals(fetchCalls, 0)'));
});