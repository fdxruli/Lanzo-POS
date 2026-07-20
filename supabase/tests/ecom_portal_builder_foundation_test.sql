-- ECOM.PORTAL.BUILDER.1 real-RPC matrix.
-- Run after the four aligned migrations plus the local hardening migration.
-- Every fixture is disposable and the whole suite is transactional.
begin;

do $test$
declare
  v_license uuid := '10000000-0000-4000-8000-000000000101';
  v_free_license uuid := '10000000-0000-4000-8000-000000000102';
  v_portal_a uuid := '10000000-0000-4000-8000-000000000103';
  v_portal_b uuid := '10000000-0000-4000-8000-000000000104';
  v_admin_device uuid := '10000000-0000-4000-8000-000000000105';
  v_staff_ok uuid := '10000000-0000-4000-8000-000000000106';
  v_staff_bad uuid := '10000000-0000-4000-8000-000000000107';
  v_staff_ok_device uuid := '10000000-0000-4000-8000-000000000108';
  v_staff_bad_device uuid := '10000000-0000-4000-8000-000000000109';
  v_free_device uuid := '10000000-0000-4000-8000-000000000110';
  v_admin_result jsonb;
  v_save_result jsonb;
  v_publish_result jsonb;
  v_restore_result jsonb;
  v_public_result jsonb;
  v_default jsonb := private.ecommerce_site_default_document('classic');
  v_custom jsonb;
  v_revision bigint;
  v_version_a uuid;
  v_published_before uuid;
  v_grant record;
  v_error text;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, features)
  values
    (v_license, 'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'pro', 'active', clock_timestamp() + interval '1 day',
      jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_layout_customization', 'advanced')),
    (v_free_license, 'ECOM-PORTAL-BUILDER-1-FREE-ROLLBACK', 'free', 'active', clock_timestamp() + interval '1 day',
      jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_layout_customization', 'template_only'));

  insert into public.license_devices(id, license_id, device_fingerprint, security_token, is_active, device_role)
  values
    (v_admin_device, v_license, 'portal-builder-admin-device', 'portal-builder-admin-token', true, 'admin'),
    (v_free_device, v_free_license, 'portal-builder-free-device', 'portal-builder-free-token', true, 'admin');

  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values
    (v_staff_ok, v_license, 'portal_builder_staff_ok', 'Portal builder staff', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"settings":true,"ecommerce":true}'::jsonb),
    (v_staff_bad, v_license, 'portal_builder_staff_bad', 'Portal builder denied', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"settings":false,"ecommerce":false}'::jsonb);

  insert into public.license_devices(id, license_id, device_fingerprint, security_token, is_active, device_role, staff_user_id)
  values
    (v_staff_ok_device, v_license, 'portal-builder-staff-ok-device', 'portal-builder-staff-ok-token', true, 'staff', v_staff_ok),
    (v_staff_bad_device, v_license, 'portal-builder-staff-bad-device', 'portal-builder-staff-bad-token', true, 'staff', v_staff_bad);

  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values
    (v_license, v_staff_ok, v_staff_ok_device, extensions.crypt('portal-builder-staff-ok-session', extensions.gen_salt('bf')), clock_timestamp() + interval '1 hour'),
    (v_license, v_staff_bad, v_staff_bad_device, extensions.crypt('portal-builder-staff-bad-session', extensions.gen_salt('bf')), clock_timestamp() + interval '1 hour');

  insert into public.ecommerce_portals(id, license_id, slug, status, name, ordering_enabled, pickup_enabled, business_hours_enabled, timezone)
  values
    (v_portal_a, v_license, 'portal-builder-a-rollback', 'published', 'Builder A', true, true, false, 'America/Mexico_City'),
    (v_portal_b, v_free_license, 'portal-builder-b-rollback', 'published', 'Builder B', true, true, false, 'America/Mexico_City');

  insert into public.ecommerce_site_documents(portal_id, draft_document)
  values (v_portal_b, private.ecommerce_site_default_document('classic'));

  -- Authorization matrix exercises the public RPC boundary, not private helpers.
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  if coalesce((v_admin_result->>'success')::boolean, false) is not true then raise exception 'admin valid failed: %', v_admin_result; end if;
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-staff-ok-device', 'portal-builder-staff-ok-token', 'portal-builder-staff-ok-session');
  if coalesce((v_admin_result->>'success')::boolean, false) is not true then raise exception 'staff with settings/ecommerce failed: %', v_admin_result; end if;
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-staff-bad-device', 'portal-builder-staff-bad-token', 'portal-builder-staff-bad-session');
  if coalesce((v_admin_result->>'success')::boolean, true) is true then raise exception 'staff without settings/ecommerce was accepted'; end if;
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'invalid-device', 'portal-builder-admin-token', null);
  if coalesce((v_admin_result->>'success')::boolean, true) is true then raise exception 'invalid device was accepted'; end if;
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-FREE-ROLLBACK', 'portal-builder-free-device', 'portal-builder-free-token', null);
  if (v_admin_result->>'code') <> 'ECOMMERCE_SITE_ACCESS_DENIED' then raise exception 'Free plan was not rejected: %', v_admin_result; end if;

  -- Default document, optimistic revision, invalid and oversized payloads.
  v_revision := (v_admin_result #>> '{draft,revision}')::bigint;
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  v_revision := (v_admin_result #>> '{draft,revision}')::bigint;
  if v_admin_result #>> '{draft,document,sections,1,props,showSearch}' <> 'true' then raise exception 'default document missing'; end if;
  v_save_result := public.ecommerce_admin_save_site_draft('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, v_revision, v_default);
  if coalesce((v_save_result->>'success')::boolean, false) is not true or (v_save_result #>> '{draft,revision}')::bigint <> v_revision + 1 then raise exception 'save/revision failed: %', v_save_result; end if;
  v_save_result := public.ecommerce_admin_save_site_draft('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, v_revision, v_default);
  if (v_save_result->>'code') <> 'ECOMMERCE_SITE_DRAFT_CONFLICT' then raise exception 'stale revision was accepted: %', v_save_result; end if;
  v_save_result := public.ecommerce_admin_save_site_draft('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, v_revision + 1, '{}'::jsonb);
  if coalesce((v_save_result->>'success')::boolean, true) is true then raise exception 'invalid document was accepted'; end if;
  v_save_result := public.ecommerce_admin_save_site_draft('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, v_revision + 1, jsonb_build_object('note', repeat('x', 70000)));
  if (v_save_result->>'code') <> 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE' then raise exception 'oversized document was not rejected: %', v_save_result; end if;

  -- Publish, backend checksum, idempotency and metadata-only pagination.
  v_publish_result := public.ecommerce_admin_publish_site('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  if coalesce((v_publish_result->>'success')::boolean, false) is not true then raise exception 'publish failed: %', v_publish_result; end if;
  v_version_a := (v_publish_result #>> '{published,versionId}')::uuid;
  select published_version_id into v_published_before from public.ecommerce_site_documents where portal_id = v_portal_a;
  if v_published_before <> v_version_a then raise exception 'published pointer mismatch'; end if;
  if not exists (select 1 from public.ecommerce_site_versions where id=v_version_a and document_checksum=encode(extensions.digest(document::text, 'sha256'), 'hex')) then raise exception 'backend checksum mismatch'; end if;
  v_publish_result := public.ecommerce_admin_publish_site('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  if (v_publish_result->>'idempotent')::boolean is not true then raise exception 'repeat publish is not idempotent'; end if;
  v_admin_result := public.ecommerce_admin_list_site_versions('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, 20, 0);
  if v_admin_result ? 'document' or (v_admin_result #>> '{versions,0,document}') is not null then raise exception 'history leaked document: %', v_admin_result; end if;

  -- Restore changes draft and revision only; publication remains explicit.
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  v_revision := (v_admin_result #>> '{draft,revision}')::bigint;
  v_custom := jsonb_set(v_default, '{global,density}', '"compact"'::jsonb);
  v_save_result := public.ecommerce_admin_save_site_draft('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, v_revision, v_custom);
  v_publish_result := public.ecommerce_admin_publish_site('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  v_admin_result := public.ecommerce_admin_get_site_builder('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null);
  v_revision := (v_admin_result #>> '{draft,revision}')::bigint;
  v_restore_result := public.ecommerce_admin_restore_site_version('ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK', 'portal-builder-admin-device', 'portal-builder-admin-token', null, v_version_a);
  if coalesce((v_restore_result->>'success')::boolean, false) is not true or (v_restore_result #>> '{draft,revision}')::bigint <> v_revision + 1 then raise exception 'restore failed: %', v_restore_result; end if;
  if (select published_version_id from public.ecommerce_site_documents where portal_id=v_portal_a) <> (v_publish_result #>> '{published,versionId}')::uuid then raise exception 'restore changed publication'; end if;

  -- Public RPC returns only the published snapshot, never draft or history.
  v_public_result := public.ecommerce_get_portal_by_slug('portal-builder-a-rollback');
  if coalesce((v_public_result->>'success')::boolean, false) is not true or v_public_result ? 'versions' then raise exception 'public response leaked history: %', v_public_result; end if;
  if v_public_result->>'site' is null or v_public_result #>> '{site,document}' is null then raise exception 'published public document missing'; end if;
  if v_public_result::text ~* '(device_id|staff_user_id|security_token)' then raise exception 'public response leaked actor identifiers'; end if;

  -- Cross-portal published pointer must fail under the composite FK.
  begin
    update public.ecommerce_site_documents set published_version_id=v_version_a where portal_id=v_portal_b;
    raise exception 'cross-portal pointer accepted';
  exception when foreign_key_violation then null;
  end;

  -- Existing immutable trigger plus hardening protections.
  begin
    update public.ecommerce_site_versions set source='restore' where id=v_version_a;
    raise exception 'TEST_VERSION_UPDATE_ACCEPTED';
  exception when others then
    if sqlerrm = 'TEST_VERSION_UPDATE_ACCEPTED' then raise; end if;
  end;
  begin
    delete from public.ecommerce_site_versions where id=v_version_a;
    raise exception 'TEST_VERSION_DELETE_ACCEPTED';
  exception when others then
    if sqlerrm = 'TEST_VERSION_DELETE_ACCEPTED' then raise; end if;
  end;
  begin
    set local role service_role;
    truncate public.ecommerce_site_versions;
    raise exception 'TEST_RUNTIME_TRUNCATE_ACCEPTED';
  exception when others then
    v_error := sqlerrm;
    set local role postgres;
    if v_error = 'TEST_RUNTIME_TRUNCATE_ACCEPTED' then raise exception '%', v_error; end if;
  end;
  if has_table_privilege('service_role', 'public.ecommerce_site_versions', 'TRUNCATE') then raise exception 'service_role has TRUNCATE'; end if;
  if has_table_privilege('service_role', 'public.ecommerce_site_versions', 'UPDATE') then raise exception 'service_role has UPDATE on versions'; end if;
  if has_table_privilege('anon', 'public.ecommerce_site_documents', 'SELECT') or has_table_privilege('authenticated', 'public.ecommerce_site_versions', 'SELECT') then raise exception 'anon/authenticated have direct access'; end if;
  for v_grant in select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('ecommerce_site_documents','ecommerce_site_versions') and grantee='service_role' loop
    if v_grant.table_name='ecommerce_site_documents' and v_grant.privilege_type not in ('SELECT','INSERT','UPDATE') then raise exception 'unexpected documents grant: %', v_grant; end if;
    if v_grant.table_name='ecommerce_site_versions' and v_grant.privilege_type not in ('SELECT','INSERT') then raise exception 'unexpected versions grant: %', v_grant; end if;
  end loop;
end;
$test$;

rollback;
