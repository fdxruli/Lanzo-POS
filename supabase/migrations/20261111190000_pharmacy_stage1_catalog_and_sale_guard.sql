-- Farmacia Etapa 1: barrera transaccional de catálogo y ventas Cloud.
-- No instala funcionalidad de dispensación. LGS art. 226; DOF 27/05/2010.
-- Aplicar SOLO con autorización posterior y QA aislado de RPC reales.
-- Sin columnas, sin escrituras retrospectivas, sin permisos nuevos.

create or replace function private.pharmacy_stage1_product_write_guard()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_old jsonb := null;
  v_new jsonb := new.metadata->'pharmacy';
  v_fraction text;
  v_kind text;
  v_status text;
  v_antibiotic boolean;
begin
  if tg_op = 'UPDATE' then
    v_old := old.metadata->'pharmacy';
    -- La clasificación ya confirmada no puede ser borrada/alterada
    -- usando el RPC heredado, toggle status o cualquier otro UPDATE.
    if pg_catalog.jsonb_typeof(v_old) = 'object'
       and v_old->>'kind' = 'medicine'
       and v_old->>'status' = 'confirmed'
       and (
         pg_catalog.jsonb_typeof(v_new) is distinct from 'object'
         or v_new->>'kind' is distinct from v_old->>'kind'
         or v_new->>'fraction' is distinct from v_old->>'fraction'
         or v_new->>'status' is distinct from v_old->>'status'
         or v_new->>'antibiotic' is distinct from v_old->>'antibiotic'
       ) then
      raise exception 'PHARMACY_CONFIRMED_CLASSIFICATION_IMMUTABLE_STAGE1' using errcode = 'P0001';
    end if;
    -- Restricciones conocidas de productos históricos no se degradan en edición.
    if (old.requires_prescription is true
        or old.prescription_type in ('controlled', 'antibiotic', 'prescription'))
       and (new.requires_prescription is distinct from true
            or new.prescription_type = 'otc') then
      raise exception 'PHARMACY_LEGACY_PRESCRIPTION_DOWNGRADE_FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  if pg_catalog.jsonb_typeof(v_new) is distinct from 'object' then return new; end if;
  v_kind := v_new->>'kind';
  v_status := v_new->>'status';
  v_fraction := v_new->>'fraction';
  v_antibiotic := coalesce((v_new->>'antibiotic')::boolean, false);

  if v_kind is null or v_kind not in ('medicine', 'other')
     or v_status is null or v_status not in ('confirmed', 'pending') then
    raise exception 'PHARMACY_CLASSIFICATION_INVALID' using errcode = 'P0001';
  end if;
  if v_kind = 'other' then
    if v_fraction is not null or v_antibiotic then
      raise exception 'PHARMACY_NON_MEDICINE_CLASSIFICATION_INVALID' using errcode = 'P0001';
    end if;
    return new;
  end if;
  if v_fraction is not null
     and v_fraction not in ('I','II','III','IV','V','VI') then
    raise exception 'PHARMACY_FRACTION_INVALID' using errcode = 'P0001';
  end if;
  if v_fraction is null and v_status <> 'pending'
     or v_fraction is not null and v_status <> 'confirmed' then
    raise exception 'PHARMACY_STATUS_FRACTION_MISMATCH' using errcode = 'P0001';
  end if;
  if v_antibiotic and v_fraction in ('V','VI') then
    raise exception 'PHARMACY_ANTIBIOTIC_WITHOUT_RX_INVALID' using errcode = 'P0001';
  end if;
  if v_fraction in ('I','II','III') then
    if new.is_active is true then
      raise exception 'PHARMACY_SPECIAL_FRACTION_ACTIVATION_FORBIDDEN' using errcode = 'P0001';
    end if;
    if new.requires_prescription is distinct from true or new.prescription_type is distinct from 'controlled' then
      raise exception 'PHARMACY_SPECIAL_FRACTION_LEGACY_FLAGS_INVALID' using errcode = 'P0001';
    end if;
  elsif v_fraction = 'IV' or v_antibiotic then
    if new.requires_prescription is distinct from true or
       new.prescription_type not in ('prescription', 'antibiotic') then
      raise exception 'PHARMACY_PRESCRIPTION_FLAGS_INVALID' using errcode = 'P0001';
    end if;
  elsif v_fraction is null then
    -- Los nuevos registros pendientes no se publican como venta libre.
    -- Los históricos sin metadata no se modifican automáticamente.
    if new.is_active is true then
      raise exception 'PHARMACY_PENDING_ACTIVATION_FORBIDDEN' using errcode = 'P0001';
    end if;
  elsif new.requires_prescription is distinct from false or new.prescription_type is distinct from 'otc' then
    raise exception 'PHARMACY_NON_RX_FLAGS_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pharmacy_stage1_product_write_guard on public.pos_products;
create trigger trg_pharmacy_stage1_product_write_guard
before insert or update on public.pos_products
for each row execute function private.pharmacy_stage1_product_write_guard();

create or replace function private.pharmacy_stage1_sale_item_guard()
returns trigger language plpgsql
set search_path = ''
as $$
declare
  v_fraction text;
begin
  -- El producto se obtiene del catálogo canónico, nunca del snapshot
  -- suministrado por el cliente. FOR SHARE serializa reclasificación vs venta.
  select p.metadata->'pharmacy'->>'fraction' into v_fraction
  from public.pos_products p
  where p.license_id = new.license_id
    and p.id = new.product_id
    and p.metadata->'pharmacy'->>'kind' = 'medicine'
  for share;
  if v_fraction in ('I','II','III') then
    raise exception 'PHARMACY_SPECIAL_FRACTION_SALE_FORBIDDEN' using errcode = 'P0001';
  end if;

  -- El lote también identifica el producto cuando un cliente omite product_id.
  if new.batch_id is not null then
    select p.metadata->'pharmacy'->>'fraction' into v_fraction
    from public.pos_product_batches b
    join public.pos_products p on p.license_id = b.license_id and p.id = b.product_id
    where b.license_id = new.license_id and b.id = new.batch_id
      and p.metadata->'pharmacy'->>'kind' = 'medicine'
    for share of p;
    if v_fraction in ('I','II','III') then
      raise exception 'PHARMACY_SPECIAL_FRACTION_SALE_FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pharmacy_stage1_sale_item_guard on public.pos_sale_items;
create trigger trg_pharmacy_stage1_sale_item_guard
before insert or update of product_id, batch_id, license_id on public.pos_sale_items
for each row execute function private.pharmacy_stage1_sale_item_guard();

-- Cobertura esperada: caja, crédito, inventario Cloud y shadow insertan
-- pos_sale_items; el error de trigger aborta toda la transacción del RPC.
-- PENDIENTE: verificar esos RPC reales en PostgreSQL aislado antes de Production.
