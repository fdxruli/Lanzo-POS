-- ECOM.FE.CATALOG.3.1 - Correccion de bloqueantes residuales.
-- No aplicar a produccion durante la revision del PR.

-- Una proyeccion unverified es un estado tecnico fail-closed. Su hash se marca
-- expresamente para que la decision de revision pueda conservar el ultimo
-- snapshot confirmado sin confundirla con un cambio legitimo de contenido.
create or replace function private.ecommerce_projection_payload_hash(p_projection jsonb)
returns text
language sql
immutable
security definer
set search_path to ''
as $$
  select case
    when coalesce(p_projection->>'sourceState', '') = 'unverified' then
      'unverified:' || encode(
        extensions.digest(coalesce(p_projection, '{}'::jsonb)::text, 'sha256'),
        'hex'
      )
    else encode(
      extensions.digest(coalesce(p_projection, '{}'::jsonb)::text, 'sha256'),
      'hex'
    )
  end;
$$;

-- Para unverified se permite aplicar exclusivamente el estado tecnico cuando
-- la revision es igual o superior. Una revision comparable anterior continua
-- siendo stale y una revision opaca distinta continua requiriendo review.
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

-- La RPC aplica campos antes de su rama de preservacion de stock. Este guard
-- impide que una proyeccion tecnica unverified, incluso con revision igual,
-- sobrescriba nombre, descripcion, categoria, precio, imagen o snapshot.
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

  if tg_op = 'UPDATE' and new.source_state = 'unverified' then
    new.public_name := old.public_name;
    new.public_description := old.public_description;
    new.category_name := old.category_name;
    new.price := old.price;
    new.image_url := old.image_url;
    new.source_available := old.source_available;
    new.stock_snapshot := old.stock_snapshot;
    new.stock_updated_at := old.stock_updated_at;
    new.source_revision := old.source_revision;
    new.source_revision_kind := old.source_revision_kind;
    new.source_revision_order := old.source_revision_order;
    new.source_payload_hash := old.source_payload_hash;
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
