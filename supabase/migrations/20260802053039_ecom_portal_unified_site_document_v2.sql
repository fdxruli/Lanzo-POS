-- ECOM.PORTAL.BUILDER.3: v2 is the stored design document; v1 RPCs remain stable.
alter table public.ecommerce_site_versions drop constraint if exists ecommerce_site_versions_schema_version_check;
alter table public.ecommerce_site_versions add constraint ecommerce_site_versions_schema_version_check check (schema_version in (1, 2));
alter table public.ecommerce_site_versions drop constraint if exists ecommerce_site_versions_source_check;
alter table public.ecommerce_site_versions add constraint ecommerce_site_versions_source_check check (source in ('publish', 'restore', 'migration'));

create or replace function private.ecommerce_site_default_document_v2(
  p_template text, p_theme jsonb default null, p_logo_url text default null, p_cover_image_url text default null
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare
  v_template text := case when p_template in ('classic', 'showcase', 'compact') then p_template else 'classic' end;
  v_theme jsonb := coalesce(p_theme, '{}'::jsonb);
begin
  return jsonb_build_object(
    'schemaVersion', 2,
    'global', jsonb_build_object(
      'contentWidth', 'standard',
      'density', case when v_template = 'compact' then 'compact' else 'comfortable' end,
      'appearance', jsonb_build_object(
        'templateCode', v_template,
        'theme', jsonb_build_object(
          'primaryColor', case when v_theme->>'primaryColor' ~ '^#[0-9A-Fa-f]{6}$' then v_theme->>'primaryColor' else '#0284c7' end,
          'secondaryColor', case when v_theme->>'secondaryColor' ~ '^#[0-9A-Fa-f]{6}$' then v_theme->>'secondaryColor' else '#0369a1' end,
          'cornerStyle', case when v_theme->>'cornerStyle' in ('rounded', 'soft', 'square') then v_theme->>'cornerStyle' else 'rounded' end,
          'fontStyle', case when v_theme->>'fontStyle' in ('system', 'rounded', 'editorial') then v_theme->>'fontStyle' else 'system' end
        ),
        'branding', jsonb_build_object(
          'logoUrl', case when p_logo_url ~ '^https://[^[:cntrl:] ]+$' and char_length(p_logo_url) <= 2048 then p_logo_url else null end,
          'coverImageUrl', case when p_cover_image_url ~ '^https://[^[:cntrl:] ]+$' and char_length(p_cover_image_url) <= 2048 then p_cover_image_url else null end
        )
      )
    ),
    'sections', jsonb_build_array(
      jsonb_build_object('id', 'header-main', 'type', 'header', 'enabled', true, 'layout', case when v_template = 'showcase' then 'showcase' else 'default' end, 'props', jsonb_build_object('contentSource', 'portal')),
      jsonb_build_object('id', 'catalog-main', 'type', 'catalog', 'enabled', true, 'layout', case when v_template = 'compact' then 'compact' else 'grid' end, 'props', jsonb_build_object('showSearch', true, 'showCategories', true)),
      jsonb_build_object('id', 'footer-main', 'type', 'footer', 'enabled', true, 'layout', 'lanzo', 'props', jsonb_build_object('contentSource', 'lanzo'))
    )
  );
end;
$$;

-- Kept private so legacy clients can be validated before being converted to v2.
create or replace function private.ecommerce_site_document_error_v1(p_document jsonb)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_section jsonb; v_ids text[] := '{}'::text[]; v_active jsonb := '{}'::jsonb; v_type text; v_props jsonb;
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if octet_length(p_document::text) > 65536 then return 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE'; end if;
  if not (p_document ? 'schemaVersion') or not (p_document ? 'global') or not (p_document ? 'sections')
     or p_document - array['schemaVersion', 'global', 'sections'] <> '{}'::jsonb then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if p_document->>'schemaVersion' is distinct from '1' then return 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'; end if;
  if jsonb_typeof(p_document->'global') is distinct from 'object'
     or not (p_document->'global' ? 'themeSource') or not (p_document->'global' ? 'contentWidth') or not (p_document->'global' ? 'density')
     or (p_document -> 'global') - array['themeSource', 'contentWidth', 'density'] <> '{}'::jsonb
     or p_document  #>>'{global,themeSource}' is distinct from 'portal'
     or p_document  #>>'{global,contentWidth}' is distinct from 'standard'
     or p_document  #>>'{global,density}' not in ('comfortable', 'compact') then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if jsonb_typeof(p_document->'sections') is distinct from 'array' or jsonb_array_length(p_document->'sections') > 30 then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  for v_section in select value from jsonb_array_elements(p_document->'sections') loop
    if jsonb_typeof(v_section) is distinct from 'object'
       or v_section - array['id', 'type', 'enabled', 'layout', 'props', 'style'] <> '{}'::jsonb
       or not (v_section ? 'id') or not (v_section ? 'type') or not (v_section ? 'enabled') or not (v_section ? 'layout') or not (v_section ? 'props')
       or jsonb_typeof(v_section->'id') is distinct from 'string' or jsonb_typeof(v_section->'type') is distinct from 'string'
       or jsonb_typeof(v_section->'enabled') is distinct from 'boolean' or jsonb_typeof(v_section->'layout') is distinct from 'string'
       or jsonb_typeof(v_section->'props') is distinct from 'object' or v_section->>'id' !~ '^[a-z][a-z0-9-]{2,63}$'
       or (v_section ? 'style' and (jsonb_typeof(v_section->'style') is distinct from 'object' or v_section->'style' is distinct from '{}'::jsonb)) then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    v_type := v_section->>'type'; v_props := v_section->'props'; v_ids := array_append(v_ids, v_section->>'id');
    if (v_type = 'header' and (v_section->>'layout' not in ('default', 'showcase') or v_props is distinct from jsonb_build_object('contentSource', 'portal')))
       or (v_type = 'catalog' and (v_section->>'layout' not in ('grid', 'compact') or v_props - array['showSearch', 'showCategories'] <> '{}'::jsonb or not (v_props ? 'showSearch') or not (v_props ? 'showCategories') or jsonb_typeof(v_props->'showSearch') is distinct from 'boolean' or jsonb_typeof(v_props->'showCategories') is distinct from 'boolean'))
       or (v_type = 'footer' and (v_section->>'layout' is distinct from 'lanzo' or v_props is distinct from jsonb_build_object('contentSource', 'lanzo')))
       or v_type not in ('header', 'catalog', 'footer') then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    if (v_section->>'enabled')::boolean then v_active := jsonb_set(v_active, array[v_type], to_jsonb(coalesce((v_active->>v_type)::integer, 0) + 1), true); end if;
  end loop;
  if exists (select 1 from unnest(v_ids) as id group by id having count(*) > 1) then return 'ECOMMERCE_SITE_DUPLICATE_SECTION'; end if;
  if coalesce((v_active->>'header')::integer, 0) <> 1 or coalesce((v_active->>'catalog')::integer, 0) <> 1 or coalesce((v_active->>'footer')::integer, 0) <> 1 then return 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'; end if;
  return null;
end;
$$;

create or replace function private.ecommerce_site_document_error(p_document jsonb)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_section jsonb; v_ids text[] := '{}'::text[]; v_active jsonb := '{}'::jsonb; v_type text; v_props jsonb; v_theme jsonb; v_branding jsonb;
begin
  if p_document is null or jsonb_typeof(p_document) is distinct from 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if octet_length(p_document::text) > 65536 then return 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE'; end if;
  if not (p_document ? 'schemaVersion') or not (p_document ? 'global') or not (p_document ? 'sections')
     or p_document - array['schemaVersion', 'global', 'sections'] <> '{}'::jsonb then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if p_document->>'schemaVersion' is distinct from '2' then return 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'; end if;
  if jsonb_typeof(p_document->'global') is distinct from 'object'
     or not (p_document->'global' ? 'contentWidth') or not (p_document->'global' ? 'density') or not (p_document->'global' ? 'appearance')
     or (p_document -> 'global') - array['contentWidth', 'density', 'appearance'] <> '{}'::jsonb
     or p_document  #>>'{global,contentWidth}' is distinct from 'standard'
     or p_document  #>>'{global,density}' not in ('comfortable', 'compact')
     or jsonb_typeof(p_document #>'{global,appearance}') is distinct from 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if not (p_document #>'{global,appearance}' ? 'templateCode') or not (p_document #>'{global,appearance}' ? 'theme') or not (p_document #>'{global,appearance}' ? 'branding')
     or (p_document #> '{global,appearance}') - array['templateCode', 'theme', 'branding'] <> '{}'::jsonb
     or jsonb_typeof(p_document #>'{global,appearance,templateCode}') is distinct from 'string'
     or p_document  #>>'{global,appearance,templateCode}' not in ('classic', 'showcase', 'compact')
     or jsonb_typeof(p_document #>'{global,appearance,theme}') is distinct from 'object'
     or jsonb_typeof(p_document #>'{global,appearance,branding}') is distinct from 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  v_theme := p_document #>'{global,appearance,theme}'; v_branding := p_document #>'{global,appearance,branding}';
  if not (v_theme ? 'primaryColor') or not (v_theme ? 'secondaryColor') or not (v_theme ? 'cornerStyle') or not (v_theme ? 'fontStyle')
     or v_theme - array['primaryColor', 'secondaryColor', 'cornerStyle', 'fontStyle'] <> '{}'::jsonb
     or jsonb_typeof(v_theme->'primaryColor') is distinct from 'string' or jsonb_typeof(v_theme->'secondaryColor') is distinct from 'string'
     or jsonb_typeof(v_theme->'cornerStyle') is distinct from 'string' or jsonb_typeof(v_theme->'fontStyle') is distinct from 'string'
     or p_document  #>>'{global,appearance,theme,primaryColor}' !~ '^#[0-9A-Fa-f]{6}$'
     or p_document  #>>'{global,appearance,theme,secondaryColor}' !~ '^#[0-9A-Fa-f]{6}$'
     or p_document  #>>'{global,appearance,theme,cornerStyle}' not in ('rounded', 'soft', 'square')
     or p_document  #>>'{global,appearance,theme,fontStyle}' not in ('system', 'rounded', 'editorial') then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if not (v_branding ? 'logoUrl') or not (v_branding ? 'coverImageUrl')
     or v_branding - array['logoUrl', 'coverImageUrl'] <> '{}'::jsonb
     or (v_branding->'logoUrl' is distinct from 'null'::jsonb and (jsonb_typeof(v_branding->'logoUrl') is distinct from 'string' or char_length(v_branding->>'logoUrl') > 2048 or v_branding->>'logoUrl' !~ '^https://[^[:cntrl:] ]+$'))
     or (v_branding->'coverImageUrl' is distinct from 'null'::jsonb and (jsonb_typeof(v_branding->'coverImageUrl') is distinct from 'string' or char_length(v_branding->>'coverImageUrl') > 2048 or v_branding->>'coverImageUrl' !~ '^https://[^[:cntrl:] ]+$')) then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if jsonb_typeof(p_document->'sections') is distinct from 'array' or jsonb_array_length(p_document->'sections') > 30 then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  for v_section in select value from jsonb_array_elements(p_document->'sections') loop
    if jsonb_typeof(v_section) is distinct from 'object'
       or v_section - array['id', 'type', 'enabled', 'layout', 'props'] <> '{}'::jsonb
       or not (v_section ? 'id') or not (v_section ? 'type') or not (v_section ? 'enabled') or not (v_section ? 'layout') or not (v_section ? 'props')
       or jsonb_typeof(v_section->'id') is distinct from 'string' or jsonb_typeof(v_section->'type') is distinct from 'string'
       or jsonb_typeof(v_section->'enabled') is distinct from 'boolean' or jsonb_typeof(v_section->'layout') is distinct from 'string'
       or jsonb_typeof(v_section->'props') is distinct from 'object' or v_section->>'id' !~ '^[a-z][a-z0-9-]{2,63}$' then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    v_type := v_section->>'type'; v_props := v_section->'props'; v_ids := array_append(v_ids, v_section->>'id');
    if (v_type = 'header' and (v_section->>'layout' not in ('default', 'showcase') or v_props is distinct from jsonb_build_object('contentSource', 'portal')))
       or (v_type = 'catalog' and (v_section->>'layout' not in ('grid', 'compact') or v_props - array['showSearch', 'showCategories'] <> '{}'::jsonb or not (v_props ? 'showSearch') or not (v_props ? 'showCategories') or jsonb_typeof(v_props->'showSearch') is distinct from 'boolean' or jsonb_typeof(v_props->'showCategories') is distinct from 'boolean'))
       or (v_type = 'footer' and (v_section->>'layout' is distinct from 'lanzo' or v_props is distinct from jsonb_build_object('contentSource', 'lanzo')))
       or v_type not in ('header', 'catalog', 'footer') then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    if (v_section->>'enabled')::boolean then v_active := jsonb_set(v_active, array[v_type], to_jsonb(coalesce((v_active->>v_type)::integer, 0) + 1), true); end if;
  end loop;
  if exists (select 1 from unnest(v_ids) as id group by id having count(*) > 1) then return 'ECOMMERCE_SITE_DUPLICATE_SECTION'; end if;
  if coalesce((v_active->>'header')::integer, 0) <> 1 or coalesce((v_active->>'catalog')::integer, 0) <> 1 or coalesce((v_active->>'footer')::integer, 0) <> 1 then return 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'; end if;
  return null;
end;
$$;

create or replace function private.ecommerce_site_project_document_v2_to_v1(p_document jsonb)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_projected jsonb; v_error text;
begin
  v_error := private.ecommerce_site_document_error(p_document);
  if v_error is not null then raise exception '%', v_error; end if;
  v_projected := jsonb_build_object(
    'schemaVersion', 1,
    'global', jsonb_build_object('themeSource', 'portal', 'contentWidth', p_document  #>>'{global,contentWidth}', 'density', p_document  #>>'{global,density}'),
    'sections', p_document->'sections'
  );
  v_error := private.ecommerce_site_document_error_v1(v_projected);
  if v_error is not null then raise exception '%', v_error; end if;
  return v_projected;
end;
$$;

create or replace function private.ecommerce_site_migrate_document_v1_to_v2(
  p_document jsonb, p_template text, p_theme jsonb, p_logo_url text, p_cover_image_url text
) returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_base jsonb; v_candidate jsonb; v_error text;
begin
  v_error := private.ecommerce_site_document_error_v1(p_document);
  if v_error is not null then raise exception '%', v_error; end if;
  v_base := private.ecommerce_site_default_document_v2(p_template, p_theme, p_logo_url, p_cover_image_url);
  v_candidate := jsonb_set(v_base, '{global,density}', to_jsonb(p_document  #>>'{global,density}'));
  v_candidate := jsonb_set(v_candidate, '{sections}', p_document->'sections');
  v_error := private.ecommerce_site_document_error(v_candidate);
  if v_error is not null then raise exception '%', v_error; end if;
  return v_candidate;
end;
$$;

create or replace function private.ecommerce_site_document_mode_v2(p_document jsonb)
returns text language sql stable security definer set search_path to '' as $$
  select case when p_document = private.ecommerce_site_default_document_v2(
    p_document  #>>'{global,appearance,templateCode}',
    p_document #>'{global,appearance,theme}',
    p_document  #>>'{global,appearance,branding,logoUrl}',
    p_document  #>>'{global,appearance,branding,coverImageUrl}'
  ) then 'default' else 'custom' end;
$$;

-- The operation is guarded by v1 predicates, so a logical rerun cannot create another v2 baseline.
do $$
declare r record; v_document jsonb; v_checksum text; v_mode text; v_next_number bigint; v_new_id uuid;
begin
  for r in
    select d.portal_id, d.draft_document, p.template_code, p.theme, p.logo_url, p.cover_image_url
    from public.ecommerce_site_documents d join public.ecommerce_portals p on p.id = d.portal_id
    where d.draft_document->>'schemaVersion' = '1'
  loop
    v_document := private.ecommerce_site_migrate_document_v1_to_v2(r.draft_document, r.template_code, r.theme, r.logo_url, r.cover_image_url);
    update public.ecommerce_site_documents
    set draft_document = v_document, document_mode = private.ecommerce_site_document_mode_v2(v_document), draft_revision = draft_revision + 1, updated_at = now()
    where portal_id = r.portal_id and draft_document->>'schemaVersion' = '1';
  end loop;
  for r in
    select d.portal_id, v.document, p.template_code, p.theme, p.logo_url, p.cover_image_url
    from public.ecommerce_site_documents d
    join public.ecommerce_site_versions v on v.id = d.published_version_id and v.portal_id = d.portal_id
    join public.ecommerce_portals p on p.id = d.portal_id
    where v.schema_version = 1
  loop
    v_document := private.ecommerce_site_migrate_document_v1_to_v2(r.document, r.template_code, r.theme, r.logo_url, r.cover_image_url);
    v_checksum := private.ecommerce_site_checksum(v_document); v_mode := private.ecommerce_site_document_mode_v2(v_document);
    select coalesce(max(version_number), 0) + 1 into v_next_number from public.ecommerce_site_versions where portal_id = r.portal_id;
    perform set_config('app.ecommerce_site_version_insert', 'authorized', true);
    insert into public.ecommerce_site_versions(portal_id, version_number, schema_version, document, document_checksum, source, document_mode)
    values (r.portal_id, v_next_number, 2, v_document, v_checksum, 'migration', v_mode) returning id into v_new_id;
    update public.ecommerce_site_documents set published_version_id = v_new_id, updated_at = now() where portal_id = r.portal_id;
  end loop;
end;
$$;

create or replace function private.ecommerce_site_document_for_auth(p_auth jsonb, p_lock boolean default false)
returns public.ecommerce_site_documents language plpgsql security definer set search_path to '' as $$
declare v_portal public.ecommerce_portals%rowtype; v_document public.ecommerce_site_documents%rowtype; v_default jsonb;
begin
  select * into v_portal from public.ecommerce_portals where license_id = (p_auth->>'license_id')::uuid and deleted_at is null limit 1;
  if v_portal.id is null then return null; end if;
  v_default := private.ecommerce_site_default_document_v2(v_portal.template_code, v_portal.theme, v_portal.logo_url, v_portal.cover_image_url);
  insert into public.ecommerce_site_documents(portal_id, draft_document, document_mode, updated_by_device_id, updated_by_staff_user_id)
  values (v_portal.id, v_default, 'default', (p_auth->>'device_id')::uuid, nullif(p_auth->>'staff_user_id', '')::uuid)
  on conflict (portal_id) do nothing;
  if p_lock then select * into v_document from public.ecommerce_site_documents where portal_id = v_portal.id for update;
  else select * into v_document from public.ecommerce_site_documents where portal_id = v_portal.id; end if;
  return v_document;
end;
$$;

/* superseded below after the compatibility helpers; retained only to keep this migration diff recoverable.
create or replace function private.ecommerce_site_builder_payload(p_document public.ecommerce_site_documents, p_legacy boolean)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_version public.ecommerce_site_versions%rowtype; v_draft jsonb; v_published jsonb;
begin
  select * into v_version from public.ecommerce_site_versions where id = p_document.published_version_id and portal_id = p_document.portal_id;
  v_draft := case when p_legacy then private.ecommerce_site_project_document_v2_to_v1(p_document.draft_document) else p_document.draft_document end;
  if v_version.id is not null then v_published := case when p_legacy then private.ecommerce_site_project_document_v2_to_v1(v_version.document) else v_version.document end; end if;
  return jsonb_build_object(
    'success', true,
    'draft', jsonb_build_object('document', v_draft, 'revision', p_document.draft_revision, 'updatedAt', p_document.updated_at, 'documentMode', p_document.documenâ€¦29 tokens truncatedâ€¦ values (v_doc.portal_id, coalesce((select max(version_number) + 1 from public.ecommerce_site_versions where portal_id = v_doc.portal_id), 1), 2, v_doc.draft_document, v_checksum, v_doc.document_mode, 'publish', (p_auth->>'device_id')::uuid, nullif(p_auth->>'staff_user_id', '')::uuid)
  returning * into v_version;
  update public.ecommerce_site_documents set published_version_id = v_version.id, updated_at = now() where portal_id = v_doc.portal_id;
  update public.ecommerce_portals set template_code = v_doc.draft_document  #>>'{global,appearance,templateCode}', theme = v_doc.draft_document #>'{global,appearance,theme}', logo_url = nullif(v_doc.draft_document  #>>'{global,appearance,branding,logoUrl}', ''), cover_image_url = nullif(v_doc.draft_document  #>>'{global,appearance,branding,coverImageUrl}', '') where id = v_doc.portal_id;
  return jsonb_build_object('success', true, 'idempotent', false, 'published', jsonb_build_object('versionId', v_version.id, 'versionNumber', v_version.version_number, 'document', v_version.document, 'schemaVersion', 2, 'documentMode', v_version.document_mode, 'publishedAt', v_version.created_at));
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_PUBLISH_FAILED');
end;
$$;

*/
create or replace function private.ecommerce_site_builder_payload(p_document public.ecommerce_site_documents, p_legacy boolean)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_version public.ecommerce_site_versions%rowtype; v_draft jsonb; v_published jsonb;
begin
  select * into v_version from public.ecommerce_site_versions where id = p_document.published_version_id and portal_id = p_document.portal_id;
  v_draft := case when p_legacy then private.ecommerce_site_project_document_v2_to_v1(p_document.draft_document) else p_document.draft_document end;
  if v_version.id is not null then v_published := case when p_legacy then private.ecommerce_site_project_document_v2_to_v1(v_version.document) else v_version.document end; end if;
  return jsonb_build_object(
    'success', true,
    'draft', jsonb_build_object('document', v_draft, 'revision', p_document.draft_revision, 'updatedAt', p_document.updated_at, 'documentMode', p_document.document_mode),
    'published', case when v_version.id is null then null else jsonb_build_object('versionId', v_version.id, 'versionNumber', v_version.version_number, 'document', v_published, 'documentMode', v_version.document_mode, 'publishedAt', v_version.created_at) end,
    'hasUnpublishedChanges', v_version.id is null or private.ecommerce_site_checksum(p_document.draft_document) is distinct from v_version.document_checksum or p_document.document_mode is distinct from v_version.document_mode
  );
end;
$$;

create or replace function private.ecommerce_site_save_draft_v2(p_auth jsonb, p_expected_revision bigint, p_document jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_doc public.ecommerce_site_documents%rowtype; v_error text;
begin
  v_error := private.ecommerce_site_document_error(p_document); if v_error is not null then return private.ecommerce_admin_error(v_error); end if;
  v_doc := private.ecommerce_site_document_for_auth(p_auth, true);
  if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  if p_expected_revision is null or v_doc.draft_revision is distinct from p_expected_revision then return private.ecommerce_admin_error('ECOMMERCE_SITE_DRAFT_CONFLICT'); end if;
  update public.ecommerce_site_documents
  set draft_document = p_document, document_mode = private.ecommerce_site_document_mode_v2(p_document), draft_revision = draft_revision + 1, updated_at = now(), updated_by_device_id = (p_auth->>'device_id')::uuid, updated_by_staff_user_id = nullif(p_auth->>'staff_user_id', '')::uuid
  where portal_id = v_doc.portal_id returning * into v_doc;
  return jsonb_build_object('success', true, 'draft', jsonb_build_object('document', v_doc.draft_document, 'revision', v_doc.draft_revision, 'updatedAt', v_doc.updated_at, 'documentMode', v_doc.document_mode));
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED');
end;
$$;

create or replace function private.ecommerce_site_publish_v2(p_auth jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_doc public.ecommerce_site_documents%rowtype; v_existing public.ecommerce_site_versions%rowtype; v_version public.ecommerce_site_versions%rowtype; v_error text; v_checksum text;
begin
  v_doc := private.ecommerce_site_document_for_auth(p_auth, true); if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  v_error := private.ecommerce_site_document_error(v_doc.draft_document); if v_error is not null then return private.ecommerce_admin_error(v_error); end if;
  v_checksum := private.ecommerce_site_checksum(v_doc.draft_document);
  select * into v_existing from public.ecommerce_site_versions where id = v_doc.published_version_id and portal_id = v_doc.portal_id;
  if v_existing.id is not null and v_existing.document_checksum = v_checksum and v_existing.schema_version = 2 and v_existing.document_mode = v_doc.document_mode then
    return jsonb_build_object('success', true, 'idempotent', true, 'published', jsonb_build_object('versionId', v_existing.id, 'versionNumber', v_existing.version_number, 'document', v_existing.document, 'schemaVersion', 2, 'documentMode', v_existing.document_mode, 'publishedAt', v_existing.created_at));
  end if;
  perform set_config('app.ecommerce_site_version_insert', 'authorized', true);
  insert into public.ecommerce_site_versions(portal_id, version_number, schema_version, document, document_checksum, document_mode, source, created_by_device_id, created_by_staff_user_id)
  values (v_doc.portal_id, coalesce((select max(version_number) + 1 from public.ecommerce_site_versions where portal_id = v_doc.portal_id), 1), 2, v_doc.draft_document, v_checksum, v_doc.document_mode, 'publish', (p_auth->>'device_id')::uuid, nullif(p_auth->>'staff_user_id', '')::uuid)
  returning * into v_version;
  update public.ecommerce_site_documents set published_version_id = v_version.id, updated_at = now() where portal_id = v_doc.portal_id;
  update public.ecommerce_portals set template_code = v_doc.draft_document #>> '{global,appearance,templateCode}', theme = v_doc.draft_document #> '{global,appearance,theme}', logo_url = nullif(v_doc.draft_document #>> '{global,appearance,branding,logoUrl}', ''), cover_image_url = nullif(v_doc.draft_document #>> '{global,appearance,branding,coverImageUrl}', '') where id = v_doc.portal_id;
  return jsonb_build_object('success', true, 'idempotent', false, 'published', jsonb_build_object('versionId', v_version.id, 'versionNumber', v_version.version_number, 'document', v_version.document, 'schemaVersion', 2, 'documentMode', v_version.document_mode, 'publishedAt', v_version.created_at));
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_PUBLISH_FAILED');
end;
$$;

create or replace function private.ecommerce_site_restore_v2(p_auth jsonb, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_doc public.ecommerce_site_documents%rowtype; v_version public.ecommerce_site_versions%rowtype; v_next jsonb; v_error text;
begin
  v_doc := private.ecommerce_site_document_for_auth(p_auth, true); if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  select * into v_version from public.ecommerce_site_versions where id = p_version_id and portal_id = v_doc.portal_id;
  if v_version.id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_VERSION_NOT_FOUND'); end if;
  v_next := case when v_version.schema_version = 1 then private.ecommerce_site_migrate_document_v1_to_v2(v_version.document, v_doc.draft_document  #>>'{global,appearance,templateCode}', v_doc.draft_document #>'{global,appearance,theme}', v_doc.draft_document  #>>'{global,appearance,branding,logoUrl}', v_doc.draft_document  #>>'{global,appearance,branding,coverImageUrl}') else v_version.document end;
  v_error := private.ecommerce_site_document_error(v_next); if v_error is not null then return private.ecommerce_admin_error(v_error); end if;
  update public.ecommerce_site_documents
  set draft_document = v_next, document_mode = private.ecommerce_site_document_mode_v2(v_next), draft_revision = draft_revision + 1, updated_at = now(), updated_by_device_id = (p_auth->>'device_id')::uuid, updated_by_staff_user_id = nullif(p_auth->>'staff_user_id', '')::uuid
  where portal_id = v_doc.portal_id returning * into v_doc;
  return jsonb_build_object('success', true, 'legacyStructureRestored', v_version.schema_version = 1, 'draft', jsonb_build_object('document', v_doc.draft_document, 'revision', v_doc.draft_revision, 'updatedAt', v_doc.updated_at, 'documentMode', v_doc.document_mode));
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED');
end;
$$;

create or replace function private.ecommerce_site_versions_payload(p_document public.ecommerce_site_documents, p_limit integer, p_offset integer)
returns jsonb language sql stable security definer set search_path to '' as $$
  with bounds as (select least(greatest(coalesce(p_limit, 20), 1), 50) as lim, greatest(coalesce(p_offset, 0), 0) as off), page as (
    select v.* from public.ecommerce_site_versions v, bounds where v.portal_id = p_document.portal_id order by v.version_number desc limit (select lim from bounds) offset (select off from bounds)
  ) select jsonb_build_object('success', true, 'limit', (select lim from bounds), 'offset', (select off from bounds),
    'hasMore', exists (select 1 from public.ecommerce_site_versions v, bounds where v.portal_id = p_document.portal_id order by v.version_number desc offset ((select off from bounds) + (select lim from bounds)) limit 1),
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'versionNumber', version_number, 'schemaVersion', schema_version, 'documentChecksum', document_checksum, 'documentMode', document_mode, 'source', source, 'createdAt', created_at, 'restoredFromVersionId', restored_from_version_id, 'isPublished', id = p_document.published_version_id) order by version_number desc) from page), '[]'::jsonb));
$$;

-- Legacy RPCs retain their exact names and signatures, but only ever receive v1 projections.
create or replace function public.ecommerce_admin_get_site_builder(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype;
begin
  v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_get_site_builder'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if;
  v_doc := private.ecommerce_site_document_for_auth(v_auth); if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  return private.ecommerce_site_builder_payload(v_doc, true);
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end;
$$;

create or replace function public.ecommerce_admin_get_site_builder_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype;
begin
  v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_get_site_builder_v2'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if;
  v_doc := private.ecommerce_site_document_for_auth(v_auth); if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  return private.ecommerce_site_builder_payload(v_doc, false);
exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end;
$$;

create or replace function public.ecommerce_admin_save_site_draft(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_expected_revision bigint, p_document jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype; v_v2 jsonb; v_result jsonb; v_error text;
begin
  v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_save_site_draft'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if;
  v_error := private.ecommerce_site_document_error_v1(p_document); if v_error is not null then return private.ecommerce_admin_error(v_error); end if;
  v_doc := private.ecommerce_site_document_for_auth(v_auth); if v_doc.portal_id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end if;
  v_v2 := private.ecommerce_site_migrate_document_v1_to_v2(p_document, v_doc.draft_document  #>>'{global,appearance,templateCode}', v_doc.draft_document #>'{global,appearance,theme}', v_doc.draft_document  #>>'{global,appearance,branding,logoUrl}', v_doc.draft_document  #>>'{global,appearance,branding,coverImageUrl}');
  v_result := private.ecommerce_site_save_draft_v2(v_auth, p_expected_revision, v_v2);
  if coalesce((v_result->>'success')::boolean, false) is not true then return v_result; end if;
  return jsonb_set(v_result, '{draft,document}', private.ecommerce_site_project_document_v2_to_v1(v_result #>'{draft,document}'));
end;
$$;

create or replace function public.ecommerce_admin_save_site_draft_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_expected_revision bigint, p_document jsonb)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_save_site_draft_v2'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; return private.ecommerce_site_save_draft_v2(v_auth, p_expected_revision, p_document); end;
$$;

create or replace function public.ecommerce_admin_publish_site(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_result jsonb;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_publish_site'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; v_result := private.ecommerce_site_publish_v2(v_auth); if coalesce((v_result->>'success')::boolean, false) then return jsonb_set(v_result, '{published,document}', private.ecommerce_site_project_document_v2_to_v1(v_result #>'{published,document}')); end if; return v_result; end;
$$;

create or replace function public.ecommerce_admin_publish_site_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_publish_site_v2'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; return private.ecommerce_site_publish_v2(v_auth); end;
$$;

create or replace function public.ecommerce_admin_restore_site_version(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_result jsonb;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_restore_site_version'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; v_result := private.ecommerce_site_restore_v2(v_auth, p_version_id); if coalesce((v_result->>'success')::boolean, false) then return jsonb_set(v_result, '{draft,document}', private.ecommerce_site_project_document_v2_to_v1(v_result #>'{draft,document}')); end if; return v_result; end;
$$;

create or replace function public.ecommerce_admin_restore_site_version_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_version_id uuid)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_restore_site_version_v2'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; return private.ecommerce_site_restore_v2(v_auth, p_version_id); end;
$$;

create or replace function public.ecommerce_admin_list_site_versions(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_list_site_versions'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; v_doc := private.ecommerce_site_document_for_auth(v_auth); return private.ecommerce_site_versions_payload(v_doc, p_limit, p_offset); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end;
$$;

create or replace function public.ecommerce_admin_list_site_versions_v2(p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text, p_limit integer default 20, p_offset integer default 0)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_auth jsonb; v_doc public.ecommerce_site_documents%rowtype;
begin v_auth := private.ecommerce_site_authorize(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'ecommerce_admin_list_site_versions_v2'); if coalesce((v_auth->>'success')::boolean, false) is not true then return v_auth; end if; v_doc := private.ecommerce_site_document_for_auth(v_auth); return private.ecommerce_site_versions_payload(v_doc, p_limit, p_offset); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end;
$$;

create or replace function private.ecommerce_site_public_payload(p_slug text, p_legacy boolean)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare v_portal public.ecommerce_portals%rowtype; v_version public.ecommerce_site_versions%rowtype; v_document jsonb; v_error text; v_version_id uuid := null; v_version_number bigint := null; v_mode text := 'default';
begin
  v_portal := private.ecommerce_get_public_portal_by_slug(p_slug); if v_portal.id is null then return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;
  select v.* into v_version from public.ecommerce_site_documents d join public.ecommerce_site_versions v on v.id = d.published_version_id and v.portal_id = d.portal_id where d.portal_id = v_portal.id;
  if v_version.id is not null then
    v_document := case when v_version.schema_version = 2 then v_version.document else private.ecommerce_site_migrate_document_v1_to_v2(v_version.document, v_portal.template_code, v_portal.theme, v_portal.logo_url, v_portal.cover_image_url) end;
    v_error := private.ecommerce_site_document_error(v_document);
    if v_error is null then v_version_id := v_version.id; v_version_number := v_version.version_number; v_mode := coalesce(nullif(v_version.document_mode, ''), private.ecommerce_site_document_mode_v2(v_document)); else v_document := null; end if;
  end if;
  if v_document is null then v_document := private.ecommerce_site_default_document_v2(v_portal.template_code, v_portal.theme, v_portal.logo_url, v_portal.cover_image_url); v_version_id := null; v_version_number := null; v_mode := 'default'; end if;
  if p_legacy then v_document := private.ecommerce_site_project_document_v2_to_v1(v_document); end if;
  return jsonb_build_object('success', true, 'portal', private.ecommerce_portal_public_jsonb(v_portal), 'hours', private.ecommerce_portal_hours_jsonb(v_portal.id), 'availability', private.ecommerce_public_availability_jsonb(v_portal, clock_timestamp()),
    'features', jsonb_build_object('whatsappCheckout', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_whatsapp_checkout', false), 'orderInbox', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_order_inbox', false), 'customSlug', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_custom_slug', false), 'brandingCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_branding_customization'), 'basic'), 'layoutCustomization', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_layout_customization'), 'template_only'), 'businessHours', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_business_hours', true), 'deliveryPickupSettings', coalesce(private.ecommerce_license_feature_text(v_portal.license_id, 'ecommerce_delivery_pickup_settings'), 'basic'), 'stockVisibility', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_stock_visibility', false), 'realtimeOrders', private.ecommerce_license_feature_bool(v_portal.license_id, 'ecommerce_realtime_orders', false)),
    'catalogRevision', v_portal.catalog_revision, 'site', jsonb_build_object('schemaVersion', case when p_legacy then 1 else 2 end, 'versionId', v_version_id, 'versionNumber', v_version_number, 'documentMode', v_mode, 'document', v_document), 'cachePolicy', jsonb_build_object('schemaVersion', case when p_legacy then 1 else 2 end, 'freshSeconds', 300, 'maxStaleSeconds', 86400));
exception when others then return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND'); end;
$$;

create or replace function public.ecommerce_get_portal_by_slug(p_slug text)
returns jsonb language sql security definer set search_path to '' as $$ select private.ecommerce_site_public_payload(p_slug, true); $$;
create or replace function public.ecommerce_get_portal_by_slug_v2(p_slug text)
returns jsonb language sql security definer set search_path to '' as $$ select private.ecommerce_site_public_payload(p_slug, false); $$;

revoke all on function private.ecommerce_site_default_document_v2(text,jsonb,text,text), private.ecommerce_site_document_error_v1(jsonb), private.ecommerce_site_document_error(jsonb), private.ecommerce_site_project_document_v2_to_v1(jsonb), private.ecommerce_site_migrate_document_v1_to_v2(jsonb,text,jsonb,text,text), private.ecommerce_site_document_mode_v2(jsonb), private.ecommerce_site_document_for_auth(jsonb,boolean), private.ecommerce_site_builder_payload(public.ecommerce_site_documents,boolean), private.ecommerce_site_save_draft_v2(jsonb,bigint,jsonb), private.ecommerce_site_publish_v2(jsonb), private.ecommerce_site_restore_v2(jsonb,uuid), private.ecommerce_site_versions_payload(public.ecommerce_site_documents,integer,integer), private.ecommerce_site_public_payload(text,boolean) from public, anon, authenticated;
revoke all on function public.ecommerce_admin_get_site_builder(text,text,text,text), public.ecommerce_admin_save_site_draft(text,text,text,text,bigint,jsonb), public.ecommerce_admin_publish_site(text,text,text,text), public.ecommerce_admin_restore_site_version(text,text,text,text,uuid), public.ecommerce_admin_list_site_versions(text,text,text,text,integer,integer), public.ecommerce_get_portal_by_slug(text), public.ecommerce_admin_get_site_builder_v2(text,text,text,text), public.ecommerce_admin_save_site_draft_v2(text,text,text,text,bigint,jsonb), public.ecommerce_admin_publish_site_v2(text,text,text,text), public.ecommerce_admin_restore_site_version_v2(text,text,text,text,uuid), public.ecommerce_admin_list_site_versions_v2(text,text,text,text,integer,integer), public.ecommerce_get_portal_by_slug_v2(text) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_get_site_builder(text,text,text,text), public.ecommerce_admin_save_site_draft(text,text,text,text,bigint,jsonb), public.ecommerce_admin_publish_site(text,text,text,text), public.ecommerce_admin_restore_site_version(text,text,text,text,uuid), public.ecommerce_admin_list_site_versions(text,text,text,text,integer,integer), public.ecommerce_admin_get_site_builder_v2(text,text,text,text), public.ecommerce_admin_save_site_draft_v2(text,text,text,text,bigint,jsonb), public.ecommerce_admin_publish_site_v2(text,text,text,text), public.ecommerce_admin_restore_site_version_v2(text,text,text,text,uuid), public.ecommerce_admin_list_site_versions_v2(text,text,text,text,integer,integer) to anon, authenticated, service_role;
grant execute on function public.ecommerce_get_portal_by_slug(text), public.ecommerce_get_portal_by_slug_v2(text) to anon, authenticated, service_role;
