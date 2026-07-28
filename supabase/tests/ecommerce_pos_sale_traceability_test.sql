-- Ecommerce/POS traceability functional contract.
-- Run only after the migration in an authorized test database.
-- Every fixture is synthetic and the transaction is rolled back.

begin;

do $traceability_test$
declare
  v_license_id uuid := '39000000-0000-4000-8000-000000000001';
  v_other_license_id uuid := '39000000-0000-4000-8000-000000000002';
  v_device_id uuid := '39000000-0000-4000-8000-000000000003';
  v_portal_id uuid := '39000000-0000-4000-8000-000000000004';
  v_other_portal_id uuid := '39000000-0000-4000-8000-000000000005';
  v_order_explicit uuid := '39000000-0000-4000-8000-000000000011';
  v_order_metadata uuid := '39000000-0000-4000-8000-000000000012';
  v_order_idempotency uuid := '39000000-0000-4000-8000-000000000013';
  v_order_ambiguous_a uuid := '39000000-0000-4000-8000-000000000014';
  v_order_ambiguous_b uuid := '39000000-0000-4000-8000-000000000015';
  v_order_multi_sale uuid := '39000000-0000-4000-8000-000000000016';
  v_order_orphan uuid := '39000000-0000-4000-8000-000000000017';
  v_explicit_code text;
  v_metadata_code text;
  v_idempotency_code text;
  v_result jsonb;
  v_search text;
  v_rejected boolean;
  v_history_def text;
  v_trigger_def text;
begin
  insert into public.licenses(
    id, license_key, license_type, status, expires_at, features
  ) values
    (
      v_license_id,
      'ECOM-POS-TRACEABILITY-ROLLBACK',
      'free',
      'active',
      clock_timestamp() + interval '1 day',
      jsonb_build_object(
        'cloud_pos_sync', true,
        'cloud_sales_reports_final', true,
        'ecommerce_portal_enabled', true,
        'ecommerce_order_inbox', true
      )
    ),
    (
      v_other_license_id,
      'ECOM-POS-TRACEABILITY-OTHER-ROLLBACK',
      'free',
      'active',
      clock_timestamp() + interval '1 day',
      jsonb_build_object(
        'cloud_pos_sync', true,
        'cloud_sales_reports_final', true,
        'ecommerce_portal_enabled', true,
        'ecommerce_order_inbox', true
      )
    );

  insert into public.license_devices(
    id, license_id, device_fingerprint, security_token, is_active, device_role
  ) values (
    v_device_id,
    v_license_id,
    'ecom-pos-traceability-device',
    'ecom-pos-traceability-token',
    true,
    'admin'
  );

  insert into public.ecommerce_portals(
    id, license_id, slug, status, name
  ) values
    (
      v_portal_id,
      v_license_id,
      'ecom-pos-traceability-rollback',
      'draft',
      'Ecommerce POS traceability rollback'
    ),
    (
      v_other_portal_id,
      v_other_license_id,
      'ecom-pos-traceability-other-rollback',
      'draft',
      'Ecommerce POS traceability other rollback'
    );

  insert into public.ecommerce_orders(
    id, portal_id, license_id, customer_name, customer_phone, total
  ) values
    (v_order_explicit, v_portal_id, v_license_id, 'Explicit fixture', '9990000001', 31),
    (v_order_metadata, v_portal_id, v_license_id, 'Metadata fixture', '9990000002', 32),
    (v_order_idempotency, v_portal_id, v_license_id, 'Idempotency fixture', '9990000003', 33),
    (v_order_ambiguous_a, v_portal_id, v_license_id, 'Ambiguous A', '9990000004', 34),
    (v_order_ambiguous_b, v_portal_id, v_license_id, 'Ambiguous B', '9990000005', 35),
    (v_order_multi_sale, v_portal_id, v_license_id, 'Multi sale', '9990000006', 36),
    (v_order_orphan, v_portal_id, v_license_id, 'Orphan', '9990000007', 37);

  select public_order_code into v_explicit_code
  from public.ecommerce_orders where id = v_order_explicit;
  select public_order_code into v_metadata_code
  from public.ecommerce_orders where id = v_order_metadata;
  select public_order_code into v_idempotency_code
  from public.ecommerce_orders where id = v_order_idempotency;

  update public.ecommerce_orders
  set pos_conversion_key = 'ecommerce:' || v_order_idempotency::text
  where id = v_order_idempotency;

  -- Explicit UUID wins and canonicalizes a stale/wrong public code.
  insert into public.pos_sales(
    id, license_id, device_id, cloud_folio, total,
    sales_channel, ecommerce_order_id, ecommerce_order_code
  ) values (
    'trace-sale-explicit',
    v_license_id,
    v_device_id,
    'V-000034',
    31,
    'ecommerce',
    v_order_explicit,
    'EC-99999999'
  );

  if not exists (
    select 1
    from public.pos_sales
    where id = 'trace-sale-explicit'
      and sales_channel = 'ecommerce'
      and ecommerce_order_id = v_order_explicit
      and ecommerce_order_code = v_explicit_code
      and metadata->>'ecommerceOrderId' = v_order_explicit::text
      and metadata->>'ecommerceOrderCode' = v_explicit_code
  ) then
    raise exception 'explicit traceability was not canonicalized';
  end if;

  -- Metadata-only intent resolves to explicit canonical columns.
  insert into public.pos_sales(id, license_id, device_id, cloud_folio, total, metadata)
  values (
    'trace-sale-metadata',
    v_license_id,
    v_device_id,
    'V-000035',
    32,
    jsonb_build_object('origin', 'ecommerce', 'ecommerceOrderId', v_order_metadata)
  );

  if not exists (
    select 1
    from public.pos_sales
    where id = 'trace-sale-metadata'
      and sales_channel = 'ecommerce'
      and ecommerce_order_id = v_order_metadata
      and ecommerce_order_code = v_metadata_code
  ) then
    raise exception 'metadata-only traceability was not resolved';
  end if;

  -- The canonical ecommerce idempotency key resolves the order.
  insert into public.pos_sales(
    id, license_id, device_id, cloud_folio, total, idempotency_key
  ) values (
    'trace-sale-idempotency',
    v_license_id,
    v_device_id,
    'V-000036',
    33,
    'ecommerce:' || v_order_idempotency::text
  );

  if not exists (
    select 1
    from public.pos_sales
    where id = 'trace-sale-idempotency'
      and sales_channel = 'ecommerce'
      and ecommerce_order_id = v_order_idempotency
      and ecommerce_order_code = v_idempotency_code
  ) then
    raise exception 'idempotency traceability was not resolved';
  end if;

  -- A normal local sale remains local with both ecommerce references null.
  insert into public.pos_sales(id, license_id, device_id, cloud_folio, total)
  values ('trace-sale-local', v_license_id, v_device_id, 'V-000037', 38);

  if not exists (
    select 1
    from public.pos_sales
    where id = 'trace-sale-local'
      and sales_channel = 'local'
      and ecommerce_order_id is null
      and ecommerce_order_code is null
  ) then
    raise exception 'local sale coherence failed';
  end if;

  -- One ecommerce order cannot be linked to a second sale.
  v_rejected := false;
  begin
    insert into public.pos_sales(
      id, license_id, sales_channel, ecommerce_order_id, total
    ) values (
      'trace-sale-duplicate',
      v_license_id,
      'ecommerce',
      v_order_explicit,
      31
    );
  exception when unique_violation then
    v_rejected := true;
  end;
  if not v_rejected then
    raise exception 'duplicate ecommerce order link was accepted';
  end if;

  -- Cross-license and nonexistent orders must fail closed in the trigger.
  v_rejected := false;
  begin
    insert into public.pos_sales(
      id, license_id, sales_channel, ecommerce_order_id, total
    ) values (
      'trace-sale-cross-license',
      v_other_license_id,
      'ecommerce',
      v_order_explicit,
      1
    );
  exception when sqlstate 'P0001' then
    v_rejected := sqlerrm = 'ECOMMERCE_ORDER_NOT_FOUND';
  end;
  if not v_rejected then
    raise exception 'cross-license ecommerce order was accepted';
  end if;

  v_rejected := false;
  begin
    insert into public.pos_sales(
      id, license_id, sales_channel, ecommerce_order_id, total
    ) values (
      'trace-sale-missing-order',
      v_license_id,
      'ecommerce',
      '39000000-0000-4000-8000-000000000099',
      1
    );
  exception when sqlstate 'P0001' then
    v_rejected := sqlerrm = 'ECOMMERCE_ORDER_NOT_FOUND';
  end;
  if not v_rejected then
    raise exception 'nonexistent ecommerce order was accepted';
  end if;

  -- Backfill preflight exposes ambiguities instead of ranking one candidate.
  insert into public.pos_sales(id, license_id, total)
  values
    ('trace-ambiguous-sale-a', v_license_id, 1),
    ('trace-ambiguous-sale-b', v_license_id, 1);

  update public.ecommerce_orders
  set converted_sale_id = 'trace-ambiguous-sale-a'
  where id in (v_order_ambiguous_a, v_order_ambiguous_b);

  update public.ecommerce_orders
  set converted_sale_id = 'trace-ambiguous-sale-a',
      pos_conversion_sale_id = 'trace-ambiguous-sale-b'
  where id = v_order_multi_sale;

  if not exists (
    select 1
    from private.pos_ecommerce_sale_backfill_candidates(v_license_id)
    where sale_id = 'trace-ambiguous-sale-a'
      and sale_candidate_count > 1
  ) or not exists (
    select 1
    from private.pos_ecommerce_sale_backfill_candidates(v_license_id)
    where ecommerce_order_id = v_order_multi_sale
      and order_candidate_count > 1
  ) then
    raise exception 'backfill ambiguity preflight did not report both directions';
  end if;

  if not exists (
    select 1
    from private.pos_ecommerce_sale_integrity_issues(v_license_id)
    where code = 'ECOMMERCE_SALE_MULTIPLE_ORDER_CANDIDATES'
  ) or not exists (
    select 1
    from private.pos_ecommerce_sale_integrity_issues(v_license_id)
    where code = 'ECOMMERCE_ORDER_MULTIPLE_SALE_CANDIDATES'
  ) then
    raise exception 'integrity report omitted a backfill ambiguity';
  end if;

  -- Converted order without a sale and total mismatch are functional findings.
  update public.ecommerce_orders
  set status = 'converted_to_sale',
      converted_sale_id = 'trace-sale-does-not-exist'
  where id = v_order_orphan;

  update public.ecommerce_orders set total = 131 where id = v_order_explicit;

  if not exists (
    select 1 from private.pos_ecommerce_sale_integrity_issues(v_license_id)
    where code = 'CONVERTED_ORDER_WITHOUT_POS_SALE'
      and ecommerce_order_id = v_order_orphan
  ) or not exists (
    select 1 from private.pos_ecommerce_sale_integrity_issues(v_license_id)
    where code = 'ECOMMERCE_ORDER_SALE_TOTAL_MISMATCH'
      and ecommerce_order_id = v_order_explicit
  ) then
    raise exception 'integrity report functional findings are incomplete';
  end if;

  -- Final-history RPC searches by EC folio, V folio, order UUID and sale id.
  foreach v_search in array array[
    v_explicit_code,
    'V-000034',
    v_order_explicit::text,
    'trace-sale-explicit'
  ]
  loop
    v_result := public.pos_get_sales_final_history_unlimited(
      p_license_key => 'ECOM-POS-TRACEABILITY-ROLLBACK',
      p_device_fingerprint => 'ecom-pos-traceability-device',
      p_security_token => 'ecom-pos-traceability-token',
      p_scope => 'mine',
      p_search => v_search
    );
    if coalesce((v_result->>'success')::boolean, false) is not true
       or not exists (
         select 1
         from jsonb_array_elements(v_result->'rows') row_data
         where row_data->>'id' = 'trace-sale-explicit'
           and row_data->>'sales_channel' = 'ecommerce'
       ) then
      raise exception 'history RPC search failed for %: %', v_search, v_result;
    end if;
  end loop;

  -- Structural contract and private execution boundary.
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.pos_sales'::regclass
      and conname = 'pos_sales_ecommerce_traceability_coherence_check'
  ) then
    raise exception 'traceability coherence constraint is missing';
  end if;

  if has_function_privilege(
    'anon',
    'private.pos_ecommerce_sale_integrity_issues(uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'private.pos_ecommerce_sale_integrity_issues(uuid)',
    'execute'
  ) or has_function_privilege(
    'anon',
    'private.pos_ecommerce_sale_backfill_candidates(uuid)',
    'execute'
  ) or has_function_privilege(
    'authenticated',
    'private.pos_ecommerce_sale_backfill_candidates(uuid)',
    'execute'
  ) then
    raise exception 'private reports must not be client executable';
  end if;

  select lower(pg_get_functiondef(
    'public.pos_get_sales_final_history_unlimited(text,text,text,text,timestamptz,timestamptz,text,uuid,uuid,text,text,text,text,text,text,text,integer,integer)'::regprocedure
  )) into v_history_def;
  if v_history_def not like '%s.ecommerce_order_code%'
     or v_history_def not like '%s.ecommerce_order_id::text%'
     or v_history_def not like '%''sales_channel'', s.sales_channel%' then
    raise exception 'history search/output does not preserve ecommerce traceability';
  end if;

  select lower(pg_get_functiondef(
    'private.pos_sales_normalize_ecommerce_traceability()'::regprocedure
  )) into v_trigger_def;
  if v_trigger_def not like '%ecommerce_order_not_found%'
     or v_trigger_def not like '%new.metadata%'
     or v_trigger_def not like '%new.idempotency_key%' then
    raise exception 'traceability trigger does not fail closed for every input path';
  end if;
end;
$traceability_test$;

rollback;
