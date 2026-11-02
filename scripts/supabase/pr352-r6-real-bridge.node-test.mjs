import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalizePostgresAcl } from './pr352-r6-canonical-postgres-acl.mjs';
import { assertEquivalentPreparationStationCatalog } from './pr352-r6-canonical-postgres-constraints.mjs';
import { assertRateLimitedRestaurantUpsertCatalog } from './pr352-r6-wrapper-catalog.mjs';
import { assertPsqlScriptRejection } from './pr352-r6-concurrency.mjs';
import { sharedLedgerProbeSql, sharedLedgerInvariants, compareSharedLedger, runSharedLedgerProbe } from './pr352-r6-shared-ledger.mjs';
import { priorOperations,candidateOperations,migrationSha256,sourceCommit,assertMigrationBytes,
  assertArchiveCheckEvidence,archiveInstallRollbackSql } from './pr352-r6-archive-check.mjs';
import { assertRestaurantOrderItemRelationship, restaurantOrderItemSnapshotSql, runPreparationStationBehavior } from './pr352-r6-preparation-station.mjs';
import './pr352-r6-concurrency-id.node-test.mjs';
import './pr352-r6-relationship-diagnostics.node-test.mjs';
import './pr352-r6-cancellation.node-test.mjs';
import './pr352-r6-financial-races.node-test.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bridgePath = path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql');
const threeD14Path = path.join(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql');
const writerManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-writer-fingerprints.json');
const dispatcherManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/dispatcher-fingerprint.json');
const writersPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-restaurant-writers.sql');
const restaurantDependenciesFixturePath = path.join(root, 'supabase/tests/fixtures/pr352-r6/restaurant-dependencies.sql');
const preparationStationManifestPath = path.join(root, 'supabase/tests/fixtures/pr352-r6/preparation-station-fingerprints.json');
const workflowPath = path.join(root, '.github/workflows/pr352-real-bridge-pg176-r6.yml');
const runnerPath = path.join(root, 'scripts/supabase/pr352-r6-real-bridge-pg176-test.mjs');
const preparationStationTestPath = path.join(root, 'scripts/supabase/pr352-r6-preparation-station.mjs');
const concurrencyPath = path.join(root, 'scripts/supabase/pr352-r6-concurrency.mjs');
const overlayPath = path.join(root, 'scripts/supabase/pr352-r6-synthetic-ledger-overlay.mjs');

// Controlled Node evidence, never a PostgreSQL execution result.
function syntheticArchiveChecks(identity) {
  return [['ARCHIVE_CHECK_BEFORE_MIGRATION','BASELINE_PRODUCTION_CURRENT',priorOperations,'archive'],
    ['ARCHIVE_CHECK_AFTER_MIGRATION','CANDIDATE_SCHEMA_AFTER_MIGRATION',candidateOperations,'r635_invalid_operation']]
    .map(([name,schema,operations,rejectedOperation])=>({name,status:'PASS',...identity,
      schema,sourceCommit,migrationSha256,serverVersionNum:'170006',
      catalog:{type:'c',validated:true,
        definition:`CHECK (operation = ANY (ARRAY[${operations.map(x=>"'"+x+"'::text").join(', ')}]))`},
      allowedOperations:[...operations],recorder:{accepted:operations.length,rejectedSqlstate:'23514'},
      rejectedOperation,rowsAndSecurityUnchanged:true,rollbackObservedFromIndependentConnections:true,
      ...(name==='ARCHIVE_CHECK_AFTER_MIGRATION'?{rejectedMigrations:
        ['missing-check','unknown-check','unvalidated-check','top-level-install-rollback'].map(name=>({name,exitCode:3,sqlstate:'P0001'}))}:{})}));
}

test('archive installation rollback probe preserves literal PostgreSQL dollar quotes',async()=>{
  const source=await readFile(path.join(root,'docs/evidence/20261101235323_repair_pos_sync_archive_operation_contract.sql'),'utf8');
  const generated=archiveInstallRollbackSql(source);
  assert.equal(generated,source.replace(/commit;\s*$/,()=>
    "do $$ begin raise exception 'R635_FORCED_INSTALL_ROLLBACK' using errcode='P0001'; end $$;\ncommit;"));
  assert.match(generated,/do \$\$ begin raise exception 'R635_FORCED_INSTALL_ROLLBACK' using errcode='P0001'; end \$\$;\ncommit;$/);
  assert.doesNotMatch(generated,/do \$ begin/);
  assert.equal((generated.match(/\$\$/g)||[]).length,2);
  assert.equal(generated.slice(0,source.lastIndexOf('commit;')),source.slice(0,source.lastIndexOf('commit;')));
  assert.throws(()=>archiveInstallRollbackSql('select 1;'));
});

test('archive repair QA SQL matches the reviewed canonical SHA and rejects tampering',async()=>{
  const copy=await readFile(path.join(root,'docs/evidence/20261101235323_repair_pos_sync_archive_operation_contract.sql'));
  assert.equal(createHash('sha256').update(copy).digest('hex'),
    '9e89b368be660dd31a975a5afd87082944bb0601f045c33be6e134476e2cf5ab');
  assertMigrationBytes(copy);
  assert.match(await readFile(path.join(root,'.gitattributes'),'utf8'),
    /^docs\/evidence\/20261101235323_repair_pos_sync_archive_operation_contract\.sql text eol=lf$/m);
  assert.throws(()=>assertMigrationBytes(Buffer.concat([copy,Buffer.from('\n')])));
  assert.equal(priorOperations.length,18);assert.deepEqual(candidateOperations,[...priorOperations,'archive']);
  assert.equal(new Set(candidateOperations).size,19);
  assert.equal(existsSync(path.join(root,'supabase/migrations/20261101235323_repair_pos_sync_archive_operation_contract.sql')),false);
});

test('archive CHECK evidence requires both unique phases, exact operations, SQL rejection and run identity',()=>{
  const identity={commitSha:'a'.repeat(40),runId:'123',runAttempt:'1'};
  const good=syntheticArchiveChecks(identity); assert.doesNotThrow(()=>assertArchiveCheckEvidence(good,identity));
  for(const phase of [0,1]) {
    assert.throws(()=>assertArchiveCheckEvidence(good.filter((_,i)=>i!==phase),identity));
    assert.throws(()=>assertArchiveCheckEvidence([...good,structuredClone(good[phase])],identity));
    for(const mutate of [c=>{c.allowedOperations.pop();},c=>{c.allowedOperations.push('bogus');},
      c=>{c.catalog.validated=false;},c=>{c.catalog.definition+=' OR true';},c=>{c.recorder.rejectedSqlstate='00000';},
      c=>{c.recorder.accepted=0;},c=>{c.migrationSha256='0'.repeat(64);},c=>{c.sourceCommit='0'.repeat(40);},
      c=>{c.commitSha='b'.repeat(40);},c=>{c.runId='other';},c=>{c.runAttempt='2';},c=>{c.status='NOT_RUN';},
      c=>{c.rowsAndSecurityUnchanged=false;},c=>{c.rollbackObservedFromIndependentConnections=false;}]) {
      const bad=structuredClone(good);mutate(bad[phase]);assert.throws(()=>assertArchiveCheckEvidence(bad,identity));
    }
  }
});

test('archive CHECK runtime contract precedes bridge and archive replay retains the original financial matrices',async()=>{
  const source=await readFile(runnerPath,'utf8');
  assert.ok(source.indexOf('completedChecks.push(await runArchiveContractRepair')<source.indexOf("currentStage = 'verify bridge ACL"));
  assert.match(source,/onBefore:check=>completedChecks\.push\(check\)/);
  assert.match(source,/completedChecks\.push\(await assertArchiveReplay/);
  const helper=await readFile(path.join(root,'scripts/supabase/pr352-r6-archive-check.mjs'),'utf8');
  assert.ok(helper.indexOf('assertMigrationBytes(bytes)')<helper.indexOf('const beforeCatalog='));
  assert.match(helper,/rollback;`/);assert.match(helper,/exception when check_violation/);
  assert.match(helper,/error\.code,3/);assert.match(helper,/ERROR:\\\\s\+P0001/);
  assert.match(helper,/assert\.deepEqual\(await snapshot\(\),before/);
  assert.match(helper,/persisted\.events,1/);
});

// Controlled Node input for the validator, never a PostgreSQL observation.
function syntheticSharedLedger(phase) {
  const receipt = { success: true, mode: 'cloud_cashier_inventory',
    idempotency_key: `r627-${phase}-key`, sale: { id: `r627-${phase}-1`, total: 20 } };
  const empty = { sales:0,payments:0,inventory:0,cash:0,credit:0,operations:0,ledger:0 };
  const security = {owner:'postgres',rls:true,acl:[[10,10,'SELECT',false]]};
  return { phase, status: 'PASS', backendPid: phase === 'before' ? 601 : 602, transactionId: '900',
    sqlCompleted:true,countsBeforeProbe:structuredClone(empty),countsAfterRollback:structuredClone(empty),securityBefore:structuredClone(security),
    queries:{operationLookup:`select count(*) from public.pos_financial_operations where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key='r627-${phase}-key'`},
    operation:{licenseId:'00000000-0000-0000-0000-000000000001',externalKey:`r627-${phase}-key`,operationType:'sale.cashier_inventory',status:'completed',receiptSuccess:true},
    transactionScope: 'BEGIN_EFFECTS_THEN_ROLLBACK', rollbackVerified: true,
    statementTimeout:'8s',lockTimeout:'2s',blockedBy:[],pendingSessions:0,
    receipt, replayReceipt: structuredClone(receipt), privateTablesPresent: phase === 'after', proofRows: 0, attemptRows: 0,
    countsBefore: { sales:0,payments:0,inventory:0,cash:0,credit:0,operations:0,ledger:0 },
    countsAfter: { sales:1,payments:1,inventory:1,cash:1,credit:0,operations:1,ledger:2 },
    stock:18,saleTotal:20,paymentTotal:20,ledgerRows:2,ledgerCompleted:true,ledgerReceiptValid:true,
    operationRows:1,operationCompleted:true,security };
}

test('shared ledger baseline runs the authentic fixture in bounded rollback transactions around bridge installation', async () => {
  const source = await readFile(path.join(root,'supabase/tests/fixtures/pr338-real-financial/ordinary-sale.sql'),'utf8');
  for (const phase of ['before','after']) {
    const sql = sharedLedgerProbeSql(source, phase);
    assert.match(sql,/^BEGIN;/); assert.match(sql,/ROLLBACK;$/);
    assert.match(sql,/statement_timeout='8s'/); assert.match(sql,/lock_timeout='2s'/);
    assert.equal((sql.match(/public\.pos_execute_financial_operation_v1\(/g)||[]).length,2);
    assert.match(sql,/pg_temp\.r627_receipts VALUES \(a,b\)/);
    assert.ok(sql.includes(`r627-${phase}-key`)); assert.ok(!sql.includes('lab-ordinary-'));
    assert.equal(sql.includes('from private.restaurant_upsert_attempts_v1'),phase==='after');
    assert.ok(!/insert into public\.pos_idempotency_keys/i.test(sql));
  }
  const runner=await readFile(runnerPath,'utf8');
  assert.ok(runner.indexOf("phase: 'before'") < runner.indexOf("await runFile(bridgePath, 'bridge-v1')"));
  assert.ok(runner.indexOf("phase: 'after'") > runner.indexOf("await runFile(bridgePath, 'bridge-v1')"));
});

test('shared ledger invariant comparison rejects financial drift, invalid receipts and private residue', () => {
  const baseline=syntheticSharedLedger('before'), after=syntheticSharedLedger('after');
  assert.doesNotThrow(()=>compareSharedLedger(baseline,after,{}));
  for(const mutate of [row=>{row.countsAfter.sales=2;},row=>{row.countsAfter.cash=2;},
    row=>{row.receipt.sale.total=21;},row=>{row.replayReceipt.success=false;},
    row=>{row.proofRows=1;},row=>{row.attemptRows=1;},row=>{row.ledgerReceiptValid=false;},
    row=>{row.security.rls=false;},row=>{row.security.acl.push([10,0,'SELECT',false]);},
    row=>{row.rollbackVerified=false;},row=>{row.operation.licenseId='00000000-0000-0000-0000-000000000002';},
    row=>{row.operation.externalKey='foreign-key';},row=>{row.operation.operationType='cash.open';},
    row=>{row.operation.status='processing';},row=>{row.operationCompleted=false;},
    row=>{delete row.receipt;},row=>{row.receipt.success=false;},row=>{row.operation.receiptSuccess=false;},
    row=>{row.ledgerRows=0;},row=>{delete row.countsBeforeProbe;},row=>{delete row.queries;},
    row=>{row.queries.operationLookup=row.queries.operationLookup.replace('and idempotency_key=','and legacy_idempotency_key=');},
    row=>{row.sqlCompleted=false;}]) {
    const changed=structuredClone(after); mutate(changed);
    assert.throws(()=>compareSharedLedger(baseline,changed,{}));
  }
  assert.throws(()=>sharedLedgerInvariants(null));
  assert.throws(()=>compareSharedLedger(baseline,undefined,{}));
});

test('shared ledger driver retains observed data and confirmed rollback on a later assertion failure', async () => {
  const source=await readFile(path.join(root,'supabase/tests/fixtures/pr338-real-financial/ordinary-sale.sql'),'utf8');
  const row=syntheticSharedLedger('after');
  const changedSecurity={...row.security,rls:false};
  const replies=[row.countsBefore,{proof:true,attempt:true},row.security,row,row.countsBefore,changedSecurity,0];
  let calls=0;
  await assert.rejects(runSharedLedgerProbe({source,phase:'after',identity:{runId:'123'},baseline:syntheticSharedLedger('before'),
    query:async()=>JSON.stringify(replies[calls++])}),error=>{
    assert.equal(calls,7);
    const check=error.sharedLedgerCheck;
    assert.equal(check.status,'FAIL');assert.equal(check.runId,'123');
    assert.equal(check.after.status,'FAIL');assert.equal(check.after.phase,'after');
    assert.equal(check.after.sqlCompleted,true);assert.equal(check.after.rollbackVerified,true);
    assert.deepEqual(check.after.operation,row.operation);assert.deepEqual(check.after.receipt,row.receipt);
    assert.deepEqual(check.after.security,changedSecurity);assert.equal(check.comparisonExecuted,false);
    assert.match(check.failedAssertion,/privileges/);
    return true;
  });
});

test('shared ledger driver preserves partial before snapshot without asserting unconfirmed SQL or rollback', async () => {
  const source=await readFile(path.join(root,'supabase/tests/fixtures/pr338-real-financial/ordinary-sale.sql'),'utf8');
  const row=syntheticSharedLedger('before');let calls=0;
  const replies=[row.countsBefore,{proof:false,attempt:false},row.security];
  await assert.rejects(runSharedLedgerProbe({source,phase:'before',query:async()=>{
    if(calls===3){calls++;throw new Error('controlled SQL/client failure');}
    return JSON.stringify(replies[calls++]);
  }}),error=>{
    assert.equal(calls,4);const check=error.sharedLedgerCheck;
    assert.equal(check.status,'FAIL');assert.equal(check.after,null);
    assert.equal(check.baseline.phase,'before');assert.equal(check.baseline.status,'FAIL');
    assert.equal(check.baseline.queryAttempted,true);assert.equal(check.baseline.sqlCompleted,false);
    assert.equal(check.baseline.rollbackVerified,false);
    assert.deepEqual(check.baseline.countsBeforeProbe,row.countsBefore);
    assert.deepEqual(check.baseline.securityBefore,row.security);
    assert.match(check.baseline.queries.operationLookup,/idempotency_key='r627-before-key'/);
    assert.equal(check.comparisonExecuted,false);return true;
  });
});

test('shared-ledger probe resolves the external operation key in its authentic financial namespace', async () => {
  const sources=JSON.parse(await readFile(path.join(root,'supabase/tests/fixtures/pr338-real-financial/02-function-sources.json'),'utf8'));
  const reserve=sources.find(source=>source.startsWith('CREATE OR REPLACE FUNCTION private.reserve_financial_operation_v1('));
  assert.ok(reserve);
  assert.match(reserve,/o\.idempotency_key = p_idempotency_key/);
  assert.match(reserve,/p_license_id, p_idempotency_key, v_internal_idempotency_key, p_request_hash/);
  const source=await readFile(path.join(root,'supabase/tests/fixtures/pr338-real-financial/ordinary-sale.sql'),'utf8');
  for(const phase of ['before','after']) {
    const sql=sharedLedgerProbeSql(source,phase);
    const operationQueries=[...sql.matchAll(/from public\.pos_financial_operations where ([^)]+)/g)];
    assert.equal(operationQueries.length,3);
    for(const [,where] of operationQueries) {
      assert.ok(where.includes("license_id='00000000-0000-0000-0000-000000000001'::uuid"));
      assert.ok(where.includes(`and idempotency_key='r627-${phase}-key'`));
      assert.ok(!where.includes('legacy_idempotency_key'));
    }
  }
  const baseline=syntheticSharedLedger('before'), after=syntheticSharedLedger('after');
  after.operationRows=0;
  assert.throws(()=>compareSharedLedger(baseline,after,{runId:'123'}),error=>{
    assert.equal(error.sharedLedgerCheck.status,'FAIL');
    assert.equal(error.sharedLedgerCheck.after,after);
    assert.equal(error.sharedLedgerCheck.baseline,baseline);
    assert.equal(error.sharedLedgerCheck.runId,'123');
    assert.equal(error.sharedLedgerCheck.invariantsEqual,false);
    return true;
  });
  const runner=await readFile(runnerPath,'utf8');
  assert.match(runner,/if \(error\.sharedLedgerCheck\) completedChecks\.push\(error\.sharedLedgerCheck\)/);
});

test('stdin psql rejection requires script exit 3 and the exact PostgreSQL error', () => {
  const valid = { code: 3, signal: null, spawnError: null,
    stderr: 'ERROR: P0001: RESTAURANT_ORDER_VERSION_CONFLICT' };
  assert.doesNotThrow(() => assertPsqlScriptRejection(valid, 'RESTAURANT_ORDER_VERSION_CONFLICT'));
  for (const code of [0, 1, 2, null]) {
    assert.throws(() => assertPsqlScriptRejection({ ...valid, code }, 'RESTAURANT_ORDER_VERSION_CONFLICT'));
  }
  for (const mutation of [{ signal: 'SIGTERM' }, { spawnError: new Error('spawn failed') },
    { stderr: 'ERROR: 23505: RESTAURANT_ORDER_VERSION_CONFLICT' }, { stderr: 'ERROR: P0001: OTHER_ERROR' },
    { stderr: 'ERROR: P0001: RESTAURANT_ORDER_VERSION_CONFLICT_EXTRA' },
    { stderr: 'ERROR: P0001: OTHER_ERROR\nCONTEXT: RESTAURANT_ORDER_VERSION_CONFLICT' },
    { stderr: valid.stderr+'\n'+valid.stderr }, { stdout: '{"success":true}' }]) {
    assert.throws(() => assertPsqlScriptRejection({ ...valid, ...mutation }, 'RESTAURANT_ORDER_VERSION_CONFLICT'));
  }
});

test('archived replay setup rejects unpaid archival then uses authentic cancel and archive without bypassing the guard', async () => {
  const runner=await readFile(runnerPath,'utf8');
  const block=runner.slice(runner.indexOf('  const archivedReceipt ='),runner.indexOf('  const physicallyDeletedReceipt ='));
  const rejected=block.indexOf("'P0001','RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED'");
  const cancelled=block.indexOf('select public.pos_cancel_restaurant_order_from_pos_v1(');
  const archived=block.indexOf('select public.pos_archive_restaurant_order_unlimited(');
  const tombstone=block.indexOf('set deleted_at=clock_timestamp(),checkout_closed_at=clock_timestamp()');
  const replay=block.indexOf('const archivedReplay =');
  const syntheticReplay=block.indexOf('const syntheticReplay =');
  assert.ok(rejected>0 && cancelled>rejected && archived>cancelled && replay>archived && tombstone>replay && syntheticReplay>tombstone);
  assert.match(block,/set role anon; select public\.pos_cancel_restaurant_order_from_pos_v1/);
  assert.match(block,/set role service_role; select public\.pos_archive_restaurant_order_unlimited/);
  assert.match(block,/assert\.equal\(archivedCancellation\.success,true\)/);
  assert.match(block,/assert\.equal\(archivedResult\.success,true\)/);
  assert.match(block,/assert\.deepEqual\(archivedAfterReplay,archivedBeforeReplay/);
  assert.match(block,/assertTerminalSnapshot\(archivedBeforeReplay,archivedReceipt,false\)/);
  assert.match(block,/assertTerminalSnapshot\(syntheticBeforeReplay,archivedReceipt,true\)/);
  assert.match(block,/assertTerminalArchiveRejection\(invalidArchiveError,archivedSeedState,afterInvalidArchive\)/);
  assert.ok(!/disable trigger|session_replication_role|insert into private\.restaurant.*permits/i.test(block));
  const bridge=await readFile(bridgePath,'utf8');
  const guard=bridge.slice(bridge.indexOf('create or replace function private.guard_restaurant_bridge_parent_v1()'));
  assert.ok(guard.indexOf("old.status='cancelled'")<guard.indexOf('if (new.archived_at is not null'));
  assert.match(guard,/RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED.*errcode='P0001'/);
  const versioned=bridge.slice(bridge.indexOf('create function public.pos_upsert_restaurant_order_versioned_v1('));
  const terminalOrder=versioned.slice(versioned.indexOf('  if o.id is not null then'),versioned.indexOf('  -- Global line identities'));
  assert.ok(terminalOrder.indexOf("raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED'")
    < terminalOrder.indexOf("raise exception 'RESTAURANT_ORDER_NOT_ACTIVE'"));
  assert.match(block,/'P0001','RESTAURANT_ORDER_ALREADY_CANCELLED','new write against cancelled and authentically archived parent'/);
  assert.match(block,/'P0001','RESTAURANT_ORDER_ALREADY_CANCELLED','new write against cancelled parent with synthetic tombstone/);
  const manifest=JSON.parse(await readFile(writerManifestPath,'utf8'));
  assert.match(manifest.entries.find(row=>row.signature.startsWith('public.pos_archive_restaurant_order_unlimited(')).acl,/service_role=X/);
  assert.match(manifest.entries.find(row=>row.signature.startsWith('public.pos_cancel_restaurant_order_from_pos_v1(')).acl,/anon=X/);
});

async function terminalAssertions() {
  const source=await readFile(runnerPath,'utf8');
  const pure=source.slice(source.indexOf('function assertTerminalSnapshot('),source.indexOf('async function writeEvidence('));
  return Function('assert',pure+';return {assertTerminalSnapshot,assertTerminalNoFinancialChange,assertTerminalArchiveRejection};')(assert);
}

function syntheticTerminalSnapshot() {
  const receipt={success:true,idempotency_key:'bridge-r20-archived-terminal-key',order:{id:'internal-terminal-parent'}};
  const license='00000000-0000-0000-0000-000000000001';
  return {receipt,snapshot:{state:{parent:{id:receipt.order.id},ledgerRowsForKey:1,proofRowsForKey:1,pendingAttempts:0,
    sales:0,cashMovements:0,inventoryMovements:0,customerLedger:0,financialOperations:0},
    detail:{parent:{id:receipt.order.id,local_order_id:'bridge-r20-archived-terminal',license_id:license,
      status:'cancelled',fulfillment_status:'cancelled',cancelled_at:'synthetic-cancel-time',archived_at:'synthetic-archive-time',
      payment_status:'unpaid',paid_at:null,paid_sale_id:null,deleted_at:null,checkout_closed_at:null},
      items:[{id:'item-terminal',restaurant_order_id:receipt.order.id,license_id:license,status:'cancelled'}],
      ledger:{license_id:license,idempotency_key:receipt.idempotency_key,operation_type:'restaurant_order.upsert',
        entity_id:receipt.order.id,status:'completed',response_payload:structuredClone(receipt)},
      proof:{license_id:license,idempotency_key:receipt.idempotency_key,restaurant_order_id:receipt.order.id,
        local_order_id:'bridge-r20-archived-terminal',actor_type:'admin',actor_id:'00000000-0000-0000-0000-0000000000aa',
        device_id:'00000000-0000-0000-0000-00000000000a',request_sha256:'a'.repeat(64),response_sha256:'b'.repeat(64)},
      responseShaMatches:true,events:[{id:'event-terminal'}],payments:0,productStock:20,permits:0,pendingSessions:0}}};
}

test('terminal snapshot validator distinguishes archive-only from synthetic markers and rejects invalid proofs or states', async () => {
  const {assertTerminalSnapshot,assertTerminalNoFinancialChange}=await terminalAssertions();
  const {receipt,snapshot}=syntheticTerminalSnapshot();
  assert.doesNotThrow(()=>assertTerminalSnapshot(snapshot,receipt,false));
  const nullableUnpaid=structuredClone(snapshot);nullableUnpaid.detail.parent.payment_status=null;
  assert.doesNotThrow(()=>assertTerminalSnapshot(nullableUnpaid,receipt,false));
  for(const status of ['paid','partial','',undefined]) {
    const invalid=structuredClone(snapshot);invalid.detail.parent.payment_status=status;
    assert.throws(()=>assertTerminalSnapshot(invalid,receipt,false));
  }
  const marked=structuredClone(snapshot);marked.detail.parent.deleted_at='synthetic';marked.detail.parent.checkout_closed_at='synthetic';
  assert.doesNotThrow(()=>assertTerminalSnapshot(marked,receipt,true));
  assert.throws(()=>assertTerminalSnapshot(marked,receipt,false));
  for(const mutate of [s=>{s.detail.parent.status='pending';},s=>{s.detail.parent.archived_at=null;},
    s=>{s.detail.items[0].status='pending';},s=>{s.detail.parent.license_id='other';},
    s=>{s.detail.ledger.response_payload.success=false;},s=>{s.detail.proof.request_sha256='bad';},
    s=>{s.detail.proof.device_id='other';},s=>{s.detail.responseShaMatches=false;},
    s=>{s.state.pendingAttempts=1;},s=>{s.detail.permits=1;},s=>{s.state.proofRowsForKey=0;},s=>{s.detail.pendingSessions=1;}]) {
    const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>assertTerminalSnapshot(changed,receipt,false));
  }
  assert.throws(()=>assertTerminalSnapshot(null,receipt,false));
  assert.doesNotThrow(()=>assertTerminalNoFinancialChange(snapshot,structuredClone(snapshot)));
  for(const mutate of [s=>{s.state.sales++;},s=>{s.detail.payments++;},s=>{s.detail.productStock--;},s=>{delete s.state.inventoryMovements;}]) {
    const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>assertTerminalNoFinancialChange(snapshot,changed));
  }
});

test('terminal archive rejection requires the observed SQLSTATE and exact message plus an unchanged full snapshot', async () => {
  const {assertTerminalArchiveRejection}=await terminalAssertions();
  const {snapshot}=syntheticTerminalSnapshot();
  Object.assign(snapshot.detail.parent,{status:'pending',fulfillment_status:'pending',cancelled_at:null,archived_at:null});
  snapshot.detail.items[0].status='pending';
  const error={sqlstate:'P0001',message:'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED',stderr:'ERROR:  P0001: RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED\n'};
  assert.doesNotThrow(()=>assertTerminalArchiveRejection(error,snapshot,structuredClone(snapshot)));
  const nullableUnpaid=structuredClone(snapshot);nullableUnpaid.detail.parent.payment_status=null;
  assert.doesNotThrow(()=>assertTerminalArchiveRejection(error,nullableUnpaid,structuredClone(nullableUnpaid)));
  // Preserve raw NULL in comparisons: accepting the unpaid contract does not
  // permit changing NULL to a string, or accepting paid/unknown/missing state.
  assert.throws(()=>assertTerminalArchiveRejection(error,nullableUnpaid,snapshot));
  for(const status of ['paid','partial','',undefined]) {
    const invalid=structuredClone(snapshot);invalid.detail.parent.payment_status=status;
    assert.throws(()=>assertTerminalArchiveRejection(error,invalid,structuredClone(invalid)));
  }
  for(const field of ['paid_at','paid_sale_id']) {
    const invalid=structuredClone(snapshot);invalid.detail.parent[field]='paid-marker';
    assert.throws(()=>assertTerminalArchiveRejection(error,invalid,structuredClone(invalid)));
  }
  for(const mutation of [{sqlstate:'42501'},{message:'OTHER_ERROR'},
    {stderr:'ERROR: P0001: RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED_EXTRA\n'},
    {stderr:'ERROR: 42501: RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED\n'}]) {
    assert.throws(()=>assertTerminalArchiveRejection({...error,...mutation},snapshot,structuredClone(snapshot)));
  }
  for(const mutate of [s=>{s.detail.items[0].status='cancelled';},s=>{s.detail.payments++;},
    s=>{s.detail.events.push({id:'extra'});},s=>{s.detail.proof.request_sha256='c'.repeat(64);},s=>{s.detail.ledger.status='processing';}]) {
    const changed=structuredClone(snapshot);mutate(changed);assert.throws(()=>assertTerminalArchiveRejection(error,snapshot,changed));
  }
  assert.throws(()=>assertTerminalArchiveRejection(error,null,null));
});

// This small scanner is intentionally limited to function-call argument lists
// in the SQL strings below. It tracks SQL string literals and nested calls so
// source assertions stay tied to the p_order argument, not nearby p_items SQL.
function readSqlCallArguments(source, callStart) {
  const open = source.indexOf('(', callStart);
  assert.ok(open >= 0, 'SQL function call must have an opening parenthesis');
  const args = [];
  let depth = 1;
  let inString = false;
  let start = open + 1;

  for (let index = open + 1; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (character === "'" && source[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
    } else if (character === '(') {
      depth += 1;
    } else if (character === ')') {
      depth -= 1;
      if (depth === 0) {
        args.push(source.slice(start, index).trim());
        return args;
      }
    } else if (character === ',' && depth === 1) {
      args.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  throw new Error('Unterminated SQL function call in bridge QA runner');
}

const countOccurrences = (source, needle) => source.split(needle).length - 1;

test('bridge candidate stays out of the canonical migration set and runs after 3D.14', async () => {
  const sql = await readFile(bridgePath, 'utf8');
  assert.equal(existsSync(path.join(root, 'supabase/migrations/20261030182733_restaurant_cloud_transition_bridge_v1.sql')), false);
  assert.equal(existsSync(path.join(root, 'supabase/tests/fixtures/pr352-r6/bridge-v1-candidate.sql')), false);
  assert.match(sql, /BRIDGE_REQUIRES_3D14_DISPATCHER_GUARD/);
  assert.match(sql, /BRIDGE_REQUIRED_FUNCTION_MISSING/);
  assert.match(sql, /BRIDGE_FUNCTION_OVERLOAD_UNSUPPORTED/);
  assert.match(sql, /BRIDGE_FUNCTION_SECURITY_DRIFT/);
  assert.match(sql, /pg_get_functiondef\(target_oid\)/);
  assert.match(sql, /private\.pr352_r6_outer_begin_position_v1/);
  assert.match(sql, /private\.pr352_r6_inject_writer_admission_v1/);
  assert.doesNotMatch(sql, /definition:=regexp_replace\(definition/,
    'Writer admission must not use an unbounded regular expression over deparsed SQL');
  for (const lexicalState of ['line_comment', 'block_comment', 'single_quote', 'double_quote', 'dollar_quote']) {
    assert.ok(sql.includes(`v_state='${lexicalState}'`), `PostgreSQL scanner must handle ${lexicalState}`);
  }
  assert.match(sql, /BRIDGE_DOUBLE_INJECTION_UNEXPECTEDLY_ALLOWED/);
  assert.match(sql, /BRIDGE_WRITER_BODY_MATCH_AMBIGUOUS/);
  assert.match(sql, /BRIDGE_WRITER_BODY_UNSUPPORTED: no unambiguous outer BEGIN/);
  assert.match(sql, /first\\nBEGIN\\nlast/);
  assert.match(sql, /\$literal\$first\\nBEGIN\\nlast\$literal\$/);
  assert.match(sql, /v_value text;\\nbegin\\n\\tperform 1;/);
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

test('Staff bridge authorization matches validate_pos_sync_context session fields', async () => {
  const sql = await readFile(bridgePath, 'utf8');
  const functionSources = JSON.parse(await readFile(
    path.join(root, 'supabase/tests/fixtures/pr338-real-financial/02-function-sources.json'), 'utf8'));
  const validator = functionSources.find((source) => /CREATE OR REPLACE FUNCTION private\.validate_pos_sync_context\(/i.test(source));
  assert.ok(validator, 'The reviewed auth context function must be present in the PostgreSQL fixture');
  assert.match(validator, /'actor_session_id',\s*v_actor_session_id/);
  assert.doesNotMatch(validator, /'staff_session_id'/,
    'validate_pos_sync_context exports the validated Staff session as actor_session_id');

  const staffGuard = sql.match(/create function private\.assert_restaurant_bridge_actor_v1\([\s\S]*?\$function\$;/i)?.[0];
  assert.ok(staffGuard, 'The bridge actor guard must be present');
  assert.match(staffGuard, /nullif\(c->>'staff_user_id',''\)\s+is distinct from c->>'actor_id'/);
  assert.match(staffGuard, /nullif\(c->>'actor_id',''\)\s+is null/);
  assert.match(staffGuard, /nullif\(c->>'actor_session_id',''\)\s+is null/);
  assert.doesNotMatch(staffGuard, /c->>'staff_session_id'/,
    'The guard must not read a Staff session field that the validated context does not return');
});

test('Cocina fixture matches production station schema and helper function fingerprints', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const fixture = await readFile(restaurantDependenciesFixturePath, 'utf8');
  const manifest = JSON.parse(await readFile(preparationStationManifestPath, 'utf8'));
  assert.match(runner, /Production-matched synthetic Cocina schema and functions/);
  assert.match(runner, /assertEquivalentPreparationStationCatalog\(preparationStationActual,/);
  assert.match(runner, /table:\s*preparationStationManifest\.table,[\s\S]*?functions:\s*preparationStationManifest\.functions/);
  assert.match(fixture, /create table public\.pos_preparation_stations\s*\(/i);
  assert.match(fixture, /alter table public\.pos_preparation_stations enable row level security/i);
  assert.match(fixture, /grant all on table public\.pos_preparation_stations to service_role/i);
  assert.match(fixture, /create unique index pos_preparation_stations_license_code_uidx/i);
  assert.match(fixture, /create unique index pos_preparation_stations_license_name_key_uidx/i);
  assert.match(fixture, /references public\.license_devices\(id\) on delete set null/i);
  assert.match(fixture, /references public\.license_staff_users\(id\) on delete set null/i);
  assert.match(fixture, /references public\.licenses\(id\) on delete cascade/i);
  assert.match(fixture, /returns public\.pos_preparation_stations\s+language plpgsql\s+security definer\s+set search_path to ''/i);
  assert.match(fixture, /select \* into v_station[\s\S]*?for update;/i);
  assert.match(fixture, /exception when unique_violation then[\s\S]*?where license_id = p_license_id[\s\S]*?and code = 'kitchen'/i);
  assert.match(fixture, /create or replace function private\.resolve_restaurant_order_station/i);
  assert.match(fixture, /perform private\.ensure_default_preparation_station\(p_license_id, p_device_id, p_staff_user_id\)/);
  assert.match(fixture, /revoke all on function private\.ensure_default_preparation_station\(uuid,uuid,uuid\)\s+from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(fixture, /returns void\s+language plpgsql\s+security definer[\s\S]*?begin\s+return;\s+end;/i,
    'The prior no-op helper must not remain as the writer dependency');
  assert.equal(manifest.source.rawRowsIncluded, false);
  assert.equal(manifest.source.credentialsIncluded, false);
  assert.equal(manifest.table.columns.length, 18);
  assert.equal(manifest.table.constraints.length, 9);
  assert.equal(manifest.table.indexes.length, 5);
  assert.equal(manifest.table.acl, 'postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres');
  assert.equal(manifest.functions.length, 6);
  assert.equal(manifest.functions.find((fn) => fn.signature.startsWith('private.ensure_default')).bodySha256,
    'e1066fb33e7d039894e7e00a72022c60aa8bfd6d76ffe66588660ca1915cf354');
  for (const name of ['is_restaurant_order_status', 'normalize_restaurant_order_status', 'safe_jsonb_numeric']) {
    assert.ok(manifest.functions.some((fn) => fn.signature.startsWith(`private.${name}(`)),
      `Missing authentic direct writer helper ${name}`);
  }
  for (const fn of manifest.functions) {
    const start = fixture.indexOf(`CREATE OR REPLACE FUNCTION ${fn.signature.split('(')[0]}`);
    assert.ok(start >= 0, `Missing source function ${fn.signature}`);
    const delimiter = 'AS $function$\n';
    const bodyStart = fixture.indexOf(delimiter, start);
    assert.ok(bodyStart >= 0, `Missing function body delimiter ${fn.signature}`);
    const bodyEnd = fixture.indexOf('\n$function$;', bodyStart + delimiter.length);
    assert.ok(bodyEnd >= 0, `Missing function body end ${fn.signature}`);
    const exactProsrc = `\n${fixture.slice(bodyStart + delimiter.length, bodyEnd)}\n`;
    assert.equal(createHash('sha256').update(exactProsrc).digest('hex'), fn.bodySha256,
      `The fixture body must match the read-only Production prosrc hash: ${fn.signature}`);
  }
});

test('station behavior test covers independent PG sessions and Cocina invariants A-H', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const testSource = await readFile(preparationStationTestPath, 'utf8');
  assert.equal(typeof runPreparationStationBehavior, 'function', 'The imported PostgreSQL behavior suite must parse and load in CI');
  for (const name of [
    'A/G: first authenticated Staff write creates and attributes Kitchen',
    'B: active station reuse and authentic resolver fallback',
    'C: inactive station reactivation',
    'D: incomplete station fields repaired without rewriting metadata',
    'E: concurrent creation, independent psql sessions',
    'F: different licenses keep distinct default stations',
    'H: failed transaction rolls back station initialization',
  ]) assert.ok(testSource.includes(name), `Missing runtime Cocina assertion ${name}`);
  assert.match(runner, /runPreparationStationBehavior\(\{ query, runSql, psqlBin, env \}\)/);
  assert.match(testSource, /assertRestaurantOrderItemRelationship\(itemSnapshot/);
  assert.match(runner, /statementBatch\.endsWith\(';'\)/);
  assert.match(testSource, /spawn\(psqlBin/);
  assert.match(testSource, /'-h', '127\.0\.0\.1'/);
  assert.match(testSource, /'-d', 'pr352_bridge_isolated'/);
  assert.match(testSource, /child\.stdin\.end\(\)/);
  assert.match(testSource, /pg_stat_activity/);
  assert.match(testSource, /pg_locks/);
  assert.match(testSource, /wait_event_type/);
  assert.match(testSource, /controller\.finish\('COMMIT;'\)/);
  assert.match(testSource, /finally\s*\{[\s\S]*?controller\.finish\('ROLLBACK;'\)/);
  assert.match(testSource, /pendingConcurrencySessions/);
});

test('Staff parent and item evidence rejects missing, duplicate, cross-license and wrong-key rows', () => {
  const expected = { licenseId: 'license-a', localOrderId: 'local-order', localLineId: 'local-line' };
  const valid = {
    parents: [{ id: 'internal-order', licenseId: 'license-a', localOrderId: 'local-order', deletedAt: null }],
    items: [{ id: 'item-a', licenseId: 'license-a', parentId: 'internal-order', localLineId: 'local-line',
      stationCode: 'kitchen', stationName: 'Cocina', deletedAt: null }],
    joinedItems: [{ id: 'item-a', parentId: 'internal-order', licenseId: 'license-a' }],
    deletedParents: [], deletedItems: [],
  };
  assert.equal(assertRestaurantOrderItemRelationship(valid, expected).itemId, 'item-a');
  const changed = (edit) => { const value = JSON.parse(JSON.stringify(valid)); edit(value); return value; };
  const failures = [
    ['missing parent', (v) => { v.parents = []; }, /parent missing/],
    ['duplicate parents', (v) => { v.parents.push({ ...v.parents[0], id: 'internal-order-2' }); }, /Duplicate Restaurant parents/],
    ['wrong local order', (v) => { v.parents[0].localOrderId = 'other-local'; }, /incorrect local order ID/],
    ['wrong parent license', (v) => { v.parents[0].licenseId = 'license-b'; }, /parent has an inconsistent license/],
    ['deleted parent', (v) => { v.parents[0].deletedAt = '2026-01-01'; }, /parent must be active/],
    ['missing item', (v) => { v.items = []; v.joinedItems = []; }, /item is missing/],
    ['wrong local line', (v) => { v.items[0].localLineId = 'other-line'; }, /item is missing/],
    ['duplicate expected line', (v) => { v.items.push({ ...v.items[0], id: 'item-b' }); }, /Duplicate expected Restaurant order items/],
    ['item under another parent', (v) => { v.items[0].parentId = 'other-parent'; v.joinedItems = []; }, /incorrect parent foreign key/],
    ['item with another license', (v) => { v.items[0].licenseId = 'license-b'; v.joinedItems = []; }, /item has an inconsistent license/],
    ['deleted item', (v) => { v.items[0].deletedAt = '2026-01-01'; }, /item must be active/],
    ['extra item under parent', (v) => { v.items.push({ ...v.items[0], id: 'item-b', localLineId: 'other-line' }); }, /Duplicate or unexpected active items/],
    ['join on local order ID', (v) => { v.joinedItems = []; }, /internal-ID and license join/],
    ['wrong station', (v) => { v.items[0].stationCode = 'bar'; }, /assigned to kitchen/],
    ['wrong station name', (v) => { v.items[0].stationName = 'Bar'; }, /Cocina station name/],
  ];
  for (const [name, edit, message] of failures) {
    assert.throws(() => assertRestaurantOrderItemRelationship(changed(edit), expected), message, name);
  }

  const sql = restaurantOrderItemSnapshotSql('00000000-0000-0000-0000-000000000001', 'local-order', 'local-line');
  const requireSafeJoin = (statement) => {
    assert.match(statement, /where license_id='00000000-0000-0000-0000-000000000001'::uuid and local_order_id='local-order' and deleted_at is null/);
    assert.match(statement, /from public\.pos_restaurant_order_items\s+where deleted_at is null/);
    assert.match(statement, /local_line_id='local-line' and license_id='00000000-0000-0000-0000-000000000001'::uuid/);
    assert.match(statement, /on p\.id=i\.restaurant_order_id and p\.license_id=i\.license_id/);
    assert.doesNotMatch(statement, /\blimit\s+1\b|\bcoalesce\s*\(/i);
  };
  requireSafeJoin(sql);
  assert.throws(() => requireSafeJoin(sql.replace('p.id=i.restaurant_order_id', 'p.local_order_id=i.restaurant_order_id')));
  assert.throws(() => requireSafeJoin(sql.replace('p.license_id=i.license_id', 'true')));
  assert.throws(() => requireSafeJoin(sql.replace("license_id='00000000-0000-0000-0000-000000000001'::uuid and ", '')));
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

test('PostgreSQL ACL comparisons ignore display order but preserve the exact grant set', async () => {
  const expected = '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}';
  const actual = '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}';
  assert.deepEqual(canonicalizePostgresAcl(actual), canonicalizePostgresAcl(expected));
  const expectedSet = canonicalizePostgresAcl(expected);
  const driftCases = [
    ['missing grant', '{postgres=X/postgres,anon=X/postgres,authenticated=X/postgres}'],
    ['additional role', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres,unexpected=X/postgres}'],
    ['different grantee', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,other_role=X/postgres}'],
    ['different grantor', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/other_grantor}'],
    ['different privilege', '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=U/postgres}'],
    ['grant option drift', '{postgres=X*/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'],
    ['PUBLIC confused with a named role', '{=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'],
  ];
  for (const [description, acl] of driftCases) {
    assert.notDeepEqual(canonicalizePostgresAcl(acl), expectedSet, description);
  }

  const duplicateGrant = canonicalizePostgresAcl('{postgres=X/postgres,postgres=X/postgres}');
  assert.equal(duplicateGrant.length, 2, 'Duplicate ACL entries must not be silently removed');
  assert.notDeepEqual(duplicateGrant, canonicalizePostgresAcl('{postgres=X/postgres}'));

  const quotedIdentifiers = String.raw`{"\"role,with,comma\"=X/postgres","\"role\"\"quoted\"=X/postgres"}`;
  const quotedIdentifiersReordered = String.raw`{"\"role\"\"quoted\"=X/postgres","\"role,with,comma\"=X/postgres"}`;
  assert.deepEqual(canonicalizePostgresAcl(quotedIdentifiers), [
    '"role""quoted"=X/postgres', '"role,with,comma"=X/postgres',
  ]);
  assert.deepEqual(canonicalizePostgresAcl(quotedIdentifiers), canonicalizePostgresAcl(quotedIdentifiersReordered),
    'Quoted and escaped identifiers must survive array decoding while order is ignored');
  assert.notDeepEqual(canonicalizePostgresAcl(quotedIdentifiers),
    canonicalizePostgresAcl(String.raw`{"\"other,role\"=X/postgres","\"role\"\"quoted\"=X/postgres"}`),
    'A quoted grantee change must remain visible');

  assert.deepEqual(canonicalizePostgresAcl('<default>'), ['<default>']);
  assert.throws(() => canonicalizePostgresAcl('not-an-acl'), /brace-delimited array literal/);
  assert.throws(() => canonicalizePostgresAcl(null), /brace-delimited array literal/);
  const runner = await readFile(runnerPath, 'utf8');
  assert.match(runner, /canonicalizePostgresAcl\(liveDispatcher\.acl\)/);
  assert.match(runner, /canonicalizePostgresAcl\(actual\.acl\)/);
  assert.match(runner, /canonicalizePostgresAcl\(after\.acl\)/);
  assert.match(runner, /writerChecks,/);
  assert.match(runner, /adminOff: adminOffEvidence/);
  assert.match(runner, /const adminState = JSON\.parse\(await query/);
  assert.match(runner, /adminOffEvidence\.status = 'PASS'/);
  assert.doesNotMatch(runner, /adminOffEvidence = \{ status: 'PASS', contractVersion:/,
    'Admin OFF evidence must be derived from executed PostgreSQL observations');
  assert.match(runner, /originalFingerprint:/);
  assert.match(runner, /postBridgeFingerprint:/);
  assert.match(runner, /bodyRecoveredExactly:/);
  assert.match(runner, /firstTextDifference/);
  assert.doesNotMatch(runner, /after\.definition\.replace\(insertion, '\\n'\)/,
    'Post-bridge comparison must remove only the injected guard without normalizing original SQL');
});

test('full Cocina catalog comparison accepts only the named default CHECK text-cast rendering', async () => {
  const manifest = JSON.parse(await readFile(preparationStationManifestPath, 'utf8'));
  const expected = {
    table: manifest.table,
    triggers: manifest.triggers,
    policies: manifest.policies,
    functions: manifest.functions,
  };
  const cloneExpected = () => JSON.parse(JSON.stringify(expected));
  const kitchenCheck = (catalog) => catalog.table.constraints.find((constraint) =>
    constraint.name === 'pos_preparation_stations_default_code');
  const actualWithRenderedCast = cloneExpected();
  kitchenCheck(actualWithRenderedCast).definition = "CHECK (is_default IS FALSE OR code = 'kitchen'::text)";
  assert.doesNotThrow(() => assertEquivalentPreparationStationCatalog(actualWithRenderedCast, expected));
  assert.doesNotThrow(() => assertEquivalentPreparationStationCatalog(cloneExpected(), expected),
    'The exact uncast definition remains valid too');

  const negativeCatalogs = [
    ['different literal', (catalog) => { kitchenCheck(catalog).definition = "CHECK (is_default IS FALSE OR code = 'bar'::text)"; }],
    ['different operator', (catalog) => { kitchenCheck(catalog).definition = "CHECK (is_default IS FALSE OR code <> 'kitchen'::text)"; }],
    ['different column', (catalog) => { kitchenCheck(catalog).definition = "CHECK (is_default IS FALSE OR name = 'kitchen'::text)"; }],
    ['empty literal', (catalog) => { kitchenCheck(catalog).definition = "CHECK (is_default IS FALSE OR code = ''::text)"; }],
    ['missing default flag predicate', (catalog) => { kitchenCheck(catalog).definition = "CHECK (code = 'kitchen'::text)"; }],
    ['AND substituted for OR', (catalog) => { kitchenCheck(catalog).definition = "CHECK (is_default IS FALSE AND code = 'kitchen'::text)"; }],
    ['additional CHECK expression', (catalog) => { catalog.table.constraints.push({ name: 'unexpected_check', type: 'c', definition: 'CHECK (true)' }); }],
    ['missing CHECK constraint', (catalog) => { catalog.table.constraints = catalog.table.constraints.filter((constraint) => constraint.name !== 'pos_preparation_stations_default_code'); }],
    ['duplicate CHECK constraint', (catalog) => { catalog.table.constraints.push({ ...kitchenCheck(catalog) }); }],
    ['renamed CHECK constraint', (catalog) => { kitchenCheck(catalog).name = 'different_default_code'; }],
    ['changed foreign key', (catalog) => { catalog.table.constraints.find((constraint) => constraint.type === 'f').definition = 'FOREIGN KEY (license_id) REFERENCES other_table(id)'; }],
    ['missing index', (catalog) => { catalog.table.indexes.pop(); }],
    ['changed index predicate', (catalog) => { catalog.table.indexes.find((index) => index.name === 'pos_preparation_stations_license_active_idx').definition = 'CREATE INDEX pos_preparation_stations_license_active_idx ON public.pos_preparation_stations USING btree (license_id, is_active) WHERE (deleted_at IS NOT NULL)'; }],
    ['different code type', (catalog) => { catalog.table.columns.find((column) => column.name === 'code').type = 'character varying'; }],
    ['changed ACL', (catalog) => { catalog.table.acl = 'postgres=arwdDxtm/postgres'; }],
    ['RLS disabled', (catalog) => { catalog.table.rlsEnabled = false; }],
    ['changed helper fingerprint', (catalog) => { catalog.functions[0].bodySha256 = '0'.repeat(64); }],
  ];
  for (const [description, mutate] of negativeCatalogs) {
    const actual = cloneExpected();
    kitchenCheck(actual).definition = "CHECK (is_default IS FALSE OR code = 'kitchen'::text)";
    mutate(actual);
    assert.throws(() => assertEquivalentPreparationStationCatalog(actual, expected), undefined, description);
  }

  const alteredExpected = cloneExpected();
  kitchenCheck(alteredExpected).definition = "CHECK (is_default IS FALSE OR code = 'bar')";
  assert.throws(() => assertEquivalentPreparationStationCatalog(actualWithRenderedCast, alteredExpected),
    undefined, 'The expected manifest must not be broadened to justify the live catalog');
});

test('rate-limited wrapper catalog comparator binds exact Production identity and rejects altered catalog rows', async () => {
  const manifest = JSON.parse(await readFile(path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.json'), 'utf8'));
  const wrapperSql = await readFile(path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.sql'), 'utf8');
  const body = wrapperSql.match(/AS \$function\$(.*?)\$function\$;/s)?.[1];
  assert.equal(typeof body, 'string', 'Synthetic wrapper fixture must expose the captured prosrc body');
  const expected = manifest.entry;
  const authenticRow = {
    signature: expected.signature,
    returnType: expected.returnType,
    language: expected.language,
    owner: expected.owner,
    security_definer: expected.securityDefiner,
    config: expected.config,
    acl: expected.acl,
    source: body,
  };
  assert.doesNotThrow(() => assertRateLimitedRestaurantUpsertCatalog([authenticRow], expected));

  const catalogNegatives = [
    ['return type text', (row) => { row.returnType = 'text'; }],
    ['language other than plpgsql', (row) => { row.language = 'sql'; }],
    ['incorrect signature', (row) => { row.signature = 'public.pos_upsert_restaurant_order(text,text)'; }],
    ['altered owner', (row) => { row.owner = 'authenticated'; }],
    ['SECURITY DEFINER disabled', (row) => { row.security_definer = false; }],
    ['incorrect search_path', (row) => { row.config = ['search_path=public']; }],
    ['altered ACL', (row) => { row.acl = '{postgres=X/postgres,anon=X/postgres}'; }],
    ['altered function body', (row) => { row.source = `${row.source} -- altered`; }],
  ];
  for (const [description, mutate] of catalogNegatives) {
    const row = structuredClone(authenticRow);
    mutate(row);
    assert.throws(() => assertRateLimitedRestaurantUpsertCatalog([row], expected), undefined, description);
  }
  assert.throws(() => assertRateLimitedRestaurantUpsertCatalog([], expected), undefined, 'missing wrapper');
  assert.throws(() => assertRateLimitedRestaurantUpsertCatalog([authenticRow, authenticRow], expected), undefined,
    'duplicate wrapper signature');
  for (const field of ['returnType', 'language', 'signature', 'owner', 'securityDefiner', 'config', 'acl', 'prosrcSha256']) {
    const alteredManifest = structuredClone(expected);
    if (field === 'config') alteredManifest[field] = ['search_path=public'];
    else if (field === 'acl') alteredManifest[field] = '{postgres=X/postgres}';
    else if (field === 'prosrcSha256') alteredManifest[field] = '0'.repeat(64);
    else if (field === 'securityDefiner') alteredManifest[field] = false;
    else alteredManifest[field] = 'unexpected';
    assert.throws(() => assertRateLimitedRestaurantUpsertCatalog([authenticRow], alteredManifest), undefined,
      `altered manifest ${field}`);
  }
});

test('real PostgreSQL runner applies 3D.14 before the bridge and proves finite loopback-only setup', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const concurrency = await readFile(concurrencyPath, 'utf8');
  const clientWrapper = await readFile(path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.sql'), 'utf8');
  const clientWrapperManifest = JSON.parse(await readFile(path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.json'), 'utf8'));
  assert.ok(runner.indexOf("currentStage = 'apply 3D.14'") < runner.indexOf("currentStage = 'apply forward bridge migration'"));
  assert.match(runner, /rateLimitedUpsertWrapperFixture[\s\S]*runFile\(rateLimitedUpsertWrapperFixture/);
  assert.match(runner, /pg_catalog\.format_type\(p\.prorettype,\s*NULL\)/);
  assert.match(runner, /join pg_language l on l\.oid=p\.prolang/i);
  assert.match(runner, /assertRateLimitedRestaurantUpsertCatalog\(rateLimitedUpsert,\s*rateLimitedUpsertManifest\.entry\)/);
  assert.match(clientWrapper, /CREATE OR REPLACE FUNCTION public\.pos_upsert_restaurant_order\(/i);
  assert.match(clientWrapper, /public\.enforce_pos_rpc_rate_limit_v2/);
  assert.match(clientWrapper, /public\.pos_upsert_restaurant_order_unlimited/);
  assert.equal(clientWrapperManifest.entry.signature, 'public.pos_upsert_restaurant_order(text,text,text,text,jsonb,jsonb,text)');
  assert.equal(clientWrapperManifest.entry.returnType, 'jsonb');
  assert.equal(clientWrapperManifest.entry.language, 'plpgsql');
  assert.equal(clientWrapperManifest.entry.prosrcSha256, '9e7512bfed56993512f48f6f88bdcda1ee89701f01c262af3d1b3a42e191a8c0');
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
  assert.match(runner, /commitSha:\s*process\.env\.GITHUB_SHA\s*\?\?\s*null/);
  assert.match(runner, /runId:\s*process\.env\.GITHUB_RUN_ID\s*\?\?\s*null/);
  assert.match(runner, /runAttempt:\s*process\.env\.GITHUB_RUN_ATTEMPT\s*\?\?\s*null/);
  assert.match(runner, /VERBOSITY=verbose/);
  assert.match(runner, /denialSqlstate: match\[1\]/);
  assert.match(runner, /denialMessage: match\[2\]/);
  assert.match(runner, /assert\.deepEqual\(stateAfterDenial, adminState/);
  assert.doesNotMatch(runner, /passed\(`admin-off-private-setter-denied-\$\{role\}`,\s*\{\s*role,\s*denialSqlstate:\s*'42501'/,
    'Runtime role evidence must contain SQLSTATE read from PostgreSQL, not a fixed pass value');
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
  assert.match(workflow, /EXPECTED_EXECUTION_SHA:\s*\$\{\{ github\.sha \}\}/);
  assert.match(workflow, /EXPECTED_RUN_ID:\s*\$\{\{ github\.run_id \}\}/);
  assert.match(workflow, /EXPECTED_RUN_ATTEMPT:\s*\$\{\{ github\.run_attempt \}\}/);
  assert.match(workflow, /bridge\.commitSha !== expectedSha \|\| overlay\.commitSha !== expectedSha/);
  assert.match(workflow, /bridge\.writerChecks\.length !== 10/);
  assert.match(workflow, /writer\.bodyRecoveredExactly === true && writer\.oidPreserved === true/);
  assert.match(workflow, /state\.activeActivationRows === 0/);
  for (const check of ['admin-off-initial-state', 'admin-off-contract-response', 'admin-off-setter-rejected-no-state-change',
    'admin-off-private-setter-denied-anon', 'admin-off-private-setter-denied-authenticated']) {
    assert.ok(workflow.includes(check), `evidence gate must require the executed check ${check}`);
  }
  assert.match(workflow, /contractResponse\.adminSupervisionAvailable !== false/);
  assert.match(workflow, /setterAttempt\.errorMessage !== "RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE"/);
  assert.match(workflow, /roleMatrix\.authenticatedCanExecuteSetter !== false/);
  assert.match(workflow, /bridge\.concurrency\.length !== 4/);
  assert.match(workflow, /overlay\.cases\.length !== overlay\.caseCount/);
  assert.match(workflow, /overlay\.productionConnections !== 0 \|\| overlay\.cleanupFailures !== 0/);
  assert.doesNotMatch(workflow, /^\s{6}PR352_R6_EVIDENCE_DIR:/m, 'runner context is not valid in job-level env');
  assert.equal((workflow.match(/^\s{10}PR352_R6_EVIDENCE_DIR: \$\{\{ runner\.temp \}\}\/pr352-r6-evidence$/gm) || []).length, 2,
    'runner temp path must be scoped to the two steps that write JSON evidence');
});

test('original Restaurant writes and the empty-response regression preserve mapper source and actor coverage', async () => {
  const runner = await readFile(runnerPath, 'utf8');
  const mapper = await readFile(path.join(root, 'src/services/restaurant/restaurantOrderMapper.js'), 'utf8');
  const writers = await readFile(writersPath, 'utf8');
  const orderSchema = await readFile(path.join(root, 'supabase/tests/fixtures/restaurant_origin_cancel_3d13_setup.sql'), 'utf8');
  assert.match(mapper, /source:\s*'tables'/,
    'Use the exact source value emitted by the production Restaurant order mapper');
  assert.match(writers, /nullif\(btrim\(coalesce\(p_order->>'source'\s*,\s*''\)\)\s*,\s*''\)/,
    'The authentic writer must continue passing explicit NULL when source is absent');
  assert.match(orderSchema, /source\s+text\s+not null\s+default\s+'pos'/i,
    'The schema default does not apply to the writer\'s explicit NULL');

  const expectedCalls = [
    { scenario: 'concurrency seed', functionName: 'pos_upsert_restaurant_order_unlimited', args: ["'lab-license-a'", "'lab-device-a'", "'lab-device-token-a'", "'lab-admin-session'"] },
    { scenario: 'Staff owner', functionName: 'pos_upsert_restaurant_order_unlimited', args: ["'lab-license-a'", "'lab-device-b'", "'lab-device-token-b'", "'lab-staff-session'"] },
    { scenario: 'Admin non-owner', functionName: 'pos_upsert_restaurant_order_unlimited', args: ["'lab-license-a'", "'lab-device-a'", "'lab-device-token-a'", "'lab-admin-session'"] },
    { scenario: 'Staff non-owner', functionName: 'pos_upsert_restaurant_order_unlimited', args: ["'lab-license-a'", "'lab-device-c'", "'lab-device-token-c'", "'lab-staff-session-c'"] },
    { scenario: 'invalid session', functionName: 'pos_upsert_restaurant_order_unlimited', args: ["'lab-license-a'", "'lab-device-b'", "'lab-device-token-b'", "'wrong-session'"] },
    { scenario: 'legacy client', functionName: 'pos_upsert_restaurant_order_unlimited', args: ["'lab-license-a'", "'lab-device-a'", "'lab-device-token-a'", "'lab-admin-session'"] },
    { scenario: 'versioned client', functionName: 'pos_upsert_restaurant_order_versioned_v1', args: ["'lab-license-a'", "'lab-device-a'", "'lab-device-token-a'", "'lab-admin-session'"] },
    { scenario: 'unsuccessful empty writer response', functionName: 'pos_upsert_restaurant_order_versioned_v1', args: ["'lab-license-a'", "'lab-device-a'", "'lab-device-token-a'", "'lab-admin-session'"] },
  ];
  const matches = [...runner.matchAll(/(?:select|perform)\s+public\.(pos_upsert_restaurant_order(?:_unlimited|_versioned_v1))\s*\(/g)];
  assert.equal(matches.length, expectedCalls.length, 'Every original call and the new negative writer response must remain under review');

  for (const [index, match] of matches.entries()) {
    const expected = expectedCalls[index];
    const args = readSqlCallArguments(runner, match.index + match[0].lastIndexOf('('));
    assert.equal(match[1], expected.functionName, `${expected.scenario} must keep its original RPC`);
    assert.deepEqual(args.slice(0, 4), expected.args, `${expected.scenario} credentials and actor session must not drift`);

    const orderArgument = args[4];
    assert.match(orderArgument, /^jsonb_build_object\s*\(/i, `${expected.scenario} source must be in p_order`);
    const orderPairs = readSqlCallArguments(orderArgument, 0);
    const sourceKeyPositions = orderPairs
      .map((argument, pairIndex) => argument === "'source'" ? pairIndex : -1)
      .filter((pairIndex) => pairIndex >= 0);
    assert.equal(sourceKeyPositions.length, 1, `${expected.scenario} p_order must contain source exactly once`);
    assert.equal(orderPairs[sourceKeyPositions[0] + 1], "'tables'",
      `${expected.scenario} p_order must carry the mapper's exact source value`);
    assert.ok(!args[5].includes("'source'"), `${expected.scenario} source must not be added to p_items`);
  }

  assert.equal(countOccurrences(runner,
    "if state<>'P0001' or message<>'RESTAURANT_TABLE_OWNER_REQUIRED' then raise; end if;"), 2,
    'Admin and non-owning Staff legacy fixtures must each continue to be rejected by the ownership rule');
  assert.match(runner, /if state<>'P0001' or message<>'ACTOR_SESSION_INVALID' then raise; end if;/,
    'The invalid-session case must reject for the authentication failure, not an unrelated error');
  const capturedFunctions = JSON.parse(await readFile(path.join(root, 'supabase/tests/fixtures/pr338-real-financial/02-function-sources.json'), 'utf8'));
  const sessionValidator = capturedFunctions.find((source) => /FUNCTION private\.validate_pos_sync_context\(/i.test(source));
  assert.ok(sessionValidator, 'The captured session validator must exist');
  assert.match(sessionValidator, /raise exception 'ACTOR_SESSION_INVALID' using errcode = 'P0001'/i,
    'The expected authentication error must match the captured server validator');
  assert.match(runner, /where local_order_id='bridge-invalid-session-parent'\"\), '0'/,
    'Invalid-session rejection must leave no order row');
  assert.match(runner, /const legacyUpsertSql = `set role service_role;/,
    'Legacy route must retain its original service_role execution context');
  assert.match(runner, /const versionedUpsertSql = `set role anon;/,
    'Versioned route must retain its original anon execution context');
  assert.match(runner, /public\.pos_upsert_restaurant_order_versioned_v1\(/,
    'The harness must keep invoking the real versioned wrapper');
});

test('private insertion witness is scoped to the active call and cannot certify a prior receipt', async () => {
  const source = await readFile(bridgePath,'utf8');
  const check = (sql) => {
    const upsert=sql.match(/create function public\.pos_upsert_restaurant_order_versioned_v1\([\s\S]*?\$function\$;/i)?.[0];
    const observer=sql.match(/create function private\.observe_restaurant_upsert_insert_v1\([\s\S]*?\$function\$;/i)?.[0];
    assert.ok(upsert && observer);
    assert.doesNotMatch(upsert,/\.xmin|into\s+idem\s*,/i,'No tuple/top-XID equality or composite/scalar INTO');
    assert.match(sql,/create trigger restaurant_upsert_insert_witness_v1 after insert on public\.pos_idempotency_keys/i);
    assert.match(sql,/alter table private\.restaurant_upsert_attempts_v1 enable row level security/i);
    assert.match(sql,/revoke all on private\.restaurant_upsert_attempts_v1 from public,anon,authenticated,service_role/i);
    assert.match(sql,/revoke all on function private\.observe_restaurant_upsert_insert_v1\(\) from public,anon,authenticated,service_role/i);
    assert.match(observer,/a\.transaction_id=pg_catalog\.pg_current_xact_id\(\)/);
    assert.match(observer,/a\.license_id=new\.license_id and a\.idempotency_key=new\.idempotency_key/);
    assert.match(observer,/a\.request_hash=new\.request_hash and a\.inserted_entity_id is null/);
    assert.match(observer,/new\.operation_type='restaurant_order\.upsert' and new\.entity_type='restaurant_order'/);
    assert.doesNotMatch(observer,/(?:insert into|update|delete from) public\./i,'Observer must not write the shared ledger');
    const intent=upsert.indexOf('insert into private.restaurant_upsert_attempts_v1');
    const writer=upsert.indexOf('response:=public.pos_upsert_restaurant_order_unlimited(');
    const proof=upsert.indexOf('insert into private.restaurant_order_upsert_replay_proofs_v1');
    assert.ok(intent>upsert.indexOf('return idem.response_payload;') && writer>intent && proof>writer);
    assert.match(upsert,/a\.attempt_id=v_attempt_id/);
    assert.match(upsert,/if not found or v_inserted_entity_id is null then[\s\S]*?raise exception 'IDEMPOTENCY_CONFLICT'/);
    assert.match(upsert,/select i\.\* into idem[\s\S]*?for update;\s*if not found or idem\.entity_id is distinct from v_inserted_entity_id/);
    assert.equal((upsert.match(/delete from private\.restaurant_upsert_attempts_v1/g)||[]).length,2,
      'Both an unsuccessful leaf response and successful proof mint must consume the attempt');
    assert.ok(upsert.lastIndexOf('delete from private.restaurant_upsert_attempts_v1')>proof);
  };
  check(source);
  assert.throws(()=>check(source.replace('a.transaction_id=pg_catalog.pg_current_xact_id()','true')));
  assert.throws(()=>check(source.replace('a.request_hash=new.request_hash and a.inserted_entity_id is null','true')));
  assert.throws(()=>check(source.replace('if not found or v_inserted_entity_id is null then','if false then')));
  assert.throws(()=>check(source.replace('a.attempt_id=v_attempt_id','true')));
});

test('provenance diagnosis and legacy races must execute before the replay evidence can pass', async () => {
  const runner=await readFile(runnerPath,'utf8');
  const races=await readFile(concurrencyPath,'utf8');
  for(const key of ['topLevelXid','observedLedgerXmin','ledgerStatus','operation','writerSuccess','sameTopLevelXid',
    'ledgerPresent','completed','operationMatches','entityMatches','md5Matches','receiptMatches','parentMatches','failedPredicates']) {
    assert.ok(runner.includes(key),'Missing diagnostic predicate '+key);
  }
  assert.match(runner,/provenanceDiagnostic = JSON\.parse[\s\S]*?rollback;/);
  assert.match(runner,/captureVersionedOrderState\('bridge-r25-diagnostic','bridge-r25-diagnostic-key'\),diagnosticBefore/);
  assert.match(runner,/xidProbe\.proofs,1/);
  assert.match(runner,/xidProbe\.pendingAttempts,0/);
  assert.doesNotMatch(runner,/sameTransaction:true/,'XID equality must not be an acceptance criterion');
  for(const name of ['legacy-first-same-parent','versioned-first-legacy-same-parent','legacy-first-cross-parent','foreign-completed-receipt-no-insert']) {
    assert.ok(runner.includes(name) && races.includes(name),'Missing independent scenario '+name);
  }
  assert.ok(runner.indexOf('legacyProvenanceResults = await runLegacyProvenanceRaces')<runner.indexOf('  idempotencyEvidence = {'));
  assert.match(races,/blockedBy\.includes\(holderPid\)/);
  assert.match(races,/assert\.notEqual\(wait\.pid,holderPid\)/);
  assert.match(races,/No prior receipt may escape/);
  assert.match(races,/pendingDatabaseSessions:pending/);
});

test('R20 replay path binds a completed receipt without weakening auth, rate limits, or version guards', async () => {
  const bridge = await readFile(path.join(root, 'docs/evidence/20261030182733_restaurant_cloud_transition_bridge_v1.sql'), 'utf8');
  const runner = await readFile(runnerPath, 'utf8');
  const concurrency = await readFile(path.join(root, 'scripts/supabase/pr352-r6-concurrency.mjs'), 'utf8');
  const wrapperSnapshot = await readFile(path.join(root, 'supabase/tests/fixtures/pr352-r6/verified-rate-limited-upsert-wrapper.sql'), 'utf8');
  const functionMatch = bridge.match(/create function public\.pos_upsert_restaurant_order_versioned_v1\([\s\S]*?\$function\$;/i);
  assert.ok(functionMatch, 'The exact versioned bridge function must be present');
  const upsert = functionMatch[0];

  assert.ok(wrapperSnapshot.indexOf('public.enforce_pos_rpc_rate_limit_v2(')
    < wrapperSnapshot.indexOf('public.pos_upsert_restaurant_order_unlimited('),
  'The versioned route must preserve the read-only Production wrapper’s rate-limit-before-writer order');

  assert.match(bridge, /create table private\.restaurant_order_upsert_replay_proofs_v1[\s\S]*?references public\.pos_idempotency_keys\(license_id,idempotency_key\) on delete cascade/i);
  assert.match(bridge, /alter table private\.restaurant_order_upsert_replay_proofs_v1 enable row level security/i);
  assert.match(bridge, /revoke all on private\.restaurant_order_upsert_replay_proofs_v1 from public,anon,authenticated,service_role/i);
  assert.match(bridge, /request_sha256 text not null check \(request_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\),\s*response_sha256 text not null check \(response_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    'The private proof must bind both the canonical request and the exact stored receipt');
  assert.equal((upsert.match(/public\.enforce_pos_rpc_rate_limit_v2\(/g) || []).length, 1,
    'The versioned path must consume exactly one attempt under the authentic public wrapper policy');
  assert.match(upsert, /p_rpc_name:='pos_upsert_restaurant_order',[\s\S]*?p_scope:='POS_WRITE',[\s\S]*?p_max_attempts:=120,p_window_seconds:=600,p_block_seconds:=300/);
  assert.ok(upsert.indexOf('public.enforce_pos_rpc_rate_limit_v2(') < upsert.indexOf('private.enter_restaurant_transition_write_v1()')
    && upsert.indexOf('private.enter_restaurant_transition_write_v1()') < upsert.indexOf('private.validate_pos_sync_context(')
    && upsert.indexOf('public.enforce_pos_rpc_rate_limit_v2(') < upsert.indexOf('private.lock_restaurant_order_settlement_v1('),
  'The authentic limiter must precede transition admission, which must precede auth/session touch and every business lock');
  assert.match(upsert, /public\.build_pos_rpc_rate_limited_response\(rate_limit\)/);
  assert.ok(upsert.includes("request_hash:=md5(coalesce(p_order::text,'')||'|'||coalesce(p_items::text,''));"),
    'The MD5 cross-check must use exactly the authentic writer input');
  assert.match(upsert, /extensions\.digest\(convert_to\([\s\S]*?'sha256'\)/);
  assert.ok(upsert.indexOf('if has_idem or has_proof then') < upsert.indexOf('if o.id is not null then'),
    'Exact replay must be resolved before version and terminal mutation guards');
  assert.match(upsert, /jsonb_typeof\(idem\.response_payload->'success'\) is distinct from 'boolean'/,
    'A missing/null success field must fail closed despite SQL three-valued logic');
  assert.match(upsert, /proof\.request_sha256 is distinct from request_sha256[\s\S]*?proof\.actor_type is distinct from c->>'actor_type'[\s\S]*?proof\.actor_id is distinct from[\s\S]*?proof\.device_id is distinct from/);
  assert.match(upsert, /proof\.response_sha256 is distinct from encode\(extensions\.digest\(convert_to\(idem\.response_payload::text,'UTF8'\),'sha256'\),'hex'\)/,
    'Any modified receipt must fail closed before its payload is returned');
  assert.match(upsert, /idem\.request_hash is distinct from request_hash/,
    'The legacy MD5 is only an additional compatibility cross-check');
  assert.match(upsert, /idem\.response_payload->>'idempotency_key' is distinct from p_idempotency_key/);
  assert.match(upsert, /idem\.response_payload->'order'->>'id' is distinct from idem\.entity_id/);
  assert.match(upsert, /public\.pos_upsert_restaurant_order_unlimited\(/);
  assert.doesNotMatch(upsert, /public\.pos_upsert_restaurant_order\(/,
    'Delegating to the public wrapper would count the rate limit twice');
  assert.doesNotMatch(upsert, /\.xmin/, 'Ledger provenance must support successful writer subtransactions');
  assert.doesNotMatch(upsert, /idem\.expires_at\s*(?:is null|<=)/,
    'Replay policy must follow the retained ledger row; the shared writer does not enforce its seven-day marker');

  for (const requiredStage of [
    'R20 canonical fingerprint and post-commit retry',
    'R20 authorization and license isolation',
    'R20 concurrent identical and conflicting requests',
    'R20 terminal parent replay and real rate-limit rejection',
  ]) assert.ok(runner.includes(requiredStage), `${requiredStage} must be emitted by the real PostgreSQL runner`);
  assert.match(runner, /const beforeReplayState = await captureVersionedOrderState\('bridge-versioned-client','bridge-versioned-client-upsert'\)[\s\S]*?assert\.deepEqual\(afterReplayState,\s*beforeReplayState/,
    'Post-commit retry must compare business and financial state before and after');
  assert.match(runner, /response_payload=response_payload-'success'[\s\S]*?missingSuccess\.code,'IDEMPOTENCY_CONFLICT'/,
    'The PostgreSQL runner must dynamically reject a malformed receipt with a missing success field');
  assert.match(runner, /proofResponseMatches',p\.response_sha256=encode\(extensions\.digest\(convert_to\(i\.response_payload::text,'UTF8'\),'sha256'\),'hex'\)/,
    'The successful receipt evidence must dynamically verify the private response hash');
  assert.match(runner, /publicAnyPrivilege.*policyCount/s,
    'The catalog evidence must reject public table ACL entries and unreviewed private-table policies');
  assert.match(runner, /xidRollbackState[\s\S]*?assert\.deepEqual\(xidRollbackState,\{parents:0,items:0,ledger:0,proofs:0,attempts:0,events:0\}/,
    'A real top-level rollback must be checked from a separate connection after proof insertion');
  assert.match(runner, /R20_TEST_IDEMPOTENCY_COMPLETION_FAILURE[\s\S]*?completionFailureState[\s\S]*?assert\.deepEqual\(completionFailureState,\{parents:0,items:0,ledger:0,proofs:0,attempts:0,events:0\}/,
    'An injected completion failure must prove parent, item, ledger, proof and event atomicity');
  assert.match(runner, /R20_TEST_PROOF_INSERT_FAILURE[\s\S]*?proofFailureState[\s\S]*?assert\.deepEqual\(proofFailureState,\{parents:0,items:0,ledger:0,proofs:0,attempts:0,events:0\}/,
    'An injected after-proof failure must prove no private proof or business effect survives');
  assert.match(runner, /wrongDeviceSessionError = await assertSqlFailure[\s\S]*?ACTOR_SESSION_INVALID/,
    'The PostgreSQL runner must reject reusing an Admin session from a different device');
  assert.match(concurrency, /contenderQuerySubmitted: true/);
  assert.match(concurrency, /name: 'versioned-same-parent-distinct-keys'[\s\S]*?RESTAURANT_ORDER_VERSION_CONFLICT/,
    'RC-05 must contend with a different key and require the stale parent-version rejection');
  assert.match(concurrency, /observeRestaurantIdempotencyLock\(query,keyContenderName,sharedKey\)/);
  assert.match(concurrency, /name:'versioned-same-key-distinct-parents'[\s\S]*?IDEMPOTENCY_CONFLICT/,
    'A cross-parent retry must wait on and report the exact shared idempotency advisory lock, then reject without receipt disclosure');
  assert.match(concurrency, /name:'versioned-cutover-rate-limit-order'[\s\S]*?rateWait:[\s\S]*?transitionWait:[\s\S]*?RESTAURANT_CONTRACT_MAINTENANCE/,
    'The PostgreSQL runner must observe limiter-row wait followed by real exclusive/shared transition-lock wait');
  assert.match(concurrency, /pg_blocking_pids/);
  assert.match(concurrency, /holder COMMIT, then contender COMMIT/);
  assert.match(concurrency, /finalState,\s+status: 'PASS'/);
});

test('structured evidence gate binds the Admin report to this run and SHA and rejects malformed evidence', async () => {
  const workflow = await readFile(workflowPath, 'utf8');
  const match = workflow.match(/node --input-type=module -e '\r?\n([\s\S]*?)\r?\n[ \t]{10}'/);
  assert.ok(match, 'workflow evidence gate JavaScript must be extractable');
  const gateSource = match[1].split(/\r?\n/).map((line) => line.replace(/^ {12}/, '')).join('\n')
    .replaceAll('process.exit(1)', 'throw new Error("invalid evidence")');
  const runnerSource = await readFile(path.join(root, 'scripts/supabase/pr352-r6-real-bridge-pg176-test.mjs'), 'utf8');
  const targetBlock = runnerSource.match(/const targetFunctions = \[([\s\S]*?)\n\];/);
  assert.ok(targetBlock, 'runner must declare its reviewed 10-function bridge contract');
  const canonicalWriterSignatures = [...targetBlock[1].matchAll(/signature: '([^']+)'/g)].map((row) => row[1]);
  const gateWriterBlock = gateSource.match(/const writerSignatures = \[([\s\S]*?)\n\s*\];/);
  assert.ok(gateWriterBlock, 'workflow gate must declare the required writer set');
  const gateWriterSignatures = [...gateWriterBlock[1].matchAll(/"([^"]+)"/g)].map((row) => row[1]);
  assert.equal(canonicalWriterSignatures.length, 10);
  assert.equal(new Set(canonicalWriterSignatures).size, 10);
  assert.deepEqual(gateWriterSignatures, canonicalWriterSignatures,
    'workflow gate writer set must match the exact runner bridge instrumentation contract');
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'pr352-r6-evidence-gate-'));
  const evidenceRoot = path.join(tempRoot, 'pr352-r6-evidence');
  const gatePath = path.join(tempRoot, 'evidence-gate.mjs');
  await mkdir(evidenceRoot, { mode: 0o700 });
  await writeFile(gatePath, gateSource, { mode: 0o600 });
  const bridgePath = path.join(evidenceRoot, 'real-bridge.json');
  const overlayPath = path.join(evidenceRoot, 'synthetic-overlay.json');
  const commitSha = 'a'.repeat(40);
  const runId = '1234567890';
  const runAttempt = '2';
  const relation = (localOrderId, localLineId) => ({
    parentId: 'internal-' + localOrderId, itemId: 'item-' + localLineId,
    itemParentId: 'internal-' + localOrderId, itemLicenseId: '00000000-0000-0000-0000-000000000001',
    licenseId: '00000000-0000-0000-0000-000000000001', localOrderId, localLineId,
    stationCode: 'kitchen', stationName: 'Cocina', activeItemCount: 1,
  });
  const stationNames = [
    'A/G: first authenticated Staff write creates and attributes Kitchen',
    'B: active station reuse and authentic resolver fallback',
    'C: inactive station reactivation',
    'D: incomplete station fields repaired without rewriting metadata',
    'E: concurrent creation, independent psql sessions',
    'F: different licenses keep distinct default stations',
    'H: failed transaction rolls back station initialization',
  ];
  const lock = (pid, mode, granted) => ({ pid, mode, granted, locktype: 'advisory', classId: 123, objectId: 456, objectSubId: 1 });
  const cutoverLocks = (includeNewWriter) => ({
    holderGranted: [lock(101, 'ShareLock', true)],
    holderActivity: [{ pid: 101, state: 'idle in transaction', queryText: 'pos_update_restaurant_order_status_unlimited' }],
    pauseWaiting: [lock(102, 'ExclusiveLock', false)],
    pauseActivity: [{ pid: 102, state: 'active', waitEventType: 'Lock', blockedBy: [101] }],
    ...(includeNewWriter ? { newWriteWaiting: [lock(103, 'ShareLock', false)],
      newWriteActivity: [{ pid: 103, state: 'active', waitEventType: 'Lock', blockedBy: [102] }] } : {}),
  });
  let bridge = {
    commitSha,
    runId,
    runAttempt,
    status: 'PASS',
    failedStage: null,
    error: null,
    errorStack: null,
    schemaContractState:'CANDIDATE_SCHEMA_AFTER_MIGRATION',
    checks: [
      ...syntheticArchiveChecks({commitSha,runId,runAttempt}),
      {name:'ARCHIVE_RPC_REPLAY_AFTER_REPAIR',status:'PASS',event:{entity_type:'restaurant_order',operation:'archive'},
        persistedEvents:1,replayIdentical:true,businessSnapshotUnchanged:true},
      { name: 'loopback disposable PostgreSQL 17.6 endpoint', status: 'PASS', serverVersionNum: '170006' },
      { name: 'Cocina schema and six direct Restaurant helper functions match read-only Production catalog metadata', status: 'PASS', tableColumnCount: 18, constraintCount: 9, indexCount: 5, functionCount: 6 },
      { name: 'financial schema and captured function snapshot installed', status: 'PASS', functionCount: 267 },
      { name: 'authentic 3D.14 dispatcher fingerprint matches reviewed read-only fingerprint', status: 'PASS', sha256: 'aa0bd977c3b47fef871a8cf099c7c84a87f9e0512d49c0676d31d49c5fe6a3f4' },
      { name: 'six authentic Restaurant writer bodies and security metadata match fingerprints', status: 'PASS', writerCount: 6 },
      { name: 'bridge installation transaction fully rolls back after induced failure', status: 'PASS' },
      { name: 'forward bridge v1 migration installed and committed in disposable PostgreSQL', status: 'PASS', contractStateTablePresent: true, contractReaderPresent: true },
      { name: 'bridge preserves function OIDs, owners, SECURITY DEFINER, settings, ACL and business bodies', status: 'PASS', instrumentedFunctions: 10 },
      { name: 'anon/authenticated public grants and private policy setter denial verified', status: 'PASS' },
      { name: 'authentic Cocina provisioning, resolution, attribution, license isolation, rollback and concurrency checks completed', status: 'PASS' },
      { name: 'cutover lock, concurrent commit/rollback, paused write rejection, replay and unrelated sale scenarios completed', status: 'PASS' },
      { name: 'Restaurant settlement and replay materialize one sale, payment, operation and inventory movement', status: 'PASS', receiptsIdentical: true, sales: 1, payments: 1, operations: 1, inventoryMovements: 1, parentPaid: true },
      { name: 'financial settlement races completed with observed parent locks', status: 'PASS' },
      { name: 'Restaurant cancellation scenarios completed', status: 'PASS' },
      { name: 'bridge integration assertions and zero-session cleanup complete', status: 'PASS' },
      { name: 'admin-off-initial-state', status: 'PASS', contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
      { name: 'admin-off-contract-response', status: 'PASS', success: true, contractVersion: 1, writesPaused: false, adminSupervisionAvailable: false },
      { name: 'admin-off-setter-rejected-no-state-change', status: 'PASS', attempted: true, rejected: true, errorMessage: 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE', sqlstate: 'P0001', stateBefore: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 }, stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      { name: 'admin-off-private-setter-denied-anon', status: 'PASS', role: 'anon', denialSqlstate: '42501', denialMessage: 'permission denied for schema private', stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      { name: 'admin-off-private-setter-denied-authenticated', status: 'PASS', role: 'authenticated', denialSqlstate: '42501', denialMessage: 'permission denied for schema private', stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      { name: 'Staff owner admitted; Admin and another Staff denied while Admin remains OFF; invalid session has no effect', status: 'PASS' },
      { name: 'legacy and versioned clients persist and replay one correctly licensed parent and item', status: 'PASS',
        legacy: { role: 'service_role', relationship: relation('bridge-legacy-client', 'bridge-legacy-line') },
        versioned: { role: 'anon', relationship: relation('bridge-versioned-client', 'bridge-versioned-line') } },
    ],
    adminOff: {
      status: 'PASS',
      initialState: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
      contractResponse: { success: true, contractVersion: 1, writesPaused: false, adminSupervisionAvailable: false },
      setterAttempt: { attempted: true, rejected: true, errorMessage: 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE', sqlstate: 'P0001', stateBefore: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 }, stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 } },
      roleMatrix: {
        anonCanExecuteSetter: false,
        authenticatedCanExecuteSetter: false,
        denials: ['anon', 'authenticated'].map((role) => ({
          role,
          denialSqlstate: '42501',
          denialMessage: 'permission denied for schema private',
          stateAfter: { contractVersion: 1, writesPaused: false, activeActivationRows: 0 },
        })),
      },
    },
    preparationStationDependencies: {
      status: 'PASS', initialStationCountBeforeStaffWriter: 0,
      cases: stationNames.map((name, index) => ({ name, status: 'PASS', ...(index === 0 ? {
        count: 1, actor: { deviceId: '00000000-0000-0000-0000-00000000000b', staffUserId: '00000000-0000-0000-0000-0000000000ab' },
        parentItemRelationship: relation('bridge-staff-owned-parent', 'bridge-staff-owned-parent-line'),
      } : index === 4 ? {
        sqlSubmittedAndObserved: true, sessions: ['worker-a', 'worker-b'],
        observation: ['worker-a', 'worker-b'].map((applicationName) => ({ applicationName, state: 'active',
          waitEventType: 'Lock', waitEvent: 'advisory', lockGranted: false, queryText: 'ensure_default_preparation_station' })),
        controllerLock: { granted: true }, controllerExit: { code: 0 },
        exits: [{ code: 0, signal: null }, { code: 0, signal: null }], finalStationCount: 1, pendingSessionCount: 0,
      } : {}) })),
    },
    writerChecks: canonicalWriterSignatures.map((signature) => ({
      signature,
      status: 'PASS',
      admissionOccurrences: 1,
      bodyRecoveredExactly: true,
      oidPreserved: true,
      ownerPreserved: true,
      securityDefinerPreserved: true,
      configurationPreserved: true,
      aclSemanticallyPreserved: true,
    })),
    concurrency: [
      { category: 'CUTOVER_COMMIT_RACE', name: 'in-flight real writer commits, pause waits exclusively, new writer rejects', status: 'PASS',
        submitted: { inFlight: true, pause: true, newWrite: true }, lockObservations: cutoverLocks(true),
        exitCodes: { holder: 0, pause: 0, newWrite: 0 }, sqlstate: { newWrite: 'P0001', message: 'RESTAURANT_CONTRACT_MAINTENANCE' },
        finalState: { paused: true, parentStatus: 'preparing', saleCount: 0, pausedWriteParentCount: 0 }, pendingProcesses: 0, pendingDatabaseSessions: 0 },
      { category: 'UNRELATED_RUBRIC_CONTINUITY', name: 'unrelated cashier financial operation completes while Restaurant transition is paused', status: 'PASS',
        submitted: true, finalState: { paused: true, saleCount: 1, paymentCount: 1, inventoryCount: 1 } },
      { category: 'CUTOVER_ROLLBACK_RACE', name: 'in-flight real writer rolls back and releases shared lock for pause', status: 'PASS',
        submitted: { inFlight: true, pause: true }, lockObservations: cutoverLocks(false), exitCodes: { holder: 0, pause: 0 },
        finalState: { paused: true, parentStatus: 'pending', saleCount: 0 }, pendingProcesses: 0, pendingDatabaseSessions: 0 },
      { category: 'POST_RESUME_REPLAY', name: 'replay after resume commits exactly once after concurrent rollback', status: 'PASS',
        submitted: true, exitCodes: { first: 0, replay: 0 }, finalState: { paused: false, parentStatus: 'preparing', operationRows: 1 } },
    ],
    financialRaces: ['F1', 'F2'].map((name) => ({
      name, status: 'PASS', submitted: { holder: true, contender: true },
      actor: { licenseId: '00000000-0000-0000-0000-000000000001', device: 'lab-device-a', session: 'lab-admin-session' },
      stateBefore: { parentId: 'internal-' + name, localOrderId: name === 'F1' ? 'r6-f1-parent' : 'r6-f2-parent', parentStatus: 'pending', paymentStatus: null, paidSaleId: null, stock: 20 },
      sessionNames: { holder: `holder-${name}`, contender: `contender-${name}` },
      sql: { holder: `public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-admin-session',${name === 'F1' ? 'r6-f1-parent' : 'r6-f2-parent'})`,
        contender: name === 'F1' ? `public.pos_cancel_restaurant_order_from_pos_v1('lab-license-a','lab-device-a','lab-admin-session',r6-f1-parent)`
          : `public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-admin-session',r6-f2-parent)` },
      releaseOrder: ['holder settlement completed within transaction','contender waits on holder parent advisory lock','holder COMMIT','contender COMMIT'],
      holderState: [{ pid: 201, state: 'idle in transaction' }],
      lockObservations: [{ holderPid: 201, contenderPid: 202, holderGranted: true, contenderGranted: false,
        holderMode: 'ExclusiveLock', contenderMode: 'ExclusiveLock', wait: 'Lock', classId: 123, objectId: 456, objectSubId: 2, blockedBy: [201],
        query: name === 'F1' ? 'pos_cancel_restaurant_order_from_pos_v1' : 'R6_FINANCIAL_RPC' }],
      exitCodes: { holder: 0, contender: 0 }, sqlstate: { holder: '00000', contender: name === 'F1' ? 'P0001' : '00000', message: name === 'F1' ? 'RESTAURANT_ORDER_ALREADY_PAID' : null },
      stockBefore: 20,
      finalState: { parentCount: 1, parentStatus: 'delivered', paymentStatus: 'paid', paidSaleId: name === 'F1' ? 'r6-f1-parent' : 'r6-f2-parent', stock: 19, cashMovements: 1, sales: 1, payments: 1,
        operations: 1, inventory: 1, cancelledItems: 0, cancelKeys: 0, permits: 0 },
      receipt: { success: true }, contenderReceipt: name === 'F2' ? { success: true } : null,
      pendingDatabaseSessions: 0, pendingProcesses: 0,
    })),
    cancellation: [
      { name: 'C1', status: 'PASS', parent: 'cancelled', item: 'cancelled', permitGranted: true, permitRows: 0,
        transactionBoundary: { backendPid: 401, transactionId: '10001', committed: true, scope: 'separate psql -c implicit transaction completed before C4' } },
      { name: 'C2', status: 'PASS', denial: 'P0001 RESTAURANT_TABLE_OWNER_REQUIRED', parentUnchanged: true },
      { name: 'C3', status: 'PASS', denial: 'P0001 RESTAURANT_ORDER_ALREADY_PAID', parentUnchanged: true },
      { name: 'C4', status: 'PASS', sameKey: 'identical receipt', differentKey: 'P0001 RESTAURANT_ORDER_ALREADY_CANCELLED', cancellationEvents: 1, completedKeys: 1,
        replayBoundary: { backendPid: 402, transactionId: '10002', afterTransactionId: '10001', priorBackendPid: 401, separateConnection: true, priorTransactionCommitted: true } },
      { name: 'C5', status: 'PASS', financialRace: 'F1' },
      { name: 'C6', status: 'PASS', parentAndItemRestored: true, permitRows: 0 },
    ].map((row) => {
      if (row.name === 'C5') return row;
      const parentId = row.name === 'C3' ? 'r6-f2-parent' : row.name === 'C2' ? 'r6-cancel-nonowner' : row.name === 'C6' ? 'r6-cancel-rollback' : 'r6-cancel-valid';
      const beforeStatus = row.name === 'C4' ? 'cancelled' : 'pending';
      const snapshot = (status, cancelEvents) => ({ parent: { id: 'internal-' + parentId, license_id: '00000000-0000-0000-0000-000000000001', local_order_id: parentId, status, payment_status: row.name === 'C3' ? 'paid' : 'unpaid' },
        items: [{ id: 'item-' + parentId, license_id: '00000000-0000-0000-0000-000000000001', restaurant_order_id: 'internal-' + parentId, status }], cancelEvents });
      const before = snapshot(beforeStatus, row.name === 'C4' ? 1 : 0);
      const after = row.name === 'C1' ? snapshot('cancelled', 1) : structuredClone(before);
      const message = { C1: null, C2: 'RESTAURANT_TABLE_OWNER_REQUIRED', C3: 'RESTAURANT_ORDER_ALREADY_PAID', C4: 'RESTAURANT_ORDER_ALREADY_CANCELLED', C6: 'R6_C6_ROLLBACK_PROBE' }[row.name];
      const effects = { sales: 3, payments: 3, inventory: 3, cash: 2 };
      return { ...row, operation: 'public.pos_cancel_restaurant_order_from_pos_v1', actor: 'synthetic actor', parentId: before.parent.id, localOrderId: parentId,
        stateBefore: before, stateAfter: after, financialEffects: { before: effects, after: structuredClone(effects) },
        cleanup: { permitRows: 0 }, sqlstate: { state: row.name === 'C1' ? '00000' : 'P0001', message },
        ...(row.name === 'C6' ? { rollbackKind: 'plpgsql_subtransaction' } : {}) };
    }),
    postgresServerVersionNum: '170006',
    productionConnections: 0,
  };
  const f1 = bridge.financialRaces[0];
  f1.alternateOrder = { status: 'PASS', submitted: { holder: true, contender: true },
    actor: { licenseId: '00000000-0000-0000-0000-000000000001', device: 'lab-device-a', session: 'lab-admin-session' },
    parentId: 'internal-r6-f1-cancel-first-parent',
    stateBefore: { parentId: 'internal-r6-f1-cancel-first-parent', localOrderId: 'r6-f1-cancel-first-parent', parentStatus: 'pending', paymentStatus: 'unpaid', paidSaleId: null, stock: 20 },
    sessionNames: { holder: 'cancel-first-holder', contender: 'cancel-first-contender' },
    sql: { holder: "public.pos_cancel_restaurant_order_from_pos_v1('lab-license-a','lab-device-a','lab-admin-session',r6-f1-cancel-first-parent)",
      contender: "public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-admin-session',r6-f1-cancel-first-parent)" },
    holderState: [{ pid: 301, state: 'idle in transaction' }],
    lockObservations: [{ holderPid: 301, contenderPid: 302, holderGranted: true, contenderGranted: false,
      holderMode: 'ExclusiveLock', contenderMode: 'ExclusiveLock', wait: 'Lock', classId: 123, objectId: 456,
      objectSubId: 2, blockedBy: [301], query: 'R6_FINANCIAL_RPC' }],
    exitCodes: { holder: 0, contender: 0 }, sqlstate: { holder: '00000', contender: 'P0001', message: 'RESTAURANT_ORDER_ALREADY_CANCELLED' },
    stockBefore: 20, finalState: { parentCount: 1, parentStatus: 'cancelled', paymentStatus: null, paidSaleId: null,
      sales: 0, payments: 0, operations: 0, inventory: 0, cashMovements: 0, stock: 20, cancelledItems: 1, cancelKeys: 1, permits: 0 },
    releaseOrder: ['holder cancellation completed within transaction','contender waits on holder parent advisory lock','holder COMMIT','contender COMMIT'],
    pendingDatabaseSessions: 0, pendingProcesses: 0 };
  Object.assign(bridge.cancellation.find((row) => row.name === 'C5'), { operation: f1.sql.contender, actor: f1.actor,
    parentId: f1.stateBefore.parentId, localOrderId: f1.stateBefore.localOrderId, stateBefore: f1.stateBefore, stateAfter: f1.finalState,
    financialEffects: f1.finalState, sqlstate: f1.sqlstate, cleanup: { permitRows: 0, pendingProcesses: 0, pendingDatabaseSessions: 0 } });
  const overlay = {
    schemaVersion: 1,
    suite: 'PR352_R6_LEDGER_OVERLAY',
    fixtureKind: 'synthetic-only',
    commitSha,
    runId,
    runAttempt,
    status: 'PASS',
    expectedLedgerRows: 333,
    cases: [
      '333 harmless entries, deterministic order, exactly one candidate', 'missing fetched version rejected',
      'duplicate ledger identity rejected', 'renamed file identity rejected', 'modified SQL bytes rejected by per-file fingerprint',
      'reordered entries rejected even with a recomputed aggregate fingerprint', 'manifest fingerprint tamper rejected',
      'unexpected fetched migration rejected', 'older candidate version rejected', 'second pending candidate rejected',
      'drift between validation and application rejected', 'candidate source drift between validation and application rejected',
      'temporary overlay removed after a thrown error',
    ].map((name) => ({ name, status: 'PASS' })),
    caseCount: 13,
    passed: 13,
    failed: 0,
    productionConnections: 0,
    cleanupFailures: 0,
    sqlContentsEmitted: false,
  };
  const writeReports = async () => {
    await writeFile(bridgePath, JSON.stringify(bridge));
    await writeFile(overlayPath, JSON.stringify(overlay));
  };
  // Synthetic complete report for the gate contract, not PostgreSQL evidence.
  bridge.provenanceDiagnostic = {topLevelXid:'900',observedLedgerXmin:'901',ledgerStatus:'completed',operation:'restaurant_order.upsert',
    writerSuccess:true,receiptSha256:'b'.repeat(64),predicates:{sameTopLevelXid:false,ledgerPresent:true,completed:true,
      operationMatches:true,entityMatches:true,md5Matches:true,receiptMatches:true,parentMatches:true},
    failedPredicates:['sameTopLevelXid'],subtransactionHypothesis:'DISTINCT_XIDS_OBSERVED'};
  bridge.legacyProvenance = ['legacy-first-same-parent','versioned-first-legacy-same-parent','legacy-first-cross-parent',
    'foreign-completed-receipt-no-insert'].map((name) => {
      const rejected=name==='legacy-first-cross-parent'||name==='foreign-completed-receipt-no-insert';
      return {name,status:'PASS',queriesSubmitted:true,holderPid:501,contenderPid:502,
        wait:{pid:502,waitEventType:'Lock',waitEvent:rejected?'transactionid':'advisory',blockedBy:[501]},locks:[{pid:502,granted:false}],
        keyLocks:rejected?[{pid:502,granted:true}]:[],
        financialBefore:{sales:0,payments:0,cash:0,inventory:0,credit:0,operations:0},
        financialAfter:{sales:0,payments:0,cash:0,inventory:0,credit:0,operations:0},
      exitCodes:{holder:0,contender:rejected?3:0},sqlstate:rejected?'P0001':'00000',pendingDatabaseSessions:0,
        rejection:rejected?{exitCode:3,signal:null,spawnError:null,sqlstate:'P0001',message:'IDEMPOTENCY_CONFLICT',noReceipt:true}:null,
        finalState:{parents:1,items:1,ledger:1,proofs:name==='versioned-first-legacy-same-parent'?1:0,attempts:0}};
    });
  bridge.idempotency={status:'PASS',provenance:{mechanism:'private call nonce witnessed by authentic ledger INSERT',
    legacy:bridge.legacyProvenance,diagnostic:bridge.provenanceDiagnostic,xidProbe:{proofs:1,pendingAttempts:0}}};
  bridge.idempotencyConcurrency=['versioned-idempotency-identical','versioned-idempotency-conflict',
    'versioned-same-key-distinct-parents','versioned-same-parent-distinct-keys','versioned-cutover-rate-limit-order'].map(name=>{
    if (!['versioned-same-parent-distinct-keys','versioned-cutover-rate-limit-order'].includes(name)) return {
      name,status:'PASS',holderPid:701,contenderPid:702,contenderQuerySubmitted:true,
      waitEventType:'Lock',waitEvent:'advisory',blockedBy:[701],pendingDatabaseSessions:0,releaseOrder:'holder COMMIT',
      holderExitCode:0,contenderExitCode:0,finalState:name==='versioned-same-key-distinct-parents'
        ?{holderParents:1,contenderParents:0,holderItems:1,contenderItems:0,ledger:1,proofs:1,events:2}
        :{parents:1,items:1,events:2,ledger:1,proofs:1}};
    const message=name==='versioned-same-parent-distinct-keys'?'RESTAURANT_ORDER_VERSION_CONFLICT':'RESTAURANT_CONTRACT_MAINTENANCE';
    return {name,status:'PASS',holderPid:701,contenderPid:702,contenderQuerySubmitted:true,
      waitEventType:'Lock',waitEvent:'advisory',blockedBy:[701],transitionWait:{waitEventType:'Lock',waitEvent:'advisory',blockedBy:[701]},
      holderExitCode:0,pauseExitCode:0,rateHolderExitCode:0,rateCountAfterPausedError:'1',
      finalState:{parents:1,items:1,holderLedger:1,contenderLedger:0,holderProof:1,contenderProof:0,holderEvents:2,contenderEvents:0,serverVersion:2},
      pausedFinalState:{parents:0,items:0,ledger:0,proofs:0,events:0},
      releaseOrder:'holder COMMIT',pendingDatabaseSessions:0,contenderExitCode:3,contenderSqlstate:'P0001',contenderResponse:message,
      rejection:{exitCode:3,signal:null,spawnError:null,sqlstate:'P0001',message,noReceipt:true}};
  });
  bridge.idempotency.concurrent=bridge.idempotencyConcurrency;
  bridge.checks.push(
    compareSharedLedger(syntheticSharedLedger('before'),syntheticSharedLedger('after'),{commitSha,runId,runAttempt}),
    {name:'authentic writer provenance diagnostic records every original rejection predicate',status:'PASS',...bridge.provenanceDiagnostic},
    {name:'private insertion witness has restricted ACL, RLS and an enabled authentic-ledger observer',status:'PASS',
      table:'pos_idempotency_keys',type:5,enabled:'O',securityDefiner:true,owner:'postgres',config:['search_path=""'],browserExecute:false},
    {name:'prior legacy ledger rejected without attribution and unsuccessful writer response cleans its attempt',status:'PASS'},
    {name:'versioned idempotency binds the strong request proof, preserves the authentic rate-limit and rejects conflicts',...bridge.idempotency},
  );
  const runGate = () => { try { return execFileSync(process.execPath, [gatePath], {
    cwd: root,
    env: {
      ...process.env,
      RUNNER_TEMP: tempRoot,
      EXPECTED_EXECUTION_SHA: commitSha,
      EXPECTED_RUN_ID: runId,
      EXPECTED_RUN_ATTEMPT: runAttempt,
    },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }); } catch (error) { if (error.stderr) error.message = String(error.stderr); throw error; } };
  const rejectBridgeMutation = async (description, mutate) => {
    const validBridge = structuredClone(bridge);
    mutate(bridge);
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, description);
    bridge = validBridge;
  };

  try {
    await writeReports();
    assert.match(runGate(), /PR352_R6_EVIDENCE_PASS/);

    for(const checkName of ['ARCHIVE_CHECK_BEFORE_MIGRATION','ARCHIVE_CHECK_AFTER_MIGRATION']) {
      await rejectBridgeMutation('missing '+checkName,report=>{report.checks=report.checks.filter(c=>c.name!==checkName);});
      await rejectBridgeMutation('duplicate '+checkName,report=>{report.checks.push(structuredClone(report.checks.find(c=>c.name===checkName)));});
    }
    for(const [label,mutate] of [
      ['migration hash',c=>{c.migrationSha256='0'.repeat(64);}],
      ['missing operation',c=>{c.allowedOperations.pop();}],
      ['invalid operation accepted',c=>{c.recorder.rejectedSqlstate='00000';}],
      ['another run',c=>{c.runId='999';}],['another SHA',c=>{c.commitSha='b'.repeat(40);}],
      ['another attempt',c=>{c.runAttempt='999';}],
    ]) await rejectBridgeMutation('archive evidence '+label,report=>mutate(report.checks.find(c=>c.name==='ARCHIVE_CHECK_AFTER_MIGRATION')));
    await rejectBridgeMutation('archive schema label missing',report=>{delete report.schemaContractState;});

    await rejectBridgeMutation('missing shared-ledger evidence',report=>{
      report.checks=report.checks.filter(row=>row.name!=='UNRELATED_LEDGER_BEFORE_AFTER');
    });
    await rejectBridgeMutation('duplicate shared-ledger evidence',report=>{
      report.checks.push(structuredClone(report.checks.find(row=>row.name==='UNRELATED_LEDGER_BEFORE_AFTER')));
    });
    for(const [name,mutate] of [
      ['missing baseline',row=>{delete row.baseline;}],
      ['comparison not executed',row=>{row.comparisonExecuted=false;}],
      ['financial difference',row=>{row.after.countsAfter.cash++;}],
      ['unexpected Restaurant proof',row=>{row.after.proofRows=1;}],
      ['residual attempt',row=>{row.after.attemptRows=1;}],
      ['wrong SHA',row=>{row.commitSha='b'.repeat(40);}],
      ['wrong run',row=>{row.runId='999';}],
      ['wrong attempt',row=>{row.runAttempt='999';}],
      ['wrong SQL receipt',row=>{row.after.ledgerReceiptValid=false;}],
      ['wrong operation license',row=>{row.after.operation.licenseId='00000000-0000-0000-0000-000000000002';}],
      ['processing operation',row=>{row.after.operation.status='processing';}],
      ['missing financial receipt',row=>{delete row.after.receipt;}],
      ['missing ledger',row=>{row.after.ledgerRows=0;}],
      ['partial SQL snapshot',row=>{delete row.after.countsAfterRollback;}],
    ]) await rejectBridgeMutation(name,report=>mutate(report.checks.find(row=>row.name==='UNRELATED_LEDGER_BEFORE_AFTER')));

    await rejectBridgeMutation('missing insertion provenance fails closed',(report)=>{delete report.idempotency.provenance;});
    await rejectBridgeMutation('duplicate legacy scenario fails closed',(report)=>{report.legacyProvenance[1]=structuredClone(report.legacyProvenance[0]);});
    await rejectBridgeMutation('missing original rejection predicate fails closed',(report)=>{delete report.provenanceDiagnostic.predicates.md5Matches;});
    await rejectBridgeMutation('same PID is not concurrent evidence',(report)=>{report.legacyProvenance[0].contenderPid=501;});
    await rejectBridgeMutation('unconsumed private attempt fails closed',(report)=>{report.idempotency.provenance.xidProbe.pendingAttempts=1;});
    for (const code of [0, 1, 2]) await rejectBridgeMutation(`legacy rejection exit ${code} fails closed`, (report) => {
      report.legacyProvenance.find((row) => row.name === 'legacy-first-cross-parent').exitCodes.contender = code;
    });
    for(const [name,mutate] of [
      ['SQLSTATE',row=>{row.rejection.sqlstate='23505';}],
      ['message',row=>{row.rejection.message='OTHER_ERROR';}],
      ['signal',row=>{row.rejection.signal='SIGTERM';}],
      ['client failure',row=>{row.rejection.exitCode=1;}],
      ['spawn error',row=>{row.rejection.spawnError='failed';}],
      ['receipt',row=>{row.rejection.noReceipt=false;}],
    ]) await rejectBridgeMutation(`legacy invalid ${name}`,report=>mutate(report.legacyProvenance[2]));
    for(const [name,mutate] of [
      ['missing rejection',row=>{delete row.rejection;}],
      ['wrong exit',row=>{row.contenderExitCode=1;}],
      ['signal',row=>{row.rejection.signal='SIGTERM';}],
      ['wrong SQLSTATE',row=>{row.rejection.sqlstate='23505';}],
      ['wrong message',row=>{row.rejection.message='OTHER_ERROR';}],
      ['no SQL sent',row=>{row.contenderQuerySubmitted=false;}],
      ['no blocker',row=>{row.blockedBy=[];}],
      ['no final state',row=>{delete row.finalState;}],
      ['duplicate effect',row=>{row.finalState.contenderLedger=1;}],
    ]) await rejectBridgeMutation(`RC05 invalid ${name}`,report=>mutate(report.idempotencyConcurrency[3]));
    await rejectBridgeMutation('successful replay without observed blocking fails closed',report=>{
      report.idempotencyConcurrency[0].blockedBy=[];
    });
    await rejectBridgeMutation('successful replay missing final ledger fails closed',report=>{
      delete report.idempotencyConcurrency[0].finalState.ledger;
    });

    for (const name of [
      'Cocina schema and six direct Restaurant helper functions match read-only Production catalog metadata',
      'authentic 3D.14 dispatcher fingerprint matches reviewed read-only fingerprint',
      'bridge installation transaction fully rolls back after induced failure',
      'forward bridge v1 migration installed and committed in disposable PostgreSQL',
      'bridge preserves function OIDs, owners, SECURITY DEFINER, settings, ACL and business bodies',
      'Restaurant settlement and replay materialize one sale, payment, operation and inventory movement',
      'bridge integration assertions and zero-session cleanup complete',
      'authentic writer provenance diagnostic records every original rejection predicate',
      'private insertion witness has restricted ACL, RLS and an enabled authentic-ledger observer',
      'prior legacy ledger rejected without attribution and unsuccessful writer response cleans its attempt',
      'versioned idempotency binds the strong request proof, preserves the authentic rate-limit and rejects conflicts',
    ]) await rejectBridgeMutation(`missing mandatory check ${name} fails closed`, (report) => {
      report.checks = report.checks.filter((check) => check.name !== name);
    });
    await rejectBridgeMutation('mismatched Cocina catalog fails closed', (report) => {
      report.checks.find((check) => check.name.startsWith('Cocina schema')).constraintCount = 8;
    });
    await rejectBridgeMutation('mismatched 3D.14 fingerprint fails closed', (report) => {
      report.checks.find((check) => check.name.startsWith('authentic 3D.14')).sha256 = '0'.repeat(64);
    });
    await rejectBridgeMutation('contradictory settlement effects fail closed', (report) => {
      report.checks.find((check) => check.name.startsWith('Restaurant settlement and replay')).payments = 2;
    });
    await rejectBridgeMutation('missing Staff owner admission check fails closed', (report) => {
      report.checks = report.checks.filter((check) => !check.name.startsWith('Staff owner admitted'));
    });
    await rejectBridgeMutation('missing Cocina producer check fails closed', (report) => {
      report.checks = report.checks.filter((check) => !check.name.startsWith('authentic Cocina provisioning'));
    });
    await rejectBridgeMutation('duplicate mandatory catalog check fails closed', (report) => {
      report.checks.push(structuredClone(report.checks.find((check) => check.name.startsWith('Cocina schema'))));
    });
    await rejectBridgeMutation('NOT_RUN mandatory check fails closed', (report) => {
      report.checks.find((check) => check.name.startsWith('financial schema')).status = 'NOT_RUN';
    });
    for (const key of ['runId', 'runAttempt']) {
      const original = overlay[key];
      overlay[key] = '999999';
      await writeReports();
      assert.throws(runGate, (error) => error.status === 1, `wrong overlay ${key} fails closed`);
      overlay[key] = original;
    }
    const originalOverlaySha = overlay.commitSha;
    overlay.commitSha = 'c'.repeat(40);
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'wrong overlay SHA fails closed');
    overlay.commitSha = originalOverlaySha;
    const originalOverlaySchemaVersion = overlay.schemaVersion;
    delete overlay.schemaVersion;
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'missing overlay schema version fails closed');
    overlay.schemaVersion = originalOverlaySchemaVersion;
    const originalOverlayFixtureKind = overlay.fixtureKind;
    overlay.fixtureKind = 1;
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'wrong overlay synthetic fixture type fails closed');
    overlay.fixtureKind = originalOverlayFixtureKind;
    const originalOverlayCase = overlay.cases[1];
    overlay.cases[1] = structuredClone(overlay.cases[0]);
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'duplicate overlay scenario fails closed');
    overlay.cases[1] = originalOverlayCase;

    await rejectBridgeMutation('missing financial race fails closed', (report) => { report.financialRaces.pop(); });
    for (const name of ['F1', 'F2']) await rejectBridgeMutation(`missing ${name} fails closed`, (report) => {
      report.financialRaces = report.financialRaces.filter((row) => row.name !== name);
    });
    await rejectBridgeMutation('missing cancellation-first serialization fails closed', (report) => { delete report.financialRaces[0].alternateOrder; });
    await rejectBridgeMutation('unobserved cancellation-first lock fails closed', (report) => { report.financialRaces[0].alternateOrder.lockObservations[0].blockedBy = []; });
    await rejectBridgeMutation('cancellation-first orphan sale fails closed', (report) => { report.financialRaces[0].alternateOrder.finalState.sales = 1; });
    await rejectBridgeMutation('cancellation-first wrong parent fails closed', (report) => { report.financialRaces[0].alternateOrder.parentId = 'another-parent'; });
    await rejectBridgeMutation('cancellation-first wrong license fails closed', (report) => { report.financialRaces[0].alternateOrder.actor.licenseId = 'another-license'; });
    await rejectBridgeMutation('cancellation-first unreported release order fails closed', (report) => { report.financialRaces[0].alternateOrder.releaseOrder.pop(); });
    await rejectBridgeMutation('C5 contradictory parent fails closed', (report) => { report.cancellation.find((row) => row.name === 'C5').parentId = 'another'; });
    await rejectBridgeMutation('duplicate writer signature fails closed', (report) => { report.writerChecks[1].signature = report.writerChecks[0].signature; });
    await rejectBridgeMutation('unknown writer signature fails closed', (report) => { report.writerChecks[9].signature = 'public.unknown_writer()'; });
    await rejectBridgeMutation('missing writer signature fails closed', (report) => { report.writerChecks.pop(); });
    await rejectBridgeMutation('writer security metadata drift fails closed', (report) => { report.writerChecks[3].aclSemanticallyPreserved = false; });
    await rejectBridgeMutation('unobserved financial blocker fails closed', (report) => { report.financialRaces[0].lockObservations[0].blockedBy = []; });
    await rejectBridgeMutation('financial receipt mismatch fails closed', (report) => { report.financialRaces[1].contenderReceipt.success = false; });
    await rejectBridgeMutation('duplicate payment fails closed', (report) => { report.financialRaces[0].finalState.payments = 2; });
    for (const name of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6']) await rejectBridgeMutation(`missing ${name} fails closed`, (report) => {
      report.cancellation = report.cancellation.filter((row) => row.name !== name);
    });
    await rejectBridgeMutation('missing C4 post-commit connection evidence fails closed', (report) => { delete report.cancellation.find((row) => row.name === 'C4').replayBoundary; });
    await rejectBridgeMutation('C4 same transaction as C1 fails closed', (report) => {
      report.cancellation.find((row) => row.name === 'C4').replayBoundary.transactionId = report.cancellation.find((row) => row.name === 'C1').transactionBoundary.transactionId;
    });
    await rejectBridgeMutation('missing cancellation snapshot fails closed', (report) => { delete report.cancellation.find((row) => row.name === 'C1').stateAfter; });
    await rejectBridgeMutation('denied cancellation mutation fails closed', (report) => { report.cancellation.find((row) => row.name === 'C2').stateAfter.parent.status = 'cancelled'; });
    await rejectBridgeMutation('cancellation financial effect fails closed', (report) => { report.cancellation.find((row) => row.name === 'C6').financialEffects.after.sales += 1; });
    await rejectBridgeMutation('cancellation wrong SQLSTATE fails closed', (report) => { report.cancellation.find((row) => row.name === 'C3').sqlstate.state = '23505'; });
    await rejectBridgeMutation('wrong paid cancellation denial fails closed', (report) => { report.cancellation.find((row) => row.name === 'C3').denial = 'unknown'; });
    await rejectBridgeMutation('cancellation race must refer to F1', (report) => { report.cancellation.find((row) => row.name === 'C5').financialRace = 'F2'; });

    await rejectBridgeMutation('wrong commit SHA must fail closed', (report) => { report.commitSha = 'b'.repeat(40); });
    await rejectBridgeMutation('wrong workflow run ID must fail closed', (report) => { report.runId = '1234567891'; });
    await rejectBridgeMutation('wrong workflow run attempt must fail closed', (report) => { report.runAttempt = '1'; });
    await rejectBridgeMutation('missing Admin check must fail closed', (report) => {
      report.checks = report.checks.filter((check) => check.name !== 'admin-off-private-setter-denied-anon');
    });
    await rejectBridgeMutation('duplicate Admin check must fail closed', (report) => {
      report.checks.push(structuredClone(report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon')));
    });
    await rejectBridgeMutation('unknown Admin check ID must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-initial-state').name = 'admin-off-initial-state-unknown';
    });
    await rejectBridgeMutation('unknown extra Admin check ID must fail closed', (report) => {
      report.checks.push({ name: 'admin-off-unexpected', status: 'PASS' });
    });
    await rejectBridgeMutation('FAIL Admin status must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').status = 'FAIL';
    });
    await rejectBridgeMutation('string boolean must fail closed', (report) => {
      report.adminOff.initialState.writesPaused = 'false';
      report.checks.find((check) => check.name === 'admin-off-initial-state').writesPaused = 'false';
    });
    await rejectBridgeMutation('wrong contract version must fail closed', (report) => {
      report.adminOff.initialState.contractVersion = 2;
      report.checks.find((check) => check.name === 'admin-off-initial-state').contractVersion = 2;
    });
    await rejectBridgeMutation('wrong endpoint contract version must fail closed', (report) => {
      report.adminOff.contractResponse.contractVersion = 2;
      report.checks.find((check) => check.name === 'admin-off-contract-response').contractVersion = 2;
    });
    await rejectBridgeMutation('activation rows above zero must fail closed', (report) => {
      report.adminOff.initialState.activeActivationRows = 1;
      report.checks.find((check) => check.name === 'admin-off-initial-state').activeActivationRows = 1;
    });
    await rejectBridgeMutation('endpoint Admin enabled must fail closed', (report) => {
      report.adminOff.contractResponse.adminSupervisionAvailable = true;
      report.checks.find((check) => check.name === 'admin-off-contract-response').adminSupervisionAvailable = true;
    });
    await rejectBridgeMutation('missing endpoint capability must fail closed', (report) => {
      delete report.adminOff.contractResponse.adminSupervisionAvailable;
    });
    await rejectBridgeMutation('setter success must fail closed', (report) => {
      report.adminOff.setterAttempt.rejected = false;
      report.checks.find((check) => check.name === 'admin-off-setter-rejected-no-state-change').rejected = false;
    });
    await rejectBridgeMutation('unexpected setter rejection must fail closed', (report) => {
      report.adminOff.setterAttempt.errorMessage = 'arbitrary exception';
      report.checks.find((check) => check.name === 'admin-off-setter-rejected-no-state-change').errorMessage = 'arbitrary exception';
    });
    await rejectBridgeMutation('unexpected setter SQLSTATE must fail closed', (report) => {
      report.adminOff.setterAttempt.sqlstate = '42501';
      report.checks.find((check) => check.name === 'admin-off-setter-rejected-no-state-change').sqlstate = '42501';
    });
    await rejectBridgeMutation('contradictory post-rejection state must fail closed', (report) => {
      report.adminOff.setterAttempt.stateAfter.activeActivationRows = 1;
    });
    await rejectBridgeMutation('anon denial mutation must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon').denialSqlstate = '00000';
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'anon').denialSqlstate = '00000';
    });
    await rejectBridgeMutation('anon denial message mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'anon').denialMessage = 'an unrelated error';
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon').denialMessage = 'an unrelated error';
    });
    await rejectBridgeMutation('anon denial state mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'anon').stateAfter.activeActivationRows = 1;
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-anon').stateAfter.activeActivationRows = 1;
    });
    await rejectBridgeMutation('anon role privilege mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.anonCanExecuteSetter = true;
    });
    await rejectBridgeMutation('authenticated denial mutation must fail closed', (report) => {
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').denialSqlstate = '00000';
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'authenticated').denialSqlstate = '00000';
    });
    await rejectBridgeMutation('authenticated denial message mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'authenticated').denialMessage = 'an unrelated error';
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').denialMessage = 'an unrelated error';
    });
    await rejectBridgeMutation('authenticated denial state mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.denials.find((denial) => denial.role === 'authenticated').stateAfter.activeActivationRows = 1;
      report.checks.find((check) => check.name === 'admin-off-private-setter-denied-authenticated').stateAfter.activeActivationRows = 1;
    });
    await rejectBridgeMutation('authenticated role privilege mutation must fail closed', (report) => {
      report.adminOff.roleMatrix.authenticatedCanExecuteSetter = true;
    });
    await rejectBridgeMutation('PASS with failure diagnostics must fail closed', (report) => {
      report.failedStage = 'synthetic failure';
      report.error = 'synthetic error';
      report.errorStack = 'synthetic stack';
    });
    await rejectBridgeMutation('missing Admin evidence report must fail closed', (report) => { delete report.adminOff; });
    await rejectBridgeMutation('missing Cocina evidence must fail closed', (report) => { delete report.preparationStationDependencies; });
    await rejectBridgeMutation('missing Cocina scenario must fail closed', (report) => { report.preparationStationDependencies.cases.pop(); });
    await rejectBridgeMutation('wrong item parent must fail closed', (report) => {
      report.preparationStationDependencies.cases[0].parentItemRelationship.itemParentId = 'another-parent';
    });
    await rejectBridgeMutation('missing observed Cocina locks must fail closed', (report) => {
      report.preparationStationDependencies.cases[4].observation = [];
    });
    await rejectBridgeMutation('missing client evidence must fail closed', (report) => {
      report.checks = report.checks.filter((check) => !check.name.startsWith('legacy and versioned clients'));
    });
    await rejectBridgeMutation('client item license must fail closed', (report) => {
      report.checks.find((check) => check.name.startsWith('legacy and versioned clients')).versioned.relationship.itemLicenseId = 'another-license';
    });
    await rejectBridgeMutation('replay cannot be counted as a cutover race', (report) => {
      report.concurrency[3].category = 'CUTOVER_COMMIT_RACE';
    });
    await rejectBridgeMutation('missing lock identity must fail closed', (report) => {
      report.concurrency[0].lockObservations.pauseWaiting[0].objectId = 999;
    });
    await rejectBridgeMutation('unrelated blocking session must fail closed', (report) => {
      report.concurrency[0].lockObservations.pauseActivity[0].blockedBy = [999];
    });
    await rejectBridgeMutation('missing new writer wait must fail closed', (report) => {
      report.concurrency[0].lockObservations.newWriteActivity = [];
    });

    await rejectBridgeMutation('writer body drift must fail closed', (report) => { report.writerChecks[3].bodyRecoveredExactly = false; });

    const originalBridgeBytes = await readFile(bridgePath);
    await rm(bridgePath);
    assert.throws(runGate, (error) => error.status === 1, 'missing bridge report must fail closed');
    await writeFile(bridgePath, originalBridgeBytes);

    await writeFile(bridgePath, '{malformed');
    assert.throws(runGate, (error) => error.status === 1, 'malformed bridge JSON must fail closed');

    const originalOverlayBytes = await readFile(overlayPath);
    await rm(overlayPath);
    assert.throws(runGate, (error) => error.status === 1, 'missing overlay report must fail closed');
    await writeFile(overlayPath, originalOverlayBytes);

    overlay.cases[4].status = 'FAIL';
    await writeReports();
    assert.throws(runGate, (error) => error.status === 1, 'failed case status must fail closed');

    overlay.cases[4].status = 'PASS';
    await writeReports();
    await writeFile(overlayPath, '{malformed');
    assert.throws(runGate, (error) => error.status === 1, 'malformed JSON must fail closed');
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('synthetic overlay helper is self-contained and never embeds the remote ledger', async () => {
  const source = await readFile(overlayPath, 'utf8');
  const runner = await readFile(path.join(root, 'scripts/supabase/pr352-r6-synthetic-ledger-overlay-test.mjs'), 'utf8');
  assert.match(runner, /report\.commitSha = process\.env\.GITHUB_SHA\s*\?\?\s*null/);
  assert.match(source, /synthetic-only/);
  assert.match(source, /canonicalLedgerRepresentation/);
  assert.match(source, /fingerprint mismatch/);
  assert.match(source, /drift detected/);
  assert.match(source, /exactly one approved candidate migration/);
  assert.match(source, /0700/);
  assert.doesNotMatch(source, /productionProjectRef|pr352-r5-production-ledger-fingerprint-manifest|DELETE\s+FROM/i);
});

// The captured reserve function stores caller K separately from its server-owned internal key.
test('settlement and rejection probes query the authentic external financial key namespace',async()=>{
  const source=await readFile(path.join(root,'scripts/supabase/pr352-r6-real-bridge-pg176-test.mjs'),'utf8');
  const functions=JSON.parse(await readFile(path.join(root,'supabase/tests/fixtures/pr338-real-financial/02-function-sources.json'),'utf8'));
  const reserve=functions.find(sql=>sql.startsWith('CREATE OR REPLACE FUNCTION private.reserve_financial_operation_v1('));
  assert.ok(reserve);
  assert.match(reserve,/id, license_id, idempotency_key, legacy_idempotency_key/);
  assert.match(reserve,/v_operation_id, p_license_id, p_idempotency_key, v_internal_idempotency_key/);
  const internalKey=functions.find(sql=>sql.startsWith('CREATE OR REPLACE FUNCTION private.financial_operation_internal_key_v1('));
  assert.ok(internalKey);
  assert.ok(internalKey.includes("return 'financial-v1:' || p_operation_type || ':' || p_operation_id::text;"));
  for(const key of ['bridge-alias-contradiction','bridge-paused-write','bridge-restaurant-settlement']) {
    assert.ok(source.includes("where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key='"+key+"'"));
    assert.ok(!source.includes("legacy_idempotency_key='"+key+"'"));
  }
  const alias=source.slice(source.indexOf("currentStage = 'contradictory aliases'"),
    source.indexOf("currentStage = 'paused transition blocks a new Restaurant operation'"));
  const paused=source.slice(source.indexOf("currentStage = 'paused transition blocks a new Restaurant operation'"),
    source.indexOf("currentStage = 'cutover concurrency and unrelated rubric operation'"));
  for(const [block,key,rejection,effectError] of [
    [alias,'bridge-alias-contradiction','RESTAURANT_ORDER_CONTEXT_MISMATCH','CONTRADICTORY_ALIAS_CAUSED_FINANCIAL_EFFECT'],
    [paused,'bridge-paused-write','RESTAURANT_CONTRACT_MAINTENANCE','PAUSED_RESTAURANT_WRITE_CAUSED_FINANCIAL_EFFECT'],
  ]) {
    assert.ok(block.includes("if exists(select 1 from public.pos_financial_operations where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key='"+key+"')"));
    assert.ok(block.includes("if state<>'P0001' or message<>'"+rejection+"' then raise; end if;"));
    assert.ok(block.includes("or exists(select 1 from public.pos_sales where id='bridge-restaurant-a')"));
    assert.ok(block.includes("raise exception '"+effectError+"';"));
  }
  assert.ok(alias.includes("local_order_id in ('bridge-restaurant-a','bridge-restaurant-b') and payment_status='paid'"));
  const settlement=source.slice(source.indexOf("currentStage = 'Restaurant financial settlement and replay'"),
    source.indexOf("currentStage = 'concurrent settlement versus cancellation and concurrent replay'"));
  assert.ok(settlement.includes("'bridge-restaurant-settlement',h,'sale.cashier_inventory',req)"));
  assert.ok(settlement.includes("if first_receipt is distinct from replay_receipt or coalesce((first_receipt->>'success')::boolean,false) is not true then"));
  assert.ok(settlement.includes("if (select count(*) from public.pos_sales where id='bridge-restaurant-a')<>1\n      or (select count(*) from public.pos_sale_payments where sale_id='bridge-restaurant-a')<>1\n      or (select count(*) from public.pos_financial_operations where license_id='00000000-0000-0000-0000-000000000001'::uuid and idempotency_key='bridge-restaurant-settlement')<>1\n      or (select count(*) from public.pos_inventory_movements where product_id='bridge-restaurant-product')<>1\n      or not exists(select 1 from public.pos_restaurant_orders where local_order_id='bridge-restaurant-a'\n        and payment_status='paid' and paid_sale_id='bridge-restaurant-a') then"));
  assert.ok(settlement.includes("raise exception 'BRIDGE_SETTLEMENT_EFFECT_COUNT_MISMATCH' using detail=jsonb_build_object("));
  for(const field of ['sales','payments','operations','inventoryMovements','parentPaid'])
    assert.ok(settlement.includes("'"+field+"',"),'Failure detail must identify '+field);
});
