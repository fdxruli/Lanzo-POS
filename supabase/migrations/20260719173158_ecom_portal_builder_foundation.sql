-- FASE ECOM.PORTAL.BUILDER.1: immutable public site documents.
create table public.ecommerce_site_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  portal_id uuid not null references public.ecommerce_portals(id) on delete restrict,
  version_number bigint not null check (version_number > 0),
  schema_version integer not null check (schema_version = 1),
  document jsonb not null,
  document_checksum text not null check (document_checksum ~ '^[a-f0-9]{64}$'),
  source text not null check (source in ('publish', 'restore')),
  created_at timestamptz not null default now(),
  created_by_device_id uuid null references public.license_devices(id) on delete set null,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  restored_from_version_id uuid null references public.ecommerce_site_versions(id) on delete restrict,
  unique (portal_id, version_number)
);
create index ecommerce_site_versions_portal_version_idx on public.ecommerce_site_versions(portal_id, version_number desc);

create table public.ecommerce_site_documents (
  portal_id uuid primary key references public.ecommerce_portals(id) on delete restrict,
  draft_document jsonb not null,
  draft_revision bigint not null default 1 check (draft_revision > 0),
  published_version_id uuid null references public.ecommerce_site_versions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by_device_id uuid null references public.license_devices(id) on delete set null,
  updated_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null
);
create index ecommerce_site_documents_published_version_idx on public.ecommerce_site_documents(published_version_id) where published_version_id is not null;
alter table public.ecommerce_site_versions enable row level security;
alter table public.ecommerce_site_documents enable row level security;
revoke all on table public.ecommerce_site_versions, public.ecommerce_site_documents from public, anon, authenticated;
grant select, insert, update on table public.ecommerce_site_versions, public.ecommerce_site_documents to service_role;

create or replace function private.ecommerce_site_default_document(p_template text)
returns jsonb language sql stable security definer set search_path to '' as $$
  select jsonb_build_object('schemaVersion',1,'global',jsonb_build_object('themeSource','portal','contentWidth','standard','density',case when p_template='compact' then 'compact' else 'comfortable' end),'sections',jsonb_build_array(
    jsonb_build_object('id','header-main','type','header','enabled',true,'layout',case when p_template='showcase' then 'showcase' else 'default' end,'props',jsonb_build_object('contentSource','portal')),
    jsonb_build_object('id','catalog-main','type','catalog','enabled',true,'layout',case when p_template='compact' then 'compact' else 'grid' end,'props',jsonb_build_object('showSearch',true,'showCategories',true)),
    jsonb_build_object('id','footer-main','type','footer','enabled',true,'layout','lanzo','props',jsonb_build_object('contentSource','lanzo'))
  ));
$$;

create or replace function private.ecommerce_site_document_error(p_document jsonb)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_section jsonb; v_ids text[]; v_active jsonb := '{}'::jsonb; v_type text; v_props jsonb;
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object' or p_document - array['schemaVersion','global','sections'] <> '{}'::jsonb then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if p_document->>'schemaVersion' <> '1' then return 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'; end if;
  if jsonb_typeof(p_document->'global') <> 'object' or p_document->'global' - array['themeSource','contentWidth','density'] <> '{}'::jsonb or p_document#>>'{global,themeSource}' <> 'portal' or p_document#>>'{global,contentWidth}' <> 'standard' or p_document#>>'{global,density}' not in ('comfortable','compact') then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if jsonb_typeof(p_document->'sections') <> 'array' or jsonb_array_length(p_document->'sections') > 30 then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  for v_section in select value from jsonb_array_elements(p_document->'sections') loop
    if jsonb_typeof(v_section) <> 'object' or v_section - array['id','type','enabled','layout','props','style'] <> '{}'::jsonb or v_section->>'id' !~ '^[a-z][a-z0-9-]{2,63}$' or jsonb_typeof(v_section->'enabled') <> 'boolean' or jsonb_typeof(v_section->'props') <> 'object' or (v_section ? 'style' and (jsonb_typeof(v_section->'style') <> 'object' or v_section->'style' <> '{}'::jsonb)) then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    v_type := v_section->>'type'; v_props := v_section->'props'; v_ids := array_append(v_ids, v_section->>'id');
    if (v_type='header' and (v_section->>'layout' not in ('default','showcase') or v_props <> jsonb_build_object('contentSource','portal')))
      or (v_type='catalog' and (v_section->>'layout' not in ('grid','compact') or v_props - array['showSearch','showCategories'] <> '{}'::jsonb or jsonb_typeof(v_props->'showSearch') <> 'boolean' or jsonb_typeof(v_props->'showCategories') <> 'boolean'))
      or (v_type='footer' and (v_section->>'layout' <> 'lanzo' or v_props <> jsonb_build_object('contentSource','lanzo')))
      or v_type not in ('header','catalog','footer') then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    if (v_section->>'enabled')::boolean then v_active := jsonb_set(v_active, array[v_type], to_jsonb(coalesce((v_active->>v_type)::integer,0)+1), true); end if;
  end loop;
  if exists (select 1 from unnest(coalesce(v_ids,'{}')) id group by id having count(*) > 1) then return 'ECOMMERCE_SITE_DUPLICATE_SECTION'; end if;
  if coalesce((v_active->>'header')::integer,0) <> 1 or coalesce((v_active->>'catalog')::integer,0) <> 1 or coalesce((v_active->>'footer')::integer,0) <> 1 then return 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'; end if;
  if octet_length(p_document::text) > 65536 then return 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE'; end if;
  return null;
end;
$$;

create or replace function private.ecommerce_site_checksum(p_document jsonb)
returns text language sql stable security definer set search_path to '' as $$ select encode(extensions.digest(p_document::text, 'sha256'), 'hex'); $$;

create or replace function private.ecommerce_site_authorize(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_rpc text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb;
begin
  v_auth := private.ecommerce_admin_authorize_v2(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_rpc);
  if coalesce((v_auth->>'success')::boolean,false) is not true then return v_auth; end if;
  if coalesce(v_auth#>>'{features,ecommerce_layout_customization}','template_only') <> 'advanced' then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED','No tienes acceso al constructor del sitio.'); end if;
  return v_auth;
end;
$$;

create or replace function private.ecommerce_site_document_for_auth(p_auth jsonb, p_lock boolean default false)
returns public.ecommerce_site_documents language plpgsql security definer set search_path to '' as $$
declare v_portal public.ecommerce_portals%rowtype; v_document public.ecommerce_site_documents%rowtype;
begin
  select * into v_portal from public.ecommerce_portals where license_id=(p_auth->>'license_id')::uuid and deleted_at is null limit 1;
  if v_portal.id is null then return null; end if;
  insert into public.ecommerce_site_documents(portal_id,draft_document,updated_by_device_id,updated_by_staff_user_id)
  values(v_portal.id,private.ecommerce_site_default_document(v_portal.template_code),(p_auth->>'device_id')::uuid,nullif(p_auth->>'staff_user_id','')::uuid)
  on conflict (portal_id) do nothing;
  if p_lock then select * into v_document from public.ecommerce_site_documents where portal_id=v_portal.id for update; else select * into v_document from public.ecommerce_site_documents where portal_id=v_portal.id; end if;
  return v_document;
end;
$$;

create or replace function public.ecommerce_admin_get_site_builder(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype; v_version public.ecommerce_site_versions%rowtype;
begin
  v_auth:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_get_site_builder'); if coalesce((v_auth->>'success')::boolean,false) is not true then return v_auth; end if;
  v_doc:=private.ecommerce_site_document_for_auth(v_auth); if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  select * into v_version from public.ecommerce_site_versions where id=v_doc.published_version_id;
  return jsonb_build_object('success',true,'draft',jsonb_build_object('document',v_doc.draft_document,'revision',v_doc.draft_revision,'updatedAt',v_doc.updated_at),'published',case when v_version.id is null then null else jsonb_build_object('versionId',v_version.id,'versionNumber',v_version.version_number,'document',v_version.document,'publishedAt',v_version.created_at) end,'hasUnpublishedChanges',v_version.id is null or private.ecommerce_site_checksum(v_doc.draft_document) <> v_version.document_checksum);
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end;
$$;

create or replace function public.ecommerce_admin_save_site_draft(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_expected_revision bigint,p_document jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype; v_error text;
begin
  v_auth:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_save_site_draft'); if coalesce((v_auth->>'success')::boolean,false) is not true then return v_auth; end if;
  v_error:=private.ecommerce_site_document_error(p_document); if v_error is not null then return private.ecommerce_admin_error(v_error); end if;
  v_doc:=private.ecommerce_site_document_for_auth(v_auth,true); if p_expected_revision is null or v_doc.draft_revision <> p_expected_revision then return private.ecommerce_admin_error('ECOMMERCE_SITE_DRAFT_CONFLICT'); end if;
  update public.ecommerce_site_documents set draft_document=p_document,draft_revision=draft_revision+1,updated_at=now(),updated_by_device_id=(v_auth->>'device_id')::uuid,updated_by_staff_user_id=nullif(v_auth->>'staff_user_id','')::uuid where portal_id=v_doc.portal_id returning * into v_doc;
  return jsonb_build_object('success',true,'draft',jsonb_build_object('document',v_doc.draft_document,'revision',v_doc.draft_revision,'updatedAt',v_doc.updated_at));
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED'); end;
$$;

create or replace function public.ecommerce_admin_publish_site(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype; v_existing public.ecommerce_site_versions%rowtype; v_version public.ecommerce_site_versions%rowtype; v_error text; v_checksum text;
begin
  v_auth:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_publish_site'); if coalesce((v_auth->>'success')::boolean,false) is not true then return v_auth; end if;
  v_doc:=private.ecommerce_site_document_for_auth(v_auth,true); v_error:=private.ecommerce_site_document_error(v_doc.draft_document); if v_error is not null then return private.ecommerce_admin_error(v_error); end if;
  v_checksum:=private.ecommerce_site_checksum(v_doc.draft_document); select * into v_existing from public.ecommerce_site_versions where id=v_doc.published_version_id;
  if v_existing.id is not null and v_existing.document_checksum=v_checksum then return jsonb_build_object('success',true,'idempotent',true,'published',jsonb_build_object('versionId',v_existing.id,'versionNumber',v_existing.version_number,'document',v_existing.document,'publishedAt',v_existing.created_at)); end if;
  insert into public.ecommerce_site_versions(portal_id,version_number,schema_version,document,document_checksum,source,created_by_device_id,created_by_staff_user_id) values(v_doc.portal_id,coalesce((select max(version_number)+1 from public.ecommerce_site_versions where portal_id=v_doc.portal_id),1),1,v_doc.draft_document,v_checksum,'publish',(v_auth->>'device_id')::uuid,nullif(v_auth->>'staff_user_id','')::uuid) returning * into v_version;
  update public.ecommerce_site_documents set published_version_id=v_version.id,updated_at=now() where portal_id=v_doc.portal_id;
  return jsonb_build_object('success',true,'idempotent',false,'published',jsonb_build_object('versionId',v_version.id,'versionNumber',v_version.version_number,'document',v_version.document,'publishedAt',v_version.created_at));
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_PUBLISH_FAILED'); end;
$$;

create or replace function public.ecommerce_admin_list_site_versions(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype;
begin v_auth:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_list_site_versions'); if coalesce((v_auth->>'success')::boolean,false) is not true then return v_auth; end if; v_doc:=private.ecommerce_site_document_for_auth(v_auth); return jsonb_build_object('success',true,'versions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'versionNumber',version_number,'document',document,'createdAt',created_at,'source',source) order by version_number desc) from public.ecommerce_site_versions where portal_id=v_doc.portal_id),'[]'::jsonb)); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end;
$$;

create or replace function public.ecommerce_admin_restore_site_version(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_version_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype; v_version public.ecommerce_site_versions%rowtype;
begin v_auth:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_restore_site_version'); if coalesce((v_auth->>'success')::boolean,false) is not true then return v_auth; end if; v_doc:=private.ecommerce_site_document_for_auth(v_auth,true); select * into v_version from public.ecommerce_site_versions where id=p_version_id and portal_id=v_doc.portal_id; if v_version.id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_VERSION_NOT_FOUND'); end if; update public.ecommerce_site_documents set draft_document=v_version.document,draft_revision=draft_revision+1,updated_at=now(),updated_by_device_id=(v_auth->>'device_id')::uuid,updated_by_staff_user_id=nullif(v_auth->>'staff_user_id','')::uuid where portal_id=v_doc.portal_id returning * into v_doc; return jsonb_build_object('success',true,'draft',jsonb_build_object('document',v_doc.draft_document,'revision',v_doc.draft_revision,'updatedAt',v_doc.updated_at)); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED'); end;
$$;

create or replace function public.ecommerce_get_portal_by_slug(p_slug text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_portal public.ecommerce_portals%rowtype; v_version public.ecommerce_site_versions%rowtype; v_document jsonb; v_error text;
begin
  v_portal:=private.ecommerce_get_public_portal_by_slug(p_slug); if v_portal.id is null then return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;
  select v.* into v_version from public.ecommerce_site_documents d join public.ecommerce_site_versions v on v.id=d.published_version_id where d.portal_id=v_portal.id;
  v_document:=v_version.document; v_error:=private.ecommerce_site_document_error(v_document); if v_version.id is null or v_error is not null then if v_error is not null then raise log 'ecommerce site document fallback: %',v_error; end if; v_document:=private.ecommerce_site_default_document(v_portal.template_code); end if;
  return jsonb_build_object('success',true,'portal',private.ecommerce_portal_public_jsonb(v_portal),'hours',private.ecommerce_portal_hours_jsonb(v_portal.id),'availability',private.ecommerce_public_availability_jsonb(v_portal,clock_timestamp()),'features',jsonb_build_object('whatsappCheckout',private.ecommerce_license_feature_bool(v_portal.license_id,'ecommerce_whatsapp_checkout',false),'orderInbox',private.ecommerce_license_feature_bool(v_portal.license_id,'ecommerce_order_inbox',false),'customSlug',private.ecommerce_license_feature_bool(v_portal.license_id,'ecommerce_custom_slug',false),'brandingCustomization',coalesce(private.ecommerce_license_feature_text(v_portal.license_id,'ecommerce_branding_customization'),'basic'),'layoutCustomization',coalesce(private.ecommerce_license_feature_text(v_portal.license_id,'ecommerce_layout_customization'),'template_only'),'businessHours',private.ecommerce_license_feature_bool(v_portal.license_id,'ecommerce_business_hours',true),'deliveryPickupSettings',coalesce(private.ecommerce_license_feature_text(v_portal.license_id,'ecommerce_delivery_pickup_settings'),'basic'),'stockVisibility',private.ecommerce_license_feature_bool(v_portal.license_id,'ecommerce_stock_visibility',false),'realtimeOrders',private.ecommerce_license_feature_bool(v_portal.license_id,'ecommerce_realtime_orders',false)),'catalogRevision',v_portal.catalog_revision,'site',jsonb_build_object('schemaVersion',1,'versionId',v_version.id,'versionNumber',v_version.version_number,'document',v_document),'cachePolicy',jsonb_build_object('schemaVersion',1,'freshSeconds',300,'maxStaleSeconds',86400));
exception when others then return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND'); end;
$$;

revoke all on function private.ecommerce_site_default_document(text), private.ecommerce_site_document_error(jsonb), private.ecommerce_site_checksum(jsonb), private.ecommerce_site_authorize(text,text,text,text,text), private.ecommerce_site_document_for_auth(jsonb,boolean) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_get_site_builder(text,text,text,text), public.ecommerce_admin_save_site_draft(text,text,text,text,bigint,jsonb), public.ecommerce_admin_publish_site(text,text,text,text), public.ecommerce_admin_list_site_versions(text,text,text,text), public.ecommerce_admin_restore_site_version(text,text,text,text,uuid), public.ecommerce_get_portal_by_slug(text) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_get_site_builder(text,text,text,text), public.ecommerce_admin_save_site_draft(text,text,text,text,bigint,jsonb), public.ecommerce_admin_publish_site(text,text,text,text), public.ecommerce_admin_list_site_versions(text,text,text,text), public.ecommerce_admin_restore_site_version(text,text,text,text,uuid), public.ecommerce_get_portal_by_slug(text) to anon, authenticated, service_role;
