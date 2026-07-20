alter table public.ecommerce_site_versions
add constraint ecommerce_site_versions_portal_id_id_key unique (portal_id, id);
alter table public.ecommerce_site_documents
drop constraint ecommerce_site_documents_published_version_id_fkey,
add constraint ecommerce_site_documents_portal_published_version_fkey
foreign key (portal_id, published_version_id)
references public.ecommerce_site_versions(portal_id, id)
on delete restrict;
alter table public.ecommerce_site_documents
add column document_mode text;
update public.ecommerce_site_documents d
set document_mode = case
when d.draft_document = private.ecommerce_site_default_document(p.template_code) then 'default'
else 'custom'
end
from public.ecommerce_portals p
where p.id = d.portal_id;
alter table public.ecommerce_site_documents
alter column document_mode set not null,
add constraint ecommerce_site_documents_document_mode_check
check (document_mode in ('default', 'custom'));
drop trigger if exists ecommerce_site_versions_immutable on public.ecommerce_site_versions;
alter table public.ecommerce_site_versions
add column document_mode text;
update public.ecommerce_site_versions v
set document_mode = case
when v.document = private.ecommerce_site_default_document(p.template_code) then 'default'
else 'custom'
end
from public.ecommerce_portals p
where p.id = v.portal_id;
alter table public.ecommerce_site_versions
alter column document_mode set not null,
add constraint ecommerce_site_versions_document_mode_check
check (document_mode in ('default', 'custom'));
create trigger ecommerce_site_versions_immutable
before update or delete on public.ecommerce_site_versions
for each row execute function private.ecommerce_site_prevent_version_mutation();
create or replace function private.ecommerce_site_document_error(p_document jsonb)
returns text
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
v_section jsonb;
v_ids text[] := '{}'::text[];
v_active jsonb := '{}'::jsonb;
v_type text;
v_props jsonb;
begin
if p_document is null
or jsonb_typeof(p_document) is distinct from 'object' then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if octet_length(p_document::text) > 65536 then
return 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE';
end if;
if not (p_document ? 'schemaVersion')
or not (p_document ? 'global')
or not (p_document ? 'sections') then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if exists (
select 1
from jsonb_object_keys(p_document) as root_key
where root_key not in ('schemaVersion', 'global', 'sections')
) then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if p_document->>'schemaVersion' is distinct from '1' then
return 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED';
end if;
if jsonb_typeof(p_document->'global') is distinct from 'object' then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if not (p_document->'global' ? 'themeSource')
or not (p_document->'global' ? 'contentWidth')
or not (p_document->'global' ? 'density') then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if exists (
select 1
from jsonb_object_keys(p_document->'global') as global_key
where global_key not in ('themeSource', 'contentWidth', 'density')
) then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if jsonb_typeof(p_document #> '{global,themeSource}') is distinct from 'string'
or jsonb_typeof(p_document #> '{global,contentWidth}') is distinct from 'string'
or jsonb_typeof(p_document #> '{global,density}') is distinct from 'string'
or p_document #>> '{global,themeSource}' is distinct from 'portal'
or p_document #>> '{global,contentWidth}' is distinct from 'standard'
or p_document #>> '{global,density}' not in ('comfortable', 'compact') then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if jsonb_typeof(p_document->'sections') is distinct from 'array' then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
if jsonb_array_length(p_document->'sections') > 30 then
return 'ECOMMERCE_SITE_DOCUMENT_INVALID';
end if;
for v_section in
select value from jsonb_array_elements(p_document->'sections')
loop
if jsonb_typeof(v_section) is distinct from 'object' then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if not (v_section ? 'id')
or not (v_section ? 'type')
or not (v_section ? 'enabled')
or not (v_section ? 'layout')
or not (v_section ? 'props') then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if exists (
select 1
from jsonb_object_keys(v_section) as section_key
where section_key not in ('id', 'type', 'enabled', 'layout', 'props', 'style')
) then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if jsonb_typeof(v_section->'id') is distinct from 'string'
or jsonb_typeof(v_section->'type') is distinct from 'string'
or jsonb_typeof(v_section->'enabled') is distinct from 'boolean'
or jsonb_typeof(v_section->'layout') is distinct from 'string'
or jsonb_typeof(v_section->'props') is distinct from 'object' then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if (v_section->>'id') !~ '^[a-z][a-z0-9-]{2,63}$' then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if v_section ? 'style' then
if jsonb_typeof(v_section->'style') is distinct from 'object'
or v_section->'style' is distinct from '{}'::jsonb then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
end if;
v_type := v_section->>'type';
v_props := v_section->'props';
v_ids := array_append(v_ids, v_section->>'id');
if v_type not in ('header', 'catalog', 'footer') then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if v_type = 'header' then
if v_section->>'layout' not in ('default', 'showcase')
or v_props is distinct from jsonb_build_object('contentSource', 'portal') then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
elsif v_type = 'catalog' then
if v_section->>'layout' not in ('grid', 'compact') then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if not (v_props ? 'showSearch')
or not (v_props ? 'showCategories') then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if exists (
select 1
from jsonb_object_keys(v_props) as prop_key
where prop_key not in ('showSearch', 'showCategories')
) then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
if jsonb_typeof(v_props->'showSearch') is distinct from 'boolean'
or jsonb_typeof(v_props->'showCategories') is distinct from 'boolean' then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
else
if v_section->>'layout' is distinct from 'lanzo'
or v_props is distinct from jsonb_build_object('contentSource', 'lanzo') then
return 'ECOMMERCE_SITE_SECTION_INVALID';
end if;
end if;
if (v_section->>'enabled')::boolean then
v_active := jsonb_set(
v_active,
array[v_type],
to_jsonb(coalesce((v_active->>v_type)::integer, 0) + 1),
true
);
end if;
end loop;
if exists (
select 1
from unnest(v_ids) as section_id
group by section_id
having count(*) > 1
) then
return 'ECOMMERCE_SITE_DUPLICATE_SECTION';
end if;
if coalesce((v_active->>'header')::integer, 0) <> 1
or coalesce((v_active->>'catalog')::integer, 0) <> 1
or coalesce((v_active->>'footer')::integer, 0) <> 1 then
return 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING';
end if;
return null;
end;
$$;
revoke all on function private.ecommerce_site_document_error(jsonb) from public, anon, authenticated;
revoke all privileges on table public.ecommerce_site_documents from service_role;
revoke all privileges on table public.ecommerce_site_versions from service_role;
grant select, insert, update on table public.ecommerce_site_documents to service_role;
grant select, insert on table public.ecommerce_site_versions to service_role;
revoke all privileges on table public.ecommerce_site_documents, public.ecommerce_site_versions from anon, authenticated;
create or replace function private.ecommerce_site_prevent_version_truncate()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
raise exception 'ECOMMERCE_SITE_VERSION_IMMUTABLE';
return null;
end;
$$;
drop trigger if exists ecommerce_site_versions_prevent_truncate on public.ecommerce_site_versions;
create trigger ecommerce_site_versions_prevent_truncate
before truncate on public.ecommerce_site_versions
for each statement execute function private.ecommerce_site_prevent_version_truncate();
revoke all on function private.ecommerce_site_prevent_version_truncate() from public, anon, authenticated;
create or replace function private.ecommerce_site_prevent_unmanaged_version_insert()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
if current_setting('app.ecommerce_site_version_insert', true) is distinct from 'authorized' then
raise exception 'ECOMMERCE_SITE_VERSION_INSERT_NOT_AUTHORIZED';
end if;
return new;
end;
$$;
drop trigger if exists ecommerce_site_versions_authorized_insert on public.ecommerce_site_versions;
create trigger ecommerce_site_versions_authorized_insert
before insert on public.ecommerce_site_versions
for each row execute function private.ecommerce_site_prevent_unmanaged_version_insert();
revoke all on function private.ecommerce_site_prevent_unmanaged_version_insert() from public, anon, authenticated;
create or replace function private.ecommerce_site_document_for_auth(
p_auth jsonb,
p_lock boolean default false
)
returns public.ecommerce_site_documents
language plpgsql
security definer
set search_path to ''
as $$
declare
v_portal public.ecommerce_portals%rowtype;
v_document public.ecommerce_site_documents%rowtype;
v_default jsonb;
begin
select * into v_portal
from public.ecommerce_portals
where license_id = (p_auth->>'license_id')::uuid
and deleted_at is null
limit 1;
if v_portal.id is null then
return null;
end if;
v_default := private.ecommerce_site_default_document(v_portal.template_code);
insert into public.ecommerce_site_documents(
portal_id,
draft_document,
document_mode,
updated_by_device_id,
updated_by_staff_user_id
) values (
v_portal.id,
v_default,
'default',
(p_auth->>'device_id')::uuid,
nullif(p_auth->>'staff_user_id', '')::uuid
)
on conflict (portal_id) do nothing;
if p_lock then
select * into v_document
from public.ecommerce_site_documents
where portal_id = v_portal.id
for update;
else
select * into v_document
from public.ecommerce_site_documents
where portal_id = v_portal.id;
end if;
if v_document.document_mode = 'default'
and v_document.draft_document is distinct from v_default then
update public.ecommerce_site_documents
set draft_document = v_default,
draft_revision = draft_revision + 1,
updated_at = now()
where portal_id = v_portal.id
returning * into v_document;
end if;
return v_document;
end;
$$;
create or replace function public.ecommerce_admin_save_site_draft(
p_license_key text,
p_device_fingerprint text,
p_security_token text,
p_staff_session_token text,
p_expected_revision bigint,
p_document jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
v_auth jsonb;
v_doc public.ecommerce_site_documents%rowtype;
v_error text;
v_template text;
begin
v_auth := private.ecommerce_site_authorize(
p_license_key,
p_device_fingerprint,
p_security_token,
p_staff_session_token,
'ecommerce_admin_save_site_draft'
);
if coalesce((v_auth->>'success')::boolean, false) is not true then
return v_auth;
end if;
v_error := private.ecommerce_site_document_error(p_document);
if v_error is not null then
return private.ecommerce_admin_error(v_error);
end if;
v_doc := private.ecommerce_site_document_for_auth(v_auth, true);
if p_expected_revision is null
or v_doc.draft_revision is distinct from p_expected_revision then
return private.ecommerce_admin_error('ECOMMERCE_SITE_DRAFT_CONFLICT');
end if;
select template_code into v_template
from public.ecommerce_portals
where id = v_doc.portal_id;
update public.ecommerce_site_documents
set draft_document = p_document,
document_mode = case
when p_document = private.ecommerce_site_default_document(v_template) then 'default'
else 'custom'
end,
draft_revision = draft_revision + 1,
updated_at = now(),
updated_by_device_id = (v_auth->>'device_id')::uuid,
updated_by_staff_user_id = nullif(v_auth->>'staff_user_id', '')::uuid
where portal_id = v_doc.portal_id
returning * into v_doc;
return jsonb_build_object(
'success', true,
'draft', jsonb_build_object(
'document', v_doc.draft_document,
'revision', v_doc.draft_revision,
'updatedAt', v_doc.updated_at,
'documentMode', v_doc.document_mode
)
);
exception
when others then
return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED');
end;
$$;
create or replace function public.ecommerce_admin_get_site_builder(
p_license_key text,
p_device_fingerprint text,
p_security_token text,
p_staff_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
v_auth jsonb;
v_doc public.ecommerce_site_documents%rowtype;
v_version public.ecommerce_site_versions%rowtype;
begin
v_auth := private.ecommerce_site_authorize(
p_license_key,
p_device_fingerprint,
p_security_token,
p_staff_session_token,
'ecommerce_admin_get_site_builder'
);
if coalesce((v_auth->>'success')::boolean, false) is not true then
return v_auth;
end if;
v_doc := private.ecommerce_site_document_for_auth(v_auth);
if v_doc.portal_id is null then
return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED');
end if;
select * into v_version
from public.ecommerce_site_versions
where id = v_doc.published_version_id
and portal_id = v_doc.portal_id;
return jsonb_build_object(
'success', true,
'draft', jsonb_build_object(
'document', v_doc.draft_document,
'revision', v_doc.draft_revision,
'updatedAt', v_doc.updated_at,
'documentMode', v_doc.document_mode
),
'published', case
when v_version.id is null then null
else jsonb_build_object(
'versionId', v_version.id,
'versionNumber', v_version.version_number,
'document', v_version.document,
'documentMode', v_version.document_mode,
'publishedAt', v_version.created_at
)
end,
'hasUnpublishedChanges',
v_version.id is null
or private.ecommerce_site_checksum(v_doc.draft_document) is distinct from v_version.document_checksum
or v_doc.document_mode is distinct from v_version.document_mode
);
exception
when others then
return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED');
end;
$$;
create or replace function public.ecommerce_admin_publish_site(
p_license_key text,
p_device_fingerprint text,
p_security_token text,
p_staff_session_token text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
v_auth jsonb;
v_doc public.ecommerce_site_documents%rowtype;
v_existing public.ecommerce_site_versions%rowtype;
v_version public.ecommerce_site_versions%rowtype;
v_error text;
v_checksum text;
begin
v_auth := private.ecommerce_site_authorize(
p_license_key,
p_device_fingerprint,
p_security_token,
p_staff_session_token,
'ecommerce_admin_publish_site'
);
if coalesce((v_auth->>'success')::boolean, false) is not true then
return v_auth;
end if;
v_doc := private.ecommerce_site_document_for_auth(v_auth, true);
v_error := private.ecommerce_site_document_error(v_doc.draft_document);
if v_error is not null then
return private.ecommerce_admin_error(v_error);
end if;
v_checksum := private.ecommerce_site_checksum(v_doc.draft_document);
select * into v_existing
from public.ecommerce_site_versions
where id = v_doc.published_version_id
and portal_id = v_doc.portal_id;
if v_existing.id is not null
and v_existing.document_checksum = v_checksum
and v_existing.document_mode = v_doc.document_mode then
return jsonb_build_object(
'success', true,
'idempotent', true,
'published', jsonb_build_object(
'versionId', v_existing.id,
'versionNumber', v_existing.version_number,
'document', v_existing.document,
'documentMode', v_existing.document_mode,
'publishedAt', v_existing.created_at
)
);
end if;
perform set_config('app.ecommerce_site_version_insert', 'authorized', true);
insert into public.ecommerce_site_versions(
portal_id,
version_number,
schema_version,
document,
document_checksum,
document_mode,
source,
created_by_device_id,
created_by_staff_user_id
) values (
v_doc.portal_id,
coalesce((
select max(version_number) + 1
from public.ecommerce_site_versions
where portal_id = v_doc.portal_id
), 1),
1,
v_doc.draft_document,
v_checksum,
v_doc.document_mode,
'publish',
(v_auth->>'device_id')::uuid,
nullif(v_auth->>'staff_user_id', '')::uuid
)
returning * into v_version;
perform set_config('app.ecommerce_site_version_insert', '', true);
update public.ecommerce_site_documents
set published_version_id = v_version.id,
updated_at = now()
where portal_id = v_doc.portal_id;
return jsonb_build_object(
'success', true,
'idempotent', false,
'published', jsonb_build_object(
'versionId', v_version.id,
'versionNumber', v_version.version_number,
'document', v_version.document,
'documentMode', v_version.document_mode,
'publishedAt', v_version.created_at
)
);
exception
when others then
return private.ecommerce_admin_error('ECOMMERCE_SITE_PUBLISH_FAILED');
end;
$$;
revoke all on function public.ecommerce_admin_list_site_versions(text, text, text, text) from public, anon, authenticated;
drop function public.ecommerce_admin_list_site_versions(text, text, text, text);
create function public.ecommerce_admin_list_site_versions(
p_license_key text,
p_device_fingerprint text,
p_security_token text,
p_staff_session_token text,
p_limit integer default 20,
p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
v_auth jsonb;
v_doc public.ecommerce_site_documents%rowtype;
v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 50);
v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
v_auth := private.ecommerce_site_authorize(
p_license_key,
p_device_fingerprint,
p_security_token,
p_staff_session_token,
'ecommerce_admin_list_site_versions'
);
if coalesce((v_auth->>'success')::boolean, false) is not true then
return v_auth;
end if;
v_doc := private.ecommerce_site_document_for_auth(v_auth);
return jsonb_build_object(
'success', true,
'limit', v_limit,
'offset', v_offset,
'hasMore', exists (
select 1
from public.ecommerce_site_versions
where portal_id = v_doc.portal_id
order by version_number desc
offset (v_offset + v_limit)
limit 1
),
'versions', coalesce((
select jsonb_agg(
jsonb_build_object(
'id', id,
'versionNumber', version_number,
'schemaVersion', schema_version,
'documentChecksum', document_checksum,
'documentMode', document_mode,
'source', source,
'createdAt', created_at,
'restoredFromVersionId', restored_from_version_id
)
order by version_number desc
)
from (
select *
from public.ecommerce_site_versions
where portal_id = v_doc.portal_id
order by version_number desc
limit v_limit
offset v_offset
) as versions_page
), '[]'::jsonb)
);
exception
when others then
return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED');
end;
$$;
create or replace function public.ecommerce_admin_restore_site_version(
p_license_key text,
p_device_fingerprint text,
p_security_token text,
p_staff_session_token text,
p_version_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
v_auth jsonb;
v_doc public.ecommerce_site_documents%rowtype;
v_version public.ecommerce_site_versions%rowtype;
begin
v_auth := private.ecommerce_site_authorize(
p_license_key,
p_device_fingerprint,
p_security_token,
p_staff_session_token,
'ecommerce_admin_restore_site_version'
);
if coalesce((v_auth->>'success')::boolean, false) is not true then
return v_auth;
end if;
v_doc := private.ecommerce_site_document_for_auth(v_auth, true);
select * into v_version
from public.ecommerce_site_versions
where id = p_version_id
and portal_id = v_doc.portal_id;
if v_version.id is null then
return private.ecommerce_admin_error('ECOMMERCE_SITE_VERSION_NOT_FOUND');
end if;
update public.ecommerce_site_documents
set draft_document = v_version.document,
document_mode = v_version.document_mode,
draft_revision = draft_revision + 1,
updated_at = now(),
updated_by_device_id = (v_auth->>'device_id')::uuid,
updated_by_staff_user_id = nullif(v_auth->>'staff_user_id', '')::uuid
where portal_id = v_doc.portal_id
returning * into v_doc;
return jsonb_build_object(
'success', true,
'draft', jsonb_build_object(
'document', v_doc.draft_document,
'revision', v_doc.draft_revision,
'updatedAt', v_doc.updated_at,
'documentMode', v_doc.document_mode
)
);
exception
when others then
return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED');
end;
$$;
create or replace function public.ecommerce_get_portal_by_slug(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
v_portal public.ecommerce_portals%rowtype;
v_version public.ecommerce_site_versions%rowtype;
v_document jsonb;
v_error text;
v_site_version_id uuid := null;
v_site_version_number bigint := null;
v_document_mode text := 'default';
begin
v_portal := private.ecommerce_get_public_portal_by_slug(p_slug);
if v_portal.id is null then
return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end if;
select v.* into v_version
from public.ecommerce_site_documents d
join public.ecommerce_site_versions v
on v.id = d.published_version_id
and v.portal_id = d.portal_id
where d.portal_id = v_portal.id;
if v_version.id is not null then
v_error := private.ecommerce_site_document_error(v_version.document);
if v_error is null then
v_site_version_id := v_version.id;
v_site_version_number := v_version.version_number;
v_document_mode := v_version.document_mode;
v_document := v_version.document;
else
raise log 'ecommerce published site fallback: portal=%, code=%', v_portal.id, v_error;
end if;
end if;
if v_document is null then
v_site_version_id := null;
v_site_version_number := null;
v_document_mode := 'default';
v_document := private.ecommerce_site_default_document(v_portal.template_code);
end if;
return jsonb_build_object(
'success', true,
'portal', private.ecommerce_portal_public_jsonb(v_portal),
'hours', private.ecommerce_portal_hours_jsonb(v_portal.id),
'availability', private.ecommerce_public_availability_jsonb(v_portal, clock_timestamp()),
'features', jsonb_build_object(
'whatsappCheckout', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_whatsapp_checkout', false),
'orderInbox', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false),
'customSlug', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_custom_slug', false),
'brandingCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_branding_customization'), 'basic'),
'layoutCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_layout_customization'), 'template_only'),
'businessHours', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_business_hours', true),
'deliveryPickupSettings', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_delivery_pickup_settings'), 'basic'),
'stockVisibility', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false),
'realtimeOrders', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_realtime_orders', false)
),
'catalogRevision', v_portal.catalog_revision,
'site', jsonb_build_object(
'schemaVersion', 1,
'versionId', v_site_version_id,
'versionNumber', v_site_version_number,
'documentMode', v_document_mode,
'document', v_document
),
'cachePolicy', jsonb_build_object(
'schemaVersion', 1,
'freshSeconds', 300,
'maxStaleSeconds', 86400
)
);
exception
when others then
return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND');
end;
$$;
revoke all on function public.ecommerce_admin_list_site_versions(text, text, text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_list_site_versions(text, text, text, text, integer, integer) to anon, authenticated, service_role;
