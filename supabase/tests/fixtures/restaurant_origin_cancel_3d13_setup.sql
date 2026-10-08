-- CONTROLLED TEST FIXTURE ONLY. Requires a clean, isolated PostgreSQL 17 DB.
-- Contains production function snapshots plus test doubles for device/session
-- validation, plan checks and financial leaf operations. NEVER load in prod.
create schema private;
do $fixture_roles$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then execute 'create role anon'; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then execute 'create role authenticated'; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then execute 'create role service_role'; end if;
end; $fixture_roles$;
create table public.pos_restaurant_orders (
 id text not null,
 license_id uuid not null,
 local_order_id text,
 sale_id text,
 table_label text,
 customer_id text,
 customer_name text,
 status text not null default 'pending'::text,
 fulfillment_status text not null default 'pending'::text,
 source text not null default 'pos'::text,
 notes text,
 subtotal numeric not null default 0,
 total numeric not null default 0,
 currency text not null default 'MXN'::text,
 created_by_device_id uuid,
 updated_by_device_id uuid,
 created_by_staff_user_id uuid,
 updated_by_staff_user_id uuid,
 created_at timestamp with time zone not null default now(),
 updated_at timestamp with time zone not null default now(),
 sent_to_kitchen_at timestamp with time zone,
 ready_at timestamp with time zone,
 delivered_at timestamp with time zone,
 cancelled_at timestamp with time zone,
 deleted_at timestamp with time zone,
 server_version integer not null default 1,
 last_idempotency_key text,
 metadata jsonb not null default '{}'::jsonb,
 payment_status text,
 paid_at timestamp with time zone,
 paid_sale_id text,
 paid_sale_folio text,
 paid_total numeric,
 checkout_closed_at timestamp with time zone,
 checkout_close_metadata jsonb not null default '{}'::jsonb,
 archived_at timestamp with time zone,
 archive_reason text,
 archive_metadata jsonb not null default '{}'::jsonb,
 archived_by_device_id uuid,
 archived_by_staff_user_id uuid
);
create table public.pos_restaurant_order_items (
 id text not null,
 license_id uuid not null,
 restaurant_order_id text not null,
 local_line_id text,
 product_id text,
 product_name text not null,
 quantity numeric not null default 1,
 unit_price numeric not null default 0,
 line_total numeric not null default 0,
 notes text,
 selected_modifiers jsonb not null default '[]'::jsonb,
 station_code text not null default 'kitchen'::text,
 station_name text not null default 'Cocina'::text,
 status text not null default 'pending'::text,
 sort_order integer not null default 0,
 created_at timestamp with time zone not null default now(),
 updated_at timestamp with time zone not null default now(),
 deleted_at timestamp with time zone,
 server_version integer not null default 1,
 metadata jsonb not null default '{}'::jsonb,
 started_at timestamp with time zone,
 ready_at timestamp with time zone,
 delivered_at timestamp with time zone,
 cancelled_at timestamp with time zone,
 updated_by_device_id uuid,
 updated_by_staff_user_id uuid
);
create table public.pos_idempotency_keys (
 id uuid not null default gen_random_uuid(),
 license_id uuid not null,
 idempotency_key text not null,
 operation_type text not null,
 entity_type text,
 entity_id text,
 request_hash text,
 response_payload jsonb,
 status text not null default 'completed'::text,
 created_at timestamp with time zone not null default now(),
 expires_at timestamp with time zone
);
create unique index on public.pos_idempotency_keys(license_id,idempotency_key);
create table public.pos_sync_events(id uuid default gen_random_uuid(),license_id uuid,entity_type text,entity_id text,operation text,change_seq bigint,server_version integer,actor_device_id uuid,actor_staff_user_id uuid,idempotency_key text,metadata jsonb,created_at timestamptz default now());
create sequence public.pos_change_seq;
create function private.next_pos_change_seq() returns bigint language sql as $$ select nextval('public.pos_change_seq') $$;
create function private.broadcast_pos_event(uuid,jsonb) returns void language sql as $$ select $$;
CREATE OR REPLACE FUNCTION private.complete_pos_idempotency(p_license_id uuid, p_idempotency_key text, p_response_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.pos_idempotency_keys
  set status = 'completed',
      response_payload = p_response_payload,
      expires_at = now() + interval '7 days'
  where license_id = p_license_id
    and idempotency_key = p_idempotency_key;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.insert_pos_idempotency_processing(p_license_id uuid, p_idempotency_key text, p_operation_type text, p_entity_type text, p_entity_id text, p_request_hash text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row_count integer := 0;
  v_existing_hash text;
  v_existing_status text;
begin
  if p_idempotency_key is null or length(btrim(p_idempotency_key)) = 0 then
    raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;

  insert into public.pos_idempotency_keys (
    license_id, idempotency_key, operation_type, entity_type,
    entity_id, request_hash, status, expires_at
  ) values (
    p_license_id, p_idempotency_key, p_operation_type, p_entity_type,
    p_entity_id, p_request_hash, 'processing', now() + interval '7 days'
  )
  on conflict (license_id, idempotency_key) do nothing;

  get diagnostics v_row_count = row_count;
  if v_row_count > 0 then return true; end if;

  select k.request_hash, k.status
  into v_existing_hash, v_existing_status
  from public.pos_idempotency_keys k
  where k.license_id = p_license_id
    and k.idempotency_key = p_idempotency_key
  for update;

  if p_request_hash is not null
     and v_existing_hash is not null
     and v_existing_hash is distinct from p_request_hash then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  if v_existing_hash is null and p_request_hash is not null
     and v_existing_status = 'processing' then
    update public.pos_idempotency_keys
    set request_hash = p_request_hash
    where license_id = p_license_id
      and idempotency_key = p_idempotency_key
      and request_hash is null;
  end if;

  return false;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.record_pos_sync_event(p_license_id uuid, p_entity_type text, p_entity_id text, p_operation text, p_actor_device_id uuid DEFAULT NULL::uuid, p_actor_staff_user_id uuid DEFAULT NULL::uuid, p_idempotency_key text DEFAULT NULL::text, p_metadata jsonb DEFAULT '{}'::jsonb, p_server_version integer DEFAULT 1)
 RETURNS pos_sync_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.pos_sync_events;
begin
  insert into public.pos_sync_events (
    license_id,
    entity_type,
    entity_id,
    operation,
    change_seq,
    server_version,
    actor_device_id,
    actor_staff_user_id,
    idempotency_key,
    metadata
  ) values (
    p_license_id,
    p_entity_type,
    p_entity_id,
    coalesce(p_operation, 'unknown'),
    private.next_pos_change_seq(),
    coalesce(p_server_version, 1),
    p_actor_device_id,
    p_actor_staff_user_id,
    p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning * into v_event;

  perform private.broadcast_pos_event(
    p_license_id,
    jsonb_build_object(
      'entity_type', v_event.entity_type,
      'entity_id', v_event.entity_id,
      'operation', v_event.operation,
      'change_seq', v_event.change_seq,
      'server_version', v_event.server_version,
      'actor_device_id', v_event.actor_device_id,
      'actor_staff_user_id', v_event.actor_staff_user_id,
      'created_at', v_event.created_at
    )
  );

  return v_event;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.resolve_pos_actor_type(p_context jsonb)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_actor_type text := nullif(p_context->>'actor_type', '');
  v_device_mode text := nullif(p_context->>'device_mode', '');
  v_legacy_role text := nullif(p_context->>'device_role', '');
begin
  if v_actor_type in ('admin', 'staff') then
    return v_actor_type;
  end if;

  if v_device_mode = 'shared' then
    raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001';
  end if;

  if v_legacy_role in ('admin', 'staff') then
    return v_legacy_role;
  end if;

  raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001';
end;
$function$
;
CREATE OR REPLACE FUNCTION private.assert_pos_permission(p_context jsonb, p_permission text)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_actor_type text := private.resolve_pos_actor_type(p_context);
  v_permissions jsonb := coalesce(p_context->'actor_permissions', p_context->'staff_permissions', '{}'::jsonb);
begin
  if v_actor_type = 'admin' then return; end if;
  if v_actor_type = 'staff' and coalesce((v_permissions->>p_permission)::boolean, false) is true then return; end if;
  raise exception 'POS_PERMISSION_DENIED:%', p_permission using errcode = 'P0001';
end;
$function$
;
CREATE OR REPLACE FUNCTION private.lock_restaurant_order_settlement_v1(p_license_id uuid, p_local_order_id text)
 RETURNS pos_restaurant_orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_order public.pos_restaurant_orders;
begin
  if p_license_id is null or nullif(btrim(p_local_order_id), '') is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext(p_license_id::text), hashtext('restaurant_split:' || p_local_order_id));
  select * into v_order from public.pos_restaurant_orders o where o.license_id = p_license_id and o.local_order_id = p_local_order_id order by (o.deleted_at is null) desc, o.updated_at desc nulls last, o.id limit 1 for update;
  return v_order;
end;
$function$
;
create function private.validate_pos_sync_context(text,text,text,text) returns jsonb language plpgsql as $$
begin
 if nullif($1,'') is distinct from 'fixture-license' or nullif($2,'') is null or nullif($3,'') is distinct from 'valid' then raise exception 'DEVICE_AUTH_INVALID'; end if;
 if $4='invalid-staff' then raise exception 'STAFF_SESSION_INVALID'; end if;
 return jsonb_build_object('license_id','00000000-0000-0000-0000-000000000001','device_id',case when $2='A' then '00000000-0000-0000-0000-00000000000a' else '00000000-0000-0000-0000-00000000000b' end,'actor_type',case when $4 is null then 'admin' else 'staff' end,'staff_user_id',case when $4='refunds' then '00000000-0000-0000-0000-0000000000aa' else null end,'actor_permissions',jsonb_build_object('refunds',$4='refunds'));
end $$;
create function private.assert_cloud_sales_sync_base_enabled(jsonb) returns void language sql as $$ select $$;
create function private.assert_restaurant_orders_food_service(uuid) returns void language sql as $$ select $$;
create table public.pos_sales(id text,local_order_id text,total numeric);
create table public.pos_sale_payments(id text);
create table public.pos_cash_movements(id text);
create table public.pos_customer_ledger(id text);
create table public.pos_financial_operations(id uuid default gen_random_uuid(),status text, response_payload jsonb,legacy_idempotency_key text);
create table public.pos_cash_sessions(license_id uuid,id text,cash_station_id text,deleted_at timestamptz,status text,actor_key text);
insert into public.pos_cash_sessions values('00000000-0000-0000-0000-000000000001','cash-a','station-a',null,'open','admin:a');
create function private.resolve_cash_actor_key(jsonb) returns text language sql as $$ select 'admin:a'::text $$;
create function private.resolve_financial_cash_station_v1(uuid,uuid) returns text language sql as $$ select 'station-a'::text $$;
create function private.canonical_financial_request_v1(text,jsonb) returns jsonb language sql as $$ select $2 $$;
create function private.financial_execution_request_v1(jsonb) returns jsonb language sql as $$ select $1 $$;
create function private.reserve_financial_operation_v1(uuid,text,text,text,jsonb,text,uuid,text,text) returns public.pos_financial_operations language plpgsql as $$
declare v public.pos_financial_operations;
begin insert into public.pos_financial_operations(status,legacy_idempotency_key) values('processing',$2) returning * into v; return v; end $$;
create function private.public_financial_response_v1(text,jsonb,text,text) returns jsonb language sql as $$ select $2 $$;
create function private.complete_financial_operation_v1(uuid,text,jsonb) returns void language sql as $$ select $$;
create function public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text) returns jsonb language plpgsql as $$
begin
 insert into public.pos_sales values('sale-'||($5->>'id'),$5->>'id',($5->>'total')::numeric);
 insert into public.pos_sale_payments values('payment-'||($5->>'id'));
 insert into public.pos_cash_movements values('cash-'||($5->>'id'));
 return jsonb_build_object('success',true,'sale',jsonb_build_object('id','sale-'||($5->>'id')));
end $$;
create function public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text) returns jsonb language plpgsql as $$
begin update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id=$6,updated_at=now() where local_order_id=$5;
 return jsonb_build_object('success',true,'found',true,'order',jsonb_build_object('status','delivered','fulfillment_status','delivered'));
end $$;
create function private.execute_split_sale_financial_v1(text,text,text,text,jsonb,text) returns jsonb language plpgsql as $$
declare v public.pos_restaurant_orders;
begin
 v:=private.lock_restaurant_order_settlement_v1('00000000-0000-0000-0000-000000000001',$5->>'parent_order_id');
 insert into public.pos_sales values('split-'||($5->>'parent_order_id'),$5->>'parent_order_id',50);
 update public.pos_restaurant_orders set payment_status='paid',paid_at=now(),paid_sale_id='split-'||($5->>'parent_order_id'),updated_at=now() where local_order_id=$5->>'parent_order_id';
 return jsonb_build_object('success',true);
end $$;
CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text, p_request_hash text DEFAULT NULL::text, p_operation_type text DEFAULT NULL::text, p_request jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET statement_timeout TO '45s'
 SET lock_timeout TO '20s'
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_canonical jsonb;
  v_execution jsonb;
  v_cash_station_id text;
  v_cash_session_id text;
  v_session_station_id text;
  v_operation public.pos_financial_operations;
  v_response jsonb;
  v_internal_idempotency_key text;
  v_requires_cash boolean := false;
  v_layaway_id text;
  v_payment_payload jsonb;
  v_rate_limit jsonb;
  v_restaurant_order_id text;
  v_restaurant_version text;
  v_restaurant_version_at timestamptz;
  v_restaurant_order public.pos_restaurant_orders;
  v_restaurant_row_exists boolean := false;
  v_restaurant_context_supplied boolean := false;
  v_is_restaurant_settlement boolean := false;
  v_sale_total numeric;
  v_restaurant_paid_sale_id text;
  v_restaurant_paid_folio text;
  v_restaurant_close_response jsonb;
  v_restaurant_payment_summary jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
      p_license_key, p_device_fingerprint, p_staff_session_token,
      'pos_execute_financial_operation_v1.layaway', 'POS_WRITE',
      120, 600, 300, 'RPC_RATE_LIMITED',
      jsonb_build_object('operation_type', p_operation_type)
    );
    if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
      return public.build_pos_rpc_rate_limited_response(v_rate_limit);
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel', 'sale.layaway_complete') then
    perform private.assert_cloud_layaways_enabled(v_context);
    perform private.assert_pos_permission(v_context, 'pos');
  end if;

  -- Canonicalize first so restaurant settlement takes its shared lock before
  -- the cash-session row and the financial-operation ledger.
  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);

    if p_operation_type = 'sale.split' then
      v_restaurant_order_id := nullif(btrim(v_execution->>'parent_order_id'), '');
      v_restaurant_version := nullif(btrim(v_canonical->>'parent_order_version'), '');
    else
      v_restaurant_order_id := nullif(btrim(v_execution->'sale'->>'id'), '');
      v_restaurant_context_supplied := p_request ? 'restaurant_settlement';
      if v_restaurant_context_supplied then
        if v_restaurant_order_id is distinct from nullif(btrim(v_canonical #>> '{restaurant_settlement,parent_order_id}'), '') then
          raise exception 'RESTAURANT_ORDER_CONTEXT_MISMATCH' using errcode = 'P0001';
        end if;
        v_restaurant_version := nullif(btrim(v_canonical #>> '{restaurant_settlement,parent_order_version}'), '');
      end if;
    end if;

    if v_restaurant_order_id is not null then
      select exists (
        select 1 from public.pos_restaurant_orders o
         where o.license_id = v_license_id
           and o.local_order_id = v_restaurant_order_id
      ) into v_restaurant_row_exists;

      if p_operation_type = 'sale.split' or v_restaurant_context_supplied or v_restaurant_row_exists then
        v_restaurant_order := private.lock_restaurant_order_settlement_v1(v_license_id, v_restaurant_order_id);
        if v_restaurant_order.id is null then
          raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
        end if;
        v_is_restaurant_settlement := true;
      end if;
    elsif p_operation_type = 'sale.split' or v_restaurant_context_supplied then
      raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit', 'sale.split') then
    v_cash_session_id := nullif(btrim(coalesce(p_request->>'cash_session_id', p_request->>'cashSessionId')), '');
    if v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    select s.cash_station_id into v_session_station_id
      from public.pos_cash_sessions s
     where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
     for update;
    if not found then
      raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_session_station_id is null then
      raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
    end if;
    if v_session_station_id is distinct from v_cash_station_id then
      raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
    end if;
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
    v_cash_session_id := private.layaway_request_cash_session_id_v1(p_request);
    if p_operation_type = 'layaway.payment' then
      v_requires_cash := true;
    elsif p_operation_type = 'layaway.create' then
      v_payment_payload := private.layaway_payment_payload_v1(p_request);
      v_requires_cash := coalesce(private.layaway_request_numeric_v1(v_payment_payload, array['amount', 'total'], 0), 0) > 0;
    else
      v_layaway_id := private.layaway_request_id_v1(p_request);
      v_requires_cash := not private.layaway_request_bool_v1(p_request, array['retain_money', 'retainMoney', 'retained_money'])
        and exists (
          select 1 from public.pos_layaways l
           where l.license_id = v_license_id and l.id = v_layaway_id and l.paid_amount > 0
        );
    end if;

    if v_requires_cash and v_cash_session_id is null then
      raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_cash_session_id is not null then
      select s.cash_station_id into v_session_station_id
        from public.pos_cash_sessions s
       where s.license_id = v_license_id and s.id = v_cash_session_id and s.deleted_at is null
       for update;
      if not found then
        raise exception 'CASH_SESSION_NOT_FOUND' using errcode = 'P0001';
      end if;
      if v_session_station_id is null then
        raise exception 'CASH_STATION_UNRESOLVED' using errcode = 'P0001';
      end if;
      if v_session_station_id is distinct from v_cash_station_id then
        raise exception 'CASH_SESSION_STATION_MISMATCH' using errcode = 'P0001';
      end if;
      if (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
        raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
      end if;
      if (select actor_key from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) is distinct from v_actor_key then
        raise exception 'CASH_SESSION_FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if p_operation_type in ('cash.open', 'sale.layaway_complete') then
    v_cash_station_id := private.resolve_financial_cash_station_v1(v_license_id, v_device_id);
  end if;

  if p_operation_type in ('layaway.create', 'layaway.payment', 'layaway.cancel') then
    v_canonical := private.canonical_layaway_request_v1(p_operation_type, p_request);
    v_execution := private.layaway_execution_request_v1(p_request);
  else
    v_canonical := private.canonical_financial_request_v1(p_operation_type, p_request);
    v_execution := private.financial_execution_request_v1(p_request);
  end if;

  v_operation := private.reserve_financial_operation_v1(
    v_license_id, p_idempotency_key, p_request_hash,
    p_operation_type, v_canonical, v_actor_key, v_device_id,
    v_canonical->>'cash_session_id', v_cash_station_id
  );
  if v_operation.status = 'completed' then
    return private.public_financial_response_v1(
      p_operation_type,
      v_operation.response_payload,
      p_idempotency_key,
      v_operation.legacy_idempotency_key
    );
  end if;
  v_internal_idempotency_key := v_operation.legacy_idempotency_key;

  -- Completed K/H retries returned above. Validate new attempts before sale effects.
  if v_is_restaurant_settlement then
    if v_restaurant_order.deleted_at is not null or v_restaurant_order.archived_at is not null or v_restaurant_order.checkout_closed_at is not null then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_restaurant_order.status = 'cancelled' or v_restaurant_order.cancelled_at is not null then
      raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_restaurant_order.payment_status, 'unpaid')) = 'paid' then
      raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
    end if;
    if lower(coalesce(v_restaurant_order.payment_status, 'unpaid')) <> 'unpaid'
       or v_restaurant_order.status not in ('pending', 'preparing', 'ready', 'delivered')
       or v_restaurant_order.fulfillment_status not in ('pending', 'preparing', 'ready', 'delivered') then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
    end if;
    if v_restaurant_version is not null then
      begin
        v_restaurant_version_at := v_restaurant_version::timestamptz;
      exception
        when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
          raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end;
      if v_restaurant_order.updated_at is distinct from v_restaurant_version_at then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
      end if;
    end if;

    if p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
      begin
        v_sale_total := nullif(v_canonical #>> '{sale,total}', '')::numeric;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'RESTAURANT_SETTLEMENT_TOTAL_MISMATCH' using errcode = 'P0001';
      end;
      if v_sale_total is null or round(v_sale_total, 2) <> round(coalesce(v_restaurant_order.total, 0), 2) then
        raise exception 'RESTAURANT_SETTLEMENT_TOTAL_MISMATCH' using errcode = 'P0001';
      end if;
    end if;
  end if;

  case p_operation_type
    when 'cash.open' then
      v_response := public.pos_open_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'cash.movement' then
      v_response := public.pos_register_cash_movement(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'type', (v_execution->>'amount')::numeric,
        v_execution->>'concept', v_internal_idempotency_key,
        jsonb_strip_nulls(jsonb_build_object(
          'source', v_execution->>'source', 'reference_type', v_execution->>'reference_type',
          'reference_id', v_execution->>'reference_id'
        ))
      );
    when 'cash.adjust_initial_fund' then
      v_response := public.pos_adjust_initial_cash_fund(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', (v_execution->>'new_opening_amount')::numeric,
        v_execution->>'reason', (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.close' then
      v_response := public.pos_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution, (v_execution->>'expected_version')::integer,
        v_internal_idempotency_key
      );
    when 'cash.admin_close' then
      v_response := public.pos_admin_close_cash_session(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'cash_session_id', v_execution->>'closing_mode',
        (v_execution->>'counted_amount')::numeric, (v_execution->>'next_shift_fund')::numeric,
        v_execution->>'reason_code', v_execution->>'comments',
        (v_execution->>'expected_version')::integer, v_internal_idempotency_key
      );
    when 'sale.cashier' then
      v_response := public.pos_create_cloud_sale_cashier(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.cashier_inventory' then
      v_response := public.pos_create_cloud_sale_cashier_inventory(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_internal_idempotency_key
      );
    when 'sale.credit' then
      v_response := public.pos_create_cloud_sale_credit(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->'sale', v_execution->'items', v_execution->'payments',
        v_execution->>'cash_session_id', v_execution->>'customer_id', v_internal_idempotency_key
      );
    when 'sale.split' then
      v_response := private.execute_split_sale_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, v_internal_idempotency_key
      );
    when 'sale.layaway_complete' then
      v_response := private.execute_layaway_completion_financial_v1(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution, p_idempotency_key
      );
    when 'sale.cancel' then
      v_response := public.pos_cancel_cloud_sale(
        p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
        v_execution->>'sale_id', v_execution->>'reason', v_internal_idempotency_key
      );
    when 'layaway.create' then
      v_response := private.execute_layaway_create_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.payment' then
      v_response := private.execute_layaway_payment_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    when 'layaway.cancel' then
      v_response := private.execute_layaway_cancel_financial_v1(
        v_context, v_execution, p_idempotency_key, p_request_hash, v_cash_station_id
      );
    else
      raise exception 'FINANCIAL_OPERATION_TYPE_UNSUPPORTED' using errcode = 'P0001';
  end case;

  if v_is_restaurant_settlement and p_operation_type in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
    if coalesce((v_response->>'success')::boolean, false) is not true then
      raise exception 'RESTAURANT_SETTLEMENT_SALE_NOT_CONFIRMED:%',
        coalesce(v_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;
    v_restaurant_paid_sale_id := nullif(btrim(coalesce(v_response->'sale'->>'id', v_response->'sale'->>'cloud_sale_id', v_response->'sale'->>'cloudSaleId')), '');
    v_restaurant_paid_folio := nullif(btrim(coalesce(v_response->'sale'->>'pos_folio', v_response->'sale'->>'folio')), '');
    if v_restaurant_paid_sale_id is null then
      raise exception 'RESTAURANT_SETTLEMENT_SALE_RESPONSE_INVALID' using errcode = 'P0001';
    end if;
    v_restaurant_payment_summary := jsonb_build_object('source', 'restaurant_normal_checkout', 'operation_type', p_operation_type, 'payment_method', v_canonical #>> '{sale,payment_method}', 'total', round(v_sale_total, 2), 'sourceMode', 'cloud_committed');
    v_restaurant_close_response := public.pos_close_restaurant_order_after_checkout_unlimited(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      v_restaurant_order_id, v_restaurant_paid_sale_id, v_restaurant_paid_folio,
      round(v_sale_total, 2), v_restaurant_payment_summary, v_internal_idempotency_key || ':restaurant-close'
    );
    if coalesce((v_restaurant_close_response->>'success')::boolean, false) is not true or coalesce((v_restaurant_close_response->>'found')::boolean, false) is not true then
      raise exception 'RESTAURANT_ORDER_CLOSE_NOT_CONFIRMED:%', coalesce(v_restaurant_close_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;
    v_response := v_response || jsonb_build_object('restaurant_settlement', jsonb_build_object('success', true, 'parent_order_id', v_restaurant_order_id, 'payment_status', 'paid', 'paid_sale_id', v_restaurant_paid_sale_id, 'paid_sale_folio', v_restaurant_paid_folio, 'total', round(v_sale_total, 2), 'status', v_restaurant_close_response #>> '{order,status}', 'fulfillment_status', v_restaurant_close_response #>> '{order,fulfillment_status}'));
  end if;

  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$
;
