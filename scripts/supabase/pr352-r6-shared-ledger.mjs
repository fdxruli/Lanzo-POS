import assert from 'node:assert/strict';

const countsSql = `jsonb_build_object(
  'sales',(select count(*) from public.pos_sales),
  'payments',(select count(*) from public.pos_sale_payments),
  'inventory',(select count(*) from public.pos_inventory_movements),
  'cash',(select count(*) from public.pos_cash_movements),
  'credit',(select count(*) from public.pos_customer_ledger),
  'operations',(select count(*) from public.pos_financial_operations),
  'ledger',(select count(*) from public.pos_idempotency_keys))`;

// Reuse the existing authentic dispatcher/leaf fixture; change only its known
// synthetic identity prefix and capture its actual first/replay responses.
export function sharedLedgerProbeSql(source, phase) {
  assert.ok(['before', 'after'].includes(phase));
  assert.equal((source.match(/END \$test\$;/g) || []).length, 1);
  assert.match(source, /public\.pos_execute_financial_operation_v1\(/);
  assert.match(source, /PASS_ORDINARY_SALE_AND_REPLAY/);
  const prefix = `r627-${phase}-`;
  const body = source.replace(/^\\set ON_ERROR_STOP on\r?\n/, '')
    .replaceAll('lab-ordinary-', prefix)
    .replace('END $test$;', 'INSERT INTO pg_temp.r627_receipts VALUES (a,b); END $test$;')
    .replace(/SELECT 'PASS_ORDINARY_SALE_AND_REPLAY' result;\s*$/, '');
  const privateCounts = phase === 'before'
    ? `'privateTablesPresent',false,'proofRows',0,'attemptRows',0`
    : `'privateTablesPresent',true,
       'proofRows',(select count(*) from private.restaurant_order_upsert_replay_proofs_v1),
       'attemptRows',(select count(*) from private.restaurant_upsert_attempts_v1)`;
  return `BEGIN;
    SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s';
    CREATE TEMP TABLE r627_receipts(first_receipt jsonb,replay_receipt jsonb) ON COMMIT DROP;
    CREATE TEMP TABLE r627_counts AS SELECT ${countsSql} AS value;
    ${body}
    SELECT jsonb_build_object('phase','${phase}','backendPid',pg_backend_pid(),
      'transactionId',pg_current_xact_id()::text,'transactionScope','BEGIN_EFFECTS_THEN_ROLLBACK',
      'statementTimeout',current_setting('statement_timeout'),'lockTimeout',current_setting('lock_timeout'),
      'blockedBy',pg_blocking_pids(pg_backend_pid()),
      'receipt',r.first_receipt,'replayReceipt',r.replay_receipt,
      'countsBefore',(select value from pg_temp.r627_counts),'countsAfter',${countsSql},
      'stock',(select stock from public.pos_products where id='${prefix}product'),
      'saleTotal',(select total from public.pos_sales where id='${prefix}1'),
      'paymentTotal',(select sum(amount) from public.pos_sale_payments where sale_id='${prefix}1'),
      'ledgerRows',(select count(*) from public.pos_idempotency_keys where entity_id='${prefix}1'),
      'ledgerCompleted',(select bool_and(status='completed') from public.pos_idempotency_keys where entity_id='${prefix}1'),
      'ledgerReceiptValid',(select bool_and((response_payload->>'success')::boolean
        and response_payload->'sale'->>'id'='${prefix}1') from public.pos_idempotency_keys where entity_id='${prefix}1'),
      'operationRows',(select count(*) from public.pos_financial_operations where legacy_idempotency_key='${prefix}key'),
      'operationCompleted',(select bool_and(status='completed') from public.pos_financial_operations where legacy_idempotency_key='${prefix}key'),
      ${privateCounts})::text FROM pg_temp.r627_receipts r;
    ROLLBACK;`;
}

const securitySql = `select jsonb_build_object('owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
  'acl',(select coalesce(jsonb_agg(jsonb_build_array(a.grantor,a.grantee,a.privilege_type,a.is_grantable)
    order by a.grantor,a.grantee,a.privilege_type,a.is_grantable),'[]'::jsonb)
    from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a))::text
  from pg_class c where c.oid='public.pos_idempotency_keys'::regclass`;

export async function runSharedLedgerProbe({ query, source, phase }) {
  const countsBefore = JSON.parse(await query(`select ${countsSql}::text`));
  const privateTables = JSON.parse(await query(`select json_build_object(
    'proof',to_regclass('private.restaurant_order_upsert_replay_proofs_v1') is not null,
    'attempt',to_regclass('private.restaurant_upsert_attempts_v1') is not null)::text`));
  assert.deepEqual(privateTables, { proof: phase === 'after', attempt: phase === 'after' });
  const securityBefore = JSON.parse(await query(securitySql));
  const observation = JSON.parse(await query(sharedLedgerProbeSql(source, phase)));
  const countsAfterRollback = JSON.parse(await query(`select ${countsSql}::text`));
  const securityAfter = JSON.parse(await query(securitySql));
  const pendingSessions = Number(await query(`select count(*) from pg_stat_activity
    where datname=current_database() and pid<>pg_backend_pid()`));
  assert.deepEqual(countsAfterRollback, countsBefore, 'Probe transaction must leave no business or ledger rows');
  assert.deepEqual(securityAfter, securityBefore, 'Financial call must not change ledger privileges');
  assert.equal(pendingSessions, 0, 'Shared-ledger probe must leave no other sessions');
  return { ...observation, security: securityAfter, pendingSessions, rollbackVerified: true, status: 'PASS' };
}

export function sharedLedgerInvariants(row) {
  assert.ok(row && row.status === 'PASS');
  assert.ok(Number.isInteger(row.backendPid) && row.backendPid > 0);
  assert.match(row.transactionId, /^\d+$/);
  assert.equal(row.transactionScope, 'BEGIN_EFFECTS_THEN_ROLLBACK');
  assert.equal(row.rollbackVerified, true);
  assert.equal(row.statementTimeout, '8s'); assert.equal(row.lockTimeout, '2s');
  assert.deepEqual(row.blockedBy, []); assert.equal(row.pendingSessions, 0);
  assert.equal(row.privateTablesPresent, row.phase === 'after');
  assert.equal(row.proofRows, 0); assert.equal(row.attemptRows, 0);
  assert.equal(row.receipt?.success, true);
  assert.equal(row.receipt.mode, 'cloud_cashier_inventory');
  assert.equal(row.receipt.sale?.total, 20);
  assert.equal(row.receipt?.idempotency_key, `r627-${row.phase}-key`);
  assert.equal(row.receipt?.sale?.id, `r627-${row.phase}-1`);
  assert.deepEqual(row.replayReceipt, row.receipt);
  assert.equal(row.operationRows, 1); assert.equal(row.operationCompleted, true);
  assert.ok(Number.isInteger(row.ledgerRows) && row.ledgerRows > 0);
  assert.equal(row.ledgerCompleted, true); assert.equal(row.ledgerReceiptValid, true);
  assert.equal(row.stock, 18); assert.equal(row.saleTotal, 20); assert.equal(row.paymentTotal, 20);
  assert.equal(row.security?.owner, 'postgres'); assert.equal(row.security?.rls, true);
  assert.ok(Array.isArray(row.security?.acl) && row.security.acl.length > 0);
  const delta = Object.fromEntries(['sales','payments','inventory','cash','credit','operations','ledger'].map((key) => {
    assert.ok(Number.isInteger(row.countsBefore?.[key]) && row.countsBefore[key] >= 0);
    assert.ok(Number.isInteger(row.countsAfter?.[key]) && row.countsAfter[key] >= row.countsBefore[key]);
    return [key, row.countsAfter[key] - row.countsBefore[key]];
  }));
  for (const key of ['sales','payments','inventory','operations']) assert.equal(delta[key], 1);
  assert.equal(delta.credit, 0); assert.ok(delta.ledger > 0);
  // Compare the business contract, never generated UUIDs, folios or timestamps.
  return { delta, ledgerRows: row.ledgerRows, stock: row.stock, saleTotal: row.saleTotal,
    paymentTotal: row.paymentTotal, mode: row.receipt.mode, security: row.security };
}

export function compareSharedLedger(baseline, after, identity) {
  assert.equal(baseline.phase, 'before'); assert.equal(after.phase, 'after');
  assert.deepEqual(sharedLedgerInvariants(after), sharedLedgerInvariants(baseline),
    'Shared-ledger business invariants must not change after bridge installation');
  return { name: 'UNRELATED_LEDGER_BEFORE_AFTER', status: 'PASS', ...identity,
    baseline, after, comparisonExecuted: true, invariantsEqual: true };
}
