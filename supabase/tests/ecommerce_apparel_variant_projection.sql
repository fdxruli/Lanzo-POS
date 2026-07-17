begin;

do $test$
declare
  v_portal_id uuid;
  v_license_id uuid;
  v_product_id uuid;
  v_local_ref text := '__ecom_apparel_sql_test_parent__';
  v_config jsonb;
  v_config_without_large jsonb;
  v_config_empty jsonb;
  v_black_m_id uuid;
  v_black_l_id uuid;
  v_blue_m_id uuid;
  v_count integer;
  v_parent record;
begin
  select p.id, p.license_id
  into v_portal_id, v_license_id
  from public.ecommerce_portals p
  where p.deleted_at is null
  order by p.created_at
  limit 1;

  if v_portal_id is null or v_license_id is null then
    raise exception 'ECOMMERCE_APPAREL_SQL_TEST_PORTAL_REQUIRED';
  end if;

  insert into public.ecommerce_published_products (
    portal_id,
    license_id,
    source_type,
    local_product_ref,
    public_name,
    price,
    is_published,
    manual_available,
    source_available,
    is_available,
    stock_mode
  ) values (
    v_portal_id,
    v_license_id,
    'local_snapshot',
    v_local_ref,
    'Camisa polo SQL test',
    299,
    false,
    true,
    true,
    true,
    'hidden'
  )
  returning id into v_product_id;

  v_config := jsonb_build_object(
    'type', 'variant_parent',
    'version', 1,
    'hasRecipe', false,
    'variants', jsonb_build_array(
      jsonb_build_object(
        'sourceVariantRef', 'sku:POLO-NEG-M',
        'sourceProductId', null,
        'localProductRef', v_local_ref,
        'sku', 'POLO-NEG-M',
        'publicName', 'Negro / M',
        'optionValues', jsonb_build_object('color', 'Negro', 'talla', 'M'),
        'priceMode', 'base',
        'priceValue', 0,
        'trackStock', true,
        'stockMode', 'exact',
        'stockSnapshot', 3,
        'sourceAvailable', true,
        'manualAvailable', true,
        'displayOrder', 0,
        'metadata', jsonb_build_object('source', 'sql_test')
      ),
      jsonb_build_object(
        'sourceVariantRef', 'sku:POLO-NEG-L',
        'sourceProductId', null,
        'localProductRef', v_local_ref,
        'sku', 'POLO-NEG-L',
        'publicName', 'Negro / L',
        'optionValues', jsonb_build_object('color', 'Negro', 'talla', 'L'),
        'priceMode', 'base',
        'priceValue', 0,
        'trackStock', true,
        'stockMode', 'exact',
        'stockSnapshot', 4,
        'sourceAvailable', true,
        'manualAvailable', true,
        'displayOrder', 1,
        'metadata', jsonb_build_object('source', 'sql_test')
      ),
      jsonb_build_object(
        'sourceVariantRef', 'sku:POLO-AZU-M',
        'sourceProductId', null,
        'localProductRef', v_local_ref,
        'sku', 'POLO-AZU-M',
        'publicName', 'Azul / M',
        'optionValues', jsonb_build_object('color', 'Azul', 'talla', 'M'),
        'priceMode', 'base',
        'priceValue', 0,
        'trackStock', true,
        'stockMode', 'exact',
        'stockSnapshot', 5,
        'sourceAvailable', true,
        'manualAvailable', true,
        'displayOrder', 2,
        'metadata', jsonb_build_object('source', 'sql_test')
      )
    ),
    'optionGroups', '[]'::jsonb,
    'availabilitySource', 'variant_aggregate',
    'availabilityReasonCode', null,
    'limitingSource', '{}'::jsonb
  );

  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    v_config,
    null
  );

  select count(*) into v_count
  from public.ecommerce_published_product_variants v
  where v.published_product_id = v_product_id
    and v.deleted_at is null
    and v.source_product_id is null
    and v.local_product_ref = v_local_ref;

  if v_count <> 3 then
    raise exception 'EXPECTED_THREE_ACTIVE_APPAREL_VARIANTS_GOT_%', v_count;
  end if;

  select id into v_black_m_id
  from public.ecommerce_published_product_variants
  where published_product_id = v_product_id
    and source_variant_ref = 'sku:POLO-NEG-M'
    and deleted_at is null;

  select id into v_black_l_id
  from public.ecommerce_published_product_variants
  where published_product_id = v_product_id
    and source_variant_ref = 'sku:POLO-NEG-L'
    and deleted_at is null;

  select id into v_blue_m_id
  from public.ecommerce_published_product_variants
  where published_product_id = v_product_id
    and source_variant_ref = 'sku:POLO-AZU-M'
    and deleted_at is null;

  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    v_config,
    null
  );

  if (
    select count(*)
    from public.ecommerce_published_product_variants
    where published_product_id = v_product_id
      and deleted_at is null
  ) <> 3 then
    raise exception 'IDEMPOTENT_REAPPLY_CREATED_DUPLICATES';
  end if;

  if (
    select id
    from public.ecommerce_published_product_variants
    where published_product_id = v_product_id
      and source_variant_ref = 'sku:POLO-NEG-M'
      and deleted_at is null
  ) <> v_black_m_id then
    raise exception 'IDEMPOTENT_REAPPLY_CHANGED_ACTIVE_IDENTITY';
  end if;

  v_config := jsonb_set(v_config, '{variants,0,stockSnapshot}', '7'::jsonb);
  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    v_config,
    null
  );

  if (
    select stock_snapshot
    from public.ecommerce_published_product_variants
    where id = v_black_m_id
  ) <> 7 then
    raise exception 'TARGET_VARIANT_STOCK_WAS_NOT_UPDATED';
  end if;

  if (
    select stock_snapshot
    from public.ecommerce_published_product_variants
    where id = v_black_l_id
  ) <> 4 or (
    select stock_snapshot
    from public.ecommerce_published_product_variants
    where id = v_blue_m_id
  ) <> 5 then
    raise exception 'SIBLING_VARIANT_STOCK_CHANGED';
  end if;

  v_config_without_large := jsonb_set(
    v_config,
    '{variants}',
    jsonb_build_array(v_config#>'{variants,0}', v_config#>'{variants,2}')
  );

  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    v_config_without_large,
    null
  );

  if (
    select deleted_at is null
    from public.ecommerce_published_product_variants
    where id = v_black_l_id
  ) is not false then
    raise exception 'REMOVED_VARIANT_WAS_NOT_SOFT_DELETED';
  end if;

  if (
    select count(*)
    from public.ecommerce_published_product_variants
    where published_product_id = v_product_id
      and source_variant_ref in ('sku:POLO-NEG-M', 'sku:POLO-AZU-M')
      and deleted_at is null
  ) <> 2 then
    raise exception 'REMOVING_ONE_VARIANT_AFFECTED_SIBLINGS';
  end if;

  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    v_config,
    null
  );

  if (
    select count(*)
    from public.ecommerce_published_product_variants
    where published_product_id = v_product_id
      and source_variant_ref = 'sku:POLO-NEG-L'
      and deleted_at is null
  ) <> 1 then
    raise exception 'READDING_VARIANT_DID_NOT_RESTORE_COMMERCIAL_IDENTITY';
  end if;

  begin
    perform private.ecommerce_apply_product_configuration(
      v_license_id,
      v_product_id,
      jsonb_set(
        v_config,
        '{variants}',
        (v_config->'variants') || jsonb_build_array(
          jsonb_build_object(
            'sourceVariantRef', 'sku:DUPLICATE-COMBINATION',
            'sourceProductId', null,
            'localProductRef', v_local_ref,
            'sku', 'DUPLICATE-COMBINATION',
            'publicName', 'Negro / M duplicate',
            'optionValues', jsonb_build_object('color', 'Negro', 'talla', 'M'),
            'priceMode', 'base',
            'priceValue', 0,
            'trackStock', true,
            'stockMode', 'exact',
            'stockSnapshot', 1,
            'sourceAvailable', true,
            'manualAvailable', true,
            'displayOrder', 3,
            'metadata', jsonb_build_object('source', 'sql_test')
          )
        )
      ),
      null
    );
    raise exception 'DUPLICATE_OPTION_VALUES_WERE_NOT_BLOCKED';
  exception
    when others then
      if sqlerrm = 'DUPLICATE_OPTION_VALUES_WERE_NOT_BLOCKED' then
        raise;
      end if;
      if sqlerrm not like '%ECOMMERCE_CONFIGURATION_INVALID%' then
        raise;
      end if;
  end;

  v_config_empty := jsonb_build_object(
    'type', 'variant_parent',
    'version', 1,
    'hasRecipe', false,
    'variants', '[]'::jsonb,
    'optionGroups', '[]'::jsonb,
    'availabilitySource', 'variant_aggregate',
    'availabilityReasonCode', 'APPAREL_VARIANTS_UNAVAILABLE',
    'limitingSource', '{}'::jsonb
  );

  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    v_config_empty,
    null
  );

  select * into v_parent
  from public.ecommerce_published_products
  where id = v_product_id;

  if v_parent.configuration_type <> 'variant_parent'
     or v_parent.has_variants is true
     or v_parent.requires_configuration is not true
     or v_parent.source_available is true
     or v_parent.is_available is true
     or coalesce(v_parent.stock_snapshot, -1) <> 0
     or v_parent.availability_reason_code <> 'APPAREL_VARIANTS_UNAVAILABLE' then
    raise exception 'EMPTY_APPAREL_PARENT_DID_NOT_FAIL_CLOSED';
  end if;

  if (
    select count(*)
    from public.ecommerce_published_product_variants
    where published_product_id = v_product_id
      and deleted_at is null
  ) <> 0 then
    raise exception 'EMPTY_APPAREL_CONFIGURATION_LEFT_ACTIVE_VARIANTS';
  end if;

  perform private.ecommerce_apply_product_configuration(
    v_license_id,
    v_product_id,
    jsonb_set(v_config, '{variants}', jsonb_build_array(v_config#>'{variants,0}')),
    null
  );

  select * into v_parent
  from public.ecommerce_published_products
  where id = v_product_id;

  if v_parent.configuration_type <> 'variant_parent'
     or v_parent.has_variants is not true
     or v_parent.requires_configuration is not true
     or v_parent.source_available is not true
     or v_parent.availability_reason_code <> 'CONFIGURATION_REQUIRED' then
    raise exception 'APPAREL_PARENT_DID_NOT_RECOVER';
  end if;
end;
$test$;

rollback;
