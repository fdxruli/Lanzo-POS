-- ECOM.POS.3.1 / ECOM.POS.3.1.1 controlled SQL contract and behavior test.
-- Ejecutar despues de aplicar las migraciones en un entorno de prueba autorizado.
-- Todas las mutaciones y fixtures se revierten con el ROLLBACK final.

begin;

do $contract_test$
declare
  v_release_def text;
  v_cancel_def text;
  v_state_def text;
  v_begin_def text;
  v_complete_def text;
  v_reserved_pos integer;
  v_update_pos integer;
begin
  select lower(pg_get_functiondef(
    'public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)'::regprocedure
  )) into v_release_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_cancel_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_cancel_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid)'::regprocedure
  )) into v_state_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_begin_def;
  select lower(pg_get_functiondef(
    'public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)'::regprocedure
  )) into v_complete_def;

  if v_release_def not like '%for update%' then
    raise exception 'admin release must lock the ecommerce order with FOR UPDATE';
  end if;
  if v_release_def not like '%ecommerce_pos_conversion_already_completed%' then
    raise exception 'admin release must reject completed conversions';
  end if;
  if v_release_def not like '%if coalesce(v_order.pos_conversion_status, ''idle'') = ''reserved'' then%' then
    raise exception 'admin release must contain an explicit fail-closed reserved branch';
  end if;
  if v_release_def not like '%ecommerce_pos_conversion_review_required%' then
    raise exception 'admin release must return review required for reserved or unknown states';
  end if;
  if v_release_def like '%private.ecommerce_pos_sale_lookup_v2%' then
    raise exception 'admin release must not use public.pos_sales absence to authorize release';
  end if;
  if v_release_def like '%pos_conversion_admin_released%' then
    raise exception 'admin release must not emit a false conversion-release audit event';
  end if;

  v_reserved_pos := strpos(
    v_release_def,
    'if coalesce(v_order.pos_conversion_status, ''idle'') = ''reserved'' then'
  );
  v_update_pos := strpos(v_release_def, 'update public.ecommerce_orders');
  if v_reserved_pos = 0 or v_update_pos = 0 or v_reserved_pos >= v_update_pos then
    raise exception 'reserved must be rejected before the release UPDATE can run';
  end if;

  if v_release_def not like '%pos_conversion_status = ''idle''%'
     or v_release_def not like '%pos_conversion_attempt_id = null%'
     or v_release_def not like '%pos_conversion_sale_id = null%'
     or v_release_def not like '%pos_conversion_key = null%'
     or v_release_def not like '%pos_conversion_actor_ref = null%'
     or v_release_def not like '%pos_conversion_started_at = null%' then
    raise exception 'idle release must leave a clean idle conversion state';
  end if;

  if v_cancel_def not like '%private.ecommerce_pos_sale_lookup_v2%' then
    raise exception 'normal controlled cancellation must preserve remote sale verification';
  end if;

  if v_state_def not like '%''contractversion'', 2%'
     or v_begin_def not like '%''contractversion'', 2%'
     or v_complete_def not like '%''contractversion'', 2%'
     or v_release_def not like '%''contractversion'', 2%' then
    raise exception 'the ecommerce conversion contract must remain at version 2';
  end if;

  if to_regprocedure('public.ecommerce_get_pos_conversion_state(text,text,text,text,uuid,uuid)') is null
     or to_regprocedure('public.ecommerce_begin_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('public.ecommerce_cancel_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)') is null
     or to_regprocedure('public.ecommerce_complete_pos_conversion(text,text,text,text,uuid,uuid,text,text,text,text)') is null then
    raise exception 'one or more required ecommerce conversion RPCs are missing';
  end if;

  if has_function_privilege(
       'anon',
       'private.ecommerce_pos_sale_lookup_v2(uuid,text,text)',
       'execute'
     )
     or has_function_privilege(
       'authenticated',
       'private.ecommerce_pos_sale_lookup_v2(uuid,text,text)',
       'execute'
     ) then
    raise exception 'private sale verification helper is executable by a client role';
  end if;

  if not has_function_privilege(
       'anon',
       'public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)',
       'execute'
     )
     or not has_function_privilege(
       'authenticated',
       'public.ecommerce_admin_release_pos_draft(text,text,text,text,uuid,uuid,text)',
       'execute'
     ) then
    raise exception 'admin release compatibility grants were not preserved';
  end if;
end;
$contract_test$;

do $behavior_test$
declare
  v_order_id uuid;
  v_license_id uuid;
  v_license_key text;
  v_admin_id uuid;
  v_admin_fingerprint text;
  v_security_token text := 'fixture-token-ecom-pos-3-1-1';
  v_claim_token uuid;
  v_attempt_id text;
  v_sale_id text;
  v_conversion_key text;
  v_remote_sale_id text;
  v_result jsonb;
  v_sale_check jsonb;
  v_before jsonb;
  v_after jsonb;
  v_release_events_before bigint;
  v_admin_release_events_before bigint;
  v_release_events_after bigint;
  v_admin_release_events_after bigint;
begin
  select o.id, o.license_id, l.license_key
  into v_order_id, v_license_id, v_license_key
  from public.ecommerce_orders o
  join public.licenses l on l.id = o.license_id
  where o.public_order_code = 'EC-00000010'
  limit 1;

  if v_order_id is null then
    raise exception 'ECOM.POS.3.1.1 ecommerce order fixture missing';
  end if;

  select d.id, d.device_fingerprint
  into v_admin_id, v_admin_fingerprint
  from public.license_devices d
  where d.license_id = v_license_id
    and d.device_role = 'admin'
    and d.is_active is true
  limit 1;

  if v_admin_id is null then
    raise exception 'ECOM.POS.3.1.1 active admin fixture missing';
  end if;

  update public.license_devices
  set security_token = v_security_token,
      previous_security_token = null
  where id = v_admin_id;

  -- Case 1: an idle prepared draft remains administratively releasable.
  v_claim_token := extensions.gen_random_uuid();
  update public.ecommerce_orders
  set status = 'accepted',
      converted_sale_id = null,
      converted_at = null,
      pos_draft_status = 'prepared',
      pos_draft_id = 'ecom-pos-idle-draft',
      pos_claim_token = v_claim_token,
      pos_claim_request_key = 'ecom-pos-idle-request',
      pos_claimed_at = now(),
      pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin',
      pos_claim_actor_ref = v_admin_id::text,
      pos_draft_prepared_at = now(),
      pos_conversion_status = 'idle',
      pos_conversion_attempt_id = null,
      pos_conversion_sale_id = null,
      pos_conversion_key = null,
      pos_conversion_actor_ref = null,
      pos_conversion_started_at = null
  where id = v_order_id;

  select count(*) into v_release_events_before
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'order_pos_draft_released';
  select count(*) into v_admin_release_events_before
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'pos_conversion_admin_released';

  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key,
    v_admin_fingerprint,
    v_security_token,
    null,
    v_order_id,
    null,
    'sql_idle_release'
  );

  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, false) is not true
     or v_result #>> '{order,posDraft,status}' <> 'released'
     or v_result #>> '{order,posConversion,status}' is distinct from 'idle' then
    raise exception 'idle draft release failed: %', v_result;
  end if;

  if exists (
    select 1
    from public.ecommerce_orders o
    where o.id = v_order_id
      and (
        o.pos_draft_status <> 'released'
        or o.pos_draft_id is not null
        or o.pos_claim_token is not null
        or o.pos_claim_request_key is not null
        or o.pos_claimed_at is not null
        or o.pos_claim_expires_at is not null
        or o.pos_claim_actor_type is not null
        or o.pos_claim_actor_ref is not null
        or o.pos_draft_prepared_at is not null
        or coalesce(o.pos_conversion_status, 'idle') <> 'idle'
      )
  ) then
    raise exception 'idle release did not clear draft and claim atomically';
  end if;

  select count(*) into v_release_events_after
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'order_pos_draft_released';
  select count(*) into v_admin_release_events_after
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'pos_conversion_admin_released';

  if v_release_events_after <> v_release_events_before + 1 then
    raise exception 'idle release did not create order_pos_draft_released';
  end if;
  if v_admin_release_events_after <> v_admin_release_events_before then
    raise exception 'idle release created pos_conversion_admin_released unexpectedly';
  end if;

  -- Case 6: an already released idle draft remains idempotent and unaudited.
  v_release_events_before := v_release_events_after;
  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key,
    v_admin_fingerprint,
    v_security_token,
    null,
    v_order_id,
    null,
    'sql_idle_retry'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true
     or coalesce((v_result->>'changed')::boolean, true) is true
     or coalesce((v_result->>'idempotent')::boolean, false) is not true then
    raise exception 'released idle draft is not idempotent: %', v_result;
  end if;
  if (select count(*) from public.ecommerce_order_events
      where order_id = v_order_id and event_type = 'order_pos_draft_released')
     <> v_release_events_before then
    raise exception 'idempotent release created duplicate audit';
  end if;

  -- Case 2: reserved without a remote sale is always blocked and unchanged.
  v_claim_token := extensions.gen_random_uuid();
  v_attempt_id := 'attempt-no-remote-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_sale_id := 'sale-no-remote-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_conversion_key := 'ecommerce:test-no-remote:' || replace(extensions.gen_random_uuid()::text, '-', '');

  v_sale_check := private.ecommerce_pos_sale_lookup_v2(v_license_id, v_sale_id, v_conversion_key);
  if coalesce((v_sale_check->>'success')::boolean, false) is not true
     or coalesce((v_sale_check->>'saleExists')::boolean, false) is true then
    raise exception 'no-remote-sale fixture is not conclusively absent: %', v_sale_check;
  end if;

  update public.ecommerce_orders
  set status = 'accepted',
      converted_sale_id = null,
      converted_at = null,
      pos_draft_status = 'prepared',
      pos_draft_id = v_sale_id,
      pos_claim_token = v_claim_token,
      pos_claim_request_key = 'ecom-pos-reserved-no-remote',
      pos_claimed_at = now(),
      pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin',
      pos_claim_actor_ref = v_admin_id::text,
      pos_draft_prepared_at = now(),
      pos_conversion_status = 'reserved',
      pos_conversion_attempt_id = v_attempt_id,
      pos_conversion_sale_id = v_sale_id,
      pos_conversion_key = v_conversion_key,
      pos_conversion_actor_ref = v_admin_id::text,
      pos_conversion_started_at = now()
  where id = v_order_id;

  select jsonb_build_object(
    'draftStatus', o.pos_draft_status,
    'draftId', o.pos_draft_id,
    'claimToken', o.pos_claim_token,
    'claimRequestKey', o.pos_claim_request_key,
    'claimedAt', o.pos_claimed_at,
    'claimExpiresAt', o.pos_claim_expires_at,
    'claimActorType', o.pos_claim_actor_type,
    'claimActorRef', o.pos_claim_actor_ref,
    'preparedAt', o.pos_draft_prepared_at,
    'conversionStatus', o.pos_conversion_status,
    'attemptId', o.pos_conversion_attempt_id,
    'saleId', o.pos_conversion_sale_id,
    'conversionKey', o.pos_conversion_key,
    'conversionActorRef', o.pos_conversion_actor_ref,
    'conversionStartedAt', o.pos_conversion_started_at
  ) into v_before
  from public.ecommerce_orders o where o.id = v_order_id;

  select count(*) into v_release_events_before
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'order_pos_draft_released';
  select count(*) into v_admin_release_events_before
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'pos_conversion_admin_released';

  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key,
    v_admin_fingerprint,
    v_security_token,
    null,
    v_order_id,
    null,
    'sql_reserved_without_remote_sale'
  );

  if coalesce((v_result->>'success')::boolean, true) is not false
     or v_result->>'code' <> 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED' then
    raise exception 'reserved without remote sale was not blocked: %', v_result;
  end if;

  select jsonb_build_object(
    'draftStatus', o.pos_draft_status,
    'draftId', o.pos_draft_id,
    'claimToken', o.pos_claim_token,
    'claimRequestKey', o.pos_claim_request_key,
    'claimedAt', o.pos_claimed_at,
    'claimExpiresAt', o.pos_claim_expires_at,
    'claimActorType', o.pos_claim_actor_type,
    'claimActorRef', o.pos_claim_actor_ref,
    'preparedAt', o.pos_draft_prepared_at,
    'conversionStatus', o.pos_conversion_status,
    'attemptId', o.pos_conversion_attempt_id,
    'saleId', o.pos_conversion_sale_id,
    'conversionKey', o.pos_conversion_key,
    'conversionActorRef', o.pos_conversion_actor_ref,
    'conversionStartedAt', o.pos_conversion_started_at
  ) into v_after
  from public.ecommerce_orders o where o.id = v_order_id;

  if v_after is distinct from v_before then
    raise exception 'reserved without remote sale mutated protected fields';
  end if;
  if (select count(*) from public.ecommerce_order_events
      where order_id = v_order_id and event_type = 'order_pos_draft_released')
       <> v_release_events_before
     or (select count(*) from public.ecommerce_order_events
      where order_id = v_order_id and event_type = 'pos_conversion_admin_released')
       <> v_admin_release_events_before then
    raise exception 'blocked reserved release created false audit';
  end if;

  -- Case 3: reserved with a remote sale is blocked exactly the same way.
  select coalesce(to_jsonb(s)->>'id', to_jsonb(s)->>'local_sale_id')
  into v_remote_sale_id
  from public.pos_sales s
  where to_jsonb(s)->>'license_id' = v_license_id::text
    and lower(coalesce(to_jsonb(s)->>'status', 'closed')) not in ('cancelled', 'deleted')
    and coalesce(to_jsonb(s)->>'id', to_jsonb(s)->>'local_sale_id') is not null
  limit 1;

  if v_remote_sale_id is null then
    raise exception 'ECOM.POS.3.1.1 remote sale fixture missing';
  end if;

  v_claim_token := extensions.gen_random_uuid();
  v_attempt_id := 'attempt-with-remote-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_conversion_key := 'ecommerce:test-with-remote:' || replace(extensions.gen_random_uuid()::text, '-', '');

  v_sale_check := private.ecommerce_pos_sale_lookup_v2(v_license_id, v_remote_sale_id, v_conversion_key);
  if coalesce((v_sale_check->>'success')::boolean, false) is not true
     or coalesce((v_sale_check->>'saleExists')::boolean, false) is not true then
    raise exception 'remote-sale fixture was not detected: %', v_sale_check;
  end if;

  update public.ecommerce_orders
  set status = 'accepted',
      converted_sale_id = null,
      converted_at = null,
      pos_draft_status = 'prepared',
      pos_draft_id = 'ecom-pos-reserved-with-remote',
      pos_claim_token = v_claim_token,
      pos_claim_request_key = 'ecom-pos-reserved-with-remote',
      pos_claimed_at = now(),
      pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin',
      pos_claim_actor_ref = v_admin_id::text,
      pos_draft_prepared_at = now(),
      pos_conversion_status = 'reserved',
      pos_conversion_attempt_id = v_attempt_id,
      pos_conversion_sale_id = v_remote_sale_id,
      pos_conversion_key = v_conversion_key,
      pos_conversion_actor_ref = v_admin_id::text,
      pos_conversion_started_at = now()
  where id = v_order_id;

  select to_jsonb(o) - 'updated_at' into v_before
  from public.ecommerce_orders o where o.id = v_order_id;
  select count(*) into v_release_events_before
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'order_pos_draft_released';
  select count(*) into v_admin_release_events_before
  from public.ecommerce_order_events
  where order_id = v_order_id and event_type = 'pos_conversion_admin_released';

  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key,
    v_admin_fingerprint,
    v_security_token,
    null,
    v_order_id,
    null,
    'sql_reserved_with_remote_sale'
  );

  if coalesce((v_result->>'success')::boolean, true) is not false
     or v_result->>'code' <> 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED' then
    raise exception 'reserved with remote sale was not blocked: %', v_result;
  end if;
  select to_jsonb(o) - 'updated_at' into v_after
  from public.ecommerce_orders o where o.id = v_order_id;
  if v_after is distinct from v_before then
    raise exception 'reserved with remote sale mutated the order';
  end if;
  if (select count(*) from public.ecommerce_order_events
      where order_id = v_order_id and event_type = 'order_pos_draft_released')
       <> v_release_events_before
     or (select count(*) from public.ecommerce_order_events
      where order_id = v_order_id and event_type = 'pos_conversion_admin_released')
       <> v_admin_release_events_before then
    raise exception 'reserved with remote sale created false audit';
  end if;

  -- Case 4: completed conversion remains immutable.
  v_sale_id := 'completed-sale-' || replace(extensions.gen_random_uuid()::text, '-', '');
  v_conversion_key := 'ecommerce:test-completed:' || replace(extensions.gen_random_uuid()::text, '-', '');
  update public.ecommerce_orders
  set status = 'converted_to_sale',
      converted_sale_id = v_sale_id,
      converted_at = now(),
      pos_draft_status = 'prepared',
      pos_draft_id = 'ecom-pos-completed-draft',
      pos_claim_token = extensions.gen_random_uuid(),
      pos_conversion_status = 'completed',
      pos_conversion_attempt_id = 'completed-attempt',
      pos_conversion_sale_id = v_sale_id,
      pos_conversion_key = v_conversion_key,
      pos_conversion_actor_ref = v_admin_id::text,
      pos_conversion_started_at = now()
  where id = v_order_id;

  select to_jsonb(o) - 'updated_at' into v_before
  from public.ecommerce_orders o where o.id = v_order_id;
  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key,
    v_admin_fingerprint,
    v_security_token,
    null,
    v_order_id,
    null,
    'sql_completed_release'
  );
  if v_result->>'code' <> 'ECOMMERCE_POS_CONVERSION_ALREADY_COMPLETED' then
    raise exception 'completed conversion was not protected: %', v_result;
  end if;
  select to_jsonb(o) - 'updated_at' into v_after
  from public.ecommerce_orders o where o.id = v_order_id;
  if v_after is distinct from v_before then
    raise exception 'completed conversion was mutated';
  end if;

  -- Case 5: an unexpected state is fail-closed when the test temporarily permits it.
  alter table public.ecommerce_orders
    drop constraint ecommerce_orders_pos_conversion_status_valid;

  update public.ecommerce_orders
  set status = 'accepted',
      converted_sale_id = null,
      converted_at = null,
      pos_draft_status = 'prepared',
      pos_draft_id = 'ecom-pos-unexpected-draft',
      pos_claim_token = extensions.gen_random_uuid(),
      pos_claim_request_key = 'ecom-pos-unexpected-request',
      pos_claimed_at = now(),
      pos_claim_expires_at = now() + interval '1 hour',
      pos_claim_actor_type = 'admin',
      pos_claim_actor_ref = v_admin_id::text,
      pos_draft_prepared_at = now(),
      pos_conversion_status = 'unexpected_test_state',
      pos_conversion_attempt_id = 'unexpected-attempt',
      pos_conversion_sale_id = 'unexpected-sale',
      pos_conversion_key = 'ecommerce:test-unexpected:' || replace(extensions.gen_random_uuid()::text, '-', ''),
      pos_conversion_actor_ref = v_admin_id::text,
      pos_conversion_started_at = now()
  where id = v_order_id;

  select to_jsonb(o) - 'updated_at' into v_before
  from public.ecommerce_orders o where o.id = v_order_id;
  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key,
    v_admin_fingerprint,
    v_security_token,
    null,
    v_order_id,
    null,
    'sql_unexpected_release'
  );
  if v_result->>'code' <> 'ECOMMERCE_POS_CONVERSION_REVIEW_REQUIRED' then
    raise exception 'unexpected conversion state was not fail-closed: %', v_result;
  end if;
  select to_jsonb(o) - 'updated_at' into v_after
  from public.ecommerce_orders o where o.id = v_order_id;
  if v_after is distinct from v_before then
    raise exception 'unexpected conversion state was mutated';
  end if;

  update public.ecommerce_orders
  set pos_conversion_status = 'idle',
      pos_conversion_attempt_id = null,
      pos_conversion_sale_id = null,
      pos_conversion_key = null,
      pos_conversion_actor_ref = null,
      pos_conversion_started_at = null
  where id = v_order_id;

  alter table public.ecommerce_orders
    add constraint ecommerce_orders_pos_conversion_status_valid
    check (pos_conversion_status in ('idle', 'reserved', 'completed'));
end;
$behavior_test$;

select jsonb_build_object(
  'status', 'ECOM.POS.3.1.1 SQL PASS',
  'idleRelease', true,
  'releasedIdempotency', true,
  'reservedWithoutRemoteSaleBlocked', true,
  'reservedWithRemoteSaleBlocked', true,
  'completedProtected', true,
  'unexpectedStateProtected', true,
  'falseAuditBlocked', true,
  'contractVersion', 2,
  'rolledBack', true
) as result;

rollback;
