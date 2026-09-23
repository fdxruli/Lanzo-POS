-- Phase 4 cloud inventory operational alerts.
-- Transactional fixture coverage; safe to run against a linked test/production
-- database because all fixture writes are rolled back.

begin;

do $test$
declare
  v_license_id uuid;
  v_first_incident uuid;
  v_second_incident uuid;
  v_notification_id uuid;
  v_count integer;
begin
  select l.id
  into v_license_id
  from public.licenses l
  join public.plans p on p.id = l.plan_id
  where p.code = 'pro_monthly'
  order by l.created_at
  limit 1;

  if v_license_id is null then
    raise exception 'PHASE4_TEST_PRO_LICENSE_REQUIRED';
  end if;

  insert into public.pos_products
    (id, license_id, name, name_key, stock, committed_stock, min_stock, track_stock, is_active, deleted_at)
  values
    ('phase4-test-healthy', v_license_id, 'P4 Healthy', 'phase4 test healthy', 10, 0, 5, true, true, null),
    ('phase4-test-low', v_license_id, 'P4 Low', 'phase4 test low', 5, 0, 5, true, true, null),
    ('phase4-test-out', v_license_id, 'P4 Out', 'phase4 test out', 5, 5, 5, true, true, null),
    ('phase4-test-min-zero', v_license_id, 'P4 Min Zero', 'phase4 test min zero', 1, 0, 0, true, true, null),
    ('phase4-test-min-null', v_license_id, 'P4 Min Null', 'phase4 test min null', 5, 0, null, true, true, null),
    ('phase4-test-min-negative', v_license_id, 'P4 Min Negative', 'phase4 test min negative', 1, 0, -1, true, true, null),
    ('phase4-test-expiry', v_license_id, 'P4 Expiry', 'phase4 test expiry', 100, 0, 5, true, true, null),
    ('phase4-test-stock-life', v_license_id, 'P4 Stock Lifecycle', 'phase4 test stock lifecycle', 5, 0, 5, true, true, null),
    ('phase4-test-expiry-life', v_license_id, 'P4 Expiry Lifecycle', 'phase4 test expiry lifecycle', 100, 0, 5, true, true, null);

  insert into public.pos_product_batches
    (id, license_id, product_id, stock, committed_stock, is_active, status, active_stock_status, expiry_date, alert_target_date)
  values
    ('phase4-test-day8', v_license_id, 'phase4-test-expiry', 1, 0, true, 'active', 1, '2026-10-01 00:00:00+00', null),
    ('phase4-test-day7', v_license_id, 'phase4-test-expiry', 1, 0, true, 'active', 1, '2026-09-30 00:00:00+00', null),
    ('phase4-test-today', v_license_id, 'phase4-test-expiry', 1, 0, true, 'active', 1, '2026-09-23 00:00:00+00', null),
    ('phase4-test-yesterday', v_license_id, 'phase4-test-expiry', 1, 0, true, 'active', 1, '2026-09-22 00:00:00+00', null),
    ('phase4-test-no-stock', v_license_id, 'phase4-test-expiry', 0, 0, true, 'active', 1, '2026-09-23 00:00:00+00', null),
    ('phase4-test-target', v_license_id, 'phase4-test-expiry', 1, 0, true, 'active', 1, '2026-09-01 00:00:00+00', '2026-09-24 00:00:00+00'),
    ('phase4-test-expiry-life-batch', v_license_id, 'phase4-test-expiry-life', 1, 0, true, 'active', 1, '2026-09-25 00:00:00+00', null);

  if exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where product_id = 'phase4-test-healthy' and entity_kind = 'product'
  ) then raise exception 'healthy product must not alert'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where product_id = 'phase4-test-low' and classification = 'low_stock'
      and severity = 'warning' and available_stock = 5 and min_stock = 5
  ) then raise exception 'stock=minStock must be low_stock'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where product_id = 'phase4-test-out' and classification = 'out_of_stock'
      and severity = 'critical' and available_stock = 0
  ) then raise exception 'committed stock must affect availability'; end if;

  if exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where product_id in ('phase4-test-min-zero', 'phase4-test-min-negative')
      and entity_kind = 'product'
  ) then raise exception 'minStock zero/invalid parity failed'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where product_id = 'phase4-test-min-null' and min_stock = 5
      and min_stock_source = 'legacy_fallback'
  ) then raise exception 'legacy minStock fallback failed'; end if;

  if exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where batch_id in ('phase4-test-day8', 'phase4-test-no-stock')
  ) then raise exception 'expiry eligibility/window failed'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where batch_id = 'phase4-test-day7' and classification = 'expiring'
      and severity = 'warning' and days_until_expiry = 7
  ) then raise exception '7-day expiry boundary failed'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where batch_id = 'phase4-test-today' and severity = 'critical'
      and expires_today and days_until_expiry = 0
  ) then raise exception 'expires-today critical failed'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where batch_id = 'phase4-test-yesterday' and classification = 'expired'
      and severity = 'critical' and days_until_expiry = -1
  ) then raise exception 'expired classification failed'; end if;

  if not exists (
    select 1 from private.inventory_operational_alert_candidates_v1(v_license_id, date '2026-09-23')
    where batch_id = 'phase4-test-target' and expiry_date = date '2026-09-24'
  ) then raise exception 'alert_target_date precedence failed'; end if;

  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  select i.id, i.notification_id
  into v_first_incident, v_notification_id
  from private.pos_notification_operational_incidents i
  where i.license_id = v_license_id
    and i.incident_type = 'inventory_low_stock'
    and i.entity_id = 'phase4-test-stock-life'
    and i.resolved_at is null;

  if v_first_incident is null or v_notification_id is null then
    raise exception 'initial low-stock incident/notification missing';
  end if;

  if not exists (
    select 1 from public.pos_notifications n
    where n.id = v_notification_id
      and n.type = 'inventory'
      and n.source = 'system'
      and n.metadata->>'category' = 'inventory'
      and n.metadata->>'event_key' = 'inventory:' || v_first_incident::text
  ) then raise exception 'notification contract/event key failed'; end if;

  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  select count(*) into v_count
  from public.pos_notifications n
  where n.license_id = v_license_id
    and n.metadata->>'product_id' = 'phase4-test-stock-life';
  if v_count <> 1 then raise exception 'stable incident duplicated notification'; end if;

  update public.pos_products
  set stock = 0
  where license_id = v_license_id and id = 'phase4-test-stock-life';
  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  if not exists (
    select 1 from private.pos_notification_operational_incidents
    where id = v_first_incident and resolved_at is not null
  ) then raise exception 'low->out failed to resolve low'; end if;

  if not exists (
    select 1 from public.pos_notifications
    where id = v_notification_id and expires_at is not null
  ) then raise exception 'resolved notification remained active'; end if;

  update public.pos_products
  set stock = 20
  where license_id = v_license_id and id = 'phase4-test-stock-life';
  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  update public.pos_products
  set stock = 5
  where license_id = v_license_id and id = 'phase4-test-stock-life';
  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  select i.id into v_second_incident
  from private.pos_notification_operational_incidents i
  where i.license_id = v_license_id
    and i.incident_type = 'inventory_low_stock'
    and i.entity_id = 'phase4-test-stock-life'
    and i.resolved_at is null;

  if v_second_incident is null or v_second_incident = v_first_incident then
    raise exception 'resolved->reappeared must create a new incident';
  end if;

  -- Expiry transitions are material.
  if not exists (
    select 1 from private.pos_notification_operational_incidents
    where license_id = v_license_id
      and incident_type = 'inventory_expiring_warning'
      and entity_id = 'phase4-test-expiry-life-batch'
      and resolved_at is null
  ) then raise exception 'expiry warning incident missing'; end if;

  update public.pos_product_batches
  set expiry_date = '2026-09-23 00:00:00+00'
  where license_id = v_license_id and id = 'phase4-test-expiry-life-batch';
  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  if not exists (
    select 1 from private.pos_notification_operational_incidents
    where license_id = v_license_id
      and incident_type = 'inventory_expiring_critical'
      and entity_id = 'phase4-test-expiry-life-batch'
      and resolved_at is null
  ) then raise exception 'warning->today transition failed'; end if;

  update public.pos_product_batches
  set expiry_date = '2026-09-22 00:00:00+00'
  where license_id = v_license_id and id = 'phase4-test-expiry-life-batch';
  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  if not exists (
    select 1 from private.pos_notification_operational_incidents
    where license_id = v_license_id
      and incident_type = 'inventory_expired'
      and entity_id = 'phase4-test-expiry-life-batch'
      and resolved_at is null
  ) then raise exception 'today->expired transition failed'; end if;

  update public.pos_product_batches
  set stock = 0
  where license_id = v_license_id and id = 'phase4-test-expiry-life-batch';
  perform private.generate_inventory_operational_notifications(v_license_id, date '2026-09-23');

  if exists (
    select 1 from private.pos_notification_operational_incidents
    where license_id = v_license_id
      and entity_id = 'phase4-test-expiry-life-batch'
      and incident_type in (
        'inventory_expiring_warning',
        'inventory_expiring_critical',
        'inventory_expired'
      )
      and resolved_at is null
  ) then raise exception 'expiry resolution failed'; end if;
end
$test$;

select 'PASS' as inventory_operational_alerts_phase4_cloud_generation;
rollback;
