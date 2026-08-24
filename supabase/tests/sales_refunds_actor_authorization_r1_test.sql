-- ADMIN.STAFF.SECTION.ISOLATION.R1 -- transactional sales/refunds authorization.
-- Every fixture, cancellation, audit row and rate-limit row is rolled back.
begin;

do $test$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_license_id uuid := extensions.gen_random_uuid();
  v_other_license_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_other_device_id uuid := extensions.gen_random_uuid();
  v_cross_device_id uuid := extensions.gen_random_uuid();
  v_admin_id uuid := extensions.gen_random_uuid();
  v_reports_staff_id uuid := extensions.gen_random_uuid();
  v_refunds_staff_id uuid := extensions.gen_random_uuid();
  v_global_staff_id uuid := extensions.gen_random_uuid();
  v_cross_staff_id uuid;
  v_license_key text := 'SALES-R1-' || v_suffix;
  v_other_license_key text := 'SALES-X-' || v_suffix;
  v_fingerprint text := 'sales-device-' || v_suffix;
  v_other_fingerprint text := 'sales-other-device-' || v_suffix;
  v_cross_fingerprint text := 'sales-cross-device-' || v_suffix;
  v_device_token text := 'sales-device-token-' || v_suffix;
  v_other_device_token text := 'sales-other-device-token-' || v_suffix;
  v_cross_device_security text := 'sales-cross-device-security-' || v_suffix;
  v_admin_token text := 'sales-admin-token-' || v_suffix;
  v_reports_token text := 'sales-reports-token-' || v_suffix;
  v_refunds_token text := 'sales-refunds-token-' || v_suffix;
  v_global_token text := 'sales-global-token-' || v_suffix;
  v_revoked_token text := 'sales-revoked-token-' || v_suffix;
  v_cross_license_token text := 'sales-cross-license-token-' || v_suffix;
  v_cross_device_token text := 'sales-cross-device-token-' || v_suffix;
  v_own_sale_id text := 'sale-own-' || v_suffix;
  v_execute_sale_id text := 'sale-execute-' || v_suffix;
  v_other_sale_id text := 'sale-other-' || v_suffix;
  v_result jsonb;
  v_definition text;
  v_status text;
begin
  -- Catalog and ACL contract: rate-limited public wrappers stay public API;
  -- internal and renamed legacy bodies cannot be called by client roles.
  if to_regprocedure('public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)') is null
     or to_regprocedure('public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)') is null
     or to_regprocedure('public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)') is null
     or to_regprocedure('public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)') is null then
    raise exception 'SALES_R1_SIGNATURE_CONTRACT_FAILED';
  end if;

  if has_function_privilege('public', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('anon', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('public', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('anon', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.pos_preview_cloud_sale_cancellation_legacy_r1(text,text,text,text,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.pos_cancel_cloud_sale_apply_fase6e_legacy_r1(text,text,text,text,text,text,text)', 'execute') then
    raise exception 'SALES_R1_ACL_CONTRACT_FAILED';
  end if;

  select pg_get_functiondef('public.pos_preview_cloud_sale_cancellation(text,text,text,text,text,text)'::regprocedure)
  into v_definition;
  if position('enforce_pos_rpc_rate_limit_v2' in v_definition) = 0
     or position('pos_preview_cloud_sale_cancellation_unlimited' in v_definition) = 0 then
    raise exception 'SALES_R1_PREVIEW_RATE_WRAPPER_FAILED';
  end if;
  select pg_get_functiondef('public.pos_cancel_cloud_sale(text,text,text,text,text,text,text)'::regprocedure)
  into v_definition;
  if position('enforce_pos_rpc_rate_limit_v2' in v_definition) = 0
     or position('pos_cancel_cloud_sale_unlimited' in v_definition) = 0 then
    raise exception 'SALES_R1_CANCEL_RATE_WRAPPER_FAILED';
  end if;
  select pg_get_functiondef('public.pos_preview_cloud_sale_cancellation_unlimited(text,text,text,text,text,text)'::regprocedure)
  into v_definition;
  if position('SECURITY DEFINER' in v_definition) = 0
     or position('SET search_path TO ''''' in v_definition) = 0
     or position('private.has_pos_permission(v_context, ''refunds'')' in v_definition) = 0 then
    raise exception 'SALES_R1_PREVIEW_DEFINITION_FAILED';
  end if;
  select pg_get_functiondef('public.pos_cancel_cloud_sale_apply_fase6e(text,text,text,text,text,text,text)'::regprocedure)
  into v_definition;
  if position('SECURITY DEFINER' in v_definition) = 0
     or position('SET search_path TO ''''' in v_definition) = 0
     or position('private.assert_pos_permission(v_context, ''refunds'')' in v_definition) = 0 then
    raise exception 'SALES_R1_CANCEL_DEFINITION_FAILED';
  end if;

  insert into public.licenses (
    id, license_key, license_type, max_devices, status, product_name, features
  ) values
  (
    v_license_id, v_license_key, 'pro', 10, 'active', 'SALES R1 TEST',
    jsonb_build_object(
      'staff_roles', true,
      'cloud_pos_sync', true,
      'cloud_sales_sync_base', true,
      'cloud_cash_sync', true,
      'cloud_sales_cashier', true,
      'cloud_sales_cancellations', true
    )
  ),
  (
    v_other_license_id, v_other_license_key, 'pro', 10, 'active', 'SALES R1 CROSS TEST',
    jsonb_build_object(
      'staff_roles', true,
      'cloud_pos_sync', true,
      'cloud_sales_sync_base', true,
      'cloud_cash_sync', true,
      'cloud_sales_cashier', true,
      'cloud_sales_cancellations', true
    )
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info,
    is_active, security_token, device_role, device_mode
  ) values
  (
    v_device_id, v_license_id, v_fingerprint, 'Sales device', '{}'::jsonb,
    true, v_device_token, 'admin', 'shared'
  ),
  (
    v_other_device_id, v_other_license_id, v_other_fingerprint, 'Other sales device', '{}'::jsonb,
    true, v_other_device_token, 'admin', 'shared'
  ),
  (
    v_cross_device_id, v_license_id, v_cross_fingerprint, 'Cross sales device', '{}'::jsonb,
    true, v_cross_device_security, 'admin', 'shared'
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_admin_id, v_license_id, 'sales-owner-' || left(v_suffix, 8), 'Sales Owner',
    extensions.crypt('sales-pass-1', extensions.gen_salt('bf', 4)), true, true
  );
  insert into public.license_admin_sessions (
    license_id, admin_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_license_id, v_admin_id, v_device_id,
    extensions.crypt(v_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values
  (
    v_reports_staff_id, v_license_id, 'reports-' || left(v_suffix, 8), 'Reports Staff',
    extensions.crypt('sales-pass-2', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('pos', true, 'reports', true, 'refunds', false), true
  ),
  (
    v_refunds_staff_id, v_license_id, 'refunds-' || left(v_suffix, 8), 'Refunds Staff',
    extensions.crypt('sales-pass-3', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('pos', true, 'reports', false, 'refunds', true), true
  ),
  (
    v_global_staff_id, v_license_id, 'global-' || left(v_suffix, 8), 'Global Refunds Staff',
    extensions.crypt('sales-pass-4', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('pos', true, 'refunds', true, 'sales_cancellations_global', true), true
  );

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at, revoked_at
  ) values
  (
    v_license_id, v_reports_staff_id, v_device_id,
    extensions.crypt(v_reports_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null
  ),
  (
    v_license_id, v_refunds_staff_id, v_device_id,
    extensions.crypt(v_refunds_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null
  ),
  (
    v_license_id, v_global_staff_id, v_device_id,
    extensions.crypt(v_global_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null
  ),
  (
    v_license_id, v_refunds_staff_id, v_device_id,
    extensions.crypt(v_revoked_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', now()
  ),
  (
    v_license_id, v_refunds_staff_id, v_cross_device_id,
    extensions.crypt(v_cross_device_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour', null
  );

  insert into public.license_staff_users (
    license_id, username, display_name, password_hash, role_name, permissions, is_active
  ) values (
    v_other_license_id, 'cross-' || left(v_suffix, 8), 'Cross License Staff',
    extensions.crypt('sales-pass-5', extensions.gen_salt('bf', 4)), 'staff',
    jsonb_build_object('pos', true, 'refunds', true), true
  ) returning id into v_cross_staff_id;
  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at
  ) values (
    v_other_license_id, v_cross_staff_id, v_other_device_id,
    extensions.crypt(v_cross_license_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'
  );

  insert into public.pos_sales (
    id, license_id, device_id, staff_user_id, device_role, actor_key, actor_name,
    origin, source_mode, effects_status, status, subtotal, total, amount_paid
  ) values
  (
    v_own_sale_id, v_license_id, v_device_id, v_refunds_staff_id, 'staff',
    'staff:' || v_refunds_staff_id::text, 'Refunds Staff',
    'cloud', 'cloud_committed', 'cloud_applied', 'closed', 0, 0, 0
  ),
  (
    v_execute_sale_id, v_license_id, v_device_id, v_refunds_staff_id, 'staff',
    'staff:' || v_refunds_staff_id::text, 'Refunds Staff',
    'cloud', 'cloud_committed', 'cloud_applied', 'closed', 0, 0, 0
  ),
  (
    v_other_sale_id, v_license_id, v_device_id, v_reports_staff_id, 'staff',
    'staff:' || v_reports_staff_id::text, 'Reports Staff',
    'cloud', 'cloud_committed', 'cloud_applied', 'closed', 0, 0, 0
  );

  -- reports=true remains read-only and cannot preview or execute a refund.
  v_result := public.pos_preview_cloud_sale_cancellation(
    v_license_key, v_fingerprint, v_device_token, v_reports_token,
    v_other_sale_id, 'R1 reports-only preview'
  );
  if v_result->>'code' is distinct from 'POS_PERMISSION_DENIED:refunds'
     or coalesce((v_result->>'can_cancel')::boolean, true) is not false then
    raise exception 'SALES_R1_REPORTS_ONLY_PREVIEW_NOT_DENIED:%', v_result;
  end if;

  v_result := public.pos_cancel_cloud_sale(
    v_license_key, v_fingerprint, v_device_token, v_reports_token,
    v_other_sale_id, 'R1 reports-only cancel', 'r1-reports-' || v_suffix
  );
  if v_result->>'code' is distinct from 'POS_PERMISSION_DENIED:refunds' then
    raise exception 'SALES_R1_REPORTS_ONLY_CANCEL_NOT_DENIED:%', v_result;
  end if;

  -- refunds=true may reach the unchanged state/financial preview without
  -- gaining report reads.
  v_result := public.pos_preview_cloud_sale_cancellation(
    v_license_key, v_fingerprint, v_device_token, v_refunds_token,
    v_own_sale_id, 'R1 refunds preview'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'can_cancel')::boolean, false) is not true then
    raise exception 'SALES_R1_REFUNDS_PREVIEW_NOT_ALLOWED:%', v_result;
  end if;

  v_result := public.pos_preview_cloud_sale_cancellation(
    v_license_key, v_fingerprint, v_device_token, v_admin_token,
    v_other_sale_id, 'R1 Admin preview'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'can_cancel')::boolean, false) is not true then
    raise exception 'SALES_R1_ADMIN_PREVIEW_NOT_ALLOWED:%', v_result;
  end if;

  -- Ownership remains additive. `reports` is no longer accepted as global
  -- cancellation authority; the existing explicit global key still is.
  v_result := public.pos_preview_cloud_sale_cancellation(
    v_license_key, v_fingerprint, v_device_token, v_refunds_token,
    v_other_sale_id, 'R1 wrong owner'
  );
  if v_result->>'code' is distinct from 'SALE_CANCELLATION_FORBIDDEN' then
    raise exception 'SALES_R1_WRONG_OWNER_NOT_DENIED:%', v_result;
  end if;

  v_result := public.pos_preview_cloud_sale_cancellation(
    v_license_key, v_fingerprint, v_device_token, v_global_token,
    v_other_sale_id, 'R1 global owner override'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'can_cancel')::boolean, false) is not true then
    raise exception 'SALES_R1_GLOBAL_OWNER_OVERRIDE_FAILED:%', v_result;
  end if;

  -- A valid refunds actor can execute; all legacy state and financial checks
  -- still run behind the new gate.
  v_result := public.pos_cancel_cloud_sale(
    v_license_key, v_fingerprint, v_device_token, v_refunds_token,
    v_execute_sale_id, 'R1 authorized cancel', 'r1-refunds-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'SALES_R1_REFUNDS_CANCEL_NOT_ALLOWED:%', v_result;
  end if;
  select status into v_status
  from public.pos_sales
  where license_id = v_license_id and id = v_execute_sale_id;
  if v_status is distinct from 'cancelled' then
    raise exception 'SALES_R1_REFUNDS_CANCEL_DID_NOT_MUTATE:%', v_status;
  end if;

  -- Missing, revoked, cross-license and cross-device actor evidence all fail
  -- before sale data can be read or mutated.
  begin
    perform public.pos_preview_cloud_sale_cancellation(
      v_license_key, v_fingerprint, v_device_token, null,
      v_own_sale_id, 'R1 missing actor'
    );
    raise exception 'SALES_R1_MISSING_ACTOR_NOT_DENIED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'ACTOR_SESSION_REQUIRED' then raise; end if;
  end;

  begin
    perform public.pos_preview_cloud_sale_cancellation(
      v_license_key, v_fingerprint, v_device_token, v_revoked_token,
      v_own_sale_id, 'R1 revoked actor'
    );
    raise exception 'SALES_R1_REVOKED_ACTOR_NOT_DENIED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'ACTOR_SESSION_INVALID' then raise; end if;
  end;

  begin
    perform public.pos_preview_cloud_sale_cancellation(
      v_license_key, v_fingerprint, v_device_token, v_cross_license_token,
      v_own_sale_id, 'R1 cross license'
    );
    raise exception 'SALES_R1_CROSS_LICENSE_NOT_DENIED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'ACTOR_SESSION_INVALID' then raise; end if;
  end;

  begin
    perform public.pos_preview_cloud_sale_cancellation(
      v_license_key, v_fingerprint, v_device_token, v_cross_device_token,
      v_own_sale_id, 'R1 cross device'
    );
    raise exception 'SALES_R1_CROSS_DEVICE_NOT_DENIED';
  exception
    when sqlstate 'P0001' then
      if sqlerrm is distinct from 'ACTOR_SESSION_INVALID' then raise; end if;
  end;
end;
$test$;

rollback;
