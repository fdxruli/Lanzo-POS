-- Remove only historical site versions. The active publication and restore ancestry stay immutable.
create or replace function private.ecommerce_site_delete_version_v2(p_auth jsonb, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_doc public.ecommerce_site_documents%rowtype;
  v_version public.ecommerce_site_versions%rowtype;
begin
  v_doc := private.ecommerce_site_document_for_auth(p_auth, true);
  if v_doc.portal_id is null then
    return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED');
  end if;

  select * into v_version
  from public.ecommerce_site_versions
  where id = p_version_id and portal_id = v_doc.portal_id
  for update;

  if v_version.id is null then
    return private.ecommerce_admin_error('ECOMMERCE_SITE_VERSION_NOT_FOUND');
  end if;
  if v_version.id = v_doc.published_version_id then
    return private.ecommerce_admin_error('ECOMMERCE_SITE_PUBLISHED_VERSION_PROTECTED');
  end if;
  if exists (
    select 1 from public.ecommerce_site_versions
    where restored_from_version_id = v_version.id
  ) then
    return private.ecommerce_admin_error('ECOMMERCE_SITE_VERSION_REFERENCED');
  end if;

  delete from public.ecommerce_site_versions where id = v_version.id;
  return jsonb_build_object('success', true, 'deletedVersionId', v_version.id);
exception when others then
  return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED');
end;
$$;

create or replace function public.ecommerce_admin_delete_site_version_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_version_id uuid
) returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_auth jsonb;
begin
  v_auth := private.ecommerce_site_authorize(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'ecommerce_admin_delete_site_version_v2'
  );
  if coalesce((v_auth->>'success')::boolean, false) is not true then
    return v_auth;
  end if;
  return private.ecommerce_site_delete_version_v2(v_auth, p_version_id);
end;
$$;

revoke all on function private.ecommerce_site_delete_version_v2(jsonb,uuid) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_delete_site_version_v2(text,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_delete_site_version_v2(text,text,text,text,uuid) to anon, authenticated, service_role;
