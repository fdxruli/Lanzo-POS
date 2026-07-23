-- LICENSE.ADMIN.AUTH.1 cutover. Apply only after the compatible frontend is live.
do $$
begin
  if to_regprocedure('public.activate_license_on_device_legacy_free(text,text,text,jsonb)') is null
     and to_regprocedure('public.activate_license_on_device_unlimited(text,text,text,jsonb)') is not null then
    alter function public.activate_license_on_device_unlimited(text,text,text,jsonb)
      rename to activate_license_on_device_legacy_free;
  end if;
end;
$$;

create or replace function public.activate_license_on_device_unlimited(
  license_key_param text, device_fingerprint_param text, device_name_param text, device_info_param jsonb
) returns json language plpgsql security definer set search_path = '' as $$
declare v_license record; v_device record; v_has_owner boolean;
begin
  select l.id,l.status,l.expires_at,l.product_name,p.code as plan_code,
    coalesce(p.features,'{}'::jsonb)||coalesce(l.features,'{}'::jsonb) as features
  into v_license from public.licenses l left join public.plans p on p.id=l.plan_id
  where l.license_key=license_key_param for update of l;
  if v_license.id is null then return json_build_object('success',false,'code','LICENSE_NOT_FOUND'); end if;
  if v_license.status<>'active' or (v_license.expires_at is not null and v_license.expires_at<now()) then return json_build_object('success',false,'code','LICENSE_NOT_ACTIVE'); end if;
  if lower(coalesce(v_license.plan_code,''))='free_trial' then
    return public.activate_license_on_device_legacy_free(license_key_param,device_fingerprint_param,device_name_param,device_info_param);
  end if;
  select exists(select 1 from public.license_admin_users u where u.license_id=v_license.id and u.is_owner and u.is_active) into v_has_owner;
  if v_has_owner then return json_build_object('success',false,'code','ADMIN_OR_STAFF_LOGIN_REQUIRED','access_choice_required',true,'details',json_build_object('license_key',license_key_param,'device_role','admin')); end if;
  select * into v_device from public.license_devices d where d.license_id=v_license.id and d.device_fingerprint=device_fingerprint_param limit 1;
  if v_device.id is not null and v_device.is_active and v_device.device_role='admin' then
    return json_build_object('success',false,'code','ADMIN_ENROLLMENT_REQUIRED','admin_enrollment_required',true,'details',json_build_object('license_key',license_key_param,'device_role','admin'));
  end if;
  if v_device.id is not null and v_device.device_role='staff' then
    return json_build_object('success',false,'code','STAFF_LOGIN_REQUIRED','staff_login_required',true,'details',json_build_object('license_key',license_key_param,'device_role','staff'));
  end if;
  return json_build_object('success',false,'code','ADMIN_ENROLLMENT_NOT_ALLOWED');
end;
$$;

-- Ecommerce RPCs keep their historical fourth parameter for compatibility,
-- but after cutover it is strictly the current actor session: an admin token
-- is only accepted on an admin device and a staff token only on its staff
-- device.  The public RPCs already route through this shared helper.
create or replace function private.ecommerce_admin_authorize_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_actor_session_token text,
  p_rpc_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rate_limit jsonb;
  v_license record;
  v_device record;
  v_admin_auth jsonb;
  v_staff_verification jsonb;
  v_permissions jsonb;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null
     or nullif(btrim(coalesce(p_device_fingerprint, '')), '') is null
     or nullif(btrim(coalesce(p_security_token, '')), '') is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
  end if;

  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, null,
    coalesce(nullif(btrim(p_rpc_name), ''), 'ecommerce_admin'),
    'ECOM_ADMIN', 180, 600, 300, 'ECOMMERCE_RATE_LIMITED',
    jsonb_build_object('actor_partition', 'device')
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return private.ecommerce_admin_error('ECOMMERCE_RATE_LIMITED');
  end if;

  select l.id as license_id, p.code as plan_code, p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as effective_features
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key
     and l.status = 'active'
     and (l.expires_at is null or l.expires_at >= now())
   limit 1;
  if v_license.license_id is null then
    return private.ecommerce_admin_error('LICENSE_NOT_ACTIVE');
  end if;
  if private.ecommerce_license_feature_bool(v_license.license_id, 'ecommerce_portal_enabled', false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_DISABLED');
  end if;

  select d.id as device_id, d.device_role, d.staff_user_id
    into v_device
    from public.license_devices d
   where d.license_id = v_license.license_id
     and d.device_fingerprint = p_device_fingerprint
     and d.is_active is true
     and (d.security_token = p_security_token or d.previous_security_token = p_security_token)
   limit 1;
  if v_device.device_id is null then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
  end if;

  if v_device.device_role = 'admin' then
    if exists (
      select 1 from public.license_admin_users u
       where u.license_id = v_license.license_id and u.is_owner and u.is_active
    ) then
      v_admin_auth := private.require_active_admin_session(
        p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token
      );
      if coalesce((v_admin_auth->>'success')::boolean, false) is false then
        return private.ecommerce_admin_error(
          'ECOMMERCE_ADMIN_SESSION_REQUIRED',
          'Inicia sesion como administrador para continuar.'
        );
      end if;
    end if;
    return jsonb_build_object(
      'success', true, 'license_id', v_license.license_id, 'device_id', v_device.device_id,
      'device_role', 'admin', 'actor_type', 'admin_owner',
      'admin_user_id', v_admin_auth->>'admin_user_id', 'staff_user_id', null,
      'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name,
      'features', v_license.effective_features
    );
  end if;

  if v_device.device_role <> 'staff' or nullif(btrim(coalesce(p_actor_session_token, '')), '') is null then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_SESSION_REQUIRED');
  end if;
  v_staff_verification := public.verify_staff_session_unlimited(
    p_license_key, p_device_fingerprint, p_actor_session_token
  );
  if coalesce((v_staff_verification->>'valid')::boolean, false) is false
     or v_device.staff_user_id is null
     or coalesce(v_staff_verification#>>'{staff_user,id}', '') <> v_device.staff_user_id::text then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_SESSION_INVALID');
  end if;
  select s.permissions into v_permissions
    from public.license_staff_users s
   where s.id = v_device.staff_user_id
     and s.license_id = v_license.license_id
     and s.is_active
   limit 1;
  if v_permissions is null then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_SESSION_INVALID');
  end if;
  if coalesce((v_permissions->>'settings')::boolean, false) is not true
     or coalesce((v_permissions->>'ecommerce')::boolean, false) is not true then
    return private.ecommerce_admin_error('ECOMMERCE_STAFF_PERMISSION_DENIED');
  end if;
  return jsonb_build_object(
    'success', true, 'license_id', v_license.license_id, 'device_id', v_device.device_id,
    'device_role', 'staff', 'actor_type', 'staff', 'staff_user_id', v_device.staff_user_id,
    'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name,
    'features', v_license.effective_features
  );
exception when others then
  return private.ecommerce_admin_error('ECOMMERCE_ADMIN_ACCESS_DENIED');
end;
$$;

create or replace function private.ecommerce_admin_authorize(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_rpc_name text
)
returns jsonb language sql security definer set search_path = '' as $$
  select private.ecommerce_admin_authorize_v2($1, $2, $3, null, $4);
$$;

revoke all on function private.ecommerce_admin_authorize_v2(text,text,text,text,text)
  from public, anon, authenticated, service_role;
revoke all on function private.ecommerce_admin_authorize(text,text,text,text)
  from public, anon, authenticated, service_role;

revoke all on function public.admin_list_staff_users(text,text,text) from public,anon,authenticated;
revoke all on function public.admin_create_staff_user(text,text,text,text,text,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text) from public,anon,authenticated;
revoke all on function public.get_license_devices_anon(text,text) from public,anon,authenticated;
revoke all on function public.get_license_devices_anon_unlimited(text,text) from public,anon,authenticated;
revoke all on function public.release_device_anon(uuid,text,text) from public,anon,authenticated;
revoke all on function public.release_device_anon_unlimited(uuid,text,text) from public,anon,authenticated;
revoke all on function public.activate_license_on_device_legacy_free(text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.activate_license_on_device_unlimited(text,text,text,jsonb) from public;
grant execute on function public.activate_license_on_device_unlimited(text,text,text,jsonb) to anon,authenticated;
notify pgrst, 'reload schema';
