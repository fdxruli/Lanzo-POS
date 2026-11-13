-- Stage 3: resolve only the linked active sync alert when its incident closes.
-- The existing generator continues renewing open incidents and deduplicating by incident id.
-- No other notification categories, reads, archives, or conflict records change.

begin;

CREATE OR REPLACE FUNCTION private.generate_sync_operational_notifications(p_license_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_unresolved integer := 0;
  v_incident jsonb;
  v_resolution jsonb;
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
    v_resolution := private.set_pos_operational_incident_state(
      p_license_id,
      'sync_errors_active',
      null,
      false,
      jsonb_build_object('unresolved_count', 0)
    );
    v_notification_id := nullif(v_resolution->>'notification_id', '')::uuid;

    -- A closed incident must not keep displaying its previously renewed warning.
    -- Only expire the notification linked to this license and sync incident.
    if coalesce((v_resolution->>'resolved')::boolean, false)
       and v_notification_id is not null then
      update public.pos_notifications
      set expires_at = now() - interval '1 microsecond'
      where id = v_notification_id
        and license_id = p_license_id
        and type = 'sync'
        and metadata->>'event' = 'sync_errors_active'
        and (expires_at is null or expires_at >= now());
    end if;
  end if;

  return jsonb_build_object('success', true, 'generated', v_generated, 'events', v_events);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'GENERATE_SYNC_OPERATIONAL_NOTIFICATIONS_ERROR', 'generated', 0, 'events', '[]'::jsonb);
end;
$function$;

commit;
