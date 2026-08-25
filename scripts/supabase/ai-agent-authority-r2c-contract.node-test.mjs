import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
const migrationDir = resolve(root, 'supabase/migrations');
const migrationName = '20260825090000_admin_staff_rbac_r2c_ai_agent_authority.sql';
const migration = readFileSync(resolve(migrationDir, migrationName), 'utf8');
const normalizedMigration = migration
  .split(String.fromCharCode(13) + String.fromCharCode(10))
  .join(String.fromCharCode(10));
const edgeFunction = readFileSync(resolve(root, 'supabase/functions/lanzo-ai-agent/index.ts'), 'utf8');
const edgeTest = readFileSync(resolve(root, 'supabase/functions/lanzo-ai-agent/index.test.ts'), 'utf8');
const aiService = readFileSync(resolve(root, 'src/services/aiService.js'), 'utf8');
const usageService = readFileSync(resolve(root, 'src/services/aiAgentUsageService.js'), 'utf8');

test('R2C has one canonical migration and fail-closed ai_agents defaults', () => {
  const candidates = readdirSync(migrationDir)
    .filter((name) => name.includes('r2c_ai_agent_authority'));
  assert.deepEqual(candidates, [migrationName]);
  assert.ok(migration.includes("'ai_agents', false"));
  assert.ok(migration.includes("'support_center', 'ai_agents'"));
  assert.ok(migration.includes("jsonb_typeof(p_permissions -> v_key) = 'boolean'"));
});

test('R2C gates Staff before period and usage work', () => {
  const gate = migration.indexOf("v_actor->>'actor_type' = 'staff'");
  const period = migration.indexOf('v_pid := public.ensure_current_license_period', gate);
  const usageCount = migration.indexOf('select count(*)::integer into v_used', gate);
  assert.ok(gate >= 0);
  assert.ok(period > gate);
  assert.ok(usageCount > gate);
  assert.ok(migration.includes(
    "and (v_actor->'actor_permissions')->>'ai_agents' is distinct from 'true'"
  ));
  const beforeGate = migration.slice(0, gate).toLowerCase();
  assert.equal(beforeGate.includes('insert into'), false);
  assert.equal(beforeGate.includes('update '), false);
  assert.equal(beforeGate.includes('delete '), false);
});

test('R2C closes internal helper ACL and preserves service-role cleanup path', () => {
  assert.ok(normalizedMigration.includes(
    'revoke all on function public.get_ai_agent_usage_unlimited(text, text, text, text)' +
    String.fromCharCode(10) +
    '  from public, anon, authenticated;'
  ));
  assert.ok(normalizedMigration.includes(
    'grant execute on function public.get_ai_agent_usage_unlimited(text, text, text, text)' +
    String.fromCharCode(10) +
    '  to service_role;'
  ));
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