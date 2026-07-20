begin;
create function pg_temp.assert_site_document_error(
p_case text,
p_document jsonb,
p_expected text
)
returns void
language plpgsql
as $$
declare
v_actual text;
begin
v_actual := private.ecommerce_site_document_error(p_document);
if v_actual is distinct from p_expected then
raise exception 'validator case % expected %, got %', p_case, p_expected, v_actual;
end if;
end;
$$;
do $test$
declare
v_license uuid := '10000000-0000-4000-8000-000000000101';
v_free_license uuid := '10000000-0000-4000-8000-000000000102';
v_limited_license uuid := '10000000-0000-4000-8000-000000000103';
v_inactive_license uuid := '10000000-0000-4000-8000-000000000104';
v_portal_a uuid := '10000000-0000-4000-8000-000000000111';
v_portal_b uuid := '10000000-0000-4000-8000-000000000112';
v_admin_device uuid := '10000000-0000-4000-8000-000000000121';
v_staff_ok uuid := '10000000-0000-4000-8000-000000000122';
v_staff_bad uuid := '10000000-0000-4000-8000-000000000123';
v_staff_ok_device uuid := '10000000-0000-4000-8000-000000000124';
v_staff_bad_device uuid := '10000000-0000-4000-8000-000000000125';
v_free_device uuid := '10000000-0000-4000-8000-000000000126';
v_limited_device uuid := '10000000-0000-4000-8000-000000000127';
v_inactive_device uuid := '10000000-0000-4000-8000-000000000128';
v_admin_valid jsonb;
v_staff_valid jsonb;
v_staff_denied jsonb;
v_staff_invalid_session jsonb;
v_invalid_device jsonb;
v_inactive_result jsonb;
v_free_result jsonb;
v_limited_result jsonb;
v_builder jsonb;
v_save jsonb;
v_publish jsonb;
v_publish_repeat jsonb;
v_restore jsonb;
v_public jsonb;
v_history jsonb;
v_default jsonb := private.ecommerce_site_default_document('classic');
v_compact_default jsonb := private.ecommerce_site_default_document('compact');
v_custom jsonb;
v_large jsonb;
v_revision bigint;
v_revision_before bigint;
v_document_before jsonb;
v_mode_before text;
v_published_before uuid;
v_version_default uuid;
v_version_custom uuid;
v_version_default_2 uuid;
v_version_b uuid := '10000000-0000-4000-8000-000000000199';
v_count_before bigint;
v_count_after bigint;
v_error text;
v_privileges text[];
begin
perform pg_temp.assert_site_document_error('default valid', v_default, null);
perform pg_temp.assert_site_document_error('null', null::jsonb, 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('array', '[]'::jsonb, 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('empty object', '{}'::jsonb, 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('schemaVersion absent', v_default - 'schemaVersion', 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('schemaVersion null', jsonb_set(v_default, '{schemaVersion}', 'null'::jsonb), 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED');
perform pg_temp.assert_site_document_error('schemaVersion incorrect', jsonb_set(v_default, '{schemaVersion}', '2'::jsonb), 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED');
perform pg_temp.assert_site_document_error('global absent', v_default - 'global', 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('global null', jsonb_set(v_default, '{global}', 'null'::jsonb), 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error(
'themeSource absent',
jsonb_set(v_default, '{global}', (v_default->'global') - 'themeSource'),
'ECOMMERCE_SITE_DOCUMENT_INVALID'
);
perform pg_temp.assert_site_document_error(
'contentWidth absent',
jsonb_set(v_default, '{global}', (v_default->'global') - 'contentWidth'),
'ECOMMERCE_SITE_DOCUMENT_INVALID'
);
perform pg_temp.assert_site_document_error(
'density absent',
jsonb_set(v_default, '{global}', (v_default->'global') - 'density'),
'ECOMMERCE_SITE_DOCUMENT_INVALID'
);
perform pg_temp.assert_site_document_error('sections absent', v_default - 'sections', 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('sections null', jsonb_set(v_default, '{sections}', 'null'::jsonb), 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error('sections object', jsonb_set(v_default, '{sections}', '{}'::jsonb), 'ECOMMERCE_SITE_DOCUMENT_INVALID');
perform pg_temp.assert_site_document_error(
'more than 30 sections',
jsonb_set(v_default, '{sections}', (
select jsonb_agg(to_jsonb(n)) from generate_series(1, 31) as n
)),
'ECOMMERCE_SITE_DOCUMENT_INVALID'
);
perform pg_temp.assert_site_document_error(
'id absent',
jsonb_set(v_default, '{sections,0}', (v_default #> '{sections,0}') - 'id'),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'type absent',
jsonb_set(v_default, '{sections,0}', (v_default #> '{sections,0}') - 'type'),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'enabled absent',
jsonb_set(v_default, '{sections,0}', (v_default #> '{sections,0}') - 'enabled'),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'layout absent',
jsonb_set(v_default, '{sections,0}', (v_default #> '{sections,0}') - 'layout'),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'props absent',
jsonb_set(v_default, '{sections,0}', (v_default #> '{sections,0}') - 'props'),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'props null',
jsonb_set(v_default, '{sections,0,props}', 'null'::jsonb),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'style with content',
jsonb_set(v_default, '{sections,0,style}', '{"color":"red"}'::jsonb, true),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'unknown type',
jsonb_set(v_default, '{sections,0,type}', '"hero"'::jsonb),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'unknown layout',
jsonb_set(v_default, '{sections,1,layout}', '"masonry"'::jsonb),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'extra prop',
jsonb_set(v_default, '{sections,1,props,unsafe}', 'true'::jsonb, true),
'ECOMMERCE_SITE_SECTION_INVALID'
);
perform pg_temp.assert_site_document_error(
'duplicate id',
jsonb_set(v_default, '{sections,1,id}', '"header-main"'::jsonb),
'ECOMMERCE_SITE_DUPLICATE_SECTION'
);
perform pg_temp.assert_site_document_error(
'required section disabled',
jsonb_set(v_default, '{sections,0,enabled}', 'false'::jsonb),
'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'
);
v_large := v_default || jsonb_build_object('oversized', repeat('x', 70000));
perform pg_temp.assert_site_document_error('larger than 64 KiB', v_large, 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE');
insert into public.licenses(id, license_key, license_type, status, expires_at, features)
values
(
v_license,
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'pro',
'active',
clock_timestamp() + interval '1 day',
jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_layout_customization', 'advanced')
),
(
v_free_license,
'ECOM-PORTAL-BUILDER-1-FREE-ROLLBACK',
'free',
'active',
clock_timestamp() + interval '1 day',
jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_layout_customization', 'template_only')
),
(
v_limited_license,
'ECOM-PORTAL-BUILDER-1-LIMITED-ROLLBACK',
'pro',
'active',
clock_timestamp() + interval '1 day',
jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_layout_customization', 'template_only')
),
(
v_inactive_license,
'ECOM-PORTAL-BUILDER-1-INACTIVE-ROLLBACK',
'pro',
'active',
clock_timestamp() - interval '1 day',
jsonb_build_object('ecommerce_portal_enabled', true, 'ecommerce_layout_customization', 'advanced')
);
insert into public.license_devices(
id, license_id, device_fingerprint, security_token, is_active, device_role
) values
(v_admin_device, v_license, 'portal-builder-admin-device', 'portal-builder-admin-token', true, 'admin'),
(v_free_device, v_free_license, 'portal-builder-free-device', 'portal-builder-free-token', true, 'admin'),
(v_limited_device, v_limited_license, 'portal-builder-limited-device', 'portal-builder-limited-token', true, 'admin'),
(v_inactive_device, v_inactive_license, 'portal-builder-inactive-device', 'portal-builder-inactive-token', true, 'admin');
insert into public.license_staff_users(
id, license_id, username, display_name, password_hash, permissions
) values
(
v_staff_ok,
v_license,
'portal_builder_staff_ok',
'Portal builder staff',
extensions.crypt('fixture', extensions.gen_salt('bf')),
'{"settings":true,"ecommerce":true}'::jsonb
),
(
v_staff_bad,
v_license,
'portal_builder_staff_bad',
'Portal builder denied',
extensions.crypt('fixture', extensions.gen_salt('bf')),
'{"settings":false,"ecommerce":false}'::jsonb
);
insert into public.license_devices(
id, license_id, device_fingerprint, security_token, is_active, device_role, staff_user_id
) values
(
v_staff_ok_device,
v_license,
'portal-builder-staff-ok-device',
'portal-builder-staff-ok-token',
true,
'staff',
v_staff_ok
),
(
v_staff_bad_device,
v_license,
'portal-builder-staff-bad-device',
'portal-builder-staff-bad-token',
true,
'staff',
v_staff_bad
);
insert into public.license_staff_sessions(
license_id, staff_user_id, device_id, session_token_hash, expires_at
) values
(
v_license,
v_staff_ok,
v_staff_ok_device,
extensions.crypt('portal-builder-staff-ok-session', extensions.gen_salt('bf')),
clock_timestamp() + interval '1 hour'
),
(
v_license,
v_staff_bad,
v_staff_bad_device,
extensions.crypt('portal-builder-staff-bad-session', extensions.gen_salt('bf')),
clock_timestamp() + interval '1 hour'
);
insert into public.ecommerce_portals(
id, license_id, slug, status, name, template_code,
ordering_enabled, pickup_enabled, business_hours_enabled, timezone
) values
(
v_portal_a,
v_license,
'portal-builder-a-rollback',
'published',
'Builder A',
'classic',
true,
true,
false,
'America/Mexico_City'
),
(
v_portal_b,
v_free_license,
'portal-builder-b-rollback',
'published',
'Builder B',
'classic',
true,
true,
false,
'America/Mexico_City'
);
insert into public.ecommerce_site_documents(portal_id, draft_document, document_mode)
values (v_portal_b, v_default, 'default');
v_admin_valid := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
if coalesce((v_admin_valid->>'success')::boolean, false) is not true then
raise exception 'admin valid failed: %', v_admin_valid;
end if;
v_staff_valid := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-staff-ok-device',
'portal-builder-staff-ok-token',
'portal-builder-staff-ok-session'
);
if coalesce((v_staff_valid->>'success')::boolean, false) is not true then
raise exception 'staff with settings/ecommerce failed: %', v_staff_valid;
end if;
v_staff_denied := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-staff-bad-device',
'portal-builder-staff-bad-token',
'portal-builder-staff-bad-session'
);
if v_staff_denied->>'code' is distinct from 'ECOMMERCE_STAFF_PERMISSION_DENIED' then
raise exception 'staff without permissions returned unexpected result: %', v_staff_denied;
end if;
v_staff_invalid_session := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-staff-ok-device',
'portal-builder-staff-ok-token',
'invalid-session'
);
if v_staff_invalid_session->>'code' is distinct from 'ECOMMERCE_STAFF_SESSION_INVALID' then
raise exception 'invalid staff session returned unexpected result: %', v_staff_invalid_session;
end if;
v_invalid_device := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'invalid-device',
'portal-builder-admin-token',
null
);
if v_invalid_device->>'code' is distinct from 'ECOMMERCE_ADMIN_ACCESS_DENIED' then
raise exception 'invalid device returned unexpected result: %', v_invalid_device;
end if;
v_inactive_result := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-INACTIVE-ROLLBACK',
'portal-builder-inactive-device',
'portal-builder-inactive-token',
null
);
if v_inactive_result->>'code' is distinct from 'LICENSE_NOT_ACTIVE' then
raise exception 'inactive license returned unexpected result: %', v_inactive_result;
end if;
v_free_result := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-FREE-ROLLBACK',
'portal-builder-free-device',
'portal-builder-free-token',
null
);
if v_free_result->>'code' is distinct from 'ECOMMERCE_SITE_ACCESS_DENIED' then
raise exception 'Free plan returned unexpected result: %', v_free_result;
end if;
v_limited_result := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-LIMITED-ROLLBACK',
'portal-builder-limited-device',
'portal-builder-limited-token',
null
);
if v_limited_result->>'code' is distinct from 'ECOMMERCE_SITE_ACCESS_DENIED' then
raise exception 'PRO without advanced layout returned unexpected result: %', v_limited_result;
end if;
v_builder := v_admin_valid;
v_revision := (v_builder #>> '{draft,revision}')::bigint;
if v_builder #> '{draft,document}' is distinct from v_default
or v_builder #>> '{draft,documentMode}' is distinct from 'default' then
raise exception 'initial draft is not the exact classic default: %', v_builder;
end if;
v_save := public.ecommerce_admin_save_site_draft(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_revision,
v_default
);
if coalesce((v_save->>'success')::boolean, false) is not true
or (v_save #>> '{draft,revision}')::bigint <> v_revision + 1
or v_save #> '{draft,document}' is distinct from v_default
or v_save #>> '{draft,documentMode}' is distinct from 'default' then
raise exception 'valid save/revision failed: %', v_save;
end if;
select draft_revision, draft_document, document_mode, published_version_id
into v_revision_before, v_document_before, v_mode_before, v_published_before
from public.ecommerce_site_documents
where portal_id = v_portal_a;
v_save := public.ecommerce_admin_save_site_draft(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_revision,
v_default
);
if v_save->>'code' is distinct from 'ECOMMERCE_SITE_DRAFT_CONFLICT' then
raise exception 'stale revision returned unexpected result: %', v_save;
end if;
if exists (
select 1 from public.ecommerce_site_documents
where portal_id = v_portal_a
and (
draft_revision is distinct from v_revision_before
or draft_document is distinct from v_document_before
or document_mode is distinct from v_mode_before
or published_version_id is distinct from v_published_before
)
) then
raise exception 'stale revision changed draft or publication';
end if;
v_save := public.ecommerce_admin_save_site_draft(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_revision_before,
'{}'::jsonb
);
if v_save->>'code' is distinct from 'ECOMMERCE_SITE_DOCUMENT_INVALID' then
raise exception 'invalid document returned unexpected result: %', v_save;
end if;
v_save := public.ecommerce_admin_save_site_draft(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_revision_before,
v_large
);
if v_save->>'code' is distinct from 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE' then
raise exception 'oversized document returned unexpected result: %', v_save;
end if;
if exists (
select 1 from public.ecommerce_site_documents
where portal_id = v_portal_a
and (
draft_revision is distinct from v_revision_before
or draft_document is distinct from v_document_before
or document_mode is distinct from v_mode_before
or published_version_id is distinct from v_published_before
)
) then
raise exception 'invalid save changed draft or publication';
end if;
select count(*) into v_count_before
from public.ecommerce_site_versions
where portal_id = v_portal_a;
v_publish := public.ecommerce_admin_publish_site(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
if coalesce((v_publish->>'success')::boolean, false) is not true
or coalesce((v_publish->>'idempotent')::boolean, true) is true then
raise exception 'v1 default publication failed: %', v_publish;
end if;
v_version_default := (v_publish #>> '{published,versionId}')::uuid;
if (v_publish #>> '{published,versionNumber}')::bigint <> 1
or v_publish #> '{published,document}' is distinct from v_default
or v_publish #>> '{published,documentMode}' is distinct from 'default' then
raise exception 'v1 default payload mismatch: %', v_publish;
end if;
select count(*) into v_count_after
from public.ecommerce_site_versions
where portal_id = v_portal_a;
if v_count_after <> v_count_before + 1 then
raise exception 'authorized publication did not insert exactly one version';
end if;
if not exists (
select 1
from public.ecommerce_site_versions
where id = v_version_default
and portal_id = v_portal_a
and version_number = 1
and document = v_default
and document_mode = 'default'
and document_checksum = private.ecommerce_site_checksum(v_default)
) then
raise exception 'v1 stored document/checksum/mode mismatch';
end if;
if (select published_version_id from public.ecommerce_site_documents where portal_id = v_portal_a)
is distinct from v_version_default then
raise exception 'v1 published pointer mismatch';
end if;
v_publish_repeat := public.ecommerce_admin_publish_site(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
if coalesce((v_publish_repeat->>'idempotent')::boolean, false) is not true
or (v_publish_repeat #>> '{published,versionId}')::uuid is distinct from v_version_default
or v_publish_repeat #> '{published,document}' is distinct from v_default
or v_publish_repeat #>> '{published,documentMode}' is distinct from 'default' then
raise exception 'repeat publication is not exactly idempotent: %', v_publish_repeat;
end if;
v_custom := jsonb_set(v_default, '{sections,1,props,showSearch}', 'false'::jsonb);
v_builder := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
v_revision := (v_builder #>> '{draft,revision}')::bigint;
v_save := public.ecommerce_admin_save_site_draft(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_revision,
v_custom
);
if v_save #> '{draft,document}' is distinct from v_custom
or v_save #>> '{draft,documentMode}' is distinct from 'custom' then
raise exception 'custom draft mismatch: %', v_save;
end if;
v_publish := public.ecommerce_admin_publish_site(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
v_version_custom := (v_publish #>> '{published,versionId}')::uuid;
if (v_publish #>> '{published,versionNumber}')::bigint <> 2
or v_publish #> '{published,document}' is distinct from v_custom
or v_publish #>> '{published,documentMode}' is distinct from 'custom'
or v_version_custom is not distinct from v_version_default then
raise exception 'v2 custom publication mismatch: %', v_publish;
end if;
v_builder := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
v_revision_before := (v_builder #>> '{draft,revision}')::bigint;
v_published_before := (v_builder #>> '{published,versionId}')::uuid;
v_restore := public.ecommerce_admin_restore_site_version(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_version_default
);
if coalesce((v_restore->>'success')::boolean, false) is not true
or (v_restore #>> '{draft,revision}')::bigint <> v_revision_before + 1
or v_restore #> '{draft,document}' is distinct from v_default
or v_restore #>> '{draft,documentMode}' is distinct from 'default' then
raise exception 'restore default as draft mismatch: %', v_restore;
end if;
if (select published_version_id from public.ecommerce_site_documents where portal_id = v_portal_a)
is distinct from v_published_before then
raise exception 'restore changed published_version_id';
end if;
v_public := public.ecommerce_get_portal_by_slug('portal-builder-a-rollback');
if (v_public #>> '{site,versionId}')::uuid is distinct from v_version_custom
or (v_public #>> '{site,versionNumber}')::bigint <> 2
or v_public #> '{site,document}' is distinct from v_custom
or v_public #>> '{site,documentMode}' is distinct from 'custom' then
raise exception 'scenario A leaked restored draft into public site: %', v_public;
end if;
v_publish := public.ecommerce_admin_publish_site(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
v_version_default_2 := (v_publish #>> '{published,versionId}')::uuid;
if v_version_default_2 is not distinct from v_version_custom
or (v_publish #>> '{published,versionNumber}')::bigint <> 3
or v_publish #> '{published,document}' is distinct from v_default
or v_publish #>> '{published,documentMode}' is distinct from 'default' then
raise exception 'scenario B publication mismatch: %', v_publish;
end if;
v_public := public.ecommerce_get_portal_by_slug('portal-builder-a-rollback');
if (v_public #>> '{site,versionId}')::uuid is distinct from v_version_default_2
or (v_public #>> '{site,versionNumber}')::bigint <> 3
or v_public #> '{site,document}' is distinct from v_default
or v_public #>> '{site,documentMode}' is distinct from 'default' then
raise exception 'scenario B public response mismatch: %', v_public;
end if;
v_builder := public.ecommerce_admin_get_site_builder(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
v_revision := (v_builder #>> '{draft,revision}')::bigint;
v_save := public.ecommerce_admin_save_site_draft(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
v_revision,
v_custom
);
if v_save #>> '{draft,documentMode}' is distinct from 'custom' then
raise exception 'scenario C custom draft mode mismatch: %', v_save;
end if;
v_public := public.ecommerce_get_portal_by_slug('portal-builder-a-rollback');
if (v_public #>> '{site,versionId}')::uuid is distinct from v_version_default_2
or v_public #> '{site,document}' is distinct from v_default
or v_public #>> '{site,documentMode}' is distinct from 'default' then
raise exception 'scenario C draft changed public site: %', v_public;
end if;
update public.ecommerce_portals
set template_code = 'compact'
where id = v_portal_a;
v_public := public.ecommerce_get_portal_by_slug('portal-builder-a-rollback');
if (v_public #>> '{site,versionId}')::uuid is distinct from v_version_default_2
or (v_public #>> '{site,versionNumber}')::bigint <> 3
or v_public #> '{site,document}' is distinct from v_default
or v_public #> '{site,document}' = v_compact_default
or v_public #>> '{site,documentMode}' is distinct from 'default' then
raise exception 'scenario D template change rewrote published version: %', v_public;
end if;
v_public := public.ecommerce_get_portal_by_slug('portal-builder-b-rollback');
if coalesce((v_public->>'success')::boolean, false) is not true
or v_public #> '{site,versionId}' is distinct from 'null'::jsonb
or v_public #> '{site,versionNumber}' is distinct from 'null'::jsonb
or v_public #>> '{site,documentMode}' is distinct from 'default'
or v_public #> '{site,document}' is distinct from v_default
or private.ecommerce_site_document_error(v_public #> '{site,document}') is not null then
raise exception 'scenario E fallback mismatch: %', v_public;
end if;
if v_public::text ~* '(device_id|staff_user_id|security_token|draft_revision)' then
raise exception 'public response leaked private builder fields';
end if;
perform set_config('app.ecommerce_site_version_insert', 'authorized', true);
insert into public.ecommerce_site_versions(
id, portal_id, version_number, schema_version, document,
document_checksum, document_mode, source
) values (
v_version_b,
v_portal_b,
1,
1,
'{}'::jsonb,
private.ecommerce_site_checksum('{}'::jsonb),
'custom',
'publish'
);
perform set_config('app.ecommerce_site_version_insert', '', true);
update public.ecommerce_site_documents
set published_version_id = v_version_b
where portal_id = v_portal_b;
v_public := public.ecommerce_get_portal_by_slug('portal-builder-b-rollback');
if v_public #> '{site,versionId}' is distinct from 'null'::jsonb
or v_public #> '{site,versionNumber}' is distinct from 'null'::jsonb
or v_public #>> '{site,documentMode}' is distinct from 'default'
or v_public #> '{site,document}' is distinct from v_default then
raise exception 'invalid published version exposed mismatched identity/content: %', v_public;
end if;
v_history := public.ecommerce_admin_list_site_versions(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null
);
if (v_history->>'limit')::integer <> 20
or (v_history->>'offset')::integer <> 0
or jsonb_array_length(v_history->'versions') <> 3
or coalesce((v_history->>'hasMore')::boolean, true) is true then
raise exception 'default history pagination mismatch: %', v_history;
end if;
if exists (
select 1
from jsonb_array_elements(v_history->'versions') as item
where item ? 'document'
or item->>'id' = v_version_b::text
) then
raise exception 'history leaked document or another portal version: %', v_history;
end if;
if (v_history #>> '{versions,0,versionNumber}')::bigint <> 3
or (v_history #>> '{versions,1,versionNumber}')::bigint <> 2
or (v_history #>> '{versions,2,versionNumber}')::bigint <> 1 then
raise exception 'history is not descending: %', v_history;
end if;
v_history := public.ecommerce_admin_list_site_versions(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
500,
-10
);
if (v_history->>'limit')::integer <> 50
or (v_history->>'offset')::integer <> 0 then
raise exception 'history limit/negative offset normalization mismatch: %', v_history;
end if;
v_history := public.ecommerce_admin_list_site_versions(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
2,
0
);
if coalesce((v_history->>'hasMore')::boolean, false) is not true
or jsonb_array_length(v_history->'versions') <> 2 then
raise exception 'history hasMore page 1 mismatch: %', v_history;
end if;
v_history := public.ecommerce_admin_list_site_versions(
'ECOM-PORTAL-BUILDER-1-PRO-ROLLBACK',
'portal-builder-admin-device',
'portal-builder-admin-token',
null,
2,
2
);
if coalesce((v_history->>'hasMore')::boolean, true) is true
or jsonb_array_length(v_history->'versions') <> 1 then
raise exception 'history hasMore page 2 mismatch: %', v_history;
end if;
begin
update public.ecommerce_site_documents
set published_version_id = v_version_custom
where portal_id = v_portal_b;
raise exception 'TEST_CROSS_PORTAL_POINTER_ACCEPTED';
exception
when foreign_key_violation then null;
when others then
if sqlerrm = 'TEST_CROSS_PORTAL_POINTER_ACCEPTED' then raise; end if;
raise exception 'cross-portal pointer failed with unexpected error: %', sqlerrm;
end;
begin
update public.ecommerce_site_versions
set document_mode = 'custom'
where id = v_version_default;
raise exception 'TEST_VERSION_UPDATE_ACCEPTED';
exception
when others then
if sqlerrm = 'TEST_VERSION_UPDATE_ACCEPTED' then raise; end if;
if position('ECOMMERCE_SITE_VERSION_IMMUTABLE' in sqlerrm) = 0 then
raise exception 'version UPDATE failed with unexpected error: %', sqlerrm;
end if;
end;
begin
delete from public.ecommerce_site_versions
where id = v_version_default;
raise exception 'TEST_VERSION_DELETE_ACCEPTED';
exception
when others then
if sqlerrm = 'TEST_VERSION_DELETE_ACCEPTED' then raise; end if;
if position('ECOMMERCE_SITE_VERSION_IMMUTABLE' in sqlerrm) = 0 then
raise exception 'version DELETE failed with unexpected error: %', sqlerrm;
end if;
end;
perform set_config('app.ecommerce_site_version_insert', '', true);
begin
insert into public.ecommerce_site_versions(
portal_id, version_number, schema_version, document,
document_checksum, document_mode, source
) values (
v_portal_a,
999,
1,
v_default,
private.ecommerce_site_checksum(v_default),
'default',
'publish'
);
raise exception 'TEST_DIRECT_INSERT_ACCEPTED';
exception
when others then
if sqlerrm = 'TEST_DIRECT_INSERT_ACCEPTED' then raise; end if;
if position('ECOMMERCE_SITE_VERSION_INSERT_NOT_AUTHORIZED' in sqlerrm) = 0 then
raise exception 'direct INSERT failed with unexpected error: %', sqlerrm;
end if;
end;
begin
set local role service_role;
truncate public.ecommerce_site_versions;
raise exception 'TEST_RUNTIME_TRUNCATE_ACCEPTED';
exception
when others then
v_error := sqlerrm;
set local role postgres;
if v_error = 'TEST_RUNTIME_TRUNCATE_ACCEPTED' then
raise exception '%', v_error;
end if;
end;
select array_agg(privilege_type order by privilege_type)
into v_privileges
from information_schema.role_table_grants
where table_schema = 'public'
and table_name = 'ecommerce_site_documents'
and grantee = 'service_role';
if v_privileges is distinct from array['INSERT', 'SELECT', 'UPDATE']::text[] then
raise exception 'unexpected service_role document grants: %', v_privileges;
end if;
select array_agg(privilege_type order by privilege_type)
into v_privileges
from information_schema.role_table_grants
where table_schema = 'public'
and table_name = 'ecommerce_site_versions'
and grantee = 'service_role';
if v_privileges is distinct from array['INSERT', 'SELECT']::text[] then
raise exception 'unexpected service_role version grants: %', v_privileges;
end if;
if exists (
select 1
from information_schema.role_table_grants
where table_schema = 'public'
and table_name in ('ecommerce_site_documents', 'ecommerce_site_versions')
and grantee in ('anon', 'authenticated')
) then
raise exception 'anon/authenticated retain direct table grants';
end if;
end;
$test$;
rollback;
