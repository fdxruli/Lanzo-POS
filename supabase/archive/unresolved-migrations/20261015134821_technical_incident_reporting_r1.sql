-- Technical incident reports are separate from commercial support tickets.
-- The table stays in `private`; browser clients can only call the narrow RPC.

create table if not exists private.technical_incident_reports (
  id uuid primary key default gen_random_uuid(),
  license_id uuid not null references public.licenses(id) on delete cascade,
  incident_id uuid not null,
  correlation_id uuid not null,
  fingerprint text not null,
  request_digest text not null,
  source text not null,
  category text not null,
  severity text not null,
  safe_code text not null,
  module text not null,
  safe_route text not null,
  app_version text not null,
  build_commit text not null,
  browser_family text not null,
  platform text not null,
  network_status text not null,
  recovery_status text not null,
  occurred_at timestamptz not null,
  user_description text,
  consented_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  status text not null default 'received' check (status = 'received'),
  constraint technical_incident_reports_idempotency_unique unique (license_id, incident_id),
  constraint technical_incident_reports_fingerprint_check check (fingerprint ~ '^v1-[a-f0-9]{32}$'),
  constraint technical_incident_reports_severity_check check (severity in ('recoverable', 'section_failure', 'critical_blocker')),
  constraint technical_incident_reports_category_check check (category in (
    'react_render', 'navigation_resource', 'indexeddb', 'pwa', 'authorization_session',
    'supabase_rpc', 'synchronization', 'financial_operation', 'connectivity', 'unknown'
  )),
  constraint technical_incident_reports_source_check check (source in (
    'react_boundary', 'global_error', 'unhandled_rejection', 'navigation_resource',
    'indexeddb', 'pwa', 'synchronization', 'backend_service', 'module_exception'
  )),
  constraint technical_incident_reports_user_description_length check (
    user_description is null or char_length(user_description) <= 500
  )
);

alter table private.technical_incident_reports enable row level security;
revoke all on table private.technical_incident_reports from public, anon, authenticated, service_role;
drop policy if exists technical_incident_reports_owner_access on private.technical_incident_reports;
create policy technical_incident_reports_owner_access
  on private.technical_incident_reports
  for all
  to postgres
  using (true)
  with check (true);

create index if not exists technical_incident_reports_license_received_idx
  on private.technical_incident_reports (license_id, received_at desc);
create index if not exists technical_incident_reports_expiry_idx
  on private.technical_incident_reports (expires_at);

comment on table private.technical_incident_reports is
  'User-confirmed technical diagnostics, independent from paid support tickets; expires after 90 days.';
comment on column private.technical_incident_reports.user_description is
  'Optional user-authored text. It is length-limited but is not automatically sanitized.';
comment on column private.technical_incident_reports.request_digest is
  'Internal idempotency comparison only; never returned by the RPC.';

create or replace function public.submit_technical_incident_report(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_incident jsonb,
  p_consent boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_incident_id uuid;
  v_correlation_id uuid;
  v_fingerprint text;
  v_source text;
  v_category text;
  v_severity text;
  v_safe_code text;
  v_module text;
  v_safe_route text;
  v_app_version text;
  v_build_commit text;
  v_browser_family text;
  v_platform text;
  v_network_status text;
  v_recovery_status text;
  v_occurred_at timestamptz;
  v_user_description text;
  v_expected_module text;
  v_request_digest text;
  v_existing private.technical_incident_reports%rowtype;
  v_report_id uuid;
  v_recent_count integer;
  v_allowed_keys text[] := array[
    'app_version', 'browser_family', 'build_commit', 'category', 'correlation_id',
    'fingerprint', 'incident_id', 'module', 'network_status', 'occurred_at', 'platform',
    'recovery_status', 'safe_code', 'safe_route', 'schema_version', 'severity', 'source',
    'user_description'
  ];
  v_supplied_keys text[];
  v_sqlstate text;
begin
  if coalesce(p_consent, false) is not true then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_CONSENT_REQUIRED');
  end if;

  if p_incident is null
     or pg_catalog.jsonb_typeof(p_incident) is distinct from 'object'
     or pg_catalog.octet_length(p_incident::text) > 10000 then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end if;

  select coalesce(array_agg(key order by key), array[]::text[])
  into v_supplied_keys
  from pg_catalog.jsonb_object_keys(p_incident) as keys(key);

  if v_supplied_keys is distinct from v_allowed_keys
     or p_incident->>'schema_version' is distinct from '1' then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_SCHEMA_UNSUPPORTED');
  end if;

  if coalesce(p_incident->>'incident_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_incident->>'correlation_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     or coalesce(p_incident->>'fingerprint', '') !~ '^v1-[a-f0-9]{32}$'
     or coalesce(p_incident->>'source', '') not in (
       'react_boundary', 'global_error', 'unhandled_rejection', 'navigation_resource',
       'indexeddb', 'pwa', 'synchronization', 'backend_service', 'module_exception'
     )
     or coalesce(p_incident->>'category', '') not in (
       'react_render', 'navigation_resource', 'indexeddb', 'pwa', 'authorization_session',
       'supabase_rpc', 'synchronization', 'financial_operation', 'connectivity', 'unknown'
     )
     or coalesce(p_incident->>'severity', '') not in ('recoverable', 'section_failure', 'critical_blocker')
     or coalesce(p_incident->>'safe_code', '') !~ '^[A-Z][A-Z0-9_.-]{1,79}$'
     or coalesce(p_incident->>'safe_code', '') ~* '(TOKEN|JWT|LICENSE|PASSWORD|SECRET|FINGERPRINT|DEVICE|CUSTOMER|PHONE|EMAIL)'
     or coalesce(p_incident->>'recovery_status', '') not in (
       'detected', 'preserved', 'action_required', 'recovering', 'verified', 'failed', 'blocked'
     )
     or coalesce(p_incident->>'network_status', '') not in ('online', 'offline', 'unknown')
     or coalesce(p_incident->>'platform', '') not in ('Windows', 'macOS', 'Linux', 'Android', 'iOS', 'No disponible')
     or coalesce(p_incident->>'browser_family', '') !~ '^(Edge|Opera|Firefox|Chrome|Safari) [0-9]{1,3}$|^Navegador no identificado$'
     or coalesce(p_incident->>'app_version', '') !~ '^(No disponible|[0-9]{1,3}(\.[0-9]{1,3}){0,3}([-+][A-Za-z0-9.-]{1,20})?)$'
     or coalesce(p_incident->>'build_commit', '') !~ '^(No disponible|[A-Fa-f0-9]{7,40})$'
     or pg_catalog.jsonb_typeof(p_incident->'user_description') not in ('string', 'null') then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end if;

  v_safe_route := p_incident->>'safe_route';
  if v_safe_route not in (
    'inicio', 'otra sección', '/inicio', '/acerca-de', '/agentes-ia', '/caja', '/clientes',
    '/configuracion', '/dashboard', '/licencia', '/login', '/mesas', '/pedidos',
    '/pedidos-online', '/portal-online', '/pos', '/productos', '/renovacion-urgente', '/ventas'
  ) then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end if;

  v_expected_module := case
    when v_safe_route = 'inicio' then 'inicio'
    when v_safe_route = 'otra sección' then 'otra-seccion'
    else pg_catalog.substr(v_safe_route, 2)
  end;
  if p_incident->>'module' is distinct from v_expected_module then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end if;

  v_user_description := nullif(p_incident->>'user_description', '');
  if v_user_description is not null and pg_catalog.char_length(v_user_description) > 500 then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end if;

  begin
    v_incident_id := (p_incident->>'incident_id')::uuid;
    v_correlation_id := (p_incident->>'correlation_id')::uuid;
    v_occurred_at := (p_incident->>'occurred_at')::timestamptz;
  exception when others then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end;

  if v_occurred_at is null
     or v_occurred_at > now() + interval '5 minutes'
     or v_occurred_at < now() - interval '90 days' then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_INVALID');
  end if;

  begin
    v_context := private.validate_pos_sync_context(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token
    );
  exception when others then
    get stacked diagnostics v_sqlstate = returned_sqlstate;
    if v_sqlstate = 'P0001' then
      return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_AUTHORIZATION_FAILED');
    end if;
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_UNAVAILABLE');
  end;

  v_license_id := nullif(v_context->>'license_id', '')::uuid;
  if v_license_id is null then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_AUTHORIZATION_FAILED');
  end if;

  v_fingerprint := p_incident->>'fingerprint';
  v_source := p_incident->>'source';
  v_category := p_incident->>'category';
  v_severity := p_incident->>'severity';
  v_safe_code := p_incident->>'safe_code';
  v_module := p_incident->>'module';
  v_app_version := p_incident->>'app_version';
  v_build_commit := p_incident->>'build_commit';
  v_browser_family := p_incident->>'browser_family';
  v_platform := p_incident->>'platform';
  v_network_status := p_incident->>'network_status';
  v_recovery_status := p_incident->>'recovery_status';
  v_request_digest := pg_catalog.md5(p_incident::text);

  -- Serialize the low volume report path per license, so concurrent submissions
  -- cannot race around the bounded rate check. No payment operation is involved.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_license_id::text, 0));

  select * into v_existing
  from private.technical_incident_reports r
  where r.license_id = v_license_id
    and r.incident_id = v_incident_id
  limit 1;

  if found then
    if v_existing.request_digest is distinct from v_request_digest then
      return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'success', true,
      'report_reference', 'IR-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(v_existing.id::text, '-', ''), 1, 16)),
      'received_at', v_existing.received_at,
      'deduplicated', true
    );
  end if;

  select pg_catalog.count(*)::integer into v_recent_count
  from private.technical_incident_reports r
  where r.license_id = v_license_id
    and r.received_at >= now() - interval '1 hour';

  if v_recent_count >= 10 then
    return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_RATE_LIMITED');
  end if;

  insert into private.technical_incident_reports (
    license_id, incident_id, correlation_id, fingerprint, request_digest, source,
    category, severity, safe_code, module, safe_route, app_version, build_commit,
    browser_family, platform, network_status, recovery_status, occurred_at,
    user_description, consented_at, received_at, expires_at
  ) values (
    v_license_id, v_incident_id, v_correlation_id, v_fingerprint, v_request_digest, v_source,
    v_category, v_severity, v_safe_code, v_module, v_safe_route, v_app_version, v_build_commit,
    v_browser_family, v_platform, v_network_status, v_recovery_status, v_occurred_at,
    v_user_description, now(), now(), now() + interval '90 days'
  ) returning id into v_report_id;

  return jsonb_build_object(
    'success', true,
    'report_reference', 'IR-' || pg_catalog.upper(pg_catalog.substr(pg_catalog.replace(v_report_id::text, '-', ''), 1, 16)),
    'received_at', now(),
    'deduplicated', false
  );
exception when others then
  return jsonb_build_object('success', false, 'code', 'INCIDENT_REPORT_UNAVAILABLE');
end;
$function$;

revoke all on function public.submit_technical_incident_report(text, text, text, text, jsonb, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.submit_technical_incident_report(text, text, text, text, jsonb, boolean)
  to anon, authenticated;
comment on function public.submit_technical_incident_report(text, text, text, text, jsonb, boolean) is
  'Accepts user-confirmed, allowlisted technical diagnostics. Resolves tenant from the validated Lanzo license/device/actor context; does not require paid support capabilities.';

create or replace function private.purge_technical_incident_reports()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer := 0;
  v_batch integer := 0;
begin
  loop
    with expired as (
      select r.id
      from private.technical_incident_reports r
      where r.expires_at <= now()
      order by r.expires_at
      limit 1000
    )
    delete from private.technical_incident_reports r
    using expired e
    where r.id = e.id;

    get diagnostics v_batch = row_count;
    v_deleted := v_deleted + v_batch;
    exit when v_batch < 1000 or v_deleted >= 5000;
  end loop;
  return v_deleted;
end;
$function$;

revoke all on function private.purge_technical_incident_reports() from public, anon, authenticated, service_role;
comment on function private.purge_technical_incident_reports() is
  'Deletes up to 5000 expired technical incident reports per run; retention is 90 days.';

-- Schedule cleanup only when pg_cron is already installed. This migration does
-- not enable extensions or create a new Supabase project/branch.
do $schedule$
declare
  v_job_exists boolean;
begin
  if pg_catalog.to_regclass('cron.job') is null then
    raise notice 'pg_cron is unavailable; technical incident retention cleanup must be scheduled separately.';
    return;
  end if;

  execute 'select exists(select 1 from cron.job where jobname = $1)'
    into v_job_exists
    using 'technical-incident-report-retention-r1';

  if not coalesce(v_job_exists, false) then
    perform cron.schedule(
      'technical-incident-report-retention-r1',
      '40 3 * * *',
      'select private.purge_technical_incident_reports();'
    );
  end if;
end;
$schedule$;
