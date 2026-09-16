-- LICENSE.LIFECYCLE.3
-- Hourly, bounded materialization of canonically expired paid licenses.
-- Entitlement remains owned by LICENSE.LIFECYCLE.1 and every business change
-- remains owned by the single-license LICENSE.LIFECYCLE.2 primitive.

create table if not exists private.license_lifecycle_scheduler_runs (
  run_id uuid primary key default extensions.gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'completed_with_errors', 'already_running', 'failed')),
  batch_limit integer not null check (batch_limit between 1 and 100),
  candidates_seen integer not null default 0 check (candidates_seen >= 0),
  downgraded_count integer not null default 0 check (downgraded_count >= 0),
  noop_count integer not null default 0 check (noop_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  error_summary text
);

create index if not exists idx_license_lifecycle_scheduler_runs_started
  on private.license_lifecycle_scheduler_runs (started_at desc);

create index if not exists idx_license_lifecycle_scheduler_runs_status_started
  on private.license_lifecycle_scheduler_runs (status, started_at desc);

create table if not exists private.license_lifecycle_scheduler_run_items (
  item_id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null
    references private.license_lifecycle_scheduler_runs(run_id) on delete cascade,
  license_id uuid not null,
  result_code text not null,
  occurred_at timestamptz not null default now(),
  error_code text,
  error_message text,
  constraint license_lifecycle_scheduler_run_items_run_license_key
    unique (run_id, license_id)
);

create index if not exists idx_license_lifecycle_scheduler_items_license_time
  on private.license_lifecycle_scheduler_run_items (license_id, occurred_at desc);

create index if not exists idx_license_lifecycle_scheduler_items_failures
  on private.license_lifecycle_scheduler_run_items (occurred_at desc)
  where result_code = 'FAILED';

alter table private.license_lifecycle_scheduler_runs enable row level security;
alter table private.license_lifecycle_scheduler_run_items enable row level security;

revoke all on table private.license_lifecycle_scheduler_runs
  from public, anon, authenticated;
revoke all on table private.license_lifecycle_scheduler_run_items
  from public, anon, authenticated;
grant select on table private.license_lifecycle_scheduler_runs to service_role;
grant select on table private.license_lifecycle_scheduler_run_items to service_role;

comment on table private.license_lifecycle_scheduler_runs is
  'LICENSE.LIFECYCLE.3 operational run summaries. No customer PII or secrets. Rows are retained for 90 days by the batch runner.';
comment on table private.license_lifecycle_scheduler_run_items is
  'LICENSE.LIFECYCLE.3 per-license operational outcomes. Error text is sanitized and rows follow the parent run retention.';

create or replace function private.materialize_expired_licenses_batch_v1(
  p_batch_limit integer default 25
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  -- Dedicated two-key advisory-lock namespace for this scheduler only.
  v_lock_namespace constant integer := 1279347531;
  v_lock_key constant integer := 1;
  v_limit integer := least(greatest(coalesce(p_batch_limit, 25), 1), 100);
  v_run_id uuid;
  v_started_at timestamptz := clock_timestamp();
  v_finished_at timestamptz;
  v_candidate record;
  v_result jsonb;
  v_notification jsonb;
  v_result_code text;
  v_notification_id uuid;
  v_candidates_seen integer := 0;
  v_downgraded integer := 0;
  v_noop integer := 0;
  v_failed integer := 0;
  v_error_message text;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(v_lock_namespace, v_lock_key) then
    insert into private.license_lifecycle_scheduler_runs (
      started_at, finished_at, status, batch_limit
    ) values (
      v_started_at, clock_timestamp(), 'already_running', v_limit
    )
    returning run_id, finished_at into v_run_id, v_finished_at;

    return jsonb_build_object(
      'success', true,
      'status', 'already_running',
      'run_id', v_run_id,
      'candidates_seen', 0,
      'downgraded', 0,
      'already_free', 0,
      'skipped', 0,
      'failed', 0,
      'started_at', v_started_at,
      'finished_at', v_finished_at
    );
  end if;

  insert into private.license_lifecycle_scheduler_runs (
    started_at, status, batch_limit
  ) values (
    v_started_at, 'running', v_limit
  )
  returning run_id into v_run_id;

  for v_candidate in
    select
      l.id as license_id,
      entitlement.grace_period_ends,
      entitlement.expires_at
    from public.licenses l
    join public.plans p on p.id = l.plan_id
    cross join lateral private.license_entitlement_state_v1(l.id) entitlement
    where lower(coalesce(l.status::text, '')) = 'active'
      and coalesce(l.is_lifetime, false) is false
      and l.expires_at is not null
      -- Cheap prefilter only; canonical lifecycle is the final authority below.
      and l.expires_at < now()
      and p.code <> 'free_trial'
      and coalesce(p.price, 0) > 0
      and entitlement.lifecycle_state = 'expired'
      and entitlement.is_entitled is false
      -- A repeatedly broken row is retried after a short cooling period, so it
      -- cannot permanently occupy every slot ahead of healthy later rows.
      and not exists (
        select 1
        from private.license_lifecycle_scheduler_run_items recent_failure
        where recent_failure.license_id = l.id
          and recent_failure.result_code = 'FAILED'
          and recent_failure.occurred_at > now() - interval '6 hours'
      )
    order by
      entitlement.grace_period_ends asc,
      entitlement.expires_at asc,
      l.id asc
    limit v_limit
  loop
    v_candidates_seen := v_candidates_seen + 1;

    begin
      -- LICENSE.LIFECYCLE.2 owns locking, re-evaluation, mutation, the single
      -- transition event, and all reconciliation. Do not duplicate it here.
      v_result := private.materialize_expired_license_to_free_v1(v_candidate.license_id);
      v_result_code := coalesce(nullif(v_result->>'code', ''), 'UNKNOWN_RESULT');

      if coalesce((v_result->>'success')::boolean, false) is not true then
        raise exception 'MATERIALIZATION_RETURNED_FAILURE:%', v_result_code
          using errcode = 'P0001';
      end if;

      if coalesce((v_result->>'changed')::boolean, false) is true
         and v_result_code = 'PLAN_EXPIRED_DOWNGRADED_TO_FREE' then
        -- period_id is created exactly once by the Phase 2 transition and is
        -- therefore a stable notification dedupe key across scheduler retries.
        v_notification := private.create_pos_notification_once(
          p_license_id => v_candidate.license_id,
          p_event_key => 'license_plan_downgraded_to_free:' || (v_result->>'period_id'),
          p_type => 'license',
          p_severity => 'info',
          p_title => 'Tu plan Lanzo Nube terminó',
          p_body => 'Tu negocio pasó a Lanzo Local. Tus datos se conservaron y puedes seguir usando las funciones incluidas en el plan Free. Puedes volver a Lanzo Nube cuando quieras.',
          p_action_label => 'Ver licencia',
          p_action_route => '/configuracion?tab=license',
          p_metadata => jsonb_build_object(
            'phase', 'LICENSE.LIFECYCLE.3',
            'event', 'license_plan_downgraded_to_free',
            'category', 'license',
            'period_id', v_result->>'period_id',
            'previous_plan', v_result->>'previous_plan',
            'new_plan', v_result->>'new_plan',
            'materialized_at', v_result->>'materialized_at',
            'required_permission', 'settings',
            'lifecycle_contract', 'LICENSE.LIFECYCLE.1',
            'materialization_contract', 'LICENSE.LIFECYCLE.2',
            'generated_by', 'LICENSE.LIFECYCLE.3'
          ),
          p_source => 'license',
          p_expires_at => null
        );

        if coalesce((v_notification->>'success')::boolean, false) is not true then
          raise exception 'DOWNGRADE_NOTIFICATION_FAILED:%',
            coalesce(v_notification->>'code', 'UNKNOWN_NOTIFICATION_ERROR')
            using errcode = 'P0001';
        end if;

        v_notification_id := nullif(v_notification->>'notification_id', '')::uuid;
        update public.pos_notifications
           set target_scope = 'admin',
               target_staff_user_id = null,
               target_device_role = null,
               updated_at = now()
         where id = v_notification_id
           and license_id = v_candidate.license_id;

        if not found then
          raise exception 'DOWNGRADE_NOTIFICATION_TARGETING_FAILED'
            using errcode = 'P0001';
        end if;

        v_downgraded := v_downgraded + 1;
      else
        v_noop := v_noop + 1;
      end if;

      insert into private.license_lifecycle_scheduler_run_items (
        run_id, license_id, result_code
      ) values (
        v_run_id, v_candidate.license_id, v_result_code
      );
    exception
      when others then
        v_failed := v_failed + 1;
        v_error_message := left(
          pg_catalog.regexp_replace(
            pg_catalog.regexp_replace(
              sqlerrm,
              E'[\\r\\n\\t]+',
              ' ',
              'g'
            ),
            '(?i)(token|password|authorization|bearer)[^ ,;]*',
            '\\1=[redacted]',
            'g'
          ),
          500
        );

        insert into private.license_lifecycle_scheduler_run_items (
          run_id, license_id, result_code, error_code, error_message
        ) values (
          v_run_id,
          v_candidate.license_id,
          'FAILED',
          sqlstate,
          v_error_message
        );
    end;
  end loop;

  v_finished_at := clock_timestamp();

  update private.license_lifecycle_scheduler_runs
     set finished_at = v_finished_at,
         status = case when v_failed = 0 then 'succeeded' else 'completed_with_errors' end,
         candidates_seen = v_candidates_seen,
         downgraded_count = v_downgraded,
         noop_count = v_noop,
         failed_count = v_failed,
         error_summary = case
           when v_failed = 0 then null
           else v_failed::text || ' license(s) failed; inspect run items by run_id.'
         end
   where run_id = v_run_id;

  -- This owns only scheduler business logs. pg_cron history is extension data
  -- and is deliberately never modified here.
  delete from private.license_lifecycle_scheduler_runs
   where started_at < now() - interval '90 days';

  return jsonb_build_object(
    'success', true,
    'status', case when v_failed = 0 then 'succeeded' else 'completed_with_errors' end,
    'run_id', v_run_id,
    'candidates_seen', v_candidates_seen,
    'downgraded', v_downgraded,
    'already_free', 0,
    'skipped', v_noop,
    'failed', v_failed,
    'started_at', v_started_at,
    'finished_at', v_finished_at
  );
end;
$function$;

revoke all on function private.materialize_expired_licenses_batch_v1(integer)
  from public, anon, authenticated;
grant execute on function private.materialize_expired_licenses_batch_v1(integer)
  to service_role;

comment on function private.materialize_expired_licenses_batch_v1(integer) is
  'LICENSE.LIFECYCLE.3 bounded scheduler runner. Uses canonical entitlement, delegates every transition to LICENSE.LIFECYCLE.2, isolates per-license failures, dedupes Admin notifications, and retains 90 days of private operational logs.';

-- Deployment preflight: the scheduler is registered only after all private
-- observability and runner objects exist with their restricted ACLs.
do $preflight$
begin
  if to_regprocedure('private.license_entitlement_state_v1(uuid)') is null
     or to_regprocedure('private.materialize_expired_license_to_free_v1(uuid)') is null
     or to_regprocedure('private.create_pos_notification_once(uuid,text,text,text,text,text,text,text,jsonb,text,timestamptz)') is null then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_DEPENDENCY_MISSING';
  end if;

  if (select count(*) from public.plans where code = 'free_trial' and is_active) <> 1 then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_FREE_PLAN_INCONSISTENT';
  end if;

  if has_function_privilege('public', 'private.materialize_expired_licenses_batch_v1(integer)', 'execute')
     or has_function_privilege('anon', 'private.materialize_expired_licenses_batch_v1(integer)', 'execute')
     or has_function_privilege('authenticated', 'private.materialize_expired_licenses_batch_v1(integer)', 'execute') then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_CLIENT_EXECUTE_PRESENT';
  end if;
end;
$preflight$;

do $pg_cron_preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_PG_CRON_MISSING';
  end if;
end;
$pg_cron_preflight$;

do $scheduler$
declare
  v_job_id bigint;
  v_job_count integer;
  v_expected_name constant text := 'license-expiry-materialization-v1';
  v_expected_schedule constant text := '0 * * * *';
  v_expected_command constant text := 'SELECT private.materialize_expired_licenses_batch_v1(25);';
begin
  if current_user <> 'postgres' then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_REQUIRES_POSTGRES';
  end if;

  select count(*), min(jobid)
    into v_job_count, v_job_id
    from cron.job
   where jobname = v_expected_name;

  if v_job_count > 1 then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_DUPLICATE_JOB';
  elsif v_job_count = 1 then
    perform cron.alter_job(
      job_id => v_job_id,
      schedule => v_expected_schedule,
      command => v_expected_command,
      database => current_database(),
      username => 'postgres',
      active => true
    );
  else
    perform cron.schedule(
      v_expected_name,
      v_expected_schedule,
      v_expected_command
    );
  end if;

  select count(*)
    into v_job_count
    from cron.job
   where jobname = v_expected_name
     and schedule = v_expected_schedule
     and command = v_expected_command
     and database = current_database()
     and username = 'postgres'
     and active is true;

  if v_job_count <> 1 then
    raise exception 'LICENSE_LIFECYCLE_SCHEDULER_VERIFICATION_FAILED';
  end if;
end;
$scheduler$;
