-- LICENSE.PRO.TO.FREE.LIFECYCLE.FINAL.R1
-- Cross-phase certification with synthetic data only. The complete fixture rolls back.
begin;

do $test$
declare
  v_pro_plan public.plans%rowtype;
  v_free_plan public.plans%rowtype;
  v_license uuid := extensions.gen_random_uuid();
  v_license_key text := 'PHASE5-LIFECYCLE-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_other_license uuid := extensions.gen_random_uuid();
  v_other_key text := 'PHASE5-LIFECYCLE-OTHER-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_owner uuid := extensions.gen_random_uuid();
  v_other_owner uuid := extensions.gen_random_uuid();
  v_device_survivor uuid := extensions.gen_random_uuid();
  v_device_removed uuid := extensions.gen_random_uuid();
  v_device_cycle2 uuid := extensions.gen_random_uuid();
  v_other_device uuid := extensions.gen_random_uuid();
  v_cash_station text := 'p5-station-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_other_cash_station text := 'p5-other-station-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_cash_cycle1 text := 'p5-cycle1-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_other_cash text := 'p5-other-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_cash_cycle2 text;
  v_suffix text := replace(extensions.gen_random_uuid()::text, '-', '');
  v_password text := 'SyntheticOwnerPass123!';
  v_username text;
  v_other_username text;
  v_survivor_session jsonb;
  v_removed_session jsonb;
  v_other_session jsonb;
  v_takeover1 jsonb;
  v_takeover2 jsonb;
  v_result jsonb;
  v_entitlement record;
  v_license_before jsonb;
  v_device_before jsonb;
  v_session_before jsonb;
  v_other_cash_before jsonb;
  v_cash1_before jsonb;
  v_cash2_before jsonb;
  v_movement_before jsonb;
  v_movement_after jsonb;
  v_expected_amount numeric;
  v_expected_version integer;
  v_boundary1 timestamptz := now() - interval '1 day';
  v_boundary2 timestamptz := now() - interval '10 minutes';
  v_cycle1_recovery_event uuid;
  v_cycle2_recovery_event uuid;
  v_cycle1_downgrade_event uuid;
  v_cycle2_downgrade_event uuid;
  v_count integer;
begin
  select * into v_pro_plan from public.plans where code = 'pro_monthly' and is_active is true limit 1;
  select * into v_free_plan from public.plans where code = 'free_trial' and is_active is true limit 1;
  if v_pro_plan.id is null or v_free_plan.id is null then
    raise exception 'FINAL_LIFECYCLE_REQUIRED_PLANS_MISSING';
  end if;

  v_username := 'owner_' || v_suffix;
  v_other_username := 'other_' || v_suffix;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name
  ) values
    (v_license, v_license_key, v_pro_plan.id, 'subscription', 'active',
      now() + interval '30 days', false, 1, v_pro_plan.max_devices,
      v_pro_plan.features, 'Phase 5 lifecycle fixture'),
    (v_other_license, v_other_key, v_pro_plan.id, 'subscription', 'active',
      now() + interval '30 days', false, 1, v_pro_plan.max_devices,
      v_pro_plan.features, 'Phase 5 tenant isolation fixture');

  insert into public.pos_cash_stations (id, license_id, station_key, status, binding_mode)
  values
    (v_cash_station, v_license, 'p5-station-key-' || v_suffix, 'active', 'device_default'),
    (v_other_cash_station, v_other_license, 'p5-other-station-key-' || v_suffix, 'active', 'device_default');

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license, v_pro_plan.id, 'pro_monthly', v_pro_plan.name,
    'pro_paid', 'active', now() - interval '40 days', now() - interval '8 days',
    15, '{"fixture":"license-pro-to-free-lifecycle-final-r1"}'::jsonb
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values
    (v_owner, v_license, v_username, 'Synthetic Lifecycle Owner',
      extensions.crypt(v_password, extensions.gen_salt('bf', 4)), true, true),
    (v_other_owner, v_other_license, v_other_username, 'Synthetic Other Owner',
      extensions.crypt(v_password, extensions.gen_salt('bf', 4)), true, true);

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info, is_active,
    activated_at, last_used_at, security_token, previous_security_token,
    device_role, device_mode
  ) values
    (v_device_survivor, v_license, 'p5-survivor-' || v_suffix, 'Cycle 1 survivor',
      '{}'::jsonb, true, now() - interval '30 days', now() - interval '10 days',
      'p5-survivor-token-' || v_suffix, 'p5-survivor-previous-' || v_suffix,
      'admin', 'admin_only'),
    (v_device_removed, v_license, 'p5-removed-' || v_suffix, 'Cycle 1 removed device',
      '{}'::jsonb, true, now() - interval '10 days', now() - interval '1 day',
      'p5-removed-token-' || v_suffix, 'p5-removed-previous-' || v_suffix,
      'admin', 'admin_only'),
    (v_other_device, v_other_license, 'p5-other-' || v_suffix, 'Other tenant device',
      '{}'::jsonb, true, now() - interval '5 days', now(),
      'p5-other-token-' || v_suffix, null, 'admin', 'admin_only');

  v_survivor_session := private.create_admin_session(
    v_license, v_owner, v_device_survivor, 'Cycle 1 survivor'
  );
  v_removed_session := private.create_admin_session(
    v_license, v_owner, v_device_removed, 'Cycle 1 removed device'
  );
  v_other_session := private.create_admin_session(
    v_other_license, v_other_owner, v_other_device, 'Other tenant device'
  );

  -- Canonical Pro-at-opening evidence for the synthetic historical cash session.
  insert into public.license_events (license_key, event_type, triggered_at, metadata)
  values (
    v_license_key, 'PLAN_CHANGED', now() - interval '30 days',
    jsonb_build_object(
      'source', 'licenses_update_trigger',
      'from_plan', 'free_trial',
      'to_plan', 'pro_monthly'
    )
  );

  insert into public.pos_cash_sessions (
    id, license_id, device_id, admin_user_id, device_role, scope, actor_key, status,
    opened_at, opened_by_actor_key, opening_amount, cash_sales_total,
    cash_entries_total, cash_exits_total, expected_cash_total,
    responsible_name, opened_by_device_id, cash_station_id, server_version, metadata
  ) values
    (v_cash_cycle1, v_license, v_device_survivor, v_owner, 'admin', 'actor',
      'admin:' || v_owner::text, 'open', now() - interval '20 days',
      'admin:' || v_owner::text, 100, 0, 25, 0, 125,
      'Synthetic owner', v_device_survivor, v_cash_station, 1,
      '{"fixture":"phase5-cycle-1"}'::jsonb),
    (v_other_cash, v_other_license, v_other_device, v_other_owner, 'admin', 'actor',
      'admin:' || v_other_owner::text, 'open', now() - interval '1 day',
      'admin:' || v_other_owner::text, 777, 0, 0, 0, 777,
      'Other tenant', v_other_device, v_other_cash_station, 1,
      '{"fixture":"phase5-tenant-b"}'::jsonb);

  insert into public.pos_cash_movements (
    id, license_id, cash_session_id, device_id, actor_key, type, amount,
    concept, actor_name, metadata
  ) values (
    'p5-movement-' || v_suffix, v_license, v_cash_cycle1, v_device_survivor,
    'admin:' || v_owner::text, 'entrada', 25,
    'Synthetic fixture movement', 'Synthetic lifecycle owner',
    '{"fixture":"phase5-cycle-1"}'::jsonb
  );

  perform private.record_pos_cash_event(
    v_license, v_cash_cycle1, 'OPENED', v_device_survivor, null,
    'Synthetic lifecycle owner',
    jsonb_build_object('actor_key', 'admin:' || v_owner::text)
  );
  perform private.record_pos_sync_event(
    v_license, 'cash_session', v_cash_cycle1, 'open', v_device_survivor, null,
    'p5-cycle1-open-' || v_suffix,
    jsonb_build_object('cash_session_id', v_cash_cycle1), 1
  );

  select to_jsonb(l) into v_license_before from public.licenses l where l.id = v_other_license;
  select to_jsonb(d) into v_device_before from public.license_devices d where d.id = v_other_device;
  select to_jsonb(s) into v_session_before
    from public.license_admin_sessions s
   where s.license_id = v_other_license and s.device_id = v_other_device
   order by s.created_at desc limit 1;
  select to_jsonb(c) into v_other_cash_before
    from public.pos_cash_sessions c where c.id = v_other_cash;
  select to_jsonb(c) into v_cash1_before
    from public.pos_cash_sessions c where c.id = v_cash_cycle1;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    into v_movement_before
    from public.pos_cash_movements m
   where m.license_id = v_license and m.cash_session_id = v_cash_cycle1;
  select expected_cash_total, server_version into v_expected_amount, v_expected_version
    from public.pos_cash_sessions where id = v_cash_cycle1;

  -- Active -> grace is still entitled; materialization must remain a no-op.
  update public.licenses
     set expires_at = now() - interval '3 days'
   where id = v_license;
  select * into v_entitlement from private.license_entitlement_state_v1(v_license);
  if v_entitlement.lifecycle_state <> 'grace_period'
     or v_entitlement.is_entitled is not true
     or v_entitlement.grace_period_ends is distinct from (now() + interval '4 days') then
    raise exception 'FINAL_LIFECYCLE_GRACE_BOUNDARY_MISMATCH: %', row_to_json(v_entitlement);
  end if;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if v_result->>'code' <> 'LICENSE_IN_GRACE'
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 2
     or exists (
       select 1 from public.license_admin_sessions
        where license_id = v_license and revoked_at is not null
     ) then
    raise exception 'FINAL_LIFECYCLE_MATERIALIZED_OR_REVOKED_DURING_GRACE: %', v_result;
  end if;

  -- Grace ended: the real materializer performs Free transition and Phase 2 pruning.
  update public.licenses set expires_at = now() - interval '8 days' where id = v_license;
  select * into v_entitlement from private.license_entitlement_state_v1(v_license);
  if v_entitlement.lifecycle_state <> 'expired'
     or v_entitlement.is_entitled is not false then
    raise exception 'FINAL_LIFECYCLE_EXPIRY_NOT_CANONICAL: %', row_to_json(v_entitlement);
  end if;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, false) is not true
     or v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
    raise exception 'FINAL_LIFECYCLE_MATERIALIZATION_FAILED: %', v_result;
  end if;

  -- Give synthetic cycle events distinct timestamps to make boundary ordering explicit.
  select e.id into v_cycle1_downgrade_event
    from public.license_events e
   where e.license_key = v_license_key
     and e.event_type = 'PLAN_CHANGED'
     and e.metadata->>'source' = 'licenses_update_trigger'
     and e.metadata->>'from_plan' = 'pro_monthly'
     and e.metadata->>'to_plan' = 'free_trial'
   order by e.triggered_at desc, e.id desc limit 1;
  if v_cycle1_downgrade_event is null then
    raise exception 'FINAL_LIFECYCLE_CYCLE1_PLAN_EVENT_MISSING';
  end if;
  update public.license_events set triggered_at = v_boundary1 where id = v_cycle1_downgrade_event;
  update public.license_events
     set triggered_at = v_boundary1
   where id = (
     select e.id from public.license_events e
      where e.license_key = v_license_key
        and e.event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE'
      order by e.triggered_at desc, e.id desc limit 1
   );
  select e.id into v_cycle1_recovery_event
    from public.license_events e
   where e.license_key = v_license_key
     and e.event_type = 'LICENSE_UPDATE'
     and e.metadata->>'source' = 'enforce_license_plan_limits_after_change'
     and e.metadata->>'reason' = 'PLAN_LIMITS_ENFORCED'
     and e.metadata->>'plan' = 'free_trial'
     and e.metadata->>'max_devices' = '1'
     and coalesce((e.metadata->>'over_limit_devices_blocked')::integer, 0) > 0
   order by e.triggered_at desc, e.id desc limit 1;
  if v_cycle1_recovery_event is null then
    raise exception 'FINAL_LIFECYCLE_CYCLE1_DEVICE_EVIDENCE_MISSING';
  end if;
  update public.license_events set triggered_at = v_boundary1 where id = v_cycle1_recovery_event;

  if (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_device_survivor and is_active)
     or not exists (
       select 1 from public.license_devices
        where id = v_device_removed and not is_active
          and security_token is null and previous_security_token is null
          and device_info #>> '{license_block,reason}' = 'PLAN_DOWNGRADE_DEVICE_LIMIT'
     )
     or exists (
       select 1 from public.license_admin_sessions
        where license_id = v_license and device_id = v_device_removed
          and revoked_at is null and expires_at > now()
     )
     or (select count(*) from public.license_admin_sessions
          where license_id = v_license and device_id = v_device_removed
            and revoked_at is null and expires_at > now()) <> 0 then
    raise exception 'FINAL_LIFECYCLE_DEVICE_OR_SESSION_PRUNING_FAILED';
  end if;

  select to_jsonb(c) into v_result from public.pos_cash_sessions c where c.id = v_cash_cycle1;
  if v_result is distinct from v_cash1_before
     or v_result->>'status' <> 'open'
     or v_result->>'closing_counted_amount' is not null
     or v_result->>'cash_difference' is not null then
    raise exception 'FINAL_LIFECYCLE_DOWNGRADE_CHANGED_OPEN_FINANCIAL_STATE';
  end if;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    into v_movement_after
    from public.pos_cash_movements m
   where m.license_id = v_license and m.cash_session_id = v_cash_cycle1;
  if v_movement_after is distinct from v_movement_before then
    raise exception 'FINAL_LIFECYCLE_DOWNGRADE_CHANGED_FINANCIAL_MOVEMENTS';
  end if;

  -- Removed-device owner login is explicit; invalid credentials cannot mutate authority.
  v_result := public.admin_login_on_device(
    v_license_key, v_username, 'invalid-password',
    'p5-removed-' || v_suffix, 'Cycle 1 removed device', '{}'::jsonb
  );
  if v_result->>'code' <> 'INVALID_ADMIN_CREDENTIALS'
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1 then
    raise exception 'FINAL_LIFECYCLE_INVALID_CREDENTIALS_MUTATED_DEVICE_STATE: %', v_result;
  end if;

  v_result := public.admin_login_on_device(
    v_license_key, v_username, v_password,
    'p5-removed-' || v_suffix, 'Cycle 1 removed device', '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_REQUIRED' then
    raise exception 'FINAL_LIFECYCLE_TAKEOVER_CONFIRMATION_MISSING: %', v_result;
  end if;

  v_takeover1 := public.admin_takeover_free_device(
    v_license_key, v_username, v_password,
    'p5-removed-' || v_suffix, 'Cycle 1 removed device',
    '{"fixture":"phase5-cycle-1"}'::jsonb
  );
  if coalesce((v_takeover1->>'success')::boolean, false) is not true
     or v_takeover1->>'code' <> 'FREE_DEVICE_TAKEOVER_SUCCESS'
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_device_removed and is_active)
     or exists (select 1 from public.license_devices where id = v_device_survivor and is_active) then
    raise exception 'FINAL_LIFECYCLE_CYCLE1_TAKEOVER_FAILED: %', v_takeover1;
  end if;

  if coalesce((public.verify_admin_session(
       v_license_key, 'p5-survivor-' || v_suffix,
       'p5-survivor-token-' || v_suffix,
       v_survivor_session->>'session_token'
     )->>'valid')::boolean, false) is true
     or exists (
       select 1 from public.license_admin_sessions
        where license_id = v_license and revoked_at is null
          and device_id <> v_device_removed
     ) then
    raise exception 'FINAL_LIFECYCLE_TAKEOVER_LEFT_PREVIOUS_SESSION_AUTHORIZED';
  end if;

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, 'p5-removed-' || v_suffix,
    v_takeover1->>'device_security_token',
    v_takeover1->>'admin_session_token'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 1
     or not exists (
       select 1 from jsonb_array_elements(v_result->'cash_sessions') x
        where x->>'id' = v_cash_cycle1
     )
     or (select coalesce((features->>'cloud_cash_sync')::boolean, true)
           from public.licenses where id = v_license) is not false then
    raise exception 'FINAL_LIFECYCLE_CYCLE1_PENDING_OR_FREE_FEATURE_FAILED: %', v_result;
  end if;

  -- Tenant A cannot read or close Tenant B cash through its owner bridge.
  begin
    perform public.pos_get_post_downgrade_cash_session_detail(
      v_license_key, 'p5-removed-' || v_suffix,
      v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token',
      v_other_cash
    );
    raise exception 'FINAL_LIFECYCLE_CROSS_TENANT_DETAIL_ACCEPTED';
  exception when others then
    if sqlerrm <> 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE' then raise; end if;
  end;
  begin
    perform public.pos_close_post_downgrade_cash_session(
      v_license_key, 'p5-removed-' || v_suffix,
      v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token',
      v_other_cash, 'admin_audited', 777, 0, 'abandoned_session',
      'Synthetic cross-tenant rejection', 1, 'p5-cross-tenant-' || v_suffix
    );
    raise exception 'FINAL_LIFECYCLE_CROSS_TENANT_CLOSE_ACCEPTED';
  exception when others then
    if sqlerrm <> 'POST_DOWNGRADE_CASH_NOT_ELIGIBLE' then raise; end if;
  end;

  -- Cash stays open and all counted/expected/difference/movement data stays intact until explicit owner action.
  select to_jsonb(c) into v_result from public.pos_cash_sessions c where c.id = v_cash_cycle1;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.id), '[]'::jsonb)
    into v_movement_after
    from public.pos_cash_movements m
   where m.license_id = v_license and m.cash_session_id = v_cash_cycle1;
  if v_result is distinct from v_cash1_before
     or v_result->>'status' <> 'open'
     or v_result->>'closing_counted_amount' is not null
     or v_result->>'cash_difference' is not null
     or v_movement_after is distinct from v_movement_before then
    raise exception 'FINAL_LIFECYCLE_PRE_CLOSE_FINANCIAL_ASSERTION_FAILED';
  end if;

  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, 'p5-removed-' || v_suffix,
    v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token',
    v_cash_cycle1, 'admin_audited', v_expected_amount, 0,
    'historical_test', 'Explicit synthetic owner reconciliation, cycle 1.',
    v_expected_version, 'p5-cycle1-close-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,status}' <> 'closed'
     or (v_result#>>'{cash_session,closing_counted_amount}')::numeric <> v_expected_amount
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'FINAL_LIFECYCLE_CYCLE1_EXPLICIT_CLOSE_FAILED: %', v_result;
  end if;

  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, 'p5-removed-' || v_suffix,
    v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token',
    v_cash_cycle1, 'admin_audited', v_expected_amount, 0,
    'historical_test', 'Explicit synthetic owner reconciliation, cycle 1.',
    v_expected_version, 'p5-cycle1-close-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select count(*) from public.pos_cash_audit_events
          where license_id = v_license and cash_session_id = v_cash_cycle1
            and payload->>'reconciliation_source' = 'POST_DOWNGRADE_CASH_RECONCILIATION') <> 1
     or (select count(*) from public.pos_sync_events
          where license_id = v_license and entity_type = 'cash_session'
            and entity_id = v_cash_cycle1 and operation = 'close'
            and idempotency_key = 'p5-cycle1-close-' || v_suffix) <> 1 then
    raise exception 'FINAL_LIFECYCLE_CYCLE1_CLOSE_RETRY_NOT_IDEMPOTENT: %', v_result;
  end if;

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, 'p5-removed-' || v_suffix,
    v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token'
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_LIFECYCLE_PENDING_COUNT_DID_NOT_REFRESH_AFTER_CLOSE: %', v_result;
  end if;

  -- Free -> Pro restores normal Cloud Cash and removes the historical bridge surface.
  update public.licenses l
     set plan_id = v_pro_plan.id,
         features = v_pro_plan.features,
         max_devices = v_pro_plan.max_devices,
         expires_at = now() + interval '30 days'
   where l.id = v_license;
  update public.license_events
     set triggered_at = now() - interval '1 hour'
   where id = (
     select e.id from public.license_events e
      where e.license_key = v_license_key
        and e.event_type = 'PLAN_CHANGED'
        and e.metadata->>'source' = 'licenses_update_trigger'
        and e.metadata->>'from_plan' = 'free_trial'
        and e.metadata->>'to_plan' = 'pro_monthly'
      order by e.triggered_at desc, e.id desc limit 1
   );

  if (select coalesce((features->>'cloud_cash_sync')::boolean, false)
        from public.licenses where id = v_license) is not true then
    raise exception 'FINAL_LIFECYCLE_PRO_UPGRADE_DID_NOT_RESTORE_CLOUD_CASH';
  end if;
  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, 'p5-removed-' || v_suffix,
    v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_LIFECYCLE_BRIDGE_REMAINED_ACTIVE_AFTER_UPGRADE: %', v_result;
  end if;

  -- Pro Cloud Cash normal opening proves the standard surface is restored.
  v_result := public.pos_open_cash_session_unlimited(
    v_license_key, 'p5-removed-' || v_suffix,
    v_takeover1->>'device_security_token', v_takeover1->>'admin_session_token',
    jsonb_build_object('opening_amount', 40, 'responsible_name', 'Cycle 2 owner'),
    'p5-cycle2-cloud-open-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'FINAL_LIFECYCLE_NORMAL_PRO_CLOUD_CASH_OPEN_FAILED: %', v_result;
  end if;
  v_cash_cycle2 := v_result#>>'{cash_session,id}';
  if v_cash_cycle2 is null then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_CASH_ID_MISSING: %', v_result;
  end if;
  update public.pos_cash_sessions
     set opened_at = now() - interval '30 minutes'
   where id = v_cash_cycle2 and license_id = v_license;
  select to_jsonb(c) into v_cash2_before
    from public.pos_cash_sessions c where c.id = v_cash_cycle2;

  -- A second active Pro device ensures the second downgrade has a fresh recovery event.
  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, device_info, is_active,
    activated_at, last_used_at, security_token, previous_security_token,
    device_role, device_mode
  ) values (
    v_device_cycle2, v_license, 'p5-cycle2-removed-' || v_suffix,
    'Cycle 2 removed device', '{}'::jsonb, true,
    now(), now(), 'p5-cycle2-token-' || v_suffix,
    'p5-cycle2-previous-' || v_suffix, 'admin', 'admin_only'
  );
  perform private.create_admin_session(
    v_license, v_owner, v_device_cycle2, 'Cycle 2 removed device'
  );

  update public.licenses set expires_at = now() - interval '8 days' where id = v_license;
  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, false) is not true
     or v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_MATERIALIZATION_FAILED: %', v_result;
  end if;

  select e.id into v_cycle2_downgrade_event
    from public.license_events e
   where e.license_key = v_license_key
     and e.event_type = 'PLAN_CHANGED'
     and e.metadata->>'source' = 'licenses_update_trigger'
     and e.metadata->>'from_plan' = 'pro_monthly'
     and e.metadata->>'to_plan' = 'free_trial'
   order by e.triggered_at desc, e.id desc limit 1;
  update public.license_events set triggered_at = v_boundary2 where id = v_cycle2_downgrade_event;
  update public.license_events
     set triggered_at = v_boundary2
   where id = (
     select e.id from public.license_events e
      where e.license_key = v_license_key
        and e.event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE'
      order by e.triggered_at desc, e.id desc limit 1
   );
  select e.id into v_cycle2_recovery_event
    from public.license_events e
   where e.license_key = v_license_key
     and e.event_type = 'LICENSE_UPDATE'
     and e.metadata->>'source' = 'enforce_license_plan_limits_after_change'
     and e.metadata->>'reason' = 'PLAN_LIMITS_ENFORCED'
     and e.metadata->>'plan' = 'free_trial'
     and e.metadata->>'max_devices' = '1'
     and coalesce((e.metadata->>'over_limit_devices_blocked')::integer, 0) > 0
   order by e.triggered_at desc, e.id desc limit 1;

  if v_cycle2_downgrade_event is null
     or v_cycle2_recovery_event is null
     or (select count(*) from public.license_devices where license_id = v_license and is_active) <> 1
     or not exists (select 1 from public.license_devices where id = v_device_removed and is_active)
     or not exists (
       select 1 from public.license_devices where id = v_device_cycle2 and not is_active
         and security_token is null and previous_security_token is null
     ) then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_DEVICE_OR_EVIDENCE_FAILED';
  end if;
  update public.license_events set triggered_at = v_boundary2 where id = v_cycle2_recovery_event;

  v_result := public.admin_login_on_device(
    v_license_key, v_username, v_password,
    'p5-cycle2-removed-' || v_suffix, 'Cycle 2 removed device', '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_REQUIRED' then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_RECOVERY_USED_STALE_EVIDENCE: %', v_result;
  end if;

  v_takeover2 := public.admin_takeover_free_device(
    v_license_key, v_username, v_password,
    'p5-cycle2-removed-' || v_suffix, 'Cycle 2 removed device',
    '{"fixture":"phase5-cycle-2"}'::jsonb
  );
  if coalesce((v_takeover2->>'success')::boolean, false) is not true
     or v_takeover2->>'code' <> 'FREE_DEVICE_TAKEOVER_SUCCESS'
     or not exists (
       select 1 from public.license_events e
        where e.license_key = v_license_key
          and e.event_type = 'FREE_PRIMARY_DEVICE_TAKEOVER'
          and e.metadata->>'new_device_id' = v_device_cycle2::text
          and e.metadata->>'downgrade_event_id' = v_cycle2_recovery_event::text
          and e.metadata->>'downgrade_event_id' <> v_cycle1_recovery_event::text
          and e.metadata->>'result' = 'success'
     ) then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_TAKEOVER_REUSED_OLD_EVIDENCE: %', v_takeover2;
  end if;

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, 'p5-cycle2-removed-' || v_suffix,
    v_takeover2->>'device_security_token',
    v_takeover2->>'admin_session_token'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 1
     or not exists (
       select 1 from jsonb_array_elements(v_result->'cash_sessions') x
        where x->>'id' = v_cash_cycle2
     )
     or exists (
       select 1 from jsonb_array_elements(v_result->'cash_sessions') x
        where x->>'id' = v_cash_cycle1
     ) then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_CASH_BOUNDARY_MIXED: %', v_result;
  end if;

  select to_jsonb(c) into v_result from public.pos_cash_sessions c where c.id = v_cash_cycle2;
  if v_result is distinct from v_cash2_before
     or v_result->>'status' <> 'open'
     or v_result->>'closing_counted_amount' is not null
     or v_result->>'cash_difference' is not null
     or (select coalesce((features->>'cloud_cash_sync')::boolean, true)
           from public.licenses where id = v_license) is not false then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_DOWNGRADE_CHANGED_CASH_OR_FEATURE';
  end if;

  select expected_cash_total, server_version into v_expected_amount, v_expected_version
    from public.pos_cash_sessions where id = v_cash_cycle2;
  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, 'p5-cycle2-removed-' || v_suffix,
    v_takeover2->>'device_security_token', v_takeover2->>'admin_session_token',
    v_cash_cycle2, 'admin_audited', v_expected_amount, 0,
    'historical_test', 'Explicit synthetic owner reconciliation, cycle 2.',
    v_expected_version, 'p5-cycle2-close-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result#>>'{cash_session,status}' <> 'closed'
     or (v_result#>>'{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_EXPLICIT_CLOSE_FAILED: %', v_result;
  end if;
  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, 'p5-cycle2-removed-' || v_suffix,
    v_takeover2->>'device_security_token',
    v_takeover2->>'admin_session_token'
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_LIFECYCLE_CYCLE2_PENDING_COUNT_STALE: %', v_result;
  end if;

  -- Tenant B remains byte-for-byte unchanged across Tenant A's two cycles.
  if (select to_jsonb(l) from public.licenses l where l.id = v_other_license) is distinct from v_license_before
     or (select to_jsonb(d) from public.license_devices d where d.id = v_other_device) is distinct from v_device_before
     or (select to_jsonb(s) from public.license_admin_sessions s
          where s.license_id = v_other_license and s.device_id = v_other_device
          order by s.created_at desc limit 1) is distinct from v_session_before
     or (select to_jsonb(c) from public.pos_cash_sessions c where c.id = v_other_cash) is distinct from v_other_cash_before then
    raise exception 'FINAL_LIFECYCLE_CROSS_TENANT_STATE_CHANGED';
  end if;

  if (select count(*) from public.license_devices where license_id = v_license and is_active)
       > (select max_devices from public.licenses where id = v_license)
     or (select count(*) from public.license_admin_sessions s
          join public.license_devices d on d.id = s.device_id
         where s.license_id = v_license and s.revoked_at is null and s.expires_at > now()
           and d.is_active is false) <> 0 then
    raise exception 'FINAL_LIFECYCLE_FINAL_DEVICE_SESSION_INVARIANT_FAILED';
  end if;
end;
$test$;

rollback;
