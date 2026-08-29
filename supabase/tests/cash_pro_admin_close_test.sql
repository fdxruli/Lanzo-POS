-- CASH PRO FASE 2-4 regression matrix. Fixtures are synthetic and rolled back.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_other_license_id uuid := extensions.gen_random_uuid();
  v_admin_device uuid := extensions.gen_random_uuid();
  v_other_admin_device uuid := extensions.gen_random_uuid();
  v_staff_device uuid := extensions.gen_random_uuid();
  v_other_license_device uuid := extensions.gen_random_uuid();
  v_admin_user uuid := extensions.gen_random_uuid();
  v_other_admin_user uuid := extensions.gen_random_uuid();
  v_staff_user uuid := extensions.gen_random_uuid();
  v_admin_session_id uuid := extensions.gen_random_uuid();
  v_second_admin_session_id uuid := extensions.gen_random_uuid();
  v_other_admin_session_id uuid := extensions.gen_random_uuid();
  v_admin_key text := 'TEST-CASH-ADMIN-' || v_suffix;
  v_other_key text := 'TEST-CASH-OTHER-' || v_suffix;
  v_fingerprint text := 'cash-admin-' || v_suffix;
  v_second_fingerprint text := 'cash-admin-second-' || v_suffix;
  v_other_fingerprint text := 'cash-other-license-' || v_suffix;
  v_device_token text := 'cash-device-' || v_suffix;
  v_second_device_token text := 'cash-second-device-' || v_suffix;
  v_other_device_token text := 'cash-other-device-' || v_suffix;
  v_admin_token text := 'cash-admin-session-' || v_suffix;
  v_second_admin_token text := 'cash-second-admin-session-' || v_suffix;
  v_other_admin_token text := 'cash-other-admin-session-' || v_suffix;
  v_staff_token text := 'cash-staff-session-' || v_suffix;
  v_result jsonb;
  v_event_payload jsonb;
  v_count integer;
  v_version integer;
  v_sales_before integer;
  v_movements_before integer;
  v_audits_before integer;
  v_sync_before integer;
  v_station_id text := 'cash-station-' || v_suffix;
begin
  insert into public.licenses(id, license_key, license_type, status, expires_at, max_devices, product_name, features, plan_id)
  values
    (v_license_id, v_admin_key, 'pro', 'active', now() + interval '1 day', 6, 'Cash admin fixture', '{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true}'::jsonb, (select id from public.plans where code='pro_monthly' limit 1)),
    (v_other_license_id, v_other_key, 'pro', 'active', now() + interval '1 day', 2, 'Other cash fixture', '{"cloud_pos_sync":true,"cloud_cash_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true}'::jsonb, (select id from public.plans where code='pro_monthly' limit 1));
  insert into public.license_admin_users(id, license_id, username, display_name, password_hash, is_owner, is_active)
  values
    (v_admin_user, v_license_id, 'owner_' || substr(v_suffix,1,6), 'Cash owner', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)), true, true),
    (v_other_admin_user, v_other_license_id, 'other_' || substr(v_suffix,1,6), 'Other owner', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)), true, true);
  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values (v_staff_user, v_license_id, 'staff_' || substr(v_suffix,1,6), 'Cash staff', extensions.crypt('password-' || v_suffix, extensions.gen_salt('bf', 4)), '{"cash_register":true,"cash_audit":true}'::jsonb);
  insert into public.license_devices(id, license_id, device_fingerprint, device_name, security_token, is_active, device_role, staff_user_id)
  values
    (v_admin_device, v_license_id, v_fingerprint, 'Chrome admin', v_device_token, true, 'admin', null),
    (v_other_admin_device, v_license_id, v_second_fingerprint, 'Edge admin', v_second_device_token, true, 'admin', null),
    (v_staff_device, v_license_id, 'cash-staff-' || v_suffix, 'Chrome staff', 'staff-device-' || v_suffix, true, 'staff', v_staff_user),
    (v_other_license_device, v_other_license_id, v_other_fingerprint, 'Other tenant', v_other_device_token, true, 'admin', null);
  insert into public.license_admin_sessions(id, license_id, admin_user_id, device_id, session_token_hash, expires_at)
  values
    (v_admin_session_id, v_license_id, v_admin_user, v_admin_device, extensions.crypt(v_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_second_admin_session_id, v_license_id, v_admin_user, v_other_admin_device, extensions.crypt(v_second_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour'),
    (v_other_admin_session_id, v_other_license_id, v_other_admin_user, v_other_license_device, extensions.crypt(v_other_admin_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour');
  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values (v_license_id, v_staff_user, v_staff_device, extensions.crypt(v_staff_token, extensions.gen_salt('bf', 4)), now() + interval '1 hour');

  insert into public.pos_products(
    id, license_id, name, name_key, price, cost, stock, committed_stock,
    track_stock, is_active, product_type, sale_type, batch_management,
    expiration_mode, server_version
  ) values
    ('cash-sale-30-' || v_suffix, v_license_id, 'Venta de prueba', 'cash-sale-30-' || v_suffix, 30, 10, 0, 0, false, true, 'sellable', 'unit', '{"enabled":false}'::jsonb, 'NONE', 1),
    ('cash-sale-5-' || v_suffix, v_license_id, 'Venta bloqueada', 'cash-sale-5-' || v_suffix, 5, 2, 0, 0, false, true, 'sellable', 'unit', '{"enabled":false}'::jsonb, 'NONE', 1);
  insert into public.pos_cash_stations(id, license_id, station_key, status, binding_mode)
  values
    (v_station_id, v_license_id, 'cash-station-key-' || v_suffix, 'active', 'explicit'),
    ('cash-station-recalc-drift-' || v_suffix, v_license_id, 'cash-station-recalc-drift-key-' || v_suffix, 'active', 'explicit'),
    ('cash-station-recalc-unverified-' || v_suffix, v_license_id, 'cash-station-recalc-unverified-key-' || v_suffix, 'active', 'explicit'),
    ('cash-station-stale-' || v_suffix, v_license_id, 'cash-station-stale-key-' || v_suffix, 'active', 'explicit'),
    ('cash-station-normal-' || v_suffix, v_license_id, 'cash-station-normal-key-' || v_suffix, 'active', 'explicit');
  insert into public.pos_cash_station_bindings(license_id, cash_station_id, device_id, binding_mode, status)
  values
    (v_license_id, v_station_id, v_admin_device, 'explicit', 'active'),
    (v_license_id, 'cash-station-stale-' || v_suffix, v_other_admin_device, 'explicit', 'active');

  -- Admin may close another admin and a staff session in its own tenant, never another tenant.
  insert into public.pos_cash_sessions(id, license_id, device_id, staff_user_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version)
  values
    ('cash-admin-audited-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:' || v_other_admin_device, 'open', 1196, 1196, 'Other admin', 1),
    ('cash-staff-unverified-' || v_suffix, v_license_id, v_staff_device, v_staff_user, 'staff', 'staff:' || v_staff_user, 'open', 1196, 1196, 'Staff cash', 1),
    ('cash-recalc-drift-' || v_suffix, v_license_id, v_admin_device, null, 'admin', 'admin_device:recalc-drift-' || v_suffix, 'open', 1196, 1196, 'Recalculation drift cash', 1),
    ('cash-recalc-unverified-' || v_suffix, v_license_id, v_admin_device, null, 'admin', 'admin_device:recalc-unverified-' || v_suffix, 'open', 1196, 1196, 'Unverified recalculation drift cash', 1),
    ('cash-stale-' || v_suffix, v_license_id, v_admin_device, null, 'admin', 'admin_device:stale-' || v_suffix, 'open', 10, 10, 'Stale cash', 1),
    ('cash-zero-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:zero-' || v_suffix, 'open', 0, 0, 'Zero counted cash', 1),
    ('cash-next-fund-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:next-fund-' || v_suffix, 'open', 1196, 1196, 'Next shift fund cash', 1),
    ('cash-legacy-adopt-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:legacy-adopt-' || v_suffix, 'open', 1185, 1196, 'Legacy to adopt', 1),
    ('cash-legacy-unselected-' || v_suffix, v_license_id, v_other_admin_device, null, 'admin', 'admin_device:legacy-unselected-' || v_suffix, 'open', 77, 77, 'Legacy left untouched', 1),
    ('cash-other-tenant-' || v_suffix, v_other_license_id, v_other_license_device, null, 'admin', 'admin_device:other-' || v_suffix, 'open', 5, 5, 'Other tenant', 1);
  update public.pos_cash_sessions
  set cash_station_id = case id
    when 'cash-legacy-adopt-' || v_suffix then v_station_id
    when 'cash-recalc-drift-' || v_suffix then 'cash-station-recalc-drift-' || v_suffix
    when 'cash-recalc-unverified-' || v_suffix then 'cash-station-recalc-unverified-' || v_suffix
    when 'cash-stale-' || v_suffix then 'cash-station-stale-' || v_suffix
    else null
  end
  where license_id = v_license_id
    and id in (
      'cash-legacy-adopt-' || v_suffix,
      'cash-recalc-drift-' || v_suffix,
      'cash-recalc-unverified-' || v_suffix,
      'cash-stale-' || v_suffix
    );

  -- Historical financial rows are fixtures only: adoption may change identity, never amounts or these rows.
  insert into public.pos_sales(id, license_id, local_sale_id, device_id, device_role, actor_key, actor_name, cash_session_id, total, amount_paid, idempotency_key)
  values ('sale-legacy-history-' || v_suffix, v_license_id, 'sale-legacy-history-' || v_suffix, v_other_admin_device, 'admin', 'admin_device:legacy-adopt-' || v_suffix, 'Legacy admin', 'cash-legacy-adopt-' || v_suffix, 30, 30, 'sale-legacy-history-' || v_suffix);
  insert into public.pos_cash_movements(id, license_id, cash_session_id, device_id, actor_key, type, amount, concept, source, created_by_device_id, actor_name, idempotency_key, metadata)
  values ('mov-legacy-history-' || v_suffix, v_license_id, 'cash-legacy-adopt-' || v_suffix, v_other_admin_device, 'admin_device:legacy-adopt-' || v_suffix, 'entrada', 11, 'Movimiento historico legacy', 'manual', v_other_admin_device, 'Legacy admin', 'mov-legacy-history-' || v_suffix, '{}'::jsonb);

  -- Fase 3: real legacy adoption is identity_adopt, never a direct test UPDATE.
  select count(*) into v_sales_before from public.pos_sales where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix;
  select count(*) into v_movements_before from public.pos_cash_movements where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix;
  select count(*) into v_audits_before from public.pos_cash_audit_events where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix;
  select count(*) into v_sync_before from public.pos_sync_events where license_id=v_license_id and entity_type='cash_session' and entity_id='cash-legacy-adopt-' || v_suffix and operation='identity_adopt';
  v_result := public.pos_admin_adopt_legacy_cash_session(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-legacy-adopt-' || v_suffix, 1, 'cash-identity-adopt-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,id}' <> 'cash-legacy-adopt-' || v_suffix
     or v_result#>>'{cash_session,admin_user_id}' <> v_admin_user::text
     or v_result#>>'{cash_session,actor_key}' <> 'admin:' || v_admin_user::text then
    raise exception 'LEGACY_IDENTITY_ADOPT_FAILED: %', v_result;
  end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-legacy-adopt-' || v_suffix and status='open' and admin_user_id=v_admin_user and actor_key='admin:' || v_admin_user::text and opening_amount=1185 and expected_cash_total=1196 and server_version=2) then
    raise exception 'LEGACY_IDENTITY_ADOPT_CANONICAL_STATE_FAILED';
  end if;
  if (select count(*) from public.pos_sales where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> v_sales_before
     or (select coalesce(sum(total), 0) from public.pos_sales where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> 30
     or (select count(*) from public.pos_cash_movements where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> v_movements_before
     or (select coalesce(sum(amount), 0) from public.pos_cash_movements where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> 11 then
    raise exception 'LEGACY_IDENTITY_ADOPT_CHANGED_FINANCIAL_HISTORY';
  end if;
  if (select count(*) from public.pos_cash_audit_events where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix and event_type='ADMIN_CASH_IDENTITY_ADOPTED') <> v_audits_before + 1
     or (select count(*) from public.pos_sync_events where license_id=v_license_id and entity_type='cash_session' and entity_id='cash-legacy-adopt-' || v_suffix and operation='identity_adopt') <> v_sync_before + 1 then
    raise exception 'LEGACY_IDENTITY_ADOPT_AUDIT_OR_SYNC_FAILED';
  end if;
  v_result := public.pos_admin_adopt_legacy_cash_session(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-legacy-adopt-' || v_suffix, 1, 'cash-identity-adopt-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.pos_cash_sessions where license_id=v_license_id and admin_user_id=v_admin_user and status='open' and deleted_at is null) <> 1
     or (select count(*) from public.pos_sales where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> v_sales_before
     or (select count(*) from public.pos_cash_movements where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> v_movements_before
     or (select count(*) from public.pos_cash_audit_events where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix and event_type='ADMIN_CASH_IDENTITY_ADOPTED') <> v_audits_before + 1
     or (select count(*) from public.pos_sync_events where license_id=v_license_id and entity_type='cash_session' and entity_id='cash-legacy-adopt-' || v_suffix and operation='identity_adopt') <> v_sync_before + 1 then
    raise exception 'LEGACY_IDENTITY_ADOPT_IDEMPOTENCY_FAILED: %', v_result;
  end if;
  begin
    perform public.pos_admin_adopt_legacy_cash_session(v_other_key, v_other_fingerprint, v_other_device_token, v_other_admin_token, 'cash-legacy-adopt-' || v_suffix, 2, 'cash-identity-cross-tenant-' || v_suffix);
    raise exception 'LEGACY_IDENTITY_ADOPT_CROSS_TENANT_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if; end;
  begin
    perform public.pos_admin_adopt_legacy_cash_session(v_admin_key, 'cash-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_token, 'cash-legacy-unselected-' || v_suffix, 1, 'cash-identity-staff-' || v_suffix);
    raise exception 'LEGACY_IDENTITY_ADOPT_STAFF_ACCEPTED';
  exception when others then if sqlerrm not in ('ADMIN_SESSION_REQUIRED', 'ACTOR_SESSION_REQUIRED') then raise; end if; end;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-legacy-unselected-' || v_suffix and admin_user_id is null and actor_key='admin_device:legacy-unselected-' || v_suffix and status='open' and server_version=1) then
    raise exception 'LEGACY_IDENTITY_ADOPT_UNSELECTED_CHANGED';
  end if;

  -- Each authenticated admin device resolves only the canonical session at its
  -- own station; the administrative list still exposes open sessions globally.
  v_result := public.pos_get_current_cash_session(v_admin_key, v_fingerprint, v_device_token, v_admin_token);
  if coalesce((v_result->>'success')::boolean, false) is not true or v_result#>>'{cash_session,id}' <> 'cash-legacy-adopt-' || v_suffix or v_result->>'actor_key' <> 'admin:' || v_admin_user::text then
    raise exception 'LEGACY_IDENTITY_ADOPT_DEVICE_A_RESOLUTION_FAILED: %', v_result;
  end if;
  v_result := public.pos_get_current_cash_session(v_admin_key, v_second_fingerprint, v_second_device_token, v_second_admin_token);
  if coalesce((v_result->>'success')::boolean, false) is not true or v_result#>>'{cash_session,id}' is not null or v_result->>'cash_station_id' <> 'cash-station-stale-' || v_suffix or v_result->>'actor_key' <> 'admin:' || v_admin_user::text
     or (select count(*) from public.pos_cash_sessions where license_id=v_license_id and admin_user_id=v_admin_user and status='open' and deleted_at is null) <> 1 then
    raise exception 'LEGACY_IDENTITY_ADOPT_STATION_SCOPING_FAILED: %', v_result;
  end if;

  -- Sale then close: the actual cashier-sale RPC locks and updates the same cash session before the close snapshot.
  v_result := public.pos_create_cloud_sale_cashier(
    v_admin_key, v_fingerprint, v_device_token, v_admin_token,
    jsonb_build_object('id', 'sale-before-close-' || v_suffix, 'local_sale_id', 'sale-before-close-' || v_suffix, 'total', 30, 'subtotal', 30, 'amount_paid', 30, 'payment_method', 'cash'),
    jsonb_build_array(jsonb_build_object('id', 'sale-before-close-item-' || v_suffix, 'product_id', 'cash-sale-30-' || v_suffix, 'product_name', 'Venta de prueba', 'quantity', 1, 'unit_price', 30, 'line_subtotal', 30, 'line_total', 30)),
    jsonb_build_array(jsonb_build_object('id', 'sale-before-close-payment-' || v_suffix, 'method', 'cash', 'amount', 30, 'received_amount', 30, 'change_amount', 0)),
    'cash-legacy-adopt-' || v_suffix, 'sale-before-close-idem-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{sale,cash_session_id}' <> 'cash-legacy-adopt-' || v_suffix
     or v_result#>>'{cash_session,expected_cash_total}' <> '1226.00'
     or v_result#>>'{cash_movement,amount}' <> '30.00' then
    raise exception 'SALE_BEFORE_CLOSE_EXPECTED_CASH_FAILED: %', v_result;
  end if;
  select server_version into v_version from public.pos_cash_sessions where id='cash-legacy-adopt-' || v_suffix;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-legacy-adopt-' || v_suffix, 'admin_audited', 1226, 0, 'operational_error', 'Cierre posterior a venta de efectivo.', v_version, 'cash-close-after-sale-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result#>>'{cash_session,expected_cash_total}')::numeric <> 1226
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'SALE_BEFORE_CLOSE_RECONCILIATION_FAILED: %', v_result;
  end if;

  -- Close then sale: the same cashier-sale RPC must reject a closed session and create no financial rows.
  select count(*) into v_sales_before from public.pos_sales where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix;
  select count(*) into v_movements_before from public.pos_cash_movements where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix;
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_admin_key, v_fingerprint, v_device_token, v_admin_token,
      jsonb_build_object('id', 'sale-after-close-' || v_suffix, 'local_sale_id', 'sale-after-close-' || v_suffix, 'total', 5, 'subtotal', 5, 'amount_paid', 5, 'payment_method', 'cash'),
      jsonb_build_array(jsonb_build_object('id', 'sale-after-close-item-' || v_suffix, 'product_id', 'cash-sale-5-' || v_suffix, 'product_name', 'Venta bloqueada', 'quantity', 1, 'unit_price', 5, 'line_subtotal', 5, 'line_total', 5)),
      jsonb_build_array(jsonb_build_object('id', 'sale-after-close-payment-' || v_suffix, 'method', 'cash', 'amount', 5, 'received_amount', 5, 'change_amount', 0)),
      'cash-legacy-adopt-' || v_suffix, 'sale-after-close-idem-' || v_suffix
    );
    raise exception 'SALE_AFTER_CLOSE_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_OPEN' then raise; end if; end;
  if (select count(*) from public.pos_sales where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> v_sales_before
     or (select count(*) from public.pos_cash_movements where license_id=v_license_id and cash_session_id='cash-legacy-adopt-' || v_suffix) <> v_movements_before then
    raise exception 'SALE_AFTER_CLOSE_CREATED_FINANCIAL_ROWS';
  end if;

  -- The stale-session mutation is performed by the same authenticated admin actor
  -- after the adopted session is closed, preserving the exact actor/station guard.
  update public.pos_cash_sessions
  set admin_user_id = v_admin_user,
      actor_key = 'admin:' || v_admin_user::text
  where id = 'cash-stale-' || v_suffix;
  update public.pos_cash_station_bindings
  set cash_station_id = 'cash-station-stale-' || v_suffix
  where license_id = v_license_id and device_id = v_admin_device;

  -- This one-connection SQL file proves both serialized orders through real RPCs. A true overlapping sale/close race requires the existing two-session harness pattern.

  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-admin-audited-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Conteo documentado', 1, 'cash-admin-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean,false) is not true or (v_result#>>'{cash_session,cash_difference}')::numeric <> -16 then raise exception 'ADMIN_AUDITED_DIFFERENCE_FAILED: %', v_result; end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-admin-audited-' || v_suffix and closing_mode='admin_audited' and reconciliation_status='verified_with_difference' and closed_by_admin_user_id=v_admin_user) then raise exception 'ADMIN_AUDITED_METADATA_FAILED'; end if;
  if not exists(select 1 from public.pos_cash_audit_events where cash_session_id='cash-admin-audited-' || v_suffix and event_type='ADMIN_CLOSED_AUDITED' and actor_admin_user_id=v_admin_user and actor_device_id=v_admin_device) then raise exception 'ADMIN_AUDITED_EVENT_FAILED'; end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-admin-audited-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Conteo documentado', 1, 'cash-admin-idem-' || v_suffix);
  select count(*) into v_count from public.pos_cash_audit_events where cash_session_id='cash-admin-audited-' || v_suffix and event_type='ADMIN_CLOSED_AUDITED';
  if coalesce((v_result->>'success')::boolean,false) is not true or v_count <> 1 then raise exception 'ADMIN_CLOSE_IDEMPOTENCY_FAILED'; end if;

  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-staff-unverified-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'No existe conteo fisico confiable.', 1, 'cash-unverified-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean,false) is not true then raise exception 'ADMIN_UNVERIFIED_FAILED: %', v_result; end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-staff-unverified-' || v_suffix and closing_counted_amount is null and cash_difference is null and expected_cash_total=1196 and next_shift_fund=0 and reconciliation_status='unverified') then raise exception 'ADMIN_UNVERIFIED_NULL_SEMANTICS_FAILED'; end if;
  if exists(select 1 from public.pos_cash_movements where cash_session_id='cash-staff-unverified-' || v_suffix) then raise exception 'ADMIN_UNVERIFIED_CREATED_MOVEMENT'; end if;
  if not exists(select 1 from public.pos_cash_sessions where id='cash-staff-unverified-' || v_suffix and close_detail->>'expected_cash_total'='1196' and close_detail->>'closing_counted_amount' is null and close_detail->>'cash_difference' is null) then raise exception 'ADMIN_UNVERIFIED_CLOSE_DETAIL_NULL_FAILED'; end if;

  -- Zero is a valid audited physical count, never the representation of an unavailable count.
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-zero-' || v_suffix, 'admin_audited', 0, 0, 'operational_error', 'Conteo fisico de cero.', 1, 'cash-zero-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result#>>'{cash_session,closing_counted_amount}')::numeric <> 0
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'ADMIN_AUDITED_ZERO_SEMANTICS_FAILED: %', v_result;
  end if;

  -- The retained next-shift fund is closure metadata and cannot change expected cash or difference.
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-next-fund-' || v_suffix, 'admin_audited', 1180, 200, 'operational_error', 'Fondo para el siguiente turno.', 1, 'cash-next-fund-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result#>>'{cash_session,expected_cash_total}')::numeric <> 1196
     or (v_result#>>'{cash_session,closing_counted_amount}')::numeric <> 1180
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> -16
     or (v_result#>>'{cash_session,next_shift_fund}')::numeric <> 200 then
    raise exception 'ADMIN_CLOSE_NEXT_SHIFT_FUND_SEMANTICS_FAILED: %', v_result;
  end if;

  -- Phase 4's CHECK must reject invalid snapshots even if a write bypasses the RPC.
  begin
    update public.pos_cash_sessions set closing_counted_amount = null where id = 'cash-admin-audited-' || v_suffix;
    raise exception 'ADMIN_AUDITED_NULL_COUNTED_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update public.pos_cash_sessions set cash_difference = 0 where id = 'cash-staff-unverified-' || v_suffix;
    raise exception 'ADMIN_UNVERIFIED_DIFFERENCE_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update public.pos_cash_sessions set closure_reason_code = null where id = 'cash-staff-unverified-' || v_suffix;
    raise exception 'ADMIN_UNVERIFIED_REASON_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;
  begin
    update public.pos_cash_sessions set audit_comments = '' where id = 'cash-staff-unverified-' || v_suffix;
    raise exception 'ADMIN_UNVERIFIED_COMMENT_CHECK_ACCEPTED';
  exception when check_violation then null;
  end;

  -- A stale aggregate can change during canonical recalculation without an earlier version bump.
  insert into public.pos_cash_movements(
    id, license_id, cash_session_id, device_id, actor_key, type, amount, concept,
    source, created_by_device_id, actor_name, idempotency_key, metadata
  ) values (
    'mov-recalc-drift-' || v_suffix, v_license_id, 'cash-recalc-drift-' || v_suffix,
    v_admin_device, 'admin_device:' || v_admin_device, 'entrada', 4, 'Entrada pendiente de proyectar',
    'manual', v_admin_device, 'Cash owner', 'cash-recalc-drift-movement-' || v_suffix, '{}'::jsonb
  );
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-drift-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Snapshot previo', 1, 'cash-recalc-drift-key-a-' || v_suffix);
  if v_result->>'code' <> 'CASH_TOTALS_CHANGED'
     or v_result#>>'{cash_session,status}' <> 'open'
     or (v_result#>>'{cash_session,expected_cash_total}')::numeric <> 1200
     or v_result#>>'{cash_session,server_version}' <> '2' then
    raise exception 'ADMIN_CLOSE_RECALC_GUARD_FAILED: %', v_result;
  end if;
  if exists(select 1 from public.pos_cash_sessions where id='cash-recalc-drift-' || v_suffix and (closed_at is not null or closing_mode is not null or cash_difference is not null))
     or exists(select 1 from public.pos_cash_audit_events where cash_session_id='cash-recalc-drift-' || v_suffix and event_type in ('ADMIN_CLOSED_AUDITED', 'ADMIN_CLOSED_UNVERIFIED'))
     or exists(select 1 from public.pos_sync_events where entity_type='cash_session' and entity_id='cash-recalc-drift-' || v_suffix and operation='close') then
    raise exception 'ADMIN_CLOSE_RECALC_GUARD_CLOSED_OR_AUDITED';
  end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-drift-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Replay conflict', 1, 'cash-recalc-drift-key-a-' || v_suffix);
  if v_result->>'code' <> 'CASH_TOTALS_CHANGED' then raise exception 'ADMIN_CLOSE_RECALC_CONFLICT_IDEMPOTENCY_FAILED: %', v_result; end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-drift-' || v_suffix, 'admin_audited', 1180, 0, 'operational_error', 'Confirmed refreshed snapshot', 2, 'cash-recalc-drift-key-b-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true or (v_result#>>'{cash_session,cash_difference}')::numeric <> -20 then raise exception 'ADMIN_CLOSE_RECALC_SECOND_ATTEMPT_FAILED: %', v_result; end if;

  insert into public.pos_cash_movements(
    id, license_id, cash_session_id, device_id, actor_key, type, amount, concept,
    source, created_by_device_id, actor_name, idempotency_key, metadata
  ) values (
    'mov-recalc-unverified-' || v_suffix, v_license_id, 'cash-recalc-unverified-' || v_suffix,
    v_admin_device, 'admin_device:' || v_admin_device, 'entrada', 4, 'Entrada pendiente de proyectar sin conteo',
    'manual', v_admin_device, 'Cash owner', 'cash-recalc-unverified-movement-' || v_suffix, '{}'::jsonb
  );
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-unverified-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Sin conteo; snapshot previo', 1, 'cash-recalc-unverified-key-a-' || v_suffix);
  if v_result->>'code' <> 'CASH_TOTALS_CHANGED'
     or v_result#>>'{cash_session,status}' <> 'open'
     or (v_result#>>'{cash_session,expected_cash_total}')::numeric <> 1200 then
    raise exception 'ADMIN_UNVERIFIED_RECALC_GUARD_FAILED: %', v_result;
  end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-recalc-unverified-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Sin conteo; snapshot actualizado', 2, 'cash-recalc-unverified-key-b-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,closing_counted_amount}' is not null
     or v_result#>>'{cash_session,cash_difference}' is not null
     or v_result#>>'{cash_session,reconciliation_status}' <> 'unverified' then
    raise exception 'ADMIN_UNVERIFIED_RECALC_SECOND_ATTEMPT_FAILED: %', v_result;
  end if;

  v_result := public.pos_register_cash_movement_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'entrada', 1, 'Cambio concurrente sintetico', 'cash-stale-movement-' || v_suffix, '{}'::jsonb);
  if coalesce((v_result->>'success')::boolean, false) is not true or (v_result#>>'{cash_session,server_version}')::numeric <> 2 then raise exception 'CONCURRENCY_MUTATION_FAILED: %', v_result; end if;
  v_result := public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', 11, 0, 'operational_error', 'Stale version', 1, 'cash-stale-idem-' || v_suffix);
  if v_result->>'code' <> 'VERSION_CONFLICT' then raise exception 'ADMIN_CLOSE_VERSION_CONFLICT_FAILED: %', v_result; end if;

  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-other-tenant-' || v_suffix, 'admin_audited', 5, 0, 'operational_error', 'Wrong tenant', 1, 'cash-other-tenant-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_CROSS_TENANT_ACCEPTED';
  exception when others then
    if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if;
  end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, 'cash-staff-' || v_suffix, 'staff-device-' || v_suffix, v_staff_token, 'cash-stale-' || v_suffix, 'admin_audited', 10, 0, 'operational_error', 'Staff attempt', 2, 'cash-staff-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_STAFF_ACCEPTED';
  exception when others then
    if sqlerrm not in ('ADMIN_DEVICE_REQUIRED', 'ADMIN_SESSION_INVALID') then raise; end if;
  end;

  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', 0, 0, 'historical_test', 'Must fail', 2, 'cash-invalid-unverified-' || v_suffix);
    raise exception 'ADMIN_UNVERIFIED_COUNTED_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_CLOSE_UNVERIFIED_COUNTED_FORBIDDEN' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', null, 1, 'historical_test', 'Must fail', 2, 'cash-invalid-fund-' || v_suffix);
    raise exception 'ADMIN_UNVERIFIED_FUND_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_CLOSE_UNVERIFIED_NEXT_FUND_FORBIDDEN' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', null, 0, 'operational_error', 'Must fail', 2, 'cash-invalid-counted-' || v_suffix);
    raise exception 'ADMIN_AUDITED_NULL_COUNTED_ACCEPTED';
  exception when others then if sqlerrm <> 'ADMIN_CLOSE_COUNTED_AMOUNT_REQUIRED' then raise; end if; end;

  -- The public rate-limited wrapper preserves the same privileged contract.
  insert into public.pos_cash_sessions(id, license_id, device_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version)
  values ('cash-wrapper-' || v_suffix, v_license_id, v_other_admin_device, 'admin', 'admin_device:wrapper-' || v_suffix, 'open', 7, 7, 'Wrapper cash', 1);
  v_result := public.pos_admin_close_cash_session(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-wrapper-' || v_suffix, 'admin_audited', 7, 0, 'operational_error', 'Wrapper close', 1, 'cash-wrapper-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'ADMIN_CLOSE_WRAPPER_FAILED: %', v_result; end if;

  -- Closed, deleted and unknown sessions never become administratively closable.
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-wrapper-' || v_suffix, 'admin_audited', 7, 0, 'operational_error', 'Second close', 2, 'cash-wrapper-second-' || v_suffix);
    raise exception 'ADMIN_CLOSE_CLOSED_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_OPEN' then raise; end if; end;
  insert into public.pos_cash_sessions(id, license_id, device_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version, deleted_at)
  values ('cash-deleted-' || v_suffix, v_license_id, v_other_admin_device, 'admin', 'admin_device:deleted-' || v_suffix, 'open', 1, 1, 'Deleted cash', 1, now());
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-deleted-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Deleted fixture', 1, 'cash-deleted-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_DELETED_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-missing-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Unknown fixture', 1, 'cash-missing-idem-' || v_suffix);
    raise exception 'ADMIN_CLOSE_MISSING_ACCEPTED';
  exception when others then if sqlerrm <> 'CASH_SESSION_NOT_FOUND' then raise; end if; end;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_audited', 5, 6, 'operational_error', 'Fund must fail', 2, 'cash-excess-fund-' || v_suffix);
    raise exception 'ADMIN_CLOSE_EXCESS_FUND_ACCEPTED';
  exception when others then if sqlerrm <> 'NEXT_SHIFT_FUND_EXCEEDS_COUNTED' then raise; end if; end;

  -- Normal owner closure remains available and retains its historical semantics.
  update public.pos_cash_sessions
  set admin_user_id = null,
      actor_key = 'admin_device:stale-' || v_suffix
  where id = 'cash-stale-' || v_suffix;
  insert into public.pos_cash_sessions(id, license_id, device_id, device_role, actor_key, status, opening_amount, expected_cash_total, responsible_name, server_version)
  values ('cash-normal-' || v_suffix, v_license_id, v_admin_device, 'admin', 'admin_device:' || v_admin_device, 'open', 7, 7, 'Normal owner cash', 1);
  update public.pos_cash_sessions
  set admin_user_id = v_admin_user,
      actor_key = 'admin:' || v_admin_user::text,
      cash_station_id = 'cash-station-normal-' || v_suffix
  where id = 'cash-normal-' || v_suffix;
  update public.pos_cash_station_bindings
  set cash_station_id = 'cash-station-normal-' || v_suffix
  where license_id = v_license_id and device_id = v_admin_device;
  v_result := public.pos_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-normal-' || v_suffix, '{"closing_counted_amount":7,"next_shift_fund":0,"audit_comments":"Normal close regression"}'::jsonb, 1, 'cash-normal-idem-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'NORMAL_CLOSE_REGRESSION_FAILED: %', v_result;
  end if;

  -- The detail RPC is tenant scoped and exposes the single-session audit read model.
  v_result := public.pos_admin_get_cash_session_detail_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-admin-audited-' || v_suffix);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce(jsonb_array_length(v_result->'audit_events'), 0) <> 1
     or v_result#>>'{cash_session,closing_mode}' <> 'admin_audited'
     or v_result#>>'{audit_events,0,device_name}' <> 'Chrome admin'
     or v_result#>>'{audit_events,0,admin_display_name}' <> 'Cash owner' then
    raise exception 'ADMIN_DETAIL_READ_MODEL_FAILED: %', v_result;
  end if;
  v_result := public.pos_admin_list_cash_sessions_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, null, null, null, null, 100, 0);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or not exists(select 1 from jsonb_array_elements(v_result->'cash_sessions') row_payload where row_payload->>'id'='cash-admin-audited-' || v_suffix and row_payload->>'device_name'='Edge admin' and row_payload->>'closed_by_device_name'='Chrome admin') then
    raise exception 'ADMIN_LIST_READ_MODEL_FAILED: %', v_result;
  end if;
  select payload into v_event_payload from public.pos_cash_audit_events where cash_session_id='cash-admin-audited-' || v_suffix and event_type='ADMIN_CLOSED_AUDITED';
  if v_event_payload::text like '%' || v_admin_token || '%' or v_event_payload::text like '%' || v_device_token || '%' then
    raise exception 'ADMIN_AUDIT_EVENT_EXPOSED_SECRET';
  end if;

  -- A privileged close requires a live, unrevoked, unexpired admin session.
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, null, 'cash-stale-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'No session', 2, 'cash-no-session-' || v_suffix);
    raise exception 'ADMIN_CLOSE_NO_SESSION_ACCEPTED';
   exception when others then if sqlerrm not in ('ADMIN_SESSION_REQUIRED', 'ACTOR_SESSION_REQUIRED') then raise; end if; end;
  update public.license_admin_sessions set revoked_at = now() where id = v_admin_session_id;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Revoked session', 2, 'cash-revoked-session-' || v_suffix);
    raise exception 'ADMIN_CLOSE_REVOKED_SESSION_ACCEPTED';
   exception when others then if sqlerrm not in ('ADMIN_SESSION_INVALID', 'ACTOR_SESSION_INVALID') then raise; end if; end;
  update public.license_admin_sessions set revoked_at = null, expires_at = now() - interval '1 minute' where id = v_admin_session_id;
  begin
    perform public.pos_admin_close_cash_session_unlimited(v_admin_key, v_fingerprint, v_device_token, v_admin_token, 'cash-stale-' || v_suffix, 'admin_unverified', null, null, 'historical_test', 'Expired session', 2, 'cash-expired-session-' || v_suffix);
    raise exception 'ADMIN_CLOSE_EXPIRED_SESSION_ACCEPTED';
   exception when others then if sqlerrm not in ('ADMIN_SESSION_EXPIRED', 'ACTOR_SESSION_EXPIRED', 'ADMIN_SESSION_INVALID', 'ACTOR_SESSION_INVALID') then raise; end if; end;
end;
$test$;

rollback;
