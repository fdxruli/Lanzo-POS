-- ECOM.DELIVERY.1 structured delivery address contract matrix.
-- Every fixture and order is transactional and discarded by ROLLBACK.

begin;

select set_config('app.settings.ecommerce_public_trusted_ip_header', '', true);
select set_config('request.headers', '{}', true);

do $delivery_address$
declare
  v_license uuid := '32000000-0000-4000-8000-000000000001';
  v_portal uuid := '32000000-0000-4000-8000-000000000002';
  v_product uuid := '32000000-0000-4000-8000-000000000003';
  v_result jsonb;
  v_replay jsonb;
  v_snapshot jsonb;
  v_order_id uuid;
  v_legacy_order_id uuid;
  v_pickup_order_id uuid;
  v_stored_address jsonb;
  v_stored_legacy_address text;
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ecommerce_orders'
      and column_name = 'customer_delivery_address'
      and data_type = 'jsonb'
      and is_nullable = 'YES'
      and column_default is null
  ) then
    raise exception 'STRUCTURED_ADDRESS_COLUMN_CONTRACT_FAILED';
  end if;

  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  ) values (
    v_license, 'ECOM-DELIVERY-ADDRESS-ROLLBACK', 'pro', 'active',
    clock_timestamp() + interval '1 day',
    jsonb_build_object(
      'ecommerce_portal_enabled', true,
      'ecommerce_order_inbox', true,
      'ecommerce_max_published_products', 10,
      'ecommerce_max_open_orders_per_day', 100,
      'ecommerce_stock_visibility', false
    )
  );

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name, ordering_enabled, pickup_enabled,
    delivery_enabled, min_order_total, max_order_items, max_item_quantity,
    stock_mode, business_hours_enabled, timezone, whatsapp_phone, address_street,
    address_neighborhood, address_municipality, address_state,
    address_postal_code
  ) values (
    v_portal, v_license, 'ecom-delivery-address-rollback', 'published',
    'Structured delivery test', true, true, true, 0, 30, 99, 'hidden',
    false, 'America/Mexico_City', '9610000000', 'Avenida Comercio 100', 'Centro', 'Tuxtla',
    'Chiapas', '29000'
  );

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, public_name, price, currency, is_published,
    is_available, manual_available, source_available, source_state, track_stock,
    stock_mode, stock_snapshot, configuration_type, configuration_version,
    has_recipe, has_variants, has_option_groups, requires_configuration,
    availability_source
  ) values (
    v_product, v_portal, v_license, 'Producto de prueba', 50, 'MXN', true,
    true, true, true, 'not_tracked', false, 'hidden', null, 'simple', 1,
    false, false, false, false, 'not_tracked'
  );

  -- Structured success: canonical JSON is stored and the legacy text is formatted.
  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente estructurado',
      'phone', '9610000000',
      'fulfillmentMethod', 'delivery',
      'address', 'legacy value must not win',
      'deliveryAddress', jsonb_build_object(
        'street', ' Avenida Central ',
        'exteriorNumber', ' 24 ',
        'interiorNumber', ' B ',
        'neighborhood', ' Centro ',
        'municipality', ' Tuxtla ',
        'state', ' Chiapas ',
        'postalCode', '29000',
        'reference', ' Frente al parque ',
        'secret', 'must not be stored'
      ),
      'notes', 'Tocar la puerta'
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-structured-success'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'STRUCTURED_CREATE_FAILED: %', v_result;
  end if;
  v_order_id := (v_result #>> '{order,id}')::uuid;

  select customer_delivery_address, customer_address
  into v_stored_address, v_stored_legacy_address
  from public.ecommerce_orders
  where id = v_order_id and license_id = v_license;
  if v_stored_address is distinct from jsonb_build_object(
       'street', 'Avenida Central',
       'exteriorNumber', '24',
       'interiorNumber', 'B',
       'neighborhood', 'Centro',
       'municipality', 'Tuxtla',
       'state', 'Chiapas',
       'postalCode', '29000',
       'reference', 'Frente al parque'
     )
     or v_stored_legacy_address is distinct from 'Avenida Central #24 Int. B, Centro, Tuxtla, Chiapas, CP 29000'
     or v_stored_address is null
     or v_stored_address::text like '%secret%' then
    raise exception 'STRUCTURED_STORAGE_FAILED: % / %', v_stored_address, v_stored_legacy_address;
  end if;
  if position('Direccion de entrega: Avenida Central #24 Int. B, Centro, Tuxtla, Chiapas, CP 29000' in coalesce(v_result #>> '{whatsapp,message}', '')) = 0
     or position('Referencia para llegar: Frente al parque' in coalesce(v_result #>> '{whatsapp,message}', '')) = 0
     or position('Indicaciones: Tocar la puerta' in coalesce(v_result #>> '{whatsapp,message}', '')) = 0 then
    raise exception 'STRUCTURED_WHATSAPP_FAILED: %', v_result #>> '{whatsapp,message}';
  end if;

  v_snapshot := private.ecommerce_order_pos_snapshot_v1(
    v_order_id, v_license,
    jsonb_build_object('actor_type', 'admin', 'device_id', 'delivery-address-test')
  );
  if v_snapshot #>> '{customer,address}' is distinct from v_stored_legacy_address
     or v_snapshot #>> '{customer,deliveryAddress,municipality}' is distinct from 'Tuxtla'
     or v_snapshot #>> '{customer,deliveryAddress,state}' is distinct from 'Chiapas'
     or v_snapshot #>> '{customer,deliveryAddress,postalCode}' is distinct from '29000'
     or v_snapshot #>> '{customer,deliveryAddress,reference}' is distinct from 'Frente al parque' then
    raise exception 'STRUCTURED_SNAPSHOT_FAILED: %', v_snapshot;
  end if;

  -- Replay is unchanged and does not revalidate or mutate the stored address.
  v_replay := public.ecommerce_create_order(
    'ecom-delivery-address-rollback', '{}'::jsonb, '[]'::jsonb,
    'delivery-structured-success'
  );
  if coalesce((v_replay->>'idempotent')::boolean, false) is not true
     or (v_replay #>> '{order,id}')::uuid <> v_order_id then
    raise exception 'STRUCTURED_IDEMPOTENT_REPLAY_FAILED: %', v_replay;
  end if;

  -- Legacy delivery remains accepted and is not heuristically backfilled.
  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente legacy',
      'phone', '9610000001',
      'fulfillmentMethod', 'delivery',
      'address', 'Calle legacy 5, Centro'
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-legacy-success'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'LEGACY_DELIVERY_CREATE_FAILED: %', v_result;
  end if;
  v_legacy_order_id := (v_result #>> '{order,id}')::uuid;
  select customer_delivery_address, customer_address
  into v_stored_address, v_stored_legacy_address
  from public.ecommerce_orders where id = v_legacy_order_id;
  if v_stored_address is not null or v_stored_legacy_address <> 'Calle legacy 5, Centro' then
    raise exception 'LEGACY_DELIVERY_BACKFILL_OR_COMPATIBILITY_FAILED: % / %', v_stored_address, v_stored_legacy_address;
  end if;

  -- Required fields and postal code errors are safe public codes.
  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente invalido', 'phone', '9610000002', 'fulfillmentMethod', 'delivery',
      'deliveryAddress', jsonb_build_object(
        'street', 'Calle', 'neighborhood', 'Centro', 'state', 'Chiapas', 'postalCode', '29000'
      )
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-missing-municipality'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_DELIVERY_MUNICIPALITY_REQUIRED' then
    raise exception 'MUNICIPALITY_REQUIRED_CODE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente invalido', 'phone', '9610000006', 'fulfillmentMethod', 'delivery',
      'deliveryAddress', jsonb_build_object(
        'street', 'Calle', 'neighborhood', 'Centro', 'municipality', 'A',
        'state', 'Chiapas', 'postalCode', '29000'
      )
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-short-municipality'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_DELIVERY_MUNICIPALITY_REQUIRED' then
    raise exception 'MUNICIPALITY_MINIMUM_LENGTH_CODE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente invalido', 'phone', '9610000007', 'fulfillmentMethod', 'delivery',
      'deliveryAddress', jsonb_build_object(
        'street', 'Calle', 'neighborhood', 'Centro', 'municipality', 'Tuxtla',
        'postalCode', '29000'
      )
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-missing-state'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_DELIVERY_STATE_REQUIRED' then
    raise exception 'STATE_REQUIRED_CODE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente invalido', 'phone', '9610000003', 'fulfillmentMethod', 'delivery',
      'deliveryAddress', jsonb_build_object(
        'street', 'Calle', 'neighborhood', 'Centro', 'municipality', 'Tuxtla',
        'state', 'Chiapas', 'postalCode', '2900'
      )
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-invalid-postal'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_DELIVERY_POSTAL_CODE_INVALID' then
    raise exception 'POSTAL_CODE_INVALID_CODE_FAILED: %', v_result;
  end if;

  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente invalido', 'phone', '9610000004', 'fulfillmentMethod', 'delivery',
      'deliveryAddress', jsonb_build_object(
        'street', 'Calle', 'neighborhood', 'Centro', 'municipality', 'Tuxtla',
        'state', 'Chiapas', 'postalCode', '29000', 'reference', 123
      )
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'delivery-invalid-type'
  );
  if v_result #>> '{error,code}' <> 'ECOMMERCE_DELIVERY_ADDRESS_INVALID' then
    raise exception 'ADDRESS_INVALID_CODE_FAILED: %', v_result;
  end if;

  -- Pickup clears structured data even when a stale malformed value is present.
  v_result := public.ecommerce_create_order(
    'ecom-delivery-address-rollback',
    jsonb_build_object(
      'name', 'Cliente pickup', 'phone', '9610000005', 'fulfillmentMethod', 'pickup',
      'address', 'stale legacy address',
      'deliveryAddress', jsonb_build_object('municipality', 42)
    ),
    jsonb_build_array(jsonb_build_object('productId', v_product, 'quantity', 1)),
    'pickup-clears-structured-address'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'PICKUP_WITH_STALE_ADDRESS_FAILED: %', v_result;
  end if;
  v_pickup_order_id := (v_result #>> '{order,id}')::uuid;
  select customer_delivery_address, customer_address
  into v_stored_address, v_stored_legacy_address
  from public.ecommerce_orders where id = v_pickup_order_id;
  if v_stored_address is not null or v_stored_legacy_address is not null then
    raise exception 'PICKUP_DID_NOT_CLEAR_ADDRESS: % / %', v_stored_address, v_stored_legacy_address;
  end if;
end;
$delivery_address$;

select jsonb_build_object(
  'status', 'ECOM.DELIVERY.1 STRUCTURED ADDRESS SQL PASS',
  'structuredStorage', true,
  'legacyCompatibility', true,
  'requiredAndPostalErrors', true,
  'pickupClearsAddress', true,
  'idempotentReplay', true,
  'rolledBack', true
) as result;

rollback;
