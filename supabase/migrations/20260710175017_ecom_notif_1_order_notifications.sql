-- ECOM.NOTIF.1 — notificaciones ecommerce PRO y autorización por permiso requerido.

-- Conservar todas las categorías existentes y admitir ecommerce.
alter table public.pos_notifications
  drop constraint if exists pos_notifications_type_check;

alter table public.pos_notifications
  add constraint pos_notifications_type_check
  check (type = any (array[
    'license'::text,
    'support'::text,
    'inventory'::text,
    'cash'::text,
    'system'::text,
    'commercial'::text,
    'ai'::text,
    'sync'::text,
    'ecommerce'::text
  ]));

alter table public.pos_notifications
  drop constraint if exists pos_notifications_source_check;

alter table public.pos_notifications
  add constraint pos_notifications_source_check
  check (source = any (array[
    'system'::text,
    'support'::text,
    'admin'::text,
    'ai'::text,
    'license'::text,
    'sync'::text,
    'ecommerce'::text
  ]));

create or replace function private.pos_notification_required_permission_allowed_v1(
  p_metadata jsonb,
  p_device_role text,
  p_staff_permissions jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_required_permission text;
begin
  v_required_permission := nullif(btrim(coalesce(p_metadata->>'required_permission', '')), '');

  if v_required_permission is null then
    return true;
  end if;

  if coalesce(p_device_role, '') = 'admin' then
    return true;
  end if;

  if coalesce(p_device_role, '') <> 'staff' then
    return false;
  end if;

  return coalesce((coalesce(p_staff_permissions, '{}'::jsonb)->>v_required_permission)::boolean, false);
exception
  when others then
    return false;
end;
$function$;

create or replace function private.pos_notification_target_allowed_v1(
  p_target_scope text,
  p_target_staff_user_id uuid,
  p_target_device_role text,
  p_metadata jsonb,
  p_device_role text,
  p_staff_user_id uuid,
  p_staff_permissions jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  if not private.pos_notification_required_permission_allowed_v1(
    p_metadata,
    p_device_role,
    p_staff_permissions
  ) then
    return false;
  end if;

  return (
    p_target_scope = 'license'
    or (p_target_scope = 'admin' and p_device_role = 'admin')
    or (
      p_target_scope = 'staff'
      and p_staff_user_id is not null
      and (p_target_staff_user_id is null or p_target_staff_user_id = p_staff_user_id)
    )
    or (
      p_target_scope = 'role'
      and (p_target_device_role is null or p_target_device_role = p_device_role)
    )
    or p_target_scope in ('plan', 'rubro')
  );
end;
$function$;

create or replace function private.ecommerce_order_notifications_enabled(
  p_license_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_features jsonb;
  v_realtime_license_sync boolean := false;
  v_notification_center boolean := false;
  v_cloud_notifications boolean := false;
begin
  select coalesce(p.features, '{}'::jsonb) || coalesce(l.features, '{}'::jsonb)
  into v_features
  from public.licenses l
  left join public.plans p on p.id = l.plan_id
  where l.id = p_license_id
    and l.status = 'active'
    and (l.expires_at is null or l.expires_at >= now())
  limit 1;

  if v_features is null then
    return false;
  end if;

  if coalesce((v_features->>'ecommerce_order_inbox')::boolean, false) is not true
     or coalesce((v_features->>'ecommerce_realtime_orders')::boolean, false) is not true then
    return false;
  end if;

  v_realtime_license_sync := coalesce((v_features->>'realtime_license_sync')::boolean, false);
  v_notification_center := case
    when v_features ? 'notification_center' then coalesce((v_features->>'notification_center')::boolean, false)
    else v_realtime_license_sync
  end;
  v_cloud_notifications := case
    when v_features ? 'cloud_notifications' then coalesce((v_features->>'cloud_notifications')::boolean, false)
    else v_realtime_license_sync
  end;

  return v_notification_center and v_cloud_notifications;
exception
  when others then
    return false;
end;
$function$;

create or replace function private.create_pos_notification(
  p_license_id uuid,
  p_title text,
  p_type text default 'system'::text,
  p_severity text default 'info'::text,
  p_body text default null::text,
  p_action_label text default null::text,
  p_action_route text default null::text,
  p_metadata jsonb default '{}'::jsonb,
  p_source text default 'system'::text,
  p_expires_at timestamp with time zone default null::timestamp with time zone
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_id uuid;
  v_metadata jsonb;
  v_metadata_event text;
  v_reason text := 'notification_created';
  v_ticket_id uuid := null;
  v_broadcast_metadata jsonb;
begin
  if p_license_id is null then
    raise exception 'LICENSE_ID_REQUIRED' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'TITLE_REQUIRED' using errcode = 'P0001';
  end if;

  v_metadata := case
    when jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) = 'object' then coalesce(p_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;

  insert into public.pos_notifications (
    license_id,
    type,
    severity,
    title,
    body,
    action_label,
    action_route,
    metadata,
    source,
    expires_at
  ) values (
    p_license_id,
    coalesce(nullif(p_type, ''), 'system'),
    coalesce(nullif(p_severity, ''), 'info'),
    btrim(p_title),
    nullif(p_body, ''),
    nullif(p_action_label, ''),
    nullif(p_action_route, ''),
    v_metadata,
    coalesce(nullif(p_source, ''), 'system'),
    p_expires_at
  )
  returning id into v_id;

  v_metadata_event := v_metadata->>'event';

  v_reason := case
    when coalesce(p_source, '') = 'ecommerce' then 'ecommerce_order_created'
    when coalesce(p_source, '') = 'support' and v_metadata_event = 'support_reply' then 'support_reply'
    when coalesce(p_source, '') = 'support' and v_metadata_event = 'status_change' then 'ticket_status_changed'
    when coalesce(p_source, '') = 'support' then 'support_ticket_changed'
    when coalesce(p_source, '') = 'license'
      or v_metadata->>'generated_by' in ('NOTIF.5', 'NOTIF.8')
      or v_metadata->>'phase' in ('NOTIF.5', 'NOTIF.8') then 'operational_refresh'
    else 'notification_created'
  end;

  if coalesce(v_metadata->>'ticket_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_ticket_id := (v_metadata->>'ticket_id')::uuid;
  end if;

  v_broadcast_metadata := jsonb_strip_nulls(jsonb_build_object(
    'type', coalesce(nullif(p_type, ''), 'system'),
    'severity', coalesce(nullif(p_severity, ''), 'info'),
    'source', coalesce(nullif(p_source, ''), 'system'),
    'category', nullif(v_metadata->>'category', ''),
    'order_id', case
      when coalesce(v_metadata->>'order_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then v_metadata->>'order_id'
      else null
    end
  ));

  perform private.broadcast_notification_event(
    p_license_id => p_license_id,
    p_event => 'notifications_changed',
    p_reason => v_reason,
    p_notification_id => v_id,
    p_ticket_id => v_ticket_id,
    p_metadata => v_broadcast_metadata
  );

  return v_id;
end;
$function$;

create or replace function private.ensure_ecommerce_order_notification(
  p_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_order record;
  v_item_count numeric := 0;
  v_event_key text;
  v_body text;
  v_result jsonb;
begin
  if p_order_id is null then
    return jsonb_build_object('success', false, 'code', 'ECOMMERCE_ORDER_ID_REQUIRED');
  end if;

  select
    o.id,
    o.license_id,
    o.public_order_code,
    o.fulfillment_method,
    o.total,
    o.currency
  into v_order
  from public.ecommerce_orders o
  where o.id = p_order_id
  limit 1;

  if v_order.id is null then
    return jsonb_build_object('success', false, 'code', 'ECOMMERCE_ORDER_NOT_FOUND');
  end if;

  if private.ecommerce_order_notifications_enabled(v_order.license_id) is not true then
    return jsonb_build_object('success', true, 'created', false, 'skipped', true, 'code', 'ECOMMERCE_NOTIFICATIONS_DISABLED');
  end if;

  select coalesce(sum(i.quantity), 0)
  into v_item_count
  from public.ecommerce_order_items i
  where i.order_id = v_order.id
    and i.license_id = v_order.license_id;

  v_event_key := 'ecommerce_order_created:' || v_order.id::text;
  v_body := trim(to_char(v_item_count, 'FM999999990.###'))
    || case when v_item_count = 1 then ' artículo' else ' artículos' end
    || ' · $' || trim(to_char(v_order.total, 'FM999999990.00'))
    || ' ' || coalesce(nullif(v_order.currency, ''), 'MXN')
    || ' · ' || case v_order.fulfillment_method
      when 'delivery' then 'Entrega a domicilio'
      else 'Recoger en el negocio'
    end;

  v_result := private.create_pos_notification_once(
    p_license_id => v_order.license_id,
    p_event_key => v_event_key,
    p_type => 'ecommerce',
    p_severity => 'info',
    p_title => 'Nuevo pedido online ' || coalesce(v_order.public_order_code, ''),
    p_body => v_body,
    p_action_label => 'Ver pedido',
    p_action_route => '/pedidos-online?order=' || v_order.id::text,
    p_metadata => jsonb_build_object(
      'category', 'ecommerce',
      'required_permission', 'ecommerce',
      'order_id', v_order.id,
      'order_code', v_order.public_order_code,
      'event_key', v_event_key,
      'generated_by', 'ECOM.NOTIF.1'
    ),
    p_source => 'ecommerce',
    p_expires_at => null
  );

  if coalesce((v_result->>'success')::boolean, false) then
    update public.ecommerce_orders
    set system_notification_status = 'notified', updated_at = now()
    where id = v_order.id
      and system_notification_status is distinct from 'notified';
  else
    update public.ecommerce_orders
    set system_notification_status = 'failed', updated_at = now()
    where id = v_order.id
      and system_notification_status is distinct from 'notified';
  end if;

  return v_result;
exception
  when others then
    begin
      update public.ecommerce_orders
      set system_notification_status = 'failed', updated_at = now()
      where id = p_order_id
        and system_notification_status is distinct from 'notified';
    exception
      when others then null;
    end;

    return jsonb_build_object(
      'success', false,
      'created', false,
      'code', 'ECOMMERCE_NOTIFICATION_FAILED'
    );
end;
$function$;

create or replace function private.on_ecommerce_order_created_event_v1()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  perform private.ensure_ecommerce_order_notification(new.order_id);
  return new;
exception
  when others then
    return new;
end;
$function$;

drop trigger if exists trg_ecommerce_order_created_notification_v1
  on public.ecommerce_order_events;

create trigger trg_ecommerce_order_created_notification_v1
after insert on public.ecommerce_order_events
for each row
when (new.event_type = 'order_created')
execute function private.on_ecommerce_order_created_event_v1();

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
  v_device_role text;
  v_staff_permissions jsonb;
  v_limit integer;
  v_offset integer;
  v_notifications jsonb;
  v_unread_count integer;
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
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);
  v_limit := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_offset := greatest(coalesce(p_offset, 0), 0);

  with visible_notifications as (
    select
      n.*,
      r.read_at,
      r.archived_at
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and (
        (v_staff_user_id is not null and r.staff_user_id = v_staff_user_id)
        or (v_staff_user_id is null and r.staff_user_id is null and r.device_fingerprint = p_device_fingerprint)
      )
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
  ), page_rows as (
    select *
    from visible_notifications
    where (p_include_archived is true or archived_at is null)
    order by created_at desc, id desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id,
    'type', type,
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
    'read_at', read_at,
    'archived_at', archived_at,
    'is_read', read_at is not null,
    'is_archived', archived_at is not null,
    'is_dismissible', is_dismissible
  ) order by created_at desc, id desc), '[]'::jsonb)
  into v_notifications
  from page_rows;

  with visible_notifications as (
    select n.id, r.read_at, r.archived_at
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and (
        (v_staff_user_id is not null and r.staff_user_id = v_staff_user_id)
        or (v_staff_user_id is null and r.staff_user_id is null and r.device_fingerprint = p_device_fingerprint)
      )
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
  )
  select count(*)::integer
  into v_unread_count
  from visible_notifications
  where read_at is null and archived_at is null;

  return jsonb_build_object(
    'success', true,
    'notifications', v_notifications,
    'unread_count', coalesce(v_unread_count, 0)
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
      'unread_count', 0
    );
end;
$function$;

create or replace function public.mark_pos_notification_read(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_notification_id uuid,
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
  v_device_role text;
  v_staff_permissions jsonb;
  v_notification_id uuid;
begin
  v_context := private.get_pos_notification_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'mark_pos_notification_read');
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  select n.id into v_notification_id
  from public.pos_notifications n
  where n.id = p_notification_id
    and n.license_id = v_license_id
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
  limit 1;

  if v_notification_id is null then
    return jsonb_build_object('success', false, 'code', 'NOTIFICATION_NOT_FOUND', 'message', 'La notificacion no existe o no pertenece a esta licencia.');
  end if;

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at)
    values (v_notification_id, v_license_id, v_staff_user_id, now())
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at)
    values (v_notification_id, v_license_id, p_device_fingerprint, now())
    on conflict (notification_id, license_id, device_fingerprint) where staff_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  end if;

  return jsonb_build_object('success', true, 'notification_id', v_notification_id);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'MARK_NOTIFICATION_READ_FAILED', 'message', 'No se pudo marcar la notificacion como leida.');
end;
$function$;

create or replace function public.mark_all_pos_notifications_read(
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
  v_device_role text;
  v_staff_permissions jsonb;
  v_count integer := 0;
begin
  v_context := private.get_pos_notification_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'mark_all_pos_notifications_read');
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at)
    select n.id, n.license_id, v_staff_user_id, now()
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and r.staff_user_id = v_staff_user_id
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and r.archived_at is null
      and private.pos_notification_target_allowed_v1(
        n.target_scope,
        n.target_staff_user_id,
        n.target_device_role,
        n.metadata,
        v_device_role,
        v_staff_user_id,
        v_staff_permissions
      )
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at)
    select n.id, n.license_id, p_device_fingerprint, now()
    from public.pos_notifications n
    left join public.pos_notification_reads r on r.notification_id = n.id
      and r.license_id = n.license_id
      and r.staff_user_id is null
      and r.device_fingerprint = p_device_fingerprint
    where n.license_id = v_license_id
      and n.starts_at <= now()
      and (n.expires_at is null or n.expires_at >= now())
      and r.archived_at is null
      and private.pos_notification_target_allowed_v1(
        n.target_scope,
        n.target_staff_user_id,
        n.target_device_role,
        n.metadata,
        v_device_role,
        v_staff_user_id,
        v_staff_permissions
      )
    on conflict (notification_id, license_id, device_fingerprint) where staff_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, excluded.read_at), updated_at = now();
  end if;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'updated_count', coalesce(v_count, 0));
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'MARK_ALL_NOTIFICATIONS_READ_FAILED', 'message', 'No se pudieron marcar las notificaciones como leidas.');
end;
$function$;

create or replace function public.archive_pos_notification(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_notification_id uuid,
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
  v_device_role text;
  v_staff_permissions jsonb;
  v_notification record;
begin
  v_context := private.get_pos_notification_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'archive_pos_notification');
  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_device_role := coalesce(nullif(v_context->>'device_role', ''), 'staff');
  v_staff_permissions := coalesce(v_context->'staff_permissions', '{}'::jsonb);

  select n.id, n.is_dismissible into v_notification
  from public.pos_notifications n
  where n.id = p_notification_id
    and n.license_id = v_license_id
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
  limit 1;

  if v_notification.id is null then
    return jsonb_build_object('success', false, 'code', 'NOTIFICATION_NOT_FOUND', 'message', 'La notificacion no existe o no pertenece a esta licencia.');
  end if;

  if v_notification.is_dismissible is not true then
    return jsonb_build_object('success', false, 'code', 'NOTIFICATION_NOT_DISMISSIBLE', 'message', 'Esta notificacion no se puede archivar.');
  end if;

  if v_staff_user_id is not null then
    insert into public.pos_notification_reads (notification_id, license_id, staff_user_id, read_at, archived_at)
    values (v_notification.id, v_license_id, v_staff_user_id, now(), now())
    on conflict (notification_id, license_id, staff_user_id) where staff_user_id is not null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, now()), archived_at = coalesce(public.pos_notification_reads.archived_at, now()), updated_at = now();
  else
    insert into public.pos_notification_reads (notification_id, license_id, device_fingerprint, read_at, archived_at)
    values (v_notification.id, v_license_id, p_device_fingerprint, now(), now())
    on conflict (notification_id, license_id, device_fingerprint) where staff_user_id is null
    do update set read_at = coalesce(public.pos_notification_reads.read_at, now()), archived_at = coalesce(public.pos_notification_reads.archived_at, now()), updated_at = now();
  end if;

  return jsonb_build_object('success', true, 'notification_id', v_notification.id);
exception
  when others then
    return jsonb_build_object('success', false, 'code', 'ARCHIVE_NOTIFICATION_FAILED', 'message', 'No se pudo archivar la notificacion.');
end;
$function$;

revoke all on function private.pos_notification_required_permission_allowed_v1(jsonb, text, jsonb) from public, anon, authenticated;
revoke all on function private.pos_notification_target_allowed_v1(text, uuid, text, jsonb, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function private.ecommerce_order_notifications_enabled(uuid) from public, anon, authenticated;
revoke all on function private.ensure_ecommerce_order_notification(uuid) from public, anon, authenticated;
revoke all on function private.on_ecommerce_order_created_event_v1() from public, anon, authenticated;

revoke all on function public.list_pos_notifications(text, text, text, integer, integer, boolean, text) from public, anon;
revoke all on function public.mark_pos_notification_read(text, text, text, uuid, text) from public, anon;
revoke all on function public.mark_all_pos_notifications_read(text, text, text, text) from public, anon;
revoke all on function public.archive_pos_notification(text, text, text, uuid, text) from public, anon;

grant execute on function public.list_pos_notifications(text, text, text, integer, integer, boolean, text) to authenticated;
grant execute on function public.mark_pos_notification_read(text, text, text, uuid, text) to authenticated;
grant execute on function public.mark_all_pos_notifications_read(text, text, text, text) to authenticated;
grant execute on function public.archive_pos_notification(text, text, text, uuid, text) to authenticated;;
