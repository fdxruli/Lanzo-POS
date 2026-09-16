-- LICENSE.LIFECYCLE.1
-- Transactional production-safe matrix. Every fixture is rolled back.
begin;

do $test$
declare
  v_plan_id uuid;
  v_active uuid := extensions.gen_random_uuid();
  v_grace uuid := extensions.gen_random_uuid();
  v_expired uuid := extensions.gen_random_uuid();
  v_free uuid := extensions.gen_random_uuid();
  v_suspended uuid := extensions.gen_random_uuid();
  v_cancelled uuid := extensions.gen_random_uuid();
  v_portal uuid := extensions.gen_random_uuid();
  v_state record;
  v_result jsonb;
begin
  select id into v_plan_id
  from public.plans
  where code = 'pro_monthly'
  limit 1;

  if v_plan_id is null then
    raise exception 'pro_monthly plan fixture is required';
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, max_devices, features, product_name
  ) values
    (v_active, 'LIFECYCLE-R1-ACTIVE-' || v_active, v_plan_id, 'subscription', 'active',
      now() + interval '1 day', false, 1,
      '{"cloud_pos_sync":true,"ecommerce_portal_enabled":true,"ecommerce_max_published_products":100}'::jsonb,
      'Lifecycle active fixture'),
    (v_grace, 'LIFECYCLE-R1-GRACE-' || v_grace, v_plan_id, 'subscription', 'active',
      now() - interval '3 days', false, 1,
      '{"cloud_pos_sync":true,"ecommerce_portal_enabled":true,"ecommerce_max_published_products":100}'::jsonb,
      'Lifecycle grace fixture'),
    (v_expired, 'LIFECYCLE-R1-EXPIRED-' || v_expired, v_plan_id, 'subscription', 'active',
      now() - interval '8 days', false, 1,
      '{"cloud_pos_sync":true,"ecommerce_portal_enabled":true,"ecommerce_max_published_products":100}'::jsonb,
      'Lifecycle expired fixture'),
    (v_free, 'LIFECYCLE-R1-FREE-' || v_free,
      (select id from public.plans where code = 'free_trial' limit 1),
      'free', 'active', null, true, 1, '{}'::jsonb, 'Lanzo POS Free'),
    (v_suspended, 'LIFECYCLE-R1-SUSPENDED-' || v_suspended, v_plan_id, 'subscription', 'suspended',
      now() + interval '1 day', false, 1,
      '{"cloud_pos_sync":true,"ecommerce_portal_enabled":true}'::jsonb,
      'Lifecycle suspended fixture'),
    (v_cancelled, 'LIFECYCLE-R1-CANCELLED-' || v_cancelled, v_plan_id, 'subscription', 'cancelled',
      now() - interval '3 days', false, 1,
      '{"cloud_pos_sync":true,"ecommerce_portal_enabled":true}'::jsonb,
      'Lifecycle cancelled fixture');

  select * into v_state from private.license_entitlement_state_v1(v_active);
  if v_state.lifecycle_state <> 'active'
     or v_state.is_entitled is not true
     or (v_state.effective_features->>'cloud_pos_sync') <> 'true' then
    raise exception 'active Pro lifecycle mismatch: %', row_to_json(v_state);
  end if;

  select * into v_state from private.license_entitlement_state_v1(v_grace);
  if v_state.lifecycle_state <> 'grace_period'
     or v_state.is_entitled is not true
     or v_state.is_in_grace is not true
     or (v_state.effective_features->>'cloud_pos_sync') <> 'true' then
    raise exception 'grace Pro lifecycle mismatch: %', row_to_json(v_state);
  end if;

  select * into v_state from private.license_entitlement_state_v1(v_expired);
  if v_state.lifecycle_state <> 'expired'
     or v_state.is_entitled is not false
     or v_state.effective_features <> '{}'::jsonb then
    raise exception 'expired Pro lifecycle mismatch: %', row_to_json(v_state);
  end if;

  select * into v_state from private.license_entitlement_state_v1(v_free);
  if v_state.lifecycle_state <> 'active'
     or v_state.is_entitled is not true
     or v_state.is_in_grace is not false
     or v_state.grace_period_ends is not null then
    raise exception 'Free lifetime lifecycle mismatch: %', row_to_json(v_state);
  end if;

  select * into v_state from private.license_entitlement_state_v1(v_suspended);
  if v_state.lifecycle_state <> 'administratively_blocked'
     or v_state.is_entitled is not false
     or v_state.is_in_grace is not false then
    raise exception 'suspended lifecycle mismatch: %', row_to_json(v_state);
  end if;

  select * into v_state from private.license_entitlement_state_v1(v_cancelled);
  if v_state.lifecycle_state <> 'administratively_blocked'
     or v_state.is_entitled is not false
     or v_state.is_in_grace is not false then
    raise exception 'cancelled lifecycle mismatch: %', row_to_json(v_state);
  end if;

  if private.ecommerce_license_feature_bool(v_active, 'ecommerce_portal_enabled', false) is not true
     or private.ecommerce_license_feature_bool(v_grace, 'ecommerce_portal_enabled', false) is not true
     or private.ecommerce_license_feature_bool(v_expired, 'ecommerce_portal_enabled', false) is not false then
    raise exception 'effective ecommerce feature matrix failed';
  end if;

  insert into public.ecommerce_portals (
    id, license_id, slug, status, name, ordering_enabled, pickup_enabled,
    delivery_enabled, min_order_total, max_order_items, max_item_quantity,
    stock_mode, business_hours_enabled, timezone, address_street,
    address_neighborhood, address_municipality, address_state,
    address_postal_code, whatsapp_phone
  ) values (
    v_portal, v_active, 'lifecycle-r1-portal', 'published', 'Lifecycle portal',
    true, true, false, 0, 30, 99, 'hidden', false, 'America/Mexico_City',
    'Calle Prueba 1', 'Centro', 'Tuxtla Gutierrez', 'Chiapas', '29000',
    '9610000000'
  );

  if (private.ecommerce_get_public_portal_by_slug('lifecycle-r1-portal')).id is null then
    raise exception 'active Pro public portal was not resolved';
  end if;

  v_result := public.ecommerce_get_catalog('lifecycle-r1-portal', 100, 0);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'active Pro catalog was denied: %', v_result;
  end if;

  update public.licenses
  set expires_at = now() - interval '3 days'
  where id = v_active;
  if (private.ecommerce_get_public_portal_by_slug('lifecycle-r1-portal')).id is null then
    raise exception 'grace Pro public portal was not resolved';
  end if;

  v_result := public.ecommerce_get_catalog('lifecycle-r1-portal', 100, 0);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'grace Pro catalog was denied: %', v_result;
  end if;

  update public.licenses
  set expires_at = now() - interval '8 days'
  where id = v_active;
  if (private.ecommerce_get_public_portal_by_slug('lifecycle-r1-portal')).id is not null then
    raise exception 'expired Pro public portal remained resolvable';
  end if;

  v_result := public.ecommerce_get_catalog('lifecycle-r1-portal', 100, 0);
  if coalesce((v_result->>'success')::boolean, false) is true then
    raise exception 'expired Pro catalog remained available: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'lifecycle-r1-portal',
    jsonb_build_object('name', 'Cliente', 'phone', '9610000000', 'fulfillmentMethod', 'pickup'),
    '[]'::jsonb,
    'lifecycle-r1-expired-order'
  );
  if coalesce((v_result->>'success')::boolean, false) is true
     or v_result #>> '{error,code}' <> 'ECOMMERCE_PORTAL_NOT_FOUND' then
    raise exception 'expired Pro checkout was not denied at portal boundary: %', v_result;
  end if;

  begin
    perform private.validate_pos_sync_context(
      'LIFECYCLE-R1-EXPIRED-' || v_expired,
      'missing-device',
      'missing-token',
      'missing-actor'
    );
    raise exception 'expired Pro cloud context unexpectedly authorized';
  exception
    when sqlstate 'P0001' then
      if sqlerrm <> 'LICENSE_EXPIRED' then
        raise exception 'expired Pro cloud context returned unexpected error: %', sqlerrm;
      end if;
  end;

  if public.ensure_current_license_period(v_expired) is not null then
    raise exception 'expired Pro created or reused an active entitlement period';
  end if;
end;
$test$;

rollback;
