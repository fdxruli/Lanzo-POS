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
$$;

create or replace function public.pos_create_product_batch_from_parent_stock(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_expiry_date timestamptz default null,
  p_quantity numeric default null,
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
$$;

create or replace function public.pos_adjust_product_stock_without_batch_zero(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text default null,
  p_staff_session_token text default null,
  p_product_id text default null,
  p_reason text default 'regularizacion_stock_sin_lote',
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
$$;
revoke all on function public.pos_add_inventory_entry(text, text, text, text, text, text, numeric, text, numeric, text, numeric, text, text, timestamptz, timestamptz, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_add_inventory_entry(text, text, text, text, text, text, numeric, text, numeric, text, numeric, text, text, timestamptz, timestamptz, text, jsonb, text) to anon, authenticated, service_role;
revoke all on function public.pos_register_expiration_waste(text, text, text, text, text, numeric, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_register_expiration_waste(text, text, text, text, text, numeric, text, text, text) to anon, authenticated, service_role;
revoke all on function public.pos_create_product_batch_from_parent_stock(text, text, text, text, text, timestamptz, numeric, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_create_product_batch_from_parent_stock(text, text, text, text, text, timestamptz, numeric, text, text) to anon, authenticated, service_role;
revoke all on function public.pos_adjust_product_stock_without_batch_zero(text, text, text, text, text, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.pos_adjust_product_stock_without_batch_zero(text, text, text, text, text, text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';