-- ECOM.ORDERS.2 transactional verification.
-- This script does not leave orders, tokens, events or state changes behind.

begin;

DO $test$
DECLARE
  v_order_id uuid;
  v_slug text;
  v_token_a jsonb;
  v_token_b jsonb;
  v_public jsonb;
  v_invalid jsonb;
  v_wrong_slug jsonb;
  v_revoked jsonb;
  v_admin_failure jsonb;
BEGIN
  select o.id, p.slug
  into v_order_id, v_slug
  from public.ecommerce_orders o
  join public.ecommerce_portals p
    on p.id = o.portal_id
   and p.license_id = o.license_id
  order by o.created_at desc
  limit 1;

  if v_order_id is null then
    raise exception 'ECOM.ORDERS.2 requires one existing ecommerce order for a rollback-only token test';
  end if;

  v_token_a := private.ecommerce_tracking_token_for_order_v1(v_order_id);
  v_token_b := private.ecommerce_tracking_token_for_order_v1(v_order_id);

  if v_token_a ->> 'token' !~ '^trk1_[A-Za-z0-9_-]{43}$' then
    raise exception 'tracking token shape is invalid';
  end if;
  if v_token_a ->> 'token' is distinct from v_token_b ->> 'token' then
    raise exception 'tracking token is not idempotent';
  end if;
  if v_token_a ->> 'path' is distinct from v_token_b ->> 'path' then
    raise exception 'tracking path is not idempotent';
  end if;

  v_public := public.ecommerce_get_order_tracking(v_slug, v_token_a ->> 'token');
  if coalesce((v_public ->> 'success')::boolean, false) is not true then
    raise exception 'valid public tracking lookup failed';
  end if;
  if v_public::text ~* '(license_id|portal_id|order_id|sale_id|staff_id|customer_phone|customer_address|security_token|claim_token|conversion_key)' then
    raise exception 'public payload leaked an internal field';
  end if;
  if v_public::text ~ 'trk1_' then
    raise exception 'public payload echoed the tracking token';
  end if;

  v_invalid := public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('A', 43));
  v_wrong_slug := public.ecommerce_get_order_tracking(v_slug || '-wrong', v_token_a ->> 'token');
  if v_invalid #>> '{error,code}' <> 'ECOMMERCE_TRACKING_NOT_FOUND'
     or v_wrong_slug #>> '{error,code}' <> 'ECOMMERCE_TRACKING_NOT_FOUND' then
    raise exception 'invalid token or slug did not use uniform not-found code';
  end if;
  if v_invalid #>> '{error,message}' is distinct from v_wrong_slug #>> '{error,message}' then
    raise exception 'invalid token and slug did not use a uniform message';
  end if;

  perform private.ecommerce_revoke_order_tracking_v1(v_order_id);
  v_revoked := public.ecommerce_get_order_tracking(v_slug, v_token_a ->> 'token');
  if v_revoked #>> '{error,code}' <> 'ECOMMERCE_TRACKING_NOT_FOUND' then
    raise exception 'revoked token remained visible';
  end if;

  if private.ecommerce_fulfillment_transition_allowed_v1('accepted','preparing','pickup') is not true
     or private.ecommerce_fulfillment_transition_allowed_v1('preparing','ready','pickup') is not true
     or private.ecommerce_fulfillment_transition_allowed_v1('ready','completed','pickup') is not true
     or private.ecommerce_fulfillment_transition_allowed_v1('ready','out_for_delivery','delivery') is not true
     or private.ecommerce_fulfillment_transition_allowed_v1('out_for_delivery','completed','delivery') is not true then
    raise exception 'one or more required transitions are blocked';
  end if;

  if private.ecommerce_fulfillment_transition_allowed_v1(null,'preparing','pickup') is true
     or private.ecommerce_fulfillment_transition_allowed_v1('rejected','preparing','pickup') is true
     or private.ecommerce_fulfillment_transition_allowed_v1('completed','preparing','pickup') is true
     or private.ecommerce_fulfillment_transition_allowed_v1('cancelled','preparing','pickup') is true
     or private.ecommerce_fulfillment_transition_allowed_v1('ready','out_for_delivery','pickup') is true
     or private.ecommerce_fulfillment_transition_allowed_v1('completed','ready','delivery') is true
     or private.ecommerce_fulfillment_transition_allowed_v1('completed','cancelled','delivery') is true then
    raise exception 'one or more invalid transitions are allowed';
  end if;

  v_admin_failure := public.ecommerce_admin_update_order_fulfillment(
    null,
    null,
    null,
    null,
    extensions.gen_random_uuid(),
    'preparing',
    0,
    'invalid-auth-test',
    null
  );
  if coalesce((v_admin_failure ->> 'success')::boolean, false) is true then
    raise exception 'unauthenticated administrative transition was allowed';
  end if;
END
$test$;

rollback;
