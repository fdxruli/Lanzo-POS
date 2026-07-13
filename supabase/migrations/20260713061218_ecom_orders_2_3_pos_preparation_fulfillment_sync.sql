-- ECOM.ORDERS.2.3
-- Keep POS draft preparation and public fulfillment in the same locked transaction.

create or replace function private.ecommerce_ensure_pos_preparing_fulfillment_v1(
  p_order public.ecommerce_orders,
  p_actor_type text,
  p_actor_ref text,
  p_actor_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.ecommerce_orders%rowtype;
  v_previous_status text;
  v_next_version bigint;
  v_event_key text;
  v_actor_type text;
  v_event_inserted integer := 0;
begin
  -- Callers already hold SELECT ... FOR UPDATE on p_order. This helper deliberately
  -- does not authorize or acquire another rate-limit authorization.
  if p_order.id is null
     or p_order.pos_draft_status <> 'prepared'
     or p_order.fulfillment_status <> 'accepted'
     or p_order.status not in ('accepted', 'converted_to_sale') then
    return jsonb_build_object(
      'changed', false,
      'previousStatus', p_order.fulfillment_status,
      'currentStatus', p_order.fulfillment_status,
      'version', greatest(coalesce(p_order.fulfillment_version, 0), 0)
    );
  end if;

  v_previous_status := p_order.fulfillment_status;
  v_next_version := greatest(coalesce(p_order.fulfillment_version, 0), 0) + 1;
  v_actor_type := case
    when p_actor_type in ('system', 'public_customer', 'admin', 'staff', 'automation') then p_actor_type
    else 'automation'
  end;

  -- The predicate is intentionally narrow: this can only advance accepted -> preparing.
  update public.ecommerce_orders
  set fulfillment_status = 'preparing',
      fulfillment_version = v_next_version,
      fulfillment_updated_at = now(),
      updated_at = now()
  where id = p_order.id
    and status in ('accepted', 'converted_to_sale')
    and pos_draft_status = 'prepared'
    and fulfillment_status = 'accepted'
  returning * into v_order;

  if not found then
    return jsonb_build_object(
      'changed', false,
      'previousStatus', p_order.fulfillment_status,
      'currentStatus', p_order.fulfillment_status,
      'version', greatest(coalesce(p_order.fulfillment_version, 0), 0)
    );
  end if;

  -- This key has no claim/security material and is stable for the single version.
  v_event_key := format('pos_draft_prepared:%s:%s', v_order.id, v_next_version);

  insert into private.ecommerce_order_fulfillment_events (
    order_id,
    portal_id,
    license_id,
    version,
    from_status,
    to_status,
    event_key,
    public_message,
    actor_type,
    actor_staff_id
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    v_next_version,
    v_previous_status,
    'preparing',
    v_event_key,
    v_order.public_status_message,
    v_actor_type,
    nullif(left(btrim(coalesce(p_actor_ref, '')), 200), '')
  )
  on conflict do nothing;

  get diagnostics v_event_inserted = row_count;

  -- Match the public event contract used by manual fulfillment transitions. The
  -- public message remains untouched; POS preparation only supplies the source.
  if v_event_inserted = 1 then
    insert into public.ecommerce_order_events (
      order_id,
      portal_id,
      license_id,
      event_type,
      actor_type,
      actor_ref,
      message,
      payload
    ) values (
      v_order.id,
      v_order.portal_id,
      v_order.license_id,
      'order_fulfillment_preparing',
      v_actor_type,
      nullif(left(btrim(coalesce(p_actor_ref, '')), 200), ''),
      'Pedido en preparacion',
      jsonb_strip_nulls(jsonb_build_object(
        'fromStatus', v_previous_status,
        'toStatus', 'preparing',
        'version', v_next_version,
        'source', 'pos_draft_prepared',
        'actorLabel', nullif(left(btrim(coalesce(p_actor_label, '')), 80), '')
      ))
    );
  end if;

  return jsonb_build_object(
    'changed', true,
    'previousStatus', v_previous_status,
    'currentStatus', 'preparing',
    'version', v_next_version
  );
end;
$$;

create or replace function private.ecommerce_admin_confirm_pos_draft_authorized_v1(
  p_auth jsonb,
  p_order_id uuid,
  p_claim_token uuid,
  p_draft_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_fulfillment jsonb;
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
begin
  if coalesce((p_auth->>'success')::boolean, false) is false
     or nullif(p_auth->>'license_id', '') is null
     or nullif(p_auth->>'device_id', '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
  end if;

  if v_draft_id = '' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
  end if;

  v_license_id := (p_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if private.ecommerce_order_fulfillment_terminal_v1(v_order.fulfillment_status) then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');
  end if;

  if v_order.pos_visibility_status not in ('pending', 'visible') then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if v_order.pos_draft_status = 'prepared' then
    if v_order.pos_claim_token = p_claim_token
       and v_order.pos_draft_id = v_draft_id
       and v_order.pos_claim_actor_ref = p_auth->>'device_id' then
      -- A replay normally makes no write. If it reaches an old inconsistent row,
      -- repair only accepted -> preparing while retaining the same locked row.
      v_fulfillment := private.ecommerce_ensure_pos_preparing_fulfillment_v1(
        v_order,
        p_auth->>'actor_type',
        coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
        p_auth->>'actor_label'
      );

      select o.* into v_order
      from public.ecommerce_orders o
      where o.id = v_order.id;

      return jsonb_build_object(
        'success', true,
        'changed', coalesce((v_fulfillment->>'changed')::boolean, false),
        'idempotent', coalesce((v_fulfillment->>'changed')::boolean, false) is false,
        'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
          || jsonb_build_object('fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order))
      );
    end if;
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_ALREADY_PREPARED');
  end if;

  if v_order.pos_draft_status <> 'claimed' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID');
  end if;

  if v_order.pos_claim_expires_at <= now() then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_CLAIM_EXPIRED');
  end if;

  if v_order.pos_claim_token is distinct from p_claim_token
     or v_order.pos_claim_actor_ref <> p_auth->>'device_id' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID');
  end if;

  update public.ecommerce_orders
  set pos_draft_status = 'prepared',
      pos_draft_id = v_draft_id,
      pos_draft_prepared_at = now(),
      updated_at = now()
  where id = v_order.id
  returning * into v_order;

  v_fulfillment := private.ecommerce_ensure_pos_preparing_fulfillment_v1(
    v_order,
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
    p_auth->>'actor_label'
  );

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = v_order.id;

  insert into public.ecommerce_order_events(
    order_id,
    portal_id,
    license_id,
    event_type,
    actor_type,
    actor_ref,
    message,
    payload
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    'order_pos_draft_prepared',
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
    'Pedido preparado en Punto de Venta',
    jsonb_build_object(
      'draftId', v_draft_id,
      'deviceRole', p_auth->>'device_role',
      'actorLabel', p_auth->>'actor_label'
    )
  );

  -- The fulfillment update emits one public tracking revalidation through its
  -- existing trigger. This remains the single POS/admin notification for the
  -- draft confirmation itself.
  perform private.broadcast_ecommerce_order_change_v1(
    v_license_id,
    v_order.id,
    v_order.status,
    'order_pos_draft_prepared'
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
      || jsonb_build_object('fulfillment', private.ecommerce_fulfillment_public_json_v1(v_order))
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
end;
$$;

create or replace function private.ecommerce_begin_pos_conversion_authorized_v1(
  p_auth jsonb,
  p_order_id uuid,
  p_claim_token uuid,
  p_draft_id text,
  p_attempt_id text,
  p_sale_id text,
  p_conversion_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_fulfillment jsonb;
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
  v_expected_key text;
begin
  if coalesce((p_auth->>'success')::boolean, false) is false
     or nullif(p_auth->>'license_id', '') is null
     or nullif(p_auth->>'device_id', '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
  end if;

  if v_draft_id = '' or v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      'Faltan datos requeridos para reservar la conversion.'
    );
  end if;

  v_expected_key := 'ecommerce:' || p_order_id::text;
  if v_conversion_key <> v_expected_key or v_sale_id <> v_draft_id then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_KEY_INVALID',
      'La clave o el identificador de venta no corresponde al pedido.'
    );
  end if;

  v_license_id := (p_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if private.ecommerce_order_fulfillment_terminal_v1(v_order.fulfillment_status)
     and not (
       v_order.status = 'converted_to_sale'
       and v_order.converted_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key
     ) then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');
  end if;

  if v_order.converted_sale_id is not null
     or v_order.pos_conversion_status = 'completed'
     or v_order.status = 'converted_to_sale' then
    if v_order.converted_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key
       and v_order.status = 'converted_to_sale' then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'idempotent', true,
        'alreadyCompleted', true,
        'contractVersion', 2,
        'orderId', v_order.id,
        'conversionStatus', 'completed',
        'convertedSaleId', v_order.converted_sale_id,
        'conversionKey', v_order.pos_conversion_key
      );
    end if;

    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'El pedido ya fue convertido con una venta diferente.',
      jsonb_build_object('convertedSaleId', v_order.converted_sale_id)
    );
  end if;

  if v_order.pos_conversion_status = 'reserved' then
    if v_order.pos_conversion_actor_ref = p_auth->>'device_id'
       and v_order.pos_conversion_attempt_id = v_attempt_id
       and v_order.pos_conversion_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'idempotent', true,
        'contractVersion', 2,
        'orderId', v_order.id,
        'conversionStatus', 'reserved',
        'conversionAttemptId', v_order.pos_conversion_attempt_id,
        'reservedSaleId', v_order.pos_conversion_sale_id,
        'conversionStartedAt', v_order.pos_conversion_started_at,
        'conversionKey', v_order.pos_conversion_key
      );
    end if;

    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_IN_PROGRESS',
      'Este pedido ya esta reservado para conversion por otro intento.'
    );
  end if;

  if v_order.status <> 'accepted' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status <> 'prepared'
     or v_order.pos_draft_id <> v_draft_id then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_DRAFT_NOT_PREPARED',
      'El pedido ya no conserva el borrador preparado esperado.'
    );
  end if;

  if v_order.pos_claim_expires_at is null
     or v_order.pos_claim_expires_at <= now() then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_CLAIM_EXPIRED');
  end if;

  if v_order.pos_claim_token is distinct from p_claim_token
     or v_order.pos_claim_actor_ref <> p_auth->>'device_id' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CLAIM_LOST',
      'La reserva del pedido ya no pertenece a este dispositivo.'
    );
  end if;

  -- Defensive recovery for orders prepared by the pre-2.3 contract. It uses
  -- the row already locked above and is not the normal preparation mechanism.
  v_fulfillment := private.ecommerce_ensure_pos_preparing_fulfillment_v1(
    v_order,
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
    p_auth->>'actor_label'
  );
  if coalesce((v_fulfillment->>'changed')::boolean, false) then
    perform private.broadcast_ecommerce_order_change_v1(
      v_license_id,
      v_order.id,
      v_order.status,
      'order_fulfillment_preparing'
    );
  end if;

  update public.ecommerce_orders
  set pos_conversion_status = 'reserved',
      pos_conversion_attempt_id = v_attempt_id,
      pos_conversion_sale_id = v_sale_id,
      pos_conversion_key = v_conversion_key,
      pos_conversion_actor_ref = p_auth->>'device_id',
      pos_conversion_started_at = now(),
      updated_at = now()
  where id = v_order.id;

  insert into public.ecommerce_order_events(
    order_id,
    portal_id,
    license_id,
    event_type,
    actor_type,
    actor_ref,
    message,
    payload
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    'pos_conversion_reserved',
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
    'Pedido reservado para conversion en Punto de Venta',
    jsonb_build_object(
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'deviceRole', p_auth->>'device_role'
    )
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'orderId', v_order.id,
    'conversionStatus', 'reserved',
    'conversionAttemptId', v_attempt_id,
    'reservedSaleId', v_sale_id,
    'conversionStartedAt', now(),
    'conversionKey', v_conversion_key
  );
exception
  when unique_violation then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'La clave de conversion ya fue utilizada por otro pedido.'
    );
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_RESERVATION_FAILED',
      'No se pudo reservar el pedido para conversion.'
    );
end;
$$;

create or replace function private.ecommerce_complete_pos_conversion_authorized_v1(
  p_auth jsonb,
  p_order_id uuid,
  p_claim_token uuid,
  p_draft_id text,
  p_attempt_id text,
  p_sale_id text,
  p_conversion_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_fulfillment jsonb;
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
begin
  if coalesce((p_auth->>'success')::boolean, false) is false
     or nullif(p_auth->>'license_id', '') is null
     or nullif(p_auth->>'device_id', '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
  end if;

  if v_draft_id = '' or v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      'Faltan datos requeridos para confirmar la conversion.'
    );
  end if;

  v_license_id := (p_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if private.ecommerce_order_fulfillment_terminal_v1(v_order.fulfillment_status)
     and not (
       v_order.status = 'converted_to_sale'
       and v_order.converted_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key
     ) then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_FULFILLMENT_TERMINAL');
  end if;

  if v_order.converted_sale_id is not null
     or v_order.pos_conversion_status = 'completed'
     or v_order.status = 'converted_to_sale' then
    if v_order.converted_sale_id = v_sale_id
       and v_order.pos_conversion_key = v_conversion_key
       and v_order.status = 'converted_to_sale' then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'idempotent', true,
        'contractVersion', 2,
        'orderId', v_order.id,
        'orderStatus', v_order.status,
        'conversionStatus', 'completed',
        'convertedSaleId', v_order.converted_sale_id,
        'convertedAt', v_order.converted_at,
        'conversionKey', v_order.pos_conversion_key
      );
    end if;

    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'El pedido ya fue convertido con una venta diferente.',
      jsonb_build_object('convertedSaleId', v_order.converted_sale_id)
    );
  end if;

  if v_order.status <> 'accepted' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status <> 'prepared'
     or v_order.pos_draft_id <> v_draft_id then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_NOT_PREPARED');
  end if;

  if v_order.pos_conversion_status <> 'reserved'
     or v_order.pos_conversion_actor_ref <> p_auth->>'device_id'
     or v_order.pos_conversion_attempt_id <> v_attempt_id
     or v_order.pos_conversion_sale_id <> v_sale_id
     or v_order.pos_conversion_key <> v_conversion_key
     or v_order.pos_claim_token is distinct from p_claim_token then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_RESERVATION_LOST',
      'La reserva remota de conversion ya no coincide con este intento.'
    );
  end if;

  -- A legacy reservation may reach complete without invoking begin under the
  -- fixed contract. Repair only the known accepted/prepared inconsistency.
  v_fulfillment := private.ecommerce_ensure_pos_preparing_fulfillment_v1(
    v_order,
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
    p_auth->>'actor_label'
  );

  update public.ecommerce_orders
  set status = 'converted_to_sale',
      converted_sale_id = v_sale_id,
      converted_at = now(),
      pos_conversion_status = 'completed',
      pos_visibility_status = 'archived',
      updated_at = now()
  where id = v_order.id;

  insert into public.ecommerce_order_events(
    order_id,
    portal_id,
    license_id,
    event_type,
    actor_type,
    actor_ref,
    message,
    payload
  ) values (
    v_order.id,
    v_order.portal_id,
    v_order.license_id,
    'order_converted_to_pos_sale',
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), p_auth->>'device_id'),
    'Pedido convertido en venta de Punto de Venta',
    jsonb_build_object(
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'deviceRole', p_auth->>'device_role',
      'actorLabel', p_auth->>'actor_label'
    )
  );

  perform private.broadcast_ecommerce_order_change_v1(
    v_license_id,
    v_order.id,
    'converted_to_sale',
    'order_converted_to_pos_sale'
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'orderId', v_order.id,
    'orderStatus', 'converted_to_sale',
    'conversionStatus', 'completed',
    'convertedSaleId', v_sale_id,
    'convertedAt', now(),
    'conversionKey', v_conversion_key
  );
exception
  when unique_violation then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CONFLICT',
      'La clave de conversion ya fue utilizada por otro pedido.'
    );
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_FAILED',
      'La venta fue registrada, pero no se pudo confirmar el pedido online.'
    );
end;
$$;

-- Conservative compensating backfill. It only changes the exact legacy split
-- state and relies on the same idempotent helper/event contract as live RPCs.
do $$
declare
  v_order public.ecommerce_orders%rowtype;
begin
  for v_order in
    select o.*
    from public.ecommerce_orders o
    where o.pos_draft_status = 'prepared'
      and o.fulfillment_status = 'accepted'
      and o.status in ('accepted', 'converted_to_sale')
    order by o.created_at, o.id
    for update
  loop
    perform private.ecommerce_ensure_pos_preparing_fulfillment_v1(
      v_order,
      'automation',
      'ecom_orders_2_3_backfill',
      null
    );
  end loop;
end;
$$;

alter function private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders, text, text, text) owner to postgres;
alter function private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb, uuid, uuid, text) owner to postgres;
alter function private.ecommerce_begin_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) owner to postgres;
alter function private.ecommerce_complete_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) owner to postgres;

revoke all on function private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders, text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_begin_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_complete_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) from public, anon, authenticated;

revoke all on function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) from public;
revoke all on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;

grant execute on function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
