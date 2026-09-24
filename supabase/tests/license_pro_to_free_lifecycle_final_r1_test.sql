-- LICENSE.PRO_FREE.LIFECYCLE.FINAL.R1
-- Cross-phase certification for the Pro -> grace -> Free -> owner recovery ->
-- historical cash reconciliation -> Pro -> Free second-cycle lifecycle.
-- Synthetic fixtures only. This script MUST be executed as one transaction.
begin;

do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text), 1, 12));
  v_license uuid := extensions.gen_random_uuid();
  v_other_license uuid := extensions.gen_random_uuid();
  v_owner uuid := extensions.gen_random_uuid();
  v_other_owner uuid := extensions.gen_random_uuid();
  v_staff uuid := extensions.gen_random_uuid();
  v_device_a uuid := extensions.gen_random_uuid();
  v_device_b uuid := extensions.gen_random_uuid();
  v_device_c uuid := extensions.gen_random_uuid();
  v_other_device uuid := extensions.gen_random_uuid();
  v_pro_plan uuid;
  v_free_plan uuid;
  v_pro_max integer;
  v_password text := 'FinalLifecycle123!';
  v_license_key text := 'FINAL-LIFECYCLE-' || v_suffix;
  v_other_key text := 'FINAL-DIRECT-FREE-' || v_suffix;
  v_owner_username text := 'owner_' || v_suffix;
  v_other_username text := 'other_' || v_suffix;
  v_fp_a text := 'final-a-' || v_suffix;
  v_fp_b text := 'final-b-' || v_suffix;
  v_fp_c text := 'final-c-' || v_suffix;
  v_other_fp text := 'final-other-' || v_suffix;
  v_session_a jsonb;
  v_session_b jsonb;
  v_other_session jsonb;
  v_result jsonb;
  v_retry jsonb;
  v_takeover_security text;
  v_takeover_session text;
  v_takeover_security_2 text;
  v_takeover_session_2 text;
  v_removed_fp_2 text;
  v_evidence_1 jsonb;
  v_evidence_2 jsonb;
  v_cash_before jsonb;
  v_cash_after jsonb;
  v_other_license_before jsonb;
  v_other_license_after jsonb;
  v_other_device_before jsonb;
  v_other_device_after jsonb;
  v_other_cash_before jsonb;
  v_other_cash_after jsonb;
  v_entitlement record;
  v_count integer;
  v_opened_1 timestamptz := now() - interval '6 days';
  v_opened_2 timestamptz;
begin
  select id, max_devices
    into v_pro_plan, v_pro_max
  from public.plans
  where code = 'pro_monthly' and is_active
  limit 1;

  select id into v_free_plan
  from public.plans
  where code = 'free_trial' and is_active
  limit 1;

  if v_pro_plan is null or v_free_plan is null then
    raise exception 'FINAL_LIFECYCLE_PLANS_MISSING';
  end if;

  -- Tenant A starts as a normal active Pro with two Admin devices and Staff.
  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at, is_lifetime,
    duration_months, max_devices, features, product_name
  ) values (
    v_license, v_license_key, v_pro_plan, 'subscription', 'active',
    now() + interval '30 days', false, 1, coalesce(v_pro_max, 5), '{}'::jsonb,
    'Final lifecycle synthetic Pro'
  );

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license, v_pro_plan, 'pro_monthly', 'Lanzo Nube',
    'pro_paid', 'active', now() - interval '30 days', now() + interval '30 days',
    15, '{"fixture":"final-lifecycle-r1"}'::jsonb
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_owner, v_license, v_owner_username, 'Final Owner',
    extensions.crypt(v_password, extensions.gen_salt('bf', 4)), true, true
  );

  insert into public.license_staff_users (
    id, license_id, username, display_name, password_hash, role_name, metadata
  ) values (
    v_staff, v_license, 'staff_' || v_suffix, 'Final Staff',
    extensions.crypt('StaffFinal123!', extensions.gen_salt('bf', 4)),
    'staff', '{"fixture":"final-lifecycle-r1"}'::jsonb
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, is_active,
    activated_at, last_used_at, security_token, previous_security_token,
    device_role, device_mode
  ) values
    (
      v_device_a, v_license, v_fp_a, 'Final A', true,
      now() - interval '20 days', now() - interval '2 days',
      'final-a-token-' || v_suffix, 'final-a-prev-' || v_suffix,
      'admin', 'admin_only'
    ),
    (
      v_device_b, v_license, v_fp_b, 'Final B', true,
      now() - interval '10 days', now() - interval '1 day',
      'final-b-token-' || v_suffix, 'final-b-prev-' || v_suffix,
      'admin', 'admin_only'
    );

  v_session_a := private.create_admin_session(v_license, v_owner, v_device_a, 'Final A');
  v_session_b := private.create_admin_session(v_license, v_owner, v_device_b, 'Final B');

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at, metadata
  ) values (
    v_license, v_staff, v_device_b,
    extensions.crypt('final-staff-session-' || v_suffix, extensions.gen_salt('bf', 4)),
    now() + interval '1 hour', '{"fixture":"final-lifecycle-r1"}'::jsonb
  );

  -- Canonical opening-plan history for a Cloud Cash session.
  insert into public.license_events (license_key, event_type, triggered_at, metadata)
  values (
    v_license_key, 'PLAN_CHANGED', now() - interval '20 days',
    jsonb_build_object(
      'source', 'licenses_update_trigger',
      'from_plan', 'free_trial',
      'to_plan', 'pro_monthly'
    )
  );

  insert into public.pos_cash_sessions (
    id, license_id, device_id, admin_user_id, device_role, scope, actor_key,
    status, opened_at, opening_amount, expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_actor_key, server_version, metadata
  ) values (
    'final-cash-cycle1-' || v_suffix, v_license, v_device_a, v_owner,
    'admin', 'actor', 'admin:' || v_owner::text, 'open', v_opened_1,
    100, 100, 'Final Owner', v_device_a, 'admin:' || v_owner::text, 1,
    '{"fixture":"final-lifecycle-r1","cycle":1}'::jsonb
  );

  perform private.record_pos_cash_event(
    v_license, 'final-cash-cycle1-' || v_suffix, 'OPENED',
    v_device_a, null, 'Final Owner',
    jsonb_build_object('actor_key', 'admin:' || v_owner::text)
  );
  perform private.record_pos_sync_event(
    v_license, 'cash_session', 'final-cash-cycle1-' || v_suffix, 'open',
    v_device_a, null, 'final-open-cycle1-' || v_suffix,
    jsonb_build_object('cash_session_id', 'final-cash-cycle1-' || v_suffix), 1
  );

  select * into v_entitlement from private.license_entitlement_state_v1(v_license);
  if v_entitlement.lifecycle_state <> 'active'
     or v_entitlement.is_entitled is not true
     or coalesce((v_entitlement.effective_features->>'cloud_cash_sync')::boolean, false) is not true then
    raise exception 'FINAL_NORMAL_PRO_CONTRACT_FAILED: %', row_to_json(v_entitlement);
  end if;

  -- Normal Pro has no post-downgrade bridge.
  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_fp_a, 'final-a-token-' || v_suffix, v_session_a->>'session_token'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_NORMAL_PRO_BRIDGE_VISIBLE: %', v_result;
  end if;

  -- Exact grace boundary: equality remains grace; one microsecond beyond is expired.
  update public.licenses
  set expires_at = now() - interval '7 days'
  where id = v_license;

  select * into v_entitlement from private.license_entitlement_state_v1(v_license);
  if v_entitlement.lifecycle_state <> 'grace_period'
     or v_entitlement.is_entitled is not true
     or v_entitlement.grace_period_ends <> now() then
    raise exception 'FINAL_GRACE_BOUNDARY_FAILED: %', row_to_json(v_entitlement);
  end if;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if v_result->>'code' <> 'LICENSE_IN_GRACE'
     or coalesce((v_result->>'changed')::boolean, true) is not false then
    raise exception 'FINAL_PREMATURE_DOWNGRADE_AT_BOUNDARY: %', v_result;
  end if;

  update public.licenses
  set expires_at = now() - interval '7 days 1 microsecond'
  where id = v_license;

  select * into v_entitlement from private.license_entitlement_state_v1(v_license);
  if v_entitlement.lifecycle_state <> 'expired'
     or v_entitlement.is_entitled is not false then
    raise exception 'FINAL_GRACE_END_FAILED: %', row_to_json(v_entitlement);
  end if;

  select to_jsonb(c) into v_cash_before
  from public.pos_cash_sessions c
  where c.id = 'final-cash-cycle1-' || v_suffix;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE'
     or coalesce((v_result->>'changed')::boolean, false) is not true then
    raise exception 'FINAL_MATERIALIZATION_FAILED: %', v_result;
  end if;

  if (select count(*) from public.license_devices where license_id=v_license and is_active) > 1
     or exists (
       select 1 from public.license_staff_sessions
       where license_id=v_license and revoked_at is null and expires_at > now()
     )
     or exists (
       select 1 from public.license_admin_sessions s
       join public.license_devices d on d.id=s.device_id
       where s.license_id=v_license and s.revoked_at is null and s.expires_at > now()
         and d.is_active is false
     ) then
    raise exception 'FINAL_DOWNGRADE_DEVICE_SESSION_INVARIANT_FAILED';
  end if;

  select to_jsonb(c) into v_cash_after
  from public.pos_cash_sessions c
  where c.id = 'final-cash-cycle1-' || v_suffix;
  if v_cash_after is distinct from v_cash_before then
    raise exception 'FINAL_DOWNGRADE_MUTATED_FINANCE';
  end if;

  v_evidence_1 := private.resolve_free_device_takeover_evidence_v1(v_license_key);
  if v_evidence_1 is null then
    raise exception 'FINAL_TAKEOVER_EVIDENCE_CYCLE1_MISSING';
  end if;

  -- The deterministic survivor is A for this fixture; B was pruned by the plan limit.
  if not exists (
    select 1 from public.license_devices
    where id=v_device_b and is_active=false
      and device_info #>> '{license_block,reason}'='PLAN_DOWNGRADE_DEVICE_LIMIT'
      and security_token is null and previous_security_token is null
  ) then
    raise exception 'FINAL_EXPECTED_PRUNED_DEVICE_MISSING';
  end if;

  v_result := public.admin_login_on_device(
    v_license_key, v_owner_username, v_password, v_fp_b, 'Final B', '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_REQUIRED' then
    raise exception 'FINAL_TAKEOVER_NOT_OFFERED: %', v_result;
  end if;

  v_result := public.admin_takeover_free_device(
    v_license_key, v_owner_username, v_password, v_fp_b, 'Final B',
    '{"fixture":"final-lifecycle-r1","cycle":1}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_SUCCESS'
     or (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1
     or not exists(select 1 from public.license_devices where id=v_device_b and is_active) then
    raise exception 'FINAL_TAKEOVER_CYCLE1_FAILED: %', v_result;
  end if;

  v_takeover_security := v_result->>'device_security_token';
  v_takeover_session := v_result->>'admin_session_token';

  v_retry := public.admin_takeover_free_device(
    v_license_key, v_owner_username, v_password, v_fp_b, 'Final B',
    '{"fixture":"final-lifecycle-r1","cycle":1,"retry":true}'::jsonb
  );
  if coalesce((v_retry->>'success')::boolean, false) is not true
     or coalesce((v_retry->>'idempotent_retry')::boolean, false) is not true
     or (select count(*) from public.license_events
         where license_key=v_license_key and event_type='FREE_PRIMARY_DEVICE_TAKEOVER'
           and metadata->>'downgrade_event_id'=v_evidence_1->>'event_id') <> 1 then
    raise exception 'FINAL_TAKEOVER_RETRY_FAILED: %', v_retry;
  end if;
  -- Retry rotates the winning device/session credentials, so use the latest values.
  v_takeover_security := v_retry->>'device_security_token';
  v_takeover_session := v_retry->>'admin_session_token';

  -- Simulate the fact that lifecycle cycles occur in separate production
  -- transactions while keeping this certification file rollback-only. license_events
  -- defaults triggered_at to transaction-stable now(), so move cycle-1 transition
  -- evidence into the past before the synthetic upgrade/cycle-2 sequence.
  update public.license_events
  set triggered_at = now() - interval '2 days'
  where license_key = v_license_key
    and (
      (event_type = 'PLAN_CHANGED'
        and metadata->>'source' = 'licenses_update_trigger'
        and metadata->>'to_plan' = 'free_trial')
      or (event_type = 'LICENSE_UPDATE'
        and metadata->>'source' = 'enforce_license_plan_limits_after_change'
        and metadata->>'plan' = 'free_trial')
      or event_type in ('PLAN_EXPIRED_DOWNGRADED_TO_FREE','FREE_PRIMARY_DEVICE_TAKEOVER')
    );

  -- The displaced pre-downgrade device/session/token no longer has authority.
  v_result := public.verify_admin_session(
    v_license_key, v_fp_a, 'final-a-token-' || v_suffix, v_session_a->>'session_token'
  );
  if coalesce((v_result->>'success')::boolean, false) is true
     or coalesce((v_result->>'valid')::boolean, false) is true then
    raise exception 'FINAL_DISPLACED_TOKEN_RETAINED_AUTHORITY: %', v_result;
  end if;

  -- Before explicit close, takeover still must not alter the financial row.
  select to_jsonb(c) into v_cash_after
  from public.pos_cash_sessions c
  where c.id = 'final-cash-cycle1-' || v_suffix;
  if v_cash_after is distinct from v_cash_before then
    raise exception 'FINAL_TAKEOVER_MUTATED_FINANCE';
  end if;

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_fp_b, v_takeover_security, v_takeover_session
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 1
     or not exists (
       select 1 from jsonb_array_elements(v_result->'cash_sessions') x
       where x->>'id'='final-cash-cycle1-' || v_suffix
     ) then
    raise exception 'FINAL_PENDING_CYCLE1_FAILED: %', v_result;
  end if;

  v_result := public.pos_close_post_downgrade_cash_session(
    v_license_key, v_fp_b, v_takeover_security, v_takeover_session,
    'final-cash-cycle1-' || v_suffix, 'admin_audited', 100, 0,
    'abandoned_session', 'Synthetic final lifecycle reconciliation.', 1,
    'final-close-cycle1-' || v_suffix
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result #>> '{cash_session,status}' <> 'closed'
     or (v_result #>> '{cash_session,cash_difference}')::numeric <> 0 then
    raise exception 'FINAL_CASH_CLOSE_CYCLE1_FAILED: %', v_result;
  end if;

  v_retry := public.pos_close_post_downgrade_cash_session(
    v_license_key, v_fp_b, v_takeover_security, v_takeover_session,
    'final-cash-cycle1-' || v_suffix, 'admin_audited', 100, 0,
    'abandoned_session', 'Synthetic final lifecycle reconciliation.', 1,
    'final-close-cycle1-' || v_suffix
  );
  if coalesce((v_retry->>'success')::boolean, false) is not true
     or (select count(*) from public.pos_cash_audit_events
         where license_id=v_license
           and cash_session_id='final-cash-cycle1-' || v_suffix
           and payload->>'reconciliation_source'='POST_DOWNGRADE_CASH_RECONCILIATION') <> 1 then
    raise exception 'FINAL_CASH_IDEMPOTENCY_FAILED: %', v_retry;
  end if;

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_fp_b, v_takeover_security, v_takeover_session
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_PENDING_NOT_CLEARED_AFTER_EXPLICIT_CLOSE: %', v_result;
  end if;

  -- Upgrade through the canonical restoration primitive.
  v_result := private.materialize_license_upgrade_v1(
    v_license, 'pro_monthly', 1, 'final lifecycle cycle 1 upgrade',
    jsonb_build_object('type','test','subject','final-lifecycle-r1')
  );
  if v_result->>'code' <> 'LICENSE_UPGRADED_TO_PAID'
     or coalesce((v_result->>'changed')::boolean, false) is not true then
    raise exception 'FINAL_FREE_TO_PRO_FAILED: %', v_result;
  end if;

  select * into v_entitlement from private.license_entitlement_state_v1(v_license);
  if v_entitlement.lifecycle_state <> 'active'
     or v_entitlement.plan_code <> 'pro_monthly'
     or coalesce((v_entitlement.effective_features->>'cloud_cash_sync')::boolean, false) is not true then
    raise exception 'FINAL_UPGRADE_ENTITLEMENT_FAILED: %', row_to_json(v_entitlement);
  end if;

  if private.resolve_free_device_takeover_evidence_v1(v_license_key) is not null then
    raise exception 'FINAL_CYCLE1_TAKEOVER_EVIDENCE_SURVIVED_UPGRADE';
  end if;

  if (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1
     or not exists(select 1 from public.license_devices where id=v_device_b and is_active)
     or exists(select 1 from public.license_devices where id=v_device_a and is_active) then
    raise exception 'FINAL_UPGRADE_REACTIVATED_DISPLACED_DEVICE';
  end if;

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_fp_b, v_takeover_security, v_takeover_session
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_BRIDGE_SURVIVED_UPGRADE: %', v_result;
  end if;

  -- Cycle 2: add one legitimate Pro device, open a new Cloud Cash session, then
  -- expire again. Old takeover/cash evidence must not authorize the new cycle.
  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, is_active,
    activated_at, last_used_at, security_token, previous_security_token,
    device_role, device_mode
  ) values (
    v_device_c, v_license, v_fp_c, 'Final C', true,
    now(), now(), 'final-c-token-' || v_suffix, 'final-c-prev-' || v_suffix,
    'admin', 'admin_only'
  );

  perform private.create_admin_session(v_license, v_owner, v_device_c, 'Final C');

  insert into public.license_staff_sessions (
    license_id, staff_user_id, device_id, session_token_hash, expires_at, metadata
  ) values (
    v_license, v_staff, v_device_c,
    extensions.crypt('cycle2-staff-' || v_suffix, extensions.gen_salt('bf', 4)),
    now() + interval '1 hour', '{"fixture":"final-lifecycle-r1","cycle":2}'::jsonb
  );

  v_opened_2 := clock_timestamp();

  insert into public.pos_cash_sessions (
    id, license_id, device_id, admin_user_id, device_role, scope, actor_key,
    status, opened_at, opening_amount, expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_actor_key, server_version, metadata
  ) values (
    'final-cash-cycle2-' || v_suffix, v_license, v_device_b, v_owner,
    'admin', 'actor', 'admin:' || v_owner::text, 'open', v_opened_2,
    40, 40, 'Final Owner', v_device_b, 'admin:' || v_owner::text, 1,
    '{"fixture":"final-lifecycle-r1","cycle":2}'::jsonb
  );

  perform private.record_pos_cash_event(
    v_license, 'final-cash-cycle2-' || v_suffix, 'OPENED',
    v_device_b, null, 'Final Owner',
    jsonb_build_object('actor_key', 'admin:' || v_owner::text)
  );
  perform private.record_pos_sync_event(
    v_license, 'cash_session', 'final-cash-cycle2-' || v_suffix, 'open',
    v_device_b, null, 'final-open-cycle2-' || v_suffix,
    jsonb_build_object('cash_session_id', 'final-cash-cycle2-' || v_suffix), 1
  );

  update public.licenses
  set expires_at = now() - interval '8 days'
  where id = v_license;

  v_result := private.materialize_expired_license_to_free_v1(v_license);
  if v_result->>'code' <> 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
    raise exception 'FINAL_SECOND_DOWNGRADE_FAILED: %', v_result;
  end if;

  v_evidence_2 := private.resolve_free_device_takeover_evidence_v1(v_license_key);
  if v_evidence_2 is null
     or v_evidence_2->>'event_id' = v_evidence_1->>'event_id' then
    raise exception 'FINAL_SECOND_CYCLE_TAKEOVER_EVIDENCE_NOT_FRESH: old %, new %', v_evidence_1, v_evidence_2;
  end if;

  if (select count(*) from public.license_devices where license_id=v_license and is_active) > 1
     or exists (
       select 1 from public.license_staff_sessions
       where license_id=v_license and revoked_at is null and expires_at > now()
     ) then
    raise exception 'FINAL_SECOND_CYCLE_DEVICE_SESSION_INVARIANT_FAILED';
  end if;

  if private.post_downgrade_cash_session_evidence_v1(
       v_license, 'final-cash-cycle2-' || v_suffix
     ) is null then
    raise exception 'FINAL_SECOND_CYCLE_CASH_EVIDENCE_MISSING';
  end if;

  if private.post_downgrade_cash_session_evidence_v1(
       v_license, 'final-cash-cycle1-' || v_suffix
     ) is not null then
    raise exception 'FINAL_CLOSED_CYCLE1_CASH_REAPPEARED';
  end if;

  select d.device_fingerprint
    into v_removed_fp_2
  from public.license_devices d
  where d.license_id=v_license
    and d.is_active=false
    and d.device_info #>> '{license_block,reason}'='PLAN_DOWNGRADE_DEVICE_LIMIT'
  order by d.last_used_at desc nulls last, d.id
  limit 1;

  if v_removed_fp_2 is null then
    raise exception 'FINAL_SECOND_CYCLE_PRUNED_DEVICE_MISSING';
  end if;

  v_result := public.admin_login_on_device(
    v_license_key, v_owner_username, v_password, v_removed_fp_2,
    'Final second-cycle recovery', '{}'::jsonb
  );
  if v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_REQUIRED' then
    raise exception 'FINAL_SECOND_CYCLE_TAKEOVER_NOT_OFFERED: %', v_result;
  end if;

  v_result := public.admin_takeover_free_device(
    v_license_key, v_owner_username, v_password, v_removed_fp_2,
    'Final second-cycle recovery',
    '{"fixture":"final-lifecycle-r1","cycle":2}'::jsonb
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or v_result->>'code' <> 'FREE_DEVICE_TAKEOVER_SUCCESS'
     or (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1 then
    raise exception 'FINAL_SECOND_CYCLE_TAKEOVER_FAILED: %', v_result;
  end if;

  v_takeover_security_2 := v_result->>'device_security_token';
  v_takeover_session_2 := v_result->>'admin_session_token';

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_license_key, v_removed_fp_2, v_takeover_security_2, v_takeover_session_2
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 1
     or not exists (
       select 1 from jsonb_array_elements(v_result->'cash_sessions') x
       where x->>'id'='final-cash-cycle2-' || v_suffix
     ) then
    raise exception 'FINAL_SECOND_CYCLE_PENDING_MISMATCH: %', v_result;
  end if;

  -- Direct Free tenant: no historical bridge and no takeover without downgrade evidence.
  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at, is_lifetime,
    max_devices, features, product_name
  ) values (
    v_other_license, v_other_key, v_free_plan, 'free', 'active', null, true,
    1, '{}'::jsonb, 'Final direct Free tenant'
  );

  insert into public.license_admin_users (
    id, license_id, username, display_name, password_hash, is_owner, is_active
  ) values (
    v_other_owner, v_other_license, v_other_username, 'Other Owner',
    extensions.crypt(v_password, extensions.gen_salt('bf', 4)), true, true
  );

  insert into public.license_devices (
    id, license_id, device_fingerprint, device_name, is_active,
    security_token, device_role, device_mode
  ) values (
    v_other_device, v_other_license, v_other_fp, 'Other Free', true,
    'other-security-' || v_suffix, 'admin', 'admin_only'
  );

  v_other_session := private.create_admin_session(
    v_other_license, v_other_owner, v_other_device, 'Other Free'
  );

  insert into public.pos_cash_sessions (
    id, license_id, device_id, admin_user_id, device_role, scope, actor_key,
    status, opened_at, opening_amount, expected_cash_total, responsible_name,
    opened_by_device_id, opened_by_actor_key, server_version
  ) values (
    'other-free-cash-' || v_suffix, v_other_license, v_other_device, v_other_owner,
    'admin', 'actor', 'admin:' || v_other_owner::text, 'open', now(),
    5, 5, 'Other Owner', v_other_device, 'admin:' || v_other_owner::text, 1
  );

  v_result := public.pos_list_post_downgrade_cash_sessions(
    v_other_key, v_other_fp, 'other-security-' || v_suffix,
    v_other_session->>'session_token'
  );
  if coalesce((v_result->>'pending_count')::integer, -1) <> 0 then
    raise exception 'FINAL_DIRECT_FREE_BRIDGE_VISIBLE: %', v_result;
  end if;

  v_result := public.admin_login_on_device(
    v_other_key, v_other_username, v_password,
    'other-second-device-' || v_suffix, 'Other second', '{}'::jsonb
  );
  if v_result->>'code' <> 'DEVICE_LIMIT_REACHED' then
    raise exception 'FINAL_DIRECT_FREE_TAKEOVER_WRONGLY_OFFERED: %', v_result;
  end if;

  if private.resolve_free_device_takeover_evidence_v1(v_other_key) is not null then
    raise exception 'FINAL_DIRECT_FREE_HAS_TAKEOVER_EVIDENCE';
  end if;

  -- Snapshot unrelated Tenant B after its own checks; subsequent Tenant A
  -- assertions must leave these durable rows semantically untouched.
  select to_jsonb(l) into v_other_license_before
  from public.licenses l where l.id=v_other_license;
  select to_jsonb(d) into v_other_device_before
  from public.license_devices d where d.id=v_other_device;
  select to_jsonb(c) into v_other_cash_before
  from public.pos_cash_sessions c where c.id='other-free-cash-' || v_suffix;

  -- Retry the second materializer after it is already Free: stable NOOP.
  v_retry := private.materialize_expired_license_to_free_v1(v_license);
  if v_retry->>'code' <> 'ALREADY_FREE'
     or coalesce((v_retry->>'changed')::boolean, true) is not false
     or (select count(*) from public.license_devices where license_id=v_license and is_active) <> 1 then
    raise exception 'FINAL_SECOND_CYCLE_MATERIALIZER_RETRY_FAILED: %', v_retry;
  end if;

  select to_jsonb(l) into v_other_license_after
  from public.licenses l where l.id=v_other_license;
  select to_jsonb(d) into v_other_device_after
  from public.license_devices d where d.id=v_other_device;
  select to_jsonb(c) into v_other_cash_after
  from public.pos_cash_sessions c where c.id='other-free-cash-' || v_suffix;

  if v_other_license_after is distinct from v_other_license_before
     or v_other_device_after is distinct from v_other_device_before
     or v_other_cash_after is distinct from v_other_cash_before then
    raise exception 'FINAL_CROSS_TENANT_MUTATION_DETECTED';
  end if;

  -- Final current-Free invariants for Tenant A.
  if not exists (
    select 1
    from public.licenses l
    join public.plans p on p.id=l.plan_id
    where l.id=v_license and l.status='active' and p.code='free_trial'
      and coalesce((l.features->>'cloud_cash_sync')::boolean,
                   (p.features->>'cloud_cash_sync')::boolean,false) is false
  ) then
    raise exception 'FINAL_FREE_FEATURE_INVARIANT_FAILED';
  end if;

  select count(*) into v_count
  from public.license_events
  where license_key=v_license_key
    and event_type='PLAN_EXPIRED_DOWNGRADED_TO_FREE';
  if v_count <> 2 then
    raise exception 'FINAL_EXPECTED_TWO_DOWNGRADE_EVENTS: %', v_count;
  end if;
end;
$test$;

rollback;
