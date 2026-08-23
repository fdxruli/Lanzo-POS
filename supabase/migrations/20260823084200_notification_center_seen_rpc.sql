-- POS Notification Center hotfix: authoritative unseen state and seen mutation.

begin;

create or replace function private.pos_notification_actor_counts_v1(
  p_license_id uuid,
  p_staff_user_id uuid,
  p_admin_user_id uuid,
  p_device_fingerprint text,
  p_device_role text,
  p_staff_permissions jsonb
)
returns jsonb
language sql
stable
security definer
set search_path to ''
as $function$
  with visible_notifications as (
    select r.seen_at, r.read_at, r.archived_at
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
          (p_staff_user_id is not null and pr.staff_user_id = p_staff_user_id)
          or (p_staff_user_id is null and p_admin_user_id is not null and pr.admin_user_id = p_admin_user_id)
          or (
            p_staff_user_id is null
            and p_admin_user_id is null
            and pr.staff_user_id is null
            and pr.admin_user_id is null
            and pr.device_fingerprint = p_device_fingerprint
          )
        )
    ) r on true
    where n.license_id = p_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope,
        n.target_staff_user_id,
        n.target_device_role,
        n.metadata,
        p_device_role,
        p_staff_user_id,
        coalesce(p_staff_permissions, '{}'::jsonb)
      )
      and private.pos_notification_category_allowed_v1(
        n.type,
        n.metadata,
        p_device_role,
        coalesce(p_staff_permissions, '{}'::jsonb)
      )
  )
  select jsonb_build_object(
    'unread_count', count(*) filter (where read_at is null and archived_at is null),
    'unseen_count', count(*) filter (where seen_at is null and archived_at is null)
  )
  from visible_notifications;
$function$;

revoke all on function private.pos_notification_actor_counts_v1(uuid, uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;

create or replace function public.list_pos_notifications(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_limit integer default 30,
  p_offset integer default 0,
  p_include_archived boolean default false,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
    select n.*, r.seen_at, r.read_at, r.archived_at
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
    order by created_at desc, id desc
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
      ) order by created_at desc, id desc)
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

create or replace function public.mark_pos_notifications_seen(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_admin_user_id uuid;
  v_device_role text;
  v_staff_permissions jsonb;
  v_count integer := 0;
  v_counts jsonb;
begin
  v_context := private.get_pos_notification_context(
    p_license_key,
    p_device_fingerprint,
    p_security_token,
    p_staff_session_token,
    'mark_pos_notifications_seen'
  );
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_admin_user_id := nullif(v_context->>'admin_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, seen_at)
    select n.id, n.license_id, v_staff_user_id, now()
    from public.pos_notifications n
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope, n.target_staff_user_id, n.target_device_role, n.metadata,
        v_device_role, v_staff_user_id, v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(n.type, n.metadata, v_device_role, v_staff_permissions)
      and not exists (
        select 1 from public.pos_notification_reads r
        where r.notification_id = n.id and r.license_id = n.license_id
          and r.staff_user_id = v_staff_user_id and r.archived_at is not null
      )
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set seen_at = coalesce(public.pos_notification_reads.seen_at, excluded.seen_at), updated_at = now()
    where public.pos_notification_reads.seen_at is null;
  elsif v_admin_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, admin_user_id, seen_at)
    select n.id, n.license_id, v_admin_user_id, now()
    from public.pos_notifications n
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope, n.target_staff_user_id, n.target_device_role, n.metadata,
        v_device_role, v_staff_user_id, v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(n.type, n.metadata, v_device_role, v_staff_permissions)
      and not exists (
        select 1 from public.pos_notification_reads r
        where r.notification_id = n.id and r.license_id = n.license_id
          and r.admin_user_id = v_admin_user_id and r.archived_at is not null
      )
    on conflict (notification_id, license_id, admin_user_id) where admin_user_id is not null
    do update set seen_at = coalesce(public.pos_notification_reads.seen_at, excluded.seen_at), updated_at = now()
    where public.pos_notification_reads.seen_at is null;
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, seen_at)
    select n.id, n.license_id, p_device_fingerprint, now()
    from public.pos_notifications n
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and private.pos_notification_target_allowed_v1(
        n.target_scope, n.target_staff_user_id, n.target_device_role, n.metadata,
        v_device_role, v_staff_user_id, v_staff_permissions
      )
      and private.pos_notification_category_allowed_v1(n.type, n.metadata, v_device_role, v_staff_permissions)
      and not exists (
        select 1 from public.pos_notification_reads r
        where r.notification_id = n.id and r.license_id = n.license_id
          and r.staff_user_id is null and r.admin_user_id is null
          and r.device_fingerprint = p_device_fingerprint and r.archived_at is not null
      )
    on conflict (notification_id, license_id, device_fingerprint)
      where staff_user_id is null and admin_user_id is null
    do update set seen_at = coalesce(public.pos_notification_reads.seen_at, excluded.seen_at), updated_at = now()
    where public.pos_notification_reads.seen_at is null;
  end if;

  get diagnostics v_count = row_count;
  v_counts := private.pos_notification_actor_counts_v1(
    v_license_id,
    v_staff_user_id,
    v_admin_user_id,
    p_device_fingerprint,
    v_device_role,
    v_staff_permissions
  );

  if v_count > 0 then
    perform private.broadcast_notification_event(
      p_license_id => v_license_id,
      p_event => 'notifications_changed',
      p_reason => 'notifications_seen_changed',
      p_metadata => jsonb_build_object('actor_state', 'seen')
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'updated_count', coalesce(v_count, 0),
    'unread_count', coalesce((v_counts->>'unread_count')::integer, 0),
    'unseen_count', coalesce((v_counts->>'unseen_count')::integer, 0)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', 'MARK_NOTIFICATIONS_SEEN_FAILED',
      'message', 'No se pudieron marcar las notificaciones como vistas.'
    );
end;
$function$;

revoke all on function public.mark_pos_notifications_seen(text, text, text, text) from public;
grant execute on function public.mark_pos_notifications_seen(text, text, text, text) to anon, authenticated, service_role;

commit;
