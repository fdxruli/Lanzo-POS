-- Phase 3 follow-up: schedule only the existing private reservation-expiry
-- routine.  The job is owned by postgres, runs every five minutes, and has no
-- client-controlled input or public RPC surface.
create extension if not exists pg_cron with schema pg_catalog;

revoke all on schema cron from public, anon, authenticated;
revoke all on all tables in schema cron from public, anon, authenticated;
revoke all on all sequences in schema cron from public, anon, authenticated;
revoke all on all functions in schema cron from public, anon, authenticated;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;
grant usage, select on all sequences in schema cron to postgres;
grant execute on all functions in schema cron to postgres;

do $scheduler$
declare
  v_job_id bigint;
  v_job_count integer;
  v_schedule text;
  v_command text;
  v_database text;
  v_username name;
  v_active boolean;
  v_expected_name constant text := 'ecommerce-stock-reservation-expiry-v1';
  v_expected_schedule constant text := '*/5 * * * *';
  v_expected_command constant text := 'SELECT private.ecommerce_expire_abandoned_stock_reservations();';
begin
  if current_user <> 'postgres' then
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_REQUIRES_POSTGRES';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_extension
     where extname = 'pg_cron'
  ) then
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_EXTENSION_MISSING';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
     where n.nspname = 'private'
       and p.proname = 'ecommerce_expire_abandoned_stock_reservations'
       and p.pronargs = 0
       and p.prosecdef
  ) then
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_TARGET_MISSING';
  end if;

  if has_schema_privilege('anon', 'cron', 'usage')
     or has_schema_privilege('authenticated', 'cron', 'usage') then
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_CLIENT_CRON_SCHEMA_ACCESS';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc as p
      join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
      cross join lateral pg_catalog.aclexplode(
        coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
      ) as acl
     where n.nspname = 'private'
       and p.proname = 'ecommerce_expire_abandoned_stock_reservations'
       and p.pronargs = 0
       and acl.privilege_type = 'EXECUTE'
       and (
         acl.grantee = 0
         or acl.grantee in (
           select oid
             from pg_catalog.pg_roles
            where rolname in ('anon', 'authenticated')
         )
       )
  ) then
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_CLIENT_EXPIRY_FUNCTION_ACL';
  end if;

  select count(*)
    into v_job_count
    from cron.job
   where jobname = v_expected_name;

  if v_job_count > 1 then
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_DUPLICATE_JOB';
  end if;

  if v_job_count = 1 then
    select jobid, schedule, command, database, username, active
      into v_job_id, v_schedule, v_command, v_database, v_username, v_active
      from cron.job
     where jobname = v_expected_name
     for update;

    if v_schedule <> v_expected_schedule
       or v_command <> v_expected_command
       or v_database <> current_database()
       or v_username <> 'postgres'
       or v_active is not true then
      raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_CONFLICT';
    end if;
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
    raise exception 'ECOMMERCE_RESERVATION_EXPIRY_SCHEDULER_VERIFICATION_FAILED';
  end if;
end;
$scheduler$;

comment on extension pg_cron is
  'Supabase Cron scheduler. Phase 3 job ecommerce-stock-reservation-expiry-v1 runs every five minutes as postgres and invokes only private.ecommerce_expire_abandoned_stock_reservations().';
