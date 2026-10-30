import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bridgePath = path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql');
const threeD14Path = path.join(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const writerManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-writer-fingerprints.json');
const dispatcherManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/dispatcher-fingerprint.json');
const writersPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql');
const workflowPath = path.join(root, '.github/workflows/pr352-real-bridge-pg176-r6.yml');
const runnerPath = path.join(root, 'scripts/supabase/pr352-r6-real-bridge-pg176-test.mjs');
const concurrencyPath = path.join(root, 'scripts/supabase/pr352-r6-concurrency.mjs');
const overlayPath = path.join(root, 'scripts/supabase/pr352-r6-synthetic-ledger-overlay.mjs');

test('bridge candidate stays out of the canonical migration set and runs after 3D.14', async () => {
  const sql = await readFile(bridgePath, 'utf8');
  assert.equal(existsSync(path.join(root, 'supabase/migrations/20261030182733_restaurant_cloud_transition_bridge_v1.sql')), false);
  assert.equal(existsSync(path.join(root, 'supabase/tests/fixtures/pr352-r6/bridge-v1-candidate.sql')), false);
  assert.match(sql, /BRIDGE_REQUIRES_3D14_DISPATCHER_GUARD/);
  assert.match(sql, /BRIDGE_REQUIRED_FUNCTION_MISSING/);
  assert.match(sql, /BRIDGE_FUNCTION_OVERLOAD_UNSUPPORTED/);
  assert.match(sql, /BRIDGE_FUNCTION_SECURITY_DRIFT/);
  assert.match(sql, /pg_get_functiondef\(target_oid\)/);
  assert.match(sql, /pg_advisory_xact_lock_shared\(pg_catalog\.hashtextextended\('restaurant_contract_cutover_v1',0\)\)/);
  assert.match(sql, /contract_version integer not null default 1/);
  assert.doesNotMatch(sql, /set contract_version\s*=\s*2/i);
  assert.match(sql, /'adminSupervisionAvailable',s\.contract_version=2 and coalesce\(a\.enabled,false\) and not s\.writes_paused/);
  assert.match(sql, /if \(select contract_version from private\.restaurant_cloud_contract_state where singleton\)=2 then[\s\S]*clientContractVersion' is distinct from '2'/);
  assert.match(sql, /RESTAURANT_PARENT_ORDER_REQUIRED/);
  assert.match(sql, /RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED/);
  assert.match(sql, /RESTAURANT_ORDER_LINE_ID_CONFLICT/);
  assert.match(sql, /RESTAURANT_ORDER_ALREADY_PAID/);
  assert.match(sql, /RESTAURANT_CONTRACT_MAINTENANCE/);
  const policyStart = sql.indexOf('create function private.set_restaurant_transition_policy_v1');
  assert.ok(policyStart > 0);
  assert.doesNotMatch(sql.slice(0, policyStart), /insert\s+into\s+private\.restaurant_admin_activation\s*\(/i);
});

test('historical 3D.14 remains the exact reviewed blob and dispatcher fingerprint', async () => {
  const blob = execFileSync('git', ['hash-object', threeD14Path], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(blob, 'e1ab62ed387a3da7798d03d46e2c0723d12526a8');
  const dispatcher = JSON.parse(await readFile(dispatcherManifestPath, 'utf8'));
  assert.equal(dispatcher.postgresServerVersionNum, '170006');
  assert.equal(dispatcher.rawDataIncluded, false);
  assert.equal(dispatcher.credentialsIncluded, false);
  assert.equal(dispatcher.entry.signature, 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)');
  const source = await readFile(threeD14Path, 'utf8');
  const match = source.replaceAll('\r', '').match(/create or replace function public\.pos_execute_financial_operation_v1\([\s\S]*?\n\$function\$;/i)?.[0];
  assert.ok(match);
  const pgGetFunctionDefSerialization = match.slice(0, -1) + '\n';
  assert.equal(createHash('sha256').update(pgGetFunctionDefSerialization).digest('hex'), dispatcher.entry.sha256);
});

test('six authentic writer definitions are fingerprinted without row data or credentials', async () => {
  const manifest = JSON.parse(await readFile(writerManifestPath, 'utf8'));
  assert.equal(manifest.postgresServerVersionNum, '170006');
  assert.equal(manifest.rawDataIncluded, false);
  assert.equal(manifest.credentialsIncluded, false);
  assert.equal(manifest.entries.length, 6);
  assert.equal(new Set(manifest.entries.map((entry) => entry.signature)).size, 6);
  assert.ok(manifest.entries.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
  assert.ok(manifest.entries.every((entry) => entry.owner === 'postgres' && entry.securityDefiner === true));
  assert.ok(manifest.entries.every((entry) => entry.config.includes('search_path=""')));
  const source = await readFile(writersPath, 'utf8');
  assert.equal((source.match(/create or replace function/gi) || []).length, 6);
  assert.doesNotMatch(source, /(eyJ[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{16,}|postgres(?:ql)?:\/\/[^\s"']+|password\s*[:=]\s*['"][^'"]{6,}|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/i);
});

test('real PostgreSQL runner applies 3D.14 before the bridge and proves finite loopback-only setup', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const concurrency = await readFile(concurrencyPath, 'utf8');
  assert.ok(runner.indexOf("currentStage = 'apply 3D.14'") < runner.indexOf("currentStage = 'apply forward bridge migration'"));
  assert.match(runner, /server_version_num/);
  assert.match(runner, /170006/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /pr352_bridge_isolated/);
  assert.match(runner, /set_restaurant_transition_policy_v1/);
  assert.match(concurrency, /pg_locks/);
  assert.match(concurrency, /pg_stat_activity/);
  assert.match(concurrency, /statement_timeout|lock_timeout|timeout/);
  assert.match(concurrency, /finish\('commit;'\)/);
  assert.match(concurrency, /newWriteWaiting/);
  assert.match(runner, /SERVICE_ROLE|service_role|anon|authenticated/);
  assert.doesNotMatch(runner, /SUPABASE_ACCESS_TOKEN|SUPABASE_DB_PASSWORD/);
});

test('isolated workflow runs only on the exact QA push branch without secrets or dispatch', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  assert.match(workflow, /branches:\s*\n\s*-\s*qa\/pr352-real-bridge-pg176-r6-20261030/);
  assert.match(workflow, /permissions:\s*\n\s*contents:\s*read/);
  assert.match(workflow, /image:\s*postgres:17\.6/);
  assert.match(workflow, /PGHOST:\s*127\.0\.0\.1/);
  assert.match(workflow, /PGDATABASE:\s*pr352_bridge_isolated/);
  assert.doesNotMatch(workflow, /workflow_dispatch|pull_request_target|environment:\s*production|secrets\./i);
  assert.doesNotMatch(workflow, /supabase db push|migration fetch|vercel deploy|--prod/i);
  assert.match(workflow, /continue-on-error:\s*true/);
  assert.match(workflow, /upload-artifact/);
  assert.match(workflow, /postgresServerVersionNum !== "170006"/);
  assert.match(workflow, /overlay\.expectedLedgerRows !== 333/);
  assert.match(workflow, /real-bridge\.json/);
  assert.match(workflow, /synthetic-overlay\.json/);
  assert.doesNotMatch(workflow, /^\s{6}PR352_R6_EVIDENCE_DIR:/m, 'runner context is not valid in job-level env');
  assert.equal((workflow.match(/^\s{10}PR352_R6_EVIDENCE_DIR: \$\{\{ runner\.temp \}\}\/pr352-r6-evidence$/gm) || []).length, 2,
    'runner temp path must be scoped to the two steps that write JSON evidence');
});

test('synthetic overlay helper is self-contained and never embeds the remote ledger', async () => {
  const source = await readFile(overlayPath, 'utf8');
  assert.match(source, /synthetic-only/);
  assert.match(source, /canonicalLedgerRepresentation/);
  assert.match(source, /fingerprint mismatch/);
  assert.match(source, /drift detected/);
  assert.match(source, /exactly one approved candidate migration/);
  assert.match(source, /0700/);
  assert.doesNotMatch(source, /productionProjectRef|pr352-r5-production-ledger-fingerprint-manifest|DELETE\s+FROM/i);
});
