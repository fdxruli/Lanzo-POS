-- FASE NOTIF.DB.DRIFT.1
-- NOTIF.4 — Bandeja privada de soporte.
-- Objetos privados sin grants cliente.

create schema if not exists private;

create or replace view private.support_ticket_inbox as
select
  t.id as ticket_id,
  t.license_id,
  case
    when l.license_key is null then null::text
    when char_length(l.license_key::text) <= 8 then (left(l.license_key::text, 2) || '...'::text) || right(l.license_key::text, 2)
    else (left(l.license_key::text, 4) || '...'::text) || right(l.license_key::text, 4)
  end as license_key_masked,
  coalesce(p.code, l.license_type::text) as plan_code,
  p.name as plan_name,
  coalesce(bp.business_name, l.organization_name::varchar, l.product_name) as business_name,
  t.subject,
  t.category,
  t.priority,
  t.status,
  t.last_message_preview,
  t.last_message_at,
  t.created_at,
  t.updated_at,
  coalesce(mc.message_count, 0) as message_count
from public.support_tickets t
join public.licenses l on l.id = t.license_id
left join public.plans p on p.id = l.plan_id
left join public.business_profiles bp on bp.license_id = l.id
left join lateral (
  select count(*)::integer as message_count
  from public.support_ticket_messages m
  where m.ticket_id = t.id
    and m.license_id = t.license_id
) mc on true;

revoke all on table private.support_ticket_inbox from public, anon, authenticated;

create or replace function private.list_support_inbox(
  p_status text default null::text,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_tickets jsonb;
begin
  if v_status is not null and v_status not in ('open','waiting_support','waiting_user','resolved','closed') then
    return jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'message', 'Estado de ticket invalido.', 'tickets', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ticket_id', inbox.ticket_id,
    'license_id', inbox.license_id,
    'license_key_masked', inbox.license_key_masked,
    'plan_code', inbox.plan_code,
    'plan_name', inbox.plan_name,
    'business_name', inbox.business_name,
    'subject', inbox.subject,
    'category', inbox.category,
    'priority', inbox.priority,
    'status', inbox.status,
    'last_message_preview', inbox.last_message_preview,
    'last_message_at', inbox.last_message_at,
    'created_at', inbox.created_at,
    'updated_at', inbox.updated_at,
    'message_count', inbox.message_count
  ) order by inbox.priority_rank asc, inbox.updated_at desc), '[]'::jsonb)
  into v_tickets
  from (
    select
      i.*,
      case i.priority
        when 'urgent' then 1
        when 'high' then 2
        when 'normal' then 3
        when 'low' then 4
        else 5
      end as priority_rank
    from private.support_ticket_inbox i
    where v_status is null or i.status = v_status
    order by priority_rank asc, i.updated_at desc
    limit v_limit offset v_offset
  ) inbox;

  return jsonb_build_object('success', true, 'tickets', v_tickets);
end;
$function$;

create or replace function private.get_support_inbox_thread(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket jsonb;
  v_messages jsonb;
begin
  select jsonb_build_object(
    'ticket_id', i.ticket_id,
    'license_id', i.license_id,
    'license_key_masked', i.license_key_masked,
    'plan_code', i.plan_code,
    'plan_name', i.plan_name,
    'business_name', i.business_name,
    'subject', i.subject,
    'category', i.category,
    'priority', i.priority,
    'status', i.status,
    'last_message_preview', i.last_message_preview,
    'last_message_at', i.last_message_at,
    'created_at', i.created_at,
    'updated_at', i.updated_at,
    'message_count', i.message_count
  )
  into v_ticket
  from private.support_ticket_inbox i
  where i.ticket_id = p_ticket_id
  limit 1;

  if v_ticket is null then
    return jsonb_build_object('success', false, 'code', 'TICKET_NOT_FOUND', 'message', 'Ticket no encontrado.', 'ticket', null, 'messages', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'sender_type', m.sender_type,
    'message', m.message,
    'attachments_metadata', m.attachments_metadata,
    'metadata', m.metadata,
    'created_at', m.created_at
  ) order by m.created_at asc), '[]'::jsonb)
  into v_messages
  from public.support_ticket_messages m
  where m.ticket_id = p_ticket_id;

  return jsonb_build_object('success', true, 'ticket', v_ticket, 'messages', v_messages);
end;
$function$;

create or replace function private.add_support_ticket_reply(
  p_ticket_id uuid,
  p_message text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.support_tickets%rowtype;
  v_message text := btrim(coalesce(p_message, ''));
  v_preview text;
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
begin
  if jsonb_typeof(v_metadata) <> 'object' then
    return jsonb_build_object('success', false, 'code', 'INVALID_METADATA', 'message', 'Metadata invalida.');
  end if;

  if char_length(v_message) < 1 or char_length(v_message) > 3000 then
    return jsonb_build_object('success', false, 'code', 'INVALID_MESSAGE_LENGTH', 'message', 'El mensaje debe tener entre 1 y 3000 caracteres.');
  end if;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'TICKET_NOT_FOUND', 'message', 'Ticket no encontrado.');
  end if;

  if v_ticket.status = 'closed' then
    return jsonb_build_object('success', false, 'code', 'TICKET_CLOSED', 'message', 'No se puede responder un ticket cerrado.');
  end if;

  v_preview := private.support_message_preview(v_message);

  insert into public.support_ticket_messages (
    ticket_id,
    license_id,
    sender_type,
    message,
    metadata
  ) values (
    v_ticket.id,
    v_ticket.license_id,
    'support',
    v_message,
    v_metadata || jsonb_build_object('phase', 'NOTIF.4', 'event', 'support_reply')
  );

  update public.support_tickets
  set status = 'waiting_user',
      last_message_preview = v_preview,
      last_message_at = now(),
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  perform private.create_pos_notification(
    p_license_id => v_ticket.license_id,
    p_title => 'Soporte respondió tu solicitud',
    p_type => 'support',
    p_severity => 'info',
    p_body => v_preview,
    p_action_label => 'Ver respuesta',
    p_action_route => 'notifications:support',
    p_metadata => jsonb_build_object('ticket_id', v_ticket.id, 'phase', 'NOTIF.4', 'event', 'support_reply'),
    p_source => 'support',
    p_expires_at => null
  );

  return jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket.id,
    'status', v_ticket.status,
    'last_message_preview', v_ticket.last_message_preview,
    'last_message_at', v_ticket.last_message_at
  );
end;
$function$;

create or replace function private.update_support_ticket_status(
  p_ticket_id uuid,
  p_status text,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ticket public.support_tickets%rowtype;
  v_status text := btrim(coalesce(p_status, ''));
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_preview text;
  v_notification_title text;
  v_notification_body text;
begin
  if v_status not in ('open','waiting_support','waiting_user','resolved','closed') then
    return jsonb_build_object('success', false, 'code', 'INVALID_STATUS', 'message', 'Estado de ticket invalido.');
  end if;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'TICKET_NOT_FOUND', 'message', 'Ticket no encontrado.');
  end if;

  if v_note is not null and char_length(v_note) > 3000 then
    return jsonb_build_object('success', false, 'code', 'NOTE_TOO_LONG', 'message', 'La nota no puede superar 3000 caracteres.');
  end if;

  v_preview := case
    when v_note is not null then private.support_message_preview(v_note)
    else v_ticket.last_message_preview
  end;

  if v_note is not null then
    insert into public.support_ticket_messages (
      ticket_id,
      license_id,
      sender_type,
      message,
      metadata
    ) values (
      v_ticket.id,
      v_ticket.license_id,
      'system',
      v_note,
      jsonb_build_object('phase', 'NOTIF.4', 'event', 'status_change', 'status', v_status)
    );
  end if;

  update public.support_tickets
  set status = v_status,
      closed_at = case
        when v_status = 'closed' then coalesce(closed_at, now())
        else closed_at
      end,
      last_message_preview = v_preview,
      last_message_at = case when v_note is not null then now() else last_message_at end,
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  if v_status in ('waiting_user','resolved','closed') then
    v_notification_title := case v_status
      when 'waiting_user' then 'Soporte espera tu respuesta'
      when 'resolved' then 'Solicitud de soporte resuelta'
      when 'closed' then 'Solicitud de soporte cerrada'
      else 'Soporte actualizo tu solicitud'
    end;

    v_notification_body := coalesce(
      v_preview,
      case v_status
        when 'waiting_user' then 'Revisa tu solicitud de soporte y responde si es necesario.'
        when 'resolved' then 'Tu solicitud fue marcada como resuelta.'
        when 'closed' then 'Tu solicitud de soporte fue cerrada.'
        else 'Tu solicitud de soporte fue actualizada.'
      end
    );

    perform private.create_pos_notification(
      p_license_id => v_ticket.license_id,
      p_title => v_notification_title,
      p_type => 'support',
      p_severity => 'info',
      p_body => v_notification_body,
      p_action_label => 'Ver soporte',
      p_action_route => 'notifications:support',
      p_metadata => jsonb_build_object('ticket_id', v_ticket.id, 'phase', 'NOTIF.4', 'event', 'status_change', 'status', v_status),
      p_source => 'support',
      p_expires_at => null
    );
  else
    perform private.broadcast_notification_event(
      p_license_id => v_ticket.license_id,
      p_event => 'notifications_changed',
      p_reason => 'ticket_status_changed',
      p_ticket_id => v_ticket.id,
      p_metadata => jsonb_build_object('status', v_status, 'source', 'support')
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'ticket_id', v_ticket.id,
    'status', v_ticket.status,
    'closed_at', v_ticket.closed_at,
    'last_message_preview', v_ticket.last_message_preview,
    'last_message_at', v_ticket.last_message_at
  );
end;
$function$;

revoke all on function private.list_support_inbox(text, integer, integer) from public;
revoke all on function private.list_support_inbox(text, integer, integer) from anon;
revoke all on function private.list_support_inbox(text, integer, integer) from authenticated;
revoke all on function private.get_support_inbox_thread(uuid) from public;
revoke all on function private.get_support_inbox_thread(uuid) from anon;
revoke all on function private.get_support_inbox_thread(uuid) from authenticated;
revoke all on function private.add_support_ticket_reply(uuid, text, jsonb) from public;
revoke all on function private.add_support_ticket_reply(uuid, text, jsonb) from anon;
revoke all on function private.add_support_ticket_reply(uuid, text, jsonb) from authenticated;
revoke all on function private.update_support_ticket_status(uuid, text, text) from public;
revoke all on function private.update_support_ticket_status(uuid, text, text) from anon;
revoke all on function private.update_support_ticket_status(uuid, text, text) from authenticated;
