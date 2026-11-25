-- POS sync transactional frontier v1. Candidate migration for the 4D/4E Draft PR.
-- It has not been installed in Production. The short write pause and drain
-- preconditions are documented in docs/sync/pos-sync-frontier-block1.md.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
declare
  v_name text;
  v_expected text;
  v_actual text;
  v_proc regprocedure;
  v_owner text;
  v_config text[];
  v_unsafe text;
  v_sequence record;
begin
  if to_regclass('public.pos_sync_events') is null or to_regclass('public.pos_change_seq') is null then
    raise exception 'POS_SYNC_FRONTIER_BASE_OBJECTS_MISSING';
  end if;
  if not exists (select 1 from pg_attribute where attrelid='public.pos_sync_events'::regclass and attname='change_seq' and attnotnull) then
    raise exception 'POS_SYNC_FRONTIER_CHANGE_SEQ_NOT_NULL_REQUIRED';
  end if;
  select s.seqcache,s.seqincrement,s.seqcycle,s.seqtypid::regtype into v_sequence
    from pg_sequence s where s.seqrelid='public.pos_change_seq'::regclass;
  if v_sequence.seqcache is distinct from 1 or v_sequence.seqincrement is distinct from 1
     or v_sequence.seqcycle is distinct from false or v_sequence.seqtypid is distinct from 'bigint'::regtype then
    raise exception 'POS_SYNC_FRONTIER_SEQUENCE_CONFIGURATION_UNSUPPORTED';
  end if;

  -- Read-only Production catalog hashes captured for the approved base. A
  -- changed reader/writer definition aborts rather than being wrapped blindly.
  for v_name,v_expected in select * from (values
    ('private.next_pos_change_seq()','6919def96147bf924ddcb6ba0bc8ca4d'),
    ('private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer)','a6d15fd981804853cc75124172431618'),
    ('public.pos_pull_sync_events_unlimited(text,text,text,text,bigint,integer)','b9ea58d3c88a34a78b7336b23636bfe2'),
    ('public.pos_pull_product_catalog_changes_unlimited(text,text,text,text,bigint,integer)','4c1ab193eec9b198977922c24eb0dad6'),
    ('public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer)','9930526ec8298529627f10a6d3207f2b'),
    ('public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer)','e5bcd79bd1ccc42407c9e0b4d33b675f'),
    ('public.pos_pull_sales_changes_unlimited(text,text,text,text,bigint,integer)','294afbbe97905d34779b78450f262c89'),
    ('public.pos_pull_cash_changes_unlimited(text,text,text,text,bigint,integer)','5fdcf7272f94894c663c2047e481f6dd'),
    ('public.pos_pull_layaway_changes(text,text,text,text,bigint,integer)','88d43f0846c673e5e70175c790234a52'),
    ('public.pos_pull_sync_events(text,text,text,text,bigint,integer)','749149bbe14813cc9bbc285f994d8c74'),
    ('public.pos_pull_product_catalog_changes(text,text,text,text,bigint,integer)','f0e465ee1055af60dfcf20cb266f4475'),
    ('public.pos_pull_customer_changes(text,text,text,text,bigint,integer)','06f371a75bc040e9e9b2a478a408961e'),
    ('public.pos_pull_customer_credit_changes(text,text,text,text,bigint,integer)','9cdfd27803e2709eef111b8165ef477c'),
    ('public.pos_pull_sales_changes(text,text,text,text,bigint,integer)','e6423b7bb75292be7ca4fa20811a8333'),
    ('public.pos_pull_cash_changes(text,text,text,text,bigint,integer)','d67b76217b6a6fd39739d3cdb2125fad'),
    ('public.pos_pull_customer_changes_v2(text,text,text,text,bigint,integer,jsonb)','406ccb055b92822155a5075ddbcc29c4'),
    ('public.pos_pull_customer_credit_changes_v2(text,text,text,text,bigint,integer,jsonb)','446fa488d0d36f7e79ad1aa8f3976946')
  ) expected(function_name,md5) loop
    v_proc := to_regprocedure(v_name);
    if v_proc is null then raise exception 'POS_SYNC_FRONTIER_FUNCTION_MISSING: %',v_name; end if;
    select md5(pg_get_functiondef(v_proc)),pg_get_userbyid(p.proowner),p.proconfig
      into v_actual,v_owner,v_config from pg_proc p where p.oid=v_proc;
    if v_actual is distinct from v_expected then
      raise exception 'POS_SYNC_FRONTIER_FUNCTION_DRIFT: % expected %, got %',v_name,v_expected,v_actual;
    end if;
    if v_owner is distinct from 'postgres' or not coalesce(v_config @> array['search_path=""']::text[],false) then
      raise exception 'POS_SYNC_FRONTIER_FUNCTION_SECURITY_DRIFT: %',v_name;
    end if;
  end loop;

  if position('private.next_pos_change_seq' in pg_get_functiondef(
       to_regprocedure('private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer)')))=0 then
    raise exception 'POS_SYNC_FRONTIER_EVENT_WRITER_BYPASSES_ALLOCATOR';
  end if;
  select string_agg(n.nspname||'.'||p.proname,', ' order by n.nspname,p.proname) into v_unsafe
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname not in ('pg_catalog','information_schema')
     and p.prosrc ~* 'insert[[:space:]]+into[[:space:]]+(public[.])?pos_sync_events'
     and p.oid<>to_regprocedure('private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer)');
  if v_unsafe is not null then raise exception 'POS_SYNC_FRONTIER_UNREGISTERED_EVENT_WRITERS: %',v_unsafe; end if;
  select string_agg(n.nspname||'.'||p.proname,', ' order by n.nspname,p.proname) into v_unsafe
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname not in ('pg_catalog','information_schema')
     and p.prosrc ~* 'nextval[[:space:]]*\([^)]*pos_change_seq'
     and p.oid<>to_regprocedure('private.next_pos_change_seq()');
  if v_unsafe is not null then raise exception 'POS_SYNC_FRONTIER_UNREGISTERED_SEQUENCE_ALLOCATORS: %',v_unsafe; end if;
end;
$preflight$;

alter function private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer)
  rename to record_pos_sync_event_legacy_frontier_v1;

create or replace function private.pos_sync_frontier_lock_keys_v1(p_license_id uuid)
returns table(p_coord_key bigint,p_marker_classid integer,p_marker_objid integer)
language sql immutable security invoker set search_path = ''
as $function$
  select pg_catalog.hashtextextended('lanzo:pos-sync-frontier:coord:v1:'||p_license_id::text,918273645),
         (-2147483648 | (pg_catalog.hashtext('lanzo:pos-sync-frontier:license:v1:'||p_license_id::text) & 1073741823)),
         pg_catalog.hashtext('lanzo:pos-sync-frontier:license:v1b:'||p_license_id::text)
   where p_license_id is not null;
$function$;

create or replace function private.pos_sync_frontier_lock_exclusive_v1(p_license_id uuid)
returns bigint language plpgsql volatile security invoker set search_path = ''
as $function$
declare v_key bigint; v_acquired boolean:=false; v_attempt integer;
begin
  select k.p_coord_key into v_key from private.pos_sync_frontier_lock_keys_v1(p_license_id) k;
  if v_key is null then raise exception 'POS_SYNC_FRONTIER_LICENSE_REQUIRED' using errcode='22004'; end if;
  for v_attempt in 1..100 loop
    if pg_catalog.pg_try_advisory_lock(v_key) then v_acquired:=true; exit; end if;
    perform pg_catalog.pg_sleep(0.002);
  end loop;
  if not v_acquired then raise exception 'POS_SYNC_FRONTIER_COORDINATOR_BUSY' using errcode='55P03'; end if;
  return v_key;
end;
$function$;

create or replace function private.pos_sync_frontier_lock_shared_v1(p_license_id uuid)
returns bigint language plpgsql volatile security invoker set search_path = ''
as $function$
declare v_key bigint; v_acquired boolean:=false; v_attempt integer;
begin
  select k.p_coord_key into v_key from private.pos_sync_frontier_lock_keys_v1(p_license_id) k;
  if v_key is null then raise exception 'POS_SYNC_FRONTIER_LICENSE_REQUIRED' using errcode='22004'; end if;
  for v_attempt in 1..100 loop
    if pg_catalog.pg_try_advisory_lock_shared(v_key) then v_acquired:=true; exit; end if;
    perform pg_catalog.pg_sleep(0.002);
  end loop;
  if not v_acquired then raise exception 'POS_SYNC_FRONTIER_COORDINATOR_BUSY' using errcode='55P03'; end if;
  return v_key;
end;
$function$;

create or replace function private.next_pos_change_seq()
returns bigint language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_license_id uuid; v_coord_key bigint; v_marker_classid integer; v_marker_objid integer;
  v_seq_high bigint; v_seq bigint; v_seq_hi integer; v_seq_lo integer;
  v_low_unsigned bigint; v_has_prior_marker boolean:=false; v_marker_witness text; v_xid text;
begin
  v_license_id:=nullif(current_setting('lanzo.pos_sync_license_id',true),'')::uuid;
  if v_license_id is null then raise exception 'POS_SYNC_FRONTIER_LICENSE_CONTEXT_REQUIRED' using errcode='22004'; end if;
  v_xid:=pg_catalog.pg_current_xact_id()::text;
  v_marker_witness:=current_setting('lanzo.pos_sync_frontier_marker_v1',true);
  if v_marker_witness=v_license_id::text||':'||v_xid then
    return pg_catalog.nextval('public.pos_change_seq'::regclass);
  end if;
  select k.p_coord_key,k.p_marker_classid,k.p_marker_objid into v_coord_key,v_marker_classid,v_marker_objid
    from private.pos_sync_frontier_lock_keys_v1(v_license_id) k;
  select case when s.is_called then s.last_value else 0 end into v_seq_high from public.pos_change_seq s;
  select exists (
    select 1 from pg_catalog.pg_locks lic join pg_catalog.pg_locks marker on marker.pid=lic.pid
     where lic.pid=pg_catalog.pg_backend_pid() and lic.locktype='advisory' and lic.granted
       and lic.mode='ShareLock' and lic.objsubid=2 and lic.classid=v_marker_classid::oid and lic.objid=v_marker_objid::oid
       and marker.locktype='advisory' and marker.granted and marker.mode='ShareLock' and marker.objsubid=2
       and ((marker.classid::bigint << 32)|marker.objid::bigint)>0
       and ((marker.classid::bigint << 32)|marker.objid::bigint)<=v_seq_high
  ) into v_has_prior_marker;
  if v_has_prior_marker then
    perform pg_catalog.set_config('lanzo.pos_sync_frontier_marker_v1',v_license_id::text||':'||v_xid,true);
    return pg_catalog.nextval('public.pos_change_seq'::regclass);
  end if;

  v_coord_key:=private.pos_sync_frontier_lock_exclusive_v1(v_license_id);
  begin
    v_seq:=pg_catalog.nextval('public.pos_change_seq'::regclass);
    if v_seq<=0 or v_seq>=4611686018427387904 then raise exception 'POS_SYNC_FRONTIER_SEQUENCE_OUT_OF_RANGE' using errcode='22003'; end if;
    v_seq_hi:=(v_seq >> 32)::integer;
    v_low_unsigned:=v_seq & 4294967295;
    v_seq_lo:=case when v_low_unsigned>=2147483648 then (v_low_unsigned-4294967296)::integer else v_low_unsigned::integer end;
    if not pg_catalog.pg_try_advisory_xact_lock_shared(v_marker_classid,v_marker_objid) then
      raise exception 'POS_SYNC_FRONTIER_LICENSE_MARKER_COLLISION' using errcode='55P03';
    end if;
    if not pg_catalog.pg_try_advisory_xact_lock_shared(v_seq_hi,v_seq_lo) then
      raise exception 'POS_SYNC_FRONTIER_SEQUENCE_MARKER_COLLISION:%',v_seq using errcode='55P03';
    end if;
  exception
    when query_canceled then perform pg_catalog.pg_advisory_unlock(v_coord_key); raise;
    when others then perform pg_catalog.pg_advisory_unlock(v_coord_key); raise;
  end;
  perform pg_catalog.pg_advisory_unlock(v_coord_key);
  perform pg_catalog.set_config('lanzo.pos_sync_frontier_marker_v1',v_license_id::text||':'||v_xid,true);
  return v_seq;
end;
$function$;

create or replace function private.pos_sync_safe_frontier_v1(p_license_id uuid)
returns table(safe_change_seq bigint,sync_deferred boolean)
language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_coord_key bigint; v_marker_classid integer; v_marker_objid integer; v_high bigint;
  v_min_pending bigint; v_has_marker boolean:=false; v_has_unmatched_marker boolean:=false;
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'POS_SYNC_FRONTIER_REQUIRES_READ_COMMITTED' using errcode='25001';
  end if;
  select k.p_coord_key,k.p_marker_classid,k.p_marker_objid into v_coord_key,v_marker_classid,v_marker_objid
    from private.pos_sync_frontier_lock_keys_v1(p_license_id) k;
  if v_coord_key is null then raise exception 'POS_SYNC_FRONTIER_LICENSE_REQUIRED' using errcode='22004'; end if;
  v_coord_key:=private.pos_sync_frontier_lock_shared_v1(p_license_id);
  begin
    select case when s.is_called then s.last_value else 0 end into v_high from public.pos_change_seq s;
    select exists (select 1 from pg_catalog.pg_locks lic where lic.locktype='advisory' and lic.granted
      and lic.mode='ShareLock' and lic.objsubid=2 and lic.classid=v_marker_classid::oid and lic.objid=v_marker_objid::oid)
      into v_has_marker;
    select min(mark.seq_value),coalesce(bool_or(mark.seq_value is null),false)
      into v_min_pending,v_has_unmatched_marker
      from (
        select distinct lic.pid,seq.classid,seq.objid,((seq.classid::bigint<<32)|seq.objid::bigint) as seq_value
          from pg_catalog.pg_locks lic
          left join pg_catalog.pg_locks seq on seq.pid=lic.pid and seq.locktype='advisory' and seq.granted
            and seq.mode='ShareLock' and seq.objsubid=2
            and ((seq.classid::bigint<<32)|seq.objid::bigint)>0
            and ((seq.classid::bigint<<32)|seq.objid::bigint)<=v_high
         where lic.locktype='advisory' and lic.granted and lic.mode='ShareLock' and lic.objsubid=2
           and lic.classid=v_marker_classid::oid and lic.objid=v_marker_objid::oid
      ) mark;
  exception
    when query_canceled then perform pg_catalog.pg_advisory_unlock_shared(v_coord_key); raise;
    when others then perform pg_catalog.pg_advisory_unlock_shared(v_coord_key); raise;
  end;
  perform pg_catalog.pg_advisory_unlock_shared(v_coord_key);
  safe_change_seq:=case when v_has_unmatched_marker then 0 when v_min_pending is null then v_high
                        else greatest(0,least(v_high,v_min_pending-1)) end;
  sync_deferred:=v_has_marker;
  return next;
end;
$function$;

create or replace function private.pos_sync_filter_json_rows_v1(p_rows jsonb,p_ids text[],p_id_field text)
returns jsonb language plpgsql immutable security invoker set search_path = ''
as $function$
begin
  if p_rows is null then return null; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'POS_SYNC_FRONTIER_INVALID_PROJECTION_ARRAY:%',p_id_field using errcode='22023'; end if;
  return coalesce((select jsonb_agg(row_value order by ordinal)
    from jsonb_array_elements(p_rows) with ordinality as r(row_value,ordinal)
    where row_value->>p_id_field=any(coalesce(p_ids,array[]::text[]))), '[]'::jsonb);
end;
$function$;

create or replace function private.pos_sync_filter_json_ids_v1(p_rows jsonb,p_ids text[])
returns jsonb language plpgsql immutable security invoker set search_path = ''
as $function$
begin
  if p_rows is null then return null; end if;
  if jsonb_typeof(p_rows)<>'array' then raise exception 'POS_SYNC_FRONTIER_INVALID_ID_ARRAY' using errcode='22023'; end if;
  return coalesce((select jsonb_agg(row_value order by ordinal)
    from jsonb_array_elements(p_rows) with ordinality as r(row_value,ordinal)
    where (case when jsonb_typeof(row_value)='string' then row_value #>> '{}' else row_value->>'id' end)
      =any(coalesce(p_ids,array[]::text[]))), '[]'::jsonb);
end;
$function$;

create or replace function private.pos_sync_project_safe_pull_v1(p_kind text,p_payload jsonb,p_events jsonb)
returns jsonb language plpgsql immutable security invoker set search_path = ''
as $function$
declare
  v_ids text[]; v_ids2 text[]; v_ids3 text[]; v_sessions text[]; v_deleted jsonb;
begin
  if p_kind='general' then return jsonb_set(p_payload,'{events}',p_events,true); end if;

  if p_kind='product' then
    select coalesce(array_agg(distinct e->>'entity_id') filter(where e->>'entity_type'='category'),array[]::text[]),
           coalesce(array_agg(distinct e->>'entity_id') filter(where e->>'entity_type'='product'),array[]::text[]),
           coalesce(array_agg(distinct e->>'entity_id') filter(where e->>'entity_type'='product_batch'),array[]::text[])
      into v_ids,v_ids2,v_ids3 from jsonb_array_elements(p_events) e;
    p_payload:=jsonb_set(p_payload,'{events}',p_events,true);
    p_payload:=jsonb_set(p_payload,'{categories}',private.pos_sync_filter_json_rows_v1(p_payload->'categories',v_ids,'id'),true);
    p_payload:=jsonb_set(p_payload,'{products}',private.pos_sync_filter_json_rows_v1(p_payload->'products',v_ids2,'id'),true);
    p_payload:=jsonb_set(p_payload,'{batches}',private.pos_sync_filter_json_rows_v1(p_payload->'batches',v_ids3,'id'),true);
    v_deleted:=coalesce(p_payload->'deleted_ids','{}'::jsonb);
    v_deleted:=jsonb_set(v_deleted,'{categories}',coalesce(private.pos_sync_filter_json_ids_v1(v_deleted->'categories',v_ids),'[]'::jsonb),true);
    v_deleted:=jsonb_set(v_deleted,'{products}',coalesce(private.pos_sync_filter_json_ids_v1(v_deleted->'products',v_ids2),'[]'::jsonb),true);
    v_deleted:=jsonb_set(v_deleted,'{batches}',coalesce(private.pos_sync_filter_json_ids_v1(v_deleted->'batches',v_ids3),'[]'::jsonb),true);
    return jsonb_set(p_payload,'{deleted_ids}',v_deleted,true);
  end if;

  if p_kind='customer' then
    select coalesce(array_agg(distinct e->>'entity_id'),array[]::text[]) into v_ids
      from jsonb_array_elements(p_events) e where e->>'entity_type'='customer';
    p_payload:=jsonb_set(p_payload,'{events}',p_events,true);
    p_payload:=jsonb_set(p_payload,'{customers}',private.pos_sync_filter_json_rows_v1(p_payload->'customers',v_ids,'id'),true);
    p_payload:=jsonb_set(p_payload,'{deleted_ids}',coalesce(private.pos_sync_filter_json_ids_v1(p_payload->'deleted_ids',v_ids),'[]'::jsonb),true);
    return p_payload;
  end if;

  if p_kind='credit' then
    select coalesce(array_agg(distinct e->>'entity_id') filter(where e->>'entity_type'='customer_ledger'),array[]::text[]),
           coalesce(array_agg(distinct coalesce(e->'metadata'->>'customer_id',e->>'entity_id')) filter(where e->>'entity_type' in ('customer_ledger','customer')),array[]::text[]),
           coalesce(array_agg(distinct e->>'entity_id') filter(where e->>'entity_type'='cash_movement'),array[]::text[]),
           coalesce(array_agg(distinct coalesce(e->'metadata'->>'cash_session_id',case when e->>'entity_type'='cash_session' then e->>'entity_id' end)) filter(where e->>'entity_type' in ('cash_session','cash_movement')),array[]::text[])
      into v_ids,v_ids2,v_ids3,v_sessions from jsonb_array_elements(p_events) e;
    p_payload:=jsonb_set(p_payload,'{events}',p_events,true);
    p_payload:=jsonb_set(p_payload,'{ledger_entries}',private.pos_sync_filter_json_rows_v1(p_payload->'ledger_entries',v_ids,'id'),true);
    p_payload:=jsonb_set(p_payload,'{customers}',private.pos_sync_filter_json_rows_v1(p_payload->'customers',v_ids2,'id'),true);
    p_payload:=jsonb_set(p_payload,'{cash_movements}',private.pos_sync_filter_json_rows_v1(p_payload->'cash_movements',v_ids3,'id'),true);
    p_payload:=jsonb_set(p_payload,'{movements}',private.pos_sync_filter_json_rows_v1(p_payload->'movements',v_ids3,'id'),true);
    p_payload:=jsonb_set(p_payload,'{cash_sessions}',private.pos_sync_filter_json_rows_v1(p_payload->'cash_sessions',v_sessions,'id'),true);
    return p_payload;
  end if;

  if p_kind='sales' then
    select coalesce(array_agg(distinct coalesce(e->'metadata'->>'sale_id',case when e->>'entity_type'='sale' then e->>'entity_id' end)),array[]::text[])
      into v_ids from jsonb_array_elements(p_events) e;
    p_payload:=jsonb_set(p_payload,'{events}',p_events,true);
    p_payload:=jsonb_set(p_payload,'{sales}',private.pos_sync_filter_json_rows_v1(p_payload->'sales',v_ids,'id'),true);
    p_payload:=jsonb_set(p_payload,'{items}',private.pos_sync_filter_json_rows_v1(p_payload->'items',v_ids,'sale_id'),true);
    p_payload:=jsonb_set(p_payload,'{payments}',private.pos_sync_filter_json_rows_v1(p_payload->'payments',v_ids,'sale_id'),true);
    return p_payload;
  end if;

  if p_kind='cash' then
    select coalesce(array_agg(distinct coalesce(e->'metadata'->>'cash_session_id',case when e->>'entity_type'='cash_session' then e->>'entity_id' end)) filter(where e->>'entity_type' in ('cash_session','cash_movement')),array[]::text[]),
           coalesce(array_agg(distinct e->>'entity_id') filter(where e->>'entity_type'='cash_movement'),array[]::text[])
      into v_ids,v_ids2 from jsonb_array_elements(p_events) e;
    p_payload:=jsonb_set(p_payload,'{events}',p_events,true);
    p_payload:=jsonb_set(p_payload,'{cash_sessions}',private.pos_sync_filter_json_rows_v1(p_payload->'cash_sessions',v_ids,'id'),true);
    if jsonb_typeof(p_payload->'movements')<>'array' then raise exception 'POS_SYNC_FRONTIER_INVALID_CASH_MOVEMENTS' using errcode='22023'; end if;
    select coalesce(jsonb_agg(m.row_value order by m.ordinal),'[]'::jsonb) into v_deleted
      from jsonb_array_elements(p_payload->'movements') with ordinality m(row_value,ordinal)
     where m.row_value->>'id'=any(v_ids2) or m.row_value->>'cash_session_id'=any(v_ids);
    return jsonb_set(p_payload,'{movements}',v_deleted,true);
  end if;
  raise exception 'POS_SYNC_FRONTIER_UNKNOWN_PULL_KIND:%',p_kind using errcode='22023';
end;
$function$;

create or replace function private.pos_sync_bind_safe_pull_v1(
  p_kind text,p_payload jsonb,p_since bigint,p_safe bigint,p_limit integer,p_sync_deferred boolean
)
returns jsonb language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_events jsonb; v_page_events jsonb; v_safe_count integer; v_latest bigint;
  v_server_latest bigint; v_has_more boolean; v_deferred boolean;
begin
  if coalesce((p_payload->>'success')::boolean,false) is not true then return p_payload; end if;
  if jsonb_typeof(p_payload->'events')<>'array' then raise exception 'POS_SYNC_FRONTIER_PULL_EVENTS_REQUIRED:%',p_kind using errcode='22023'; end if;
  select count(*)::integer into v_safe_count
    from jsonb_array_elements(p_payload->'events') event_value
   where (event_value->>'change_seq')::bigint>p_since and (event_value->>'change_seq')::bigint<=p_safe;
  select coalesce(jsonb_agg(page.event_value order by page.change_seq),'[]'::jsonb)
    into v_page_events
    from (select event_value,(event_value->>'change_seq')::bigint as change_seq
            from jsonb_array_elements(p_payload->'events') event_value
           where (event_value->>'change_seq')::bigint>p_since and (event_value->>'change_seq')::bigint<=p_safe
           order by (event_value->>'change_seq')::bigint limit p_limit) page;
  select coalesce(max((event_value->>'change_seq')::bigint),p_since) into v_latest from jsonb_array_elements(v_page_events) event_value;
  select coalesce(nullif(p_payload->>'server_latest_change_seq','')::bigint,v_latest) into v_server_latest;
  -- The legacy has_more/server_latest fields can include events beyond the
  -- captured frontier. The limit+1 safe lookahead is the authoritative proof
  -- that another page is immediately available.
  v_has_more:=v_safe_count>p_limit;
  if not v_has_more then v_latest:=p_safe; end if;
  v_deferred:=p_sync_deferred or coalesce((p_payload->>'sync_deferred')::boolean,false);
  v_events:=private.pos_sync_project_safe_pull_v1(p_kind,p_payload,v_page_events);
  return v_events||jsonb_build_object('latest_change_seq',v_latest,
    'server_latest_change_seq',greatest(p_since,least(v_server_latest,p_safe)),
    'has_more',v_has_more,'sync_deferred',v_deferred,'safe_change_seq',p_safe);
end;
$function$;

create or replace function private.pos_sync_empty_safe_pull_v1(p_kind text,p_since bigint,p_safe bigint,p_sync_deferred boolean)
returns jsonb language sql immutable security invoker set search_path = ''
as $function$
  select jsonb_build_object('success',true,'events','[]'::jsonb,'latest_change_seq',p_since,
    'server_latest_change_seq',p_safe,'has_more',false,'sync_deferred',p_sync_deferred,
    'safe_change_seq',p_safe,'cursor_ahead_of_safe_frontier',p_since>p_safe,
    'categories',case when p_kind='product' then '[]'::jsonb end,
    'products',case when p_kind='product' then '[]'::jsonb end,
    'batches',case when p_kind='product' then '[]'::jsonb end,
    'deleted_ids',case when p_kind='product' then jsonb_build_object('categories','[]'::jsonb,'products','[]'::jsonb,'batches','[]'::jsonb)
      when p_kind='customer' then '[]'::jsonb end,
    'customers',case when p_kind in ('customer','credit') then '[]'::jsonb end,
    'ledger_entries',case when p_kind='credit' then '[]'::jsonb end,
    'cash_movements',case when p_kind='credit' then '[]'::jsonb end,
    'cash_sessions',case when p_kind='credit' then '[]'::jsonb end,
    'movements',case when p_kind in ('credit','cash') then '[]'::jsonb end,
    'sales',case when p_kind='sales' then '[]'::jsonb end,
    'items',case when p_kind='sales' then '[]'::jsonb end,
    'payments',case when p_kind='sales' then '[]'::jsonb end);
$function$;

-- The retained bodies keep the Production filters, serializers and authority
-- checks. The stable public and v2 wrappers still delegate to these names.
alter function public.pos_pull_sync_events_unlimited(text,text,text,text,bigint,integer) rename to pos_pull_sync_events_legacy_frontier_v1;
alter function public.pos_pull_product_catalog_changes_unlimited(text,text,text,text,bigint,integer) rename to pos_pull_product_catalog_changes_legacy_frontier_v1;
alter function public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer) rename to pos_pull_customer_changes_legacy_frontier_v1;
alter function public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer) rename to pos_pull_customer_credit_changes_legacy_frontier_v1;
alter function public.pos_pull_sales_changes_unlimited(text,text,text,text,bigint,integer) rename to pos_pull_sales_changes_legacy_frontier_v1;
alter function public.pos_pull_cash_changes_unlimited(text,text,text,text,bigint,integer) rename to pos_pull_cash_changes_legacy_frontier_v1;
alter function public.pos_pull_layaway_changes(text,text,text,text,bigint,integer) rename to pos_pull_layaway_changes_legacy_frontier_v1;

create or replace function public.pos_pull_sync_events_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),999); v_safe bigint; v_deferred boolean; v_payload jsonb;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  if coalesce((v_context->'features'->>'cloud_pos_sync')::boolean,false) is not true then
    return jsonb_build_object('success',false,'code','CLOUD_POS_SYNC_DISABLED',
      'message','La sincronizacion cloud POS no esta habilitada para este plan.','events','[]'::jsonb,
      'latest_change_seq',v_since,'server_latest_change_seq',v_since,'has_more',false);
  end if;
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then
    return private.pos_sync_empty_safe_pull_v1('general',v_since,v_safe,v_deferred)
      || jsonb_build_object('sync_context',jsonb_build_object('device_role',v_context->>'device_role',
        'plan_code',v_context->>'plan_code','cloud_pos_sync',coalesce((v_context->'features'->>'cloud_pos_sync')::boolean,false),
        'cloud_cash_sync',coalesce((v_context->'features'->>'cloud_cash_sync')::boolean,false)));
  end if;
  v_payload:=public.pos_pull_sync_events_legacy_frontier_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_since,v_limit+1);
  return private.pos_sync_bind_safe_pull_v1('general',v_payload,v_since,v_safe,v_limit,v_deferred);
end;
$function$;

create or replace function public.pos_pull_product_catalog_changes_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),999); v_safe bigint; v_deferred boolean; v_payload jsonb;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_read_permission(v_context);
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then return private.pos_sync_empty_safe_pull_v1('product',v_since,v_safe,v_deferred); end if;
  v_payload:=public.pos_pull_product_catalog_changes_legacy_frontier_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_since,v_limit+1);
  return private.pos_sync_bind_safe_pull_v1('product',v_payload,v_since,v_safe,v_limit,v_deferred);
end;
$function$;

create or replace function public.pos_pull_customer_changes_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),999); v_safe bigint; v_deferred boolean; v_payload jsonb;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context,'customers');
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then return private.pos_sync_empty_safe_pull_v1('customer',v_since,v_safe,v_deferred); end if;
  v_payload:=public.pos_pull_customer_changes_legacy_frontier_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_since,v_limit+1);
  return private.pos_sync_bind_safe_pull_v1('customer',v_payload,v_since,v_safe,v_limit,v_deferred);
end;
$function$;

create or replace function public.pos_pull_customer_credit_changes_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),999); v_safe bigint; v_deferred boolean; v_payload jsonb;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context,'customers');
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then return private.pos_sync_empty_safe_pull_v1('credit',v_since,v_safe,v_deferred); end if;
  v_payload:=public.pos_pull_customer_credit_changes_legacy_frontier_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_since,v_limit+1);
  return private.pos_sync_bind_safe_pull_v1('credit',v_payload,v_since,v_safe,v_limit,v_deferred);
end;
$function$;

create or replace function public.pos_pull_sales_changes_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text default null,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),999); v_safe bigint; v_deferred boolean; v_payload jsonb;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then return private.pos_sync_empty_safe_pull_v1('sales',v_since,v_safe,v_deferred); end if;
  v_payload:=public.pos_pull_sales_changes_legacy_frontier_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_since,v_limit+1);
  return private.pos_sync_bind_safe_pull_v1('sales',v_payload,v_since,v_safe,v_limit,v_deferred);
end;
$function$;

create or replace function public.pos_pull_cash_changes_unlimited(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),999); v_safe bigint; v_deferred boolean; v_payload jsonb;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then return private.pos_sync_empty_safe_pull_v1('cash',v_since,v_safe,v_deferred); end if;
  v_payload:=public.pos_pull_cash_changes_legacy_frontier_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_since,v_limit+1);
  return private.pos_sync_bind_safe_pull_v1('cash',v_payload,v_since,v_safe,v_limit,v_deferred);
end;
$function$;

create or replace function public.pos_pull_layaway_changes(
  p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text default null,p_since_change_seq bigint default 0,p_limit integer default 500
)
returns jsonb language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),499); v_safe bigint; v_deferred boolean;
  v_events jsonb:='[]'::jsonb; v_layaway_ids text[]:=array[]::text[]; v_deleted_ids jsonb:='[]'::jsonb;
  v_layaways jsonb:='[]'::jsonb; v_payments jsonb:='[]'::jsonb; v_reservations jsonb:='[]'::jsonb;
  v_cash_movements jsonb:='[]'::jsonb; v_inventory_movements jsonb:='[]'::jsonb;
  v_latest bigint; v_server_latest bigint; v_count integer:=0; v_has_more boolean:=false;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context,'pos');
  v_license_id:=(v_context->>'license_id')::uuid;
  select f.safe_change_seq,f.sync_deferred into v_safe,v_deferred from private.pos_sync_safe_frontier_v1(v_license_id) f;
  if v_since>v_safe then
    return jsonb_build_object('success',true,'events','[]'::jsonb,'layaways','[]'::jsonb,
      'payments','[]'::jsonb,'inventory_reservations','[]'::jsonb,'cash_movements','[]'::jsonb,
      'inventory_movements','[]'::jsonb,'deleted_ids','[]'::jsonb,'since_change_seq',v_since,
      'latest_change_seq',v_since,'server_latest_change_seq',v_safe,'has_more',false,
      'sync_deferred',v_deferred,'safe_change_seq',v_safe,'cursor_ahead_of_safe_frontier',true,
      'mode','cloud_layaway_changes');
  end if;

  with candidate as (
    select e.*,
      case when e.entity_type='layaway' then e.entity_id
           when e.entity_type='layaway_payment' then p.layaway_id
           when e.entity_type='layaway_inventory_reservation' then r.layaway_id
           when e.entity_type in ('cash_movement','product','product_batch') then e.metadata->>'layaway_id'
      end as affected_layaway_id
      from public.pos_sync_events e
      left join public.pos_layaway_payments p on p.license_id=e.license_id and p.id=e.entity_id and e.entity_type='layaway_payment'
      left join public.pos_layaway_inventory_reservations r on r.license_id=e.license_id and r.id=e.entity_id and e.entity_type='layaway_inventory_reservation'
     where e.license_id=v_license_id and e.change_seq>v_since and e.change_seq<=v_safe
       and e.entity_type in ('layaway','layaway_payment','layaway_inventory_reservation','cash_movement','product','product_batch')
  ), page as (
    select * from candidate where affected_layaway_id is not null order by change_seq limit v_limit+1
  )
  select coalesce((select jsonb_agg(to_jsonb(q)-'affected_layaway_id' order by q.change_seq)
                     from (select * from page order by change_seq limit v_limit) q),'[]'::jsonb),
         coalesce((select array_agg(distinct affected_layaway_id)
                     from (select * from page order by change_seq limit v_limit) q),array[]::text[]),
         (select count(*)::integer from page),
         coalesce((select max(change_seq) from (select * from page order by change_seq limit v_limit) q),v_since)
    into v_events,v_layaway_ids,v_count,v_latest;
  v_has_more:=v_count>v_limit;
  if not v_has_more then v_latest:=v_safe; end if;

  select coalesce(jsonb_agg(private.pos_layaway_read_to_jsonb_v1(l) order by l.updated_at,l.id),'[]'::jsonb),
         coalesce(jsonb_agg(l.id) filter(where l.deleted_at is not null),'[]'::jsonb)
    into v_layaways,v_deleted_ids from public.pos_layaways l
   where l.license_id=v_license_id and l.id=any(v_layaway_ids);
  select coalesce(jsonb_agg(private.pos_layaway_payment_read_to_jsonb_v1(p) order by p.created_at,p.id),'[]'::jsonb)
    into v_payments from public.pos_layaway_payments p where p.license_id=v_license_id and p.layaway_id=any(v_layaway_ids);
  select coalesce(jsonb_agg(private.pos_layaway_reservation_read_to_jsonb_v1(r) order by r.created_at,r.id),'[]'::jsonb)
    into v_reservations from public.pos_layaway_inventory_reservations r where r.license_id=v_license_id and r.layaway_id=any(v_layaway_ids);
  select coalesce(jsonb_agg(private.pos_layaway_public_cash_movement_to_jsonb_v1(m) order by m.created_at,m.id),'[]'::jsonb)
    into v_cash_movements from public.pos_cash_movements m
   where m.license_id=v_license_id and m.reference_type='layaway' and m.reference_id=any(v_layaway_ids) and m.deleted_at is null;
  select coalesce(jsonb_agg(private.pos_layaway_public_inventory_movement_to_jsonb_v1(m) order by m.created_at,m.id),'[]'::jsonb)
    into v_inventory_movements from public.pos_inventory_movements m
   where m.license_id=v_license_id and m.metadata->>'layaway_id'=any(v_layaway_ids);
  select coalesce(max(change_seq),v_since) into v_server_latest from public.pos_sync_events
   where license_id=v_license_id and change_seq<=v_safe;
  return jsonb_build_object('success',true,'events',v_events,'layaways',v_layaways,'payments',v_payments,
    'inventory_reservations',v_reservations,'cash_movements',v_cash_movements,'inventory_movements',v_inventory_movements,
    'deleted_ids',v_deleted_ids,'since_change_seq',v_since,'latest_change_seq',v_latest,
    'server_latest_change_seq',greatest(v_since,least(v_server_latest,v_safe)),'has_more',v_has_more,
    'sync_deferred',v_deferred,'safe_change_seq',v_safe,'mode','cloud_layaway_changes');
end;
$function$;

create or replace function private.record_pos_sync_event(
  p_license_id uuid,p_entity_type text,p_entity_id text,p_operation text,
  p_actor_device_id uuid default null,p_actor_staff_user_id uuid default null,
  p_idempotency_key text default null,p_metadata jsonb default '{}'::jsonb,
  p_server_version integer default 1
)
returns public.pos_sync_events
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_current_license text;
  v_event public.pos_sync_events;
begin
  v_current_license:=current_setting('lanzo.pos_sync_license_id',true);
  if coalesce(v_current_license,'') is distinct from coalesce(p_license_id::text,'') then
    perform pg_catalog.set_config('lanzo.pos_sync_license_id',coalesce(p_license_id::text,''),true);
  end if;
  insert into public.pos_sync_events (
    license_id,entity_type,entity_id,operation,change_seq,server_version,
    actor_device_id,actor_staff_user_id,idempotency_key,metadata
  ) values (
    p_license_id,p_entity_type,p_entity_id,coalesce(p_operation,'unknown'),
    private.next_pos_change_seq(),coalesce(p_server_version,1),
    p_actor_device_id,p_actor_staff_user_id,p_idempotency_key,coalesce(p_metadata,'{}'::jsonb)
  ) returning * into v_event;
  perform private.broadcast_pos_event(p_license_id,jsonb_build_object(
    'entity_type',v_event.entity_type,'entity_id',v_event.entity_id,'operation',v_event.operation,
    'change_seq',v_event.change_seq,'server_version',v_event.server_version,
    'actor_device_id',v_event.actor_device_id,'actor_staff_user_id',v_event.actor_staff_user_id,
    'created_at',v_event.created_at
  ));
  return v_event;
end;
$function$;

alter function private.pos_sync_frontier_lock_keys_v1(uuid) owner to postgres;
alter function private.pos_sync_frontier_lock_exclusive_v1(uuid) owner to postgres;
alter function private.pos_sync_frontier_lock_shared_v1(uuid) owner to postgres;
alter function private.next_pos_change_seq() owner to postgres;
alter function private.pos_sync_safe_frontier_v1(uuid) owner to postgres;
alter function private.pos_sync_filter_json_rows_v1(jsonb,text[],text) owner to postgres;
alter function private.pos_sync_filter_json_ids_v1(jsonb,text[]) owner to postgres;
alter function private.pos_sync_project_safe_pull_v1(text,jsonb,jsonb) owner to postgres;
alter function private.pos_sync_bind_safe_pull_v1(text,jsonb,bigint,bigint,integer,boolean) owner to postgres;
alter function private.pos_sync_empty_safe_pull_v1(text,bigint,bigint,boolean) owner to postgres;
alter function private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer) owner to postgres;
alter function public.pos_pull_sync_events_unlimited(text,text,text,text,bigint,integer) owner to postgres;
alter function public.pos_pull_product_catalog_changes_unlimited(text,text,text,text,bigint,integer) owner to postgres;
alter function public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer) owner to postgres;
alter function public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer) owner to postgres;
alter function public.pos_pull_sales_changes_unlimited(text,text,text,text,bigint,integer) owner to postgres;
alter function public.pos_pull_cash_changes_unlimited(text,text,text,text,bigint,integer) owner to postgres;
alter function public.pos_pull_layaway_changes(text,text,text,text,bigint,integer) owner to postgres;

revoke all on function private.pos_sync_frontier_lock_keys_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_frontier_lock_exclusive_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_frontier_lock_shared_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function private.next_pos_change_seq() from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_safe_frontier_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_filter_json_rows_v1(jsonb,text[],text) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_filter_json_ids_v1(jsonb,text[]) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_project_safe_pull_v1(text,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_bind_safe_pull_v1(text,jsonb,bigint,bigint,integer,boolean) from public,anon,authenticated,service_role;
revoke all on function private.pos_sync_empty_safe_pull_v1(text,bigint,bigint,boolean) from public,anon,authenticated,service_role;
revoke all on function private.record_pos_sync_event(uuid,text,text,text,uuid,uuid,text,jsonb,integer) from public,anon,authenticated,service_role;
revoke all on function private.record_pos_sync_event_legacy_frontier_v1(uuid,text,text,text,uuid,uuid,text,jsonb,integer) from public,anon,authenticated,service_role;

revoke all on function public.pos_pull_sync_events_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function public.pos_pull_product_catalog_changes_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function public.pos_pull_customer_changes_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function public.pos_pull_customer_credit_changes_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function public.pos_pull_sales_changes_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function public.pos_pull_cash_changes_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;
revoke all on function public.pos_pull_layaway_changes_legacy_frontier_v1(text,text,text,text,bigint,integer) from public,anon,authenticated,service_role;

revoke all on function public.pos_pull_sync_events_unlimited(text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.pos_pull_product_catalog_changes_unlimited(text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.pos_pull_sales_changes_unlimited(text,text,text,text,bigint,integer) from public,anon,authenticated;
revoke all on function public.pos_pull_cash_changes_unlimited(text,text,text,text,bigint,integer) from public,anon,authenticated;
grant execute on function public.pos_pull_sync_events_unlimited(text,text,text,text,bigint,integer) to service_role;
grant execute on function public.pos_pull_product_catalog_changes_unlimited(text,text,text,text,bigint,integer) to service_role;
grant execute on function public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer) to service_role;
grant execute on function public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer) to service_role;
grant execute on function public.pos_pull_sales_changes_unlimited(text,text,text,text,bigint,integer) to service_role;
grant execute on function public.pos_pull_cash_changes_unlimited(text,text,text,text,bigint,integer) to service_role;

revoke all on function public.pos_pull_layaway_changes(text,text,text,text,bigint,integer) from public;
grant execute on function public.pos_pull_layaway_changes(text,text,text,text,bigint,integer) to anon,authenticated,service_role;

comment on function private.pos_sync_safe_frontier_v1(uuid) is
  'Internal transaction-safe POS event boundary. Requires READ COMMITTED; locks only the tenant coordinator briefly and releases before entity reads.';
comment on function private.next_pos_change_seq() is
  'Internal allocator: registers one transaction-scoped tenant/sequence marker before event insertion; advisory session lock is released before business/event row writes.';
comment on function public.pos_pull_layaway_changes(text,text,text,text,bigint,integer) is
  'Incremental layaway reader bounded by the tenant-safe POS change frontier; pages relevant events by change_seq and reports sync_deferred.';

-- Take the cutover barrier last. ALTER SEQUENCE holds ACCESS EXCLUSIVE through
-- COMMIT; in PG 17.6 nextval() retains RowExclusiveLock through transaction end,
-- so this drains legacy writers and queues new allocations. The table lock then
-- drains active legacy readers/event inserts. Definitions above are still
-- invisible until this transaction commits, keeping the lock hold to this tail.
-- lock_timeout fails closed when either drain cannot complete promptly.
alter sequence public.pos_change_seq cache 1;
lock table public.pos_sync_events in access exclusive mode;
alter table public.pos_sync_events alter column change_seq drop default;
revoke insert,update,delete,truncate,references,trigger on table public.pos_sync_events from service_role;
revoke usage,select,update on sequence public.pos_change_seq from service_role;

commit;
