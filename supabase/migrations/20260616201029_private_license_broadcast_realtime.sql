create schema if not exists private;

grant usage on schema private to anon, authenticated;

alter table public.license_devices
  add column if not exists realtime_topic text;

update public.license_devices
set realtime_topic = 'license:' || encode(extensions.gen_random_bytes(32), 'hex')
where realtime_topic is null;

create unique index if not exists idx_license_devices_realtime_topic
  on public.license_devices (realtime_topic)
  where realtime_topic is not null;

create or replace function private.generate_license_realtime_topic()
returns text
language sql
volatile
set search_path = ''
as $$
  select 'license:' || encode(extensions.gen_random_bytes(32), 'hex');
$$;

create or replace function private.license_realtime_enabled(
  p_plan_features jsonb,
  p_license_features jsonb
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    ((coalesce(p_plan_features, '{}'::jsonb) || coalesce(p_license_features, '{}'::jsonb))->>'realtime_license_sync') = 'true',
    false
  );
$$;

create or replace function private.can_access_license_realtime_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where d.realtime_topic = p_topic
      and p_topic like 'license:%'
      and d.is_active = true
      and d.security_token is not null
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at >= now())
      and private.license_realtime_enabled(p.features, l.features)
  );
$$;

grant execute on function private.can_access_license_realtime_topic(text) to anon, authenticated;

drop policy if exists "Lanzo private license broadcast receive" on realtime.messages;
create policy "Lanzo private license broadcast receive"
on realtime.messages
for select
to anon, authenticated
using (
  extension = 'broadcast'
  and private = true
  and private.can_access_license_realtime_topic(realtime.topic())
);

create or replace function private.broadcast_license_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    'LICENSE_RENEWED'
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
$$;

drop trigger if exists trg_broadcast_license_event on public.license_events;
create trigger trg_broadcast_license_event
  after insert on public.license_events
  for each row
  execute function private.broadcast_license_event();

create or replace function public.activate_license_on_device(license_key_param text, device_fingerprint_param text, device_name_param text, device_info_param jsonb)
returns json
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_record public.licenses%rowtype;
  v_device_record record;
  v_current_count int;
  v_security_token text;
  v_profile_required boolean;
  v_effective_features jsonb;
  v_realtime_topic text;
begin
  select * into v_license_record
  from public.licenses
  where license_key = license_key_param
  for update;

  if v_license_record.id is null then
    return json_build_object('success', false, 'error', 'Licencia no encontrada.');
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_effective_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = v_license_record.id;

  if v_license_record.status <> 'active' then
    return json_build_object('success', false, 'error', 'La licencia no esta activa o ha sido suspendida.');
  end if;

  if v_license_record.expires_at is not null and v_license_record.expires_at < now() then
    return json_build_object('success', false, 'error', 'La licencia ha caducado.');
  end if;

  if v_license_record.expires_at is null
     and coalesce(v_license_record.is_lifetime, false) = false
     and v_license_record.duration_months is not null then
    update public.licenses
    set expires_at = now() + (v_license_record.duration_months || ' months')::interval
    where id = v_license_record.id;

    v_license_record.expires_at := now() + (v_license_record.duration_months || ' months')::interval;
  end if;

  select not exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = v_license_record.id
      and nullif(trim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  select * into v_device_record
  from public.license_devices
  where license_id = v_license_record.id
    and device_fingerprint = device_fingerprint_param;

  if v_device_record.id is not null and coalesce(v_device_record.is_active, false) = true then
    return json_build_object(
      'success', false,
      'error', 'Esta licencia ya esta activa en este dispositivo.'
    );
  end if;

  select count(*) into v_current_count
  from public.license_devices
  where license_id = v_license_record.id
    and is_active = true;

  if (v_current_count + 1) > v_license_record.max_devices then
    return json_build_object('success', false, 'error', 'Limite de dispositivos alcanzado para esta licencia.');
  end if;

  v_security_token := encode(extensions.gen_random_bytes(32), 'hex');

  if v_device_record.id is not null then
    update public.license_devices
    set device_name = device_name_param,
        device_info = coalesce(device_info_param, '{}'::jsonb),
        is_active = true,
        security_token = v_security_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_used_at = now(),
        last_check_at = now()
    where id = v_device_record.id
    returning realtime_topic into v_realtime_topic;
  else
    v_realtime_topic := private.generate_license_realtime_topic();

    insert into public.license_devices (
      license_id,
      device_fingerprint,
      device_name,
      device_info,
      is_active,
      security_token,
      realtime_topic,
      last_check_at
    ) values (
      v_license_record.id,
      device_fingerprint_param,
      device_name_param,
      coalesce(device_info_param, '{}'::jsonb),
      true,
      v_security_token,
      v_realtime_topic,
      now()
    );
  end if;

  insert into public.license_usage_logs (license_id, device_fingerprint, action, metadata)
  values (v_license_record.id, device_fingerprint_param, 'ACTIVATE', coalesce(device_info_param, '{}'::jsonb));

  return json_build_object(
    'success', true,
    'message', 'Licencia activada correctamente',
    'device_security_token', v_security_token,
    'profile_required', v_profile_required,
    'details', json_build_object(
      'license_key', license_key_param,
      'product_name', v_license_record.product_name,
      'expires_at', v_license_record.expires_at,
      'max_devices', v_license_record.max_devices,
      'features', coalesce(v_effective_features, '{}'::jsonb),
      'profile_required', v_profile_required,
      'security_token', v_security_token,
      'token', v_security_token,
      'realtime_topic', case
        when coalesce((v_effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
        else null
      end
    )
  );
exception when unique_violation then
  return json_build_object(
    'success', false,
    'error', 'Error: este dispositivo ya esta registrado.'
  );
end;
$function$;

create or replace function public.verify_device_license_unified(p_license_key text, p_device_fingerprint text, p_security_token text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
    v_license record;
    v_device record;
    v_new_token text;
    v_grace_days integer := 7;
    v_is_in_grace boolean := false;
    v_latest_term_id uuid;
    v_latest_term_version text;
    v_terms_accepted boolean := true;
    v_realtime_topic text;
begin
    select
      l.id,
      l.status,
      l.product_name,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features,
      l.expires_at,
      l.license_key
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.license_key = p_license_key;

    if v_license.id is null then
        return jsonb_build_object('valid', false, 'status', 'not_found', 'reason', 'LICENSE_NOT_FOUND');
    end if;

    if v_license.status != 'active' then
        return jsonb_build_object('valid', false, 'status', 'suspended', 'reason', 'LICENSE_SUSPENDED');
    end if;

    if v_license.expires_at is not null and v_license.expires_at < now() then
        if v_license.expires_at > (now() - (v_grace_days || ' days')::interval) then
            v_is_in_grace := true;
        else
            return jsonb_build_object('valid', false, 'status', 'expired', 'reason', 'LICENSE_EXPIRED', 'expires_at', v_license.expires_at);
        end if;
    end if;

    select id, device_name, security_token, previous_security_token, is_active, realtime_topic
    into v_device
    from public.license_devices
    where license_id = v_license.id
      and device_fingerprint = p_device_fingerprint
    limit 1;

    if v_device.id is null or v_device.is_active = false then
        return jsonb_build_object('valid', false, 'status', 'device_banned', 'reason', 'DEVICE_NOT_ALLOWED');
    end if;

    if v_device.realtime_topic is null then
        update public.license_devices
        set realtime_topic = private.generate_license_realtime_topic()
        where id = v_device.id
        returning realtime_topic into v_realtime_topic;
    else
        v_realtime_topic := v_device.realtime_topic;
    end if;

    if v_device.security_token is not null then
        if p_security_token = v_device.security_token then
            null;
        elsif p_security_token = v_device.previous_security_token then
            return jsonb_build_object(
                'valid', true,
                'status', case when v_is_in_grace then 'grace_period' else 'active' end,
                'license_key', v_license.license_key,
                'product_name', v_license.product_name,
                'features', coalesce(v_license.effective_features, '{}'::jsonb),
                'device_name', v_device.device_name,
                'expires_at', v_license.expires_at,
                'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
                'new_security_token', v_device.security_token,
                'realtime_topic', case
                  when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
                  else null
                end
            );
        elsif p_security_token is not null and p_security_token != '' then
            return jsonb_build_object('valid', false, 'status', 'cloned', 'reason', 'CLONING_DETECTED');
        end if;
    end if;

    v_new_token := extensions.gen_random_uuid()::text;
    update public.license_devices
    set previous_security_token = security_token,
        security_token = v_new_token,
        last_used_at = now(),
        last_check_at = now()
    where id = v_device.id;

    select id, version into v_latest_term_id, v_latest_term_version
    from public.legal_terms
    where type = 'terms_of_use' and is_active = true
    order by published_at desc
    limit 1;

    if v_latest_term_id is not null then
        select exists (
            select 1
            from public.legal_acceptances
            where license_id = v_license.id
              and term_id = v_latest_term_id
        ) into v_terms_accepted;
    end if;

    return jsonb_build_object(
        'valid', true,
        'status', case when v_is_in_grace then 'grace_period' else 'active' end,
        'license_status', v_license.status,
        'license_key', v_license.license_key,
        'product_name', v_license.product_name,
        'features', coalesce(v_license.effective_features, '{}'::jsonb),
        'device_name', v_device.device_name,
        'expires_at', v_license.expires_at,
        'grace_period_ends', case when v_is_in_grace then v_license.expires_at + (v_grace_days || ' days')::interval else null end,
        'new_security_token', v_new_token,
        'realtime_topic', case
          when coalesce((v_license.effective_features->>'realtime_license_sync') = 'true', false) then v_realtime_topic
          else null
        end,
        'legal_status', jsonb_build_object(
            'has_updated_terms', not v_terms_accepted,
            'latest_version', v_latest_term_version,
            'term_id', v_latest_term_id
        )
    );
end;
$function$;

do $$
begin
  if exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'license_events'
  ) then
    alter publication supabase_realtime drop table public.license_events;
  end if;
end $$;

drop policy if exists "Public read events" on public.license_events;;
