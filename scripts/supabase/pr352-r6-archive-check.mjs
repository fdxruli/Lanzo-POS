// R6.36 isolated before/after CHECK tests. Derived from the reviewed R6.35 lab.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const priorOperations = Object.freeze(['create','update','delete','restore','upsert','upsert_shadow',
  'cloud_commit','cancel','toggle_status','status_update','status_recalculate','sync_checkpoint',
  'open','close','movement','adjust','identity_adopt','unknown']);
export const candidateOperations = Object.freeze([...priorOperations,'archive']);
export const migrationName = '20261101235323_repair_pos_sync_archive_operation_contract.sql';
export const migrationSha256 = '9e89b368be660dd31a975a5afd87082944bb0601f045c33be6e134476e2cf5ab';
export const sourceCommit = '8ea479fcaee4596dbcf59d93f07a038d7602210f';
export const quote = value => "'" + String(value).replaceAll("'", "''") + "'";

export function assertMigrationBytes(bytes) {
  assert.equal(createHash('sha256').update(bytes).digest('hex'),migrationSha256,
    'QA must execute the exact canonical R6.35 migration bytes');
}

export function assertArchiveCheckEvidence(checks,identity) {
  const phases=[['ARCHIVE_CHECK_BEFORE_MIGRATION','BASELINE_PRODUCTION_CURRENT',priorOperations,'archive'],
    ['ARCHIVE_CHECK_AFTER_MIGRATION','CANDIDATE_SCHEMA_AFTER_MIGRATION',candidateOperations,'r635_invalid_operation']];
  for(const [name,schema,operations,rejected] of phases) {
    const matches=checks.filter(c=>c.name===name); assert.equal(matches.length,1,name+' must be unique and present');
    const c=matches[0]; assert.equal(c.status,'PASS'); assert.equal(c.schema,schema);
    for(const field of ['commitSha','runId','runAttempt'])assert.equal(c[field],identity[field]);
    assert.equal(c.migrationSha256,migrationSha256); assert.equal(c.sourceCommit,sourceCommit);
    assert.equal(c.serverVersionNum,'170006'); assertCatalog(c.catalog,operations);
    assert.deepEqual(c.allowedOperations,operations);
    assert.equal(c.recorder.accepted,operations.length); assert.equal(c.recorder.rejectedSqlstate,'23514');
    assert.equal(c.rejectedOperation,rejected); assert.equal(c.rowsAndSecurityUnchanged,true);
    assert.equal(c.rollbackObservedFromIndependentConnections,true);
    if(name==='ARCHIVE_CHECK_AFTER_MIGRATION') {
      assert.deepEqual(c.rejectedMigrations.map(r=>r.name),
        ['missing-check','unknown-check','unvalidated-check','top-level-install-rollback']);
      for(const row of c.rejectedMigrations) {assert.equal(row.exitCode,3);assert.equal(row.sqlstate,'P0001');}
    }
  }
}

export function assertCatalog(catalog, operations) {
  assert.equal(catalog.validated,true);
  assert.equal(catalog.type,'c');
  const definition = `CHECK (operation = ANY (ARRAY[${operations.map(x=>quote(x)+'::text').join(', ')}]))`;
  assert.equal(catalog.definition,definition,'Exact named CHECK and ordering must match');
}

export async function catalog(query) {
  return JSON.parse(await query(`select jsonb_build_object('type',contype,'validated',convalidated,
    'definition',pg_get_constraintdef(oid,true))::text from pg_constraint
    where conrelid='public.pos_sync_events'::regclass and conname='pos_sync_events_operation_check'`));
}

export async function businessSnapshot(query) {
  // Synthetic database only. Includes existing event rows and receipts, not
  // nontransactional sequence counters (gaps after rollback are legitimate).
  const privatePresent=await query("select to_regclass('private.restaurant_order_upsert_replay_proofs_v1') is not null");
  const privateSql=privatePresent==='t' ? `'proofs',(select coalesce(jsonb_agg(to_jsonb(t) order by license_id,idempotency_key),'[]')
      from private.restaurant_order_upsert_replay_proofs_v1 t),
    'attempts',(select count(*) from private.restaurant_upsert_attempts_v1),
    'permits',(select count(*) from private.restaurant_bridge_cancel_permits),` :
    "'proofs',null,'attempts',null,'permits',null,";
  return JSON.parse(await query(`select jsonb_build_object(
    'parents',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.pos_restaurant_orders t),
    'items',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.pos_restaurant_order_items t),
    'events',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.pos_sync_events t),
    'ledger',(select coalesce(jsonb_agg(to_jsonb(t) order by id),'[]') from public.pos_idempotency_keys t),
    ${privateSql}
    'sales',(select count(*) from public.pos_sales),'payments',(select count(*) from public.pos_sale_payments),
    'cash',(select count(*) from public.pos_cash_movements),'inventory',(select count(*) from public.pos_inventory_movements),
    'credit',(select count(*) from public.pos_customer_ledger),
    'stock',(select coalesce(jsonb_agg(jsonb_build_array(id,stock) order by id),'[]') from public.pos_products),
    'security',(select jsonb_build_object('owner',relowner,'acl',relacl,'rls',relrowsecurity,'forceRls',relforcerowsecurity)
      from pg_class where oid='public.pos_sync_events'::regclass),
    'otherConstraints',(select jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid,true),convalidated) order by conname)
      from pg_constraint where conrelid='public.pos_sync_events'::regclass and conname<>'pos_sync_events_operation_check'),
    'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(oid,true) order by tgname),'[]') from pg_trigger
      where tgrelid='public.pos_sync_events'::regclass and not tgisinternal),
    'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by polname),'[]') from pg_policy p
      where polrelid='public.pos_sync_events'::regclass))::text`));
}

function recorder(operation) {
  return `private.record_pos_sync_event('00000000-0000-0000-0000-000000000001'::uuid,
    'restaurant_order','r635-contract-only',${quote(operation)},
    '00000000-0000-0000-0000-00000000000a'::uuid,null,'r635-contract-only',
    '{"synthetic":true}'::jsonb,1)`;
}

async function recorderContract(query, allowed, rejected) {
  // Every accepted value really reaches the original recorder and table.
  // The entire transaction is rolled back; diagnostic SQLSTATE comes from PG.
  const batch = `begin; do $test$ declare observed text; constraint_name text; begin
    ${allowed.map(op=>`perform ${recorder(op)};`).join('\n')}
    begin perform ${recorder(rejected)}; raise exception 'R635_INVALID_EVENT_ACCEPTED';
    exception when check_violation then
      get stacked diagnostics observed=returned_sqlstate,constraint_name=constraint_name;
      if constraint_name<>'pos_sync_events_operation_check' then raise; end if;
      perform set_config('r635.rejected_state',observed,true);
    end;
  end $test$;
  select jsonb_build_object('accepted',${allowed.length},'rejectedSqlstate',current_setting('r635.rejected_state'))::text;
  rollback;`;
  const result=JSON.parse(await query(batch));
  assert.equal(result.accepted,allowed.length); assert.equal(result.rejectedSqlstate,'23514');
  return result;
}

export async function runArchiveContractRepair({query,psqlBin,env,migrationPath,identity,onBefore}) {
  assert.equal(await query("select current_database()||'|'||current_setting('server_version_num')"),
    'pr352_bridge_isolated|170006');
  assert.equal(env.PGHOST,'127.0.0.1');
  const bytes=await readFile(migrationPath);assertMigrationBytes(bytes);
  const source=bytes.toString('utf8');
  const beforeCatalog=await catalog(query); assertCatalog(beforeCatalog,priorOperations);
  const before=await businessSnapshot(query);
  const baseline=await recorderContract(query,priorOperations,'archive');
  assert.deepEqual(await businessSnapshot(query),before,'Baseline recorder probes must roll back');
  const beforeCheck={name:'ARCHIVE_CHECK_BEFORE_MIGRATION',status:'PASS',...identity,
    schema:'BASELINE_PRODUCTION_CURRENT',sourceCommit,migrationSha256,serverVersionNum:'170006',
    catalog:beforeCatalog,allowedOperations:[...priorOperations],recorder:baseline,rejectedOperation:'archive',
    rowsAndSecurityUnchanged:true,rollbackObservedFromIndependentConnections:true};
  onBefore(beforeCheck);
  const temp=await mkdtemp(path.join(os.tmpdir(),'r635-migration-'));
  const execute=promisify(execFile);
  const call= file => execute(psqlBin,['-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose',
    '-h','127.0.0.1','-p',env.PGPORT||'5432','-U',env.PGUSER||'postgres',
    '-d','pr352_bridge_isolated','-f',file],{env,windowsHide:true,timeout:45000,maxBuffer:2000000});
  const rejected=[];
  async function expectFailure(label,sql,message) {
    const file=path.join(temp,label+'.sql'); await writeFile(file,sql);
    let error; try { await call(file); } catch(e) { error=e; }
    assert.ok(error,`${label} must fail`); assert.equal(error.code,3); assert.equal(error.signal,null);
    assert.match(error.stderr,new RegExp('ERROR:\\s+P0001: '+message));
    assertCatalog(await catalog(query),priorOperations);
    assert.deepEqual(await businessSnapshot(query),before,'Failed migration must restore rows/security/schema');
    rejected.push({name:label,exitCode:error.code,sqlstate:'P0001',message});
  }
  try {
    for (const [label,ddl,message] of [
      ['missing-check','alter table public.pos_sync_events drop constraint pos_sync_events_operation_check;',
        'SYNC_ARCHIVE_CONTRACT_BASELINE_MISSING'],
      ['unknown-check',`alter table public.pos_sync_events drop constraint pos_sync_events_operation_check;
        alter table public.pos_sync_events add constraint pos_sync_events_operation_check check (operation <> 'bogus');`,
        'SYNC_ARCHIVE_CONTRACT_BASELINE_MISMATCH'],
      ['unvalidated-check',`alter table public.pos_sync_events drop constraint pos_sync_events_operation_check;
        alter table public.pos_sync_events add constraint pos_sync_events_operation_check ${beforeCatalog.definition} not valid;`,
        'SYNC_ARCHIVE_CONTRACT_BASELINE_MISMATCH'],
    ]) {
      await expectFailure(label,source.replace('lock table public.pos_sync_events',ddl+'\nlock table public.pos_sync_events'),message);
    }
    await expectFailure('top-level-install-rollback',source.replace(/commit;\s*$/,
      "do $$ begin raise exception 'R635_FORCED_INSTALL_ROLLBACK' using errcode='P0001'; end $$;\ncommit;"),
      'R635_FORCED_INSTALL_ROLLBACK');
    await call(migrationPath);
    const afterCatalog=await catalog(query); assertCatalog(afterCatalog,candidateOperations);
    assert.deepEqual(await businessSnapshot(query),before,'Migration must change no rows, ACL/RLS or other constraints');
    const after=await recorderContract(query,candidateOperations,'r635_invalid_operation');
    assert.deepEqual(await businessSnapshot(query),before,'Candidate recorder probes must roll back');
    return {name:'ARCHIVE_CHECK_AFTER_MIGRATION',status:'PASS',...identity,
      schema:'CANDIDATE_SCHEMA_AFTER_MIGRATION',sourceCommit,migrationSha256,serverVersionNum:'170006',
      catalog:afterCatalog,allowedOperations:[...candidateOperations],recorder:after,
      rejectedOperation:'r635_invalid_operation',rejectedMigrations:rejected,
      rowsAndSecurityUnchanged:true,rollbackObservedFromIndependentConnections:true};
  } finally { await rm(temp,{recursive:true,force:true}); }
}

export async function assertArchiveReplay({query,receipt,originalSql,snapshot}) {
  assert.equal(receipt.success,true);
  const event=receipt.event;
  assert.equal(event.entity_type,'restaurant_order'); assert.equal(event.operation,'archive');
  assert.equal(event.license_id,'00000000-0000-0000-0000-000000000001');
  assert.equal(event.idempotency_key,receipt.idempotency_key);
  assert.equal(event.entity_id,receipt.order.id); assert.equal(event.server_version,receipt.order.serverVersion);
  assert.equal(event.server_version,receipt.serverVersion); assert.equal(event.change_seq,receipt.changeSeq);
  assert.equal(event.actor_device_id,'00000000-0000-0000-0000-00000000000a');
  assert.equal(event.actor_staff_user_id,null);
  assert.ok(Number.isInteger(event.change_seq)&&event.change_seq>0);
  assert.equal(event.metadata.action,'archive'); assert.equal(event.metadata.reason,'R20 archived replay setup');
  assert.equal(event.metadata.source,'pos_archive_restaurant_order'); assert.equal(event.metadata.status,'cancelled');
  assert.equal(event.metadata.archived_at,receipt.order.archivedAt);
  assert.equal(receipt.order.status,'cancelled'); assert.equal(receipt.order.paymentStatus,'unpaid');
  assert.equal(receipt.order.deletedAt ?? null,null); assert.equal(receipt.order.checkoutClosedAt,null);
  const before=await snapshot();
  const persisted=JSON.parse(await query(`select jsonb_build_object('events',count(*),'event',jsonb_agg(to_jsonb(e))->0)::text
    from public.pos_sync_events e where license_id='00000000-0000-0000-0000-000000000001'::uuid
      and entity_id=${quote(receipt.order.id)} and operation='archive'`));
  assert.equal(persisted.events,1); assert.deepEqual(persisted.event,event);
  assert.deepEqual(JSON.parse(await query(originalSql)),receipt,'Authentic archive same-key replay must return original receipt');
  assert.deepEqual(await snapshot(),before,'Archive replay cannot duplicate any business effect');
  const stored=JSON.parse(await query(`select response_payload::text from public.pos_idempotency_keys
    where license_id='00000000-0000-0000-0000-000000000001'::uuid
      and idempotency_key=${quote(receipt.idempotency_key)}`));
  assert.deepEqual(stored,receipt);
  return {name:'ARCHIVE_RPC_REPLAY_AFTER_REPAIR',status:'PASS',event,persistedEvents:persisted.events,
    replayIdentical:true,businessSnapshotUnchanged:true};
}
