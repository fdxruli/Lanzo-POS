create or replace function private.is_pos_batch_expired_for_sale(p_expiry_date timestamptz)
returns boolean
language sql
stable
set search_path to ''
as $$
  select p_expiry_date is not null and p_expiry_date::date < current_date;
$$;

comment on function private.is_pos_batch_expired_for_sale(timestamptz)
is 'CAD.1: fecha vencida para venta POS. Compara por fecha calendario: un lote que vence hoy sigue vendible hoy. current_date usa la zona horaria de la sesión DB; cuando se agregue zona horaria por negocio, este helper debe centralizar el ajuste.';

create or replace function private.audit_pos_inventory_block(
  p_license_id uuid,
  p_sale_id text,
  p_event_type text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
begin
  insert into public.pos_sale_audit_events (
    license_id,
    sale_id,
    event_type,
    payload
  ) values (
    p_license_id,
    p_sale_id,
    p_event_type,
    coalesce(p_payload, '{}'::jsonb)
  );

  return p_payload;
exception when others then
  return p_payload || jsonb_build_object('audit_warning', sqlerrm);
end;
$$;

create or replace function private.resolve_sale_inventory_allocations(p_license_id uuid, p_items jsonb, p_sale_id text)
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
  v_expired_available_total numeric;
  v_uses_batches boolean;
  v_strict_expiry boolean;
  v_response jsonb;
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
    v_strict_expiry := coalesce(v_product.expiration_mode, 'NONE') = 'STRICT';

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
      v_expired_available_total := 0;

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

          if v_strict_expiry and private.is_pos_batch_expired_for_sale(v_batch.expiry_date) then
            v_response := jsonb_build_object(
              'ok', false,
              'success', false,
              'code', 'EXPIRED_BATCH_BLOCKED',
              'message', 'Este lote ya esta vencido y no puede venderse.',
              'product_id', v_product_id,
              'product_name', v_product_name,
              'batch_id', v_batch_id,
              'batch_sku', v_batch.sku,
              'expiry_date', v_batch.expiry_date::date,
              'requested_quantity', v_requested_batch_qty,
              'available_quantity', 0,
              'expired_available_quantity', v_available,
              'source', 'resolve_sale_inventory_allocations'
            );
            return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.expired_batch_blocked', v_response);
          end if;

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
            'batch_sku', v_batch.sku,
            'batch_expiry_date', v_batch.expiry_date::date,
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

        if v_strict_expiry and private.is_pos_batch_expired_for_sale(v_batch.expiry_date) then
          v_response := jsonb_build_object(
            'ok', false,
            'success', false,
            'code', 'EXPIRED_BATCH_BLOCKED',
            'message', 'Este lote ya esta vencido y no puede venderse.',
            'product_id', v_product_id,
            'product_name', v_product_name,
            'batch_id', v_batch_id,
            'batch_sku', v_batch.sku,
            'expiry_date', v_batch.expiry_date::date,
            'requested_quantity', v_quantity,
            'available_quantity', 0,
            'expired_available_quantity', v_available,
            'source', 'resolve_sale_inventory_allocations'
          );
          return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.expired_batch_blocked', v_response);
        end if;

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
          'batch_sku', v_batch.sku,
          'batch_expiry_date', v_batch.expiry_date::date,
          'quantity', v_quantity,
          'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
          'stock_source', 'batch'
        ));
      else
        v_remaining := v_quantity;
        v_available_total := 0;
        v_expired_available_total := 0;

        if v_strict_expiry then
          select coalesce(sum(greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0)), 0)
          into v_expired_available_total
          from public.pos_product_batches b
          where b.license_id = p_license_id
            and b.product_id = v_product_id
            and b.deleted_at is null
            and b.is_active is true
            and b.track_stock is true
            and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
            and private.is_pos_batch_expired_for_sale(b.expiry_date);
        end if;

        for v_batch in
          select *
          from public.pos_product_batches b
          where b.license_id = p_license_id
            and b.product_id = v_product_id
            and b.deleted_at is null
            and b.is_active is true
            and b.track_stock is true
            and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
            and (v_strict_expiry is not true or private.is_pos_batch_expired_for_sale(b.expiry_date) is not true)
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
              'batch_sku', v_batch.sku,
              'batch_expiry_date', v_batch.expiry_date::date,
              'quantity', v_requested_batch_qty,
              'unit_cost', coalesce(v_unit_cost, v_batch.cost, v_product.cost),
              'stock_source', 'batch',
              'fefo', true
            ));
          end if;
        end loop;

        if v_remaining > 0.00001 then
          if v_strict_expiry and v_expired_available_total > 0 then
            v_response := jsonb_build_object(
              'ok', false,
              'success', false,
              'code', 'INSUFFICIENT_NON_EXPIRED_STOCK',
              'message', 'No hay stock vigente suficiente para completar esta venta.',
              'product_id', v_product_id,
              'product_name', v_product_name,
              'requested_quantity', v_quantity,
              'available_quantity', v_available_total,
              'expired_available_quantity', v_expired_available_total,
              'source', 'resolve_sale_inventory_allocations'
            );
            return private.audit_pos_inventory_block(p_license_id, p_sale_id, 'sale.insufficient_non_expired_stock', v_response);
          end if;

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

create or replace function private.fill_pos_sale_item_batch_snapshot()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_batch public.pos_product_batches;
begin
  if new.batch_id is null then
    return new;
  end if;

  select * into v_batch
  from public.pos_product_batches b
  where b.license_id = new.license_id
    and b.id = new.batch_id
  limit 1;

  if v_batch.id is not null then
    new.batch_sku := coalesce(new.batch_sku, v_batch.sku);
    new.batch_expiry_date := coalesce(new.batch_expiry_date, v_batch.expiry_date::date);
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      || jsonb_strip_nulls(jsonb_build_object(
        'batchSku', v_batch.sku,
        'batchExpiryDate', v_batch.expiry_date::date
      ));
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pos_sale_items_fill_batch_snapshot on public.pos_sale_items;
create trigger trg_pos_sale_items_fill_batch_snapshot
before insert or update of batch_id on public.pos_sale_items
for each row
execute function private.fill_pos_sale_item_batch_snapshot();

create or replace function public.pos_register_expiration_waste(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_batch_id text default null,
  p_quantity numeric default null,
  p_reason text default 'caducidad',
  p_notes text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_batch public.pos_product_batches;
  v_product public.pos_products;
  v_movement public.pos_inventory_movements;
  v_idempotency_key text;
  v_idem public.pos_idempotency_keys;
  v_inserted boolean;
  v_available numeric;
  v_quantity numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_previous_product_stock numeric;
  v_loss_amount numeric;
  v_batch_version integer;
  v_response jsonb;
begin
  if nullif(btrim(coalesce(p_batch_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'BATCH_ID_REQUIRED', 'message', 'Selecciona un lote para registrar merma.');
  end if;

  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_pos_permission(v_context, 'pos');

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'inventory.expiration_waste:' || p_batch_id || ':' || coalesce(p_quantity::text, 'all') || ':' || v_device_id::text);

  select * into v_idem
  from public.pos_idempotency_keys
  where license_id = v_license_id
    and idempotency_key = v_idempotency_key
  limit 1;

  if v_idem.status = 'completed' and v_idem.response_payload is not null then
    return v_idem.response_payload;
  elsif v_idem.status = 'processing' then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La merma ya esta en proceso.', 'idempotency_key', v_idempotency_key);
  end if;

  v_inserted := private.insert_pos_idempotency_processing(
    v_license_id,
    v_idempotency_key,
    'inventory.expiration_waste',
    'product_batch',
    p_batch_id,
    md5(coalesce(p_batch_id, '') || ':' || coalesce(p_quantity::text, 'all') || ':' || coalesce(p_reason, '') || ':' || coalesce(p_notes, ''))
  );

  if not v_inserted then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La merma ya esta en proceso.', 'idempotency_key', v_idempotency_key);
  end if;

  select * into v_batch
  from public.pos_product_batches b
  where b.license_id = v_license_id
    and b.id = p_batch_id
    and b.deleted_at is null
  for update;

  if v_batch.id is null then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'CLOUD_BATCH_NOT_AVAILABLE', 'message', 'El lote no esta disponible en la nube.', 'batch_id', p_batch_id);
  end if;

  select * into v_product
  from public.pos_products p
  where p.license_id = v_license_id
    and p.id = v_batch.product_id
    and p.deleted_at is null
  for update;

  if v_product.id is null then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_SYNCED_FOR_CLOUD_SALE', 'message', 'El producto del lote no esta disponible.', 'batch_id', p_batch_id);
  end if;

  v_available := greatest(coalesce(v_batch.stock, 0) - coalesce(v_batch.committed_stock, 0), 0);
  v_quantity := coalesce(p_quantity, v_available);

  if v_quantity <= 0 then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'NO_AVAILABLE_BATCH_STOCK', 'message', 'El lote no tiene stock disponible para merma.', 'batch_id', p_batch_id, 'available_quantity', v_available);
  end if;

  if v_quantity > v_available then
    delete from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = v_idempotency_key;
    return jsonb_build_object('success', false, 'code', 'WASTE_QUANTITY_EXCEEDS_AVAILABLE', 'message', 'La cantidad de merma supera el stock disponible del lote.', 'batch_id', p_batch_id, 'requested_quantity', v_quantity, 'available_quantity', v_available);
  end if;

  v_previous_batch_stock := coalesce(v_batch.stock, 0);
  v_previous_product_stock := coalesce(v_product.stock, 0);
  v_new_batch_stock := greatest(v_previous_batch_stock - v_quantity, 0);
  v_loss_amount := round((v_quantity * coalesce(v_batch.cost, 0))::numeric, 4);

  update public.pos_product_batches
  set stock = v_new_batch_stock,
      is_active = case when v_new_batch_stock <= 0 then false else is_active end,
      status = case when v_new_batch_stock <= 0 then 'inactive' else status end,
      active_stock_status = case when v_new_batch_stock > 0 and is_active is true then 1 else 0 end,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = v_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'expirationWasteRegisteredAt', now(),
        'expirationWasteReason', coalesce(p_reason, 'caducidad'),
        'expirationWasteNotes', p_notes,
        'expirationWasteQuantity', v_quantity
      )
  where license_id = v_license_id
    and id = p_batch_id
  returning * into v_batch;

  v_batch_version := v_batch.server_version;
  v_product := private.recalculate_pos_product_projection(v_license_id, v_batch.product_id);

  v_movement := private.record_pos_inventory_movement(
    v_license_id,
    v_product.id,
    v_batch.id,
    null,
    null,
    'manual_out',
    v_quantity,
    v_previous_product_stock,
    v_product.stock,
    v_previous_batch_stock,
    v_new_batch_stock,
    v_batch.cost,
    coalesce(p_reason, 'caducidad'),
    'manual',
    v_device_id,
    v_staff_user_id,
    v_actor_key,
    v_actor_name,
    v_idempotency_key,
    jsonb_strip_nulls(jsonb_build_object(
      'semantic_type', 'expiry_write_off',
      'reason', coalesce(p_reason, 'caducidad'),
      'notes', p_notes,
      'expiry_date', v_batch.expiry_date::date,
      'loss_amount', v_loss_amount,
      'phase', 'fase_cad_1'
    ))
  );

  perform private.record_pos_sync_event(v_license_id, 'product_batch', v_batch.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'expiration_waste_registered', 'product_id', v_product.id, 'movement_id', v_movement.id), v_batch_version);
  perform private.record_pos_sync_event(v_license_id, 'product', v_product.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'expiration_waste_registered', 'batch_id', v_batch.id, 'movement_id', v_movement.id), v_product.server_version::integer);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'expiration_waste_registered', 'product_id', v_product.id, 'batch_id', v_batch.id), v_movement.server_version::integer);
  perform private.record_pos_sync_event(v_license_id, 'report', 'overview', 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('reason', 'expiration_waste_registered', 'product_id', v_product.id, 'batch_id', v_batch.id), 1);

  perform private.record_pos_sale_audit_event(
    v_license_id,
    null,
    'inventory.expiration_waste_registered',
    v_device_id,
    v_staff_user_id,
    v_actor_name,
    jsonb_build_object('product_id', v_product.id, 'product_name', v_product.name, 'batch_id', v_batch.id, 'expiry_date', v_batch.expiry_date::date, 'quantity_written_off', v_quantity, 'loss_amount', v_loss_amount, 'movement_id', v_movement.id, 'source', 'pos_register_expiration_waste')
  );

  v_response := jsonb_build_object(
    'success', true,
    'batch', to_jsonb(v_batch),
    'product', to_jsonb(v_product),
    'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement),
    'quantity_written_off', v_quantity,
    'loss_amount', v_loss_amount,
    'idempotency_key', v_idempotency_key
  );

  perform private.complete_pos_idempotency(v_license_id, v_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_get_expiring_batches_report(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_days_ahead integer default 30,
  p_include_inactive boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_context jsonb;
  v_license_id uuid;
  v_days integer := greatest(coalesce(p_days_ahead, 30), 0);
  v_summary jsonb;
  v_batches jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_pos_permission(v_context, 'pos');
  v_license_id := (v_context->>'license_id')::uuid;

  with scored as (
    select
      b.id as batch_id,
      b.product_id,
      p.name as product_name,
      b.sku as batch_sku,
      b.expiry_date,
      b.alert_target_date,
      b.alert_type,
      b.stock,
      b.committed_stock,
      greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) as available_stock,
      coalesce(b.cost, 0) as unit_cost,
      greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) * coalesce(b.cost, 0) as stock_value,
      b.is_active,
      b.status,
      p.expiration_mode,
      case
        when b.expiry_date is null then 'missing'
        when private.is_pos_batch_expired_for_sale(b.expiry_date) then 'expired'
        when b.expiry_date::date = current_date then 'expires_today'
        when b.expiry_date::date <= current_date + v_days then 'upcoming'
        else 'valid'
      end as expiry_status
    from public.pos_product_batches b
    join public.pos_products p on p.license_id = b.license_id and p.id = b.product_id
    where b.license_id = v_license_id
      and b.deleted_at is null
      and p.deleted_at is null
      and (p_include_inactive is true or (b.is_active is true and b.status = 'active'))
      and greatest(coalesce(b.stock, 0) - coalesce(b.committed_stock, 0), 0) > 0
  )
  select jsonb_build_object(
      'expired_active_batches', count(*) filter (where expiry_status = 'expired' and is_active is true and status = 'active'),
      'upcoming_batches', count(*) filter (where expiry_status in ('expires_today','upcoming')),
      'missing_expiry_strict_batches', count(*) filter (where expiry_status = 'missing' and expiration_mode = 'STRICT'),
      'current_stock', coalesce(sum(available_stock) filter (where expiry_status <> 'expired'), 0),
      'expired_stock', coalesce(sum(available_stock) filter (where expiry_status = 'expired'), 0),
      'expired_value', coalesce(sum(stock_value) filter (where expiry_status = 'expired'), 0),
      'risk_value', coalesce(sum(stock_value) filter (where expiry_status in ('expires_today','upcoming')), 0),
      'days_ahead', v_days
    ),
    coalesce(jsonb_agg(jsonb_build_object(
      'batch_id', batch_id,
      'product_id', product_id,
      'product_name', product_name,
      'batch_sku', batch_sku,
      'expiry_date', expiry_date::date,
      'alert_target_date', alert_target_date::date,
      'alert_type', alert_type,
      'expiry_status', expiry_status,
      'stock', stock,
      'committed_stock', committed_stock,
      'available_stock', available_stock,
      'unit_cost', unit_cost,
      'stock_value', stock_value,
      'is_active', is_active,
      'status', status,
      'expiration_mode', expiration_mode
    ) order by expiry_date asc nulls last, product_name asc), '[]'::jsonb)
  into v_summary, v_batches
  from scored
  where expiry_status in ('expired', 'expires_today', 'upcoming')
     or (expiry_status = 'missing' and expiration_mode = 'STRICT');

  return jsonb_build_object(
    'success', true,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'batches', coalesce(v_batches, '[]'::jsonb)
  );
end;
$$;;
