begin;

-- Contract checks run without creating, deleting, or mutating production data.
do $$
declare
  v_current_definition text;
  v_legacy_definition text;
begin
  select pg_get_functiondef(
    'public.ecommerce_admin_upsert_portal(text,text,text,text,jsonb)'::regprocedure
  ) into v_current_definition;
  select pg_get_functiondef(
    'public.ecommerce_admin_upsert_portal(text,text,text,jsonb)'::regprocedure
  ) into v_legacy_definition;

  if lower(v_current_definition) !~ 'p_payload[[:space:]]*\\?[[:space:]]*''logourl'''
    or lower(v_current_definition) !~ 'p_payload[[:space:]]*\\?[[:space:]]*''coverimageurl''' then
    raise exception 'image intent contract regression: omitted properties must remain distinguishable from JSON null';
  end if;
  if lower(v_current_definition) !~ 'slug_source[[:space:]]*=[[:space:]]*case[[:space:]]+when[[:space:]]+v_custom_slug_allowed' then
    raise exception 'slug_source update regression';
  end if;
  if position('public.ecommerce_admin_upsert_portal' in v_legacy_definition) = 0 then
    raise exception 'legacy upsert overload no longer delegates to canonical implementation';
  end if;

  if private.ecommerce_portal_normalize_image_url('"https://cdn.example/logo.png"'::jsonb)
    <> 'https://cdn.example/logo.png' then
    raise exception 'HTTPS image normalization regression';
  end if;
  if private.ecommerce_portal_normalize_image_url('null'::jsonb) is not null then
    raise exception 'explicit JSON null must remain an unlink request';
  end if;
  begin perform private.ecommerce_portal_normalize_image_url('"javascript:alert(1)"'::jsonb); raise exception 'expected javascript URL rejection'; exception when others then if sqlerrm not like '%ECOMMERCE_IMAGE_URL_INVALID%' then raise; end if; end;
  begin perform private.ecommerce_portal_normalize_image_url('"data:image/png;base64,x"'::jsonb); raise exception 'expected data URL rejection'; exception when others then if sqlerrm not like '%ECOMMERCE_IMAGE_URL_INVALID%' then raise; end if; end;
  begin perform private.ecommerce_portal_normalize_image_url('"blob:https://app.example/x"'::jsonb); raise exception 'expected blob URL rejection'; exception when others then if sqlerrm not like '%ECOMMERCE_IMAGE_URL_INVALID%' then raise; end if; end;

  if not has_function_privilege('anon', 'public.ecommerce_admin_upsert_portal(text,text,text,text,jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.ecommerce_admin_upsert_portal(text,text,text,jsonb)', 'EXECUTE') then
    raise exception 'administrative RPC grants regression';
  end if;
  if has_table_privilege('anon', 'public.ecommerce_portals', 'UPDATE')
    or has_table_privilege('authenticated', 'public.ecommerce_portals', 'UPDATE') then
    raise exception 'direct ecommerce_portals write grant regression';
  end if;
end;
$$;

rollback;
