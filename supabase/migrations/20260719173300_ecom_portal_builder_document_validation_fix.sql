-- Compensatory fix: explicit grouping avoids JSON operator precedence ambiguity.
create or replace function private.ecommerce_site_document_error(p_document jsonb)
returns text language plpgsql stable security definer set search_path to '' as $$
declare v_section jsonb; v_ids text[]; v_active jsonb := '{}'::jsonb; v_type text; v_props jsonb;
begin
  if p_document is null or jsonb_typeof(p_document) <> 'object' or p_document - array['schemaVersion','global','sections'] <> '{}'::jsonb then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if (p_document->>'schemaVersion') <> '1' then return 'ECOMMERCE_SITE_SCHEMA_UNSUPPORTED'; end if;
  if jsonb_typeof(p_document->'global') <> 'object' or p_document->'global' - array['themeSource','contentWidth','density'] <> '{}'::jsonb or (p_document #>> '{global,themeSource}') <> 'portal' or (p_document #>> '{global,contentWidth}') <> 'standard' or (p_document #>> '{global,density}') not in ('comfortable','compact') then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  if jsonb_typeof(p_document->'sections') <> 'array' or jsonb_array_length(p_document->'sections') > 30 then return 'ECOMMERCE_SITE_DOCUMENT_INVALID'; end if;
  for v_section in select value from jsonb_array_elements(p_document->'sections') loop
    if jsonb_typeof(v_section) <> 'object' or v_section - array['id','type','enabled','layout','props','style'] <> '{}'::jsonb or (v_section->>'id') !~ '^[a-z][a-z0-9-]{2,63}$' or jsonb_typeof(v_section->'enabled') <> 'boolean' or jsonb_typeof(v_section->'props') <> 'object' or (v_section ? 'style' and (jsonb_typeof(v_section->'style') <> 'object' or v_section->'style' <> '{}'::jsonb)) then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    v_type := v_section->>'type'; v_props := v_section->'props'; v_ids := array_append(v_ids, v_section->>'id');
    if (v_type='header' and ((v_section->>'layout') not in ('default','showcase') or v_props <> jsonb_build_object('contentSource','portal')))
      or (v_type='catalog' and ((v_section->>'layout') not in ('grid','compact') or v_props - array['showSearch','showCategories'] <> '{}'::jsonb or jsonb_typeof(v_props->'showSearch') <> 'boolean' or jsonb_typeof(v_props->'showCategories') <> 'boolean'))
      or (v_type='footer' and ((v_section->>'layout') <> 'lanzo' or v_props <> jsonb_build_object('contentSource','lanzo')))
      or v_type not in ('header','catalog','footer') then return 'ECOMMERCE_SITE_SECTION_INVALID'; end if;
    if (v_section->>'enabled')::boolean then v_active := jsonb_set(v_active, array[v_type], to_jsonb(coalesce((v_active->>v_type)::integer,0)+1), true); end if;
  end loop;
  if exists (select 1 from unnest(coalesce(v_ids,'{}')) id group by id having count(*) > 1) then return 'ECOMMERCE_SITE_DUPLICATE_SECTION'; end if;
  if coalesce((v_active->>'header')::integer,0) <> 1 or coalesce((v_active->>'catalog')::integer,0) <> 1 or coalesce((v_active->>'footer')::integer,0) <> 1 then return 'ECOMMERCE_SITE_REQUIRED_SECTION_MISSING'; end if;
  if octet_length(p_document::text) > 65536 then return 'ECOMMERCE_SITE_DOCUMENT_TOO_LARGE'; end if;
  return null;
end;
$$;
revoke all on function private.ecommerce_site_document_error(jsonb) from public, anon, authenticated;
