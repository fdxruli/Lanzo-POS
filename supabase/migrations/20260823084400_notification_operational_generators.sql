-- POS Notification Center hotfix: transition/incident operational generation.

begin;

create or replace function private.generate_staff_operational_notifications(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_device record;
  v_staff record;
  v_limits record;
  v_incident jsonb;
  v_once jsonb;
  v_incident_id uuid;
  v_notification_id uuid;
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

  -- Resolve device incidents whose authoritative state is active again.
  update private.pos_notification_operational_incidents i
  set resolved_at = now(),
      current_state = i.current_state || jsonb_build_object('active', false),
      updated_at = now()
  where i.license_id = p_license_id
    and i.incident_type = 'device_disabled'
    and i.resolved_at is null
    and not exists (
      select 1
      from public.license_devices d
      where d.license_id = p_license_id
        and d.id::text = coalesce(i.entity_id, '')
        and d.is_active is false
    );

  for v_device in
    select id, last_check_at, activated_at
    from public.license_devices
    where license_id = p_license_id
      and is_active is false
    order by coalesce(last_check_at, activated_at) desc nulls last
    limit 10
  loop
    v_incident := private.set_pos_operational_incident_state(
      p_license_id,
      'device_disabled',
      v_device.id::text,
      true,
      jsonb_build_object('last_check_at', v_device.last_check_at, 'activated_at', v_device.activated_at)
    );
    v_incident_id := nullif(v_incident->>'incident_id', '')::uuid;
    v_notification_id := nullif(v_incident->>'notification_id', '')::uuid;

    if v_notification_id is null then
      v_once := private.create_pos_notification_once(
        p_license_id => p_license_id,
        p_event_key => 'device_disabled:' || v_device.id || ':' || v_incident_id,
        p_type => 'system',
        p_severity => 'info',
        p_title => 'Dispositivo desactivado',
        p_body => 'Un dispositivo fue desactivado de esta licencia.',
        p_action_label => 'Ver licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.9',
          'generated_by', 'NOTIF.9',
          'category', 'staff',
          'event', 'device_disabled',
          'entity_id', v_device.id,
          'incident_id', v_incident_id
        ),
        p_source => 'license',
        p_expires_at => now() + interval '14 days'
      );
      v_notification_id := nullif(v_once->>'notification_id', '')::uuid;
      if v_notification_id is not null then
        update private.pos_notification_operational_incidents
        set notification_id = v_notification_id, updated_at = now()
        where id = v_incident_id and license_id = p_license_id;
      end if;
      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    else
      update public.pos_notifications
      set expires_at = greatest(coalesce(expires_at, now()), now() + interval '14 days')
      where id = v_notification_id and license_id = p_license_id;
      v_once := jsonb_build_object('success', true, 'created', false, 'notification_id', v_notification_id, 'incident_id', v_incident_id);
    end if;

    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'device_disabled'));
  end loop;

  select l.max_devices, count(d.id) filter (where d.is_active is true)::integer as active_devices
  into v_limits
  from public.licenses l
  left join public.license_devices d on d.license_id = l.id
  where l.id = p_license_id
  group by l.max_devices;

  if coalesce(v_limits.max_devices, 0) > 0
     and coalesce(v_limits.active_devices, 0) >= v_limits.max_devices then
    v_incident := private.set_pos_operational_incident_state(
      p_license_id,
      'device_limit_reached',
      null,
      true,
      jsonb_build_object('active_devices', coalesce(v_limits.active_devices, 0), 'max_devices', v_limits.max_devices)
    );
    v_incident_id := nullif(v_incident->>'incident_id', '')::uuid;
    v_notification_id := nullif(v_incident->>'notification_id', '')::uuid;

    if v_notification_id is null then
      v_once := private.create_pos_notification_once(
        p_license_id => p_license_id,
        p_event_key => 'device_limit_reached:' || v_incident_id,
        p_type => 'system',
        p_severity => 'warning',
        p_title => 'Límite de dispositivos alcanzado',
        p_body => 'Tu licencia Lanzo Nube ya usa todos los dispositivos disponibles.',
        p_action_label => 'Administrar licencia',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.9',
          'generated_by', 'NOTIF.9',
          'category', 'staff',
          'event', 'device_limit_reached',
          'active_devices', coalesce(v_limits.active_devices, 0),
          'max_devices', v_limits.max_devices,
          'incident_id', v_incident_id
        ),
        p_source => 'license',
        p_expires_at => now() + interval '7 days'
      );
      v_notification_id := nullif(v_once->>'notification_id', '')::uuid;
      if v_notification_id is not null then
        update private.pos_notification_operational_incidents
        set notification_id = v_notification_id, updated_at = now()
        where id = v_incident_id and license_id = p_license_id;
      end if;
      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    else
      update public.pos_notifications
      set expires_at = greatest(coalesce(expires_at, now()), now() + interval '7 days')
      where id = v_notification_id and license_id = p_license_id;
      v_once := jsonb_build_object('success', true, 'created', false, 'notification_id', v_notification_id, 'incident_id', v_incident_id);
    end if;

    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'device_limit_reached'));
  else
    perform private.set_pos_operational_incident_state(
      p_license_id,
      'device_limit_reached',
      null,
      false,
      jsonb_build_object('active_devices', coalesce(v_limits.active_devices, 0), 'max_devices', v_limits.max_devices)
    );
  end if;

  -- Resolve staff incidents whose authoritative user state is active again.
  update private.pos_notification_operational_incidents i
  set resolved_at = now(),
      current_state = i.current_state || jsonb_build_object('active', false),
      updated_at = now()
  where i.license_id = p_license_id
    and i.incident_type = 'staff_disabled'
    and i.resolved_at is null
    and not exists (
      select 1
      from public.license_staff_users s
      where s.license_id = p_license_id
        and s.id::text = coalesce(i.entity_id, '')
        and s.is_active is false
    );

  for v_staff in
    select id, updated_at
    from public.license_staff_users
    where license_id = p_license_id
      and is_active is false
    order by updated_at desc
    limit 10
  loop
    v_incident := private.set_pos_operational_incident_state(
      p_license_id,
      'staff_disabled',
      v_staff.id::text,
      true,
      jsonb_build_object('updated_at', v_staff.updated_at)
    );
    v_incident_id := nullif(v_incident->>'incident_id', '')::uuid;
    v_notification_id := nullif(v_incident->>'notification_id', '')::uuid;

    if v_notification_id is null then
      v_once := private.create_pos_notification_once(
        p_license_id => p_license_id,
        p_event_key => 'staff_disabled:' || v_staff.id || ':' || v_incident_id,
        p_type => 'system',
        p_severity => 'info',
        p_title => 'Usuario staff desactivado',
        p_body => 'Un usuario staff fue desactivado.',
        p_action_label => 'Ver configuración',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.9',
          'generated_by', 'NOTIF.9',
          'category', 'staff',
          'event', 'staff_disabled',
          'entity_id', v_staff.id,
          'incident_id', v_incident_id
        ),
        p_source => 'system',
        p_expires_at => now() + interval '14 days'
      );
      v_notification_id := nullif(v_once->>'notification_id', '')::uuid;
      if v_notification_id is not null then
        update private.pos_notification_operational_incidents
        set notification_id = v_notification_id, updated_at = now()
        where id = v_incident_id and license_id = p_license_id;
      end if;
      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    else
      update public.pos_notifications
      set expires_at = greatest(coalesce(expires_at, now()), now() + interval '14 days')
      where id = v_notification_id and license_id = p_license_id;
      v_once := jsonb_build_object('success', true, 'created', false, 'notification_id', v_notification_id, 'incident_id', v_incident_id);
    end if;

    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'staff_disabled'));
  end loop;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_STAFF_OPERATIONAL_NOTIFICATIONS_ERROR', 'generated', 0, 'events', '[]'::jsonb);
end;
$function$;

create or replace function private.generate_sync_operational_notifications(p_license_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_unresolved integer := 0;
  v_incident jsonb;
  v_incident_id uuid;
  v_notification_id uuid;
  v_once jsonb;
  v_generated integer := 0;
  v_events jsonb := '[]'::jsonb;
begin
  if p_license_id is null then
    return jsonb_build_object('success', false, 'code', 'LICENSE_ID_REQUIRED', 'generated', 0, 'events', '[]'::jsonb);
  end if;

  select count(*)::integer
  into v_unresolved
  from public.pos_sync_conflicts c
  where c.license_id = p_license_id
    and c.resolved_at is null;

  if v_unresolved > 0 then
    v_incident := private.set_pos_operational_incident_state(
      p_license_id,
      'sync_errors_active',
      null,
      true,
      jsonb_build_object('unresolved_count', v_unresolved)
    );
    v_incident_id := nullif(v_incident->>'incident_id', '')::uuid;
    v_notification_id := nullif(v_incident->>'notification_id', '')::uuid;

    if v_notification_id is null then
      v_once := private.create_pos_notification_once(
        p_license_id => p_license_id,
        p_event_key => 'sync_errors_active:' || v_incident_id,
        p_type => 'sync',
        p_severity => 'warning',
        p_title => 'Errores de sincronización pendientes',
        p_body => 'Hay cambios que todavía requieren atención para completar la sincronización.',
        p_action_label => 'Revisar sincronización',
        p_action_route => '/configuracion',
        p_metadata => jsonb_build_object(
          'phase', 'NOTIF.9',
          'generated_by', 'NOTIF.9',
          'category', 'sync',
          'event', 'sync_errors_active',
          'unresolved_count', v_unresolved,
          'incident_id', v_incident_id
        ),
        p_source => 'sync',
        p_expires_at => now() + interval '24 hours'
      );
      v_notification_id := nullif(v_once->>'notification_id', '')::uuid;
      if v_notification_id is not null then
        update private.pos_notification_operational_incidents
        set notification_id = v_notification_id, updated_at = now()
        where id = v_incident_id and license_id = p_license_id;
      end if;
      if coalesce((v_once->>'created')::boolean, false) then v_generated := v_generated + 1; end if;
    else
      update public.pos_notifications
      set expires_at = greatest(coalesce(expires_at, now()), now() + interval '24 hours')
      where id = v_notification_id and license_id = p_license_id;
      v_once := jsonb_build_object('success', true, 'created', false, 'notification_id', v_notification_id, 'incident_id', v_incident_id);
    end if;

    v_events := v_events || jsonb_build_array(v_once || jsonb_build_object('event', 'sync_errors_active'));
  else
    perform private.set_pos_operational_incident_state(
      p_license_id,
      'sync_errors_active',
      null,
      false,
      jsonb_build_object('unresolved_count', 0)
    );
  end if;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_SYNC_OPERATIONAL_NOTIFICATIONS_ERROR', 'generated', 0, 'events', '[]'::jsonb);
end;
$function$;

revoke all on function private.generate_staff_operational_notifications(uuid) from public, anon, authenticated;
revoke all on function private.generate_sync_operational_notifications(uuid) from public, anon, authenticated;

commit;
