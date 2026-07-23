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
