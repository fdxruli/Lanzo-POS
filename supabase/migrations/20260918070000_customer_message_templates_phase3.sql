-- CUSTOMER.MESSAGING.PHASE3
-- Image-template copy only. Financial payloads and customer data never persist here.

do $preflight$
begin
  if to_regprocedure('private.validate_pos_sync_context(text,text,text,text)') is null then
    raise exception 'CUSTOMER_MESSAGE_TEMPLATE_AUTH_PREREQUISITE_MISSING';
  end if;
  if to_regprocedure('private.license_entitlement_state_v1(uuid)') is null then
    raise exception 'CUSTOMER_MESSAGE_TEMPLATE_ENTITLEMENT_PREREQUISITE_MISSING';
  end if;
end;
$preflight$;

-- The plan feature is the source of entitlement. Existing individual license
-- overrides are intentionally untouched; effective_features remains canonical.
update public.plans
set features = jsonb_set(
  coalesce(features, '{}'::jsonb),
  '{customerMessageTemplates}',
  to_jsonb(coalesce((features->>'cloud_pos_sync')::boolean, false) or code like 'pro%'),
  true
)
where is_active is true;

create function private.customer_message_template_shape_valid(p_template jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select jsonb_typeof(p_template) = 'object'
    and (select count(*) from jsonb_object_keys(p_template)) = 4
    and p_template ?& array['schemaVersion', 'title', 'body', 'footer']
    and p_template->>'schemaVersion' = '1';
$function$;

create table public.customer_message_templates (
  license_id uuid not null references public.licenses(id) on delete cascade,
  event_type text not null check (event_type in (
    'sale_paid', 'sale_credit', 'account_statement', 'payment_partial', 'account_settled',
    'layaway_created', 'layaway_payment', 'layaway_settled', 'layaway_delivered', 'layaway_cancelled', 'debt_reminder'
  )),
  channel text not null default 'image' check (channel = 'image'),
  template_json jsonb not null,
  schema_version integer not null check (schema_version = 1),
  revision integer not null default 1 check (revision > 0),
  updated_by uuid not null references public.license_admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (license_id, event_type, channel),
  check (private.customer_message_template_shape_valid(template_json))
);

alter table public.customer_message_templates enable row level security;
alter table public.customer_message_templates force row level security;

-- Browser roles receive no relation grants. All access is through the scoped
-- RPCs below, which derive license_id from the validated device/session context.
revoke all on table public.customer_message_templates from public, anon, authenticated;

create policy customer_message_templates_no_direct_access
  on public.customer_message_templates for all
  using (false) with check (false);

create function private.touch_customer_message_template()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

create trigger customer_message_templates_touch_updated_at
before update on public.customer_message_templates
for each row execute function private.touch_customer_message_template();

create function private.customer_message_template_valid(p_event_type text, p_template jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $function$
declare
  v_all_text text;
  v_key text;
  v_allowed text[] := array['business.name', 'customer.name', 'occurredAt', 'reference', 'currency'];
  v_required text[] := array['business.name', 'customer.name', 'occurredAt'];
begin
  if p_template is null or jsonb_typeof(p_template) <> 'object'
     or (select count(*) from jsonb_object_keys(p_template)) <> 4
     or not (p_template ?& array['schemaVersion', 'title', 'body', 'footer'])
     or p_template->>'schemaVersion' <> '1'
     or jsonb_typeof(p_template->'title') <> 'string'
     or jsonb_typeof(p_template->'body') <> 'string'
     or jsonb_typeof(p_template->'footer') <> 'string'
     or length(btrim(p_template->>'title')) = 0
     or length(btrim(p_template->>'body')) = 0
     or length(p_template->>'title') > 100
     or length(p_template->>'body') > 5000
     or length(p_template->>'footer') > 500 then
    return false;
  end if;

  v_allowed := v_allowed || case p_event_type
    when 'sale_paid' then array['sale.items', 'sale.total', 'sale.receivedAmount', 'sale.balanceDue', 'sale.paymentMethodLabel', 'sale.dueDate', 'sale.creditStatus']
    when 'sale_credit' then array['sale.items', 'sale.total', 'sale.receivedAmount', 'sale.balanceDue', 'sale.paymentMethodLabel', 'sale.dueDate', 'sale.creditStatus']
    when 'payment_partial' then array['payment.amount', 'payment.previousBalance', 'payment.newBalance', 'payment.methodLabel', 'payment.reference']
    when 'account_settled' then array['payment.amount', 'payment.previousBalance', 'payment.newBalance', 'payment.methodLabel', 'payment.reference']
    when 'account_statement' then array['account.totalBalance', 'account.totalPayments', 'account.cutoffAt', 'account.pendingNotes']
    when 'debt_reminder' then array['account.totalBalance', 'account.cutoffAt', 'account.pendingNotes']
    when 'layaway_created' then array['layaway.reference', 'layaway.total', 'layaway.initialPayment', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status']
    when 'layaway_payment' then array['layaway.reference', 'layaway.paymentAmount', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status']
    when 'layaway_settled' then array['layaway.reference', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status']
    when 'layaway_delivered' then array['layaway.reference', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.deadline', 'layaway.status', 'layaway.saleFolio']
    when 'layaway_cancelled' then array['layaway.reference', 'layaway.total', 'layaway.totalPaid', 'layaway.balanceDue', 'layaway.status']
    else array[]::text[] end;
  v_required := v_required || case p_event_type
    when 'sale_paid' then array['sale.total', 'sale.paymentMethodLabel']
    when 'sale_credit' then array['sale.total', 'sale.balanceDue', 'sale.paymentMethodLabel']
    when 'payment_partial' then array['payment.amount', 'payment.newBalance', 'payment.methodLabel']
    when 'account_settled' then array['payment.amount', 'payment.newBalance', 'payment.methodLabel']
    when 'account_statement' then array['account.totalBalance']
    when 'debt_reminder' then array['account.totalBalance']
    when 'layaway_created' then array['layaway.reference', 'layaway.total', 'layaway.initialPayment', 'layaway.balanceDue']
    when 'layaway_payment' then array['layaway.reference', 'layaway.paymentAmount', 'layaway.totalPaid', 'layaway.balanceDue']
    when 'layaway_settled' then array['layaway.reference', 'layaway.totalPaid', 'layaway.balanceDue']
    when 'layaway_delivered' then array['layaway.reference', 'layaway.saleFolio']
    when 'layaway_cancelled' then array['layaway.reference', 'layaway.status']
    else array[]::text[] end;
  if p_event_type = 'debt_reminder' then
    v_required := array['business.name', 'customer.name', 'account.totalBalance'];
  end if;

  v_all_text := coalesce(p_template->>'title', '') || E'\n' || coalesce(p_template->>'body', '') || E'\n' || coalesce(p_template->>'footer', '');
  if v_all_text ~* '<[[:alpha:]][^>]*>|javascript[[:space:]]*:|data[[:space:]]*:[[:space:]]*text/html|https?://|\\mwww\\.'
     or v_all_text ~ '([$€£][[:space:]]*[0-9]|\\m[0-9]+([,.][0-9]{2})\\M)'
     or regexp_replace(v_all_text, '\\{\\{[^}]*\\}\\}', '', 'g') ~ '[{}]'
     or (select count(*) from regexp_matches(v_all_text, '\\{\\{([^}]*)\\}\\}', 'g')) > 60
     or (length(v_all_text) - length(replace(v_all_text, E'\n', '')) + 3) > 160 then
    return false;
  end if;

  for v_key in select match[1] from regexp_matches(v_all_text, '\\{\\{([^}]*)\\}\\}', 'g') as match loop
    if not (v_key = any(v_allowed)) then return false; end if;
  end loop;
  foreach v_key in array v_required loop
    if position('{{' || v_key || '}}' in v_all_text) = 0 then return false; end if;
  end loop;
  return true;
end;
$function$;

create function private.customer_message_template_context(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_actor_session_token text, p_write boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token);
  if coalesce((v_context->'features'->>'customerMessageTemplates')::boolean, false) is not true then
    raise exception 'TEMPLATE_FEATURE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  if p_write and v_context->>'actor_type' <> 'admin' then
    raise exception 'TEMPLATE_ADMIN_REQUIRED' using errcode = 'P0001';
  end if;
  return v_context;
end;
$function$;

create function public.list_customer_message_templates(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_actor_session_token text
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb; v_license_id uuid; v_templates jsonb;
begin
  v_context := private.customer_message_template_context(p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token, false);
  v_license_id := (v_context->>'license_id')::uuid;
  select coalesce(jsonb_agg(jsonb_build_object('event_type', event_type, 'channel', channel, 'template_json', template_json, 'schema_version', schema_version, 'revision', revision, 'updated_at', updated_at) order by event_type), '[]'::jsonb)
  into v_templates from public.customer_message_templates where license_id = v_license_id;
  return jsonb_build_object('success', true, 'templates', v_templates);
exception when others then return jsonb_build_object('success', false, 'code', coalesce(nullif(sqlerrm, ''), 'TEMPLATE_LIST_FAILED'));
end;
$function$;

create function public.save_customer_message_template(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_actor_session_token text,
  p_event_type text, p_template_json jsonb, p_expected_revision integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb; v_license_id uuid; v_actor_id uuid; v_current integer; v_row public.customer_message_templates%rowtype;
begin
  v_context := private.customer_message_template_context(p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token, true);
  if not private.customer_message_template_valid(p_event_type, p_template_json) then return jsonb_build_object('success', false, 'code', 'TEMPLATE_INVALID'); end if;
  v_license_id := (v_context->>'license_id')::uuid; v_actor_id := (v_context->>'actor_id')::uuid;
  select revision into v_current from public.customer_message_templates where license_id = v_license_id and event_type = p_event_type and channel = 'image' for update;
  if v_current is not null and coalesce(p_expected_revision, 0) <> v_current then return jsonb_build_object('success', false, 'code', 'TEMPLATE_CONFLICT'); end if;
  if v_current is null and coalesce(p_expected_revision, 0) <> 0 then return jsonb_build_object('success', false, 'code', 'TEMPLATE_CONFLICT'); end if;
  if v_current is null then
    insert into public.customer_message_templates (license_id, event_type, channel, template_json, schema_version, revision, updated_by)
    values (v_license_id, p_event_type, 'image', p_template_json, 1, 1, v_actor_id) returning * into v_row;
  else
    update public.customer_message_templates set template_json = p_template_json, schema_version = 1, revision = revision + 1, updated_by = v_actor_id
    where license_id = v_license_id and event_type = p_event_type and channel = 'image' returning * into v_row;
  end if;
  return jsonb_build_object('success', true, 'template', jsonb_build_object('event_type', v_row.event_type, 'channel', v_row.channel, 'template_json', v_row.template_json, 'schema_version', v_row.schema_version, 'revision', v_row.revision, 'updated_at', v_row.updated_at));
exception when unique_violation then return jsonb_build_object('success', false, 'code', 'TEMPLATE_CONFLICT');
when others then return jsonb_build_object('success', false, 'code', coalesce(nullif(sqlerrm, ''), 'TEMPLATE_SAVE_FAILED'));
end;
$function$;

create function public.reset_customer_message_template(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_actor_session_token text,
  p_event_type text, p_expected_revision integer default 0
)
returns jsonb language plpgsql security definer set search_path = '' as $function$
declare v_context jsonb; v_license_id uuid; v_current integer;
begin
  v_context := private.customer_message_template_context(p_license_key, p_device_fingerprint, p_security_token, p_actor_session_token, true);
  v_license_id := (v_context->>'license_id')::uuid;
  select revision into v_current from public.customer_message_templates where license_id = v_license_id and event_type = p_event_type and channel = 'image' for update;
  if v_current is null then return jsonb_build_object('success', true, 'reset', true); end if;
  if coalesce(p_expected_revision, 0) <> v_current then return jsonb_build_object('success', false, 'code', 'TEMPLATE_CONFLICT'); end if;
  delete from public.customer_message_templates where license_id = v_license_id and event_type = p_event_type and channel = 'image';
  return jsonb_build_object('success', true, 'reset', true);
exception when others then return jsonb_build_object('success', false, 'code', coalesce(nullif(sqlerrm, ''), 'TEMPLATE_RESET_FAILED'));
end;
$function$;

revoke all on function public.list_customer_message_templates(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.save_customer_message_template(text,text,text,text,text,jsonb,integer) from public, anon, authenticated, service_role;
revoke all on function public.reset_customer_message_template(text,text,text,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.list_customer_message_templates(text,text,text,text) to anon, authenticated;
grant execute on function public.save_customer_message_template(text,text,text,text,text,jsonb,integer) to anon, authenticated;
grant execute on function public.reset_customer_message_template(text,text,text,text,text,integer) to anon, authenticated;

notify pgrst, 'reload schema';
