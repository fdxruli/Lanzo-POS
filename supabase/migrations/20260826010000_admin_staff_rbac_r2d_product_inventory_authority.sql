-- ADMIN.STAFF.RBAC.R2D: independent server authority for POS product and inventory mutations.
-- Forward-only migration. Historical migrations remain unchanged.

create or replace function private.has_product_inventory_permission(
  p_context jsonb,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_context->>'actor_type' = 'admin' then true
    when p_context->>'actor_type' = 'staff'
      and jsonb_typeof(coalesce(p_context->'actor_permissions', '{}'::jsonb)) = 'object'
      and jsonb_typeof(coalesce(p_context->'actor_permissions'->p_permission, 'null'::jsonb)) = 'boolean'
      and (p_context->'actor_permissions'->p_permission) = 'true'::jsonb
      then true
    else false
  end;
$function$;

create or replace function private.validate_product_inventory_actor(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := public.validate_pos_rpc_rate_limit_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token
  );

  if coalesce((v_context->>'success')::boolean, false) is not true then
    raise exception '%', coalesce(v_context->>'code', 'ACTOR_CONTEXT_INVALID')
      using errcode = 'P0001';
  end if;

  return v_context;
end;
$function$;

create or replace function private.assert_product_actor_authority(p_context jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_product_inventory_permission(p_context, 'products') then
    raise exception 'POS_PERMISSION_DENIED:products.write' using errcode = 'P0001';
  end if;
end;
$function$;

create or replace function private.assert_inventory_actor_authority(p_context jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not private.has_product_inventory_permission(p_context, 'inventory') then
    raise exception 'POS_PERMISSION_DENIED:inventory.write' using errcode = 'P0001';
  end if;
end;
$function$;

revoke all on function private.has_product_inventory_permission(jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.validate_product_inventory_actor(text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.assert_product_actor_authority(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.assert_inventory_actor_authority(jsonb) from public, anon, authenticated, service_role;

alter function public.pos_upsert_category(text, text, text, text, jsonb, integer, text)
  rename to pos_upsert_category_legacy_r2d;
alter function public.pos_delete_category(text, text, text, text, text, integer, text)
  rename to pos_delete_category_legacy_r2d;
alter function public.pos_upsert_product(text, text, text, text, jsonb, jsonb, integer, text)
  rename to pos_upsert_product_legacy_r2d;
alter function public.pos_delete_product(text, text, text, text, text, integer, text)
  rename to pos_delete_product_legacy_r2d;
alter function public.pos_toggle_product_status(text, text, text, text, text, boolean, integer, text)
  rename to pos_toggle_product_status_legacy_r2d;
alter function public.pos_upsert_product_batch(text, text, text, text, jsonb, integer, text)
  rename to pos_upsert_product_batch_legacy_r2d;
alter function public.pos_delete_product_batch(text, text, text, text, text, integer, text)
  rename to pos_delete_product_batch_legacy_r2d;
alter function public.pos_migrate_local_product_catalog(text, text, text, text, jsonb, jsonb, jsonb, text)
  rename to pos_migrate_local_product_catalog_legacy_r2d;
create or replace function public.pos_upsert_category(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_category jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  return public.pos_upsert_category_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_category, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_delete_category(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_category_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  return public.pos_delete_category_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_category_id, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_upsert_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product jsonb default '{}'::jsonb,
  p_initial_batches jsonb default '[]'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  if jsonb_typeof(coalesce(p_initial_batches, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb)) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  if not exists (
    select 1 from public.pos_products existing
    where existing.license_id = (v_context->>'license_id')::uuid
      and existing.id = nullif(p_product->>'id', '')
      and existing.deleted_at is null
  ) and greatest(
    coalesce(nullif(p_product->>'stock', '')::numeric, 0),
    coalesce(nullif(p_product->>'committed_stock', '')::numeric, 0),
    coalesce(nullif(p_product->>'committedStock', '')::numeric, 0)
  ) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  return public.pos_upsert_product_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product, p_initial_batches, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_delete_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  perform private.assert_inventory_actor_authority(v_context);
  return public.pos_delete_product_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product_id, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_toggle_product_status(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_is_active boolean default true,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  return public.pos_toggle_product_status_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_product_id, p_is_active, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_upsert_product_batch(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_batch jsonb default '{}'::jsonb,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_inventory_actor_authority(v_context);
  return public.pos_upsert_product_batch_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_batch, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_delete_product_batch(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_batch_id text default null,
  p_expected_version integer default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_inventory_actor_authority(v_context);
  return public.pos_delete_product_batch_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_batch_id, p_expected_version, p_idempotency_key);
end;
$function$;

create or replace function public.pos_migrate_local_product_catalog(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_categories jsonb default '[]'::jsonb,
  p_products jsonb default '[]'::jsonb,
  p_batches jsonb default '[]'::jsonb,
  p_batch_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_product_actor_authority(v_context);
  if jsonb_typeof(coalesce(p_batches, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_batches, '[]'::jsonb)) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  if jsonb_typeof(coalesce(p_products, '[]'::jsonb)) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) as product_item(item)
      where not exists (
        select 1 from public.pos_products existing
        where existing.license_id = (v_context->>'license_id')::uuid
          and existing.id = nullif(product_item.item->>'id', '')
          and existing.deleted_at is null
      )
      and greatest(
        coalesce(nullif(product_item.item->>'stock', '')::numeric, 0),
        coalesce(nullif(product_item.item->>'committed_stock', '')::numeric, 0),
        coalesce(nullif(product_item.item->>'committedStock', '')::numeric, 0)
      ) > 0
    ) then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  return public.pos_migrate_local_product_catalog_legacy_r2d(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_categories, p_products, p_batches, p_batch_id);
end;
$function$;

revoke all on function public.pos_upsert_category(text, text, text, text, jsonb, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_upsert_category(text, text, text, text, jsonb, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_delete_category(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_delete_category(text, text, text, text, text, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_upsert_product(text, text, text, text, jsonb, jsonb, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_upsert_product(text, text, text, text, jsonb, jsonb, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_delete_product(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_delete_product(text, text, text, text, text, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_toggle_product_status(text, text, text, text, text, boolean, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_toggle_product_status(text, text, text, text, text, boolean, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_upsert_product_batch(text, text, text, text, jsonb, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_upsert_product_batch(text, text, text, text, jsonb, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_delete_product_batch(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_delete_product_batch(text, text, text, text, text, integer, text) to anon, authenticated, service_role;
revoke all on function public.pos_migrate_local_product_catalog(text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_migrate_local_product_catalog(text, text, text, text, jsonb, jsonb, jsonb, text) to anon, authenticated, service_role;

revoke all on function public.pos_upsert_category_legacy_r2d(text, text, text, text, jsonb, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_delete_category_legacy_r2d(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_upsert_product_legacy_r2d(text, text, text, text, jsonb, jsonb, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_delete_product_legacy_r2d(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_toggle_product_status_legacy_r2d(text, text, text, text, text, boolean, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_upsert_product_batch_legacy_r2d(text, text, text, text, jsonb, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_delete_product_batch_legacy_r2d(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.pos_migrate_local_product_catalog_legacy_r2d(text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated, service_role;
create or replace function public.pos_add_inventory_entry(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_batch_id text default null,
  p_quantity numeric default null,
  p_input_unit text default null,
  p_base_quantity numeric default null,
  p_base_unit text default null,
  p_unit_cost numeric default null,
  p_supplier text default null,
  p_manufacturer_batch_id text default null,
  p_expiry_date timestamptz default null,
  p_occurred_at timestamptz default null,
  p_entry_kind text default 'restock',
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rate_limit jsonb;
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product public.pos_products;
  v_batch public.pos_product_batches;
  v_saved_batch public.pos_product_batches;
  v_saved_product public.pos_products;
  v_movement public.pos_inventory_movements;
  v_event public.pos_sync_events;
  v_batch_event public.pos_sync_events;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_request jsonb;
  v_request_hash text;
  v_batch_id text;
  v_previous_stock numeric;
  v_new_stock numeric;
  v_previous_batch_stock numeric;
  v_new_batch_stock numeric;
  v_uses_batches boolean;
  v_is_variant boolean;
  v_has_variants boolean;
  v_response jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_add_inventory_entry', 'POS_WRITE', 60, 60, 60,
    'RPC_RATE_LIMITED', jsonb_build_object('operation', 'inventory_entry')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;

  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_KEY_REQUIRED', 'message', 'operationId es obligatorio.');
  end if;
  if nullif(btrim(coalesce(p_product_id, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto es obligatorio.');
  end if;
  if coalesce(p_quantity, 0) <= 0 or coalesce(p_base_quantity, 0) <= 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_QUANTITY', 'message', 'La cantidad debe ser mayor a cero.');
  end if;
  if abs(p_quantity - p_base_quantity) > 0.000001 then
    return jsonb_build_object('success', false, 'code', 'INVALID_UNIT_PRECISION', 'message', 'La conversión de unidades aún no está disponible.');
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    return jsonb_build_object('success', false, 'code', 'INVALID_UNIT_PRECISION', 'message', 'El costo no puede ser negativo.');
  end if;

  v_request := jsonb_build_object(
    'product_id', p_product_id, 'batch_id', p_batch_id, 'quantity', p_quantity,
    'input_unit', p_input_unit, 'base_quantity', p_base_quantity, 'base_unit', p_base_unit,
    'unit_cost', p_unit_cost, 'supplier', p_supplier, 'manufacturer_batch_id', p_manufacturer_batch_id,
    'expiry_date', p_expiry_date, 'occurred_at', p_occurred_at, 'entry_kind', p_entry_kind,
    'metadata', coalesce(p_metadata, '{}'::jsonb)
  );
  v_request_hash := md5(v_request::text);
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'inventory.entry', 'inventory_entry', p_product_id, v_request_hash);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key for update;
    if coalesce(v_idem.request_hash, '') <> v_request_hash then
      return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PAYLOAD_MISMATCH', 'message', 'operationId ya fue usado con otro payload.');
    end if;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operación ya está en proceso.');
  end if;

  select * into v_product from public.pos_products where license_id = v_license_id and id = p_product_id and deleted_at is null for update;
  if v_product.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if v_product.track_stock is false then
    v_response := jsonb_build_object('success', false, 'code', 'STOCK_TRACKING_DISABLED', 'message', 'El producto no administra existencias.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;
  if jsonb_typeof(coalesce(v_product.recipe, '[]'::jsonb)) = 'array' and jsonb_array_length(coalesce(v_product.recipe, '[]'::jsonb)) > 0 then
    v_response := jsonb_build_object('success', false, 'code', 'RECIPE_INVENTORY_ENTRY_NOT_ALLOWED', 'message', 'Los platillos con receta no admiten entradas directas.');
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
  end if;

  v_uses_batches := private.product_uses_batches(v_product);
  v_previous_stock := greatest(coalesce(v_product.stock, 0), 0);
  if v_uses_batches then
    select exists (
      select 1 from public.pos_product_batches b where b.license_id = v_license_id and b.product_id = v_product.id
        and b.deleted_at is null and b.attributes is not null and b.attributes <> '{}'::jsonb
    ) into v_has_variants;
    if v_has_variants and nullif(btrim(coalesce(p_batch_id, '')), '') is null then
      v_response := jsonb_build_object('success', false, 'code', 'VARIANT_REQUIRED', 'message', 'Este producto requiere seleccionar una variante.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    v_batch_id := nullif(btrim(coalesce(p_batch_id, '')), '');
    if v_batch_id is null then v_batch_id := 'batch-entry-' || regexp_replace(p_idempotency_key, '[^a-zA-Z0-9_-]', '-', 'g'); end if;
    select * into v_batch from public.pos_product_batches where license_id = v_license_id and id = v_batch_id and deleted_at is null for update;
    if v_batch.id is not null and v_batch.product_id <> v_product.id then
      v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'El lote no pertenece al producto.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_has_variants and (v_batch.id is null or v_batch.attributes is null or v_batch.attributes = '{}'::jsonb) then
      v_response := jsonb_build_object('success', false, 'code', 'VARIANT_NOT_FOUND', 'message', 'La variante seleccionada ya no existe.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_product.expiration_mode = 'STRICT' and v_batch.id is null and nullif(btrim(coalesce(p_manufacturer_batch_id, '')), '') is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_MANUFACTURER_BATCH_REQUIRED', 'message', 'Se requiere lote del fabricante.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    if v_product.expiration_mode = 'STRICT' and v_batch.id is null and p_expiry_date is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'Se requiere fecha de caducidad.');
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); return v_response;
    end if;
    v_previous_batch_stock := greatest(coalesce(v_batch.stock, 0), 0);
    v_new_batch_stock := v_previous_batch_stock + p_base_quantity;
    if v_batch.id is null then
      insert into public.pos_product_batches (id, license_id, product_id, stock, committed_stock, cost, price, track_stock, is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type, manufacturer_batch_id, supplier, attributes, notes, created_at, updated_at, server_version, created_by_device_id, updated_by_device_id, created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata)
      values (v_batch_id, v_license_id, v_product.id, v_new_batch_stock, 0, greatest(coalesce(p_unit_cost, v_product.cost, 0), 0), greatest(coalesce(v_product.price, 0), 0), true, true, 'active', 1, p_expiry_date, p_expiry_date, case when p_expiry_date is null then null else 'CADUCIDAD_LEGAL' end, nullif(btrim(coalesce(p_manufacturer_batch_id, '')), ''), nullif(btrim(coalesce(p_supplier, '')), ''), null, 'Entrada de inventario', coalesce(p_occurred_at, now()), now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry')) returning * into v_saved_batch;
    else
      update public.pos_product_batches set stock = v_new_batch_stock, cost = greatest(coalesce(p_unit_cost, cost, 0), 0), supplier = coalesce(nullif(btrim(coalesce(p_supplier, '')), ''), supplier), is_active = true, status = 'active', active_stock_status = 1, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_batch.id returning * into v_saved_batch;
    end if;
    v_saved_product := private.recalculate_pos_product_projection(v_license_id, v_product.id);
    v_new_stock := v_saved_product.stock;
    v_batch_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, case when v_batch.id is null then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_saved_batch.server_version);
  else
    v_new_stock := v_previous_stock + p_base_quantity;
    update public.pos_products set stock = v_new_stock, active_stock_status = case when is_active then 1 else 0 end, updated_at = now(), server_version = server_version + 1, updated_by_device_id = v_device_id, updated_by_staff_user_id = v_staff_user_id, last_idempotency_key = p_idempotency_key, metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('source', 'inventory_entry') where license_id = v_license_id and id = v_product.id returning * into v_saved_product;
  end if;

  v_movement := private.record_pos_inventory_movement(v_license_id, v_product.id, case when v_uses_batches then v_saved_batch.id else null end, null, null, 'manual_in', p_base_quantity, v_previous_stock, v_new_stock, case when v_uses_batches then v_previous_batch_stock else null end, case when v_uses_batches then v_new_batch_stock else null end, coalesce(p_unit_cost, v_saved_batch.cost, v_product.cost), coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inventory_entry', v_device_id, v_staff_user_id, private.resolve_cash_actor_key(v_context), private.resolve_cash_actor_name(v_context), p_idempotency_key, jsonb_build_object('entryKind', coalesce(nullif(btrim(p_entry_kind), ''), 'restock'), 'inputQuantity', p_quantity, 'inputUnit', p_input_unit, 'baseQuantity', p_base_quantity, 'baseUnit', p_base_unit) || coalesce(p_metadata, '{}'::jsonb));
  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'batch_id', case when v_uses_batches then v_saved_batch.id else null end), v_saved_product.server_version);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'inventory_entry', 'product_id', v_product.id), v_movement.server_version::integer);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved_product), 'batch', case when v_uses_batches then private.pos_product_batch_to_jsonb(v_saved_batch) else null end, 'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement), 'event', to_jsonb(v_event), 'batch_event', case when v_uses_batches then to_jsonb(v_batch_event) else null end, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.pos_register_expiration_waste(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_reason text DEFAULT 'caducidad'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_register_expiration_waste',
          p_scope := 'POS_WRITE',
          p_max_attempts := 120,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_register_expiration_waste_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9)::jsonb;
      END;
      $function$;

create or replace function public.pos_create_product_batch_from_parent_stock(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_quantity numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_create_product_batch_from_parent_stock',
          p_scope := 'POS_WRITE',
          p_max_attempts := 120,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_create_product_batch_from_parent_stock_unlimited($1, $2, $3, $4, $5, $6, $7, $8, $9)::jsonb;
      END;
      $function$;

create or replace function public.pos_adjust_product_stock_without_batch_zero(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_reason text DEFAULT 'regularizacion_stock_sin_lote'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
      DECLARE
        v_rate_limit jsonb;
      BEGIN
        v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
          p_license_key := $1,
          p_device_fingerprint := $2,
          p_staff_session_token := $4,
          p_rpc_name := 'pos_adjust_product_stock_without_batch_zero',
          p_scope := 'POS_WRITE',
          p_max_attempts := 120,
          p_window_seconds := 600,
          p_block_seconds := 300,
          p_code := 'RPC_RATE_LIMITED',
          p_metadata := '{}'::jsonb
        );

        IF COALESCE((v_rate_limit->>'allowed')::boolean, false) IS FALSE THEN
          RETURN public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
        END IF;

        RETURN public.pos_adjust_product_stock_without_batch_zero_unlimited($1, $2, $3, $4, $5, $6, $7, $8)::jsonb;
      END;
      $function$;
revoke all on function public.pos_add_inventory_entry(text, text, text, text, text, text, numeric, text, numeric, text, numeric, text, text, timestamptz, timestamptz, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_add_inventory_entry(text, text, text, text, text, text, numeric, text, numeric, text, numeric, text, text, timestamptz, timestamptz, text, jsonb, text) to anon, authenticated, service_role;
revoke all on function public.pos_register_expiration_waste(text, text, text, text, text, numeric, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_register_expiration_waste(text, text, text, text, text, numeric, text, text, text) to anon, authenticated, service_role;
revoke all on function public.pos_create_product_batch_from_parent_stock(text, text, text, text, text, timestamptz, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_create_product_batch_from_parent_stock(text, text, text, text, text, timestamptz, numeric, text, text) to anon, authenticated, service_role;
revoke all on function public.pos_adjust_product_stock_without_batch_zero(text, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_adjust_product_stock_without_batch_zero(text, text, text, text, text, text, text, text) to anon, authenticated, service_role;


-- CLOSEOUT.R2: authoritative *_unlimited paths validate the current actor and exact R2D authority.

create or replace function public.pos_upsert_category_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_category jsonb DEFAULT '{}'::jsonb, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_category_id text;
  v_name text;
  v_name_key text;
  v_existing public.pos_categories;
  v_saved public.pos_categories;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  v_category_id := nullif(btrim(coalesce(p_category->>'id', '')), '');
  if v_category_id is null then
    raise exception 'CATEGORY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_name := nullif(btrim(coalesce(p_category->>'name', '')), '');
  if v_name is null then
    raise exception 'CATEGORY_NAME_REQUIRED' using errcode = 'P0001';
  end if;
  v_name_key := private.normalize_pos_product_name_key(v_name);

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'category.upsert', 'category', v_category_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then
      return v_idem.response_payload;
    end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_categories where license_id = v_license_id and id = v_category_id for update;
  v_is_create := v_existing.id is null;

  if not v_is_create then
    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
      values (v_license_id, 'category', v_category_id, 'VERSION_CONFLICT', p_category, private.pos_category_to_jsonb(v_existing), v_device_id, v_staff_user_id);
      v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La categoria fue modificada en otro dispositivo.', 'category', private.pos_category_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  if exists (
    select 1 from public.pos_categories c
    where c.license_id = v_license_id
      and c.name_key = v_name_key
      and c.deleted_at is null
      and c.id <> v_category_id
  ) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_CATEGORY_NAME', 'message', 'Ya existe una categoria activa con este nombre.', 'field', 'name', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_create then
    insert into public.pos_categories (
      id, license_id, name, name_key, color, sort_order, is_active,
      created_at, updated_at, server_version,
      created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id,
      last_idempotency_key, metadata
    ) values (
      v_category_id, v_license_id, v_name, v_name_key,
      nullif(btrim(coalesce(p_category->>'color', '')), ''),
      coalesce(nullif(p_category->>'sort_order', '')::integer, nullif(p_category->>'sortOrder', '')::integer, 0),
      coalesce(nullif(p_category->>'is_active', '')::boolean, nullif(p_category->>'isActive', '')::boolean, true),
      coalesce(nullif(p_category->>'created_at', '')::timestamptz, nullif(p_category->>'createdAt', '')::timestamptz, now()),
      now(), 1,
      v_device_id, v_device_id,
      v_staff_user_id, v_staff_user_id,
      p_idempotency_key,
      coalesce(p_category->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    ) returning * into v_saved;
  else
    update public.pos_categories
    set name = v_name,
        name_key = v_name_key,
        color = nullif(btrim(coalesce(p_category->>'color', color, '')), ''),
        sort_order = coalesce(nullif(p_category->>'sort_order', '')::integer, nullif(p_category->>'sortOrder', '')::integer, sort_order),
        is_active = coalesce(nullif(p_category->>'is_active', '')::boolean, nullif(p_category->>'isActive', '')::boolean, is_active),
        deleted_at = null,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_category->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    where license_id = v_license_id and id = v_category_id
    returning * into v_saved;
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'category', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_category'), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'category', private.pos_category_to_jsonb(v_saved), 'event', to_jsonb(v_event), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_CATEGORY_NAME', 'message', 'Ya existe una categoria activa con este nombre.', 'field', 'name', 'idempotency_key', p_idempotency_key);
    if v_license_id is not null and p_idempotency_key is not null then
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    end if;
    return v_response;
end;
$function$;

create or replace function public.pos_delete_category_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_category_id text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_categories;
  v_saved public.pos_categories;
  v_product public.pos_products;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_affected integer := 0;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_category_id, '')), '') is null then
    raise exception 'CATEGORY_ID_REQUIRED' using errcode = 'P0001';
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'category.delete', 'category', p_category_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_categories where license_id = v_license_id and id = p_category_id for update;
  if v_existing.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'CATEGORY_NOT_FOUND', 'message', 'La categoria no existe.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'category', p_category_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version), private.pos_category_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'La categoria fue modificada en otro dispositivo.', 'category', private.pos_category_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_categories
  set deleted_at = coalesce(deleted_at, now()),
      is_active = false,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_by_phase', 'fase2_products_catalog')
  where license_id = v_license_id and id = p_category_id
  returning * into v_saved;

  for v_product in
    update public.pos_products
    set category_id = null,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('category_deleted_id', p_category_id)
    where license_id = v_license_id
      and category_id = p_category_id
      and deleted_at is null
    returning *
  loop
    v_affected := v_affected + 1;
    v_event := private.record_pos_sync_event(v_license_id, 'product', v_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_category', 'cascade', 'category_null'), v_product.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
  end loop;

  v_event := private.record_pos_sync_event(v_license_id, 'category', v_saved.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_category', 'affected_products', v_affected), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'category', private.pos_category_to_jsonb(v_saved), 'affected_products', v_affected, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

create or replace function public.pos_upsert_product_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product jsonb DEFAULT '{}'::jsonb, p_initial_batches jsonb DEFAULT '[]'::jsonb, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product_id text;
  v_category_id text;
  v_name text;
  v_name_key text;
  v_barcode text;
  v_barcode_key text;
  v_sku text;
  v_sku_key text;
  v_product_type text;
  v_sale_type text;
  v_expiration_mode text;
  v_shelf_life_value numeric;
  v_shelf_life_unit text;
  v_price numeric;
  v_cost numeric;
  v_stock numeric;
  v_committed_stock numeric;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_saved_batch public.pos_product_batches;
  v_batch_item jsonb;
  v_batch_id text;
  v_batch_sku text;
  v_batch_sku_key text;
  v_batch_stock numeric;
  v_batch_cost numeric;
  v_batch_price numeric;
  v_batch_status text;
  v_batch_created_at timestamptz;
  v_batch_expiry_date timestamptz;
  v_batch_alert_target_date timestamptz;
  v_batch_alert_type text;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
  v_has_initial_batches boolean := false;
  v_search_tokens text[];
  v_search_ngrams text[];
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);
  if jsonb_typeof(coalesce(p_initial_batches, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb)) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  if not exists (
    select 1 from public.pos_products existing
    where existing.license_id = (v_context->>'license_id')::uuid
      and existing.id = nullif(p_product->>'id', '')
      and existing.deleted_at is null
  ) and greatest(
    coalesce(nullif(p_product->>'stock', '')::numeric, 0),
    coalesce(nullif(p_product->>'committed_stock', '')::numeric, 0),
    coalesce(nullif(p_product->>'committedStock', '')::numeric, 0)
  ) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if coalesce(jsonb_typeof(p_initial_batches), 'array') <> 'array' then
    raise exception 'INITIAL_BATCHES_ARRAY_REQUIRED' using errcode = 'P0001';
  end if;
  v_has_initial_batches := jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb)) > 0;

  v_product_id := nullif(btrim(coalesce(p_product->>'id', '')), '');
  if v_product_id is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  v_name := nullif(btrim(coalesce(p_product->>'name', '')), '');
  if v_name is null then raise exception 'PRODUCT_NAME_REQUIRED' using errcode = 'P0001'; end if;
  v_name_key := private.normalize_pos_product_name_key(v_name);

  v_category_id := nullif(btrim(coalesce(p_product->>'category_id', p_product->>'categoryId', '')), '');
  if v_category_id is not null and not exists (
    select 1 from public.pos_categories c where c.license_id = v_license_id and c.id = v_category_id and c.deleted_at is null
  ) then
    v_category_id := null;
  end if;

  v_barcode := nullif(btrim(coalesce(p_product->>'barcode', '')), '');
  v_barcode_key := private.normalize_pos_barcode_key(coalesce(p_product->>'barcode_key', p_product->>'barcodeKey', v_barcode));
  v_sku := nullif(btrim(coalesce(p_product->>'sku', '')), '');
  v_sku_key := private.normalize_pos_sku_key(coalesce(p_product->>'sku_key', p_product->>'skuKey', v_sku));
  v_product_type := lower(coalesce(nullif(p_product->>'product_type', ''), nullif(p_product->>'productType', ''), 'sellable'));
  v_sale_type := lower(coalesce(nullif(p_product->>'sale_type', ''), nullif(p_product->>'saleType', ''), 'unit'));
  v_expiration_mode := upper(coalesce(nullif(p_product->>'expiration_mode', ''), nullif(p_product->>'expirationMode', ''), 'NONE'));
  if v_product_type not in ('sellable','ingredient') then raise exception 'INVALID_PRODUCT_TYPE' using errcode = 'P0001'; end if;
  if v_sale_type not in ('unit','bulk') then raise exception 'INVALID_SALE_TYPE' using errcode = 'P0001'; end if;
  if v_expiration_mode not in ('STRICT','SHELF_LIFE','NONE') then raise exception 'INVALID_EXPIRATION_MODE' using errcode = 'P0001'; end if;

  v_shelf_life_value := nullif(coalesce(p_product->>'shelf_life_value', p_product->>'shelfLifeValue', ''), '')::numeric;
  v_shelf_life_unit := nullif(btrim(coalesce(p_product->>'shelf_life_unit', p_product->>'shelfLifeUnit', '')), '');
  v_price := greatest(coalesce(nullif(p_product->>'price', '')::numeric, 0), 0);
  v_cost := greatest(coalesce(nullif(p_product->>'cost', '')::numeric, 0), 0);
  v_stock := greatest(coalesce(nullif(p_product->>'stock', '')::numeric, 0), 0);
  v_committed_stock := greatest(coalesce(nullif(p_product->>'committed_stock', '')::numeric, nullif(p_product->>'committedStock', '')::numeric, 0), 0);

  if jsonb_typeof(p_product->'search_tokens') = 'array' then
    select array(select jsonb_array_elements_text(p_product->'search_tokens')) into v_search_tokens;
  else
    v_search_tokens := null;
  end if;
  if jsonb_typeof(p_product->'search_ngrams') = 'array' then
    select array(select jsonb_array_elements_text(p_product->'search_ngrams')) into v_search_ngrams;
  else
    v_search_ngrams := null;
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.upsert', 'product', v_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = v_product_id for update;
  v_is_create := v_existing.id is null;

  if not v_is_create and v_has_initial_batches then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'INITIAL_BATCHES_CREATE_ONLY',
      'message', 'Los lotes iniciales solo se permiten al crear un producto. Edita las variantes mediante el catálogo de lotes.',
      'field', 'initialBatches',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;


  if v_is_create
    and v_stock > 0
    and v_has_initial_batches is not true
    and (
      v_expiration_mode in ('STRICT','SHELF_LIFE')
      or (
        jsonb_typeof(coalesce(p_product->'batch_management', p_product->'batchManagement')) = 'boolean'
        and coalesce(p_product->'batch_management', p_product->'batchManagement') = 'true'::jsonb
      )
      or (
        jsonb_typeof(coalesce(p_product->'batch_management', p_product->'batchManagement')) = 'object'
        and (
          lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'enabled', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'batchManagement', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'manageBatches', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'useBatches', '')) in ('true','1','yes','si','sí','enabled','active')
          or lower(coalesce(coalesce(p_product->'batch_management', p_product->'batchManagement')->>'mode', '')) in ('batch','batches','lote','lotes','fefo')
        )
      )
    )
  then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'INITIAL_BATCH_REQUIRED_FOR_EXPIRING_PRODUCT',
      'message', 'No se puede guardar stock inicial sin lote para productos con caducidad. Crea un lote inicial o guarda el producto sin stock.',
      'field', 'initialBatches',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if not v_is_create then
    if v_existing.deleted_at is not null then
      v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_DELETED', 'message', 'El producto ya fue eliminado.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
    if p_expected_version is not null and p_expected_version <> v_existing.server_version then
      insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
      values (v_license_id, 'product', v_product_id, 'VERSION_CONFLICT', p_product, private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
      v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;
  end if;

  if v_expiration_mode = 'SHELF_LIFE'
    and v_has_initial_batches
    and coalesce(v_shelf_life_value, v_existing.shelf_life_value, 0) <= 0
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_initial_batches, '[]'::jsonb)) as pre_batch(value)
      where greatest(coalesce(nullif(pre_batch.value->>'stock', '')::numeric, 0), 0) > 0
        and nullif(pre_batch.value->>'expiry_date', '') is null
        and nullif(pre_batch.value->>'expiryDate', '') is null
        and nullif(pre_batch.value->>'alert_target_date', '') is null
        and nullif(pre_batch.value->>'alertTargetDate', '') is null
    )
  then
    v_response := jsonb_build_object(
      'success', false,
      'code', 'SHELF_LIFE_VALUE_REQUIRED',
      'message', 'Indica una vida util valida para crear inventario con caducidad estimada.',
      'field', 'shelfLifeValue',
      'idempotency_key', p_idempotency_key
    );
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_barcode_key is not null and exists (select 1 from public.pos_products p where p.license_id = v_license_id and p.barcode_key = v_barcode_key and p.deleted_at is null and p.id <> v_product_id) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_BARCODE', 'message', 'El codigo de barras ya esta registrado en otro producto.', 'field', 'barcode', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_sku_key is not null and exists (select 1 from public.pos_products p where p.license_id = v_license_id and p.sku_key = v_sku_key and p.deleted_at is null and p.id <> v_product_id) then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_SKU', 'message', 'El SKU ya esta registrado en otro producto.', 'field', 'sku', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if v_is_create then
    insert into public.pos_products (
      id, license_id, category_id, name, name_key, description, barcode, barcode_key, sku, sku_key,
      image_ref, image_url, location, price, cost, stock, committed_stock, min_stock, max_stock,
      track_stock, is_active, product_type, sale_type, bulk_data, conversion_factor, batch_management,
      recipe, modifiers, wholesale_tiers, prescription_type, active_substance, laboratory,
      requires_prescription, presentation, expiration_mode, shelf_life_value, shelf_life_unit,
      search_tokens, search_ngrams, low_stock_alert_status, active_stock_status,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_product_id, v_license_id, v_category_id, v_name, v_name_key,
      nullif(btrim(coalesce(p_product->>'description', '')), ''), v_barcode, v_barcode_key, v_sku, v_sku_key,
      nullif(btrim(coalesce(p_product->>'image_ref', p_product->>'imageRef', p_product->>'image', '')), ''),
      nullif(btrim(coalesce(p_product->>'image_url', p_product->>'imageUrl', '')), ''),
      nullif(btrim(coalesce(p_product->>'location', '')), ''),
      v_price, v_cost,
      case when v_has_initial_batches then 0 else v_stock end,
      case when v_has_initial_batches then 0 else v_committed_stock end,
      nullif(p_product->>'min_stock', '')::numeric,
      nullif(p_product->>'max_stock', '')::numeric,
      coalesce(nullif(p_product->>'track_stock', '')::boolean, nullif(p_product->>'trackStock', '')::boolean, true),
      coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, true),
      v_product_type, v_sale_type, p_product->'bulk_data', p_product->'conversion_factor', p_product->'batch_management',
      p_product->'recipe', p_product->'modifiers', p_product->'wholesale_tiers',
      nullif(btrim(coalesce(p_product->>'prescription_type', p_product->>'prescriptionType', '')), ''),
      nullif(btrim(coalesce(p_product->>'active_substance', p_product->>'activeSubstance', '')), ''),
      nullif(btrim(coalesce(p_product->>'laboratory', '')), ''),
      coalesce(nullif(p_product->>'requires_prescription', '')::boolean, nullif(p_product->>'requiresPrescription', '')::boolean, null),
      nullif(btrim(coalesce(p_product->>'presentation', '')), ''),
      v_expiration_mode,
      v_shelf_life_value,
      v_shelf_life_unit,
      v_search_tokens, v_search_ngrams,
      nullif(btrim(coalesce(p_product->>'low_stock_alert_status', p_product->>'lowStockAlertStatus', '')), ''),
      case when coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, true) and (case when v_has_initial_batches then 0 else v_stock end) > 0 then 1 else 0 end,
      coalesce(nullif(p_product->>'created_at', '')::timestamptz, nullif(p_product->>'createdAt', '')::timestamptz, now()),
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(p_product->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'images_cloud', false)
    ) returning * into v_saved;
  else
    update public.pos_products
    set category_id = v_category_id,
        name = v_name,
        name_key = v_name_key,
        description = nullif(btrim(coalesce(p_product->>'description', description, '')), ''),
        barcode = v_barcode,
        barcode_key = v_barcode_key,
        sku = v_sku,
        sku_key = v_sku_key,
        image_ref = nullif(btrim(coalesce(p_product->>'image_ref', p_product->>'imageRef', p_product->>'image', image_ref, '')), ''),
        image_url = nullif(btrim(coalesce(p_product->>'image_url', p_product->>'imageUrl', image_url, '')), ''),
        location = nullif(btrim(coalesce(p_product->>'location', location, '')), ''),
        price = v_price,
        cost = v_cost,
        min_stock = coalesce(nullif(p_product->>'min_stock', '')::numeric, nullif(p_product->>'minStock', '')::numeric, min_stock),
        max_stock = coalesce(nullif(p_product->>'max_stock', '')::numeric, nullif(p_product->>'maxStock', '')::numeric, max_stock),
        track_stock = coalesce(nullif(p_product->>'track_stock', '')::boolean, nullif(p_product->>'trackStock', '')::boolean, track_stock),
        is_active = coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, is_active),
        product_type = v_product_type,
        sale_type = v_sale_type,
        bulk_data = coalesce(p_product->'bulk_data', bulk_data),
        conversion_factor = coalesce(p_product->'conversion_factor', conversion_factor),
        batch_management = coalesce(p_product->'batch_management', batch_management),
        recipe = coalesce(p_product->'recipe', recipe),
        modifiers = coalesce(p_product->'modifiers', modifiers),
        wholesale_tiers = coalesce(p_product->'wholesale_tiers', wholesale_tiers),
        prescription_type = nullif(btrim(coalesce(p_product->>'prescription_type', p_product->>'prescriptionType', prescription_type, '')), ''),
        active_substance = nullif(btrim(coalesce(p_product->>'active_substance', p_product->>'activeSubstance', active_substance, '')), ''),
        laboratory = nullif(btrim(coalesce(p_product->>'laboratory', laboratory, '')), ''),
        requires_prescription = coalesce(nullif(p_product->>'requires_prescription', '')::boolean, nullif(p_product->>'requiresPrescription', '')::boolean, requires_prescription),
        presentation = nullif(btrim(coalesce(p_product->>'presentation', presentation, '')), ''),
        expiration_mode = v_expiration_mode,
        shelf_life_value = coalesce(v_shelf_life_value, shelf_life_value),
        shelf_life_unit = nullif(btrim(coalesce(p_product->>'shelf_life_unit', p_product->>'shelfLifeUnit', shelf_life_unit, '')), ''),
        search_tokens = coalesce(v_search_tokens, search_tokens),
        search_ngrams = coalesce(v_search_ngrams, search_ngrams),
        low_stock_alert_status = nullif(btrim(coalesce(p_product->>'low_stock_alert_status', p_product->>'lowStockAlertStatus', low_stock_alert_status, '')), ''),
        active_stock_status = case when coalesce(nullif(p_product->>'is_active', '')::boolean, nullif(p_product->>'isActive', '')::boolean, is_active) and stock > 0 and deleted_at is null then 1 else 0 end,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_product->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'stock_not_mutated_by_catalog_edit', true)
    where license_id = v_license_id and id = v_product_id
    returning * into v_saved;
  end if;

  for v_batch_item in select value from jsonb_array_elements(coalesce(p_initial_batches, '[]'::jsonb)) loop
    v_batch_id := nullif(btrim(coalesce(v_batch_item->>'id', '')), '');
    if v_batch_id is null then
      v_batch_id := 'batch-' || gen_random_uuid()::text;
    end if;

    if exists (select 1 from public.pos_product_batches b where b.license_id = v_license_id and b.id = v_batch_id) then
      v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_BATCH_ID', 'message', 'El lote inicial ya existe y no se sobreescribira desde catalogo.', 'field', 'batch.id', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if nullif(btrim(coalesce(v_batch_item->>'product_id', v_batch_item->>'productId', v_product_id)), '') <> v_product_id then
      v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'Un lote inicial no pertenece al producto.', 'field', 'productId', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    v_batch_stock := greatest(coalesce(nullif(v_batch_item->>'stock', '')::numeric, 0), 0);
    v_batch_created_at := coalesce(nullif(v_batch_item->>'created_at', '')::timestamptz, nullif(v_batch_item->>'createdAt', '')::timestamptz, now());
    v_batch_expiry_date := coalesce(nullif(v_batch_item->>'expiry_date', '')::timestamptz, nullif(v_batch_item->>'expiryDate', '')::timestamptz, null);
    v_batch_alert_target_date := coalesce(nullif(v_batch_item->>'alert_target_date', '')::timestamptz, nullif(v_batch_item->>'alertTargetDate', '')::timestamptz, v_batch_expiry_date);
    v_batch_alert_type := nullif(btrim(coalesce(v_batch_item->>'alert_type', v_batch_item->>'alertType', '')), '');

    if v_expiration_mode = 'STRICT' and v_batch_stock > 0 and v_batch_expiry_date is null then
      v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'El modo estricto requiere caducidad para lotes con stock.', 'field', 'expiryDate', 'idempotency_key', p_idempotency_key);
      perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
      return v_response;
    end if;

    if v_expiration_mode = 'SHELF_LIFE' and v_batch_stock > 0 then
      if v_batch_expiry_date is null and v_batch_alert_target_date is null then
        v_batch_expiry_date := private.calculate_pos_shelf_life_target(v_batch_created_at, v_saved.shelf_life_value, v_saved.shelf_life_unit);
        if v_batch_expiry_date is null then
          v_response := jsonb_build_object('success', false, 'code', 'SHELF_LIFE_VALUE_REQUIRED', 'message', 'Indica una vida util valida para crear inventario con caducidad estimada.', 'field', 'shelfLifeValue', 'idempotency_key', p_idempotency_key);
          perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
          return v_response;
        end if;
        v_batch_alert_target_date := v_batch_expiry_date;
        v_batch_alert_type := 'VIDA_UTIL_ESTIMADA';
      else
        v_batch_expiry_date := coalesce(v_batch_expiry_date, v_batch_alert_target_date);
        v_batch_alert_target_date := coalesce(v_batch_alert_target_date, v_batch_expiry_date);
      end if;
    end if;

    v_batch_cost := greatest(coalesce(nullif(v_batch_item->>'cost', '')::numeric, v_cost, 0), 0);
    v_batch_price := greatest(coalesce(nullif(v_batch_item->>'price', '')::numeric, v_price, 0), 0);
    v_batch_sku := nullif(btrim(coalesce(v_batch_item->>'sku', '')), '');
    v_batch_sku_key := private.normalize_pos_sku_key(coalesce(v_batch_item->>'sku_key', v_batch_item->>'skuKey', v_batch_sku));
    v_batch_status := lower(coalesce(nullif(v_batch_item->>'status', ''), 'active'));
    if v_batch_status not in ('active','inactive','archived') then v_batch_status := 'active'; end if;

    insert into public.pos_product_batches (
      id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price, track_stock,
      is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type,
      manufacturer_batch_id, supplier, attributes, location, notes, update_global_price,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_batch_id, v_license_id, v_product_id, v_batch_sku, v_batch_sku_key, v_batch_stock,
      greatest(coalesce(nullif(v_batch_item->>'committed_stock', '')::numeric, nullif(v_batch_item->>'committedStock', '')::numeric, 0), 0),
      v_batch_cost, v_batch_price,
      coalesce(nullif(v_batch_item->>'track_stock', '')::boolean, nullif(v_batch_item->>'trackStock', '')::boolean, true),
      coalesce(nullif(v_batch_item->>'is_active', '')::boolean, nullif(v_batch_item->>'isActive', '')::boolean, true),
      v_batch_status,
      case when coalesce(nullif(v_batch_item->>'is_active', '')::boolean, nullif(v_batch_item->>'isActive', '')::boolean, true) and v_batch_status = 'active' and v_batch_stock > 0 then 1 else 0 end,
      v_batch_expiry_date,
      v_batch_alert_target_date,
      v_batch_alert_type,
      nullif(btrim(coalesce(v_batch_item->>'manufacturer_batch_id', v_batch_item->>'manufacturerBatchId', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'supplier', '')), ''),
      v_batch_item->'attributes',
      nullif(btrim(coalesce(v_batch_item->>'location', p_product->>'location', '')), ''),
      nullif(btrim(coalesce(v_batch_item->>'notes', 'Stock inicial')), ''),
      coalesce(nullif(v_batch_item->>'update_global_price', '')::boolean, nullif(v_batch_item->>'updateGlobalPrice', '')::boolean, false),
      v_batch_created_at,
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(v_batch_item->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog', 'source', 'initial_batch')
    ) returning * into v_saved_batch;

    v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, 'create', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product.initial_batches', 'product_id', v_product_id), v_saved_batch.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
    v_batches := v_batches || jsonb_build_array(private.pos_product_batch_to_jsonb(v_saved_batch));
  end loop;

  if v_has_initial_batches then
    v_saved := private.recalculate_pos_product_projection(v_license_id, v_product_id);
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product', 'initial_batches_count', jsonb_array_length(coalesce(p_initial_batches, '[]'::jsonb))), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'batches', v_batches, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
exception
  when unique_violation then
    v_response := jsonb_build_object('success', false, 'code', 'DUPLICATE_PRODUCT_KEY', 'message', 'Codigo de barras o SKU duplicado.', 'idempotency_key', p_idempotency_key);
    if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response); end if;
    return v_response;
end;
$function$;

create or replace function public.pos_delete_product_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_batch public.pos_product_batches;
  v_event public.pos_sync_events;
  v_events jsonb := '[]'::jsonb;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_batch_count integer := 0;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);
  perform private.assert_inventory_actor_authority(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_product_id, '')), '') is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.delete', 'product', p_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = p_product_id for update;
  if v_existing.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product', p_product_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version), private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  for v_batch in
    update public.pos_product_batches
    set deleted_at = coalesce(deleted_at, now()),
        is_active = false,
        status = 'archived',
        active_stock_status = 0,
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_with_product', p_product_id)
    where license_id = v_license_id
      and product_id = p_product_id
      and deleted_at is null
    returning *
  loop
    v_batch_count := v_batch_count + 1;
    v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_batch.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product', 'product_id', p_product_id), v_batch.server_version);
    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
  end loop;

  update public.pos_products
  set deleted_at = coalesce(deleted_at, now()),
      is_active = false,
      active_stock_status = 0,
      barcode_key = null,
      sku_key = null,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deleted_by_phase', 'fase2_products_catalog')
  where license_id = v_license_id and id = p_product_id
  returning * into v_saved;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product', 'batches_archived', v_batch_count), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'batches_archived', v_batch_count, 'events', v_events || jsonb_build_array(to_jsonb(v_event)), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

create or replace function public.pos_toggle_product_status_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_is_active boolean DEFAULT true, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_products;
  v_saved public.pos_products;
  v_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_product_id, '')), '') is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product.toggle_status', 'product', p_product_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_products where license_id = v_license_id and id = p_product_id for update;
  if v_existing.id is null or v_existing.deleted_at is not null then
    v_response := jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;
  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product', p_product_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'toggle_status', 'expected_version', p_expected_version), private.pos_product_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El producto fue modificado en otro dispositivo.', 'product', private.pos_product_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_products
  set is_active = coalesce(p_is_active, true),
      active_stock_status = case when coalesce(p_is_active, true) and stock > 0 and deleted_at is null then 1 else 0 end,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key
  where license_id = v_license_id and id = p_product_id
  returning * into v_saved;

  v_event := private.record_pos_sync_event(v_license_id, 'product', v_saved.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_toggle_product_status'), v_saved.server_version);
  v_response := jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved), 'event', to_jsonb(v_event), 'server_version', v_saved.server_version, 'change_seq', v_event.change_seq, 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

create or replace function public.pos_upsert_product_batch_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_batch jsonb DEFAULT '{}'::jsonb, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_batch_id text;
  v_product_id text;
  v_parent public.pos_products;
  v_existing public.pos_product_batches;
  v_saved public.pos_product_batches;
  v_saved_product public.pos_products;
  v_event public.pos_sync_events;
  v_product_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
  v_is_create boolean;
  v_stock numeric;
  v_status text;
  v_sku text;
  v_sku_key text;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  v_batch_id := nullif(btrim(coalesce(p_batch->>'id', '')), '');
  if v_batch_id is null then raise exception 'BATCH_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_product_id := nullif(btrim(coalesce(p_batch->>'product_id', p_batch->>'productId', '')), '');
  if v_product_id is null then raise exception 'PRODUCT_ID_REQUIRED' using errcode = 'P0001'; end if;

  select * into v_parent from public.pos_products where license_id = v_license_id and id = v_product_id for update;
  if v_parent.id is null or v_parent.deleted_at is not null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto padre no existe o fue eliminado.', 'idempotency_key', p_idempotency_key);
  end if;

  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product_batch.upsert', 'product_batch', v_batch_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_product_batches where license_id = v_license_id and id = v_batch_id for update;
  v_is_create := v_existing.id is null;
  if not v_is_create and v_existing.product_id <> v_product_id then
    v_response := jsonb_build_object('success', false, 'code', 'BATCH_PRODUCT_MISMATCH', 'message', 'No se puede mover un lote a otro producto.', 'field', 'productId', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;
  if not v_is_create and p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product_batch', v_batch_id, 'VERSION_CONFLICT', p_batch, private.pos_product_batch_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El lote fue modificado en otro dispositivo.', 'batch', private.pos_product_batch_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_stock := greatest(coalesce(nullif(p_batch->>'stock', '')::numeric, 0), 0);
  if v_parent.expiration_mode = 'STRICT' and v_stock > 0 and (nullif(p_batch->>'expiry_date', '') is null and nullif(p_batch->>'expiryDate', '') is null) then
    v_response := jsonb_build_object('success', false, 'code', 'STRICT_EXPIRY_REQUIRED', 'message', 'El modo estricto requiere caducidad para lotes con stock.', 'field', 'expiryDate', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  v_sku := nullif(btrim(coalesce(p_batch->>'sku', '')), '');
  v_sku_key := private.normalize_pos_sku_key(coalesce(p_batch->>'sku_key', p_batch->>'skuKey', v_sku));
  v_status := lower(coalesce(nullif(p_batch->>'status', ''), v_existing.status, 'active'));
  if v_status not in ('active','inactive','archived') then v_status := 'active'; end if;

  if v_is_create then
    insert into public.pos_product_batches (
      id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price, track_stock,
      is_active, status, active_stock_status, expiry_date, alert_target_date, alert_type,
      manufacturer_batch_id, supplier, attributes, location, notes, update_global_price,
      created_at, updated_at, server_version, created_by_device_id, updated_by_device_id,
      created_by_staff_user_id, updated_by_staff_user_id, last_idempotency_key, metadata
    ) values (
      v_batch_id, v_license_id, v_product_id, v_sku, v_sku_key, v_stock,
      greatest(coalesce(nullif(p_batch->>'committed_stock', '')::numeric, nullif(p_batch->>'committedStock', '')::numeric, 0), 0),
      greatest(coalesce(nullif(p_batch->>'cost', '')::numeric, v_parent.cost, 0), 0),
      greatest(coalesce(nullif(p_batch->>'price', '')::numeric, v_parent.price, 0), 0),
      coalesce(nullif(p_batch->>'track_stock', '')::boolean, nullif(p_batch->>'trackStock', '')::boolean, true),
      coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, true),
      v_status,
      case when coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, true) and v_status = 'active' and v_stock > 0 then 1 else 0 end,
      coalesce(nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, null),
      coalesce(nullif(p_batch->>'alert_target_date', '')::timestamptz, nullif(p_batch->>'alertTargetDate', '')::timestamptz, nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, null),
      nullif(btrim(coalesce(p_batch->>'alert_type', p_batch->>'alertType', '')), ''),
      nullif(btrim(coalesce(p_batch->>'manufacturer_batch_id', p_batch->>'manufacturerBatchId', '')), ''),
      nullif(btrim(coalesce(p_batch->>'supplier', '')), ''),
      p_batch->'attributes',
      nullif(btrim(coalesce(p_batch->>'location', v_parent.location, '')), ''),
      nullif(btrim(coalesce(p_batch->>'notes', '')), ''),
      coalesce(nullif(p_batch->>'update_global_price', '')::boolean, nullif(p_batch->>'updateGlobalPrice', '')::boolean, false),
      coalesce(nullif(p_batch->>'created_at', '')::timestamptz, nullif(p_batch->>'createdAt', '')::timestamptz, now()),
      now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id, p_idempotency_key,
      coalesce(p_batch->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    ) returning * into v_saved;
  else
    update public.pos_product_batches
    set sku = v_sku,
        sku_key = v_sku_key,
        stock = v_stock,
        committed_stock = greatest(coalesce(nullif(p_batch->>'committed_stock', '')::numeric, nullif(p_batch->>'committedStock', '')::numeric, committed_stock, 0), 0),
        cost = greatest(coalesce(nullif(p_batch->>'cost', '')::numeric, cost, 0), 0),
        price = greatest(coalesce(nullif(p_batch->>'price', '')::numeric, price, 0), 0),
        track_stock = coalesce(nullif(p_batch->>'track_stock', '')::boolean, nullif(p_batch->>'trackStock', '')::boolean, track_stock),
        is_active = coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, is_active),
        status = v_status,
        active_stock_status = case when coalesce(nullif(p_batch->>'is_active', '')::boolean, nullif(p_batch->>'isActive', '')::boolean, is_active) and v_status = 'active' and v_stock > 0 then 1 else 0 end,
        expiry_date = coalesce(nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, expiry_date),
        alert_target_date = coalesce(nullif(p_batch->>'alert_target_date', '')::timestamptz, nullif(p_batch->>'alertTargetDate', '')::timestamptz, nullif(p_batch->>'expiry_date', '')::timestamptz, nullif(p_batch->>'expiryDate', '')::timestamptz, alert_target_date),
        alert_type = nullif(btrim(coalesce(p_batch->>'alert_type', p_batch->>'alertType', alert_type, '')), ''),
        manufacturer_batch_id = nullif(btrim(coalesce(p_batch->>'manufacturer_batch_id', p_batch->>'manufacturerBatchId', manufacturer_batch_id, '')), ''),
        supplier = nullif(btrim(coalesce(p_batch->>'supplier', supplier, '')), ''),
        attributes = coalesce(p_batch->'attributes', attributes),
        location = nullif(btrim(coalesce(p_batch->>'location', location, '')), ''),
        notes = nullif(btrim(coalesce(p_batch->>'notes', notes, '')), ''),
        update_global_price = coalesce(nullif(p_batch->>'update_global_price', '')::boolean, nullif(p_batch->>'updateGlobalPrice', '')::boolean, update_global_price),
        updated_at = now(),
        server_version = server_version + 1,
        updated_by_device_id = v_device_id,
        updated_by_staff_user_id = v_staff_user_id,
        last_idempotency_key = p_idempotency_key,
        metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_batch->'metadata', '{}'::jsonb) || jsonb_build_object('phase', 'fase2_products_catalog')
    where license_id = v_license_id and id = v_batch_id
    returning * into v_saved;
  end if;

  v_saved_product := private.recalculate_pos_product_projection(v_license_id, v_product_id);
  if v_saved.update_global_price is true then
    update public.pos_products
    set price = v_saved.price,
        updated_at = now(),
        server_version = server_version + 1
    where license_id = v_license_id and id = v_product_id
    returning * into v_saved_product;
  end if;

  v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved.id, case when v_is_create then 'create' else 'update' end, v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product_batch', 'product_id', v_product_id), v_saved.server_version);
  v_product_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_upsert_product_batch.recalculate', 'batch_id', v_saved.id), v_saved_product.server_version);
  v_response := jsonb_build_object('success', true, 'batch', private.pos_product_batch_to_jsonb(v_saved), 'product', private.pos_product_to_jsonb(v_saved_product), 'event', to_jsonb(v_event), 'product_event', to_jsonb(v_product_event), 'server_version', v_saved.server_version, 'change_seq', greatest(v_event.change_seq, v_product_event.change_seq), 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

create or replace function public.pos_delete_product_batch_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_expected_version integer DEFAULT NULL::integer, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_existing public.pos_product_batches;
  v_saved public.pos_product_batches;
  v_product public.pos_products;
  v_event public.pos_sync_events;
  v_product_event public.pos_sync_events;
  v_response jsonb;
  v_idem public.pos_idempotency_keys;
  v_inserted_idem boolean;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  if nullif(btrim(coalesce(p_batch_id, '')), '') is null then raise exception 'BATCH_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_inserted_idem := private.insert_pos_idempotency_processing(v_license_id, p_idempotency_key, 'product_batch.delete', 'product_batch', p_batch_id, null);
  if not v_inserted_idem then
    select * into v_idem from public.pos_idempotency_keys where license_id = v_license_id and idempotency_key = p_idempotency_key limit 1;
    if v_idem.status = 'completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success', false, 'code', 'IDEMPOTENCY_PROCESSING', 'message', 'La operacion ya esta en proceso.', 'idempotency_key', p_idempotency_key);
  end if;

  select * into v_existing from public.pos_product_batches where license_id = v_license_id and id = p_batch_id for update;
  if v_existing.id is null then
    v_response := jsonb_build_object('success', false, 'code', 'BATCH_NOT_FOUND', 'message', 'El lote no existe.', 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;
  if p_expected_version is not null and p_expected_version <> v_existing.server_version then
    insert into public.pos_sync_conflicts (license_id, entity_type, entity_id, conflict_type, local_payload, server_payload, actor_device_id, actor_staff_user_id)
    values (v_license_id, 'product_batch', p_batch_id, 'VERSION_CONFLICT', jsonb_build_object('operation', 'delete', 'expected_version', p_expected_version), private.pos_product_batch_to_jsonb(v_existing), v_device_id, v_staff_user_id);
    v_response := jsonb_build_object('success', false, 'code', 'VERSION_CONFLICT', 'message', 'El lote fue modificado en otro dispositivo.', 'batch', private.pos_product_batch_to_jsonb(v_existing), 'server_version', v_existing.server_version, 'idempotency_key', p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
    return v_response;
  end if;

  update public.pos_product_batches
  set deleted_at = coalesce(deleted_at, now()),
      is_active = false,
      status = 'archived',
      active_stock_status = 0,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = p_idempotency_key
  where license_id = v_license_id and id = p_batch_id
  returning * into v_saved;

  v_product := private.recalculate_pos_product_projection(v_license_id, v_saved.product_id);
  v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved.id, 'delete', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product_batch', 'product_id', v_saved.product_id), v_saved.server_version);
  v_product_event := private.record_pos_sync_event(v_license_id, 'product', v_product.id, 'update', v_device_id, v_staff_user_id, p_idempotency_key, jsonb_build_object('source', 'pos_delete_product_batch.recalculate', 'batch_id', v_saved.id), v_product.server_version);
  v_response := jsonb_build_object('success', true, 'batch', private.pos_product_batch_to_jsonb(v_saved), 'product', private.pos_product_to_jsonb(v_product), 'event', to_jsonb(v_event), 'product_event', to_jsonb(v_product_event), 'server_version', v_saved.server_version, 'change_seq', greatest(v_event.change_seq, v_product_event.change_seq), 'idempotency_key', p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id, p_idempotency_key, v_response);
  return v_response;
end;
$function$;

create or replace function public.pos_migrate_local_product_catalog_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text DEFAULT NULL::text, p_categories jsonb DEFAULT '[]'::jsonb, p_products jsonb DEFAULT '[]'::jsonb, p_batches jsonb DEFAULT '[]'::jsonb, p_batch_id text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_item jsonb;
  v_results jsonb := jsonb_build_object('categories', '[]'::jsonb, 'products', '[]'::jsonb, 'batches', '[]'::jsonb);
  v_result jsonb;
  v_index integer := 0;
  v_key text;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_product_actor_authority(v_context);
  if jsonb_typeof(coalesce(p_batches, '[]'::jsonb)) = 'array'
    and jsonb_array_length(coalesce(p_batches, '[]'::jsonb)) > 0 then
    perform private.assert_inventory_actor_authority(v_context);
  end if;
  if jsonb_typeof(coalesce(p_products, '[]'::jsonb)) = 'array'
    and exists (
      select 1
      from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) as product_item(item)
      where not exists (
        select 1 from public.pos_products existing
        where existing.license_id = (v_context->>'license_id')::uuid
          and existing.id = nullif(product_item.item->>'id', '')
          and existing.deleted_at is null
      )
      and greatest(
        coalesce(nullif(product_item.item->>'stock', '')::numeric, 0),
        coalesce(nullif(product_item.item->>'committed_stock', '')::numeric, 0),
        coalesce(nullif(product_item.item->>'committedStock', '')::numeric, 0)
      ) > 0
    ) then
    perform private.assert_inventory_actor_authority(v_context);
  end if;

  if coalesce(jsonb_typeof(p_categories), 'array') <> 'array' then raise exception 'CATEGORIES_ARRAY_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p_products), 'array') <> 'array' then raise exception 'PRODUCTS_ARRAY_REQUIRED' using errcode = 'P0001'; end if;
  if coalesce(jsonb_typeof(p_batches), 'array') <> 'array' then raise exception 'BATCHES_ARRAY_REQUIRED' using errcode = 'P0001'; end if;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_categories, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':category:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_category(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)), null, v_key);
    v_results := jsonb_set(v_results, '{categories}', (v_results->'categories') || jsonb_build_array(v_result));
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_products, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':product:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_product(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)), '[]'::jsonb, null, v_key);
    v_results := jsonb_set(v_results, '{products}', (v_results->'products') || jsonb_build_array(v_result));
  end loop;

  v_index := 0;
  for v_item in select value from jsonb_array_elements(coalesce(p_batches, '[]'::jsonb)) loop
    v_index := v_index + 1;
    v_key := concat('migration:', coalesce(p_batch_id, 'default'), ':batch:', coalesce(v_item->>'id', v_index::text));
    v_result := public.pos_upsert_product_batch(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)), null, v_key);
    v_results := jsonb_set(v_results, '{batches}', (v_results->'batches') || jsonb_build_array(v_result));
  end loop;

  return jsonb_build_object(
    'success', true,
    'batch_id', p_batch_id,
    'processed', jsonb_build_object(
      'categories', jsonb_array_length(coalesce(p_categories, '[]'::jsonb)),
      'products', jsonb_array_length(coalesce(p_products, '[]'::jsonb)),
      'batches', jsonb_array_length(coalesce(p_batches, '[]'::jsonb))
    ),
    'results', v_results
  );
end;
$function$;

create or replace function public.pos_register_expiration_waste_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_batch_id text DEFAULT NULL::text, p_quantity numeric DEFAULT NULL::numeric, p_reason text DEFAULT 'caducidad'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
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

  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_inventory_actor_authority(v_context);

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
$function$;

create or replace function public.pos_create_product_batch_from_parent_stock_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_expiry_date timestamp with time zone DEFAULT NULL::timestamp with time zone, p_quantity numeric DEFAULT NULL::numeric, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_product public.pos_products;
  v_saved_batch public.pos_product_batches;
  v_saved_product public.pos_products;
  v_event public.pos_sync_events;
  v_product_event public.pos_sync_events;
  v_available numeric;
  v_quantity numeric;
  v_batch_id text;
  v_batch_sku text;
  v_idempotency_key text;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'cad6.create_batch_from_stock:' || p_product_id || ':' || v_device_id::text);

  select * into v_product
  from public.pos_products p
  where p.license_id = v_license_id and p.id = p_product_id and p.deleted_at is null
  for update;

  if v_product.id is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
  end if;

  if private.product_uses_batches(v_product) is not true and coalesce(v_product.expiration_mode, 'NONE') <> 'STRICT' then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_DOES_NOT_REQUIRE_BATCH', 'message', 'Este producto no requiere lote para regularizar.');
  end if;

  v_available := greatest(coalesce(v_product.stock, 0) - coalesce(v_product.committed_stock, 0), 0);
  v_quantity := coalesce(p_quantity, v_available);

  if v_quantity <= 0 or v_quantity > v_available then
    return jsonb_build_object('success', false, 'code', 'INVALID_REGULARIZATION_QUANTITY', 'message', 'La cantidad a regularizar no es valida.', 'available_quantity', v_available);
  end if;

  if coalesce(v_product.expiration_mode, 'NONE') in ('STRICT','SHELF_LIFE') and p_expiry_date is null then
    return jsonb_build_object('success', false, 'code', 'REGULARIZATION_EXPIRY_REQUIRED', 'message', 'Captura una fecha de caducidad o vida util estimada para crear el lote.');
  end if;

  v_batch_id := 'batch-reg-' || replace(gen_random_uuid()::text, '-', '');
  v_batch_sku := 'REG-' || to_char(now(), 'YYYYMMDDHH24MISS');

  insert into public.pos_product_batches (
    id, license_id, product_id, sku, sku_key, stock, committed_stock, cost, price,
    track_stock, is_active, status, active_stock_status, expiry_date, alert_target_date,
    alert_type, location, notes, update_global_price, created_at, updated_at,
    server_version, created_by_device_id, updated_by_device_id, created_by_staff_user_id,
    updated_by_staff_user_id, last_idempotency_key, metadata
  ) values (
    v_batch_id, v_license_id, p_product_id, v_batch_sku, private.normalize_pos_sku_key(v_batch_sku),
    v_quantity, 0, coalesce(v_product.cost, 0), coalesce(v_product.price, 0),
    true, true, 'active', case when v_quantity > 0 then 1 else 0 end,
    p_expiry_date, p_expiry_date,
    case when v_product.expiration_mode = 'SHELF_LIFE' then 'VIDA_UTIL_ESTIMADA' else 'CADUCIDAD_LEGAL' end,
    v_product.location, coalesce(nullif(btrim(p_notes), ''), 'Regularizacion de inventario sin lote'),
    false, now(), now(), 1, v_device_id, v_device_id, v_staff_user_id, v_staff_user_id,
    v_idempotency_key,
    jsonb_build_object('phase', 'fase_cad_6', 'source', 'create_batch_from_parent_stock', 'regularization', true)
  ) returning * into v_saved_batch;

  v_saved_product := private.recalculate_pos_product_projection(v_license_id, p_product_id);
  v_event := private.record_pos_sync_event(v_license_id, 'product_batch', v_saved_batch.id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.create_batch_from_parent_stock', 'product_id', p_product_id), v_saved_batch.server_version);
  v_product_event := private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.recalculate_after_regularization', 'batch_id', v_saved_batch.id), v_saved_product.server_version);

  return jsonb_build_object('success', true, 'batch', private.pos_product_batch_to_jsonb(v_saved_batch), 'product', private.pos_product_to_jsonb(v_saved_product), 'event', to_jsonb(v_event), 'product_event', to_jsonb(v_product_event), 'idempotency_key', v_idempotency_key, 'change_seq', greatest(v_event.change_seq, v_product_event.change_seq));
end;
$function$;

create or replace function public.pos_adjust_product_stock_without_batch_zero_unlimited(p_license_key text, p_device_fingerprint text, p_security_token text DEFAULT NULL::text, p_staff_session_token text DEFAULT NULL::text, p_product_id text DEFAULT NULL::text, p_reason text DEFAULT 'regularizacion_stock_sin_lote'::text, p_notes text DEFAULT NULL::text, p_idempotency_key text DEFAULT NULL::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_actor_key text;
  v_actor_name text;
  v_product public.pos_products;
  v_saved_product public.pos_products;
  v_movement public.pos_inventory_movements;
  v_previous_stock numeric;
  v_idempotency_key text;
begin
  v_context := private.validate_product_inventory_actor(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_inventory_actor_authority(v_context);

  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  v_actor_name := private.resolve_cash_actor_name(v_context);
  v_idempotency_key := coalesce(nullif(btrim(p_idempotency_key), ''), 'cad6.adjust_stock_without_batch_zero:' || p_product_id || ':' || v_device_id::text);

  select * into v_product
  from public.pos_products p
  where p.license_id = v_license_id and p.id = p_product_id and p.deleted_at is null
  for update;

  if v_product.id is null then
    return jsonb_build_object('success', false, 'code', 'PRODUCT_NOT_FOUND', 'message', 'El producto no existe o fue eliminado.');
  end if;

  v_previous_stock := greatest(coalesce(v_product.stock, 0), 0);
  if v_previous_stock <= 0 then
    return jsonb_build_object('success', false, 'code', 'NO_PARENT_STOCK_TO_ADJUST', 'message', 'El producto ya no tiene stock padre por ajustar.');
  end if;

  update public.pos_products
  set stock = 0,
      committed_stock = 0,
      active_stock_status = 0,
      updated_at = now(),
      server_version = server_version + 1,
      updated_by_device_id = v_device_id,
      updated_by_staff_user_id = v_staff_user_id,
      last_idempotency_key = v_idempotency_key,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cad6RegularizedStockWithoutBatch', true, 'cad6RegularizedAt', now())
  where license_id = v_license_id and id = p_product_id
  returning * into v_saved_product;

  insert into public.pos_inventory_movements (
    id, license_id, product_id, movement_type, quantity, previous_stock, new_stock,
    unit_cost, total_cost, reason, source, actor_device_id, actor_staff_user_id,
    actor_key, actor_name, idempotency_key, metadata, created_at, server_version
  ) values (
    'mov_inv_' || replace(gen_random_uuid()::text, '-', ''), v_license_id, p_product_id,
    'adjustment', v_previous_stock, v_previous_stock, 0, coalesce(v_product.cost, 0),
    v_previous_stock * coalesce(v_product.cost, 0), coalesce(nullif(btrim(p_reason), ''), 'regularizacion_stock_sin_lote'),
    'adjustment', v_device_id, v_staff_user_id, v_actor_key, v_actor_name, v_idempotency_key,
    jsonb_build_object('phase', 'fase_cad_6', 'source', 'adjust_stock_without_batch_zero', 'notes', p_notes),
    now(), 1
  ) returning * into v_movement;

  perform private.record_pos_sync_event(v_license_id, 'product', v_saved_product.id, 'update', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.adjust_stock_without_batch_zero', 'previous_stock', v_previous_stock), v_saved_product.server_version);
  perform private.record_pos_sync_event(v_license_id, 'inventory_movement', v_movement.id, 'create', v_device_id, v_staff_user_id, v_idempotency_key, jsonb_build_object('source', 'cad6.adjust_stock_without_batch_zero', 'product_id', p_product_id), v_movement.server_version::integer);

  return jsonb_build_object('success', true, 'product', private.pos_product_to_jsonb(v_saved_product), 'inventory_movement', private.pos_inventory_movement_to_jsonb(v_movement), 'idempotency_key', v_idempotency_key);
end;
$function$;

-- Internal mutation paths are never directly callable by API roles; service_role reaches only the validated actor path.
revoke all on function public.pos_upsert_category_unlimited(text, text, text, text, jsonb, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_upsert_category_unlimited(text, text, text, text, jsonb, integer, text) to service_role;
revoke all on function public.pos_delete_category_unlimited(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_delete_category_unlimited(text, text, text, text, text, integer, text) to service_role;
revoke all on function public.pos_upsert_product_unlimited(text, text, text, text, jsonb, jsonb, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_upsert_product_unlimited(text, text, text, text, jsonb, jsonb, integer, text) to service_role;
revoke all on function public.pos_delete_product_unlimited(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_delete_product_unlimited(text, text, text, text, text, integer, text) to service_role;
revoke all on function public.pos_toggle_product_status_unlimited(text, text, text, text, text, boolean, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_toggle_product_status_unlimited(text, text, text, text, text, boolean, integer, text) to service_role;
revoke all on function public.pos_upsert_product_batch_unlimited(text, text, text, text, jsonb, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_upsert_product_batch_unlimited(text, text, text, text, jsonb, integer, text) to service_role;
revoke all on function public.pos_delete_product_batch_unlimited(text, text, text, text, text, integer, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_delete_product_batch_unlimited(text, text, text, text, text, integer, text) to service_role;
revoke all on function public.pos_migrate_local_product_catalog_unlimited(text, text, text, text, jsonb, jsonb, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_migrate_local_product_catalog_unlimited(text, text, text, text, jsonb, jsonb, jsonb, text) to service_role;
revoke all on function public.pos_register_expiration_waste_unlimited(text, text, text, text, text, numeric, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_register_expiration_waste_unlimited(text, text, text, text, text, numeric, text, text, text) to service_role;
revoke all on function public.pos_create_product_batch_from_parent_stock_unlimited(text, text, text, text, text, timestamp with time zone, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_create_product_batch_from_parent_stock_unlimited(text, text, text, text, text, timestamp with time zone, numeric, text, text) to service_role;
revoke all on function public.pos_adjust_product_stock_without_batch_zero_unlimited(text, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_adjust_product_stock_without_batch_zero_unlimited(text, text, text, text, text, text, text, text) to service_role;

notify pgrst, 'reload schema';