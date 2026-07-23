-- ECOM.POS.1 - claim seguro y preparacion local de pedidos ecommerce.

alter table public.ecommerce_orders
  add column pos_draft_status text not null default 'none',
  add column pos_draft_id text,
  add column pos_claim_token uuid,
  add column pos_claim_request_key text,
  add column pos_claimed_at timestamptz,
  add column pos_claim_expires_at timestamptz,
  add column pos_claim_actor_type text,
  add column pos_claim_actor_ref text,
  add column pos_draft_prepared_at timestamptz;

alter table public.ecommerce_orders
  add constraint ecommerce_orders_pos_draft_status_valid
    check (pos_draft_status in ('none', 'claimed', 'prepared', 'released')),
  add constraint ecommerce_orders_pos_draft_state_coherent check (
    (
      pos_draft_status in ('none', 'released')
      and pos_draft_id is null
      and pos_claim_token is null
      and pos_claim_request_key is null
      and pos_claimed_at is null
      and pos_claim_expires_at is null
      and pos_claim_actor_type is null
      and pos_claim_actor_ref is null
      and pos_draft_prepared_at is null
    ) or (
      pos_draft_status = 'claimed'
      and pos_draft_id is null
      and pos_claim_token is not null
      and nullif(btrim(pos_claim_request_key), '') is not null
      and pos_claimed_at is not null
      and pos_claim_expires_at > pos_claimed_at
      and pos_claim_actor_type in ('admin', 'staff')
      and nullif(btrim(pos_claim_actor_ref), '') is not null
      and pos_draft_prepared_at is null
    ) or (
      pos_draft_status = 'prepared'
      and nullif(btrim(pos_draft_id), '') is not null
      and pos_claim_token is not null
      and nullif(btrim(pos_claim_request_key), '') is not null
      and pos_claimed_at is not null
      and pos_claim_expires_at > pos_claimed_at
      and pos_claim_actor_type in ('admin', 'staff')
      and nullif(btrim(pos_claim_actor_ref), '') is not null
      and pos_draft_prepared_at >= pos_claimed_at
    )
  );

create index ix_ecommerce_orders_license_pos_draft_expiry
  on public.ecommerce_orders (license_id, pos_draft_status, pos_claim_expires_at);

create or replace function private.ecommerce_orders_error_v1(
  p_code text,
  p_message text default null,
  p_details jsonb default null
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'success', false,
    'code', coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_ORDER_ACTION_FAILED'),
    'message', coalesce(p_message, case coalesce(nullif(btrim(p_code), ''), 'ECOMMERCE_ORDER_ACTION_FAILED')
      when 'ECOMMERCE_ORDERS_ACCESS_DENIED' then 'No tienes permiso para administrar pedidos online.'
      when 'ECOMMERCE_ORDER_INBOX_DISABLED' then 'La bandeja de pedidos online no esta disponible para esta licencia.'
      when 'ECOMMERCE_STAFF_SESSION_REQUIRED' then 'Inicia sesion como personal para administrar pedidos online.'
      when 'ECOMMERCE_STAFF_SESSION_INVALID' then 'Tu sesion de personal no es valida. Inicia sesion nuevamente.'
      when 'ECOMMERCE_STAFF_PERMISSION_DENIED' then 'Tu usuario no tiene permiso para administrar pedidos online.'
      when 'ECOMMERCE_ORDERS_RATE_LIMITED' then 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.'
      when 'ECOMMERCE_ORDER_NOT_FOUND' then 'El pedido no existe o no esta disponible.'
      when 'ECOMMERCE_ORDER_INVALID_TRANSITION' then 'El pedido ya no permite esta accion.'
      when 'ECOMMERCE_REJECTION_REASON_REQUIRED' then 'Escribe un motivo de rechazo de al menos 3 caracteres.'
      when 'ECOMMERCE_REJECTION_REASON_TOO_LONG' then 'El motivo de rechazo no puede superar 300 caracteres.'
      when 'ECOMMERCE_POS_DRAFT_IN_PROGRESS' then 'Este pedido ya esta siendo preparado en otro dispositivo.'
      when 'ECOMMERCE_POS_DRAFT_ALREADY_PREPARED' then 'Este pedido ya tiene un borrador preparado en Punto de Venta.'
      when 'ECOMMERCE_POS_DRAFT_CLAIM_EXPIRED' then 'La reserva para preparar este pedido vencio. Intenta nuevamente.'
      when 'ECOMMERCE_POS_DRAFT_TOKEN_INVALID' then 'No se pudo validar la reserva de este borrador.'
      when 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' then 'Necesitas permisos de ecommerce y Punto de Venta para preparar este pedido.'
      when 'ECOMMERCE_POS_DRAFT_PREPARE_FAILED' then 'No se pudo preparar el pedido en Punto de Venta.'
      else 'No se pudo completar la accion sobre el pedido.'
    end),
    'details', p_details
  ));
$function$;

create or replace function private.ecommerce_pos_draft_authorize_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_rpc_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    p_rpc_name
  );

  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  if v_auth->>'actor_type' = 'staff'
     and coalesce((v_auth->'staff_permissions'->>'pos')::boolean, false) is not true then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
  end if;

  if nullif(v_auth->>'device_id', '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
  end if;

  return v_auth;
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PERMISSION_DENIED');
end;
$function$;

create or replace function private.ecommerce_order_event_public_payload_v1(
  p_event_type text,
  p_payload jsonb
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  select case coalesce(p_event_type, '')
    when 'order_created' then jsonb_strip_nulls(jsonb_build_object(
      'orderCode', p_payload->>'orderCode',
      'fulfillmentMethod', p_payload->>'fulfillmentMethod',
      'total', case when coalesce(p_payload->>'total', '') ~ '^-?[0-9]+([.][0-9]+)?$' then (p_payload->>'total')::numeric else null end
    ))
    when 'order_seen' then jsonb_strip_nulls(jsonb_build_object('fromStatus', p_payload->>'fromStatus', 'toStatus', p_payload->>'toStatus'))
    when 'order_accepted' then jsonb_strip_nulls(jsonb_build_object('fromStatus', p_payload->>'fromStatus', 'toStatus', p_payload->>'toStatus'))
    when 'order_rejected' then jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', p_payload->>'fromStatus',
      'toStatus', p_payload->>'toStatus',
      'reason', left(nullif(btrim(p_payload->>'reason'), ''), 300)
    ))
    when 'order_pos_draft_claimed' then jsonb_strip_nulls(jsonb_build_object(
      'deviceRole', left(nullif(btrim(p_payload->>'deviceRole'), ''), 20)
    ))
    when 'order_pos_draft_prepared' then jsonb_strip_nulls(jsonb_build_object(
      'draftId', left(nullif(btrim(p_payload->>'draftId'), ''), 200),
      'deviceRole', left(nullif(btrim(p_payload->>'deviceRole'), ''), 20)
    ))
    when 'order_pos_draft_released' then jsonb_strip_nulls(jsonb_build_object(
      'reasonCode', left(nullif(btrim(p_payload->>'reasonCode'), ''), 80),
      'deviceRole', left(nullif(btrim(p_payload->>'deviceRole'), ''), 20)
    ))
    else '{}'::jsonb
  end;
$function$;

create or replace function private.ecommerce_order_pos_snapshot_v1(
  p_order_id uuid,
  p_license_id uuid,
  p_auth jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_items jsonb;
  v_events jsonb;
  v_whatsapp_url text;
  v_is_owner boolean := false;
  v_can_pos boolean := false;
begin
  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = p_license_id
    and o.pos_visibility_status in ('pending', 'visible')
  limit 1;

  if v_order.id is null then return null; end if;

  v_can_pos := p_auth->>'actor_type' = 'admin'
    or coalesce((p_auth->'staff_permissions'->>'pos')::boolean, false) is true;
  v_is_owner := v_can_pos
    and v_order.pos_claim_token is not null
    and v_order.pos_claim_actor_ref = nullif(p_auth->>'device_id', '');

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'sourceProductId', i.source_product_id,
    'publishedProductId', i.published_product_id,
    'productName', i.product_name,
    'unitPrice', i.unit_price,
    'quantity', i.quantity,
    'lineTotal', i.line_total,
    'options', case when jsonb_typeof(i.options) = 'object' then i.options else '{}'::jsonb end
  ) order by i.created_at, i.id), '[]'::jsonb)
  into v_items
  from public.ecommerce_order_items i
  where i.order_id = v_order.id and i.license_id = p_license_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventType', e.event_type,
    'actorType', e.actor_type,
    'actorLabel', case e.actor_type
      when 'admin' then 'Administrador'
      when 'staff' then coalesce(nullif(left(btrim(e.payload->>'actorLabel'), 80), ''), 'Personal')
      when 'public_customer' then 'Cliente'
      when 'automation' then 'Automatizacion'
      else 'Sistema'
    end,
    'message', case e.event_type
      when 'order_created' then 'Pedido creado desde la tienda online.'
      when 'order_seen' then 'Pedido marcado como visto.'
      when 'order_accepted' then 'Pedido aceptado.'
      when 'order_rejected' then 'Pedido rechazado.'
      when 'order_pos_draft_claimed' then 'Pedido reservado para preparacion en POS.'
      when 'order_pos_draft_prepared' then 'Pedido preparado en Punto de Venta.'
      when 'order_pos_draft_released' then 'Borrador de Punto de Venta liberado.'
      else nullif(left(btrim(coalesce(e.message, '')), 200), '')
    end,
    'payload', private.ecommerce_order_event_public_payload_v1(e.event_type, e.payload),
    'createdAt', e.created_at
  ) order by e.created_at, e.id), '[]'::jsonb)
  into v_events
  from public.ecommerce_order_events e
  where e.order_id = v_order.id and e.license_id = p_license_id;

  v_whatsapp_url := private.ecommerce_build_whatsapp_url(
    v_order.customer_phone,
    'Hola, te contactamos sobre tu pedido ' || coalesce(v_order.public_order_code, 'online') || '.'
  );
  if v_whatsapp_url is not null and left(v_whatsapp_url, 14) <> 'https://wa.me/' then v_whatsapp_url := null; end if;

  return jsonb_build_object(
    'id', v_order.id,
    'code', v_order.public_order_code,
    'licenseIdentity', v_order.license_id,
    'status', v_order.status,
    'channel', v_order.channel,
    'fulfillmentMethod', v_order.fulfillment_method,
    'customer', jsonb_build_object('name', v_order.customer_name, 'phone', v_order.customer_phone, 'address', v_order.customer_address, 'notes', v_order.customer_notes),
    'totals', jsonb_build_object('subtotal', v_order.subtotal, 'deliveryFee', v_order.delivery_fee, 'discountTotal', v_order.discount_total, 'taxTotal', v_order.tax_total, 'total', v_order.total, 'currency', v_order.currency),
    'payment', jsonb_build_object('method', v_order.payment_method, 'status', v_order.payment_status),
    'timestamps', jsonb_build_object('createdAt', v_order.created_at, 'updatedAt', v_order.updated_at, 'seenAt', v_order.seen_at, 'acceptedAt', v_order.accepted_at, 'rejectedAt', v_order.rejected_at),
    'items', coalesce(v_items, '[]'::jsonb),
    'events', coalesce(v_events, '[]'::jsonb),
    'contact', jsonb_build_object('whatsappUrl', v_whatsapp_url),
    'posDraft', jsonb_strip_nulls(jsonb_build_object(
      'status', v_order.pos_draft_status,
      'draftId', v_order.pos_draft_id,
      'claimedAt', v_order.pos_claimed_at,
      'expiresAt', v_order.pos_claim_expires_at,
      'preparedAt', v_order.pos_draft_prepared_at,
      'isClaimedByCurrentActor', v_is_owner,
      'claimToken', case when v_is_owner then v_order.pos_claim_token else null end
    ))
  );
end;
$function$;

create or replace function public.ecommerce_admin_get_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_snapshot jsonb;
begin
  v_auth := private.ecommerce_orders_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_get_order');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;
  v_snapshot := private.ecommerce_order_pos_snapshot_v1(p_order_id, v_license_id, v_auth);
  if v_snapshot is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  return jsonb_build_object('success', true, 'order', v_snapshot);
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
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
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_request_key text := left(btrim(coalesce(p_request_key, '')), 160);
  v_device_ref text;
  v_new_token uuid;
  v_changed boolean := false;
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_claim_pos_draft');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  if v_request_key = '' then return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED'); end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_device_ref := v_auth->>'device_id';

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id and o.license_id = v_license_id and o.pos_visibility_status in ('pending', 'visible')
  for update;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status <> 'accepted' or v_order.converted_sale_id is not null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION');
  end if;

  if v_order.pos_draft_status = 'prepared' then
    if v_order.pos_claim_request_key = v_request_key and v_order.pos_claim_actor_ref = v_device_ref then
      return jsonb_build_object('success', true, 'changed', false, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
    end if;
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_ALREADY_PREPARED');
  end if;

  if v_order.pos_draft_status = 'claimed' and v_order.pos_claim_expires_at > now() then
    if v_order.pos_claim_request_key = v_request_key and v_order.pos_claim_actor_ref = v_device_ref then
      return jsonb_build_object('success', true, 'changed', false, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
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
      pos_claim_actor_type = v_auth->>'actor_type',
      pos_claim_actor_ref = v_device_ref,
      pos_draft_prepared_at = null,
      updated_at = now()
  where id = v_order.id;

  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (v_order.id, v_order.portal_id, v_order.license_id, 'order_pos_draft_claimed', v_auth->>'actor_type', coalesce(nullif(v_auth->>'staff_user_id', ''), v_device_ref), 'Pedido reservado para preparacion en POS', jsonb_build_object('deviceRole', v_auth->>'device_role', 'actorLabel', v_auth->>'actor_label'));
  v_changed := true;
  perform private.broadcast_ecommerce_order_change_v1(v_license_id, v_order.id, v_order.status, 'order_pos_draft_claimed');
  return jsonb_build_object('success', true, 'changed', v_changed, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
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
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_order public.ecommerce_orders%rowtype;
  v_draft_id text := left(btrim(coalesce(p_draft_id, '')), 200);
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_confirm_pos_draft');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  if v_draft_id = '' then return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED'); end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  select o.* into v_order from public.ecommerce_orders o
  where o.id = p_order_id and o.license_id = v_license_id and o.pos_visibility_status in ('pending', 'visible')
  for update;
  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status <> 'accepted' or v_order.converted_sale_id is not null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION'); end if;

  if v_order.pos_draft_status = 'prepared' then
    if v_order.pos_claim_token = p_claim_token and v_order.pos_draft_id = v_draft_id and v_order.pos_claim_actor_ref = v_auth->>'device_id' then
      return jsonb_build_object('success', true, 'changed', false, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
    end if;
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_ALREADY_PREPARED');
  end if;
  if v_order.pos_draft_status <> 'claimed' then return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID'); end if;
  if v_order.pos_claim_expires_at <= now() then return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_CLAIM_EXPIRED'); end if;
  if v_order.pos_claim_token is distinct from p_claim_token or v_order.pos_claim_actor_ref <> v_auth->>'device_id' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID');
  end if;

  update public.ecommerce_orders
  set pos_draft_status = 'prepared', pos_draft_id = v_draft_id, pos_draft_prepared_at = now(), updated_at = now()
  where id = v_order.id;
  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (v_order.id, v_order.portal_id, v_order.license_id, 'order_pos_draft_prepared', v_auth->>'actor_type', coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'), 'Pedido preparado en Punto de Venta', jsonb_build_object('draftId', v_draft_id, 'deviceRole', v_auth->>'device_role', 'actorLabel', v_auth->>'actor_label'));
  perform private.broadcast_ecommerce_order_change_v1(v_license_id, v_order.id, v_order.status, 'order_pos_draft_prepared');
  return jsonb_build_object('success', true, 'changed', true, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_release_pos_draft(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_order_id uuid,
  p_claim_token uuid,
  p_reason text
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
  v_reason text := left(coalesce(nullif(btrim(p_reason), ''), 'abandoned'), 80);
begin
  v_auth := private.ecommerce_pos_draft_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_release_pos_draft');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;
  select o.* into v_order from public.ecommerce_orders o
  where o.id = p_order_id and o.license_id = v_license_id and o.pos_visibility_status in ('pending', 'visible')
  for update;
  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status <> 'accepted' or v_order.converted_sale_id is not null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION'); end if;
  if v_order.pos_draft_status = 'released' then
    return jsonb_build_object('success', true, 'changed', false, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
  end if;
  if v_order.pos_draft_status not in ('claimed', 'prepared') then return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID'); end if;
  if v_auth->>'actor_type' <> 'admin' and (
    v_order.pos_claim_actor_ref <> v_auth->>'device_id' or v_order.pos_claim_token is distinct from p_claim_token
  ) then return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_TOKEN_INVALID'); end if;

  update public.ecommerce_orders
  set pos_draft_status = 'released', pos_draft_id = null, pos_claim_token = null, pos_claim_request_key = null,
      pos_claimed_at = null, pos_claim_expires_at = null, pos_claim_actor_type = null, pos_claim_actor_ref = null,
      pos_draft_prepared_at = null, updated_at = now()
  where id = v_order.id;
  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (v_order.id, v_order.portal_id, v_order.license_id, 'order_pos_draft_released', v_auth->>'actor_type', coalesce(nullif(v_auth->>'staff_user_id', ''), v_auth->>'device_id'), 'Borrador de Punto de Venta liberado', jsonb_build_object('reasonCode', v_reason, 'deviceRole', v_auth->>'device_role', 'actorLabel', v_auth->>'actor_label'));
  perform private.broadcast_ecommerce_order_change_v1(v_license_id, v_order.id, v_order.status, 'order_pos_draft_released');
  return jsonb_build_object('success', true, 'changed', true, 'order', private.ecommerce_order_pos_snapshot_v1(v_order.id, v_license_id, v_auth));
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_POS_DRAFT_PREPARE_FAILED');
end;
$function$;

revoke all on function private.ecommerce_pos_draft_authorize_v1(text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_order_pos_snapshot_v1(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_orders_error_v1(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_order_event_public_payload_v1(text, jsonb) from public, anon, authenticated;

revoke all on function public.ecommerce_admin_claim_pos_draft(text, text, text, text, uuid, text) from public;
revoke all on function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) from public;
revoke all on function public.ecommerce_admin_release_pos_draft(text, text, text, text, uuid, uuid, text) from public;
grant execute on function public.ecommerce_admin_claim_pos_draft(text, text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.ecommerce_admin_confirm_pos_draft(text, text, text, text, uuid, uuid, text) to anon, authenticated;
grant execute on function public.ecommerce_admin_release_pos_draft(text, text, text, text, uuid, uuid, text) to anon, authenticated;

revoke all on table public.ecommerce_orders from public, anon, authenticated;
revoke all on table public.ecommerce_order_items from public, anon, authenticated;
revoke all on table public.ecommerce_order_events from public, anon, authenticated;
revoke all on table public.license_devices from public, anon, authenticated;
revoke all on table public.license_staff_users from public, anon, authenticated;
revoke all on table public.license_staff_sessions from public, anon, authenticated;
;
