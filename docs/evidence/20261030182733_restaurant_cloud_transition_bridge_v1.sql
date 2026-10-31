-- Phase A forward-only candidate: install after the Production 3D.14 guard.
-- Admin remains disabled and the contract remains v1. CLI 2.51.0 generated this
-- provisional filename locally; regenerate the final filename with pinned CLI
-- 2.79.0 before any release. No historical migration is renamed or edited.
create table private.restaurant_cloud_contract_state (
  singleton boolean primary key default true check(singleton),
  contract_version integer not null default 1 check(contract_version in (1,2)),
  writes_paused boolean not null default false,
  generation bigint not null default 1 check(generation > 0)
);
insert into private.restaurant_cloud_contract_state(singleton) values(true);
alter table private.restaurant_cloud_contract_state enable row level security;
revoke all on private.restaurant_cloud_contract_state from public,anon,authenticated;
create table private.restaurant_admin_activation (
  license_id uuid primary key,
  enabled boolean not null default false,
  generation bigint not null default 1 check(generation > 0)
);
alter table private.restaurant_admin_activation enable row level security;
revoke all on private.restaurant_admin_activation from public,anon,authenticated;
create table private.restaurant_bridge_cancel_permits (
  transaction_id xid8 not null, license_id uuid not null, order_id text not null,
  primary key(transaction_id,license_id,order_id)
);
alter table private.restaurant_bridge_cancel_permits enable row level security;
revoke all on private.restaurant_bridge_cancel_permits from public,anon,authenticated;

-- All instrumented writers acquire SHARED before parent/cash/idempotency locks.
-- The operator takes EXCLUSIVE and drains in-flight transactions before changing
-- policy. It never settles a sale or changes a table. Browser roles cannot call it.
create function private.enter_restaurant_transition_write_v1()
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  if (select writes_paused from private.restaurant_cloud_contract_state where singleton) then
    raise exception 'RESTAURANT_CONTRACT_MAINTENANCE' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.enter_restaurant_transition_write_v1() from public,anon,authenticated;

create function private.set_restaurant_transition_policy_v1(p_paused boolean,
  p_license_id uuid default null, p_admin_enabled boolean default null)
returns void language plpgsql security definer set search_path='' as $function$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  if p_paused is null then raise exception 'RESTAURANT_POLICY_REQUIRED'; end if;
  if p_admin_enabled is not null then
    if p_license_id is null then raise exception 'RESTAURANT_POLICY_LICENSE_REQUIRED'; end if;
    if p_admin_enabled and (select contract_version from private.restaurant_cloud_contract_state where singleton) <> 2 then
      raise exception 'RESTAURANT_ADMIN_BACKEND_NOT_AVAILABLE';
    end if;
    insert into private.restaurant_admin_activation(license_id,enabled) values(p_license_id,p_admin_enabled)
    on conflict(license_id) do update set enabled=excluded.enabled,
      generation=private.restaurant_admin_activation.generation+1;
  end if;
  update private.restaurant_cloud_contract_state set writes_paused=p_paused,generation=generation+1 where singleton;
end;
$function$;
revoke all on function private.set_restaurant_transition_policy_v1(boolean,uuid,boolean) from public,anon,authenticated;

create function private.restaurant_admin_supervision_enabled_v1(p_license_id uuid)
returns boolean language sql security definer set search_path='' as $function$
  select s.contract_version=2 and not s.writes_paused and coalesce(a.enabled,false)
  from private.restaurant_cloud_contract_state s
  left join private.restaurant_admin_activation a on a.license_id=p_license_id where s.singleton;
$function$;
revoke all on function private.restaurant_admin_supervision_enabled_v1(uuid) from public,anon,authenticated;

create function public.pos_restaurant_cloud_contract_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text default null)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c jsonb; s private.restaurant_cloud_contract_state; a private.restaurant_admin_activation;
begin
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  perform private.assert_cloud_sales_sync_base_enabled(c);
  perform private.assert_restaurant_orders_food_service((c->>'license_id')::uuid);
  select * into strict s from private.restaurant_cloud_contract_state where singleton;
  select * into a from private.restaurant_admin_activation where license_id=(c->>'license_id')::uuid;
  return jsonb_build_object('success',true,'contractVersion',s.contract_version,
    'minimumSupportedClientVersion',s.contract_version,'strictParentVersionRequired',s.contract_version=2,
    'versionedWritesAvailable',true,'versionedParentVersionRequired',true,
    'adminSupervisionAvailable',s.contract_version=2 and coalesce(a.enabled,false) and not s.writes_paused,
    'legacyWritesAllowed',s.contract_version=1 and not s.writes_paused,
    'kitchenTerminalGuardEnabled',true,'writesPaused',s.writes_paused,
    'serverCapabilityGeneration',s.generation::text||':'||coalesce(a.generation,0)::text);
end;
$function$;
revoke all on function public.pos_restaurant_cloud_contract_v1(text,text,text,text) from public;
-- Device/staff session is authenticated by validate_pos_sync_context, including
-- deployments using the anon transport role. A role or client flag is not authority.
grant execute on function public.pos_restaurant_cloud_contract_v1(text,text,text,text) to anon,authenticated;

create function private.assert_restaurant_bridge_actor_v1(c jsonb,o public.pos_restaurant_orders,
  operation text) returns void language plpgsql security definer set search_path='' as $function$
begin
  if c->>'actor_type'='admin' then
    if nullif(c->>'admin_user_id','') is distinct from c->>'actor_id'
      or nullif(c->>'admin_session_id','') is distinct from c->>'actor_session_id' then
      raise exception 'ACTOR_SESSION_INVALID';
    end if;
  elsif c->>'actor_type'='staff' then
    if nullif(c->>'staff_user_id','') is distinct from c->>'actor_id'
      or nullif(c->>'actor_session_id','') is null then
      raise exception 'ACTOR_SESSION_INVALID';
    end if;
  else raise exception 'ACTOR_SESSION_INVALID'; end if;
  perform private.assert_pos_permission(c,case when operation='cancel' then 'refunds' else 'pos' end);
  if o.id is null then return; end if;
  if o.license_id is distinct from (c->>'license_id')::uuid then raise exception 'RESTAURANT_ORDER_NOT_FOUND'; end if;
  if (c->>'actor_type'='staff' and o.created_by_staff_user_id is distinct from (c->>'actor_id')::uuid)
    or (c->>'actor_type'='admin' and o.created_by_staff_user_id is not null
      and not private.restaurant_admin_supervision_enabled_v1(o.license_id)) then
    raise exception 'RESTAURANT_TABLE_OWNER_REQUIRED' using errcode='P0001';
  end if;
  if operation in ('edit','cancel') and o.created_by_device_id is distinct from (c->>'device_id')::uuid
    and (operation='edit' or c->>'actor_type'<>'admin' or not private.restaurant_admin_supervision_enabled_v1(o.license_id)) then
    raise exception 'RESTAURANT_ORDER_REMOTE_EDIT_BLOCKED_PENDING_INVENTORY_CONTRACT' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.assert_restaurant_bridge_actor_v1(jsonb,public.pos_restaurant_orders,text) from public,anon,authenticated;

-- Legacy mapper payloads remain valid during bridge. Authentication, ownership,
-- parent serialization and physical-ID isolation apply before the installed leaf.
-- Blind legacy updates are retired by the final contract, never synthesized into
-- a current version here. The old mapper does not supply physical row IDs.
create function private.prepare_restaurant_bridge_upsert_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_order jsonb,p_items jsonb)
returns void language plpgsql security definer set search_path='' as $function$
declare c jsonb; o public.pos_restaurant_orders; local_id text;
begin
  perform private.enter_restaurant_transition_write_v1();
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  -- Match the installed leaf's actual aliases and precedence, including frames
  -- compiled before cutover. A marker cannot turn a snake-case identity into
  -- an apparently new parent and skip its version requirement.
  local_id:=nullif(btrim(coalesce(p_order->>'localOrderId',p_order->>'local_order_id','')),'');
  if local_id is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED'; end if;
  o:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,local_id);
  perform private.assert_restaurant_bridge_actor_v1(c,o,'edit');
  -- A legacy PL/pgSQL frame may already be waiting inside this helper when
  -- cutover replaces its caller. Recheck strict policy AFTER acquiring the
  -- shared lock; replacing the caller alone cannot revoke that old frame.
  if (select contract_version from private.restaurant_cloud_contract_state where singleton)=2 then
    if p_order->>'clientContractVersion' is distinct from '2' then raise exception 'RESTAURANT_CLIENT_UPGRADE_REQUIRED'; end if;
    if o.id is not null then
      if nullif(p_order->>'expectedParentVersion','') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end if;
      if (p_order->>'expectedParentVersion')::timestamptz is distinct from o.updated_at then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT'; end if;
    end if;
  end if;
  if nullif(btrim(p_order->>'id'),'') is not null then raise exception 'RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) i where nullif(btrim(i->>'id'),'') is not null) then
    raise exception 'RESTAURANT_ORDER_LINE_ID_CONFLICT';
  end if;
end;
$function$;
revoke all on function private.prepare_restaurant_bridge_upsert_v1(text,text,text,text,jsonb,jsonb) from public,anon,authenticated;

create function public.pos_restaurant_transition_table_capabilities_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_local_order_id text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare c jsonb; o public.pos_restaurant_orders; active boolean; owner boolean; same_device boolean;
  pos boolean; refunds boolean; admin boolean; writable boolean;
begin
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  perform private.assert_cloud_sales_sync_base_enabled(c);
  perform private.assert_restaurant_orders_food_service((c->>'license_id')::uuid);
  perform private.assert_pos_permission(c,'pos');
  select * into o from public.pos_restaurant_orders where license_id=(c->>'license_id')::uuid
    and local_order_id=$5 order by updated_at desc,id limit 1;
  if o.id is null then raise exception 'RESTAURANT_ORDER_NOT_FOUND'; end if;
  active:=o.deleted_at is null and o.archived_at is null and o.checkout_closed_at is null and o.cancelled_at is null
    and o.paid_at is null and o.paid_sale_id is null and coalesce(o.payment_status,'unpaid')='unpaid'
    and o.status in ('pending','preparing','ready','delivered') and o.fulfillment_status in ('pending','preparing','ready','delivered');
  owner:=(c->>'actor_type'='staff' and o.created_by_staff_user_id=(c->>'actor_id')::uuid)
    or (c->>'actor_type'='admin' and o.created_by_staff_user_id is null);
  admin:=c->>'actor_type'='admin' and private.restaurant_admin_supervision_enabled_v1(o.license_id);
  same_device:=o.created_by_device_id=(c->>'device_id')::uuid;
  pos:=c->>'actor_type'='admin' or coalesce((c->'actor_permissions'->>'pos')::boolean,false);
  refunds:=c->>'actor_type'='admin' or coalesce((c->'actor_permissions'->>'refunds')::boolean,false);
  writable:=not (select writes_paused from private.restaurant_cloud_contract_state where singleton);
  return jsonb_build_object('success',true,'contractVersion',1,'cloudOrderId',o.id,
    'localOrderId',o.local_order_id,'parentVersion',o.updated_at,
    'capabilities',jsonb_build_object('canViewTable',true,
      'canEditTable',writable and pos and active and (coalesce(owner,false) or admin) and same_device,
      'canSendToKitchen',writable and pos and active and (coalesce(owner,false) or admin) and same_device,
      'canCheckoutTable',writable and pos and active and (coalesce(owner,false) or admin),
      'canSplitTable',writable and pos and active and (coalesce(owner,false) or admin),
      'canCancelTable',writable and refunds and active and (admin or (coalesce(owner,false) and same_device)),
      'canAdministerTable',writable and admin and active),
    'remoteEdit','BLOCKED_PENDING_INVENTORY_CONTRACT');
end;
$function$;
revoke all on function public.pos_restaurant_transition_table_capabilities_v1(text,text,text,text,text) from public;
grant execute on function public.pos_restaurant_transition_table_capabilities_v1(text,text,text,text,text) to anon,authenticated;

create function public.pos_upsert_restaurant_order_versioned_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text default null,p_staff_session_token text default null,p_order jsonb default '{}'::jsonb,
  p_items jsonb default '[]'::jsonb,p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path='' set lock_timeout='20s' as $function$
declare c jsonb; o public.pos_restaurant_orders; existing_line public.pos_restaurant_order_items;
  local_id text; expected timestamptz; item jsonb; line_id text;
begin
  perform private.enter_restaurant_transition_write_v1();
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  perform private.assert_cloud_sales_sync_base_enabled(c);
  perform private.assert_restaurant_orders_food_service((c->>'license_id')::uuid);
  local_id:=coalesce(nullif(btrim(p_order->>'localOrderId'),''),nullif(btrim(p_order->>'saleId'),''));
  if nullif(btrim(p_order->>'id'),'') is not null then raise exception 'RESTAURANT_ORDER_PHYSICAL_ID_NOT_SUPPORTED'; end if;
  if local_id is null then raise exception 'RESTAURANT_PARENT_ORDER_REQUIRED'; end if;
  if nullif(btrim(p_idempotency_key),'') is null then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  o:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,local_id);
  perform private.assert_restaurant_bridge_actor_v1(c,o,'edit');
  if o.id is not null then
    if o.paid_at is not null or o.paid_sale_id is not null or o.payment_status='paid' then raise exception 'RESTAURANT_ORDER_ALREADY_PAID'; end if;
    if o.cancelled_at is not null or o.status='cancelled' then raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED'; end if;
    if o.deleted_at is not null or o.archived_at is not null or o.checkout_closed_at is not null then raise exception 'RESTAURANT_ORDER_NOT_ACTIVE'; end if;
    if nullif(p_order->>'expectedParentVersion','') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end if;
    begin expected:=(p_order->>'expectedParentVersion')::timestamptz;
    exception when invalid_datetime_format or datetime_field_overflow then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end;
    if expected is distinct from o.updated_at then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT'; end if;
  elsif nullif(p_order->>'expectedParentVersion','') is not null then
    raise exception 'RESTAURANT_ORDER_NOT_FOUND';
  end if;
  -- Global line identities are serialized, including lines absent at snapshot.
  for item in select value from jsonb_array_elements(p_items) order by value->>'localLineId' loop
    line_id:=nullif(btrim(coalesce(item->>'localLineId',item->>'local_line_id')),'');
    if line_id is null then raise exception 'RESTAURANT_ORDER_LINE_ID_REQUIRED'; end if;
    -- The common mapper supplies localLineId, not a physical Cloud row ID.
    -- Never allow an alias ID to redirect the legacy leaf's ON CONFLICT target.
    if nullif(btrim(item->>'id'),'') is not null then raise exception 'RESTAURANT_ORDER_LINE_ID_CONFLICT'; end if;
    -- New parents use an unpredictable server-generated ID in the installed
    -- leaf; they have no preexisting physical line identities to lock.
    if o.id is null then continue; end if;
    line_id:='rest_item_'||md5(o.id||':'||line_id);
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('restaurant_bridge_line:'||line_id,0));
    select * into existing_line from public.pos_restaurant_order_items where id=line_id for update;
    if existing_line.id is not null and (existing_line.license_id is distinct from (c->>'license_id')::uuid
      or o.id is null or existing_line.restaurant_order_id is distinct from o.id) then
      raise exception 'RESTAURANT_ORDER_LINE_ID_CONFLICT';
    end if;
  end loop;
  -- The original rate-limited public wrapper still validates its own contract.
  return public.pos_upsert_restaurant_order($1,$2,$3,$4,
    p_order||jsonb_build_object('clientContractVersion',2),p_items,$7);
end;
$function$;
revoke all on function public.pos_upsert_restaurant_order_versioned_v1(text,text,text,text,jsonb,jsonb,text) from public;
grant execute on function public.pos_upsert_restaurant_order_versioned_v1(text,text,text,text,jsonb,jsonb,text) to anon,authenticated;

create function private.enter_restaurant_financial_transition_write_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_request jsonb)
returns void language plpgsql security definer set search_path='' as $function$
declare c jsonb; ids text[];
begin
  -- Admission is transaction-scoped and must precede all business locks. This
  -- bridge intentionally does not lock parents from raw aliases: the canonical
  -- dispatcher resolves one coherent parent and locks it before Caja/ledger.
  perform pg_catalog.pg_advisory_xact_lock_shared(pg_catalog.hashtextextended('restaurant_contract_cutover_v1',0));
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  ids:=array[p_request->>'parent_order_id',p_request->>'parentOrderId',
    p_request#>>'{restaurant_settlement,parent_order_id}',p_request#>>'{restaurant_settlement,parentOrderId}',
    p_request#>>'{sale,id}',p_request#>>'{sale,local_sale_id}',p_request#>>'{sale,localSaleId}',
    p_request#>>'{sale,cloud_sale_id}',p_request#>>'{sale,cloudSaleId}',
    p_request#>>'{sale,metadata,splitParentId}',p_request#>>'{sale,metadata,split_parent_id}',
    p_request#>>'{sale,metadata,restaurant,parentOrderId}',p_request#>>'{sale,metadata,restaurant,parent_order_id}'];
  -- The shared lock is held through COMMIT/ROLLBACK. While paused, inspect the
  -- raw aliases only to reject Restaurant writes; never acquire parent locks
  -- until the dispatcher has canonicalized and reconciled the full request.
  if not (select writes_paused from private.restaurant_cloud_contract_state where singleton) then return; end if;
  if exists(select 1 from public.pos_restaurant_orders where license_id=(c->>'license_id')::uuid
      and (local_order_id=any(ids) or id=any(ids)))
    or nullif(p_request->>'parent_order_id','') is not null
    or nullif(p_request->>'parentOrderId','') is not null
    or p_request ? 'restaurant_settlement' then
    raise exception 'RESTAURANT_CONTRACT_MAINTENANCE' using errcode='P0001';
  end if;
end;
$function$;
revoke all on function private.enter_restaurant_financial_transition_write_v1(text,text,text,text,jsonb) from public,anon,authenticated;

create function private.prepare_restaurant_bridge_cancel_v1(p_license_key text,p_device_fingerprint text,
  p_security_token text,p_staff_session_token text,p_local_order_id text,p_expected_parent_version text)
returns void language plpgsql security definer set search_path='' as $function$
declare c jsonb; o public.pos_restaurant_orders;
begin
  perform private.enter_restaurant_transition_write_v1();
  c:=private.validate_pos_sync_context($1,$2,$3,$4);
  o:=private.lock_restaurant_order_settlement_v1((c->>'license_id')::uuid,$5);
  perform private.assert_restaurant_bridge_actor_v1(c,o,'cancel');
  if o.id is null then raise exception 'RESTAURANT_ORDER_NOT_FOUND'; end if;
  -- Already confirmed cancellation returns its existing receipt in the original
  -- RPC. No permit or new effect is needed, including a lost-response retry.
  if o.status='cancelled' then return; end if;
  if o.payment_status='paid' or o.paid_at is not null or o.paid_sale_id is not null then raise exception 'RESTAURANT_ORDER_ALREADY_PAID'; end if;
  if nullif($6,'') is null then raise exception 'RESTAURANT_ORDER_VERSION_REQUIRED'; end if;
  if $6::timestamptz is distinct from o.updated_at then raise exception 'RESTAURANT_ORDER_VERSION_CONFLICT'; end if;
  insert into private.restaurant_bridge_cancel_permits values(pg_current_xact_id(),o.license_id,o.id) on conflict do nothing;
end;
$function$;
revoke all on function private.prepare_restaurant_bridge_cancel_v1(text,text,text,text,text,text) from public,anon,authenticated;

-- Instrument actual installed bodies without recreating their business logic.
-- pg_get_functiondef preserves signatures, security mode and settings; CREATE OR
-- REPLACE preserves ACLs. Only a first statement is inserted, never a header flag
-- granting authority. The matrix tests execute captured production bodies.
-- Find the first PL/pgSQL BEGIN token while skipping comments and quoted text.
-- This is a lexical locator, not a SQL parser: a valid PL/pgSQL function's outer
-- block is its first unquoted BEGIN token. If the body cannot be located exactly,
-- injection fails closed rather than guessing with a regex over deparsed SQL.
create function private.pr352_r6_outer_begin_position_v1(p_source text)
returns integer language plpgsql immutable strict set search_path='' as $function$
declare
  i integer:=1; j integer; n integer:=length(p_source); v_depth integer:=0;
  v_state text:='code'; v_char text; v_word text; v_dollar_tag text; v_tag_body text;
  v_tag_end integer; v_escape_string boolean:=false;
begin
  while i<=n loop
    v_char:=substr(p_source,i,1);
    if v_state='code' then
      if substr(p_source,i,2)='--' then v_state:='line_comment'; i:=i+2; continue; end if;
      if substr(p_source,i,2)='/*' then v_state:='block_comment'; v_depth:=1; i:=i+2; continue; end if;
      if v_char='''' then
        v_escape_string:=false;
        if i>1 and lower(substr(p_source,i-1,1))='e'
          and (i=2 or substr(p_source,i-2,1) !~ '^[[:alnum:]_$]$') then
          v_escape_string:=true;
        elsif i>2 and lower(substr(p_source,i-2,2))='u&'
          and (i=3 or substr(p_source,i-3,1) !~ '^[[:alnum:]_$]$') then
          v_escape_string:=true;
        end if;
        v_state:='single_quote'; i:=i+1; continue;
      end if;
      if v_char='"' then v_state:='double_quote'; i:=i+1; continue; end if;
      if v_char='$' then
        v_tag_end:=i+strpos(substr(p_source,i+1),'$');
        if v_tag_end>i then
          v_dollar_tag:=substr(p_source,i,v_tag_end-i+1);
          v_tag_body:=substr(v_dollar_tag,2,length(v_dollar_tag)-2);
          if v_dollar_tag='$$' or v_tag_body ~ '^[[:alpha:]_][[:alnum:]_]*$' then
            v_state:='dollar_quote'; i:=v_tag_end+1; continue;
          end if;
        end if;
      end if;
      if v_char ~ '^[[:alpha:]_]$' then
        j:=i+1;
        while j<=n and substr(p_source,j,1) ~ '^[[:alnum:]_$]$' loop j:=j+1; end loop;
        v_word:=lower(substr(p_source,i,j-i));
        if v_word='begin' then
          if j>n or substr(p_source,j,1) !~ '^[[:space:]]$' then return null; end if;
          return i;
        end if;
        i:=j; continue;
      end if;
      i:=i+1; continue;
    elsif v_state='line_comment' then
      if v_char=chr(10) or v_char=chr(13) then v_state:='code'; end if;
      i:=i+1; continue;
    elsif v_state='block_comment' then
      if substr(p_source,i,2)='/*' then v_depth:=v_depth+1; i:=i+2; continue; end if;
      if substr(p_source,i,2)='*/' then
        v_depth:=v_depth-1; i:=i+2;
        if v_depth=0 then v_state:='code'; end if;
        continue;
      end if;
      i:=i+1; continue;
    elsif v_state='single_quote' then
      if v_escape_string and v_char=chr(92) then i:=i+2; continue; end if;
      if v_char='''' then
        if substr(p_source,i+1,1)='''' then i:=i+2; continue; end if;
        v_state:='code';
      end if;
      i:=i+1; continue;
    elsif v_state='double_quote' then
      if v_char='"' then
        if substr(p_source,i+1,1)='"' then i:=i+2; continue; end if;
        v_state:='code';
      end if;
      i:=i+1; continue;
    elsif v_state='dollar_quote' then
      if substr(p_source,i,length(v_dollar_tag))=v_dollar_tag then
        i:=i+length(v_dollar_tag); v_state:='code'; continue;
      end if;
      i:=i+1; continue;
    end if;
  end loop;
  return null;
end;
$function$;
revoke all on function private.pr352_r6_outer_begin_position_v1(text) from public,anon,authenticated;

create function private.pr352_r6_inject_writer_admission_v1(p_definition text,p_source text,p_instruction text)
returns text language plpgsql immutable set search_path='' as $function$
declare v_body_start integer; v_begin_position integer;
begin
  if p_definition is null or p_source is null or p_source='' or p_instruction is null or p_instruction=''
    or p_instruction ~ E'[\r\n]' then
    raise exception 'BRIDGE_WRITER_BODY_UNSUPPORTED: invalid definition, source or instruction' using errcode='P0001';
  end if;
  if position(p_instruction in p_definition)>0 then
    raise exception 'BRIDGE_WRITER_ADMISSION_ALREADY_PRESENT' using errcode='P0001';
  end if;
  v_body_start:=strpos(p_definition,p_source);
  if v_body_start=0 or strpos(substr(p_definition,v_body_start+length(p_source)),p_source)>0 then
    raise exception 'BRIDGE_WRITER_BODY_MATCH_AMBIGUOUS' using errcode='P0001';
  end if;
  v_begin_position:=private.pr352_r6_outer_begin_position_v1(p_source);
  if v_begin_position is null then
    raise exception 'BRIDGE_WRITER_BODY_UNSUPPORTED: no unambiguous outer BEGIN' using errcode='P0001';
  end if;
  return left(p_definition,v_body_start+v_begin_position+3)||E'\n  '||p_instruction
    ||substr(p_definition,v_body_start+v_begin_position+4);
end;
$function$;
revoke all on function private.pr352_r6_inject_writer_admission_v1(text,text,text) from public,anon,authenticated;

-- Exercise the exact PostgreSQL transformation before touching any financial
-- writer. These are source strings only; no business rows or effects are created.
do $bridge_injection_probes$
declare
  v_source text; v_definition text; v_injected text; v_instruction text;
  v_count integer:=0; v_message text; v_begin_position integer; v_expected_position integer;
begin
  foreach v_source in array array[
    E'declare\n  v_value text;\nbegin\n  perform 1;\nend;',
    E'declare\n  v_value text;\nbegin\n    perform 1;\nend;',
    E'declare\n  v_value text;\nbegin\n\tperform 1;\nend;',
    E'declare\n  v_value text;\nbegin\n\n  perform 1;\nend;',
    E'declare\r\n  v_value text;\r\nbegin\r\n  perform 1;\r\nend;',
    E'/* comment\nBEGIN\n/* nested BEGIN */\n*/\ndeclare\n  v_value text;\nbegin\n  perform 1;\nend;',
    E'-- BEGIN line-comment decoy\ndeclare\n  v_value text;\nbegin\n  perform 1;\nend;',
    E'declare\n  v_value text := ''first\nBEGIN\nlast'';\nbegin\n  perform 1;\nend;',
    E'declare\n  v_value text := E''first\\nBEGIN\\nlast'';\nbegin\n  perform 1;\nend;',
    E'declare\n  v_value text := $literal$first\nBEGIN\nlast$literal$;\nbegin\n  perform 1;\nend;',
    E'begin\n  declare\n    v_value text;\n  begin\n    v_value := ''BEGIN'';\n  end;\nend;'
  ] loop
    v_count:=v_count+1;
    v_instruction:=format('perform pg_catalog.set_config(%L,%L,true);','pr352_probe',v_count::text);
    v_definition:='CREATE FUNCTION private.pr352_probe() RETURNS void LANGUAGE plpgsql AS $function$'||E'\n'||v_source||E'\n'||'$function$;';
    v_begin_position:=private.pr352_r6_outer_begin_position_v1(v_source);
    v_expected_position:=case
      when strpos(v_source,E'\nbegin\n')>0 then strpos(v_source,E'\nbegin\n')+1
      when strpos(v_source,E'\r\nbegin\r\n')>0 then strpos(v_source,E'\r\nbegin\r\n')+2
      else 1 end;
    if v_begin_position is distinct from v_expected_position then
      raise exception 'BRIDGE_INJECTION_PROBE_OUTER_BEGIN_MISLOCATED:%',v_count using errcode='P0001';
    end if;
    v_injected:=private.pr352_r6_inject_writer_admission_v1(v_definition,v_source,v_instruction);
    if length(v_injected)-length(replace(v_injected,v_instruction,''))<>length(v_instruction)
      or replace(v_injected,E'\n  '||v_instruction,'') is distinct from v_definition then
      raise exception 'BRIDGE_INJECTION_PROBE_BODY_RECONSTRUCTION_FAILED:%',v_count using errcode='P0001';
    end if;
    if position(E'\nbegin\n  '||v_instruction in lower(v_injected))=0
      and position(E'\nBEGIN\n  '||v_instruction in v_injected)=0 then
      raise exception 'BRIDGE_INJECTION_PROBE_POSITION_FAILED:%',v_count using errcode='P0001';
    end if;
    begin
      perform private.pr352_r6_inject_writer_admission_v1(v_injected,v_source,v_instruction);
      raise exception 'BRIDGE_DOUBLE_INJECTION_UNEXPECTEDLY_ALLOWED';
    exception when others then
      get stacked diagnostics v_message=message_text;
      if v_message<>'BRIDGE_WRITER_ADMISSION_ALREADY_PRESENT' then raise; end if;
    end;
  end loop;
  begin
    perform private.pr352_r6_inject_writer_admission_v1('CREATE FUNCTION probe() AS $function$DECLARE x int;$function$;','DECLARE x int;','perform 1;');
    raise exception 'BRIDGE_MISSING_BEGIN_UNEXPECTEDLY_ALLOWED';
  exception when others then
    if sqlerrm<>'BRIDGE_WRITER_BODY_UNSUPPORTED: no unambiguous outer BEGIN' then raise; end if;
  end;
  begin
    v_source:='begin perform 1; end;';
    perform private.pr352_r6_inject_writer_admission_v1('prefix'||v_source||'middle'||v_source,v_source,'perform 2;');
    raise exception 'BRIDGE_AMBIGUOUS_BODY_UNEXPECTEDLY_ALLOWED';
  exception when others then
    if sqlerrm<>'BRIDGE_WRITER_BODY_MATCH_AMBIGUOUS' then raise; end if;
  end;
end;
$bridge_injection_probes$;

do $bridge_writers$
declare expected record; target_oid oid; target_count integer; owner_name text;
  is_security_definer boolean; function_config text[]; definition text; body_source text; instruction text;
begin
  if to_regprocedure('private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text)') is null then
    raise exception 'BRIDGE_REQUIRES_3D14_DISPATCHER_GUARD' using errcode='P0001';
  end if;
  foreach target_oid in array array[
    to_regprocedure('public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)')::oid,
    to_regprocedure('public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)')::oid,
    to_regprocedure('public.pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)')::oid
  ] loop
    if target_oid is null or position('private.assert_restaurant_sale_dispatcher_context_v1' in pg_get_functiondef(target_oid))=0 then
      raise exception 'BRIDGE_REQUIRES_3D14_SALE_WRAPPER_GUARDS' using errcode='P0001';
    end if;
  end loop;
  for expected in select * from (values
    ('public.pos_upsert_restaurant_order_unlimited(text,text,text,text,jsonb,jsonb,text)', 'upsert'),
    ('public.pos_update_restaurant_order_status_unlimited(text,text,text,text,text,text,text)', 'status'),
    ('public.pos_update_restaurant_order_item_status_unlimited(text,text,text,text,text,text,text,text)', 'status'),
    ('public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text)', 'write'),
    ('public.pos_archive_restaurant_order_unlimited(text,text,text,text,text,text,jsonb,text)', 'write'),
    ('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', 'financial'),
    ('public.pos_cancel_restaurant_order_from_pos_v1(text,text,text,text,text,text,text,text)', 'cancel'),
    ('private.r2b_authorize_sale_financial_request_v1(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text)', 'r2b'),
    ('private.execute_split_sale_financial_v1(text,text,text,text,jsonb,text)', 'split'),
    ('private.recalculate_restaurant_order_status(uuid,text)', 'write')
  ) as required(signature, kind) loop
    target_oid:=to_regprocedure(expected.signature)::oid;
    if target_oid is null then
      raise exception 'BRIDGE_REQUIRED_FUNCTION_MISSING: %',expected.signature using errcode='P0001';
    end if;
    select count(*) into target_count
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname=split_part(expected.signature,'.',1)
      and p.proname=split_part(split_part(expected.signature,'.',2),'(',1);
    if target_count<>1 then
      raise exception 'BRIDGE_FUNCTION_OVERLOAD_UNSUPPORTED: % (% overloads)',expected.signature,target_count using errcode='P0001';
    end if;
    select r.rolname,p.prosecdef,p.proconfig into owner_name,is_security_definer,function_config
    from pg_proc p join pg_roles r on r.oid=p.proowner where p.oid=target_oid;
    if owner_name<>'postgres' or not is_security_definer or not coalesce(function_config @> array['search_path=""'],false) then
      raise exception 'BRIDGE_FUNCTION_SECURITY_DRIFT: %',expected.signature using errcode='P0001';
    end if;
    definition:=pg_get_functiondef(target_oid);
    select p.prosrc into body_source from pg_proc p where p.oid=target_oid;
    if expected.kind='upsert' then
      instruction:='perform private.prepare_restaurant_bridge_upsert_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_order,p_items);';
    elsif expected.kind='financial' then
      instruction:='perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_request);';
    elsif expected.kind='r2b' then
      instruction:='perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,jsonb_build_object(''sale'',p_sale));';
    elsif expected.kind='split' then
      instruction:='perform private.enter_restaurant_financial_transition_write_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_split);';
    elsif expected.kind='cancel' then
      instruction:='perform private.prepare_restaurant_bridge_cancel_v1(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,p_local_order_id,p_expected_parent_version);';
    elsif expected.kind='status' and expected.signature='public.pos_update_restaurant_order_status_unlimited(text,text,text,text,text,text,text)' then
      instruction:='perform private.enter_restaurant_transition_write_v1(); if lower(btrim(p_status))=''cancelled'' then raise exception ''RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED''; end if;';
    else instruction:='perform private.enter_restaurant_transition_write_v1();'; end if;
    definition:=private.pr352_r6_inject_writer_admission_v1(definition,body_source,instruction);
    execute definition;
  end loop;
end;
$bridge_writers$;
drop function private.pr352_r6_inject_writer_admission_v1(text,text,text);
drop function private.pr352_r6_outer_begin_position_v1(text);

create or replace function private.guard_restaurant_bridge_parent_v1()
returns trigger language plpgsql security definer set search_path='' as $guard$
declare v_terminal boolean; v_permitted boolean := false;
begin
  v_terminal := lower(coalesce(new.status,''))='cancelled'
    or lower(coalesce(new.fulfillment_status,''))='cancelled'
    or new.cancelled_at is not null or new.metadata->>'cancelledFromPos'='true';
  if TG_OP='UPDATE' and (old.status='cancelled' or old.fulfillment_status='cancelled'
    or old.cancelled_at is not null or old.metadata->>'cancelledFromPos'='true') then
    if new.status is distinct from old.status or new.fulfillment_status is distinct from old.fulfillment_status
      or new.cancelled_at is distinct from old.cancelled_at or new.payment_status is distinct from old.payment_status
      or new.metadata->'cancelledFromPos' is distinct from old.metadata->'cancelledFromPos'
      or new.metadata->'cancelReason' is distinct from old.metadata->'cancelReason'
      or new.metadata->'cancelContractVersion' is distinct from old.metadata->'cancelContractVersion' then
      raise exception 'RESTAURANT_ORDER_ALREADY_CANCELLED' using errcode='P0001';
    end if;
    return new;
  end if;
  -- Kitchen delivery is operational, not financial closure. Archiving an
  -- unpaid delivered parent would otherwise hide the live POS table.
  if (new.archived_at is not null or new.deleted_at is not null or new.metadata->>'archived'='true')
    and new.paid_at is null and new.paid_sale_id is null
    and coalesce(new.payment_status,'unpaid') <> 'paid' then
    raise exception 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED' using errcode='P0001';
  end if;
  if v_terminal then
    if TG_OP='UPDATE' and (old.paid_at is not null or old.paid_sale_id is not null
      or coalesce(old.payment_status,'unpaid') <> 'unpaid') then
      raise exception 'RESTAURANT_ORDER_ALREADY_PAID' using errcode='P0001';
    end if;
    v_permitted:=exists(select 1 from private.restaurant_bridge_cancel_permits
      where transaction_id=pg_current_xact_id() and license_id=new.license_id and order_id=new.id);
    if not v_permitted and to_regclass('private.restaurant_parent_cancel_permits') is not null then
      execute 'select exists(select 1 from private.restaurant_parent_cancel_permits where transaction_id=pg_current_xact_id() and license_id=$1 and order_id=$2)' into v_permitted using new.license_id,new.id;
    end if;
    if not v_permitted then
      raise exception 'RESTAURANT_PARENT_CANCEL_CONTRACT_REQUIRED' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$guard$;
revoke all on function private.guard_restaurant_bridge_parent_v1() from public,anon,authenticated;
create trigger restaurant_bridge_terminal_guard_v1 before insert or update on public.pos_restaurant_orders
for each row execute function private.guard_restaurant_bridge_parent_v1();
create function private.cleanup_restaurant_bridge_cancel_permit_v1() returns trigger
language plpgsql security definer set search_path='' as $function$
begin
  delete from private.restaurant_bridge_cancel_permits where transaction_id=pg_current_xact_id()
    and license_id=new.license_id and order_id=new.id;
  return new;
end; $function$;
revoke all on function private.cleanup_restaurant_bridge_cancel_permit_v1() from public,anon,authenticated;
create trigger restaurant_bridge_cancel_permit_cleanup_v1 after insert or update on public.pos_restaurant_orders
for each row execute function private.cleanup_restaurant_bridge_cancel_permit_v1();
