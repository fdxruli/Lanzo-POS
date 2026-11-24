-- Block 2: additive, keyset-based initial snapshots bound to the safe
-- transactional frontier introduced by 20261124183143.
-- Existing snapshot RPCs are intentionally left unchanged for legacy clients.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $preflight$
begin
  if to_regprocedure('private.pos_sync_safe_frontier_v1(uuid)') is null then
    raise exception 'POS_SNAPSHOT_BLOCK1_FRONTIER_REQUIRED';
  end if;
  if to_regclass('public.pos_sync_events') is null
     or to_regclass('public.pos_categories') is null
     or to_regclass('public.pos_products') is null
     or to_regclass('public.pos_product_batches') is null
     or to_regclass('public.pos_customers') is null
     or to_regclass('public.pos_customer_ledger') is null
     or to_regclass('public.pos_sales') is null
     or to_regclass('public.pos_sale_items') is null
     or to_regclass('public.pos_sale_payments') is null
     or to_regclass('public.pos_cash_sessions') is null
     or to_regclass('public.pos_cash_movements') is null then
    raise exception 'POS_SNAPSHOT_REQUIRED_TABLE_MISSING';
  end if;
  if to_regprocedure('private.pos_category_to_jsonb(pos_categories)') is null
     or to_regprocedure('private.pos_product_to_jsonb(pos_products)') is null
     or to_regprocedure('private.pos_product_batch_to_jsonb(pos_product_batches)') is null
     or to_regprocedure('private.pos_customer_to_jsonb(pos_customers)') is null
     or to_regprocedure('private.pos_customer_ledger_to_jsonb(pos_customer_ledger)') is null
     or to_regprocedure('private.pos_sale_to_jsonb(pos_sales)') is null
     or to_regprocedure('private.pos_sale_item_to_jsonb(pos_sale_items)') is null
     or to_regprocedure('private.pos_sale_payment_to_jsonb(pos_sale_payments)') is null
     or to_regprocedure('private.pos_cash_session_to_jsonb(pos_cash_sessions)') is null
     or to_regprocedure('private.pos_cash_movement_to_jsonb(pos_cash_movements)') is null then
    raise exception 'POS_SNAPSHOT_REQUIRED_PROJECTION_MISSING';
  end if;
end;
$preflight$;

-- Capture once from Block 1. A page may reuse a reference only while it is at
-- or below the currently safe frontier. Pending writers do not make the
-- snapshot wait; the response carries sync_deferred for the existing #592
-- recovery path.
create or replace function private.pos_snapshot_reference_v1(
  p_license_id uuid,
  p_requested_reference bigint default null
)
returns table(
  snapshot_reference_change_seq bigint,
  safe_change_seq bigint,
  sync_deferred boolean
)
language plpgsql volatile security invoker set search_path = ''
as $function$
declare
  v_safe bigint;
  v_deferred boolean;
begin
  if p_license_id is null then
    raise exception 'POS_SNAPSHOT_LICENSE_REQUIRED' using errcode = '22004';
  end if;
  if p_requested_reference is not null and p_requested_reference < 0 then
    raise exception 'POS_SNAPSHOT_REFERENCE_INVALID' using errcode = '22023';
  end if;
  select f.safe_change_seq, f.sync_deferred
    into v_safe, v_deferred
    from private.pos_sync_safe_frontier_v1(p_license_id) f;
  if v_safe is null then
    raise exception 'POS_SNAPSHOT_FRONTIER_UNAVAILABLE' using errcode = '55000';
  end if;
  if p_requested_reference is not null and p_requested_reference > v_safe then
    raise exception 'POS_SNAPSHOT_REFERENCE_AHEAD_OF_SAFE_FRONTIER' using errcode = '22023';
  end if;
  snapshot_reference_change_seq := coalesce(p_requested_reference, v_safe);
  safe_change_seq := v_safe;
  sync_deferred := coalesce(v_deferred, false);
  return next;
end;
$function$;

-- Rows already represented at the reference remain eligible even when their
-- current projection changes during paging. Rows with only post-reference
-- events are left for the incremental pull. Rows without event history are
-- treated as legacy baseline rows. Sale/session roots include related events
-- because older writers can register child/movement events in the same scope.
create or replace function private.pos_snapshot_member_at_reference_v1(
  p_license_id uuid,
  p_entity_type text,
  p_entity_id text,
  p_reference bigint
)
returns boolean
language sql stable security invoker set search_path = ''
as $function$
  select
    not exists (
      select 1
        from public.pos_sync_events e
       where e.license_id = p_license_id
         and (
           (p_entity_type in ('category','product','product_batch','customer','customer_ledger','cash_movement')
             and e.entity_type = p_entity_type and e.entity_id = p_entity_id)
           or (p_entity_type = 'sale' and (
             (e.entity_type = 'sale' and e.entity_id = p_entity_id)
             or (e.entity_type in ('sale_item','sale_payment') and e.metadata->>'sale_id' = p_entity_id)
           ))
           or (p_entity_type = 'cash_session' and (
             (e.entity_type = 'cash_session' and e.entity_id = p_entity_id)
             or (e.entity_type = 'cash_movement' and e.metadata->>'cash_session_id' = p_entity_id)
           ))
         )
    )
    or exists (
      select 1
        from public.pos_sync_events e
       where e.license_id = p_license_id
         and e.change_seq <= p_reference
         and (
           (p_entity_type in ('category','product','product_batch','customer','customer_ledger','cash_movement')
             and e.entity_type = p_entity_type and e.entity_id = p_entity_id)
           or (p_entity_type = 'sale' and (
             (e.entity_type = 'sale' and e.entity_id = p_entity_id)
             or (e.entity_type in ('sale_item','sale_payment') and e.metadata->>'sale_id' = p_entity_id)
           ))
           or (p_entity_type = 'cash_session' and (
             (e.entity_type = 'cash_session' and e.entity_id = p_entity_id)
             or (e.entity_type = 'cash_movement' and e.metadata->>'cash_session_id' = p_entity_id)
           ))
         )
    )
$function$;

-- Cursors bind the tenant, reference and query scope to prevent accidental
-- reuse across tenants or differently filtered traversals. They are not an
-- authorization credential; every page revalidates its RPC context and
-- tenant filters. A cursor can never grant access outside that tenant.
create or replace function private.pos_snapshot_decode_cursor_v1(
  p_cursor jsonb,
  p_license_id uuid,
  p_reference bigint,
  p_scope_hash text,
  p_min_rank integer,
  p_max_rank integer
)
returns table(position_rank integer, position_id text)
language plpgsql immutable security invoker set search_path = ''
as $function$
declare
  v_rank integer;
  v_reference bigint;
  v_license_id text;
  v_id text;
begin
  if p_cursor is null then
    position_rank := 0;
    position_id := null;
    return next;
    return;
  end if;
  if jsonb_typeof(p_cursor) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_cursor)) <> 6
     or p_cursor->>'version' is distinct from '1'
     or p_cursor->>'scope_hash' is distinct from p_scope_hash then
    raise exception 'POS_SNAPSHOT_PAGE_CURSOR_INVALID' using errcode = '22023';
  end if;
  begin
    v_rank := (p_cursor->>'position_rank')::integer;
    v_reference := (p_cursor->>'snapshot_reference_change_seq')::bigint;
    v_license_id := p_cursor->>'license_id';
    v_id := p_cursor->>'position_id';
  exception when others then
    raise exception 'POS_SNAPSHOT_PAGE_CURSOR_INVALID' using errcode = '22023';
  end;
  if v_rank is null or v_rank < p_min_rank or v_rank > p_max_rank
     or v_reference is distinct from p_reference
     or v_license_id is distinct from p_license_id::text
     or nullif(v_id, '') is null then
    raise exception 'POS_SNAPSHOT_PAGE_CURSOR_INVALID' using errcode = '22023';
  end if;
  position_rank := v_rank;
  position_id := v_id;
  return next;
end;
$function$;

create or replace function private.pos_snapshot_build_cursor_v1(
  p_license_id uuid,
  p_reference bigint,
  p_scope_hash text,
  p_position_rank integer,
  p_position_id text
)
returns jsonb
language sql immutable security invoker set search_path = ''
as $function$
  select jsonb_build_object(
    'version', 1,
    'license_id', p_license_id::text,
    'snapshot_reference_change_seq', p_reference,
    'scope_hash', p_scope_hash,
    'position_rank', p_position_rank,
    'position_id', p_position_id
  )
$function$;

create or replace function private.pos_snapshot_scope_hash_v1(
  p_context jsonb,
  p_scope_key text
)
returns text
language sql immutable security invoker set search_path = ''
as $function$
  select pg_catalog.md5(
    coalesce(p_context->>'license_id', '') || E'\n' ||
    coalesce(p_context->>'device_id', '') || E'\n' ||
    coalesce(p_context->>'actor_type', '') || E'\n' ||
    coalesce(p_context->>'actor_id', '') || E'\n' ||
    coalesce(p_context->>'actor_session_id', '') || E'\n' ||
    coalesce(p_context->>'actor_permissions', '{}') || E'\n' ||
    coalesce(p_scope_key, '')
  )
$function$;

create or replace function public.pos_pull_product_catalog_snapshot_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_snapshot_reference_change_seq bigint default null,
  p_page_cursor jsonb default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_limit integer := coalesce(p_limit, 500);
  v_reference bigint;
  v_safe bigint;
  v_deferred boolean;
  v_scope_hash text;
  v_position_rank integer := 0;
  v_position_id text;
  v_categories jsonb := '[]'::jsonb;
  v_products jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb;
begin
  if v_limit < 1 or v_limit > 500 then
    raise exception 'POS_SNAPSHOT_LIMIT_INVALID' using errcode = '22023';
  end if;
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_product_catalog_snapshot_v2', 'SYNC_PULL', 30, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('snapshot_contract_version', 1, 'snapshot_complete', false,
                            'has_more', false, 'sync_deferred', false);
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_products_sync_enabled(v_context);
  perform private.assert_pos_products_read_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_scope_hash := private.pos_snapshot_scope_hash_v1(v_context, 'catalog:keyset-reference:v1');
  select r.snapshot_reference_change_seq, r.safe_change_seq, r.sync_deferred
    into v_reference, v_safe, v_deferred
    from private.pos_snapshot_reference_v1(v_license_id, p_snapshot_reference_change_seq) r;
  select c.position_rank, c.position_id into v_position_rank, v_position_id
    from private.pos_snapshot_decode_cursor_v1(p_page_cursor, v_license_id, v_reference, v_scope_hash, 1, 3) c;

  with candidates as (
    select 1 as rank, c.id as id, private.pos_category_to_jsonb(c) as payload
      from public.pos_categories c
     where c.license_id = v_license_id
       and (v_position_rank < 1 or (v_position_rank = 1 and c.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'category', c.id, v_reference)
    union all
    select 2, p.id, private.pos_product_to_jsonb(p)
      from public.pos_products p
     where p.license_id = v_license_id
       and (v_position_rank < 2 or (v_position_rank = 2 and p.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'product', p.id, v_reference)
    union all
    select 3, b.id, private.pos_product_batch_to_jsonb(b)
      from public.pos_product_batches b
     where b.license_id = v_license_id
       and (v_position_rank < 3 or (v_position_rank = 3 and b.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'product_batch', b.id, v_reference)
  ), lookahead as materialized (
    select * from candidates order by rank, id limit v_limit + 1
  ), delivered as materialized (
    select * from lookahead order by rank, id limit v_limit
  ), last_delivered as (
    select rank, id from delivered order by rank desc, id desc limit 1
  )
  select
    coalesce((select jsonb_agg(d.payload order by d.rank, d.id)
      from delivered d where d.rank = 1), '[]'::jsonb),
    coalesce((select jsonb_agg(d.payload order by d.rank, d.id)
      from delivered d where d.rank = 2), '[]'::jsonb),
    coalesce((select jsonb_agg(d.payload order by d.rank, d.id)
      from delivered d where d.rank = 3), '[]'::jsonb),
    (select count(*) > v_limit from lookahead),
    (select private.pos_snapshot_build_cursor_v1(v_license_id, v_reference, v_scope_hash, l.rank, l.id)
       from last_delivered l)
  into v_categories, v_products, v_batches, v_has_more, v_cursor;

  return jsonb_build_object(
    'success', true,
    'snapshot_contract', 'keyset_reference_v1',
    'snapshot_contract_version', 1,
    'snapshot_reference_change_seq', v_reference,
    'safe_change_seq', v_safe,
    'sync_deferred', v_deferred,
    'categories', v_categories,
    'products', v_products,
    'batches', v_batches,
    'limit', v_limit,
    'has_more', v_has_more,
    'snapshot_complete', not v_has_more,
    'next_page_cursor', case when v_has_more then v_cursor else null end
  );
end;
$function$;

create or replace function public.pos_pull_customers_snapshot_v3(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_snapshot_reference_change_seq bigint default null,
  p_page_cursor jsonb default null,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
  v_limit integer := coalesce(p_limit, 500);
  v_reference bigint;
  v_safe bigint;
  v_deferred boolean;
  v_scope_hash text;
  v_position_rank integer := 0;
  v_position_id text;
  v_customers jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract, p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_scope_hash := private.pos_snapshot_scope_hash_v1(v_context, 'customers:keyset-reference:v1');
  v_rate := private.pos_fin01_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_customers_snapshot_v3', 'SYNC_PULL', 30, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    v_payload := public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('snapshot_contract', 'keyset_reference_v1', 'snapshot_contract_version', 1,
                            'snapshot_complete', false, 'has_more', false);
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customers_snapshot_v3',
      'customer_directory', v_context, v_payload, null, null, null);
  end if;
  v_limit := coalesce(p_limit, 500);
  if v_limit < 1 or v_limit > 500 then
    raise exception 'POS_SNAPSHOT_LIMIT_INVALID' using errcode = '22023';
  end if;
  select r.snapshot_reference_change_seq, r.safe_change_seq, r.sync_deferred
    into v_reference, v_safe, v_deferred
    from private.pos_snapshot_reference_v1(v_license_id, p_snapshot_reference_change_seq) r;
  select c.position_rank, c.position_id into v_position_rank, v_position_id
    from private.pos_snapshot_decode_cursor_v1(p_page_cursor, v_license_id, v_reference, v_scope_hash, 1, 1) c;
  with lookahead as materialized (
    select c.id as id, private.pos_customer_to_jsonb(c) as payload
      from public.pos_customers c
     where c.license_id = v_license_id
       and (v_position_rank < 1 or c.id > v_position_id)
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'customer', c.id, v_reference)
     order by c.id
     limit v_limit + 1
  ), delivered as materialized (
    select * from lookahead order by id limit v_limit
  ), last_delivered as (
    select id from delivered order by id desc limit 1
  )
  select
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d), '[]'::jsonb),
    (select count(*) > v_limit from lookahead),
    (select private.pos_snapshot_build_cursor_v1(v_license_id, v_reference, v_scope_hash, 1, l.id) from last_delivered l)
  into v_customers, v_has_more, v_cursor;
  v_payload := jsonb_build_object(
    'success', true,
    'snapshot_contract', 'keyset_reference_v1',
    'snapshot_contract_version', 1,
    'snapshot_reference_change_seq', v_reference,
    'safe_change_seq', v_safe,
    'sync_deferred', v_deferred,
    'customers', v_customers,
    'limit', v_limit,
    'has_more', v_has_more,
    'snapshot_complete', not v_has_more,
    'next_page_cursor', case when v_has_more then v_cursor else null end
  );
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customers_snapshot_v3',
    'customer_directory', v_context, v_payload, null, null, null);
end;
$function$;

create or replace function public.pos_pull_customer_credit_snapshot_v3(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_snapshot_reference_change_seq bigint default null,
  p_page_cursor jsonb default null,
  p_customer_id text default null,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_customer_id text := nullif(pg_catalog.btrim(coalesce(p_customer_id, '')), '');
  v_rate jsonb;
  v_payload jsonb;
  v_limit integer := coalesce(p_limit, 500);
  v_reference bigint;
  v_safe bigint;
  v_deferred boolean;
  v_scope_hash text;
  v_scope_key text;
  v_position_rank integer := 0;
  v_position_id text;
  v_ledger jsonb := '[]'::jsonb;
  v_customers jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract, p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_scope_key := 'customer_credit:keyset-reference:v1|customer=' || coalesce(v_customer_id, '*');
  v_scope_hash := private.pos_snapshot_scope_hash_v1(v_context, v_scope_key);
  v_rate := private.pos_fin01_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_customer_credit_snapshot_v3', 'SYNC_PULL', 30, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    v_payload := public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('snapshot_contract', 'keyset_reference_v1', 'snapshot_contract_version', 1,
                            'snapshot_complete', false, 'has_more', false,
                            'ledger_reconciliation_complete', false);
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_credit_snapshot_v3',
      'customer_credit', v_context, v_payload, v_customer_id, null, null);
  end if;
  if v_limit < 1 or v_limit > 500 then
    raise exception 'POS_SNAPSHOT_LIMIT_INVALID' using errcode = '22023';
  end if;
  select r.snapshot_reference_change_seq, r.safe_change_seq, r.sync_deferred
    into v_reference, v_safe, v_deferred
    from private.pos_snapshot_reference_v1(v_license_id, p_snapshot_reference_change_seq) r;
  select c.position_rank, c.position_id into v_position_rank, v_position_id
    from private.pos_snapshot_decode_cursor_v1(p_page_cursor, v_license_id, v_reference, v_scope_hash, 1, 1) c;
  with lookahead as materialized (
    select l.id as id, l.customer_id, private.pos_customer_ledger_to_jsonb(l) as payload
      from public.pos_customer_ledger l
     where l.license_id = v_license_id
       and (v_customer_id is null or l.customer_id = v_customer_id)
       and (v_position_rank < 1 or l.id > v_position_id)
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'customer_ledger', l.id, v_reference)
     order by l.id
     limit v_limit + 1
  ), delivered as materialized (
    select * from lookahead order by id limit v_limit
  ), last_delivered as (
    select id from delivered order by id desc limit 1
  ), related_customer_ids as (
    select distinct d.customer_id from delivered d
    union select v_customer_id where v_customer_id is not null
  )
  select
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_customer_to_jsonb(c) order by c.id)
      from public.pos_customers c join related_customer_ids r on r.customer_id = c.id
     where c.license_id = v_license_id), '[]'::jsonb),
    (select count(*) > v_limit from lookahead),
    (select private.pos_snapshot_build_cursor_v1(v_license_id, v_reference, v_scope_hash, 1, l.id) from last_delivered l)
  into v_ledger, v_customers, v_has_more, v_cursor;
  v_payload := jsonb_build_object(
    'success', true,
    'snapshot_contract', 'keyset_reference_v1',
    'snapshot_contract_version', 1,
    'snapshot_reference_change_seq', v_reference,
    'safe_change_seq', v_safe,
    'sync_deferred', v_deferred,
    'ledger_entries', v_ledger,
    'customers', v_customers,
    'customer_id', v_customer_id,
    'limit', v_limit,
    'has_more', v_has_more,
    'snapshot_complete', not v_has_more,
    'ledger_reconciliation_complete', not v_has_more,
    'next_page_cursor', case when v_has_more then v_cursor else null end
  );
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_credit_snapshot_v3',
    'customer_credit', v_context, v_payload, v_customer_id, null, null);
end;
$function$;

create or replace function public.pos_pull_sales_snapshot_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_limit integer default 500,
  p_snapshot_reference_change_seq bigint default null,
  p_page_cursor jsonb default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_staff_user_id uuid;
  v_rate jsonb;
  v_limit integer := coalesce(p_limit, 500);
  v_reference bigint;
  v_safe bigint;
  v_deferred boolean;
  v_scope_key text;
  v_scope_hash text;
  v_position_rank integer := 0;
  v_position_id text;
  v_sales jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_payments jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb;
begin
  if v_limit < 1 or v_limit > 500 then
    raise exception 'POS_SNAPSHOT_LIMIT_INVALID' using errcode = '22023';
  end if;
  if p_date_from is not null and p_date_to is not null and p_date_from >= p_date_to then
    raise exception 'POS_SNAPSHOT_DATE_RANGE_INVALID' using errcode = '22023';
  end if;
  v_scope_key := 'sales:keyset-reference:v1|from='
    || coalesce(pg_catalog.to_char(p_date_from at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '*')
    || '|to='
    || coalesce(pg_catalog.to_char(p_date_to at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), '*');
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_sales_snapshot_v2', 'SYNC_PULL', 30, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('snapshot_contract', 'keyset_reference_v1', 'snapshot_contract_version', 1,
                            'snapshot_complete', false, 'has_more', false, 'sync_deferred', false);
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_sales_sync_base_enabled(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := (v_context->>'device_id')::uuid;
  v_staff_user_id := nullif(v_context->>'staff_user_id', '')::uuid;
  v_scope_hash := private.pos_snapshot_scope_hash_v1(v_context, v_scope_key);
  select r.snapshot_reference_change_seq, r.safe_change_seq, r.sync_deferred
    into v_reference, v_safe, v_deferred
    from private.pos_snapshot_reference_v1(v_license_id, p_snapshot_reference_change_seq) r;
  select c.position_rank, c.position_id into v_position_rank, v_position_id
    from private.pos_snapshot_decode_cursor_v1(p_page_cursor, v_license_id, v_reference, v_scope_hash, 1, 1) c;
  with lookahead as materialized (
    select s.id as id, private.pos_sale_to_jsonb(s) as payload
      from public.pos_sales s
     where s.license_id = v_license_id
       and (p_date_from is null or s.sold_at >= p_date_from)
       and (p_date_to is null or s.sold_at < p_date_to)
       and (v_position_rank < 1 or s.id > v_position_id)
       and (
         coalesce(v_context->>'device_role', 'staff') <> 'staff'
         or private.has_pos_permission(v_context, 'reports')
         or s.staff_user_id = v_staff_user_id
         or s.device_id = v_device_id
       )
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'sale', s.id, v_reference)
     order by s.id
     limit v_limit + 1
  ), delivered as materialized (
    select * from lookahead order by id limit v_limit
  ), last_delivered as (
    select id from delivered order by id desc limit 1
  ), delivered_ids as (
    select id from delivered
  )
  select
    coalesce((select jsonb_agg(d.payload order by d.id) from delivered d), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_sale_item_to_jsonb(i) order by i.sale_id, i.id)
      from public.pos_sale_items i where i.license_id = v_license_id and i.sale_id in (select id from delivered_ids)), '[]'::jsonb),
    coalesce((select jsonb_agg(private.pos_sale_payment_to_jsonb(p) order by p.sale_id, p.id)
      from public.pos_sale_payments p where p.license_id = v_license_id and p.sale_id in (select id from delivered_ids)), '[]'::jsonb),
    (select count(*) > v_limit from lookahead),
    (select private.pos_snapshot_build_cursor_v1(v_license_id, v_reference, v_scope_hash, 1, l.id) from last_delivered l)
  into v_sales, v_items, v_payments, v_has_more, v_cursor;
  return jsonb_build_object(
    'success', true,
    'snapshot_contract', 'keyset_reference_v1',
    'snapshot_contract_version', 1,
    'snapshot_reference_change_seq', v_reference,
    'safe_change_seq', v_safe,
    'sync_deferred', v_deferred,
    'sales', v_sales,
    'items', v_items,
    'payments', v_payments,
    'scope', jsonb_build_object('date_from', p_date_from, 'date_to', p_date_to,
      'visibility', case when coalesce(v_context->>'device_role', 'staff') = 'staff'
                         and not private.has_pos_permission(v_context, 'reports')
                         then 'actor' else 'authorized' end),
    'limit', v_limit,
    'has_more', v_has_more,
    'snapshot_complete', not v_has_more,
    'next_page_cursor', case when v_has_more then v_cursor else null end
  );
end;
$function$;

create or replace function public.pos_pull_cash_snapshot_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_scope text default 'mine',
  p_limit integer default 100,
  p_snapshot_reference_change_seq bigint default null,
  p_page_cursor jsonb default null
)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_actor_key text;
  v_rate jsonb;
  v_limit integer := coalesce(p_limit, 100);
  v_scope text := lower(coalesce(nullif(pg_catalog.btrim(p_scope), ''), 'mine'));
  v_reference bigint;
  v_safe bigint;
  v_deferred boolean;
  v_scope_hash text;
  v_position_rank integer := 0;
  v_position_id text;
  v_sessions jsonb := '[]'::jsonb;
  v_movements jsonb := '[]'::jsonb;
  v_has_more boolean := false;
  v_cursor jsonb;
begin
  if v_limit < 1 or v_limit > 500 then
    raise exception 'POS_SNAPSHOT_LIMIT_INVALID' using errcode = '22023';
  end if;
  if v_scope not in ('mine', 'open', 'all', 'staff') then
    raise exception 'POS_SNAPSHOT_CASH_SCOPE_INVALID' using errcode = '22023';
  end if;
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_cash_snapshot_v2', 'SYNC_PULL', 30, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate)::jsonb
      || jsonb_build_object('snapshot_contract', 'keyset_reference_v1', 'snapshot_contract_version', 1,
                            'snapshot_complete', false, 'has_more', false, 'sync_deferred', false);
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  perform private.assert_cloud_cash_sync_enabled(v_context);
  perform private.assert_cash_permission(v_context);
  v_license_id := (v_context->>'license_id')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  if coalesce(v_context->>'device_role', 'staff') = 'staff' then
    v_scope := 'mine';
  end if;
  v_scope_hash := private.pos_snapshot_scope_hash_v1(
    v_context, 'cash:keyset-reference:v1|scope=' || v_scope || '|actor=' || coalesce(v_actor_key, '')
  );
  select r.snapshot_reference_change_seq, r.safe_change_seq, r.sync_deferred
    into v_reference, v_safe, v_deferred
    from private.pos_snapshot_reference_v1(v_license_id, p_snapshot_reference_change_seq) r;
  select c.position_rank, c.position_id into v_position_rank, v_position_id
    from private.pos_snapshot_decode_cursor_v1(p_page_cursor, v_license_id, v_reference, v_scope_hash, 1, 2) c;

  with visible_sessions as materialized (
    select s.*
      from public.pos_cash_sessions s
     where s.license_id = v_license_id
       and ((v_scope = 'mine' and s.actor_key = v_actor_key)
         or (v_scope = 'open' and s.status = 'open')
         or (v_scope = 'all')
         or (v_scope = 'staff' and s.staff_user_id is not null))
  ), candidates as (
    select 1 as rank, s.id as id,
           private.pos_cash_session_to_jsonb(s) as payload
      from visible_sessions s
     where (v_position_rank < 1 or (v_position_rank = 1 and s.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'cash_session', s.id, v_reference)
    union all
    select 2, m.id, private.pos_cash_movement_to_jsonb(m)
      from public.pos_cash_movements m
      join visible_sessions s on s.id = m.cash_session_id
     where m.license_id = v_license_id
       and (v_position_rank < 2 or (v_position_rank = 2 and m.id > v_position_id))
       and private.pos_snapshot_member_at_reference_v1(v_license_id, 'cash_movement', m.id, v_reference)
  ), lookahead as materialized (
    select * from candidates order by rank, id limit v_limit + 1
  ), delivered as materialized (
    select * from lookahead order by rank, id limit v_limit
  ), last_delivered as (
    select rank, id from delivered order by rank desc, id desc limit 1
  )
  select
    coalesce((select jsonb_agg(d.payload order by d.rank, d.id) from delivered d where d.rank = 1), '[]'::jsonb),
    coalesce((select jsonb_agg(d.payload order by d.rank, d.id) from delivered d where d.rank = 2), '[]'::jsonb),
    (select count(*) > v_limit from lookahead),
    (select private.pos_snapshot_build_cursor_v1(v_license_id, v_reference, v_scope_hash, l.rank, l.id) from last_delivered l)
  into v_sessions, v_movements, v_has_more, v_cursor;
  return jsonb_build_object(
    'success', true,
    'snapshot_contract', 'keyset_reference_v1',
    'snapshot_contract_version', 1,
    'snapshot_reference_change_seq', v_reference,
    'safe_change_seq', v_safe,
    'sync_deferred', v_deferred,
    'scope', v_scope,
    'cash_sessions', v_sessions,
    'movements', v_movements,
    'limit', v_limit,
    'has_more', v_has_more,
    'snapshot_complete', not v_has_more,
    'next_page_cursor', case when v_has_more then v_cursor else null end
  );
end;
$function$;

alter function private.pos_snapshot_reference_v1(uuid,bigint) owner to postgres;
alter function private.pos_snapshot_member_at_reference_v1(uuid,text,text,bigint) owner to postgres;
alter function private.pos_snapshot_decode_cursor_v1(jsonb,uuid,bigint,text,integer,integer) owner to postgres;
alter function private.pos_snapshot_build_cursor_v1(uuid,bigint,text,integer,text) owner to postgres;
alter function private.pos_snapshot_scope_hash_v1(jsonb,text) owner to postgres;
alter function public.pos_pull_product_catalog_snapshot_v2(text,text,text,text,integer,bigint,jsonb) owner to postgres;
alter function public.pos_pull_customers_snapshot_v3(text,text,text,text,integer,bigint,jsonb,jsonb) owner to postgres;
alter function public.pos_pull_customer_credit_snapshot_v3(text,text,text,text,integer,bigint,jsonb,text,jsonb) owner to postgres;
alter function public.pos_pull_sales_snapshot_v2(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz) owner to postgres;
alter function public.pos_pull_cash_snapshot_v2(text,text,text,text,text,integer,bigint,jsonb) owner to postgres;

revoke all on function private.pos_snapshot_reference_v1(uuid,bigint) from public, anon, authenticated, service_role;
revoke all on function private.pos_snapshot_member_at_reference_v1(uuid,text,text,bigint) from public, anon, authenticated, service_role;
revoke all on function private.pos_snapshot_decode_cursor_v1(jsonb,uuid,bigint,text,integer,integer) from public, anon, authenticated, service_role;
revoke all on function private.pos_snapshot_build_cursor_v1(uuid,bigint,text,integer,text) from public, anon, authenticated, service_role;
revoke all on function private.pos_snapshot_scope_hash_v1(jsonb,text) from public, anon, authenticated, service_role;
revoke all on function public.pos_pull_product_catalog_snapshot_v2(text,text,text,text,integer,bigint,jsonb) from public;
revoke all on function public.pos_pull_customers_snapshot_v3(text,text,text,text,integer,bigint,jsonb,jsonb) from public;
revoke all on function public.pos_pull_customer_credit_snapshot_v3(text,text,text,text,integer,bigint,jsonb,text,jsonb) from public;
revoke all on function public.pos_pull_sales_snapshot_v2(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz) from public;
revoke all on function public.pos_pull_cash_snapshot_v2(text,text,text,text,text,integer,bigint,jsonb) from public;
grant execute on function public.pos_pull_product_catalog_snapshot_v2(text,text,text,text,integer,bigint,jsonb) to anon, authenticated, service_role;
grant execute on function public.pos_pull_customers_snapshot_v3(text,text,text,text,integer,bigint,jsonb,jsonb) to anon, authenticated, service_role;
grant execute on function public.pos_pull_customer_credit_snapshot_v3(text,text,text,text,integer,bigint,jsonb,text,jsonb) to anon, authenticated, service_role;
grant execute on function public.pos_pull_sales_snapshot_v2(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz) to anon, authenticated, service_role;
grant execute on function public.pos_pull_cash_snapshot_v2(text,text,text,text,text,integer,bigint,jsonb) to anon, authenticated, service_role;

comment on function public.pos_pull_product_catalog_snapshot_v2(text,text,text,text,integer,bigint,jsonb) is
  'Additive keyset snapshot. One stable safe reference spans categories, products and batches; never an applied cursor.';
comment on function public.pos_pull_customers_snapshot_v3(text,text,text,text,integer,bigint,jsonb,jsonb) is
  'Additive V2-envelope customer snapshot with a stable safe reference and immutable-ID keyset cursor.';
comment on function public.pos_pull_customer_credit_snapshot_v3(text,text,text,text,integer,bigint,jsonb,text,jsonb) is
  'Additive V2-envelope credit snapshot with a stable safe reference, immutable ledger-ID cursor and related customer projections.';
comment on function public.pos_pull_sales_snapshot_v2(text,text,text,text,integer,bigint,jsonb,timestamptz,timestamptz) is
  'Additive sales snapshot with a stable safe reference, immutable sale-ID cursor and complete related items/payments per page.';
comment on function public.pos_pull_cash_snapshot_v2(text,text,text,text,text,integer,bigint,jsonb) is
  'Additive cash snapshot with a stable safe reference and bounded keyset traversal over sessions then movements.';

commit;
