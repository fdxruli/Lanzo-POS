begin;
-- Support SQL only; additive case workflow around the v1 owner identity.
-- Installation does not modify existing contacts, passwords, sessions or plans.
create table private.admin_recovery_cases (
  id uuid primary key default extensions.gen_random_uuid(),
  license_id uuid not null references public.licenses(id),
  admin_user_id uuid not null,
  kind text not null check (kind in ('authenticated','exceptional','security_hold')),
  state text not null default 'open' check (state in ('open','approved','blocked','completed','cancelled')),
  new_email text check (char_length(new_email) between 3 and 254),
  old_email text,
  old_verified_at timestamptz,
  request_session_id uuid references public.license_admin_sessions(id),
  opened_by text not null,
  reason_reference text not null,
  evidence jsonb not null default '[]',
  approved_by text,
  approval_reference text,
  approved_at timestamptz,
  old_notice_reference text,
  new_challenge_id uuid references private.admin_recovery_challenges(id),
  old_challenge_id uuid references private.admin_recovery_challenges(id),
  new_verified_at timestamptz,
  old_confirmed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '7 days',
  not_before timestamptz not null,
  completed_at timestamptz,
  foreign key (admin_user_id,license_id) references public.license_admin_users(id,license_id),
  check (kind <> 'authenticated' or request_session_id is not null),
  check (kind='security_hold' or new_email is not null),
  check (kind<>'security_hold' or state in ('blocked','cancelled'))
);
create unique index admin_recovery_cases_one_active on private.admin_recovery_cases(license_id)
  where state in ('open','approved','blocked');
create index admin_recovery_cases_owner on private.admin_recovery_cases(admin_user_id,license_id);
create index admin_recovery_cases_session on private.admin_recovery_cases(request_session_id);
create index admin_recovery_cases_new_challenge on private.admin_recovery_cases(new_challenge_id);
create index admin_recovery_cases_old_challenge on private.admin_recovery_cases(old_challenge_id);
alter table private.admin_recovery_cases enable row level security;
revoke all on private.admin_recovery_cases from public,anon,authenticated,service_role;
alter table private.admin_recovery_audit add column case_id uuid references private.admin_recovery_cases(id);
create index admin_recovery_audit_case on private.admin_recovery_audit(case_id,created_at);
alter table private.admin_recovery_challenges drop constraint admin_recovery_challenges_purpose_check;
alter table private.admin_recovery_challenges add constraint admin_recovery_challenges_purpose_check
  check (purpose in ('contact','password','replacement_new','replacement_old'));

-- Structured human attestation, NOT automatic verification of external evidence.
-- Two different independently checked sources are required. Public commercial
-- details, screenshots, license keys and unverified historical emails don't qualify.
create function private.recovery_evidence_complete(p_evidence jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
  select case when jsonb_typeof(p_evidence) <> 'array' then false else
    (select count(*) >= 2 and count(distinct e->>'kind') >= 2 and bool_and(coalesce(
      e->>'kind' in ('provider_payment','prior_contract','prior_verified_channel','prior_ownership_record')
      and e->>'independently_checked' = 'true'
      and char_length(btrim(coalesce(e->>'reference',''))) between 10 and 500
      and char_length(btrim(coalesce(e->>'checked_against',''))) between 10 and 500
    ,false)) from jsonb_array_elements(p_evidence) e) end;
$$;

create function private.support_open_recovery_case(
  p_license_id uuid,p_new_email text,p_operator text,p_reason_reference text,p_evidence jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_id uuid; v_contact private.admin_recovery_contacts%rowtype;
  v_email text := lower(btrim(coalesce(p_new_email,'')));
begin
  if char_length(btrim(coalesce(p_operator,''))) not between 3 and 160
    or char_length(btrim(coalesce(p_reason_reference,''))) not between 10 and 500 then
    return jsonb_build_object('success',false,'code','RECOVERY_OPERATOR_EVIDENCE_REQUIRED'); end if;
  if not coalesce(private.recovery_evidence_complete(p_evidence),false) then
    return jsonb_build_object('success',false,'code','RECOVERY_INDEPENDENT_EVIDENCE_REQUIRED'); end if;
  if char_length(v_email)>254 or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' then
    return jsonb_build_object('success',false,'code','RECOVERY_EMAIL_INVALID'); end if;
  perform 1 from public.licenses where id=p_license_id for update;
  select id into v_owner from public.license_admin_users where license_id=p_license_id and is_owner and is_active for update;
  if v_owner is null then return jsonb_build_object('success',false,'code','RECOVERY_OWNER_UNAVAILABLE'); end if;
  if exists(select 1 from private.admin_recovery_cases where license_id=p_license_id and state in ('open','approved','blocked')) then
    return jsonb_build_object('success',false,'code','RECOVERY_CASE_ACTIVE'); end if;
  select * into v_contact from private.admin_recovery_contacts where license_id=p_license_id;
  if v_contact.email=v_email then return jsonb_build_object('success',false,'code','RECOVERY_EMAIL_UNCHANGED'); end if;
  insert into private.admin_recovery_cases(license_id,admin_user_id,kind,new_email,old_email,old_verified_at,
    opened_by,reason_reference,evidence,not_before)
    values(p_license_id,v_owner,'exceptional',v_email,v_contact.email,v_contact.verified_at,
      lower(btrim(p_operator)),btrim(p_reason_reference),p_evidence,clock_timestamp()+interval '48 hours') returning id into v_id;
  insert into private.admin_recovery_audit(license_id,admin_user_id,case_id,action,operator_name,evidence_reference)
    values(p_license_id,v_owner,v_id,'exceptional_case_opened',lower(btrim(p_operator)),btrim(p_reason_reference));
  return jsonb_build_object('success',true,'case_id',v_id,'next','Independent second review; verify mailbox; wait 48 hours');
end;
$$;

-- The only new client mutation. A Staff session or a stolen session alone is
-- insufficient: the existing real owner session AND current password are checked.
create function public.admin_request_recovery_contact_change(
  p_license_key text,p_device_fingerprint text,p_device_security_token text,
  p_admin_session_token text,p_current_password text,p_email text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_auth jsonb; v_rate jsonb; v_owner public.license_admin_users%rowtype;
  v_contact private.admin_recovery_contacts%rowtype; v_email text:=lower(btrim(coalesce(p_email,''))); v_id uuid;
begin
  if char_length(v_email)>254 or v_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$' then
    return jsonb_build_object('success',false,'code','RECOVERY_EMAIL_INVALID'); end if;
  perform 1 from public.licenses where license_key=p_license_key for update;
  v_auth:=private.require_active_admin_session(p_license_key,p_device_fingerprint,p_device_security_token,p_admin_session_token);
  if not coalesce((v_auth->>'success')::boolean,false) then return v_auth; end if;
  v_rate:=public.enforce_pos_rpc_rate_limit_v2(p_license_key,'recovery-contact',null,
    'admin_request_recovery_contact_change','ADMIN_AUTH',5,900,900,'RECOVERY_RATE_LIMITED','{}'::jsonb);
  if not coalesce((v_rate->>'allowed')::boolean,false) then
    return jsonb_build_object('success',false,'code','RECOVERY_RATE_LIMITED'); end if;
  select * into v_owner from public.license_admin_users where id=(v_auth->>'admin_user_id')::uuid
    and license_id=(v_auth->>'license_id')::uuid and is_owner and is_active for update;
  if v_owner.id is null or p_current_password is null or extensions.crypt(p_current_password,v_owner.password_hash)<>v_owner.password_hash then
    return jsonb_build_object('success',false,'code','RECOVERY_REAUTH_REQUIRED'); end if;
  select * into v_contact from private.admin_recovery_contacts where license_id=v_owner.license_id and admin_user_id=v_owner.id;
  if v_contact.email is null then return jsonb_build_object('success',false,'code','RECOVERY_VERIFIED_CONTACT_REQUIRED'); end if;
  if v_contact.email=v_email then return jsonb_build_object('success',false,'code','RECOVERY_EMAIL_UNCHANGED'); end if;
  if exists(select 1 from private.admin_recovery_cases where license_id=v_owner.license_id and state in ('open','approved','blocked')) then
    return jsonb_build_object('success',false,'code','RECOVERY_CASE_ACTIVE'); end if;
  insert into private.admin_recovery_cases(license_id,admin_user_id,kind,new_email,old_email,old_verified_at,request_session_id,
    opened_by,reason_reference,not_before)
    values(v_owner.license_id,v_owner.id,'authenticated',v_email,v_contact.email,v_contact.verified_at,
      (v_auth->>'admin_session_id')::uuid,'owner-session','Backend password and owner session verified',clock_timestamp()+interval '24 hours') returning id into v_id;
  insert into private.admin_recovery_audit(license_id,admin_user_id,case_id,action)
    values(v_owner.license_id,v_owner.id,v_id,'contact_change_requested_with_password');
  return jsonb_build_object('success',true,'case_id',v_id);
end;
$$;

-- Shared emission budget with v1; codes are hashed and never included in audit.
create function private.support_issue_recovery_case_code(p_case_id uuid,p_target text,p_operator text,p_reference text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_case private.admin_recovery_cases%rowtype; v_license uuid; v_email text;
  v_id uuid; v_ref text; v_secret text; v_now timestamptz;
begin
  if p_target is null or p_target not in ('new','old') or char_length(btrim(coalesce(p_operator,''))) not between 3 and 160
    or char_length(btrim(coalesce(p_reference,''))) not between 10 and 500 then
    return jsonb_build_object('success',false,'code','RECOVERY_OPERATOR_EVIDENCE_REQUIRED'); end if;
  select license_id into v_license from private.admin_recovery_cases where id=p_case_id;
  perform 1 from public.licenses where id=v_license for update;
  select * into v_case from private.admin_recovery_cases where id=p_case_id for update;
  v_now:=clock_timestamp();
  if v_case.id is null or v_case.state not in ('open','approved') or v_case.expires_at<=v_now then
    return jsonb_build_object('success',false,'code','RECOVERY_CASE_NOT_ACTIONABLE'); end if;
  if v_case.kind='exceptional' and v_case.state<>'approved' then
    return jsonb_build_object('success',false,'code','RECOVERY_SECOND_REVIEW_REQUIRED'); end if;
  v_email:=case when p_target='new' then v_case.new_email else v_case.old_email end;
  if v_email is null then return jsonb_build_object('success',false,'code','RECOVERY_VERIFIED_CONTACT_REQUIRED'); end if;
  if (p_target='new' and v_case.new_verified_at is not null) or (p_target='old' and v_case.old_confirmed_at is not null) then
    return jsonb_build_object('success',false,'code','RECOVERY_MAILBOX_ALREADY_VERIFIED'); end if;
  if exists(select 1 from private.admin_recovery_audit where license_id=v_license and action='code_issued' and created_at>v_now-interval '60 seconds')
    or (select count(*) from private.admin_recovery_audit where license_id=v_license and action='code_issued' and created_at>v_now-interval '1 hour')>=3
    or (select count(*) from private.admin_recovery_audit where license_id=v_license and action='code_issued' and created_at>v_now-interval '1 day')>=5 then
    return jsonb_build_object('success',false,'code','RECOVERY_RATE_LIMITED'); end if;
  -- Invalidate only this case/target's previous code, not a different account.
  update private.admin_recovery_challenges set invalidated_at=v_now
    where id=case when p_target='new' then v_case.new_challenge_id else v_case.old_challenge_id end and consumed_at is null;
  v_ref:=encode(extensions.gen_random_bytes(6),'hex'); v_secret:=encode(extensions.gen_random_bytes(16),'hex');
  insert into private.admin_recovery_challenges(license_id,admin_user_id,purpose,email,code_ref,code_hash,issued_at,expires_at)
    values(v_license,v_case.admin_user_id,'replacement_'||p_target,v_email,v_ref,extensions.digest(v_ref||v_secret,'sha256'),v_now,v_now+interval '15 minutes') returning id into v_id;
  update private.admin_recovery_cases set new_challenge_id=case when p_target='new' then v_id else new_challenge_id end,
    old_challenge_id=case when p_target='old' then v_id else old_challenge_id end where id=p_case_id;
  insert into private.admin_recovery_audit(license_id,admin_user_id,challenge_id,case_id,action,operator_name,evidence_reference)
    values(v_license,v_case.admin_user_id,v_id,p_case_id,'code_issued',lower(btrim(p_operator)),btrim(p_reference));
  return jsonb_build_object('success',true,'case_id',p_case_id,'target',p_target,'delivery_email',v_email,
    'code',v_ref||'-'||v_secret,'expires_at',v_now+interval '15 minutes');
end;
$$;

-- All support mutations go through this finite workflow. SQL administrators
-- attest external checks; free text alone never advances the exceptional case.
create function private.support_recovery_case_action(
  p_case_id uuid,p_action text,p_operator text,p_reference text,p_code text default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_case private.admin_recovery_cases%rowtype; v_license uuid; v_key text; v_result jsonb;
  v_contact private.admin_recovery_contacts%rowtype; v_now timestamptz; v_challenge uuid;
  v_operator text:=lower(btrim(coalesce(p_operator,'')));
begin
  if char_length(v_operator) not between 3 and 160 or char_length(btrim(coalesce(p_reference,''))) not between 10 and 500 then
    return jsonb_build_object('success',false,'code','RECOVERY_OPERATOR_EVIDENCE_REQUIRED'); end if;
  if p_action is null or p_action not in ('approve','notice','verify_new','verify_old','complete','block','cancel') then
    return jsonb_build_object('success',false,'code','RECOVERY_ACTION_INVALID'); end if;
  select license_id into v_license from private.admin_recovery_cases where id=p_case_id;
  select license_key into v_key from public.licenses where id=v_license for update;
  select * into v_case from private.admin_recovery_cases where id=p_case_id for update;
  v_now:=clock_timestamp();
  if v_case.id is null then return jsonb_build_object('success',false,'code','RECOVERY_CASE_NOT_ACTIONABLE'); end if;
  if v_case.state='completed' and p_action='complete' then
    return jsonb_build_object('success',true,'case_id',p_case_id,'state','completed','already_completed',true); end if;
  -- Expired/blocked cases must be explicitly cancelled; never silently reopen.
  if v_case.state in ('completed','cancelled') or
    (p_action<>'cancel' and (v_case.expires_at<=v_now or v_case.state='blocked')) then
    return jsonb_build_object('success',false,'code','RECOVERY_CASE_NOT_ACTIONABLE'); end if;
  if p_action='approve' then
    if v_case.kind<>'exceptional' or v_operator=v_case.opened_by then
      return jsonb_build_object('success',false,'code','RECOVERY_SECOND_REVIEW_REQUIRED'); end if;
    if not coalesce(private.recovery_evidence_complete(v_case.evidence),false) then
      return jsonb_build_object('success',false,'code','RECOVERY_INDEPENDENT_EVIDENCE_REQUIRED'); end if;
    if v_case.state='approved' then
      return jsonb_build_object('success',true,'case_id',p_case_id,'state','approved','already_approved',true); end if;
    update private.admin_recovery_cases set state='approved',approved_by=v_operator,approval_reference=btrim(p_reference),approved_at=v_now,
      not_before=greatest(not_before,v_now+interval '48 hours') where id=p_case_id;
  elsif p_action='notice' then
    -- Reference to actual attempted delivery to the snapshotted old mailbox;
    -- no old mailbox means the independent review explains missing history.
    update private.admin_recovery_cases set old_notice_reference=btrim(p_reference),
      not_before=case when old_notice_reference is null and kind='authenticated' then greatest(not_before,v_now+interval '24 hours') else not_before end
      where id=p_case_id;
  elsif p_action in ('verify_new','verify_old') then
    if v_case.kind='exceptional' and v_case.state<>'approved' then
      return jsonb_build_object('success',false,'code','RECOVERY_SECOND_REVIEW_REQUIRED'); end if;
    v_result:=private.check_admin_recovery_code(v_key,case when p_action='verify_new' then 'replacement_new' else 'replacement_old' end,p_code);
    if not coalesce((v_result->>'success')::boolean,false) then return v_result; end if;
    v_challenge:=(v_result->>'challenge_id')::uuid;
    if v_challenge is distinct from (case when p_action='verify_new' then v_case.new_challenge_id else v_case.old_challenge_id end) then
      return jsonb_build_object('success',false,'code','RECOVERY_CODE_INVALID'); end if;
    update private.admin_recovery_challenges set consumed_at=v_now where id=v_challenge;
    update private.admin_recovery_cases set new_verified_at=case when p_action='verify_new' then v_now else new_verified_at end,
      old_confirmed_at=case when p_action='verify_old' then v_now else old_confirmed_at end where id=p_case_id;
  elsif p_action='complete' then
    if v_case.new_verified_at is null then return jsonb_build_object('success',false,'code','RECOVERY_NEW_MAILBOX_REQUIRED'); end if;
    if v_case.old_email is not null and v_case.old_notice_reference is null then
      return jsonb_build_object('success',false,'code','RECOVERY_OLD_NOTICE_REQUIRED'); end if;
    if v_case.kind='exceptional' and (v_case.state<>'approved' or v_case.approved_by=v_case.opened_by) then
      return jsonb_build_object('success',false,'code','RECOVERY_SECOND_REVIEW_REQUIRED'); end if;
    if v_case.not_before>v_now and not (v_case.kind='authenticated' and v_case.old_confirmed_at is not null) then
      return jsonb_build_object('success',false,'code','RECOVERY_SAFETY_WAIT','not_before',v_case.not_before); end if;
    if not exists(select 1 from public.license_admin_users where id=v_case.admin_user_id and license_id=v_license and is_owner and is_active) then
      return jsonb_build_object('success',false,'code','RECOVERY_OWNER_UNAVAILABLE'); end if;
    if v_case.kind='authenticated' and not exists(select 1 from public.license_admin_sessions s
      join public.license_devices d on d.id=s.device_id and d.license_id=s.license_id
      where s.id=v_case.request_session_id and s.license_id=v_license and s.admin_user_id=v_case.admin_user_id
        and s.revoked_at is null and s.expires_at>v_now and d.is_active and d.device_mode in ('admin_only','shared')) then
      return jsonb_build_object('success',false,'code','RECOVERY_REQUEST_SESSION_REQUIRED'); end if;
    select * into v_contact from private.admin_recovery_contacts where license_id=v_license;
    if v_contact.email is distinct from v_case.old_email or v_contact.verified_at is distinct from v_case.old_verified_at
      or (v_contact.admin_user_id is not null and v_contact.admin_user_id<>v_case.admin_user_id) then
      return jsonb_build_object('success',false,'code','RECOVERY_CONTACT_CHANGED'); end if;
    insert into private.admin_recovery_contacts(license_id,admin_user_id,email,verified_at)
      values(v_license,v_case.admin_user_id,v_case.new_email,v_now)
      on conflict(license_id) do update set email=excluded.email,verified_at=excluded.verified_at;
    update private.admin_recovery_cases set state='completed',completed_at=v_now where id=p_case_id;
  elsif p_action='block' then
    update private.admin_recovery_cases set state='blocked' where id=p_case_id;
  elsif p_action='cancel' then
    update private.admin_recovery_cases set state='cancelled' where id=p_case_id;
  end if;
  if p_action in ('complete','block') then
    update public.license_admin_sessions set revoked_at=v_now,
      metadata=metadata||jsonb_build_object('revoked_reason','SUPPORT_CONTACT_'||upper(p_action))
      where license_id=v_license and admin_user_id=v_case.admin_user_id and revoked_at is null;
  end if;
  if p_action in ('complete','block','cancel') then
    update private.admin_recovery_challenges set invalidated_at=v_now
      where license_id=v_license and admin_user_id=v_case.admin_user_id and consumed_at is null and invalidated_at is null;
  end if;
  insert into private.admin_recovery_audit(license_id,admin_user_id,case_id,challenge_id,action,operator_name,evidence_reference)
    values(v_license,v_case.admin_user_id,p_case_id,v_challenge,'case_'||p_action,v_operator,btrim(p_reference));
  return jsonb_build_object('success',true,'case_id',p_case_id,'action',p_action,
    'state',(select state from private.admin_recovery_cases where id=p_case_id));
end;
$$;

-- A suspected compromise can be frozen without pretending that ownership has
-- already been proved. A security_hold can ONLY remain blocked or be cancelled;
-- it cannot be approved, issued a code, verified or completed.
create function private.support_block_admin_recovery(p_license_id uuid,p_operator text,p_reference text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_owner uuid; v_id uuid; v_case private.admin_recovery_cases%rowtype; v_contact private.admin_recovery_contacts%rowtype;
  v_operator text:=lower(btrim(coalesce(p_operator,''))); v_now timestamptz;
begin
  if char_length(v_operator) not between 3 and 160 or char_length(btrim(coalesce(p_reference,''))) not between 10 and 500 then
    return jsonb_build_object('success',false,'code','RECOVERY_OPERATOR_EVIDENCE_REQUIRED'); end if;
  perform 1 from public.licenses where id=p_license_id for update;
  v_now:=clock_timestamp();
  select id into v_owner from public.license_admin_users where license_id=p_license_id and is_owner and is_active for update;
  if v_owner is null then return jsonb_build_object('success',false,'code','RECOVERY_OWNER_UNAVAILABLE'); end if;
  select * into v_case from private.admin_recovery_cases where license_id=p_license_id and state in ('open','approved','blocked') for update;
  if v_case.state='blocked' then
    return jsonb_build_object('success',true,'case_id',v_case.id,'state','blocked','already_blocked',true); end if;
  if v_case.id is not null and v_case.expires_at>v_now then
    return private.support_recovery_case_action(v_case.id,'block',v_operator,p_reference); end if;
  -- Even an expired case may remain held for security review; never release it
  -- implicitly. Keep its history rather than deleting/replacing the case.
  if v_case.id is not null then
    v_id:=v_case.id;
    update private.admin_recovery_cases set state='blocked' where id=v_id;
  else
    select * into v_contact from private.admin_recovery_contacts where license_id=p_license_id;
    insert into private.admin_recovery_cases(license_id,admin_user_id,kind,state,new_email,old_email,old_verified_at,
      opened_by,reason_reference,not_before)
      values(p_license_id,v_owner,'security_hold','blocked',null,v_contact.email,v_contact.verified_at,
        v_operator,btrim(p_reference),'infinity'::timestamptz) returning id into v_id;
  end if;
  update public.license_admin_sessions set revoked_at=v_now,
    metadata=metadata||jsonb_build_object('revoked_reason','SUPPORT_SECURITY_HOLD')
    where license_id=p_license_id and admin_user_id=v_owner and revoked_at is null;
  update private.admin_recovery_challenges set invalidated_at=v_now
    where license_id=p_license_id and admin_user_id=v_owner and consumed_at is null and invalidated_at is null;
  insert into private.admin_recovery_audit(license_id,admin_user_id,case_id,action,operator_name,evidence_reference)
    values(p_license_id,v_owner,v_id,'case_block',v_operator,btrim(p_reference));
  return jsonb_build_object('success',true,'case_id',v_id,'state','blocked');
end;
$$;

-- Read-only operational surface. Explicit projections deliberately exclude all
-- password hashes, code hashes, device/session tokens and commercial contents.
create function private.support_find_recovery_accounts(p_search text)
returns table(license_id uuid,license_key text,business_name text,license_status text,expires_at timestamptz,
  owner_id uuid,owner_username text,recovery_email text,verified_at timestamptz,historical_email_unverified text)
language sql stable security invoker set search_path='' as $$
  select l.id,l.license_key::text,coalesce(b.business_name,l.organization_name,l.product_name)::text,l.status::text,l.expires_at,
    u.id,u.username,c.email,c.verified_at,l.owner_email
  from public.licenses l left join public.business_profiles b on b.license_id=l.id
  left join public.license_admin_users u on u.license_id=l.id and u.is_owner and u.is_active
  left join private.admin_recovery_contacts c on c.license_id=l.id and c.admin_user_id=u.id
  where char_length(btrim(coalesce(p_search,'')))>=3 and
    (l.id::text=btrim(p_search) or u.id::text=btrim(p_search) or lower(l.license_key)=lower(btrim(p_search))
      or position(lower(btrim(p_search)) in lower(coalesce(b.business_name,l.organization_name,l.product_name,'')))>0
      or lower(c.email)=lower(btrim(p_search)) or lower(l.owner_email)=lower(btrim(p_search))
      or exists(select 1 from public.subscriptions sub where sub.license_id=l.id and lower(sub.customer_email)=lower(btrim(p_search)))
      or exists(select 1 from private.admin_recovery_challenges h where h.license_id=l.id and h.consumed_at is not null
        and h.purpose in ('contact','replacement_new','replacement_old') and lower(h.email)=lower(btrim(p_search))))
  order by l.id limit 50;
$$;

create function private.support_recovery_status(p_license_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('account',to_jsonb(a),'cases',coalesce((select jsonb_agg(to_jsonb(c) order by c.created_at desc)
    from private.admin_recovery_cases c where c.license_id=a.license_id),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(jsonb_build_object('request_id',id,'purpose',purpose,'email',email,'requested_at',requested_at,
      'issued_at',issued_at,'expires_at',expires_at,'failed_attempts',failed_attempts,'consumed_at',consumed_at,'invalidated_at',invalidated_at))
      from private.admin_recovery_challenges where license_id=a.license_id),'[]'::jsonb),
    'active_admin_sessions',(select count(*) from public.license_admin_sessions where license_id=a.license_id and revoked_at is null and expires_at>now()),
    'active_devices',(select count(*) from public.license_devices where license_id=a.license_id and is_active),
    'subscription_references',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'provider_subscription_id',provider_subscription_id,
      'customer_email_unverified',customer_email,'status',status)) from public.subscriptions where license_id=a.license_id),'[]'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('id',id,'case_id',case_id,'challenge_id',challenge_id,'action',action,
      'operator',operator_name,'database_actor',database_actor,'reference',evidence_reference,'created_at',created_at) order by created_at desc)
      from private.admin_recovery_audit where license_id=a.license_id),'[]'::jsonb))
  from private.support_find_recovery_accounts(p_license_id::text) a;
$$;

-- ACL: no support helper/table is granted to any Data API role, including
-- service_role. Public RPCs use existing custom Admin authentication, not JWTs.
revoke all on function private.recovery_evidence_complete(jsonb),
  private.support_open_recovery_case(uuid,text,text,text,jsonb),
  private.support_issue_recovery_case_code(uuid,text,text,text),
  private.support_recovery_case_action(uuid,text,text,text,text),
  private.support_find_recovery_accounts(text),private.support_recovery_status(uuid),
  private.support_block_admin_recovery(uuid,text,text)
  from public,anon,authenticated,service_role;
revoke all on function public.admin_request_recovery_contact_change(text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_request_recovery_contact_change(text,text,text,text,text,text) to anon,authenticated;

-- v1 contract preserved; active support cases freeze normal recovery.
create or replace function private.support_issue_admin_recovery_code(
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
  if exists(select 1 from private.admin_recovery_cases where license_id=p_license_id and state in ('open','approved','blocked')) then
    return jsonb_build_object('success',false,'code','RECOVERY_SUPPORT_HOLD'); end if;
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

-- v1 contract preserved; active support cases freeze normal recovery.
create or replace function private.check_admin_recovery_code(
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
  -- Reveal a hold only after authenticating the random code, preserving v1's
  -- protection against status enumeration with a known license key.
  if p_purpose in ('contact','password') and exists(select 1 from private.admin_recovery_cases
    where license_id=v_license_id and state in ('open','approved','blocked')) then
    return jsonb_build_object('success',false,'code','RECOVERY_SUPPORT_HOLD'); end if;
  return jsonb_build_object('success', true, 'license_id', v_license_id, 'admin_user_id', v_owner_id,
    'challenge_id', v_challenge.id, 'email', v_challenge.email);
end;
$$;

-- v1 contract preserved; active support cases freeze normal recovery.
create or replace function public.admin_recovery_contact_status(
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
  return jsonb_build_object('success', true, 'contact', v_contact, 'pending', v_pending, 'pending_change',
    (select jsonb_build_object('case_id',id,'email',new_email,'state',state,'not_before',not_before,'expires_at',expires_at)
      from private.admin_recovery_cases where license_id=(v_auth->>'license_id')::uuid
        and admin_user_id=(v_auth->>'admin_user_id')::uuid and state in ('open','approved','blocked')));
end;
$$;

notify pgrst, 'reload schema';

commit;
