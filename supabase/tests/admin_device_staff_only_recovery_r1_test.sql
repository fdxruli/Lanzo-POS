begin;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_license_id uuid := extensions.gen_random_uuid();
  v_expired_license_id uuid := extensions.gen_random_uuid();
  v_other_license_id uuid := extensions.gen_random_uuid();
  v_limited_license_id uuid := extensions.gen_random_uuid();
  v_owner_id uuid := extensions.gen_random_uuid();
  v_inactive_owner_id uuid := extensions.gen_random_uuid();
  v_limited_owner_id uuid := extensions.gen_random_uuid();
  v_staff_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_other_admin_device_id uuid := extensions.gen_random_uuid();
  v_expired_device_id uuid := extensions.gen_random_uuid();
  v_other_device_id uuid := extensions.gen_random_uuid();
  v_inactive_device_id uuid := extensions.gen_random_uuid();
  v_limited_device_id uuid := extensions.gen_random_uuid();
  v_limit_extra_device_id uuid := extensions.gen_random_uuid();
  v_license_key text := 'DEVICE-RECOVERY-' || v_suffix;
  v_expired_license_key text := 'DEVICE-RECOVERY-EXPIRED-' || v_suffix;
  v_other_license_key text := 'DEVICE-RECOVERY-OTHER-' || v_suffix;
  v_limited_license_key text := 'DEVICE-RECOVERY-LIMITED-' || v_suffix;
  v_owner_password text := 'OwnerRecovery-' || v_suffix || '9';
  v_staff_password text := 'StaffRecovery-' || v_suffix || '9';
  v_old_device_token text := 'old-device-token-' || v_suffix;
  v_new_device_token text;
  v_admin_session_token text;
  v_result jsonb;
  v_auth jsonb;
  v_revoked integer;
begin
  insert into public.licenses (
    id, license_key, license_type, status, expires_at, max_devices, product_name, features
  ) values
    (v_license_id, v_license_key, 'pro', 'active', now() + interval '30 days', 2, 'Recovery fixture', '{"staff_roles":true}'::jsonb),
    (v_expired_license_id, v_expired_license_key, 'pro', 'active', now() - interval '1 day', 1, 'Expired recovery fixture', '{"staff_roles":true}'::jsonb),
    (v_other_license_id, v_other_license_key, 'pro', 'active', now() + interval '30 days', 1, 'Other tenant fixture', '{"staff_roles":true}'::jsonb),
    (v_limited_license_id, v_limited_license_key, 'pro', 'active', now() + interval '30 days', 1, 'Device limit fixture', '{"staff_roles":true}'::jsonb);

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values
    (v_owner_id, v_license_id, 'owner_' || v_suffix, 'Recovery Owner', extensions.crypt(v_owner_password, extensions.gen_salt('bf', 4)), true, true),
    (v_inactive_owner_id, v_license_id, 'inactive_' || v_suffix, 'Inactive Owner', extensions.crypt(v_owner_password, extensions.gen_salt('bf', 4)), true, false);

  insert into public.license_admin_users (
    license_id, username, display_name, password_hash, is_owner, is_active
  ) values
    (v_expired_license_id, 'expired_owner_' || v_suffix, 'Expired Owner', extensions.crypt(v_owner_password, extensions.gen_salt('bf', 4)), true, true),
    (v_other_license_id, 'other_owner_' || v_suffix, 'Other Owner', extensions.crypt(v_owner_password, extensions.gen_salt('bf', 4)), true, true),
    (v_limited_license_id, 'limited_owner_' || v_suffix, 'Limited Owner', extensions.crypt(v_owner_password, extensions.gen_salt('bf', 4)), true, true);

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values (
    v_staff_id, v_license_id, 'staff_' || v_suffix, 'Recovery Staff',
    extensions.crypt(v_staff_password, extensions.gen_salt('bf', 4)), 'staff', '{"pos_access":true}'::jsonb, true
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info, security_token,
    previous_security_token, is_active, device_role, device_mode, staff_user_id
  ) values
    (v_device_id, v_license_id, 'recovery-device-' || v_suffix, 'Recovery device', '{}'::jsonb, v_old_device_token, null, true, 'staff', 'staff_only', v_staff_id),
    (v_other_admin_device_id, v_license_id, 'other-admin-device-' || v_suffix, 'Other Admin device', '{}'::jsonb, 'other-admin-token-' || v_suffix, null, true, 'admin', 'admin_only', null),
    (v_expired_device_id, v_expired_license_id, 'expired-device-' || v_suffix, 'Expired device', '{}'::jsonb, 'expired-device-token-' || v_suffix, null, true, 'staff', 'staff_only', null),
    (v_other_device_id, v_other_license_id, 'other-device-' || v_suffix, 'Other device', '{}'::jsonb, 'other-device-token-' || v_suffix, null, true, 'staff', 'staff_only', null),
    (v_inactive_device_id, v_license_id, 'inactive-device-' || v_suffix, 'Inactive device', '{}'::jsonb, 'inactive-device-token-' || v_suffix, null, false, 'staff', 'staff_only', null),
    (v_limited_device_id, v_limited_license_id, 'limited-device-' || v_suffix, 'Limited device', '{}'::jsonb, 'limited-device-token-' || v_suffix, null, true, 'staff', 'staff_only', null),
    (v_limit_extra_device_id, v_limited_license_id, 'limited-extra-' || v_suffix, 'Extra active device', '{}'::jsonb, 'limited-extra-token-' || v_suffix, null, true, 'admin', 'admin_only', null);

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at, metadata
  ) values (
    v_license_id, v_staff_id, v_device_id,
    extensions.crypt('old-staff-session-' || v_suffix, extensions.gen_salt('bf', 4)),
    now() + interval '1 day', '{"fixture":true}'::jsonb
  );

  v_result := public.admin_recover_staff_only_device(null, null, null, null, null);
  if v_result->>'code' is distinct from 'ADMIN_RECOVERY_INVALID_REQUEST'
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'staff_only' then
    raise exception 'MISSING_CREDENTIALS_CHANGED_DEVICE:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Ordinary Admin login must retain its existing staff_only rejection.
  v_result := public.admin_login_on_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'recovery-device-' || v_suffix, 'Recovery device', '{}'::jsonb
  );
  if v_result->>'code' is distinct from 'DEVICE_MODE_ADMIN_NOT_ALLOWED' then
    raise exception 'NORMAL_ADMIN_LOGIN_POLICY_CHANGED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- A wrong password cannot alter the mode or revoke the active Staff session.
  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'owner_' || v_suffix, 'wrong-password',
    'recovery-device-' || v_suffix, v_old_device_token
  );
  if v_result->>'code' is distinct from 'INVALID_ADMIN_CREDENTIALS'
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'staff_only'
     or (select revoked_at from public.license_staff_sessions where device_id = v_device_id limit 1) is not null then
    raise exception 'WRONG_PASSWORD_CHANGED_DEVICE:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Staff credentials never satisfy the owner-only lookup.
  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'staff_' || v_suffix, v_staff_password,
    'recovery-device-' || v_suffix, v_old_device_token
  );
  if v_result->>'code' is distinct from 'INVALID_ADMIN_CREDENTIALS'
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'staff_only' then
    raise exception 'STAFF_CREDENTIALS_ACCEPTED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- An inactive owner, expired license, foreign-tenant device, and bad device token fail closed.
  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'inactive_' || v_suffix, v_owner_password,
    'recovery-device-' || v_suffix, v_old_device_token
  );
  if v_result->>'code' is distinct from 'INVALID_ADMIN_CREDENTIALS' then
    raise exception 'INACTIVE_OWNER_ACCEPTED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_result := public.admin_recover_staff_only_device(
    v_expired_license_key, 'expired_owner_' || v_suffix, v_owner_password,
    'expired-device-' || v_suffix, 'expired-device-token-' || v_suffix
  );
  if v_result->>'code' is distinct from 'LICENSE_NOT_ACTIVE' then
    raise exception 'EXPIRED_LICENSE_ACCEPTED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'other-device-' || v_suffix, 'other-device-token-' || v_suffix
  );
  if v_result->>'code' is distinct from 'DEVICE_NOT_ALLOWED' then
    raise exception 'CROSS_TENANT_DEVICE_ACCEPTED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'inactive-device-' || v_suffix, 'inactive-device-token-' || v_suffix
  );
  if v_result->>'code' is distinct from 'DEVICE_NOT_ACTIVE'
     or (select device_mode from public.license_devices where id = v_inactive_device_id) is distinct from 'staff_only' then
    raise exception 'INACTIVE_DEVICE_ACCEPTED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'recovery-device-' || v_suffix, 'invalid-device-token'
  );
  if v_result->>'code' is distinct from 'DEVICE_TOKEN_INVALID'
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'staff_only' then
    raise exception 'INVALID_DEVICE_PROOF_ACCEPTED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_result := public.admin_recover_staff_only_device(
    v_limited_license_key, 'limited_owner_' || v_suffix, v_owner_password,
    'limited-device-' || v_suffix, 'limited-device-token-' || v_suffix
  );
  if v_result->>'code' is distinct from 'DEVICE_LIMIT_REACHED'
     or (select device_mode from public.license_devices where id = v_limited_device_id) is distinct from 'staff_only'
     or (select security_token from public.license_devices where id = v_limited_device_id) is distinct from 'limited-device-token-' || v_suffix then
    raise exception 'DEVICE_LIMIT_WAS_BYPASSED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- The successful call is the atomic owner-authorized mode transition.
  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'recovery-device-' || v_suffix, v_old_device_token
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'device_mode' is distinct from 'admin_only'
     or v_result->'admin_user'->>'id' is distinct from v_owner_id::text then
    raise exception 'OWNER_RECOVERY_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  v_new_device_token := v_result->>'device_security_token';
  v_admin_session_token := v_result->>'admin_session_token';
  if v_new_device_token is null or v_new_device_token = v_old_device_token
     or v_admin_session_token is null
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'admin_only'
     or (select device_role from public.license_devices where id = v_device_id) is distinct from 'admin'
     or (select staff_user_id from public.license_devices where id = v_device_id) is not null
     or (select security_token from public.license_devices where id = v_device_id) is distinct from v_new_device_token
     or (select previous_security_token from public.license_devices where id = v_device_id) is not null then
    raise exception 'DEVICE_TRANSITION_INCOMPLETE';
  end if;

  select count(*) into v_revoked
  from public.license_staff_sessions
  where device_id = v_device_id and revoked_at is not null;
  if v_revoked <> 1 then
    raise exception 'STAFF_SESSION_NOT_REVOKED:%', v_revoked;
  end if;

  if not exists (
       select 1 from public.license_admin_sessions s
       where s.device_id = v_device_id and s.admin_user_id = v_owner_id
         and s.revoked_at is null
         and extensions.crypt(v_admin_session_token, s.session_token_hash) = s.session_token_hash
     )
     or not exists (
       select 1 from public.license_events e
       where e.license_key = v_license_key and e.event_type = 'DEVICE_MODE_CHANGED'
         and e.metadata->>'change_source' = 'OWNER_DEVICE_RECOVERY'
         and e.metadata->>'target_device_id' = v_device_id::text
     ) then
    raise exception 'ADMIN_SESSION_OR_AUDIT_MISSING';
  end if;

  v_auth := private.require_active_admin_session(
    v_license_key, 'recovery-device-' || v_suffix, v_new_device_token, v_admin_session_token
  );
  if coalesce((v_auth->>'success')::boolean, false) is not true then
    raise exception 'ISSUED_ADMIN_SESSION_NOT_AUTHORIZED:%', coalesce(v_auth->>'code', 'NO_CODE');
  end if;

  -- Simulate a lost HTTP response: a fresh normal Admin login can recover the
  -- new Admin session, while the ordinary login still cannot enter staff_only.
  v_result := public.admin_login_on_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'recovery-device-' || v_suffix, 'Recovery device', '{}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'device_mode' is distinct from 'admin_only' then
    raise exception 'LOST_RESPONSE_ADMIN_RELOGIN_FAILED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- A separate already-authorized Admin device continues to use the ordinary
  -- login contract and is not changed by this single-device recovery.
  v_result := public.admin_login_on_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'other-admin-device-' || v_suffix, 'Other Admin device', '{}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'device_mode' is distinct from 'admin_only'
     or (select device_mode from public.license_devices where id = v_other_admin_device_id) is distinct from 'admin_only'
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'admin_only' then
    raise exception 'OTHER_ADMIN_DEVICE_LOGIN_CHANGED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Retry with the stale pre-transition device token cannot mutate the device.
  v_result := public.admin_recover_staff_only_device(
    v_license_key, 'owner_' || v_suffix, v_owner_password,
    'recovery-device-' || v_suffix, v_old_device_token
  );
  if v_result->>'code' is distinct from 'DEVICE_MODE_ALREADY_ADMIN_ONLY'
     or (select device_mode from public.license_devices where id = v_device_id) is distinct from 'admin_only' then
    raise exception 'RECOVERY_RETRY_NOT_BOUNDED:%', coalesce(v_result->>'code', 'NO_CODE');
  end if;

  -- Recovery must not make the Staff login contract accept the old account.
  v_result := public.staff_login_on_device(
    v_license_key, 'recovery-device-' || v_suffix, 'Recovery device', '{}'::jsonb,
    'staff_' || v_suffix, v_staff_password
  );
  if coalesce((v_result->>'success')::boolean, false) is true
     or exists (select 1 from public.license_staff_sessions where device_id = v_device_id and revoked_at is null) then
    raise exception 'STAFF_LOGIN_REMAINS_ACTIVE';
  end if;

  -- The migration must keep the recovery RPC callable only by the client roles
  -- that already call the Admin login RPC.
  if not has_function_privilege('anon', 'public.admin_recover_staff_only_device(text,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_recover_staff_only_device(text,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.admin_recover_staff_only_device(text,text,text,text,text)', 'EXECUTE') then
    raise exception 'RECOVERY_RPC_GRANTS_MISSING';
  end if;
  if exists (
    select 1
    from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = 'public.admin_recover_staff_only_device(text,text,text,text,text)'::regprocedure
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'RECOVERY_RPC_PUBLIC_EXECUTE_NOT_REVOKED';
  end if;
end;
$test$;

rollback;
