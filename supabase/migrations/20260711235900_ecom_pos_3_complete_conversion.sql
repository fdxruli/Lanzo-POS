-- FASE ECOM.POS.3
-- Contrato remoto atomico e idempotente para convertir un pedido ecommerce
-- preparado en una venta POS ya creada.
--
-- IMPORTANTE: esta migracion se versiona, pero no se aplica a produccion desde
-- este PR. El frontend debe permanecer fail-closed hasta que contractVersion=1
-- sea autorizado, aplicado y validado.

alter table public.ecommerce_orders
  add column if not exists converted_at timestamptz,
  add column if not exists pos_conversion_key text;

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
  v_is_owner boolean := false;
  v_claim_valid boolean := false;
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

  v_is_owner := v_order.pos_draft_status = 'prepared'
    and v_order.pos_claim_token is not null
    and v_order.pos_claim_token is not distinct from p_claim_token
    and v_order.pos_claim_actor_ref = nullif(v_auth->>'device_id', '');

  v_claim_valid := v_is_owner
    and v_order.pos_claim_expires_at is not null
    and v_order.pos_claim_expires_at > now();

  return jsonb_build_object(
    'success', true,
    'contractVersion', 1,
    'orderId', v_order.id,
    'orderStatus', v_order.status,
    'draftStatus', v_order.pos_draft_status,
    'draftId', v_order.pos_draft_id,
    'claimOwned', v_is_owner,
    'claimValid', v_claim_valid,
    'claimExpiresAt', v_order.pos_claim_expires_at,
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

create or replace function public.ecommerce_complete_pos_conversion(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_draft_id text,
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
  v_sale_id text := left(btrim(coalesce(p_sale_id, '')), 200);
  v_conversion_key text := left(btrim(coalesce(p_conversion_key, '')), 240);
  v_expected_key text;
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

  if v_draft_id = '' or v_sale_id = '' or v_conversion_key = '' then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_INVALID_ARGUMENT',
      'Faltan datos requeridos para confirmar la conversion.'
    );
  end if;

  v_expected_key := 'ecommerce:' || p_order_id::text;
  if v_conversion_key <> v_expected_key then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_POS_CONVERSION_KEY_INVALID',
      'La clave de conversion no corresponde al pedido.'
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
        'contractVersion', 1,
        'orderId', v_order.id,
        'orderStatus', v_order.status,
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
  set status = 'converted_to_sale',
      converted_sale_id = v_sale_id,
      converted_at = now(),
      pos_conversion_key = v_conversion_key,
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
    'contractVersion', 1,
    'orderId', v_order.id,
    'orderStatus', 'converted_to_sale',
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
revoke all on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text) from public;

grant execute on function public.ecommerce_get_pos_conversion_state(text, text, text, text, uuid, uuid) to anon, authenticated;
grant execute on function public.ecommerce_complete_pos_conversion(text, text, text, text, uuid, uuid, text, text, text) to anon, authenticated;

revoke all on table public.ecommerce_orders from public, anon, authenticated;
revoke all on table public.ecommerce_order_events from public, anon, authenticated;
