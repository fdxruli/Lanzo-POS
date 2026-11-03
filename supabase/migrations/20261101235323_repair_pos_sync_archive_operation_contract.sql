-- Forward-only repair of the REST.8 archive event contract.
-- Expected baseline: validated 18-operation CHECK from CASH PRO identity.
-- Do not apply through an unfiltered db push: deploy this exact file/version
-- only after owner approval. No rows, RPC bodies, ACL or RLS are changed.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Serialize inspection and replacement, including concurrent DDL. Other
-- sessions see either the old CHECK or the new CHECK, never an absent CHECK.
lock table public.pos_sync_events in access exclusive mode;

do $archive_contract$
declare
  previous_definition constant text :=
    $expected$CHECK (operation = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'restore'::text, 'upsert'::text, 'upsert_shadow'::text, 'cloud_commit'::text, 'cancel'::text, 'toggle_status'::text, 'status_update'::text, 'status_recalculate'::text, 'sync_checkpoint'::text, 'open'::text, 'close'::text, 'movement'::text, 'adjust'::text, 'identity_adopt'::text, 'unknown'::text]))$expected$;
  current_constraint record;
  operation_attribute smallint;
begin
  if (select relkind from pg_catalog.pg_class where oid='public.pos_sync_events'::regclass) <> 'r' then
    raise exception 'SYNC_ARCHIVE_CONTRACT_TABLE_KIND_MISMATCH' using errcode='P0001';
  end if;
  select attnum into operation_attribute from pg_catalog.pg_attribute
    where attrelid='public.pos_sync_events'::regclass and attname='operation'
      and atttypid='pg_catalog.text'::regtype and attnotnull and not attisdropped;
  if operation_attribute is null then
    raise exception 'SYNC_ARCHIVE_CONTRACT_COLUMN_MISMATCH' using errcode='P0001';
  end if;
  select contype,convalidated,connoinherit,conislocal,coninhcount,conkey,
    pg_catalog.pg_get_constraintdef(oid,true) as definition
    into current_constraint from pg_catalog.pg_constraint
    where conrelid='public.pos_sync_events'::regclass
      and conname='pos_sync_events_operation_check';
  if not found then
    raise exception 'SYNC_ARCHIVE_CONTRACT_BASELINE_MISSING' using errcode='P0001';
  end if;
  if current_constraint.contype <> 'c' or not current_constraint.convalidated
      or current_constraint.connoinherit or not current_constraint.conislocal
      or current_constraint.coninhcount <> 0
      or current_constraint.conkey is distinct from array[operation_attribute]::smallint[]
      or current_constraint.definition is distinct from previous_definition then
    raise exception 'SYNC_ARCHIVE_CONTRACT_BASELINE_MISMATCH' using errcode='P0001';
  end if;
end;
$archive_contract$;

alter table public.pos_sync_events
  drop constraint pos_sync_events_operation_check,
  add constraint pos_sync_events_operation_check check (
    operation = any (array[
      'create'::text, 'update'::text, 'delete'::text, 'restore'::text,
      'upsert'::text, 'upsert_shadow'::text, 'cloud_commit'::text,
      'cancel'::text, 'toggle_status'::text, 'status_update'::text,
      'status_recalculate'::text, 'sync_checkpoint'::text, 'open'::text,
      'close'::text, 'movement'::text, 'adjust'::text, 'identity_adopt'::text,
      'unknown'::text, 'archive'::text
    ])
  );

commit;
