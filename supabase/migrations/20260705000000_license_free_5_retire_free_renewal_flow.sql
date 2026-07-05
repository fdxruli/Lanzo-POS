-- FASE LICENSE.FREE.5
-- Retira la renovacion FREE como flujo principal.
-- Mantiene public.renew_license_free(text,text) como RPC de compatibilidad
-- sin extender vencimientos ni registrar renovaciones de 3 meses.

create or replace function public.renew_license_free(
  license_key_param text,
  device_fingerprint_param text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_updated_license record;
  v_device_authorized boolean := false;
  v_now timestamptz := now();
  v_period_id uuid;
  v_previous_license_type text;
  v_previous_expires_at timestamptz;
  v_previous_duration_months integer;
  v_previous_is_lifetime boolean;
  v_product_name_corrected boolean := false;
begin
  select
    l.id,
    l.license_key,
    l.plan_id,
    l.status,
    l.license_type,
    l.duration_months,
    l.expires_at,
    coalesce(l.is_lifetime, false) as is_lifetime,
    l.product_name,
    l.features,
    p.code as plan_code,
    p.name as plan_name
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = license_key_param;

  if v_license.id is null then
    return jsonb_build_object(
      'success', false,
      'code', 'LICENSE_NOT_FOUND',
      'message', 'Licencia no encontrada.'
    );
  end if;

  select exists (
    select 1
    from public.license_devices d
    where d.license_id = v_license.id
      and d.device_fingerprint = device_fingerprint_param
      and d.is_active = true
  ) into v_device_authorized;

  if not v_device_authorized then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_NOT_AUTHORIZED',
      'message', 'Dispositivo no autorizado para esta licencia.'
    );
  end if;

  if lower(coalesce(v_license.status, '')) in ('suspended', 'cancelled', 'revoked', 'blocked', 'banned') then
    return jsonb_build_object(
      'success', false,
      'code', 'LICENSE_NOT_ACTIVE',
      'message', 'La licencia no está activa.'
    );
  end if;

  if coalesce(v_license.plan_code, '') <> 'free_trial' then
    return jsonb_build_object(
      'success', false,
      'code', 'RENEWAL_NOT_APPLICABLE',
      'message', 'Esta licencia no usa renovación FREE.'
    );
  end if;

  if lower(coalesce(v_license.status, '')) not in ('active', 'expired') then
    return jsonb_build_object(
      'success', false,
      'code', 'LICENSE_NOT_ACTIVE',
      'message', 'La licencia no está activa.'
    );
  end if;

  if lower(coalesce(v_license.license_type, '')) = 'free'
     and v_license.is_lifetime = true
     and v_license.expires_at is null
     and v_license.duration_months is null then
    if coalesce(v_license.product_name, '') <> 'Lanzo POS Free' then
      update public.licenses
      set product_name = 'Lanzo POS Free'
      where id = v_license.id;

      v_product_name_corrected := true;
    end if;

    return jsonb_build_object(
      'success', true,
      'code', 'FREE_ALREADY_LIFETIME',
      'message', 'Tu licencia FREE ya es permanente.',
      'status', 'active',
      'expires_at', null,
      'new_expiry', null,
      'newExpiry', null,
      'duration_months', null,
      'is_lifetime', true,
      'license_type', 'free',
      'product_name', 'Lanzo POS Free',
      'plan_code', v_license.plan_code,
      'plan_name', coalesce(v_license.plan_name, 'Plan Free'),
      'product_name_corrected', v_product_name_corrected,
      'details', jsonb_build_object(
        'license_key', v_license.license_key,
        'status', 'active',
        'expires_at', null,
        'duration_months', null,
        'is_lifetime', true,
        'license_type', 'free',
        'product_name', 'Lanzo POS Free',
        'plan_code', v_license.plan_code,
        'plan_name', coalesce(v_license.plan_name, 'Plan Free'),
        'features', coalesce(v_license.features, '{}'::jsonb)
      )
    );
  end if;

  v_previous_license_type := v_license.license_type;
  v_previous_expires_at := v_license.expires_at;
  v_previous_duration_months := v_license.duration_months;
  v_previous_is_lifetime := v_license.is_lifetime;

  update public.licenses
  set
    license_type = 'free',
    duration_months = null,
    expires_at = null,
    is_lifetime = true,
    product_name = 'Lanzo POS Free',
    status = 'active'
  where id = v_license.id;

  select
    l.id,
    l.license_key,
    l.plan_id,
    l.status,
    l.license_type,
    l.duration_months,
    l.expires_at,
    coalesce(l.is_lifetime, false) as is_lifetime,
    l.product_name,
    l.features,
    p.code as plan_code,
    p.name as plan_name
  into v_updated_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = v_license.id;

  if lower(coalesce(v_updated_license.license_type, '')) <> 'free'
     or v_updated_license.duration_months is not null
     or v_updated_license.expires_at is not null
     or v_updated_license.is_lifetime is not true
     or coalesce(v_updated_license.product_name, '') <> 'Lanzo POS Free'
     or lower(coalesce(v_updated_license.status, '')) <> 'active' then
    update public.licenses
    set
      license_type = 'free',
      duration_months = null,
      expires_at = null,
      is_lifetime = true,
      product_name = 'Lanzo POS Free',
      status = 'active'
    where id = v_license.id;
  end if;

  select lp.id
  into v_period_id
  from public.license_periods lp
  where lp.license_id = v_license.id
    and lp.status = 'active'
  order by lp.starts_at desc, lp.created_at desc
  limit 1;

  if v_period_id is null then
    select lp.id
    into v_period_id
    from public.license_periods lp
    where lp.license_id = v_license.id
    order by lp.starts_at desc, lp.created_at desc
    limit 1;
  end if;

  if v_period_id is not null then
    update public.license_periods
    set
      plan_id = v_license.plan_id,
      plan_code_snapshot = v_license.plan_code,
      plan_name_snapshot = coalesce(v_license.plan_name, 'Plan Free'),
      period_type = 'trial',
      status = 'active',
      ends_at = null,
      closed_at = null,
      ai_agent_limit = 0,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'renew_license_free_compat',
        'license_kind', 'free_lifetime',
        'license_type', 'free',
        'is_lifetime', true,
        'expires_at', null,
        'previous_license_type', v_previous_license_type,
        'previous_expires_at', v_previous_expires_at,
        'previous_duration_months', v_previous_duration_months,
        'previous_is_lifetime', v_previous_is_lifetime
      )
    where id = v_period_id;
  else
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
    values (
      v_license.id,
      v_license.plan_id,
      v_license.plan_code,
      coalesce(v_license.plan_name, 'Plan Free'),
      'trial',
      'active',
      v_now,
      null,
      0,
      jsonb_build_object(
        'source', 'renew_license_free_compat',
        'license_kind', 'free_lifetime',
        'license_type', 'free',
        'is_lifetime', true,
        'expires_at', null,
        'previous_active_period_missing', true
      )
    )
    returning id into v_period_id;
  end if;

  update public.license_periods
  set
    status = 'closed',
    closed_at = coalesce(closed_at, v_now)
  where license_id = v_license.id
    and id <> v_period_id
    and status = 'active';

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license.license_key,
    'FREE_LICENSE_MIGRATED_LIFETIME_FROM_RENEWAL',
    jsonb_build_object(
      'source', 'renew_license_free_compat',
      'previous_license_type', v_previous_license_type,
      'new_license_type', 'free',
      'previous_expires_at', v_previous_expires_at,
      'new_expires_at', null,
      'previous_duration_months', v_previous_duration_months,
      'new_duration_months', null,
      'previous_is_lifetime', v_previous_is_lifetime,
      'is_lifetime', true,
      'device_fingerprint', device_fingerprint_param,
      'migrated_at', v_now,
      'period_id', v_period_id
    )
  );

  return jsonb_build_object(
    'success', true,
    'code', 'FREE_MIGRATED_TO_LIFETIME',
    'message', 'Tu licencia FREE ahora es permanente.',
    'status', 'active',
    'expires_at', null,
    'new_expiry', null,
    'newExpiry', null,
    'duration_months', null,
    'is_lifetime', true,
    'license_type', 'free',
    'product_name', 'Lanzo POS Free',
    'plan_code', v_license.plan_code,
    'plan_name', coalesce(v_license.plan_name, 'Plan Free'),
    'period_id', v_period_id,
    'details', jsonb_build_object(
      'license_key', v_license.license_key,
      'status', 'active',
      'expires_at', null,
      'duration_months', null,
      'is_lifetime', true,
      'license_type', 'free',
      'product_name', 'Lanzo POS Free',
      'plan_code', v_license.plan_code,
      'plan_name', coalesce(v_license.plan_name, 'Plan Free'),
      'period_id', v_period_id,
      'features', coalesce(v_license.features, '{}'::jsonb)
    )
  );
exception when others then
  return jsonb_build_object(
    'success', false,
    'code', 'FREE_RENEWAL_COMPAT_FAILED',
    'message', 'No se pudo revisar la licencia FREE.'
  );
end;
$function$;
