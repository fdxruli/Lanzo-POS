-- SECURITY.TENANT.ACTOR.HARDENING.R1
--
-- This migration is intentionally staged on an isolated branch. It is not
-- applied to the hosted project by this audit.
--
-- Goals:
--   1. Remove PUBLIC inheritance from sensitive actor-aware RPCs while
--      preserving the browser's explicit anon/authenticated execution path.
--   2. Fence legacy actorless admin/ecommerce overloads after the repository
--      consumer audit. Missing actor sessions must fail closed at the current
--      actor-aware RPC boundary.
--   3. Make Broadcast payloads invalidation-only. The client must refetch via
--      the actor-authorized RPC instead of trusting IDs, metadata, or actor
--      details carried by Realtime.
--   4. Enable RLS on private operational tables with no direct client grants.

begin;

-- 1) Sensitive RPC execution: no PUBLIC inheritance, explicit client roles.
revoke all on function public.admin_create_staff_user(
  text, text, text, text, text, text, jsonb, text, text
) from public, anon, authenticated;
grant execute on function public.admin_create_staff_user(
  text, text, text, text, text, text, jsonb, text, text
) to anon, authenticated, service_role;

revoke all on function public.admin_list_staff_users(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_list_staff_users(
  text, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.admin_update_staff_user(
  text, text, text, uuid, text, jsonb, boolean, text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_update_staff_user(
  text, text, text, uuid, text, jsonb, boolean, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.pos_admin_adopt_legacy_cash_session(
  text, text, text, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.pos_admin_adopt_legacy_cash_session(
  text, text, text, text, text, integer, text
) to anon, authenticated, service_role;

revoke all on function public.pos_admin_close_cash_session(
  text, text, text, text, text, text, numeric, numeric, text, text, integer, text
) from public, anon, authenticated;
grant execute on function public.pos_admin_close_cash_session(
  text, text, text, text, text, text, numeric, numeric, text, text, integer, text
) to anon, authenticated, service_role;

revoke all on function public.pos_get_cash_station_state(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.pos_get_cash_station_state(
  text, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_get_portal(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_get_portal(
  text, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_list_published_products(
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_list_published_products(
  text, text, text, text
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_set_product_published(
  text, text, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_set_product_published(
  text, text, text, text, uuid, boolean
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_upsert_portal(
  text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_portal(
  text, text, text, text, jsonb
) to anon, authenticated, service_role;

revoke all on function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product(
  text, text, text, text, jsonb
) to anon, authenticated, service_role;

-- 2) Legacy actorless overloads. They remain catalogued for reversible
-- compatibility, but client roles cannot execute them. Trusted server-side
-- maintenance may retain access while consumers complete the cutover.
revoke all on function public.admin_create_staff_user(
  text, text, text, text, text, text, jsonb, text
) from public, anon, authenticated;
grant execute on function public.admin_create_staff_user(
  text, text, text, text, text, text, jsonb, text
) to service_role;
revoke all on function public.admin_list_staff_users(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.admin_list_staff_users(
  text, text, text
) to service_role;
revoke all on function public.admin_update_staff_user(
  text, text, text, uuid, text, jsonb, boolean, text, text
) from public, anon, authenticated;
grant execute on function public.admin_update_staff_user(
  text, text, text, uuid, text, jsonb, boolean, text, text
) to service_role;

revoke all on function public.ecommerce_admin_get_portal(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_get_portal(
  text, text, text
) to service_role;
revoke all on function public.ecommerce_admin_list_published_products(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_list_published_products(
  text, text, text
) to service_role;
revoke all on function public.ecommerce_admin_set_product_published(
  text, text, text, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_set_product_published(
  text, text, text, uuid, boolean
) to service_role;
revoke all on function public.ecommerce_admin_upsert_portal(
  text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_portal(
  text, text, text, jsonb
) to service_role;
revoke all on function public.ecommerce_admin_upsert_published_product(
  text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.ecommerce_admin_upsert_published_product(
  text, text, text, jsonb
) to service_role;

-- 3) Private operational tables have no direct client grants. RLS provides a
-- second boundary if a future grant or SECURITY INVOKER helper is introduced.
alter table private.ecommerce_catalog_sync_requests enable row level security;
alter table private.ecommerce_public_rate_limit_secret enable row level security;
alter table private.pos_notification_operational_incidents enable row level security;

-- 4) Realtime is an invalidation bus only. Routing remains per-device and the
-- existing private-channel policies continue to decide who can join. Payloads
-- deliberately omit business IDs, metadata, fingerprints, and actor IDs.
create or replace function private.broadcast_license_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_target_fingerprint text;
  v_broadcast_all boolean;
  v_device record;
begin
  v_target_fingerprint := coalesce(
    new.metadata->>'fingerprint',
    new.metadata->>'target_fingerprint',
    new.metadata->>'device_fingerprint'
  );

  v_broadcast_all := new.event_type in (
    'LICENSE_UPDATE',
    'LICENSE_REVOKED',
    'LICENSE_SUSPENDED',
    'SUBSCRIPTION_UPDATED',
    'PLAN_CHANGED',
    'LICENSE_RENEWED',
    'BUSINESS_PROFILE_UPDATED'
  );

  for v_device in
    select d.realtime_topic
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where l.license_key = new.license_key
      and d.realtime_topic is not null
      and private.license_realtime_enabled(p.features, l.features)
      and (
        (v_broadcast_all and d.is_active = true)
        or (v_target_fingerprint is not null and d.device_fingerprint = v_target_fingerprint)
      )
  loop
    perform realtime.send(
      jsonb_build_object(
        'schema_version', 1,
        'kind', 'invalidate',
        'scope', 'license',
        'event_type', new.event_type,
        'triggered_at', new.triggered_at
      ),
      'license_event',
      v_device.realtime_topic,
      true
    );
  end loop;

  return new;
end;
$function$;

create or replace function private.broadcast_pos_event(
  p_license_id uuid,
  p_event jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_device record;
begin
  for v_device in
    select 'pos:' || split_part(d.realtime_topic, ':', 2) as pos_topic
    from public.license_devices d
    join public.licenses l on l.id = d.license_id
    left join public.plans p on p.id = l.plan_id
    where d.license_id = p_license_id
      and d.is_active = true
      and d.realtime_topic is not null
      and private.cloud_pos_sync_enabled(p.features, l.features)
  loop
    perform realtime.send(
      jsonb_build_object(
        'schema_version', 1,
        'kind', 'invalidate',
        'scope', 'pos',
        'created_at', now()
      ),
      'pos_event',
      v_device.pos_topic,
      true
    );
  end loop;
end;
$function$;

create or replace function private.broadcast_ecommerce_order_change_v1(
  p_license_id uuid,
  p_order_id uuid,
  p_status text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_topic text;
  v_topics_count integer := 0;
begin
  if p_license_id is null or p_order_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0);
  end if;

  if private.ecommerce_license_feature_bool(
    p_license_id,
    'ecommerce_realtime_orders',
    false
  ) is not true then
    return jsonb_build_object(
      'success', true,
      'broadcasted', false,
      'topics_count', 0,
      'code', 'REALTIME_DISABLED'
    );
  end if;

  for v_topic in
    select distinct d.realtime_topic
    from public.license_devices d
    where d.license_id = p_license_id
      and d.is_active is true
      and d.realtime_topic is not null
      and d.realtime_topic like 'license:%'
  loop
    perform realtime.send(
      jsonb_build_object(
        'schema_version', 1,
        'kind', 'invalidate',
        'scope', 'ecommerce_orders',
        'event', 'ecommerce_orders_changed',
        'created_at', now()
      ),
      'notification_event',
      v_topic,
      true
    );
    v_topics_count := v_topics_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'broadcasted', v_topics_count > 0,
    'topics_count', v_topics_count
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', coalesce(v_topics_count, 0),
      'code', 'ECOMMERCE_ORDER_BROADCAST_FAILED'
    );
end;
$function$;

create or replace function private.broadcast_notification_event(
  p_license_id uuid,
  p_event text default 'notifications_changed',
  p_reason text default 'notification_created',
  p_notification_id uuid default null,
  p_ticket_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_features jsonb;
  v_topic text;
  v_topics_count integer := 0;
  v_event text;
  v_reason text;
begin
  if p_license_id is null then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', 0,
      'code', 'LICENSE_ID_REQUIRED'
    );
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
  limit 1;

  if v_features is null then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', 0,
      'code', 'LICENSE_NOT_FOUND'
    );
  end if;

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true'
     or (
       (v_features->>'support_realtime') is distinct from 'true'
       and (v_features->>'realtime_license_sync') is distinct from 'true'
     ) then
    return jsonb_build_object(
      'success', true,
      'broadcasted', false,
      'topics_count', 0,
      'code', 'REALTIME_DISABLED'
    );
  end if;

  v_event := case
    when p_event = 'ecommerce_orders_changed' then 'ecommerce_orders_changed'
    else 'notifications_changed'
  end;

  v_reason := case
    when p_reason in (
      'support_reply',
      'ticket_status_changed',
      'support_ticket_changed',
      'operational_refresh',
      'cash_changed',
      'sync_changed',
      'ecommerce_order_created',
      'notification_created'
    ) then p_reason
    else 'notification_changed'
  end;

  for v_topic in
    select distinct d.realtime_topic
    from public.license_devices d
    where d.license_id = p_license_id
      and d.is_active is true
      and d.realtime_topic is not null
      and d.realtime_topic like 'license:%'
  loop
    perform realtime.send(
      jsonb_build_object(
        'schema_version', 1,
        'kind', 'invalidate',
        'scope', 'notifications',
        'event', v_event,
        'reason', v_reason,
        'created_at', now()
      ),
      'notification_event',
      v_topic,
      true
    );
    v_topics_count := v_topics_count + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'broadcasted', v_topics_count > 0,
    'topics_count', v_topics_count
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'broadcasted', false,
      'topics_count', coalesce(v_topics_count, 0),
      'code', 'BROADCAST_NOTIFICATION_EVENT_ERROR'
    );
end;
$function$;

commit;
