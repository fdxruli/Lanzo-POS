-- ECOM.ORDER.LIFECYCLE.STABILIZATION.1 controlled SQL test.
-- Requires the migration under test. Every fixture and mutation is rolled back.

begin;

create or replace function private.ecom_lifecycle_insert_fixture_v1(p_payload jsonb)
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
  v_source_admin public.license_admin_users%rowtype;
  v_license public.licenses%rowtype;
  v_portal public.ecommerce_portals%rowtype;
  v_admin public.license_admin_users%rowtype;
  v_order public.ecommerce_orders%rowtype;
  v_before_updated_at timestamptz;
  v_result jsonb;
  v_list jsonb;
  v_detail jsonb;
  v_session jsonb;
  v_actor_token text;

  v_license_id uuid := extensions.gen_random_uuid();
  v_portal_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_admin_user_id uuid := extensions.gen_random_uuid();
  v_key text := 'ECOM-LIFECYCLE-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_slug text := 'ecom-lifecycle-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 18);
  v_fingerprint text := 'ecom-lifecycle-device';
  v_security_token text := 'ecom-lifecycle-security-token';
  v_prefix text := 'ECOM-LIFECYCLE-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 10);

  v_delivery_unpaid uuid := extensions.gen_random_uuid();
  v_delivery_paid uuid := extensions.gen_random_uuid();
  v_pickup_unpaid uuid := extensions.gen_random_uuid();
  v_pickup_converted uuid := extensions.gen_random_uuid();
  v_cancelled uuid := extensions.gen_random_uuid();
  v_rejected uuid := extensions.gen_random_uuid();
  v_active_converted uuid := extensions.gen_random_uuid();

  v_delivery_address jsonb := jsonb_build_object(
    'street', 'Calle Terminal',
    'exteriorNumber', '125',
    'interiorNumber', '',
    'neighborhood', 'Centro',
    'municipality', 'Tuxtla',
    'state', 'Chiapas',
    'postalCode', '29000',
    'reference', 'Frente al parque'
  );
begin
  select o.* into v_source_order
  from public.ecommerce_orders o
  order by o.created_at desc
  limit 1;
  if v_source_order.id is null then
    raise exception 'lifecycle fixture source order unavailable';
  end if;

  select p.* into v_source_portal
  from public.ecommerce_portals p
  where p.id = v_source_order.portal_id;
  select l.* into v_source_license
  from public.licenses l
  where l.id = v_source_order.license_id;
  select u.* into v_source_admin
  from public.license_admin_users u
  where u.license_id = v_source_license.id
    and u.is_owner is true
    and u.is_active is true
  order by u.created_at
  limit 1;
  if v_source_admin.id is null then
    select u.* into v_source_admin
    from public.license_admin_users u
    where u.is_owner is true
      and u.is_active is true
    order by u.created_at
    limit 1;
  end if;
  if v_source_admin.id is null then
    raise exception 'lifecycle fixture source admin unavailable';
  end if;

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
    is_active, security_token, device_role, device_mode, activated_at, last_used_at
  ) values (
    v_device_id, v_license_id, v_fingerprint, 'ECOM lifecycle fixture',
    true, v_security_token, 'admin', 'admin_only', now(), now()
  );

  v_admin := jsonb_populate_record(
    null::public.license_admin_users,
    to_jsonb(v_source_admin) || jsonb_build_object(
      'id', v_admin_user_id,
      'license_id', v_license_id,
      'username', 'ecom_lifecycle_admin',
      'display_name', 'ECOM Lifecycle Admin',
      'is_owner', true,
      'is_active', true,
      'created_at', now(),
      'updated_at', now()
    )
  );
  insert into public.license_admin_users select (v_admin).*;

  v_session := private.create_admin_session(
    v_license_id,
    v_admin_user_id,
    v_device_id,
    'ECOM lifecycle fixture'
  );
  v_actor_token := nullif(v_session->>'session_token', '');
  if v_actor_token is null then
    raise exception 'lifecycle fixture admin session unavailable';
  end if;

  v_portal := jsonb_populate_record(
    null::public.ecommerce_portals,
    to_jsonb(v_source_portal) || jsonb_build_object(
      'id', v_portal_id,
      'license_id', v_license_id,
      'slug', v_slug,
      'slug_source', 'system',
      'status', 'published',
      'name', 'ECOM Lifecycle Fixture',
      'headline', 'Pedidos online de prueba',
      'description', 'Portal transaccional para pruebas de ciclo de vida.',
      'template_code', 'classic',
      'customization_level', 'basic',
      'theme', '{}'::jsonb,
      'whatsapp_phone', '9610000000',
      'contact_email', null,
      'address', 'Avenida Comercio 100, Centro, Tuxtla, Chiapas, CP 29000',
      'address_street', 'Avenida Comercio 100',
      'address_neighborhood', 'Centro',
      'address_municipality', 'Tuxtla',
      'address_state', 'Chiapas',
      'address_postal_code', '29000',
      'ordering_enabled', true,
      'pickup_enabled', true,
      'delivery_enabled', true,
      'scheduled_orders_enabled', false,
      'min_order_total', 0,
      'max_order_items', 50,
      'max_item_quantity', 10,
      'stock_mode', 'status',
      'settings', '{}'::jsonb,
      'metadata', jsonb_build_object('source', 'ecom-lifecycle-test'),
      'catalog_revision', 1,
      'timezone', 'America/Mexico_City',
      'deleted_at', null,
      'created_at', now(),
      'updated_at', now()
    )
  );
  insert into public.ecommerce_portals select (v_portal).*;
  if v_portal.name <> 'ECOM Lifecycle Fixture'
     or v_portal.slug_source <> 'system'
     or v_portal.status <> 'published'
     or v_portal.timezone <> 'America/Mexico_City'
     or v_portal.catalog_revision <> 1
     or v_portal.customization_level <> 'basic'
     or v_portal.stock_mode <> 'status'
     or v_portal.max_order_items <> 50
     or v_portal.max_item_quantity <> 10
     or v_portal.min_order_total <> 0
     or v_portal.address_street <> 'Avenida Comercio 100'
     or v_portal.address_neighborhood <> 'Centro'
     or v_portal.address_municipality <> 'Tuxtla'
     or v_portal.address_state <> 'Chiapas'
     or v_portal.address_postal_code <> '29000'
     or v_portal.whatsapp_phone <> '9610000000' then
    raise exception 'published portal fixture is not deterministic: %', v_portal;
  end if;

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_delivery_unpaid,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-delivery-unpaid',
    'status', 'accepted',
    'fulfillment_method', 'delivery',
    'customer_address', 'Calle Terminal #125, Centro, Tuxtla, Chiapas, CP 29000',
    'customer_delivery_address', v_delivery_address,
    'customer_notes', 'Llamar al llegar',
    'payment_method', 'on_delivery',
    'payment_status', 'pending',
    'pos_visibility_status', 'visible',
    'pos_draft_status', 'none',
    'pos_conversion_status', 'idle',
    'converted_sale_id', null,
    'converted_at', null,
    'fulfillment_status', 'out_for_delivery',
    'fulfillment_version', 11,
    'fulfillment_updated_at', now(),
    'accepted_at', now(),
    'created_at', now() - interval '7 minutes',
    'updated_at', now()
  ));

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_delivery_paid,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-delivery-paid',
    'status', 'accepted',
    'fulfillment_method', 'delivery',
    'customer_address', 'Calle Terminal #125, Centro, Tuxtla, Chiapas, CP 29000',
    'customer_delivery_address', v_delivery_address,
    'customer_notes', 'Llamar al llegar',
    'payment_method', 'cash',
    'payment_status', 'paid',
    'pos_visibility_status', 'visible',
    'pos_draft_status', 'none',
    'pos_conversion_status', 'idle',
    'converted_sale_id', null,
    'converted_at', null,
    'fulfillment_status', 'out_for_delivery',
    'fulfillment_version', 21,
    'fulfillment_updated_at', now(),
    'accepted_at', now(),
    'created_at', now() - interval '6 minutes',
    'updated_at', now()
  ));

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_pickup_unpaid,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-pickup-unpaid',
    'status', 'accepted',
    'fulfillment_method', 'pickup',
    'customer_delivery_address', null,
    'customer_notes', 'Avisar al cliente',
    'payment_method', 'on_delivery',
    'payment_status', 'pending',
    'pos_visibility_status', 'visible',
    'pos_draft_status', 'none',
    'pos_conversion_status', 'idle',
    'converted_sale_id', null,
    'converted_at', null,
    'fulfillment_status', 'ready',
    'fulfillment_version', 31,
    'fulfillment_updated_at', now(),
    'accepted_at', now(),
    'created_at', now() - interval '5 minutes',
    'updated_at', now()
  ));

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_pickup_converted,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-pickup-converted',
    'status', 'converted_to_sale',
    'fulfillment_method', 'pickup',
    'customer_delivery_address', null,
    'payment_method', 'cash',
    'payment_status', 'pending',
    'pos_visibility_status', 'archived',
    'pos_draft_status', 'prepared',
    'pos_draft_id', 'ecom-lifecycle-draft-pickup',
    'pos_claim_token', extensions.gen_random_uuid(),
    'pos_claim_request_key', 'ecom-lifecycle-claim-pickup',
    'pos_claimed_at', now() - interval '6 minutes',
    'pos_claim_expires_at', now() + interval '30 minutes',
    'pos_claim_actor_type', 'admin',
    'pos_claim_actor_ref', v_device_id::text,
    'pos_draft_prepared_at', now() - interval '5 minutes',
    'pos_conversion_status', 'completed',
    'converted_sale_id', 'sale-pickup-converted',
    'converted_at', now(),
    'fulfillment_status', 'ready',
    'fulfillment_version', 41,
    'fulfillment_updated_at', now(),
    'accepted_at', now(),
    'created_at', now() - interval '4 minutes',
    'updated_at', now()
  ));

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_cancelled,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-cancelled',
    'status', 'accepted',
    'fulfillment_method', 'pickup',
    'customer_address', 'Legacy cancelled address',
    'customer_delivery_address', null,
    'customer_notes', 'Cancelled note',
    'payment_status', 'pending',
    'pos_visibility_status', 'archived',
    'pos_draft_status', 'none',
    'pos_conversion_status', 'idle',
    'converted_sale_id', null,
    'converted_at', null,
    'fulfillment_status', 'cancelled',
    'fulfillment_version', 51,
    'fulfillment_updated_at', now(),
    'cancelled_at', now(),
    'created_at', now() - interval '3 minutes',
    'updated_at', now()
  ));

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_rejected,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-rejected',
    'status', 'rejected',
    'fulfillment_method', 'pickup',
    'customer_address', 'Legacy address only',
    'customer_delivery_address', null,
    'customer_notes', 'Legacy note',
    'payment_status', 'pending',
    'pos_visibility_status', 'archived',
    'pos_draft_status', 'none',
    'pos_conversion_status', 'idle',
    'converted_sale_id', null,
    'converted_at', null,
    'fulfillment_status', null,
    'fulfillment_version', 0,
    'fulfillment_updated_at', null,
    'rejected_at', now(),
    'created_at', now() - interval '2 minutes',
    'updated_at', now()
  ));

  perform private.ecom_lifecycle_insert_fixture_v1(to_jsonb(v_source_order) || jsonb_build_object(
    'id', v_active_converted,
    'portal_id', v_portal_id,
    'license_id', v_license_id,
    'idempotency_key', v_prefix || '-active-converted',
    'status', 'converted_to_sale',
    'fulfillment_method', 'delivery',
    'customer_address', 'Calle Activa #8, Centro, Tuxtla, Chiapas, CP 29000',
    'customer_delivery_address', v_delivery_address,
    'payment_status', 'pending',
    'pos_visibility_status', 'archived',
    'pos_draft_status', 'prepared',
    'pos_draft_id', 'ecom-lifecycle-draft-active',
    'pos_claim_token', extensions.gen_random_uuid(),
    'pos_claim_request_key', 'ecom-lifecycle-claim-active',
    'pos_claimed_at', now() - interval '6 minutes',
    'pos_claim_expires_at', now() + interval '30 minutes',
    'pos_claim_actor_type', 'admin',
    'pos_claim_actor_ref', v_device_id::text,
    'pos_draft_prepared_at', now() - interval '5 minutes',
    'pos_conversion_status', 'completed',
    'converted_sale_id', 'sale-active-converted',
    'converted_at', now(),
    'fulfillment_status', 'out_for_delivery',
    'fulfillment_version', 61,
    'fulfillment_updated_at', now(),
    'accepted_at', now(),
    'created_at', now() - interval '1 minute',
    'updated_at', now()
  ));

  -- A. Unpaid delivery cannot complete and does not advance or archive.
  select fulfillment_updated_at into v_before_updated_at
  from public.ecommerce_orders where id = v_delivery_unpaid;
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, v_actor_token,
    v_delivery_unpaid, 'completed', 11, 'complete-unpaid-delivery', null
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_PAYMENT_REQUIRED' then
    raise exception 'unpaid delivery completion was not blocked: %', v_result;
  end if;
  select * into v_order from public.ecommerce_orders where id = v_delivery_unpaid;
  if v_order.fulfillment_status <> 'out_for_delivery'
     or v_order.fulfillment_version <> 11
     or v_order.pos_visibility_status <> 'visible'
     or v_order.fulfillment_updated_at is distinct from v_before_updated_at
     or exists (
       select 1 from private.ecommerce_order_fulfillment_events e
       where e.order_id = v_delivery_unpaid and e.event_key = 'complete-unpaid-delivery'
     ) then
    raise exception 'unpaid delivery changed state before payment: %', v_order;
  end if;

  -- F. Payment registration permits a retry using a fresh idempotency key.
  update public.ecommerce_orders
  set payment_status = 'paid'
  where id = v_delivery_unpaid;
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, v_actor_token,
    v_delivery_unpaid, 'completed', 11, 'complete-paid-delivery-retry', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'paid delivery completion retry failed: %', v_result;
  end if;
  select * into v_order from public.ecommerce_orders where id = v_delivery_unpaid;
  if v_order.fulfillment_status <> 'completed'
     or v_order.fulfillment_version <> 12
     or v_order.pos_visibility_status <> 'archived' then
    raise exception 'paid delivery completion did not pass: %', v_order;
  end if;

  -- B. A directly paid delivery can complete without a POS conversion.
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, v_actor_token,
    v_delivery_paid, 'completed', 21, 'complete-paid-delivery', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'paid delivery completion failed: %', v_result;
  end if;

  -- C. Unpaid pickup is blocked at ready.
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, v_actor_token,
    v_pickup_unpaid, 'completed', 31, 'complete-unpaid-pickup', null
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_PAYMENT_REQUIRED' then
    raise exception 'unpaid pickup completion was not blocked: %', v_result;
  end if;
  if exists (
    select 1 from public.ecommerce_orders o
    where o.id = v_pickup_unpaid
      and (o.fulfillment_status <> 'ready' or o.fulfillment_version <> 31 or o.pos_visibility_status <> 'visible')
  ) then
    raise exception 'unpaid pickup changed state before payment';
  end if;

  -- D. A converted pickup is payment-registered but fulfillment remains separate.
  v_result := public.ecommerce_admin_update_order_fulfillment(
    v_key, v_fingerprint, v_security_token, v_actor_token,
    v_pickup_converted, 'completed', 41, 'complete-converted-pickup', null
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'converted pickup completion failed: %', v_result;
  end if;
  select * into v_order from public.ecommerce_orders where id = v_pickup_converted;
  if v_order.status <> 'converted_to_sale'
     or v_order.fulfillment_status <> 'completed'
     or v_order.pos_visibility_status <> 'archived' then
    raise exception 'converted pickup collapsed commercial and fulfillment state: %', v_order;
  end if;

  -- H/I/J/M. Closed history is bounded and includes terminal/rejected rows,
  -- while an archived converted order with active fulfillment stays active.
  v_list := public.ecommerce_admin_list_orders(
    v_key, v_fingerprint, v_security_token, v_actor_token, 'closed', 2, 0
  );
  if coalesce((v_list#>>'{pagination,limit}')::integer, 0) <> 2
     or jsonb_array_length(v_list->'orders') > 2
     or coalesce((v_list#>>'{pagination,hasMore}')::boolean, false) is not true then
    raise exception 'closed history is not bounded/paginated: %', v_list;
  end if;

  v_list := public.ecommerce_admin_list_orders(
    v_key, v_fingerprint, v_security_token, v_actor_token, 'closed', 100, 0
  );
  if not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_delivery_unpaid::text)
     or not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_delivery_paid::text)
     or not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_pickup_converted::text)
     or not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_cancelled::text)
     or not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_rejected::text)
     or exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_active_converted::text)
     or coalesce((v_list#>>'{counts,closed}')::integer, 0) < 5 then
    raise exception 'closed history classification is incorrect: %', v_list;
  end if;

  v_list := public.ecommerce_admin_list_orders(
    v_key, v_fingerprint, v_security_token, v_actor_token, 'all', 100, 0
  );
  if not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_active_converted::text)
     or not exists (select 1 from jsonb_array_elements(v_list->'orders') e where e->>'id' = v_delivery_unpaid::text) then
    raise exception 'all list did not retain bounded active and closed visibility: %', v_list;
  end if;

  -- L. Terminal structured delivery and legacy address-only detail remain readable.
  v_detail := public.ecommerce_admin_get_order(
    v_key, v_fingerprint, v_security_token, v_delivery_unpaid, v_actor_token
  );
  if coalesce((v_detail->>'success')::boolean, false) is not true
     or position('ECOMMERCE_ORDER_NOT_FOUND' in coalesce(v_detail::text, '')) > 0
     or v_detail#>>'{order,customer,address}' <> 'Calle Terminal #125, Centro, Tuxtla, Chiapas, CP 29000'
     or v_detail#>>'{order,customer,deliveryAddress,street}' <> 'Calle Terminal'
     or v_detail#>>'{order,customer,deliveryAddress,municipality}' <> 'Tuxtla'
     or v_detail#>>'{order,customer,deliveryAddress,state}' <> 'Chiapas'
     or v_detail#>>'{order,customer,deliveryAddress,postalCode}' <> '29000'
     or v_detail#>>'{order,customer,deliveryAddress,reference}' <> 'Frente al parque'
     or v_detail#>>'{order,customer,notes}' <> 'Llamar al llegar'
     or v_detail#>>'{order,fulfillment,internalStatus}' <> 'completed'
     or coalesce((v_detail#>>'{order,fulfillment,paymentRegistered}')::boolean, false) is not true then
    raise exception 'terminal structured detail lost lifecycle/address data: %', v_detail;
  end if;

  v_detail := public.ecommerce_admin_get_order(
    v_key, v_fingerprint, v_security_token, v_cancelled, v_actor_token
  );
  if coalesce((v_detail->>'success')::boolean, false) is not true
     or position('ECOMMERCE_ORDER_NOT_FOUND' in coalesce(v_detail::text, '')) > 0
     or v_detail#>>'{order,customer,address}' <> 'Legacy cancelled address'
     or v_detail#>>'{order,customer,notes}' <> 'Cancelled note'
     or v_detail#>>'{order,fulfillment,internalStatus}' <> 'cancelled' then
    raise exception 'cancelled legacy detail is no longer readable: %', v_detail;
  end if;

  v_detail := public.ecommerce_admin_get_order(
    v_key, v_fingerprint, v_security_token, v_rejected, v_actor_token
  );
  if coalesce((v_detail->>'success')::boolean, false) is not true
     or position('ECOMMERCE_ORDER_NOT_FOUND' in coalesce(v_detail::text, '')) > 0
     or v_detail#>>'{order,customer,address}' <> 'Legacy address only'
     or v_detail#>>'{order,customer,notes}' <> 'Legacy note' then
    raise exception 'legacy detail is no longer readable: %', v_detail;
  end if;
end;
$test$;

select jsonb_build_object(
  'status', 'ECOM.ORDER.LIFECYCLE.STABILIZATION.1 SQL PASS',
  'paymentGate', true,
  'paymentRetry', true,
  'closedHistory', true,
  'boundedPagination', true,
  'structuredAndLegacyDetails', true,
  'rolledBack', true
) as result;

rollback;
