-- Atomic Free/Local catalog recovery over the existing catalog and inventory engines.
-- A new opening balance never merges with a Cloud product, lot, or reservation.
begin;

create function public.pos_recover_local_product_group_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_product jsonb,
  p_batches jsonb,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_context jsonb;
  v_license uuid;
  v_id text := p_product->>'id';
  v_category text := nullif(p_product->>'category_id', '');
  v_version integer := coalesce((p_product->>'server_version')::integer, 0);
  v_stock numeric := (p_product->>'stock')::numeric;
  v_committed numeric := (p_product->>'committed_stock')::numeric;
  v_parent public.pos_products;
  v_batch public.pos_product_batches;
  v_item jsonb;
  v_saved_batches jsonb := '[]'::jsonb;
  v_projection numeric := 0;
  v_has_batch_stock boolean := false;
  v_hash text;
  v_receipt public.pos_idempotency_keys;
  v_result jsonb;
  v_replay boolean;
  v_created boolean := false;
begin
  v_context := private.validate_product_inventory_actor(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
  );
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);
  v_license := (v_context->>'license_id')::uuid;

  -- Readiness check for clients deployed before this migration. It authorizes
  -- the same actor and plan but writes neither catalog rows nor receipts.
  if p_product is null and p_batches = '[]'::jsonb and p_idempotency_key is null then
    return jsonb_build_object('success', true, 'contract_version', 1);
  end if;

  if jsonb_typeof(p_product) is distinct from 'object'
    or jsonb_typeof(p_batches) is distinct from 'array'
    or nullif(btrim(v_id), '') is null or v_id <> btrim(v_id)
    or v_version < 0 or p_product->>'deleted_at' is not null
    or p_idempotency_key is null or p_idempotency_key !~ '^catalog-recovery:[0-9a-f]{32}$'
    or jsonb_typeof(p_product->'stock') is distinct from 'number'
    or jsonb_typeof(p_product->'committed_stock') is distinct from 'number'
    or v_stock < 0 or v_committed < 0 or v_committed > v_stock then
    raise exception 'RECOVERY_PRODUCT_INVALID' using errcode = 'P0001';
  end if;

  if v_version = 0 and (
    v_stock > 0 or v_committed > 0 or jsonb_array_length(p_batches) > 0
  ) then
    perform private.assert_inventory_actor_authority(v_context);
  end if;

  for v_item in select value from jsonb_array_elements(p_batches) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or nullif(btrim(v_item->>'id'), '') is null or (v_item->>'id') <> btrim(v_item->>'id')
      or (v_item->>'product_id') is distinct from v_id
      or v_item->>'deleted_at' is not null
      or coalesce(v_item->>'status', '') not in ('active', 'inactive', 'archived')
      or jsonb_typeof(v_item->'stock') is distinct from 'number'
      or jsonb_typeof(v_item->'committed_stock') is distinct from 'number'
      or (v_item->>'stock')::numeric < 0 or (v_item->>'committed_stock')::numeric < 0
      or (v_item->>'committed_stock')::numeric > (v_item->>'stock')::numeric then
      raise exception 'RECOVERY_BATCH_INVALID' using errcode = 'P0001';
    end if;
    if coalesce((v_item->>'is_active')::boolean, true) and v_item->>'status' = 'active' then
      v_projection := v_projection + (v_item->>'stock')::numeric;
    end if;
    v_has_batch_stock := v_has_batch_stock or (v_item->>'stock')::numeric > 0;
  end loop;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_batches)) <> jsonb_array_length(p_batches) then
    raise exception 'RECOVERY_BATCH_ID_DUPLICATE' using errcode = 'P0001';
  end if;

  -- Keep storefront source changes in the existing explicit recovery flow.
  -- Check the tenant's rows here so staff need only POS catalog permissions,
  -- and a business without a portal can still recover its catalog.
  if exists (
    select 1 from public.ecommerce_published_products publication
    where publication.license_id = v_license and publication.local_product_ref = v_id
      and publication.source_type = 'local_snapshot' and publication.deleted_at is null
      and publication.is_published
  ) then
    raise exception 'RECOVERY_PUBLISHED_SOURCE_REQUIRES_SELECTION' using errcode = 'P0001';
  end if;

  if v_version > 0 then
    v_result := public.enforce_pos_rpc_rate_limit_v2(
      p_license_key := p_license_key, p_device_fingerprint := p_device_fingerprint,
      p_staff_session_token := p_staff_session_token, p_rpc_name := 'pos_recover_local_product_group_v1',
      p_scope := 'POS_WRITE', p_max_attempts := 120, p_window_seconds := 600,
      p_block_seconds := 300, p_code := 'RPC_RATE_LIMITED', p_metadata := '{}'::jsonb
    );
    if (v_result->>'allowed')::boolean is not true then
      return public.build_pos_rpc_rate_limited_response(v_result);
    end if;
  end if;

  v_hash := md5(jsonb_build_array(p_product, p_batches)::text);
  v_replay := not private.insert_pos_idempotency_processing(
    v_license, p_idempotency_key, 'product.recover_local_group_v1', 'product', v_id, v_hash
  );
  if v_replay then
    select * into v_receipt from public.pos_idempotency_keys
      where license_id = v_license and idempotency_key = p_idempotency_key;
    if v_receipt.operation_type is distinct from 'product.recover_local_group_v1'
      or v_receipt.entity_id is distinct from v_id or v_receipt.request_hash is distinct from v_hash
      or v_receipt.status is distinct from 'completed' or v_receipt.response_payload->>'success' is distinct from 'true' then
      raise exception 'RECOVERY_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

  -- Inventory, reservation and lot writers lock the same parent row. For an
  -- absent parent, the existing create engine's unique identity and version 0
  -- prevent a concurrent creator from becoming an update.
  select * into v_parent from public.pos_products
    where license_id = v_license and id = v_id for update;
  if v_parent.deleted_at is not null then
    raise exception 'PRODUCT_DELETED' using errcode = 'P0001';
  end if;

  if v_category is not null then
    perform 1 from public.pos_categories
      where license_id = v_license and id = v_category and deleted_at is null for share;
    if not found then raise exception 'RECOVERY_CATEGORY_UNCONFIRMED' using errcode = 'P0001'; end if;
  end if;

  if v_replay or v_version > 0 then
    if v_parent.id is null or v_parent.server_version is distinct from
      (case when v_replay then (v_receipt.response_payload->'product'->>'server_version')::integer else v_version end) then
      raise exception 'RECOVERY_PRODUCT_VERSION_CONFLICT' using errcode = 'P0001';
    end if;
  elsif v_parent.id is null then
    if v_committed <> 0 or exists (
      select 1 from jsonb_array_elements(p_batches) b
      where (b->>'committed_stock')::numeric <> 0 or coalesce((b->>'server_version')::integer, 0) <> 0
    ) or exists (
      select 1 from public.pos_layaway_inventory_reservations r
      where r.license_id = v_license and r.product_id = v_id and r.status = 'reserved'
    ) or exists (
      select 1 from public.ecommerce_order_inventory_reservations r
      where r.license_id = v_license and r.source_product_id = v_id and r.status = 'reserved'
    ) then
      raise exception 'RECOVERY_RESERVATION_OR_BATCH_HISTORY_UNVERIFIED' using errcode = 'P0001';
    end if;
    if jsonb_array_length(p_batches) > 0 and v_projection <> v_stock then
      raise exception 'RECOVERY_PHYSICAL_PROJECTION_MISMATCH' using errcode = 'P0001';
    end if;
    if (v_stock > 0 or v_has_batch_stock) and (
      nullif(p_product->>'created_at', '') is null
      or exists (select 1 from jsonb_array_elements(p_batches) b where nullif(b->>'created_at', '') is null)
    ) then
      raise exception 'RECOVERY_OPENING_BALANCE_ORIGIN_REQUIRED' using errcode = 'P0001';
    end if;
    if (v_stock > 0 or v_has_batch_stock) and (
      p_product->'metadata'->'pharmacy'->>'kind' = 'medicine'
      or coalesce((p_product->>'requires_prescription')::boolean, false)
      or p_product->>'prescription_type' in ('controlled', 'antibiotic', 'prescription')
    ) then
      raise exception 'PHARMACY_DOCUMENTED_RECEIPT_REQUIRED' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.pos_product_batches b
      where b.license_id = v_license and (b.product_id = v_id or b.id in (
        select value->>'id' from jsonb_array_elements(p_batches)
      ))
    ) then
      raise exception 'RECOVERY_BATCH_ALREADY_EXISTS' using errcode = 'P0001';
    end if;

    v_result := public.pos_upsert_product(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      p_product, p_batches, 0, 'catalog-recovery-write:' || split_part(p_idempotency_key, ':', 2)
    );
    -- Some legacy business rejections are JSON and may occur after writes.
    -- Raise at this boundary so the entire group and its receipts roll back.
    if v_result->>'success' is distinct from 'true' then
      raise exception '%', coalesce(v_result->>'code', 'RECOVERY_WRITE_UNCONFIRMED') using errcode = 'P0001';
    end if;
    select * into strict v_parent from public.pos_products
      where license_id = v_license and id = v_id;
    if v_parent.last_idempotency_key is distinct from 'catalog-recovery-write:' || split_part(p_idempotency_key, ':', 2)
      or v_parent.cost is distinct from (p_product->>'cost')::numeric then
      raise exception 'RECOVERY_PARENT_CONFIRMATION_INVALID' using errcode = 'P0001';
    end if;
    v_created := true;
  end if;

  if v_parent.category_id is distinct from v_category or v_parent.stock is distinct from v_stock
    or v_parent.committed_stock is distinct from v_committed then
    raise exception 'RECOVERY_PARENT_PROJECTION_MISMATCH' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_batches) order by value->>'id' loop
    select * into v_batch from public.pos_product_batches
      where license_id = v_license and id = v_item->>'id' for update;
    if v_batch.id is null or v_batch.product_id is distinct from v_id or v_batch.deleted_at is not null
      or v_batch.stock is distinct from (v_item->>'stock')::numeric
      or v_batch.committed_stock is distinct from (v_item->>'committed_stock')::numeric
      or (not v_created and not v_replay and coalesce((v_item->>'server_version')::integer, 0) > 0
        and v_batch.server_version is distinct from (v_item->>'server_version')::integer)
      or (v_replay and v_batch.server_version is distinct from (
        select (saved->>'server_version')::integer
        from jsonb_array_elements(v_receipt.response_payload->'batches') saved
        where saved->>'id' = v_batch.id
      )) then
      raise exception 'RECOVERY_BATCH_CONFLICT:%', v_item->>'id' using errcode = 'P0001';
    end if;
    v_saved_batches := v_saved_batches || jsonb_build_array(private.pos_product_batch_to_jsonb(v_batch));
  end loop;
  if (select count(*) from public.pos_product_batches
      where license_id = v_license and product_id = v_id and deleted_at is null) <> jsonb_array_length(p_batches) then
    raise exception 'RECOVERY_BATCH_SET_MISMATCH' using errcode = 'P0001';
  end if;

  if v_replay then return v_receipt.response_payload; end if;
  v_result := jsonb_build_object(
    'success', true, 'outcome', case when v_created then 'created' else 'existing' end,
    'product', private.pos_product_to_jsonb(v_parent), 'batches', v_saved_batches,
    'idempotency_key', p_idempotency_key
  );
  perform private.complete_pos_idempotency(v_license, p_idempotency_key, v_result);
  return v_result;
end;
$$;

revoke all on function public.pos_recover_local_product_group_v1(text,text,text,text,jsonb,jsonb,text) from public, anon, authenticated, service_role;
grant execute on function public.pos_recover_local_product_group_v1(text,text,text,text,jsonb,jsonb,text) to anon, authenticated, service_role;

commit;
