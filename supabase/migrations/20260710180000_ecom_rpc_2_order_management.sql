-- ECOM.RPC.2 — contratos administrativos seguros para pedidos ecommerce.

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
      else 'No se pudo completar la accion sobre el pedido.'
    end),
    'details', p_details
  ));
$function$;

create or replace function private.ecommerce_orders_authorize_v1(
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
  v_rate_limit jsonb;
  v_context jsonb;
  v_device_role text;
  v_permissions jsonb;
  v_license_id uuid;
  v_actor_label text;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDERS_ACCESS_DENIED');
  end if;

  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := coalesce(nullif(btrim(p_rpc_name), ''), 'ecommerce_orders'),
    p_scope := 'ECOM_ORDERS',
    p_max_attempts := 240,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_ORDERS_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'phase', 'ECOM.RPC.2',
      'actor_partition', 'device'
    )
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_orders_error_v1(
      'ECOMMERCE_ORDERS_RATE_LIMITED',
      null,
      jsonb_build_object(
        'retryAfterSeconds',
        nullif(v_rate_limit->>'retry_after_seconds', '')::integer
      )
    );
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      p_license_key,
      p_device_fingerprint,
      p_security_token,
      p_staff_session_token
    );
  exception
    when others then
      return private.ecommerce_orders_error_v1(case sqlerrm
        when 'STAFF_SESSION_REQUIRED' then 'ECOMMERCE_STAFF_SESSION_REQUIRED'
        when 'STAFF_LOGIN_REQUIRED' then 'ECOMMERCE_STAFF_SESSION_REQUIRED'
        when 'STAFF_SESSION_INVALID' then 'ECOMMERCE_STAFF_SESSION_INVALID'
        when 'STAFF_SESSION_EXPIRED' then 'ECOMMERCE_STAFF_SESSION_INVALID'
        when 'STAFF_USER_INACTIVE' then 'ECOMMERCE_STAFF_SESSION_INVALID'
        else 'ECOMMERCE_ORDERS_ACCESS_DENIED'
      end);
  end;

  v_license_id := nullif(v_context->>'license_id', '')::uuid;
  if v_license_id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDERS_ACCESS_DENIED');
  end if;

  if private.ecommerce_license_feature_bool(
    p_license_id := v_license_id,
    p_feature_key := 'ecommerce_order_inbox',
    p_default := false
  ) is not true then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INBOX_DISABLED');
  end if;

  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');

  if v_device_role = 'admin' then
    return v_context || jsonb_build_object(
      'success', true,
      'actor_type', 'admin',
      'actor_label', 'Administrador'
    );
  end if;

  if v_device_role <> 'staff' then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDERS_ACCESS_DENIED');
  end if;

  if nullif(btrim(coalesce(p_staff_session_token, '')), '') is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_STAFF_SESSION_REQUIRED');
  end if;

  v_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);
  if coalesce((v_permissions->>'ecommerce')::boolean, false) is not true then
    return private.ecommerce_orders_error_v1('ECOMMERCE_STAFF_PERMISSION_DENIED');
  end if;

  v_actor_label := left(
    coalesce(
      nullif(btrim(v_context #>> '{staff_user,display_name}'), ''),
      nullif(btrim(v_context #>> '{staff_user,username}'), ''),
      'Personal'
    ),
    80
  );

  return v_context || jsonb_build_object(
    'success', true,
    'actor_type', 'staff',
    'actor_label', v_actor_label
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDERS_ACCESS_DENIED');
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
    when 'order_seen' then jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', p_payload->>'fromStatus',
      'toStatus', p_payload->>'toStatus'
    ))
    when 'order_accepted' then jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', p_payload->>'fromStatus',
      'toStatus', p_payload->>'toStatus'
    ))
    when 'order_rejected' then jsonb_strip_nulls(jsonb_build_object(
      'fromStatus', p_payload->>'fromStatus',
      'toStatus', p_payload->>'toStatus',
      'reason', left(nullif(btrim(p_payload->>'reason'), ''), 300)
    ))
    else '{}'::jsonb
  end;
$function$;

create or replace function private.broadcast_ecommerce_order_change_v1(
  p_license_id uuid,
  p_order_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_topic text;
  v_topics_count integer := 0;
  v_payload jsonb;
begin
  if p_license_id is null or p_order_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0);
  end if;

  if private.ecommerce_license_feature_bool(
    p_license_id,
    'ecommerce_realtime_orders',
    false
  ) is not true then
    return jsonb_build_object('success', true, 'broadcasted', false, 'topics_count', 0, 'code', 'REALTIME_DISABLED');
  end if;

  v_payload := jsonb_build_object(
    'event', 'ecommerce_orders_changed',
    'reason', coalesce(nullif(btrim(p_reason), ''), 'order_changed'),
    'created_at', now(),
    'metadata', jsonb_build_object(
      'source', 'ecommerce',
      'category', 'ecommerce',
      'order_id', p_order_id,
      'status', p_status
    )
  );

  for v_topic in
    select distinct d.realtime_topic
    from public.license_devices d
    where d.license_id = p_license_id
      and d.is_active is true
      and d.realtime_topic is not null
      and d.realtime_topic like 'license:%'
  loop
    perform realtime.send(v_payload, 'notification_event', v_topic, true);
    v_topics_count := v_topics_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'broadcasted', v_topics_count > 0,
    'topics_count', v_topics_count
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', coalesce(v_topics_count, 0),
      'code', 'ECOMMERCE_ORDER_BROADCAST_FAILED'
    );
end;
$function$;

create or replace function public.ecommerce_admin_list_orders(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_status text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_filter text;
  v_limit integer;
  v_offset integer;
  v_orders jsonb;
  v_counts jsonb;
  v_has_more boolean := false;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_list_orders'
  );

  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_filter := lower(btrim(coalesce(p_status, 'all')));
  if v_filter not in ('all', 'pending', 'new', 'seen', 'accepted', 'rejected') then
    v_filter := 'all';
  end if;

  v_limit := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_orders as (
    select
      o.id,
      o.public_order_code,
      o.status,
      o.customer_name,
      o.fulfillment_method,
      coalesce((
        select sum(i.quantity)
        from public.ecommerce_order_items i
        where i.order_id = o.id
      ), 0) as item_count,
      o.total,
      o.currency,
      o.created_at,
      o.seen_at,
      o.accepted_at,
      o.rejected_at
    from public.ecommerce_orders o
    where o.license_id = v_license_id
      and o.pos_visibility_status in ('pending', 'visible')
  ), filtered_orders as (
    select *
    from visible_orders
    where v_filter = 'all'
       or (v_filter = 'pending' and status in ('new', 'seen'))
       or status = v_filter
  ), page_rows as (
    select *
    from filtered_orders
    order by created_at desc, id desc
    limit v_limit + 1
    offset v_offset
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'code', public_order_code,
      'status', status,
      'customerName', customer_name,
      'fulfillmentMethod', fulfillment_method,
      'itemCount', item_count,
      'total', total,
      'currency', currency,
      'createdAt', created_at,
      'seenAt', seen_at,
      'acceptedAt', accepted_at,
      'rejectedAt', rejected_at
    ) order by created_at desc, id desc) filter (where row_number <= v_limit), '[]'::jsonb),
    count(*) > v_limit
  into v_orders, v_has_more
  from (
    select page_rows.*, row_number() over (order by created_at desc, id desc) as row_number
    from page_rows
  ) numbered;

  select jsonb_build_object(
    'new', count(*) filter (where status = 'new'),
    'seen', count(*) filter (where status = 'seen'),
    'pending', count(*) filter (where status in ('new', 'seen')),
    'accepted', count(*) filter (where status = 'accepted'),
    'rejected', count(*) filter (where status = 'rejected'),
    'total', count(*)
  )
  into v_counts
  from public.ecommerce_orders o
  where o.license_id = v_license_id
    and o.pos_visibility_status in ('pending', 'visible');

  return jsonb_build_object(
    'success', true,
    'orders', coalesce(v_orders, '[]'::jsonb),
    'counts', coalesce(v_counts, jsonb_build_object('new',0,'seen',0,'pending',0,'accepted',0,'rejected',0,'total',0)),
    'pagination', jsonb_build_object(
      'limit', v_limit,
      'offset', v_offset,
      'hasMore', coalesce(v_has_more, false)
    ),
    'filter', v_filter
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
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
  v_order public.ecommerce_orders%rowtype;
  v_items jsonb;
  v_events jsonb;
  v_whatsapp_url text;
  v_contact_message text;
begin
  v_auth := private.ecommerce_orders_authorize_v1(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_get_order'
  );

  if coalesce((v_auth->>'success')::boolean, false) is false then
    return v_auth;
  end if;

  v_license_id := (v_auth->>'license_id')::uuid;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending', 'visible')
  limit 1;

  if v_order.id is null then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'productName', i.product_name,
    'unitPrice', i.unit_price,
    'quantity', i.quantity,
    'lineTotal', i.line_total,
    'options', case when jsonb_typeof(i.options) = 'object' then i.options else '{}'::jsonb end
  ) order by i.created_at, i.id), '[]'::jsonb)
  into v_items
  from public.ecommerce_order_items i
  where i.order_id = v_order.id
    and i.license_id = v_license_id;

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
      else nullif(left(btrim(coalesce(e.message, '')), 200), '')
    end,
    'payload', private.ecommerce_order_event_public_payload_v1(e.event_type, e.payload),
    'createdAt', e.created_at
  ) order by e.created_at, e.id), '[]'::jsonb)
  into v_events
  from public.ecommerce_order_events e
  where e.order_id = v_order.id
    and e.license_id = v_license_id;

  v_contact_message := 'Hola, te contactamos sobre tu pedido ' || coalesce(v_order.public_order_code, 'online') || '.';
  v_whatsapp_url := private.ecommerce_build_whatsapp_url(v_order.customer_phone, v_contact_message);

  if v_whatsapp_url is not null and left(v_whatsapp_url, 14) <> 'https://wa.me/' then
    v_whatsapp_url := null;
  end if;

  return jsonb_build_object(
    'success', true,
    'order', jsonb_build_object(
      'id', v_order.id,
      'code', v_order.public_order_code,
      'status', v_order.status,
      'channel', v_order.channel,
      'fulfillmentMethod', v_order.fulfillment_method,
      'customer', jsonb_build_object(
        'name', v_order.customer_name,
        'phone', v_order.customer_phone,
        'address', v_order.customer_address,
        'notes', v_order.customer_notes
      ),
      'totals', jsonb_build_object(
        'subtotal', v_order.subtotal,
        'deliveryFee', v_order.delivery_fee,
        'discountTotal', v_order.discount_total,
        'taxTotal', v_order.tax_total,
        'total', v_order.total,
        'currency', v_order.currency
      ),
      'payment', jsonb_build_object(
        'method', v_order.payment_method,
        'status', v_order.payment_status
      ),
      'timestamps', jsonb_build_object(
        'createdAt', v_order.created_at,
        'updatedAt', v_order.updated_at,
        'seenAt', v_order.seen_at,
        'acceptedAt', v_order.accepted_at,
        'rejectedAt', v_order.rejected_at
      ),
      'items', coalesce(v_items, '[]'::jsonb),
      'events', coalesce(v_events, '[]'::jsonb),
      'contact', jsonb_build_object('whatsappUrl', v_whatsapp_url)
    )
  );
exception
  when others then
    return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_mark_order_seen(
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
  v_order public.ecommerce_orders%rowtype;
  v_from_status text;
  v_changed boolean := false;
begin
  v_auth := private.ecommerce_orders_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_mark_order_seen');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending', 'visible')
  for update;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;

  if v_order.status = 'new' then
    v_from_status := v_order.status;
    update public.ecommerce_orders
    set status = 'seen', seen_at = coalesce(seen_at, now()), pos_visibility_status = 'visible', updated_at = now()
    where id = v_order.id
    returning * into v_order;

    insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
    values (
      v_order.id,
      v_order.portal_id,
      v_order.license_id,
      'order_seen',
      v_auth->>'actor_type',
      coalesce(nullif(v_auth->>'staff_user_id', ''), nullif(v_auth->>'device_id', '')),
      'Pedido marcado como visto',
      jsonb_build_object('fromStatus', v_from_status, 'toStatus', 'seen', 'actorLabel', v_auth->>'actor_label')
    );
    v_changed := true;
  end if;

  if v_changed then
    perform private.broadcast_ecommerce_order_change_v1(v_order.license_id, v_order.id, v_order.status, 'order_seen');
  end if;

  return jsonb_build_object(
    'success', true,
    'changed', v_changed,
    'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status, 'seenAt', v_order.seen_at)
  );
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_accept_order(
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
  v_order public.ecommerce_orders%rowtype;
  v_from_status text;
  v_changed boolean := false;
begin
  v_auth := private.ecommerce_orders_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_accept_order');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending', 'visible')
  for update;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status = 'accepted' then
    return jsonb_build_object('success', true, 'changed', false, 'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status, 'acceptedAt', v_order.accepted_at));
  end if;
  if v_order.status not in ('new', 'seen') then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION'); end if;

  v_from_status := v_order.status;
  update public.ecommerce_orders
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), seen_at = coalesce(seen_at, now()), pos_visibility_status = 'visible', updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (
    v_order.id, v_order.portal_id, v_order.license_id, 'order_accepted', v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), nullif(v_auth->>'device_id', '')),
    'Pedido aceptado',
    jsonb_build_object('fromStatus', v_from_status, 'toStatus', 'accepted', 'actorLabel', v_auth->>'actor_label')
  );
  v_changed := true;

  perform private.broadcast_ecommerce_order_change_v1(v_order.license_id, v_order.id, v_order.status, 'order_accepted');

  return jsonb_build_object(
    'success', true,
    'changed', v_changed,
    'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status, 'seenAt', v_order.seen_at, 'acceptedAt', v_order.accepted_at)
  );
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_reject_order(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_order_id uuid,
  p_reason text,
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
  v_order public.ecommerce_orders%rowtype;
  v_from_status text;
  v_reason text;
begin
  v_auth := private.ecommerce_orders_authorize_v1(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_reject_order');
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_reason := btrim(coalesce(p_reason, ''));
  if length(v_reason) < 3 then return private.ecommerce_orders_error_v1('ECOMMERCE_REJECTION_REASON_REQUIRED'); end if;
  if length(v_reason) > 300 then return private.ecommerce_orders_error_v1('ECOMMERCE_REJECTION_REASON_TOO_LONG'); end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
    and o.license_id = v_license_id
    and o.pos_visibility_status in ('pending', 'visible')
  for update;

  if v_order.id is null then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_NOT_FOUND'); end if;
  if v_order.status = 'rejected' then
    return jsonb_build_object('success', true, 'changed', false, 'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status, 'rejectedAt', v_order.rejected_at));
  end if;
  if v_order.status not in ('new', 'seen') then return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_INVALID_TRANSITION'); end if;

  v_from_status := v_order.status;
  update public.ecommerce_orders
  set status = 'rejected', rejected_at = coalesce(rejected_at, now()), seen_at = coalesce(seen_at, now()), pos_visibility_status = 'visible', updated_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.ecommerce_order_events(order_id, portal_id, license_id, event_type, actor_type, actor_ref, message, payload)
  values (
    v_order.id, v_order.portal_id, v_order.license_id, 'order_rejected', v_auth->>'actor_type',
    coalesce(nullif(v_auth->>'staff_user_id', ''), nullif(v_auth->>'device_id', '')),
    'Pedido rechazado',
    jsonb_build_object('fromStatus', v_from_status, 'toStatus', 'rejected', 'reason', v_reason, 'actorLabel', v_auth->>'actor_label')
  );

  perform private.broadcast_ecommerce_order_change_v1(v_order.license_id, v_order.id, v_order.status, 'order_rejected');

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'order', jsonb_build_object('id', v_order.id, 'code', v_order.public_order_code, 'status', v_order.status, 'seenAt', v_order.seen_at, 'rejectedAt', v_order.rejected_at)
  );
exception when others then
  return private.ecommerce_orders_error_v1('ECOMMERCE_ORDER_ACTION_FAILED');
end;
$function$;

create index if not exists ix_ecommerce_orders_license_created
  on public.ecommerce_orders (license_id, created_at desc);

revoke all on function private.ecommerce_orders_error_v1(text, text, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_orders_authorize_v1(text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_order_event_public_payload_v1(text, jsonb) from public, anon, authenticated;
revoke all on function private.broadcast_ecommerce_order_change_v1(uuid, uuid, text, text) from public, anon, authenticated;

revoke all on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) from public, anon;
revoke all on function public.ecommerce_admin_get_order(text, text, text, uuid, text) from public, anon;
revoke all on function public.ecommerce_admin_mark_order_seen(text, text, text, uuid, text) from public, anon;
revoke all on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) from public, anon;
revoke all on function public.ecommerce_admin_reject_order(text, text, text, uuid, text, text) from public, anon;

grant execute on function public.ecommerce_admin_list_orders(text, text, text, text, text, integer, integer) to authenticated;
grant execute on function public.ecommerce_admin_get_order(text, text, text, uuid, text) to authenticated;
grant execute on function public.ecommerce_admin_mark_order_seen(text, text, text, uuid, text) to authenticated;
grant execute on function public.ecommerce_admin_accept_order(text, text, text, uuid, text) to authenticated;
grant execute on function public.ecommerce_admin_reject_order(text, text, text, uuid, text, text) to authenticated;
