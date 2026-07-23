-- Automatiza la sincronizacion de licencias con plans y aplica limites al bajar de plan.

create or replace function public.sync_license_plan_snapshot()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plan record;
  v_free_plan_id uuid;
  v_should_sync boolean := false;
  v_existing_features jsonb;
  v_base_features jsonb;
  v_plan_features jsonb;
begin
  if tg_op = 'INSERT' then
    v_should_sync := true;
  else
    v_should_sync :=
      new.plan_id is distinct from old.plan_id
      or (
        new.license_type is distinct from old.license_type
        and lower(coalesce(new.license_type, '')) in ('trial', 'free_trial')
      );
  end if;

  if not v_should_sync then
    return new;
  end if;

  -- Compatibilidad con cambios manuales antiguos: si alguien cambia solo license_type a trial,
  -- la licencia se mueve automaticamente al plan free_trial.
  if lower(coalesce(new.license_type, '')) in ('trial', 'free_trial')
     and (
       tg_op = 'INSERT'
       or new.plan_id is not distinct from old.plan_id
     ) then
    select p.id
    into v_free_plan_id
    from public.plans p
    where p.code = 'free_trial'
      and p.is_active = true
    limit 1;

    if v_free_plan_id is not null then
      new.plan_id := v_free_plan_id;
    end if;
  end if;

  if new.plan_id is null then
    return new;
  end if;

  select *
  into v_plan
  from public.plans p
  where p.id = new.plan_id;

  if v_plan.id is null then
    return new;
  end if;

  v_existing_features := coalesce(new.features, '{}'::jsonb);
  v_plan_features := coalesce(v_plan.features, '{}'::jsonb);

  -- Quitamos llaves controladas por plan para que un downgrade no herede permisos Pro.
  v_base_features :=
    (
      v_existing_features
      - 'staff_roles'
      - 'realtime_license_sync'
      - 'max_rubros'
      - 'allowed_rubros'
    )
    || jsonb_build_object(
      'full_access',
        case
          when v_existing_features ? 'full_access' then coalesce((v_existing_features->>'full_access')::boolean, true)
          else true
        end,
      'max_rubros', 1,
      'allowed_rubros', jsonb_build_array('*')
    );

  new.features := v_base_features || v_plan_features;
  new.max_devices := coalesce(v_plan.max_devices, new.max_devices, 1);
  new.price := coalesce(v_plan.price, new.price);

  new.product_name := case
    when v_plan.code = 'free_trial' then 'Lanzo POS (FREE-TRIAL)'
    when v_plan.code = 'basic_monthly' then 'Lanzo POS Basico'
    when v_plan.code = 'pro_monthly' then 'Lanzo POS Pro'
    else coalesce(nullif(trim(new.product_name), ''), 'Lanzo POS - ' || v_plan.name)
  end;

  new.license_type := case
    when v_plan.code = 'free_trial' then 'trial'
    when v_plan.code like '%monthly' then 'subscription'
    else coalesce(nullif(trim(new.license_type), ''), v_plan.code)
  end;

  return new;
end;
$$;

comment on function public.sync_license_plan_snapshot() is
'Sincroniza licenses con plans al insertar o al cambiar plan_id/license_type, evitando que permisos Pro queden heredados en downgrades.';

drop trigger if exists trg_sync_license_plan_snapshot_before_write on public.licenses;
create trigger trg_sync_license_plan_snapshot_before_write
before insert or update on public.licenses
for each row
execute function public.sync_license_plan_snapshot();

create or replace function public.enforce_license_plan_limits_after_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_plan_code text;
  v_plan_name text;
  v_features jsonb;
  v_staff_roles_enabled boolean;
  v_max_devices integer;
  v_active_before integer := 0;
  v_active_after integer := 0;
  v_staff_blocked integer := 0;
  v_over_limit_blocked integer := 0;
  v_now timestamptz := now();
begin
  select p.code, p.name, coalesce(p.features, '{}'::jsonb) || coalesce(new.features, '{}'::jsonb)
  into v_plan_code, v_plan_name, v_features
  from public.plans p
  where p.id = new.plan_id;

  v_staff_roles_enabled := coalesce((v_features->>'staff_roles')::boolean, false);
  v_max_devices := greatest(coalesce(new.max_devices, 1), 0);

  select count(*)
  into v_active_before
  from public.license_devices d
  where d.license_id = new.id
    and d.is_active = true;

  -- Si el plan destino no incluye staff, se bloquean dispositivos staff y se revocan sesiones staff.
  if not v_staff_roles_enabled then
    with blocked as (
      update public.license_devices d
      set
        is_active = false,
        security_token = null,
        previous_security_token = null,
        last_check_at = v_now,
        device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
          'license_block', jsonb_build_object(
            'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
            'message', 'Esta licencia cambio a un plan que no incluye usuarios staff. Cambia la licencia o pide al administrador actualizar el plan.',
            'plan_code', v_plan_code,
            'plan_name', v_plan_name,
            'blocked_at', v_now
          )
        )
      where d.license_id = new.id
        and d.is_active = true
        and coalesce(d.device_role, 'staff') = 'staff'
      returning d.id
    )
    select count(*) into v_staff_blocked from blocked;

    update public.license_staff_sessions s
    set
      revoked_at = coalesce(s.revoked_at, v_now),
      metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
        'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
        'revoked_at', v_now,
        'plan_code', v_plan_code,
        'plan_name', v_plan_name
      )
    where s.license_id = new.id
      and s.revoked_at is null;
  end if;

  -- Si el nuevo plan permite menos dispositivos, se conserva primero el admin mas antiguo
  -- y se bloquean los sobrantes.
  with ranked_devices as (
    select
      d.id,
      row_number() over (
        order by
          case when coalesce(d.device_role, 'staff') = 'admin' then 0 else 1 end,
          d.activated_at asc nulls last,
          d.last_used_at desc nulls last,
          d.id asc
      ) as keep_rank
    from public.license_devices d
    where d.license_id = new.id
      and d.is_active = true
  ), blocked as (
    update public.license_devices d
    set
      is_active = false,
      security_token = null,
      previous_security_token = null,
      last_check_at = v_now,
      device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
        'license_block', jsonb_build_object(
          'reason', 'PLAN_DOWNGRADE_DEVICE_LIMIT',
          'message', 'Esta licencia cambio a un plan con menos dispositivos permitidos. Cambia la licencia para continuar en este equipo.',
          'plan_code', v_plan_code,
          'plan_name', v_plan_name,
          'max_devices', v_max_devices,
          'blocked_at', v_now
        )
      )
    from ranked_devices r
    where d.id = r.id
      and r.keep_rank > v_max_devices
    returning d.id
  )
  select count(*) into v_over_limit_blocked from blocked;

  select count(*)
  into v_active_after
  from public.license_devices d
  where d.license_id = new.id
    and d.is_active = true;

  if v_staff_blocked > 0 or v_over_limit_blocked > 0 then
    insert into public.license_events (license_key, event_type, metadata)
    values (
      new.license_key,
      'LICENSE_UPDATE',
      jsonb_build_object(
        'source', 'enforce_license_plan_limits_after_change',
        'reason', 'PLAN_LIMITS_ENFORCED',
        'plan', v_plan_code,
        'plan_name', v_plan_name,
        'staff_devices_blocked', v_staff_blocked,
        'over_limit_devices_blocked', v_over_limit_blocked,
        'active_devices_before', v_active_before,
        'active_devices_after', v_active_after,
        'max_devices', v_max_devices
      )
    );
  end if;

  return null;
end;
$$;

comment on function public.enforce_license_plan_limits_after_change() is
'Aplica limites de plan despues de un cambio: bloquea staff si el plan no lo permite y desactiva dispositivos sobrantes.';

drop trigger if exists aa_enforce_license_plan_limits_after_update on public.licenses;
create trigger aa_enforce_license_plan_limits_after_update
after update on public.licenses
for each row
when (
  old.plan_id is distinct from new.plan_id
  or old.max_devices is distinct from new.max_devices
  or old.features is distinct from new.features
  or old.license_type is distinct from new.license_type
)
execute function public.enforce_license_plan_limits_after_change();

create or replace function public.admin_change_license_plan(
  p_license_key text,
  p_target_plan_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_target_plan public.plans%rowtype;
  v_license_before record;
  v_license_after record;
  v_active_devices integer;
  v_staff_devices integer;
begin
  if nullif(trim(p_license_key), '') is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED');
  end if;

  if nullif(trim(p_target_plan_code), '') is null then
    return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_REQUIRED');
  end if;

  select *
  into v_target_plan
  from public.plans p
  where p.code = p_target_plan_code
    and p.is_active = true
  limit 1;

  if v_target_plan.id is null then
    return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_NOT_FOUND');
  end if;

  select
    l.id,
    l.license_key,
    l.plan_id,
    p.code as plan_code,
    p.name as plan_name,
    l.license_type,
    l.product_name,
    l.max_devices,
    l.features
  into v_license_before
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update;

  if v_license_before.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  update public.licenses l
  set plan_id = v_target_plan.id
  where l.id = v_license_before.id
  returning
    l.id,
    l.license_key,
    l.plan_id,
    l.license_type,
    l.product_name,
    l.max_devices,
    l.features
  into v_license_after;

  select count(*)
  into v_active_devices
  from public.license_devices d
  where d.license_id = v_license_before.id
    and d.is_active = true;

  select count(*)
  into v_staff_devices
  from public.license_devices d
  where d.license_id = v_license_before.id
    and d.is_active = true
    and coalesce(d.device_role, 'staff') = 'staff';

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'PLAN_CHANGED',
    jsonb_build_object(
      'source', 'admin_change_license_plan',
      'reason', coalesce(p_reason, 'manual_admin_plan_change'),
      'from_plan', v_license_before.plan_code,
      'from_plan_name', v_license_before.plan_name,
      'to_plan', v_target_plan.code,
      'to_plan_name', v_target_plan.name,
      'active_devices_after_enforcement', v_active_devices,
      'active_staff_devices_after_enforcement', v_staff_devices,
      'max_devices', v_license_after.max_devices
    )
  );

  return jsonb_build_object(
    'success', true,
    'license_key', p_license_key,
    'from_plan', v_license_before.plan_code,
    'to_plan', v_target_plan.code,
    'product_name', v_license_after.product_name,
    'license_type', v_license_after.license_type,
    'max_devices', v_license_after.max_devices,
    'features', v_license_after.features,
    'active_devices_after_enforcement', v_active_devices,
    'active_staff_devices_after_enforcement', v_staff_devices
  );
end;
$$;

comment on function public.admin_change_license_plan(text, text, text) is
'Cambia una licencia a un plan por code y deja que los triggers sincronicen snapshot, eventos y limites de dispositivos.';

revoke all on function public.admin_change_license_plan(text, text, text) from public;
revoke all on function public.admin_change_license_plan(text, text, text) from anon;
revoke all on function public.admin_change_license_plan(text, text, text) from authenticated;
;
