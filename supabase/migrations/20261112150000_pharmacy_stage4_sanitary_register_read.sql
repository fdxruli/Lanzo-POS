-- LANZO POS · Farmacia Etapa 4 · Registro sanitario auxiliar.
-- PROPUESTA: NO INSTALADA en Supabase Production.
-- Lectura acotada; no modifica movimientos, ventas, lotes ni recetas.
-- No es libro oficial ni demuestra sellado/retencion fisicos.

create index if not exists idx_pharmacy_dispensations_register_v1
  on private.pharmacy_dispensations_v1 (license_id, dispensed_at desc, sale_item_id desc);

create or replace function public.pos_get_pharmacy_sanitary_register_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_search text default null,
  p_movement_type text default null,
  p_batch_id text default null,
  p_trace_status text default null,
  p_limit integer default 50,
  p_before_at timestamptz default null,
  p_before_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer := coalesce(p_limit, 50);
  v_search text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_search, '')));
  v_rows jsonb;
  v_has_more boolean;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_reports_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'reports');
  -- A consolidated establishment-wide register needs global report authority.
  -- Ordinary Staff with only personal reports must not see other actors' prescriptions.
  if not private.reports_audit_allowed(v_context) then
    raise exception 'REPORT_SCOPE_DENIED' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;

  if not exists (
    select 1 from public.business_profiles bp
    where bp.license_id = v_license_id
      and 'farmacia'::public.business_category = any(bp.business_type)
  ) then
    raise exception 'PHARMACY_BUSINESS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_date_from is null or p_date_to is null
     or p_date_to <= p_date_from
     or p_date_to - p_date_from > interval '93 days'
     or p_date_to > pg_catalog.now() + interval '2 days'
     or v_limit not between 1 and 100
     or p_before_at is not null and nullif(p_before_id, '') is null
     or pg_catalog.length(v_search) > 120
     or pg_catalog.length(coalesce(p_batch_id, '')) > 150
     or (p_movement_type is not null and p_movement_type not in
       ('receipt', 'dispensation', 'waste', 'return', 'adjustment', 'other'))
     or (p_trace_status is not null and p_trace_status not in
       ('complete', 'incomplete', 'limited'))
  then
    raise exception 'PHARMACY_REPORT_FILTERS_INVALID' using errcode = 'P0001';
  end if;

  with inventory as (
    select
      'inventory:' || m.id as id,
      m.created_at as happened_at,
      case
        when m.source = 'inventory_entry' and m.movement_type = 'manual_in'
             and pg_catalog.jsonb_typeof(m.metadata->'pharmacyReceipt') = 'object'
          then 'receipt'
        when m.metadata->>'semantic_type' = 'expiry_write_off'
             or m.source = 'expiration_waste' then 'waste'
        when m.movement_type = 'return_in' then 'return'
        when m.movement_type in ('adjustment_in', 'adjustment_out') then 'adjustment'
        else 'other'
      end as movement_type,
      m.batch_id,
      pg_catalog.lower(coalesce(p.name, '') || ' ' || coalesce(p.barcode, '') ||
        ' ' || coalesce(p.active_substance, '') || ' ' || coalesce(m.product_id, '')) as search_text,
      pg_catalog.jsonb_build_object(
        'id', 'inventory:' || m.id,
        'operationId', m.idempotency_key,
        'occurredAt', m.created_at,
        'productId', m.product_id,
        'productName', p.name,
        'nameSource', 'current_catalog',
        'activeSubstance', p.active_substance,
        'classificationAtOperation', null,
        'quantity', m.quantity,
        'unit', null,
        'batchId', m.batch_id,
        'batchNumber', b.manufacturer_batch_id,
        'expiryDate', b.expiry_date,
        'expirySource', case when b.id is not null then 'current_batch' else null end,
        'documentReference', m.metadata->'pharmacyReceipt'->>'documentReference',
        'documentType', m.metadata->'pharmacyReceipt'->>'documentType',
        'receiptAt', m.metadata->'pharmacyReceipt'->>'receivedAt',
        'supplier', m.metadata->'pharmacyReceipt'->>'supplier',
        'saleId', m.sale_id,
        'saleItemId', m.sale_item_id,
        'prescriptionId', null,
        'saleStatus', null,
        'actor', coalesce(m.actor_name, m.actor_key),
        'notes', coalesce(m.metadata->'pharmacyReceipt'->>'notes', m.reason),
        'source', 'cloud',
        'provenance', m.source,
        'traceStatus', case
          when m.source = 'inventory_entry' and m.movement_type = 'manual_in'
            and nullif(pg_catalog.btrim(m.metadata->'pharmacyReceipt'->>'documentReference'), '') is not null
            and nullif(pg_catalog.btrim(m.metadata->'pharmacyReceipt'->>'manufacturerBatchId'), '') is not null
            and nullif(pg_catalog.btrim(m.metadata->'pharmacyReceipt'->>'expiryDate'), '') is not null
            then 'complete'
          when m.source = 'inventory_entry' or m.source = 'expiration_waste'
            or m.metadata->>'semantic_type' = 'expiry_write_off' then 'incomplete'
          else 'limited'
        end,
        'syncStatus', 'cloud_confirmed'
      ) as row_data
    from public.pos_inventory_movements m
    join public.pos_products p
      on p.license_id = m.license_id and p.id = m.product_id
      and p.metadata->'pharmacy'->>'kind' = 'medicine'
    left join public.pos_product_batches b
      on b.license_id = m.license_id and b.id = m.batch_id and b.product_id = m.product_id
    where m.license_id = v_license_id
      and m.created_at >= p_date_from and m.created_at < p_date_to
      and m.movement_type <> 'sale_out'
  ),
  dispensations as (
    select
      'dispensation:' || d.sale_item_id as id,
      d.dispensed_at as happened_at,
      'dispensation'::text as movement_type,
      d.batch_id,
      pg_catalog.lower(coalesce(si.product_name, '') || ' ' || coalesce(si.barcode, '') ||
        ' ' || coalesce(p.active_substance, '') || ' ' || coalesce(d.product_id, '')) as search_text,
      pg_catalog.jsonb_build_object(
        'id', 'dispensation:' || d.sale_item_id,
        'operationId', d.sale_item_id,
        'occurredAt', d.dispensed_at,
        'productId', d.product_id,
        'productName', si.product_name,
        'nameSource', 'sale_snapshot',
        'activeSubstance', null,
        'classificationAtOperation', null,
        'quantity', d.quantity,
        'unit', null,
        'batchId', d.batch_id,
        'batchNumber', b.manufacturer_batch_id,
        'expiryDate', coalesce(si.batch_expiry_date::text, b.expiry_date::date::text),
        'expirySource', case when si.batch_expiry_date is not null
           then 'sale_snapshot' when b.id is not null then 'current_batch' else null end,
        'documentReference', rx.reference,
        'documentType', 'prescription',
        'receiptAt', null,
        'supplier', null,
        'saleId', d.sale_id,
        'saleItemId', d.sale_item_id,
        'prescriptionId', d.prescription_id,
        'saleStatus', s.status,
        'actor', d.actor_key,
        'notes', null,
        'stampDeclared', d.stamp_declared,
        'retentionDeclared', d.retention_declared,
        'source', 'cloud',
        'provenance', 'confirmed_dispensation',
        'traceStatus', case
          when d.batch_id is not null and b.id is not null
            and s.status = 'closed' and nullif(pg_catalog.btrim(rx.reference), '') is not null
          then 'complete' else 'incomplete' end,
        'syncStatus', 'cloud_confirmed'
      ) as row_data
    from private.pharmacy_dispensations_v1 d
    join private.pharmacy_prescriptions_v1 rx
      on rx.license_id = d.license_id and rx.id = d.prescription_id
    join public.pos_sale_items si
      on si.license_id = d.license_id and si.id = d.sale_item_id
    join public.pos_sales s
      on s.license_id = d.license_id and s.id = d.sale_id
    left join public.pos_products p
      on p.license_id = d.license_id and p.id = d.product_id
    left join public.pos_product_batches b
      on b.license_id = d.license_id and b.id = d.batch_id and b.product_id = d.product_id
    where d.license_id = v_license_id
      and d.dispensed_at >= p_date_from and d.dispensed_at < p_date_to
  ),
  candidates as (
    select * from inventory
    union all
    select * from dispensations
  ),
  filtered as (
    select id, happened_at,
      row_data || pg_catalog.jsonb_build_object('movementType', movement_type) as record
    from candidates
    where (p_movement_type is null or movement_type = p_movement_type)
      and (p_batch_id is null or batch_id = p_batch_id)
      and (v_search = '' or pg_catalog.strpos(search_text, v_search) > 0)
      and (p_trace_status is null or row_data->>'traceStatus' = p_trace_status)
      and (p_before_at is null or (happened_at, id) < (p_before_at, p_before_id))
  ),
  page_plus_one as (
    select * from filtered order by happened_at desc, id desc limit v_limit + 1
  ),
  visible as (
    select * from page_plus_one order by happened_at desc, id desc limit v_limit
  )
  select
    (select coalesce(pg_catalog.jsonb_agg(record order by happened_at desc, id desc), '[]'::jsonb)
       from visible),
    (select count(*) > v_limit from page_plus_one)
  into v_rows, v_has_more;

  return pg_catalog.jsonb_build_object(
    'success', true, 'rows', v_rows, 'hasMore', v_has_more,
    'limit', v_limit, 'source', 'cloud_authorized',
    'coverage', 'Solo movimientos identificables; saldos historicos y ventas sin dispensacion documentada pueden faltar'
  );
end;
$$;

revoke all on function public.pos_get_pharmacy_sanitary_register_v1(
  text,text,text,text,timestamptz,timestamptz,text,text,text,text,integer,timestamptz,text
) from public, anon, authenticated, service_role;
grant execute on function public.pos_get_pharmacy_sanitary_register_v1(
  text,text,text,text,timestamptz,timestamptz,text,text,text,text,integer,timestamptz,text
) to anon, authenticated;
