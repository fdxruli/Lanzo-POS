-- ECOM.ORDERS.2.2 — Single authorization for POS mutation wrappers.
-- Compensatory migration. Public signatures and cleanup/read routes remain unchanged.

create or replace function private.ecommerce_admin_claim_pos_draft_authorized_v1(
  p_auth jsonb,
  p_order_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_request_key text := left(btrim(coalesce(p_request_key, '')), 160);
  v_device_ref text;
  v_new_token uuid;
  v_changed boolean := false;
begin
  if coalesce((p_auth->>'success')::boolean, false) is false
     or nullif(p_auth->>'license_id', '') is null
     or nullif(p_auth->>'device_id', '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
  end if;

  if v_request_key = '' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
  end if;

  v_license_id := (p_auth->>'license_id')::uuid;
  v_device_ref := p_auth->>'device_id';

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

  if v_order.status <> 'accepted' or v_order.converted_sale_id is not null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status = 'prepared' then
    if v_order.pos_claim_request_key = v_request_key
       and v_order.pos_claim_actor_ref = v_device_ref then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
      );
    end if;
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_ALREADY_PREPARED');
  end if;

  if v_order.pos_draft_status = 'claimed'
     and v_order.pos_claim_expires_at > now() then
    if v_order.pos_claim_request_key = v_request_key
       and v_order.pos_claim_actor_ref = v_device_ref then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
      );
    end if;
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_IN_PROGRESS');
  end if;

  v_new_token := extensions.gen_random_uuid();

  update public.ecommerce_orders
  set pos_draft_status = 'claimed',
      pos_draft_id = null,
      pos_claim_token = v_new_token,
      pos_claim_request_key = v_request_key,
      pos_claimed_at = now(),
      pos_claim_expires_at = now() + interval '15 minutes',
      pos_claim_actor_type = p_auth->>'actor_type',
      pos_claim_actor_ref = v_device_ref,
      pos_draft_prepared_at = null,
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
    'order_pos_draft_claimed',
    p_auth->>'actor_type',
    coalesce(nullif(p_auth->>'staff_user_id', ''), v_device_ref),
    'Pedido reservado para preparacion en POS',
    jsonb_build_object(
      'deviceRole', p_auth->>'device_role',
      'actorLabel', p_auth->>'actor_label'
    )
  );

  v_changed := true;
  perform private.broadcast_ecommerce_order_change_v1(
    v_license_id,
    v_order.id,
    v_order.status,
    'order_pos_draft_claimed'
  );

  return jsonb_build_object(
    'success', true,
    'changed', v_changed,
    'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
end;
$function$;

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
as $function$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
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

  if v_order.status <> 'accepted' or v_order.converted_sale_id is not null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status = 'prepared' then
    if v_order.pos_claim_token = p_claim_token
       and v_order.pos_draft_id = v_draft_id
       and v_order.pos_claim_actor_ref = p_auth->>'device_id' then
      return jsonb_build_object(
        'success', true,
        'changed', false,
        'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
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

  perform private.broadcast_ecommerce_order_change_v1(
    v_license_id,
    v_order.id,
    v_order.status,
    'order_pos_draft_prepared'
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, p_auth)
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
end;
$function$;

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
as $function$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
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
$function$;

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
as $function$
declare
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
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
$function$;

create or replace function public.ecommerce_admin_claim_pos_draft(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_claim_pos_draft'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;
  return private.ecommerce_admin_claim_pos_draft_authorized_v1(v_auth, p_order_id, p_request_key);
end;
$function$;

create or replace function public.ecommerce_admin_confirm_pos_draft(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_draft_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_confirm_pos_draft'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;
  return private.ecommerce_admin_confirm_pos_draft_authorized_v1(v_auth, p_order_id, p_claim_token, p_draft_id);
end;
$function$;

create or replace function public.ecommerce_begin_pos_conversion(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
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
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_begin_pos_conversion'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;
  return private.ecommerce_begin_pos_conversion_authorized_v1(
    v_auth, p_order_id, p_claim_token, p_draft_id,
    p_attempt_id, p_sale_id, p_conversion_key
  );
end;
$function$;

create or replace function public.ecommerce_complete_pos_conversion(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
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
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_complete_pos_conversion'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;
  return private.ecommerce_complete_pos_conversion_authorized_v1(
    v_auth, p_order_id, p_claim_token, p_draft_id,
    p_attempt_id, p_sale_id, p_conversion_key
  );
end;
$function$;

revoke all on function private.ecommerce_admin_claim_pos_draft_authorized_v1(jsonb, uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.ecommerce_begin_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_complete_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) from public, anon, authenticated;

revoke all on function public.ecommerce_admin_claim_pos_draft(text, text, text, text, uuid, text) from public;
revoke all on function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) from public;
revoke all on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;

grant execute on function public.ecommerce_admin_claim_pos_draft(text, text, text, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated, service_role;

alter function private.ecommerce_admin_claim_pos_draft_authorized_v1(jsonb, uuid, text) owner to postgres;
alter function private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb, uuid, uuid, text) owner to postgres;
alter function private.ecommerce_begin_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) owner to postgres;
alter function private.ecommerce_complete_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text) owner to postgres;
alter function public.ecommerce_admin_claim_pos_draft(text, text, text, text, uuid, text) owner to postgres;
alter function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) owner to postgres;
alter function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) owner to postgres;
alter function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) owner to postgres;

comment on function private.ecommerce_admin_claim_pos_draft_authorized_v1(jsonb, uuid, text)
is 'ECOM.ORDERS.2.2: executes claim with a pre-authorized POS context and a row lock.';
comment on function private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb, uuid, uuid, text)
is 'ECOM.ORDERS.2.2: confirms a POS draft with a pre-authorized context and a row lock.';
comment on function private.ecommerce_begin_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text)
is 'ECOM.ORDERS.2.2: reserves POS conversion with one authorization and a terminal guard under the mutation lock.';
comment on function private.ecommerce_complete_pos_conversion_authorized_v1(jsonb, uuid, uuid, text, text, text, text)
is 'ECOM.ORDERS.2.2: completes POS conversion with one authorization and a terminal guard under the mutation lock.';
