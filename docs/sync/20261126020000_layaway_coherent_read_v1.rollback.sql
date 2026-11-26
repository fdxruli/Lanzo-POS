-- Explicit rollback only. Not a migration and not a ledger edit.
begin;
set local lock_timeout='5s';
set local statement_timeout='2min';
do $guard$
declare v_signature text; v_hash text; v_oid regprocedure; v_row record;
begin
  for v_signature,v_hash in select * from (values
    ('public.pos_get_layaway(text,text,text,text,text)', md5($expected_definition$CREATE OR REPLACE FUNCTION public.pos_get_layaway(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_layaway_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_payload jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  if nullif(btrim(coalesce(p_layaway_id, '')), '') is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  -- All projections (including the parent) share this statement's MVCC snapshot.
  select jsonb_build_object(
    'success', true,
    'layaway', private.pos_layaway_read_to_jsonb_v1(l),
    'payments', coalesce((select jsonb_agg(private.pos_layaway_payment_read_to_jsonb_v1(p) order by p.created_at, p.id)
      from public.pos_layaway_payments p where p.license_id=v_license_id and p.layaway_id=l.id), '[]'::jsonb),
    'inventory_reservations', coalesce((select jsonb_agg(private.pos_layaway_reservation_read_to_jsonb_v1(r) order by r.item_index)
      from public.pos_layaway_inventory_reservations r where r.license_id=v_license_id and r.layaway_id=l.id), '[]'::jsonb),
    'cash_movements', coalesce((select jsonb_agg(private.pos_layaway_public_cash_movement_to_jsonb_v1(m) order by m.created_at,m.id)
      from public.pos_cash_movements m where m.license_id=v_license_id and m.reference_type='layaway'
      and m.reference_id=l.id and m.deleted_at is null), '[]'::jsonb),
    'inventory_movements', coalesce((select jsonb_agg(private.pos_layaway_public_inventory_movement_to_jsonb_v1(m) order by m.created_at,m.id)
      from public.pos_inventory_movements m where m.license_id=v_license_id and m.metadata->>'layaway_id'=l.id), '[]'::jsonb),
    'mode', 'cloud_layaway_read'
  ) into v_payload
  from public.pos_layaways l
  where l.license_id=v_license_id and l.id=p_layaway_id and l.deleted_at is null;
  if v_payload is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_payload;
end;
$function$
$expected_definition$)),
    ('public.pos_pull_layaway_changes(text,text,text,text,bigint,integer)', md5($expected_definition$CREATE OR REPLACE FUNCTION public.pos_pull_layaway_changes(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_since_change_seq bigint DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb; v_license_id uuid; v_since bigint:=greatest(coalesce(p_since_change_seq,0),0);
  v_limit integer:=least(greatest(coalesce(p_limit,500),1),499); v_safe bigint; v_deferred boolean;
  v_payload jsonb;
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

  -- The frontier bounds event delivery; the single statement below bounds row visibility.
  -- If a committed event newer than the frontier affects a selected aggregate,
  -- do not return that aggregate under an older cursor. Retry the same page.
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
  ), page as materialized (
    select * from candidate where affected_layaway_id is not null order by change_seq limit v_limit+1
  ), delivered as materialized (
    select * from page order by change_seq limit v_limit
  ), ids as materialized (
    select distinct affected_layaway_id as id from delivered
  ), future as materialized (
    select distinct case when e.entity_type='layaway' then e.entity_id
           when e.entity_type='layaway_payment' then p.layaway_id
           when e.entity_type='layaway_inventory_reservation' then r.layaway_id
           when e.entity_type in ('cash_movement','product','product_batch') then e.metadata->>'layaway_id'
      end as id
      from public.pos_sync_events e
      left join public.pos_layaway_payments p on p.license_id=e.license_id and p.id=e.entity_id and e.entity_type='layaway_payment'
      left join public.pos_layaway_inventory_reservations r on r.license_id=e.license_id and r.id=e.entity_id and e.entity_type='layaway_inventory_reservation'
      where e.license_id=v_license_id and e.change_seq>v_safe
        and e.entity_type in ('layaway','layaway_payment','layaway_inventory_reservation','cash_movement','product','product_batch')
  ), bounds as (
    select (select count(*)>v_limit from page) as more,
      coalesce((select max(change_seq) from delivered),v_since) as last_seq,
      greatest(v_since,coalesce((select max(e.change_seq) from public.pos_sync_events e
        where e.license_id=v_license_id and e.change_seq<=v_safe),v_since)) as server_seq,
      exists(select 1 from future f join ids i on i.id=f.id) as blocked,
      exists(select 1 from future f where f.id is not null) as future_pending
  )
  select case when b.blocked then
    jsonb_build_object('success',true,'events','[]'::jsonb,'layaways','[]'::jsonb,
      'payments','[]'::jsonb,'inventory_reservations','[]'::jsonb,'cash_movements','[]'::jsonb,
      'inventory_movements','[]'::jsonb,'deleted_ids','[]'::jsonb,'since_change_seq',v_since,
      'latest_change_seq',v_since,'server_latest_change_seq',b.server_seq,'has_more',false,
      'sync_deferred',true,'safe_change_seq',v_safe,'mode','cloud_layaway_changes')
  else jsonb_build_object('success',true,
    'events',coalesce((select jsonb_agg(to_jsonb(d)-'affected_layaway_id' order by d.change_seq) from delivered d),'[]'::jsonb),
    'layaways',coalesce((select jsonb_agg(private.pos_layaway_read_to_jsonb_v1(l) order by l.updated_at,l.id)
      from public.pos_layaways l join ids i on i.id=l.id where l.license_id=v_license_id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(private.pos_layaway_payment_read_to_jsonb_v1(p) order by p.created_at,p.id)
      from public.pos_layaway_payments p join ids i on i.id=p.layaway_id where p.license_id=v_license_id),'[]'::jsonb),
    'inventory_reservations',coalesce((select jsonb_agg(private.pos_layaway_reservation_read_to_jsonb_v1(r) order by r.created_at,r.id)
      from public.pos_layaway_inventory_reservations r join ids i on i.id=r.layaway_id where r.license_id=v_license_id),'[]'::jsonb),
    'cash_movements',coalesce((select jsonb_agg(private.pos_layaway_public_cash_movement_to_jsonb_v1(m) order by m.created_at,m.id)
      from public.pos_cash_movements m join ids i on i.id=m.reference_id where m.license_id=v_license_id
      and m.reference_type='layaway' and m.deleted_at is null),'[]'::jsonb),
    'inventory_movements',coalesce((select jsonb_agg(private.pos_layaway_public_inventory_movement_to_jsonb_v1(m) order by m.created_at,m.id)
      from public.pos_inventory_movements m join ids i on i.id=m.metadata->>'layaway_id' where m.license_id=v_license_id),'[]'::jsonb),
    'deleted_ids',coalesce((select jsonb_agg(l.id order by l.updated_at,l.id) from public.pos_layaways l join ids i on i.id=l.id
      where l.license_id=v_license_id and l.deleted_at is not null),'[]'::jsonb),
    'since_change_seq',v_since,'latest_change_seq',case when b.more then b.last_seq else v_safe end,
    'server_latest_change_seq',b.server_seq,'has_more',b.more,
    'sync_deferred',v_deferred or b.future_pending,'safe_change_seq',v_safe,'mode','cloud_layaway_changes')
  end into v_payload from bounds b;
  return v_payload;
end;
$function$
$expected_definition$)),
    ('private.pos_sync_safe_frontier_v1(uuid)', '51dae0e6767b826bf015ac09117aa7aa')
  ) expected(signature,definition_md5) loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null then raise exception 'LAYAWAY_READ_FUNCTION_MISSING: %',v_signature; end if;
    select p.*,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) as actual_hash,pg_get_userbyid(p.proowner) as owner_name
      into v_row from pg_proc p where p.oid=v_oid;
    if v_row.actual_hash is distinct from v_hash or v_row.owner_name<>'postgres'
       or v_row.provolatile<>'v' or not coalesce(v_row.proconfig @> array['search_path=""']::text[],false) then
      raise exception 'LAYAWAY_READ_CONTRACT_DRIFT: %',v_signature;
    end if;
    if v_signature like 'public.%' then
      if not v_row.prosecdef or not (v_row.proacl @> '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'::aclitem[]
        and v_row.proacl <@ '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'::aclitem[]) then
        raise exception 'LAYAWAY_READ_ACL_DRIFT: %',v_signature;
      end if;
    elsif v_row.prosecdef or v_row.proacl is distinct from '{postgres=X/postgres}'::aclitem[] then
      raise exception 'LAYAWAY_FRONTIER_ACL_DRIFT';
    end if;
  end loop;
end;
$guard$;

CREATE OR REPLACE FUNCTION public.pos_get_layaway(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_layaway_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_layaway public.pos_layaways;
  v_payments jsonb := '[]'::jsonb;
  v_reservations jsonb := '[]'::jsonb;
  v_cash_movements jsonb := '[]'::jsonb;
  v_inventory_movements jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_layaways_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;
  if nullif(btrim(coalesce(p_layaway_id, '')), '') is null then
    raise exception 'LAYAWAY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_layaway
    from public.pos_layaways l
   where l.license_id = v_license_id
     and l.id = p_layaway_id
     and l.deleted_at is null;
  if v_layaway.id is null then
    raise exception 'LAYAWAY_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(private.pos_layaway_payment_read_to_jsonb_v1(p) order by p.created_at, p.id), '[]'::jsonb)
    into v_payments
    from public.pos_layaway_payments p
   where p.license_id = v_license_id
     and p.layaway_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_layaway_reservation_read_to_jsonb_v1(r) order by r.item_index), '[]'::jsonb)
    into v_reservations
    from public.pos_layaway_inventory_reservations r
   where r.license_id = v_license_id
     and r.layaway_id = v_layaway.id;
  select coalesce(jsonb_agg(private.pos_layaway_public_cash_movement_to_jsonb_v1(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_cash_movements
    from public.pos_cash_movements m
   where m.license_id = v_license_id
     and m.reference_type = 'layaway'
     and m.reference_id = v_layaway.id
     and m.deleted_at is null;
  select coalesce(jsonb_agg(private.pos_layaway_public_inventory_movement_to_jsonb_v1(m) order by m.created_at, m.id), '[]'::jsonb)
    into v_inventory_movements
    from public.pos_inventory_movements m
   where m.license_id = v_license_id
     and m.metadata->>'layaway_id' = v_layaway.id;

  return jsonb_build_object(
    'success', true,
    'layaway', private.pos_layaway_read_to_jsonb_v1(v_layaway),
    'payments', v_payments,
    'inventory_reservations', v_reservations,
    'cash_movements', v_cash_movements,
    'inventory_movements', v_inventory_movements,
    'mode', 'cloud_layaway_read'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.pos_pull_layaway_changes(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_since_change_seq bigint DEFAULT 0, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

do $guard$
declare v_signature text; v_hash text; v_oid regprocedure; v_row record;
begin
  for v_signature,v_hash in select * from (values
    ('public.pos_get_layaway(text,text,text,text,text)', '570f28b1e06c106f9ad073e03b7cf551'),
    ('public.pos_pull_layaway_changes(text,text,text,text,bigint,integer)', '7a9382f6e4eefc6a6d51859cb9767bc3'),
    ('private.pos_sync_safe_frontier_v1(uuid)', '51dae0e6767b826bf015ac09117aa7aa')
  ) expected(signature,definition_md5) loop
    v_oid:=to_regprocedure(v_signature);
    if v_oid is null then raise exception 'LAYAWAY_READ_FUNCTION_MISSING: %',v_signature; end if;
    select p.*,md5(replace(pg_get_functiondef(p.oid),chr(13),'')) as actual_hash,pg_get_userbyid(p.proowner) as owner_name
      into v_row from pg_proc p where p.oid=v_oid;
    if v_row.actual_hash is distinct from v_hash or v_row.owner_name<>'postgres'
       or v_row.provolatile<>'v' or not coalesce(v_row.proconfig @> array['search_path=""']::text[],false) then
      raise exception 'LAYAWAY_READ_CONTRACT_DRIFT: %',v_signature;
    end if;
    if v_signature like 'public.%' then
      if not v_row.prosecdef or not (v_row.proacl @> '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'::aclitem[]
        and v_row.proacl <@ '{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}'::aclitem[]) then
        raise exception 'LAYAWAY_READ_ACL_DRIFT: %',v_signature;
      end if;
    elsif v_row.prosecdef or v_row.proacl is distinct from '{postgres=X/postgres}'::aclitem[] then
      raise exception 'LAYAWAY_FRONTIER_ACL_DRIFT';
    end if;
  end loop;
end;
$guard$;

commit;
