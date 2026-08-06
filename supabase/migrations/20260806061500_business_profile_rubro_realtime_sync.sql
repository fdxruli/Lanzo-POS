-- BUSINESS.PROFILE.RUBRO.SYNC.1
-- Keep business-profile changes observable by installed clients without
-- deleting local data or coupling the profile refresh TTL to license TTLs.

create or replace function public.get_business_profile_anon_unlimited(license_key_param text)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_data json;
begin
  select id into v_license_id
  from public.licenses
  where license_key = license_key_param;

  if v_license_id is null then
    return json_build_object(
      'success', false,
      'code', 'LICENSE_NOT_FOUND',
      'reason', 'LICENSE_NOT_FOUND',
      'message', 'Licencia no encontrada.'
    );
  end if;

  select json_build_object(
    'profile_id', bp.id,
    'license_key', l.license_key,
    'name', bp.business_name,
    'business_name', bp.business_name,
    'phone', bp.phone_number,
    'phone_number', bp.phone_number,
    'address', bp.address,
    'logo', bp.logo_url,
    'logo_url', bp.logo_url,
    'business_type', bp.business_type,
    'updated_at', bp.updated_at,
    'profile_revision', floor(
      extract(epoch from coalesce(bp.updated_at, bp.created_at, now())) * 1000
    )::bigint
  ) into v_data
  from public.business_profiles bp
  join public.licenses l on bp.license_id = l.id
  where bp.license_id = v_license_id;

  if v_data is null then
    return json_build_object(
      'success', false,
      'code', 'PROFILE_NOT_FOUND',
      'reason', 'PROFILE_NOT_FOUND',
      'message', 'Perfil de negocio no configurado.'
    );
  end if;

  return json_build_object('success', true, 'data', v_data);
end;
$function$;

create or replace function private.broadcast_license_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_fingerprint text;
  v_broadcast_all boolean;
  v_device record;
begin
  v_target_fingerprint := coalesce(
    new.metadata->>'fingerprint',
    new.metadata->>'target_fingerprint',
    new.metadata->>'device_fingerprint'
  );

  v_broadcast_all := new.event_type in (
    'LICENSE_UPDATE',
    'LICENSE_REVOKED',
    'LICENSE_SUSPENDED',
    'SUBSCRIPTION_UPDATED',
    'PLAN_CHANGED',
    'LICENSE_RENEWED',
    'BUSINESS_PROFILE_UPDATED'
  );

  for v_device in
    select d.realtime_topic, d.device_fingerprint
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where l.license_key = new.license_key
      and d.realtime_topic is not null
      and private.license_realtime_enabled(p.features, l.features)
      and (
        (v_broadcast_all and d.is_active = true)
        or (v_target_fingerprint is not null and d.device_fingerprint = v_target_fingerprint)
      )
  loop
    perform realtime.send(
      jsonb_build_object(
        'event_type', new.event_type,
        'triggered_at', new.triggered_at,
        'metadata', coalesce(new.metadata, '{}'::jsonb)
      ),
      'license_event',
      v_device.realtime_topic,
      true
    );
  end loop;

  return new;
end;
$function$;

create or replace function private.emit_business_profile_updated_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_key text;
  v_profile_revision bigint;
begin
  if tg_op = 'UPDATE'
     and row(
       old.business_name,
       old.phone_number,
       old.address,
       old.logo_url,
       old.business_type
     ) is not distinct from row(
       new.business_name,
       new.phone_number,
       new.address,
       new.logo_url,
       new.business_type
     ) then
    return new;
  end if;

  select l.license_key
  into v_license_key
  from public.licenses l
  where l.id = new.license_id;

  if v_license_key is null then
    return new;
  end if;

  v_profile_revision := floor(
    extract(epoch from coalesce(new.updated_at, new.created_at, now())) * 1000
  )::bigint;

  insert into public.license_events (
    license_key,
    event_type,
    metadata
  ) values (
    v_license_key,
    'BUSINESS_PROFILE_UPDATED',
    jsonb_build_object(
      'profile_id', new.id,
      'updated_at', new.updated_at,
      'profile_revision', v_profile_revision,
      'business_type', to_jsonb(
        coalesce(new.business_type, array[]::public.business_category[])
      )
    )
  );

  return new;
end;
$function$;

revoke all on function private.emit_business_profile_updated_event()
from public, anon, authenticated;

drop trigger if exists trg_business_profile_realtime_event
on public.business_profiles;

create trigger trg_business_profile_realtime_event
after insert or update of
  business_name,
  phone_number,
  address,
  logo_url,
  business_type
on public.business_profiles
for each row
execute function private.emit_business_profile_updated_event();

comment on function private.emit_business_profile_updated_event() is
  'Emits a private BUSINESS_PROFILE_UPDATED license event after authoritative profile changes.';
