-- ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1 catalog v3 closure matrix.
-- Exercises real batches larger than RPC_BATCH_SIZE (200), final-revision
-- handoff, idempotent repetition, and one later material change. All fixtures
-- are synthetic and discarded by ROLLBACK.

begin;

do $multibatch$
declare
  v_license uuid := '32000000-0000-4000-8000-000000000001';
  v_portal uuid := '32000000-0000-4000-8000-000000000002';
  v_device uuid := '32000000-0000-4000-8000-000000000003';
  v_first jsonb;
  v_second jsonb;
  v_repeat jsonb;
  v_change jsonb;
  v_first_batch jsonb;
  v_second_batch jsonb;
  v_change_batch jsonb;
  v_initial_revision bigint;
  v_revision_one bigint;
  v_revision_two bigint;
  v_revision_repeat bigint;
  v_revision_change bigint;
  v_stored_revision bigint;
  v_rows_before jsonb;
  v_rows_after jsonb;
  v_tiers_total bigint;
  v_tiers_active bigint;
  v_tiers_deleted bigint;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values (
    v_license, 'ECOM-WS-MULTIBATCH-ROLLBACK', 'pro', 'active', clock_timestamp()+interval '1 day',
    '{"ecommerce_portal_enabled":true,"ecommerce_order_inbox":true,"ecommerce_cloud_catalog_source":true,"ecommerce_max_published_products":-1,"ecommerce_stock_visibility":true}'::jsonb
  );
  insert into public.business_profiles(license_id, business_name, business_type)
  values (v_license, 'ECOM wholesale multi batch rollback', array['abarrotes']::public.business_category[]);
  insert into public.license_devices(id, license_id, device_fingerprint, security_token, is_active, device_role)
  values (v_device, v_license, 'ecom-ws-multibatch-device', 'ecom-ws-multibatch-token', true, 'admin');
  insert into public.ecommerce_portals(id, license_id, slug, status, name, ordering_enabled, pickup_enabled, business_hours_enabled)
  values (v_portal, v_license, 'ecom-ws-multibatch-rollback', 'published', 'ECOM wholesale multi batch rollback', true, true, false);

  insert into public.pos_products(
    id, license_id, name, name_key, price, cost, stock, committed_stock, track_stock,
    server_version, is_active, product_type, sale_type, bulk_data, batch_management,
    expiration_mode, recipe, modifiers, metadata
  )
  select
    'ecom-ws-batch-' || lpad(i::text, 3, '0'), v_license,
    'Batch product ' || i, 'ecom-ws-batch-' || lpad(i::text, 3, '0'),
    10, 0, 100, 0, false, 1, true, 'sellable', 'unit',
    '{"purchase":{"unit":"pza"}}'::jsonb, '{"enabled":false}'::jsonb,
    'NONE', null, null, '{}'::jsonb
  from generate_series(1, 201) as i;

  insert into public.ecommerce_published_products(
    id, portal_id, license_id, product_id, local_product_ref, public_name, price,
    is_published, manual_available, source_available, is_available, source_state, sync_config,
    configuration_type, configuration_version, stock_mode, stock_snapshot
  )
  select
    extensions.gen_random_uuid(), v_portal, v_license,
    'ecom-ws-batch-' || lpad(i::text, 3, '0'),
    'ecom-ws-batch-' || lpad(i::text, 3, '0'),
    'Batch product ' || i, 10,
    true, true, true, true, 'not_tracked',
    '{"name":"source","description":"source","category":"source","price":"source","image":"source"}'::jsonb,
    'simple', 1, 'hidden', null
  from generate_series(1, 201) as i;

  select catalog_revision into v_initial_revision from public.ecommerce_portals where id=v_portal;

  with projections as (
    select p.local_product_ref,
      jsonb_build_object(
        'publishedProductId',p.id::text,
        'localProductRef',p.local_product_ref,
        'sourceRevision','version:1',
        'sourceState','not_tracked',
        'sourceAvailable',true,
        'stockSnapshot',null,
        'fields',jsonb_build_object('name',p.public_name,'description',null,'category',null,'price',10,'image',null),
        'configuration',jsonb_build_object(
          'type','simple','version',1,'hasRecipe',false,'variants',jsonb_build_array(),
          'optionGroups',jsonb_build_array(),'availabilitySource','not_tracked',
          'availabilityReasonCode',null,'limitingSource',jsonb_build_object('productId',null,'name',null)
        ),
        'configurationSourceRevision','version:1',
        'publicConfigurationMode','compatible',
        'wholesaleEnabled',false,
        'wholesaleTiers',jsonb_build_array()
      ) as projection,
      row_number() over (order by p.local_product_ref) as rn
    from public.ecommerce_published_products p
    where p.portal_id=v_portal and p.license_id=v_license
  )
  select
    jsonb_agg(projection order by local_product_ref) filter (where rn <= 200),
    jsonb_agg(projection order by local_product_ref) filter (where rn > 200)
  into v_first_batch, v_second_batch
  from projections;
  if jsonb_array_length(v_first_batch) <> 200 or jsonb_array_length(v_second_batch) <> 1 then
    raise exception 'BATCH_FIXTURE_SIZE_INVALID';
  end if;

  v_first := public.ecommerce_admin_sync_published_catalog_v3(
    'ECOM-WS-MULTIBATCH-ROLLBACK', 'ecom-ws-multibatch-device', 'ecom-ws-multibatch-token', null,
    v_first_batch, 'ecom-ws-multibatch:one', v_initial_revision
  );
  if coalesce((v_first->>'success')::boolean,false) is not true then
    raise exception 'FIRST_BATCH_FAILED: %', v_first;
  end if;
  v_revision_one := (v_first->>'catalogRevision')::bigint;
  select catalog_revision into v_stored_revision from public.ecommerce_portals where id=v_portal;
  if v_revision_one <> v_stored_revision then
    raise exception 'FIRST_BATCH_RETURNED_STALE_REVISION: returned %, stored %', v_revision_one, v_stored_revision;
  end if;

  v_second := public.ecommerce_admin_sync_published_catalog_v3(
    'ECOM-WS-MULTIBATCH-ROLLBACK', 'ecom-ws-multibatch-device', 'ecom-ws-multibatch-token', null,
    v_second_batch, 'ecom-ws-multibatch:two', v_revision_one
  );
  if coalesce((v_second->>'success')::boolean,false) is not true
     or v_second->>'code' = 'ECOMMERCE_CATALOG_REVISION_CHANGED' then
    raise exception 'SECOND_BATCH_REVISION_CONFLICT: %', v_second;
  end if;
  v_revision_two := (v_second->>'catalogRevision')::bigint;
  select catalog_revision into v_stored_revision from public.ecommerce_portals where id=v_portal;
  if v_revision_two <> v_stored_revision then
    raise exception 'SECOND_BATCH_RETURNED_STALE_REVISION: returned %, stored %', v_revision_two, v_stored_revision;
  end if;

  select jsonb_object_agg(p.id::text, private.ecommerce_product_public_signature(p) order by p.id)
  into v_rows_before
  from public.ecommerce_published_products p
  where p.portal_id=v_portal and p.license_id=v_license;
  select count(*), count(*) filter (where deleted_at is null), count(*) filter (where deleted_at is not null)
  into v_tiers_total, v_tiers_active, v_tiers_deleted
  from public.ecommerce_published_wholesale_tiers
  where portal_id=v_portal and license_id=v_license;

  -- The identical retry is a new RPC request with the current final revision:
  -- it must not add rows, tombstones, timestamps, or a catalog revision.
  v_repeat := public.ecommerce_admin_sync_published_catalog_v3(
    'ECOM-WS-MULTIBATCH-ROLLBACK', 'ecom-ws-multibatch-device', 'ecom-ws-multibatch-token', null,
    v_second_batch, 'ecom-ws-multibatch:two-repeat', v_revision_two
  );
  if coalesce((v_repeat->>'success')::boolean,false) is not true then
    raise exception 'REPEAT_BATCH_FAILED: %', v_repeat;
  end if;
  v_revision_repeat := (v_repeat->>'catalogRevision')::bigint;
  select catalog_revision into v_stored_revision from public.ecommerce_portals where id=v_portal;
  select jsonb_object_agg(p.id::text, private.ecommerce_product_public_signature(p) order by p.id)
  into v_rows_after
  from public.ecommerce_published_products p
  where p.portal_id=v_portal and p.license_id=v_license;
  if v_revision_repeat <> v_revision_two or v_stored_revision <> v_revision_two
     or v_rows_after is distinct from v_rows_before
     or (select count(*) from public.ecommerce_published_wholesale_tiers where portal_id=v_portal and license_id=v_license) <> v_tiers_total
     or (select count(*) from public.ecommerce_published_wholesale_tiers where portal_id=v_portal and license_id=v_license and deleted_at is null) <> v_tiers_active
     or (select count(*) from public.ecommerce_published_wholesale_tiers where portal_id=v_portal and license_id=v_license and deleted_at is not null) <> v_tiers_deleted then
    raise exception 'REPEAT_BATCH_NOT_IDEMPOTENT';
  end if;

  -- One material source change is accepted from the returned revision and
  -- produces exactly the new final revision reported by v3.
  update public.pos_products
  set price=11, server_version=2
  where license_id=v_license and id='ecom-ws-batch-201';
  select jsonb_set(
    jsonb_set(v_second_batch, '{0,sourceRevision}', '"version:2"'::jsonb, true),
    '{0,configurationSourceRevision}', '"version:2"'::jsonb, true
  ) into v_change_batch;
  v_change_batch := jsonb_set(v_change_batch, '{0,fields,price}', '11'::jsonb, true);
  v_change := public.ecommerce_admin_sync_published_catalog_v3(
    'ECOM-WS-MULTIBATCH-ROLLBACK', 'ecom-ws-multibatch-device', 'ecom-ws-multibatch-token', null,
    v_change_batch, 'ecom-ws-multibatch:material-change', v_revision_repeat
  );
  if coalesce((v_change->>'success')::boolean,false) is not true then
    raise exception 'MATERIAL_BATCH_FAILED: %', v_change;
  end if;
  v_revision_change := (v_change->>'catalogRevision')::bigint;
  select catalog_revision into v_stored_revision from public.ecommerce_portals where id=v_portal;
  if v_revision_change <> v_stored_revision or v_revision_change <= v_revision_repeat
     or coalesce((v_change->>'updatedCount')::integer,0) <> 1 then
    raise exception 'MATERIAL_BATCH_FINAL_REVISION_INVALID: one %, two %, repeat %, change %, stored %, result %',
      v_revision_one, v_revision_two, v_revision_repeat, v_revision_change, v_stored_revision, v_change;
  end if;
end;
$multibatch$;

select jsonb_build_object(
  'status','ECOM.BUSINESS.CAPABILITIES.WHOLESALE.1 MULTIBATCH SQL PASS',
  'rpcBatchSize',200,
  'projections',201,
  'finalRevisionHandoff',true,
  'repeatIdempotent',true,
  'materialChangeRevision',true,
  'rolledBack',true
) as result;

rollback;
