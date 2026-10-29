-- Generated with `supabase migration new restaurant_cloud_transition_bridge_v1`.
-- The NEW, UNAPPLIED file was ordered immediately before #352's unapplied final
-- migration. No historical migration was renamed or edited. Install separately
-- only after an authorized maintenance window; this task does not deploy SQL.
create table private.restaurant_cloud_contract_state (
  singleton boolean primary key default true check(singleton),
  contract_version integer not null default 1 check(contract_version in (1,2)),
  writes_paused boolean not null default false,
  generation bigint not null default 1 check(generation > 0)
);
insert into private.restaurant_cloud_contract_state(singleton) values(true);
alter table private.restaurant_cloud_contract_state enable row level security;
revoke all on private.restaurant_cloud_contract_state from public,anon,authenticated;
create table private.restaurant_admin_activation (
  license_id uuid primary key,
  enabled boolean not null default false,
  generation bigint not null default 1 check(generation > 0)
);
alter table private.restaurant_admin_activation enable row level security;
revoke all on private.restaurant_admin_activation from public,anon,authenticated;
create table private.restaurant_bridge_cancel_permits (
  transaction_id xid8 not null, license_id uuid not null, order_id text not null,
  primary key(transaction_id,license_id,order_id)
);
alter table private.restaurant_bridge_cancel_permits enable row level security;
revoke all on private.restaurant_bridge_cancel_permits from public,anon,authenticated;

-- All instrumented writers acquire SHARED before parent/cash/idempotency locks.
-- The operator takes EXCLUSIVE and drains in-flight transactions before changing
-- policy. It never settles a sale or changes a table. Browser roles cannot call it.
create function private.enter_restaurant_transition_write_v1()
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  if (select writes_paused from private.restaurant_cloud_contract_state where singleton) then
    raise exception 'RESTAURANT_CONTRACT_MAINTENANCE' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.enter_restaurant_transition_write_v1() from public,anon,authenticated;

create function private.set_restaurant_transition_policy_v1(p_paused boolean,
  p_license_id uuid default null, p_admin_enabled boolean default null)
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  if p_paused is null then raise exception 'RESTAURANT_POLICY_REQUIRED'; end if;
  if p_admin_enabled is not null then
    if p_license_id is null then raise exception 'RESTAURANT_POLICY_LICENSE_REQUIRED'; end if;
    if p_admin_enabled and (select contract_version from private.restaurant_cloud_contract_state where singleton) <> 2 then
      raise exception 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE';
    end if;
    insert into private.restaurant_admin_activation(license_id,enabled) values(p_license_id,p_admin_enabled)
    on conflict(license_id) do update set enabled=excluded.enabled,
      generation=private.restaurant_admin_activation.generation+1;
  end if;
  update private.restaurant_cloud_contract_state set writes_paused=p_paused,generation=generation+1 where singleton;
end;
$function$;
revoke all on function private.set_restaurant_transition_policy_v1(boolean,uuid,boolean) from public,anon,authenticated;

create function private.restaurant_admin_supervision_enabled_v1(p_license_id uuid)
returns boolean language sql security definer set search_path='' as $function$
  select s.contract_version=2 and not s.writes_paused and coalesce(a.enabled,false)
  from private.restaurant_cloud_contract_state s
  left join private.restaurant_admin_activation a on a.license_id=p_license_id where s.singleton;
$function$;
revoke all on function private.restaurant_admin_supervision_enabled_v1(uuid) from public,anon,authenticated;

create function public.pos_restaurant_cloud_contract_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c jsonb; s private.restaurant_cloud_contract_state; a private.restaurant_admin_activation;
begin
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  perform private.assert_cloud_sales_sync_base_enabled(c);
  perform private.assert_restaurant_orders_food_service((c->>'license_id')::uuid);
  select * into strict s from private.restaurant_cloud_contract_state where singleton;
  select * into a from private.restaurant_admin_activation where license_id=(c->>'license_id')::uuid;
  return jsonb_build_object('success',true,'contractVersion',s.contract_version,
    'minimumSupportedClientVersion',s.contract_version,'strictParentVersionRequired',s.contract_version=2,
    'versionedWritesAvailable',true,'versionedParentVersionRequired',true,
    'adminSupervisionAvailable',s.contract_version=2 and coalesce(a.enabled,false) and not s.writes_paused,
    'legacyWritesAllowed',s.contract_version=1 and not s.writes_paused,
    'kitchenTerminalGuardEnabled',true,'writesPaused',s.writes_paused,
    'serverCapabilityGeneration',s.generation::text||':'||coalesce(a.generation,0)::text);
end;
$function$;
revoke all on function public.pos_restaurant_cloud_contract_v1(text,text,text,text) from public;
-- Device/staff session is authenticated by validate_pos_sync_context, including
-- deployments using the anon transport role. A role or client flag is not authority.
grant execute on function public.pos_restaurant_cloud_contract_v1(text,text,text,text) to anon,authenticated;

create function private.assert_restaurant_bridge_actor_v1(c jsonb,o public.pos_restaurant_orders,
  operation text) returns void language plpgsql security definer set search_path='' as $function$
begin
  if c->>'actor_type'='admin' then
    if nullif(c->>'admin_user_id','') is distinct from c->>'actor_id'
      or nullif(c->>'admin_session_id','') is distinct from c->>'actor_session_id' then
      raise exception 'ACTOR_SESSION_INVALID';
    end if;
  elsif c->>'actor_type'='staff' then
    if nullif(c->>'staff_user_id','') is distinct from c->>'actor_id'
      or nullif(c->>'staff_session_id','') is distinct from c->>'actor_session_id' then
      raise exception 'ACTOR_SESSION_INVALID';
    end if;
  else raise exception 'ACTOR_SESSION_INVALID'; end if;
  perform private.assert_pos_permission(c,case when operation='cancel' then 'refunds' else 'pos' end);
  if o.id is null then return; end if;
  if o.license_id is distinct from (c->>'license_id')::uuid then raise exception 'RESTAURANT_ORDER_NOT_FOUND'; end if;
  if (c->>'actor_type'='staff' and o.created_by_staff_user_id is distinct from (c->>'actor_id')::uuid)
    or (c->>'actor_type'='admin' and o.created_by_staff_user_id is not null
      and not private.restaurant_admin_supervision_enabled_v1(o.license_id)) then
    raise exception 'RESTAURANT_TABLE_OWNER_REQUIRED' using errcode='P0001';
  end if;
  if operation in ('edit','cancel') and o.created_by_device_id is distinct from (c->>'device_id')::uuid
    and (operation='edit' or c->>'actor_type'<>'admin' or not private.restaurant_admin_supervision_enabled_v1(o.license_id)) then
    raise exception 'RESTAURANT_ORDER_REMOTE_EDIT_BLOCKED_PENDING_INVENTORY_CONTRACT' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.assert_restaurant_bridge_actor_v1(jsonb,public.pos_restaurant_orders,text) from public,anon,authenticated;

-- Legacy mapper payloads remain valid during bridge. Authentication, ownership,
-- parent serialization and physical-ID isolation apply before the installed leaf.
-- Blind legacy updates are retired by the final contract, never synthesized into
-- a current version here. The old mapper does not supply physical row IDs.
create function private.prepare_restaurant_bridge_upsert_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_order jsonb,p_items jsonb)
returns void language plpgsql security definer set search_path='' as $function$
declare c jsonb; o public.pos_restaurant_orders; local_id text;
begin
  perform private.enter_restaurant_transition_write_v1();
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  -- Match the installed leaf's actual aliases and precedence, including frames
  -- compiled before cutover. A marker cannot turn a snake-case identity into
  -- an apparently new parent and skip its version requirement.
  local_id:=nullif(btrim(coalesce(p_order->>'localOrderId',p_order->>'local_order_id','')),'');
  if local_id is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED'; end if;
  o:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,local_id);
  perform private.assert_restaurant_bridge_actor_v1(c,o,'edit');
  -- A legacy PL/pgSQL frame may already be waiting inside this helper when
  -- cutover replaces its caller. Recheck strict policy AFTER acquiring the
  -- shared lock; replacing the caller alone cannot revoke that old frame.
  if (select contract_version from private.restaurant_cloud_contract_state where singleton)=2 then
    if p_order->>'clientContractVersion' is distinct from '2' then raise exception 'RESTAURANT_CLIENT_UPGRADE_REQUIRED'; end if;
    if o.id is not null then
      if nullif(p_order->>'expectedParentVersion','') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end if;
      if (p_order->>'expectedParentVersion')::timestamptz is distinct from o.updated_at then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT'; end if;
    end if;
  end if;
  if nullif(btrim(p_order->>'id'),'') is not null then raise exception 'RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where nullif(btrim(i->>'id'),'') is not null) then
    raise exception 'RESTAURANT_ORDER_LINE_ID_CONFLICT';
  end if;
end;
$function$;
revoke all on function private.prepare_restaurant_bridge_upsert_v1(text,text,text,text,jsonb,jsonb) from public,anon,authenticated;

create function public.pos_restaurant_transition_table_capabilities_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_local_order_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c jsonb; o public.pos_restaurant_orders; active boolean; owner boolean; same_device boolean;
  pos boolean; refunds boolean; admin boolean; writable boolean;
begin
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  perform private.assert_cloud_sales_sync_base_enabled(c);
  perform private.assert_restaurant_orders_food_service((c->>'license_id')::uuid);
  perform private.assert_pos_permission(c,'pos');
  select * into o from public.pos_restaurant_orders where license_id=(c->>'license_id')::uuid
    and local_order_id=$5 order by updated_at desc,id limit 1;
  if o.id is null then raise exception 'RESTAURANT_ORDER_NOT_FOUND'; end if;
  active:=o.deleted_at is null and o.archived_at is null and o.checkout_closed_at is null and o.cancelled_at is null
    and o.paid_at is null and o.paid_sale_id is null and coalesce(o.payment_status,'unpaid')='unpaid'
    and o.status in ('pending','preparing','ready','delivered') and o.fulfillment_status in ('pending','preparing','ready','delivered');
  owner:=(c->>'actor_type'='staff' and o.created_by_staff_user_id=(c->>'actor_id')::uuid)
    or (c->>'actor_type'='admin' and o.created_by_staff_user_id is null);
  admin:=c->>'actor_type'='admin' and private.restaurant_admin_supervision_enabled_v1(o.license_id);
  same_device:=o.created_by_device_id=(c->>'device_id')::uuid;
  pos:=c->>'actor_type'='admin' or coalesce((c->'actor_permissions'->>'pos')::boolean,false);
  refunds:=c->>'actor_type'='admin' or coalesce((c->'actor_permissions'->>'refunds')::boolean,false);
  writable:=not (select writes_paused from private.restaurant_cloud_contract_state where singleton);
  return jsonb_build_object('success',true,'contractVersion',1,'cloudOrderId',o.id,
    'localOrderId',o.local_order_id,'parentVersion',o.updated_at,
    'capabilities',jsonb_build_object('canViewTable',true,
      'canEditTable',writable and pos and active and (coalesce(owner,false) or admin) and same_device,
      'canSendToKitchen',writable and pos and active and (coalesce(owner,false) or admin) and same_device,
      'canCheckoutTable',writable and pos and active and (coalesce(owner,false) or admin),
      'canSplitTable',writable and pos and active and (coalesce(owner,false) or admin),
      'canCancelTable',writable and refunds and active and (admin or (coalesce(owner,false) and same_device)),
      'canAdministerTable',writable and admin and active),
    'remoteEdit','BLOCKED_PENDING_INVENTORY_CONTRACT');
end;
$function$;
revoke all on function public.pos_restaurant_transition_table_capabilities_v1(text,text,text,text,text) from public;
grant execute on function public.pos_restaurant_transition_table_capabilities_v1(text,text,text,text,text) to anon,authenticated;

create function public.pos_upsert_restaurant_order_versioned_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text default null,p_staff_session_token text default null,p_order jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='20s' as $function$
declare c jsonb; o public.pos_restaurant_orders; existing_line public.pos_restaurant_order_items;
  local_id text; expected timestamptz; item jsonb; line_id text;
begin
  perform private.enter_restaurant_transition_write_v1();
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  perform private.assert_cloud_sales_sync_base_enabled(c);
  perform private.assert_restaurant_orders_food_service((c->>'license_id')::uuid);
  local_id:=coalesce(nullif(btrim(p_order->>'localOrderId'),''),nullif(btrim(p_order->>'saleId'),''));
  if nullif(btrim(p_order->>'id'),'') is not null then raise exception 'RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED'; end if;
  if local_id is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED'; end if;
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  o:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,local_id);
  perform private.assert_restaurant_bridge_actor_v1(c,o,'edit');
  if o.id is not null then
    if o.paid_at is not null or o.paid_sale_id is not null or o.payment_status='paid' then raise exception 'RESTAURANT_ORDER_ALREADY_PAID'; end if;
    if o.cancelled_at is not null or o.status='cancelled' then raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED'; end if;
    if o.deleted_at is not null or o.archived_at is not null or o.checkout_closed_at is not null then raise exception 'RESTAURANT_ORDER_NOT_ACTIVE'; end if;
    if nullif(p_order->>'expectedParentVersion','') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end if;
    begin expected:=(p_order->>'expectedParentVersion')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end;
    if expected is distinct from o.updated_at then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT'; end if;
  elsif nullif(p_order->>'expectedParentVersion','') is not null then
    raise exception 'RESTAURANT_ORDER_NOT_FOUND';
  end if;
  -- Global line identities are serialized, including lines absent at snapshot.
  for item in select value from jsonb_array_elements(p_items) order by value->>'localLineId' loop
    line_id:=nullif(btrim(coalesce(item->>'localLineId',item->>'local_line_id')),'');
    if line_id is null then raise exception 'RESTAURANT_ORDER_LINE_ID_REQUIRED'; end if;
    -- The common mapper supplies localLineId, not a physical Cloud row ID.
    -- Never allow an alias ID to redirect the legacy leaf's ON CONFLICT target.
    if nullif(btrim(item->>'id'),'') is not null then raise exception 'RESTAURANT_ORDER_LINE_ID_CONFLICT'; end if;
    -- New parents use an unpredictable server-generated ID in the installed
    -- leaf; they have no preexisting physical line identities to lock.
    if o.id is null then continue; end if;
    line_id:='rest_item_'||md5(o.id||':'||line_id);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('restaurant_bridge_line:'||line_id,0));
    select * into existing_line from public.pos_restaurant_order_items where id=line_id for update;
    if existing_line.id is not null and (existing_line.license_id is distinct from (c->>'license_id')::uuid
      or o.id is null or existing_line.restaurant_order_id is distinct from o.id) then
      raise exception 'RESTAURANT_ORDER_LINE_ID_CONFLICT';
    end if;
  end loop;
  -- The original rate-limited public wrapper still validates its own contract.
  return public.pos_upsert_restaurant_order($1,$2,$3,$4,
    p_order||jsonb_build_object('clientContractVersion',2),p_items,$7);
end;
$function$;
revoke all on function public.pos_upsert_restaurant_order_versioned_v1(text,text,text,text,jsonb,jsonb,text) from public;
grant execute on function public.pos_upsert_restaurant_order_versioned_v1(text,text,text,text,jsonb,jsonb,text) to anon,authenticated;

create function private.enter_restaurant_financial_transition_write_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_request jsonb)
returns void language plpgsql security definer set search_path='' as $function$
declare c jsonb; ids text[];
begin
  -- Admission is transaction-scoped and must precede all business locks. This
  -- bridge intentionally does not lock parents from raw aliases: the canonical
  -- dispatcher resolves one coherent parent and locks it before Caja/ledger.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  ids:=array[p_request->>'parent_order_id',p_request->>'parentOrderId',
    p_request#>>'{restaurant_settlement,parent_order_id}',p_request#>>'{restaurant_settlement,parentOrderId}',
    p_request#>>'{sale,id}',p_request#>>'{sale,local_sale_id}',p_request#>>'{sale,localSaleId}',
    p_request#>>'{sale,cloud_sale_id}',p_request#>>'{sale,cloudSaleId}',
    p_request#>>'{sale,metadata,splitParentId}',p_request#>>'{sale,metadata,split_parent_id}',
    p_request#>>'{sale,metadata,restaurant,parentOrderId}',p_request#>>'{sale,metadata,restaurant,parent_order_id}'];
  -- The shared lock is held through COMMIT/ROLLBACK. While paused, inspect the
  -- raw aliases only to reject Restaurant writes; never acquire parent locks
  -- until the dispatcher has canonicalized and reconciled the full request.
  if not (select writes_paused from private.restaurant_cloud_contract_state where singleton) then return; end if;
  if exists(select 1 from public.pos_restaurant_orders where license_id=(c->>'license_id')::uuid
      and (local_order_id=any(ids) or id=any(ids)))
    or nullif(p_request->>'parent_order_id','') is not null
    or nullif(p_request->>'parentOrderId','') is not null
    or p_request ? 'restaurant_settlement' then
    raise exception 'RESTAURANT_CONTRACT_MAINTENANCE' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.enter_restaurant_financial_transition_write_v1(text,text,text,text,jsonb) from public,anon,authenticated;

create function private.prepare_restaurant_bridge_cancel_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_local_order_id text,p_expected_parent_version text)
returns void language plpgsql security definer set search_path='' as $function$
declare c jsonb; o public.pos_restaurant_orders;
begin
  perform private.enter_restaurant_transition_write_v1();
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  o:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,$5);
  perform private.assert_restaurant_bridge_actor_v1(c,o,'cancel');
  if o.id is null then raise exception 'RESTAURANT_ORDER_NOT_FOUND'; end if;
  -- Already confirmed cancellation returns its existing receipt in the original
  -- RPC. No permit or new effect is needed, including a lost-response retry.
  if o.status='cancelled' then return; end if;
  if o.payment_status='paid' or o.paid_at is not null or o.paid_sale_id is not null then raise exception 'RESTAURANT_ORDER_ALREADY_PAID'; end if;
  if nullif($6,'') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end if;
  if $6::timestamptz is distinct from o.updated_at then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT'; end if;
  insert into private.restaurant_bridge_cancel_permits values(pg_current_xact_id(),o.license_id,o.id) on conflict do nothing;
end;
$function$;
revoke all on function private.prepare_restaurant_bridge_cancel_v1(text,text,text,text,text,text) from public,anon,authenticated;

-- Instrument actual installed bodies without recreating their business logic.
-- pg_get_functiondef preserves signatures, security mode and settings; CREATE OR
-- REPLACE preserves ACLs. Only a first statement is inserted, never a header flag
-- granting authority. The matrix tests execute captured production bodies.
do $bridge_writers$
declare r record; definition text; instruction text;
begin
  for r in select p.oid,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname in ('pos_upsert_restaurant_order_unlimited',
      'pos_update_restaurant_order_status_unlimited','pos_update_restaurant_order_item_status_unlimited',
      'pos_close_restaurant_order_after_checkout_unlimited','pos_archive_restaurant_order_unlimited',
      'pos_execute_financial_operation_v1','pos_cancel_restaurant_order_from_pos_v1'))
      or (n.nspname='private' and p.proname in ('r2b_authorize_sale_financial_request_v1','execute_split_sale_financial_v1')) loop
    definition:=pg_get_functiondef(r.oid);
    if r.proname='pos_upsert_restaurant_order_unlimited' then
      instruction:='perform private.prepare_restaurant_bridge_upsert_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order,p_items);';
    elsif r.proname='pos_execute_financial_operation_v1' then
      instruction:='perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_request);';
    elsif r.proname='r2b_authorize_sale_financial_request_v1' then
      instruction:='perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,jsonb_build_object(''sale'',p_sale));';
    elsif r.proname='execute_split_sale_financial_v1' then
      instruction:='perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_split);';
    elsif r.proname='pos_cancel_restaurant_order_from_pos_v1' then
      instruction:='perform private.prepare_restaurant_bridge_cancel_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_local_order_id,p_expected_parent_version);';
    elsif r.proname='pos_update_restaurant_order_status_unlimited' then
      instruction:='perform private.enter_restaurant_transition_write_v1(); if lower(btrim(p_status))=''cancelled'' then raise exception ''RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED''; end if;';
    else instruction:='perform private.enter_restaurant_transition_write_v1();'; end if;
    if definition !~ E'\n[Bb][Ee][Gg][Ii][Nn][[:space:]]+' then raise exception 'BRIDGE_UNSUPPORTED_FUNCTION_BODY: %',r.proname; end if;
    definition:=regexp_replace(definition,E'(\n[Bb][Ee][Gg][Ii][Nn][[:space:]]+)',E'\\1  '||instruction||E'\n');
    execute definition;
  end loop;
end;
$bridge_writers$;

create or replace function private.guard_restaurant_bridge_parent_v1()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare v_terminal boolean; v_permitted boolean := false;
begin
  v_terminal := lower(coalesce(new.status,''))='cancelled'
    or lower(coalesce(new.fulfillment_status,''))='cancelled'
    or new.cancelled_at is not null or new.metadata->>'cancelledFromPos'='true';
  if TG_OP='UPDATE' and (old.status='cancelled' or old.fulfillment_status='cancelled'
    or old.cancelled_at is not null or old.metadata->>'cancelledFromPos'='true') then
    if new.status is distinct from old.status or new.fulfillment_status is distinct from old.fulfillment_status
      or new.cancelled_at is distinct from old.cancelled_at or new.payment_status is distinct from old.payment_status
      or new.metadata->'cancelledFromPos' is distinct from old.metadata->'cancelledFromPos'
      or new.metadata->'cancelReason' is distinct from old.metadata->'cancelReason'
      or new.metadata->'cancelContractVersion' is distinct from old.metadata->'cancelContractVersion' then
      raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode='P0001';
    end if;
    return new;
  end if;
  -- Kitchen delivery is operational, not financial closure. Archiving an
  -- unpaid delivered parent would otherwise hide the live POS table.
  if (new.archived_at is not null or new.deleted_at is not null or new.metadata->>'archived'='true')
    and new.paid_at is null and new.paid_sale_id is null
    and coalesce(new.payment_status,'unpaid') <> 'paid' then
    raise exception 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED' using errcode='P0001';
  end if;
  if v_terminal then
    if TG_OP='UPDATE' and (old.paid_at is not null or old.paid_sale_id is not null
      or coalesce(old.payment_status,'unpaid') <> 'unpaid') then
      raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode='P0001';
    end if;
    v_permitted:=exists(select 1 from private.restaurant_bridge_cancel_permits
      where transaction_id=pg_current_xact_id() and license_id=new.license_id and order_id=new.id);
    if not v_permitted and to_regclass('private.restaurant_parent_cancel_permits') is not null then
      execute 'select exists(select 1 from private.restaurant_parent_cancel_permits where transaction_id=pg_current_xact_id() and license_id=$1 and order_id=$2)' into v_permitted using new.license_id,new.id;
    end if;
    if not v_permitted then
      raise exception 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$guard$;
revoke all on function private.guard_restaurant_bridge_parent_v1() from public,anon,authenticated;
create trigger restaurant_bridge_terminal_guard_v1 before insert or update on public.pos_restaurant_orders
for each row execute function private.guard_restaurant_bridge_parent_v1();
create function private.cleanup_restaurant_bridge_cancel_permit_v1() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  delete from private.restaurant_bridge_cancel_permits where transaction_id=pg_current_xact_id()
    and license_id=new.license_id and order_id=new.id;
  return new;
end; $function$;
revoke all on function private.cleanup_restaurant_bridge_cancel_permit_v1() from public,anon,authenticated;
create trigger restaurant_bridge_cancel_permit_cleanup_v1 after insert or update on public.pos_restaurant_orders
for each row execute function private.cleanup_restaurant_bridge_cancel_permit_v1();
create or replace function private.recalculate_restaurant_order_status(
  p_license_id uuid,
  p_restaurant_order_id text
)
returns public.pos_restaurant_orders
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order public.pos_restaurant_orders;
  v_saved public.pos_restaurant_orders;
  v_total integer := 0;
  v_active integer := 0;
  v_preparing integer := 0;
  v_done integer := 0;
  v_next_status text;
  v_is_paid boolean := false;
begin
  perform private.enter_restaurant_transition_write_v1();
  select * into v_order
  from public.pos_restaurant_orders
  where license_id = p_license_id
    and id = p_restaurant_order_id
    and deleted_at is null
  limit 1
  for update;

  if v_order.id is null then
    return v_order;
  end if;

  if v_order.status in ('delivered', 'cancelled') then
    return v_order;
  end if;

  v_is_paid := lower(coalesce(v_order.payment_status, 'unpaid')) = 'paid';

  select
    count(*)::integer,
    count(*) filter (where status <> 'cancelled')::integer,
    count(*) filter (where status = 'preparing')::integer,
    count(*) filter (where status in ('ready', 'delivered'))::integer
  into v_total, v_active, v_preparing, v_done
  from public.pos_restaurant_order_items
  where license_id = p_license_id
    and restaurant_order_id = p_restaurant_order_id
    and deleted_at is null;

  if coalesce(v_total, 0) = 0 then
    return v_order;
  end if;

  if coalesce(v_active, 0) = 0 then
    -- An entirely rejected Kitchen ticket remains an open POS parent.
    -- Item evidence is preserved for the origin's existing reconciliation.
    v_next_status := v_order.status;
  elsif v_done = v_active then
    v_next_status := case when v_is_paid then 'delivered' else 'ready' end;
  elsif v_preparing > 0 or v_done > 0 then
    v_next_status := 'preparing';
  else
    v_next_status := 'pending';
  end if;

  -- Each item mutation must advance the parent version, even when its aggregate
  -- status stays unchanged. Otherwise a POS write could overwrite a Kitchen edit.

  update public.pos_restaurant_orders
  set status = v_next_status,
      fulfillment_status = v_next_status,
      updated_at = now(),
      sent_to_kitchen_at = case when v_next_status in ('pending', 'preparing', 'ready', 'delivered') then coalesce(sent_to_kitchen_at, now()) else sent_to_kitchen_at end,
      ready_at = case when v_next_status in ('ready', 'delivered') then coalesce(ready_at, now()) else ready_at end,
      delivered_at = case when v_next_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      checkout_closed_at = case when v_next_status = 'delivered' and v_is_paid then coalesce(checkout_closed_at, now()) else checkout_closed_at end,
      cancelled_at = case when v_next_status = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
      server_version = server_version + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.7', 'statusRecalculatedBy', 'private.recalculate_restaurant_order_status')
  where license_id = p_license_id
    and id = p_restaurant_order_id
    and deleted_at is null
  returning * into v_saved;

  return coalesce(v_saved, v_order);
end;
$$;
