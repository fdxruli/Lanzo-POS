-- FASE NOTIF.DB.DRIFT.1
-- NOTIF.5 / NOTIF.6 / NOTIF.8 / NOTIF.9
-- Licencia, realtime ligero, notificaciones operativas y cleanup.
-- Idempotencia por metadata.event_key; cleanup dry-run por default.

create schema if not exists private;

create or replace function private.broadcast_notification_event(
  p_license_id uuid,
  p_event text default 'notifications_changed'::text,
  p_reason text default 'notification_created'::text,
  p_notification_id uuid default null::uuid,
  p_ticket_id uuid default null::uuid,
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
  v_payload jsonb;
  v_metadata jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0, 'code', 'LICENSE_ID_REQUIRED');
  end if;

  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
  limit 1;

  if v_features is null then
    return jsonb_build_object('success', false, 'broadcasted', false, 'topics_count', 0, 'code', 'LICENSE_NOT_FOUND');
  end if;

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true'
     or (
       (v_features->>'support_realtime') is distinct from 'true'
       and (v_features->>'realtime_license_sync') is distinct from 'true'
     ) then
    return jsonb_build_object('success', true, 'broadcasted', false, 'topics_count', 0, 'code', 'REALTIME_DISABLED');
  end if;

  v_metadata := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'event', coalesce(nullif(p_event, ''), 'notifications_changed'),
    'notification_id', p_notification_id,
    'ticket_id', p_ticket_id,
    'reason', coalesce(nullif(p_reason, ''), 'notification_created'),
    'created_at', now(),
    'metadata', v_metadata
  ));

  for v_topic in
    select distinct d.realtime_topic
    from public.license_devices d
    where d.license_id = p_license_id
      and d.is_active is true
      and d.realtime_topic is not null
      and d.realtime_topic like 'license:%'
  loop
    perform realtime.send(v_payload, 'notification_event', v_topic, true);
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

create or replace function private.generate_license_operational_notifications(p_license_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_now timestamptz := now();
  v_expiry_date text;
  v_days_until integer;
  v_event_key text;
  v_once jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  for v_license in
    select
      l.id,
      l.expires_at,
      coalesce(l.is_lifetime, false) as is_lifetime,
      coalesce(p.code, l.license_type::text) as plan_code,
      p.name as plan_name,
      coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb) as features
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where (p_license_id is null or l.id = p_license_id)
      and coalesce(l.is_lifetime, false) is false
      and l.expires_at is not null
      and coalesce(l.status, 'active') in ('active', 'expired', 'grace', 'blocked')
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'notification_center') = 'true'
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'cloud_notifications') = 'true'
  loop
    v_expiry_date := to_char(v_license.expires_at::date, 'YYYY-MM-DD');

    if v_license.expires_at >= v_now and v_license.expires_at <= v_now + interval '7 days' then
      v_days_until := greatest(ceil(extract(epoch from (v_license.expires_at - v_now)) / 86400.0)::integer, 1);
      v_event_key := 'license_expiring_7d:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'warning',
        p_title => 'Lanzo Nube vence pronto',
        p_body => 'Tu plan Lanzo Nube vence en ' || v_days_until || ' días. Renueva para evitar interrupciones.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object('phase', 'NOTIF.5', 'event', 'license_expiring_7d', 'expires_at', v_license.expires_at, 'days_until_expiration', v_days_until, 'plan_code', v_license.plan_code),
        p_source => 'license',
        p_expires_at => v_license.expires_at + interval '1 day'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_expiring_7d'));
    end if;

    if v_license.expires_at >= v_now and v_license.expires_at <= v_now + interval '3 days' then
      v_days_until := greatest(ceil(extract(epoch from (v_license.expires_at - v_now)) / 86400.0)::integer, 1);
      v_event_key := 'license_expiring_3d:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'warning',
        p_title => 'Lanzo Nube vence en pocos días',
        p_body => 'Tu plan Lanzo Nube vence en ' || v_days_until || ' días. El cloud, staff y soporte interno dependen de la renovación.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object('phase', 'NOTIF.5', 'event', 'license_expiring_3d', 'expires_at', v_license.expires_at, 'days_until_expiration', v_days_until, 'plan_code', v_license.plan_code),
        p_source => 'license',
        p_expires_at => v_license.expires_at + interval '1 day'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_expiring_3d'));
    end if;

    if v_license.expires_at < v_now and v_license.expires_at >= v_now - interval '7 days' then
      v_event_key := 'license_grace_period:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'critical',
        p_title => 'Lanzo Nube está en periodo de gracia',
        p_body => 'Tu plan venció. El sistema puede bloquearse si no renuevas antes de terminar el periodo de gracia.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object('phase', 'NOTIF.5', 'event', 'license_grace_period', 'expires_at', v_license.expires_at, 'plan_code', v_license.plan_code),
        p_source => 'license',
        p_expires_at => v_license.expires_at + interval '8 days'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_grace_period'));
    end if;

    if v_license.expires_at < v_now - interval '7 days' then
      v_event_key := 'license_expired:' || v_expiry_date;

      v_once := private.create_pos_notification_once(
        p_license_id => v_license.id,
        p_event_key => v_event_key,
        p_type => 'license',
        p_severity => 'critical',
        p_title => 'Lanzo Nube expiró',
        p_body => 'Tu plan Lanzo Nube expiró y requiere renovación para recuperar el servicio cloud.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object('phase', 'NOTIF.5', 'event', 'license_expired', 'expires_at', v_license.expires_at, 'plan_code', v_license.plan_code),
        p_source => 'license',
        p_expires_at => v_now + interval '30 days'
      );

      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
      v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'license_expired'));
    end if;
  end loop;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_OPERATIONAL_NOTIFICATIONS_ERROR', 'message', 'Could not generate operational notifications.');
end;
$function$;

create or replace function private.generate_sync_operational_notifications(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today text := to_char(current_date, 'YYYY-MM-DD');
  v_conflicts integer := 0;
  v_once jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_ID_REQUIRED', 'generated', 0, 'events', '[]'::jsonb);
  end if;

  if not exists (
    select 1
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.id = p_license_id
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'notification_center') = 'true'
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'cloud_notifications') = 'true'
  ) then
    return jsonb_build_object('success', true, 'generated', 0, 'events', '[]'::jsonb, 'skipped', true);
  end if;

  select count(*)::integer
  into v_conflicts
  from public.pos_sync_conflicts c
  where c.license_id = p_license_id
    and lower(coalesce(c.resolution_status, 'pending')) not in ('resolved', 'dismissed', 'ignored');

  if v_conflicts > 0 then
    v_once := private.create_pos_notification_once(
      p_license_id => p_license_id,
      p_event_key => 'sync_errors_active:' || v_today,
      p_type => 'sync',
      p_severity => 'warning',
      p_title => 'Sincronización requiere atención',
      p_body => 'Hay eventos cloud que no pudieron sincronizarse. Revisa tu conexión o vuelve a intentar.',
      p_action_label => 'Ver estado',
      p_action_route => '/configuracion',
      p_metadata => jsonb_build_object(
        'phase', 'NOTIF.8',
        'generated_by', 'NOTIF.8',
        'category', 'sync',
        'event', 'sync_errors_active',
        'entity_count', v_conflicts
      ),
      p_source => 'sync',
      p_expires_at => now() + interval '24 hours'
    );

    if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'sync_errors_active'));
  end if;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_SYNC_OPERATIONAL_NOTIFICATIONS_ERROR', 'generated', 0, 'events', '[]'::jsonb);
end;
$function$;

create or replace function private.generate_cash_operational_notifications(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session record;
  v_once jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_ID_REQUIRED', 'generated', 0, 'events', '[]'::jsonb);
  end if;

  if not exists (
    select 1
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.id = p_license_id
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'notification_center') = 'true'
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'cloud_notifications') = 'true'
  ) then
    return jsonb_build_object('success', true, 'generated', 0, 'events', '[]'::jsonb, 'skipped', true);
  end if;

  for v_session in
    select id, opened_at
    from public.pos_cash_sessions
    where license_id = p_license_id
      and status = 'open'
      and deleted_at is null
      and opened_at <= now() - interval '12 hours'
    order by opened_at asc
    limit 5
  loop
    v_once := private.create_pos_notification_once(
      p_license_id => p_license_id,
      p_event_key => 'cash_open_long:' || v_session.id,
      p_type => 'cash',
      p_severity => 'warning',
      p_title => 'Caja abierta por mucho tiempo',
      p_body => 'Hay una caja abierta desde hace varias horas. Revisa si debe cerrarse.',
      p_action_label => 'Ver caja',
      p_action_route => '/caja',
      p_metadata => jsonb_build_object(
        'phase', 'NOTIF.8',
        'generated_by', 'NOTIF.8',
        'category', 'cash',
        'event', 'cash_open_long',
        'entity_id', v_session.id,
        'opened_at', v_session.opened_at
      ),
      p_source => 'system',
      p_expires_at => now() + interval '48 hours'
    );

    if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'cash_open_long'));
  end loop;

  for v_session in
    select id, cash_difference, closed_at
    from public.pos_cash_sessions
    where license_id = p_license_id
      and status = 'closed'
      and deleted_at is null
      and coalesce(abs(cash_difference), 0) > 0
    order by closed_at desc nulls last, updated_at desc
    limit 10
  loop
    v_once := private.create_pos_notification_once(
      p_license_id => p_license_id,
      p_event_key => 'cash_difference:' || v_session.id,
      p_type => 'cash',
      p_severity => 'warning',
      p_title => 'Diferencia detectada en caja',
      p_body => 'Se detectó una diferencia en el cierre de caja. Revisa el corte.',
      p_action_label => 'Ver caja',
      p_action_route => '/caja',
      p_metadata => jsonb_build_object(
        'phase', 'NOTIF.8',
        'generated_by', 'NOTIF.8',
        'category', 'cash',
        'event', 'cash_difference',
        'entity_id', v_session.id,
        'closed_at', v_session.closed_at
      ),
      p_source => 'system',
      p_expires_at => now() + interval '30 days'
    );

    if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'cash_difference'));
  end loop;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_CASH_OPERATIONAL_NOTIFICATIONS_ERROR', 'generated', 0, 'events', '[]'::jsonb);
end;
$function$;

create or replace function private.generate_staff_operational_notifications(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_today text := to_char(current_date, 'YYYY-MM-DD');
  v_device record;
  v_staff record;
  v_limits record;
  v_once jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_ID_REQUIRED', 'generated', 0, 'events', '[]'::jsonb);
  end if;

  if not exists (
    select 1
    from public.licenses l
    left join public.plans p on p.id = l.plan_id
    where l.id = p_license_id
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'notification_center') = 'true'
      and ((coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb))->>'cloud_notifications') = 'true'
  ) then
    return jsonb_build_object('success', true, 'generated', 0, 'events', '[]'::jsonb, 'skipped', true);
  end if;

  for v_device in
    select id, last_check_at, activated_at
    from public.license_devices
    where license_id = p_license_id
      and is_active is false
    order by coalesce(last_check_at, activated_at) desc nulls last
    limit 10
  loop
    v_once := private.create_pos_notification_once(
      p_license_id => p_license_id,
      p_event_key => 'device_disabled:' || v_device.id || ':' || v_today,
      p_type => 'system',
      p_severity => 'info',
      p_title => 'Dispositivo desactivado',
      p_body => 'Un dispositivo fue desactivado de esta licencia.',
      p_action_label => 'Ver licencia',
      p_action_route => '/configuracion',
      p_metadata => jsonb_build_object(
        'phase', 'NOTIF.8',
        'generated_by', 'NOTIF.8',
        'category', 'staff',
        'event', 'device_disabled',
        'entity_id', v_device.id
      ),
      p_source => 'license',
      p_expires_at => now() + interval '14 days'
    );

    if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'device_disabled'));
  end loop;

  select l.max_devices, count(d.id) filter (where d.is_active is true)::integer as active_devices
  into v_limits
  from public.licenses l
  left join public.license_devices d on d.license_id = l.id
  where l.id = p_license_id
  group by l.max_devices;

  if coalesce(v_limits.max_devices, 0) > 0 and coalesce(v_limits.active_devices, 0) >= v_limits.max_devices then
    v_once := private.create_pos_notification_once(
      p_license_id => p_license_id,
      p_event_key => 'device_limit_reached:' || v_today,
      p_type => 'system',
      p_severity => 'warning',
      p_title => 'Límite de dispositivos alcanzado',
      p_body => 'Tu licencia Lanzo Nube ya usa todos los dispositivos disponibles.',
      p_action_label => 'Administrar licencia',
      p_action_route => '/configuracion',
      p_metadata => jsonb_build_object(
        'phase', 'NOTIF.8',
        'generated_by', 'NOTIF.8',
        'category', 'staff',
        'event', 'device_limit_reached',
        'active_devices', coalesce(v_limits.active_devices, 0),
        'max_devices', v_limits.max_devices
      ),
      p_source => 'license',
      p_expires_at => now() + interval '7 days'
    );

    if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'device_limit_reached'));
  end if;

  for v_staff in
    select id, updated_at
    from public.license_staff_users
    where license_id = p_license_id
      and is_active is false
    order by updated_at desc
    limit 10
  loop
    v_once := private.create_pos_notification_once(
      p_license_id => p_license_id,
      p_event_key => 'staff_disabled:' || v_staff.id || ':' || v_today,
      p_type => 'system',
      p_severity => 'info',
      p_title => 'Usuario staff desactivado',
      p_body => 'Un usuario staff fue desactivado.',
      p_action_label => 'Ver configuración',
      p_action_route => '/configuracion',
      p_metadata => jsonb_build_object(
        'phase', 'NOTIF.8',
        'generated_by', 'NOTIF.8',
        'category', 'staff',
        'event', 'staff_disabled',
        'entity_id', v_staff.id
      ),
      p_source => 'system',
      p_expires_at => now() + interval '14 days'
    );

    if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'staff_disabled'));
  end loop;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_STAFF_OPERATIONAL_NOTIFICATIONS_ERROR', 'generated', 0, 'events', '[]'::jsonb);
end;
$function$;

create or replace function private.cleanup_old_pos_notifications(
  p_dry_run boolean default true,
  p_archive_expired boolean default true,
  p_delete_test_data boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_expired_count integer := 0;
  v_test_data_count integer := 0;
  v_old_operational_count integer := 0;
  v_archived_count integer := 0;
  v_deleted_count integer := 0;
begin
  select count(*)::integer
  into v_expired_count
  from public.pos_notifications n
  where n.expires_at is not null
    and n.expires_at < now();

  select count(*)::integer
  into v_test_data_count
  from public.pos_notifications n
  where n.metadata->>'test_data' = 'true'
     or n.metadata->>'phase' = 'NOTIF.3'
     or n.metadata->>'cleanup_phase' = 'NOTIF.9';

  select count(*)::integer
  into v_old_operational_count
  from public.pos_notifications n
  where n.metadata ? 'event_key'
    and n.created_at < now() - interval '90 days'
    and n.type <> 'support';

  if p_dry_run is not true and p_archive_expired is true then
    update public.pos_notifications n
    set metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object(
      'archived_by_cleanup', true,
      'cleanup_phase', 'NOTIF.9',
      'cleanup_at', now()
    )
    where n.expires_at is not null
      and n.expires_at < now()
      and (n.metadata->>'archived_by_cleanup') is distinct from 'true';

    get diagnostics v_archived_count = row_count;
  end if;

  if p_dry_run is not true and p_delete_test_data is true then
    delete from public.pos_notifications n
    where n.metadata->>'test_data' = 'true';

    get diagnostics v_deleted_count = row_count;
  end if;

  return jsonb_build_object(
    'success', true,
    'dry_run', p_dry_run,
    'expired_count', v_expired_count,
    'test_data_count', v_test_data_count,
    'old_operational_count', v_old_operational_count,
    'archived_count', v_archived_count,
    'deleted_count', v_deleted_count
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'CLEANUP_OLD_POS_NOTIFICATIONS_ERROR',
      'message', 'No se pudo ejecutar la limpieza de notificaciones.',
      'dry_run', p_dry_run,
      'expired_count', v_expired_count,
      'test_data_count', v_test_data_count,
      'archived_count', v_archived_count,
      'deleted_count', v_deleted_count
    );
end;
$function$;

revoke all on function private.broadcast_notification_event(uuid, text, text, uuid, uuid, jsonb) from public;
revoke all on function private.broadcast_notification_event(uuid, text, text, uuid, uuid, jsonb) from anon;
revoke all on function private.broadcast_notification_event(uuid, text, text, uuid, uuid, jsonb) from authenticated;
revoke all on function private.generate_license_operational_notifications(uuid) from public;
revoke all on function private.generate_license_operational_notifications(uuid) from anon;
revoke all on function private.generate_license_operational_notifications(uuid) from authenticated;
revoke all on function private.generate_sync_operational_notifications(uuid) from public;
revoke all on function private.generate_sync_operational_notifications(uuid) from anon;
revoke all on function private.generate_sync_operational_notifications(uuid) from authenticated;
revoke all on function private.generate_cash_operational_notifications(uuid) from public;
revoke all on function private.generate_cash_operational_notifications(uuid) from anon;
revoke all on function private.generate_cash_operational_notifications(uuid) from authenticated;
revoke all on function private.generate_staff_operational_notifications(uuid) from public;
revoke all on function private.generate_staff_operational_notifications(uuid) from anon;
revoke all on function private.generate_staff_operational_notifications(uuid) from authenticated;
revoke all on function private.cleanup_old_pos_notifications(boolean, boolean, boolean) from public;
revoke all on function private.cleanup_old_pos_notifications(boolean, boolean, boolean) from anon;
revoke all on function private.cleanup_old_pos_notifications(boolean, boolean, boolean) from authenticated;

create or replace function public.refresh_operational_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_license record;
  v_device record;
  v_session record;
  v_features jsonb;
  v_generation jsonb;
  v_sync_generation jsonb;
  v_cash_generation jsonb;
  v_staff_generation jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    'refresh_operational_notifications',
    'notifications',
    60,
    60,
    120,
    'OPERATIONAL_NOTIFICATIONS_RATE_LIMITED',
    jsonb_build_object('phase', 'STAFF.NOTIF.1')
  );

  if p_license_key is null or btrim(p_license_key) = '' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_KEY_REQUIRED', 'message', 'Falta licencia.');
  end if;

  if p_device_fingerprint is null or btrim(p_device_fingerprint) = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_FINGERPRINT_REQUIRED', 'message', 'Falta identificador del dispositivo.');
  end if;

  select
    l.id,
    l.license_key,
    l.status,
    l.expires_at,
    coalesce(p.code, l.license_type::text) as plan_code,
    p.name as plan_name,
    coalesce(p.features, '{}'::jsonb) as plan_features,
    coalesce(l.features, '{}'::jsonb) as license_features
  into v_license
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.license_key = p_license_key
  limit 1;

  if v_license.id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_FOUND', 'message', 'Licencia no encontrada.');
  end if;

  if coalesce(v_license.status, '') not in ('active', 'expired', 'grace', 'blocked') then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  select
    d.id,
    d.license_id,
    d.device_fingerprint,
    d.security_token,
    d.previous_security_token,
    d.is_active,
    coalesce(d.device_role, 'staff') as device_role,
    d.staff_user_id
  into v_device
  from public.license_devices d
  where d.license_id = v_license.id
    and d.device_fingerprint = p_device_fingerprint
  limit 1;

  if v_device.id is null then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ALLOWED', 'message', 'Este dispositivo no esta autorizado.');
  end if;

  if v_device.is_active is not true then
    return jsonb_build_object('success', false, 'code', 'DEVICE_NOT_ACTIVE', 'message', 'Este dispositivo esta desactivado.');
  end if;

  if v_device.security_token is null or p_security_token is null or p_security_token = '' then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_REQUIRED', 'message', 'Falta token seguro del dispositivo.');
  end if;

  if p_security_token <> v_device.security_token
     and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    return jsonb_build_object('success', false, 'code', 'DEVICE_TOKEN_INVALID', 'message', 'Token seguro del dispositivo invalido.');
  end if;

  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);

  if (v_features->>'notification_center') is distinct from 'true'
     or (v_features->>'cloud_notifications') is distinct from 'true' then
    return jsonb_build_object(
      'success', false,
      'code', 'CLOUD_NOTIFICATIONS_DISABLED',
      'message', 'Este plan no incluye notificaciones cloud.',
      'generated', 0,
      'events', '[]'::jsonb
    );
  end if;

  if v_device.device_role = 'staff' then
    if v_device.staff_user_id is null then
      return jsonb_build_object('success', false, 'code', 'STAFF_LOGIN_REQUIRED', 'message', 'Este dispositivo requiere login staff.');
    end if;

    if p_staff_session_token is null or p_staff_session_token = '' then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_REQUIRED', 'message', 'Falta sesion staff.');
    end if;

    select
      ss.id as session_id,
      ss.expires_at,
      s.id as staff_user_id,
      s.is_active as staff_is_active,
      s.permissions
    into v_session
    from public.license_staff_sessions ss
    join public.license_staff_users s on s.id = ss.staff_user_id
    where ss.license_id = v_license.id
      and ss.device_id = v_device.id
      and ss.staff_user_id = v_device.staff_user_id
      and ss.revoked_at is null
      and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash
    limit 1;

    if not found then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_INVALID', 'message', 'Sesion staff invalida.');
    end if;

    if v_session.expires_at < now() then
      return jsonb_build_object('success', false, 'code', 'STAFF_SESSION_EXPIRED', 'message', 'Sesion staff expirada.');
    end if;

    if v_session.staff_is_active is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_USER_INACTIVE', 'message', 'Usuario staff inactivo.');
    end if;

    if coalesce((v_session.permissions->>'notifications')::boolean, false) is not true then
      return jsonb_build_object(
        'success', false,
        'code', 'STAFF_NOTIFICATIONS_DISABLED',
        'message', 'Tu usuario staff no tiene acceso al Centro de Notificaciones.',
        'generated', 0,
        'events', '[]'::jsonb
      );
    end if;

    perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);
  end if;

  v_generation := private.generate_license_operational_notifications(v_license.id);
  if v_generation->>'success' = 'false' then return v_generation; end if;
  v_generated := v_generated + coalesce((v_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_generation->'events', '[]'::jsonb);

  v_sync_generation := private.generate_sync_operational_notifications(v_license.id);
  if v_sync_generation->>'success' = 'false' then return v_sync_generation; end if;
  v_generated := v_generated + coalesce((v_sync_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_sync_generation->'events', '[]'::jsonb);

  v_cash_generation := private.generate_cash_operational_notifications(v_license.id);
  if v_cash_generation->>'success' = 'false' then return v_cash_generation; end if;
  v_generated := v_generated + coalesce((v_cash_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_cash_generation->'events', '[]'::jsonb);

  v_staff_generation := private.generate_staff_operational_notifications(v_license.id);
  if v_staff_generation->>'success' = 'false' then return v_staff_generation; end if;
  v_generated := v_generated + coalesce((v_staff_generation->>'generated')::integer, 0);
  v_events := v_events || coalesce(v_staff_generation->'events', '[]'::jsonb);

  return jsonb_build_object(
    'success', true,
    'generated', v_generated,
    'events', v_events
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'STAFF_NOTIFICATIONS_DISABLED'
        else 'REFRESH_OPERATIONAL_NOTIFICATIONS_ERROR'
      end,
      'message', case
        when sqlerrm = 'STAFF_NOTIFICATIONS_DISABLED' then 'Tu usuario staff no tiene acceso al Centro de Notificaciones.'
        else 'No se pudieron refrescar las notificaciones operativas.'
      end,
      'generated', 0,
      'events', '[]'::jsonb
    );
end;
$function$;

revoke all on function public.refresh_operational_notifications(text, text, text, text) from public;
grant execute on function public.refresh_operational_notifications(text, text, text, text) to anon, authenticated;
