-- FASE LICENSE.FREE.3
-- Migrar licencias FREE existentes a permanentes.
--
-- Alcance:
-- - Solo licencias con plans.code = 'free_trial'.
-- - Solo estados migrables: active, expired.
-- - No toca PRO, BASIC, otros planes, dispositivos, tokens, staff, cloud, caja,
--   restaurante, inventario, ventas ni frontend.
-- - Omite licencias FREE que ya estaban normalizadas como permanentes.
--
-- Nota de compatibilidad:
-- period_type permanece como 'trial' porque el constraint actual de
-- public.license_periods todavia no contempla un tipo free_lifetime.

create temp table tmp_license_free_3_candidates on commit drop as
select
  l.id,
  l.license_key,
  l.plan_id,
  p.code as plan_code,
  p.name as plan_name,
  l.status as previous_status,
  l.license_type as previous_license_type,
  l.product_name as previous_product_name,
  l.expires_at as previous_expires_at,
  l.duration_months as previous_duration_months,
  l.is_lifetime as previous_is_lifetime,
  now() as migrated_at
from public.licenses l
join public.plans p on p.id = l.plan_id
where p.code = 'free_trial'
  and l.status in ('active', 'expired')
  and (
    coalesce(l.license_type, '') <> 'free'
    or l.duration_months is not null
    or l.expires_at is not null
    or coalesce(l.is_lifetime, false) = false
    or coalesce(l.product_name, '') <> 'Lanzo POS Free'
  );

create index tmp_license_free_3_candidates_id_idx
  on tmp_license_free_3_candidates (id);

update public.licenses l
set
  license_type = 'free',
  duration_months = null,
  expires_at = null,
  is_lifetime = true,
  product_name = 'Lanzo POS Free',
  status = 'active'
from tmp_license_free_3_candidates c
where l.id = c.id;

update public.license_periods lp
set
  ends_at = null,
  status = 'active',
  metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
    'license_kind', 'free_lifetime',
    'is_lifetime', true,
    'migrated_by', 'license_free_3',
    'migrated_at', c.migrated_at,
    'previous_ends_at', lp.ends_at,
    'previous_period_type', lp.period_type
  )
from tmp_license_free_3_candidates c
where lp.license_id = c.id
  and lp.status = 'active';

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
)
select
  c.id,
  c.plan_id,
  c.plan_code,
  c.plan_name,
  'trial',
  'active',
  c.migrated_at,
  null,
  0,
  jsonb_build_object(
    'source', 'license_free_3',
    'license_kind', 'free_lifetime',
    'license_type', 'free',
    'is_lifetime', true,
    'previous_active_period_missing', true,
    'migrated_at', c.migrated_at
  )
from tmp_license_free_3_candidates c
where not exists (
  select 1
  from public.license_periods lp
  where lp.license_id = c.id
    and lp.status = 'active'
);

insert into public.license_events (
  license_key,
  event_type,
  metadata
)
select
  c.license_key,
  'FREE_LICENSE_MIGRATED_LIFETIME',
  jsonb_build_object(
    'source', 'license_free_3',
    'previous_status', c.previous_status,
    'new_status', 'active',
    'previous_license_type', c.previous_license_type,
    'new_license_type', 'free',
    'previous_product_name', c.previous_product_name,
    'new_product_name', 'Lanzo POS Free',
    'previous_expires_at', c.previous_expires_at,
    'new_expires_at', null,
    'previous_duration_months', c.previous_duration_months,
    'new_duration_months', null,
    'previous_is_lifetime', c.previous_is_lifetime,
    'is_lifetime', true,
    'migrated_at', c.migrated_at
  )
from tmp_license_free_3_candidates c;

do $$
declare
  v_remaining integer;
begin
  select count(*)
  into v_remaining
  from public.licenses l
  join tmp_license_free_3_candidates c on c.id = l.id
  where l.expires_at is not null
     or l.duration_months is not null
     or coalesce(l.is_lifetime, false) = false
     or l.license_type <> 'free'
     or l.product_name <> 'Lanzo POS Free'
     or l.status <> 'active';

  if v_remaining <> 0 then
    raise exception 'LICENSE.FREE.3 validation failed: % migrated licenses still have legacy FREE fields', v_remaining;
  end if;
end;
$$;
;
