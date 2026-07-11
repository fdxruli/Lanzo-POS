-- ECOM.POS.1 controlled SQL test. Run inside BEGIN/ROLLBACK after the migration.
do $test$
declare
  v_license_id uuid;
  v_license_key text;
  v_order_id uuid;
  v_new_order_id uuid;
  v_admin_a uuid;
  v_admin_fingerprint text;
  v_staff_ok uuid := extensions.gen_random_uuid();
  v_staff_ecom uuid := extensions.gen_random_uuid();
  v_staff_pos uuid := extensions.gen_random_uuid();
  v_staff_other uuid := extensions.gen_random_uuid();
  v_staff_ok_device uuid := extensions.gen_random_uuid();
  v_staff_ecom_device uuid := extensions.gen_random_uuid();
  v_staff_pos_device uuid := extensions.gen_random_uuid();
  v_staff_other_device uuid := extensions.gen_random_uuid();
  v_result jsonb;
  v_retry jsonb;
  v_claim_token uuid;
  v_replacement_token uuid;
begin
  select o.license_id, l.license_key
  into v_license_id, v_license_key
  from public.ecommerce_orders o
  join public.licenses l on l.id = o.license_id
  where o.public_order_code = 'EC-00000010';

  select id into v_order_id from public.ecommerce_orders where public_order_code = 'EC-00000010';
  select id into v_new_order_id from public.ecommerce_orders where public_order_code = 'EC-00000011';
  if v_license_id is null or v_order_id is null or v_new_order_id is null then raise exception 'fixture orders missing'; end if;

  select id, device_fingerprint into v_admin_a, v_admin_fingerprint
  from public.license_devices
  where license_id=v_license_id and device_role='admin' and is_active is true
  limit 1;
  if v_admin_a is null then raise exception 'active admin fixture missing'; end if;
  update public.license_devices set security_token='fixture-token-a', previous_security_token=null where id=v_admin_a;

  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values
    (v_staff_ok, v_license_id, 'ecom_pos_ok', 'ECOM POS OK', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"ecommerce":true,"pos":true}'::jsonb),
    (v_staff_ecom, v_license_id, 'ecom_only', 'ECOM ONLY', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"ecommerce":true,"pos":false}'::jsonb),
    (v_staff_pos, v_license_id, 'pos_only', 'POS ONLY', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"ecommerce":false,"pos":true}'::jsonb),
    (v_staff_other, v_license_id, 'ecom_pos_other', 'ECOM POS OTHER', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"ecommerce":true,"pos":true}'::jsonb);

  insert into public.license_devices(id, license_id, device_fingerprint, device_name, is_active, security_token, device_role, staff_user_id)
  values
    (v_staff_ok_device, v_license_id, 'ecom-pos-test-staff-ok', 'ECOM POS STAFF OK', true, 'fixture-token-ok', 'staff', v_staff_ok),
    (v_staff_ecom_device, v_license_id, 'ecom-pos-test-staff-ecom', 'ECOM STAFF', true, 'fixture-token-ecom', 'staff', v_staff_ecom),
    (v_staff_pos_device, v_license_id, 'ecom-pos-test-staff-pos', 'POS STAFF', true, 'fixture-token-pos', 'staff', v_staff_pos),
    (v_staff_other_device, v_license_id, 'ecom-pos-test-staff-other', 'OTHER STAFF', true, 'fixture-token-other', 'staff', v_staff_other);

  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values
    (v_license_id, v_staff_ok, v_staff_ok_device, extensions.crypt('session-ok', extensions.gen_salt('bf')), now() + interval '1 hour'),
    (v_license_id, v_staff_ecom, v_staff_ecom_device, extensions.crypt('session-ecom', extensions.gen_salt('bf')), now() + interval '1 hour'),
    (v_license_id, v_staff_pos, v_staff_pos_device, extensions.crypt('session-pos', extensions.gen_salt('bf')), now() + interval '1 hour'),
    (v_license_id, v_staff_other, v_staff_other_device, extensions.crypt('session-other', extensions.gen_salt('bf')), now() + interval '1 hour');

  update public.ecommerce_orders
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), converted_sale_id = null,
      pos_draft_status = 'none', pos_draft_id = null, pos_claim_token = null, pos_claim_request_key = null,
      pos_claimed_at = null, pos_claim_expires_at = null, pos_claim_actor_type = null,
      pos_claim_actor_ref = null, pos_draft_prepared_at = null
  where id = v_order_id;

  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-admin-a');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'admin claim failed: %', v_result->>'code'; end if;
  v_claim_token := nullif(v_result #>> '{order,posDraft,claimToken}', '')::uuid;
  if v_claim_token is null then raise exception 'owner token missing'; end if;

  v_retry := public.ecommerce_admin_claim_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-admin-a');
  if nullif(v_retry #>> '{order,posDraft,claimToken}', '')::uuid is distinct from v_claim_token then raise exception 'idempotent claim changed token'; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, 'ecom-pos-test-staff-other', 'fixture-token-other', 'session-other', v_order_id, 'request-other-device');
  if v_result->>'code' <> 'ECOMMERCE_POS_DRAFT_IN_PROGRESS' then raise exception 'second device was not blocked'; end if;

  v_result := public.ecommerce_admin_confirm_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, extensions.gen_random_uuid(), 'ecom-test');
  if v_result->>'code' <> 'ECOMMERCE_POS_DRAFT_TOKEN_INVALID' then raise exception 'bad token was not blocked'; end if;

  v_result := public.ecommerce_admin_confirm_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, v_claim_token, 'ecom-test');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'confirm failed'; end if;
  if (select status <> 'accepted' or converted_sale_id is not null or pos_draft_status <> 'prepared' from public.ecommerce_orders where id=v_order_id) then
    raise exception 'confirm changed conversion state';
  end if;
  v_retry := public.ecommerce_admin_confirm_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, v_claim_token, 'ecom-test');
  if coalesce((v_retry->>'success')::boolean, false) is not true or coalesce((v_retry->>'changed')::boolean, true) is true then raise exception 'confirm not idempotent'; end if;

  v_result := public.ecommerce_admin_release_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, null, 'admin_release');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'admin release failed'; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, 'ecom-pos-test-staff-ecom', 'fixture-token-ecom', 'session-ecom', v_order_id, 'request-ecom-only');
  if v_result->>'code' <> 'ECOMMERCE_POS_DRAFT_PERMISSION_DENIED' then raise exception 'ecommerce-only staff was not blocked: %', v_result->>'code'; end if;
  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, 'ecom-pos-test-staff-pos', 'fixture-token-pos', 'session-pos', v_order_id, 'request-pos-only');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_PERMISSION_DENIED' then raise exception 'pos-only staff was not blocked: %', v_result->>'code'; end if;
  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, 'ecom-pos-test-staff-ok', 'fixture-token-ok', 'invalid-session', v_order_id, 'request-invalid-session');
  if v_result->>'code' <> 'ECOMMERCE_STAFF_SESSION_INVALID' then raise exception 'invalid staff session was not blocked'; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, 'ecom-pos-test-staff-ok', 'fixture-token-ok', 'session-ok', v_order_id, 'request-staff-ok');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'authorized staff claim failed: %', v_result->>'code'; end if;
  v_claim_token := nullif(v_result #>> '{order,posDraft,claimToken}', '')::uuid;
  v_result := public.ecommerce_admin_release_pos_draft(v_license_key, 'ecom-pos-test-staff-other', 'fixture-token-other', 'session-other', v_order_id, v_claim_token, 'foreign_release');
  if v_result->>'code' <> 'ECOMMERCE_POS_DRAFT_TOKEN_INVALID' then raise exception 'foreign release was not blocked'; end if;
  v_result := public.ecommerce_admin_release_pos_draft(v_license_key, 'ecom-pos-test-staff-ok', 'fixture-token-ok', 'session-ok', v_order_id, v_claim_token, 'owner_release');
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'owner release failed'; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-expired');
  v_claim_token := nullif(v_result #>> '{order,posDraft,claimToken}', '')::uuid;
  update public.ecommerce_orders set pos_claimed_at=now()-interval '20 minutes', pos_claim_expires_at=now()-interval '5 minutes' where id=v_order_id;
  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, 'ecom-pos-test-staff-other', 'fixture-token-other', 'session-other', v_order_id, 'request-replacement');
  v_replacement_token := nullif(v_result #>> '{order,posDraft,claimToken}', '')::uuid;
  if coalesce((v_result->>'success')::boolean, false) is not true or v_replacement_token is null or v_replacement_token = v_claim_token then raise exception 'expired claim was not replaced'; end if;
  perform public.ecommerce_admin_release_pos_draft(v_license_key, 'ecom-pos-test-staff-other', 'fixture-token-other', 'session-other', v_order_id, v_replacement_token, 'cleanup');

  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_new_order_id, 'request-new');
  if v_result->>'code' <> 'ECOMMERCE_ORDER_INVALID_TRANSITION' then raise exception 'new order was not blocked'; end if;

  update public.ecommerce_orders set status='rejected' where id=v_order_id;
  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-rejected');
  if v_result->>'code' <> 'ECOMMERCE_ORDER_INVALID_TRANSITION' then raise exception 'rejected order was not blocked'; end if;
  update public.ecommerce_orders set status='converted_to_sale', converted_sale_id='fixture-sale' where id=v_order_id;
  v_result := public.ecommerce_admin_claim_pos_draft(v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-converted');
  if v_result->>'code' <> 'ECOMMERCE_ORDER_INVALID_TRANSITION' then raise exception 'converted order was not blocked'; end if;

  if has_function_privilege('public', 'public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text)', 'execute') then raise exception 'PUBLIC can execute claim'; end if;
  if not has_function_privilege('anon', 'public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text)', 'execute') then raise exception 'anon cannot execute claim'; end if;
  if not has_function_privilege('authenticated', 'public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text)', 'execute') then raise exception 'authenticated cannot execute claim'; end if;
  if has_function_privilege('anon', 'private.ecommerce_pos_draft_authorize_v1(text,text,text,text,text)', 'execute') then raise exception 'anon can execute private helper'; end if;
  if has_table_privilege('anon', 'public.ecommerce_orders', 'select') or has_table_privilege('authenticated', 'public.ecommerce_orders', 'select') then raise exception 'client role has direct ecommerce_orders grant'; end if;
end;
$test$;

select jsonb_build_object(
  'status', 'ECOM.POS.1 SQL PASS',
  'financialEffects', 0,
  'rollbackRequired', true
) as result;
