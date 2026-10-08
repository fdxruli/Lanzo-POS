-- Expose version changes and exact accepted legal documents to the active license device.
-- Legal acceptance records and legal document content remain inaccessible through direct table access.

create or replace function public.get_legal_policy_state(
  p_license_key text,
  p_device_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rate_limit jsonb;
  v_license_id uuid;
  v_license_key text := nullif(btrim(coalesce(p_license_key, '')), '');
  v_license_status text;
  v_license_expires_at timestamptz;
  v_device_fingerprint text := nullif(btrim(coalesce(p_device_fingerprint, '')), '');
  v_license_device_id uuid;
  v_pending_documents jsonb;
  v_accepted_documents jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := $1,
    p_device_fingerprint := $2,
    p_staff_session_token := null,
    p_rpc_name := 'get_legal_policy_state',
    p_scope := 'PROFILE',
    p_max_attempts := 60,
    p_window_seconds := 600,
    p_block_seconds := 600,
    p_code := 'AUTH_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
  end if;

  select l.id, l.status::text, l.expires_at
  into v_license_id, v_license_status, v_license_expires_at
  from public.licenses l
  where l.license_key = v_license_key
  limit 1;

  if v_license_id is null
    or v_license_status is distinct from 'active'
    or (v_license_expires_at is not null and v_license_expires_at < now()) then
    return jsonb_build_object('success', false, 'error', 'LICENSE_NOT_FOUND_OR_INACTIVE');
  end if;

  select d.id
  into v_license_device_id
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_fingerprint = v_device_fingerprint
    and d.is_active = true
  order by d.last_used_at desc nulls last, d.activated_at desc nulls last, d.id desc
  limit 1;

  if v_license_device_id is null then
    return jsonb_build_object('success', false, 'error', 'DEVICE_NOT_AUTHORIZED');
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'type', t.type,
        'version', t.version,
        'published_at', t.published_at
      )
      order by t.published_at desc, t.type::text
    ),
    '[]'::jsonb
  )
  into v_pending_documents
  from public.legal_terms t
  where t.is_active = true
    and not exists (
      select 1
      from public.legal_acceptances a
      where a.license_id = v_license_id
        and a.term_id = t.id
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'term_id', a.term_id,
        'term_type', a.term_type,
        'term_version', a.term_version,
        'term_published_at', a.term_published_at,
        'term_content_sha256', a.term_content_sha256,
        'accepted_at', a.accepted_at
      )
      order by a.accepted_at desc, a.term_type::text, a.term_version
    ),
    '[]'::jsonb
  )
  into v_accepted_documents
  from public.legal_acceptances a
  where a.license_id = v_license_id;

  return jsonb_build_object(
    'success', true,
    'pending_documents', v_pending_documents,
    'accepted_documents', v_accepted_documents
  );
end;
$function$;

create or replace function public.get_accepted_legal_document(
  p_license_key text,
  p_device_fingerprint text,
  p_term_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_rate_limit jsonb;
  v_license_id uuid;
  v_license_key text := nullif(btrim(coalesce(p_license_key, '')), '');
  v_license_status text;
  v_license_expires_at timestamptz;
  v_device_fingerprint text := nullif(btrim(coalesce(p_device_fingerprint, '')), '');
  v_license_device_id uuid;
  v_document jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := $1,
    p_device_fingerprint := $2,
    p_staff_session_token := null,
    p_rpc_name := 'get_accepted_legal_document',
    p_scope := 'PROFILE',
    p_max_attempts := 30,
    p_window_seconds := 600,
    p_block_seconds := 600,
    p_code := 'AUTH_RATE_LIMITED',
    p_metadata := '{}'::jsonb
  );

  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit)::jsonb;
  end if;

  select l.id, l.status::text, l.expires_at
  into v_license_id, v_license_status, v_license_expires_at
  from public.licenses l
  where l.license_key = v_license_key
  limit 1;

  if v_license_id is null
    or v_license_status is distinct from 'active'
    or (v_license_expires_at is not null and v_license_expires_at < now()) then
    return jsonb_build_object('success', false, 'error', 'LICENSE_NOT_FOUND_OR_INACTIVE');
  end if;

  select d.id
  into v_license_device_id
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_fingerprint = v_device_fingerprint
    and d.is_active = true
  order by d.last_used_at desc nulls last, d.activated_at desc nulls last, d.id desc
  limit 1;

  if v_license_device_id is null then
    return jsonb_build_object('success', false, 'error', 'DEVICE_NOT_AUTHORIZED');
  end if;

  select jsonb_build_object(
    'term_id', a.term_id,
    'type', a.term_type,
    'version', a.term_version,
    'published_at', a.term_published_at,
    'content_sha256', a.term_content_sha256,
    'content_html', t.content_html
  )
  into v_document
  from public.legal_acceptances a
  join public.legal_terms t on t.id = a.term_id
  where a.license_id = v_license_id
    and a.term_id = p_term_id
  limit 1;

  if v_document is null then
    return jsonb_build_object('success', false, 'error', 'ACCEPTED_DOCUMENT_NOT_FOUND');
  end if;

  return jsonb_build_object('success', true, 'document', v_document);
end;
$function$;

revoke all on function public.get_legal_policy_state(text, text) from public, anon, authenticated;
grant execute on function public.get_legal_policy_state(text, text) to anon, authenticated, service_role;

revoke all on function public.get_accepted_legal_document(text, text, uuid) from public, anon, authenticated;
grant execute on function public.get_accepted_legal_document(text, text, uuid) to anon, authenticated, service_role;

comment on function public.get_legal_policy_state(text, text) is
  'Returns pending active legal versions and acceptance history for a verified active license device.';
comment on function public.get_accepted_legal_document(text, text, uuid) is
  'Returns immutable legal content only when the supplied active license has accepted that exact version.';
