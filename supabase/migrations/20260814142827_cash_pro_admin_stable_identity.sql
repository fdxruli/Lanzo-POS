-- CASH PRO FASE 3: stable financial identity for authenticated administrators.
-- Device remains provenance/security data. It is never the financial owner.
begin;

alter table public.pos_cash_sessions
  add column if not exists admin_user_id uuid null references public.license_admin_users(id);

create index if not exists idx_pos_cash_sessions_license_admin_opened
  on public.pos_cash_sessions (license_id, admin_user_id, opened_at desc)
  where admin_user_id is not null and deleted_at is null;

create unique index if not exists ux_pos_cash_sessions_open_admin_identity
  on public.pos_cash_sessions (license_id, admin_user_id)
  where status = 'open' and deleted_at is null and admin_user_id is not null;

-- The historical fourth argument is the actor token. Keep its signature so
-- all existing POS callers remain compatible, but bind admin contexts to the
-- authenticated admin session rather than merely to an admin device.
create or replace function private.validate_pos_sync_context(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_license record;
  v_device record;
  v_session record;
  v_features jsonb;
  v_staff_payload jsonb := null;
  v_staff_user_id uuid := null;
  v_staff_permissions jsonb := '{}'::jsonb;
  v_admin_auth jsonb;
begin
  select l.id, l.license_key, l.status, l.expires_at,
         coalesce(p.code, l.license_type::text) as plan_code, p.name as plan_name,
         coalesce(p.features, '{}'::jsonb) as plan_features,
         coalesce(l.features, '{}'::jsonb) as license_features
    into v_license
    from public.licenses l left join public.plans p on p.id = l.plan_id
   where l.license_key = p_license_key limit 1;
  if v_license.id is null then raise exception 'LICENSE_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_license.status <> 'active' then raise exception 'LICENSE_NOT_ACTIVE' using errcode = 'P0001'; end if;
  if v_license.expires_at is not null and v_license.expires_at < now() then raise exception 'LICENSE_EXPIRED' using errcode = 'P0001'; end if;

  select d.id, d.license_id, d.device_fingerprint, d.security_token, d.previous_security_token, d.is_active,
         coalesce(d.device_role, 'staff') as device_role, d.staff_user_id, d.realtime_topic
    into v_device from public.license_devices d
   where d.license_id = v_license.id and d.device_fingerprint = p_device_fingerprint limit 1;
  if v_device.id is null then raise exception 'DEVICE_NOT_ALLOWED' using errcode = 'P0001'; end if;
  if v_device.is_active is not true then raise exception 'DEVICE_NOT_ACTIVE' using errcode = 'P0001'; end if;
  if v_device.security_token is null or nullif(p_security_token, '') is null then raise exception 'DEVICE_TOKEN_REQUIRED' using errcode = 'P0001'; end if;
  if p_security_token <> v_device.security_token and (v_device.previous_security_token is null or p_security_token <> v_device.previous_security_token) then
    raise exception 'DEVICE_TOKEN_INVALID' using errcode = 'P0001';
  end if;
  v_features := coalesce(v_license.plan_features, '{}'::jsonb) || coalesce(v_license.license_features, '{}'::jsonb);

  if v_device.device_role = 'staff' then
    if v_device.staff_user_id is null then raise exception 'STAFF_LOGIN_REQUIRED' using errcode = 'P0001'; end if;
    if nullif(p_staff_session_token, '') is null then raise exception 'STAFF_SESSION_REQUIRED' using errcode = 'P0001'; end if;
    select ss.id as session_id, ss.expires_at, s.id as staff_user_id, s.username, s.display_name, s.role_name,
           s.permissions, s.is_active as staff_is_active into v_session
      from public.license_staff_sessions ss join public.license_staff_users s on s.id = ss.staff_user_id
     where ss.license_id = v_license.id and ss.device_id = v_device.id and ss.staff_user_id = v_device.staff_user_id
       and ss.revoked_at is null and extensions.crypt(coalesce(p_staff_session_token, ''), ss.session_token_hash) = ss.session_token_hash limit 1;
    if not found then raise exception 'STAFF_SESSION_INVALID' using errcode = 'P0001'; end if;
    if v_session.expires_at < now() then raise exception 'STAFF_SESSION_EXPIRED' using errcode = 'P0001'; end if;
    if v_session.staff_is_active is not true then raise exception 'STAFF_USER_INACTIVE' using errcode = 'P0001'; end if;
    perform private.touch_license_staff_session_seen(v_session.session_id, '30 seconds'::interval);
    v_staff_user_id := v_session.staff_user_id;
    v_staff_permissions := coalesce(v_session.permissions, '{}'::jsonb);
    v_staff_payload := jsonb_build_object('id', v_session.staff_user_id, 'username', v_session.username,
      'display_name', v_session.display_name, 'role_name', v_session.role_name, 'permissions', v_staff_permissions);
  else
    v_admin_auth := private.require_active_admin_session(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
    if coalesce((v_admin_auth->>'success')::boolean, false) is not true then
      raise exception '%', coalesce(v_admin_auth->>'code', 'ADMIN_SESSION_REQUIRED') using errcode = 'P0001';
    end if;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'license_id', v_license.id, 'license_key', v_license.license_key, 'device_id', v_device.id,
    'device_role', v_device.device_role, 'staff_user_id', v_staff_user_id, 'staff_permissions', v_staff_permissions,
    'staff_user', v_staff_payload, 'admin_user_id', v_admin_auth->>'admin_user_id',
    'admin_session_id', v_admin_auth->>'admin_session_id', 'admin_user', v_admin_auth->'admin_user',
    'plan_code', v_license.plan_code, 'plan_name', v_license.plan_name, 'features', coalesce(v_features, '{}'::jsonb),
    'realtime_topic', v_device.realtime_topic
  ));
end;
$$;

create or replace function private.resolve_cash_actor_key(p_context jsonb)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_role text := coalesce(p_context->>'device_role', 'staff');
  v_staff_user_id uuid := nullif(p_context->>'staff_user_id', '')::uuid;
  v_admin_user_id uuid := nullif(p_context->>'admin_user_id', '')::uuid;
begin
  if v_role = 'staff' then
    if v_staff_user_id is null then raise exception 'STAFF_USER_REQUIRED_FOR_CASH' using errcode = 'P0001'; end if;
    return 'staff:' || v_staff_user_id::text;
  end if;
  if v_admin_user_id is null then raise exception 'ADMIN_SESSION_REQUIRED' using errcode = 'P0001'; end if;
  return 'admin:' || v_admin_user_id::text;
end;
$$;

create or replace function private.resolve_cash_actor_name(p_context jsonb)
returns text language plpgsql stable set search_path = '' as $$
declare v_name text;
begin
  if coalesce(p_context->>'device_role', 'staff') = 'staff' then
    v_name := nullif(btrim(coalesce(p_context->'staff_user'->>'display_name', p_context->'staff_user'->>'username', 'Staff')), '');
  else
    v_name := nullif(btrim(coalesce(p_context->'admin_user'->>'display_name', p_context->'admin_user'->>'username', 'Administrador')), '');
  end if;
  return coalesce(v_name, case when coalesce(p_context->>'device_role', 'staff') = 'staff' then 'Staff' else 'Administrador' end);
end;
$$;

create or replace function private.pos_cash_session_to_jsonb(p_session public.pos_cash_sessions)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_strip_nulls(to_jsonb(p_session) || jsonb_build_object(
    'cash_identity_state', case when p_session.admin_user_id is null and p_session.device_role = 'admin' then 'legacy' else 'canonical' end,
    'opening_device_id', p_session.opened_by_device_id
  ))
$$;

-- A current session deliberately never falls back to legacy device sessions.
-- Those records remain separately visible for an explicit audited adoption.
create or replace function public.pos_get_current_cash_session(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb; v_license_id uuid; v_actor_key text;
  v_session public.pos_cash_sessions; v_movements jsonb := '[]'::jsonb;
  v_admin_open_sessions jsonb := '[]'::jsonb; v_legacy jsonb := '[]'::jsonb;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context); perform private.assert_cash_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid; v_actor_key := private.resolve_cash_actor_key(v_context);
  select * into v_session from public.pos_cash_sessions s
   where s.license_id=v_license_id and s.actor_key=v_actor_key and s.status='open' and s.deleted_at is null limit 1;
  if v_session.id is not null then
    v_session := private.recalculate_pos_cash_session_totals(v_license_id, v_session.id, false);
    select coalesce(jsonb_agg(private.pos_cash_movement_to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
      into v_movements from public.pos_cash_movements m
     where m.license_id=v_license_id and m.cash_session_id=v_session.id and m.deleted_at is null;
  end if;
  if coalesce(v_context->>'device_role','staff') <> 'staff' then
    select coalesce(jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.opened_at desc), '[]'::jsonb) into v_admin_open_sessions
      from public.pos_cash_sessions s where s.license_id=v_license_id and s.status='open' and s.deleted_at is null;
    select coalesce(jsonb_agg(private.pos_cash_session_to_jsonb(s) order by s.opened_at desc), '[]'::jsonb) into v_legacy
      from public.pos_cash_sessions s where s.license_id=v_license_id and s.device_role='admin' and s.admin_user_id is null
        and s.actor_key like 'admin_device:%' and s.status='open' and s.deleted_at is null;
  end if;
  return jsonb_build_object('success',true,'cash_session',case when v_session.id is null then null else private.pos_cash_session_to_jsonb(v_session) end,
    'movements',v_movements,'admin_open_sessions',v_admin_open_sessions,'legacy_admin_cash_sessions',v_legacy,
    'actor_key',v_actor_key,'actor_name',private.resolve_cash_actor_name(v_context),
    'sync_context',jsonb_strip_nulls(jsonb_build_object('device_role',v_context->>'device_role','staff_user_id',v_context->>'staff_user_id','admin_user_id',v_context->>'admin_user_id','cloud_cash_sync',true)));
end;
$$;

-- Override only opening to persist the structured stable identity; all other
-- cash and sales consumers inherit the canonical resolver above.
create or replace function public.pos_open_cash_session(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text default null,
  p_opening jsonb default '{}'::jsonb, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb; v_license_id uuid; v_device_id uuid; v_staff_user_id uuid; v_admin_user_id uuid;
  v_role text; v_actor_key text; v_actor_name text; v_session public.pos_cash_sessions; v_existing public.pos_cash_sessions;
  v_event public.pos_sync_events; v_response jsonb; v_idem public.pos_idempotency_keys; v_inserted boolean;
  v_opening numeric; v_counted numeric; v_suggested numeric;
begin
  v_context := private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context); perform private.assert_cash_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid; v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id','')::uuid; v_admin_user_id := nullif(v_context->>'admin_user_id','')::uuid;
  v_role := coalesce(v_context->>'device_role','staff'); v_actor_key := private.resolve_cash_actor_key(v_context); v_actor_name := private.resolve_cash_actor_name(v_context);
  v_opening := greatest(coalesce(nullif(p_opening->>'opening_amount','')::numeric,nullif(p_opening->>'montoInicial','')::numeric,0),0);
  v_counted := greatest(coalesce(nullif(p_opening->>'opening_counted_amount','')::numeric,nullif(p_opening->>'montoContado','')::numeric,v_opening),0);
  v_suggested := greatest(coalesce(nullif(p_opening->>'opening_suggested_amount','')::numeric,nullif(p_opening->>'montoSugerido','')::numeric,0),0);
  v_inserted := private.insert_pos_idempotency_processing(v_license_id,p_idempotency_key,'cash.open','cash_session',null,null);
  if not v_inserted then
    select * into v_idem from public.pos_idempotency_keys where license_id=v_license_id and idempotency_key=p_idempotency_key limit 1;
    if v_idem.status='completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success',false,'code','IDEMPOTENCY_PROCESSING','idempotency_key',p_idempotency_key);
  end if;
  select * into v_existing from public.pos_cash_sessions s where s.license_id=v_license_id and s.actor_key=v_actor_key and s.status='open' and s.deleted_at is null limit 1;
  if v_existing.id is not null then
    v_response:=jsonb_build_object('success',false,'code','CASH_SESSION_ALREADY_OPEN','cash_session',private.pos_cash_session_to_jsonb(v_existing),'idempotency_key',p_idempotency_key);
    perform private.complete_pos_idempotency(v_license_id,p_idempotency_key,v_response); return v_response;
  end if;
  insert into public.pos_cash_sessions (id,license_id,device_id,staff_user_id,admin_user_id,device_role,scope,actor_key,status,opening_amount,opening_counted_amount,opening_suggested_amount,opening_difference,opening_policy,opening_origin,is_auto_opening,expected_cash_total,responsible_name,opened_by_device_id,opened_by_staff_user_id,last_idempotency_key,metadata)
  values ('cash_'||replace(gen_random_uuid()::text,'-',''),v_license_id,v_device_id,v_staff_user_id,v_admin_user_id,v_role,'actor',v_actor_key,'open',v_opening,v_counted,v_suggested,v_counted-v_suggested,
    nullif(btrim(coalesce(p_opening->>'opening_policy',p_opening->>'politicaApertura','manual')),''),nullif(btrim(coalesce(p_opening->>'opening_origin',p_opening->>'origen','manual')),''),coalesce((p_opening->>'is_auto_opening')::boolean,(p_opening->>'esAutoApertura')::boolean,false),v_opening,
    case when v_role='staff' then v_actor_name else coalesce(nullif(btrim(p_opening->>'responsible_name'),''),nullif(btrim(p_opening->>'responsable'),''),v_actor_name) end,v_device_id,v_staff_user_id,p_idempotency_key,coalesce(p_opening->'metadata','{}'::jsonb)||jsonb_build_object('phase','cash_pro_admin_stable_identity')) returning * into v_session;
  perform private.record_pos_cash_event(v_license_id,v_session.id,'OPENED',v_device_id,v_staff_user_id,v_actor_name,jsonb_strip_nulls(jsonb_build_object('actor_key',v_actor_key,'admin_user_id',v_admin_user_id,'admin_session_id',v_context->>'admin_session_id')));
  v_event:=private.record_pos_sync_event(v_license_id,'cash_session',v_session.id,'open',v_device_id,v_staff_user_id,p_idempotency_key,jsonb_build_object('cash_session_id',v_session.id,'actor_key',v_actor_key,'admin_user_id',v_admin_user_id),v_session.server_version);
  v_response:=jsonb_build_object('success',true,'cash_session',private.pos_cash_session_to_jsonb(v_session),'event',to_jsonb(v_event),'change_seq',v_event.change_seq,'idempotency_key',p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id,p_idempotency_key,v_response); return v_response;
exception when unique_violation then
  select * into v_existing from public.pos_cash_sessions s where s.license_id=v_license_id and s.actor_key=v_actor_key and s.status='open' and s.deleted_at is null limit 1;
  v_response:=jsonb_build_object('success',false,'code','CASH_SESSION_ALREADY_OPEN','cash_session',case when v_existing.id is null then null else private.pos_cash_session_to_jsonb(v_existing) end,'idempotency_key',p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then perform private.complete_pos_idempotency(v_license_id,p_idempotency_key,v_response); end if; return v_response;
end;
$$;

create or replace function public.pos_admin_adopt_legacy_cash_session_unlimited(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text default null,
  p_cash_session_id text default null, p_expected_version integer default null, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_context jsonb; v_license_id uuid; v_device_id uuid; v_admin_user_id uuid; v_admin_session_id uuid; v_actor_key text;
  v_session public.pos_cash_sessions; v_event public.pos_sync_events; v_response jsonb; v_idem public.pos_idempotency_keys; v_inserted boolean; v_legacy_key text;
begin
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  if coalesce(v_context->>'device_role','staff')='staff' then raise exception 'ADMIN_SESSION_REQUIRED' using errcode='P0001'; end if;
  v_license_id:=(v_context->>'license_id')::uuid; v_device_id:=(v_context->>'device_id')::uuid; v_admin_user_id:=(v_context->>'admin_user_id')::uuid; v_admin_session_id:=(v_context->>'admin_session_id')::uuid; v_actor_key:=private.resolve_cash_actor_key(v_context);
  if nullif(btrim(coalesce(p_cash_session_id,'')),'') is null then raise exception 'CASH_SESSION_ID_REQUIRED' using errcode='P0001'; end if;
  v_inserted:=private.insert_pos_idempotency_processing(v_license_id,p_idempotency_key,'cash.identity_adopt','cash_session',p_cash_session_id,null);
  if not v_inserted then
    select * into v_idem from public.pos_idempotency_keys where license_id=v_license_id and idempotency_key=p_idempotency_key limit 1;
    if v_idem.status='completed' and v_idem.response_payload is not null then return v_idem.response_payload; end if;
    return jsonb_build_object('success',false,'code','IDEMPOTENCY_PROCESSING','idempotency_key',p_idempotency_key);
  end if;
  select * into v_session from public.pos_cash_sessions s where s.license_id=v_license_id and s.id=p_cash_session_id and s.deleted_at is null for update;
  if v_session.id is null then raise exception 'CASH_SESSION_NOT_FOUND' using errcode='P0001'; end if;
  if v_session.status<>'open' then raise exception 'CASH_SESSION_NOT_OPEN' using errcode='P0001'; end if;
  if v_session.device_role<>'admin' or v_session.admin_user_id is not null or v_session.actor_key not like 'admin_device:%' then raise exception 'CASH_SESSION_NOT_LEGACY_ADMIN' using errcode='P0001'; end if;
  if p_expected_version is null or p_expected_version<>v_session.server_version then
    v_response:=jsonb_build_object('success',false,'code','VERSION_CONFLICT','cash_session',private.pos_cash_session_to_jsonb(v_session),'idempotency_key',p_idempotency_key); perform private.complete_pos_idempotency(v_license_id,p_idempotency_key,v_response); return v_response;
  end if;
  if exists(select 1 from public.pos_cash_sessions s where s.license_id=v_license_id and s.admin_user_id=v_admin_user_id and s.status='open' and s.deleted_at is null) then raise exception 'ADOPTION_CONFLICT' using errcode='P0001'; end if;
  v_legacy_key:=v_session.actor_key;
  update public.pos_cash_sessions set admin_user_id=v_admin_user_id,actor_key=v_actor_key,updated_at=now(),server_version=server_version+1,last_idempotency_key=p_idempotency_key
    where license_id=v_license_id and id=v_session.id returning * into v_session;
  insert into public.pos_cash_audit_events (license_id,cash_session_id,event_type,actor_device_id,actor_admin_user_id,actor_name,payload)
  values (v_license_id,v_session.id,'ADMIN_CASH_IDENTITY_ADOPTED',v_device_id,v_admin_user_id,private.resolve_cash_actor_name(v_context),jsonb_build_object('cash_session_id',v_session.id,'legacy_actor_key',v_legacy_key,'canonical_actor_key',v_actor_key,'admin_user_id',v_admin_user_id,'admin_session_id',v_admin_session_id,'acting_device_id',v_device_id,'opened_by_device_id',v_session.opened_by_device_id,'expected_cash_total',v_session.expected_cash_total,'previous_server_version',v_session.server_version-1,'server_version',v_session.server_version));
  v_event:=private.record_pos_sync_event(v_license_id,'cash_session',v_session.id,'identity_adopt',v_device_id,null,p_idempotency_key,jsonb_build_object('cash_session_id',v_session.id,'legacy_actor_key',v_legacy_key,'canonical_actor_key',v_actor_key,'admin_user_id',v_admin_user_id),v_session.server_version);
  v_response:=jsonb_build_object('success',true,'cash_session',private.pos_cash_session_to_jsonb(v_session),'event',to_jsonb(v_event),'change_seq',v_event.change_seq,'idempotency_key',p_idempotency_key);
  perform private.complete_pos_idempotency(v_license_id,p_idempotency_key,v_response); return v_response;
exception when unique_violation then
  v_response:=jsonb_build_object('success',false,'code','ADOPTION_CONFLICT','message','Ya existe una caja canónica abierta para esta identidad administrativa.','idempotency_key',p_idempotency_key);
  if v_license_id is not null and p_idempotency_key is not null then
    perform private.complete_pos_idempotency(v_license_id,p_idempotency_key,v_response);
  end if;
  return v_response;
end;
$$;

create or replace function public.pos_admin_adopt_legacy_cash_session(
  p_license_key text, p_device_fingerprint text, p_security_token text, p_staff_session_token text default null,
  p_cash_session_id text default null, p_expected_version integer default null, p_idempotency_key text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_rate_limit jsonb;
begin
  v_rate_limit := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key := p_license_key, p_device_fingerprint := p_device_fingerprint,
    p_staff_session_token := p_staff_session_token, p_rpc_name := 'pos_admin_adopt_legacy_cash_session',
    p_scope := 'POS_WRITE', p_max_attempts := 20, p_window_seconds := 600, p_block_seconds := 300,
    p_code := 'RPC_RATE_LIMITED', p_metadata := '{}'::jsonb
  );
  if coalesce((v_rate_limit->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate_limit);
  end if;
  return public.pos_admin_adopt_legacy_cash_session_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_cash_session_id, p_expected_version, p_idempotency_key
  );
end;
$$;

revoke all on function private.resolve_cash_actor_key(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.resolve_cash_actor_name(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.validate_pos_sync_context(text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_admin_adopt_legacy_cash_session_unlimited(text,text,text,text,text,integer,text) from public, anon, authenticated;
grant execute on function public.pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
