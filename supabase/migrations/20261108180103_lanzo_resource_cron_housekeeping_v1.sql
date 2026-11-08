-- LANZO POS resource maintenance v1 — only cron schedules, no business data modifications.
-- Production preflight required: existing job names, commands, schedules and ownership.
DO $lanzo_resource_cron_housekeeping_v1$
DECLARE
  v_reminders record;
  v_existing record;
  v_rate_command constant text := 'SELECT public.cleanup_pos_rpc_rate_limits(interval ''48 hours'');';
  v_history_command constant text := 'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''30 days'';';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'ecommerce-stock-reservation-expiry-v1'
      AND schedule = '*/5 * * * *'
      AND active
      AND btrim(command) = 'SELECT private.ecommerce_expire_abandoned_stock_reservations();'
  ) OR NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'license-expiry-materialization-v1'
      AND schedule = '0 * * * *'
      AND active
      AND btrim(command) = 'SELECT private.materialize_expired_licenses_batch_v1(25);'
  ) THEN
    RAISE EXCEPTION 'LANZO_RESOURCE_CRON_PREFLIGHT_CRITICAL_JOBS_MISMATCH';
  END IF;

  SELECT jobid, schedule, command, active
    INTO v_reminders
    FROM cron.job
   WHERE jobname = 'customer-message-reminders-phase5';

  IF NOT FOUND
    OR v_reminders.active IS DISTINCT FROM true
    OR lower(btrim(v_reminders.command)) <> 'select private.run_customer_message_reminders();'
    OR v_reminders.schedule NOT IN ('*/5 * * * *', '*/15 * * * *')
  THEN
    RAISE EXCEPTION 'LANZO_RESOURCE_CRON_PREFLIGHT_REMINDERS_MISMATCH';
  END IF;

  SELECT jobid, schedule, command, active
    INTO v_existing
    FROM cron.job
   WHERE jobname = 'lanzo-rate-limit-retention-48h-v1';
  IF FOUND AND (v_existing.schedule <> '17 3 * * *'
    OR v_existing.command <> v_rate_command
    OR v_existing.active IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'LANZO_RESOURCE_CRON_PREFLIGHT_RATE_RETENTION_CONFLICT';
  END IF;

  SELECT jobid, schedule, command, active
    INTO v_existing
    FROM cron.job
   WHERE jobname = 'lanzo-cron-history-retention-30d-v1';
  IF FOUND AND (v_existing.schedule <> '43 3 * * 0'
    OR v_existing.command <> v_history_command
    OR v_existing.active IS DISTINCT FROM true) THEN
    RAISE EXCEPTION 'LANZO_RESOURCE_CRON_PREFLIGHT_CRON_RETENTION_CONFLICT';
  END IF;

  IF v_reminders.schedule <> '*/15 * * * *' THEN
    PERFORM cron.alter_job(job_id => v_reminders.jobid,
                           schedule => '*/15 * * * *');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job
                 WHERE jobname = 'lanzo-rate-limit-retention-48h-v1') THEN
    PERFORM cron.schedule('lanzo-rate-limit-retention-48h-v1',
                          '17 3 * * *', v_rate_command);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cron.job
                 WHERE jobname = 'lanzo-cron-history-retention-30d-v1') THEN
    PERFORM cron.schedule('lanzo-cron-history-retention-30d-v1',
                          '43 3 * * 0', v_history_command);
  END IF;
END;
$lanzo_resource_cron_housekeeping_v1$;
