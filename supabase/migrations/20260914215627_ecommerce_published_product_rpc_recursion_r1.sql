-- ECOMMERCE PUBLISHED PRODUCT RPC RECURSION HOTFIX R1
--
-- The Phase 1 aliases intentionally route both legacy writers through v3 so
-- that legacy clients cannot bypass publication eligibility.  v2 must
-- therefore never call either legacy overload; the persistence implementation
-- lives in this private core instead.

create or replace function private.ecommerce_admin_upsert_published_product_core(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_features jsonb;
  v_portal_id uuid;
  v_existing public.ecommerce_published_products%rowtype;
  v_saved public.ecommerce_published_products%rowtype;
  v_id uuid;
  v_source_type text;
  v_local_ref text;
  v_cloud_ref text;
  v_name text;
  v_price numeric(12,2);
  v_is_published boolean;
  v_manual_available boolean;
  v_stock_mode text;
  v_sync_config jsonb;
  v_cloud_catalog boolean;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_upsert_published_product'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;

  v_license_id := (v_auth->>'license_id')::uuid;
  v_features := coalesce(v_auth->'features', '{}'::jsonb);
  v_cloud_catalog := coalesce((v_features->>'ecommerce_cloud_catalog_source')::boolean, false);

  -- Writer lock protocol: portal -> published product -> configuration
  -- children.  The configuration helper acquires the same parent locks
  -- before touching variants/options, so all product writers serialize in the
  -- same order.
  select p.id into v_portal_id
  from public.ecommerce_portals p
  where p.license_id = v_license_id and p.deleted_at is null
  limit 1 for update;
  if v_portal_id is null then
    return private.ecommerce_admin_error('ECOMMERCE_PORTAL_NOT_FOUND');
  end if;

  if nullif(btrim(coalesce(p_payload->>'id', '')), '') is not null then
    begin
      v_id := (p_payload->>'id')::uuid;
    exception when others then
      return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND');
    end;
    select pp.* into v_existing
    from public.ecommerce_published_products pp
    where pp.id = v_id and pp.portal_id = v_portal_id and pp.deleted_at is null
    limit 1 for update;
    if v_existing.id is null then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND'); end if;
  end if;

  v_source_type := lower(btrim(coalesce(p_payload->>'sourceType', coalesce(v_existing.source_type, 'local_snapshot'))));
  if v_source_type not in ('local_snapshot', 'cloud_product') then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_SOURCE_INVALID', 'La fuente del producto no es valida.');
  end if;
  if v_source_type = 'cloud_product' and v_cloud_catalog is false then
    return private.ecommerce_admin_error('ECOMMERCE_CLOUD_CATALOG_REQUIRES_PRO');
  end if;

  v_local_ref := nullif(btrim(coalesce(p_payload->>'localProductRef', coalesce(v_existing.local_product_ref, ''))), '');
  v_cloud_ref := nullif(btrim(coalesce(p_payload->>'productId', coalesce(v_existing.product_id, ''))), '');
  if v_local_ref is null then return private.ecommerce_admin_error('ECOMMERCE_LOCAL_PRODUCT_REF_REQUIRED'); end if;

  if v_existing.id is null then
    select pp.* into v_existing
    from public.ecommerce_published_products pp
    where pp.portal_id = v_portal_id
      and pp.deleted_at is null
      and pp.local_product_ref = v_local_ref
    limit 1 for update;
  end if;

  v_name := btrim(coalesce(p_payload->>'publicName', coalesce(v_existing.public_name, '')));
  if v_name = '' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NAME_REQUIRED'); end if;

  begin
    v_price := coalesce(nullif(p_payload->>'price', '')::numeric, v_existing.price, 0);
  exception when others then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PRICE_INVALID');
  end;
  if v_price < 0 then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PRICE_INVALID'); end if;

  v_is_published := coalesce((p_payload->>'isPublished')::boolean, coalesce(v_existing.is_published, true));
  v_manual_available := coalesce(
    (p_payload->>'manualAvailable')::boolean,
    (p_payload->>'isAvailable')::boolean,
    v_existing.manual_available,
    true
  );
  v_stock_mode := lower(btrim(coalesce(p_payload->>'stockMode', coalesce(v_existing.stock_mode, 'hidden'))));
  if coalesce((v_features->>'ecommerce_stock_visibility')::boolean, false) is false then
    v_stock_mode := 'hidden';
  elsif v_stock_mode not in ('hidden', 'status', 'exact') then
    v_stock_mode := 'hidden';
  end if;

  if v_cloud_catalog then
    v_sync_config := private.ecommerce_normalize_sync_config(
      p_payload->'syncConfig',
      coalesce(v_existing.sync_config, jsonb_build_object(
        'name', 'source', 'description', 'source', 'category', 'source', 'price', 'source', 'image', 'source'
      ))
    );
  else
    v_sync_config := private.ecommerce_normalize_sync_config('{}'::jsonb, null);
  end if;

  if v_existing.id is null then
    insert into public.ecommerce_published_products (
      portal_id, license_id, source_type, product_id, local_product_ref,
      public_name, public_description, category_name, price, currency,
      image_url, is_published, is_available, manual_available, source_available,
      display_order, track_stock, stock_mode, sync_config, source_state,
      sync_status, metadata
    ) values (
      v_portal_id, v_license_id, v_source_type, v_cloud_ref, v_local_ref,
      v_name, nullif(btrim(p_payload->>'publicDescription'), ''),
      nullif(btrim(p_payload->>'categoryName'), ''), v_price, 'MXN',
      nullif(btrim(p_payload->>'imageUrl'), ''), v_is_published,
      v_manual_available, v_manual_available, true,
      greatest(coalesce(nullif(p_payload->>'displayOrder', '')::integer, 0), 0),
      v_stock_mode <> 'hidden', v_stock_mode, v_sync_config,
      case when v_cloud_catalog then 'unverified' else 'manual' end,
      case when v_cloud_catalog and v_sync_config @> '{"name":"source"}'::jsonb then 'pending' else 'manual' end,
      coalesce(p_payload->'metadata', '{}'::jsonb)
        || jsonb_build_object('source', 'admin_ui', 'phase', 'ECOM.FE.CATALOG.3')
    ) returning * into v_saved;
  else
    update public.ecommerce_published_products pp
    set source_type = v_source_type,
        product_id = v_cloud_ref,
        local_product_ref = v_local_ref,
        public_name = v_name,
        public_description = nullif(btrim(p_payload->>'publicDescription'), ''),
        category_name = nullif(btrim(p_payload->>'categoryName'), ''),
        price = v_price,
        image_url = case
          when p_payload ? 'imageUrl' then nullif(btrim(p_payload->>'imageUrl'), '')
          else pp.image_url
        end,
        is_published = v_is_published,
        manual_available = v_manual_available,
        is_available = v_manual_available and pp.source_available,
        display_order = greatest(coalesce(nullif(p_payload->>'displayOrder', '')::integer, pp.display_order), 0),
        track_stock = v_stock_mode <> 'hidden',
        stock_mode = v_stock_mode,
        sync_config = v_sync_config,
        sync_status = case
          when v_cloud_catalog and v_sync_config <> pp.sync_config then 'pending'
          when v_cloud_catalog then pp.sync_status
          else 'manual'
        end,
        metadata = coalesce(pp.metadata, '{}'::jsonb)
          || coalesce(p_payload->'metadata', '{}'::jsonb)
          || jsonb_build_object('last_admin_source', 'admin_ui')
    where pp.id = v_existing.id
    returning * into v_saved;
  end if;

  return jsonb_build_object(
    'success', true,
    'message', case when v_existing.id is null then 'Producto publicado correctamente.' else 'Producto actualizado correctamente.' end,
    'product', private.ecommerce_admin_product_jsonb(v_saved)
  );
exception
  when others then
    if sqlerrm like '%ECOMMERCE_PRODUCT_LIMIT_REACHED%' then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_LIMIT_REACHED'); end if;
    if sqlerrm like '%ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO%' then return private.ecommerce_admin_error('ECOMMERCE_STOCK_VISIBILITY_REQUIRES_PRO'); end if;
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_SAVE_FAILED');
end;
$function$;

create or replace function public.ecommerce_admin_upsert_published_product_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_base_payload jsonb;
  v_base_result jsonb;
  v_configuration_result jsonb;
  v_product_id uuid;
  v_license_id uuid;
begin
  if p_payload is null
     or jsonb_typeof(p_payload) <> 'object'
     or jsonb_typeof(p_payload->'configuration') <> 'object'
     or (p_payload ? 'configurationSourceRevision'
         and jsonb_typeof(p_payload->'configurationSourceRevision') not in ('string','null')) then
    return private.ecommerce_admin_error('ECOMMERCE_CONFIGURATION_INVALID','La configuracion del producto no es valida.');
  end if;

  v_base_payload := p_payload-array['configuration','configurationSourceRevision'];
  v_base_result := private.ecommerce_admin_upsert_published_product_core(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,v_base_payload
  );
  if coalesce((v_base_result->>'success')::boolean,false) is false then return v_base_result; end if;

  v_product_id := nullif(v_base_result#>>'{product,id}','')::uuid;
  select p.license_id into v_license_id
  from public.ecommerce_published_products p
  where p.id=v_product_id and p.deleted_at is null;
  if v_license_id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;

  v_configuration_result := private.ecommerce_apply_product_configuration_checked(
    v_license_id,v_product_id,p_payload->'configuration',p_payload->>'configurationSourceRevision',false
  );

  return v_base_result || jsonb_build_object(
    'product',v_configuration_result->'product',
    'configuration',v_configuration_result->'configuration'
  );
exception
  when others then return private.ecommerce_configuration_error_from_message(sqlerrm);
end;
$function$;

-- Legacy overloads remain public compatibility aliases.  They intentionally
-- route through v3 so old clients receive the same eligibility enforcement as
-- the modern writer.
create or replace function public.ecommerce_admin_upsert_published_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.ecommerce_admin_upsert_published_product_v3(
    p_license_key, p_device_fingerprint, p_security_token, null::text, p_payload
  );
$function$;

create or replace function public.ecommerce_admin_upsert_published_product(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.ecommerce_admin_upsert_published_product_v3(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_payload
  );
$function$;

alter function private.ecommerce_admin_upsert_published_product_core(
  text, text, text, text, jsonb
) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product_v2(
  text, text, text, text, jsonb
) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product(
  text, text, text, jsonb
) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) owner to postgres;

-- The core is an implementation detail, never a PostgREST endpoint.  v2 is
-- retained as an internal service-role callable compatibility boundary for v3.
revoke all on function private.ecommerce_admin_upsert_published_product_core(
  text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.ecommerce_admin_upsert_published_product_v2(
  text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product_v2(
  text, text, text, text, jsonb
) to service_role;

revoke all on function public.ecommerce_admin_upsert_published_product(
  text, text, text, jsonb
) from public;
grant execute on function public.ecommerce_admin_upsert_published_product(
  text, text, text, jsonb
) to anon, authenticated, service_role;
revoke all on function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) from public;
grant execute on function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) to anon, authenticated, service_role;

comment on function private.ecommerce_admin_upsert_published_product_core(
  text, text, text, text, jsonb
) is
  'Private canonical published-product persistence core. Called by v2 only; never calls a public writer.';
