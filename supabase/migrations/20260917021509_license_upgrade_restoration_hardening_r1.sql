-- LICENSE.LIFECYCLE.4
--
-- A paid-plan activation is a material, tenant-scoped transition.  This
-- migration intentionally has no billing or payment integration: the only
-- caller is the existing administrative boundary and it supplies the already
-- authorized duration.

begin;

-- The previous Phase 4 guard is attached to two relations with different
-- NEW-record shapes.  PL/pgSQL resolves fields against the trigger relation,
-- so sharing a body that references both shapes makes an otherwise-valid
-- order-item or reservation write fail with SQLSTATE 42703.  Keep the same
-- tenant predicates but give each trigger an exact record contract.
create or replace function private.ecommerce_order_item_phase4_tenant_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.published_product_id is not null
     and not exists (
       select 1
       from public.ecommerce_published_products p
       where p.id = new.published_product_id
         and p.portal_id = new.portal_id
         and p.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  if private.ecommerce_reservation_variant_id(new.options) is not null
     and not exists (
       select 1
       from public.ecommerce_published_product_variants v
       where v.id = private.ecommerce_reservation_variant_id(new.options)
         and v.published_product_id = new.published_product_id
         and v.portal_id = new.portal_id
         and v.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  return new;
end;
$function$;

create or replace function private.ecommerce_reservation_phase4_tenant_scope_guard()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.published_variant_id is not null
     and not exists (
       select 1
       from public.ecommerce_published_product_variants v
       where v.id = new.published_variant_id
         and v.published_product_id = new.published_product_id
         and v.portal_id = new.portal_id
         and v.license_id = new.license_id
     ) then
    raise exception 'ECOMMERCE_TENANT_SCOPE_MISMATCH' using errcode = '23514';
  end if;

  return new;
end;
$function$;

alter function private.ecommerce_order_item_phase4_tenant_scope_guard() owner to postgres;
alter function private.ecommerce_reservation_phase4_tenant_scope_guard() owner to postgres;
revoke all on function private.ecommerce_order_item_phase4_tenant_scope_guard() from public, anon, authenticated;
revoke all on function private.ecommerce_reservation_phase4_tenant_scope_guard() from public, anon, authenticated;

drop trigger if exists ecommerce_order_items_phase4_tenant_scope_guard
  on public.ecommerce_order_items;
create trigger ecommerce_order_items_phase4_tenant_scope_guard
before insert or update on public.ecommerce_order_items
for each row execute function private.ecommerce_order_item_phase4_tenant_scope_guard();

drop trigger if exists ecommerce_reservations_phase4_tenant_scope_guard
  on public.ecommerce_order_inventory_reservations;
create trigger ecommerce_reservations_phase4_tenant_scope_guard
before insert or update on public.ecommerce_order_inventory_reservations
for each row execute function private.ecommerce_reservation_phase4_tenant_scope_guard();

-- Reuse the authoritative public-availability predicate rather than trying to
-- infer eligibility from downgrade metadata.  The caller is evaluating a row
-- which is deliberately unpublished, so only that one state is lifted for the
-- hypothetical eligibility check; every current catalog/stock/manual rule is
-- still applied by ecommerce_product_publicly_available.
create or replace function private.ecommerce_product_eligible_for_plan_restore_v1(
  p_product public.ecommerce_published_products
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_product.id is null
     or p_product.deleted_at is not null then
    return false;
  end if;

  p_product.is_published := true;
  return private.ecommerce_product_publicly_available(p_product);
end;
$function$;

alter function private.ecommerce_product_eligible_for_plan_restore_v1(public.ecommerce_published_products) owner to postgres;
revoke all on function private.ecommerce_product_eligible_for_plan_restore_v1(public.ecommerce_published_products)
  from public, anon, authenticated;
grant execute on function private.ecommerce_product_eligible_for_plan_restore_v1(public.ecommerce_published_products)
  to service_role;

-- Single-license, row-locked paid activation.  A fresh period ID is the stable
-- identity for the transition, notification, and plan event.  A same-plan
-- activation while still canonically active is deliberately a NOOP; a grace or
-- logically expired paid license is renewed directly, without a Free detour.
create or replace function private.materialize_license_upgrade_v1(
  p_license_id uuid,
  p_target_plan_code text,
  p_duration_months integer default 1,
  p_reason text default null,
  p_actor jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_target_plan public.plans%rowtype;
  v_entitlement record;
  v_after record;
  v_now timestamptz := clock_timestamp();
  v_duration_months integer;
  v_expires_at timestamptz;
  v_previous_period_id uuid;
  v_new_period_id uuid;
  v_active_devices integer := 0;
  v_restored_devices integer := 0;
  v_restored_publications integer := 0;
  v_notification jsonb;
  v_notification_id uuid;
  v_actor jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_ID_REQUIRED');
  end if;

  if nullif(btrim(coalesce(p_target_plan_code, '')), '') is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'TARGET_PLAN_REQUIRED');
  end if;

  if coalesce(p_duration_months, 0) < 1
     or coalesce(p_duration_months, 0) > 120 then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'INVALID_DURATION_MONTHS');
  end if;

  -- This lock is shared with the Phase 2 materialization primitive.  Every
  -- decision, including the lifecycle calculation, happens after it is held.
  select l.id,
         l.license_key,
         l.plan_id,
         l.status,
         l.expires_at,
         l.is_lifetime,
         l.duration_months,
         l.license_type,
         p.code as plan_code,
         p.name as plan_name
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.id = p_license_id
   for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  select *
    into v_target_plan
    from public.plans p
   where p.code = btrim(p_target_plan_code)
     and p.is_active is true
   limit 1
   for share;

  if v_target_plan.id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'TARGET_PLAN_NOT_FOUND');
  end if;

  if v_target_plan.code = 'free_trial'
     or coalesce(v_target_plan.price, 0) <= 0 then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'TARGET_PLAN_NOT_PAID');
  end if;

  if lower(coalesce(v_license.status::text, '')) <> 'active' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'ADMINISTRATIVELY_BLOCKED',
      'license_id', v_license.id,
      'administrative_status', v_license.status
    );
  end if;

  select *
    into v_entitlement
    from private.license_entitlement_state_v1(v_license.id);

  if v_license.plan_id = v_target_plan.id
     and v_entitlement.lifecycle_state = 'active'
     and v_entitlement.is_entitled is true
     and coalesce(v_license.is_lifetime, false) is false then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'ALREADY_ON_PLAN',
      'license_id', v_license.id,
      'plan_code', v_target_plan.code,
      'lifecycle_state', v_entitlement.lifecycle_state
    );
  end if;

  v_duration_months := p_duration_months;
  v_expires_at := v_now + make_interval(months => v_duration_months);
  v_actor := coalesce(
    p_actor,
    jsonb_strip_nulls(jsonb_build_object(
      'type', 'service_role',
      'request_subject', nullif(current_setting('request.jwt.claim.sub', true), '')
    ))
  );

  -- There is at most one active period by existing constraint.  Close only
  -- current/open rows and never edit historical closed or expired periods.
  select lp.id
    into v_previous_period_id
    from public.license_periods lp
   where lp.license_id = v_license.id
     and lp.status = 'active'
   order by lp.starts_at desc, lp.id desc
   limit 1
   for update;

  update public.license_periods lp
     set status = 'closed',
         ends_at = case
           when lp.ends_at is null or lp.ends_at > v_now then v_now
           else lp.ends_at
         end,
         closed_at = coalesce(lp.closed_at, v_now),
         metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
           'closed_by', 'materialize_license_upgrade_v1',
           'closed_reason', 'paid_plan_activated',
           'closed_at', v_now,
           'next_plan', v_target_plan.code
         )
   where lp.license_id = v_license.id
     and lp.status = 'active';

  -- sync_license_plan_snapshot remains the single owner of plan snapshot
  -- fields.  Its all-plan key scrub guarantees this is a target-plan snapshot,
  -- never a Free/Pro merge.  The after-change hook may only further restrict
  -- resources; targeted restoration follows below.
  update public.licenses l
     set plan_id = v_target_plan.id,
         duration_months = v_duration_months,
         expires_at = v_expires_at,
         is_lifetime = false,
         status = 'active'
   where l.id = v_license.id
   returning l.id,
             l.license_key,
             l.plan_id,
             l.license_type,
             l.product_name,
             l.features,
             l.max_devices,
             l.duration_months,
             l.expires_at,
             l.is_lifetime,
             l.status
    into v_after;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license.id, v_target_plan.id, v_target_plan.code, v_target_plan.name,
    case
      when v_target_plan.code = 'pro_monthly' then 'pro_paid'
      when v_target_plan.code = 'basic_monthly' then 'basic_paid'
      else 'admin_grant'
    end,
    'active', v_now, v_expires_at,
    greatest(coalesce((coalesce(v_target_plan.features, '{}'::jsonb)->>'ai_agent_total_limit')::integer, 0), 0),
    jsonb_build_object(
      'source', 'materialize_license_upgrade_v1',
      'reason', coalesce(nullif(btrim(p_reason), ''), 'administrative_paid_activation'),
      'previous_plan', v_license.plan_code,
      'previous_period_id', v_previous_period_id,
      'actor', v_actor,
      'duration_months', v_duration_months,
      'activated_at', v_now
    )
  )
  returning id into v_new_period_id;

  -- Only rows withdrawn by Phase 2, which still satisfy current public
  -- eligibility, are republished.  The original row/order is retained and the
  -- one downgrade marker is removed after successful restoration.
  with restored as (
    update public.ecommerce_published_products pp
       set is_published = true,
           metadata = coalesce(pp.metadata, '{}'::jsonb) - 'plan_downgrade_publication'
     where pp.license_id = v_license.id
       and pp.deleted_at is null
       and pp.is_published is false
       and pp.metadata #>> '{plan_downgrade_publication,reason}' = 'PLAN_DOWNGRADE_PUBLICATION_LIMIT'
       and private.ecommerce_product_eligible_for_plan_restore_v1(pp)
     returning pp.id
  )
  select count(*) into v_restored_publications from restored;

  select count(*)
    into v_active_devices
    from public.license_devices d
   where d.license_id = v_license.id
     and d.is_active is true;

  -- Phase 2 removed credentials.  Restoration intentionally leaves both token
  -- columns NULL, so an eligible device needs the normal re-authentication path
  -- before it can act again.  A later manual release/ban wins over the old plan
  -- marker and therefore excludes that device from restoration.
  with candidates as materialized (
    select d.id,
           row_number() over (
             order by
               nullif(d.device_info #>> '{license_block,blocked_at}', '')::timestamptz asc nulls last,
               d.activated_at asc nulls last,
               d.id asc
           ) as restore_rank
      from public.license_devices d
     where d.license_id = v_license.id
       and d.is_active is false
       and d.device_info #>> '{license_block,reason}' = 'PLAN_DOWNGRADE_DEVICE_LIMIT'
       and not exists (
         select 1
         from public.license_events e
         where e.license_key = v_license.license_key
           and e.event_type in ('DEVICE_RELEASED', 'DEVICE_BANNED')
           and e.metadata->>'device_id' = d.id::text
           and e.triggered_at > coalesce(
             nullif(d.device_info #>> '{license_block,blocked_at}', '')::timestamptz,
             '-infinity'::timestamptz
           )
       )
  ), restored_devices as (
    update public.license_devices d
       set is_active = true,
           security_token = null,
           previous_security_token = null,
           last_check_at = v_now,
           device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
             'plan_upgrade_restoration', jsonb_build_object(
               'reason', 'PLAN_DOWNGRADE_DEVICE_LIMIT',
               'restored_at', v_now,
               'requires_reauthentication', true,
               'restored_by_period_id', v_new_period_id
             )
           )
      from candidates c
     where d.id = c.id
       and c.restore_rank <= greatest(coalesce(v_after.max_devices, 0) - v_active_devices, 0)
     returning d.id
  )
  select count(*) into v_restored_devices from restored_devices;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license.license_key,
    'PLAN_CHANGED',
    jsonb_build_object(
      'source', 'materialize_license_upgrade_v1',
      'reason', coalesce(nullif(btrim(p_reason), ''), 'administrative_paid_activation'),
      'previous_plan', v_license.plan_code,
      'new_plan', v_target_plan.code,
      'changed_at', v_now,
      'previous_period_id', v_previous_period_id,
      'new_period_id', v_new_period_id,
      'actor', v_actor,
      'restoration', jsonb_build_object(
        'publications_republished', v_restored_publications,
        'devices_reenabled', v_restored_devices,
        'staff_sessions_reactivated', 0
      )
    )
  );

  v_notification := private.create_pos_notification_once(
    p_license_id => v_license.id,
    p_event_key => 'license_plan_upgraded_to_paid:' || v_new_period_id::text,
    p_type => 'license',
    p_severity => 'info',
    p_title => 'Lanzo Nube está activo',
    p_body => 'Tu negocio volvió a Lanzo Nube. Tus configuraciones y datos se conservaron y las funciones del plan ya están disponibles.',
    p_action_label => 'Ver licencia',
    p_action_route => '/configuracion?tab=license',
    p_metadata => jsonb_build_object(
      'phase', 'LICENSE.LIFECYCLE.4',
      'event', 'license_plan_upgraded_to_paid',
      'period_id', v_new_period_id,
      'previous_plan', v_license.plan_code,
      'new_plan', v_target_plan.code,
      'restoration', jsonb_build_object(
        'publications_republished', v_restored_publications,
        'devices_reenabled', v_restored_devices,
        'staff_sessions_reactivated', 0
      )
    ),
    p_source => 'license',
    p_expires_at => null
  );

  if coalesce((v_notification->>'success')::boolean, false) is not true then
    raise exception 'UPGRADE_NOTIFICATION_FAILED:%', coalesce(v_notification->>'code', 'UNKNOWN_NOTIFICATION_ERROR');
  end if;

  v_notification_id := nullif(v_notification->>'notification_id', '')::uuid;
  if v_notification_id is not null then
    update public.pos_notifications
       set target_scope = 'admin',
           target_staff_user_id = null,
           target_device_role = null,
           updated_at = v_now
     where id = v_notification_id
       and license_id = v_license.id;
  end if;

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'code', 'LICENSE_UPGRADED_TO_PAID',
    'license_id', v_after.id,
    'previous_plan', v_license.plan_code,
    'new_plan', v_target_plan.code,
    'license_type', v_after.license_type,
    'status', v_after.status,
    'is_lifetime', v_after.is_lifetime,
    'duration_months', v_after.duration_months,
    'expires_at', v_after.expires_at,
    'max_devices', v_after.max_devices,
    'features', v_after.features,
    'previous_period_id', v_previous_period_id,
    'period_id', v_new_period_id,
    'publications_republished', v_restored_publications,
    'devices_reenabled', v_restored_devices,
    'staff_sessions_reactivated', 0,
    'notification_id', v_notification_id
  );
end;
$function$;

alter function private.materialize_license_upgrade_v1(uuid, text, integer, text, jsonb) owner to postgres;
revoke all on function private.materialize_license_upgrade_v1(uuid, text, integer, text, jsonb)
  from public, anon, authenticated;
grant execute on function private.materialize_license_upgrade_v1(uuid, text, integer, text, jsonb)
  to service_role;

comment on function private.materialize_license_upgrade_v1(uuid, text, integer, text, jsonb) is
  'LICENSE.LIFECYCLE.4 row-locked, idempotent paid activation. Restores only Phase 2 publication/device withdrawals; never restores Staff sessions or device credentials.';

-- Keep the already-shipped administrative Free operation available while the
-- public boundary delegates paid activations above.  This is intentionally not
-- used by the expiry scheduler, whose canonical materialization remains
-- private.materialize_expired_license_to_free_v1.
create or replace function private.materialize_admin_license_to_free_v1(
  p_license_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_free_plan public.plans%rowtype;
  v_before record;
  v_after record;
  v_now timestamptz := clock_timestamp();
  v_period_id uuid;
  v_active_devices integer := 0;
  v_staff_devices integer := 0;
begin
  select *
    into v_free_plan
    from public.plans p
   where p.code = 'free_trial'
     and p.is_active is true
   limit 1
   for share;

  if v_free_plan.id is null then
    raise exception 'FREE_PLAN_NOT_AVAILABLE';
  end if;

  select l.id,
         l.license_key,
         l.plan_id,
         p.code as plan_code,
         p.name as plan_name
    into v_before
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.id = p_license_id
   for update of l;

  if v_before.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  update public.license_periods lp
     set status = 'closed',
         ends_at = case when lp.ends_at is null or lp.ends_at > v_now then v_now else lp.ends_at end,
         closed_at = coalesce(lp.closed_at, v_now),
         metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
           'closed_by', 'admin_change_license_plan',
           'to_plan', v_free_plan.code
         )
   where lp.license_id = v_before.id
     and lp.status = 'active';

  update public.licenses l
     set plan_id = v_free_plan.id,
         expires_at = null,
         duration_months = null,
         is_lifetime = true,
         status = 'active'
   where l.id = v_before.id
   returning l.id,
             l.license_key,
             l.license_type,
             l.product_name,
             l.max_devices,
             l.features,
             l.expires_at,
             l.duration_months,
             l.is_lifetime,
             l.status
    into v_after;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_before.id, v_free_plan.id, v_free_plan.code, v_free_plan.name,
    'trial', 'active', v_now, null, 0,
    jsonb_build_object(
      'source', 'admin_change_license_plan',
      'reason', coalesce(nullif(btrim(p_reason), ''), 'manual_admin_plan_change'),
      'from_plan', v_before.plan_code,
      'to_plan', v_free_plan.code,
      'license_kind', 'free_lifetime',
      'is_lifetime', true
    )
  )
  returning id into v_period_id;

  select count(*)
    into v_active_devices
    from public.license_devices d
   where d.license_id = v_before.id
     and d.is_active is true;

  select count(*)
    into v_staff_devices
    from public.license_devices d
   where d.license_id = v_before.id
     and d.is_active is true
     and d.device_mode = 'staff_only';

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_before.license_key,
    'PLAN_CHANGED',
    jsonb_build_object(
      'source', 'admin_change_license_plan',
      'reason', coalesce(nullif(btrim(p_reason), ''), 'manual_admin_plan_change'),
      'from_plan', v_before.plan_code,
      'to_plan', v_free_plan.code,
      'period_id', v_period_id,
      'period_start', v_now,
      'period_end', null,
      'license_kind', 'free_lifetime',
      'is_lifetime', true
    )
  );

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_before.license_key,
    'PERIOD_CREATED',
    jsonb_build_object(
      'source', 'admin_change_license_plan',
      'period_id', v_period_id,
      'period_type', 'trial',
      'starts_at', v_now,
      'ends_at', null,
      'ai_agent_limit', 0,
      'plan_code', v_free_plan.code,
      'license_kind', 'free_lifetime',
      'is_lifetime', true
    )
  );

  return jsonb_build_object(
    'success', true,
    'changed', true,
    'code', 'LICENSE_CHANGED_TO_FREE',
    'license_key', v_before.license_key,
    'from_plan', v_before.plan_code,
    'to_plan', v_free_plan.code,
    'plan_name', v_free_plan.name,
    'product_name', v_after.product_name,
    'license_type', v_after.license_type,
    'duration_months', v_after.duration_months,
    'is_lifetime', v_after.is_lifetime,
    'status', v_after.status,
    'max_devices', v_after.max_devices,
    'features', v_after.features,
    'expires_at', v_after.expires_at,
    'period_id', v_period_id,
    'period_start', v_now,
    'period_end', null,
    'ai_agent_limit', 0,
    'active_devices_after_enforcement', v_active_devices,
    'active_staff_devices_after_enforcement', v_staff_devices
  );
end;
$function$;

alter function private.materialize_admin_license_to_free_v1(uuid, text) owner to postgres;
revoke all on function private.materialize_admin_license_to_free_v1(uuid, text)
  from public, anon, authenticated;
grant execute on function private.materialize_admin_license_to_free_v1(uuid, text)
  to service_role;

-- Preserve the public administrative entrypoint and its three-argument
-- contract, but delegate all paid transitions to the private lifecycle owner.
-- Free targets retain the established administrative downgrade behavior.
create or replace function public.admin_change_license_plan(
  p_license_key text,
  p_target_plan_code text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license_id uuid;
  v_target_plan public.plans%rowtype;
begin
  if nullif(btrim(coalesce(p_license_key, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED');
  end if;

  if nullif(btrim(coalesce(p_target_plan_code, '')), '') is null then
    return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_REQUIRED');
  end if;

  select l.id
    into v_license_id
    from public.licenses l
   where l.license_key = p_license_key;

  if v_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  select *
    into v_target_plan
    from public.plans p
   where p.code = btrim(p_target_plan_code)
     and p.is_active is true
   limit 1;

  if v_target_plan.id is null then
    return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_NOT_FOUND');
  end if;

  if v_target_plan.code <> 'free_trial'
     and coalesce(v_target_plan.price, 0) > 0 then
    return private.materialize_license_upgrade_v1(
      v_license_id,
      v_target_plan.code,
      1,
      p_reason,
      jsonb_strip_nulls(jsonb_build_object(
        'type', 'service_role',
        'request_subject', nullif(current_setting('request.jwt.claim.sub', true), '')
      ))
    );
  end if;

  if v_target_plan.code = 'free_trial' then
    return private.materialize_admin_license_to_free_v1(v_license_id, p_reason);
  end if;

  return jsonb_build_object('success', false, 'code', 'TARGET_PLAN_NOT_PAID');
end;
$function$;

revoke all on function public.admin_change_license_plan(text, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_change_license_plan(text, text, text)
  to service_role;

do $preflight$
begin
  if to_regprocedure('private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)') is null
     or to_regprocedure('private.ecommerce_order_item_phase4_tenant_scope_guard()') is null
     or to_regprocedure('private.ecommerce_reservation_phase4_tenant_scope_guard()') is null then
    raise exception 'LICENSE_LIFECYCLE_4_DEPENDENCY_MISSING';
  end if;

  if has_function_privilege('public', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute')
     or has_function_privilege('anon', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute')
     or not has_function_privilege('service_role', 'private.materialize_license_upgrade_v1(uuid,text,integer,text,jsonb)', 'execute') then
    raise exception 'LICENSE_LIFECYCLE_4_UPGRADE_ACL_INVALID';
  end if;
end;
$preflight$;

commit;
