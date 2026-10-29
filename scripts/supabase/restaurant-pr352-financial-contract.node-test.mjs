import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bridge = readFileSync('supabase/migrations/20261010013257_restaurant_cloud_transition_bridge_v1.sql', 'utf8');
const supervision = readFileSync('supabase/migrations/20261010013258_restaurant_admin_supervision_r1.sql', 'utf8');
const historical3d14 = readFileSync('supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql', 'utf8');
const fixture = readFileSync('supabase/tests/fixtures/pr352_financial_dispatcher_context.sql', 'utf8');
const workflow = readFileSync('.github/workflows/pr352-financial-postgres.yml', 'utf8');
const scopedStorageWorkflow = readFileSync('.github/workflows/shared-terminal-actor-scoped-storage.yml', 'utf8');

function section(source, start, end) {
  const searchable = source.toLowerCase();
  const from = searchable.indexOf(start.toLowerCase());
  assert.notEqual(from, -1, `missing SQL section: ${start}`);
  const to = end ? searchable.indexOf(end.toLowerCase(), from + start.length) : source.length;
  assert.ok(!end || to !== -1, `missing SQL section terminator: ${end}`);
  return source.slice(from, to === -1 ? source.length : to);
}

test('bridge keeps xact admission first and never locks raw alias parents', () => {
  const admission = section(bridge, 'create function private.enter_restaurant_financial_transition_write_v1', '$function$;');
  assert.ok(admission.indexOf('pg_advisory_xact_lock_shared') < admission.indexOf('validate_pos_sync_context'));
  assert.match(admission, /if not \(select writes_paused[\s\S]*?then return; end if;/i);
  assert.match(admission, /RESTAURANT_CONTRACT_MAINTENANCE/);
  assert.doesNotMatch(admission, /lock_restaurant_order_settlement_v1|for update/i);
  assert.match(admission, /p_request#>>'\{sale,metadata,restaurant,parent_order_id\}'/);
});

test('dispatcher canonicalizes and reconciles identity before parent, cash and K/H locks', () => {
  const dispatcher = section(supervision,
    'CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1',
    'CREATE OR REPLACE FUNCTION public.pos_cancel_restaurant_order_from_pos_v1');
  const positions = [
    dispatcher.indexOf('canonical_financial_request_v1'),
    dispatcher.indexOf('RESTAURANT_ORDER_CONTEXT_MISMATCH'),
    dispatcher.indexOf('lock_restaurant_order_settlement_v1'),
    dispatcher.indexOf('assert_restaurant_table_actor_v1'),
    dispatcher.indexOf('for update'),
    dispatcher.indexOf('reserve_financial_operation_v1'),
    dispatcher.indexOf("if v_operation.status = 'completed' then"),
    dispatcher.indexOf('RESTAURANT_ORDER_SALE_RECONCILIATION_REQUIRED')
  ];
  assert.ok(positions.every(position => position >= 0), positions.join(','));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  for (const alias of ['splitParentId','split_parent_id','parentOrderId','parent_order_id','cloudSaleId','localSaleId']) {
    assert.ok(dispatcher.includes(alias), `missing financial alias ${alias}`);
  }
  for (const alias of [
    "'{sale,metadata,splitParentId}'", "'{sale,metadata,split_parent_id}'",
    "'{sale,metadata,restaurant,parentOrderId}'", "'{sale,metadata,restaurant,parent_order_id}'"
  ]) assert.ok(dispatcher.includes(alias), `missing nested parent alias guard ${alias}`);
  assert.match(dispatcher, /jsonb_set\(v_execution, '\{parent_order_id\}', to_jsonb\(v_restaurant_order_id\), true\)/);
});

test('financial effect routing for all operation types remains identical to 3D.14', () => {
  const dispatcherStart = 'CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1';
  const extractDispatchCase = source => {
    const start = source.toLowerCase().indexOf(dispatcherStart.toLowerCase());
    assert.notEqual(start, -1);
    const endMatch = /\n\$function\$\s*;/i.exec(source.slice(start));
    assert.ok(endMatch, 'missing dispatcher function terminator');
    const end = start + endMatch.index;
    const fn = source.slice(start, end);
    const caseStarts = [...fn.matchAll(/\n\s*case p_operation_type\s*\n/gi)];
    const caseStart = caseStarts.at(-1)?.index ?? -1;
    const caseEnd = caseStart < 0 ? -1 : fn.toLowerCase().indexOf('\n  end case;', caseStart);
    assert.ok(caseStart >= 0 && caseEnd > caseStart);
    return fn.slice(caseStart, caseEnd + '\n  end case;'.length).replace(/\s+/g, ' ').trim();
  };
  assert.equal(extractDispatchCase(supervision), extractDispatchCase(historical3d14));
});

test('candidate restores the metadata-aware 3D.14 guard and R2B has admission only', () => {
  const guard = section(supervision, 'CREATE OR REPLACE FUNCTION private.assert_restaurant_sale_dispatcher_context_v1',
    'CREATE OR REPLACE FUNCTION private.record_restaurant_intervention_v1');
  assert.match(guard, /metadata.*splitParentId/);
  assert.match(guard, /metadata.*split_parent_id/);
  assert.match(guard, /restaurant.*parentOrderId/);
  assert.match(guard, /restaurant.*parent_order_id/);
  assert.match(guard, /f\.status = 'processing'/);
  assert.match(guard, /k\.status = 'completed'/);
  assert.match(guard, /RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED/);
  assert.match(supervision, /REVOKE ALL ON FUNCTION private\.assert_restaurant_sale_dispatcher_context_v1\([^;]+service_role/s);
  const r2bStart = supervision.indexOf('CREATE OR REPLACE FUNCTION private.r2b_authorize_sale_financial_request_v1');
  const r2bEnd = supervision.indexOf('\nCREATE OR REPLACE FUNCTION ', r2bStart + 1);
  assert.notEqual(r2bStart, -1);
  assert.notEqual(r2bEnd, -1);
  const r2b = supervision.slice(r2bStart, r2bEnd);
  assert.match(r2b, /enter_restaurant_financial_transition_write_v1/);
  assert.doesNotMatch(r2b, /lock_restaurant_order_settlement_v1/);
  assert.match(historical3d14, /RESTAURANT_FINANCIAL_DISPATCHER_REQUIRED/);
});

test('3D.14 fixture overlay adds the missing guard columns without editing historical migration', () => {
  for (const column of ['license_id','local_sale_id','device_id','actor_key','cash_session_id','idempotency_key']) {
    assert.match(fixture, new RegExp(`\\b${column}\\b`));
  }
  for (const column of ['canonical_request','verified_actor_key','verified_device_id','verified_cash_session_id']) {
    assert.match(fixture, new RegExp(`\\b${column}\\b`));
  }
  assert.match(fixture, /drop table public\.pos_sales;[\s\S]*?create table public\.pos_sales/i);
  assert.match(fixture, /unique index pr352_financial_operations_key/i);
});

test('PostgreSQL CI targets PR352 on main and runs when the PR is retargeted', () => {
  const pullRequest = section(workflow, 'pull_request:', 'permissions:');
  assert.match(pullRequest, /types:\s*\[[^\]]*\bedited\b[^\]]*\]/i);
  assert.match(pullRequest, /branches:\s*\[main\]/i);
  assert.match(workflow, /if:\s*github\.event\.pull_request\.number\s*==\s*352/);
  assert.match(workflow, /image:\s*postgres:17\.11-bookworm/);
  assert.match(workflow, /permissions:\s*\r?\n\s+contents:\s*read/i);
  assert.doesNotMatch(workflow, /secrets\.|supabase db (?:push|reset)|vercel deploy/i);
});

test('Scoped Storage preserves the manual base_ref and pins PR runs to the base SHA', () => {
  const resolveBase = section(scopedStorageWorkflow, 'name: Checkout current base branch', 'fetch-depth: 1');
  assert.match(resolveBase, /github\.event\.pull_request\.base\.sha\s*\|\|\s*inputs\.base_ref\s*\|\|\s*github\.event\.repository\.default_branch/);
});
