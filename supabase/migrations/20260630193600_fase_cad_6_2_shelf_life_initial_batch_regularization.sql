create or replace function private.calculate_pos_shelf_life_target(
  p_base_date timestamptz,
  p_shelf_life_value numeric,
  p_shelf_life_unit text default 'days'
)
returns timestamptz
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_base timestamptz := coalesce(p_base_date, now());
  v_value numeric := coalesce(p_shelf_life_value, 0);
  v_unit text := translate(lower(btrim(coalesce(p_shelf_life_unit, 'days'))), 'áéíóúü', 'aeiouu');
begin
  if v_value <= 0 then
    return null;
  end if;

  if v_unit in ('hour', 'hours', 'hora', 'horas') then
    return v_base + ((v_value::text || ' hours')::interval);
  elsif v_unit in ('month', 'months', 'mes', 'meses') then
    return v_base + ((v_value::text || ' months')::interval);
  end if;

  return v_base + ((v_value::text || ' days')::interval);
end;
$function$;

do $$
declare
  v_row record;
  v_product public.pos_products;
begin
  for v_row in
    update public.pos_product_batches b
    set
      expiry_date = private.calculate_pos_shelf_life_target(
        coalesce(b.created_at, p.created_at, now()),
        p.shelf_life_value,
        p.shelf_life_unit
      ),
      alert_target_date = private.calculate_pos_shelf_life_target(
        coalesce(b.created_at, p.created_at, now()),
        p.shelf_life_value,
        p.shelf_life_unit
      ),
      alert_type = coalesce(b.alert_type, 'VIDA_UTIL_ESTIMADA'),
      updated_at = now(),
      server_version = b.server_version + 1,
      metadata = coalesce(b.metadata, '{}'::jsonb)
        || jsonb_build_object(
          'cad6_2_repaired_missing_shelf_life_date', true,
          'cad6_2_repaired_at', now()
        )
    from public.pos_products p
    where b.license_id = p.license_id
      and b.product_id = p.id
      and p.expiration_mode = 'SHELF_LIFE'
      and p.shelf_life_value > 0
      and b.deleted_at is null
      and b.is_active is true
      and b.status = 'active'
      and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
      and b.expiry_date is null
      and b.alert_target_date is null
      and private.calculate_pos_shelf_life_target(coalesce(b.created_at, p.created_at, now()), p.shelf_life_value, p.shelf_life_unit) is not null
    returning b.license_id, b.product_id, b.id, b.server_version
  loop
    perform private.record_pos_sync_event(
      v_row.license_id,
      'product_batch',
      v_row.id,
      'update',
      null,
      null,
      null,
      jsonb_build_object('source', 'fase_cad_6_2_repair', 'product_id', v_row.product_id),
      v_row.server_version
    );

    v_product := private.recalculate_pos_product_projection(v_row.license_id, v_row.product_id);

    perform private.record_pos_sync_event(
      v_row.license_id,
      'product',
      v_row.product_id,
      'update',
      null,
      null,
      null,
      jsonb_build_object('source', 'fase_cad_6_2_repair', 'repaired_batch_id', v_row.id),
      v_product.server_version
    );
  end loop;
end $$;;
