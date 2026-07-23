create or replace function private.ecommerce_apply_product_configuration_checked(
  p_license_id uuid,
  p_published_product_id uuid,
  p_configuration jsonb,
  p_source_revision text default null,
  p_revision_already_applied boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_source_product public.pos_products%rowtype;
  v_result jsonb;
  v_incoming_revision jsonb;
  v_current_revision jsonb;
  v_canonical_revision jsonb;
  v_incoming_hash text;
  v_current_hash text;
  v_incoming_normalized text;
  v_current_normalized text;
  v_canonical_normalized text;
  v_canonical_source text;
  v_decision text;
begin
  if private.ecommerce_lock_configuration_writer(
    p_license_id,
    p_published_product_id
  ) is null then
    raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND';
  end if;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id
    and p.license_id = p_license_id
    and p.deleted_at is null
  for update;
  if v_product.id is null then
    raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND';
  end if;

  select p.* into v_source_product
  from public.pos_products p
  where p.license_id = p_license_id
    and p.id = v_product.local_product_ref
    and p.deleted_at is null
  limit 1;

  if v_source_product.id is not null then
    v_canonical_source := case
      when coalesce(v_source_product.server_version, 0) > 0
        then 'version:' || v_source_product.server_version::text
      when v_source_product.updated_at is not null
        then 'timestamp:' || floor(extract(epoch from v_source_product.updated_at) * 1000)::bigint::text
      else null
    end;
  end if;

  v_incoming_hash := encode(extensions.digest(p_configuration::text, 'sha256'), 'hex');
  v_current_hash := nullif(v_product.metadata->>'ecommerce_configuration_payload_hash', '');
  v_incoming_revision := private.ecommerce_parse_source_revision(p_source_revision);
  v_current_revision := private.ecommerce_parse_source_revision(
    v_product.metadata->>'ecommerce_configuration_source_revision'
  );
  v_canonical_revision := private.ecommerce_parse_source_revision(v_canonical_source);
  v_incoming_normalized := nullif(v_incoming_revision->>'normalized', '');
  v_current_normalized := nullif(v_current_revision->>'normalized', '');
  v_canonical_normalized := nullif(v_canonical_revision->>'normalized', '');

  if v_canonical_normalized is not null
     and v_incoming_normalized is distinct from v_canonical_normalized then
    if p_revision_already_applied is true then
      update public.ecommerce_published_products p
      set sync_status = 'review',
          sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH',
          last_sync_attempt_at = now(),
          metadata = coalesce(p.metadata, '{}'::jsonb) || jsonb_build_object(
            'ecommerce_configuration_rejected_revision', v_incoming_normalized,
            'ecommerce_configuration_canonical_revision', v_canonical_normalized
          )
      where p.id = p_published_product_id;

      select p.* into v_product
      from public.ecommerce_published_products p
      where p.id = p_published_product_id;

      return jsonb_build_object(
        'success', true,
        'skipped', true,
        'code', 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH',
        'product', private.ecommerce_admin_product_jsonb(v_product)
      );
    end if;
    raise exception 'ECOMMERCE_CATALOG_SOURCE_STALE';
  end if;

  if v_canonical_normalized is not null
     and v_current_normalized is distinct from v_canonical_normalized then
    v_current_normalized := null;
    v_current_hash := null;
  end if;

  if v_incoming_normalized is null then
    if v_current_hash is not null and v_current_hash <> v_incoming_hash then
      raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT';
    end if;
  elsif v_current_normalized is not null then
    v_decision := private.ecommerce_source_revision_decision(
      nullif(v_current_revision->>'kind', ''),
      nullif(v_current_revision->>'order', '')::numeric,
      v_current_normalized,
      v_current_hash,
      nullif(v_incoming_revision->>'kind', ''),
      nullif(v_incoming_revision->>'order', '')::numeric,
      v_incoming_normalized,
      v_incoming_hash
    );
    if v_decision = 'stale' then raise exception 'ECOMMERCE_CATALOG_SOURCE_STALE'; end if;
    if v_decision = 'conflict' then raise exception 'ECOMMERCE_CATALOG_SOURCE_CONFLICT'; end if;
  end if;

  v_result := private.ecommerce_apply_product_configuration(
    p_license_id,
    p_published_product_id,
    p_configuration,
    null
  );

  update public.ecommerce_published_products p
  set metadata = (
        coalesce(p.metadata, '{}'::jsonb)
        - 'ecommerce_configuration_rejected_revision'
        - 'ecommerce_configuration_canonical_revision'
      ) || jsonb_strip_nulls(jsonb_build_object(
        'ecommerce_configuration_payload_hash', v_incoming_hash,
        'ecommerce_configuration_source_revision', coalesce(
          v_canonical_normalized,
          v_incoming_normalized
        )
      )),
      sync_error_code = case
        when p.sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH' then null
        else p.sync_error_code
      end,
      sync_status = case
        when p.sync_error_code = 'ECOMMERCE_CONFIGURATION_SOURCE_REVISION_MISMATCH' then 'synced'
        else p.sync_status
      end
  where p.id = p_published_product_id;

  select p.* into v_product
  from public.ecommerce_published_products p
  where p.id = p_published_product_id;

  return v_result || jsonb_build_object(
    'product', private.ecommerce_admin_product_jsonb(v_product)
  );
end;
$$;

revoke all on function private.ecommerce_apply_product_configuration_checked(
  uuid, uuid, jsonb, text, boolean
) from public, anon, authenticated;
grant execute on function private.ecommerce_apply_product_configuration_checked(
  uuid, uuid, jsonb, text, boolean
) to service_role;

create or replace function private.ecommerce_reconcile_recipe_projection()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_recipe jsonb;
  v_evaluation jsonb;
  v_status text;
  v_available boolean;
  v_stock numeric;
  v_incoming_state text;
  v_incoming_available boolean;
  v_incoming_stock numeric;
  v_mismatch boolean := false;
begin
  if new.deleted_at is not null
     or new.has_recipe is not true
     or new.availability_source is distinct from 'recipe' then
    return new;
  end if;

  select p.recipe into v_recipe
  from public.pos_products p
  where p.license_id = new.license_id
    and p.id = new.local_product_ref
    and p.deleted_at is null
  limit 1;

  if jsonb_typeof(v_recipe) <> 'array' or jsonb_array_length(v_recipe) = 0 then
    return new;
  end if;

  v_incoming_state := new.source_state;
  v_incoming_available := new.source_available;
  v_incoming_stock := new.stock_snapshot;
  v_evaluation := private.ecommerce_recipe_capacity(
    new.license_id,
    v_recipe,
    current_date
  );
  v_status := coalesce(v_evaluation->>'status', 'unverified');

  if v_status = 'in_stock' then
    v_available := true;
    v_stock := greatest(coalesce((v_evaluation->>'availableStock')::numeric, 0), 0);
  elsif v_status = 'out_of_stock' then
    v_available := false;
    v_stock := 0;
  elsif v_status = 'not_tracked' then
    v_available := true;
    v_stock := null;
  else
    v_status := 'unverified';
    v_available := old.source_available;
    v_stock := old.stock_snapshot;
  end if;

  v_mismatch := v_incoming_state is distinct from v_status
    or (
      v_status in ('in_stock', 'out_of_stock', 'not_tracked')
      and v_incoming_available is distinct from v_available
    )
    or (
      v_status in ('in_stock', 'out_of_stock')
      and v_incoming_stock is distinct from v_stock
    );

  new.source_state := v_status;
  new.source_available := v_available;
  new.stock_snapshot := v_stock;
  new.is_available := new.manual_available and coalesce(v_available, old.source_available, false);
  new.availability_reason_code := nullif(v_evaluation->>'reasonCode', '');
  new.limiting_source_product_id := nullif(v_evaluation->>'limitingIngredientId', '');
  new.limiting_source_name := nullif(v_evaluation->>'limitingIngredientName', '');

  if v_status in ('in_stock', 'out_of_stock') then
    new.stock_updated_at := now();
  end if;

  if v_mismatch then
    new.source_revision := null;
    new.source_revision_kind := null;
    new.source_revision_order := null;
    new.source_payload_hash := null;
    new.sync_status := 'review';
    new.sync_error_code := 'ECOMMERCE_RECIPE_SOURCE_MISMATCH';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'recipe_projection_corrected_at', now(),
      'recipe_projection_incoming_state', v_incoming_state,
      'recipe_projection_canonical_state', v_status
    );
  elsif v_status = 'unverified' then
    new.sync_status := 'review';
    new.sync_error_code := 'SOURCE_UNVERIFIED';
  elsif old.sync_error_code = 'ECOMMERCE_RECIPE_SOURCE_MISMATCH'
        and new.source_revision is null then
    new.sync_status := 'review';
    new.sync_error_code := 'ECOMMERCE_RECIPE_SOURCE_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function private.ecommerce_reconcile_recipe_projection()
from public, anon, authenticated;

drop trigger if exists zz_ecommerce_recipe_projection_guard
on public.ecommerce_published_products;
create trigger zz_ecommerce_recipe_projection_guard
before insert or update on public.ecommerce_published_products
for each row execute function private.ecommerce_reconcile_recipe_projection();
;
