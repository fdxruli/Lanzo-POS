-- CUSTOMER.MESSAGING.PHASE5
-- Cloud outbox and pending-account reminders. This migration never mutates
-- sales, cash, inventory, ledger, payments, or layaways.

do $preflight$
begin
  if to_regprocedure('private.customer_message_template_context(text,text,text,text,boolean)') is null then
    raise exception 'CUSTOMER_MESSAGE_PHASE5_TEMPLATE_AUTH_PREREQUISITE_MISSING';
  end if;
  if to_regprocedure('private.validate_pos_sync_context(text,text,text,text)') is null then
    raise exception 'CUSTOMER_MESSAGE_PHASE5_POS_AUTH_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

create or replace function private.customer_message_cloud_plan_enabled(p_features jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select coalesce((coalesce(p_features, '{}'::jsonb)->>'cloud_pos_sync')::boolean, false);
$function$;

create table public.customer_message_outbox (
  license_id uuid not null references public.licenses(id) on delete cascade,
  idempotency_key text not null,
  event_type text not null check (event_type in (
    'sale_paid', 'sale_credit', 'account_statement', 'payment_partial', 'account_settled',
    'layaway_created', 'layaway_payment', 'layaway_settled', 'layaway_delivered',
    'layaway_cancelled', 'debt_reminder'
  )),
  channel text not null default 'image' check (channel = 'image'),
  human_reference text,
  payload_snapshot jsonb not null,
  template_snapshot jsonb,
  template_revision integer not null default 0 check (template_revision >= 0),
  template_source text not null default 'default' check (template_source in ('default', 'custom')),
  status text not null default 'preparado' check (status in (
    'preparado', 'pendiente', 'compartido', 'descargado', 'cancelado',
    'reintento_pendiente', 'error'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  share_attempt_count integer not null default 0 check (share_attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_error_code text,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  image_storage_path text,
  created_by_actor_type text not null check (created_by_actor_type in ('admin', 'staff')),
  created_by_actor_id uuid,
  updated_by_actor_type text not null check (updated_by_actor_type in ('admin', 'staff')),
  updated_by_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (license_id, idempotency_key),
  check (length(btrim(idempotency_key)) between 8 and 180),
  check (octet_length(payload_snapshot::text) <= 250000),
  check (payload_snapshot::text !~* 'data:image|base64'),
  check (payload_snapshot::text !~* '"([^" ]*id|id)"[[:space:]]*:'),
  check (template_source = 'default' or template_snapshot is not null),
  check (template_snapshot is null or private.customer_message_template_shape_valid(template_snapshot)),
  check (image_storage_path is null or image_storage_path !~* '(^/|\.\.|[[:space:]])')
);

alter table public.customer_message_outbox enable row level security;
alter table public.customer_message_outbox force row level security;
revoke all on table public.customer_message_outbox from public, anon, authenticated, service_role;
create policy customer_message_outbox_no_direct_access
  on public.customer_message_outbox for all
  using (false) with check (false);

create index customer_message_outbox_license_updated_idx
  on public.customer_message_outbox (license_id, updated_at desc);
create index customer_message_outbox_license_status_idx
  on public.customer_message_outbox (license_id, status, updated_at desc);

create table public.customer_message_reminder_configs (
  license_id uuid not null references public.licenses(id) on delete cascade,
  event_type text not null check (event_type = 'debt_reminder'),
  enabled boolean not null default false,
  time_zone text not null default 'America/Mexico_City',
  local_time time not null default time '10:00',
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  backoff_minutes integer not null default 30 check (backoff_minutes between 1 and 1440),
  provider_key text,
  updated_by_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (license_id, event_type),
  check (length(btrim(time_zone)) > 0),
  check (provider_key is null or provider_key in ('whatsapp_business_api'))
);

alter table public.customer_message_reminder_configs enable row level security;
alter table public.customer_message_reminder_configs force row level security;
revoke all on table public.customer_message_reminder_configs from public, anon, authenticated, service_role;
create policy customer_message_reminder_configs_no_direct_access
  on public.customer_message_reminder_configs for all
  using (false) with check (false);

create table public.customer_message_reminders (
  id uuid not null default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  customer_id text not null references public.pos_customers(id),
  event_type text not null default 'debt_reminder' check (event_type = 'debt_reminder'),
  account_key text not null,
  window_key text not null,
  time_zone text not null,
  scheduled_for timestamptz not null,
  status text not null default 'programado' check (status in (
    'programado', 'listo_para_preparar', 'preparado', 'cancelado',
    'reintento_pendiente', 'error'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  last_error_code text,
  next_retry_at timestamptz,
  prepared_outbox_key text,
  provider_key text,
  created_by_actor_id uuid,
  updated_by_actor_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  primary key (id),
  unique (license_id, customer_id, event_type, window_key),
  check (length(btrim(account_key)) > 0),
  check (length(btrim(window_key)) > 0),
  check (provider_key is null or provider_key in ('whatsapp_business_api'))
);

alter table public.customer_message_reminders enable row level security;
alter table public.customer_message_reminders force row level security;
revoke all on table public.customer_message_reminders from public, anon, authenticated, service_role;
create policy customer_message_reminders_no_direct_access
  on public.customer_message_reminders for all
  using (false) with check (false);

create index customer_message_reminders_due_idx
  on public.customer_message_reminders (status, scheduled_for);
create index customer_message_reminders_license_customer_idx
  on public.customer_message_reminders (license_id, customer_id, updated_at desc);

create or replace function private.touch_customer_message_phase5_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger customer_message_outbox_touch_updated_at
before update on public.customer_message_outbox
for each row execute function private.touch_customer_message_phase5_updated_at();

create trigger customer_message_reminder_configs_touch_updated_at
before update on public.customer_message_reminder_configs
for each row execute function private.touch_customer_message_phase5_updated_at();

create trigger customer_message_reminders_touch_updated_at
before update on public.customer_message_reminders
for each row execute function private.touch_customer_message_phase5_updated_at();

create or replace function private.customer_message_phase5_error_code(p_error text, p_fallback text)
returns text
language sql
immutable
set search_path = ''
as $function$
  select case when p_error in (
    'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE', 'CUSTOMER_MESSAGE_ADMIN_REQUIRED',
    'CUSTOMER_MESSAGE_STAFF_NOT_ALLOWED', 'CUSTOMER_MESSAGE_PAYLOAD_INVALID',
    'CUSTOMER_MESSAGE_PAYLOAD_TOO_LARGE', 'CUSTOMER_MESSAGE_TEMPLATE_INVALID',
    'CUSTOMER_MESSAGE_IDEMPOTENCY_CONFLICT', 'CUSTOMER_MESSAGE_OUTBOX_NOT_FOUND',
    'CUSTOMER_MESSAGE_OUTBOX_CONFLICT', 'CUSTOMER_MESSAGE_OUTBOX_TRANSITION_INVALID',
    'CUSTOMER_MESSAGE_STATUS_INVALID', 'REMINDER_CONFIG_INVALID',
    'REMINDER_CONFIG_DISABLED', 'REMINDER_CUSTOMER_NOT_FOUND',
    'REMINDER_CUSTOMER_NOT_PENDING', 'REMINDER_NOT_FOUND',
    'REMINDER_CONFLICT', 'REMINDER_TIMEZONE_INVALID', 'REMINDER_DATE_INVALID',
    'LICENSE_NOT_FOUND', 'LICENSE_NOT_ACTIVE', 'LICENSE_EXPIRED',
    'DEVICE_NOT_ALLOWED', 'DEVICE_NOT_ACTIVE', 'DEVICE_TOKEN_REQUIRED',
    'DEVICE_TOKEN_INVALID', 'ACTOR_SESSION_REQUIRED', 'ACTOR_SESSION_INVALID',
    'ACTOR_SESSION_AMBIGUOUS', 'STAFF_SESSION_EXPIRED', 'STAFF_USER_INACTIVE'
  ) then p_error else p_fallback end;
$function$;

create or replace function private.customer_message_outbox_row(
  p_row public.customer_message_outbox,
  p_include_custom_template boolean default false
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'idempotency_key', p_row.idempotency_key,
    'event_type', p_row.event_type,
    'channel', p_row.channel,
    'human_reference', p_row.human_reference,
    'payload_snapshot', p_row.payload_snapshot,
    'template_snapshot', case when p_include_custom_template then p_row.template_snapshot else null end,
    'template_revision', case when p_include_custom_template then p_row.template_revision else 0 end,
    'template_source', case when p_include_custom_template then p_row.template_source else 'default' end,
    'status', p_row.status,
    'attempt_count', p_row.attempt_count,
    'share_attempt_count', p_row.share_attempt_count,
    'max_attempts', p_row.max_attempts,
    'last_error_code', p_row.last_error_code,
    'next_retry_at', p_row.next_retry_at,
    'last_attempt_at', p_row.last_attempt_at,
    'image_storage_path', p_row.image_storage_path,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'expires_at', p_row.expires_at
  ));
$function$;

create or replace function private.customer_message_reminder_row(
  p_row public.customer_message_reminders,
  p_customer public.pos_customers,
  p_config public.customer_message_reminder_configs
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', p_row.id,
    'customer_id', p_row.customer_id,
    'customer_name', p_customer.name,
    'customer_phone', p_customer.phone,
    'current_balance', p_customer.debt,
    'event_type', p_row.event_type,
    'account_key', p_row.account_key,
    'window_key', p_row.window_key,
    'time_zone', p_row.time_zone,
    'scheduled_for', p_row.scheduled_for,
    'status', p_row.status,
    'attempt_count', p_row.attempt_count,
    'max_attempts', p_row.max_attempts,
    'last_error_code', p_row.last_error_code,
    'next_retry_at', p_row.next_retry_at,
    'prepared_outbox_key', p_row.prepared_outbox_key,
    'provider_key', p_row.provider_key,
    'provider_configured', p_config.provider_key is not null,
    'created_at', p_row.created_at,
    'updated_at', p_row.updated_at,
    'cancelled_at', p_row.cancelled_at
  ));
$function$;

create or replace function public.upsert_customer_message_outbox(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_idempotency_key text,
  p_event_type text,
  p_payload_snapshot jsonb,
  p_human_reference text default null,
  p_template_snapshot jsonb default null,
  p_template_revision integer default 0,
  p_template_source text default 'default',
  p_status text default 'preparado',
  p_max_attempts integer default 3,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_id uuid;
  v_actor_type text;
  v_existing public.customer_message_outbox%rowtype;
  v_row public.customer_message_outbox%rowtype;
  v_template jsonb;
  v_source text;
  v_status text;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, false
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_id := (v_context->>'actor_id')::uuid;
  v_actor_type := coalesce(v_context->>'actor_type', 'staff');
  v_source := case when v_actor_type = 'admin' and p_template_source = 'custom' then 'custom' else 'default' end;
  v_template := case when v_source = 'custom' then p_template_snapshot else null end;
  v_status := coalesce(nullif(btrim(p_status), ''), 'preparado');

  if nullif(btrim(coalesce(p_idempotency_key, '')), '') is null
     or p_event_type not in (
       'sale_paid', 'sale_credit', 'account_statement', 'payment_partial', 'account_settled',
       'layaway_created', 'layaway_payment', 'layaway_settled', 'layaway_delivered',
       'layaway_cancelled', 'debt_reminder'
     )
     or v_status not in ('preparado', 'pendiente') then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_PAYLOAD_INVALID');
  end if;
  if p_payload_snapshot is null or jsonb_typeof(p_payload_snapshot) <> 'object' then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_PAYLOAD_INVALID');
  end if;
  if octet_length(p_payload_snapshot::text) > 250000 then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_PAYLOAD_TOO_LARGE');
  end if;
  if p_payload_snapshot::text ~* 'data:image|base64'
     or p_payload_snapshot::text ~* '"([^" ]*id|id)"[[:space:]]*:' then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_PAYLOAD_INVALID');
  end if;
  if v_template is not null and not private.customer_message_template_valid(p_event_type, v_template) then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_TEMPLATE_INVALID');
  end if;

  select * into v_existing
  from public.customer_message_outbox
  where license_id = v_license_id and idempotency_key = btrim(p_idempotency_key)
  for update;

  if v_existing.idempotency_key is not null then
    if v_existing.event_type <> p_event_type then
      return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'record', private.customer_message_outbox_row(v_existing, v_actor_type = 'admin')
    );
  end if;

  insert into public.customer_message_outbox (
    license_id, idempotency_key, event_type, channel, human_reference,
    payload_snapshot, template_snapshot, template_revision, template_source,
    status, max_attempts, created_by_actor_type, created_by_actor_id,
    updated_by_actor_type, updated_by_actor_id, expires_at
  ) values (
    v_license_id, btrim(p_idempotency_key), p_event_type, 'image', nullif(btrim(p_human_reference), ''),
    p_payload_snapshot, v_template, case when v_source = 'custom' then greatest(coalesce(p_template_revision, 0), 1) else 0 end,
    v_source, v_status, least(greatest(coalesce(p_max_attempts, 3), 1), 10),
    v_actor_type, v_actor_id, v_actor_type, v_actor_id,
    coalesce(p_expires_at, now() + interval '30 days')
  ) returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'duplicate', false,
    'record', private.customer_message_outbox_row(v_row, v_actor_type = 'admin')
  );
exception
  when unique_violation then
    select * into v_existing
    from public.customer_message_outbox
    where license_id = v_license_id and idempotency_key = btrim(p_idempotency_key);
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'record', private.customer_message_outbox_row(v_existing, v_actor_type = 'admin')
    );
  when others then
    return jsonb_build_object(
      'success', false,
      'code', private.customer_message_phase5_error_code(sqlerrm, 'CUSTOMER_MESSAGE_OUTBOX_FAILED')
    );
end;
$function$;

create or replace function public.list_customer_message_outbox(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_include_custom boolean;
  v_records jsonb;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, false
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_include_custom := coalesce(v_context->>'actor_type', '') = 'admin';
  select coalesce(jsonb_agg(private.customer_message_outbox_row(o, v_include_custom) order by o.updated_at desc), '[]'::jsonb)
  into v_records
  from (
    select * from public.customer_message_outbox
    where license_id = v_license_id
      and expires_at >= now()
    order by updated_at desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) o;
  return jsonb_build_object('success', true, 'records', v_records);
exception when others then
  return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'CUSTOMER_MESSAGE_OUTBOX_LIST_FAILED'));
end;
$function$;

create or replace function public.transition_customer_message_outbox(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_idempotency_key text,
  p_status text,
  p_expected_updated_at timestamptz default null,
  p_attempt_count integer default null,
  p_share_attempt_count integer default null,
  p_last_error_code text default null,
  p_next_retry_at timestamptz default null,
  p_last_attempt_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_id uuid;
  v_actor_type text;
  v_row public.customer_message_outbox%rowtype;
  v_allowed boolean := false;
  v_error_code text;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, false
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_id := (v_context->>'actor_id')::uuid;
  v_actor_type := coalesce(v_context->>'actor_type', 'staff');
  if p_status not in ('preparado', 'pendiente', 'compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error') then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_STATUS_INVALID');
  end if;

  select * into v_row
  from public.customer_message_outbox
  where license_id = v_license_id and idempotency_key = btrim(p_idempotency_key)
  for update;
  if v_row.idempotency_key is null then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_OUTBOX_NOT_FOUND');
  end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then
    return jsonb_build_object(
      'success', false,
      'code', 'CUSTOMER_MESSAGE_OUTBOX_CONFLICT',
      'record', private.customer_message_outbox_row(v_row, v_actor_type = 'admin')
    );
  end if;

  v_allowed := v_row.status = p_status
    or (v_row.status = 'preparado' and p_status in ('pendiente', 'compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'))
    or (v_row.status = 'pendiente' and p_status in ('compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'))
    or (v_row.status = 'compartido' and p_status in ('compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'))
    or (v_row.status = 'descargado' and p_status in ('compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'))
    or (v_row.status = 'cancelado' and p_status in ('compartido', 'descargado', 'reintento_pendiente', 'error'))
    or (v_row.status = 'reintento_pendiente' and p_status in ('compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'))
    or (v_row.status = 'error' and p_status in ('compartido', 'descargado', 'cancelado', 'reintento_pendiente', 'error'));
  if not v_allowed then
    return jsonb_build_object('success', false, 'code', 'CUSTOMER_MESSAGE_OUTBOX_TRANSITION_INVALID');
  end if;

  v_error_code := case when p_last_error_code in (
    'IMAGE_SHARE_FAILED', 'IMAGE_DOWNLOAD_FAILED', 'IMAGE_PNG_EMPTY', 'IMAGE_RENDER_FAILED',
    'IMAGE_SHARE_CANCELLED', 'WEB_SHARE_UNAVAILABLE_OR_INCOMPATIBLE', 'OUTBOX_MAX_ATTEMPTS_REACHED',
    'OUTBOX_PERSISTENCE_FAILED', 'CUSTOMER_PHONE_MISSING', 'CUSTOMER_PHONE_INVALID'
  ) then p_last_error_code else null end;

  update public.customer_message_outbox
  set status = p_status,
      attempt_count = greatest(attempt_count, coalesce(p_attempt_count, attempt_count)),
      share_attempt_count = greatest(share_attempt_count, coalesce(p_share_attempt_count, share_attempt_count)),
      last_error_code = v_error_code,
      next_retry_at = p_next_retry_at,
      last_attempt_at = coalesce(p_last_attempt_at, last_attempt_at),
      updated_by_actor_type = v_actor_type,
      updated_by_actor_id = v_actor_id
  where license_id = v_license_id and idempotency_key = v_row.idempotency_key
  returning * into v_row;

  return jsonb_build_object('success', true, 'record', private.customer_message_outbox_row(v_row, v_actor_type = 'admin'));
exception when others then
  return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'CUSTOMER_MESSAGE_OUTBOX_TRANSITION_FAILED'));
end;
$function$;

create or replace function public.save_customer_message_reminder_config(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_enabled boolean,
  p_time_zone text default 'America/Mexico_City',
  p_local_time time default time '10:00',
  p_max_attempts integer default 3,
  p_backoff_minutes integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_id uuid;
  v_config public.customer_message_reminder_configs%rowtype;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, true
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pg_timezone_names where name = nullif(btrim(p_time_zone), '')) then
    return jsonb_build_object('success', false, 'code', 'REMINDER_TIMEZONE_INVALID');
  end if;
  if p_local_time is null or p_max_attempts not between 1 and 10 or p_backoff_minutes not between 1 and 1440 then
    return jsonb_build_object('success', false, 'code', 'REMINDER_CONFIG_INVALID');
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_id := (v_context->>'actor_id')::uuid;

  insert into public.customer_message_reminder_configs (
    license_id, event_type, enabled, time_zone, local_time, max_attempts, backoff_minutes,
    provider_key, updated_by_actor_id
  ) values (
    v_license_id, 'debt_reminder', coalesce(p_enabled, false), btrim(p_time_zone), p_local_time,
    p_max_attempts, p_backoff_minutes, null, v_actor_id
  )
  on conflict (license_id, event_type) do update set
    enabled = excluded.enabled,
    time_zone = excluded.time_zone,
    local_time = excluded.local_time,
    max_attempts = excluded.max_attempts,
    backoff_minutes = excluded.backoff_minutes,
    updated_by_actor_id = excluded.updated_by_actor_id;

  if not coalesce(p_enabled, false) then
    update public.customer_message_reminders
    set status = 'cancelado', cancelled_at = coalesce(cancelled_at, now()), updated_by_actor_id = v_actor_id
    where license_id = v_license_id
      and status in ('programado', 'listo_para_preparar', 'reintento_pendiente');
  end if;

  select * into v_config from public.customer_message_reminder_configs
  where license_id = v_license_id and event_type = 'debt_reminder';
  return jsonb_build_object(
    'success', true,
    'config', jsonb_build_object(
      'event_type', v_config.event_type,
      'enabled', v_config.enabled,
      'time_zone', v_config.time_zone,
      'local_time', v_config.local_time,
      'max_attempts', v_config.max_attempts,
      'backoff_minutes', v_config.backoff_minutes,
      'provider_configured', v_config.provider_key is not null,
      'updated_at', v_config.updated_at
    )
  );
exception when others then
  return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'REMINDER_CONFIG_SAVE_FAILED'));
end;
$function$;

create or replace function public.list_customer_message_reminders(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_limit integer default 100
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_config public.customer_message_reminder_configs%rowtype;
  v_config_json jsonb;
  v_reminders jsonb;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, false
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  select * into v_config from public.customer_message_reminder_configs
  where license_id = v_license_id and event_type = 'debt_reminder';
  v_config_json := case when v_config.license_id is null then null else jsonb_build_object(
    'event_type', v_config.event_type,
    'enabled', v_config.enabled,
    'time_zone', v_config.time_zone,
    'local_time', v_config.local_time,
    'max_attempts', v_config.max_attempts,
    'backoff_minutes', v_config.backoff_minutes,
    'provider_configured', v_config.provider_key is not null,
    'updated_at', v_config.updated_at
  ) end;
  select coalesce(jsonb_agg(private.customer_message_reminder_row(r, c, v_config) order by r.scheduled_for desc), '[]'::jsonb)
  into v_reminders
  from (
    select * from public.customer_message_reminders
    where license_id = v_license_id
    order by scheduled_for desc
    limit least(greatest(coalesce(p_limit, 100), 1), 200)
  ) r
  join public.pos_customers c on c.license_id = r.license_id and c.id = r.customer_id;
  return jsonb_build_object('success', true, 'config', v_config_json, 'reminders', v_reminders);
exception when others then
  return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'REMINDER_LIST_FAILED'));
end;
$function$;

create or replace function public.schedule_customer_message_reminder(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_customer_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_id uuid;
  v_config public.customer_message_reminder_configs%rowtype;
  v_customer public.pos_customers%rowtype;
  v_local_now timestamp;
  v_local_target timestamp;
  v_scheduled_for timestamptz;
  v_window_key text;
  v_existing public.customer_message_reminders%rowtype;
  v_row public.customer_message_reminders%rowtype;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, true
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_id := (v_context->>'actor_id')::uuid;
  select * into v_config from public.customer_message_reminder_configs
  where license_id = v_license_id and event_type = 'debt_reminder';
  if v_config.license_id is null or v_config.enabled is not true then
    return jsonb_build_object('success', false, 'code', 'REMINDER_CONFIG_DISABLED');
  end if;
  select * into v_customer from public.pos_customers
  where license_id = v_license_id and id = p_customer_id and deleted_at is null;
  if v_customer.id is null then
    return jsonb_build_object('success', false, 'code', 'REMINDER_CUSTOMER_NOT_FOUND');
  end if;
  if coalesce(v_customer.debt, 0) <= 0 then
    return jsonb_build_object('success', false, 'code', 'REMINDER_CUSTOMER_NOT_PENDING');
  end if;

  v_local_now := now() at time zone v_config.time_zone;
  v_local_target := v_local_now::date + v_config.local_time;
  if v_local_target <= v_local_now then v_local_target := v_local_target + interval '1 day'; end if;
  v_scheduled_for := v_local_target at time zone v_config.time_zone;
  v_window_key := to_char(v_scheduled_for at time zone v_config.time_zone, 'YYYY-MM-DD');

  select * into v_existing from public.customer_message_reminders
  where license_id = v_license_id and customer_id = v_customer.id
    and event_type = 'debt_reminder' and window_key = v_window_key
  for update;
  if v_existing.id is not null then
    return jsonb_build_object('success', true, 'duplicate', true, 'reminder', private.customer_message_reminder_row(v_existing, v_customer, v_config));
  end if;

  insert into public.customer_message_reminders (
    license_id, customer_id, event_type, account_key, window_key, time_zone,
    scheduled_for, status, max_attempts, provider_key, created_by_actor_id, updated_by_actor_id
  ) values (
    v_license_id, v_customer.id, 'debt_reminder', v_customer.id, v_window_key, v_config.time_zone,
    v_scheduled_for, 'programado', v_config.max_attempts, v_config.provider_key, v_actor_id, v_actor_id
  ) returning * into v_row;
  return jsonb_build_object('success', true, 'duplicate', false, 'reminder', private.customer_message_reminder_row(v_row, v_customer, v_config));
exception
  when unique_violation then
    select * into v_existing from public.customer_message_reminders
    where license_id = v_license_id and customer_id = p_customer_id
      and event_type = 'debt_reminder' and window_key = v_window_key;
    return jsonb_build_object('success', true, 'duplicate', true, 'reminder', private.customer_message_reminder_row(v_existing, v_customer, v_config));
  when others then
    return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'REMINDER_SCHEDULE_FAILED'));
end;
$function$;

create or replace function public.cancel_customer_message_reminder(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_reminder_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_id uuid;
  v_row public.customer_message_reminders%rowtype;
  v_customer public.pos_customers%rowtype;
  v_config public.customer_message_reminder_configs%rowtype;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, true
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_id := (v_context->>'actor_id')::uuid;
  select * into v_row from public.customer_message_reminders
  where id = p_reminder_id and license_id = v_license_id for update;
  if v_row.id is null then return jsonb_build_object('success', false, 'code', 'REMINDER_NOT_FOUND'); end if;
  update public.customer_message_reminders
  set status = 'cancelado', cancelled_at = coalesce(cancelled_at, now()), updated_by_actor_id = v_actor_id
  where id = v_row.id
  returning * into v_row;
  select * into v_customer from public.pos_customers where license_id = v_license_id and id = v_row.customer_id;
  select * into v_config from public.customer_message_reminder_configs where license_id = v_license_id and event_type = 'debt_reminder';
  return jsonb_build_object('success', true, 'reminder', private.customer_message_reminder_row(v_row, v_customer, v_config));
exception when others then
  return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'REMINDER_CANCEL_FAILED'));
end;
$function$;

create or replace function public.reschedule_customer_message_reminder(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_reminder_id uuid,
  p_scheduled_for timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_id uuid;
  v_row public.customer_message_reminders%rowtype;
  v_customer public.pos_customers%rowtype;
  v_config public.customer_message_reminder_configs%rowtype;
  v_window_key text;
begin
  v_context := private.customer_message_template_context(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, true
  );
  if not private.customer_message_cloud_plan_enabled(v_context->'features') then
    raise exception 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if p_scheduled_for is null or p_scheduled_for <= now() then return jsonb_build_object('success', false, 'code', 'REMINDER_DATE_INVALID'); end if;
  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_id := (v_context->>'actor_id')::uuid;
  select * into v_config from public.customer_message_reminder_configs where license_id = v_license_id and event_type = 'debt_reminder';
  if v_config.license_id is null or v_config.enabled is not true then return jsonb_build_object('success', false, 'code', 'REMINDER_CONFIG_DISABLED'); end if;
  select * into v_row from public.customer_message_reminders where id = p_reminder_id and license_id = v_license_id for update;
  if v_row.id is null then return jsonb_build_object('success', false, 'code', 'REMINDER_NOT_FOUND'); end if;
  select * into v_customer from public.pos_customers where license_id = v_license_id and id = v_row.customer_id and deleted_at is null;
  if v_customer.id is null or coalesce(v_customer.debt, 0) <= 0 then return jsonb_build_object('success', false, 'code', 'REMINDER_CUSTOMER_NOT_PENDING'); end if;
  v_window_key := to_char(p_scheduled_for at time zone v_config.time_zone, 'YYYY-MM-DD');
  update public.customer_message_reminders
  set scheduled_for = p_scheduled_for, window_key = v_window_key, time_zone = v_config.time_zone,
      status = 'programado', attempt_count = 0, last_error_code = null, next_retry_at = null,
      cancelled_at = null, updated_by_actor_id = v_actor_id
  where id = v_row.id
  returning * into v_row;
  return jsonb_build_object('success', true, 'reminder', private.customer_message_reminder_row(v_row, v_customer, v_config));
exception when unique_violation then return jsonb_build_object('success', false, 'code', 'REMINDER_CONFLICT');
when others then return jsonb_build_object('success', false, 'code', private.customer_message_phase5_error_code(sqlerrm, 'REMINDER_RESCHEDULE_FAILED'));
end;
$function$;

create or replace function private.run_customer_message_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_row record;
  v_processed integer := 0;
  v_enabled boolean;
begin
  for v_row in
    select r.id, r.license_id, r.customer_id, r.status, r.scheduled_for,
           c.debt, coalesce((p.features || l.features)->>'cloud_pos_sync', 'false')::boolean as cloud_enabled,
           coalesce(cfg.enabled, false) as config_enabled
    from public.customer_message_reminders r
    join public.pos_customers c on c.license_id = r.license_id and c.id = r.customer_id
    join public.licenses l on l.id = r.license_id
    left join public.plans p on p.id = l.plan_id
    left join public.customer_message_reminder_configs cfg on cfg.license_id = r.license_id and cfg.event_type = r.event_type
    where r.status = 'programado' and r.scheduled_for <= now()
      and l.status = 'active'
      and (l.expires_at is null or l.expires_at >= now())
    order by r.scheduled_for
    for update of r skip locked
  loop
    v_enabled := v_row.cloud_enabled and v_row.config_enabled;
    update public.customer_message_reminders
    set status = case when v_enabled and coalesce(v_row.debt, 0) > 0 then 'listo_para_preparar' else 'cancelado' end,
        cancelled_at = case when not (v_enabled and coalesce(v_row.debt, 0) > 0) then coalesce(cancelled_at, now()) else null end,
        last_error_code = case when not v_enabled then 'CUSTOMER_MESSAGE_CLOUD_UNAVAILABLE' when coalesce(v_row.debt, 0) <= 0 then 'REMINDER_CUSTOMER_NOT_PENDING' else null end
    where id = v_row.id;
    v_processed := v_processed + 1;
  end loop;
  return v_processed;
end;
$function$;

revoke all on function private.customer_message_cloud_plan_enabled(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.customer_message_phase5_error_code(text, text) from public, anon, authenticated, service_role;
revoke all on function private.customer_message_outbox_row(public.customer_message_outbox, boolean) from public, anon, authenticated, service_role;
revoke all on function private.customer_message_reminder_row(public.customer_message_reminders, public.pos_customers, public.customer_message_reminder_configs) from public, anon, authenticated, service_role;
revoke all on function private.run_customer_message_reminders() from public, anon, authenticated, service_role;

revoke all on function public.upsert_customer_message_outbox(text,text,text,text,text,text,jsonb,text,jsonb,integer,text,text,integer,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.list_customer_message_outbox(text,text,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.transition_customer_message_outbox(text,text,text,text,text,text,timestamptz,integer,integer,text,timestamptz,timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.save_customer_message_reminder_config(text,text,text,text,boolean,text,time,integer,integer) from public, anon, authenticated, service_role;
revoke all on function public.list_customer_message_reminders(text,text,text,text,integer) from public, anon, authenticated, service_role;
revoke all on function public.schedule_customer_message_reminder(text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.cancel_customer_message_reminder(text,text,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.reschedule_customer_message_reminder(text,text,text,text,uuid,timestamptz) from public, anon, authenticated, service_role;

grant execute on function public.upsert_customer_message_outbox(text,text,text,text,text,text,jsonb,text,jsonb,integer,text,text,integer,timestamptz) to anon, authenticated;
grant execute on function public.list_customer_message_outbox(text,text,text,text,integer) to anon, authenticated;
grant execute on function public.transition_customer_message_outbox(text,text,text,text,text,text,timestamptz,integer,integer,text,timestamptz,timestamptz) to anon, authenticated;
grant execute on function public.save_customer_message_reminder_config(text,text,text,text,boolean,text,time,integer,integer) to anon, authenticated;
grant execute on function public.list_customer_message_reminders(text,text,text,text,integer) to anon, authenticated;
grant execute on function public.schedule_customer_message_reminder(text,text,text,text,text) to anon, authenticated;
grant execute on function public.cancel_customer_message_reminder(text,text,text,text,uuid) to anon, authenticated;
grant execute on function public.reschedule_customer_message_reminder(text,text,text,text,uuid,timestamptz) to anon, authenticated;

-- Production Supabase instances normally expose pg_cron. Local test stacks may
-- not have it enabled, so scheduling is conditional and never blocks the
-- schema deployment. No provider is invoked by this job.
do $cron$
begin
  if to_regnamespace('cron') is not null then
    if exists (select 1 from cron.job where jobname = 'customer-message-reminders-phase5') then
      perform cron.unschedule('customer-message-reminders-phase5');
    end if;
    perform cron.schedule(
      'customer-message-reminders-phase5',
      '*/5 * * * *',
      $$select private.run_customer_message_reminders();$$
    );
  end if;
exception when others then
  -- The RPC remains usable for an explicit scheduler/worker if pg_cron is not
  -- available or has been disabled by the project configuration.
  null;
end;
$cron$;

notify pgrst, 'reload schema';
