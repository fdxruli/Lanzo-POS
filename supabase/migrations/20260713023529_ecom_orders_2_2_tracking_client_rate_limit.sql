-- ECOM.ORDERS.2.2 — Public tracking client isolation and uniform responses.
-- Compensatory migration. Does not modify prior ECOM.ORDERS.2 migrations.

create or replace function private.ecommerce_tracking_client_identity_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_headers jsonb := '{}'::jsonb;
  v_headers_raw text;
  v_candidate text;
  v_normalized_ip text;
  v_fingerprint text;
begin
  begin
    v_headers_raw := nullif(current_setting('request.headers', true), '');
    if v_headers_raw is not null then
      v_headers := v_headers_raw::jsonb;
    end if;
  exception
    when others then
      v_headers := '{}'::jsonb;
  end;

  foreach v_candidate in array array[
    nullif(btrim(coalesce(v_headers->>'cf-connecting-ip', '')), ''),
    nullif(btrim(coalesce(v_headers->>'x-real-ip', '')), ''),
    nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '')
  ] loop
    if v_candidate is null then
      continue;
    end if;

    begin
      v_normalized_ip := host(v_candidate::inet);
      exit when v_normalized_ip is not null;
    exception
      when invalid_text_representation then
        v_normalized_ip := null;
      when others then
        v_normalized_ip := null;
    end;
  end loop;

  if v_normalized_ip is null then
    return jsonb_build_object(
      'fingerprint', 'tracking-client:anonymous',
      'anonymous', true
    );
  end if;

  v_fingerprint := 'tracking-client:' || left(
    encode(
      extensions.digest(
        convert_to(
          'lanzo-pos:odlrhijtfyavryeqivaa:ecom-orders-2.2:tracking-client:v1:' || v_normalized_ip,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ),
    40
  );

  return jsonb_build_object(
    'fingerprint', v_fingerprint,
    'anonymous', false
  );
end;
$function$;

create or replace function private.ecommerce_tracking_rate_limited_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select private.ecommerce_tracking_not_found_v1();
$function$;

create or replace function public.ecommerce_get_order_tracking(
  p_slug text,
  p_tracking_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_slug text;
  v_token text;
  v_token_hash bytea;
  v_client_identity jsonb;
  v_client_fingerprint text;
  v_client_is_anonymous boolean := true;
  v_client_limit jsonb;
  v_portal public.ecommerce_portals%rowtype;
  v_portal_limit jsonb;
  v_token_limit jsonb;
  v_order public.ecommerce_orders%rowtype;
  v_tracking private.ecommerce_order_tracking_tokens%rowtype;
  v_items jsonb;
  v_realtime_enabled boolean := false;
  v_storefront_available boolean := false;
  v_public_status text;
begin
  v_slug := private.ecommerce_normalize_slug(p_slug);
  v_token := left(btrim(coalesce(p_tracking_token, '')), 128);

  v_client_identity := private.ecommerce_tracking_client_identity_v1();
  v_client_fingerprint := coalesce(
    nullif(v_client_identity->>'fingerprint', ''),
    'tracking-client:anonymous'
  );
  v_client_is_anonymous := coalesce(
    (v_client_identity->>'anonymous')::boolean,
    true
  );

  v_client_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := 'ecommerce-tracking-client:v1',
    p_device_fingerprint := v_client_fingerprint,
    p_staff_session_token := null,
    p_rpc_name := 'ecommerce_get_order_tracking',
    p_scope := 'ECOMMERCE_ORDER_TRACKING_CLIENT',
    p_max_attempts := case when v_client_is_anonymous then 30 else 60 end,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_TRACKING_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'source', 'ecommerce_public_tracking',
      'phase', 'ECOM.ORDERS.2.2',
      'bucket', 'client'
    )
  );
  if coalesce((v_client_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  v_portal := private.ecommerce_get_tracking_portal_by_slug_v1(v_slug);
  if v_portal.id is null then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  v_portal_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := 'ecommerce-tracking:' || v_portal.license_id::text,
    p_device_fingerprint := 'tracking-portal:' || v_portal.id::text,
    p_staff_session_token := null,
    p_rpc_name := 'ecommerce_get_order_tracking',
    p_scope := 'ECOMMERCE_ORDER_TRACKING_PORTAL',
    p_max_attempts := 5000,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_TRACKING_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'source', 'ecommerce_public_tracking',
      'phase', 'ECOM.ORDERS.2.2',
      'bucket', 'portal'
    )
  );
  if coalesce((v_portal_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  if v_token !~ '^trk1_[A-Za-z0-9_-]{43}$' then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  v_token_hash := extensions.digest(convert_to(v_token, 'UTF8'), 'sha256');

  select t.*
  into v_tracking
  from private.ecommerce_order_tracking_tokens t
  where t.token_hash = v_token_hash
    and t.portal_id = v_portal.id
    and t.license_id = v_portal.license_id
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  if v_tracking.order_id is null then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  v_token_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := 'ecommerce-tracking:' || v_portal.license_id::text,
    p_device_fingerprint := 'tracking-token:' || left(encode(v_token_hash, 'hex'), 32),
    p_staff_session_token := null,
    p_rpc_name := 'ecommerce_get_order_tracking',
    p_scope := 'ECOMMERCE_ORDER_TRACKING_TOKEN',
    p_max_attempts := 120,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_TRACKING_RATE_LIMITED',
    p_metadata := jsonb_build_object(
      'source', 'ecommerce_public_tracking',
      'phase', 'ECOM.ORDERS.2.2',
      'bucket', 'valid_token'
    )
  );
  if coalesce((v_token_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  select o.*
  into v_order
  from public.ecommerce_orders o
  where o.id = v_tracking.order_id
    and o.portal_id = v_tracking.portal_id
    and o.license_id = v_tracking.license_id
  limit 1;

  if v_order.id is null then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', i.product_name,
        'quantity', i.quantity
      ) order by i.created_at, i.id
    ),
    '[]'::jsonb
  )
  into v_items
  from public.ecommerce_order_items i
  where i.order_id = v_order.id
    and i.portal_id = v_order.portal_id
    and i.license_id = v_order.license_id;

  v_public_status := private.ecommerce_order_public_status_v1(
    v_order.status,
    v_order.fulfillment_status
  );
  v_realtime_enabled := private.ecommerce_license_feature_bool(
    v_order.license_id,
    'ecommerce_realtime_orders',
    false
  );
  v_storefront_available := v_portal.status = 'published'
    and private.ecommerce_license_feature_bool(
      v_order.license_id,
      'ecommerce_portal_enabled',
      false
    );

  return jsonb_build_object(
    'success', true,
    'tracking', jsonb_strip_nulls(jsonb_build_object(
      'orderCode', v_order.public_order_code,
      'status', v_public_status,
      'fulfillmentMethod', v_order.fulfillment_method,
      'createdAt', v_order.created_at,
      'updatedAt', coalesce(v_order.fulfillment_updated_at, v_order.updated_at),
      'total', v_order.total,
      'currency', v_order.currency,
      'items', coalesce(v_items, '[]'::jsonb),
      'publicMessage', v_order.public_status_message,
      'version', greatest(v_order.fulfillment_version, 0),
      'paymentRegistered', (
        v_order.payment_status = 'paid'
        or v_order.converted_sale_id is not null
        or v_order.pos_conversion_status = 'completed'
      ),
      'storefrontAvailable', v_storefront_available,
      'realtime', jsonb_build_object(
        'enabled', v_realtime_enabled,
        'topic', case
          when v_realtime_enabled then private.ecommerce_tracking_topic_v1(v_tracking.token_hash)
          else null
        end
      )
    ))
  );
exception
  when others then
    return private.ecommerce_tracking_not_found_v1();
end;
$function$;

-- Remove only obsolete public-tracking counters so old low limits and blocks
-- cannot survive the compensatory policy change.
delete from public.pos_rpc_rate_limits
where rpc_name = 'ecommerce_get_order_tracking'
  and scope in (
    'ECOMMERCE_ORDER_TRACKING_CLIENT',
    'ECOMMERCE_ORDER_TRACKING_PORTAL',
    'ECOMMERCE_ORDER_TRACKING_TOKEN'
  )
  and coalesce(metadata->>'source', '') = 'ecommerce_public_tracking';

revoke all on function private.ecommerce_tracking_client_identity_v1() from public, anon, authenticated;
revoke all on function private.ecommerce_tracking_rate_limited_v1() from public, anon, authenticated;
revoke all on function public.ecommerce_get_order_tracking(text, text) from public;
grant execute on function public.ecommerce_get_order_tracking(text, text) to anon, authenticated, service_role;

alter function private.ecommerce_tracking_client_identity_v1() owner to postgres;
alter function private.ecommerce_tracking_rate_limited_v1() owner to postgres;
alter function public.ecommerce_get_order_tracking(text, text) owner to postgres;

comment on function private.ecommerce_tracking_client_identity_v1()
is 'ECOM.ORDERS.2.2: derives a stable pseudonymous client bucket from trusted proxy IP headers without retaining plaintext headers or addresses.';

comment on function public.ecommerce_get_order_tracking(text, text)
is 'ECOM.ORDERS.2.2: public tracking with client, portal-capacity and valid-token rate limits plus a uniform not-found response.';
