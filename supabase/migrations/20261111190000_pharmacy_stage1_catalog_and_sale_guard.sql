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
  v_is_pharmacy boolean;
begin
  -- Alcance según rubro del negocio en el servidor, nunca el payload.
  -- Un registro ya clasificado mantiene su protección aunque cambie el rubro.
  if tg_op = 'UPDATE' and
    (old.requires_prescription is true or old.prescription_type in ('controlled','antibiotic','prescription')) then
    select exists (
      select 1 from public.business_profiles bp
      where bp.license_id = new.license_id
        and 'farmacia'::public.business_category = any(bp.business_type)
    ) into v_is_pharmacy;
  end if;
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
    if (v_is_pharmacy is true
        or pg_catalog.jsonb_typeof(v_old) = 'object')
       and (old.requires_prescription is true
         or old.prescription_type in ('controlled', 'antibiotic', 'prescription'))
       and (new.requires_prescription is distinct from true
            or new.prescription_type = 'otc'
            or (old.prescription_type in ('controlled','antibiotic')
                and new.prescription_type is distinct from old.prescription_type)) then
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
    if new.requires_prescription is distinct from true
       or (v_antibiotic and new.prescription_type is distinct from 'antibiotic')
       or (not v_antibiotic and new.prescription_type is not null) then
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
security invoker
set search_path = ''
as $$
declare
  v_is_pharmacy boolean;
  v_product public.pos_products%rowtype;
  v_batch_product_id text;
  v_has_product boolean := false;
  v_has_batch boolean := false;
begin
  -- Tipo de negocio verificable: no aceptar rubro/metadata del snapshot.
  -- Solo farmacias requieren identidad obligatoria para toda línea de venta.
  select exists (
    select 1 from public.business_profiles bp
    where bp.license_id = new.license_id
      and 'farmacia'::public.business_category = any(bp.business_type)
  ) into v_is_pharmacy;

  if new.product_id is not null and pg_catalog.btrim(new.product_id) <> '' then
    select p.* into v_product
    from public.pos_products p
    where p.license_id = new.license_id and p.id = new.product_id
    for share;
    v_has_product := found;
    if v_is_pharmacy and not v_has_product then
      raise exception 'PHARMACY_SALE_PRODUCT_ID_UNVERIFIED' using errcode = 'P0001';
    end if;
    if v_has_product and v_product.metadata->'pharmacy'->>'kind' = 'medicine'
       and v_product.metadata->'pharmacy'->>'fraction' in ('I','II','III') then
      raise exception 'PHARMACY_SPECIAL_FRACTION_SALE_FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  -- El lote debe corresponder al mismo producto y a la misma licencia.
  -- Un ID falso no puede ocultar una fracción restringida en el batch.
  if new.batch_id is not null and pg_catalog.btrim(new.batch_id) <> '' then
    select b.product_id into v_batch_product_id
    from public.pos_product_batches b
    where b.license_id = new.license_id and b.id = new.batch_id;
    v_has_batch := found;
    if v_is_pharmacy and not v_has_batch then
      raise exception 'PHARMACY_SALE_BATCH_ID_UNVERIFIED' using errcode = 'P0001';
    end if;
    if v_has_batch then
      if v_has_product and v_product.id is distinct from v_batch_product_id then
        raise exception 'PHARMACY_SALE_PRODUCT_BATCH_MISMATCH' using errcode = 'P0001';
      end if;
      select p.* into v_product
      from public.pos_products p
      where p.license_id = new.license_id and p.id = v_batch_product_id
      for share;
      if v_is_pharmacy and not found then
        raise exception 'PHARMACY_SALE_BATCH_PRODUCT_UNVERIFIED' using errcode = 'P0001';
      end if;
      if found and v_product.metadata->'pharmacy'->>'kind' = 'medicine'
         and v_product.metadata->'pharmacy'->>'fraction' in ('I','II','III') then
        raise exception 'PHARMACY_SPECIAL_FRACTION_SALE_FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
  end if;

  if v_is_pharmacy and not (v_has_product or v_has_batch) then
    -- No hay señal fiable para distinguir una línea manual legítima
    -- de un medicamento que eliminó su identidad. Se rechaza SOLO en farmacia.
    raise exception 'PHARMACY_SALE_CANONICAL_ID_REQUIRED' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_pharmacy_stage1_sale_item_guard on public.pos_sale_items;
create trigger trg_pharmacy_stage1_sale_item_guard
before insert or update of product_id, batch_id, license_id on public.pos_sale_items
for each row execute function private.pharmacy_stage1_sale_item_guard();

-- Sin privilegios EXECUTE nuevos para los clientes; acceso solo por triggers.
revoke all on function private.pharmacy_stage1_product_write_guard()
  from public, anon, authenticated, service_role;
revoke all on function private.pharmacy_stage1_sale_item_guard()
  from public, anon, authenticated, service_role;

-- Cobertura estática: caja, crédito, inventario Cloud y shadow insertan
-- pos_sale_items; el error del trigger aborta la transacción SQL.
-- R2B exige ID canónico antes de crear ventas; shadow exige ahora
-- identidad canónica al insertar líneas de una licencia farmacia.
-- No se puede certificar un producto físico si el cliente miente y
-- proporciona todos los datos de otro producto canónico permitido.
-- PENDIENTE: ejecutar RPC reales contra PostgreSQL aislado antes de Production.
