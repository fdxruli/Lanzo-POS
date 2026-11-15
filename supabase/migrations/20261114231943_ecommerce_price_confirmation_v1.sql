-- ECOMMERCE_PRICE_CONFIRMATION_V1
-- Keeps the public RPC signature stable. The client sends only the price snapshot
-- it accepted; the database still calculates every amount from published rows.
-- This patch intentionally fails closed if Production's inspected function body
-- has changed since the read-only preflight.

begin;

do $patch_price_confirmation$
declare
  v_function_oid oid := 'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure;
  v_definition text;
  v_source_hash text;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_security_definer boolean;
  v_fragment text;
  v_replacement text;
begin
  select p.prosrc, p.proowner, p.proacl, p.proconfig, p.prosecdef
  into v_definition, v_owner, v_acl, v_config, v_security_definer
  from pg_proc p
  where p.oid = v_function_oid;

  if v_definition is null then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_CREATE_FUNCTION_MISSING';
  end if;

  v_source_hash := md5(v_definition);
  if v_source_hash <> 'ed11bdd80c3a3ffaba58c2582fdf60f0' then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_SOURCE_MISMATCH: %', v_source_hash;
  end if;
  if v_security_definer is not true
     or v_config is distinct from array['search_path=""']::text[]
     or pg_get_userbyid(v_owner) <> 'postgres' then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_SECURITY_PREFLIGHT_FAILED';
  end if;

  select pg_get_functiondef(v_function_oid) into v_definition;

  v_fragment := 'v_wholesale_min_quantity integer;';
  if position(v_fragment in v_definition) = 0 then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_DECLARATION_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_fragment,
    v_fragment || E'\n  v_acceptance_hash text;\n  v_existing_acceptance_hash text;\n  v_accepted_pricing jsonb;\n  v_current_pricing jsonb;\n  v_accepted_line_total numeric(12,2);');

  v_fragment := 'if v_idempotency_key='''' then return private.ecommerce_public_error(''ECOMMERCE_IDEMPOTENCY_KEY_REQUIRED'');end if;';
  if position(v_fragment in v_definition) = 0 then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_REQUEST_HASH_ANCHOR_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_fragment, v_fragment ||
    'if p_items is null or jsonb_typeof(p_items)<>''array'' then return private.ecommerce_public_error(''ECOMMERCE_EMPTY_CART'');end if;'
    || 'v_acceptance_hash:=encode(extensions.digest(jsonb_build_object(''customer'',coalesce(p_customer,''null''::jsonb),''items'',coalesce((select jsonb_agg(e.item order by e.item::text) from jsonb_array_elements(p_items)as e(item)),''[]''::jsonb))::text,''sha256''),''hex'');');

  v_fragment := 'if v_existing_order.id is not null then return jsonb_build_object(''success'',true,''idempotent'',true,';
  if position(v_fragment in v_definition) = 0 then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_REPLAY_ANCHOR_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_fragment,
    'if v_existing_order.id is not null then v_existing_acceptance_hash:=nullif(v_existing_order.metadata->>''priceAcceptanceHash'','''');'
    || 'if v_existing_acceptance_hash is null or v_existing_acceptance_hash<>v_acceptance_hash then return private.ecommerce_public_error(''ECOMMERCE_IDEMPOTENCY_CONFLICT'');end if;'
    || 'return jsonb_build_object(''success'',true,''idempotent'',true,');

  v_fragment := '''total'',''subtotal'')then return private.ecommerce_public_error(''ECOMMERCE_CONFIGURATION_INVALID'');end if;';
  if position(v_fragment in v_definition) = 0 then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_ITEM_ALLOWLIST_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_fragment,
    '''total'',''subtotal'',''acceptedPricing'')then return private.ecommerce_public_error(''ECOMMERCE_CONFIGURATION_INVALID'');end if;');

  v_fragment := 'v_line_total:=round(v_final_unit_price*v_quantity,2);';
  if position(v_fragment in v_definition) = 0 then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_PRICE_CHECK_ANCHOR_MISMATCH';
  end if;
  v_replacement := v_fragment ||
    'if jsonb_typeof(v_item->''acceptedPricing'') is distinct from ''object'' then return private.ecommerce_public_error(''ECOMMERCE_CATALOG_REVISION_CHANGED'');end if;'
    || 'v_accepted_pricing:=v_item->''acceptedPricing'';'
    || 'if (v_accepted_pricing-array[''pricingMode'',''baseUnitPrice'',''wholesaleBaseUnitPrice'',''appliedUnitPrice'',''wholesaleTierRef'',''wholesaleMinQuantity'',''variantAdjustment'',''optionsAdjustment'',''lineTotal'']::text[])<>''{}''::jsonb'
    || 'or not (v_accepted_pricing?&array[''pricingMode'',''baseUnitPrice'',''appliedUnitPrice'',''variantAdjustment'',''optionsAdjustment'',''lineTotal'']::text[]) then return private.ecommerce_public_error(''ECOMMERCE_PRICE_CONFIRMATION_CHANGED'');end if;'
    || 'v_current_pricing:=v_snapshot->''pricing'';'
    || 'begin v_accepted_line_total:=(v_accepted_pricing->>''lineTotal'')::numeric(12,2);'
    || 'if jsonb_strip_nulls(jsonb_build_object(''pricingMode'',v_accepted_pricing->>''pricingMode'',''baseUnitPrice'',(v_accepted_pricing->>''baseUnitPrice'')::numeric(12,2),''wholesaleBaseUnitPrice'',(v_accepted_pricing->>''wholesaleBaseUnitPrice'')::numeric(12,2),''appliedUnitPrice'',(v_accepted_pricing->>''appliedUnitPrice'')::numeric(12,2),''wholesaleTierRef'',v_accepted_pricing->>''wholesaleTierRef'',''wholesaleMinQuantity'',(v_accepted_pricing->>''wholesaleMinQuantity'')::integer,''variantAdjustment'',(v_accepted_pricing->>''variantAdjustment'')::numeric(12,2),''optionsAdjustment'',(v_accepted_pricing->>''optionsAdjustment'')::numeric(12,2))) is distinct from v_current_pricing or v_accepted_line_total is distinct from v_line_total then return private.ecommerce_public_error(''ECOMMERCE_PRICE_CONFIRMATION_CHANGED'');end if;'
    || 'exception when others then return private.ecommerce_public_error(''ECOMMERCE_PRICE_CONFIRMATION_CHANGED'');end;';
  v_definition := replace(v_definition, v_fragment, v_replacement);

  v_fragment := 'jsonb_build_object(''source'',''public_store'',''configurationSnapshotVersion'',1)';
  if position(v_fragment in v_definition) = 0 then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_METADATA_ANCHOR_MISMATCH';
  end if;
  v_definition := replace(v_definition, v_fragment,
    'jsonb_build_object(''source'',''public_store'',''configurationSnapshotVersion'',1,''priceAcceptanceHash'',v_acceptance_hash)');

  execute v_definition;

  if not exists (
    select 1 from pg_proc p
    where p.oid = v_function_oid
      and p.proowner = v_owner
      and p.proacl is not distinct from v_acl
      and p.proconfig is not distinct from v_config
      and p.prosecdef is true
  ) then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_SECURITY_POSTCHECK_FAILED';
  end if;
end;
$patch_price_confirmation$;

do $patch_public_error$
declare
  v_function_oid oid := 'private.ecommerce_public_error(text)'::regprocedure;
  v_definition text;
  v_fragment text := $before$
when 'ECOMMERCE_CONFIGURATION_CHANGED' then 'La configuracion del producto cambio. Vuelve a seleccionarla.'$before$;
  v_replacement text := $after$
when 'ECOMMERCE_PRICE_CONFIRMATION_CHANGED' then 'El precio del pedido cambio. Actualiza el carrito y acepta el nuevo total.'
when 'ECOMMERCE_CONFIGURATION_CHANGED' then 'La configuracion del producto cambio. Vuelve a seleccionarla.'$after$;
  v_owner oid;
  v_acl aclitem[];
  v_config text[];
  v_security_definer boolean;
  v_source_hash text;
begin
  select p.prosrc, p.proowner, p.proacl, p.proconfig, p.prosecdef, pg_get_functiondef(p.oid)
  into v_source_hash, v_owner, v_acl, v_config, v_security_definer, v_definition
  from pg_proc p
  where p.oid = v_function_oid;
  if v_definition is null
     or md5(v_source_hash) <> '0c68e50ab545d4b7911d7ad69977309c'
     or position(v_fragment in v_definition) = 0
     or v_security_definer is not true
     or v_config is distinct from array['search_path=""']::text[]
     or pg_get_userbyid(v_owner) <> 'postgres' then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_PUBLIC_ERROR_PREFLIGHT_FAILED';
  end if;
  v_definition := replace(v_definition, v_fragment, v_replacement);
  execute v_definition;
  if not exists (
    select 1 from pg_proc p
    where p.oid = v_function_oid
      and p.proowner = v_owner
      and p.proacl is not distinct from v_acl
      and p.proconfig is not distinct from v_config
      and p.prosecdef is not distinct from v_security_definer
  ) then
    raise exception 'ECOMMERCE_PRICE_CONFIRMATION_V1_PUBLIC_ERROR_SECURITY_POSTCHECK_FAILED';
  end if;
end;
$patch_public_error$;

commit;
