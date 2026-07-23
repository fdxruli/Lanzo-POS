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
    return 'conflict';
  end if;
  if p_existing_kind = 'opaque' and p_incoming_kind = 'opaque'
     and p_existing_revision = p_incoming_revision
     and p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
  if p_existing_kind is null and p_incoming_kind is null
     and p_existing_hash = p_incoming_hash then return 'idempotent'; end if;
  return 'conflict';
end;
$$;

revoke all on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) from public, anon, authenticated;

grant execute on function private.ecommerce_source_revision_decision(
  text, numeric, text, text, text, numeric, text, text
) to service_role;;
