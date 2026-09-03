-- R1 — Folio operativo POS global y timeout acotado para cobros cloud
--
-- El folio financiero existente (V-xxxxxx / EC-xxxxxx) no se modifica.
-- pos_folio es la referencia visible del POS y reutiliza la misma secuencia
-- global por licencia que ya reserva folio_sequence de forma atómica.
-- No se backfillean filas históricas: el serializador las proyecta de forma
-- determinista a partir de folio_sequence.

alter table public.pos_sales
  add column if not exists pos_folio text;

alter table public.pos_folio_sequences
  add column if not exists operational_prefix text,
  add column if not exists operational_terminal text;

create or replace function private.derive_pos_operational_prefix_v1(p_license_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_business_name text;
  v_normalized_name text;
  v_parts text[];
begin
  if p_license_id is null then
    return 'LZ';
  end if;

  select b.business_name
    into v_business_name
    from public.business_profiles b
   where b.license_id = p_license_id
   order by b.updated_at desc nulls last, b.created_at desc nulls last, b.id
   limit 1;

  v_normalized_name := btrim(regexp_replace(
    upper(coalesce(v_business_name, '')),
    '[^A-Z0-9ÁÉÍÓÚÜÑ]+',
    ' ',
    'g'
  ));

  if v_normalized_name = '' then
    return 'LZ';
  end if;

  v_parts := regexp_split_to_array(v_normalized_name, '\s+');

  if coalesce(array_length(v_parts, 1), 0) >= 2 then
    return left(v_parts[1], 1) || left(v_parts[2], 1);
  end if;

  if length(v_parts[1]) = 1 then
    return v_parts[1] || 'X';
  end if;

  return left(v_parts[1], 2);
exception
  when others then
    return 'LZ';
end;
$$;

create or replace function private.format_pos_operational_folio_v1(
  p_license_id uuid,
  p_sequence bigint
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_prefix text;
  v_terminal text;
  v_padding integer;
begin
  if p_license_id is null or p_sequence is null or p_sequence < 0 then
    return null;
  end if;

  select
    nullif(btrim(s.operational_prefix), ''),
    nullif(btrim(s.operational_terminal), ''),
    coalesce(s.padding, 6)
    into v_prefix, v_terminal, v_padding
    from public.pos_folio_sequences s
   where s.license_id = p_license_id
     and s.sequence_name = 'sale'
   limit 1;

  v_prefix := regexp_replace(
    upper(coalesce(v_prefix, private.derive_pos_operational_prefix_v1(p_license_id))),
    '[^A-Z0-9ÁÉÍÓÚÜÑ]',
    '',
    'g'
  );
  v_prefix := left(nullif(v_prefix, ''), 12);
  v_prefix := coalesce(v_prefix, 'LZ');

  v_terminal := regexp_replace(upper(coalesce(v_terminal, '01')), '[^A-Z0-9]', '', 'g');
  v_terminal := left(nullif(v_terminal, ''), 4);
  v_terminal := coalesce(v_terminal, '01');

  return v_prefix
    || '-'
    || lpad(v_terminal, 2, '0')
    || '-'
    || lpad(p_sequence::text, greatest(1, least(coalesce(v_padding, 6), 12)), '0');
end;
$$;

-- Inicializa únicamente la configuración de la secuencia. No modifica ventas.
update public.pos_folio_sequences s
   set operational_prefix = coalesce(
         nullif(btrim(s.operational_prefix), ''),
         private.derive_pos_operational_prefix_v1(s.license_id)
       ),
       operational_terminal = coalesce(nullif(btrim(s.operational_terminal), ''), '01')
 where s.sequence_name = 'sale';

alter table public.pos_folio_sequences
  alter column operational_prefix set default 'LZ',
  alter column operational_prefix set not null,
  alter column operational_terminal set default '01',
  alter column operational_terminal set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.pos_folio_sequences'::regclass
       and conname = 'pos_folio_sequences_operational_prefix_check'
  ) then
    alter table public.pos_folio_sequences
      add constraint pos_folio_sequences_operational_prefix_check
      check (length(btrim(operational_prefix)) between 1 and 12);
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.pos_folio_sequences'::regclass
       and conname = 'pos_folio_sequences_operational_terminal_check'
  ) then
    alter table public.pos_folio_sequences
      add constraint pos_folio_sequences_operational_terminal_check
      check (length(btrim(operational_terminal)) between 1 and 4);
  end if;
end;
$$;

create or replace function private.next_pos_sale_folio(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sequence public.pos_folio_sequences;
  v_next bigint;
  v_folio text;
  v_operational_prefix text;
begin
  if p_license_id is null then
    raise exception 'LICENSE_ID_REQUIRED_FOR_FOLIO' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_license_id::text), hashtext('pos_sale_folio'));

  v_operational_prefix := private.derive_pos_operational_prefix_v1(p_license_id);

  insert into public.pos_folio_sequences (
    license_id,
    sequence_name,
    current_value,
    prefix,
    padding,
    operational_prefix,
    operational_terminal
  )
  values (
    p_license_id,
    'sale',
    0,
    'V',
    6,
    v_operational_prefix,
    '01'
  )
  on conflict (license_id, sequence_name) do nothing;

  update public.pos_folio_sequences
     set current_value = current_value + 1,
         updated_at = now()
   where license_id = p_license_id
     and sequence_name = 'sale'
  returning * into v_sequence;

  v_next := v_sequence.current_value;
  v_folio := v_sequence.prefix || '-' || lpad(v_next::text, v_sequence.padding, '0');

  return jsonb_build_object(
    'folio', v_folio,
    'sequence', v_next,
    'prefix', v_sequence.prefix,
    'padding', v_sequence.padding,
    'pos_folio', private.format_pos_operational_folio_v1(p_license_id, v_next)
  );
end;
$$;

create or replace function private.assign_pos_sale_operational_folio_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.license_id is null
     or new.folio_sequence is null
     or lower(coalesce(new.source_mode, '')) <> 'cloud_committed'
     or lower(coalesce(new.sales_channel, 'local')) = 'ecommerce' then
    return new;
  end if;

  new.pos_folio := private.format_pos_operational_folio_v1(
    new.license_id,
    new.folio_sequence
  );

  if new.pos_folio is null then
    raise exception 'POS_OPERATIONAL_FOLIO_UNRESOLVED' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_pos_sales_assign_operational_folio on public.pos_sales;

create trigger trg_pos_sales_assign_operational_folio
before insert on public.pos_sales
for each row
execute function private.assign_pos_sale_operational_folio_v1();

create unique index if not exists ux_pos_sales_license_pos_folio
  on public.pos_sales (license_id, pos_folio)
  where pos_folio is not null and deleted_at is null;

create index if not exists idx_pos_sales_license_folio_sequence
  on public.pos_sales (license_id, folio_sequence)
  where folio_sequence is not null;

comment on column public.pos_sales.pos_folio is
  'Operational POS folio, globally allocated per license from folio_sequence; financial folio remains in folio/cloud_folio.';

comment on column public.pos_folio_sequences.operational_prefix is
  'Stable visible POS prefix derived once from the business profile, for example FG.';

comment on column public.pos_folio_sequences.operational_terminal is
  'Stable visible POS terminal code; defaults to 01 until multi-terminal configuration is enabled.';

-- Existing rows are returned with a deterministic visible POS folio without
-- rewriting financial history. New rows already have pos_folio via the trigger.
create or replace function private.pos_sale_to_jsonb(p_sale public.pos_sales)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
    when p_sale.id is null then null
    else jsonb_strip_nulls(
      to_jsonb(p_sale)
      ||
      case
        when p_sale.pos_folio is not null then '{}'::jsonb
        when lower(coalesce(p_sale.source_mode, '')) = 'cloud_committed'
             and lower(coalesce(p_sale.sales_channel, 'local')) <> 'ecommerce'
             and p_sale.folio_sequence is not null
        then jsonb_build_object(
          'pos_folio',
          private.format_pos_operational_folio_v1(p_sale.license_id, p_sale.folio_sequence)
        )
        else '{}'::jsonb
      end
    )
  end
$$;

-- PostgREST enters through this wrapper. The project-wide authenticator
-- timeout is 8s; this scoped override lets one cashier transaction finish
-- while preserving a bounded request and a shorter lock wait.
alter function public.pos_execute_financial_operation_v1(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) set statement_timeout = '45s';

alter function public.pos_execute_financial_operation_v1(
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  jsonb
) set lock_timeout = '20s';
