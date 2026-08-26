-- ADMIN.STAFF.RBAC.R2D CLOSEOUT.R2 server authority contract.
-- Definition/ACL assertions are rollback-safe and do not mutate production data.
begin;

do $test$
declare
  v_context jsonb;
  v_signature text;
  v_definition text;
  v_internal_signatures text[] := array[
    'public.pos_upsert_category_unlimited(text,text,text,text,jsonb,integer,text)',
    'public.pos_delete_category_unlimited(text,text,text,text,text,integer,text)',
    'public.pos_upsert_product_unlimited(text,text,text,text,jsonb,jsonb,integer,text)',
    'public.pos_delete_product_unlimited(text,text,text,text,text,integer,text)',
    'public.pos_toggle_product_status_unlimited(text,text,text,text,text,boolean,integer,text)',
    'public.pos_upsert_product_batch_unlimited(text,text,text,text,jsonb,integer,text)',
    'public.pos_delete_product_batch_unlimited(text,text,text,text,text,integer,text)',
    'public.pos_migrate_local_product_catalog_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text)',
    'public.pos_register_expiration_waste_unlimited(text,text,text,text,text,numeric,text,text,text)',
    'public.pos_create_product_batch_from_parent_stock_unlimited(text,text,text,text,text,timestamp with time zone,numeric,text,text)',
    'public.pos_adjust_product_stock_without_batch_zero_unlimited(text,text,text,text,text,text,text,text)'
  ];
  v_public_rate_signatures text[] := array[
    'public.pos_register_expiration_waste(text,text,text,text,text,numeric,text,text,text)',
    'public.pos_create_product_batch_from_parent_stock(text,text,text,text,text,timestamp with time zone,numeric,text,text)',
    'public.pos_adjust_product_stock_without_batch_zero(text,text,text,text,text,text,text,text)'
  ];
begin
  -- Permission helper matrix: only boolean Staff values grant the matching authority.
  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"products":false,"inventory":true}'::jsonb
  );
  if private.has_product_inventory_permission(v_context, 'products') is true
     or private.has_product_inventory_permission(v_context, 'inventory') is not true then
    raise exception 'R2D_INVENTORY_ONLY_PERMISSION_MATRIX_FAILED';
  end if;

  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"products":true,"inventory":false}'::jsonb
  );
  if private.has_product_inventory_permission(v_context, 'products') is not true
     or private.has_product_inventory_permission(v_context, 'inventory') is true then
    raise exception 'R2D_PRODUCTS_ONLY_PERMISSION_MATRIX_FAILED';
  end if;

  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"products":true,"inventory":true}'::jsonb
  );
  if private.has_product_inventory_permission(v_context, 'products') is not true
     or private.has_product_inventory_permission(v_context, 'inventory') is not true then
    raise exception 'R2D_COMBINED_PERMISSION_MATRIX_FAILED';
  end if;

  v_context := jsonb_build_object(
    'actor_type', 'staff',
    'actor_permissions', '{"products":"true","inventory":1}'::jsonb
  );
  if private.has_product_inventory_permission(v_context, 'products') is true
     or private.has_product_inventory_permission(v_context, 'inventory') is true then
    raise exception 'R2D_MALFORMED_PERMISSION_MATRIX_FAILED';
  end if;

  v_context := jsonb_build_object(
    'actor_type', 'admin',
    'actor_permissions', '{}'::jsonb
  );
  if private.has_product_inventory_permission(v_context, 'products') is not true
     or private.has_product_inventory_permission(v_context, 'inventory') is not true then
    raise exception 'R2D_ADMIN_PERMISSION_MATRIX_FAILED';
  end if;

  foreach v_signature in array v_internal_signatures loop
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if v_definition is null then
      raise exception 'R2D_INTERNAL_FUNCTION_MISSING: %', v_signature;
    end if;
    if position('private.validate_product_inventory_actor' in v_definition) = 0 then
      raise exception 'R2D_INTERNAL_ACTOR_VALIDATION_MISSING: %', v_signature;
    end if;
    if position('private.validate_pos_sync_context' in v_definition) > 0 then
      raise exception 'R2D_INTERNAL_LEGACY_VALIDATION_RETAINED: %', v_signature;
    end if;
    if has_function_privilege('anon', v_signature, 'EXECUTE')
       or has_function_privilege('authenticated', v_signature, 'EXECUTE') then
      raise exception 'R2D_INTERNAL_API_ACL_EXPOSED: %', v_signature;
    end if;
    if not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'R2D_INTERNAL_SERVICE_ROLE_ACL_MISSING: %', v_signature;
    end if;
  end loop;

  foreach v_signature in array v_public_rate_signatures loop
    if not has_function_privilege('anon', v_signature, 'EXECUTE')
       or not has_function_privilege('authenticated', v_signature, 'EXECUTE')
       or not has_function_privilege('service_role', v_signature, 'EXECUTE') then
      raise exception 'R2D_PUBLIC_RATE_LIMIT_WRAPPER_ACL_FAILED: %', v_signature;
    end if;
    select pg_get_functiondef(v_signature::regprocedure) into v_definition;
    if position('enforce_pos_rpc_rate_limit_v2' in v_definition) = 0 then
      raise exception 'R2D_PUBLIC_RATE_LIMIT_REMOVED: %', v_signature;
    end if;
  end loop;

  if has_function_privilege('service_role', 'private.has_product_inventory_permission(jsonb,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.validate_product_inventory_actor(text,text,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.assert_product_actor_authority(jsonb)', 'EXECUTE')
     or has_function_privilege('service_role', 'private.assert_inventory_actor_authority(jsonb)', 'EXECUTE') then
    raise exception 'R2D_PRIVATE_HELPER_ACL_EXPOSED';
  end if;
end;
$test$;

rollback;
