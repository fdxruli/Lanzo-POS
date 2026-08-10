-- Forward schema baseline established after historical migration
-- 20260801043000 could not be proven as fully applied.
-- This migration intentionally contains no historical data backfill.
-- Current production data is preserved as-is.

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
set search_path = ''
as $function$
begin
  if p_incoming_hash like 'unverified:%' then
    if p_existing_kind in ('version', 'timestamp')
       and p_incoming_kind = p_existing_kind
       and p_existing_order is not null
       and p_incoming_order is not null then
      if p_incoming_order < p_existing_order then return 'stale'; end if;
      return 'apply';
    end if;
    if p_existing_revision is not distinct from p_incoming_revision then return 'apply'; end if;
    if p_existing_revision is null and p_existing_hash is null then return 'apply'; end if;
    return 'conflict';
  end if;

  if p_incoming_hash like 'source-missing:%' then
    if p_existing_hash is null and p_existing_revision is null then return 'apply'; end if;
    if p_existing_kind in ('version', 'timestamp')
       and p_incoming_kind = p_existing_kind
       and p_existing_order is not null
       and p_incoming_order is not null then
      if p_incoming_order < p_existing_order then return 'stale'; end if;
      if p_incoming_order = p_existing_order and p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
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

  if p_existing_hash like 'source-missing:%' then
    if p_incoming_kind in ('version', 'timestamp') and p_incoming_order is not null then
      if p_existing_kind = p_incoming_kind
         and p_existing_order is not null
         and p_incoming_order < p_existing_order then
        return 'stale';
      end if;
      return 'apply';
    end if;
    if p_existing_kind = 'opaque' and p_incoming_kind = 'opaque' then
      if p_existing_revision is not distinct from p_incoming_revision then return 'apply'; end if;
      return 'conflict';
    end if;
    if p_existing_kind is null and p_incoming_kind is null
       and p_existing_revision is null and p_incoming_revision is null then
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

    if p_existing_kind = 'version'
       and p_existing_order between 946684800000 and 4102444800000 then
      return 'apply';
    end if;

    return 'conflict';
  end if;

  if p_existing_kind = 'opaque' and p_incoming_kind = 'opaque'
     and p_existing_revision = p_incoming_revision
     and p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
  if p_existing_kind is null and p_incoming_kind is null
     and p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
  return 'conflict';
end;
$function$;

alter function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) owner to postgres;

revoke all on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) from public;
grant execute on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) to postgres, service_role;

comment on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) is 'Compara revisiones del catálogo. Mantiene conflictos estrictos para versiones normales y permite reconciliar valores legacy con forma de epoch-millisecond cuando cambia su proyección.';
