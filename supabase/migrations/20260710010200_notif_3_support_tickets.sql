-- FASE NOTIF.DB.DRIFT.1
-- NOTIF.3 — Soporte interno con tickets.
-- Replica contrato de producción: tablas cerradas, RLS activo, acceso por RPCs públicas aprobadas.

create schema if not exists private;

create table if not exists public.support_tickets (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  created_by_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  created_by_device_fingerprint text null,
  subject text not null,
  category text not null default 'help'::text,
  priority text not null default 'normal'::text,
  status text not null default 'open'::text,
  last_message_preview text null,
  last_message_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz null,
  constraint support_tickets_subject_len_chk check ((char_length(btrim(subject)) >= 3) and (char_length(btrim(subject)) <= 180)),
  constraint support_tickets_category_chk check (category = any (array['bug','billing','feature','help','license','sync','cash','inventory','other']::text[])),
  constraint support_tickets_priority_chk check (priority = any (array['low','normal','high','urgent']::text[])),
  constraint support_tickets_status_chk check (status = any (array['open','waiting_support','waiting_user','resolved','closed']::text[])),
  constraint support_tickets_metadata_object_chk check (jsonb_typeof(metadata) = 'object'::text)
);

create table if not exists public.support_ticket_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  license_id uuid not null references public.licenses(id) on delete cascade,
  sender_type text not null default 'user'::text,
  sender_staff_user_id uuid null references public.license_staff_users(id) on delete set null,
  sender_device_fingerprint text null,
  message text not null,
  attachments_metadata jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint support_ticket_messages_sender_type_chk check (sender_type = any (array['user','support','system']::text[])),
  constraint support_ticket_messages_message_len_chk check ((char_length(btrim(message)) >= 1) and (char_length(btrim(message)) <= 3000)),
  constraint support_ticket_messages_attachments_array_chk check (jsonb_typeof(attachments_metadata) = 'array'::text),
  constraint support_ticket_messages_metadata_object_chk check (jsonb_typeof(metadata) = 'object'::text)
);

alter table public.support_tickets
  add column if not exists created_by_staff_user_id uuid null,
  add column if not exists created_by_device_fingerprint text null,
  add column if not exists subject text,
  add column if not exists category text not null default 'help'::text,
  add column if not exists priority text not null default 'normal'::text,
  add column if not exists status text not null default 'open'::text,
  add column if not exists last_message_preview text null,
  add column if not exists last_message_at timestamptz null,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists closed_at timestamptz null;

alter table public.support_ticket_messages
  add column if not exists ticket_id uuid,
  add column if not exists license_id uuid,
  add column if not exists sender_type text not null default 'user'::text,
  add column if not exists sender_staff_user_id uuid null,
  add column if not exists sender_device_fingerprint text null,
  add column if not exists message text,
  add column if not exists attachments_metadata jsonb not null default '[]'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now();

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_license_id_fkey') then
    alter table public.support_tickets add constraint support_tickets_license_id_fkey foreign key (license_id) references public.licenses(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_created_by_staff_user_id_fkey') then
    alter table public.support_tickets add constraint support_tickets_created_by_staff_user_id_fkey foreign key (created_by_staff_user_id) references public.license_staff_users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_subject_len_chk') then
    alter table public.support_tickets add constraint support_tickets_subject_len_chk check ((char_length(btrim(subject)) >= 3) and (char_length(btrim(subject)) <= 180));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_category_chk') then
    alter table public.support_tickets add constraint support_tickets_category_chk check (category = any (array['bug','billing','feature','help','license','sync','cash','inventory','other']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_priority_chk') then
    alter table public.support_tickets add constraint support_tickets_priority_chk check (priority = any (array['low','normal','high','urgent']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_status_chk') then
    alter table public.support_tickets add constraint support_tickets_status_chk check (status = any (array['open','waiting_support','waiting_user','resolved','closed']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_tickets'::regclass and conname = 'support_tickets_metadata_object_chk') then
    alter table public.support_tickets add constraint support_tickets_metadata_object_chk check (jsonb_typeof(metadata) = 'object'::text);
  end if;

  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_ticket_id_fkey') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_ticket_id_fkey foreign key (ticket_id) references public.support_tickets(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_license_id_fkey') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_license_id_fkey foreign key (license_id) references public.licenses(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_sender_staff_user_id_fkey') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_sender_staff_user_id_fkey foreign key (sender_staff_user_id) references public.license_staff_users(id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_sender_type_chk') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_sender_type_chk check (sender_type = any (array['user','support','system']::text[]));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_message_len_chk') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_message_len_chk check ((char_length(btrim(message)) >= 1) and (char_length(btrim(message)) <= 3000));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_attachments_array_chk') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_attachments_array_chk check (jsonb_typeof(attachments_metadata) = 'array'::text);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.support_ticket_messages'::regclass and conname = 'support_ticket_messages_metadata_object_chk') then
    alter table public.support_ticket_messages add constraint support_ticket_messages_metadata_object_chk check (jsonb_typeof(metadata) = 'object'::text);
  end if;
end $$;

create index if not exists idx_support_tickets_license_category on public.support_tickets using btree (license_id, category);
create index if not exists idx_support_tickets_license_status on public.support_tickets using btree (license_id, status);
create index if not exists idx_support_tickets_license_updated_at on public.support_tickets using btree (license_id, updated_at desc);
create index if not exists idx_support_ticket_messages_license_created_at on public.support_ticket_messages using btree (license_id, created_at desc);
create index if not exists idx_support_ticket_messages_ticket_created_at on public.support_ticket_messages using btree (ticket_id, created_at);

alter table public.support_tickets enable row level security;
alter table public.support_ticket_messages enable row level security;

revoke all on table public.support_tickets from public, anon, authenticated;
revoke all on table public.support_ticket_messages from public, anon, authenticated;

create or replace function private.support_message_preview(p_message text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select left(regexp_replace(btrim(coalesce(p_message, '')), '\s+', ' ', 'g'), 180);
$function$;

create or replace function private.touch_support_ticket_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function private.support_message_preview(text) from public;
revoke all on function private.support_message_preview(text) from anon;
revoke all on function private.support_message_preview(text) from authenticated;
revoke all on function private.touch_support_ticket_updated_at() from public;
revoke all on function private.touch_support_ticket_updated_at() from anon;
revoke all on function private.touch_support_ticket_updated_at() from authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_support_tickets_touch_updated_at' and tgrelid = 'public.support_tickets'::regclass) then
    create trigger trg_support_tickets_touch_updated_at
    before update on public.support_tickets
    for each row execute function private.touch_support_ticket_updated_at();
  end if;
end $$;

create or replace function private.get_support_ticket_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text,
  p_rpc_name text default 'support_tickets'::text
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
  v_staff_user_id uuid := null;
  v_staff_permissions jsonb := '{}'::jsonb;
  v_staff_payload jsonb := null;
  v_grace_days integer := 7;
begin
  perform public.enforce_pos_rpc_rate_limit_v2(
    p_license_key,
    p_device_fingerprint,
    p_staff_session_token,
    p_rpc_name,
    'support',
    90,
    60,
    120,
    'SUPPORT_RPC_RATE_LIMITED',
    jsonb_build_object('phase', 'STAFF.NOTIF.1')
  );

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

  if v_license.status <> 'active' then
    return jsonb_build_object('success', false, 'code', 'LICENSE_NOT_ACTIVE', 'message', 'La licencia no esta activa.');
  end if;

  if v_license.expires_at is not null and v_license.expires_at < now() - (v_grace_days || ' days')::interval then
    return jsonb_build_object('success', false, 'code', 'LICENSE_EXPIRED', 'message', 'La licencia expiro.');
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

  if (v_features->>'support_center') is distinct from 'true'
     or (v_features->>'support_tickets') is distinct from 'true'
     or coalesce(v_features->>'support_channel', 'email') <> 'in_app' then
    return jsonb_build_object('success', false, 'code', 'SUPPORT_CENTER_DISABLED', 'message', 'Este plan no incluye soporte interno.');
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
      s.username,
      s.display_name,
      s.role_name,
      s.permissions,
      s.is_active as staff_is_active
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

    perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);

    v_staff_user_id := v_session.staff_user_id;
    v_staff_permissions := coalesce(v_session.permissions, '{}'::jsonb);

    if coalesce((v_staff_permissions->>'support_center')::boolean, false) is not true then
      return jsonb_build_object('success', false, 'code', 'STAFF_SUPPORT_DISABLED', 'message', 'Tu usuario staff no tiene acceso a soporte Lanzo.');
    end if;

    v_staff_payload := jsonb_build_object(
      'id', v_session.staff_user_id,
      'username', v_session.username,
      'display_name', v_session.display_name,
      'role_name', v_session.role_name,
      'permissions', v_staff_permissions
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'license_id', v_license.id,
    'license_key', v_license.license_key,
    'device_id', v_device.id,
    'device_fingerprint', v_device.device_fingerprint,
    'device_role', v_device.device_role,
    'staff_user_id', v_staff_user_id,
    'staff_permissions', v_staff_permissions,
    'staff_user', v_staff_payload,
    'plan_code', v_license.plan_code,
    'plan_name', v_license.plan_name,
    'features', coalesce(v_features, '{}'::jsonb)
  );
exception
  when others then
    return jsonb_build_object(
      'success', false,
      'code', coalesce(nullif(sqlerrm, ''), 'SUPPORT_CONTEXT_ERROR'),
      'message', 'No se pudo validar el contexto seguro de soporte.'
    );
end;
$function$;

revoke all on function private.get_support_ticket_context(text, text, text, text, text) from public;
revoke all on function private.get_support_ticket_context(text, text, text, text, text) from anon;
revoke all on function private.get_support_ticket_context(text, text, text, text, text) from authenticated;

create or replace function public.create_support_ticket(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_subject text,
  p_category text default 'help'::text,
  p_priority text default 'normal'::text,
  p_message text default null::text,
  p_metadata jsonb default '{}'::jsonb,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_subject text := left(btrim(coalesce(p_subject, '')), 180);
  v_message text := btrim(coalesce(p_message, ''));
  v_category text := coalesce(nullif(p_category, ''), 'help');
  v_priority text := coalesce(nullif(p_priority, ''), 'normal');
  v_metadata jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_preview text;
  v_ticket public.support_tickets%rowtype;
begin
  v_context := private.get_support_ticket_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'create_support_ticket');
  if coalesce((v_context->>'success')::boolean, false) is not true then
    return v_context;
  end if;

  if jsonb_typeof(v_metadata) <> 'object' then
    return jsonb_build_object('success', false, 'code', 'INVALID_METADATA', 'message', 'Metadata invalida.');
  end if;

  if char_length(v_subject) < 3 then
    return jsonb_build_object('success', false, 'code', 'SUBJECT_REQUIRED', 'message', 'Escribe un asunto de al menos 3 caracteres.');
  end if;

  if char_length(v_message) < 10 then
    return jsonb_build_object('success', false, 'code', 'MESSAGE_TOO_SHORT', 'message', 'Describe el problema con al menos 10 caracteres.');
  end if;

  if char_length(v_message) > 3000 then
    return jsonb_build_object('success', false, 'code', 'MESSAGE_TOO_LONG', 'message', 'El mensaje no puede superar 3000 caracteres.');
  end if;

  if v_category not in ('bug','billing','feature','help','license','sync','cash','inventory','other') then
    v_category := 'help';
  end if;

  if v_priority not in ('low','normal','high','urgent') then
    v_priority := 'normal';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_preview := private.support_message_preview(v_message);

  insert into public.support_tickets (
    license_id,
    created_by_staff_user_id,
    created_by_device_fingerprint,
    subject,
    category,
    priority,
    status,
    last_message_preview,
    last_message_at,
    metadata
  ) values (
    v_license_id,
    v_staff_user_id,
    p_device_fingerprint,
    v_subject,
    v_category,
    v_priority,
    'waiting_support',
    v_preview,
    now(),
    v_metadata || jsonb_build_object('phase', 'NOTIF.3')
  ) returning * into v_ticket;

  insert into public.support_ticket_messages (
    ticket_id,
    license_id,
    sender_type,
    sender_staff_user_id,
    sender_device_fingerprint,
    message,
    metadata
  ) values (
    v_ticket.id,
    v_license_id,
    'user',
    v_staff_user_id,
    p_device_fingerprint,
    v_message,
    jsonb_build_object('phase', 'NOTIF.3', 'initial_message', true)
  );

  perform private.create_pos_notification(
    p_license_id => v_license_id,
    p_title => 'Solicitud de soporte creada',
    p_type => 'support',
    p_severity => 'info',
    p_body => 'Tu solicitud fue recibida. Te responderemos desde el Centro de Notificaciones.',
    p_action_label => 'Ver soporte',
    p_action_route => 'notifications:support',
    p_metadata => jsonb_build_object('ticket_id', v_ticket.id, 'phase', 'NOTIF.3', 'event', 'ticket_created'),
    p_source => 'support',
    p_expires_at => null
  );

  return jsonb_build_object(
    'success', true,
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'subject', v_ticket.subject,
      'category', v_ticket.category,
      'priority', v_ticket.priority,
      'status', v_ticket.status,
      'last_message_preview', v_ticket.last_message_preview,
      'last_message_at', v_ticket.last_message_at,
      'created_at', v_ticket.created_at,
      'updated_at', v_ticket.updated_at
    )
  );
end;
$function$;

create or replace function public.list_support_tickets(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_limit integer default 20,
  p_offset integer default 0,
  p_include_closed boolean default false,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_tickets jsonb;
begin
  v_context := private.get_support_ticket_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'list_support_tickets');
  if coalesce((v_context->>'success')::boolean, false) is not true then
    return v_context || jsonb_build_object('tickets', '[]'::jsonb);
  end if;

  v_license_id := (v_context->>'license_id')::uuid;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', t.id,
    'subject', t.subject,
    'category', t.category,
    'priority', t.priority,
    'status', t.status,
    'last_message_preview', t.last_message_preview,
    'last_message_at', t.last_message_at,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'closed_at', t.closed_at
  ) order by t.updated_at desc), '[]'::jsonb)
  into v_tickets
  from (
    select *
    from public.support_tickets
    where license_id = v_license_id
      and (p_include_closed is true or status <> 'closed')
    order by updated_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object('success', true, 'tickets', v_tickets);
end;
$function$;

create or replace function public.get_support_ticket_thread(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_ticket_id uuid,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_ticket public.support_tickets%rowtype;
  v_messages jsonb;
begin
  v_context := private.get_support_ticket_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'get_support_ticket_thread');
  if coalesce((v_context->>'success')::boolean, false) is not true then
    return v_context || jsonb_build_object('ticket', null, 'messages', '[]'::jsonb);
  end if;

  v_license_id := (v_context->>'license_id')::uuid;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
    and license_id = v_license_id
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'TICKET_NOT_FOUND', 'message', 'Ticket no encontrado.', 'messages', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id,
    'sender_type', m.sender_type,
    'sender_staff_user_id', m.sender_staff_user_id,
    'sender_device_fingerprint', m.sender_device_fingerprint,
    'message', m.message,
    'attachments_metadata', m.attachments_metadata,
    'metadata', m.metadata,
    'created_at', m.created_at
  ) order by m.created_at asc), '[]'::jsonb)
  into v_messages
  from public.support_ticket_messages m
  where m.ticket_id = v_ticket.id
    and m.license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'ticket', jsonb_build_object(
      'id', v_ticket.id,
      'subject', v_ticket.subject,
      'category', v_ticket.category,
      'priority', v_ticket.priority,
      'status', v_ticket.status,
      'last_message_preview', v_ticket.last_message_preview,
      'last_message_at', v_ticket.last_message_at,
      'created_at', v_ticket.created_at,
      'updated_at', v_ticket.updated_at,
      'closed_at', v_ticket.closed_at
    ),
    'messages', v_messages
  );
end;
$function$;

create or replace function public.reply_support_ticket(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_ticket_id uuid,
  p_message text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_staff_user_id uuid;
  v_message text := btrim(coalesce(p_message, ''));
  v_preview text;
  v_ticket public.support_tickets%rowtype;
begin
  v_context := private.get_support_ticket_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'reply_support_ticket');
  if coalesce((v_context->>'success')::boolean, false) is not true then
    return v_context;
  end if;

  if char_length(v_message) < 10 then
    return jsonb_build_object('success', false, 'code', 'MESSAGE_TOO_SHORT', 'message', 'Escribe una respuesta de al menos 10 caracteres.');
  end if;

  if char_length(v_message) > 3000 then
    return jsonb_build_object('success', false, 'code', 'MESSAGE_TOO_LONG', 'message', 'El mensaje no puede superar 3000 caracteres.');
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
    and license_id = v_license_id
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
    sender_staff_user_id,
    sender_device_fingerprint,
    message,
    metadata
  ) values (
    v_ticket.id,
    v_license_id,
    'user',
    v_staff_user_id,
    p_device_fingerprint,
    v_message,
    jsonb_build_object('phase', 'NOTIF.3', 'event', 'user_reply')
  );

  update public.support_tickets
  set status = 'waiting_support',
      last_message_preview = v_preview,
      last_message_at = now(),
      updated_at = now()
  where id = v_ticket.id
  returning * into v_ticket;

  perform private.create_pos_notification(
    p_license_id => v_license_id,
    p_title => 'Respuesta enviada',
    p_type => 'support',
    p_severity => 'info',
    p_body => 'Tu mensaje fue agregado al ticket.',
    p_action_label => 'Ver soporte',
    p_action_route => 'notifications:support',
    p_metadata => jsonb_build_object('ticket_id', v_ticket.id, 'phase', 'NOTIF.3', 'event', 'user_reply'),
    p_source => 'support',
    p_expires_at => null
  );

  return jsonb_build_object('success', true);
end;
$function$;

create or replace function public.close_support_ticket(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_ticket_id uuid,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_ticket public.support_tickets%rowtype;
begin
  v_context := private.get_support_ticket_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, 'close_support_ticket');
  if coalesce((v_context->>'success')::boolean, false) is not true then
    return v_context;
  end if;

  v_license_id := (v_context->>'license_id')::uuid;

  select * into v_ticket
  from public.support_tickets
  where id = p_ticket_id
    and license_id = v_license_id
  limit 1;

  if not found then
    return jsonb_build_object('success', false, 'code', 'TICKET_NOT_FOUND', 'message', 'Ticket no encontrado.');
  end if;

  if v_ticket.status = 'closed' then
    return jsonb_build_object('success', true, 'already_closed', true);
  end if;

  insert into public.support_ticket_messages (
    ticket_id,
    license_id,
    sender_type,
    message,
    metadata
  ) values (
    v_ticket.id,
    v_license_id,
    'system',
    'Ticket cerrado por el usuario.',
    jsonb_build_object('phase', 'NOTIF.3', 'event', 'ticket_closed')
  );

  update public.support_tickets
  set status = 'closed',
      closed_at = now(),
      last_message_preview = 'Ticket cerrado por el usuario.',
      last_message_at = now(),
      updated_at = now()
  where id = v_ticket.id;

  perform private.broadcast_notification_event(
    p_license_id => v_license_id,
    p_event => 'notifications_changed',
    p_reason => 'ticket_status_changed',
    p_ticket_id => v_ticket.id,
    p_metadata => jsonb_build_object('status', 'closed', 'source', 'support')
  );

  return jsonb_build_object('success', true);
end;
$function$;

revoke all on function public.create_support_ticket(text, text, text, text, text, text, text, jsonb, text) from public;
revoke all on function public.list_support_tickets(text, text, text, integer, integer, boolean, text) from public;
revoke all on function public.get_support_ticket_thread(text, text, text, uuid, text) from public;
revoke all on function public.reply_support_ticket(text, text, text, uuid, text, text) from public;
revoke all on function public.close_support_ticket(text, text, text, uuid, text) from public;

grant execute on function public.create_support_ticket(text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.list_support_tickets(text, text, text, integer, integer, boolean, text) to anon, authenticated;
grant execute on function public.get_support_ticket_thread(text, text, text, uuid, text) to anon, authenticated;
grant execute on function public.reply_support_ticket(text, text, text, uuid, text, text) to anon, authenticated;
grant execute on function public.close_support_ticket(text, text, text, uuid, text) to anon, authenticated;
