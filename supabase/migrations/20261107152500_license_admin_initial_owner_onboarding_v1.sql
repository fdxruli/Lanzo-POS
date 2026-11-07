-- One-time authorization for the first owner and device of an administratively
-- provisioned license. The invitation is never stored in plaintext.

create table if not exists private.license_onboarding_invitations (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  token_hash bytea not null check (octet_length(token_hash) = 32),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  issued_by text not null default session_user,
  consumed_at timestamptz,
  -- Keep the audit reference even if a later cleanup removes the device row.
  consumed_device_id uuid,
  revoked_at timestamptz,
  constraint license_onboarding_invitations_valid_expiry check (expires_at > issued_at),
  constraint license_onboarding_invitations_consumption_pair check (
    (consumed_at is null and consumed_device_id is null)
    or (consumed_at is not null and consumed_device_id is not null)
  ),
  constraint license_onboarding_invitations_token_hash_key unique (token_hash)
);

create unique index if not exists license_onboarding_one_pending_per_license_uidx
  on private.license_onboarding_invitations (license_id)
  where consumed_at is null and revoked_at is null;

create index if not exists license_onboarding_invitations_expiry_idx
  on private.license_onboarding_invitations (expires_at)
  where consumed_at is null and revoked_at is null;

alter table private.license_onboarding_invitations enable row level security;
revoke all on table private.license_onboarding_invitations from public, anon, authenticated, service_role;

create or replace function private.issue_license_onboarding_invitation(p_license_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license record;
  v_entitlement record;
  v_code text;
  v_invitation_id uuid;
  v_expires_at timestamptz;
begin
  select l.id, l.license_key, l.status, coalesce(l.max_devices, p.max_devices, 1) as max_devices
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
   for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no disponible. Revisa la clave.');
  end if;

  select * into v_entitlement
    from private.license_entitlement_state_v1(v_license.id)
   limit 1;

  if coalesce(v_entitlement.is_entitled, false) is not true then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'Esta licencia no está vigente. Contacta a LANZO.');
  end if;

  if exists (
    select 1 from public.license_admin_users u
     where u.license_id = v_license.id and u.is_owner is true
  ) then
    return jsonb_build_object(
      'success', false,
      'code', 'ADMIN_OWNER_ALREADY_ENROLLED',
      'message', 'Esta licencia ya tiene una cuenta propietaria.'
    );
  end if;

  if exists (
    select 1 from public.license_devices d
     where d.license_id = v_license.id and d.is_active is true
  ) then
    return jsonb_build_object('success', false, 'code', 'LICENSE_DEVICE_ALREADY_ACTIVE');
  end if;

  -- An explicit SQL operator action replaces any prior unused invitation.
  update private.license_onboarding_invitations
     set revoked_at = coalesce(revoked_at, now())
   where license_id = v_license.id
     and consumed_at is null
     and revoked_at is null;

  v_code := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + interval '24 hours';

  insert into private.license_onboarding_invitations (
    license_id, token_hash, expires_at
  ) values (
    v_license.id,
    extensions.digest(v_code, 'sha256'),
    v_expires_at
  ) returning id into v_invitation_id;

  return jsonb_build_object(
    'success', true,
    'invitation_code', v_code,
    'expires_at', v_expires_at,
    'invitation_id', v_invitation_id
  );
end;
$function$;

create or replace function private.revoke_license_onboarding_invitation(p_license_key text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_license_id uuid;
  v_revoked integer;
begin
  select l.id into v_license_id
    from public.licenses l
   where l.license_key = p_license_key
   for update;

  if v_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  update private.license_onboarding_invitations
     set revoked_at = coalesce(revoked_at, now())
   where license_id = v_license_id
     and consumed_at is null
     and revoked_at is null;
  get diagnostics v_revoked = row_count;

  return jsonb_build_object('success', true, 'revoked', v_revoked > 0);
end;
$function$;

revoke all on function private.issue_license_onboarding_invitation(text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_license_onboarding_invitation(text) from public, anon, authenticated, service_role;
grant execute on function private.issue_license_onboarding_invitation(text) to postgres;
grant execute on function private.revoke_license_onboarding_invitation(text) to postgres;

create or replace function public.admin_enroll_owner_with_invitation(
  p_license_key text,
  p_invitation_code text,
  p_device_fingerprint text,
  p_device_name text,
  p_device_info jsonb,
  p_username text,
  p_password text,
  p_display_name text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rate jsonb;
  v_license record;
  v_entitlement record;
  v_invitation private.license_onboarding_invitations%rowtype;
  v_admin public.license_admin_users%rowtype;
  v_device public.license_devices%rowtype;
  v_session jsonb;
  v_code_hash bytea;
  v_username text := lower(btrim(coalesce(p_username, '')));
  v_display_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_device_token text;
  v_realtime_topic text;
  v_active_devices integer;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or char_length(p_device_fingerprint) > 255
     or (p_device_info is not null and (
       jsonb_typeof(p_device_info) <> 'object' or octet_length(p_device_info::text) > 8192
     )) then
    return jsonb_build_object('success', false, 'code', 'ADMIN_ONBOARDING_INVALID');
  end if;

  -- A per-installation bucket plus a license-wide bucket prevents trivial
  -- fingerprint rotation from removing the online guessing limit.
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, 'onboarding:' || p_device_fingerprint, null,
    'admin_enroll_owner_with_invitation', 'ADMIN_AUTH', 5, 900, 900,
    'ADMIN_ONBOARDING_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, 'admin-onboarding-license-global', null,
    'admin_enroll_owner_with_invitation', 'ADMIN_AUTH', 20, 900, 1800,
    'ADMIN_ONBOARDING_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;

  if p_invitation_code is null
     or p_invitation_code !~ '^[0-9A-Fa-f]{64}$' then
    return jsonb_build_object(
      'success', false, 'code', 'ADMIN_ONBOARDING_INVALID',
      'message', 'El código no es válido, venció o ya se utilizó.'
    );
  end if;

  if char_length(v_username) < 3 or char_length(v_username) > 64
     or v_username !~ '^[a-z0-9._-]+$'
     or v_display_name is null or char_length(v_display_name) > 120
     or p_password is null or char_length(p_password) < 8
     or octet_length(p_password) > 72
     or p_password !~ '[A-Za-z]' or p_password !~ '[0-9]' then
    return jsonb_build_object(
      'success', false,
      'code', 'ADMIN_ONBOARDING_INPUT_INVALID',
      'message', 'Revisa el nombre, el usuario y la contraseña. Usa al menos 8 caracteres, una letra y un número.'
    );
  end if;

  v_code_hash := extensions.digest(lower(p_invitation_code), 'sha256');

  -- Lock order is license then invitation. The same license row serializes
  -- enrollment and other POS device registration functions.
  select l.id, l.license_key, l.product_name,
         coalesce(l.max_devices, p.max_devices, 1) as max_devices
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
   for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'ADMIN_ONBOARDING_INVALID');
  end if;

  select * into v_entitlement
    from private.license_entitlement_state_v1(v_license.id)
   limit 1;
  if coalesce(v_entitlement.is_entitled, false) is not true then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'Esta licencia no está vigente. Contacta a LANZO.');
  end if;

  if exists (
    select 1 from public.license_admin_users u
     where u.license_id = v_license.id and u.is_owner is true
  ) then
    return jsonb_build_object(
      'success', false, 'code', 'ADMIN_ONBOARDING_INVALID',
      'message', 'El código no es válido, venció o ya se utilizó.'
    );
  end if;

  select i.* into v_invitation
    from private.license_onboarding_invitations i
   where i.license_id = v_license.id
     and i.token_hash = v_code_hash
   for update;

  if v_invitation.id is null
     or v_invitation.consumed_at is not null
     or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now() then
    return jsonb_build_object(
      'success', false, 'code', 'ADMIN_ONBOARDING_INVALID',
      'message', 'El código no es válido, venció o ya se utilizó.'
    );
  end if;

  select count(*) into v_active_devices
    from public.license_devices d
   where d.license_id = v_license.id
     and d.is_active is true;

  if v_active_devices > 0 or v_license.max_devices < 1 then
    return jsonb_build_object('success', false, 'code', 'ADMIN_ONBOARDING_DEVICE_STATE_CONFLICT', 'message', 'No se puede registrar este dispositivo. Contacta a LANZO para continuar.');
  end if;

  -- Never revive a historical/Staff row by matching only its fingerprint.
  if exists (
    select 1 from public.license_devices d
     where d.license_id = v_license.id
       and d.device_fingerprint = p_device_fingerprint
  ) then
    return jsonb_build_object('success', false, 'code', 'ADMIN_ONBOARDING_DEVICE_STATE_CONFLICT', 'message', 'No se puede registrar este dispositivo. Contacta a LANZO para continuar.');
  end if;

  v_device_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_realtime_topic := private.generate_license_realtime_topic();

  insert into public.license_admin_users (
    license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_license.id,
    v_username,
    v_display_name,
    extensions.crypt(p_password, extensions.gen_salt('bf', 12)),
    true,
    true
  ) returning * into v_admin;

  insert into public.license_devices (
    license_id, device_fingerprint, device_name, device_info, is_active,
    security_token, previous_security_token, realtime_topic, last_check_at,
    last_used_at, device_role, device_mode, staff_user_id
  ) values (
    v_license.id, p_device_fingerprint, left(coalesce(p_device_name, ''), 120),
    coalesce(p_device_info, '{}'::jsonb), true, v_device_token, null,
    v_realtime_topic, now(), now(), 'admin', 'admin_only', null
  ) returning * into v_device;

  v_session := private.create_admin_session(
    v_license.id, v_admin.id, v_device.id, v_device.device_name
  );

  update private.license_onboarding_invitations
     set consumed_at = now(), consumed_device_id = v_device.id
   where id = v_invitation.id
     and consumed_at is null
     and revoked_at is null;

  if not found then
    raise exception 'ADMIN_ONBOARDING_CONSUMPTION_INVARIANT';
  end if;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    p_license_key,
    'ADMIN_OWNER_ENROLLED',
    jsonb_build_object(
      'admin_user_id', v_admin.id,
      'device_id', v_device.id,
      'device_mode', v_device.device_mode,
      'enrollment_source', 'administrative_onboarding_invitation',
      'enrolled_at', now()
    )
  );

  return jsonb_build_object(
    'success', true,
    'code', 'ADMIN_OWNER_ENROLLED',
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
      'plan_code', v_entitlement.plan_code,
      'plan_name', v_entitlement.plan_name,
      'features', coalesce(v_entitlement.effective_features, '{}'::jsonb),
      'device_name', v_device.device_name,
      'device_mode', v_device.device_mode,
      'legacy_device_role', v_device.device_role,
      'device_role', 'admin',
      'staff_user', null,
      'expires_at', v_entitlement.expires_at,
      'realtime_topic', case
        when coalesce((v_entitlement.effective_features->>'realtime_license_sync')::boolean, false)
          then v_device.realtime_topic
        else null
      end
    )
  );
end;
$function$;

revoke all on function public.admin_enroll_owner_with_invitation(text, text, text, text, jsonb, text, text, text) from public;
grant execute on function public.admin_enroll_owner_with_invitation(text, text, text, text, jsonb, text, text, text) to anon, authenticated, service_role;

-- Preserve the existing activation contract. A separate state is returned only
-- when there is no owner and no device row at all; it never indicates whether an
-- invitation exists. Legacy clients continue to fail closed on the new code.
create or replace function public.activate_license_on_device(
  license_key_param text,
  device_fingerprint_param text,
  device_name_param text,
  device_info_param jsonb
)
returns json
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rate_limit jsonb;
  v_result json;
  v_license_id uuid;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := '__license_activation__',
    p_device_fingerprint := $2,
    p_staff_session_token := null,
    p_rpc_name := 'activate_license_on_device',
    p_scope := 'AUTH_LICENSE',
    p_max_attempts := 10,
    p_window_seconds := 600,
    p_block_seconds := 900,
    p_code := 'LICENSE_ACTIVATION_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit)::json;
  end if;

  v_result := public.activate_license_on_device_unlimited($1, $2, $3, $4)::json;

  if v_result->>'code' = 'ADMIN_ENROLLMENT_NOT_ALLOWED' then
    select l.id into v_license_id
      from public.licenses l
     where l.license_key = license_key_param;

    if v_license_id is not null
       and not exists (
         select 1 from public.license_admin_users u
          where u.license_id = v_license_id and u.is_owner is true
       )
       and not exists (
         select 1 from public.license_devices d where d.license_id = v_license_id
       ) then
      return json_build_object(
        'success', false,
        'code', 'ADMIN_INITIAL_SETUP_REQUIRED',
        'message', 'Esta licencia necesita su primera configuración con el código entregado por LANZO.'
      );
    end if;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.activate_license_on_device(text, text, text, jsonb) from public;
grant execute on function public.activate_license_on_device(text, text, text, jsonb) to anon, authenticated, service_role;
