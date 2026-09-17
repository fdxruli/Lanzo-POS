-- LICENSE.LIFECYCLE.4
-- Production-safe roundtrip matrix.  Every fixture is transaction-local and
-- this file must be executed as one script so the final ROLLBACK is guaranteed.
begin;

-- The stock-reservation writer is intentionally not part of this fixture: the
-- reservation is seeded as immutable business history and its trigger is
-- disabled only to avoid manufacturing an extra legitimate stock operation.
-- Both corrected tenant-scope triggers remain enabled throughout.
alter table public.ecommerce_order_items
  disable trigger ecommerce_order_items_stock_reservation;

do $test$
declare
  v_pro_plan uuid;
  v_free_plan uuid;
  v_roundtrip uuid := extensions.gen_random_uuid();
  v_free_normal uuid := extensions.gen_random_uuid();
  v_grace uuid := extensions.gen_random_uuid();
  v_expired_unmaterialized uuid := extensions.gen_random_uuid();
  v_already_pro uuid := extensions.gen_random_uuid();
  v_suspended uuid := extensions.gen_random_uuid();
  v_tenant_b uuid := extensions.gen_random_uuid();
  v_portal uuid := extensions.gen_random_uuid();
  v_portal_b uuid := extensions.gen_random_uuid();
  v_admin_device uuid := extensions.gen_random_uuid();
  v_shared_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_staff_user uuid := extensions.gen_random_uuid();
  v_order uuid := extensions.gen_random_uuid();
  v_order_item uuid := extensions.gen_random_uuid();
  v_cross_order uuid := extensions.gen_random_uuid();
  v_product uuid;
  v_product_11 uuid;
  v_product_12 uuid;
  v_product_13 uuid;
  v_product_b uuid := extensions.gen_random_uuid();
  v_period_pro_before uuid;
  v_period_free uuid;
  v_period_pro_after uuid;
  v_result jsonb;
  v_retry jsonb;
  v_order_before jsonb;
  v_order_after jsonb;
  v_reservation_before jsonb;
  v_reservation_after jsonb;
  v_events_before integer;
  v_notifications_before integer;
  v_count integer;
begin
  select id into v_pro_plan
    from public.plans where code = 'pro_monthly' and is_active limit 1;
  select id into v_free_plan
    from public.plans where code = 'free_trial' and is_active limit 1;
  if v_pro_plan is null or v_free_plan is null then
    raise exception 'LICENSE.LIFECYCLE.4 requires active pro_monthly and free_trial plans';
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values
    (v_roundtrip, 'LIFECYCLE-R4-ROUNDTRIP-' || v_roundtrip, v_pro_plan, 'subscription', 'active', now() + interval '1 day', false, 1, 5,
      '{"roundtrip_custom":"preserve","cloud_layaways":true}'::jsonb, 'Roundtrip Pro'),
    (v_free_normal, 'LIFECYCLE-R4-FREE-' || v_free_normal, v_free_plan, 'free', 'active', null, true, null, 1,
      '{"free_custom":"preserve"}'::jsonb, 'Free'),
    (v_grace, 'LIFECYCLE-R4-GRACE-' || v_grace, v_pro_plan, 'subscription', 'active', now() - interval '3 days', false, 1, 5,
      '{}'::jsonb, 'Grace Pro'),
    (v_expired_unmaterialized, 'LIFECYCLE-R4-EXPIRED-' || v_expired_unmaterialized, v_pro_plan, 'subscription', 'active', now() - interval '8 days', false, 1, 5,
      '{}'::jsonb, 'Expired Pro'),
    (v_already_pro, 'LIFECYCLE-R4-ACTIVE-' || v_already_pro, v_pro_plan, 'subscription', 'active', now() + interval '15 days', false, 1, 5,
      '{}'::jsonb, 'Active Pro'),
    (v_suspended, 'LIFECYCLE-R4-SUSPENDED-' || v_suspended, v_pro_plan, 'subscription', 'suspended', now() - interval '8 days', false, 1, 5,
      '{}'::jsonb, 'Suspended Pro'),
    (v_tenant_b, 'LIFECYCLE-R4-TENANT-B-' || v_tenant_b, v_pro_plan, 'subscription', 'active', now() + interval '15 days', false, 1, 5,
      '{}'::jsonb, 'Tenant B Pro');

  insert into public.license_periods (
    id, license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    extensions.gen_random_uuid(), v_roundtrip, v_pro_plan, 'pro_monthly', 'Lanzo Nube',
    'pro_paid', 'active', now() - interval '30 days', now() + interval '1 day', 15,
    '{"roundtrip":"pro_before"}'::jsonb
  ) returning id into v_period_pro_before;

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, is_active, activated_at,
    last_used_at, security_token, previous_security_token, device_role, device_mode
  ) values
    (v_admin_device, v_roundtrip, 'r4-admin-' || v_admin_device, 'Admin', true, now() - interval '30 days', now() - interval '1 day', 'admin-token', null, 'admin', 'admin_only'),
    (v_shared_device, v_roundtrip, 'r4-shared-' || v_shared_device, 'Shared', true, now() - interval '20 days', now(), 'shared-token', 'shared-previous', 'admin', 'shared'),
    (v_staff_device, v_roundtrip, 'r4-staff-' || v_staff_device, 'Staff', true, now() - interval '10 days', now(), 'staff-token', null, 'staff', 'staff_only');

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, metadata
  ) values (
    v_staff_user, v_roundtrip, 'r4-staff', 'Staff preservado', 'fixture-hash', 'staff',
    '{"roundtrip":"preserve"}'::jsonb
  );
  update public.license_devices set staff_user_id = v_staff_user where id = v_staff_device;
  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, metadata
  ) values (
    v_roundtrip, v_staff_user, v_staff_device, 'fixture-session-hash', '{"roundtrip":true}'::jsonb
  );

  insert into public.ecommerce_portals (
    id, license_id, slug, slug_source, status, name, headline, description,
    customization_level, theme, whatsapp_phone, delivery_enabled, settings,
    address_street, address_neighborhood, address_municipality, address_state,
    address_postal_code
  ) values
    (v_portal, v_roundtrip, 'lifecycle-r4-' || replace(v_roundtrip::text, '-', ''), 'custom', 'published',
     'Portal R4', 'Headline Pro preservado', 'Descripcion Pro preservada', 'advanced',
     '{"primaryColor":"#123456"}'::jsonb, '9610000000', true,
     '{"deliveryPickupSettings":{"radiusKm":12},"advanced":"preserve"}'::jsonb,
     'Calle Prueba 1', 'Centro', 'Tuxtla Gutierrez', 'Chiapas', '29000'),
    (v_portal_b, v_tenant_b, 'lifecycle-r4-b-' || replace(v_tenant_b::text, '-', ''), 'custom', 'published',
     'Portal B', 'B', 'B', 'advanced', '{}'::jsonb, '9610000001', true, '{}'::jsonb,
     'Calle B', 'Centro', 'Tuxtla Gutierrez', 'Chiapas', '29000');

  for v_count in 1..13 loop
    v_product := extensions.gen_random_uuid();
    insert into public.ecommerce_published_products (
      id, portal_id, license_id, local_product_ref, public_name, price,
      is_published, display_order, metadata
    ) values (
      v_product, v_portal, v_roundtrip, 'r4-product-' || v_count,
      'Producto ' || lpad(v_count::text, 2, '0'), v_count, true, v_count,
      jsonb_build_object('fixture_order', v_count)
    );

    if v_count = 11 then v_product_11 := v_product; end if;
    if v_count = 12 then v_product_12 := v_product; end if;
    if v_count = 13 then v_product_13 := v_product; end if;

    if v_count = 1 then
      insert into public.ecommerce_orders (
        id, portal_id, license_id, status, customer_name, customer_phone,
        stock_reservation_status, stock_reservation_expires_at,
        stock_reservation_phase, metadata
      ) values (
        v_order, v_portal, v_roundtrip, 'new', 'Cliente fixture', '9610000000',
        'reserved', now() + interval '30 minutes', 'checkout', '{"historical":"preserve"}'::jsonb
      );
      insert into public.ecommerce_order_items (
        id, order_id, portal_id, license_id, published_product_id,
        source_product_id, product_name, unit_price, quantity, line_total, metadata
      ) values (
        v_order_item, v_order, v_portal, v_roundtrip, v_product,
        'r4-product-1', 'Producto 01', 1, 1, 1, '{"historical":"preserve"}'::jsonb
      );
      insert into public.ecommerce_order_inventory_reservations (
        order_id, order_item_id, portal_id, license_id, published_product_id,
        source_product_id, quantity, status, stock_before, stock_after,
        committed_before, committed_after, idempotency_key, expires_at,
        reservation_phase, metadata
      ) values (
        v_order, v_order_item, v_portal, v_roundtrip, v_product,
        'r4-product-1', 1, 'reserved', 20, 20, 0, 1,
        'r4-reservation-' || v_order, now() + interval '30 minutes', 'checkout',
        '{"historical":"preserve"}'::jsonb
      );
    end if;
  end loop;

  insert into public.ecommerce_published_products (
    id, portal_id, license_id, local_product_ref, public_name, price,
    is_published, display_order
  ) values (
    v_product_b, v_portal_b, v_tenant_b, 'r4-b-product', 'Producto B', 10, true, 1
  );

  select to_jsonb(o) into v_order_before from public.ecommerce_orders o where o.id = v_order;
  select to_jsonb(r) into v_reservation_before
    from public.ecommerce_order_inventory_reservations r where r.order_id = v_order;

  -- The expired materialization is Phase 2's authoritative downgrade.
  update public.licenses set expires_at = now() - interval '8 days' where id = v_roundtrip;
  v_result := private.materialize_expired_license_to_free_v1(v_roundtrip);
  if v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
    raise exception 'R4 roundtrip downgrade failed: %', v_result;
  end if;

  select id into v_period_free
    from public.license_periods
   where license_id = v_roundtrip and status = 'active' and plan_code_snapshot = 'free_trial';
  if v_period_free is null then raise exception 'R4 did not create the Free lifetime period'; end if;

  if not exists (
    select 1 from public.license_devices d
     where d.id = v_shared_device
       and d.is_active is false
       and d.device_info #>> '{license_block,reason}' = 'PLAN_DOWNGRADE_DEVICE_LIMIT'
       and d.security_token is null and d.previous_security_token is null
  ) then
    raise exception 'R4 did not make the shared-device downgrade reversible and credential-safe';
  end if;

  if not exists (
    select 1 from public.license_staff_sessions s
     where s.license_id = v_roundtrip and s.revoked_at is not null
  ) then
    raise exception 'R4 did not revoke the pre-existing Staff session during Free downgrade';
  end if;

  -- Product 11 remains eligible and is the reversible publication case.
  -- Product 12 was manually unpublished after the downgrade; Product 13 has
  -- become ineligible while Free.  Neither is permitted to reappear.
  update public.ecommerce_published_products
     set metadata = (metadata - 'plan_downgrade_publication') || jsonb_build_object('manual_unpublish_after_downgrade', true)
   where id = v_product_12;
  update public.ecommerce_published_products
     set manual_available = false
   where id = v_product_13;

  v_result := private.materialize_license_upgrade_v1(
    v_roundtrip, 'pro_monthly', 1, 'roundtrip fixture',
    jsonb_build_object('type', 'test_admin', 'subject', 'r4')
  );
  if v_result->>'code' <> 'LICENSE_UPGRADED_TO_PAID'
     or coalesce((v_result->>'changed')::boolean, false) is not true then
    raise exception 'R4 Free to Pro activation failed: %', v_result;
  end if;
  v_period_pro_after := nullif(v_result->>'period_id', '')::uuid;

  if not exists (
    select 1
      from public.licenses l
      join public.plans p on p.id = l.plan_id
      cross join lateral private.license_entitlement_state_v1(l.id) e
     where l.id = v_roundtrip
       and p.code = 'pro_monthly'
       and l.license_type = 'subscription'
       and l.is_lifetime is false
       and l.status = 'active'
       and l.duration_months = 1
       and l.expires_at > now()
       and e.lifecycle_state = 'active'
       and e.is_entitled is true
       and e.effective_features->>'cloud_pos_sync' = 'true'
       and l.features->>'roundtrip_custom' = 'preserve'
       and not exists (
         select 1 from jsonb_object_keys(coalesce(p.features, '{}'::jsonb)) k
          where l.features->k is distinct from p.features->k
       )
  ) then
    raise exception 'R4 Pro snapshot/entitlement does not exactly restore the destination plan';
  end if;

  if not exists (
    select 1 from public.license_periods
     where id = v_period_free and status = 'closed' and ends_at is not null
  ) or not exists (
    select 1 from public.license_periods
     where id = v_period_pro_after and status = 'active' and plan_code_snapshot = 'pro_monthly'
  ) or (select count(*) from public.license_periods where license_id = v_roundtrip and status = 'active') <> 1 then
    raise exception 'R4 period history is overlapping or missing';
  end if;

  if (select count(*) from public.license_events
       where license_key = 'LIFECYCLE-R4-ROUNDTRIP-' || v_roundtrip
         and event_type = 'PLAN_CHANGED'
         and metadata->>'new_period_id' = v_period_pro_after::text) <> 1 then
    raise exception 'R4 did not write exactly one authoritative upgrade event';
  end if;

  if not exists (
    select 1 from public.ecommerce_published_products
     where id = v_product_11 and is_published
       and metadata #>> '{plan_downgrade_publication,reason}' is null
  ) or exists (select 1 from public.ecommerce_published_products where id = v_product_12 and is_published)
    or exists (select 1 from public.ecommerce_published_products where id = v_product_13 and is_published) then
    raise exception 'R4 publication restoration did not respect downgrade/manual/eligibility intent';
  end if;

  if not exists (
    select 1 from public.ecommerce_portals p
     where p.id = v_portal and p.slug_source = 'custom'
       and p.headline = 'Headline Pro preservado'
       and p.description = 'Descripcion Pro preservada'
       and p.customization_level = 'advanced'
       and p.theme = '{"primaryColor":"#123456"}'::jsonb
       and p.delivery_enabled is true
       and p.settings #>> '{deliveryPickupSettings,radiusKm}' = '12'
  ) then
    raise exception 'R4 changed preserved ecommerce configuration';
  end if;

  if not exists (select 1 from public.license_staff_users where id = v_staff_user and is_active)
     or not exists (select 1 from public.license_staff_sessions where license_id = v_roundtrip and revoked_at is not null)
     or exists (select 1 from public.license_staff_sessions where license_id = v_roundtrip and revoked_at is null)
     or not exists (
       select 1 from public.license_devices d
        where d.id = v_shared_device and d.is_active
          and d.security_token is null and d.previous_security_token is null
          and d.device_mode = 'shared'
     )
     or exists (select 1 from public.license_devices where id = v_staff_device and is_active) then
    raise exception 'R4 Staff/device restoration violated session, credential, or shared-terminal safety';
  end if;

  select to_jsonb(o) into v_order_after from public.ecommerce_orders o where o.id = v_order;
  select to_jsonb(r) into v_reservation_after
    from public.ecommerce_order_inventory_reservations r where r.order_id = v_order;
  if v_order_after is distinct from v_order_before
     or v_reservation_after is distinct from v_reservation_before then
    raise exception 'R4 plan transition modified order/reservation history or committed stock';
  end if;

  select count(*) into v_events_before
    from public.license_events where license_key = 'LIFECYCLE-R4-ROUNDTRIP-' || v_roundtrip;
  select count(*) into v_notifications_before
    from public.pos_notifications
   where license_id = v_roundtrip
     and metadata->>'event' = 'license_plan_upgraded_to_paid'
     and metadata->>'period_id' = v_period_pro_after::text;
  v_retry := private.materialize_license_upgrade_v1(v_roundtrip, 'pro_monthly', 1, 'roundtrip fixture', jsonb_build_object('type', 'test_admin', 'subject', 'r4'));
  if v_retry->>'code' <> 'ALREADY_ON_PLAN'
     or (select count(*) from public.license_periods where license_id = v_roundtrip and status = 'active') <> 1
     or (select count(*) from public.license_events where license_key = 'LIFECYCLE-R4-ROUNDTRIP-' || v_roundtrip) <> v_events_before
     or (select count(*) from public.pos_notifications
          where license_id = v_roundtrip
            and metadata->>'event' = 'license_plan_upgraded_to_paid'
            and metadata->>'period_id' = v_period_pro_after::text) <> v_notifications_before then
    raise exception 'R4 retry was not a stable NOOP';
  end if;

  -- A normal Free tenant can be activated, a grace tenant renews directly, and
  -- a material Pro row that the scheduler selected before this call is safe to
  -- process afterwards because Phase 2 re-evaluates under the same row lock.
  if (private.materialize_license_upgrade_v1(v_free_normal, 'pro_monthly', 1, 'free normal', null)->>'code') <> 'LICENSE_UPGRADED_TO_PAID'
     or (private.materialize_license_upgrade_v1(v_grace, 'pro_monthly', 1, 'grace renewal', null)->>'code') <> 'LICENSE_UPGRADED_TO_PAID'
     or (private.materialize_license_upgrade_v1(v_expired_unmaterialized, 'pro_monthly', 1, 'expired renewal', null)->>'code') <> 'LICENSE_UPGRADED_TO_PAID'
     or (private.materialize_license_upgrade_v1(v_already_pro, 'pro_monthly', 1, 'already active', null)->>'code') <> 'ALREADY_ON_PLAN'
     or (private.materialize_license_upgrade_v1(v_suspended, 'pro_monthly', 1, 'blocked', null)->>'code') <> 'ADMINISTRATIVELY_BLOCKED' then
    raise exception 'R4 renewal state matrix failed';
  end if;

  if exists (select 1 from public.license_periods where license_id = v_grace and plan_code_snapshot = 'free_trial')
     or exists (select 1 from public.license_periods where license_id = v_expired_unmaterialized and plan_code_snapshot = 'free_trial')
     or (private.materialize_expired_license_to_free_v1(v_expired_unmaterialized)->>'code') <> 'LICENSE_ACTIVE' then
    raise exception 'R4 grace/stale-scheduler renewal introduced an artificial Free transition';
  end if;

  -- The order-item guard must reject a product belonging to tenant B before a
  -- downstream writer can derive or persist a cross-tenant scope.
  insert into public.ecommerce_orders (
    id, portal_id, license_id, status, customer_name, customer_phone, metadata
  ) values (
    v_cross_order, v_portal, v_roundtrip, 'new', 'Cross tenant', '9610000000', '{}'::jsonb
  );
  begin
    insert into public.ecommerce_order_items (
      order_id, portal_id, license_id, published_product_id, source_product_id,
      product_name, unit_price, quantity, line_total
    ) values (
      v_cross_order, v_portal, v_roundtrip, v_product_b, 'r4-b-product',
      'Cross tenant', 10, 1, 10
    );
    raise exception 'R4 cross-tenant order item unexpectedly succeeded';
  exception
    when sqlstate '23514' then null;
  end;

  if has_function_privilege('public', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute') then
    raise exception 'R4 private upgrade primitive ACL mismatch';
  end if;
end;
$test$;

alter table public.ecommerce_order_items
  enable trigger ecommerce_order_items_stock_reservation;

rollback;
