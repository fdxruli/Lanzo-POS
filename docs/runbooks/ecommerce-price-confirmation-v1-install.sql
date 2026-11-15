-- PREPARED ONLY. Do not execute before separate explicit owner authorization.
-- Target project: odlrhijtfyavryeqivaa
-- Migration version: 20261114231943
-- Canonical migration SHA-256: 6f19aec959a796dfb922902c929a680c01e2792e57767039f09b8a97c01e6f34
-- The SQL body below omits only the migration's outer BEGIN/COMMIT.
-- Its exact canonical source is stored as the single statements[] ledger entry.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '25s';
SET LOCAL transaction_timeout = '60s';
SET LOCAL application_name = 'lanzo_ecom_price_confirmation_v1_install';
SET LOCAL search_path = '';

DO $install_preflight$
DECLARE
  v_target_count integer;
BEGIN
  IF current_setting('server_version_num')::integer NOT BETWEEN 170000 AND 179999
     OR current_database() <> 'postgres'
     OR current_user <> 'postgres'
     OR current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'EPR_INSTALL_IDENTITY_OR_VERSION_MISMATCH';
  END IF;
  SELECT count(*) INTO v_target_count
  FROM supabase_migrations.schema_migrations
  WHERE version = '20261114231943';
  IF v_target_count <> 0 THEN
    RAISE EXCEPTION 'EPR_INSTALL_TARGET_VERSION_ALREADY_RECORDED: %', v_target_count;
  END IF;
  IF to_regprocedure('public.ecommerce_create_order(text,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('private.ecommerce_public_error(text)') IS NULL
     OR to_regprocedure('extensions.digest(bytea,text)') IS NULL THEN
    RAISE EXCEPTION 'EPR_INSTALL_REQUIRED_FUNCTION_OR_DIGEST_MISSING';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto' AND n.nspname = 'extensions'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ecommerce_orders'
      AND column_name = 'metadata'
      AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'EPR_INSTALL_REQUIRED_DEPENDENCY_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure
      AND md5(p.prosrc) = 'ed11bdd80c3a3ffaba58c2582fdf60f0'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
      AND p.proacl::text[] IS NOT DISTINCT FROM ARRAY[
        'postgres=X/postgres','service_role=X/postgres','anon=X/postgres','authenticated=X/postgres'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'EPR_INSTALL_CREATE_ORDER_PREFLIGHT_MISMATCH';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
    WHERE p.oid = 'private.ecommerce_public_error(text)'::regprocedure
      AND md5(p.prosrc) = '0c68e50ab545d4b7911d7ad69977309c'
      AND pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
      AND p.proacl::text[] IS NOT DISTINCT FROM ARRAY[
        'postgres=X/postgres','service_role=X/postgres'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'EPR_INSTALL_PUBLIC_ERROR_PREFLIGHT_MISMATCH';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_stat_activity
    WHERE pid <> pg_backend_pid()
      AND datname = current_database()
      AND state = 'active'
      AND (query ILIKE '%public.ecommerce_create_order%'
           OR query ILIKE '%schema_migrations%')
  ) THEN
    RAISE EXCEPTION 'EPR_INSTALL_RELATED_SESSION_ACTIVE';
  END IF;
END;
$install_preflight$;


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
    || ' or not (v_accepted_pricing?&array[''pricingMode'',''baseUnitPrice'',''appliedUnitPrice'',''variantAdjustment'',''optionsAdjustment'',''lineTotal'']::text[]) then return private.ecommerce_public_error(''ECOMMERCE_PRICE_CONFIRMATION_CHANGED'');end if;'
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


DO $install_postflight$
DECLARE
  v_create_source text;
  v_create_owner text;
  v_create_config text[];
  v_create_acl text[];
  v_create_security_definer boolean;
  v_error_source text;
  v_error_owner text;
  v_error_config text[];
  v_error_acl text[];
  v_error_security_definer boolean;
  v_replay_guard_count integer;
BEGIN
  SELECT p.prosrc, pg_get_userbyid(p.proowner), p.proconfig, p.proacl::text[], p.prosecdef
    INTO v_create_source, v_create_owner, v_create_config, v_create_acl, v_create_security_definer
  FROM pg_proc p
  WHERE p.oid = 'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure;
  IF v_create_source IS NULL
     OR v_create_owner <> 'postgres'
     OR v_create_config IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_create_acl IS DISTINCT FROM ARRAY[
       'postgres=X/postgres','service_role=X/postgres','anon=X/postgres','authenticated=X/postgres'
     ]::text[]
     OR v_create_security_definer IS NOT TRUE
     OR md5(v_create_source) = 'ed11bdd80c3a3ffaba58c2582fdf60f0'
     OR position('acceptedPricing' IN v_create_source) = 0
     OR position('priceAcceptanceHash' IN v_create_source) = 0
     OR position('v_acceptance_hash:=encode(extensions.digest' IN v_create_source) = 0
     OR position('ECOMMERCE_CATALOG_REVISION_CHANGED' IN v_create_source) = 0
     OR position('ECOMMERCE_IDEMPOTENCY_CONFLICT' IN v_create_source) = 0
     OR position('v_current_pricing' IN v_create_source) = 0 THEN
    RAISE EXCEPTION 'EPR_INSTALL_CREATE_ORDER_POSTCHECK_FAILED';
  END IF;
  v_replay_guard_count :=
    (length(v_create_source) - length(replace(v_create_source, 'v_existing_acceptance_hash:=nullif', '')))
    / length('v_existing_acceptance_hash:=nullif');
  IF v_replay_guard_count <> 2 THEN
    RAISE EXCEPTION 'EPR_INSTALL_IDEMPOTENCY_POSTCHECK_FAILED: %', v_replay_guard_count;
  END IF;

  SELECT p.prosrc, pg_get_userbyid(p.proowner), p.proconfig, p.proacl::text[], p.prosecdef
    INTO v_error_source, v_error_owner, v_error_config, v_error_acl, v_error_security_definer
  FROM pg_proc p
  WHERE p.oid = 'private.ecommerce_public_error(text)'::regprocedure;
  IF v_error_source IS NULL
     OR v_error_owner <> 'postgres'
     OR v_error_config IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_error_acl IS DISTINCT FROM ARRAY['postgres=X/postgres','service_role=X/postgres']::text[]
     OR v_error_security_definer IS NOT TRUE
     OR position('ECOMMERCE_PRICE_CONFIRMATION_CHANGED' IN v_error_source) = 0 THEN
    RAISE EXCEPTION 'EPR_INSTALL_PUBLIC_ERROR_POSTCHECK_FAILED';
  END IF;
  IF EXISTS (
    SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version = '20261114231943'
  ) THEN
    RAISE EXCEPTION 'EPR_INSTALL_LEDGER_PREINSERT_CHECK_FAILED';
  END IF;
END;
$install_postflight$;

INSERT INTO supabase_migrations.schema_migrations (version, statements, name)
VALUES (
  '20261114231943',
  ARRAY[$lanzo_migration_source_20261114231943$-- ECOMMERCE_PRICE_CONFIRMATION_V1
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
    || ' or not (v_accepted_pricing?&array[''pricingMode'',''baseUnitPrice'',''appliedUnitPrice'',''variantAdjustment'',''optionsAdjustment'',''lineTotal'']::text[]) then return private.ecommerce_public_error(''ECOMMERCE_PRICE_CONFIRMATION_CHANGED'');end if;'
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
$lanzo_migration_source_20261114231943$]::text[],
  'ecommerce_price_confirmation_v1'
);

DO $install_ledger_postflight$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '20261114231943') <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM supabase_migrations.schema_migrations
       WHERE version = '20261114231943'
         AND name = 'ecommerce_price_confirmation_v1'
         AND statements = ARRAY[$lanzo_migration_source_20261114231943$-- ECOMMERCE_PRICE_CONFIRMATION_V1
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
    || ' or not (v_accepted_pricing?&array[''pricingMode'',''baseUnitPrice'',''appliedUnitPrice'',''variantAdjustment'',''optionsAdjustment'',''lineTotal'']::text[]) then return private.ecommerce_public_error(''ECOMMERCE_PRICE_CONFIRMATION_CHANGED'');end if;'
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
$lanzo_migration_source_20261114231943$]::text[]
     ) THEN
    RAISE EXCEPTION 'EPR_INSTALL_LEDGER_POSTCHECK_FAILED';
  END IF;
END;
$install_ledger_postflight$;

COMMIT;
