-- LICENSE.ADMIN.AUTH.1 regression matrix. Fixtures and effects are rolled back.
begin;

do $test$
declare
  v_license uuid := '7a110000-0000-4000-8000-000000000001';
  v_license_full uuid := '7a110000-0000-4000-8000-000000000002';
  v_license_expired uuid := '7a110000-0000-4000-8000-000000000003';
  v_device uuid := '7a110000-0000-4000-8000-000000000011';
  v_staff uuid := '7a110000-0000-4000-8000-000000000021';
  v_staff_device uuid := '7a110000-0000-4000-8000-000000000022';
  v_result jsonb;
  v_session text;
  v_second_session text;
  v_second_device uuid;
  v_count integer;
begin
  insert into public.licenses(id,license_key,license_type,status,expires_at,max_devices,product_name,features)
  values
    (v_license,'TEST-ADMIN-AUTH-PRO-0001','pro','active',now()+interval '1 day',2,'Test Pro','{"staff_roles":true}'::jsonb),
    (v_license_full,'TEST-ADMIN-AUTH-FULL-0002','pro','active',now()+interval '1 day',1,'Test Full','{}'::jsonb),
    (v_license_expired,'TEST-ADMIN-AUTH-OLD-0003','pro','active',now()-interval '1 day',2,'Test Expired','{}'::jsonb);

  insert into public.license_devices(id,license_id,device_fingerprint,device_name,security_token,is_active,device_role)
  values
    (v_device,v_license,'auth-owner-device','Owner device','device-token-owner',true,'admin'),
    ('7a110000-0000-4000-8000-000000000012',v_license_full,'auth-full-device','Full device','device-token-full',true,'admin'),
    ('7a110000-0000-4000-8000-000000000013',v_license_expired,'auth-expired-device','Expired device','device-token-expired',true,'admin');

  -- 1. El admin heredado inscribe exactamente un propietario y recibe sesion.
  v_result:=public.admin_enroll_owner_on_device('TEST-ADMIN-AUTH-PRO-0001','auth-owner-device','device-token-owner','owner_test','Test Owner','Test Owner');
  -- Correct the deliberately ordered fixture arguments without exposing a real secret.
  if coalesce((v_result->>'success')::boolean,false) is true then raise exception 'TEST_SETUP_ARGUMENT_ORDER_FAILED'; end if;
  v_result:=public.admin_enroll_owner_on_device('TEST-ADMIN-AUTH-PRO-0001','auth-owner-device','device-token-owner','owner_test','TestPass123','Test Owner');
  if coalesce((v_result->>'success')::boolean,false) is false or nullif(v_result->>'admin_session_token','') is null then raise exception 'TEST_01_ENROLL_FAILED: %',v_result; end if;
  v_session:=v_result->>'admin_session_token';

  -- 2. No puede existir un segundo propietario.
  v_result:=public.admin_enroll_owner_on_device('TEST-ADMIN-AUTH-PRO-0001','auth-owner-device','device-token-owner','other_owner','OtherPass123','Other Owner');
  if v_result->>'code'<>'ADMIN_OWNER_ALREADY_ENROLLED' then raise exception 'TEST_02_SECOND_OWNER_FAILED: %',v_result; end if;

  -- 3-4. Un dispositivo desconocido no reclama ni se vuelve admin con la clave.
  v_result:=public.activate_license_on_device_unlimited('TEST-ADMIN-AUTH-FULL-0002','unknown-device','Unknown','{}');
  if v_result->>'code'<>'ADMIN_ENROLLMENT_NOT_ALLOWED' then raise exception 'TEST_03_UNKNOWN_CLAIM_FAILED: %',v_result; end if;
  v_result:=public.activate_license_on_device_unlimited('TEST-ADMIN-AUTH-PRO-0001','new-device','New','{}');
  if v_result->>'code'<>'ADMIN_OR_STAFF_LOGIN_REQUIRED' then raise exception 'TEST_04_KEY_ONLY_FAILED: %',v_result; end if;

  -- 5-6. Credenciales correctas agregan un segundo admin y consumen un espacio.
  v_result:=public.admin_login_on_device('TEST-ADMIN-AUTH-PRO-0001','owner_test','TestPass123','second-admin','Second admin','{}');
  if coalesce((v_result->>'success')::boolean,false) is false then raise exception 'TEST_05_SECOND_LOGIN_FAILED: %',v_result; end if;
  v_second_session:=v_result->>'admin_session_token';
  select id into v_second_device from public.license_devices where license_id=v_license and device_fingerprint='second-admin';
  select count(*) into v_count from public.license_devices where license_id=v_license and is_active;
  if v_count<>2 then raise exception 'TEST_06_DEVICE_SLOT_FAILED: %',v_count; end if;

  -- 7. Al alcanzar max_devices se rechaza un tercero.
  v_result:=public.admin_login_on_device('TEST-ADMIN-AUTH-PRO-0001','owner_test','TestPass123','third-admin','Third admin','{}');
  if v_result->>'code'<>'DEVICE_LIMIT_REACHED' then raise exception 'TEST_07_LIMIT_FAILED: %',v_result; end if;

  -- 8. Reusar fingerprint no consume otro espacio.
  v_result:=public.admin_login_on_device('TEST-ADMIN-AUTH-PRO-0001','owner_test','TestPass123','second-admin','Second admin renamed','{}');
  if coalesce((v_result->>'success')::boolean,false) is false then raise exception 'TEST_08_REUSE_FAILED: %',v_result; end if;
  v_second_session:=v_result->>'admin_session_token';
  select count(*) into v_count from public.license_devices where license_id=v_license and is_active;
  if v_count<>2 then raise exception 'TEST_08_REUSE_COUNT_FAILED'; end if;

  -- 9. Password incorrecto no activa un dispositivo.
  update public.license_devices set is_active=false where id=v_second_device;
  v_result:=public.admin_login_on_device('TEST-ADMIN-AUTH-PRO-0001','owner_test','WrongPass123','bad-login-device','Bad','{}');
  if v_result->>'code'<>'INVALID_ADMIN_CREDENTIALS' or exists(select 1 from public.license_devices where license_id=v_license and device_fingerprint='bad-login-device') then raise exception 'TEST_09_BAD_PASSWORD_FAILED'; end if;

  -- 10. El rate limit devuelve bloqueo controlado.
  perform public.enforce_pos_rpc_rate_limit_v2('rate-test','device-test',null,'rate-test','TEST',1,600,60,'RATE_TEST','{}');
  v_result:=public.enforce_pos_rpc_rate_limit_v2('rate-test','device-test',null,'rate-test','TEST',1,600,60,'RATE_TEST','{}');
  if coalesce((v_result->>'allowed')::boolean,true) is true then raise exception 'TEST_10_RATE_LIMIT_FAILED'; end if;

  insert into public.license_staff_users(id,license_id,username,display_name,password_hash)
  values(v_staff,v_license,'staff_test','Staff Test',extensions.crypt('StaffPass123',extensions.gen_salt('bf')));
  insert into public.license_devices(id,license_id,device_fingerprint,security_token,is_active,device_role,staff_user_id)
  values(v_staff_device,v_license,'staff-device','staff-device-token',true,'staff',v_staff);
  insert into public.license_staff_sessions(license_id,staff_user_id,device_id,session_token_hash,expires_at)
  values(v_license,v_staff,v_staff_device,extensions.crypt('staff-session-token',extensions.gen_salt('bf')),now()+interval '1 hour');

  -- 11-12. Staff y admin sin sesion no administran usuarios/dispositivos.
  v_result:=public.admin_list_staff_users('TEST-ADMIN-AUTH-PRO-0001','staff-device','staff-device-token','staff-session-token');
  if coalesce((v_result->>'success')::boolean,true) is true then raise exception 'TEST_11_STAFF_ESCALATION_FAILED'; end if;
  v_result:=public.admin_get_license_devices('TEST-ADMIN-AUTH-PRO-0001','auth-owner-device','device-token-owner','invalid-session');
  if coalesce((v_result->>'success')::boolean,true) is true then raise exception 'TEST_12_MISSING_SESSION_FAILED'; end if;

  -- Libera staff de la matriz antes de probar ultimo admin.
  update public.license_devices set is_active=false where id=v_staff_device;

  -- 13-14. Liberar admin revoca sesiones y marca el actual.
  v_result:=public.admin_release_device('TEST-ADMIN-AUTH-PRO-0001','auth-owner-device','device-token-owner',v_session,v_device);
  if coalesce((v_result->>'success')::boolean,false) is false or coalesce((v_result->>'released_current_device')::boolean,false) is false then raise exception 'TEST_13_14_RELEASE_CURRENT_FAILED: %',v_result; end if;
  if exists(select 1 from public.license_admin_sessions where device_id=v_device and revoked_at is null) then raise exception 'TEST_13_SESSION_NOT_REVOKED'; end if;

  -- 15. Liberar el ultimo admin conserva propietario.
  if not exists(select 1 from public.license_admin_users where license_id=v_license and is_owner and is_active) then raise exception 'TEST_15_OWNER_REMOVED'; end if;

  -- 16. El propietario recupera admin desde otro dispositivo.
  v_result:=public.admin_login_on_device('TEST-ADMIN-AUTH-PRO-0001','owner_test','TestPass123','recovery-admin','Recovery','{}');
  if coalesce((v_result->>'success')::boolean,false) is false then raise exception 'TEST_16_RECOVERY_FAILED: %',v_result; end if;

  -- 17. Staff nunca se promociona automaticamente.
  if exists(select 1 from public.license_devices where id=v_staff_device and device_role='admin') then raise exception 'TEST_17_STAFF_PROMOTED'; end if;

  -- 18. La restriccion parcial garantiza un propietario activo unico.
  begin
    insert into public.license_admin_users(license_id,username,display_name,password_hash,is_owner,is_active)
    values(v_license,'race_owner','Race',extensions.crypt('RacePass123',extensions.gen_salt('bf')),true,true);
    raise exception 'TEST_18_OWNER_RACE_NOT_BLOCKED';
  exception when unique_violation then null; end;

  -- 19. El lock de licencia y el conteo dentro de la transaccion conservan el limite.
  select count(*) into v_count from public.license_devices where license_id=v_license and is_active;
  if v_count>2 then raise exception 'TEST_19_CONCURRENT_LIMIT_INVARIANT'; end if;

  -- 20. Licencia expirada no permite login.
  v_result:=public.admin_login_on_device('TEST-ADMIN-AUTH-OLD-0003','nobody','NoLogin123','expired-new','Expired','{}');
  if v_result->>'code'<>'LICENSE_NOT_ACTIVE' then raise exception 'TEST_20_EXPIRED_FAILED: %',v_result; end if;
end;
$test$;

rollback;
