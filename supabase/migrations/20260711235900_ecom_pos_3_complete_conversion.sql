-- FASE ECOM.POS.3
-- Contrato remoto atomico e idempotente para reservar y completar la
-- conversion de un pedido ecommerce en una venta POS.
--
-- IMPORTANTE: esta migracion se versiona, pero no se aplica a produccion desde
-- este PR. El frontend debe permanecer fail-closed hasta que contractVersion=2
-- sea autorizado, aplicado y validado.

alter table public.ecommerce_orders
  add column if not exists converted_at timestamptz,
  add column if not exists pos_conversion_key text,
  add column if not exists pos_conversion_status text not null default 'idle',
  add column if not exists pos_conversion_attempt_id text,
  add column if not exists pos_conversion_sale_id text,
  add column if not exists pos_conversion_actor_ref text,
  add column if not exists pos_conversion_started_at timestamptz;

update public.ecommerce_orders
set pos_conversion_status = case
  when converted_sale_id is not null then 'completed'
  else 'idle'
end
where pos_conversion_status is null
   or pos_conversion_status not in ('idle', 'reserved', 'completed');

do $block$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint c
    where c.conname = 'ecommerce_orders_pos_conversion_status_valid'
      and c.conrelid = 'public.ecommerce_orders'::regclass
  ) then
    alter table public.ecommerce_orders
      add constraint ecommerce_orders_pos_conversion_status_valid
      check (pos_conversion_status in ('idle', 'reserved', 'completed'));
  end if;
end;
$block$;

create unique index if not exists ux_ecommerce_orders_license_pos_conversion_key
  on public.ecommerce_orders (license_id, pos_conversion_key)
  where pos_conversion_key is not null;

create or replace function public.ecommerce_get_pos_conversion_state(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_is_claim_owner boolean := false;
  v_claim_valid boolean := false;
  v_is_conversion_owner boolean := false;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_get_pos_conversion_state'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  limit 1;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  v_is_claim_owner := v_order.pos_draft_status = 'prepared'
    and v_order.pos_claim_token is not null
    and v_order.pos_claim_token is not distinct from p_claim_token
    and v_order.pos_claim_actor_ref = nullif(v_auth->>'device_id', '');

  v_claim_valid := v_is_claim_owner
    and v_order.pos_claim_expires_at is not null
    and v_order.pos_claim_expires_at > now();

  v_is_conversion_owner := v_order.pos_conversion_status = 'reserved'
    and v_order.pos_conversion_actor_ref = nullif(v_auth->>'device_id', '');

  return jsonb_build_object(
    'success', true,
    'contractVersion', 2,
    'orderId', v_order.id,
    'orderStatus', v_order.status,
    'draftStatus', v_order.pos_draft_status,
    'draftId', v_order.pos_draft_id,
    'claimOwned', v_is_claim_owner,
    'claimValid', v_claim_valid,
    'claimExpiresAt', v_order.pos_claim_expires_at,
    'conversionStatus', v_order.pos_conversion_status,
    'conversionOwned', v_is_conversion_owner,
    'conversionAttemptId', case when v_is_conversion_owner then v_order.pos_conversion_attempt_id else null end,
    'reservedSaleId', v_order.pos_conversion_sale_id,
    'conversionStartedAt', v_order.pos_conversion_started_at,
    'convertedSaleId', v_order.converted_sale_id,
    'convertedAt', v_order.converted_at,
    'conversionKey', v_order.pos_conversion_key
  );
exception
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_STATE_FAILED',
      'No se pudo verificar el estado remoto de conversion del pedido.'
    );
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
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
  v_expected_key text;
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

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if v_order.converted_sale_id is not null then
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
    if v_order.pos_conversion_actor_ref = v_auth->>'device_id'
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
     or v_order.pos_claim_actor_ref <> v_auth->>'device_id' then
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
      pos_conversion_actor_ref = v_auth->>'device_id',
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
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Pedido reservado para conversion en Punto de Venta',
    jsonb_build_object(
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'deviceRole', v_auth->>'device_role'
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

create or replace function public.ecommerce_cancel_pos_conversion(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_attempt_id text,
  p_sale_id text,
  p_conversion_key text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
  v_reason text := left(btrim(coalesce(p_reason, 'cancelled_before_sale')), 120);
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_cancel_pos_conversion'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  if v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT');
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if v_order.converted_sale_id is not null or v_order.pos_conversion_status = 'completed' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED',
      'La conversion ya fue completada y no puede cancelarse.'
    );
  end if;

  if v_order.pos_conversion_status = 'idle' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'idempotent', true,
      'contractVersion', 2,
      'orderId', v_order.id,
      'conversionStatus', 'idle'
    );
  end if;

  if v_order.pos_conversion_actor_ref <> v_auth->>'device_id'
     or v_order.pos_conversion_attempt_id <> v_attempt_id
     or v_order.pos_conversion_sale_id <> v_sale_id
     or v_order.pos_conversion_key <> v_conversion_key
     or v_order.pos_claim_token is distinct from p_claim_token then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CLAIM_LOST',
      'La reserva de conversion pertenece a otro intento o dispositivo.'
    );
  end if;

  update public.ecommerce_orders
  set pos_conversion_status = 'idle',
      pos_conversion_attempt_id = null,
      pos_conversion_sale_id = null,
      pos_conversion_key = null,
      pos_conversion_actor_ref = null,
      pos_conversion_started_at = null,
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
    'pos_conversion_cancelled',
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Reserva de conversion POS cancelada antes de crear la venta',
    jsonb_build_object('reason', v_reason, 'saleId', v_sale_id)
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'idempotent', false,
    'contractVersion', 2,
    'orderId', v_order.id,
    'conversionStatus', 'idle'
  );
exception
  when others then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_CANCEL_FAILED',
      'No se pudo liberar la reserva remota de conversion.'
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
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
  v_attempt_id text := left(btrim(coalesce(p_attempt_id, '')), 200);
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
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

  if v_draft_id = '' or v_attempt_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      'Faltan datos requeridos para confirmar la conversion.'
    );
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
  for update;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if v_order.converted_sale_id is not null then
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
     or v_order.pos_conversion_actor_ref <> v_auth->>'device_id'
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
    v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'),
    'Pedido convertido en venta de Punto de Venta',
    jsonb_build_object(
      'saleId', v_sale_id,
      'conversionKey', v_conversion_key,
      'deviceRole', v_auth->>'device_role',
      'actorLabel', v_auth->>'actor_label'
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

revoke all on function public.ecommerce_get_pos_conversion_state(text, text, text, text, uuid, uuid) from public;
revoke all on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_cancel_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;
revoke all on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) from public;

grant execute on function public.ecommerce_get_pos_conversion_state(text, text, text, text, uuid, uuid) to anon, authenticated;
grant execute on function public.ecommerce_begin_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_cancel_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text, text) to anon, authenticated;

revoke all on table public.ecommerce_orders from public, anon, authenticated;
revoke all on table public.ecommerce_order_events from public, anon, authenticated;
