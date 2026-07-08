-- LEGAL.DB.1 - Hardening legal de terminos, privacidad y evidencia de aceptacion.
-- Esta migracion no cambia la redaccion legal vigente ni crea contenido de
-- privacy_policy. Solo endurece integridad, evidencia y superficie de acceso.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- legal_terms: integridad, hash de contenido e inmutabilidad defensiva
-- ---------------------------------------------------------------------------

alter table public.legal_terms
  add column if not exists content_sha256 text;

update public.legal_terms
set
  is_active = coalesce(is_active, false),
  published_at = coalesce(published_at, created_at, now()),
  created_at = coalesce(created_at, published_at, now()),
  content_sha256 = encode(extensions.digest(content_html, 'sha256'), 'hex')
where is_active is null
   or published_at is null
   or created_at is null
   or content_sha256 is null;

alter table public.legal_terms
  alter column is_active set default false,
  alter column is_active set not null,
  alter column published_at set not null,
  alter column created_at set not null,
  alter column content_sha256 set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_terms_version_not_empty'
      and conrelid = 'public.legal_terms'::regclass
  ) then
    alter table public.legal_terms
      add constraint legal_terms_version_not_empty
      check (length(btrim(version)) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_terms_content_html_not_empty'
      and conrelid = 'public.legal_terms'::regclass
  ) then
    alter table public.legal_terms
      add constraint legal_terms_content_html_not_empty
      check (length(btrim(content_html)) > 0) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_terms_content_sha256_format'
      and conrelid = 'public.legal_terms'::regclass
  ) then
    alter table public.legal_terms
      add constraint legal_terms_content_sha256_format
      check (content_sha256 ~ '^[a-f0-9]{64}$') not valid;
  end if;
end $$;

alter table public.legal_terms validate constraint legal_terms_version_not_empty;
alter table public.legal_terms validate constraint legal_terms_content_html_not_empty;
alter table public.legal_terms validate constraint legal_terms_content_sha256_format;

-- Si por una carga previa hubiera multiples activos del mismo tipo, dejar activo
-- solo el publicado mas recientemente antes de crear el indice unico parcial.
with ranked_active_terms as (
  select
    id,
    row_number() over (
      partition by type
      order by published_at desc, created_at desc, id desc
    ) as rn
  from public.legal_terms
  where is_active = true
)
update public.legal_terms t
set is_active = false
from ranked_active_terms r
where t.id = r.id
  and r.rn > 1;

create unique index if not exists ux_legal_terms_one_active_per_type
  on public.legal_terms (type)
  where is_active = true;

create or replace function public.legal_terms_set_content_sha256()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  new.content_sha256 := encode(extensions.digest(new.content_html, 'sha256'), 'hex');
  return new;
end;
$$;

create or replace function public.legal_terms_guard_immutable()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  -- Los documentos legales publicados son evidencia. No se borran ni se
  -- reescribe su version, contenido, fecha de publicacion o hash. Para publicar
  -- una version nueva se inserta un documento nuevo y se desactiva el anterior.
  if tg_op = 'DELETE' then
    raise exception 'LEGAL_TERMS_APPEND_ONLY_DELETE_BLOCKED'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    if new.type is distinct from old.type
      or new.version is distinct from old.version
      or new.content_html is distinct from old.content_html
      or new.published_at is distinct from old.published_at
      or new.created_at is distinct from old.created_at
      or new.content_sha256 is distinct from old.content_sha256 then
      raise exception 'LEGAL_TERMS_IMMUTABLE_FIELDS_BLOCKED'
        using errcode = 'check_violation';
    end if;

    if old.is_active is distinct from new.is_active then
      if old.is_active = true and new.is_active = false then
        return new;
      end if;

      raise exception 'LEGAL_TERMS_REACTIVATION_BLOCKED'
        using errcode = 'check_violation';
    end if;

    return new;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_legal_terms_set_content_sha256 on public.legal_terms;
create trigger trg_legal_terms_set_content_sha256
  before insert on public.legal_terms
  for each row
  execute function public.legal_terms_set_content_sha256();

drop trigger if exists trg_legal_terms_guard_immutable on public.legal_terms;
create trigger trg_legal_terms_guard_immutable
  before update or delete on public.legal_terms
  for each row
  execute function public.legal_terms_guard_immutable();

comment on table public.legal_terms is
  'Documentos legales versionados. LEGAL.DB.1: contenido publicado inmutable; publicar nuevas versiones con nuevas filas.';
comment on column public.legal_terms.content_sha256 is
  'SHA-256 hexadecimal de content_html calculado con pgcrypto para evidencia legal.';

-- ---------------------------------------------------------------------------
-- legal_acceptances: snapshots robustos y preservacion de evidencia
-- ---------------------------------------------------------------------------

alter table public.legal_acceptances
  add column if not exists license_key_snapshot text,
  add column if not exists license_device_id uuid,
  add column if not exists term_type public.legal_doc_type,
  add column if not exists term_version text,
  add column if not exists term_published_at timestamptz,
  add column if not exists term_content_sha256 text,
  add column if not exists user_agent text,
  add column if not exists platform text,
  add column if not exists language text,
  add column if not exists acceptance_source text default 'app',
  add column if not exists created_at timestamptz default now();

update public.legal_acceptances
set
  accepted_at = coalesce(accepted_at, now()),
  metadata = coalesce(metadata, '{}'::jsonb),
  acceptance_source = coalesce(nullif(btrim(acceptance_source), ''), 'app'),
  created_at = coalesce(created_at, accepted_at, now());

update public.legal_acceptances a
set
  term_type = coalesce(a.term_type, t.type),
  term_version = coalesce(a.term_version, t.version),
  term_published_at = coalesce(a.term_published_at, t.published_at),
  term_content_sha256 = coalesce(a.term_content_sha256, t.content_sha256)
from public.legal_terms t
where a.term_id = t.id
  and (
    a.term_type is null
    or a.term_version is null
    or a.term_published_at is null
    or a.term_content_sha256 is null
  );

update public.legal_acceptances a
set license_key_snapshot = coalesce(a.license_key_snapshot, l.license_key)
from public.licenses l
where a.license_id = l.id
  and a.license_key_snapshot is null;

with resolved_devices as (
  select
    a.id as acceptance_id,
    d.id as device_id
  from public.legal_acceptances a
  left join lateral (
    select ld.id
    from public.license_devices ld
    where ld.license_id = a.license_id
      and ld.device_fingerprint = a.device_fingerprint
    order by ld.is_active desc nulls last,
             ld.last_used_at desc nulls last,
             ld.activated_at desc nulls last,
             ld.id desc
    limit 1
  ) d on true
)
update public.legal_acceptances a
set license_device_id = coalesce(a.license_device_id, r.device_id)
from resolved_devices r
where a.id = r.acceptance_id
  and a.license_device_id is null
  and r.device_id is not null;

update public.legal_acceptances
set
  user_agent = coalesce(user_agent, nullif(left(metadata->>'userAgent', 1024), '')),
  platform = coalesce(platform, nullif(left(metadata->>'platform', 128), '')),
  language = coalesce(language, nullif(left(metadata->>'language', 64), ''));

alter table public.legal_acceptances
  alter column accepted_at set default now(),
  alter column accepted_at set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null,
  alter column acceptance_source set default 'app',
  alter column acceptance_source set not null,
  alter column created_at set default now(),
  alter column created_at set not null;

do $$
begin
  if not exists (
    select 1 from public.legal_acceptances
    where license_key_snapshot is null
       or term_type is null
       or term_version is null
       or term_published_at is null
       or term_content_sha256 is null
  ) then
    alter table public.legal_acceptances
      alter column license_key_snapshot set not null,
      alter column term_type set not null,
      alter column term_version set not null,
      alter column term_published_at set not null,
      alter column term_content_sha256 set not null;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_acceptances_term_content_sha256_format'
      and conrelid = 'public.legal_acceptances'::regclass
  ) then
    alter table public.legal_acceptances
      add constraint legal_acceptances_term_content_sha256_format
      check (term_content_sha256 is null or term_content_sha256 ~ '^[a-f0-9]{64}$') not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'legal_acceptances_acceptance_source_not_empty'
      and conrelid = 'public.legal_acceptances'::regclass
  ) then
    alter table public.legal_acceptances
      add constraint legal_acceptances_acceptance_source_not_empty
      check (length(btrim(acceptance_source)) > 0) not valid;
  end if;
end $$;

alter table public.legal_acceptances validate constraint legal_acceptances_term_content_sha256_format;
alter table public.legal_acceptances validate constraint legal_acceptances_acceptance_source_not_empty;

alter table public.legal_acceptances
  drop constraint if exists legal_acceptances_license_id_fkey;

alter table public.legal_acceptances
  add constraint legal_acceptances_license_id_fkey
  foreign key (license_id) references public.licenses(id)
  on delete restrict;

create unique index if not exists ux_legal_acceptances_license_term
  on public.legal_acceptances (license_id, term_id);

drop index if exists public.legal_acceptances_license_term_key;

create or replace function public.legal_append_only_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'LEGAL_APPEND_ONLY_UPDATE_BLOCKED on %.%', tg_table_schema, tg_table_name
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    raise exception 'LEGAL_APPEND_ONLY_DELETE_BLOCKED on %.%', tg_table_schema, tg_table_name
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_legal_acceptances_append_only on public.legal_acceptances;
create trigger trg_legal_acceptances_append_only
  before update or delete on public.legal_acceptances
  for each row
  execute function public.legal_append_only_guard();

comment on table public.legal_acceptances is
  'Aceptaciones legales append-only. LEGAL.DB.1: conserva snapshot de licencia, dispositivo, version y hash del documento aceptado.';

-- ---------------------------------------------------------------------------
-- legal_acceptance_events: bitacora append-only de aceptaciones y reintentos
-- ---------------------------------------------------------------------------

create table if not exists public.legal_acceptance_events (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid,
  license_key_snapshot text,
  term_id uuid,
  term_type public.legal_doc_type,
  term_version text,
  term_content_sha256 text,
  license_device_id uuid,
  device_fingerprint text,
  result text not null,
  error_code text,
  already_accepted boolean default false,
  ip_address inet,
  user_agent text,
  platform text,
  language text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint legal_acceptance_events_result_check
    check (result in ('accepted', 'already_accepted', 'rejected', 'rate_limited', 'failed')),
  constraint legal_acceptance_events_term_content_sha256_format
    check (term_content_sha256 is null or term_content_sha256 ~ '^[a-f0-9]{64}$')
);

alter table public.legal_acceptance_events enable row level security;

drop trigger if exists trg_legal_acceptance_events_append_only on public.legal_acceptance_events;
create trigger trg_legal_acceptance_events_append_only
  before update or delete on public.legal_acceptance_events
  for each row
  execute function public.legal_append_only_guard();

create index if not exists idx_legal_acceptance_events_license_created
  on public.legal_acceptance_events (license_id, created_at desc);

create index if not exists idx_legal_acceptance_events_term_created
  on public.legal_acceptance_events (term_id, created_at desc);

comment on table public.legal_acceptance_events is
  'Eventos append-only de aceptacion legal y reintentos. Sin grants directos para anon/authenticated.';

-- ---------------------------------------------------------------------------
-- RLS, policies explicitas deny-all y grants directos
-- ---------------------------------------------------------------------------

alter table public.legal_terms enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.legal_acceptance_events enable row level security;

revoke all on table public.legal_terms from public, anon, authenticated;
revoke all on table public.legal_acceptances from public, anon, authenticated;
revoke all on table public.legal_acceptance_events from public, anon, authenticated;

grant all on table public.legal_terms to service_role;
grant all on table public.legal_acceptances to service_role;
grant all on table public.legal_acceptance_events to service_role;

drop policy if exists "deny direct select" on public.legal_terms;
drop policy if exists "deny direct insert" on public.legal_terms;
drop policy if exists "deny direct update" on public.legal_terms;
drop policy if exists "deny direct delete" on public.legal_terms;
create policy "deny direct select" on public.legal_terms
  for select to anon, authenticated
  using (false);
create policy "deny direct insert" on public.legal_terms
  for insert to anon, authenticated
  with check (false);
create policy "deny direct update" on public.legal_terms
  for update to anon, authenticated
  using (false)
  with check (false);
create policy "deny direct delete" on public.legal_terms
  for delete to anon, authenticated
  using (false);

drop policy if exists "deny direct select" on public.legal_acceptances;
drop policy if exists "deny direct insert" on public.legal_acceptances;
drop policy if exists "deny direct update" on public.legal_acceptances;
drop policy if exists "deny direct delete" on public.legal_acceptances;
create policy "deny direct select" on public.legal_acceptances
  for select to anon, authenticated
  using (false);
create policy "deny direct insert" on public.legal_acceptances
  for insert to anon, authenticated
  with check (false);
create policy "deny direct update" on public.legal_acceptances
  for update to anon, authenticated
  using (false)
  with check (false);
create policy "deny direct delete" on public.legal_acceptances
  for delete to anon, authenticated
  using (false);

drop policy if exists "deny direct select" on public.legal_acceptance_events;
drop policy if exists "deny direct insert" on public.legal_acceptance_events;
drop policy if exists "deny direct update" on public.legal_acceptance_events;
drop policy if exists "deny direct delete" on public.legal_acceptance_events;
create policy "deny direct select" on public.legal_acceptance_events
  for select to anon, authenticated
  using (false);
create policy "deny direct insert" on public.legal_acceptance_events
  for insert to anon, authenticated
  with check (false);
create policy "deny direct update" on public.legal_acceptance_events
  for update to anon, authenticated
  using (false)
  with check (false);
create policy "deny direct delete" on public.legal_acceptance_events
  for delete to anon, authenticated
  using (false);

-- ---------------------------------------------------------------------------
-- RPCs legales: compatibilidad publica y validaciones endurecidas
-- ---------------------------------------------------------------------------

create or replace function public.get_active_legal_terms(
  doc_type_param public.legal_doc_type default 'terms_of_use'::public.legal_doc_type
)
returns table (
  id uuid,
  version text,
  content_html text,
  published_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $$
begin
  return query
  select t.id, t.version, t.content_html, t.published_at
  from public.legal_terms t
  where t.type = doc_type_param
    and t.is_active = true
  order by t.published_at desc
  limit 1;
end;
$$;

create or replace function public.get_active_legal_terms_v2(
  doc_type_param public.legal_doc_type default 'terms_of_use'::public.legal_doc_type
)
returns table (
  id uuid,
  type public.legal_doc_type,
  version text,
  content_html text,
  content_sha256 text,
  published_at timestamptz
)
language plpgsql
security definer
set search_path to ''
as $$
begin
  return query
  select t.id, t.type, t.version, t.content_html, t.content_sha256, t.published_at
  from public.legal_terms t
  where t.type = doc_type_param
    and t.is_active = true
  order by t.published_at desc
  limit 1;
end;
$$;

create or replace function public.register_term_acceptance_unlimited(
  p_license_key text,
  p_term_id uuid,
  p_device_fingerprint text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_now timestamptz := now();
  v_license_id uuid;
  v_license_key_snapshot text := nullif(btrim(coalesce(p_license_key, '')), '');
  v_license_status text;
  v_license_expires_at timestamptz;
  v_license_device_id uuid;
  v_device_fingerprint text := nullif(btrim(coalesce(p_device_fingerprint, '')), '');
  v_term_found boolean := false;
  v_term_active boolean;
  v_term_type public.legal_doc_type;
  v_term_version text;
  v_term_published_at timestamptz;
  v_term_content_sha256 text;
  v_metadata_input jsonb;
  v_metadata jsonb;
  v_user_agent text;
  v_platform text;
  v_language text;
  v_acceptance_id uuid;
  v_accepted_at timestamptz;
  v_already_accepted boolean := false;
begin
  v_metadata_input := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object'
      then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;

  v_user_agent := nullif(left(coalesce(v_metadata_input->>'userAgent', ''), 1024), '');
  v_platform := nullif(left(coalesce(v_metadata_input->>'platform', ''), 128), '');
  v_language := nullif(left(coalesce(v_metadata_input->>'language', ''), 64), '');
  v_metadata := jsonb_strip_nulls(jsonb_build_object(
    'userAgent', v_user_agent,
    'platform', v_platform,
    'language', v_language
  ));

  select l.id, l.license_key, l.status::text, l.expires_at
  into v_license_id, v_license_key_snapshot, v_license_status, v_license_expires_at
  from public.licenses l
  where l.license_key = v_license_key_snapshot
  limit 1;

  if v_license_id is null
    or v_license_status is distinct from 'active'
    or (v_license_expires_at is not null and v_license_expires_at < v_now) then
    insert into public.legal_acceptance_events (
      license_id, license_key_snapshot, term_id, device_fingerprint,
      result, error_code, user_agent, platform, language, metadata, created_at
    ) values (
      v_license_id, v_license_key_snapshot, p_term_id, v_device_fingerprint,
      'rejected', 'LICENSE_NOT_FOUND_OR_INACTIVE',
      v_user_agent, v_platform, v_language, v_metadata, v_now
    );

    return jsonb_build_object('success', false, 'error', 'LICENSE_NOT_FOUND_OR_INACTIVE');
  end if;

  select d.id
  into v_license_device_id
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_fingerprint = v_device_fingerprint
    and d.is_active = true
  order by d.last_used_at desc nulls last, d.activated_at desc nulls last, d.id desc
  limit 1;

  if v_license_device_id is null then
    insert into public.legal_acceptance_events (
      license_id, license_key_snapshot, term_id, device_fingerprint,
      result, error_code, user_agent, platform, language, metadata, created_at
    ) values (
      v_license_id, v_license_key_snapshot, p_term_id, v_device_fingerprint,
      'rejected', 'DEVICE_NOT_AUTHORIZED',
      v_user_agent, v_platform, v_language, v_metadata, v_now
    );

    return jsonb_build_object('success', false, 'error', 'DEVICE_NOT_AUTHORIZED');
  end if;

  select true, t.is_active, t.type, t.version, t.published_at, t.content_sha256
  into v_term_found, v_term_active, v_term_type, v_term_version, v_term_published_at, v_term_content_sha256
  from public.legal_terms t
  where t.id = p_term_id
  limit 1;

  if coalesce(v_term_found, false) is false then
    insert into public.legal_acceptance_events (
      license_id, license_key_snapshot, term_id, license_device_id, device_fingerprint,
      result, error_code, user_agent, platform, language, metadata, created_at
    ) values (
      v_license_id, v_license_key_snapshot, p_term_id, v_license_device_id, v_device_fingerprint,
      'rejected', 'TERM_NOT_FOUND',
      v_user_agent, v_platform, v_language, v_metadata, v_now
    );

    return jsonb_build_object('success', false, 'error', 'TERM_NOT_FOUND');
  end if;

  if v_term_active is not true then
    insert into public.legal_acceptance_events (
      license_id, license_key_snapshot, term_id, term_type, term_version, term_content_sha256,
      license_device_id, device_fingerprint, result, error_code,
      user_agent, platform, language, metadata, created_at
    ) values (
      v_license_id, v_license_key_snapshot, p_term_id, v_term_type, v_term_version, v_term_content_sha256,
      v_license_device_id, v_device_fingerprint, 'rejected', 'TERM_NOT_ACTIVE',
      v_user_agent, v_platform, v_language, v_metadata, v_now
    );

    return jsonb_build_object('success', false, 'error', 'TERM_NOT_ACTIVE');
  end if;

  insert into public.legal_acceptances (
    license_id,
    license_key_snapshot,
    term_id,
    term_type,
    term_version,
    term_published_at,
    term_content_sha256,
    license_device_id,
    device_fingerprint,
    accepted_at,
    metadata,
    user_agent,
    platform,
    language,
    acceptance_source,
    created_at
  ) values (
    v_license_id,
    v_license_key_snapshot,
    p_term_id,
    v_term_type,
    v_term_version,
    v_term_published_at,
    v_term_content_sha256,
    v_license_device_id,
    v_device_fingerprint,
    v_now,
    v_metadata,
    v_user_agent,
    v_platform,
    v_language,
    'app',
    v_now
  )
  on conflict (license_id, term_id) do nothing
  returning id, accepted_at
  into v_acceptance_id, v_accepted_at;

  if v_acceptance_id is null then
    v_already_accepted := true;

    select a.id, a.accepted_at
    into v_acceptance_id, v_accepted_at
    from public.legal_acceptances a
    where a.license_id = v_license_id
      and a.term_id = p_term_id
    limit 1;
  end if;

  insert into public.legal_acceptance_events (
    license_id,
    license_key_snapshot,
    term_id,
    term_type,
    term_version,
    term_content_sha256,
    license_device_id,
    device_fingerprint,
    result,
    already_accepted,
    user_agent,
    platform,
    language,
    metadata,
    created_at
  ) values (
    v_license_id,
    v_license_key_snapshot,
    p_term_id,
    v_term_type,
    v_term_version,
    v_term_content_sha256,
    v_license_device_id,
    v_device_fingerprint,
    case when v_already_accepted then 'already_accepted' else 'accepted' end,
    v_already_accepted,
    v_user_agent,
    v_platform,
    v_language,
    v_metadata,
    v_now
  );

  return jsonb_build_object(
    'success', true,
    'already_accepted', v_already_accepted,
    'acceptance_id', v_acceptance_id,
    'term_id', p_term_id,
    'term_type', v_term_type,
    'term_version', v_term_version,
    'accepted_at', v_accepted_at
  );
exception
  when others then
    begin
      insert into public.legal_acceptance_events (
        license_id, license_key_snapshot, term_id, term_type, term_version, term_content_sha256,
        license_device_id, device_fingerprint, result, error_code,
        user_agent, platform, language, metadata, created_at
      ) values (
        v_license_id, v_license_key_snapshot, p_term_id, v_term_type, v_term_version, v_term_content_sha256,
        v_license_device_id, v_device_fingerprint, 'failed', 'TERM_ACCEPTANCE_FAILED',
        v_user_agent, v_platform, v_language, coalesce(v_metadata, '{}'::jsonb), now()
      );
    exception when others then
      null;
    end;

    return jsonb_build_object('success', false, 'error', 'TERM_ACCEPTANCE_FAILED');
end;
$$;

create or replace function public.register_term_acceptance(
  p_license_key text,
  p_term_id uuid,
  p_device_fingerprint text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_rate_limit jsonb;
  v_now timestamptz := now();
  v_metadata_input jsonb;
  v_metadata jsonb;
  v_user_agent text;
  v_platform text;
  v_language text;
  v_license_id uuid;
  v_license_key_snapshot text := nullif(btrim(coalesce(p_license_key, '')), '');
  v_term_type public.legal_doc_type;
  v_term_version text;
  v_term_content_sha256 text;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := $1,
    p_device_fingerprint := $3,
    p_staff_session_token := null,
    p_rpc_name := 'register_term_acceptance',
    p_scope := 'PROFILE',
    p_max_attempts := 20,
    p_window_seconds := 600,
    p_block_seconds := 600,
    p_code := 'AUTH_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    v_metadata_input := case
      when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object'
        then coalesce(p_metadata, '{}'::jsonb)
      else '{}'::jsonb
    end;

    v_user_agent := nullif(left(coalesce(v_metadata_input->>'userAgent', ''), 1024), '');
    v_platform := nullif(left(coalesce(v_metadata_input->>'platform', ''), 128), '');
    v_language := nullif(left(coalesce(v_metadata_input->>'language', ''), 64), '');
    v_metadata := jsonb_strip_nulls(jsonb_build_object(
      'userAgent', v_user_agent,
      'platform', v_platform,
      'language', v_language
    ));

    begin
      select l.id, l.license_key
      into v_license_id, v_license_key_snapshot
      from public.licenses l
      where l.license_key = v_license_key_snapshot
      limit 1;

      select t.type, t.version, t.content_sha256
      into v_term_type, v_term_version, v_term_content_sha256
      from public.legal_terms t
      where t.id = p_term_id
      limit 1;

      insert into public.legal_acceptance_events (
        license_id, license_key_snapshot, term_id, term_type, term_version, term_content_sha256,
        device_fingerprint, result, error_code, already_accepted,
        user_agent, platform, language, metadata, created_at
      ) values (
        v_license_id, v_license_key_snapshot, p_term_id, v_term_type, v_term_version, v_term_content_sha256,
        nullif(btrim(coalesce(p_device_fingerprint, '')), ''),
        'rate_limited', coalesce(v_rate_limit->>'code', 'AUTH_RATE_LIMITED'), false,
        v_user_agent, v_platform, v_language, v_metadata, v_now
      );
    exception when others then
      null;
    end;

    return public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
  end if;

  return public.register_term_acceptance_unlimited($1, $2, $3, $4)::jsonb;
end;
$$;

-- Grants explicitos de funciones legales. _unlimited permanece cerrado.
revoke all on function public.get_active_legal_terms(public.legal_doc_type) from public, anon, authenticated;
grant execute on function public.get_active_legal_terms(public.legal_doc_type) to anon, authenticated, service_role;

revoke all on function public.get_active_legal_terms_v2(public.legal_doc_type) from public, anon, authenticated;
grant execute on function public.get_active_legal_terms_v2(public.legal_doc_type) to service_role;

revoke all on function public.register_term_acceptance(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.register_term_acceptance(text, uuid, text, jsonb) to anon, authenticated, service_role;

revoke all on function public.register_term_acceptance_unlimited(text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.register_term_acceptance_unlimited(text, uuid, text, jsonb) to service_role;

revoke all on function public.legal_terms_set_content_sha256() from public, anon, authenticated;
grant execute on function public.legal_terms_set_content_sha256() to service_role;

revoke all on function public.legal_terms_guard_immutable() from public, anon, authenticated;
grant execute on function public.legal_terms_guard_immutable() to service_role;

revoke all on function public.legal_append_only_guard() from public, anon, authenticated;
grant execute on function public.legal_append_only_guard() to service_role;
