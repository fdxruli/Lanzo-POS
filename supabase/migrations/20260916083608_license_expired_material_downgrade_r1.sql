-- LICENSE.LIFECYCLE.2
-- Materialize a fully expired paid license as permanent Lanzo Local / Free.
--
-- Deliberately out of scope: cron/scheduling, billing, payments, Telegram,
-- promotions, and bulk processing. The primitive accepts exactly one license.

-- Keep the existing plan snapshot trigger as the single source of snapshot
-- fields, but strip every feature key owned by a plan before applying the
-- target plan. This prevents plan-only capabilities that are absent from Free
-- (for example cloud_layaways) from surviving a downgrade in licenses.features.
create or replace function public.sync_license_plan_snapshot()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan record;
  v_free_plan_id uuid;
  v_should_sync boolean := false;
  v_existing_features jsonb;
  v_base_features jsonb;
  v_plan_features jsonb;
  v_plan_feature_keys text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    v_should_sync := true;
  else
    v_should_sync :=
      new.plan_id is distinct from old.plan_id
      or (
        new.license_type is distinct from old.license_type
        and lower(coalesce(new.license_type, '')) in ('trial', 'free_trial')
      );
  end if;

  if not v_should_sync then
    return new;
  end if;

  if lower(coalesce(new.license_type, '')) in ('trial', 'free_trial')
     and (tg_op = 'INSERT' or new.plan_id is not distinct from old.plan_id) then
    select p.id
      into v_free_plan_id
      from public.plans p
     where p.code = 'free_trial'
       and p.is_active is true
     limit 1;

    if v_free_plan_id is not null then
      new.plan_id := v_free_plan_id;
    end if;
  end if;

  if new.plan_id is null then
    return new;
  end if;

  select *
    into v_plan
    from public.plans p
   where p.id = new.plan_id;

  if v_plan.id is null then
    return new;
  end if;

  select coalesce(array_agg(distinct plan_key.feature_key), array[]::text[])
    into v_plan_feature_keys
    from public.plans candidate
    cross join lateral jsonb_object_keys(coalesce(candidate.features, '{}'::jsonb))
      as plan_key(feature_key);

  v_existing_features := coalesce(new.features, '{}'::jsonb);
  v_plan_features := coalesce(v_plan.features, '{}'::jsonb);
  v_base_features :=
    (v_existing_features - v_plan_feature_keys - 'max_rubros' - 'allowed_rubros')
    || jsonb_build_object(
      'full_access', coalesce((v_existing_features->>'full_access')::boolean, true),
      'max_rubros', 1,
      'allowed_rubros', jsonb_build_array('*')
    );

  new.features := v_base_features || v_plan_features;
  new.max_devices := coalesce(v_plan.max_devices, new.max_devices, 1);
  new.price := coalesce(v_plan.price, new.price);
  new.product_name := case
    when v_plan.code = 'free_trial' then 'Lanzo POS Free'
    when v_plan.code = 'basic_monthly' then 'Lanzo POS Basico'
    when v_plan.code = 'pro_monthly' then 'Lanzo POS Pro'
    else coalesce(nullif(trim(new.product_name), ''), 'Lanzo POS - ' || v_plan.name)
  end;
  new.license_type := case
    when v_plan.code = 'free_trial' then 'free'
    when v_plan.code like '%monthly' then 'subscription'
    else coalesce(nullif(trim(new.license_type), ''), v_plan.code)
  end;

  return new;
end;
$function$;

revoke all on function public.sync_license_plan_snapshot()
  from public, anon, authenticated;
grant execute on function public.sync_license_plan_snapshot()
  to service_role;

-- Reuse the established AFTER UPDATE plan-limit hook, aligned with the current
-- device_mode model. Staff users remain stored; only staff sessions and
-- staff-only device capability are revoked.
create or replace function public.enforce_license_plan_limits_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_plan_code text;
  v_plan_name text;
  v_features jsonb;
  v_staff_roles_enabled boolean;
  v_max_devices integer;
  v_active_before integer := 0;
  v_active_after integer := 0;
  v_staff_blocked integer := 0;
  v_staff_sessions_revoked integer := 0;
  v_over_limit_blocked integer := 0;
  v_now timestamptz := now();
begin
  select p.code, p.name, coalesce(p.features, '{}'::jsonb) || coalesce(new.features, '{}'::jsonb)
    into v_plan_code, v_plan_name, v_features
    from public.plans p
   where p.id = new.plan_id;

  v_staff_roles_enabled := coalesce((v_features->>'staff_roles')::boolean, false);
  v_max_devices := greatest(coalesce(new.max_devices, 1), 0);

  select count(*)
    into v_active_before
    from public.license_devices d
   where d.license_id = new.id
     and d.is_active is true;

  if not v_staff_roles_enabled then
    with blocked as (
      update public.license_devices d
         set is_active = false,
             security_token = null,
             previous_security_token = null,
             last_check_at = v_now,
             device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
               'license_block', jsonb_build_object(
                 'reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
                 'message', 'Esta licencia cambio a un plan que no incluye usuarios staff.',
                 'plan_code', v_plan_code,
                 'plan_name', v_plan_name,
                 'blocked_at', v_now
               )
             )
       where d.license_id = new.id
         and d.is_active is true
         and d.device_mode = 'staff_only'
      returning d.id
    )
    select count(*) into v_staff_blocked from blocked;

    with revoked as (
      update public.license_staff_sessions s
         set revoked_at = coalesce(s.revoked_at, v_now),
             metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
               'revoked_reason', 'PLAN_DOWNGRADE_STAFF_NOT_INCLUDED',
               'revoked_at', v_now,
               'plan_code', v_plan_code,
               'plan_name', v_plan_name
             )
       where s.license_id = new.id
         and s.revoked_at is null
      returning s.id
    )
    select count(*) into v_staff_sessions_revoked from revoked;
  end if;

  with ranked_devices as (
    select d.id,
           row_number() over (
             order by
               case d.device_mode
                 when 'admin_only' then 0
                 when 'shared' then 1
                 else 2
               end,
               d.activated_at asc nulls last,
               d.last_used_at desc nulls last,
               d.id asc
           ) as keep_rank
      from public.license_devices d
     where d.license_id = new.id
       and d.is_active is true
  ), blocked as (
    update public.license_devices d
       set is_active = false,
           security_token = null,
           previous_security_token = null,
           last_check_at = v_now,
           device_info = coalesce(d.device_info, '{}'::jsonb) || jsonb_build_object(
             'license_block', jsonb_build_object(
               'reason', 'PLAN_DOWNGRADE_DEVICE_LIMIT',
               'message', 'Esta licencia cambio a un plan con menos dispositivos permitidos.',
               'plan_code', v_plan_code,
               'plan_name', v_plan_name,
               'max_devices', v_max_devices,
               'blocked_at', v_now
             )
           )
      from ranked_devices ranked
     where d.id = ranked.id
       and ranked.keep_rank > v_max_devices
    returning d.id
  )
  select count(*) into v_over_limit_blocked from blocked;

  select count(*)
    into v_active_after
    from public.license_devices d
   where d.license_id = new.id
     and d.is_active is true;

  if v_staff_blocked > 0
     or v_staff_sessions_revoked > 0
     or v_over_limit_blocked > 0 then
    insert into public.license_events (license_key, event_type, metadata)
    values (
      new.license_key,
      'LICENSE_UPDATE',
      jsonb_build_object(
        'source', 'enforce_license_plan_limits_after_change',
        'reason', 'PLAN_LIMITS_ENFORCED',
        'plan', v_plan_code,
        'plan_name', v_plan_name,
        'staff_devices_blocked', v_staff_blocked,
        'staff_sessions_revoked', v_staff_sessions_revoked,
        'over_limit_devices_blocked', v_over_limit_blocked,
        'active_devices_before', v_active_before,
        'active_devices_after', v_active_after,
        'max_devices', v_max_devices
      )
    );
  end if;

  return null;
end;
$function$;

revoke all on function public.enforce_license_plan_limits_after_change()
  from public, anon, authenticated;
grant execute on function public.enforce_license_plan_limits_after_change()
  to service_role;

create or replace function private.materialize_expired_license_to_free_v1(
  p_license_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_entitlement record;
  v_free_plan public.plans%rowtype;
  v_materialized_at timestamptz := now();
  v_period_id uuid;
  v_publication_limit integer := 0;
  v_published_before integer := 0;
  v_published_after integer := 0;
  v_publications_unpublished integer := 0;
  v_active_devices integer := 0;
  v_active_staff_sessions integer := 0;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_ID_REQUIRED');
  end if;

  -- The row lock is the concurrency boundary. Every precondition below is
  -- evaluated only after this lock is held.
  select l.id,
         l.license_key,
         l.plan_id,
         l.license_type,
         l.status,
         l.expires_at,
         l.is_lifetime,
         l.duration_months,
         l.features,
         p.code as plan_code,
         p.name as plan_name,
         p.price as plan_price
    into v_license
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
   where l.id = p_license_id
   for update of l;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'changed', false, 'code', 'LICENSE_NOT_FOUND');
  end if;

  if v_license.plan_code = 'free_trial' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'ALREADY_FREE',
      'license_id', v_license.id,
      'plan_code', v_license.plan_code
    );
  end if;

  select *
    into v_entitlement
    from private.license_entitlement_state_v1(v_license.id);

  if lower(coalesce(v_license.status::text, '')) <> 'active'
     or v_entitlement.lifecycle_state = 'administratively_blocked' then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'ADMINISTRATIVELY_BLOCKED',
      'license_id', v_license.id,
      'administrative_status', v_license.status
    );
  end if;

  if coalesce(v_license.is_lifetime, false)
     or v_license.expires_at is null
     or coalesce(v_license.plan_price, 0) <= 0 then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', 'NOT_ELIGIBLE_PAID_LICENSE',
      'license_id', v_license.id,
      'plan_code', v_license.plan_code
    );
  end if;

  if v_entitlement.lifecycle_state <> 'expired'
     or v_entitlement.is_entitled is not false then
    return jsonb_build_object(
      'success', true,
      'changed', false,
      'code', case
        when v_entitlement.lifecycle_state = 'active' then 'LICENSE_ACTIVE'
        when v_entitlement.lifecycle_state = 'grace_period' then 'LICENSE_IN_GRACE'
        else 'LICENSE_NOT_EXPIRED'
      end,
      'license_id', v_license.id,
      'lifecycle_state', v_entitlement.lifecycle_state,
      'grace_period_ends', v_entitlement.grace_period_ends
    );
  end if;

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

  v_publication_limit := greatest(
    coalesce((coalesce(v_free_plan.features, '{}'::jsonb)->>'ecommerce_max_published_products')::integer, 0),
    -1
  );

  select count(*)
    into v_published_before
    from public.ecommerce_published_products pp
   where pp.license_id = v_license.id
     and pp.deleted_at is null
     and pp.is_published is true;

  -- Paid history remains paid. Only active rows are closed, and an invalid
  -- open-ended/overlong paid boundary is capped at the canonical expires_at.
  update public.license_periods lp
     set status = 'expired',
         ends_at = case
           when lp.ends_at is null or lp.ends_at > v_license.expires_at
             then v_license.expires_at
           else lp.ends_at
         end,
         closed_at = coalesce(lp.closed_at, v_materialized_at),
         metadata = coalesce(lp.metadata, '{}'::jsonb) || jsonb_build_object(
           'closed_by', 'materialize_expired_license_to_free_v1',
           'closed_reason', 'paid_plan_expired',
           'materialized_at', v_materialized_at,
           'previous_ends_at', lp.ends_at
         )
   where lp.license_id = v_license.id
     and lp.status = 'active';

  -- The existing BEFORE/AFTER plan hooks own snapshot, device, and Staff
  -- reconciliation. This statement also restores the permanent Free fields.
  update public.licenses l
     set plan_id = v_free_plan.id,
         license_type = 'free',
         duration_months = null,
         expires_at = null,
         is_lifetime = true,
         status = 'active'
   where l.id = v_license.id;

  -- Publication intent uses the existing is_published semantic. Keep the
  -- catalog's established display order, then creation time and UUID as stable
  -- tie-breakers. Metadata preserves why rows were withdrawn for restoration.
  if v_publication_limit >= 0 then
    with ranked as materialized (
      select pp.id,
             row_number() over (
               partition by pp.portal_id
               order by pp.display_order asc, pp.created_at asc, pp.id asc
             ) as keep_rank
        from public.ecommerce_published_products pp
       where pp.license_id = v_license.id
         and pp.deleted_at is null
         and pp.is_published is true
    ), withdrawn as (
      update public.ecommerce_published_products pp
         set is_published = false,
             metadata = coalesce(pp.metadata, '{}'::jsonb) || jsonb_build_object(
               'plan_downgrade_publication', jsonb_build_object(
                 'reason', 'PLAN_DOWNGRADE_PUBLICATION_LIMIT',
                 'previous_plan', v_license.plan_code,
                 'new_plan', v_free_plan.code,
                 'free_limit', v_publication_limit,
                 'materialized_at', v_materialized_at,
                 'was_published', true
               )
             )
        from ranked
       where pp.id = ranked.id
         and ranked.keep_rank > v_publication_limit
      returning pp.id
    )
    select count(*) into v_publications_unpublished from withdrawn;
  end if;

  select count(*)
    into v_published_after
    from public.ecommerce_published_products pp
   where pp.license_id = v_license.id
     and pp.deleted_at is null
     and pp.is_published is true;

  insert into public.license_periods (
    license_id, plan_id, plan_code_snapshot, plan_name_snapshot,
    period_type, status, starts_at, ends_at, ai_agent_limit, metadata
  ) values (
    v_license.id, v_free_plan.id, v_free_plan.code, v_free_plan.name,
    'trial', 'active', v_materialized_at, null, 0,
    jsonb_build_object(
      'source', 'materialize_expired_license_to_free_v1',
      'reason', 'paid_plan_expired',
      'license_kind', 'free_lifetime',
      'is_lifetime', true,
      'previous_plan', v_license.plan_code,
      'materialized_at', v_materialized_at
    )
  )
  returning id into v_period_id;

  select count(*) into v_active_devices
    from public.license_devices d
   where d.license_id = v_license.id and d.is_active is true;

  select count(*) into v_active_staff_sessions
    from public.license_staff_sessions s
   where s.license_id = v_license.id and s.revoked_at is null;

  insert into public.license_events (license_key, event_type, metadata)
  values (
    v_license.license_key,
    'PLAN_EXPIRED_DOWNGRADED_TO_FREE',
    jsonb_build_object(
      'source', 'materialize_expired_license_to_free_v1',
      'actor', 'system',
      'reason', 'paid_plan_expired',
      'previous_plan', v_license.plan_code,
      'new_plan', v_free_plan.code,
      'expired_at', v_entitlement.expires_at,
      'grace_ended_at', v_entitlement.grace_period_ends,
      'materialized_at', v_materialized_at,
      'period_id', v_period_id,
      'publication_limit', v_publication_limit,
      'published_before', v_published_before,
      'published_after', v_published_after,
      'publications_unpublished', v_publications_unpublished,
      'active_devices_after', v_active_devices,
      'active_staff_sessions_after', v_active_staff_sessions
    )
  );

  -- Orders, order items, reservations, portals, Staff users, and device rows
  -- are intentionally not deleted or rewritten by this primitive.
  return jsonb_build_object(
    'success', true,
    'changed', true,
    'code', 'PLAN_EXPIRED_DOWNGRADED_TO_FREE',
    'license_id', v_license.id,
    'previous_plan', v_license.plan_code,
    'new_plan', v_free_plan.code,
    'expired_at', v_entitlement.expires_at,
    'grace_ended_at', v_entitlement.grace_period_ends,
    'materialized_at', v_materialized_at,
    'period_id', v_period_id,
    'publication_limit', v_publication_limit,
    'published_before', v_published_before,
    'published_after', v_published_after,
    'publications_unpublished', v_publications_unpublished,
    'active_devices_after', v_active_devices,
    'active_staff_sessions_after', v_active_staff_sessions
  );
end;
$function$;

revoke all on function private.materialize_expired_license_to_free_v1(uuid)
  from public, anon, authenticated;
grant execute on function private.materialize_expired_license_to_free_v1(uuid)
  to service_role;

comment on function private.materialize_expired_license_to_free_v1(uuid) is
  'LICENSE.LIFECYCLE.2 single-license, row-locked, idempotent materialization from canonically expired paid plan to permanent Free. No scheduler or batch behavior.';
