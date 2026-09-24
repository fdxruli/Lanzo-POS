-- LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1
-- Secure, explicit owner recovery after a real plan reduction to Lanzo Local.
-- This migration does not touch cash/financial tables and performs no tenant-specific data repair.

create or replace function private.resolve_free_device_takeover_evidence_v1(
  p_license_key text
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select jsonb_build_object(
    'event_id', e.id,
    'triggered_at', e.triggered_at,
    'reason', e.metadata->>'reason',
    'plan', e.metadata->>'plan',
    'max_devices', e.metadata->>'max_devices'
  )
  from public.license_events e
  where e.license_key = p_license_key
    and e.event_type = 'LICENSE_UPDATE'
    and e.metadata->>'source' = 'enforce_license_plan_limits_after_change'
    and e.metadata->>'reason' = 'PLAN_LIMITS_ENFORCED'
    and e.metadata->>'plan' = 'free_trial'
    and e.metadata->>'max_devices' = '1'
    and coalesce(e.metadata->>'over_limit_devices_blocked', '') ~ '^[1-9][0-9]*$'
  order by e.triggered_at desc, e.id desc
  limit 1
$function$;

revoke all on function private.resolve_free_device_takeover_evidence_v1(text)
  from public, anon, authenticated, service_role;

create or replace function public.admin_login_on_device(
  p_license_key text,
  p_username text,
  p_password text,
  p_device_fingerprint text,
  p_device_name text,
  p_device_info jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_license record;
  v_admin public.license_admin_users%rowtype;
  v_device public.license_devices%rowtype;
  v_active_count integer;
  v_device_token text;
  v_session jsonb;
  v_profile_required boolean;
  v_realtime_topic text;
  v_device_mode text;
  v_recovery_evidence jsonb;
  v_recovery_event_id uuid;
  v_recovery_consumed boolean := false;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_username, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_LOGIN_INVALID_REQUEST');
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-user:' || encode(extensions.digest(lower(btrim(coalesce(p_username, ''))), 'sha256'), 'hex'),
    null, 'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
    'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, 'admin-license-global', null, 'admin_login_on_device',
    'ADMIN_AUTH', 50, 900, 1800, 'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-device:' || coalesce(nullif(btrim(p_device_fingerprint), ''), '__missing_device__'),
    null, 'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
    'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  select l.id, l.status, l.expires_at, l.license_key, l.product_name,
         coalesce(l.max_devices, p.max_devices, 1) as max_devices,
         p.code as plan_code, p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'INVALID_ADMIN_CREDENTIALS');
  end if;

  if not exists (
    select 1
    from private.license_entitlement_state_v1(v_license.id) entitlement
    where entitlement.is_entitled
  ) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  select u.* into v_admin
  from public.license_admin_users u
  where u.license_id = v_license.id
    and u.username = lower(btrim(coalesce(p_username, '')))
    and u.is_owner is true
    and u.is_active is true
  limit 1;

  if v_admin.id is null
     or extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ADMIN_CREDENTIALS',
      'message', 'Usuario o contrasena incorrectos.'
    );
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  for update;

  if v_device.id is not null and v_device.device_mode = 'staff_only' then
    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_MODE_ADMIN_NOT_ALLOWED',
      'message', 'Este dispositivo esta configurado solo para Staff.'
    );
  end if;

  select count(*) into v_active_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true
    and (v_device.id is null or d.id <> v_device.id);

  if v_active_count + 1 > v_license.max_devices then
    if lower(coalesce(v_license.plan_code, '')) = 'free_trial'
       and v_license.max_devices = 1
       and v_active_count = 1 then
      v_recovery_evidence := private.resolve_free_device_takeover_evidence_v1(p_license_key);

      if v_recovery_evidence is not null then
        v_recovery_event_id := (v_recovery_evidence->>'event_id')::uuid;

        select exists (
          select 1
          from public.license_events e
          where e.license_key = p_license_key
            and e.event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER'
            and e.metadata->>'downgrade_event_id' = v_recovery_event_id::text
            and e.metadata->>'result' = 'success'
        ) into v_recovery_consumed;

        if not v_recovery_consumed then
          return jsonb_build_object(
            'success', false,
            'code', 'FREE_DEVICE_TAKEOVER_REQUIRED',
            'message', 'Lanzo Local permite un dispositivo. Puedes usar este equipo despues de confirmar el cambio.',
            'details', jsonb_build_object(
              'plan_code', v_license.plan_code,
              'plan_name', v_license.plan_name,
              'max_devices', 1,
              'takeover_available', true
            )
          );
        end if;
      end if;
    end if;

    return jsonb_build_object(
      'success', false,
      'code', 'DEVICE_LIMIT_REACHED',
      'message', 'Limite de dispositivos alcanzado para esta licencia.'
    );
  end if;

  v_device_token := encode(extensions.gen_random_bytes(32), 'hex');

  if v_device.id is null then
    v_device_mode := 'admin_only';
    v_realtime_topic := private.generate_license_realtime_topic();
    insert into public.license_devices (
      license_id, device_fingerprint, device_name, device_info, is_active,
      security_token, previous_security_token, realtime_topic, last_check_at,
      last_used_at, device_role, device_mode, staff_user_id
    ) values (
      v_license.id, p_device_fingerprint, left(p_device_name, 120),
      coalesce(p_device_info, '{}'::jsonb), true, v_device_token, null,
      v_realtime_topic, now(), now(), 'admin', v_device_mode, null
    ) returning * into v_device;
  else
    v_device_mode := v_device.device_mode;
    update public.license_devices
    set device_name = left(p_device_name, 120),
        device_info = coalesce(p_device_info, '{}'::jsonb),
        is_active = true,
        security_token = v_device_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_check_at = now(),
        last_used_at = now(),
        device_role = case when device_mode = 'admin_only' then 'admin' else device_role end,
        staff_user_id = case when device_mode = 'admin_only' then null else staff_user_id end
    where id = v_device.id
    returning * into v_device;
  end if;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, now()),
      metadata = metadata || jsonb_build_object('revoked_reason', 'ADMIN_LOGIN_HANDOFF')
  where device_id = v_device.id
    and revoked_at is null;

  v_session := private.create_admin_session(
    v_license.id, v_admin.id, v_device.id, v_device.device_name
  );

  update public.license_admin_users
  set updated_at = now()
  where id = v_admin.id;

  select not exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = v_license.id
      and nullif(btrim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'ADMIN_LOGIN',
    jsonb_build_object(
      'admin_user_id', v_admin.id,
      'device_id', v_device.id,
      'device_mode', v_device.device_mode,
      'logged_in_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'device_security_token', v_device_token,
    'admin_session_token', v_session->>'session_token',
    'admin_session_id', v_session->>'session_id',
    'admin_session_expires_at', v_session->>'expires_at',
    'admin_user', jsonb_build_object(
      'id', v_admin.id,
      'username', v_admin.username,
      'display_name', v_admin.display_name,
      'is_owner', true
    ),
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.device_role,
    'device_role', 'admin',
    'details', jsonb_build_object(
      'valid', true,
      'license_key', v_license.license_key,
      'product_name', v_license.product_name,
      'max_devices', v_license.max_devices,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'features', v_license.effective_features,
      'profile_required', v_profile_required,
      'device_name', v_device.device_name,
      'device_mode', v_device.device_mode,
      'legacy_device_role', v_device.device_role,
      'device_role', 'admin',
      'staff_user', null,
      'expires_at', v_license.expires_at,
      'realtime_topic', case
        when coalesce((v_license.effective_features->>'realtime_license_sync')::boolean, false)
          then v_device.realtime_topic
        else null
      end
    )
  );
end;
$function$;

revoke all on function public.admin_login_on_device(text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_login_on_device(text,text,text,text,text,jsonb)
  to anon, authenticated, service_role;

create or replace function public.admin_takeover_free_device(
  p_license_key text,
  p_username text,
  p_password text,
  p_device_fingerprint text,
  p_device_name text,
  p_device_info jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_rate jsonb;
  v_license record;
  v_admin public.license_admin_users%rowtype;
  v_device public.license_devices%rowtype;
  v_previous_device_id uuid;
  v_active_count integer := 0;
  v_device_token text;
  v_session jsonb;
  v_profile_required boolean;
  v_recovery_evidence jsonb;
  v_recovery_event_id uuid;
  v_recovery_consumed boolean := false;
  v_is_retry_winner boolean := false;
  v_admin_revoked integer := 0;
  v_staff_revoked integer := 0;
  v_now timestamptz := now();
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_username, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_LOGIN_INVALID_REQUEST');
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-user:' || encode(extensions.digest(lower(btrim(coalesce(p_username, ''))), 'sha256'), 'hex'),
    null, 'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
    'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, 'admin-license-global', null, 'admin_login_on_device',
    'ADMIN_AUTH', 50, 900, 1800, 'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    'admin-device:' || coalesce(nullif(btrim(p_device_fingerprint), ''), '__missing_device__'),
    null, 'admin_login_on_device', 'ADMIN_AUTH', 10, 600, 900,
    'ADMIN_LOGIN_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  select l.id, l.status, l.expires_at, l.license_key, l.product_name,
         coalesce(l.max_devices, p.max_devices, 1) as max_devices,
         p.code as plan_code, p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'INVALID_ADMIN_CREDENTIALS');
  end if;

  if not exists (
    select 1
    from private.license_entitlement_state_v1(v_license.id) entitlement
    where entitlement.is_entitled
  ) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE');
  end if;

  select u.* into v_admin
  from public.license_admin_users u
  where u.license_id = v_license.id
    and u.username = lower(btrim(coalesce(p_username, '')))
    and u.is_owner is true
    and u.is_active is true
  limit 1;

  if v_admin.id is null
     or extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    return jsonb_build_object(
      'success', false,
      'code', 'INVALID_ADMIN_CREDENTIALS',
      'message', 'Usuario o contrasena incorrectos.'
    );
  end if;

  if lower(coalesce(v_license.plan_code, '')) <> 'free_trial'
     or v_license.max_devices <> 1 then
    return jsonb_build_object(
      'success', false,
      'code', 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED',
      'message', 'La recuperacion de dispositivo no esta disponible para este plan.'
    );
  end if;

  select * into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  for update;

  if v_device.id is not null and v_device.device_mode = 'staff_only' then
    return jsonb_build_object(
      'success', false,
      'code', 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED',
      'message', 'Este dispositivo no es elegible para recuperacion administrativa.'
    );
  end if;

  v_recovery_evidence := private.resolve_free_device_takeover_evidence_v1(p_license_key);
  if v_recovery_evidence is null then
    return jsonb_build_object(
      'success', false,
      'code', 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED',
      'message', 'No existe una reduccion de plan pendiente que permita recuperar este dispositivo.'
    );
  end if;
  v_recovery_event_id := (v_recovery_evidence->>'event_id')::uuid;

  select exists (
    select 1
    from public.license_events e
    where e.license_key = p_license_key
      and e.event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER'
      and e.metadata->>'downgrade_event_id' = v_recovery_event_id::text
      and e.metadata->>'result' = 'success'
  ) into v_recovery_consumed;

  select count(*) into v_active_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true;

  if v_recovery_consumed then
    if v_device.id is not null
       and v_device.is_active is true
       and v_active_count = 1
       and exists (
         select 1
         from public.license_events e
         where e.license_key = p_license_key
           and e.event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER'
           and e.metadata->>'downgrade_event_id' = v_recovery_event_id::text
           and e.metadata->>'new_device_id' = v_device.id::text
           and e.metadata->>'result' = 'success'
       ) then
      v_is_retry_winner := true;
    else
      return jsonb_build_object(
        'success', false,
        'code', 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED',
        'message', 'La recuperacion asociada a este cambio de plan ya fue utilizada.'
      );
    end if;
  else
    if v_active_count <> 1
       or (v_device.id is not null and v_device.is_active is true) then
      return jsonb_build_object(
        'success', false,
        'code', 'FREE_DEVICE_TAKEOVER_NOT_ALLOWED',
        'message', 'El estado actual de dispositivos no permite esta recuperacion.'
      );
    end if;

    select d.id into v_previous_device_id
    from public.license_devices d
    where d.license_id = v_license.id
      and d.is_active is true
    order by d.id
    limit 1
    for update;
  end if;

  v_device_token := encode(extensions.gen_random_bytes(32), 'hex');

  if not v_is_retry_winner then
    update public.license_devices d
    set is_active = false,
        security_token = null,
        previous_security_token = null,
        last_check_at = v_now,
        device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
          'owner_takeover', jsonb_build_object(
            'reason', 'FREE_PRIMARY_DEVICE_TAKEOVER_DISPLACED',
            'at', v_now
          )
        )
    where d.license_id = v_license.id
      and (v_device.id is null or d.id <> v_device.id)
      and (
        d.is_active is true
        or d.security_token is not null
        or d.previous_security_token is not null
      );

    if v_device.id is null then
      insert into public.license_devices (
        license_id, device_fingerprint, device_name, device_info, is_active,
        security_token, previous_security_token, realtime_topic, last_check_at,
        last_used_at, device_role, device_mode, staff_user_id
      ) values (
        v_license.id,
        p_device_fingerprint,
        left(p_device_name, 120),
        coalesce(p_device_info, '{}'::jsonb),
        true,
        v_device_token,
        null,
        private.generate_license_realtime_topic(),
        v_now,
        v_now,
        'admin',
        'admin_only',
        null
      ) returning * into v_device;
    else
      update public.license_devices
      set device_name = left(p_device_name, 120),
          device_info = ((coalesce(device_info, '{}'::jsonb) - 'license_block') - 'owner_takeover')
            || coalesce(p_device_info, '{}'::jsonb),
          is_active = true,
          security_token = v_device_token,
          previous_security_token = null,
          realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
          last_check_at = v_now,
          last_used_at = v_now,
          device_role = 'admin',
          device_mode = 'admin_only',
          staff_user_id = null
      where id = v_device.id
      returning * into v_device;
    end if;
  else
    update public.license_devices
    set device_name = left(p_device_name, 120),
        device_info = ((coalesce(device_info, '{}'::jsonb) - 'license_block') - 'owner_takeover')
          || coalesce(p_device_info, '{}'::jsonb),
        security_token = v_device_token,
        previous_security_token = null,
        realtime_topic = coalesce(realtime_topic, private.generate_license_realtime_topic()),
        last_check_at = v_now,
        last_used_at = v_now,
        device_role = 'admin',
        device_mode = 'admin_only',
        staff_user_id = null
    where id = v_device.id
    returning * into v_device;
  end if;

  update public.license_admin_sessions
  set revoked_at = coalesce(revoked_at, v_now),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'revoked_reason', 'FREE_PRIMARY_DEVICE_TAKEOVER',
        'revoked_at', v_now
      )
  where license_id = v_license.id
    and revoked_at is null;
  get diagnostics v_admin_revoked = row_count;

  update public.license_staff_sessions
  set revoked_at = coalesce(revoked_at, v_now),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'revoked_reason', 'FREE_PRIMARY_DEVICE_TAKEOVER',
        'revoked_at', v_now
      )
  where license_id = v_license.id
    and revoked_at is null;
  get diagnostics v_staff_revoked = row_count;

  v_session := private.create_admin_session(
    v_license.id, v_admin.id, v_device.id, v_device.device_name
  );

  update public.license_admin_users
  set updated_at = v_now
  where id = v_admin.id;

  select count(*) into v_active_count
  from public.license_devices d
  where d.license_id = v_license.id
    and d.is_active is true;

  if v_active_count <> 1 then
    raise exception 'FREE_DEVICE_TAKEOVER_INVARIANT_ACTIVE_DEVICE_COUNT';
  end if;

  select not exists (
    select 1
    from public.business_profiles bp
    where bp.license_id = v_license.id
      and nullif(btrim(coalesce(bp.business_name, '')), '') is not null
      and coalesce(array_length(bp.business_type, 1), 0) > 0
  ) into v_profile_required;

  if not v_is_retry_winner then
    insert into public.license_events (license_key, event_type, metadata)
    values (
      p_license_key,
      'FREE_PRIMARY_DEVICE_TAKEOVER',
      jsonb_build_object(
        'admin_user_id', v_admin.id,
        'previous_device_id', v_previous_device_id,
        'new_device_id', v_device.id,
        'downgrade_event_id', v_recovery_event_id,
        'downgrade_reason', v_recovery_evidence->>'reason',
        'plan_code', v_license.plan_code,
        'plan_name', v_license.plan_name,
        'max_devices', v_license.max_devices,
        'admin_sessions_revoked', v_admin_revoked,
        'staff_sessions_revoked', v_staff_revoked,
        'takeover_at', v_now,
        'result', 'success'
      )
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'code', 'FREE_DEVICE_TAKEOVER_SUCCESS',
    'idempotent_retry', v_is_retry_winner,
    'device_security_token', v_device_token,
    'admin_session_token', v_session->>'session_token',
    'admin_session_id', v_session->>'session_id',
    'admin_session_expires_at', v_session->>'expires_at',
    'admin_user', jsonb_build_object(
      'id', v_admin.id,
      'username', v_admin.username,
      'display_name', v_admin.display_name,
      'is_owner', true
    ),
    'device_mode', v_device.device_mode,
    'legacy_device_role', v_device.device_role,
    'device_role', 'admin',
    'details', jsonb_build_object(
      'valid', true,
      'license_key', v_license.license_key,
      'product_name', v_license.product_name,
      'max_devices', v_license.max_devices,
      'plan_code', v_license.plan_code,
      'plan_name', v_license.plan_name,
      'features', v_license.effective_features,
      'profile_required', v_profile_required,
      'device_name', v_device.device_name,
      'device_mode', v_device.device_mode,
      'legacy_device_role', v_device.device_role,
      'device_role', 'admin',
      'staff_user', null,
      'expires_at', v_license.expires_at,
      'realtime_topic', case
        when coalesce((v_license.effective_features->>'realtime_license_sync')::boolean, false)
          then v_device.realtime_topic
        else null
      end
    )
  );
end;
$function$;

revoke all on function public.admin_takeover_free_device(text,text,text,text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_takeover_free_device(text,text,text,text,text,jsonb)
  to anon, authenticated, service_role;

comment on function private.resolve_free_device_takeover_evidence_v1(text) is
  'LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1: resolves the latest canonical one-device plan-reduction event eligible for owner recovery.';

comment on function public.admin_takeover_free_device(text,text,text,text,text,jsonb) is
  'LICENSE.FREE.OWNER.DEVICE.TAKEOVER.R1: explicit owner-authenticated, one-downgrade-event device recovery for Lanzo Local; revokes displaced actor sessions/tokens and does not touch cash.';
