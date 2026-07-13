-- ECOM.ORDERS.2.2 focused transactional verification.
-- No fixture or rate-limit row survives the rollback.

begin;

create or replace function private.ecom22_insert_order_fixture_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_columns text;
  v_select text;
  v_id uuid;
begin
  select
    string_agg(quote_ident(a.attname), ',' order by a.attnum),
    string_agg(format('r.%I', a.attname), ',' order by a.attnum)
  into v_columns, v_select
  from pg_attribute a
  where a.attrelid = 'public.ecommerce_orders'::regclass
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and a.attidentity = '';

  execute format(
    'insert into public.ecommerce_orders (%s) select %s from jsonb_populate_record(null::public.ecommerce_orders,$1) r returning id',
    v_columns,
    v_select
  ) using p_payload into v_id;

  return v_id;
end;
$function$;

do $test$
declare
  v_source_order public.ecommerce_orders%rowtype;
  v_source_portal public.ecommerce_portals%rowtype;
  v_source_license public.licenses%rowtype;
  v_license public.licenses%rowtype;
  v_portal public.ecommerce_portals%rowtype;
  v_order public.ecommerce_orders%rowtype;

  v_license_id uuid := extensions.gen_random_uuid();
  v_portal_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_order_id uuid := extensions.gen_random_uuid();
  v_terminal_id uuid := extensions.gen_random_uuid();
  v_key text := 'ECOM22-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_slug text := 'ecom22-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 18);
  v_missing_slug text := 'missing-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 18);
  v_fingerprint text := 'ecom22-device-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 12);
  v_security_token text := 'ecom22-security-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_prefix text := 'T22-' || left(replace(extensions.gen_random_uuid()::text, '-', ''), 8);
  v_draft_id text := 'ecom22-draft';
  v_attempt_id text := 'ecom22-attempt';
  v_conversion_key text;

  v_result jsonb;
  v_not_found jsonb := private.ecommerce_tracking_not_found_v1();
  v_tracking_secret jsonb;
  v_tracking_token text;
  v_claim_token uuid;
  v_client_a text;
  v_client_b text;
  v_count integer;
  v_rows integer;
  v_definition text;
begin
  select o.* into v_source_order
  from public.ecommerce_orders o
  order by o.created_at desc
  limit 1;
  if v_source_order.id is null then
    raise exception 'fixture source order unavailable';
  end if;

  select p.* into v_source_portal
  from public.ecommerce_portals p
  where p.id = v_source_order.portal_id;

  select l.* into v_source_license
  from public.licenses l
  where l.id = v_source_order.license_id;

  v_license := jsonb_populate_record(
    null::public.licenses,
    to_jsonb(v_source_license) || jsonb_build_object(
      'id', v_license_id,
      'license_key', v_key,
      'status', 'active',
      'expires_at', now() + interval '30 days',
      'features', coalesce(v_source_license.features, '{}'::jsonb) || jsonb_build_object(
        'ecommerce_order_inbox', true,
        'ecommerce_portal_enabled', true,
        'ecommerce_realtime_orders', true
      ),
      'created_at', now()
    )
  );
  insert into public.licenses select (v_license).*;

  insert into public.license_devices(
    id, license_id, device_fingerprint, device_name,
    is_active, security_token, device_role, activated_at, last_used_at
  ) values (
    v_device_id, v_license_id, v_fingerprint, 'ECOM.ORDERS.2.2 fixture',
    true, v_security_token, 'admin', now(), now()
  );

  v_portal := jsonb_populate_record(
    null::public.ecommerce_portals,
    to_jsonb(v_source_portal) || jsonb_build_object(
      'id', v_portal_id,
      'license_id', v_license_id,
      'slug', v_slug,
      'status', 'published',
      'deleted_at', null,
      'created_at', now(),
      'updated_at', now()
    )
  );
  insert into public.ecommerce_portals select (v_portal).*;

  v_order := jsonb_populate_record(
    null::public.ecommerce_orders,
    to_jsonb(v_source_order) || jsonb_build_object(
      'id', v_order_id,
      'portal_id', v_portal_id,
      'license_id', v_license_id,
      'idempotency_key', v_prefix || '-A',
      'status', 'accepted',
      'pos_visibility_status', 'visible',
      'converted_sale_id', null,
      'converted_at', null,
      'pos_draft_status', 'none',
      'pos_draft_id', null,
      'pos_claim_token', null,
      'pos_claim_request_key', null,
      'pos_claimed_at', null,
      'pos_claim_expires_at', null,
      'pos_claim_actor_type', null,
      'pos_claim_actor_ref', null,
      'pos_draft_prepared_at', null,
      'pos_conversion_status', 'idle',
      'pos_conversion_attempt_id', null,
      'pos_conversion_sale_id', null,
      'pos_conversion_key', null,
      'pos_conversion_actor_ref', null,
      'pos_conversion_started_at', null,
      'fulfillment_status', 'accepted',
      'fulfillment_version', 1,
      'fulfillment_updated_at', now(),
      'cancelled_at', null,
      'created_at', now(),
      'updated_at', now()
    )
  );
  perform private.ecom22_insert_order_fixture_v1(to_jsonb(v_order));

  v_order := jsonb_populate_record(
    null::public.ecommerce_orders,
    to_jsonb(v_order) || jsonb_build_object(
      'id', v_terminal_id,
      'idempotency_key', v_prefix || '-B',
      'pos_visibility_status', 'archived',
      'fulfillment_status', 'cancelled',
      'fulfillment_version', 2,
      'cancelled_at', now()
    )
  );
  perform private.ecom22_insert_order_fixture_v1(to_jsonb(v_order));

  -- Tracking: stable pseudonymous client bucket before portal/token resolution.
  delete from public.pos_rpc_rate_limits
  where rpc_name = 'ecommerce_get_order_tracking'
    and (
      license_key = 'ecommerce-tracking-client:v1'
      or license_key = 'ecommerce-tracking:' || v_license_id::text
    );

  perform set_config(
    'request.headers',
    '{"cf-connecting-ip":"203.0.113.10","x-real-ip":"198.51.100.9","authorization":"Bearer must-not-persist","cookie":"must-not-persist"}',
    true
  );
  v_client_a := private.ecommerce_tracking_client_identity_v1()->>'fingerprint';
  if v_client_a is null or v_client_a like '%203.0.113.10%' then
    raise exception 'client A fingerprint is absent or contains plaintext IP';
  end if;

  perform public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('A', 43));
  perform public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('B', 43));
  perform public.ecommerce_get_order_tracking(v_missing_slug, 'trk1_' || repeat('C', 43));

  select count(*), coalesce(sum(request_count), 0)
  into v_rows, v_count
  from public.pos_rpc_rate_limits
  where license_key = 'ecommerce-tracking-client:v1'
    and device_fingerprint = v_client_a
    and scope = 'ECOMMERCE_ORDER_TRACKING_CLIENT';
  if v_rows <> 1 or v_count <> 3 then
    raise exception 'same client did not share one stable bucket across tokens/slugs: rows %, count %', v_rows, v_count;
  end if;

  if exists (
    select 1 from public.pos_rpc_rate_limits
    where license_key = 'ecommerce-tracking:' || v_license_id::text
      and scope = 'ECOMMERCE_ORDER_TRACKING_TOKEN'
  ) then
    raise exception 'invalid tokens created valid-token buckets';
  end if;

  perform set_config('request.headers', '{"x-real-ip":"203.0.113.11"}', true);
  v_client_b := private.ecommerce_tracking_client_identity_v1()->>'fingerprint';
  perform public.ecommerce_get_order_tracking(v_slug, 'trk1_' || repeat('D', 43));
  if v_client_b = v_client_a then
    raise exception 'different clients share a bucket';
  end if;
  if not exists (
    select 1 from public.pos_rpc_rate_limits
    where license_key = 'ecommerce-tracking-client:v1'
      and device_fingerprint = v_client_b
      and scope = 'ECOMMERCE_ORDER_TRACKING_CLIENT'
  ) then
    raise exception 'second client bucket missing';
  end if;

  perform set_config('request.headers', '{}', true);
  if private.ecommerce_tracking_client_identity_v1()->>'fingerprint' <> 'tracking-client:anonymous' then
    raise exception 'missing headers did not use anonymous fallback';
  end if;

  perform set_config('request.headers', '{"cf-connecting-ip":"203.0.113.10"}', true);
  v_result := public.ecommerce_get_order_tracking(v_missing_slug, 'trk1_' || repeat('E', 43));
  if v_result <> v_not_found then
    raise exception 'missing portal contract differs from not-found: %', v_result;
  end if;

  v_tracking_secret := private.ecommerce_tracking_token_for_order_v1(v_order_id);
  v_tracking_token := v_tracking_secret->>'token';
  if v_tracking_token is null then
    raise exception 'valid tracking token was not created';
  end if;

  v_result := public.ecommerce_get_order_tracking(v_slug, v_tracking_token);
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'valid tracking failed: %', v_result;
  end if;
  if not exists (
    select 1 from public.pos_rpc_rate_limits
    where license_key = 'ecommerce-tracking:' || v_license_id::text
      and scope = 'ECOMMERCE_ORDER_TRACKING_TOKEN'
      and device_fingerprint like 'tracking-token:%'
  ) then
    raise exception 'valid token secondary bucket missing';
  end if;

  if exists (
    select 1 from public.pos_rpc_rate_limits r
    where r.rpc_name = 'ecommerce_get_order_tracking'
      and (
        r.device_fingerprint like '%203.0.113.%'
        or r.metadata::text ilike '%203.0.113.%'
        or r.metadata::text ilike '%authorization%'
        or r.metadata::text ilike '%cookie%'
        or r.metadata::text ilike '%must-not-persist%'
        or r.metadata::text like '%' || v_tracking_token || '%'
      )
  ) then
    raise exception 'rate-limit storage contains plaintext IP, headers or token';
  end if;

  update public.pos_rpc_rate_limits
  set blocked_until = now() + interval '5 minutes', updated_at = now()
  where license_key = 'ecommerce-tracking-client:v1'
    and device_fingerprint = v_client_a
    and scope = 'ECOMMERCE_ORDER_TRACKING_CLIENT';
  v_result := public.ecommerce_get_order_tracking(v_slug, v_tracking_token);
  if v_result <> v_not_found then
    raise exception 'client rate-limit response is distinguishable: %', v_result;
  end if;

  update public.pos_rpc_rate_limits
  set blocked_until = null, updated_at = now()
  where license_key = 'ecommerce-tracking-client:v1'
    and device_fingerprint = v_client_a
    and scope = 'ECOMMERCE_ORDER_TRACKING_CLIENT';
  update public.pos_rpc_rate_limits
  set blocked_until = now() + interval '5 minutes', updated_at = now()
  where license_key = 'ecommerce-tracking:' || v_license_id::text
    and device_fingerprint = 'tracking-portal:' || v_portal_id::text
    and scope = 'ECOMMERCE_ORDER_TRACKING_PORTAL';
  v_result := public.ecommerce_get_order_tracking(v_slug, v_tracking_token);
  if v_result <> v_not_found then
    raise exception 'portal rate-limit response is distinguishable: %', v_result;
  end if;

  update public.pos_rpc_rate_limits
  set blocked_until = null, updated_at = now()
  where license_key = 'ecommerce-tracking:' || v_license_id::text
    and device_fingerprint = 'tracking-portal:' || v_portal_id::text
    and scope = 'ECOMMERCE_ORDER_TRACKING_PORTAL';
  update public.ecommerce_portals set status = 'paused', updated_at = now() where id = v_portal_id;
  v_result := public.ecommerce_get_order_tracking(v_slug, v_tracking_token);
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result#>>'{tracking,storefrontAvailable}')::boolean, true) is not false then
    raise exception 'paused portal valid tracking regression: %', v_result;
  end if;
  update public.ecommerce_portals set status = 'published', updated_at = now() where id = v_portal_id;

  -- POS: one authorization/rate-limit entry per public operation.
  delete from public.pos_rpc_rate_limits
  where license_key = v_key
    and device_fingerprint = v_fingerprint
    and scope = 'ECOM_ORDERS';

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_key, v_fingerprint, v_security_token, null,
    v_order_id, 'ecom22-claim'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'claim failed: %', v_result;
  end if;
  select pos_claim_token into v_claim_token from public.ecommerce_orders where id = v_order_id;
  select coalesce(sum(request_count), 0) into v_count
  from public.pos_rpc_rate_limits
  where license_key = v_key and device_fingerprint = v_fingerprint
    and rpc_name = 'ecommerce_admin_claim_pos_draft' and scope = 'ECOM_ORDERS';
  if v_count <> 1 then raise exception 'claim authorization count: %', v_count; end if;

  v_result := public.ecommerce_admin_confirm_pos_draft(
    v_key, v_fingerprint, v_security_token, null,
    v_order_id, v_claim_token, v_draft_id
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'confirm failed: %', v_result;
  end if;
  select coalesce(sum(request_count), 0) into v_count
  from public.pos_rpc_rate_limits
  where license_key = v_key and device_fingerprint = v_fingerprint
    and rpc_name = 'ecommerce_admin_confirm_pos_draft' and scope = 'ECOM_ORDERS';
  if v_count <> 1 then raise exception 'confirm authorization count: %', v_count; end if;

  v_conversion_key := 'ecommerce:' || v_order_id::text;
  v_result := public.ecommerce_begin_pos_conversion(
    v_key, v_fingerprint, v_security_token, null,
    v_order_id, v_claim_token, v_draft_id,
    v_attempt_id, v_draft_id, v_conversion_key
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'begin conversion failed: %', v_result;
  end if;
  select coalesce(sum(request_count), 0) into v_count
  from public.pos_rpc_rate_limits
  where license_key = v_key and device_fingerprint = v_fingerprint
    and rpc_name = 'ecommerce_begin_pos_conversion' and scope = 'ECOM_ORDERS';
  if v_count <> 1 then raise exception 'begin authorization count: %', v_count; end if;

  v_result := public.ecommerce_complete_pos_conversion(
    v_key, v_fingerprint, v_security_token, null,
    v_order_id, v_claim_token, v_draft_id,
    v_attempt_id, v_draft_id, v_conversion_key
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'complete conversion failed: %', v_result;
  end if;
  select coalesce(sum(request_count), 0) into v_count
  from public.pos_rpc_rate_limits
  where license_key = v_key and device_fingerprint = v_fingerprint
    and rpc_name = 'ecommerce_complete_pos_conversion' and scope = 'ECOM_ORDERS';
  if v_count <> 1 then raise exception 'complete authorization count: %', v_count; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_key, v_fingerprint, v_security_token, null,
    v_terminal_id, 'ecom22-terminal-claim'
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL' then
    raise exception 'terminal claim was not blocked: %', v_result;
  end if;
  select coalesce(sum(request_count), 0) into v_count
  from public.pos_rpc_rate_limits
  where license_key = v_key and device_fingerprint = v_fingerprint
    and rpc_name = 'ecommerce_admin_claim_pos_draft' and scope = 'ECOM_ORDERS';
  if v_count <> 2 then raise exception 'terminal claim double consumption: %', v_count; end if;

  -- Static hardening and unchanged cleanup/read policy.
  if not exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='ecommerce_orders'
      and t.tgname='ecommerce_orders_block_terminal_pos_mutation' and t.tgenabled='O'
  ) then
    raise exception 'terminal trigger is not enabled';
  end if;

  if has_function_privilege('anon', 'private.ecommerce_admin_claim_pos_draft_authorized_v1(jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_admin_claim_pos_draft_authorized_v1(jsonb,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb,uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.ecommerce_begin_pos_conversion_authorized_v1(jsonb,uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_begin_pos_conversion_authorized_v1(jsonb,uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.ecommerce_complete_pos_conversion_authorized_v1(jsonb,uuid,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.ecommerce_complete_pos_conversion_authorized_v1(jsonb,uuid,uuid,text,text,text,text)', 'EXECUTE') then
    raise exception 'authorized helpers have public role grants';
  end if;

  select pg_get_functiondef('public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)'::regprocedure)
  into v_definition;
  if v_definition like '%ecommerce_pos_terminal_guard_v1%' then
    raise exception 'release_pos_draft gained a terminal wrapper';
  end if;

  select pg_get_functiondef('public.ecommerce_cancel_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure)
  into v_definition;
  if v_definition like '%ecommerce_pos_terminal_guard_v1%' then
    raise exception 'cancel_pos_conversion gained a terminal wrapper';
  end if;

  select pg_get_functiondef('public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid)'::regprocedure)
  into v_definition;
  if v_definition like '%ecommerce_pos_terminal_guard_v1%' then
    raise exception 'get_pos_conversion_state gained a terminal wrapper';
  end if;
end
$test$;

rollback;
