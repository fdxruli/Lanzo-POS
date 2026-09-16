-- LICENSE.LIFECYCLE.3
-- Transactional production-safe matrix. Every fixture and scheduler run rolls back.
begin;

do $test$
declare
  v_pro_plan uuid;
  v_free_plan uuid;
  v_isolation_run uuid := extensions.gen_random_uuid();
  v_active uuid := extensions.gen_random_uuid();
  v_grace uuid := extensions.gen_random_uuid();
  v_blocked uuid := extensions.gen_random_uuid();
  v_free uuid := extensions.gen_random_uuid();
  v_expired uuid := extensions.gen_random_uuid();
  v_failure uuid := extensions.gen_random_uuid();
  v_healthy_after_failure uuid := extensions.gen_random_uuid();
  v_gary_before jsonb;
  v_gary_after jsonb;
  v_result jsonb;
  v_run_id uuid;
  v_license_id uuid;
  v_count integer;
begin
  select id into v_pro_plan from public.plans where code = 'pro_monthly' and is_active limit 1;
  select id into v_free_plan from public.plans where code = 'free_trial' and is_active limit 1;
  if v_pro_plan is null or v_free_plan is null then
    raise exception 'LICENSE.LIFECYCLE.3 requires active pro_monthly and free_trial plans';
  end if;

  select to_jsonb(x) into v_gary_before
  from (
    select l.id, l.plan_id, l.status, l.expires_at, l.is_lifetime,
           e.lifecycle_state, e.is_entitled, e.grace_period_ends
    from public.licenses l
    cross join lateral private.license_entitlement_state_v1(l.id) e
    where l.id = 'dd047a26-130a-4d8f-8e1b-404fac48f111'::uuid
  ) x;

  -- Isolate this transactional matrix from any legitimate production backlog
  -- without changing a production license. Recent failure rows make only those
  -- pre-existing candidates cool down until this transaction rolls back.
  insert into private.license_lifecycle_scheduler_runs (
    run_id, started_at, finished_at, status, batch_limit
  ) values (
    v_isolation_run, now(), now(), 'completed_with_errors', 25
  );

  insert into private.license_lifecycle_scheduler_run_items (
    run_id, license_id, result_code, error_code, error_message
  )
  select v_isolation_run, l.id, 'FAILED', 'TEST0', 'Transactional test isolation.'
  from public.licenses l
  join public.plans p on p.id = l.plan_id
  cross join lateral private.license_entitlement_state_v1(l.id) e
  where lower(coalesce(l.status::text, '')) = 'active'
    and coalesce(l.is_lifetime, false) is false
    and p.code <> 'free_trial'
    and coalesce(p.price, 0) > 0
    and e.lifecycle_state = 'expired'
    and e.is_entitled is false;

  v_result := private.materialize_expired_licenses_batch_v1(25);
  if v_result->>'status' <> 'succeeded'
     or (v_result->>'candidates_seen')::integer <> 0
     or (v_result->>'downgraded')::integer <> 0
     or (v_result->>'failed')::integer <> 0 then
    raise exception 'Case A: empty batch mismatch: %', v_result;
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name, organization_name
  ) values
    (v_active, 'LIFECYCLE-R3-ACTIVE-' || v_active, v_pro_plan, 'subscription', 'active', now() + interval '1 day', false, 1, 5, '{}'::jsonb, 'Active', 'LIFECYCLE-R3-ACTIVE'),
    (v_grace, 'LIFECYCLE-R3-GRACE-' || v_grace, v_pro_plan, 'subscription', 'active', now() - interval '3 days', false, 1, 5, '{}'::jsonb, 'Grace', 'LIFECYCLE-R3-GRACE'),
    (v_blocked, 'LIFECYCLE-R3-BLOCKED-' || v_blocked, v_pro_plan, 'subscription', 'suspended', now() - interval '20 days', false, 1, 5, '{}'::jsonb, 'Blocked', 'LIFECYCLE-R3-BLOCKED'),
    (v_free, 'LIFECYCLE-R3-FREE-' || v_free, v_free_plan, 'free', 'active', null, true, null, 1, '{}'::jsonb, 'Lanzo POS Free', 'LIFECYCLE-R3-FREE');

  v_result := private.materialize_expired_licenses_batch_v1(25);
  if (v_result->>'candidates_seen')::integer <> 0
     or not exists (select 1 from public.licenses where id = v_active and plan_id = v_pro_plan)
     or not exists (select 1 from public.licenses where id = v_grace and plan_id = v_pro_plan) then
    raise exception 'Cases B/C: active or grace license entered the batch: %', v_result;
  end if;
  if not exists (select 1 from public.licenses where id = v_blocked and plan_id = v_pro_plan)
     or not exists (select 1 from public.licenses where id = v_free and plan_id = v_free_plan and is_lifetime) then
    raise exception 'Cases J/K: blocked or Free lifetime license changed';
  end if;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name, organization_name
  ) values (
    v_expired, 'LIFECYCLE-R3-EXPIRED-' || v_expired, v_pro_plan, 'subscription', 'active',
    now() - interval '20 days', false, 1, 5, '{}'::jsonb, 'Expired', 'LIFECYCLE-R3-EXPIRED'
  );

  v_result := private.materialize_expired_licenses_batch_v1(25);
  v_run_id := (v_result->>'run_id')::uuid;
  if (v_result->>'status') <> 'succeeded'
     or (v_result->>'candidates_seen')::integer <> 1
     or (v_result->>'downgraded')::integer <> 1
     or (v_result->>'failed')::integer <> 0
     or not exists (
       select 1 from public.licenses l join public.plans p on p.id = l.plan_id
       where l.id = v_expired and p.code = 'free_trial'
         and l.is_lifetime is true and l.expires_at is null
     ) then
    raise exception 'Case D: expired transition mismatch: %', v_result;
  end if;
  if not exists (
    select 1 from private.license_lifecycle_scheduler_runs
    where run_id = v_run_id and status = 'succeeded'
      and candidates_seen = 1 and downgraded_count = 1 and failed_count = 0
  ) then
    raise exception 'Run observability mismatch for successful transition';
  end if;

  if (select count(*) from public.pos_notifications
      where license_id = v_expired
        and metadata->>'event' = 'license_plan_downgraded_to_free'
        and target_scope = 'admin') <> 1 then
    raise exception 'Case L: expected exactly one Admin transition notification';
  end if;
  if (select count(*) from public.license_events
      where license_key = 'LIFECYCLE-R3-EXPIRED-' || v_expired
        and event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE') <> 1 then
    raise exception 'Case N: expected exactly one Phase 2 transition event';
  end if;

  v_result := private.materialize_expired_licenses_batch_v1(25);
  if (v_result->>'candidates_seen')::integer <> 0
     or (select count(*) from public.pos_notifications
         where license_id = v_expired
           and metadata->>'event' = 'license_plan_downgraded_to_free') <> 1
     or (select count(*) from public.license_events
         where license_key = 'LIFECYCLE-R3-EXPIRED-' || v_expired
           and event_type = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE') <> 1 then
    raise exception 'Cases E/M: retry duplicated transition or notification: %', v_result;
  end if;

  -- Case F: three expired licenses fit in one bounded run.
  for v_count in 1..3 loop
    v_license_id := extensions.gen_random_uuid();
    insert into public.licenses (
      id, license_key, plan_id, license_type, status, expires_at,
      is_lifetime, duration_months, max_devices, features, product_name, organization_name
    ) values (
      v_license_id, 'LIFECYCLE-R3-THREE-' || v_license_id, v_pro_plan, 'subscription', 'active',
      now() - interval '19 days' + (v_count || ' seconds')::interval,
      false, 1, 5, '{}'::jsonb, 'Batch three', 'LIFECYCLE-R3-THREE'
    );
  end loop;
  v_result := private.materialize_expired_licenses_batch_v1(25);
  if (v_result->>'candidates_seen')::integer <> 3
     or (v_result->>'downgraded')::integer <> 3 then
    raise exception 'Case F: expected three transitions: %', v_result;
  end if;

  -- Case G: limit three, then continue remaining two in deterministic order.
  for v_count in 1..5 loop
    v_license_id := extensions.gen_random_uuid();
    insert into public.licenses (
      id, license_key, plan_id, license_type, status, expires_at,
      is_lifetime, duration_months, max_devices, features, product_name, organization_name
    ) values (
      v_license_id, 'LIFECYCLE-R3-LIMIT-' || v_license_id, v_pro_plan, 'subscription', 'active',
      now() - interval '18 days' + (v_count || ' seconds')::interval,
      false, 1, 5, '{}'::jsonb, 'Batch limit', 'LIFECYCLE-R3-LIMIT'
    );
  end loop;
  v_result := private.materialize_expired_licenses_batch_v1(3);
  if (v_result->>'candidates_seen')::integer <> 3
     or (v_result->>'downgraded')::integer <> 3 then
    raise exception 'Case G first run exceeded/missed limit: %', v_result;
  end if;
  v_result := private.materialize_expired_licenses_batch_v1(3);
  if (v_result->>'candidates_seen')::integer <> 2
     or (v_result->>'downgraded')::integer <> 2 then
    raise exception 'Case G second run did not continue backlog: %', v_result;
  end if;

  -- Case I: one fixture-specific trigger failure rolls back only that license.
  -- This trigger is transaction-local test scaffolding and disappears at rollback.
  execute $ddl$
    create function pg_temp.license_lifecycle_r3_fail_fixture()
    returns trigger
    language plpgsql
    set search_path = ''
    as $body$
    begin
      if old.organization_name = 'LIFECYCLE-R3-FAIL'
         and old.plan_id is distinct from new.plan_id then
        raise exception 'LIFECYCLE_R3_SANITIZED_FIXTURE_FAILURE' using errcode = 'P0001';
      end if;
      return new;
    end;
    $body$;
  $ddl$;
  execute $ddl$
    create trigger license_lifecycle_r3_fail_fixture
    before update on public.licenses
    for each row execute function pg_temp.license_lifecycle_r3_fail_fixture()
  $ddl$;

  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name, organization_name
  ) values
    (v_failure, 'LIFECYCLE-R3-FAIL-' || v_failure, v_pro_plan, 'subscription', 'active', now() - interval '30 days', false, 1, 5, '{}'::jsonb, 'Failure', 'LIFECYCLE-R3-FAIL'),
    (v_healthy_after_failure, 'LIFECYCLE-R3-HEALTHY-' || v_healthy_after_failure, v_pro_plan, 'subscription', 'active', now() - interval '29 days', false, 1, 5, '{}'::jsonb, 'Healthy', 'LIFECYCLE-R3-HEALTHY');

  v_result := private.materialize_expired_licenses_batch_v1(25);
  v_run_id := (v_result->>'run_id')::uuid;
  if v_result->>'status' <> 'completed_with_errors'
     or (v_result->>'candidates_seen')::integer <> 2
     or (v_result->>'downgraded')::integer <> 1
     or (v_result->>'failed')::integer <> 1
     or not exists (select 1 from public.licenses where id = v_failure and plan_id = v_pro_plan)
     or not exists (select 1 from public.licenses where id = v_healthy_after_failure and plan_id = v_free_plan) then
    raise exception 'Case I: per-license isolation failed: %', v_result;
  end if;
  if not exists (
    select 1 from private.license_lifecycle_scheduler_run_items
    where run_id = v_run_id and license_id = v_failure
      and result_code = 'FAILED' and error_code = 'P0001'
      and error_message = 'LIFECYCLE_R3_SANITIZED_FIXTURE_FAILURE'
  ) then
    raise exception 'Case I: failure observability mismatch';
  end if;

  -- A later healthy row progresses while the failed row cools down.
  v_license_id := extensions.gen_random_uuid();
  insert into public.licenses (
    id, license_key, plan_id, license_type, status, expires_at,
    is_lifetime, duration_months, max_devices, features, product_name, organization_name
  ) values (
    v_license_id, 'LIFECYCLE-R3-AFTER-FAIL-' || v_license_id, v_pro_plan, 'subscription', 'active',
    now() - interval '17 days', false, 1, 5, '{}'::jsonb, 'After failure', 'LIFECYCLE-R3-AFTER-FAIL'
  );
  v_result := private.materialize_expired_licenses_batch_v1(1);
  if (v_result->>'downgraded')::integer <> 1
     or not exists (select 1 from public.licenses where id = v_license_id and plan_id = v_free_plan) then
    raise exception 'Case I: failure cooldown blocked later backlog: %', v_result;
  end if;

  execute 'drop trigger license_lifecycle_r3_fail_fixture on public.licenses';

  -- Case H: prove this transaction holds the dedicated xact advisory lock used
  -- by the batch. The non-blocking try-lock/already_running branch is also
  -- asserted by the migration contract test.
  if not exists (
    select 1 from pg_catalog.pg_locks
    where locktype = 'advisory' and classid = 1279347531 and objid = 1
      and pid = pg_backend_pid() and granted
  ) then
    raise exception 'Case H: scheduler advisory lock was not acquired';
  end if;

  select to_jsonb(x) into v_gary_after
  from (
    select l.id, l.plan_id, l.status, l.expires_at, l.is_lifetime,
           e.lifecycle_state, e.is_entitled, e.grace_period_ends
    from public.licenses l
    cross join lateral private.license_entitlement_state_v1(l.id) e
    where l.id = 'dd047a26-130a-4d8f-8e1b-404fac48f111'::uuid
  ) x;
  if v_gary_after is distinct from v_gary_before then
    raise exception 'Case O: Gary changed during transactional scheduler QA';
  end if;
end;
$test$;

do $acl_and_cron$
begin
  if has_function_privilege('public', 'private.materialize_expired_licenses_batch_v1(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'private.materialize_expired_licenses_batch_v1(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.materialize_expired_licenses_batch_v1(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'private.materialize_expired_licenses_batch_v1(integer)', 'EXECUTE') then
    raise exception 'Scheduler batch ACL mismatch';
  end if;

  if has_table_privilege('public', 'private.license_lifecycle_scheduler_runs', 'SELECT')
     or has_table_privilege('anon', 'private.license_lifecycle_scheduler_runs', 'SELECT')
     or has_table_privilege('authenticated', 'private.license_lifecycle_scheduler_runs', 'SELECT')
     or has_table_privilege('public', 'private.license_lifecycle_scheduler_run_items', 'SELECT')
     or has_table_privilege('anon', 'private.license_lifecycle_scheduler_run_items', 'SELECT')
     or has_table_privilege('authenticated', 'private.license_lifecycle_scheduler_run_items', 'SELECT') then
    raise exception 'Scheduler observability ACL mismatch';
  end if;

  if (select count(*) from cron.job
      where jobname = 'license-expiry-materialization-v1'
        and schedule = '0 * * * *'
        and command = 'SELECT private.materialize_expired_licenses_batch_v1(25);'
        and username = 'postgres' and active) <> 1 then
    raise exception 'Scheduler cron registration mismatch';
  end if;
end;
$acl_and_cron$;

rollback;
