
-- FASE 6C — Inventario/lotes cloud en venta PRO
-- Lanzo POS / Supabase production migration
-- Objetivo: activar descuento transaccional e idempotente de inventario cloud para venta cashier PRO.

create schema if not exists private;

alter table public.pos_sale_items
  add column if not exists inventory_effect_status text default 'not_applied',
  add column if not exists inventory_movement_id text null,
  add column if not exists stock_source text null,
  add column if not exists stock_before numeric null,
  add column if not exists stock_after numeric null,
  add column if not exists batch_stock_before numeric null,
  add column if not exists batch_stock_after numeric null;

alter table public.pos_sales
  add column if not exists inventory_effect_status text not null default 'not_applied';

create table if not exists public.pos_inventory_movements (
  id text primary key,
  license_id uuid not null,
  product_id text not null,
  batch_id text null,
  sale_id text null,
  sale_item_id text null,
  movement_type text not null,
  quantity numeric not null,
  previous_stock numeric,
  new_stock numeric,
  previous_batch_stock numeric,
  new_batch_stock numeric,
  unit_cost numeric,
  total_cost numeric,
  reason text,
  source text not null default 'sale',
  actor_device_id uuid,
  actor_staff_user_id uuid,
  actor_key text,
  actor_name text,
  idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  server_version bigint not null default 1,
  constraint pos_inventory_movements_type_check check (movement_type in ('sale_out','adjustment','return_in','manual_out','manual_in')),
  constraint pos_inventory_movements_quantity_check check (quantity > 0),
  constraint pos_inventory_movements_source_check check (source in ('sale','adjustment','migration','manual')),
  constraint pos_inventory_movements_unit_cost_check check (unit_cost is null or unit_cost >= 0),
  constraint pos_inventory_movements_total_cost_check check (total_cost is null or total_cost >= 0)
);

create index if not exists idx_pos_inventory_movements_license_product_created
  on public.pos_inventory_movements (license_id, product_id, created_at desc);
create index if not exists idx_pos_inventory_movements_license_batch_created
  on public.pos_inventory_movements (license_id, batch_id, created_at desc);
create index if not exists idx_pos_inventory_movements_license_sale
  on public.pos_inventory_movements (license_id, sale_id);
create index if not exists idx_pos_inventory_movements_license_source_created
  on public.pos_inventory_movements (license_id, source, created_at desc);
create index if not exists idx_pos_inventory_movements_license_idempotency
  on public.pos_inventory_movements (license_id, idempotency_key);
create unique index if not exists idx_pos_inventory_movements_license_idem_unique
  on public.pos_inventory_movements (license_id, idempotency_key)
  where idempotency_key is not null;

alter table public.pos_inventory_movements enable row level security;

revoke all on public.pos_inventory_movements from anon;
revoke all on public.pos_inventory_movements from authenticated;
grant all on public.pos_inventory_movements to service_role;

update public.plans
set features = coalesce(features, '{}'::jsonb) || jsonb_build_object('cloud_sales_inventory', code = 'pro_monthly')
where code in ('pro_monthly','free_trial','basic_monthly');

create or replace function private.assert_cloud_sales_inventory_enabled(p_context jsonb)
returns void
language plpgsql
stable
set search_path to ''
as $function$
begin
  perform private.assert_cloud_pos_sync_enabled(p_context);
  perform private.assert_cloud_products_sync_enabled(p_context);
  perform private.assert_cloud_sales_sync_base_enabled(p_context);
  perform private.assert_cloud_cash_sync_enabled(p_context);
  perform private.assert_cloud_sales_cashier_enabled(p_context);

  if coalesce((p_context->'features'->>'cloud_sales_inventory')::boolean, false) is not true then
    raise exception 'CLOUD_SALES_INVENTORY_DISABLED' using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function private.pos_inventory_movement_to_jsonb(p_movement public.pos_inventory_movements)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_movement.id,
    'license_id', p_movement.license_id,
    'product_id', p_movement.product_id,
    'batch_id', p_movement.batch_id,
    'sale_id', p_movement.sale_id,
    'sale_item_id', p_movement.sale_item_id,
    'movement_type', p_movement.movement_type,
    'quantity', p_movement.quantity,
    'previous_stock', p_movement.previous_stock,
    'new_stock', p_movement.new_stock,
    'previous_batch_stock', p_movement.previous_batch_stock,
    'new_batch_stock', p_movement.new_batch_stock,
    'unit_cost', p_movement.unit_cost,
    'total_cost', p_movement.total_cost,
    'reason', p_movement.reason,
    'source', p_movement.source,
    'actor_device_id', p_movement.actor_device_id,
    'actor_staff_user_id', p_movement.actor_staff_user_id,
    'actor_key', p_movement.actor_key,
    'actor_name', p_movement.actor_name,
    'idempotency_key', p_movement.idempotency_key,
    'metadata', p_movement.metadata,
    'created_at', p_movement.created_at,
    'server_version', p_movement.server_version
  ))
$function$;

create or replace function private.product_uses_batches(p_product public.pos_products)
returns boolean
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_cfg jsonb := p_product.batch_management;
begin
  if v_cfg is null then
    return false;
  end if;

  if jsonb_typeof(v_cfg) = 'boolean' then
    return v_cfg = 'true'::jsonb;
  end if;

  if jsonb_typeof(v_cfg) = 'object' then
    return lower(coalesce(v_cfg->>'enabled', '')) in ('true','1','yes','si','sí','enabled','active')
      or lower(coalesce(v_cfg->>'batchManagement', '')) in ('true','1','yes','si','sí','enabled','active')
      or lower(coalesce(v_cfg->>'manageBatches', '')) in ('true','1','yes','si','sí','enabled','active')
      or lower(coalesce(v_cfg->>'useBatches', '')) in ('true','1','yes','si','sí','enabled','active')
      or lower(coalesce(v_cfg->>'mode', '')) in ('batch','batches','lote','lotes','fefo');
  end if;

  return false;
end;
$function$;

create or replace function private.record_pos_inventory_movement(
  p_license_id uuid,
  p_product_id text,
  p_batch_id text default null,
  p_sale_id text default null,
  p_sale_item_id text default null,
  p_movement_type text default 'sale_out',
  p_quantity numeric default 0,
  p_previous_stock numeric default null,
  p_new_stock numeric default null,
  p_previous_batch_stock numeric default null,
  p_new_batch_stock numeric default null,
  p_unit_cost numeric default null,
  p_reason text default null,
  p_source text default 'sale',
  p_actor_device_id uuid default null,
  p_actor_staff_user_id uuid default null,
  p_actor_key text default null,
  p_actor_name text default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns public.pos_inventory_movements
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_existing public.pos_inventory_movements;
  v_movement public.pos_inventory_movements;
  v_id text;
  v_unit_cost numeric := case when p_unit_cost is null then null else greatest(p_unit_cost, 0) end;
begin
  if p_license_id is null then
    raise exception 'INVENTORY_MOVEMENT_LICENSE_REQUIRED' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(p_product_id, '')), '') is null then
    raise exception 'INVENTORY_MOVEMENT_PRODUCT_REQUIRED' using errcode = 'P0001';
  end if;
  if coalesce(p_quantity, 0) <= 0 then
    raise exception 'INVENTORY_MOVEMENT_QUANTITY_INVALID' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_existing
    from public.pos_inventory_movements
    where license_id = p_license_id
      and idempotency_key = p_idempotency_key
    limit 1;

    if v_existing.id is not null then
      return v_existing;
    end if;
  end if;

  v_id := 'inv_mov_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.pos_inventory_movements (
    id, license_id, product_id, batch_id, sale_id, sale_item_id,
    movement_type, quantity, previous_stock, new_stock,
    previous_batch_stock, new_batch_stock, unit_cost, total_cost,
    reason, source, actor_device_id, actor_staff_user_id, actor_key, actor_name,
    idempotency_key, metadata, server_version
  ) values (
    v_id, p_license_id, p_product_id, p_batch_id, p_sale_id, p_sale_item_id,
    coalesce(p_movement_type, 'sale_out'), p_quantity, p_previous_stock, p_new_stock,
    p_previous_batch_stock, p_new_batch_stock, v_unit_cost,
    case when v_unit_cost is null then null else p_quantity * v_unit_cost end,
    p_reason, coalesce(p_source, 'sale'), p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name,
    nullif(btrim(coalesce(p_idempotency_key, '')), ''),
    coalesce(p_metadata, '{}'::jsonb),
    1
  )
  returning * into v_movement;

  return v_movement;
end;
$function$;

create or replace function private.normalize_sale_inventory_item(p_payload jsonb, p_ordinality bigint)
returns jsonb
language plpgsql
immutable
set search_path to ''
as $function$
declare
  v_product_id text;
  v_batch_id text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_stock_source text;
  v_batches jsonb;
begin
  if jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) <> 'object' then
    raise exception 'SALE_ITEM_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_product_id := private.pos_sale_jsonb_text(p_payload, array['product_id','productId','parentId']);
  v_batch_id := private.pos_sale_jsonb_text(p_payload, array['batch_id','batchId']);
  v_quantity := private.pos_sale_jsonb_numeric(p_payload, array['quantity','qty'], 0);
  v_unit_cost := private.pos_sale_jsonb_numeric(p_payload, array['unit_cost','unitCost','cost'], null);
  v_stock_source := lower(coalesce(private.pos_sale_jsonb_text(p_payload, array['stock_source','stockSource'], null), ''));
  v_batches := coalesce(
    p_payload->'batches_used',
    p_payload->'batchesUsed',
    p_payload->'metadata'->'batches_used',
    p_payload->'metadata'->'batchesUsed',
    '[]'::jsonb
  );

  if v_quantity <= 0 then
    raise exception 'SALE_ITEM_QUANTITY_INVALID' using errcode = 'P0001';
  end if;

  if v_unit_cost is not null and v_unit_cost < 0 then
    raise exception 'SALE_ITEM_AMOUNT_INVALID' using errcode = 'P0001';
  end if;

  if jsonb_typeof(v_batches) <> 'array' then
    v_batches := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'item_id', coalesce(private.pos_sale_jsonb_text(p_payload, array['id','lineId','cartLineId']), 'item:' || p_ordinality::text),
    'product_id', v_product_id,
    'product_name', coalesce(private.pos_sale_jsonb_text(p_payload, array['product_name','productName','name']), 'Producto'),
    'batch_id', v_batch_id,
    'quantity', v_quantity,
    'unit_cost', v_unit_cost,
    'stock_source', nullif(v_stock_source, ''),
    'batches_used', v_batches
  );
end;
$function$;

create or replace function private.resolve_sale_inventory_allocations(
  p_license_id uuid,
  p_items jsonb,
  p_sale_id text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_item record;
  v_item_norm jsonb;
  v_batch_payload record;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_product_id text;
  v_item_id text;
  v_product_name text;
  v_batch_id text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_batches_used jsonb;
  v_requested_batch_qty numeric;
  v_allocated numeric;
  v_remaining numeric;
  v_available numeric;
  v_available_total numeric;
  v_uses_batches boolean;
  v_allocations jsonb := '[]'::jsonb;
  v_required_count integer := 0;
begin
  if p_license_id is null then
    raise exception 'LICENSE_ID_REQUIRED_FOR_INVENTORY' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  for v_item in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality
  loop
    v_item_norm := private.normalize_sale_inventory_item(v_item.payload, v_item.ordinality);
    v_item_id := coalesce(private.pos_sale_jsonb_text(v_item.payload, array['id']), p_sale_id || ':item:' || v_item.ordinality::text);
    v_product_id := nullif(v_item_norm->>'product_id', '');
    v_product_name := coalesce(v_item_norm->>'product_name', 'Producto');
    v_batch_id := nullif(v_item_norm->>'batch_id', '');
    v_quantity := (v_item_norm->>'quantity')::numeric;
    v_unit_cost := nullif(v_item_norm->>'unit_cost', '')::numeric;
    v_batches_used := coalesce(v_item_norm->'batches_used', '[]'::jsonb);

    if v_product_id is null then
      continue;
    end if;

    select * into v_product
    from public.pos_products p
    where p.license_id = p_license_id
      and p.id = v_product_id
    for update;

    if v_product.id is null then
      return jsonb_build_object(
        'ok', false,
        'success', false,
        'code', 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE',
        'message', 'Este producto aun no esta listo para venta cloud.',
        'product_id', v_product_id,
        'product_name', v_product_name,
        'requested_quantity', v_quantity,
        'available_quantity', 0
      );
    end if;

    v_product_name := coalesce(v_product.name, v_product_name);

    if v_product.deleted_at is not null or v_product.is_active is not true then
      return jsonb_build_object(
        'ok', false,
        'success', false,
        'code', 'CLOUD_PRODUCT_NOT_AVAILABLE',
        'message', 'El producto no esta activo en la nube.',
        'product_id', v_product_id,
        'product_name', v_product_name,
        'requested_quantity', v_quantity,
        'available_quantity', 0
      );
    end if;

    if v_product.track_stock is not true then
      continue;
    end if;

    v_required_count := v_required_count + 1;
    v_uses_batches := private.product_uses_batches(v_product)
      or v_batch_id is not null
      or jsonb_array_length(v_batches_used) > 0;

    if not v_uses_batches then
      v_available := greatest(coalesce(v_product.stock, 0) - coalesce(v_product.committed_stock, 0), 0);

      if v_available < v_quantity then
        return jsonb_build_object(
          'ok', false,
          'success', false,
          'code', 'INSUFFICIENT_CLOUD_STOCK',
          'message', 'No hay suficiente stock en la nube para completar esta venta.',
          'product_id', v_product_id,
          'product_name', v_product_name,
          'requested_quantity', v_quantity,
          'available_quantity', v_available
        );
      end if;

      v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
        'sale_id', p_sale_id,
        'sale_item_id', v_item_id,
        'product_id', v_product_id,
        'product_name', v_product_name,
        'batch_id', null,
        'quantity', v_quantity,
        'unit_cost', coalesce(v_unit_cost, v_product.cost),
        'stock_source', 'product'
      ));
    else
      v_allocated := 0;
      v_available_total := 0;

      if jsonb_array_length(v_batches_used) > 0 then
        for v_batch_payload in
          select value as payload, ordinality
          from jsonb_array_elements(v_batches_used) with ordinality
        loop
          v_batch_id := coalesce(
            private.pos_sale_jsonb_text(v_batch_payload.payload, array['batch_id','batchId','id']),
            null
          );
          v_requested_batch_qty := private.pos_sale_jsonb_numeric(v_batch_payload.payload, array['quantity','qty','usedQuantity','used_quantity'], 0);

          if v_batch_id is null or v_requested_batch_qty <= 0 then
            continue;
          end if;

          select * into v_batch
          from public.pos_product_batches b
          where b.license_id = p_license_id
            and b.product_id = v_product_id
            and b.id = v_batch_id
            and b.deleted_at is null
            and b.is_active is true
          for update;

          if v_batch.id is null then
            return jsonb_build_object(
              'ok', false,
              'success', false,
              'code', 'CLOUD_BATCH_NOT_AVAILABLE',
              'message', 'El lote no esta activo en la nube.',
              'product_id', v_product_id,
              'product_name', v_product_name,
              'batch_id', v_batch_id,
              'requested_quantity', v_requested_batch_qty,
              'available_quantity', 0
            );
          end if;

          v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);
          v_available_total := v_available_total + v_available;

          if v_available < v_requested_batch_qty then
            return jsonb_build_object(
              'ok', false,
              'success', false,
              'code', 'INSUFFICIENT_CLOUD_STOCK',
              'message', 'No hay suficiente stock en la nube para completar esta venta.',
              'product_id', v_product_id,
              'product_name', v_product_name,
              'batch_id', v_batch_id,
              'requested_quantity', v_requested_batch_qty,
              'available_quantity', v_available
            );
          end if;

          v_allocated := v_allocated + v_requested_batch_qty;
          v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
            'sale_id', p_sale_id,
            'sale_item_id', v_item_id,
            'product_id', v_product_id,
            'product_name', v_product_name,
            'batch_id', v_batch_id,
            'quantity', v_requested_batch_qty,
            'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
            'stock_source', 'batch'
          ));
        end loop;

        if abs(v_allocated - v_quantity) > 0.00001 then
          return jsonb_build_object(
            'ok', false,
            'success', false,
            'code', 'CLOUD_BATCH_ALLOCATION_MISMATCH',
            'message', 'Las asignaciones de lote no cuadran con la cantidad vendida.',
            'product_id', v_product_id,
            'product_name', v_product_name,
            'requested_quantity', v_quantity,
            'available_quantity', v_available_total
          );
        end if;
      elsif v_batch_id is not null then
        select * into v_batch
        from public.pos_product_batches b
        where b.license_id = p_license_id
          and b.product_id = v_product_id
          and b.id = v_batch_id
          and b.deleted_at is null
          and b.is_active is true
        for update;

        if v_batch.id is null then
          return jsonb_build_object(
            'ok', false,
            'success', false,
            'code', 'CLOUD_BATCH_NOT_AVAILABLE',
            'message', 'El lote no esta activo en la nube.',
            'product_id', v_product_id,
            'product_name', v_product_name,
            'batch_id', v_batch_id,
            'requested_quantity', v_quantity,
            'available_quantity', 0
          );
        end if;

        v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);

        if v_available < v_quantity then
          return jsonb_build_object(
            'ok', false,
            'success', false,
            'code', 'INSUFFICIENT_CLOUD_STOCK',
            'message', 'No hay suficiente stock en la nube para completar esta venta.',
            'product_id', v_product_id,
            'product_name', v_product_name,
            'batch_id', v_batch_id,
            'requested_quantity', v_quantity,
            'available_quantity', v_available
          );
        end if;

        v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
          'sale_id', p_sale_id,
          'sale_item_id', v_item_id,
          'product_id', v_product_id,
          'product_name', v_product_name,
          'batch_id', v_batch_id,
          'quantity', v_quantity,
          'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
          'stock_source', 'batch'
        ));
      else
        v_remaining := v_quantity;
        v_available_total := 0;

        for v_batch in
          select *
          from public.pos_product_batches b
          where b.license_id = p_license_id
            and b.product_id = v_product_id
            and b.deleted_at is null
            and b.is_active is true
            and b.track_stock is true
            and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
          order by b.expiry_date asc nulls last, b.created_at asc, b.id asc
          for update
        loop
          v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);
          v_available_total := v_available_total + v_available;

          if v_remaining > 0 then
            v_requested_batch_qty := least(v_remaining, v_available);
            v_remaining := v_remaining - v_requested_batch_qty;

            v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
              'sale_id', p_sale_id,
              'sale_item_id', v_item_id,
              'product_id', v_product_id,
              'product_name', v_product_name,
              'batch_id', v_batch.id,
              'quantity', v_requested_batch_qty,
              'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
              'stock_source', 'batch',
              'fefo', true
            ));
          end if;
        end loop;

        if v_remaining > 0.00001 then
          return jsonb_build_object(
            'ok', false,
            'success', false,
            'code', 'INSUFFICIENT_CLOUD_STOCK',
            'message', 'No hay suficiente stock en la nube para completar esta venta.',
            'product_id', v_product_id,
            'product_name', v_product_name,
            'requested_quantity', v_quantity,
            'available_quantity', v_available_total
          );
        end if;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'success', true,
    'inventory_effect_status', case when v_required_count > 0 then 'applied' else 'not_required' end,
    'allocations', v_allocations
  );
end;
$function$;

create or replace function private.apply_sale_inventory_effects(
  p_license_id uuid,
  p_sale_id text,
  p_allocations jsonb,
  p_actor_device_id uuid default null,
  p_actor_staff_user_id uuid default null,
  p_actor_key text default null,
  p_actor_name text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_allocation record;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_movement public.pos_inventory_movements;
  v_movements jsonb := '[]'::jsonb;
  v_product_id text;
  v_batch_id text;
  v_sale_item_id text;
  v_quantity numeric;
  v_unit_cost numeric;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_new_product_version integer;
  v_new_batch_version integer;
  v_sale_item_version bigint;
  v_movement_idem text;
  v_applied_count integer := 0;
  v_first_movement_id text;
  v_stock_source text;
begin
  if p_license_id is null or nullif(btrim(coalesce(p_sale_id, '')), '') is null then
    raise exception 'INVENTORY_EFFECT_CONTEXT_REQUIRED' using errcode = 'P0001';
  end if;

  if jsonb_typeof(coalesce(p_allocations, '[]'::jsonb)) <> 'array' then
    raise exception 'INVENTORY_ALLOCATIONS_INVALID' using errcode = 'P0001';
  end if;

  for v_allocation in
    select value as payload, ordinality
    from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) with ordinality
  loop
    v_product_id := nullif(v_allocation.payload->>'product_id', '');
    v_batch_id := nullif(v_allocation.payload->>'batch_id', '');
    v_sale_item_id := nullif(v_allocation.payload->>'sale_item_id', '');
    v_quantity := coalesce(nullif(v_allocation.payload->>'quantity', '')::numeric, 0);
    v_unit_cost := nullif(v_allocation.payload->>'unit_cost', '')::numeric;
    v_stock_source := coalesce(v_allocation.payload->>'stock_source', case when v_batch_id is null then 'product' else 'batch' end);

    if v_product_id is null or v_sale_item_id is null or v_quantity <= 0 then
      raise exception 'INVENTORY_ALLOCATION_INVALID' using errcode = 'P0001';
    end if;

    v_movement_idem := coalesce(p_idempotency_key, p_sale_id) || ':inventory:' || v_sale_item_id || ':' || v_product_id || ':' || coalesce(v_batch_id, 'product') || ':' || v_allocation.ordinality::text;

    if v_batch_id is null then
      select * into v_product
      from public.pos_products p
      where p.license_id = p_license_id
        and p.id = v_product_id
        and p.deleted_at is null
      for update;

      if v_product.id is null then
        raise exception 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE:%', v_product_id using errcode = 'P0001';
      end if;

      v_previous_stock := coalesce(v_product.stock, 0);

      if greatest(v_previous_stock - coalesce(v_product.committed_stock, 0), 0) < v_quantity then
        raise exception 'INSUFFICIENT_CLOUD_STOCK:%', v_product_id using errcode = 'P0001';
      end if;

      update public.pos_products
      set stock = stock - v_quantity,
          updated_at = now(),
          server_version = server_version + 1,
          updated_by_device_id = p_actor_device_id,
          updated_by_staff_user_id = p_actor_staff_user_id,
          last_idempotency_key = v_movement_idem,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastInventorySaleId', p_sale_id, 'lastInventoryMovementAt', now())
      where license_id = p_license_id
        and id = v_product_id
      returning stock, server_version into v_new_stock, v_new_product_version;

      v_movement := private.record_pos_inventory_movement(
        p_license_id, v_product_id, null, p_sale_id, v_sale_item_id,
        'sale_out', v_quantity, v_previous_stock, v_new_stock, null, null,
        v_unit_cost, 'Venta cloud confirmada', 'sale',
        p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name,
        v_movement_idem,
        jsonb_build_object('stock_source', 'product', 'phase', 'fase6c_cloud_sales_inventory')
      );

      perform private.record_pos_sync_event(p_license_id, 'product', v_product_id, 'update', p_actor_device_id, p_actor_staff_user_id, v_movement_idem, jsonb_build_object('reason', 'sale_inventory_out', 'sale_id', p_sale_id, 'movement_id', v_movement.id), v_new_product_version);
      perform private.record_pos_sale_audit_event(p_license_id, p_sale_id, 'sale.product_stock_updated', p_actor_device_id, p_actor_staff_user_id, p_actor_name, jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_sale_item_id, 'product_id', v_product_id, 'quantity', v_quantity, 'stock_before', v_previous_stock, 'stock_after', v_new_stock, 'idempotency_key', v_movement_idem));
    else
      select * into v_batch
      from public.pos_product_batches b
      where b.license_id = p_license_id
        and b.product_id = v_product_id
        and b.id = v_batch_id
        and b.deleted_at is null
      for update;

      if v_batch.id is null then
        raise exception 'CLOUD_BATCH_NOT_AVAILABLE:%', v_batch_id using errcode = 'P0001';
      end if;

      select * into v_product
      from public.pos_products p
      where p.license_id = p_license_id
        and p.id = v_product_id
        and p.deleted_at is null
      for update;

      if v_product.id is null then
        raise exception 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE:%', v_product_id using errcode = 'P0001';
      end if;

      v_previous_stock := coalesce(v_product.stock, 0);
      v_previous_batch_stock := coalesce(v_batch.stock, 0);

      if greatest(v_previous_batch_stock - coalesce(v_batch.committed_stock, 0), 0) < v_quantity then
        raise exception 'INSUFFICIENT_CLOUD_STOCK:%', v_product_id using errcode = 'P0001';
      end if;

      update public.pos_product_batches
      set stock = stock - v_quantity,
          updated_at = now(),
          server_version = server_version + 1,
          updated_by_device_id = p_actor_device_id,
          updated_by_staff_user_id = p_actor_staff_user_id,
          last_idempotency_key = v_movement_idem,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastInventorySaleId', p_sale_id, 'lastInventoryMovementAt', now())
      where license_id = p_license_id
        and id = v_batch_id
      returning stock, server_version into v_new_batch_stock, v_new_batch_version;

      select coalesce(sum(coalesce(b.stock, 0)) filter (where b.deleted_at is null and b.is_active is true), 0)
      into v_new_stock
      from public.pos_product_batches b
      where b.license_id = p_license_id
        and b.product_id = v_product_id;

      update public.pos_products
      set stock = coalesce(v_new_stock, 0),
          updated_at = now(),
          server_version = server_version + 1,
          updated_by_device_id = p_actor_device_id,
          updated_by_staff_user_id = p_actor_staff_user_id,
          last_idempotency_key = v_movement_idem,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('lastInventorySaleId', p_sale_id, 'lastInventoryMovementAt', now())
      where license_id = p_license_id
        and id = v_product_id
      returning stock, server_version into v_new_stock, v_new_product_version;

      v_movement := private.record_pos_inventory_movement(
        p_license_id, v_product_id, v_batch_id, p_sale_id, v_sale_item_id,
        'sale_out', v_quantity, v_previous_stock, v_new_stock, v_previous_batch_stock, v_new_batch_stock,
        v_unit_cost, 'Venta cloud confirmada', 'sale',
        p_actor_device_id, p_actor_staff_user_id, p_actor_key, p_actor_name,
        v_movement_idem,
        jsonb_build_object('stock_source', 'batch', 'phase', 'fase6c_cloud_sales_inventory', 'fefo', coalesce((v_allocation.payload->>'fefo')::boolean, false))
      );

      perform private.record_pos_sync_event(p_license_id, 'product_batch', v_batch_id, 'update', p_actor_device_id, p_actor_staff_user_id, v_movement_idem, jsonb_build_object('reason', 'sale_inventory_out', 'sale_id', p_sale_id, 'product_id', v_product_id, 'movement_id', v_movement.id), v_new_batch_version);
      perform private.record_pos_sync_event(p_license_id, 'product', v_product_id, 'update', p_actor_device_id, p_actor_staff_user_id, v_movement_idem, jsonb_build_object('reason', 'sale_inventory_out', 'sale_id', p_sale_id, 'batch_id', v_batch_id, 'movement_id', v_movement.id), v_new_product_version);
      perform private.record_pos_sale_audit_event(p_license_id, p_sale_id, 'sale.batch_stock_updated', p_actor_device_id, p_actor_staff_user_id, p_actor_name, jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_sale_item_id, 'product_id', v_product_id, 'batch_id', v_batch_id, 'quantity', v_quantity, 'stock_before', v_previous_stock, 'stock_after', v_new_stock, 'batch_stock_before', v_previous_batch_stock, 'batch_stock_after', v_new_batch_stock, 'idempotency_key', v_movement_idem));
    end if;

    v_first_movement_id := coalesce(v_first_movement_id, v_movement.id);
    v_movements := v_movements || jsonb_build_array(private.pos_inventory_movement_to_jsonb(v_movement));

    update public.pos_sale_items
    set inventory_effect_status = 'applied',
        inventory_movement_id = coalesce(inventory_movement_id, v_movement.id),
        stock_source = v_stock_source,
        stock_before = coalesce(stock_before, v_previous_stock),
        stock_after = v_new_stock,
        batch_stock_before = coalesce(batch_stock_before, v_previous_batch_stock),
        batch_stock_after = coalesce(v_new_batch_stock, batch_stock_after),
        batch_id = coalesce(batch_id, v_batch_id),
        metadata = coalesce(metadata, '{}'::jsonb)
          || jsonb_build_object(
            'inventoryEffectStatus', 'applied',
            'stockSource', v_stock_source,
            'inventoryMovementIds', coalesce(metadata->'inventoryMovementIds', '[]'::jsonb) || jsonb_build_array(v_movement.id)
          ),
        server_version = server_version + 1
    where license_id = p_license_id
      and sale_id = p_sale_id
      and id = v_sale_item_id
    returning server_version into v_sale_item_version;

    perform private.record_pos_sync_event(
      p_license_id,
      'sale_item',
      v_sale_item_id,
      'update',
      p_actor_device_id,
      p_actor_staff_user_id,
      v_movement_idem,
      jsonb_build_object('sale_id', p_sale_id, 'reason', 'inventory_effect_applied', 'movement_id', v_movement.id, 'product_id', v_product_id, 'batch_id', v_batch_id),
      coalesce(v_sale_item_version, 1)::integer
    );

    perform private.record_pos_sync_event(
      p_license_id,
      'inventory_movement',
      v_movement.id,
      'create',
      p_actor_device_id,
      p_actor_staff_user_id,
      v_movement_idem,
      jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_sale_item_id, 'product_id', v_product_id, 'batch_id', v_batch_id),
      v_movement.server_version::integer
    );

    perform private.record_pos_sale_audit_event(
      p_license_id,
      p_sale_id,
      'sale.inventory_movement_created',
      p_actor_device_id,
      p_actor_staff_user_id,
      p_actor_name,
      jsonb_build_object('sale_id', p_sale_id, 'sale_item_id', v_sale_item_id, 'product_id', v_product_id, 'batch_id', v_batch_id, 'quantity', v_quantity, 'movement_id', v_movement.id, 'idempotency_key', v_movement_idem)
    );
  end loop;

  v_applied_count := jsonb_array_length(v_movements);

  update public.pos_sales
  set inventory_effect_status = case when v_applied_count > 0 then 'applied' else 'not_required' end,
      updated_at = now(),
      server_version = server_version + 1,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'inventoryEffectStatus', case when v_applied_count > 0 then 'applied' else 'not_required' end,
        'inventoryMovementCount', v_applied_count
      )
  where license_id = p_license_id
    and id = p_sale_id;

  perform private.record_pos_sale_audit_event(
    p_license_id,
    p_sale_id,
    'sale.inventory_applied',
    p_actor_device_id,
    p_actor_staff_user_id,
    p_actor_name,
    jsonb_build_object('sale_id', p_sale_id, 'inventory_effect_status', case when v_applied_count > 0 then 'applied' else 'not_required' end, 'movement_count', v_applied_count, 'idempotency_key', p_idempotency_key)
  );

  return jsonb_build_object(
    'success', true,
    'inventory_effect_status', case when v_applied_count > 0 then 'applied' else 'not_required' end,
    'inventory_movements', v_movements
  );
end;
$function$;

create or replace function private.pos_sale_item_to_jsonb(p_item public.pos_sale_items)
returns jsonb
language sql
stable
set search_path to ''
as $function$
  select jsonb_build_object(
    'id', p_item.id,
    'license_id', p_item.license_id,
    'sale_id', p_item.sale_id,
    'product_id', p_item.product_id,
    'product_name', p_item.product_name,
    'product_sku', p_item.product_sku,
    'barcode', p_item.barcode,
    'category_id', p_item.category_id,
    'category_name', p_item.category_name,
    'quantity', p_item.quantity,
    'unit_price', p_item.unit_price,
    'unit_cost', p_item.unit_cost,
    'discount_amount', p_item.discount_amount,
    'tax_amount', p_item.tax_amount,
    'line_total', p_item.line_total,
    'batch_id', p_item.batch_id,
    'batch_sku', p_item.batch_sku,
    'batch_expiry_date', p_item.batch_expiry_date,
    'rubro', p_item.rubro,
    'inventory_effect_status', p_item.inventory_effect_status,
    'inventory_movement_id', p_item.inventory_movement_id,
    'stock_source', p_item.stock_source,
    'stock_before', p_item.stock_before,
    'stock_after', p_item.stock_after,
    'batch_stock_before', p_item.batch_stock_before,
    'batch_stock_after', p_item.batch_stock_after,
    'metadata', p_item.metadata,
    'created_at', p_item.created_at,
    'server_version', p_item.server_version
  )
$function$;

create or replace function public.pos_create_cloud_sale_cashier_inventory(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null::text,
  p_staff_session_token text default null::text,
  p_sale jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,
  p_payments jsonb default '[]'::jsonb,
  p_cash_session_id text default null::text,
  p_idempotency_key text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_sale_id text;
  v_local_sale_id text;
  v_idempotency_key text;
  v_core_idempotency_key text;
  v_inserted_idem boolean;
  v_idem public.pos_idempotency_keys;
  v_sale_payload jsonb;
  v_preflight jsonb;
  v_core_response jsonb;
  v_apply_response jsonb;
  v_sale public.pos_sales;
  v_cash_session public.pos_cash_sessions;
  v_cash_movement public.pos_cash_movements;
  v_items_response jsonb := '[]'::jsonb;
  v_payments_response jsonb := '[]'::jsonb;
  v_inventory_movements_response jsonb := '[]'::jsonb;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_latest_change_seq bigint;
  v_effects_status text;
begin
  if jsonb_typeof(coalesce(p_sale, '{}'::jsonb)) <> 'object' then
    raise exception 'SALE_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_ITEMS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_payments, '[]'::jsonb)) <> 'array' then
    raise exception 'SALE_PAYMENTS_PAYLOAD_INVALID' using errcode = 'P0001';
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_inventory_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);

  v_sale_id := coalesce(
    private.pos_sale_jsonb_text(p_sale, array['id','cloud_sale_id','cloudSaleId']),
    'sale_' || replace(gen_random_uuid()::text, '-', '')
  );
  v_local_sale_id := coalesce(private.pos_sale_jsonb_text(p_sale, array['local_sale_id','localSaleId']), v_sale_id);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'sales.cloud_commit.inventory:' || v_local_sale_id || ':' || v_device_id::text);
  v_core_idempotency_key := v_idempotency_key || ':cashier_core';

  select * into v_idem
  from public.pos_idempotency_keys
  where license_id = v_license_id
    and idempotency_key = v_idempotency_key
  limit 1;

  if v_idem.status = 'completed' and v_idem.response_payload is not null then
    return v_idem.response_payload;
  elsif v_idem.status = 'processing' then
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'sales.cloud_commit.inventory',
    'sale',
    v_sale_id,
    md5(coalesce(p_sale::text, '') || coalesce(p_items::text, '') || coalesce(p_payments::text, '') || coalesce(p_cash_session_id, ''))
  );

  if not v_inserted_idem then
    return jsonb_build_object(
      'success', false,
      'code', 'IDEMPOTENCY_PROCESSING',
      'message', 'La venta ya esta en proceso. Evita cobrarla dos veces.',
      'idempotency_key', v_idempotency_key
    );
  end if;

  v_sale_payload := coalesce(p_sale, '{}'::jsonb)
    || jsonb_build_object(
      'id', v_sale_id,
      'local_sale_id', v_local_sale_id,
      'metadata', coalesce(p_sale->'metadata', '{}'::jsonb) || jsonb_build_object(
        'phase', 'fase6c_cloud_sales_inventory',
        'cloudInventoryEffects', true,
        'noCloudInventoryEffects', false,
        'noCloudCreditEffects', true
      )
    );

  v_preflight := private.resolve_sale_inventory_allocations(v_license_id, p_items, v_sale_id);

  if coalesce((v_preflight->>'ok')::boolean, false) is not true then
    delete from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = v_idempotency_key;

    return v_preflight;
  end if;

  v_core_response := public.pos_create_cloud_sale_cashier(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    v_sale_payload,
    p_items,
    p_payments,
    p_cash_session_id,
    v_core_idempotency_key
  );

  if coalesce((v_core_response->>'success')::boolean, false) is not true then
    delete from public.pos_idempotency_keys
    where license_id = v_license_id
      and idempotency_key = v_idempotency_key;

    return v_core_response;
  end if;

  v_apply_response := private.apply_sale_inventory_effects(
    v_license_id,
    v_sale_id,
    coalesce(v_preflight->'allocations', '[]'::jsonb),
    v_device_id,
    v_staff_user_id,
    v_actor_key,
    v_actor_name,
    v_idempotency_key
  );

  select * into v_sale
  from public.pos_sales s
  where s.license_id = v_license_id
    and s.id = v_sale_id
  for update;

  if v_sale.id is null then
    raise exception 'CLOUD_SALE_NOT_FOUND_AFTER_CORE_COMMIT' using errcode = 'P0001';
  end if;

  v_effects_status := case
    when coalesce(v_apply_response->>'inventory_effect_status', 'not_required') = 'applied'
      and coalesce(v_sale.cash_effect_status, '') = 'applied' then 'cash_inventory_applied'
    when coalesce(v_apply_response->>'inventory_effect_status', 'not_required') = 'applied' then 'inventory_applied'
    else coalesce(v_sale.effects_status, 'payment_recorded')
  end;

  update public.pos_sales
  set effects_status = v_effects_status,
      inventory_effect_status = coalesce(v_apply_response->>'inventory_effect_status', 'not_required'),
      credit_effect_status = 'not_applied',
      idempotency_key = v_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'phase', 'fase6c_cloud_sales_inventory',
          'cloudInventoryEffects', true,
          'noCloudInventoryEffects', false,
          'noCloudCreditEffects', true,
          'inventoryEffectStatus', coalesce(v_apply_response->>'inventory_effect_status', 'not_required'),
          'inventoryMovementCount', jsonb_array_length(coalesce(v_apply_response->'inventory_movements', '[]'::jsonb)),
          'core_idempotency_key', v_core_idempotency_key
        ),
      updated_at = now(),
      server_version = server_version + 1
  where license_id = v_license_id
    and id = v_sale_id
  returning * into v_sale;

  perform private.record_pos_sale_audit_event(
    v_license_id,
    v_sale.id,
    'sale.inventory_cloud_committed',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_sale.cloud_folio,
      'inventory_effect_status', v_sale.inventory_effect_status,
      'effects_status', v_sale.effects_status,
      'idempotency_key', v_idempotency_key
    )
  );

  v_event := private.record_pos_sync_event(
    v_license_id,
    'sale',
    v_sale.id,
    'cloud_commit',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object(
      'sale_id', v_sale.id,
      'folio', v_sale.cloud_folio,
      'source_mode', 'cloud_committed',
      'effects_status', v_sale.effects_status,
      'inventory_effect_status', v_sale.inventory_effect_status,
      'cash_session_id', v_sale.cash_session_id,
      'cash_movement_id', v_sale.cash_movement_id
    ),
    v_sale.server_version::integer
  );

  perform private.record_pos_sync_event(
    v_license_id,
    'report',
    'overview',
    'update',
    v_device_id,
    v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object('reason', 'sale_cloud_inventory_committed', 'sale_id', v_sale.id),
    1
  );

  select coalesce(jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.created_at asc, i.id asc), '[]'::jsonb)
  into v_items_response
  from public.pos_sale_items i
  where i.license_id = v_license_id and i.sale_id = v_sale.id;

  select coalesce(jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.created_at asc, p.id asc), '[]'::jsonb)
  into v_payments_response
  from public.pos_sale_payments p
  where p.license_id = v_license_id and p.sale_id = v_sale.id;

  select coalesce(jsonb_agg(private.pos_inventory_movement_to_jsonb(m) order by m.created_at asc, m.id asc), '[]'::jsonb)
  into v_inventory_movements_response
  from public.pos_inventory_movements m
  where m.license_id = v_license_id and m.sale_id = v_sale.id;

  if v_sale.cash_session_id is not null then
    select * into v_cash_session
    from public.pos_cash_sessions s
    where s.license_id = v_license_id and s.id = v_sale.cash_session_id;
  end if;

  if v_sale.cash_movement_id is not null then
    select * into v_cash_movement
    from public.pos_cash_movements m
    where m.license_id = v_license_id and m.id = v_sale.cash_movement_id;
  end if;

  select coalesce(max(change_seq), 0) into v_latest_change_seq
  from public.pos_sync_events
  where license_id = v_license_id;

  v_response := jsonb_build_object(
    'success', true,
    'sale', private.pos_sale_to_jsonb(v_sale),
    'items', v_items_response,
    'payments', v_payments_response,
    'inventory_movements', v_inventory_movements_response,
    'cash_session', case when v_cash_session.id is null then null else private.pos_cash_session_to_jsonb(v_cash_session) end,
    'cash_movement', case when v_cash_movement.id is null then null else private.pos_cash_movement_to_jsonb(v_cash_movement) end,
    'event', to_jsonb(v_event),
    'server_version', v_sale.server_version,
    'change_seq', v_event.change_seq,
    'latest_change_seq', v_latest_change_seq,
    'idempotency_key', v_idempotency_key,
    'mode', 'cloud_cashier_inventory'
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
exception when unique_violation then
  raise exception 'SALE_DUPLICATE_OR_FOLIO_CONFLICT' using errcode = 'P0001';
end;
$function$;
;
