-- ECOM.ORDERS.2.1 transactional verification.
-- Creates a temporary license, portal, admin device and order fixtures.
-- Every mutation is rolled back.

begin;

create or replace function private.ecom21_insert_order_fixture_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_columns text;
  v_select text;
  v_id uuid;
begin
  select
    string_agg(quote_ident(a.attname), ',' order by a.attnum),
    string_agg(format('r.%I', a.attname), ',' order by a.attnum)
  into v_columns, v_select
  from pg_attribute a
  where a.attrelid = 'public.ecommerce_orders'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = '';

  execute format(
    'insert into public.ecommerce_orders (%s) select %s from jsonb_populate_record(null::public.ecommerce_orders,$1) r returning id',
    v_columns,
    v_select
  ) using p_payload into v_id;

  return v_id;
end;
$function$;

do $test$
declare
  v_source_order public.ecommerce_orders%rowtype;
  v_source_portal public.ecommerce_portals%rowtype;
  v_source_license public.licenses%rowtype;
  v_license public.licenses%rowtype;
  v_portal public.ecommerce_portals%rowtype;
  v_order public.ecommerce_orders%rowtype;

  v_license_id uuid := extensions.gen_random_uuid();
  v_portal_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_key text := 'ECOM21-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_slug text := 'ecom21-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 18);
  v_fingerprint text := 'ecom21-device';
  v_security_token text := 'ecom21-security-token';

  v_no_claim uuid := extensions.gen_random_uuid();
  v_claimed uuid := extensions.gen_random_uuid();
  v_prepared uuid := extensions.gen_random_uuid();
  v_reserved uuid := extensions.gen_random_uuid();
  v_completed uuid := extensions.gen_random_uuid();
  v_cancelled uuid := extensions.gen_random_uuid();
  v_converted uuid := extensions.gen_random_uuid();
  v_stale uuid := extensions.gen_random_uuid();
  v_claim_token uuid := extensions.gen_random_uuid();

  v_result jsonb;
  v_replay jsonb;
  v_tracking jsonb;
  v_public jsonb;
  v_list jsonb;
  v_new_order jsonb;
  v_rows integer;
  v_count integer;
  v_token text;
  v_prefix text := 'T21-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 8);
begin
  select o.* into v_source_order
  from public.ecommerce_orders o
  order by o.created_at desc
  limit 1;
  if v_source_order.id is null then
    raise exception 'fixture source order unavailable';
  end if;

  select p.* into v_source_portal
  from public.ecommerce_portals p
  where p.id = v_source_order.portal_id;

  select l.* into v_source_license
  from public.licenses l
  where l.id = v_source_order.license_id;

  v_license := jsonb_populate_record(
    null::public.licenses,
    to_jsonb(v_source_license) || jsonb_build_object(
      'id', v_license_id,
      'license_key', v_key,
      'status', 'active',
      'expires_at', now() + interval '30 days',
      'features', coalesce(v_source_license.features, '{}'::jsonb) || jsonb_build_object(
        'ecommerce_order_inbox', true,
        'ecommerce_portal_enabled', true,
        'ecommerce_realtime_orders', true
      ),
      'created_at', now()
    )
  );
  insert into public.licenses select (v_license).*;

  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name,
    is_active, security_token, device_role, activated_at, last_used_at
  ) values (
    v_device_id, v_license_id, v_fingerprint, 'ECOM.ORDERS.2.1 fixture',
    true, v_security_token, 'admin', now(), now()
  );

  v_portal := jsonb_populate_record(
    null::public.ecommerce_portals,
    to_jsonb(v_source_portal) || jsonb_build_object(
      'id', v_portal_id,
      'license_id', v_license_id,
      'slug', v_slug,
      'status', 'published',
      'deleted_at', null,
      'created_at', now(),
      'updated_at', now()
    )
  );
  insert into public.ecommerce_portals select (v_portal).*;

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_no_claim, 'portal_id', v_portal_id, 'license_id', v_license_id,
    'idempotency_key', v_prefix || '-A', 'status', 'accepted', 'pos_visibility_status', 'visible',
    'converted_sale_id', null, 'converted_at', null,
    'pos_draft_status', 'none', 'pos_draft_id', null, 'pos_claim_token', null,
    'pos_claim_request_key', null, 'pos_claimed_at', null, 'pos_claim_expires_at', null,
    'pos_claim_actor_type', null, 'pos_claim_actor_ref', null, 'pos_draft_prepared_at', null,
    'pos_conversion_status', 'idle', 'pos_conversion_attempt_id', null,
    'pos_conversion_sale_id', null, 'pos_conversion_key', null,
    'pos_conversion_actor_ref', null, 'pos_conversion_started_at', null,
    'fulfillment_status', 'accepted', 'fulfillment_version', 1,
    'fulfillment_updated_at', now(), 'cancelled_at', null,
    'created_at', now(), 'updated_at', now()
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_order) || jsonb_build_object(
    'id', v_claimed, 'idempotency_key', v_prefix || '-B',
    'pos_draft_status', 'claimed', 'pos_claim_token', v_claim_token,
    'pos_claim_request_key', 'fixture-claim', 'pos_claimed_at', now(),
    'pos_claim_expires_at', now() + interval '15 minutes',
    'pos_claim_actor_type', 'admin', 'pos_claim_actor_ref', v_device_id::text
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_order) || jsonb_build_object(
    'id', v_prepared, 'idempotency_key', v_prefix || '-C',
    'pos_draft_status', 'prepared', 'pos_draft_id', 'draft-prepared',
    'pos_draft_prepared_at', now(), 'pos_claim_token', extensions.gen_random_uuid(),
    'pos_claim_request_key', 'fixture-prepared'
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_order) || jsonb_build_object(
    'id', v_reserved, 'idempotency_key', v_prefix || '-D',
    'pos_draft_id', 'draft-reserved', 'pos_conversion_status', 'reserved',
    'pos_conversion_attempt_id', 'attempt-reserved', 'pos_conversion_sale_id', 'draft-reserved',
    'pos_conversion_key', 'ecommerce:' || v_reserved::text,
    'pos_conversion_actor_ref', v_device_id::text, 'pos_conversion_started_at', now()
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_completed, 'portal_id', v_portal_id, 'license_id', v_license_id,
    'idempotency_key', v_prefix || '-E', 'status', 'accepted', 'pos_visibility_status', 'archived',
    'converted_sale_id', null, 'converted_at', null,
    'pos_draft_status', 'none', 'pos_draft_id', null, 'pos_claim_token', null,
    'pos_claim_request_key', null, 'pos_claimed_at', null, 'pos_claim_expires_at', null,
    'pos_claim_actor_type', null, 'pos_claim_actor_ref', null, 'pos_draft_prepared_at', null,
    'pos_conversion_status', 'idle', 'pos_conversion_attempt_id', null,
    'pos_conversion_sale_id', null, 'pos_conversion_key', null,
    'pos_conversion_actor_ref', null, 'pos_conversion_started_at', null,
    'fulfillment_status', 'completed', 'fulfillment_version', 3,
    'fulfillment_updated_at', now(), 'created_at', now(), 'updated_at', now()
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_order) || jsonb_build_object(
    'id', v_cancelled, 'idempotency_key', v_prefix || '-F',
    'fulfillment_status', 'cancelled', 'cancelled_at', now()
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_converted, 'portal_id', v_portal_id, 'license_id', v_license_id,
    'idempotency_key', v_prefix || '-G', 'status', 'converted_to_sale',
    'pos_visibility_status', 'archived', 'converted_sale_id', 'sale-converted', 'converted_at', now(),
    'pos_draft_status', 'prepared', 'pos_draft_id', 'sale-converted',
    'pos_claim_token', extensions.gen_random_uuid(), 'pos_claim_request_key', 'fixture-converted',
    'pos_claimed_at', now(), 'pos_claim_expires_at', now() + interval '15 minutes',
    'pos_claim_actor_type', 'admin', 'pos_claim_actor_ref', v_device_id::text,
    'pos_draft_prepared_at', now(), 'pos_conversion_status', 'completed',
    'pos_conversion_attempt_id', 'attempt-converted', 'pos_conversion_sale_id', 'sale-converted',
    'pos_conversion_key', 'ecommerce:' || v_converted::text,
    'pos_conversion_actor_ref', v_device_id::text, 'pos_conversion_started_at', now(),
    'fulfillment_status', 'ready', 'fulfillment_version', 3,
    'fulfillment_updated_at', now(), 'created_at', now(), 'updated_at', now()
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(null::public.ecommerce_orders, to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_stale, 'portal_id', v_portal_id, 'license_id', v_license_id,
    'idempotency_key', v_prefix || '-H', 'status', 'accepted', 'pos_visibility_status', 'visible',
    'converted_sale_id', null, 'converted_at', null,
    'pos_draft_status', 'none', 'pos_draft_id', null, 'pos_claim_token', null,
    'pos_claim_request_key', null, 'pos_claimed_at', null, 'pos_claim_expires_at', null,
    'pos_claim_actor_type', null, 'pos_claim_actor_ref', null, 'pos_draft_prepared_at', null,
    'pos_conversion_status', 'idle', 'pos_conversion_attempt_id', null,
    'pos_conversion_sale_id', null, 'pos_conversion_key', null,
    'pos_conversion_actor_ref', null, 'pos_conversion_started_at', null,
    'fulfillment_status', 'accepted', 'fulfillment_version', 7,
    'fulfillment_updated_at', now(), 'created_at', now(), 'updated_at', now()
  ));
  perform private.ecom21_insert_order_fixture_v1(to_jsonb(v_order));

  -- Terminal policy and POS guards.
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_no_claim, 'cancelled', 1, 'cancel-no-claim', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'cancel without claim failed: %', v_result;
  end if;
  select * into v_order from public.ecommerce_orders where id = v_no_claim;
  if v_order.fulfillment_status <> 'cancelled' or v_order.pos_visibility_status <> 'archived' then
    raise exception 'terminal cancellation was not archived';
  end if;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_key, v_fingerprint, v_security_token, null, v_no_claim, 'claim-after-cancel'
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL' then
    raise exception 'claim after cancel was not blocked: %', v_result;
  end if;

  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_claimed, 'cancelled', 1, 'cancel-active-claim', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'cancel active claim failed: %', v_result;
  end if;
  select * into v_order from public.ecommerce_orders where id = v_claimed;
  if v_order.pos_draft_status <> 'released'
     or v_order.pos_claim_token is not null
     or v_order.pos_claim_actor_ref is not null then
    raise exception 'active claim was not atomically released';
  end if;

  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_prepared, 'cancelled', 1, 'cancel-prepared', null
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_POS_DRAFT_PREPARED' then
    raise exception 'prepared draft cancellation was not blocked: %', v_result;
  end if;

  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_reserved, 'cancelled', 1, 'cancel-reserved', null
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_POS_CONVERSION_IN_PROGRESS' then
    raise exception 'reserved conversion cancellation was not blocked: %', v_result;
  end if;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_key, v_fingerprint, v_security_token, null, v_completed, 'claim-completed'
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL' then
    raise exception 'completed claim was not blocked';
  end if;

  v_result := public.ecommerce_begin_pos_conversion(
    v_key, v_fingerprint, v_security_token, null,
    v_cancelled, extensions.gen_random_uuid(), 'draft-x', 'attempt-x', 'draft-x',
    'ecommerce:' || v_cancelled::text
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL' then
    raise exception 'cancelled begin conversion was not blocked: %', v_result;
  end if;

  -- Optimistic concurrency and idempotency.
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_stale, 'preparing', 6, 'stale-version', null
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_STATUS_STALE' then
    raise exception 'stale expected version did not fail: %', v_result;
  end if;

  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_stale, 'preparing', 7, 'idempotent-transition', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'first idempotent transition failed: %', v_result;
  end if;

  v_replay := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_stale, 'preparing', 7, 'idempotent-transition', null
  );
  if coalesce((v_replay->>'idempotent')::boolean, false) is not true then
    raise exception 'idempotent replay failed: %', v_replay;
  end if;

  select count(*) into v_count
  from private.ecommerce_order_fulfillment_events
  where order_id = v_stale and event_key = 'idempotent-transition';
  if v_count <> 1 then
    raise exception 'idempotent replay duplicated fulfillment events';
  end if;

  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, null,
    v_stale, 'ready', 8, 'idempotent-transition', null
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_STATUS_INVALID_TRANSITION' then
    raise exception 'idempotency key reused with another transition did not fail';
  end if;

  -- Stable portal bucket plus valid-token secondary bucket.
  v_tracking := private.ecommerce_tracking_token_for_order_v1(v_stale);
  v_token := v_tracking->>'token';

  delete from public.pos_rpc_rate_limits
  where license_key = 'ecommerce-tracking:' || v_license_id::text
    and rpc_name = 'ecommerce_get_order_tracking';

  perform public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('A',42) || '1');
  perform public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('B',42) || '2');
  perform public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('C',42) || '3');

  select count(*), coalesce(sum(request_count),0)
  into v_rows, v_count
  from public.pos_rpc_rate_limits
  where license_key = 'ecommerce-tracking:' || v_license_id::text
    and device_fingerprint = 'tracking-portal:' || v_portal_id::text
    and rpc_name = 'ecommerce_get_order_tracking';
  if v_rows <> 1 or v_count <> 3 then
    raise exception 'rotating invalid tokens did not share one portal bucket';
  end if;

  v_public := public.ecommerce_get_order_tracking(v_slug, v_token);
  if coalesce((v_public->>'success')::boolean, false) is not true then
    raise exception 'valid tracking failed: %', v_public;
  end if;
  if v_public::text ~* '(license_id|portal_id|order_id|sale_id|staff_id|customer_phone|customer_address|security_token|claim_token|conversion_key|token_hash|trk1_)' then
    raise exception 'public tracking payload leaked forbidden data';
  end if;

  select count(*) into v_count
  from public.pos_rpc_rate_limits
  where license_key = 'ecommerce-tracking:' || v_license_id::text
    and scope = 'ECOMMERCE_ORDER_TRACKING_TOKEN';
  if v_count <> 1 then
    raise exception 'valid-token secondary bucket missing';
  end if;
  if exists (
    select 1 from public.pos_rpc_rate_limits
    where license_key = 'ecommerce-tracking:' || v_license_id::text
      and metadata::text like '%' || v_token || '%'
  ) then
    raise exception 'plaintext tracking token persisted in rate-limit metadata';
  end if;

  -- Tracking remains available while storefront is paused; new orders remain blocked.
  update public.ecommerce_portals
  set status = 'paused', updated_at = now()
  where id = v_portal_id;

  v_public := public.ecommerce_get_order_tracking(v_slug, v_token);
  if coalesce((v_public->>'success')::boolean, false) is not true
     or coalesce((v_public#>>'{tracking,storefrontAvailable}')::boolean, true) is not false then
    raise exception 'paused portal tracking contract failed: %', v_public;
  end if;

  v_new_order := public.ecommerce_create_order(
    v_slug,
    jsonb_build_object('name','Fixture','phone','0000000000','fulfillmentMethod','pickup'),
    '[]'::jsonb,
    'fixture-new-order'
  );
  if coalesce((v_new_order->>'success')::boolean, false) is true then
    raise exception 'paused portal accepted a new order';
  end if;

  update private.ecommerce_order_tracking_tokens
  set revoked_at = now()
  where order_id = v_stale;
  v_public := public.ecommerce_get_order_tracking(v_slug, v_token);
  if v_public#>>'{error,code}' <> 'ECOMMERCE_TRACKING_NOT_FOUND' then
    raise exception 'revoked token remained visible';
  end if;

  update private.ecommerce_order_tracking_tokens
  set revoked_at = null
  where order_id = v_stale;
  update public.ecommerce_portals
  set deleted_at = now()
  where id = v_portal_id;
  v_public := public.ecommerce_get_order_tracking(v_slug, v_token);
  if v_public#>>'{error,code}' <> 'ECOMMERCE_TRACKING_NOT_FOUND' then
    raise exception 'logically deleted portal remained trackable';
  end if;
  update public.ecommerce_portals set deleted_at = null where id = v_portal_id;

  -- Operational list and counts exclude terminal orders but retain converted non-terminal orders.
  v_list := public.ecommerce_admin_list_orders(
    v_key, v_fingerprint, v_security_token, null, 'all', 50, 0
  );
  if coalesce((v_list->>'success')::boolean, false) is not true then
    raise exception 'administrative list failed: %', v_list;
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_list->'orders') e
    where e->>'id' in (v_no_claim::text, v_claimed::text, v_completed::text, v_cancelled::text)
  ) then
    raise exception 'terminal order leaked into operational list';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_list->'orders') e
    where e->>'id' = v_converted::text
  ) then
    raise exception 'converted non-terminal order missing from operational list';
  end if;
  if (v_list#>>'{counts,total}')::integer <> jsonb_array_length(v_list->'orders') then
    raise exception 'operational counts do not match fixture list';
  end if;
end
$test$;

rollback;
