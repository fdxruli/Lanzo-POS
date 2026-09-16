-- LICENSE.LIFECYCLE.2
-- Production-safe transactional matrix. All fixture writes are rolled back.
begin;

-- Transaction-local fixture accommodation for a pre-existing trigger debt:
-- private.ecommerce_phase4_tenant_scope_guard references a variant column that
-- is not present on ecommerce_order_items. The trigger state is restored before
-- rollback and any test failure rolls the DDL back atomically.
alter table public.ecommerce_order_items
  disable trigger ecommerce_order_items_phase4_tenant_scope_guard;
alter table public.ecommerce_order_items
  disable trigger ecommerce_order_items_stock_reservation;
alter table public.ecommerce_order_inventory_reservations
  disable trigger ecommerce_reservations_phase4_tenant_scope_guard;

do $test$
declare
  v_pro_plan uuid;
  v_free_plan uuid;
  v_active uuid := extensions.gen_random_uuid();
  v_grace uuid := extensions.gen_random_uuid();
  v_expired uuid := extensions.gen_random_uuid();
  v_free uuid := extensions.gen_random_uuid();
  v_suspended uuid := extensions.gen_random_uuid();
  v_cancelled uuid := extensions.gen_random_uuid();
  v_revoked uuid := extensions.gen_random_uuid();
  v_portal uuid := extensions.gen_random_uuid();
  v_admin_device uuid := extensions.gen_random_uuid();
  v_shared_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_staff_user uuid := extensions.gen_random_uuid();
  v_order uuid := extensions.gen_random_uuid();
  v_order_item uuid := extensions.gen_random_uuid();
  v_product uuid;
  v_result jsonb;
  v_second jsonb;
  v_order_before jsonb;
  v_reservation_before jsonb;
  v_order_after jsonb;
  v_reservation_after jsonb;
  v_count integer;
begin
  select id into v_pro_plan from public.plans where code = 'pro_monthly' and is_active limit 1;
  select id into v_free_plan from public.plans where code = 'free_trial' and is_active limit 1;
  if v_pro_plan is null or v_free_plan is null then
    raise exception 'LICENSE.LIFECYCLE.2 requires active pro_monthly and free_trial plans';
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values
    (v_active, 'LIFECYCLE-R2-ACTIVE-' || v_active, v_pro_plan, 'subscription', 'active', now() + interval '1 day', false, 1, 5, '{}'::jsonb, 'Active'),
    (v_grace, 'LIFECYCLE-R2-GRACE-' || v_grace, v_pro_plan, 'subscription', 'active', now() - interval '3 days', false, 1, 5, '{}'::jsonb, 'Grace'),
    (v_expired, 'LIFECYCLE-R2-EXPIRED-' || v_expired, v_pro_plan, 'subscription', 'active', now() + interval '1 day', false, 1, 5, '{"custom_fixture_data":"preserve","cloud_layaways":true}'::jsonb, 'Expired'),
    (v_free, 'LIFECYCLE-R2-FREE-' || v_free, v_free_plan, 'free', 'active', null, true, null, 1, '{}'::jsonb, 'Lanzo POS Free'),
    (v_suspended, 'LIFECYCLE-R2-SUSPENDED-' || v_suspended, v_pro_plan, 'subscription', 'suspended', now() - interval '8 days', false, 1, 5, '{}'::jsonb, 'Suspended'),
    (v_cancelled, 'LIFECYCLE-R2-CANCELLED-' || v_cancelled, v_pro_plan, 'subscription', 'cancelled', now() - interval '8 days', false, 1, 5, '{}'::jsonb, 'Cancelled'),
    (v_revoked, 'LIFECYCLE-R2-REVOKED-' || v_revoked, v_pro_plan, 'subscription', 'revoked', now() - interval '8 days', false, 1, 5, '{}'::jsonb, 'Revoked');

  if (private.materialize_expired_license_to_free_v1(v_active)->>'code') <> 'LICENSE_ACTIVE' then
    raise exception 'Case A: active paid license was not a safe NOOP';
  end if;
  if (private.materialize_expired_license_to_free_v1(v_grace)->>'code') <> 'LICENSE_IN_GRACE' then
    raise exception 'Case B: grace paid license was not a safe NOOP';
  end if;
  if (private.materialize_expired_license_to_free_v1(v_free)->>'code') <> 'ALREADY_FREE' then
    raise exception 'Case F: lifetime Free was not idempotent';
  end if;
  if (private.materialize_expired_license_to_free_v1(v_suspended)->>'code') <> 'ADMINISTRATIVELY_BLOCKED'
     or (private.materialize_expired_license_to_free_v1(v_cancelled)->>'code') <> 'ADMINISTRATIVELY_BLOCKED'
     or (private.materialize_expired_license_to_free_v1(v_revoked)->>'code') <> 'ADMINISTRATIVELY_BLOCKED' then
    raise exception 'Cases G/H: an administrative state was auto-converted';
  end if;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_expired, v_pro_plan, 'pro_monthly', 'Lanzo Nube',
    'pro_paid', 'active', now() - interval '40 days', now() - interval '8 days', 15,
    '{"historical_context":"preserve"}'::jsonb
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, is_active,
    activated_at, last_used_at, security_token, device_role, device_mode
  ) values
    (v_admin_device, v_expired, 'r2-admin-' || v_admin_device, 'Admin', true, now() - interval '30 days', now() - interval '1 day', 'admin-token', 'admin', 'admin_only'),
    (v_shared_device, v_expired, 'r2-shared-' || v_shared_device, 'Shared', true, now() - interval '20 days', now(), 'shared-token', 'admin', 'shared'),
    (v_staff_device, v_expired, 'r2-staff-' || v_staff_device, 'Staff', true, now() - interval '10 days', now(), 'staff-token', 'staff', 'staff_only');

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, metadata
  ) values (
    v_staff_user, v_expired, 'r2-staff', 'Staff preservado', 'fixture-hash', 'staff',
    '{"restore_on_upgrade":true}'::jsonb
  );

  update public.license_devices set staff_user_id = v_staff_user where id = v_staff_device;
  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, metadata
  ) values (v_expired, v_staff_user, v_staff_device, 'fixture-session-hash', '{"fixture":true}'::jsonb);

  insert into public.ecommerce_portals (
    id, license_id, slug, slug_source, status, name, headline, description,
    customization_level, theme, whatsapp_phone, delivery_enabled,
    settings, address_street, address_neighborhood, address_municipality,
    address_state, address_postal_code
  ) values (
    v_portal, v_expired, 'lifecycle-r2-' || replace(v_expired::text, '-', ''), 'custom',
    'published', 'Portal R2', 'Headline Pro preservado', 'Descripcion Pro preservada',
    'advanced', '{"primaryColor":"#123456"}'::jsonb, '9610000000', true,
    '{"deliveryPickupSettings":{"radiusKm":12},"advanced":"preserve"}'::jsonb,
    'Calle Prueba 1', 'Centro', 'Tuxtla Gutierrez', 'Chiapas', '29000'
  );

  for v_count in 1..12 loop
    v_product := extensions.gen_random_uuid();
    insert into public.ecommerce_published_products (
      id, portal_id, license_id, local_product_ref, public_name, price,
      is_published, display_order, metadata
    ) values (
      v_product, v_portal, v_expired, 'r2-product-' || v_count,
      'Producto ' || lpad(v_count::text, 2, '0'), v_count,
      true, v_count, jsonb_build_object('fixture_order', v_count)
    );

    if v_count = 1 then
      insert into public.ecommerce_orders (
        id, portal_id, license_id,
        status, customer_name, customer_phone, stock_reservation_status,
        stock_reservation_expires_at, stock_reservation_phase, metadata
      ) values (
        v_order, v_portal, v_expired,
        'new', 'Cliente fixture', '9610000000', 'reserved',
        now() + interval '30 minutes', 'checkout', '{"historical":"preserve"}'::jsonb
      );
      insert into public.ecommerce_order_items (
        id, order_id, portal_id, license_id, published_product_id,
        source_product_id, product_name, unit_price, quantity, line_total, metadata
      ) values (
        v_order_item, v_order, v_portal, v_expired, v_product,
        'r2-product-1', 'Producto 01', 1, 1, 1, '{"historical":"preserve"}'::jsonb
      );
      insert into public.ecommerce_order_inventory_reservations (
        order_id, order_item_id, portal_id, license_id, published_product_id,
        source_product_id, quantity, status, stock_before, stock_after,
        committed_before, committed_after, idempotency_key, expires_at,
        reservation_phase, metadata
      ) values (
        v_order, v_order_item, v_portal, v_expired, v_product,
        'r2-product-1', 1, 'reserved', 20, 20, 0, 1,
        'r2-reservation-' || v_order, now() + interval '30 minutes',
        'checkout', '{"historical":"preserve"}'::jsonb
      );
    end if;
  end loop;

  select to_jsonb(o) into v_order_before from public.ecommerce_orders o where o.id = v_order;
  select to_jsonb(r) into v_reservation_before from public.ecommerce_order_inventory_reservations r where r.order_id = v_order;

  -- Move only the controlled fixture beyond grace after all Pro-only setup.
  update public.licenses set expires_at = now() - interval '8 days' where id = v_expired;

  v_result := private.materialize_expired_license_to_free_v1(v_expired);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, false) is not true
     or v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
    raise exception 'Case C: expired paid materialization failed: %', v_result;
  end if;

  if not exists (
    select 1 from public.licenses l join public.plans p on p.id = l.plan_id
     where l.id = v_expired and p.code = 'free_trial' and l.license_type = 'free'
       and l.is_lifetime is true and l.expires_at is null
       and l.duration_months is null and l.status = 'active' and l.max_devices = 1
       and l.features->>'cloud_pos_sync' = 'false'
       and l.features->>'staff_roles' = 'false'
       and l.features->>'ecommerce_max_published_products' = '10'
       and not (l.features @> '{"cloud_layaways":true}'::jsonb)
       and l.features->>'custom_fixture_data' = 'preserve'
  ) then
    raise exception 'Materialized license fields/features are not permanent Free';
  end if;

  if (select lifecycle_state from private.license_entitlement_state_v1(v_expired)) <> 'active'
     or (select effective_features->>'cloud_pos_sync' from private.license_entitlement_state_v1(v_expired)) <> 'false' then
    raise exception 'Materialized Free entitlement did not emerge from the canonical contract';
  end if;

  select count(*) into v_count from public.license_periods where license_id = v_expired and status = 'active';
  if v_count <> 1
     or not exists (select 1 from public.license_periods where license_id = v_expired and status = 'active' and plan_code_snapshot = 'free_trial' and ends_at is null)
     or not exists (select 1 from public.license_periods where license_id = v_expired and status = 'expired' and plan_code_snapshot = 'pro_monthly' and metadata->>'historical_context' = 'preserve') then
    raise exception 'Period history was duplicated or rewritten';
  end if;

  select count(*) into v_count from public.license_events where license_key = 'LIFECYCLE-R2-EXPIRED-' || v_expired and event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE';
  if v_count <> 1 then raise exception 'Expected exactly one transition event, found %', v_count; end if;

  if (select count(*) from public.license_devices where license_id = v_expired) <> 3
     or (select count(*) from public.license_devices where license_id = v_expired and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_admin_device and is_active)
     or exists (select 1 from public.license_devices where id = v_shared_device and is_active)
     or exists (select 1 from public.license_devices where id = v_staff_device and is_active) then
    raise exception 'Case I: deterministic device_mode reconciliation failed';
  end if;

  if not exists (select 1 from public.license_staff_users where id = v_staff_user and is_active)
     or exists (select 1 from public.license_staff_sessions where license_id = v_expired and revoked_at is null) then
    raise exception 'Case J: Staff data/session reconciliation failed';
  end if;

  if (select count(*) from public.ecommerce_published_products where license_id = v_expired and deleted_at is null) <> 12
     or (select count(*) from public.ecommerce_published_products where license_id = v_expired and deleted_at is null and is_published) <> 10
     or exists (select 1 from public.ecommerce_published_products where license_id = v_expired and metadata->>'fixture_order' in ('11','12') and is_published)
     or (select count(*) from public.ecommerce_published_products where license_id = v_expired and metadata #>> '{plan_downgrade_publication,reason}' = 'PLAN_DOWNGRADE_PUBLICATION_LIMIT') <> 2 then
    raise exception 'Case K: publication limit reconciliation was not deterministic/reversible';
  end if;

  if not exists (
    select 1 from public.ecommerce_portals p where p.id = v_portal
      and p.slug_source = 'custom'
      and p.headline = 'Headline Pro preservado'
      and p.description = 'Descripcion Pro preservada'
      and p.customization_level = 'advanced'
      and p.theme = '{"primaryColor":"#123456"}'::jsonb
      and p.delivery_enabled is true
      and p.settings #>> '{deliveryPickupSettings,radiusKm}' = '12'
  ) then
    raise exception 'Ecommerce Pro configuration was destructively changed';
  end if;

  select to_jsonb(o) into v_order_after from public.ecommerce_orders o where o.id = v_order;
  select to_jsonb(r) into v_reservation_after from public.ecommerce_order_inventory_reservations r where r.order_id = v_order;
  if v_order_after is distinct from v_order_before then raise exception 'Case L: historical/active order changed'; end if;
  if v_reservation_after is distinct from v_reservation_before then raise exception 'Case M: active reservation changed'; end if;

  v_second := private.materialize_expired_license_to_free_v1(v_expired);
  if coalesce((v_second->>'changed')::boolean, true) is not false or v_second->>'code' <> 'ALREADY_FREE' then
    raise exception 'Case D/concurrency retry simulation was not idempotent: %', v_second;
  end if;
  if (select count(*) from public.license_periods where license_id = v_expired and status = 'active') <> 1
     or (select count(*) from public.license_events where license_key = 'LIFECYCLE-R2-EXPIRED-' || v_expired and event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE') <> 1 then
    raise exception 'Retry created duplicate period/event';
  end if;
end;
$test$;

alter table public.ecommerce_order_items
  enable trigger ecommerce_order_items_phase4_tenant_scope_guard;
alter table public.ecommerce_order_items
  enable trigger ecommerce_order_items_stock_reservation;
alter table public.ecommerce_order_inventory_reservations
  enable trigger ecommerce_reservations_phase4_tenant_scope_guard;

do $acl$
begin
  if has_function_privilege('public', 'private.materialize_expired_license_to_free_v1(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.materialize_expired_license_to_free_v1(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.materialize_expired_license_to_free_v1(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'private.materialize_expired_license_to_free_v1(uuid)', 'EXECUTE') then
    raise exception 'Materialization primitive ACL mismatch';
  end if;
end;
$acl$;

rollback;
