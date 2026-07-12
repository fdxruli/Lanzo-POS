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
-- La RPC ya preserva source_available, stock_snapshot, source_revision y
-- source_payload_hash cuando source_state = 'unverified'.
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

revoke all on function private.ecommerce_projection_payload_hash(jsonb)
  from public, anon, authenticated;
revoke all on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) from public, anon, authenticated;

grant execute on function private.ecommerce_projection_payload_hash(jsonb)
  to service_role;
grant execute on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) to service_role;
