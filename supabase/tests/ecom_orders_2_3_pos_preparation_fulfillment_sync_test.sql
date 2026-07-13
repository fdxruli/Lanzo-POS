-- ECOM.ORDERS.2.3 controlled SQL test.
-- Run after the migration. Every fixture and mutation is reverted by ROLLBACK.
begin;

do $contract_test$
declare
  v_helper_def text;
  v_confirm_def text;
  v_begin_def text;
  v_complete_def text;
begin
  if to_regprocedure('private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders,text,text,text)') is null then
    raise exception 'ECOM.ORDERS.2.3 helper is missing';
  end if;

  select lower(pg_get_functiondef(
    'private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders,text,text,text)'::regprocedure
  )) into v_helper_def;
  select lower(pg_get_functiondef(
    'private.ecommerce_admin_confirm_pos_draft_authorized_v1(jsonb,uuid,uuid,text)'::regprocedure
  )) into v_confirm_def;
  select lower(pg_get_functiondef(
    'private.ecommerce_begin_pos_conversion_authorized_v1(jsonb,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_begin_def;
  select lower(pg_get_functiondef(
    'private.ecommerce_complete_pos_conversion_authorized_v1(jsonb,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_complete_def;

  if v_helper_def not like '%security definer%'
     or v_helper_def not like '%set search_path to ''''%' then
    raise exception 'helper must be SECURITY DEFINER with empty search_path';
  end if;
  if v_helper_def not like '%fulfillment_status = ''preparing''%'
     or v_helper_def not like '%fulfillment_status = ''accepted''%'
     or v_helper_def not like '%pos_draft_status = ''prepared''%' then
    raise exception 'helper must only advance the exact prepared/accepted state';
  end if;
  if v_helper_def not like '%''source'', ''pos_draft_prepared''%'
     or v_helper_def like '%claimtoken%'
     or v_helper_def like '%securitytoken%' then
    raise exception 'fulfillment event source or payload hardening is missing';
  end if;
  if v_confirm_def not like '%for update%'
     or v_confirm_def not like '%ecommerce_ensure_pos_preparing_fulfillment_v1%' then
    raise exception 'POS confirmation must use the locked fulfillment helper';
  end if;
  if v_begin_def not like '%ecommerce_ensure_pos_preparing_fulfillment_v1%'
     or v_complete_def not like '%ecommerce_ensure_pos_preparing_fulfillment_v1%' then
    raise exception 'conversion recovery must use the fulfillment helper';
  end if;

  if has_function_privilege('public', 'private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders,text,text,text)', 'execute')
     or has_function_privilege('anon', 'private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'private.ecommerce_ensure_pos_preparing_fulfillment_v1(public.ecommerce_orders,text,text,text)', 'execute') then
    raise exception 'private helper is executable by a client role';
  end if;
end;
$contract_test$;

do $behavior_test$
declare
  v_order public.ecommerce_orders%rowtype;
  v_order_id uuid;
  v_license_id uuid;
  v_auth jsonb;
  v_claim_token uuid;
  v_version bigint;
  v_result jsonb;
  v_private_before bigint;
  v_public_before bigint;
  v_private_after bigint;
  v_public_after bigint;
  v_status text;
  v_draft_id text := 'ecom-orders-2-3-sql-draft';
  v_attempt_id text := 'ecom-orders-2-3-sql-attempt';
  v_sale_id text := 'ecom-orders-2-3-sql-sale';
  v_conversion_key text;
begin
  select o.* into v_order
  from public.ecommerce_orders o
  order by o.created_at, o.id
  limit 1
  for update;
  if v_order.id is null then
    raise exception 'ECOM.ORDERS.2.3 requires one ecommerce order fixture';
  end if;

  v_order_id := v_order.id;
  v_license_id := v_order.license_id;
  v_auth := jsonb_build_object(
    'success', true,
    'license_id', v_license_id,
    'device_id', 'sql-ecom-orders-2-3-device',
    'actor_type', 'admin',
    'actor_label', 'SQL test'
  );
  v_version := coalesce((select max(version) from private.ecommerce_order_fulfillment_events where order_id = v_order_id), 0) + 100;

  -- Normal confirmation: claimed -> prepared and accepted -> preparing.
  v_claim_token := extensions.gen_random_uuid();
  update public.ecommerce_orders
  set status = 'accepted',
      converted_sale_id = null,
      converted_at = null,
      pos_visibility_status = 'visible',
      pos_draft_status = 'claimed',
      pos_draft_id = null,
      pos_claim_token = v_claim_token,
      pos_claim_request_key = 'ecom-orders-2-3-normal',
      pos_claimed_at = now(),
      pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin',
      pos_claim_actor_ref = 'sql-ecom-orders-2-3-device',
      pos_draft_prepared_at = null,
      pos_conversion_status = 'idle',
      pos_conversion_attempt_id = null,
      pos_conversion_sale_id = null,
      pos_conversion_key = null,
      pos_conversion_actor_ref = null,
      pos_conversion_started_at = null,
      fulfillment_status = 'accepted',
      fulfillment_version = v_version,
      fulfillment_updated_at = now(),
      public_status_message = 'Keep this public message'
  where id = v_order_id;

  select count(*) into v_private_before
  from private.ecommerce_order_fulfillment_events
  where order_id = v_order_id;
  select count(*) into v_public_before
  from public.ecommerce_order_events
  where order_id = v_order_id
    and event_type = 'order_fulfillment_preparing';

  v_result := private.ecommerce_admin_confirm_pos_draft_authorized_v1(
    v_auth, v_order_id, v_claim_token, v_draft_id
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, false) is not true then
    raise exception 'normal POS confirmation failed: %', v_result;
  end if;
  if exists (
    select 1 from public.ecommerce_orders o
    where o.id = v_order_id and (
      o.pos_draft_status <> 'prepared'
      or o.fulfillment_status <> 'preparing'
      or o.fulfillment_version <> v_version + 1
      or o.public_status_message <> 'Keep this public message'
      or o.status <> 'accepted'
      or o.pos_conversion_status <> 'idle'
      or o.converted_sale_id is not null
    )
  ) then
    raise exception 'normal POS confirmation did not preserve the required state split';
  end if;
  select count(*) into v_private_after
  from private.ecommerce_order_fulfillment_events
  where order_id = v_order_id;
  select count(*) into v_public_after
  from public.ecommerce_order_events
  where order_id = v_order_id
    and event_type = 'order_fulfillment_preparing';
  if v_private_after <> v_private_before + 1 or v_public_after <> v_public_before + 1 then
    raise exception 'normal POS confirmation did not write exactly one fulfillment event pair';
  end if;
  if exists (
    select 1
    from public.ecommerce_order_events e
    where e.order_id = v_order_id
      and e.event_type = 'order_fulfillment_preparing'
      and e.payload->>'version' = (v_version + 1)::text
      and (
        e.payload->>'source' <> 'pos_draft_prepared'
        or e.payload ? 'claimToken'
        or e.payload ? 'securityToken'
      )
  ) then
    raise exception 'POS fulfillment event contract is unsafe or incomplete';
  end if;

  -- Replay: identical POS confirmation is a read-only idempotent success.
  v_result := private.ecommerce_admin_confirm_pos_draft_authorized_v1(
    v_auth, v_order_id, v_claim_token, v_draft_id
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, true) is true then
    raise exception 'POS confirmation replay is not idempotent: %', v_result;
  end if;
  if (select fulfillment_version from public.ecommerce_orders where id = v_order_id) <> v_version + 1
     or (select count(*) from private.ecommerce_order_fulfillment_events where order_id = v_order_id) <> v_private_after
     or (select count(*) from public.ecommerce_order_events where order_id = v_order_id and event_type = 'order_fulfillment_preparing') <> v_public_after then
    raise exception 'POS confirmation replay changed fulfillment version or events';
  end if;

  -- A late confirmation never regresses preparing, ready, or out_for_delivery.
  foreach v_status in array array['preparing', 'ready', 'out_for_delivery']
  loop
    v_version := v_version + 10;
    v_claim_token := extensions.gen_random_uuid();
    update public.ecommerce_orders
    set pos_draft_status = 'claimed', pos_draft_id = null,
        pos_claim_token = v_claim_token,
        pos_claim_request_key = 'ecom-orders-2-3-late-' || v_version,
        pos_claimed_at = now(), pos_claim_expires_at = now() + interval '1 hour',
        pos_claim_actor_type = 'admin', pos_claim_actor_ref = 'sql-ecom-orders-2-3-device',
        pos_draft_prepared_at = null,
        fulfillment_status = v_status,
        fulfillment_version = v_version
    where id = v_order_id;

    if (select fulfillment_status from public.ecommerce_orders where id = v_order_id) is distinct from v_status then
      raise exception 'late fixture status was not applied';
    end if;

    select count(*) into v_private_before from private.ecommerce_order_fulfillment_events where order_id = v_order_id;
    v_result := private.ecommerce_admin_confirm_pos_draft_authorized_v1(v_auth, v_order_id, v_claim_token, v_draft_id);
    if coalesce((v_result->>'success')::boolean, false) is not true then
      raise exception 'late confirmation failed: %', v_result;
    end if;
    if (select fulfillment_version from public.ecommerce_orders where id = v_order_id) <> v_version
       or (select fulfillment_status from public.ecommerce_orders where id = v_order_id) <> v_status
       or (select count(*) from private.ecommerce_order_fulfillment_events where order_id = v_order_id) <> v_private_before then
      raise exception 'late confirmation changed fulfillment version or event count';
    end if;
  end loop;
  if (select fulfillment_status from public.ecommerce_orders where id = v_order_id) <> 'out_for_delivery' then
    raise exception 'late POS confirmation regressed out_for_delivery';
  end if;

  -- Existing terminal guards remain fail-closed.
  foreach v_status in array array['cancelled', 'completed']
  loop
    begin
      v_version := v_version + 10;
      v_claim_token := extensions.gen_random_uuid();
      update public.ecommerce_orders
      set pos_draft_status = 'claimed', pos_draft_id = null,
          pos_claim_token = v_claim_token,
          pos_claim_request_key = 'ecom-orders-2-3-terminal-' || v_version,
          pos_claimed_at = now(), pos_claim_expires_at = now() + interval '1 hour',
          pos_claim_actor_type = 'admin', pos_claim_actor_ref = 'sql-ecom-orders-2-3-device',
          pos_draft_prepared_at = null,
          fulfillment_status = v_status,
          fulfillment_version = v_version
      where id = v_order_id;
      v_result := private.ecommerce_admin_confirm_pos_draft_authorized_v1(v_auth, v_order_id, v_claim_token, v_draft_id);
      if v_result->>'code' <> 'ECOMMERCE_ORDER_FULFILLMENT_TERMINAL' then
        raise exception 'terminal POS confirmation was not blocked: %', v_result;
      end if;
      raise exception 'ECOM_ORDERS_2_3_ROLLBACK_TERMINAL_FIXTURE';
    exception
      when raise_exception then
        if sqlerrm <> 'ECOM_ORDERS_2_3_ROLLBACK_TERMINAL_FIXTURE' then
          raise;
        end if;
    end;
  end loop;

  -- Begin conversion repairs only the known legacy state and reserves atomically.
  v_version := coalesce((select max(version) from private.ecommerce_order_fulfillment_events where order_id = v_order_id), 0) + 100;
  v_claim_token := extensions.gen_random_uuid();
  v_conversion_key := 'ecommerce:' || v_order_id::text;
  update public.ecommerce_orders
  set converted_sale_id = null, converted_at = null,
      pos_draft_status = 'prepared', pos_draft_id = v_draft_id,
      pos_claim_token = v_claim_token, pos_claim_request_key = 'ecom-orders-2-3-begin',
      pos_claimed_at = now(), pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin', pos_claim_actor_ref = 'sql-ecom-orders-2-3-device',
      pos_draft_prepared_at = now(),
      pos_conversion_status = 'idle', pos_conversion_attempt_id = null,
      pos_conversion_sale_id = null, pos_conversion_key = null,
      pos_conversion_actor_ref = null, pos_conversion_started_at = null,
      fulfillment_status = 'accepted', fulfillment_version = v_version
  where id = v_order_id;
  v_result := private.ecommerce_begin_pos_conversion_authorized_v1(
    v_auth, v_order_id, v_claim_token, v_draft_id, v_attempt_id, v_draft_id, v_conversion_key
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or (select fulfillment_status from public.ecommerce_orders where id = v_order_id) <> 'preparing'
     or (select fulfillment_version from public.ecommerce_orders where id = v_order_id) <> v_version + 1
     or (select pos_conversion_status from public.ecommerce_orders where id = v_order_id) <> 'reserved' then
    raise exception 'begin conversion did not atomically repair and reserve: %', v_result;
  end if;

  -- Complete conversion retains fulfillment=preparing and never invents readiness.
  v_version := coalesce((select max(version) from private.ecommerce_order_fulfillment_events where order_id = v_order_id), 0) + 100;
  v_claim_token := extensions.gen_random_uuid();
  v_sale_id := v_draft_id;
  update public.ecommerce_orders
  set converted_sale_id = null, converted_at = null,
      pos_draft_status = 'prepared', pos_draft_id = v_draft_id,
      pos_claim_token = v_claim_token, pos_claim_request_key = 'ecom-orders-2-3-complete',
      pos_claimed_at = now(), pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin', pos_claim_actor_ref = 'sql-ecom-orders-2-3-device',
      pos_draft_prepared_at = now(),
      pos_conversion_status = 'reserved', pos_conversion_attempt_id = v_attempt_id,
      pos_conversion_sale_id = v_sale_id, pos_conversion_key = v_conversion_key,
      pos_conversion_actor_ref = 'sql-ecom-orders-2-3-device', pos_conversion_started_at = now(),
      fulfillment_status = 'accepted', fulfillment_version = v_version
  where id = v_order_id;
  v_result := private.ecommerce_complete_pos_conversion_authorized_v1(
    v_auth, v_order_id, v_claim_token, v_draft_id, v_attempt_id, v_sale_id, v_conversion_key
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or exists (
       select 1 from public.ecommerce_orders o
       where o.id = v_order_id and (
         o.status <> 'converted_to_sale'
         or o.pos_conversion_status <> 'completed'
         or o.fulfillment_status <> 'preparing'
         or o.fulfillment_version <> v_version + 1
       )
     ) then
    raise exception 'complete conversion changed fulfillment incorrectly: %', v_result;
  end if;

  -- The conservative backfill predicate covers both accepted and converted rows;
  -- the helper must repair them without touching advanced or terminal statuses.
  v_version := coalesce((select max(version) from private.ecommerce_order_fulfillment_events where order_id = v_order_id), 0) + 100;
  update public.ecommerce_orders
  set status = 'converted_to_sale', converted_sale_id = 'ecom-orders-2-3-backfill-sale',
      pos_draft_status = 'prepared', pos_draft_id = v_draft_id,
      pos_claim_token = extensions.gen_random_uuid(), pos_claim_request_key = 'ecom-orders-2-3-backfill',
      pos_claimed_at = now(), pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin', pos_claim_actor_ref = 'sql-ecom-orders-2-3-device',
      pos_draft_prepared_at = now(), pos_conversion_status = 'completed',
      fulfillment_status = 'accepted', fulfillment_version = v_version
  where id = v_order_id
  returning * into v_order;
  v_result := private.ecommerce_ensure_pos_preparing_fulfillment_v1(
    v_order, 'automation', 'ecom_orders_2_3_backfill', null
  );
  if coalesce((v_result->>'changed')::boolean, false) is not true
     or exists (
       select 1 from public.ecommerce_orders o
       where o.id = v_order_id and (
         o.status <> 'converted_to_sale'
         or o.pos_conversion_status <> 'completed'
         or o.fulfillment_status <> 'preparing'
       )
     ) then
    raise exception 'converted legacy backfill repair was not conservative';
  end if;

  -- Public fulfillment projection still distinguishes payment from fulfillment.
  select o.* into v_order from public.ecommerce_orders o where o.id = v_order_id;
  if private.ecommerce_fulfillment_public_json_v1(v_order)->>'internalStatus' <> 'preparing'
     or coalesce((private.ecommerce_fulfillment_public_json_v1(v_order)->>'paymentRegistered')::boolean, false) is not true then
    raise exception 'public projection no longer separates payment from fulfillment';
  end if;
end;
$behavior_test$;

select jsonb_build_object(
  'status', 'ECOM.ORDERS.2.3 SQL PASS',
  'normalConfirm', true,
  'replayIdempotency', true,
  'nonRegression', true,
  'terminalGuards', true,
  'beginRepair', true,
  'completePreservesFulfillment', true,
  'convertedBackfill', true,
  'rolledBack', true
) as result;

rollback;
