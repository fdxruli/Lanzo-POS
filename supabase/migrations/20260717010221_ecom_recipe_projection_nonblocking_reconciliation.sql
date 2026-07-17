-- ECOM.RECIPE.PROJECTION.NONBLOCKING.RECONCILIATION
-- La disponibilidad de productos con receta se calcula de forma canónica en
-- el servidor. Una proyección local de stock distinta no debe bloquear la
-- sincronización de la configuración pública (extras, variantes, etc.).

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
  v_evaluation := private.ecommerce_recipe_capacity(new.license_id, v_recipe, current_date);
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
    or (v_status in ('in_stock', 'out_of_stock', 'not_tracked') and v_incoming_available is distinct from v_available)
    or (v_status in ('in_stock', 'out_of_stock') and v_incoming_stock is distinct from v_stock);

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

  if v_status = 'unverified' then
    new.sync_status := 'review';
    new.sync_error_code := 'SOURCE_UNVERIFIED';
  elsif old.sync_error_code = 'ECOMMERCE_RECIPE_SOURCE_MISMATCH' then
    -- El servidor ya reemplazó la disponibilidad con la evaluación de receta.
    -- Conservamos la revisión/configuración entrante y sólo auditamos la diferencia.
    new.sync_status := 'synced';
    new.sync_error_code := null;
    new.metadata := coalesce(new.metadata, '{}'::jsonb)
      - 'recipe_projection_corrected_at'
      - 'recipe_projection_incoming_state'
      - 'recipe_projection_canonical_state';
  end if;

  if v_mismatch then
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'recipe_projection_last_reconciled_at', now(),
      'recipe_projection_incoming_state', v_incoming_state,
      'recipe_projection_canonical_state', v_status
    );
  end if;

  return new;
end;
$$;

revoke all on function private.ecommerce_reconcile_recipe_projection()
from public, anon, authenticated;

-- Libera los productos que quedaron marcados durante la reconciliación inicial.
update public.ecommerce_published_products
set sync_status = 'synced',
    sync_error_code = null,
    last_synced_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb)
      - 'recipe_projection_corrected_at'
      - 'recipe_projection_incoming_state'
      - 'recipe_projection_canonical_state'
where deleted_at is null
  and has_recipe is true
  and availability_source = 'recipe'
  and sync_error_code = 'ECOMMERCE_RECIPE_SOURCE_MISMATCH';
