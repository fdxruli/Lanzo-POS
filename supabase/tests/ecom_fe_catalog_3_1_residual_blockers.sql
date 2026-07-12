-- ECOM.FE.CATALOG.3.1 - Pruebas de los bloqueantes residuales.
-- Ejecutar solo en una base local o transaccional segura con las migraciones aplicadas.

begin;

DO $$
declare
  v_confirmed_hash text;
  v_unverified_same text;
  v_unverified_old text;
  v_definition text;
begin
  v_confirmed_hash := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'published-1',
      'localProductRef', 'product-1',
      'sourceRevision', 'version:10',
      'sourceState', 'in_stock',
      'sourceAvailable', true,
      'stockSnapshot', 5,
      'fields', jsonb_build_object('price', 50)
    )
  );

  v_unverified_same := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'published-1',
      'localProductRef', 'product-1',
      'sourceRevision', 'version:10',
      'sourceState', 'unverified',
      'sourceAvailable', null,
      'stockSnapshot', null,
      'fields', jsonb_build_object('price', 50)
    )
  );

  v_unverified_old := private.ecommerce_projection_payload_hash(
    jsonb_build_object(
      'publishedProductId', 'published-1',
      'localProductRef', 'product-1',
      'sourceRevision', 'version:9',
      'sourceState', 'unverified',
      'sourceAvailable', null,
      'stockSnapshot', null,
      'fields', jsonb_build_object('price', 49)
    )
  );

  if v_confirmed_hash like 'unverified:%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: confirmed payload received technical hash';
  end if;

  if v_unverified_same not like 'unverified:%'
     or v_unverified_old not like 'unverified:%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: unverified payload was not marked';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 10, 'version:10', v_unverified_same
  ) <> 'apply' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: same revision unverified was intercepted as conflict';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 9, 'version:9', v_unverified_old
  ) <> 'stale' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: old unverified revision was not rejected as stale';
  end if;

  if private.ecommerce_source_revision_decision(
    'version', 10, 'version:10', v_confirmed_hash,
    'version', 11, 'version:11', v_unverified_same
  ) <> 'apply' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: newer unverified revision was not accepted fail-closed';
  end if;

  if private.ecommerce_source_revision_decision(
    'opaque', null, 'opaque:device-a', v_confirmed_hash,
    'opaque', null, 'opaque:device-a', v_unverified_same
  ) <> 'apply' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: same opaque revision unverified was not accepted';
  end if;

  if private.ecommerce_source_revision_decision(
    'opaque', null, 'opaque:device-a', v_confirmed_hash,
    'opaque', null, 'opaque:device-b', v_unverified_same
  ) <> 'conflict' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: different opaque revision bypassed review';
  end if;

  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'ecommerce_admin_sync_published_catalog'
    and pg_get_function_identity_arguments(p.oid) like '%p_expected_catalog_revision bigint%'
  limit 1;

  if v_definition is null
     or v_definition not like '%ecommerce_projection_payload_hash%'
     or v_definition not like '%ecommerce_source_revision_decision%'
     or v_definition not like '%when v_source_state = ''unverified'' or v_source_available is null%then pp.source_available%'
     or v_definition not like '%when v_source_state = ''unverified'' or v_stock_snapshot is null%then pp.stock_snapshot%'
     or v_definition not like '%when v_source_state = ''unverified'' then pp.source_revision%'
     or v_definition not like '%when v_source_state = ''unverified'' then pp.source_payload_hash%' then
    raise exception 'CATALOG3_1_RESIDUAL_TEST: RPC no longer preserves confirmed unverified snapshot';
  end if;
end;
$$;

rollback;
