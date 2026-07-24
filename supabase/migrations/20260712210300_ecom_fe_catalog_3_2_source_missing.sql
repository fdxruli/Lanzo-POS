-- ECOM.FE.CATALOG.3.2 - Ausencia confirmada de un producto previamente sincronizado.
-- No aplicar a produccion durante la revision del PR.

-- source_missing y unverified son estados tecnicos, no cambios normales de los
-- campos publicos. La marca permite que la decision de revision los distinga de
-- una proyeccion confirmada de contenido o inventario.
create or replace function private.ecommerce_projection_payload_hash(p_projection jsonb)
returns text
language sql
immutable
security definer
set search_path to ''
as $$
  select case coalesce(p_projection->>'sourceState', '')
    when 'unverified' then
      'unverified:' || encode(
        extensions.digest(coalesce(p_projection, '{}'::jsonb)::text, 'sha256'),
        'hex'
      )
    when 'source_missing' then
      'source-missing:' || encode(
        extensions.digest(coalesce(p_projection, '{}'::jsonb)::text, 'sha256'),
        'hex'
      )
    else encode(
      extensions.digest(coalesce(p_projection, '{}'::jsonb)::text, 'sha256'),
      'hex'
    )
  end;
$$;

create or replace function private.ecommerce_source_revision_decision(
  p_existing_kind text,
  p_existing_order numeric,
  p_existing_revision text,
  p_existing_hash text,
  p_incoming_kind text,
  p_incoming_order numeric,
  p_incoming_revision text,
  p_incoming_hash text
)
returns text
language plpgsql
immutable
security definer
set search_path to ''
as $$
begin
  -- Una lectura tecnica incompleta conserva el snapshot confirmado. Solo una
  -- revision comparable anterior puede rechazarse como stale.
  if p_incoming_hash like 'unverified:%' then
    if p_existing_kind in ('version', 'timestamp')
       and p_incoming_kind = p_existing_kind
       and p_existing_order is not null
       and p_incoming_order is not null then
      if p_incoming_order < p_existing_order then return 'stale'; end if;
      return 'apply';
    end if;

    if p_existing_revision is not distinct from p_incoming_revision then
      return 'apply';
    end if;

    if p_existing_revision is null and p_existing_hash is null then
      return 'apply';
    end if;

    return 'conflict';
  end if;

  -- source_missing aplica solo el estado tecnico de ausencia. El cliente actual
  -- no dispone de una revision de tombstone cuando la lectura local exitosa no
  -- encuentra el producto, por lo que una revision entrante nula puede aplicar
  -- contra una revision comparable almacenada. Una revision explicitamente
  -- anterior continua siendo stale y una opaca distinta continua en conflicto.
  if p_incoming_hash like 'source-missing:%' then
    if p_existing_hash is null and p_existing_revision is null then
      return 'apply';
    end if;

    if p_existing_kind in ('version', 'timestamp')
       and p_incoming_kind = p_existing_kind
       and p_existing_order is not null
       and p_incoming_order is not null then
      if p_incoming_order < p_existing_order then return 'stale'; end if;
      if p_incoming_order = p_existing_order
         and p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
      return 'apply';
    end if;

    if p_incoming_kind is null and p_incoming_revision is null then
      if p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
      if p_existing_kind in ('version', 'timestamp') then return 'apply'; end if;
      if p_existing_kind is null and p_existing_revision is null then return 'apply'; end if;
      return 'conflict';
    end if;

    if p_existing_kind = 'opaque' and p_incoming_kind = 'opaque' then
      if p_existing_revision is distinct from p_incoming_revision then return 'conflict'; end if;
      if p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
      return 'apply';
    end if;

    return 'conflict';
  end if;

  -- Si el estado almacenado era source_missing, una nueva lectura confirmada
  -- puede restaurar el producto con la misma revision o una posterior. Esto
  -- evita que la marca tecnica bloquee la reaparicion legitima del origen.
  if p_existing_hash like 'source-missing:%' then
    if p_existing_kind in ('version', 'timestamp')
       and p_incoming_kind = p_existing_kind
       and p_existing_order is not null
       and p_incoming_order is not null then
      if p_incoming_order < p_existing_order then return 'stale'; end if;
      return 'apply';
    end if;

    if p_existing_kind = 'opaque' and p_incoming_kind = 'opaque' then
      if p_existing_revision is not distinct from p_incoming_revision then return 'apply'; end if;
      return 'conflict';
    end if;

    if p_existing_kind is null
       and p_incoming_kind is null
       and p_existing_revision is null
       and p_incoming_revision is null then
      return 'apply';
    end if;

    return 'conflict';
  end if;

  if p_existing_hash is null then
    if p_existing_revision is null then return 'apply'; end if;
    return 'conflict';
  end if;

  if p_existing_kind in ('version', 'timestamp')
     and p_incoming_kind = p_existing_kind
     and p_existing_order is not null
     and p_incoming_order is not null then
    if p_incoming_order < p_existing_order then return 'stale'; end if;
    if p_incoming_order > p_existing_order then return 'apply'; end if;
    if p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
    return 'conflict';
  end if;

  if p_existing_kind = 'opaque'
     and p_incoming_kind = 'opaque'
     and p_existing_revision = p_incoming_revision
     and p_existing_hash = p_incoming_hash then
    return 'idempotent';
  end if;

  if p_existing_kind is null
     and p_incoming_kind is null
     and p_existing_hash = p_incoming_hash then
    return 'idempotent';
  end if;

  return 'conflict';
end;
$$;

-- El guard impide que estados tecnicos modifiquen campos visuales. Para
-- source_missing conserva el stock confirmado solo como dato interno, fuerza la
-- indisponibilidad efectiva y mantiene la ultima revision cuando el tombstone
-- local no incluye una revision propia.
create or replace function private.ecommerce_published_product_sync_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.sync_config := private.ecommerce_normalize_sync_config(
    new.sync_config,
    case when tg_op = 'UPDATE' then old.sync_config else null end
  );

  if tg_op = 'INSERT' then
    new.manual_available := coalesce(new.is_available, new.manual_available, true);
    new.source_available := coalesce(new.source_available, true);
  elsif new.manual_available is not distinct from old.manual_available
        and new.source_available is not distinct from old.source_available
        and new.is_available is distinct from old.is_available then
    new.manual_available := coalesce(new.is_available, old.manual_available, true);
  end if;

  new.manual_available := coalesce(new.manual_available, true);
  new.source_available := coalesce(new.source_available, true);

  if new.source_state = 'not_tracked' then
    new.track_stock := false;
    new.stock_mode := 'hidden';
    new.stock_snapshot := null;
  end if;

  if tg_op = 'UPDATE' and new.source_state in ('unverified', 'source_missing') then
    new.public_name := old.public_name;
    new.public_description := old.public_description;
    new.category_name := old.category_name;
    new.price := old.price;
    new.image_url := old.image_url;
    new.stock_snapshot := old.stock_snapshot;
    new.stock_updated_at := old.stock_updated_at;
  end if;

  if tg_op = 'UPDATE' and new.source_state = 'unverified' then
    new.source_available := old.source_available;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
  elsif tg_op = 'UPDATE' and new.source_state = 'source_missing' then
    new.source_available := false;
    if new.source_revision is null then
      new.source_revision := old.source_revision;
      new.source_revision_kind := old.source_revision_kind;
      new.source_revision_order := old.source_revision_order;
    end if;
  end if;

  new.is_available := new.manual_available and new.source_available;

  if new.sync_status not in ('synced', 'pending', 'review', 'error', 'manual') then
    new.sync_status := 'error';
    new.sync_error_code := 'INVALID_SYNC_STATUS';
  end if;

  return new;
end;
$$;

revoke all on function private.ecommerce_projection_payload_hash(jsonb)
  from public, anon, authenticated;
revoke all on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) from public, anon, authenticated;
revoke all on function private.ecommerce_published_product_sync_guard()
  from public, anon, authenticated;

grant execute on function private.ecommerce_projection_payload_hash(jsonb)
  to service_role;
grant execute on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) to service_role;
grant execute on function private.ecommerce_published_product_sync_guard()
  to service_role;
;
