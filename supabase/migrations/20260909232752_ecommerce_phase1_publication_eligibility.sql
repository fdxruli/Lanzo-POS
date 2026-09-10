-- ECOM.PHASE1.PUBLICATION.ELIGIBILITY
-- A published product must always be eligible for the public catalog. The
-- capability decision is kept in one private helper and enforced by RPCs and
-- a table constraint. This migration deliberately touches catalog tables only.

create or replace function private.ecommerce_publication_eligibility(
  p_license_id uuid,
  p_local_product_ref text,
  p_public_configuration_mode text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_types text[];
  v_supports_modifiers boolean := false;
  v_has_source_modifiers boolean := false;
  v_mode text := coalesce(nullif(p_public_configuration_mode, ''), 'compatible');
begin
  if v_mode = 'hidden_incompatible' then
    return jsonb_build_object(
      'eligible', false,
      'code', 'ECOMMERCE_PRODUCT_HIDDEN_INCOMPATIBLE',
      'status', 'hidden_incompatible'
    );
  end if;

  if v_mode = 'requires_review' then
    return jsonb_build_object(
      'eligible', false,
      'code', 'ECOMMERCE_PRODUCT_REQUIRES_REVIEW',
      'status', 'requires_review'
    );
  end if;

  v_types := private.ecommerce_normalized_business_types(p_license_id);
  if coalesce(array_length(v_types, 1), 0) = 0 then
    return jsonb_build_object(
      'eligible', false,
      'code', 'ECOMMERCE_PRODUCT_REQUIRES_REVIEW',
      'status', 'requires_review',
      'reason', 'BUSINESS_TYPE_UNKNOWN'
    );
  end if;

  v_supports_modifiers := private.ecommerce_business_supports_capability(
    p_license_id,
    'restaurant_modifiers'
  );
  select coalesce(
    jsonb_typeof(p.modifiers) = 'array'
    and jsonb_array_length(p.modifiers) > 0,
    false
  ) into v_has_source_modifiers
  from public.pos_products p
  where p.license_id = p_license_id
    and p.id = p_local_product_ref
    and p.deleted_at is null;

  if v_has_source_modifiers and not v_supports_modifiers and v_mode <> 'simple_override' then
    return jsonb_build_object(
      'eligible', false,
      'code', 'ECOMMERCE_PRODUCT_REQUIRES_REVIEW',
      'status', 'requires_review',
      'reason', 'RESTAURANT_MODIFIERS_NOT_SUPPORTED'
    );
  end if;

  return jsonb_build_object(
    'eligible', true,
    'code', null,
    'status', case when v_mode = 'simple_override' then 'simple_override' else 'compatible' end
  );
end;
$function$;

-- The canonical reconciler is also used by background Pro synchronization.
-- If a product ceases to be eligible, it is atomically unpublished in the
-- same row update, so the database invariant is never transiently violated.
create or replace function private.ecommerce_reconcile_published_product_capability(
  p_product_id uuid
)
returns public.ecommerce_published_products
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_product public.ecommerce_published_products%rowtype;
  v_types text[];
  v_has_source_modifiers boolean := false;
  v_supports_modifiers boolean := false;
  v_supports_wholesale boolean := false;
  v_status text;
  v_reason text;
  v_mode text;
  v_wholesale boolean;
  v_is_published boolean;
begin
  select * into v_product
  from public.ecommerce_published_products
  where id = p_product_id and deleted_at is null
  for update;
  if v_product.id is null then return v_product; end if;

  v_types := private.ecommerce_normalized_business_types(v_product.license_id);
  v_supports_modifiers := private.ecommerce_business_supports_capability(
    v_product.license_id, 'restaurant_modifiers');
  v_supports_wholesale := private.ecommerce_business_supports_capability(
    v_product.license_id, 'wholesale_pricing');
  select coalesce(jsonb_typeof(p.modifiers) = 'array'
    and jsonb_array_length(p.modifiers) > 0, false)
  into v_has_source_modifiers
  from public.pos_products p
  where p.license_id = v_product.license_id
    and p.id = v_product.local_product_ref and p.deleted_at is null;

  v_wholesale := v_product.wholesale_enabled and v_supports_wholesale;
  if coalesce(array_length(v_types, 1), 0) = 0 then
    v_status := 'requires_review';
    v_reason := 'BUSINESS_TYPE_UNKNOWN';
    v_mode := case when v_product.public_configuration_mode = 'simple_override'
      then 'simple_override' else 'requires_review' end;
    v_wholesale := false;
  elsif v_has_source_modifiers and not v_supports_modifiers
        and v_product.public_configuration_mode <> 'simple_override' then
    v_status := 'requires_review';
    v_reason := 'RESTAURANT_MODIFIERS_NOT_SUPPORTED';
    v_mode := 'requires_review';
  elsif v_product.public_configuration_mode = 'simple_override' then
    v_status := 'simple_override';
    v_reason := case when v_has_source_modifiers and not v_supports_modifiers
      then 'RESTAURANT_MODIFIERS_NOT_SUPPORTED' end;
    v_mode := 'simple_override';
  else
    v_status := 'compatible';
    v_reason := null;
    v_mode := 'compatible';
  end if;

  v_is_published := v_product.is_published
    and v_status in ('compatible', 'simple_override')
    and v_mode in ('compatible', 'simple_override');

  update public.ecommerce_published_products
  set business_capability_status = v_status,
      business_capability_reason = v_reason,
      public_configuration_mode = v_mode,
      wholesale_enabled = v_wholesale,
      is_published = v_is_published,
      configuration_type = case when v_mode = 'simple_override'
        and not has_variants then 'simple' else configuration_type end,
      has_option_groups = case when v_mode = 'simple_override'
        then false else has_option_groups end,
      requires_configuration = case when v_mode = 'simple_override'
        then has_variants else requires_configuration end
  where id = v_product.id
    and (business_capability_status, business_capability_reason,
         public_configuration_mode, wholesale_enabled, is_published,
         configuration_type, has_option_groups, requires_configuration)
      is distinct from
        (v_status, v_reason, v_mode, v_wholesale, v_is_published,
         case when v_mode = 'simple_override' and not has_variants
           then 'simple' else configuration_type end,
         case when v_mode = 'simple_override' then false else has_option_groups end,
         case when v_mode = 'simple_override' then has_variants
           else requires_configuration end);

  if v_mode in ('simple_override','requires_review','hidden_incompatible') then
    update public.ecommerce_published_option_groups
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
    update public.ecommerce_published_options
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  if not v_wholesale then
    update public.ecommerce_published_wholesale_tiers
    set deleted_at = now(), updated_at = now()
    where published_product_id = v_product.id and deleted_at is null;
  end if;
  select * into v_product from public.ecommerce_published_products
  where id = p_product_id;
  return v_product;
end;
$function$;

create or replace function public.ecommerce_admin_set_product_published(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_product_id uuid,
  p_is_published boolean
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_auth jsonb;
  v_license_id uuid;
  v_product public.ecommerce_published_products%rowtype;
  v_eligibility jsonb;
begin
  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_set_product_published'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  if private.ecommerce_lock_configuration_writer(v_license_id, p_product_id) is null then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND');
  end if;
  select * into v_product from public.ecommerce_published_products
  where id = p_product_id and license_id = v_license_id and deleted_at is null
  for update;
  if v_product.id is null then return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_NOT_FOUND'); end if;

  if coalesce(p_is_published, false) then
    v_eligibility := private.ecommerce_publication_eligibility(
      v_license_id, v_product.local_product_ref, v_product.public_configuration_mode
    );
    if coalesce((v_eligibility->>'eligible')::boolean, false) is not true then
      return private.ecommerce_admin_error(
        coalesce(v_eligibility->>'code', 'ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE')
      );
    end if;
  end if;

  update public.ecommerce_published_products pp
  set is_published = coalesce(p_is_published, false)
  where pp.id = p_product_id and pp.license_id = v_license_id and pp.deleted_at is null
  returning * into v_product;

  return jsonb_build_object(
    'success', true,
    'message', case when v_product.is_published then 'Producto publicado.' else 'Producto retirado del portal.' end,
    'product', private.ecommerce_admin_product_jsonb(v_product)
  );
exception when others then
  if sqlerrm like '%ECOMMERCE_PRODUCT_LIMIT_REACHED%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_LIMIT_REACHED');
  end if;
  if sqlerrm like '%ecommerce_published_products_publication_eligible%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE');
  end if;
  return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_STATUS_FAILED');
end;
$function$;

-- Preserve the legacy RPC signature while routing it through the same
-- eligibility check. Older clients therefore cannot recreate invisible rows.
create or replace function public.ecommerce_admin_set_product_published(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_product_id uuid,
  p_is_published boolean
)
returns jsonb
language sql
security definer
set search_path to ''
as $function$
  select public.ecommerce_admin_set_product_published(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    null::text,
    p_product_id,
    p_is_published
  );
$function$;

create or replace function public.ecommerce_admin_upsert_published_product_v3(
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
  v_auth jsonb;
  v_license_id uuid;
  v_result jsonb;
  v_product_id uuid;
  v_portal_id uuid;
  v_revision bigint;
  v_mode text;
  v_product public.ecommerce_published_products%rowtype;
  v_eligibility jsonb;
begin
  if jsonb_typeof(p_payload) <> 'object' then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_INVALID_PAYLOAD');
  end if;
  v_mode := coalesce(nullif(p_payload->>'publicConfigurationMode',''),'compatible');
  if v_mode not in ('compatible','requires_review','simple_override','hidden_incompatible')
     or jsonb_typeof(coalesce(p_payload->'wholesaleTiers','[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_payload->'wholesaleTiers','[]'::jsonb)) > 50 then
    return private.ecommerce_admin_error('ECOMMERCE_ADMIN_INVALID_PAYLOAD');
  end if;

  v_auth := private.ecommerce_admin_authorize_v2(
    p_license_key := p_license_key,
    p_device_fingerprint := p_device_fingerprint,
    p_security_token := p_security_token,
    p_staff_session_token := p_staff_session_token,
    p_rpc_name := 'ecommerce_admin_upsert_published_product'
  );
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_license_id := (v_auth->>'license_id')::uuid;

  if coalesce((p_payload->>'isPublished')::boolean, false) then
    v_eligibility := private.ecommerce_publication_eligibility(
      v_license_id, nullif(p_payload->>'localProductRef', ''), v_mode
    );
    if coalesce((v_eligibility->>'eligible')::boolean, false) is not true then
      return private.ecommerce_admin_error(
        coalesce(v_eligibility->>'code', 'ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE')
      );
    end if;
  end if;

  perform set_config(
    'app.ecommerce_simple_override_reconcile',
    case when v_mode = 'simple_override' then 'true' else 'false' end,
    true
  );
  v_result := public.ecommerce_admin_upsert_published_product_v2(
    p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,
    p_payload - array['businessCapabilityStatus','businessCapabilityReason',
      'publicConfigurationMode','wholesaleEnabled','wholesaleTiers','wholesaleWarnings']
  );
  if coalesce((v_result->>'success')::boolean,false) is not true then return v_result; end if;
  v_product_id := (v_result#>>'{product,id}')::uuid;
  select * into v_product from public.ecommerce_published_products
  where id = v_product_id and license_id = v_license_id and deleted_at is null
  for update;
  if v_product.id is null then raise exception 'ECOMMERCE_PRODUCT_NOT_FOUND'; end if;
  if v_product.is_published then
    v_eligibility := private.ecommerce_publication_eligibility(
      v_license_id, v_product.local_product_ref, v_mode
    );
    if coalesce((v_eligibility->>'eligible')::boolean, false) is not true then
      raise exception '%', coalesce(v_eligibility->>'code', 'ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE');
    end if;
  end if;
  update public.ecommerce_published_products
  set public_configuration_mode = v_mode
  where id = v_product_id and public_configuration_mode is distinct from v_mode;
  perform private.ecommerce_apply_wholesale_tiers(v_product_id,
    coalesce((p_payload->>'wholesaleEnabled')::boolean,false),
    coalesce(p_payload->'wholesaleTiers','[]'::jsonb));
  perform private.ecommerce_reconcile_published_product_capability(v_product_id);
  select portal_id into v_portal_id from public.ecommerce_published_products where id=v_product_id;
  select catalog_revision into v_revision from public.ecommerce_portals where id=v_portal_id;
  return jsonb_set(v_result || jsonb_build_object(
    'product',private.ecommerce_admin_product_jsonb(
      (select p from public.ecommerce_published_products p where p.id=v_product_id)
    )), '{catalogRevision}', to_jsonb(v_revision), true);
exception when others then
  if sqlerrm like '%ECOMMERCE_PRODUCT_REQUIRES_REVIEW%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_REQUIRES_REVIEW');
  end if;
  if sqlerrm like '%ECOMMERCE_PRODUCT_HIDDEN_INCOMPATIBLE%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_HIDDEN_INCOMPATIBLE');
  end if;
  if sqlerrm like '%ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE%' then
    return private.ecommerce_admin_error('ECOMMERCE_PRODUCT_PUBLICATION_INELIGIBLE');
  end if;
  if sqlerrm like '%ECOMMERCE_WHOLESALE_INVALID_PAYLOAD%' then
    return private.ecommerce_admin_error('ECOMMERCE_WHOLESALE_INVALID_PAYLOAD');
  end if;
  return private.ecommerce_admin_error('ECOMMERCE_ADMIN_SAVE_FAILED');
end;
$function$;

-- Legacy public writers are retained as compatibility aliases, but all now
-- pass through v3. v2 remains an internal implementation called only by the
-- SECURITY DEFINER v3 writer; exposing it would bypass the publication rule.
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

-- Historical rows in a review/incompatible state were the source of the
-- invisible Free catalogs. This is idempotent: a second execution finds no
-- matching published rows. The existing catalog-revision trigger invalidates
-- public cache pages for every affected portal.
update public.ecommerce_published_products
set is_published = false
where deleted_at is null
  and is_published is true
  and (
    business_capability_status in ('requires_review', 'hidden_incompatible')
    or public_configuration_mode in ('requires_review', 'hidden_incompatible')
  );

do $block$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'ecommerce_published_products_publication_eligible'
      and conrelid = 'public.ecommerce_published_products'::regclass
  ) then
    alter table public.ecommerce_published_products
      add constraint ecommerce_published_products_publication_eligible
      check (
        is_published is not true
        or (
          business_capability_status in ('compatible', 'simple_override')
          and public_configuration_mode in ('compatible', 'simple_override')
        )
      ) not valid;
  end if;
end;
$block$;

alter table public.ecommerce_published_products
  validate constraint ecommerce_published_products_publication_eligible;

alter function private.ecommerce_publication_eligibility(uuid, text, text) owner to postgres;
alter function private.ecommerce_reconcile_published_product_capability(uuid) owner to postgres;
alter function public.ecommerce_admin_set_product_published(text, text, text, uuid, boolean) owner to postgres;
alter function public.ecommerce_admin_set_product_published(text, text, text, text, uuid, boolean) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product(text, text, text, jsonb) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product(text, text, text, text, jsonb) owner to postgres;
alter function public.ecommerce_admin_upsert_published_product_v3(text, text, text, text, jsonb) owner to postgres;

revoke all on function private.ecommerce_publication_eligibility(uuid, text, text)
  from public, anon, authenticated;
grant execute on function private.ecommerce_publication_eligibility(uuid, text, text)
  to service_role;

revoke all on function private.ecommerce_reconcile_published_product_capability(uuid)
  from public, anon, authenticated;
grant execute on function private.ecommerce_reconcile_published_product_capability(uuid)
  to service_role;

revoke all on function public.ecommerce_admin_upsert_published_product_v2(text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.ecommerce_admin_sync_published_catalog_v2(text, text, text, text, jsonb, text, bigint)
  from public, anon, authenticated;
