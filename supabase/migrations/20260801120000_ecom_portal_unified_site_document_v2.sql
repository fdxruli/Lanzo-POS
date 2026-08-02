-- ECOM.PORTAL.BUILDER.3: the v2 document is the sole PRO design authority.
alter table public.ecommerce_site_versions drop constraint if exists ecommerce_site_versions_schema_version_check;
alter table public.ecommerce_site_versions add constraint ecommerce_site_versions_schema_version_check check (schema_version in (1, 2));
alter table public.ecommerce_site_versions drop constraint if exists ecommerce_site_versions_source_check;
alter table public.ecommerce_site_versions add constraint ecommerce_site_versions_source_check check (source in ('publish', 'restore', 'migration'));

create or replace function private.ecommerce_site_default_document_v2(p_template text, p_theme jsonb default null, p_logo_url text default null, p_cover_image_url text default null)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_template text := case when p_template in ('classic','showcase','compact') then p_template else 'classic' end;
declare v_theme jsonb := coalesce(p_theme, '{}'::jsonb);
begin
  return jsonb_build_object('schemaVersion',2,'global',jsonb_build_object(
    'contentWidth','standard','density',case when v_template='compact' then 'compact' else 'comfortable' end,
    'appearance',jsonb_build_object('templateCode',v_template,'theme',jsonb_build_object(
      'primaryColor',case when v_theme->>'primaryColor' ~ '^#[0-9A-Fa-f]{6}$' then v_theme->>'primaryColor' else '#0284c7' end,
      'secondaryColor',case when v_theme->>'secondaryColor' ~ '^#[0-9A-Fa-f]{6}$' then v_theme->>'secondaryColor' else '#0369a1' end,
      'cornerStyle',case when v_theme->>'cornerStyle' in ('rounded','soft','square') then v_theme->>'cornerStyle' else 'rounded' end,
      'fontStyle',case when v_theme->>'fontStyle' in ('system','rounded','editorial') then v_theme->>'fontStyle' else 'system' end
    ),'branding',jsonb_build_object('logoUrl',case when p_logo_url ~ '^https://[^[:cntrl:] ]{1,2040}$' then p_logo_url else null end,'coverImageUrl',case when p_cover_image_url ~ '^https://[^[:cntrl:] ]{1,2040}$' then p_cover_image_url else null end))),
    'sections',jsonb_build_array(
      jsonb_build_object('id','header-main','type','header','enabled',true,'layout',case when v_template='showcase' then 'showcase' else 'default' end,'props',jsonb_build_object('contentSource','portal')),
      jsonb_build_object('id','catalog-main','type','catalog','enabled',true,'layout',case when v_template='compact' then 'compact' else 'grid' end,'props',jsonb_build_object('showSearch',true,'showCategories',true)),
      jsonb_build_object('id','footer-main','type','footer','enabled',true,'layout','lanzo','props',jsonb_build_object('contentSource','lanzo'))));
end; $$;

create or replace function private.ecommerce_site_document_error(p_document jsonb)
returns text language plpgsql stable security definer set search_path to '' as $$
declare s jsonb; ids text[] := '{}'::text[]; active jsonb := '{}'::jsonb; typ text; props jsonb;
begin
 if p_document is null or jsonb_typeof(p_document) <> 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
 if octet_length(p_document::text) > 65536 then return 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE'; end if;
 if p_document - array['schemaVersion','global','sections'] <> '{}'::jsonb or p_document->>'schemaVersion' <> '2' or jsonb_typeof(p_document->'global') <> 'object' then return case when p_document->>'schemaVersion' <> '2' then 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED' else 'ECOMMERCE_SITE_DOCUMENT_INVALID' end; end if;
 if p_document->'global' - array['contentWidth','density','appearance'] <> '{}'::jsonb or p_document#>>'{global,contentWidth}' <> 'standard' or p_document#>>'{global,density}' not in ('comfortable','compact') or jsonb_typeof(p_document#>'{global,appearance}') <> 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
 if p_document#>'{global,appearance}' - array['templateCode','theme','branding'] <> '{}'::jsonb or p_document#>>'{global,appearance,templateCode}' not in ('classic','showcase','compact') or jsonb_typeof(p_document#>'{global,appearance,theme}') <> 'object' or jsonb_typeof(p_document#>'{global,appearance,branding}') <> 'object' then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
 if p_document#>'{global,appearance,theme}' - array['primaryColor','secondaryColor','cornerStyle','fontStyle'] <> '{}'::jsonb or p_document#>>'{global,appearance,primaryColor}' !~ '^#[0-9A-Fa-f]{6}$' or p_document#>>'{global,appearance,secondaryColor}' !~ '^#[0-9A-Fa-f]{6}$' or p_document#>>'{global,appearance,cornerStyle}' not in ('rounded','soft','square') or p_document#>>'{global,appearance,fontStyle}' not in ('system','rounded','editorial') then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
 if p_document#>'{global,appearance,branding}' - array['logoUrl','coverImageUrl'] <> '{}'::jsonb or (p_document#>'{global,appearance,branding,logoUrl}' <> 'null'::jsonb and (jsonb_typeof(p_document#>'{global,appearance,branding,logoUrl}') <> 'string' or p_document#>>'{global,appearance,branding,logoUrl}' !~ '^https://[^[:cntrl:] ]{1,2040}$')) or (p_document#>'{global,appearance,branding,coverImageUrl}' <> 'null'::jsonb and (jsonb_typeof(p_document#>'{global,appearance,branding,coverImageUrl}') <> 'string' or p_document#>>'{global,appearance,branding,coverImageUrl}' !~ '^https://[^[:cntrl:] ]{1,2040}$')) then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
 if jsonb_typeof(p_document->'sections') <> 'array' or jsonb_array_length(p_document->'sections') > 30 then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
 for s in select value from jsonb_array_elements(p_document->'sections') loop
  if jsonb_typeof(s) <> 'object' or s - array['id','type','enabled','layout','props'] <> '{}'::jsonb or jsonb_typeof(s->'id') <> 'string' or s->>'id' !~ '^[a-z][a-z0-9-]{2,63}$' or jsonb_typeof(s->'type') <> 'string' or jsonb_typeof(s->'enabled') <> 'boolean' or jsonb_typeof(s->'layout') <> 'string' or jsonb_typeof(s->'props') <> 'object' then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
  typ := s->>'type'; props := s->'props'; ids := array_append(ids,s->>'id');
  if typ='header' then if s->>'layout' not in ('default','showcase') or props <> jsonb_build_object('contentSource','portal') then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
  elsif typ='catalog' then if s->>'layout' not in ('grid','compact') or props - array['showSearch','showCategories'] <> '{}'::jsonb or jsonb_typeof(props->'showSearch') <> 'boolean' or jsonb_typeof(props->'showCategories') <> 'boolean' then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
  elsif typ='footer' then if s->>'layout' <> 'lanzo' or props <> jsonb_build_object('contentSource','lanzo') then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
  else return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
  if (s->>'enabled')::boolean then active := jsonb_set(active,array[typ],to_jsonb(coalesce((active->>typ)::integer,0)+1),true); end if;
 end loop;
 if exists(select 1 from unnest(ids) id group by id having count(*)>1) then return 'ECOMMERCE_SITE_DUPLICATE_SECTION'; end if;
 if coalesce((active->>'header')::integer,0)<>1 or coalesce((active->>'catalog')::integer,0)<>1 or coalesce((active->>'footer')::integer,0)<>1 then return 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'; end if;
 return null;
end; $$;

create or replace function private.ecommerce_site_migrate_document_v1_to_v2(p_document jsonb,p_template text,p_theme jsonb,p_logo_url text,p_cover_image_url text)
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare base jsonb := private.ecommerce_site_default_document_v2(p_template,p_theme,p_logo_url,p_cover_image_url); candidate jsonb; err text;
begin
 if p_document->>'schemaVersion' <> '1' then raise exception 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'; end if;
 candidate := jsonb_set(base,'{global,density}',to_jsonb(case when p_document#>>'{global,density}' in ('comfortable','compact') then p_document#>>'{global,density}' else base#>>'{global,density}' end));
 if jsonb_typeof(p_document->'sections')='array' then candidate := jsonb_set(candidate,'{sections}',p_document->'sections'); end if;
 err := private.ecommerce_site_document_error(candidate); if err is not null then raise exception '%',err; end if; return candidate;
end; $$;

-- Backfill only v1 drafts and create one v2 immutable baseline for a v1 published site.
do $$ declare r record; v2 jsonb; checksum text; next_number bigint; new_id uuid; begin
 for r in select d.portal_id,d.draft_document,p.template_code,p.theme,p.logo_url,p.cover_image_url from public.ecommerce_site_documents d join public.ecommerce_portals p on p.id=d.portal_id where d.draft_document->>'schemaVersion'='1' loop
  v2 := private.ecommerce_site_migrate_document_v1_to_v2(r.draft_document,r.template_code,r.theme,r.logo_url,r.cover_image_url);
  update public.ecommerce_site_documents set draft_document=v2,draft_revision=draft_revision+1,updated_at=now(),document_mode=case when v2=private.ecommerce_site_default_document_v2(r.template_code,r.theme,r.logo_url,r.cover_image_url) then 'default' else 'custom' end where portal_id=r.portal_id and draft_document->>'schemaVersion'='1';
 end loop;
 for r in select d.portal_id,d.published_version_id,v.document,p.template_code,p.theme,p.logo_url,p.cover_image_url from public.ecommerce_site_documents d join public.ecommerce_site_versions v on v.id=d.published_version_id join public.ecommerce_portals p on p.id=d.portal_id where v.schema_version=1 loop
  v2 := private.ecommerce_site_migrate_document_v1_to_v2(r.document,r.template_code,r.theme,r.logo_url,r.cover_image_url); checksum := private.ecommerce_site_checksum(v2);
  perform set_config('app.ecommerce_site_version_insert','authorized',true);
  select coalesce(max(version_number),0)+1 into next_number from public.ecommerce_site_versions where portal_id=r.portal_id;
  insert into public.ecommerce_site_versions(portal_id,version_number,schema_version,document,document_checksum,source,document_mode) values(r.portal_id,next_number,2,v2,checksum,'migration',case when v2=private.ecommerce_site_default_document_v2(r.template_code,r.theme,r.logo_url,r.cover_image_url) then 'default' else 'custom' end) returning id into new_id;
  update public.ecommerce_site_documents set published_version_id=new_id,updated_at=now() where portal_id=r.portal_id;
 end loop;
end $$;

create or replace function private.ecommerce_site_document_for_auth(p_auth jsonb,p_lock boolean default false) returns public.ecommerce_site_documents language plpgsql security definer set search_path to '' as $$
declare p public.ecommerce_portals%rowtype; d public.ecommerce_site_documents%rowtype; v2 jsonb;
begin select * into p from public.ecommerce_portals where license_id=(p_auth->>'license_id')::uuid and deleted_at is null limit 1; if p.id is null then return null; end if;
 v2:=private.ecommerce_site_default_document_v2(p.template_code,p.theme,p.logo_url,p.cover_image_url);
 insert into public.ecommerce_site_documents(portal_id,draft_document,document_mode,updated_by_device_id,updated_by_staff_user_id) values(p.id,v2,'default',(p_auth->>'device_id')::uuid,nullif(p_auth->>'staff_user_id','')::uuid) on conflict(portal_id) do nothing;
 if p_lock then select * into d from public.ecommerce_site_documents where portal_id=p.id for update; else select * into d from public.ecommerce_site_documents where portal_id=p.id; end if; return d;
end $$;

create or replace function public.ecommerce_admin_save_site_draft(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_expected_revision bigint,p_document jsonb) returns jsonb language plpgsql security definer set search_path to '' as $$
declare a jsonb; d public.ecommerce_site_documents%rowtype; e text;
begin a:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_save_site_draft'); if coalesce((a->>'success')::boolean,false) is not true then return a; end if; e:=private.ecommerce_site_document_error(p_document); if e is not null then return private.ecommerce_admin_error(e); end if; d:=private.ecommerce_site_document_for_auth(a,true); if p_expected_revision is null or d.draft_revision is distinct from p_expected_revision then return private.ecommerce_admin_error('ECOMMERCE_SITE_DRAFT_CONFLICT'); end if;
 update public.ecommerce_site_documents set draft_document=p_document,document_mode='custom',draft_revision=draft_revision+1,updated_at=now(),updated_by_device_id=(a->>'device_id')::uuid,updated_by_staff_user_id=nullif(a->>'staff_user_id','')::uuid where portal_id=d.portal_id returning * into d; return jsonb_build_object('success',true,'draft',jsonb_build_object('document',d.draft_document,'revision',d.draft_revision,'updatedAt',d.updated_at,'documentMode',d.document_mode)); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED'); end $$;

create or replace function public.ecommerce_admin_publish_site(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text) returns jsonb language plpgsql security definer set search_path to '' as $$
declare a jsonb; d public.ecommerce_site_documents%rowtype; existing public.ecommerce_site_versions%rowtype; v public.ecommerce_site_versions%rowtype; e text; checksum text;
begin a:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_publish_site'); if coalesce((a->>'success')::boolean,false) is not true then return a; end if; d:=private.ecommerce_site_document_for_auth(a,true); e:=private.ecommerce_site_document_error(d.draft_document); if e is not null then return private.ecommerce_admin_error(e); end if; checksum:=private.ecommerce_site_checksum(d.draft_document); select * into existing from public.ecommerce_site_versions where id=d.published_version_id and portal_id=d.portal_id;
 if existing.id is not null and existing.document_checksum=checksum then return jsonb_build_object('success',true,'idempotent',true,'published',jsonb_build_object('versionId',existing.id,'versionNumber',existing.version_number,'document',existing.document,'schemaVersion',existing.schema_version)); end if;
 perform set_config('app.ecommerce_site_version_insert','authorized',true); insert into public.ecommerce_site_versions(portal_id,version_number,schema_version,document,document_checksum,source,document_mode,created_by_device_id,created_by_staff_user_id) values(d.portal_id,coalesce((select max(version_number)+1 from public.ecommerce_site_versions where portal_id=d.portal_id),1),2,d.draft_document,checksum,'publish','custom',(a->>'device_id')::uuid,nullif(a->>'staff_user_id','')::uuid) returning * into v;
 update public.ecommerce_site_documents set published_version_id=v.id,updated_at=now() where portal_id=d.portal_id;
 update public.ecommerce_portals set template_code=d.draft_document#>>'{global,appearance,templateCode}',theme=d.draft_document#>'{global,appearance,theme}',logo_url=nullif(d.draft_document#>>'{global,appearance,branding,logoUrl}',''),cover_image_url=nullif(d.draft_document#>>'{global,appearance,branding,coverImageUrl}','') where id=d.portal_id;
 return jsonb_build_object('success',true,'idempotent',false,'published',jsonb_build_object('versionId',v.id,'versionNumber',v.version_number,'document',v.document,'schemaVersion',2)); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_PUBLISH_FAILED'); end $$;

create or replace function public.ecommerce_admin_restore_site_version(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_version_id uuid) returns jsonb language plpgsql security definer set search_path to '' as $$
declare a jsonb; d public.ecommerce_site_documents%rowtype; v public.ecommerce_site_versions%rowtype; p public.ecommerce_portals%rowtype; next_document jsonb;
begin a:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_restore_site_version'); if coalesce((a->>'success')::boolean,false) is not true then return a; end if; d:=private.ecommerce_site_document_for_auth(a,true); select * into v from public.ecommerce_site_versions where id=p_version_id and portal_id=d.portal_id; if v.id is null then return private.ecommerce_admin_error('ECOMMERCE_SITE_VERSION_NOT_FOUND'); end if; select * into p from public.ecommerce_portals where id=d.portal_id;
 next_document:=case when v.schema_version=1 then private.ecommerce_site_migrate_document_v1_to_v2(v.document,p.template_code,d.draft_document#>'{global,appearance,theme}',d.draft_document#>>'{global,appearance,branding,logoUrl}',d.draft_document#>>'{global,appearance,branding,coverImageUrl}') else v.document end;
 update public.ecommerce_site_documents set draft_document=next_document,draft_revision=draft_revision+1,updated_at=now(),updated_by_device_id=(a->>'device_id')::uuid,updated_by_staff_user_id=nullif(a->>'staff_user_id','')::uuid where portal_id=d.portal_id returning * into d; return jsonb_build_object('success',true,'legacyStructureRestored',v.schema_version=1,'draft',jsonb_build_object('document',d.draft_document,'revision',d.draft_revision,'updatedAt',d.updated_at)); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_SAVE_FAILED'); end $$;

create or replace function public.ecommerce_admin_list_site_versions(p_license_key text,p_device_fingerprint text,p_security_token text,p_staff_session_token text,p_limit integer default 20,p_offset integer default 0) returns jsonb language plpgsql security definer set search_path to '' as $$
declare a jsonb; d public.ecommerce_site_documents%rowtype;
begin a:=private.ecommerce_site_authorize(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,'ecommerce_admin_list_site_versions'); if coalesce((a->>'success')::boolean,false) is not true then return a; end if; d:=private.ecommerce_site_document_for_auth(a); return jsonb_build_object('success',true,'limit',least(50,greatest(1,coalesce(p_limit,20))),'offset',greatest(0,coalesce(p_offset,0)),'versions',coalesce((select jsonb_agg(jsonb_build_object('id',id,'versionNumber',version_number,'schemaVersion',schema_version,'createdAt',created_at,'source',source,'isPublished',id=d.published_version_id) order by version_number desc) from (select * from public.ecommerce_site_versions where portal_id=d.portal_id order by version_number desc limit least(50,greatest(1,coalesce(p_limit,20))) offset greatest(0,coalesce(p_offset,0))) x),'[]'::jsonb)); exception when others then return private.ecommerce_admin_error('ECOMMERCE_SITE_ACCESS_DENIED'); end $$;

revoke all on function private.ecommerce_site_default_document_v2(text,jsonb,text,text),private.ecommerce_site_migrate_document_v1_to_v2(jsonb,text,jsonb,text,text),private.ecommerce_site_document_error(jsonb) from public,anon,authenticated;

create or replace function public.ecommerce_get_portal_by_slug(p_slug text) returns jsonb language plpgsql security definer set search_path to '' as $$
declare p public.ecommerce_portals%rowtype; v public.ecommerce_site_versions%rowtype; doc jsonb;
begin
 p:=private.ecommerce_get_public_portal_by_slug(p_slug); if p.id is null then return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND'); end if;
 select v0.* into v from public.ecommerce_site_documents d join public.ecommerce_site_versions v0 on v0.id=d.published_version_id where d.portal_id=p.id;
 if v.id is null then doc:=private.ecommerce_site_default_document_v2(p.template_code,p.theme,p.logo_url,p.cover_image_url);
 elsif v.schema_version=1 then doc:=private.ecommerce_site_migrate_document_v1_to_v2(v.document,p.template_code,p.theme,p.logo_url,p.cover_image_url);
 else doc:=v.document; end if;
 if private.ecommerce_site_document_error(doc) is not null then doc:=private.ecommerce_site_default_document_v2(p.template_code,p.theme,p.logo_url,p.cover_image_url); end if;
 return jsonb_build_object('success',true,'portal',private.ecommerce_portal_public_jsonb(p),'hours',private.ecommerce_portal_hours_jsonb(p.id),'availability',private.ecommerce_public_availability_jsonb(p,clock_timestamp()),'features',jsonb_build_object('whatsappCheckout',private.ecommerce_license_feature_bool(p.license_id,'ecommerce_whatsapp_checkout',false),'orderInbox',private.ecommerce_license_feature_bool(p.license_id,'ecommerce_order_inbox',false),'customSlug',private.ecommerce_license_feature_bool(p.license_id,'ecommerce_custom_slug',false),'brandingCustomization',coalesce(private.ecommerce_license_feature_text(p.license_id,'ecommerce_branding_customization'),'basic'),'layoutCustomization',coalesce(private.ecommerce_license_feature_text(p.license_id,'ecommerce_layout_customization'),'template_only'),'businessHours',private.ecommerce_license_feature_bool(p.license_id,'ecommerce_business_hours',true),'deliveryPickupSettings',coalesce(private.ecommerce_license_feature_text(p.license_id,'ecommerce_delivery_pickup_settings'),'basic'),'stockVisibility',private.ecommerce_license_feature_bool(p.license_id,'ecommerce_stock_visibility',false),'realtimeOrders',private.ecommerce_license_feature_bool(p.license_id,'ecommerce_realtime_orders',false)),'catalogRevision',p.catalog_revision,'site',jsonb_build_object('schemaVersion',coalesce(v.schema_version,2),'versionId',v.id,'versionNumber',v.version_number,'document',doc),'cachePolicy',jsonb_build_object('schemaVersion',1,'freshSeconds',300,'maxStaleSeconds',86400));
exception when others then return private.ecommerce_public_error('ECOMMERCE_PORTAL_NOT_FOUND'); end $$;

revoke all on function public.ecommerce_admin_save_site_draft(text,text,text,text,bigint,jsonb),public.ecommerce_admin_publish_site(text,text,text,text),public.ecommerce_admin_restore_site_version(text,text,text,text,uuid),public.ecommerce_admin_list_site_versions(text,text,text,text,integer,integer),public.ecommerce_get_portal_by_slug(text) from public,anon,authenticated;
grant execute on function public.ecommerce_admin_save_site_draft(text,text,text,text,bigint,jsonb),public.ecommerce_admin_publish_site(text,text,text,text),public.ecommerce_admin_restore_site_version(text,text,text,text,uuid),public.ecommerce_admin_list_site_versions(text,text,text,text,integer,integer),public.ecommerce_get_portal_by_slug(text) to anon,authenticated,service_role;
