-- Stage 3: preserve the visibility and lifecycle of active sync incident alerts.
-- Reuse the existing generator and list RPC, with no new objects or privileges.
-- Other categories, read/seen/archive semantics, conflicts and counters are unchanged.

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

-- Put a linked, still-open sync incident alert on the first page of authorized results.
-- Expiration, targeting, actor state, page size and global counts remain unchanged.
CREATE OR REPLACE FUNCTION public.list_pos_notifications(p_license_key text, p_device_fingerprint text, p_security_token text, p_limit integer DEFAULT 30, p_offset integer DEFAULT 0, p_include_archived boolean DEFAULT false, p_staff_session_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_device_role text;
  v_staff_permissions jsonb;
  v_limit integer;
  v_offset integer;
  v_notifications jsonb;
  v_unread_count integer;
  v_unseen_count integer;
begin
  v_context := private.get_pos_notification_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'list_pos_notifications'
  );

  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_notifications as (
    select n.*, r.seen_at, r.read_at, r.archived_at,
      case
        when n.type = 'sync'
         and n.metadata->>'event' = 'sync_errors_active'
         and exists (
           select 1
           from private.pos_notification_operational_incidents i
           where i.license_id = n.license_id
             and i.notification_id = n.id
             and i.incident_type = 'sync_errors_active'
             and i.resolved_at is null
         )
        then 0 else 1
      end as active_sync_rank
    from public.pos_notifications n
    left join lateral (
      select
        min(pr.seen_at) filter (where pr.seen_at is not null) as seen_at,
        min(pr.read_at) filter (where pr.read_at is not null) as read_at,
        min(pr.archived_at) filter (where pr.archived_at is not null) as archived_at
      from public.pos_notification_reads pr
      where pr.notification_id = n.id
        and pr.license_id = n.license_id
        and (
          (v_staff_user_id is not null and pr.staff_user_id = v_staff_user_id)
          or (v_staff_user_id is null and v_admin_user_id is not null and pr.admin_user_id = v_admin_user_id)
          or (
            v_staff_user_id is null
            and v_admin_user_id is null
            and pr.staff_user_id is null
            and pr.admin_user_id is null
            and pr.device_fingerprint = p_device_fingerprint
          )
        )
    ) r on true
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope,
        n.target_staff_user_id,
        n.target_device_role,
        n.metadata,
        v_device_role,
        v_staff_user_id,
        v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(
        n.type,
        n.metadata,
        v_device_role,
        v_staff_permissions
      )
  ), page_rows as (
    select *
    from visible_notifications
    where p_include_archived is true or archived_at is null
    order by active_sync_rank asc, created_at desc, id desc
    limit v_limit offset v_offset
  )
  select
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id,
        'type', type,
        'category', private.pos_notification_category_v1(type, metadata),
        'severity', severity,
        'title', title,
        'body', body,
        'action_label', action_label,
        'action_route', action_route,
        'metadata', metadata,
        'source', source,
        'created_at', created_at,
        'starts_at', starts_at,
        'expires_at', expires_at,
        'seen_at', seen_at,
        'read_at', read_at,
        'archived_at', archived_at,
        'is_seen', seen_at is not null,
        'is_read', read_at is not null,
        'is_archived', archived_at is not null,
        'is_dismissible', is_dismissible
      ) order by active_sync_rank asc, created_at desc, id desc)
      from page_rows
    ), '[]'::jsonb),
    (select count(*)::integer from visible_notifications where read_at is null and archived_at is null),
    (select count(*)::integer from visible_notifications where seen_at is null and archived_at is null)
  into v_notifications, v_unread_count, v_unseen_count;

  return jsonb_build_object(
    'success', true,
    'notifications', v_notifications,
    'unread_count', coalesce(v_unread_count, 0),
    'unseen_count', coalesce(v_unseen_count, 0)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', case sqlerrm
        when 'NOTIFICATION_CENTER_DISABLED' then 'NOTIFICATION_CENTER_DISABLED'
        when 'STAFF_NOTIFICATIONS_DISABLED' then 'STAFF_NOTIFICATIONS_DISABLED'
        when 'POS_NOTIFICATIONS_RATE_LIMITED' then 'POS_NOTIFICATIONS_RATE_LIMITED'
        else 'LIST_POS_NOTIFICATIONS_FAILED'
      end,
      'message', case sqlerrm
        when 'NOTIFICATION_CENTER_DISABLED' then 'El centro de notificaciones no esta disponible para este plan.'
        when 'STAFF_NOTIFICATIONS_DISABLED' then 'Tu usuario staff no tiene acceso al Centro de Notificaciones.'
        when 'POS_NOTIFICATIONS_RATE_LIMITED' then 'Demasiadas solicitudes de notificaciones. Intenta de nuevo en unos minutos.'
        else 'No se pudieron cargar las notificaciones.'
      end,
      'notifications', '[]'::jsonb,
      'unread_count', 0,
      'unseen_count', 0
    );
end;
$function$;

commit;
