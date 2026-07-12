-- ECOM.ORDERS.2 / 2
-- Deterministic HMAC token generation and public tracking RPC.

create or replace function private.ecommerce_base64url_v1(p_value bytea)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $function$
  select rtrim(translate(encode(p_value, 'base64'), E'+/=\n\r', '-_'), '=');
$function$;

create or replace function private.ecommerce_tracking_not_found_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'success', false,
    'error', jsonb_build_object(
      'code', 'ECOMMERCE_TRACKING_NOT_FOUND',
      'message', 'No se pudo encontrar este seguimiento.'
    )
  );
$function$;

create or replace function private.ecommerce_tracking_rate_limited_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'success', false,
    'error', jsonb_build_object(
      'code', 'ECOMMERCE_TRACKING_RATE_LIMITED',
      'message', 'Se realizaron demasiadas consultas. Espera un momento e intenta nuevamente.'
    )
  );
$function$;

create or replace function private.ecommerce_order_public_status_v1(
  p_order_status text,
  p_fulfillment_status text
)
returns text
language sql
immutable
security definer
set search_path = ''
as $function$
  select case
    when p_fulfillment_status in ('accepted','preparing','ready','out_for_delivery','completed','cancelled','attention') then p_fulfillment_status
    when p_order_status in ('new','seen') then 'received'
    when p_order_status = 'accepted' then 'accepted'
    when p_order_status = 'rejected' then 'rejected'
    else 'received'
  end;
$function$;

create or replace function private.ecommerce_tracking_topic_v1(p_token_hash bytea)
returns text
language sql
immutable
strict
security definer
set search_path = ''
as $function$
  select 'ecom-track:' || left(encode(p_token_hash, 'hex'), 48);
$function$;

create or replace function private.ecommerce_tracking_token_for_order_v1(p_order_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.ecommerce_orders%rowtype;
  v_slug text;
  v_key private.ecommerce_order_tracking_keys%rowtype;
  v_stored private.ecommerce_order_tracking_tokens%rowtype;
  v_next_version integer;
  v_material bytea;
  v_token text;
  v_token_hash bytea;
begin
  if p_order_id is null then return null; end if;

  select o.* into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
  limit 1;

  if v_order.id is not null then
    select p.slug into v_slug
    from public.ecommerce_portals p
    where p.id = v_order.portal_id and p.license_id = v_order.license_id
    limit 1;
  end if;

  if v_order.id is null or nullif(btrim(v_slug), '') is null then return null; end if;

  select t.* into v_stored
  from private.ecommerce_order_tracking_tokens t
  where t.order_id = v_order.id
  limit 1;

  if v_stored.order_id is null then
    select k.* into v_key
    from private.ecommerce_order_tracking_keys k
    where k.portal_id = v_order.portal_id
      and k.license_id = v_order.license_id
      and k.is_active is true
    order by k.token_version desc
    limit 1;

    if v_key.portal_id is null then
      select coalesce(max(k.token_version), 0) + 1 into v_next_version
      from private.ecommerce_order_tracking_keys k
      where k.portal_id = v_order.portal_id;

      begin
        insert into private.ecommerce_order_tracking_keys (
          portal_id, license_id, token_version, signing_secret, is_active
        ) values (
          v_order.portal_id, v_order.license_id, v_next_version,
          extensions.gen_random_bytes(32), true
        ) returning * into v_key;
      exception when unique_violation then
        select k.* into v_key
        from private.ecommerce_order_tracking_keys k
        where k.portal_id = v_order.portal_id
          and k.license_id = v_order.license_id
          and k.is_active is true
        order by k.token_version desc
        limit 1;
      end;
    end if;

    if v_key.portal_id is null then return null; end if;

    v_material := convert_to(
      'lanzo:ecommerce:tracking:v1:' || v_order.id::text || ':' ||
      v_order.portal_id::text || ':' || v_key.token_version::text,
      'UTF8'
    );
    v_token := 'trk1_' || private.ecommerce_base64url_v1(
      extensions.hmac(v_material, v_key.signing_secret, 'sha256')
    );
    v_token_hash := extensions.digest(convert_to(v_token, 'UTF8'), 'sha256');

    insert into private.ecommerce_order_tracking_tokens (
      order_id, portal_id, license_id, token_version, token_hash, token_last4
    ) values (
      v_order.id, v_order.portal_id, v_order.license_id, v_key.token_version,
      v_token_hash, right(v_token, 4)
    ) on conflict (order_id) do nothing;

    select t.* into v_stored
    from private.ecommerce_order_tracking_tokens t
    where t.order_id = v_order.id
    limit 1;
  end if;

  select k.* into v_key
  from private.ecommerce_order_tracking_keys k
  where k.portal_id = v_stored.portal_id
    and k.license_id = v_stored.license_id
    and k.token_version = v_stored.token_version
  limit 1;

  if v_key.portal_id is null then return null; end if;

  v_material := convert_to(
    'lanzo:ecommerce:tracking:v1:' || v_order.id::text || ':' ||
    v_order.portal_id::text || ':' || v_stored.token_version::text,
    'UTF8'
  );
  v_token := 'trk1_' || private.ecommerce_base64url_v1(
    extensions.hmac(v_material, v_key.signing_secret, 'sha256')
  );
  v_token_hash := extensions.digest(convert_to(v_token, 'UTF8'), 'sha256');

  if v_token_hash <> v_stored.token_hash then return null; end if;

  return jsonb_build_object(
    'token', v_token,
    'path', '/tienda/' || v_slug || '/pedido/' || v_token,
    'version', v_stored.token_version,
    'last4', v_stored.token_last4,
    'revoked', v_stored.revoked_at is not null,
    'expiresAt', v_stored.expires_at
  );
end;
$function$;

create or replace function private.ecommerce_revoke_order_tracking_v1(p_order_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_row_count integer := 0;
begin
  update private.ecommerce_order_tracking_tokens
  set revoked_at = coalesce(revoked_at, now())
  where order_id = p_order_id and revoked_at is null;
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$function$;

create or replace function private.ecommerce_order_public_jsonb(p_order public.ecommerce_orders)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_tracking jsonb;
begin
  v_tracking := private.ecommerce_tracking_token_for_order_v1(p_order.id);
  return jsonb_strip_nulls(jsonb_build_object(
    'id', p_order.id,
    'code', p_order.public_order_code,
    'status', p_order.status,
    'total', p_order.total,
    'currency', p_order.currency,
    'fulfillmentMethod', p_order.fulfillment_method,
    'createdAt', p_order.created_at,
    'trackingToken', v_tracking ->> 'token',
    'trackingPath', v_tracking ->> 'path',
    'trackingVersion', nullif(v_tracking ->> 'version', '')::integer
  ));
end;
$function$;

create or replace function public.ecommerce_get_order_tracking(p_slug text, p_tracking_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_slug text;
  v_token text;
  v_token_hash bytea;
  v_portal public.ecommerce_portals%rowtype;
  v_rate_limit jsonb;
  v_order public.ecommerce_orders%rowtype;
  v_tracking private.ecommerce_order_tracking_tokens%rowtype;
  v_items jsonb;
  v_realtime_enabled boolean := false;
  v_public_status text;
begin
  v_slug := lower(left(btrim(coalesce(p_slug, '')), 160));
  v_token := left(btrim(coalesce(p_tracking_token, '')), 128);

  if v_slug = '' or v_token !~ '^trk1_[A-Za-z0-9_-]{43}$' then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  v_portal := private.ecommerce_get_public_portal_by_slug(v_slug);
  if v_portal.id is null then return private.ecommerce_tracking_not_found_v1(); end if;

  v_token_hash := extensions.digest(convert_to(v_token, 'UTF8'), 'sha256');
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := 'ecommerce-tracking:' || v_portal.license_id::text,
    p_device_fingerprint := 'tracking:' || left(encode(v_token_hash, 'hex'), 32),
    p_staff_session_token := null,
    p_rpc_name := 'ecommerce_get_order_tracking',
    p_scope := 'ECOMMERCE_ORDER_TRACKING',
    p_max_attempts := 120,
    p_window_seconds := 600,
    p_block_seconds := 300,
    p_code := 'ECOMMERCE_TRACKING_RATE_LIMITED',
    p_metadata := jsonb_build_object('source','ecommerce_public_tracking','phase','ECOM.ORDERS.2')
  );

  if coalesce((v_rate_limit ->> 'allowed')::boolean, false) is false then
    return private.ecommerce_tracking_rate_limited_v1();
  end if;

  select t.* into v_tracking
  from private.ecommerce_order_tracking_tokens t
  where t.token_hash = v_token_hash
    and t.portal_id = v_portal.id
    and t.license_id = v_portal.license_id
    and t.revoked_at is null
    and (t.expires_at is null or t.expires_at > now())
  limit 1;

  if v_tracking.order_id is not null then
    select o.* into v_order
    from public.ecommerce_orders o
    where o.id = v_tracking.order_id
      and o.portal_id = v_tracking.portal_id
      and o.license_id = v_tracking.license_id
    limit 1;
  end if;

  if v_tracking.order_id is null or v_order.id is null then
    return private.ecommerce_tracking_not_found_v1();
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name', i.product_name,
    'quantity', i.quantity
  ) order by i.created_at, i.id), '[]'::jsonb)
  into v_items
  from public.ecommerce_order_items i
  where i.order_id = v_order.id
    and i.portal_id = v_order.portal_id
    and i.license_id = v_order.license_id;

  v_public_status := private.ecommerce_order_public_status_v1(v_order.status, v_order.fulfillment_status);
  v_realtime_enabled := private.ecommerce_license_feature_bool(
    v_order.license_id, 'ecommerce_realtime_orders', false
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
      'realtime', jsonb_build_object(
        'enabled', v_realtime_enabled,
        'topic', case when v_realtime_enabled
          then private.ecommerce_tracking_topic_v1(v_tracking.token_hash)
          else null end
      )
    ))
  );
exception when others then
  return private.ecommerce_tracking_not_found_v1();
end;
$function$;

revoke all on function private.ecommerce_base64url_v1(bytea) from public, anon, authenticated;
revoke all on function private.ecommerce_tracking_not_found_v1() from public, anon, authenticated;
revoke all on function private.ecommerce_tracking_rate_limited_v1() from public, anon, authenticated;
revoke all on function private.ecommerce_order_public_status_v1(text, text) from public, anon, authenticated;
revoke all on function private.ecommerce_tracking_topic_v1(bytea) from public, anon, authenticated;
revoke all on function private.ecommerce_tracking_token_for_order_v1(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_revoke_order_tracking_v1(uuid) from public, anon, authenticated;
revoke all on function private.ecommerce_order_public_jsonb(public.ecommerce_orders) from public, anon, authenticated;
revoke all on function public.ecommerce_get_order_tracking(text, text) from public;
grant execute on function public.ecommerce_get_order_tracking(text, text) to anon, authenticated;

comment on function public.ecommerce_get_order_tracking(text, text) is
  'Public allowlisted ecommerce order tracking lookup. Invalid, revoked and cross-portal tokens return the same public error.';
