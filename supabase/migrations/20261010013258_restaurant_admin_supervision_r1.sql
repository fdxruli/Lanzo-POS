-- Restaurant authority r1. HOLD_SQL_DEPLOYMENT_APPROVAL.
-- Audited against deployed pg_get_functiondef on 2026-10-09. No production writes.
create table if not exists private.restaurant_table_interventions (
  id bigint generated always as identity primary key,
  license_id uuid not null,
  order_id text not null,
  actor_type text not null check (actor_type in ('admin','staff')),
  actor_id uuid not null,
  actor_session_id uuid not null,
  device_id uuid not null,
  operation text not null,
  expected_version timestamptz not null,
  reason text,
  idempotency_key text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (license_id, operation, idempotency_key)
);
alter table private.restaurant_table_interventions enable row level security;
revoke all on private.restaurant_table_interventions from public, anon, authenticated;

create or replace function private.assert_restaurant_table_actor_v1(
  p_context jsonb, p_order public.pos_restaurant_orders, p_operation text
) returns void language plpgsql set search_path = '' as $function$
declare v_actor text := p_context->>'actor_type';
begin
  if p_order.id is null or p_order.license_id is distinct from (p_context->>'license_id')::uuid then
    raise exception 'RESTAURANT_TABLE_SCOPE_DENIED' using errcode = 'P0001';
  end if;
  if nullif(p_context->>'actor_id','') is null or nullif(p_context->>'actor_session_id','') is null
     or nullif(p_context->>'device_id','') is null then
    raise exception 'ACTOR_SESSION_REQUIRED' using errcode = 'P0001';
  end if;
  if p_operation not in ('view','edit','kitchen','checkout','split','cancel') then
    raise exception 'RESTAURANT_TABLE_OPERATION_DENIED' using errcode = 'P0001';
  end if;
  perform private.assert_pos_permission(p_context, case when p_operation = 'cancel' then 'refunds' else 'pos' end);
  if v_actor = 'admin' then
    if nullif(p_context->>'admin_user_id','') is distinct from p_context->>'actor_id'
       or nullif(p_context->>'admin_session_id','') is distinct from p_context->>'actor_session_id' then
      raise exception 'ACTOR_SESSION_INVALID' using errcode = 'P0001';
    end if;
  elsif v_actor = 'staff' then
    if p_operation <> 'view' and (p_order.created_by_staff_user_id is null
      or p_order.created_by_staff_user_id is distinct from (p_context->>'actor_id')::uuid) then
      raise exception 'RESTAURANT_TABLE_OWNER_REQUIRED' using errcode = 'P0001';
    end if;
  else
    raise exception 'ACTOR_SESSION_INVALID' using errcode = 'P0001';
  end if;
  -- Identity can travel across devices; physical local reservations cannot.
  if p_operation in ('edit','kitchen')
     and p_order.created_by_device_id is distinct from (p_context->>'device_id')::uuid then
    raise exception 'ADMIN_REMOTE_EDIT_BLOCKED_PENDING_INVENTORY_CONTRACT' using errcode = 'P0001';
  end if;
  if p_operation = 'cancel' and v_actor <> 'admin'
     and p_order.created_by_device_id is distinct from (p_context->>'device_id')::uuid then
    raise exception 'RESTAURANT_ORDER_REMOTE_CANCEL_BLOCKED' using errcode = 'P0001';
  end if;
end;
$function$;
revoke all on function private.assert_restaurant_table_actor_v1(jsonb,public.pos_restaurant_orders,text) from public,anon,authenticated;

create or replace function private.record_restaurant_intervention_v1(
  p_context jsonb, p_order public.pos_restaurant_orders, p_operation text,
  p_expected_version timestamptz, p_reason text, p_idempotency_key text, p_result jsonb
) returns void language plpgsql security definer set search_path = '' as $function$
begin
  insert into private.restaurant_table_interventions
    (license_id,order_id,actor_type,actor_id,actor_session_id,device_id,operation,expected_version,reason,idempotency_key,result)
  values (p_order.license_id,p_order.id,p_context->>'actor_type',(p_context->>'actor_id')::uuid,
    (p_context->>'actor_session_id')::uuid,(p_context->>'device_id')::uuid,p_operation,p_expected_version,
    nullif(btrim(p_reason),''),p_idempotency_key,p_result);
end;
$function$;
revoke all on function private.record_restaurant_intervention_v1(jsonb,public.pos_restaurant_orders,text,timestamptz,text,text,jsonb) from public,anon,authenticated;

create or replace function public.pos_restaurant_table_capabilities_v1(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text, p_local_order_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_context jsonb;
  v_order public.pos_restaurant_orders;
  v_owner boolean;
  v_admin boolean;
  v_active boolean;
  v_edit boolean;
  v_pos boolean;
  v_refunds boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_orders_food_service((v_context->>'license_id')::uuid);
  select * into v_order from public.pos_restaurant_orders
    where license_id=(v_context->>'license_id')::uuid and local_order_id=p_local_order_id
    order by updated_at desc, id limit 1;
  perform private.assert_restaurant_table_actor_v1(v_context,v_order,'view');
  v_admin := v_context->>'actor_type' = 'admin';
  v_owner := v_context->>'actor_type' = 'staff' and v_order.created_by_staff_user_id=(v_context->>'actor_id')::uuid;
  v_active := v_order.deleted_at is null and v_order.archived_at is null and v_order.checkout_closed_at is null
    and v_order.paid_at is null and v_order.paid_sale_id is null and v_order.cancelled_at is null
    and coalesce(v_order.payment_status,'unpaid')='unpaid'
    and v_order.status in ('pending','preparing','ready','delivered')
    and v_order.fulfillment_status in ('pending','preparing','ready','delivered');
  v_pos := v_admin or coalesce((v_context->'actor_permissions'->>'pos')::boolean,false);
  v_refunds := v_admin or coalesce((v_context->'actor_permissions'->>'refunds')::boolean,false);
  v_edit := v_active and (v_admin or coalesce(v_owner,false))
    and v_order.created_by_device_id=(v_context->>'device_id')::uuid;
  return jsonb_build_object('success',true,'contractVersion',1,'cloudOrderId',v_order.id,
    'localOrderId',v_order.local_order_id,'parentVersion',v_order.updated_at,
    'capabilities',jsonb_build_object(
      'canViewTable',true,'canEditTable',v_pos and coalesce(v_edit,false),
      'canSendToKitchen',v_pos and coalesce(v_edit,false),
      'canCheckoutTable',v_pos and v_active and (v_admin or coalesce(v_owner,false)),
      'canSplitTable',v_pos and v_active and (v_admin or coalesce(v_owner,false)),
      'canCancelTable',v_refunds and v_active and (v_admin or (coalesce(v_owner,false)
        and v_order.created_by_device_id=(v_context->>'device_id')::uuid)),
      'canAdministerTable',v_admin and v_active),
    'remoteEdit','BLOCKED_PENDING_INVENTORY_CONTRACT');
end;
$function$;
revoke all on function public.pos_restaurant_table_capabilities_v1(text,text,text,text,text) from public;
grant execute on function public.pos_restaurant_table_capabilities_v1(text,text,text,text,text) to anon,authenticated;

-- Private, transaction-bound permit: browser payloads cannot grant this marker.
create table private.restaurant_settlement_permits (
  transaction_id xid8 not null,
  license_id uuid not null,
  order_id text not null,
  actor_session_id uuid not null,
  primary key (transaction_id,license_id,order_id)
);
alter table private.restaurant_settlement_permits enable row level security;
revoke all on private.restaurant_settlement_permits from public,anon,authenticated;
create or replace function private.assert_restaurant_settlement_permit_v1(p_context jsonb,p_local_order_id text)
returns void language plpgsql security definer set search_path='' as $function$
declare v_order public.pos_restaurant_orders;
begin
  select * into v_order from public.pos_restaurant_orders
    where license_id=(p_context->>'license_id')::uuid and local_order_id=p_local_order_id
    order by updated_at desc,id limit 1;
  if v_order.id is null then return; end if;
  perform private.assert_restaurant_table_actor_v1(p_context,v_order,'checkout');
  if not exists (select 1 from private.restaurant_settlement_permits
    where transaction_id=pg_current_xact_id() and license_id=v_order.license_id and order_id=v_order.id
      and actor_session_id=(p_context->>'actor_session_id')::uuid) then
    raise exception 'RESTAURANT_SETTLEMENT_CONTRACT_REQUIRED' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.assert_restaurant_settlement_permit_v1(jsonb,text) from public,anon,authenticated;
CREATE OR REPLACE FUNCTION private.pos_restaurant_order_to_jsonb(p_row pos_restaurant_orders, p_station_code text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'id', p_row.id,
    'localOrderId', p_row.local_order_id,
    'createdByStaffUserId', p_row.created_by_staff_user_id,
    'createdByDeviceId', p_row.created_by_device_id,
    'licenseId', p_row.license_id,
    'saleId', p_row.sale_id,
    'tableLabel', p_row.table_label,
    'customerId', p_row.customer_id,
    'customerName', p_row.customer_name,
    'status', p_row.status,
    'fulfillmentStatus', p_row.fulfillment_status,
    'paymentStatus', coalesce(p_row.payment_status, 'unpaid'),
    'paidAt', p_row.paid_at,
    'paidSaleId', p_row.paid_sale_id,
    'paidSaleFolio', p_row.paid_sale_folio,
    'paidTotal', p_row.paid_total,
    'checkoutClosedAt', p_row.checkout_closed_at,
    'checkoutCloseMetadata', coalesce(p_row.checkout_close_metadata, '{}'::jsonb),
    'archivedAt', p_row.archived_at,
    'archiveReason', p_row.archive_reason,
    'archiveMetadata', coalesce(p_row.archive_metadata, '{}'::jsonb),
    'archivedByDeviceId', p_row.archived_by_device_id,
    'archivedByStaffUserId', p_row.archived_by_staff_user_id,
    'source', p_row.source,
    'notes', p_row.notes,
    'subtotal', p_row.subtotal,
    'total', p_row.total,
    'currency', p_row.currency,
    'createdAt', p_row.created_at,
    'updatedAt', p_row.updated_at,
    'sentToKitchenAt', p_row.sent_to_kitchen_at,
    'readyAt', p_row.ready_at,
    'deliveredAt', p_row.delivered_at,
    'cancelledAt', p_row.cancelled_at,
    'serverVersion', p_row.server_version,
    'metadata', coalesce(p_row.metadata, '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(private.pos_restaurant_order_item_to_jsonb(i) order by i.sort_order asc, i.created_at asc)
      from public.pos_restaurant_order_items i
      where i.license_id = p_row.license_id
        and i.restaurant_order_id = p_row.id
        and i.deleted_at is null
        and (nullif(btrim(coalesce(p_station_code, '')), '') is null or i.station_code = lower(btrim(p_station_code)))
    ), '[]'::jsonb)
  )
$function$
;
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
      v_restaurant_order_id := coalesce(
        nullif(btrim(v_canonical->'sale'->>'local_sale_id'), ''),
        nullif(btrim(v_canonical->'sale'->>'id'), '')
      );
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
        perform private.assert_restaurant_table_actor_v1(v_context, v_restaurant_order,
          case when p_operation_type='sale.split' then 'split' else 'checkout' end);
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
    if v_restaurant_version is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED' using errcode='P0001'; end if;
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

  if v_is_restaurant_settlement then
    insert into private.restaurant_settlement_permits values
      (pg_current_xact_id(),v_license_id,v_restaurant_order.id,(v_context->>'actor_session_id')::uuid)
      on conflict do nothing;
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

  if v_is_restaurant_settlement then
    perform private.record_restaurant_intervention_v1(v_context,v_restaurant_order,p_operation_type,
      v_restaurant_order.updated_at,null,p_idempotency_key,
      jsonb_build_object('success',true,'source','atomic_settlement'));
    delete from private.restaurant_settlement_permits where transaction_id=pg_current_xact_id()
      and license_id=v_license_id and order_id=v_restaurant_order.id;
  end if;
  v_response := private.public_financial_response_v1(
    p_operation_type, v_response, p_idempotency_key, v_internal_idempotency_key
  );
  perform private.complete_financial_operation_v1(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.execute_split_sale_financial_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_split jsonb, p_internal_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_parent_order_id text;
  v_split_group_id text;
  v_cash_session_id text;
  v_parent_order_version text;
  v_parent_order_version_at timestamptz;
  v_split_intent text := coalesce(
    private.financial_text_v1(private.financial_first_nonblank_scalar_v1(
      coalesce(p_split, '{}'::jsonb), array['split_intent','splitIntent']
    )),
    'by_items'
  );
  v_split_payers jsonb := coalesce(p_split->'split_payers', p_split->'splitPayers', '[]'::jsonb);
  v_split_payer jsonb;
  v_payment jsonb;
  v_split_payer_count integer := 0;
  v_split_payer_index integer := 0;
  v_equal_base_cents integer := 0;
  v_equal_remainder_cents integer := 0;
  v_credit_payer_count integer := 0;
  v_split_payer_total numeric := 0;
  v_payer_id text;
  v_payer_method text;
  v_payer_customer_id text;
  v_credit_customer_id text;
  v_customer_id_snake text;
  v_customer_id_camel text;
  v_child_customer_id text;
  v_child_customer_alias_id text;
  v_sale_customer_id text;
  v_sale_customer_alias_id text;
  v_payer_initial_method text;
  v_payer_amount numeric;
  v_payer_initial_amount numeric;
  v_expected_payment_method text;
  v_expected_payment_amount numeric;
  v_payment_payer_id text;
  v_payment_method_normalized text;
  v_payment_amount numeric;
  v_payer_payment_total numeric;
  v_payer_ids text[] := array[]::text[];
  v_child_count integer;
  v_child_index integer := 0;
  v_child jsonb;
  v_child_sale jsonb;
  v_child_response jsonb;
  v_child_sale_id text;
  v_child_label text;
  v_child_key text;
  v_payment_method text;
  v_is_credit boolean;
  v_inventory boolean;
  v_sales jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_children jsonb := '[]'::jsonb;
  v_tickets jsonb := '[]'::jsonb;
  v_total numeric := 0;
  v_payment_summary jsonb;
  v_close_response jsonb;
  v_order public.pos_restaurant_orders;
  v_labels text[] := array[]::text[];
  v_sale_ids text[] := array[]::text[];
  v_latest_change_seq bigint;
  v_primary_sale_id text;
  v_primary_sale_folio text;
begin
  if jsonb_typeof(coalesce(p_split, '{}'::jsonb)) <> 'object' then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_parent_order_id := nullif(btrim(coalesce(p_split->>'parent_order_id', p_split->>'parentOrderId', '')), '');
  v_split_group_id := nullif(btrim(coalesce(p_split->>'split_group_id', p_split->>'splitGroupId', '')), '');
  v_cash_session_id := nullif(btrim(coalesce(p_split->>'cash_session_id', p_split->>'cashSessionId', '')), '');
  v_parent_order_version := nullif(btrim(coalesce(p_split->>'parent_order_version', p_split->>'parentOrderVersion', '')), '');
  if v_split_intent in ('equal_payment', 'custom_payment')
     and (v_parent_order_version is null
       or v_parent_order_version !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{1,6})?([zZ]|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_parent_order_version is not null then
    begin
      v_parent_order_version_at := v_parent_order_version::timestamptz;
    exception
      when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
        raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
    end;
  end if;
  if v_parent_order_id is null then
    raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001';
  end if;
  if v_split_group_id is null then
    raise exception 'SPLIT_GROUP_ID_REQUIRED' using errcode = 'P0001';
  end if;
  if v_cash_session_id is null then
    raise exception 'FINANCIAL_CASH_SESSION_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  -- Shared settlement lock is also acquired by the normal cashier dispatcher.
  v_order := private.lock_restaurant_order_settlement_v1(v_license_id, v_parent_order_id);
  perform private.assert_restaurant_table_actor_v1(v_context,v_order,'split');
  perform private.assert_restaurant_settlement_permit_v1(v_context,v_parent_order_id);

  if v_order.id is null then
    raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.deleted_at is not null then
    raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;

  perform private.assert_cash_session_station(
    v_license_id,
    v_device_id,
    v_cash_session_id
  );

  if v_order.id is null then
    raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_parent_order_version is not null
     and v_order.updated_at is distinct from v_parent_order_version_at then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' or v_order.cancelled_at is not null then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if v_order.archived_at is not null or v_order.checkout_closed_at is not null then
    raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if lower(coalesce(v_order.payment_status, 'unpaid')) = 'paid' then
    raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_split->'children', '[]'::jsonb)) <> 'array' then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  v_child_count := jsonb_array_length(p_split->'children');
  if v_split_intent not in ('by_items', 'equal_payment', 'custom_payment') then
    raise exception 'FINANCIAL_SPLIT_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if (v_split_intent = 'by_items' and (v_child_count < 2 or v_child_count > 8))
     or (v_split_intent in ('equal_payment', 'custom_payment') and v_child_count <> 1) then
    raise exception 'FINANCIAL_SPLIT_CHILD_COUNT_INVALID' using errcode = 'P0001';
  end if;

  if v_split_intent in ('equal_payment', 'custom_payment') then
    if jsonb_typeof(v_split_payers) <> 'array' then
      raise exception 'FINANCIAL_SPLIT_PAYER_CONTRACT_INVALID' using errcode = 'P0001';
    end if;
    v_split_payer_count := jsonb_array_length(v_split_payers);
    if v_split_payer_count < 2 or v_split_payer_count > 8 then
      raise exception 'FINANCIAL_SPLIT_PAYER_COUNT_INVALID' using errcode = 'P0001';
    end if;
    if v_split_intent = 'equal_payment' then
      v_equal_base_cents := floor(round(coalesce(v_order.total, 0) * 100)::numeric / v_split_payer_count)::integer;
      v_equal_remainder_cents := mod(round(coalesce(v_order.total, 0) * 100)::integer, v_split_payer_count);
    end if;

    for v_split_payer in select value from jsonb_array_elements(v_split_payers)
    loop
      if jsonb_typeof(v_split_payer) <> 'object' then
        raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
      end if;
      v_payer_id := nullif(btrim(coalesce(v_split_payer->>'payer_id', v_split_payer->>'payerId', v_split_payer->>'label', v_split_payer->>'id', '')), '');
      if v_payer_id is null or v_payer_id !~ '^T[1-8]$' or v_payer_id = any(v_payer_ids) then
        raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
      end if;
      v_payer_ids := array_append(v_payer_ids, v_payer_id);

      v_payer_amount := private.pos_sale_jsonb_numeric(v_split_payer, array['amount','contribution_amount','contributionAmount'], null);
      v_payer_method := private.normalize_pos_sale_payment_method(coalesce(v_split_payer->>'payment_method', v_split_payer->>'paymentMethod', v_split_payer->>'method'));
      if v_payer_amount is null or v_payer_amount <= 0 or v_payer_amount <> round(v_payer_amount, 2)
         or v_payer_method is null or v_payer_method not in ('cash', 'card', 'transfer', 'credit') then
        raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
      end if;
      v_split_payer_index := v_split_payer_index + 1;
      v_split_payer_total := v_split_payer_total + v_payer_amount;
      if v_split_intent = 'equal_payment'
         and v_payer_amount <> (v_equal_base_cents + case when v_split_payer_index <= v_equal_remainder_cents then 1 else 0 end)::numeric / 100 then
        raise exception 'FINANCIAL_SPLIT_EQUAL_DISTRIBUTION_INVALID' using errcode = 'P0001';
      end if;

      if v_payer_method = 'credit' then
        v_credit_payer_count := v_credit_payer_count + 1;
        v_payer_initial_amount := coalesce(private.pos_sale_jsonb_numeric(v_split_payer, array['initial_amount_paid','initialAmountPaid'], null), 0);
        v_payer_initial_method := private.normalize_pos_sale_payment_method(coalesce(v_split_payer->>'initial_payment_method', v_split_payer->>'initialPaymentMethod', 'cash'));
        v_customer_id_snake := nullif(btrim(v_split_payer->>'customer_id'), '');
        v_customer_id_camel := nullif(btrim(v_split_payer->>'customerId'), '');
        if v_customer_id_snake is not null
           and v_customer_id_camel is not null
           and v_customer_id_snake <> v_customer_id_camel then
          raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
        end if;
        v_payer_customer_id := coalesce(v_customer_id_snake, v_customer_id_camel);
        if v_credit_payer_count > 1
           or v_payer_customer_id is null
           or v_payer_initial_amount < 0
           or v_payer_initial_amount >= v_payer_amount
           or v_payer_initial_amount <> round(v_payer_initial_amount, 2)
           or v_payer_initial_method not in ('cash', 'card', 'transfer') then
          raise exception 'FINANCIAL_SPLIT_CREDIT_PAYER_INVALID' using errcode = 'P0001';
        end if;
        v_credit_customer_id := v_payer_customer_id;
        v_expected_payment_amount := v_payer_initial_amount;
        v_expected_payment_method := v_payer_initial_method;
      else
        if nullif(btrim(coalesce(v_split_payer->>'customer_id', v_split_payer->>'customerId', '')), '') is not null then
          raise exception 'FINANCIAL_SPLIT_PAYER_INVALID' using errcode = 'P0001';
        end if;
        v_expected_payment_amount := v_payer_amount;
        v_expected_payment_method := v_payer_method;
      end if;

      v_payer_payment_total := 0;
      for v_payment in
        select value from jsonb_array_elements(coalesce((p_split->'children'->0)->'payments', '[]'::jsonb))
      loop
        v_payment_payer_id := nullif(btrim(coalesce(
          v_payment->>'split_payer_id', v_payment->>'splitPayerId',
          v_payment->'metadata'->>'split_payer_id', v_payment->'metadata'->>'splitPayerId', ''
        )), '');
        if v_payment_payer_id = v_payer_id then
          v_payment_method_normalized := private.normalize_pos_sale_payment_method(coalesce(v_payment->>'method', v_payment->>'payment_method', v_payment->>'paymentMethod'));
          v_payment_amount := private.pos_sale_jsonb_numeric(v_payment, array['amount','total'], null);
          if jsonb_typeof(v_payment) <> 'object'
             or v_payment_method_normalized is distinct from v_expected_payment_method
             or v_payment_amount is null or v_payment_amount <= 0 or v_payment_amount <> round(v_payment_amount, 2) then
            raise exception 'FINANCIAL_SPLIT_PAYER_PAYMENT_INVALID' using errcode = 'P0001';
          end if;
          v_payer_payment_total := v_payer_payment_total + v_payment_amount;
        end if;
      end loop;
      if abs(v_payer_payment_total - v_expected_payment_amount) > 0.005 then
        raise exception 'FINANCIAL_SPLIT_PAYER_PAYMENT_MISMATCH' using errcode = 'P0001';
      end if;
    end loop;

    if v_credit_payer_count = 1 then
      v_child := coalesce(p_split->'children'->0, '{}'::jsonb);
      v_child_sale := coalesce(v_child->'sale', '{}'::jsonb);
      v_child_customer_id := nullif(btrim(v_child->>'customer_id'), '');
      v_child_customer_alias_id := nullif(btrim(v_child->>'customerId'), '');
      if v_child_customer_id is not null
         and v_child_customer_alias_id is not null
         and v_child_customer_id <> v_child_customer_alias_id then
        raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
      end if;
      v_child_customer_id := coalesce(v_child_customer_id, v_child_customer_alias_id);

      v_sale_customer_id := nullif(btrim(v_child_sale->>'customer_id'), '');
      v_sale_customer_alias_id := nullif(btrim(v_child_sale->>'customerId'), '');
      if v_sale_customer_id is not null
         and v_sale_customer_alias_id is not null
         and v_sale_customer_id <> v_sale_customer_alias_id then
        raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
      end if;
      v_sale_customer_id := coalesce(v_sale_customer_id, v_sale_customer_alias_id);

      if (v_child_customer_id is not null and v_child_customer_id <> v_credit_customer_id)
         or (v_sale_customer_id is not null and v_sale_customer_id <> v_credit_customer_id) then
        raise exception 'FINANCIAL_SPLIT_CREDIT_CUSTOMER_MISMATCH' using errcode = 'P0001';
      end if;
    end if;

    if abs(v_split_payer_total - coalesce(v_order.total, 0)) > 0.005 then
      raise exception 'FINANCIAL_SPLIT_PAYER_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;

    for v_payment in
      select value from jsonb_array_elements(coalesce((p_split->'children'->0)->'payments', '[]'::jsonb))
    loop
      v_payment_payer_id := nullif(btrim(coalesce(
        v_payment->>'split_payer_id', v_payment->>'splitPayerId',
        v_payment->'metadata'->>'split_payer_id', v_payment->'metadata'->>'splitPayerId', ''
      )), '');
      if v_payment_payer_id is null or not (v_payment_payer_id = any(v_payer_ids)) then
        raise exception 'FINANCIAL_SPLIT_PAYER_PAYMENT_INVALID' using errcode = 'P0001';
      end if;
    end loop;
  end if;

  for v_child in
    select value
      from jsonb_array_elements(p_split->'children')
  loop
    v_child_index := v_child_index + 1;
    v_child_key := p_internal_idempotency_key || ':child:' || v_child_index::text;
    if jsonb_typeof(v_child) <> 'object' then
      raise exception 'FINANCIAL_SPLIT_CHILD_INVALID' using errcode = 'P0001';
    end if;

    v_child_label := nullif(btrim(coalesce(v_child->>'label', '')), '');
    v_child_sale := coalesce(v_child->'sale', '{}'::jsonb);
    if v_child_label is null or jsonb_typeof(v_child_sale) <> 'object' then
      raise exception 'FINANCIAL_SPLIT_CHILD_INVALID' using errcode = 'P0001';
    end if;
    if v_child_label = any(v_labels) then
      raise exception 'FINANCIAL_SPLIT_LABEL_DUPLICATE' using errcode = 'P0001';
    end if;
    v_labels := array_append(v_labels, v_child_label);

    v_child_sale_id := nullif(btrim(coalesce(v_child_sale->>'id', v_child_sale->>'cloud_sale_id', v_child_sale->>'cloudSaleId', '')), '');
    if v_child_sale_id is null then
      raise exception 'FINANCIAL_SPLIT_SALE_ID_REQUIRED' using errcode = 'P0001';
    end if;
    if v_child_sale_id = any(v_sale_ids) then
      raise exception 'FINANCIAL_SPLIT_SALE_ID_DUPLICATE' using errcode = 'P0001';
    end if;
    v_sale_ids := array_append(v_sale_ids, v_child_sale_id);

    v_payment_method := lower(coalesce(
      nullif(btrim(coalesce(v_child_sale->>'payment_method', v_child_sale->>'paymentMethod', '')), ''),
      'cash'
    ));
    v_is_credit := private.normalize_pos_sale_payment_method(v_payment_method) = 'credit'
      or private.financial_payment_method_v1('sale.credit', v_payment_method) = 'mixed_credit';
    if v_split_intent in ('equal_payment', 'custom_payment')
       and (v_credit_payer_count = 1) is distinct from v_is_credit then
      raise exception 'FINANCIAL_SPLIT_CREDIT_PAYER_INVALID' using errcode = 'P0001';
    end if;
    if v_split_intent in ('equal_payment', 'custom_payment') and v_credit_payer_count = 1 then
      v_child_sale := jsonb_set(v_child_sale, '{customer_id}', to_jsonb(v_credit_customer_id), true);
    end if;
    v_inventory := coalesce((v_child_sale->'metadata'->>'cloudInventoryEffects')::boolean, false);

    if v_is_credit then
      perform private.assert_cloud_sales_credit_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_credit_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        case
          when v_split_intent in ('equal_payment', 'custom_payment') and v_credit_payer_count = 1
            then v_credit_customer_id
          else coalesce(
            nullif(btrim(v_child->>'customer_id'), ''),
            nullif(btrim(v_child_sale->>'customer_id'), ''),
            nullif(btrim(v_child_sale->>'customerId'), '')
          )
        end,
        v_child_key
      );
    elsif v_inventory then
      perform private.assert_cloud_sales_inventory_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_cashier_inventory_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        v_child_key
      );
    else
      perform private.assert_cloud_sales_cashier_enabled(v_context);
      v_child_response := public.pos_create_cloud_sale_cashier_unlimited(
        p_license_key,
        p_device_fingerprint,
        p_security_token,
        p_staff_session_token,
        v_child_sale,
        coalesce(v_child->'items', '[]'::jsonb),
        coalesce(v_child->'payments', '[]'::jsonb),
        v_cash_session_id,
        v_child_key
      );
    end if;

    if coalesce((v_child_response->>'success')::boolean, false) is not true then
      raise exception 'SALE_SPLIT_CHILD_NOT_CONFIRMED:%', coalesce(v_child_response->>'code', 'UNKNOWN') using errcode = 'P0001';
    end if;

    if v_child_response->'sale' is null
       or v_child_response->'sale'->>'id' is null then
      raise exception 'SALE_SPLIT_CHILD_RESPONSE_INVALID' using errcode = 'P0001';
    end if;

    v_sales := v_sales || jsonb_build_array(v_child_response->'sale');
    v_items := v_items || coalesce(v_child_response->'items', '[]'::jsonb);
    v_payments := v_payments || coalesce(v_child_response->'payments', '[]'::jsonb);
    v_children := v_children || jsonb_build_array(jsonb_build_object(
      'label', v_child_label,
      'sale', v_child_response->'sale',
      'items', coalesce(v_child_response->'items', '[]'::jsonb),
      'payments', coalesce(v_child_response->'payments', '[]'::jsonb),
      'cash_session', v_child_response->'cash_session',
      'cash_movement', v_child_response->'cash_movement',
      'customer', v_child_response->'customer',
      'ledger_charge', v_child_response->'ledger_charge',
      'ledger_payment', v_child_response->'ledger_payment',
      'inventory_movements', coalesce(v_child_response->'inventory_movements', '[]'::jsonb),
      'event', v_child_response->'event'
    ));

    v_total := v_total + coalesce((v_child_response->'sale'->>'total')::numeric, 0);
    v_tickets := v_tickets || jsonb_build_array(jsonb_build_object(
      'label', v_child_label,
      'saleId', v_child_response->'sale'->>'id',
      'folio', coalesce(v_child_response->'sale'->>'pos_folio', v_child_response->'sale'->>'folio'),
      'paymentMethod', v_child_response->'sale'->>'payment_method',
      'amountPaid', v_child_response->'sale'->>'amount_paid',
      'saldoPendiente', v_child_response->'sale'->>'balance_due',
      'customerId', v_child_response->'sale'->>'customer_id',
      'total', v_child_response->'sale'->>'total'
    ));
  end loop;

  if v_child_index <> v_child_count then
    raise exception 'FINANCIAL_SPLIT_CHILD_COUNT_INVALID' using errcode = 'P0001';
  end if;
  if abs(round(v_total, 2) - round(coalesce(v_order.total, 0), 2)) > 0.005 then
    raise exception 'RESTAURANT_SPLIT_TOTAL_MISMATCH' using errcode = 'P0001';
  end if;

  select value->>'id', coalesce(value->>'pos_folio', value->>'folio')
    into v_primary_sale_id, v_primary_sale_folio
    from jsonb_array_elements(v_sales)
   limit 1;

  v_payment_summary := jsonb_build_object(
    'source', 'split_bill',
    'splitGroupId', v_split_group_id,
    'parentOrderId', v_parent_order_id,
    'childSaleIds', coalesce((select jsonb_agg(value->>'id') from jsonb_array_elements(v_sales)), '[]'::jsonb),
    'tickets', v_tickets,
    'splitIntent', v_split_intent,
    'splitPayers', case when v_split_intent in ('equal_payment', 'custom_payment') then v_split_payers else '[]'::jsonb end,
    'total', round(v_total, 2),
    'sourceMode', 'cloud_committed'
  );

  v_close_response := public.pos_close_restaurant_order_after_checkout_unlimited(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_parent_order_id,
    coalesce(v_primary_sale_id, 'SPLIT-' || v_split_group_id),
    coalesce(v_primary_sale_folio, 'SPLIT-' || v_split_group_id),
    round(v_total, 2),
    v_payment_summary,
    p_internal_idempotency_key || ':restaurant-close'
  );

  if coalesce((v_close_response->>'success')::boolean, false) is not true then
    raise exception 'RESTAURANT_ORDER_CLOSE_NOT_CONFIRMED:%', coalesce(v_close_response->>'code', 'UNKNOWN') using errcode = 'P0001';
  end if;

  select coalesce(max(change_seq), 0)
    into v_latest_change_seq
    from public.pos_sync_events
   where license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'mode', 'cloud_split',
    'parent_order_id', v_parent_order_id,
    'split_group_id', v_split_group_id,
    'sales', v_sales,
    'items', v_items,
    'payments', v_payments,
    'children', v_children,
    'restaurant_order_close', v_close_response,
    'total', round(v_total, 2),
    'change_seq', coalesce((v_close_response->>'changeSeq')::bigint, 0),
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', p_internal_idempotency_key,
    'restaurant_settlement', jsonb_build_object(
      'success', true,
      'parent_order_id', v_parent_order_id,
      'payment_status', 'paid',
      'paid_sale_id', v_primary_sale_id,
      'paid_sale_folio', v_primary_sale_folio,
      'total', round(v_total, 2),
      'status', v_close_response #>> '{order,status}',
      'fulfillment_status', v_close_response #>> '{order,fulfillment_status}'
    )
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pos_cancel_restaurant_order_from_pos_v1(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_expected_parent_version text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
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
  v_staff_id uuid;
  v_order public.pos_restaurant_orders;
  v_version timestamptz;
  v_hash text;
  v_idem public.pos_idempotency_keys;
  v_response jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'refunds');
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_staff_id := nullif(v_context->>'staff_user_id', '')::uuid;
  perform private.assert_restaurant_orders_food_service(v_license_id);
  if v_device_id is null then raise exception 'DEVICE_AUTH_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_local_order_id), '') is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_expected_parent_version), '') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'RESTAURANT_CANCEL_REASON_REQUIRED' using errcode = 'P0001'; end if;
  if nullif(btrim(p_idempotency_key), '') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001'; end if;
  begin
    v_version := p_expected_parent_version::timestamptz;
  exception when invalid_text_representation or datetime_field_overflow or invalid_datetime_format then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end;

  -- Takes pg_advisory_xact_lock(license, restaurant_split:localOrderId),
  -- then SELECT FOR UPDATE, before the idempotency ledger or any effect.
  v_order := private.lock_restaurant_order_settlement_v1(v_license_id, p_local_order_id);
  if v_order.id is null then raise exception 'RESTAURANT_ORDER_NOT_FOUND' using errcode = 'P0001'; end if;
  perform private.assert_restaurant_table_actor_v1(v_context,v_order,'cancel');
  v_hash := md5(jsonb_build_object('operation', 'restaurant_order.cancel_from_pos',
    'localOrderId', p_local_order_id, 'expectedVersion', v_version,
    'reason', btrim(p_reason), 'deviceId', v_device_id, 'staffId', v_staff_id)::text);

  select * into v_idem from public.pos_idempotency_keys
    where license_id = v_license_id and idempotency_key = p_idempotency_key for update;
  if found then
    if v_idem.operation_type is distinct from 'restaurant_order.cancel_from_pos'
       or v_idem.entity_id is distinct from p_local_order_id or v_idem.request_hash is distinct from v_hash then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    raise exception 'IDEMPOTENCY_PROCESSING' using errcode = 'P0001';
  end if;

  if lower(coalesce(v_order.payment_status, 'unpaid')) = 'paid'
      or v_order.paid_at is not null or v_order.paid_sale_id is not null then
    raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode = 'P0001';
  end if;
  if v_order.deleted_at is not null or v_order.archived_at is not null or v_order.checkout_closed_at is not null then
    raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_order.status = 'cancelled' and v_order.fulfillment_status = 'cancelled' and v_order.cancelled_at is not null then
    raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode = 'P0001';
  end if;
  if coalesce(v_order.payment_status, 'unpaid') <> 'unpaid'
      or v_order.cancelled_at is not null
      or v_order.status not in ('pending','preparing','ready','delivered')
      or v_order.fulfillment_status not in ('pending','preparing','ready','delivered') then
    raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode = 'P0001';
  end if;
  if v_order.updated_at is distinct from v_version then
    raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode = 'P0001';
  end if;
  if not private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key,
      'restaurant_order.cancel_from_pos', 'restaurant_order', p_local_order_id, v_hash) then
    raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
  end if;

  update public.pos_restaurant_orders set status = 'cancelled', fulfillment_status = 'cancelled',
    cancelled_at = now(), updated_at = now(), server_version = server_version + 1,
    updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_id,
    last_idempotency_key = p_idempotency_key,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancelledFromPos', true, 'cancelReason', btrim(p_reason), 'cancelContractVersion', 1)
    where license_id = v_license_id and id = v_order.id returning * into v_order;
  update public.pos_restaurant_order_items set status = 'cancelled', cancelled_at = now(),
    updated_at = now(), server_version = server_version + 1,
    updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_id
    where license_id = v_license_id and restaurant_order_id = v_order.id
      and deleted_at is null and status not in ('cancelled','delivered');
  perform private.record_pos_sync_event(v_license_id, 'restaurant_order', v_order.id, 'cancel',
    v_device_id, v_staff_id, p_idempotency_key,
    jsonb_build_object('source', 'pos_cancel_restaurant_order_from_pos_v1',
      'localOrderId', p_local_order_id, 'status', 'cancelled'), v_order.server_version);
  v_response := jsonb_build_object('success', true, 'localOrderId', p_local_order_id,
    'status', 'cancelled', 'serverVersion', v_order.server_version,
    'updatedAt', v_order.updated_at, 'cancelledAt', v_order.cancelled_at);
  perform private.record_restaurant_intervention_v1(v_context,v_order,'cancel',v_version,p_reason,p_idempotency_key,v_response);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pos_upsert_restaurant_order_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_order jsonb DEFAULT '{}'::jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_local_order_id text;
  v_sale_id text;
  v_order_id text;
  v_status text;
  v_fulfillment_status text;
  v_metadata jsonb;
  v_existing_order public.pos_restaurant_orders;
  v_saved_order public.pos_restaurant_orders;
  v_item_record record;
  v_item jsonb;
  v_item_id text;
  v_local_line_id text;
  v_station jsonb;
  v_item_ids text[] := array[]::text[];
  v_item_metadata jsonb;
  v_selected_modifiers jsonb;
  v_item_status text;
  v_saved_item public.pos_restaurant_order_items;
  v_deleted_item public.pos_restaurant_order_items;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request_hash text;
  v_expected_version timestamptz;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);
  perform private.ensure_default_preparation_station(v_license_id, v_device_id, v_staff_user_id);

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_ITEMS_INVALID', 'message', 'Los items de la comanda no son validos.');
  end if;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    return jsonb_build_object('success', false, 'code', 'RESTAURANT_ORDER_EMPTY', 'message', 'La comanda no tiene productos.');
  end if;

  v_local_order_id := nullif(btrim(coalesce(p_order->>'localOrderId', p_order->>'local_order_id', '')), '');
  v_sale_id := nullif(btrim(coalesce(p_order->>'saleId', p_order->>'sale_id', v_local_order_id, '')), '');

  if v_local_order_id is null then
    return jsonb_build_object('success', false, 'code', 'LOCAL_ORDER_ID_REQUIRED', 'message', 'No se encontro la orden local.');
  end if;

  v_existing_order := private.lock_restaurant_order_settlement_v1(v_license_id,v_local_order_id);
  if v_existing_order.id is not null then
    perform private.assert_restaurant_table_actor_v1(v_context,v_existing_order,'edit');
    if v_existing_order.local_order_id is distinct from v_local_order_id
      or v_existing_order.sale_id is distinct from v_sale_id then
      raise exception 'RESTAURANT_TABLE_SCOPE_DENIED' using errcode='P0001';
    end if;
  elsif nullif(p_order->>'id','') is not null then
    raise exception 'RESTAURANT_TABLE_ID_SERVER_ASSIGNED' using errcode='P0001';
  end if;

  v_order_id := coalesce(v_existing_order.id, nullif(btrim(coalesce(p_order->>'id', '')), ''), 'rest_order_' || replace(gen_random_uuid()::text, '-', ''));

  v_request_hash := md5(coalesce(p_order::text, '') || '|' || coalesce(p_items::text, '') || '|' || (v_context->>'actor_key'));
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'restaurant_order.upsert', 'restaurant_order', v_order_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.request_hash is distinct from v_request_hash or v_idem.operation_type is distinct from 'restaurant_order.upsert'
      or v_idem.entity_id is distinct from v_order_id then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La comanda ya se esta procesando.', 'idempotency_key', p_idempotency_key);
  end if;

  if v_existing_order.id is not null then
    if v_existing_order.paid_at is not null or v_existing_order.paid_sale_id is not null
      or coalesce(v_existing_order.payment_status,'unpaid') <> 'unpaid'
      or v_existing_order.deleted_at is not null or v_existing_order.archived_at is not null
      or v_existing_order.checkout_closed_at is not null or v_existing_order.cancelled_at is not null
      or v_existing_order.status not in ('pending','preparing','ready','delivered') then
      raise exception 'RESTAURANT_ORDER_NOT_ACTIVE' using errcode='P0001';
    end if;
    if nullif(p_order->>'expectedParentVersion','') is null then
      raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED' using errcode='P0001';
    end if;
    begin v_expected_version := (p_order->>'expectedParentVersion')::timestamptz;
    exception when others then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode='P0001'; end;
    if v_existing_order.updated_at is distinct from v_expected_version then
      raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT' using errcode='P0001';
    end if;
    if v_context->>'actor_type'='admin' and v_existing_order.created_by_staff_user_id is not null
      and nullif(btrim(p_order->>'interventionReason'),'') is null then
      raise exception 'RESTAURANT_INTERVENTION_REASON_REQUIRED' using errcode='P0001';
    end if;
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) item
    join public.pos_restaurant_order_items i on i.id=item->>'id'
    where i.license_id is distinct from v_license_id or i.restaurant_order_id is distinct from v_order_id) then
    raise exception 'RESTAURANT_TABLE_SCOPE_DENIED' using errcode='P0001';
  end if;

  v_status := private.normalize_restaurant_order_status(coalesce(p_order->>'status', p_order->>'fulfillmentStatus', p_order->>'fulfillment_status', v_existing_order.status, 'pending'));
  v_fulfillment_status := private.normalize_restaurant_order_status(coalesce(p_order->>'fulfillmentStatus', p_order->>'fulfillment_status', v_status));
  v_metadata := case when jsonb_typeof(p_order->'metadata') = 'object' then p_order->'metadata' else '{}'::jsonb end;

  if v_existing_order.id is null then
    insert into public.pos_restaurant_orders (
      id, license_id, local_order_id, sale_id, table_label, customer_id, customer_name,
      status, fulfillment_status, source, notes, subtotal, total, currency,
      created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id,
      sent_to_kitchen_at, last_idempotency_key, metadata
    ) values (
      v_order_id,
      v_license_id,
      v_local_order_id,
      v_sale_id,
      nullif(btrim(coalesce(p_order->>'tableLabel', p_order->>'table_label', '')), ''),
      nullif(btrim(coalesce(p_order->>'customerId', p_order->>'customer_id', '')), ''),
      nullif(btrim(coalesce(p_order->>'customerName', p_order->>'customer_name', '')), ''),
      v_status,
      v_fulfillment_status,
      nullif(btrim(coalesce(p_order->>'source', '')), ''),
      nullif(coalesce(p_order->>'notes', ''), ''),
      private.safe_jsonb_numeric(p_order, 'subtotal', 0),
      private.safe_jsonb_numeric(p_order, 'total', 0),
      coalesce(nullif(btrim(p_order->>'currency'), ''), 'MXN'),
      v_device_id,
      v_device_id,
      v_staff_user_id,
      v_staff_user_id,
      now(),
      p_idempotency_key,
      v_metadata || jsonb_build_object('phase', 'REST.2')
    )
    returning * into v_saved_order;
  else
    update public.pos_restaurant_orders
    set sale_id = coalesce(v_sale_id, sale_id),
        table_label = nullif(btrim(coalesce(p_order->>'tableLabel', p_order->>'table_label', table_label, '')), ''),
        customer_id = nullif(btrim(coalesce(p_order->>'customerId', p_order->>'customer_id', customer_id, '')), ''),
        customer_name = nullif(btrim(coalesce(p_order->>'customerName', p_order->>'customer_name', customer_name, '')), ''),
        status = v_status,
        fulfillment_status = v_fulfillment_status,
        source = coalesce(nullif(btrim(p_order->>'source'), ''), source, 'pos'),
        notes = coalesce(p_order->>'notes', notes),
        subtotal = private.safe_jsonb_numeric(p_order, 'subtotal', subtotal),
        total = private.safe_jsonb_numeric(p_order, 'total', total),
        currency = coalesce(nullif(btrim(p_order->>'currency'), ''), currency, 'MXN'),
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        updated_at = now(),
        sent_to_kitchen_at = coalesce(sent_to_kitchen_at, now()),
        server_version = server_version + 1,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || v_metadata || jsonb_build_object('phase', 'REST.2')
    where license_id = v_license_id
      and id = v_existing_order.id
      and deleted_at is null
    returning * into v_saved_order;
  end if;

  for v_item_record in
    select value as payload, ordinality::integer as item_sort_order
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    v_item := v_item_record.payload;

    if private.safe_jsonb_numeric(v_item, 'quantity', 0) <= 0 then
      continue;
    end if;

    v_local_line_id := nullif(btrim(coalesce(v_item->>'localLineId', v_item->>'local_line_id', '')), '');
    v_item_id := nullif(btrim(coalesce(v_item->>'id', '')), '');

    if v_item_id is null then
      v_item_id := 'rest_item_' || md5(v_saved_order.id || ':' || coalesce(v_local_line_id, (v_item_record.item_sort_order::text || ':' || coalesce(v_item->>'productId', v_item->>'product_id', '') || ':' || coalesce(v_item->>'productName', v_item->>'product_name', ''))));
    end if;

    v_station := private.resolve_restaurant_order_station(
      v_license_id,
      coalesce(v_item->>'stationCode', v_item->>'station_code', 'kitchen'),
      coalesce(v_item->>'stationName', v_item->>'station_name', 'Cocina'),
      v_device_id,
      v_staff_user_id
    );
    v_item_status := private.normalize_restaurant_order_status(coalesce(v_item->>'status', 'pending'));
    v_item_metadata := case when jsonb_typeof(v_item->'metadata') = 'object' then v_item->'metadata' else '{}'::jsonb end;
    v_selected_modifiers := case when jsonb_typeof(v_item->'selectedModifiers') = 'array' then v_item->'selectedModifiers'
                                 when jsonb_typeof(v_item->'selected_modifiers') = 'array' then v_item->'selected_modifiers'
                                 else '[]'::jsonb end;

    v_item_ids := array_append(v_item_ids, v_item_id);

    insert into public.pos_restaurant_order_items (
      id, license_id, restaurant_order_id, local_line_id, product_id, product_name,
      quantity, unit_price, line_total, notes, selected_modifiers,
      station_code, station_name, status, sort_order, metadata
    ) values (
      v_item_id,
      v_license_id,
      v_saved_order.id,
      v_local_line_id,
      nullif(btrim(coalesce(v_item->>'productId', v_item->>'product_id', '')), ''),
      coalesce(nullif(btrim(coalesce(v_item->>'productName', v_item->>'product_name', '')), ''), 'Producto'),
      private.safe_jsonb_numeric(v_item, 'quantity', 1),
      private.safe_jsonb_numeric(v_item, 'unitPrice', private.safe_jsonb_numeric(v_item, 'unit_price', 0)),
      private.safe_jsonb_numeric(v_item, 'lineTotal', private.safe_jsonb_numeric(v_item, 'line_total', 0)),
      nullif(coalesce(v_item->>'notes', ''), ''),
      v_selected_modifiers,
      coalesce(v_station->>'code', 'kitchen'),
      coalesce(v_station->>'name', 'Cocina'),
      v_item_status,
      coalesce(nullif(v_item->>'sortOrder', '')::integer, nullif(v_item->>'sort_order', '')::integer, v_item_record.item_sort_order - 1),
      v_item_metadata || jsonb_build_object('phase', 'REST.2')
    )
    on conflict (id) do update set
      local_line_id = excluded.local_line_id,
      product_id = excluded.product_id,
      product_name = excluded.product_name,
      quantity = excluded.quantity,
      unit_price = excluded.unit_price,
      line_total = excluded.line_total,
      notes = excluded.notes,
      selected_modifiers = excluded.selected_modifiers,
      station_code = excluded.station_code,
      station_name = excluded.station_name,
      status = excluded.status,
      sort_order = excluded.sort_order,
      updated_at = now(),
      deleted_at = null,
      server_version = public.pos_restaurant_order_items.server_version + 1,
      metadata = coalesce(public.pos_restaurant_order_items.metadata, '{}'::jsonb) || excluded.metadata
    where public.pos_restaurant_order_items.license_id = excluded.license_id
      and public.pos_restaurant_order_items.restaurant_order_id = excluded.restaurant_order_id
    returning * into v_saved_item;

    -- Recheck under the conflicting row lock: the earlier snapshot cannot see
    -- an item inserted concurrently by another parent or tenant.
    if not found then
      raise exception 'RESTAURANT_TABLE_SCOPE_DENIED' using errcode = 'P0001';
    end if;

    perform private.record_pos_sync_event(
      v_license_id,
      'restaurant_order_item',
      v_saved_item.id,
      'upsert',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object('source', 'pos_upsert_restaurant_order', 'restaurant_order_id', v_saved_order.id, 'station_code', v_saved_item.station_code),
      v_saved_item.server_version
    );
  end loop;

  for v_deleted_item in
    update public.pos_restaurant_order_items i
    set deleted_at = now(),
        status = 'cancelled',
        updated_at = now(),
        server_version = server_version + 1,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('phase', 'REST.2', 'deletedByPayloadOmission', true)
    where i.license_id = v_license_id
      and i.restaurant_order_id = v_saved_order.id
      and i.deleted_at is null
      and (array_length(v_item_ids, 1) is null or not (i.id = any(v_item_ids)))
    returning *
  loop
    perform private.record_pos_sync_event(
      v_license_id,
      'restaurant_order_item',
      v_deleted_item.id,
      'delete',
      v_device_id,
      v_staff_user_id,
      p_idempotency_key,
      jsonb_build_object('source', 'pos_upsert_restaurant_order', 'restaurant_order_id', v_saved_order.id),
      v_deleted_item.server_version
    );
  end loop;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order',
    v_saved_order.id,
    'upsert',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object('source', 'pos_upsert_restaurant_order', 'local_order_id', v_local_order_id),
    v_saved_order.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'order', private.pos_restaurant_order_to_jsonb(v_saved_order, null),
    'event', to_jsonb(v_event),
    'serverVersion', v_saved_order.server_version,
    'changeSeq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  if v_existing_order.id is not null then
    perform private.record_restaurant_intervention_v1(v_context,v_existing_order,'edit',v_expected_version,
      p_order->>'interventionReason',p_idempotency_key,jsonb_build_object('success',true,'serverVersion',v_saved_order.server_version));
  end if;
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_RESTAURANT_ORDER', 'message', 'Ya existe una comanda para esta mesa.', 'idempotency_key', p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  end if;
  return v_response;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.pos_close_restaurant_order_after_checkout_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_local_order_id text DEFAULT NULL::text, p_paid_sale_id text DEFAULT NULL::text, p_paid_sale_folio text DEFAULT NULL::text, p_paid_total numeric DEFAULT NULL::numeric, p_payment_summary jsonb DEFAULT '{}'::jsonb, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_local_order_id text;
  v_payment_summary jsonb;
  v_order public.pos_restaurant_orders;
  v_saved public.pos_restaurant_orders;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request_hash text;
  v_next_status text;
  v_paid_sale_id text;
  v_paid_sale_folio text;
  v_is_split_bill boolean;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  perform private.assert_restaurant_order_write_permission(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  perform private.assert_restaurant_orders_food_service(v_license_id);
  perform private.assert_restaurant_settlement_permit_v1(v_context,p_local_order_id);

  v_local_order_id := nullif(btrim(coalesce(p_local_order_id, '')), '');
  if v_local_order_id is null then
    return jsonb_build_object('success', false, 'code', 'LOCAL_ORDER_ID_REQUIRED', 'message', 'No se encontro la mesa local para cerrar cocina cloud.');
  end if;

  v_paid_sale_id := nullif(btrim(coalesce(p_paid_sale_id, '')), '');
  v_paid_sale_folio := nullif(btrim(coalesce(p_paid_sale_folio, '')), '');
  v_payment_summary := case when jsonb_typeof(coalesce(p_payment_summary, '{}'::jsonb)) = 'object' then coalesce(p_payment_summary, '{}'::jsonb) else '{}'::jsonb end;
  v_is_split_bill := coalesce(v_payment_summary->>'source', '') = 'split_bill';
  v_request_hash := md5(v_local_order_id || '|' || coalesce(v_paid_sale_id, '') || '|' || coalesce(v_paid_sale_folio, '') || '|' || coalesce(p_paid_total::text, '') || '|' || coalesce(v_payment_summary::text, '{}'));

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'restaurant_order.checkout_close', 'restaurant_order', v_local_order_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem
    from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;

    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'El cierre de cocina cloud ya se esta procesando.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_order
  from public.pos_restaurant_orders
  where license_id = v_license_id
    and local_order_id = v_local_order_id
    and deleted_at is null
  order by updated_at desc
  limit 1
  for update;

  if v_order.id is null then
    v_response := jsonb_build_object(
      'success', true,
      'found', false,
      'code', 'RESTAURANT_ORDER_NOT_FOUND',
      'message', 'La venta se cobro, pero no habia comanda cloud abierta para cerrar.',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_order.status = 'cancelled' then
    v_response := jsonb_build_object(
      'success', true,
      'found', true,
      'code', 'ORDER_ALREADY_CANCELLED',
      'message', 'La comanda ya estaba cancelada. No se reabrio ni se movio caja.',
      'order', private.pos_restaurant_order_to_jsonb(v_order, null),
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_next_status := case
    when v_is_split_bill then 'delivered'
    when v_order.status in ('ready', 'delivered') then 'delivered'
    else v_order.status
  end;

  update public.pos_restaurant_orders
  set payment_status = 'paid',
      paid_at = coalesce(paid_at, now()),
      paid_sale_id = coalesce(v_paid_sale_id, paid_sale_id),
      paid_sale_folio = coalesce(v_paid_sale_folio, paid_sale_folio),
      paid_total = coalesce(p_paid_total, paid_total),
      status = v_next_status,
      fulfillment_status = v_next_status,
      checkout_closed_at = case when v_next_status = 'delivered' then coalesce(checkout_closed_at, now()) else checkout_closed_at end,
      delivered_at = case when v_next_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      ready_at = case when v_next_status = 'delivered' then coalesce(ready_at, now()) else ready_at end,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      updated_at = now(),
      server_version = server_version + 1,
      last_idempotency_key = p_idempotency_key,
      checkout_close_metadata = coalesce(checkout_close_metadata, '{}'::jsonb) || jsonb_build_object(
        'phase', case when v_is_split_bill then 'REST.SPLIT.1' else 'REST.7' end,
        'closedBy', 'pos_close_restaurant_order_after_checkout',
        'paymentSummary', v_payment_summary,
        'paidSaleId', v_paid_sale_id,
        'paidSaleFolio', v_paid_sale_folio,
        'paidTotal', p_paid_total,
        'statusBefore', v_order.status,
        'statusAfter', v_next_status,
        'splitBillClose', v_is_split_bill
      ),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'phase', case when v_is_split_bill then 'REST.SPLIT.1' else 'REST.7' end,
        'checkoutCloseBy', 'pos_close_restaurant_order_after_checkout',
        'paymentStatus', 'paid'
      )
  where license_id = v_license_id
    and id = v_order.id
    and deleted_at is null
  returning * into v_saved;

  if v_next_status = 'delivered' then
    update public.pos_restaurant_order_items
    set status = case when status <> 'cancelled' then 'delivered' else status end,
        delivered_at = case when status <> 'cancelled' then coalesce(delivered_at, now()) else delivered_at end,
        updated_at = now(),
        server_version = case when status <> 'cancelled' then server_version + 1 else server_version end
    where license_id = v_license_id
      and restaurant_order_id = v_saved.id
      and deleted_at is null;
  end if;

  v_event := private.record_pos_sync_event(
    v_license_id,
    'restaurant_order',
    v_saved.id,
    'close',
    v_device_id,
    v_staff_user_id,
    p_idempotency_key,
    jsonb_build_object(
      'source', 'pos_close_restaurant_order_after_checkout',
      'action', 'checkout_close',
      'payment_status', 'paid',
      'status_before', v_order.status,
      'status_after', v_saved.status,
      'paid_sale_id', v_saved.paid_sale_id,
      'paid_sale_folio', v_saved.paid_sale_folio,
      'split_bill_close', v_is_split_bill
    ),
    v_saved.server_version
  );

  v_response := jsonb_build_object(
    'success', true,
    'found', true,
    'code', case when v_saved.status = 'delivered' then 'ORDER_PAID_AND_DELIVERED' else 'ORDER_PAID_STILL_IN_KITCHEN' end,
    'message', case when v_saved.status = 'delivered' then 'Comanda pagada y cerrada en cocina cloud.' else 'Comanda pagada. Cocina sigue visible hasta terminar preparacion.' end,
    'order', private.pos_restaurant_order_to_jsonb(v_saved, null),
    'event', to_jsonb(v_event),
    'serverVersion', v_saved.server_version,
    'changeSeq', v_event.change_seq,
    'idempotency_key', p_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$
;
CREATE OR REPLACE FUNCTION private.r2b_authorize_sale_financial_request_v1(p_operation_type text, p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_sale jsonb, p_items jsonb, p_payments jsonb, p_cash_session_id text, p_customer_id text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_sale_id text;
  v_local_sale_id text;
  v_idempotency_key text;
  v_request_hash text;
  v_idem jsonb;
  v_sale jsonb := coalesce(p_sale, '{}'::jsonb);
  v_item_payload jsonb;
  v_payment_payload jsonb;
  v_item record;
  v_payment record;
  v_product public.pos_products;
  v_selected_batch public.pos_product_batches;
  v_batch public.pos_product_batches;
  v_batch_payload jsonb;
  v_ecom_order public.ecommerce_orders;
  v_ecom_item record;
  v_ecom_order_id text;
  v_ecom_conversion_key text;
  v_seen_ecom_items text[] := array[]::text[];
  v_product_id text;
  v_batch_id text;
  v_batch_quantity numeric;
  v_quantity numeric;
  v_raw_unit_price numeric;
  v_raw_unit_cost numeric;
  v_raw_line_subtotal numeric;
  v_raw_line_total numeric;
  v_raw_discount_amount numeric;
  v_raw_tax_amount numeric;
  v_batch_count integer := 0;
  v_batches_used jsonb := '[]'::jsonb;
  v_batch_cost_total numeric := 0;
  v_batch_price_total numeric := 0;
  v_price_base_total numeric := 0;
  v_price_base_unit numeric := 0;
  v_price_reference_cost numeric := 0;
  v_selected_modifier_result jsonb;
  v_selected_modifiers jsonb := '[]'::jsonb;
  v_modifier_unit_total numeric := 0;
  v_is_variant boolean := false;
  v_inventory_mode boolean := false;
  v_server_unit_cost numeric;
  v_gross_line numeric;
  v_line_discount_result jsonb;
  v_line_discount numeric := 0;
  v_line_discount_total numeric := 0;
  v_gross_subtotal numeric := 0;
  v_sale_discount_result jsonb;
  v_sale_discount jsonb;
  v_sale_discount_amount numeric := 0;
  v_tax_total numeric := 0;
  v_delivery_fee numeric := 0;
  v_total numeric := 0;
  v_incoming_sale_value numeric;
  v_raw_sale_discount jsonb;
  v_raw_item_discount jsonb;
  v_raw_batches jsonb;
  v_tier jsonb;
  v_tier_min numeric;
  v_tier_price numeric;
  v_best_tier_min numeric := null;
  v_best_tier_price numeric := null;
  v_canonical_items jsonb := '[]'::jsonb;
  v_canonical_payments jsonb := '[]'::jsonb;
  v_canonical_batches jsonb;
  v_canonical_item jsonb;
  v_canonical_payment jsonb;
  v_item_id text;
  v_method text;
  v_requested_method text;
  v_seen_method text;
  v_payment_amount numeric;
  v_received_amount numeric;
  v_payment_change numeric;
  v_payment_sum numeric := 0;
  v_change_sum numeric := 0;
  v_cash_sum numeric := 0;
  v_non_cash_sum numeric := 0;
  v_customer public.pos_customers;
  v_effective_customer_id text;
  v_has_discount_permission boolean;
  v_raw_sale_total_text text;
  v_is_split_child boolean := false;
  v_split_adjustment_expected numeric := 0;
  v_split_adjustment_sum numeric := 0;
  v_split_item_adjustment numeric := 0;
  v_split_adjustment_item_count integer := 0;
begin
  if p_operation_type not in ('sale.cashier', 'sale.cashier_inventory', 'sale.credit') then
    raise exception 'SALE_OPERATION_UNSUPPORTED' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_sale) <> 'object' then
    raise exception 'SALE_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_PAYMENTS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_pos_permission(v_context, 'pos');
  if p_operation_type = 'sale.credit' then
    perform private.assert_pos_permission(v_context, 'customers');
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;

  v_sale_id := coalesce(
    private.pos_sale_jsonb_text(v_sale, array['id','cloud_sale_id','cloudSaleId']),
    'sale_' || replace(extensions.gen_random_uuid()::text, '-', '')
  );
  v_local_sale_id := coalesce(
    private.pos_sale_jsonb_text(v_sale, array['local_sale_id','localSaleId']), v_sale_id
  );

  -- Apply exactly the aliases consumed by the effect engine. Neither a
  -- cloudSaleId alias nor a split child marker may bypass the parent permit.
  perform private.assert_restaurant_settlement_permit_v1(v_context, v_local_sale_id);
  if v_sale_id is distinct from v_local_sale_id then
    perform private.assert_restaurant_settlement_permit_v1(v_context, v_sale_id);
  end if;
  if nullif(btrim(coalesce(v_sale->'metadata'->>'splitParentId',
      v_sale->'metadata'->>'split_parent_id', '')), '') is not null then
    perform private.assert_restaurant_settlement_permit_v1(v_context,
      btrim(coalesce(v_sale->'metadata'->>'splitParentId', v_sale->'metadata'->>'split_parent_id')));
  end if;

  v_is_split_child := lower(coalesce(v_sale->'metadata'->>'source', '')) = 'split_bill_child'
    and nullif(btrim(coalesce(v_sale->'metadata'->>'splitGroupId', v_sale->'metadata'->>'split_group_id', '')), '') is not null
    and nullif(btrim(coalesce(v_sale->'metadata'->>'splitParentId', v_sale->'metadata'->>'split_parent_id', '')), '') is not null;
  if v_is_split_child then
    v_split_adjustment_expected := coalesce(private.pos_sale_jsonb_numeric(
      coalesce(v_sale->'metadata', '{}'::jsonb),
      array['splitRoundingAdjustment','split_rounding_adjustment','roundingAdjustment','rounding_adjustment'],
      0
    ), 0);
    if abs(v_split_adjustment_expected) > 0.01
       or abs(v_split_adjustment_expected - round(v_split_adjustment_expected, 2)) > 0.000001 then
      raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
    end if;
  end if;
  v_idempotency_key := coalesce(
    nullif(btrim(p_idempotency_key), ''),
    case p_operation_type
      when 'sale.cashier_inventory' then 'sales.cloud_commit.inventory:' || v_local_sale_id || ':' || v_device_id::text
      when 'sale.credit' then 'sales.cloud_credit:' || v_local_sale_id || ':' || v_device_id::text
      else 'sales.cloud_commit:' || v_local_sale_id || ':' || v_device_id::text
    end
  );
  v_inventory_mode := p_operation_type = 'sale.cashier_inventory';
  if p_operation_type = 'sale.cashier'
     and coalesce((v_sale->'metadata'->>'cloudInventoryEffects')::boolean, false) then
    v_inventory_mode := true;
  end if;

  v_ecom_order_id := coalesce(
    private.pos_sale_jsonb_text(v_sale, array['ecommerce_order_id','ecommerceOrderId']),
    v_sale->'metadata'->>'ecommerceOrderId', v_sale->'metadata'->>'ecommerce_order_id'
  );
  if lower(coalesce(private.pos_sale_jsonb_text(v_sale, array['sales_channel','salesChannel']), '' )) = 'ecommerce'
     or lower(coalesce(v_sale->'metadata'->>'origin', '')) = 'ecommerce'
     or v_ecom_order_id is not null then
    if nullif(btrim(v_ecom_order_id), '') is null then
      raise exception 'ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED' using errcode = 'P0001';
    end if;
    v_ecom_order_id := btrim(v_ecom_order_id);
    select * into v_ecom_order
    from public.ecommerce_orders o
    where o.license_id = v_license_id
      and o.id::text = v_ecom_order_id
    for update;
    if v_ecom_order.id is null then
      raise exception 'ECOMMERCE_ORDER_NOT_FOUND' using errcode = 'P0001';
    end if;
    v_ecom_conversion_key := coalesce(
      v_sale->'metadata'->>'ecommerceConversionKey',
      v_sale->'metadata'->>'idempotencyKey'
    );
    if v_ecom_order.pos_conversion_status <> 'reserved'
       or v_ecom_order.pos_conversion_sale_id is distinct from v_sale_id
       or v_ecom_order.pos_conversion_key is distinct from v_ecom_conversion_key
       or v_ecom_order.pos_draft_status <> 'prepared' then
      raise exception 'ECOMMERCE_CONVERSION_AUTHORITY_REQUIRED' using errcode = 'P0001';
    end if;
    if coalesce(v_ecom_order.discount_total, 0) > 0 then
      v_has_discount_permission := private.has_pos_permission(v_context, 'discounts');
      if not v_has_discount_permission then
        raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
      end if;
    end if;
  end if;

  v_has_discount_permission := private.has_pos_permission(v_context, 'discounts');

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then
    raise exception 'SALE_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  for v_item in
    select value as payload, ordinality
    from jsonb_array_elements(p_items) with ordinality
  loop
    v_item_payload := v_item.payload;
    if jsonb_typeof(v_item_payload) <> 'object' then
      raise exception 'SALE_ITEM_PAYLOAD_INVALID' using errcode = 'P0001';
    end if;
    v_product_id := nullif(btrim(private.pos_sale_jsonb_text(v_item_payload, array['product_id','productId','parentId'])), '');
    if v_product_id is null then
      raise exception 'MANUAL_ITEM_PRICE_POLICY_REQUIRED' using errcode = 'P0001';
    end if;
    v_quantity := private.pos_sale_jsonb_numeric(v_item_payload, array['quantity','qty'], null);
    if v_quantity is null or v_quantity <= 0 then
      raise exception 'SALE_ITEM_QUANTITY_INVALID' using errcode = 'P0001';
    end if;

    if v_ecom_order.id is not null then
      select i.*,
             coalesce(nullif(i.source_product_id, ''), ep.product_id, ep.local_product_ref) as resolved_source_product_id
      into v_ecom_item
      from public.ecommerce_order_items i
      left join public.ecommerce_published_products ep on ep.id = i.published_product_id
      where i.order_id = v_ecom_order.id
        and (
          i.id::text = coalesce(v_item_payload->>'ecommerce_order_item_id', '')
          or i.id::text = coalesce(v_item_payload->'metadata'->>'ecommerceOrderItemId', '')
          or ('ecom-' || v_ecom_order.id::text || '-' || i.id::text) = coalesce(v_item_payload->>'id', '')
          or ('ecom-' || v_ecom_order.id::text || '-' || i.id::text) = coalesce(v_item_payload->'metadata'->>'lineId', '')
        )
      limit 1;
      if v_ecom_item.id is null or v_ecom_item.id::text = any(v_seen_ecom_items) then
        raise exception 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001';
      end if;
      v_seen_ecom_items := array_append(v_seen_ecom_items, v_ecom_item.id::text);
      if v_ecom_item.resolved_source_product_id is null
         or v_ecom_item.resolved_source_product_id <> v_product_id
         or abs(v_ecom_item.quantity - v_quantity) > 0.0005
         or abs(v_ecom_item.line_total - round(v_ecom_item.unit_price * v_ecom_item.quantity, 2)) > 0.005 then
        raise exception 'ECOMMERCE_CHECKOUT_SNAPSHOT_MISMATCH' using errcode = 'P0001';
      end if;
    end if;

    select * into v_product
    from public.pos_products p
    where p.license_id = v_license_id and p.id = v_product_id
    for update;
    if v_product.id is null then
      if v_item_payload->'metadata'->>'productIdSource' = 'line_identity' then
        raise exception 'MANUAL_ITEM_PRICE_POLICY_REQUIRED' using errcode = 'P0001';
      end if;
      raise exception 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE:%', v_product_id using errcode = 'P0001';
    end if;
    if v_product.deleted_at is not null or v_product.is_active is not true then
      raise exception 'CLOUD_PRODUCT_NOT_AVAILABLE:%', v_product_id using errcode = 'P0001';
    end if;

    -- SALE_BATCH_ALLOCATION_NULL_COMPAT_R1: JSONB null means no explicit allocation.
    v_raw_batches := coalesce(
      nullif(v_item_payload->'batches_used', 'null'::jsonb),
      nullif(v_item_payload->'batchesUsed', 'null'::jsonb),
      nullif(v_item_payload->'metadata'->'batches_used', 'null'::jsonb),
      nullif(v_item_payload->'metadata'->'batchesUsed', 'null'::jsonb),
      '[]'::jsonb
    );
    if jsonb_typeof(v_raw_batches) <> 'array' then
      raise exception 'BATCH_ALLOCATION_INVALID' using errcode = 'P0001';
    end if;
    v_canonical_batches := '[]'::jsonb;
    v_batch_count := 0;
    v_batch_cost_total := 0;
    v_batch_price_total := 0;
    for v_batch_payload in select value from jsonb_array_elements(v_raw_batches) loop
      v_batch_id := nullif(btrim(private.pos_sale_jsonb_text(v_batch_payload, array['batch_id','batchId','id'])), '');
      v_batch_quantity := private.pos_sale_jsonb_numeric(v_batch_payload, array['quantity','qty','usedQuantity','used_quantity'], null);
      if v_batch_id is null or v_batch_quantity is null or v_batch_quantity <= 0 then
        raise exception 'BATCH_ALLOCATION_INVALID' using errcode = 'P0001';
      end if;
      select * into v_batch
      from public.pos_product_batches b
      where b.license_id = v_license_id
        and b.product_id = v_product_id
        and b.id = v_batch_id
        and b.deleted_at is null
        and b.is_active is true
        and b.status = 'active'
      for update;
      if v_batch.id is null then
        raise exception 'CLOUD_BATCH_NOT_AVAILABLE:%', v_batch_id using errcode = 'P0001';
      end if;
      v_batch_count := v_batch_count + 1;
      v_batch_cost_total := v_batch_cost_total + (v_batch.cost * v_batch_quantity);
      v_batch_price_total := v_batch_price_total + (v_batch.price * v_batch_quantity);
      v_canonical_batches := v_canonical_batches || jsonb_build_array(jsonb_build_object(
        'batch_id', v_batch.id, 'quantity', v_batch_quantity
      ));
    end loop;
    if v_batch_count > 0 and abs((select coalesce(sum((x->>'quantity')::numeric), 0) from jsonb_array_elements(v_canonical_batches) x) - v_quantity) > 0.0005 then
      raise exception 'CLOUD_BATCH_ALLOCATION_MISMATCH' using errcode = 'P0001';
    end if;

    v_batch_id := nullif(btrim(private.pos_sale_jsonb_text(v_item_payload, array['batch_id','batchId'])), '');
    v_selected_batch := null;
    if v_batch_id is not null then
      select * into v_selected_batch
      from public.pos_product_batches b
      where b.license_id = v_license_id
        and b.product_id = v_product_id
        and b.id = v_batch_id
        and b.deleted_at is null
        and b.is_active is true
        and b.status = 'active'
      for update;
      if v_selected_batch.id is null then
        raise exception 'CLOUD_BATCH_NOT_AVAILABLE:%', v_batch_id using errcode = 'P0001';
      end if;
    end if;

    select exists (
      select 1 from public.pos_product_batches b
      where b.license_id = v_license_id and b.product_id = v_product_id
        and b.deleted_at is null and b.is_active is true and b.status = 'active'
        and (coalesce(b.attributes, '{}'::jsonb) ? 'talla'
          or coalesce(b.attributes, '{}'::jsonb) ? 'color')
    ) into v_is_variant;

    v_selected_modifier_result := private.r2b_authoritative_modifiers_v1(v_product, v_item_payload);
    v_selected_modifiers := coalesce(v_selected_modifier_result->'modifiers', '[]'::jsonb);
    v_modifier_unit_total := coalesce((v_selected_modifier_result->>'unit_total')::numeric, 0);

    if v_ecom_order.id is not null then
      v_price_base_total := v_ecom_item.unit_price * v_quantity;
      v_gross_line := round(v_ecom_item.line_total, 2);
      v_price_base_unit := v_ecom_item.unit_price;
      v_server_unit_cost := case
        when v_selected_batch.id is not null then v_selected_batch.cost
        when v_batch_count > 0 then round(v_batch_cost_total / v_quantity, 4)
        else v_product.cost
      end;
    else
      v_price_reference_cost := case
        when v_selected_batch.id is not null then v_selected_batch.cost
        when v_batch_count > 0 then v_batch_cost_total / v_quantity
        else v_product.cost
      end;
      v_best_tier_min := null;
      v_best_tier_price := null;
      if jsonb_typeof(coalesce(v_product.wholesale_tiers, '[]'::jsonb)) = 'array' then
        for v_tier in select value from jsonb_array_elements(coalesce(v_product.wholesale_tiers, '[]'::jsonb)) loop
          begin
            v_tier_min := coalesce(nullif(btrim(coalesce(v_tier->>'min', v_tier->>'minQty', v_tier->>'min_qty', '')), '')::numeric, 0);
            v_tier_price := nullif(btrim(coalesce(v_tier->>'price', '')), '')::numeric;
          exception when others then
            raise exception 'WHOLESALE_TIER_INVALID' using errcode = 'P0001';
          end;
          if v_tier_price is not null and v_tier_min >= 0 and v_quantity >= v_tier_min
             and not (v_price_reference_cost > 0 and v_tier_price < v_price_reference_cost)
             and (v_best_tier_min is null or v_tier_min > v_best_tier_min) then
            v_best_tier_min := v_tier_min;
            v_best_tier_price := v_tier_price;
          end if;
        end loop;
      end if;

      if v_is_variant then
        if v_batch_count > 0 then
          v_price_base_total := v_batch_price_total;
        elsif v_selected_batch.id is not null then
          v_price_base_total := v_selected_batch.price * v_quantity;
        else
          raise exception 'BATCH_SELECTION_REQUIRED' using errcode = 'P0001';
        end if;
      else
        v_price_base_total := v_product.price * v_quantity;
      end if;
      if v_best_tier_price is not null then
        v_price_base_total := v_best_tier_price * v_quantity;
      end if;
      v_price_base_unit := round(v_price_base_total / v_quantity + v_modifier_unit_total, 4);
      v_gross_line := round(v_price_base_total + v_modifier_unit_total * v_quantity, 2);
      v_server_unit_cost := case
        when v_batch_count > 0 then round(v_batch_cost_total / v_quantity, 4)
        when v_selected_batch.id is not null then v_selected_batch.cost
        else v_product.cost
      end;
    end if;

    v_split_item_adjustment := 0;
    if v_is_split_child then
      v_split_item_adjustment := coalesce(private.pos_sale_jsonb_numeric(
        coalesce(v_item_payload->'metadata', '{}'::jsonb),
        array['splitRoundingAdjustment','split_rounding_adjustment','roundingAdjustment','rounding_adjustment'],
        0
      ), 0);
      if abs(v_split_item_adjustment) > 0.01
         or abs(v_split_item_adjustment - round(v_split_item_adjustment, 2)) > 0.000001 then
        raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
      end if;
      if abs(v_split_item_adjustment) > 0.005 then
        v_split_adjustment_item_count := v_split_adjustment_item_count + 1;
        if v_split_adjustment_item_count > 1 then
          raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
        end if;
      end if;
      v_split_adjustment_sum := v_split_adjustment_sum + v_split_item_adjustment;
      v_gross_line := round(v_gross_line + v_split_item_adjustment, 2);
      if v_gross_line < -0.005 then
        raise exception 'SPLIT_ROUNDING_INVALID' using errcode = 'P0001';
      end if;
    end if;

    v_raw_unit_price := private.pos_sale_jsonb_numeric(v_item_payload, array['unit_price','unitPrice','price'], null);
    if v_raw_unit_price is null or abs(v_raw_unit_price - v_price_base_unit) > 0.005 then
      raise exception 'SALE_PRICE_MISMATCH:%', v_product_id using errcode = 'P0001';
    end if;
    v_raw_unit_cost := private.pos_sale_jsonb_numeric(v_item_payload, array['unit_cost','unitCost','cost'], null);
    -- Deliberately read but never use v_raw_unit_cost.  The authoritative cost
    -- is selected from the locked product/batch rows above.
    if v_raw_unit_cost is not null and v_raw_unit_cost < 0 then
      raise exception 'SALE_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
    end if;

    v_raw_item_discount := coalesce(v_item_payload->'discount', v_item_payload->'discountAmount', v_item_payload->'discount_amount');
    if v_raw_item_discount is null or jsonb_typeof(v_raw_item_discount) = 'null' then
      v_raw_discount_amount := private.pos_sale_jsonb_numeric(v_item_payload, array['discount_amount','discountAmount'], null);
      if v_raw_discount_amount is not null and v_raw_discount_amount <> 0 then
        v_raw_item_discount := jsonb_build_object(
          'type', 'amount', 'value', v_raw_discount_amount,
          'reason', coalesce(v_item_payload->>'discountReason', v_item_payload->>'discount_reason')
        );
      end if;
    end if;
    v_line_discount_result := private.r2b_normalize_discount_v1(v_raw_item_discount, v_gross_line, 'line');
    v_line_discount := coalesce((v_line_discount_result->>'amount')::numeric, 0);
    if v_line_discount > 0 and not v_has_discount_permission then
      raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
    end if;
    if v_ecom_order.id is not null and v_line_discount > 0 then
      raise exception 'ECOMMERCE_DISCOUNT_NOT_IN_ORDER' using errcode = 'P0001';
    end if;
    v_raw_line_subtotal := private.pos_sale_jsonb_numeric(v_item_payload, array['line_subtotal','lineSubtotal','subtotal','exactTotal'], null);
    v_raw_line_total := private.pos_sale_jsonb_numeric(v_item_payload, array['line_total','lineTotal','total'], null);
    if v_raw_line_subtotal is not null and abs(v_raw_line_subtotal - v_gross_line) > 0.005 then
      raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
    end if;
    if v_raw_line_total is not null and abs(v_raw_line_total - round(v_gross_line - v_line_discount, 2)) > 0.005 then
      raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
    end if;
    v_raw_tax_amount := private.pos_sale_jsonb_numeric(v_item_payload, array['tax_amount','taxAmount','tax'], 0);
    if v_raw_tax_amount < 0 then
      raise exception 'SALE_TAX_INVALID' using errcode = 'P0001';
    end if;
    if v_ecom_order.id is null and v_raw_tax_amount > 0.005 then
      raise exception 'SALE_TAX_SOURCE_UNRESOLVED' using errcode = 'P0001';
    end if;
    if v_ecom_order.id is not null and v_raw_tax_amount > 0.005 then
      raise exception 'ECOMMERCE_TAX_LINE_UNRESOLVED' using errcode = 'P0001';
    end if;

    v_gross_subtotal := v_gross_subtotal + v_gross_line;
    v_line_discount_total := v_line_discount_total + v_line_discount;
    if v_inventory_mode and v_product.track_stock is true
       and (v_product.batch_management is not null or v_batch_count > 0 or v_selected_batch.id is not null) then
      v_server_unit_cost := null;
    end if;
    v_canonical_item := (
      v_item_payload
      - 'price' - 'unitPrice' - 'unit_price'
      - 'cost' - 'unitCost' - 'unit_cost'
      - 'discount' - 'discountAmount' - 'discount_amount'
      - 'tax' - 'taxAmount' - 'tax_amount'
      - 'lineSubtotal' - 'line_subtotal' - 'lineTotal' - 'line_total'
      - 'batchesUsed' - 'batches_used'
    ) || jsonb_strip_nulls(jsonb_build_object(
      'id', coalesce(v_item_payload->>'id', v_sale_id || ':item:' || v_item.ordinality::text),
      'product_id', v_product.id,
      'product_name', v_product.name,
      'product_sku', v_product.sku,
      'barcode', v_product.barcode,
      'category_id', v_product.category_id,
      'quantity', v_quantity,
      'unit_price', v_price_base_unit,
      'unit_cost', v_server_unit_cost,
      'discount', v_line_discount_result->'discount',
      'discount_amount', v_line_discount,
      'tax_amount', 0,
      'line_subtotal', v_gross_line,
      'line_total', round(v_gross_line - v_line_discount, 2),
      'selected_modifiers', v_selected_modifiers,
      'batch_id', v_batch_id,
      'batch_sku', case when v_selected_batch.id is not null then v_selected_batch.sku end,
      'batch_expiry_date', case when v_selected_batch.id is not null then v_selected_batch.expiry_date end,
      'batches_used', case when v_batch_count > 0 then v_canonical_batches end,
      'metadata', coalesce(v_item_payload->'metadata', '{}'::jsonb) || jsonb_build_object(
        'r2bPriceAuthority', case when v_ecom_order.id is not null then 'ecommerce_order_item' else 'pos_product_catalog' end,
        'r2bCostAuthority', case when v_server_unit_cost is null then 'inventory_effects' else 'pos_product_or_batch' end,
        'r2bClientUnitCostIgnored', true
      )
    ));
    v_canonical_items := v_canonical_items || jsonb_build_array(v_canonical_item);
  end loop;

  if v_is_split_child and abs(v_split_adjustment_sum - v_split_adjustment_expected) > 0.005 then
    raise exception 'SPLIT_ROUNDING_MISMATCH' using errcode = 'P0001';
  end if;

  if v_ecom_order.id is not null then
    v_sale_discount_amount := round(coalesce(v_ecom_order.discount_total, 0), 2);
    v_sale_discount := case when v_sale_discount_amount > 0 then jsonb_build_object(
      'type', 'amount', 'value', v_sale_discount_amount, 'amount', v_sale_discount_amount,
      'reason', 'ecommerce_order_snapshot', 'scope', 'sale'
    ) else null end;
    v_tax_total := round(coalesce(v_ecom_order.tax_total, 0), 2);
    v_delivery_fee := round(coalesce(v_ecom_order.delivery_fee, 0), 2);
    v_total := round(v_gross_subtotal - v_line_discount_total + v_delivery_fee + v_tax_total - v_sale_discount_amount, 2);
    if abs(v_gross_subtotal - v_ecom_order.subtotal) > 0.005
       or abs(v_total - v_ecom_order.total) > 0.005 then
      raise exception 'ECOMMERCE_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
  else
    v_raw_sale_discount := coalesce(
      v_sale->'saleDiscount', v_sale->'discount', v_sale->'metadata'->'discount'
    );
    if v_raw_sale_discount is null or jsonb_typeof(v_raw_sale_discount) = 'null' then
      v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['discount_total','discountTotal'], null);
      if v_incoming_sale_value is not null and v_incoming_sale_value <> 0 then
        v_raw_sale_discount := jsonb_build_object(
          'type', 'amount', 'value', v_incoming_sale_value,
          'reason', coalesce(v_sale->>'discountReason', v_sale->'metadata'->>'discountReason')
        );
      end if;
    end if;
    v_sale_discount_result := private.r2b_normalize_discount_v1(
      v_raw_sale_discount, round(v_gross_subtotal - v_line_discount_total, 2), 'sale'
    );
    v_sale_discount_amount := coalesce((v_sale_discount_result->>'amount')::numeric, 0);
    v_sale_discount := v_sale_discount_result->'discount';
    if v_sale_discount_amount > 0 and not v_has_discount_permission then
      raise exception 'DISCOUNT_PERMISSION_REQUIRED' using errcode = 'P0001';
    end if;
    v_tax_total := 0;
    v_delivery_fee := 0;
    v_total := round(v_gross_subtotal - v_line_discount_total - v_sale_discount_amount, 2);
  end if;

  if v_total < 0 then
    raise exception 'SALE_TOTAL_INVALID' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['subtotal'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - round(v_gross_subtotal, 2)) > 0.005 then
    raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['discount_total','discountTotal'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - round(v_line_discount_total + v_sale_discount_amount, 2)) > 0.005 then
    raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['tax_total','taxTotal'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - v_tax_total) > 0.005 then
    raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_raw_sale_total_text := private.pos_sale_jsonb_text(v_sale, array['total']);
  if v_raw_sale_total_text is not null then
    begin
      if abs(v_raw_sale_total_text::numeric - v_total) > 0.005 then
        raise exception 'SALE_ARITHMETIC_MISMATCH' using errcode = 'P0001';
      end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'SALE_TOTAL_INVALID' using errcode = 'P0001';
    end;
  end if;

  v_effective_customer_id := nullif(btrim(coalesce(p_customer_id, private.pos_sale_jsonb_text(v_sale, array['customer_id','customerId']))), '');
  if p_operation_type = 'sale.credit' then
    if v_effective_customer_id is null then
      raise exception 'CREDIT_SALE_CUSTOMER_REQUIRED' using errcode = 'P0001';
    end if;
    select * into v_customer
    from public.pos_customers c
    where c.license_id = v_license_id and c.id = v_effective_customer_id
    for update;
    if v_customer.id is null then raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001'; end if;
    if v_customer.deleted_at is not null then raise exception 'CUSTOMER_DELETED' using errcode = 'P0001'; end if;
  end if;

  for v_payment in
    select value as payload, ordinality
    from jsonb_array_elements(p_payments) with ordinality
  loop
    v_payment_payload := v_payment.payload;
    if jsonb_typeof(v_payment_payload) <> 'object' then
      raise exception 'SALE_PAYMENT_PAYLOAD_INVALID' using errcode = 'P0001';
    end if;
    v_method := private.normalize_pos_sale_payment_method(
      private.pos_sale_jsonb_text(v_payment_payload, array['method','payment_method','paymentMethod'], 'cash')
    );
    if v_method in ('mixed_credit', 'partial_credit') then v_method := 'credit'; end if;
    if p_operation_type = 'sale.credit' and v_method = 'credit' then
      v_canonical_payment := jsonb_build_object(
        'id', coalesce(v_payment_payload->>'id', v_sale_id || ':payment:' || v_payment.ordinality::text),
        'method', 'credit', 'amount', 0, 'received_amount', 0, 'change_amount', 0
      );
      v_canonical_payments := v_canonical_payments || jsonb_build_array(v_canonical_payment);
      continue;
    end if;
    if v_method not in ('cash', 'card', 'transfer') then
      raise exception 'SALE_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    v_payment_amount := private.pos_sale_jsonb_numeric(v_payment_payload, array['amount','total'], null);
    if v_payment_amount is null or v_payment_amount <= 0 then
      raise exception 'SALE_PAYMENT_AMOUNT_INVALID' using errcode = 'P0001';
    end if;
    v_received_amount := coalesce(private.pos_sale_jsonb_numeric(v_payment_payload, array['received_amount','receivedAmount'], null), v_payment_amount);
    v_payment_change := coalesce(private.pos_sale_jsonb_numeric(v_payment_payload, array['change_amount','changeAmount'], null), 0);
    if v_received_amount < v_payment_amount - 0.005 or v_payment_change < -0.005 then
      raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
    end if;
    if v_method = 'cash' then
      if abs(v_payment_change - greatest(v_received_amount - v_payment_amount, 0)) > 0.005 then
        raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
      end if;
      v_cash_sum := v_cash_sum + v_payment_amount;
    else
      if abs(v_payment_change) > 0.005 or abs(v_received_amount - v_payment_amount) > 0.005 then
        raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
      end if;
      v_non_cash_sum := v_non_cash_sum + v_payment_amount;
    end if;
    v_payment_sum := v_payment_sum + v_payment_amount;
    v_change_sum := v_change_sum + v_payment_change;
    v_canonical_payment := (
      v_payment_payload - 'amount' - 'total' - 'receivedAmount' - 'received_amount' - 'changeAmount' - 'change_amount'
    ) || jsonb_build_object(
      'id', coalesce(v_payment_payload->>'id', v_sale_id || ':payment:' || v_payment.ordinality::text),
      'method', v_method, 'amount', round(v_payment_amount, 2),
      'received_amount', round(v_received_amount, 2), 'change_amount', round(v_payment_change, 2),
      'cash_session_id', coalesce(v_payment_payload->>'cash_session_id', v_payment_payload->>'cashSessionId', p_cash_session_id)
    );
    v_canonical_payments := v_canonical_payments || jsonb_build_array(v_canonical_payment);
    if v_seen_method is null then v_seen_method := v_method; elsif v_seen_method <> v_method then v_seen_method := 'mixed'; end if;
  end loop;

  if p_operation_type = 'sale.credit' then
    if v_payment_sum > v_total + 0.005 then
      raise exception 'INITIAL_PAYMENT_EXCEEDS_TOTAL' using errcode = 'P0001';
    end if;
    if v_payment_sum <= 0 then
      v_requested_method := 'credit';
    else
      v_requested_method := 'mixed_credit';
    end if;
  else
    if v_payment_sum <= 0 or abs(v_payment_sum - v_total) > 0.005 then
      raise exception 'SALE_PAYMENT_TOTAL_MISMATCH' using errcode = 'P0001';
    end if;
    v_requested_method := coalesce(v_seen_method, 'cash');
  end if;

  v_method := private.normalize_pos_sale_payment_method(
    private.pos_sale_jsonb_text(v_sale, array['payment_method','paymentMethod'], v_requested_method)
  );
  if p_operation_type = 'sale.credit' then
    if v_method not in ('credit', 'mixed', 'mixed_credit', 'partial_credit') and v_method is not null then
      raise exception 'SALE_PAYMENT_METHOD_NOT_CREDIT' using errcode = 'P0001';
    end if;
    v_method := v_requested_method;
  else
    if v_method not in ('cash', 'card', 'transfer', 'mixed') then
      raise exception 'SALE_PAYMENT_METHOD_NOT_ALLOWED' using errcode = 'P0001';
    end if;
    if v_method <> 'mixed' and v_requested_method <> 'mixed' and v_method <> v_requested_method then
      raise exception 'SALE_PAYMENT_METHOD_MISMATCH' using errcode = 'P0001';
    end if;
    v_method := v_requested_method;
  end if;

  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['amount_paid','amountPaid','abono'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - v_payment_sum) > 0.005 then
    raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['change_amount','changeAmount'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - v_change_sum) > 0.005 then
    raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;
  v_incoming_sale_value := private.pos_sale_jsonb_numeric(v_sale, array['balance_due','balanceDue','saldoPendiente'], null);
  if v_incoming_sale_value is not null and abs(v_incoming_sale_value - (v_total - v_payment_sum)) > 0.005 then
    raise exception 'SALE_PAYMENT_ARITHMETIC_MISMATCH' using errcode = 'P0001';
  end if;

  v_sale := (
    v_sale
    - 'subtotal' - 'discount' - 'discountTotal' - 'discount_total'
    - 'taxTotal' - 'tax_total' - 'total'
    - 'amountPaid' - 'amount_paid' - 'abono'
    - 'changeAmount' - 'change_amount' - 'balanceDue' - 'balance_due' - 'saldoPendiente'
    - 'paymentMethod' - 'payment_method'
  ) || jsonb_strip_nulls(jsonb_build_object(
    'id', v_sale_id,
    'local_sale_id', v_local_sale_id,
    'subtotal', round(v_gross_subtotal, 2),
    'discount_total', round(v_line_discount_total + v_sale_discount_amount, 2),
    'discount', v_sale_discount,
    'tax_total', v_tax_total,
    'delivery_fee', v_delivery_fee,
    'total', v_total,
    'amount_paid', round(v_payment_sum, 2),
    'change_amount', round(v_change_sum, 2),
    'balance_due', round(v_total - v_payment_sum, 2),
    'payment_method', v_method,
    'customer_id', v_effective_customer_id,
    'customer_name', case when v_customer.id is not null then v_customer.name end,
    'customer_phone', case when v_customer.id is not null then v_customer.phone end,
    'cash_session_id', p_cash_session_id,
    'metadata', coalesce(v_sale->'metadata', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'r2bFinancialAuthority', true,
      'r2bPriceAuthority', case when v_ecom_order.id is not null then 'ecommerce_order_items' else 'pos_products_and_batches' end,
      'r2bDiscountAuthority', case when v_ecom_order.id is not null then 'ecommerce_order_snapshot' else 'server_discount_semantics' end,
      'r2bTaxAuthority', case when v_ecom_order.id is not null then 'ecommerce_order' else 'none' end,
      'ecommerceAcceptedDeliveryFee', case when v_ecom_order.id is not null then v_delivery_fee end
     ))
  ));

  -- Hash the canonical request, exactly as the legacy effect engine does.  The
  -- comparison is deliberately after normalization so harmless client aliases
  -- and ignored unit_cost values do not turn a legitimate replay into a false
  -- conflict, while changed authoritative values still fail closed.
  v_request_hash := pg_catalog.md5(
    coalesce(v_sale::text, '') || coalesce(v_canonical_items::text, '') ||
    coalesce(v_canonical_payments::text, '') || coalesce(p_cash_session_id, '') ||
    case when p_operation_type = 'sale.credit' then coalesce(v_effective_customer_id, p_customer_id, '') else '' end
  );
  v_idem := private.r2b_assert_sale_idempotency_v1(v_license_id, v_idempotency_key, v_request_hash);
  if v_idem->>'status' = 'completed' then
    return jsonb_build_object('idempotent_response', v_idem->'response', 'idempotency_key', v_idempotency_key);
  elsif v_idem->>'status' = 'processing' then
    return jsonb_build_object('idempotency_processing', true, 'idempotency_key', v_idempotency_key);
  end if;

  return jsonb_build_object(
    'license_id', v_license_id,
    'idempotency_key', v_idempotency_key,
    'request_hash', v_request_hash,
    'sale', v_sale,
    'items', v_canonical_items,
    'payments', v_canonical_payments,
    'customer_id', v_effective_customer_id,
    'inventory_mode', v_inventory_mode
  );
end;
$function$
;
