-- OSS bootstrap compatibility migration.
--
-- The period contract is referenced by the June 24 AI usage migration, but no
-- historical migration in the repository (or reachable Git history) creates
-- it. Keep this migration before that first reference so a new checkout can
-- replay the dependency graph in order.

create table if not exists public.license_periods (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  plan_id uuid references public.plans(id) on delete restrict,
  plan_code_snapshot text,
  plan_name_snapshot text,
  period_type text not null default 'admin_grant'
    check (period_type in ('trial', 'basic_paid', 'pro_paid', 'admin_grant')),
  status text not null default 'active'
    check (status in ('active', 'closed')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  closed_at timestamptz,
  ai_agent_limit integer not null default 0
    check (ai_agent_limit >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Reconcile a pre-existing manually-created table without replacing it.
alter table public.license_periods
  add column if not exists plan_id uuid,
  add column if not exists plan_code_snapshot text,
  add column if not exists plan_name_snapshot text,
  add column if not exists period_type text,
  add column if not exists status text,
  add column if not exists starts_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists ai_agent_limit integer,
  add column if not exists metadata jsonb,
  add column if not exists created_at timestamptz;

alter table public.license_periods
  alter column period_type set default 'admin_grant',
  alter column status set default 'active',
  alter column starts_at set default now(),
  alter column ai_agent_limit set default 0,
  alter column metadata set default '{}'::jsonb,
  alter column created_at set default now();

update public.license_periods
set period_type = 'admin_grant'
where period_type is null;

update public.license_periods
set status = 'active'
where status is null;

update public.license_periods
set starts_at = created_at
where starts_at is null
  and created_at is not null;

update public.license_periods
set starts_at = now()
where starts_at is null;

update public.license_periods
set ai_agent_limit = 0
where ai_agent_limit is null;

update public.license_periods
set metadata = '{}'::jsonb
where metadata is null;

update public.license_periods
set created_at = starts_at
where created_at is null;

alter table public.license_periods
  alter column period_type set not null,
  alter column status set not null,
  alter column starts_at set not null,
  alter column ai_agent_limit set not null,
  alter column metadata set not null,
  alter column created_at set not null;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'license_periods_license_id_fkey'
      and conrelid = 'public.license_periods'::regclass
  ) then
    alter table public.license_periods
      add constraint license_periods_license_id_fkey
      foreign key (license_id) references public.licenses(id) on delete cascade;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'license_periods_plan_id_fkey'
      and conrelid = 'public.license_periods'::regclass
  ) then
    alter table public.license_periods
      add constraint license_periods_plan_id_fkey
      foreign key (plan_id) references public.plans(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'license_periods_period_type_check'
      and conrelid = 'public.license_periods'::regclass
  ) then
    alter table public.license_periods
      add constraint license_periods_period_type_check
      check (period_type in ('trial', 'basic_paid', 'pro_paid', 'admin_grant'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'license_periods_status_check'
      and conrelid = 'public.license_periods'::regclass
  ) then
    alter table public.license_periods
      add constraint license_periods_status_check
      check (status in ('active', 'closed'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'license_periods_ai_agent_limit_check'
      and conrelid = 'public.license_periods'::regclass
  ) then
    alter table public.license_periods
      add constraint license_periods_ai_agent_limit_check
      check (ai_agent_limit >= 0);
  end if;
end;
$migration$;

create unique index if not exists uq_license_periods_one_active
  on public.license_periods (license_id)
  where status = 'active';

create index if not exists idx_license_periods_license_current
  on public.license_periods (license_id, status, starts_at desc, created_at desc);

create index if not exists idx_license_periods_plan_id_fk
  on public.license_periods (plan_id);

alter table public.ai_agent_usage
  add column if not exists period_id uuid;

-- Backfill only an unambiguous historical match. Existing usage rows are not
-- deleted, re-counted, or assigned to an arbitrary period.
with matched as (
  select usage_id, period_id
  from (
    select
      u.id as usage_id,
      p.id as period_id,
      count(*) over (partition by u.id) as candidate_count,
      row_number() over (
        partition by u.id
        order by p.starts_at desc, p.created_at desc, p.id
      ) as candidate_rank
    from public.ai_agent_usage u
    join public.license_periods p
      on p.license_id = u.license_id
     and p.starts_at <= u.created_at
     and (p.ends_at is null or u.created_at < p.ends_at)
    where u.period_id is null
  ) candidates
  where candidate_count = 1
    and candidate_rank = 1
)
update public.ai_agent_usage u
set period_id = matched.period_id
from matched
where u.id = matched.usage_id
  and u.period_id is null;

-- Preserve ambiguity and the reason for leaving period_id nullable. The
-- existing metadata column is the only safe place to record this without
-- changing usage facts or adding a second audit model without evidence.
with ambiguous as (
  select u.id as usage_id, count(*)::integer as candidate_count
  from public.ai_agent_usage u
  join public.license_periods p
    on p.license_id = u.license_id
   and p.starts_at <= u.created_at
   and (p.ends_at is null or u.created_at < p.ends_at)
  where u.period_id is null
  group by u.id
  having count(*) > 1
)
update public.ai_agent_usage u
set metadata = coalesce(u.metadata, '{}'::jsonb) || jsonb_build_object(
  'period_reconciliation', jsonb_build_object(
    'status', 'ambiguous',
    'candidate_count', ambiguous.candidate_count,
    'strategy', 'left_unassigned',
    'migration', 'OSS.1.5.4'
  )
)
from ambiguous
where u.id = ambiguous.usage_id
  and u.period_id is null;

with unmatched as (
  select u.id as usage_id
  from public.ai_agent_usage u
  where u.period_id is null
    and not exists (
      select 1
      from public.license_periods p
      where p.license_id = u.license_id
        and p.starts_at <= u.created_at
        and (p.ends_at is null or u.created_at < p.ends_at)
    )
)
update public.ai_agent_usage u
set metadata = coalesce(u.metadata, '{}'::jsonb) || jsonb_build_object(
  'period_reconciliation', jsonb_build_object(
    'status', 'unmatched',
    'strategy', 'left_unassigned',
    'migration', 'OSS.1.5.4'
  )
)
from unmatched
where u.id = unmatched.usage_id
  and u.period_id is null;

create unique index if not exists uq_license_periods_id_license_id
  on public.license_periods (id, license_id);

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_agent_usage_license_period_fkey'
      and conrelid = 'public.ai_agent_usage'::regclass
  ) then
    alter table public.ai_agent_usage
      add constraint ai_agent_usage_license_period_fkey
      foreign key (period_id, license_id)
      references public.license_periods(id, license_id)
      on delete restrict;
  end if;
end;
$migration$;

alter table public.license_periods enable row level security;

drop policy if exists "license_periods_no_client_select" on public.license_periods;
create policy "license_periods_no_client_select"
  on public.license_periods
  for select
  using (false);

drop policy if exists "license_periods_no_client_insert" on public.license_periods;
create policy "license_periods_no_client_insert"
  on public.license_periods
  for insert
  with check (false);

drop policy if exists "license_periods_no_client_update" on public.license_periods;
create policy "license_periods_no_client_update"
  on public.license_periods
  for update
  using (false)
  with check (false);

drop policy if exists "license_periods_no_client_delete" on public.license_periods;
create policy "license_periods_no_client_delete"
  on public.license_periods
  for delete
  using (false);

revoke all on table public.license_periods from public;
revoke all on table public.license_periods from anon;
revoke all on table public.license_periods from authenticated;

create or replace function public.ensure_current_license_period(
  p_license_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_plan record;
  v_period_id uuid;
  v_period_type text;
  v_period_end timestamptz;
  v_ai_limit integer;
  v_now timestamptz := now();
begin
  select
    l.id,
    l.plan_id,
    l.status,
    l.expires_at,
    l.is_lifetime,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  where l.id = p_license_id
  for update;

  if not found
     or v_license.status is distinct from 'active'
     or (v_license.expires_at is not null and v_license.expires_at < v_now) then
    return null;
  end if;

  select p.id,
         p.code,
         p.name,
         coalesce(p.features, '{}'::jsonb) as plan_features
  into v_plan
  from public.plans p
  where p.id = v_license.plan_id;

  if not found then
    return null;
  end if;

  update public.license_periods
  set status = 'closed',
      closed_at = coalesce(closed_at, v_now)
  where license_id = v_license.id
    and status = 'active'
    and ends_at is not null
    and ends_at <= v_now;

  select lp.id
  into v_period_id
  from public.license_periods lp
  where lp.license_id = v_license.id
    and lp.status = 'active'
    and lp.starts_at <= v_now
    and (lp.ends_at is null or v_now < lp.ends_at)
  order by lp.starts_at desc, lp.created_at desc, lp.id
  limit 1;

  if v_period_id is not null then
    return v_period_id;
  end if;

  if exists (
    select 1
    from public.license_periods lp
    where lp.license_id = v_license.id
      and lp.status = 'active'
      and lp.starts_at > v_now
  ) then
    return null;
  end if;

  v_period_type := case
    when v_plan.code = 'free_trial' then 'trial'
    when v_plan.code = 'pro_monthly' then 'pro_paid'
    when v_plan.code = 'basic_monthly' then 'basic_paid'
    else 'admin_grant'
  end;

  v_period_end := case
    when coalesce(v_license.is_lifetime, false) or v_plan.code = 'free_trial' then null
    else coalesce(v_license.expires_at, v_now + interval '1 month')
  end;

  v_ai_limit := greatest(coalesce((
    (
      coalesce(v_plan.plan_features, '{}'::jsonb)
      || coalesce(v_license.license_features, '{}'::jsonb)
    )->>'ai_agent_total_limit'
  )::integer, 0), 0);

  insert into public.license_periods (
    license_id,
    plan_id,
    plan_code_snapshot,
    plan_name_snapshot,
    period_type,
    status,
    starts_at,
    ends_at,
    ai_agent_limit,
    metadata
  ) values (
    v_license.id,
    v_plan.id,
    v_plan.code,
    v_plan.name,
    v_period_type,
    'active',
    v_now,
    v_period_end,
    v_ai_limit,
    jsonb_build_object(
      'source', 'ensure_current_license_period',
      'migration', 'OSS.1.5.4'
    )
  )
  returning id into v_period_id;

  return v_period_id;
end;
$function$;

revoke all on function public.ensure_current_license_period(uuid) from public;
revoke all on function public.ensure_current_license_period(uuid) from anon;
revoke all on function public.ensure_current_license_period(uuid) from authenticated;
grant execute on function public.ensure_current_license_period(uuid) to service_role;

-- Replace the total-license reservation with the period-scoped contract before
-- the later June 24 lookup migration creates its period index and RPC version.
create or replace function public.begin_ai_agent_analysis(
  p_license_key text,
  p_device_fingerprint text,
  p_device_security_token text,
  p_staff_session_token text default null::text,
  p_agent_type text default 'unknown'::text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_device record;
  v_staff_session record;
  v_period record;
  v_staff_user_id uuid;
  v_effective_features jsonb;
  v_period_id uuid;
  v_limit integer;
  v_used_count integer;
  v_usage_id uuid;
begin
  select
    l.id,
    l.status,
    l.expires_at,
    p.code as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if not found or v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if v_license.status <> 'active' or (v_license.expires_at is not null and v_license.expires_at < now()) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no está activa.');
  end if;

  v_effective_features := coalesce(v_license.effective_features, '{}'::jsonb);

  if coalesce((v_effective_features->>'ai_agents')::boolean, false) = false then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENTS_NOT_AVAILABLE',
      'message', 'Los agentes de IA solo están disponibles en el plan Pro.',
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name
    );
  end if;

  select d.id,
         d.is_active,
         d.security_token,
         d.previous_security_token,
         d.device_role,
         d.staff_user_id
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null or v_device.is_active = false then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no está autorizado para esta licencia.');
  end if;

  if v_device.security_token is not null then
    if coalesce(p_device_security_token, '') = '' then
      return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Se requiere token de dispositivo.');
    elsif p_device_security_token <> v_device.security_token
       and p_device_security_token <> coalesce(v_device.previous_security_token, '') then
      return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token de dispositivo inválido.');
    end if;
  end if;

  if coalesce(v_device.device_role, 'admin') = 'staff' then
    if coalesce(p_staff_session_token, '') = '' then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Se requiere sesión staff válida.');
    end if;

    select candidate.staff_user_id,
           candidate.expires_at,
           candidate.revoked_at,
           s.is_active as staff_is_active
    into v_staff_session
    from (
      select ss.staff_user_id,
             ss.session_token_hash,
             ss.expires_at,
             ss.revoked_at,
             ss.created_at
      from public.license_staff_sessions ss
      where ss.license_id = v_license.id
        and ss.device_id = v_device.id
        and ss.revoked_at is null
        and ss.expires_at > now()
      order by ss.created_at desc
      limit 3
    ) candidate
    join public.license_staff_users s on s.id = candidate.staff_user_id
    where extensions.crypt(coalesce(p_staff_session_token, ''), candidate.session_token_hash) = candidate.session_token_hash
    limit 1;

    if not found
       or v_staff_session.revoked_at is not null
       or v_staff_session.expires_at < now()
       or coalesce(v_staff_session.staff_is_active, false) is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesión staff inválida o expirada.');
    end if;

    v_staff_user_id := v_staff_session.staff_user_id;
  end if;

  v_period_id := public.ensure_current_license_period(v_license.id);
  if v_period_id is null then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_PERIOD_NOT_FOUND', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', true);
  end if;

  select * into v_period
  from public.license_periods
  where id = v_period_id
    and license_id = v_license.id;

  if not found then
    return jsonb_build_object('success', false, 'code', 'AI_AGENT_PERIOD_NOT_FOUND', 'limit', 0, 'used', 0, 'remaining', 0, 'ai_agents', true);
  end if;

  v_limit := greatest(coalesce(v_period.ai_agent_limit, 0), 0);
  if v_limit <= 0 then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENT_LIMIT_DISABLED',
      'message', 'Esta licencia no tiene análisis de IA disponibles.',
      'limit', v_limit,
      'used', 0,
      'remaining', 0,
      'period_id', v_period_id
    );
  end if;

  select count(*)::integer into v_used_count
  from public.ai_agent_usage u
  where u.license_id = v_license.id
    and u.period_id = v_period_id
    and u.status in ('reserved', 'completed');

  if v_used_count >= v_limit then
    return jsonb_build_object(
      'success', false,
      'code', 'AI_AGENT_LIMIT_REACHED',
      'message', 'Ya se alcanzó el límite de análisis de IA para este periodo.',
      'limit', v_limit,
      'used', v_used_count,
      'remaining', 0,
      'period_id', v_period_id
    );
  end if;

  insert into public.ai_agent_usage (
    license_id,
    period_id,
    device_id,
    staff_user_id,
    agent_type,
    status,
    metadata
  ) values (
    v_license.id,
    v_period_id,
    v_device.id,
    v_staff_user_id,
    coalesce(nullif(trim(p_agent_type), ''), 'unknown'),
    'reserved',
    coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'period_id', v_period_id
      )
  )
  returning id into v_usage_id;

  return jsonb_build_object(
    'success', true,
    'usage_id', v_usage_id,
    'limit', v_limit,
    'used', v_used_count + 1,
    'remaining', greatest(v_limit - (v_used_count + 1), 0),
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'period_id', v_period_id,
    'period_type', v_period.period_type,
    'period_status', v_period.status,
    'period_start', v_period.starts_at,
    'period_end', v_period.ends_at
  );
end;
$function$;

revoke all on function public.begin_ai_agent_analysis(text, text, text, text, text, jsonb) from public;
revoke all on function public.begin_ai_agent_analysis(text, text, text, text, text, jsonb) from anon;
revoke all on function public.begin_ai_agent_analysis(text, text, text, text, text, jsonb) from authenticated;
grant execute on function public.begin_ai_agent_analysis(text, text, text, text, text, jsonb) to service_role;

revoke all on function public.complete_ai_agent_analysis(uuid, boolean, integer, integer, integer, text, jsonb) from public;
revoke all on function public.complete_ai_agent_analysis(uuid, boolean, integer, integer, integer, text, jsonb) from anon;
revoke all on function public.complete_ai_agent_analysis(uuid, boolean, integer, integer, integer, text, jsonb) from authenticated;
grant execute on function public.complete_ai_agent_analysis(uuid, boolean, integer, integer, integer, text, jsonb) to service_role;
