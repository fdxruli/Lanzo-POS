-- FASE CAD.3 — Reporte e historial de mermas por caducidad.
-- Objetivo: exponer una lectura segura de mermas cloud por caducidad sin tocar la mutacion existente.

create index if not exists idx_pos_inventory_movements_expiry_waste_history
on public.pos_inventory_movements (license_id, created_at desc)
where (
  (metadata ->> 'semantic_type') = 'expiry_write_off'
  or lower(coalesce(reason, '')) in ('caducidad', 'caducidad_parcial')
);

comment on index public.idx_pos_inventory_movements_expiry_waste_history
is 'CAD.3: acelera el historial de mermas por caducidad filtrado por licencia y fecha.';

create or replace function public.pos_get_expiration_waste_history(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_summary jsonb;
  v_items jsonb;
begin
  v_context := private.validate_pos_sync_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );
  perform private.assert_pos_permission(v_context, 'reports');
  v_license_id := (v_context->>'license_id')::uuid;

  with history as (
    select
      m.id,
      m.product_id,
      coalesce(p.name, nullif(m.metadata->>'product_name', ''), 'Producto eliminado') as product_name,
      m.batch_id,
      coalesce(b.sku, nullif(m.metadata->>'batch_sku', ''), nullif(m.metadata->>'batchSku', ''), 'Lote') as batch_sku,
      coalesce(m.quantity, 0) as quantity,
      'u'::text as unit,
      coalesce(m.unit_cost, 0) as cost_at_time,
      coalesce(
        case
          when (m.metadata->>'loss_amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (m.metadata->>'loss_amount')::numeric
          else null
        end,
        m.total_cost,
        round((coalesce(m.quantity, 0) * coalesce(m.unit_cost, 0))::numeric, 4),
        0
      ) as loss_amount,
      coalesce(nullif(m.reason, ''), nullif(m.metadata->>'reason', ''), 'caducidad') as reason,
      case
        when lower(coalesce(m.reason, m.metadata->>'reason', '')) = 'caducidad_parcial'
          or coalesce(m.new_batch_stock, 0) > 0 then 'partial'
        when lower(coalesce(m.reason, m.metadata->>'reason', '')) = 'caducidad'
          or coalesce(m.new_batch_stock, 0) <= 0 then 'total'
        else 'unknown'
      end as waste_type,
      nullif(m.metadata->>'notes', '') as notes,
      coalesce(
        case
          when (m.metadata->>'expiry_date') ~ '^\d{4}-\d{2}-\d{2}' then (m.metadata->>'expiry_date')::date
          else null
        end,
        b.expiry_date::date
      ) as expiry_date,
      m.created_at,
      m.actor_name
    from public.pos_inventory_movements m
    left join public.pos_products p
      on p.license_id = m.license_id
     and p.id = m.product_id
    left join public.pos_product_batches b
      on b.license_id = m.license_id
     and b.id = m.batch_id
    where m.license_id = v_license_id
      and (p_date_from is null or m.created_at >= p_date_from)
      and (p_date_to is null or m.created_at < p_date_to)
      and (
        (m.metadata ->> 'semantic_type') = 'expiry_write_off'
        or lower(coalesce(m.reason, '')) in ('caducidad', 'caducidad_parcial')
        or lower(coalesce(m.metadata->>'reason', '')) in ('caducidad', 'caducidad_parcial')
      )
  ),
  limited as (
    select *
    from history
    order by created_at desc, id desc
    limit v_limit
  ),
  summary as (
    select jsonb_build_object(
      'total_records', count(*),
      'total_quantity', coalesce(sum(quantity), 0),
      'total_loss_amount', coalesce(sum(loss_amount), 0),
      'total_batches', count(distinct batch_id) filter (where batch_id is not null),
      'total_products', count(distinct product_id) filter (where product_id is not null),
      'partial_count', count(*) filter (where waste_type = 'partial'),
      'total_count', count(*) filter (where waste_type = 'total')
    ) as payload
    from history
  ),
  items as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', id,
      'productId', product_id,
      'productName', product_name,
      'batchId', batch_id,
      'batchSku', batch_sku,
      'quantity', quantity,
      'unit', unit,
      'costAtTime', cost_at_time,
      'lossAmount', loss_amount,
      'reason', reason,
      'wasteType', waste_type,
      'notes', notes,
      'expiryDate', expiry_date,
      'timestamp', created_at,
      'actorName', actor_name,
      'source', 'cloud'
    ) order by created_at desc, id desc), '[]'::jsonb) as payload
    from limited
  )
  select summary.payload, items.payload
  into v_summary, v_items
  from summary cross join items;

  return jsonb_build_object(
    'success', true,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'items', coalesce(v_items, '[]'::jsonb)
  );
end;
$$;

comment on function public.pos_get_expiration_waste_history(text,text,text,text,timestamptz,timestamptz,integer)
is 'CAD.3: historial cloud de mermas por caducidad. Valida contexto POS y permiso reports; no expone ventas/clientes.';

revoke all on function public.pos_get_expiration_waste_history(text,text,text,text,timestamptz,timestamptz,integer) from public;
grant execute on function public.pos_get_expiration_waste_history(text,text,text,text,timestamptz,timestamptz,integer) to anon, authenticated;
