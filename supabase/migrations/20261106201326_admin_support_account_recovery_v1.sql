-- Additive support-assisted recovery for the existing custom owner identity.
-- No license, device, staff, commercial or local-storage changes.
create table private.admin_recovery_contacts (
  license_id uuid primary key references public.licenses(id),
  admin_user_id uuid not null unique,
  email text not null check (char_length(email) between 3 and 254),
  verified_at timestamptz not null default now(),
  foreign key (admin_user_id, license_id) references public.license_admin_users(id, license_id)
);

create table private.admin_recovery_challenges (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id),
  admin_user_id uuid not null,
  purpose text not null check (purpose in ('contact', 'password')),
  email text not null,
  request_session_id uuid references public.license_admin_sessions(id),
  requested_at timestamptz not null default now(),
  code_ref text unique,
  code_hash bytea,
  issued_at timestamptz,
  expires_at timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  consumed_at timestamptz,
  invalidated_at timestamptz,
  foreign key (admin_user_id, license_id) references public.license_admin_users(id, license_id),
  check ((code_hash is null) = (issued_at is null)),
  check (purpose <> 'contact' or request_session_id is not null)
);
create index admin_recovery_challenges_owner_idx
  on private.admin_recovery_challenges (license_id, admin_user_id, purpose, requested_at desc);

create table private.admin_recovery_audit (
  id bigint generated always as identity primary key,
  license_id uuid not null references public.licenses(id),
  admin_user_id uuid not null,
  challenge_id uuid references private.admin_recovery_challenges(id),
  action text not null,
  operator_name text,
  evidence_reference text,
  database_actor text not null default session_user,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (admin_user_id, license_id) references public.license_admin_users(id, license_id)
);
create index admin_recovery_audit_issue_idx
  on private.admin_recovery_audit (license_id, created_at desc) where action = 'code_issued';

alter table private.admin_recovery_contacts enable row level security;
alter table private.admin_recovery_challenges enable row level security;
alter table private.admin_recovery_audit enable row level security;
revoke all on private.admin_recovery_contacts, private.admin_recovery_challenges,
  private.admin_recovery_audit from public, anon, authenticated, service_role;
revoke all on sequence private.admin_recovery_audit_id_seq from public, anon, authenticated, service_role;

-- Every mutating recovery operation locks the license first, matching normal
-- admin login. This serializes issuance, attempts, reset and concurrent login.
create function public.admin_request_recovery_contact(
  p_license_key text, p_device_fingerprint text, p_device_security_token text,
  p_admin_session_token text, p_current_password text, p_email text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_auth jsonb; v_rate jsonb; v_owner public.license_admin_users%rowtype;
  v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if char_length(v_email) > 254 or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_EMAIL_INVALID');
  end if;
  perform 1 from public.licenses where license_key = p_license_key for update;
  v_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  v_rate := public.enforce_pos_rpc_rate_limit_v2(p_license_key, 'recovery-contact', null,
    'admin_request_recovery_contact', 'ADMIN_AUTH', 5, 900, 900, 'RECOVERY_RATE_LIMITED', '{}'::jsonb);
  if not coalesce((v_rate->>'allowed')::boolean, false) then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_RATE_LIMITED');
  end if;
  select * into v_owner from public.license_admin_users
    where id = (v_auth->>'admin_user_id')::uuid and license_id = (v_auth->>'license_id')::uuid for update;
  if p_current_password is null or extensions.crypt(p_current_password, v_owner.password_hash) <> v_owner.password_hash then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_REAUTH_REQUIRED');
  end if;
  if exists (select 1 from private.admin_recovery_contacts where license_id = v_owner.license_id) then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_CONTACT_ALREADY_VERIFIED');
  end if;
  update private.admin_recovery_challenges set invalidated_at = clock_timestamp()
    where license_id = v_owner.license_id and purpose = 'contact' and consumed_at is null and invalidated_at is null;
  insert into private.admin_recovery_challenges (license_id, admin_user_id, purpose, email, request_session_id)
    values (v_owner.license_id, v_owner.id, 'contact', v_email, (v_auth->>'admin_session_id')::uuid) returning id into v_id;
  insert into private.admin_recovery_audit (license_id, admin_user_id, challenge_id, action)
    values (v_owner.license_id, v_owner.id, v_id, 'contact_requested_with_password');
  return jsonb_build_object('success', true, 'request_id', v_id, 'email', v_email);
end;
$$;

create function public.admin_recovery_contact_status(
  p_license_key text, p_device_fingerprint text, p_device_security_token text, p_admin_session_token text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auth jsonb; v_contact jsonb; v_pending jsonb;
begin
  v_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  select jsonb_build_object('email', email, 'verified_at', verified_at) into v_contact
    from private.admin_recovery_contacts where license_id = (v_auth->>'license_id')::uuid and admin_user_id = (v_auth->>'admin_user_id')::uuid;
  select jsonb_build_object('request_id', id, 'email', email, 'requested_at', requested_at, 'expires_at', expires_at) into v_pending
    from private.admin_recovery_challenges where license_id = (v_auth->>'license_id')::uuid
      and admin_user_id = (v_auth->>'admin_user_id')::uuid and purpose = 'contact'
      and invalidated_at is null and consumed_at is null and requested_at > clock_timestamp() - interval '24 hours'
    order by requested_at desc limit 1;
  return jsonb_build_object('success', true, 'contact', v_contact, 'pending', v_pending);
end;
$$;

-- SQL Editor only. SECURITY INVOKER and no API-role grants: possessing a
-- service_role key is deliberately insufficient to issue recovery codes.
create function private.support_issue_admin_recovery_code(
  p_license_id uuid, p_purpose text, p_operator text, p_evidence_reference text,
  p_request_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_owner public.license_admin_users%rowtype;
  v_request private.admin_recovery_challenges%rowtype;
  v_email text; v_ref text; v_secret text; v_now timestamptz;
begin
  if p_purpose is null or p_purpose not in ('contact', 'password')
    or char_length(btrim(coalesce(p_operator, ''))) not between 3 and 160
    or char_length(btrim(coalesce(p_evidence_reference, ''))) not between 10 and 500 then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_OPERATOR_EVIDENCE_REQUIRED');
  end if;
  perform 1 from public.licenses where id = p_license_id for update;
  v_now := clock_timestamp();
  select * into v_owner from public.license_admin_users
    where license_id = p_license_id and is_owner and is_active for update;
  if v_owner.id is null then return jsonb_build_object('success', false, 'code', 'RECOVERY_OWNER_UNAVAILABLE'); end if;
  if (select count(*) from private.admin_recovery_audit where license_id = p_license_id
      and action = 'code_issued' and created_at > v_now - interval '1 hour') >= 3
    or (select count(*) from private.admin_recovery_audit where license_id = p_license_id
      and action = 'code_issued' and created_at > v_now - interval '1 day') >= 5
    or exists (select 1 from private.admin_recovery_audit where license_id = p_license_id
      and action = 'code_issued' and created_at > v_now - interval '60 seconds') then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_RATE_LIMITED');
  end if;
  if p_purpose = 'contact' then
    if exists (select 1 from private.admin_recovery_contacts where license_id = p_license_id) then
      return jsonb_build_object('success', false, 'code', 'RECOVERY_CONTACT_ALREADY_VERIFIED');
    end if;
    select c.* into v_request from private.admin_recovery_challenges c
      join public.license_admin_sessions s on s.id = c.request_session_id
        and s.license_id = c.license_id and s.admin_user_id = c.admin_user_id
      join public.license_devices d on d.id = s.device_id and d.license_id = s.license_id
      where c.id = p_request_id and c.license_id = p_license_id and c.admin_user_id = v_owner.id
        and c.purpose = 'contact' and c.consumed_at is null and c.invalidated_at is null
        and c.requested_at > v_now - interval '24 hours'
        and s.revoked_at is null and s.expires_at > v_now and d.is_active and d.device_mode in ('admin_only', 'shared')
      for update of c;
    if v_request.id is null then return jsonb_build_object('success', false, 'code', 'RECOVERY_VERIFIED_REQUEST_REQUIRED'); end if;
    v_email := v_request.email;
  else
    select email into v_email from private.admin_recovery_contacts
      where license_id = p_license_id and admin_user_id = v_owner.id;
    if v_email is null then return jsonb_build_object('success', false, 'code', 'RECOVERY_VERIFIED_CONTACT_REQUIRED'); end if;
    insert into private.admin_recovery_challenges (license_id, admin_user_id, purpose, email)
      values (p_license_id, v_owner.id, 'password', v_email) returning * into v_request;
  end if;
  update private.admin_recovery_challenges set invalidated_at = v_now
    where license_id = p_license_id and purpose = p_purpose and id <> v_request.id
      and consumed_at is null and invalidated_at is null;
  v_ref := encode(extensions.gen_random_bytes(6), 'hex');
  v_secret := encode(extensions.gen_random_bytes(16), 'hex');
  update private.admin_recovery_challenges set code_ref = v_ref,
    code_hash = extensions.digest(v_ref || v_secret, 'sha256'), issued_at = v_now,
    expires_at = v_now + interval '15 minutes', failed_attempts = 0
    where id = v_request.id;
  insert into private.admin_recovery_audit (license_id, admin_user_id, challenge_id, action, operator_name, evidence_reference)
    values (p_license_id, v_owner.id, v_request.id, 'code_issued', btrim(p_operator), btrim(p_evidence_reference));
  return jsonb_build_object('success', true, 'request_id', v_request.id, 'delivery_email', v_email,
    'code', v_ref || '-' || v_secret, 'expires_at', v_now + interval '15 minutes');
end;
$$;

-- Private shared verifier. All successful effects remain in the caller's
-- transaction; a later failure rolls consumption and credential changes back.
create function private.check_admin_recovery_code(
  p_license_key text, p_purpose text, p_code text, p_request_session_id uuid default null
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_license_id uuid; v_owner_id uuid; v_now timestamptz;
  v_code text := lower(regexp_replace(left(coalesce(p_code, ''), 256), '[[:space:]-]', '', 'g'));
  v_challenge private.admin_recovery_challenges%rowtype;
begin
  if v_code !~ '^[a-f0-9]{44}$' then return jsonb_build_object('success', false, 'code', 'RECOVERY_CODE_INVALID'); end if;
  select id into v_license_id from public.licenses where license_key = p_license_key for update;
  v_now := clock_timestamp();
  select id into v_owner_id from public.license_admin_users where license_id = v_license_id and is_owner and is_active for update;
  select * into v_challenge from private.admin_recovery_challenges
    where code_ref = left(v_code, 12) and license_id = v_license_id
      and admin_user_id = v_owner_id and purpose = p_purpose for update;
  if v_challenge.id is null then return jsonb_build_object('success', false, 'code', 'RECOVERY_CODE_INVALID'); end if;
  if v_challenge.failed_attempts >= 5 then return jsonb_build_object('success', false, 'code', 'RECOVERY_ATTEMPTS_EXHAUSTED'); end if;
  if extensions.digest(v_code, 'sha256') <> v_challenge.code_hash then
    update private.admin_recovery_challenges set failed_attempts = failed_attempts + 1 where id = v_challenge.id;
    insert into private.admin_recovery_audit (license_id, admin_user_id, challenge_id, action)
      values (v_license_id, v_owner_id, v_challenge.id, 'code_rejected');
    return jsonb_build_object('success', false, 'code', case when v_challenge.failed_attempts = 4
      then 'RECOVERY_ATTEMPTS_EXHAUSTED' else 'RECOVERY_CODE_INVALID' end);
  end if;
  if v_challenge.consumed_at is not null then return jsonb_build_object('success', false, 'code', 'RECOVERY_CODE_USED'); end if;
  if v_challenge.invalidated_at is not null then return jsonb_build_object('success', false, 'code', 'RECOVERY_CODE_INVALID'); end if;
  if v_challenge.expires_at <= v_now then return jsonb_build_object('success', false, 'code', 'RECOVERY_CODE_EXPIRED'); end if;
  if p_purpose = 'contact' and v_challenge.request_session_id is distinct from p_request_session_id then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_REQUEST_SESSION_REQUIRED');
  end if;
  return jsonb_build_object('success', true, 'license_id', v_license_id, 'admin_user_id', v_owner_id,
    'challenge_id', v_challenge.id, 'email', v_challenge.email);
end;
$$;

create function public.admin_confirm_recovery_contact(
  p_license_key text, p_device_fingerprint text, p_device_security_token text, p_admin_session_token text, p_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_auth jsonb; v_result jsonb;
begin
  perform 1 from public.licenses where license_key = p_license_key for update;
  v_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_device_security_token, p_admin_session_token);
  if coalesce((v_auth->>'success')::boolean, false) is false then return v_auth; end if;
  if exists (select 1 from private.admin_recovery_contacts where license_id = (v_auth->>'license_id')::uuid) then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_CONTACT_ALREADY_VERIFIED');
  end if;
  v_result := private.check_admin_recovery_code(p_license_key, 'contact', p_code, (v_auth->>'admin_session_id')::uuid);
  if coalesce((v_result->>'success')::boolean, false) is false then return v_result; end if;
  update private.admin_recovery_challenges set consumed_at = clock_timestamp() where id = (v_result->>'challenge_id')::uuid;
  insert into private.admin_recovery_contacts (license_id, admin_user_id, email)
    values ((v_result->>'license_id')::uuid, (v_result->>'admin_user_id')::uuid, v_result->>'email');
  insert into private.admin_recovery_audit (license_id, admin_user_id, challenge_id, action)
    values ((v_result->>'license_id')::uuid, (v_result->>'admin_user_id')::uuid, (v_result->>'challenge_id')::uuid, 'contact_verified');
  return jsonb_build_object('success', true, 'email', v_result->>'email');
end;
$$;

create function public.admin_redeem_password_recovery(p_license_key text, p_code text, p_new_password text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_result jsonb; v_owner public.license_admin_users%rowtype; v_now timestamptz;
begin
  if p_new_password is null or char_length(p_new_password) < 8 or octet_length(p_new_password) > 72
    or p_new_password !~ '[A-Za-z]' or p_new_password !~ '[0-9]' then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_PASSWORD_WEAK');
  end if;
  v_result := private.check_admin_recovery_code(p_license_key, 'password', p_code);
  if coalesce((v_result->>'success')::boolean, false) is false then return v_result; end if;
  v_now := clock_timestamp();
  select * into v_owner from public.license_admin_users where id = (v_result->>'admin_user_id')::uuid;
  if extensions.crypt(p_new_password, v_owner.password_hash) = v_owner.password_hash then
    return jsonb_build_object('success', false, 'code', 'RECOVERY_PASSWORD_UNCHANGED');
  end if;
  update private.admin_recovery_challenges set consumed_at = v_now where id = (v_result->>'challenge_id')::uuid;
  update public.license_admin_users set password_hash = extensions.crypt(p_new_password, extensions.gen_salt('bf', 12)),
    password_changed_at = v_now, updated_at = v_now where id = v_owner.id and license_id = v_owner.license_id;
  update public.license_admin_sessions set revoked_at = v_now,
    metadata = metadata || jsonb_build_object('revoked_reason', 'SUPPORT_PASSWORD_RECOVERY')
    where license_id = v_owner.license_id and admin_user_id = v_owner.id and revoked_at is null;
  update private.admin_recovery_challenges set invalidated_at = v_now
    where license_id = v_owner.license_id and admin_user_id = v_owner.id and consumed_at is null and invalidated_at is null;
  insert into private.admin_recovery_audit (license_id, admin_user_id, challenge_id, action)
    values (v_owner.license_id, v_owner.id, (v_result->>'challenge_id')::uuid, 'password_recovered_sessions_revoked');
  return jsonb_build_object('success', true, 'username', v_owner.username);
end;
$$;

revoke all on function private.support_issue_admin_recovery_code(uuid,text,text,text,uuid),
  private.check_admin_recovery_code(text,text,text,uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_request_recovery_contact(text,text,text,text,text,text),
  public.admin_recovery_contact_status(text,text,text,text),
  public.admin_confirm_recovery_contact(text,text,text,text,text),
  public.admin_redeem_password_recovery(text,text,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_request_recovery_contact(text,text,text,text,text,text),
  public.admin_recovery_contact_status(text,text,text,text),
  public.admin_confirm_recovery_contact(text,text,text,text,text),
  public.admin_redeem_password_recovery(text,text,text) to anon, authenticated;

comment on function private.support_issue_admin_recovery_code(uuid,text,text,text,uuid) is
  'SQL Editor only. Verify backend request or registered contact, record operator/evidence, deliver code ONLY to delivery_email. Never log/store plaintext code.';
notify pgrst, 'reload schema';
