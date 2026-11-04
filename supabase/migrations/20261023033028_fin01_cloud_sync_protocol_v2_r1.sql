-- FIN-01 Cloud Sync Protocol v2.
-- Requires the exact FIN-01 migration F. No historical balance is imported here.
-- The public v2 RPCs adapt the existing tenant-scoped cores and preserve their
-- idempotency stores, actor checks, financial locks, and persisted responses.
begin;

do $guard$
declare
  v_name text;
  v_expected text;
  v_actual text;
  v_proc regprocedure;
  v_owner text;
  v_config text[];
  v_rls_enabled boolean;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'FIN01_V_MIGRATION_LEDGER_MISSING';
  end if;
  if not exists (
    select 1 from supabase_migrations.schema_migrations
     where version = '20261022135915'
       and name = 'fin01_historical_credit_owner_authorization'
  ) then
    raise exception 'FIN01_F_MIGRATION_REQUIRED';
  end if;
  if to_regclass('private.pos_historical_credit_authorizations') is null
     or to_regclass('private.pos_historical_credit_receipts') is null
     or to_regprocedure('public.pos_historical_credit_batch_v1(text,text,text,text,text,jsonb,uuid,boolean)') is null then
    raise exception 'FIN01_F_OBJECTS_MISSING';
  end if;
  select c.relrowsecurity into v_rls_enabled
    from pg_class c
   where c.oid = to_regclass('private.pos_historical_credit_authorizations');
  if v_rls_enabled is distinct from true then
    raise exception 'FIN01_F_RLS_DISABLED';
  end if;
  if position('HISTORICAL_DEBT_PRESERVATION_REQUIRED' in pg_get_functiondef(
       to_regprocedure('public.pos_upsert_customer_unlimited(text,text,text,text,jsonb,integer,text)')
     )) = 0 then
    raise exception 'FIN01_F_CUSTOMER_CORE_MISMATCH';
  end if;

  -- R3: the five reviewed definitions retain Restaurant transition admission,
  -- dispatcher origin checks and duplicate-parent-sale protection. Pin their
  -- new helpers/delegates too; never accept an alternate or unchecked hash.
  if to_regclass('private.restaurant_cloud_contract_state') is null then
    raise exception 'FIN01_V_RESTAURANT_CONTRACT_STATE_MISSING';
  end if;

  -- SHA-256 guards were read from the Production catalog. Abort on any drift.
  for v_name, v_expected in select * from (values
    ('private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text)', 'd644851fe9afd0c594d6ca46760c2613fb4fe1444166772fea51a0427a0d3286'),
    ('private.enter_restaurant_financial_transition_write_v1(text,text,text,text,jsonb)', '85929a9e044662df850ee81c055f188b928412cb1b04b6237938c1fb61b64d15'),
    ('private.enter_restaurant_transition_write_v1()', '89038017d6e0084499c50f102ba8d613a5990823a1b5daba0ff1f147d23de3e2'),
    ('public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)', 'c15dceb93d5c75762dc2fce94229925c128e3b9bd43e9cb7357dbb2f2c47b0c0'),
    ('public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '09cb159cfd209d54d547f1dc8cfdf3cc66f13ad46239c082a4cb68df974c3d9b'),
    ('private.assert_cloud_customer_credit_sync_enabled(jsonb)', '7741c5e713d7192196fb6b08a76b28882e00656efe822c9fce69ae6b4e5c2d3b'),
    ('private.assert_cloud_layaways_enabled(jsonb)', '1f4c4dacde46ccc3a89e69f074e0c4a8da44b62677c7dec35ac0aa9074e6d99c'),
    ('private.assert_cloud_pos_sync_enabled(jsonb)', 'ce47e8b677750f61858e5b17bd9a603aa482ea92e199d006584a6808c48a6e43'),
    ('private.assert_cloud_sales_credit_enabled(jsonb)', '77e0d4d897a83ed594d8f9b6faab78961e4fa25a74774d85b267ce4803e8f2cb'),
    ('private.assert_financial_operation_origin_v1(public.pos_financial_operations,text,uuid,text)', '2f381e3af04174cb13bd880f17853ed0c1e5644cd1b68c454817203fc12f42a0'),
    ('private.assert_financial_request_hash_v1(text)', '6f4e6453844890ed2254811ebfeb4d243151d73422e13c45db436d08a15abb33'),
    ('private.assert_pos_permission(jsonb,text)', '29fc684dd52bb132a99bebabbf7b785035bd1ba3e4fa5a9a299b6d3b3fed0447'),
    ('private.canonical_financial_request_v1(text,jsonb)', 'f2d32eaa2ca2469051f3f1ac4467db83c886eb1a3d1bacff3d41ca86309ade04'),
    ('private.canonical_layaway_request_v1(text,jsonb)', '2559757ba44a6e1f12619a29627ba377efcea5f74afa3227b23b87712e630fe3'),
    ('private.complete_financial_operation_v1(uuid,text,jsonb)', 'a0461e5972fd5fa0e2619a0de3dc8248aeeb69bc1d0af0f77284de0e25c5a143'),
    ('private.execute_layaway_cancel_financial_v1(jsonb,jsonb,text,text,text)', '188e267fb597944b050175bb2b3208f8599d515cef74ecb9f84761f2f6c81e33'),
    ('private.execute_layaway_completion_financial_v1(text,text,text,text,jsonb,text)', '9fd84cbdc9ce7b7c435647ee4ac6ffc81a225d2a5597a88028f2bbbc1477a372'),
    ('private.execute_layaway_create_financial_v1(jsonb,jsonb,text,text,text)', '7b31c8b6d9230c8c6c4ccd8f8dcd2bc16825a4bb963b26e6d2e5f95ae2a68647'),
    ('private.execute_layaway_payment_financial_v1(jsonb,jsonb,text,text,text)', '3bfb5d35ae96fa4fa42a1f07a95a4b2dc1e45d1881fa903dcc0d1e6540f1d929'),
    ('private.execute_split_sale_financial_v1(text,text,text,text,jsonb,text)', '989f580aba16357d010f30663b93dbd6d9873d06b40c4bc3844155bf97dcffc0'),
    ('private.financial_execution_request_v1(jsonb)', 'f837502bbde208dd017ee6beca6c154f270ae0fe3ff841c6672237decb6833df'),
    ('private.layaway_execution_request_v1(jsonb)', '77662715253e8e0f777729f7de3e8fcb69019fee97d8a6be5c6fb3aa9eff02ad'),
    ('private.layaway_payment_payload_v1(jsonb)', 'e0833e99022a86faea91642d2597deca80331c0465d5e445509a0c4421aae3f3'),
    ('private.layaway_request_bool_v1(jsonb,text[],boolean)', 'cfc9a0c6afd923fd6ba1601df6a08ae3d7f3de088c56db900044cdf1a4426b1a'),
    ('private.layaway_request_cash_session_id_v1(jsonb)', '999b2ee5a2e3e38ea91084ab2b7d9b84009778da43d596161a0386f1d7ba6bf1'),
    ('private.layaway_request_id_v1(jsonb)', '74ae2f0acf349ab176b63a8058f3cbfecd8b54d9937e1cf40ae111846f4d84f8'),
    ('private.layaway_request_numeric_v1(jsonb,text[],numeric)', '3c5eb1c96e279a991faf91bb1e0c3f1f74681b1150c5434d86fe385acf1bdaed'),
    ('private.lock_financial_operation_v1(uuid,text)', 'e34e74210ce2df9a6931d4d3ffd9f346bc466cb111ee8e1d3d5256e788e25f5a'),
    ('private.lock_restaurant_order_settlement_v1(uuid,text)', '8d013a48abce5e1d7385a0d252baefc02fe28fe240c14ec853ec333ee25e2db7'),
    ('private.public_financial_response_v1(text,jsonb,text,text)', 'e26cbd53f385a50991ba764a99cd4eafaef04a79b322c021aee18b1c17ba0ec2'),
    ('private.reserve_financial_operation_v1(uuid,text,text,text,jsonb,text,uuid,text,text)', 'a475cc8cb1c9c047abea22d5018aa418a6ac0abeea918ed7b361bde64a445b98'),
    ('private.resolve_cash_actor_key(jsonb)', '0d6cca21e9d27ecbe79d9d9ae4f3afe3b4d876fecc00a9c897b2b727247339ca'),
    ('private.resolve_financial_cash_station_v1(uuid,uuid)', '3157ec50c970b2fb6e7655193a78cc311238b8bc5c963b021ded844be58c833c'),
    ('private.validate_pos_sync_context(text,text,text,text)', '42995c5088de44d28d7dac13e30fa00b1aa74e97ccd95c441d3c16e7c1488957'),
    ('public.build_pos_rpc_rate_limited_response(jsonb)', 'f69f2edb8bae56dc12efdfcf1c19057a0e280025a38f1560096fd42c689ed8af'),
    ('public.enforce_pos_rpc_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb)', 'cb3c170fe4a0380c340703aa306b174f48c034bc46193b750c3440409b7a448a'),
    ('public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)', '988743703fbf74423dc308871667582f3f4517f3e0ea2da9ca0099012da90320'),
    ('public.pos_adjust_initial_cash_fund(text,text,text,text,text,numeric,text,integer,text)', '652417492a12b600ddea58899ede208856604dc76c41e4df698e02a15b24f4c8'),
    ('public.pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)', '04a6dd3c41c48464715b665830e5e751270d41c77fdd4498348be53bdb615864'),
    ('public.pos_close_cash_session(text,text,text,text,text,jsonb,integer,text)', 'b6792a55f9c620f9730b26cbcd8c5c30c3eb5b64ba179e1753990336c5279bed'),
    ('public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text)', 'b90926b0c72fb8762121eb3273becf764a19d87bb8fc2cfc73e54d25b3a1fd18'),
    ('public.pos_create_cloud_sale_cashier(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '79b6ccbe257637404be926d270f228f27c9264d820949f2f2ead2c8c2df3a78b'),
    ('public.pos_create_cloud_sale_cashier_inventory(text,text,text,text,jsonb,jsonb,jsonb,text,text)', '17c8108f78043e2f84382a65aca2fe15e7cceecc079867dac4fc7fd50147d0ed'),
    ('public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)', '6372d9f9e1550ea328101138877ebb0d069d828782252599360f13b99a990b38'),
    ('public.pos_delete_customer_unlimited(text,text,text,text,text,integer,text)', '3b7073c54b08cd2f46ec4ddf09249dd71ab1e8c91a58a42109d28c6a19d04f01'),
    ('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)', 'c7b87bfbdf5929ce14c1625066c594b8400bbafda8fbc1f18347e57e3fdebf76'),
    ('public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)', 'fd1278d820f6a0ea481534b2ffd7a411a94c54edcac4b46ce166eeb309c19745'),
    ('public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer)', '43f04a7dde80b1e77b2e9d6bb4d05cb90db4c150c41af25ecaa0473e98450121'),
    ('public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer)', '89baf719e4a16619c09605cb6652962f467cd552eb691b44fdc7314bbfc8a0f5'),
    ('public.pos_pull_customer_credit_snapshot_unlimited(text,text,text,text,integer,integer,text,boolean)', 'a737429a9b29560fc1087bf8a06bef7139520e4de6ed64949590a2b84adf7588'),
    ('public.pos_pull_customers_snapshot_unlimited(text,text,text,text,integer,integer,boolean)', '8eed2bf14f8e1caa497b99f3a807cd8a7983a9c8f13ba8469ccfe1fd08412733'),
    ('public.pos_open_cash_session(text,text,text,text,jsonb,text)', 'c1532e1a88db93fd53f24666d8a8c42d06fe9a8d0d191ab326888049313a4ab3'),
    ('public.pos_register_cash_movement(text,text,text,text,text,text,numeric,text,text,jsonb)', '0712bfdd705c939e8baa79e133aa9bb9bd39a057895bc2d9d8657551437edc60'),
    ('public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)', '73ce2f73f985eada337800b1ed18b9242c1f57948a23c48a57542f522ead8bf4')
  ) dependencies(function_name, sha256) loop
    v_proc := to_regprocedure(v_name);
    if v_proc is null then
      raise exception 'FIN01_V_DEPENDENCY_MISSING: %', v_name;
    end if;
    select encode(extensions.digest(convert_to(pg_get_functiondef(v_proc), 'UTF8'), 'sha256'), 'hex')
      into v_actual;
    if v_actual is distinct from v_expected then
      raise exception 'FIN01_V_DEPENDENCY_DRIFT: %', v_name;
    end if;
    select pg_get_userbyid(p.proowner), p.proconfig
      into v_owner, v_config
      from pg_proc p where p.oid = v_proc;
    if v_owner is distinct from 'postgres'
       or not coalesce(v_config @> array['search_path=""']::text[], false) then
      raise exception 'FIN01_V_DEPENDENCY_SECURITY_DRIFT: %', v_name;
    end if;
  end loop;

  -- Existing internal cores stay service-role only; v2 calls them as postgres.
  foreach v_name in array array[
    'private.assert_restaurant_sale_dispatcher_context_v1(text,text,text,text,jsonb,text,text,text)',
    'private.enter_restaurant_financial_transition_write_v1(text,text,text,text,jsonb)',
    'private.enter_restaurant_transition_write_v1()',
    'public.pos_create_cloud_sale_cashier_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_create_cloud_sale_cashier_inventory_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text)',
    'public.pos_upsert_customer_unlimited(text,text,text,text,jsonb,integer,text)',
    'public.pos_delete_customer_unlimited(text,text,text,text,text,integer,text)',
    'public.pos_pull_customers_snapshot_unlimited(text,text,text,text,integer,integer,boolean)',
    'public.pos_pull_customer_changes_unlimited(text,text,text,text,bigint,integer)',
    'public.pos_get_customer_credit_summary_unlimited(text,text,text,text,text)',
    'public.pos_pull_customer_credit_snapshot_unlimited(text,text,text,text,integer,integer,text,boolean)',
    'public.pos_pull_customer_credit_changes_unlimited(text,text,text,text,bigint,integer)',
    'public.pos_record_customer_payment_unlimited(text,text,text,text,text,numeric,text,text,text,jsonb,text)',
    'public.pos_create_cloud_sale_credit_unlimited(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)',
    'public.pos_cancel_cloud_sale_unlimited(text,text,text,text,text,text,text)',
    'public.pos_close_restaurant_order_after_checkout_unlimited(text,text,text,text,text,text,text,numeric,jsonb,text)'
  ] loop
    v_proc := to_regprocedure(v_name);
    if v_proc is null or has_function_privilege('anon', v_proc, 'EXECUTE')
       or has_function_privilege('authenticated', v_proc, 'EXECUTE') then
      raise exception 'FIN01_V_INTERNAL_CORE_ACL_DRIFT: %', v_name;
    end if;
  end loop;
end;
$guard$;

-- R5 is deliberately not an existing-tenant migration. A first activation
-- must be part of the INSERT transaction of a brand-new, still-unused license.
create table private.pos_fin01_qa_pilots_v2 (
  license_id uuid primary key references public.licenses(id) on delete cascade,
  creation_xid xid8 not null,
  protocol integer not null default 1 check (protocol in (1,2)),
  generation bigint not null default 1,
  approval_reference text,
  change_reference text,
  activated_at timestamptz,
  changed_at timestamptz not null default now()
);
create table private.pos_fin01_admissions_v2 (
  transaction_id xid8 not null,
  license_id uuid not null references public.licenses(id) on delete cascade,
  depth integer not null check (depth > 0),
  primary key(transaction_id,license_id)
);
alter table private.pos_fin01_qa_pilots_v2 owner to postgres;
alter table private.pos_fin01_admissions_v2 owner to postgres;
alter table private.pos_fin01_qa_pilots_v2 enable row level security;
alter table private.pos_fin01_admissions_v2 enable row level security;
revoke all on private.pos_fin01_qa_pilots_v2,private.pos_fin01_admissions_v2 from public,anon,authenticated,service_role;

create or replace function private.pos_fin01_register_new_tenant_v2()
returns trigger language plpgsql security definer set search_path='' as $function$
begin
  insert into private.pos_fin01_qa_pilots_v2(license_id,creation_xid) values(new.id,pg_current_xact_id());
  return new;
end;
$function$;
create trigger pos_fin01_register_new_tenant_v2 after insert on public.licenses
for each row execute function private.pos_fin01_register_new_tenant_v2();

create or replace function private.pos_fin01_set_clean_qa_protocol_v2(
  p_license_id uuid,p_protocol integer,p_expected_generation bigint,p_approval_reference text
)
returns jsonb language plpgsql set search_path='' as $function$
declare v_policy private.pos_fin01_qa_pilots_v2;
begin
  -- Owner-only administrative SQL, never a public app RPC. The reference is
  -- audit evidence, not authority; EXECUTE and private-table ACLs are authority.
  if p_protocol is null or p_protocol not in (1,2) or nullif(btrim(p_approval_reference),'') is null then
    raise exception 'CLOUD_SYNC_QA_APPROVAL_REQUIRED';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fin01_qa_protocol:'||p_license_id::text,0));
  select * into v_policy from private.pos_fin01_qa_pilots_v2 where license_id=p_license_id for update;
  if not found then raise exception 'CLOUD_SYNC_QA_FRESH_TENANT_REQUIRED'; end if;
  if v_policy.generation is distinct from p_expected_generation then raise exception 'CLOUD_SYNC_QA_GENERATION_CONFLICT'; end if;
  if p_protocol=2 then
    if v_policy.creation_xid<>pg_current_xact_id() or v_policy.generation<>1 or v_policy.activated_at is not null then
      raise exception 'CLOUD_SYNC_QA_FRESH_TENANT_REQUIRED';
    end if;
    if exists(select 1 from public.license_devices where license_id=p_license_id)
      or exists(select 1 from public.pos_customers where license_id=p_license_id)
      or exists(select 1 from public.pos_customer_ledger where license_id=p_license_id)
      or exists(select 1 from public.pos_sales where license_id=p_license_id)
      or exists(select 1 from public.pos_sale_payments where license_id=p_license_id)
      or exists(select 1 from public.pos_cash_sessions where license_id=p_license_id)
      or exists(select 1 from public.pos_cash_movements where license_id=p_license_id)
      or exists(select 1 from public.pos_inventory_movements where license_id=p_license_id)
      or exists(select 1 from public.pos_financial_operations where license_id=p_license_id)
      or exists(select 1 from public.pos_idempotency_keys where license_id=p_license_id)
      or exists(select 1 from public.pos_sync_events where license_id=p_license_id)
      or exists(select 1 from private.pos_historical_credit_authorizations where license_id=p_license_id)
      or exists(select 1 from private.pos_historical_credit_receipts where license_id=p_license_id) then
      raise exception 'CLOUD_SYNC_QA_TENANT_NOT_EMPTY';
    end if;
  end if;
  update private.pos_fin01_qa_pilots_v2 set protocol=p_protocol,generation=generation+1,
    approval_reference=case when p_protocol=2 then p_approval_reference else approval_reference end,
    change_reference=p_approval_reference,
    activated_at=case when p_protocol=2 then now() else activated_at end,changed_at=now()
    where license_id=p_license_id returning * into v_policy;
  return jsonb_build_object('protocol',v_policy.protocol,'generation',v_policy.generation);
end;
$function$;

create or replace function private.pos_fin01_enter_pilot_v2(
  p_sync_contract jsonb,p_license_key text,p_device_fingerprint text,p_security_token text,
  p_staff_session_token text,p_receipt_only boolean default false
)
returns void language plpgsql set search_path='' as $function$
declare v_context jsonb; v_license_id uuid; v_policy private.pos_fin01_qa_pilots_v2;
begin
  perform private.pos_fin01_validate_sync_contract_v2(p_sync_contract);
  v_context:=private.validate_pos_sync_context(p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_license_id:=(v_context->>'license_id')::uuid;
  perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:'||v_license_id::text,0));
  select * into v_policy from private.pos_fin01_qa_pilots_v2 where license_id=v_license_id for share;
  if coalesce(v_policy.protocol,1)<>2 then
    if p_receipt_only and v_policy.activated_at is not null then return; end if;
    raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode='P0001',detail='QA_PILOT_NOT_ENABLED';
  end if;
  -- Only private, authenticated entry code can create this call-scoped witness.
  -- No request parameter, claimed capability or PostgreSQL setting grants it.
  insert into private.pos_fin01_admissions_v2(transaction_id,license_id,depth)
    values(pg_current_xact_id(),v_license_id,1)
    on conflict(transaction_id,license_id) do update set depth=private.pos_fin01_admissions_v2.depth+1;
end;
$function$;

create or replace function private.pos_fin01_leave_pilot_v2(p_license_id uuid)
returns void language plpgsql set search_path='' as $function$
begin
  -- Every v2 return passes through the envelope. An exception rolls the entry
  -- witness back with its statement/subtransaction; successful calls remove it.
  delete from private.pos_fin01_admissions_v2 where transaction_id=pg_current_xact_id() and license_id=p_license_id and depth=1;
  update private.pos_fin01_admissions_v2 set depth=depth-1
    where transaction_id=pg_current_xact_id() and license_id=p_license_id;
end;
$function$;

create or replace function private.pos_fin01_guard_qa_write_v2()
returns trigger language plpgsql security definer set search_path='' as $function$
declare v_license_id uuid; v_ids uuid[];
begin
  v_ids:=case tg_op when 'INSERT' then array[new.license_id] when 'DELETE' then array[old.license_id]
    else array[old.license_id,new.license_id] end;
  for v_license_id in select distinct x from unnest(v_ids) x where x is not null order by x loop
    perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:'||v_license_id::text,0));
    if exists(select 1 from private.pos_fin01_qa_pilots_v2 where license_id=v_license_id and protocol=2)
      and not exists(select 1 from private.pos_fin01_admissions_v2
        where transaction_id=pg_current_xact_id() and license_id=v_license_id and depth>0) then
      raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode='P0001',detail='QA_PILOT_REQUIRES_V2';
    end if;
  end loop;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$function$;

-- Intercept the shared write boundary, not individual public aliases. Existing
-- validations still execute; rejection aborts the financial SQL statement.
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_customers
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_customer_ledger
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_sales
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_sale_items
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_sale_payments
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_cash_sessions
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_cash_movements
for each row execute function private.pos_fin01_guard_qa_write_v2();
create trigger pos_fin01_guard_qa_write_v2 before insert or update or delete on public.pos_financial_operations
for each row execute function private.pos_fin01_guard_qa_write_v2();

alter function private.pos_fin01_register_new_tenant_v2() owner to postgres;
alter function private.pos_fin01_set_clean_qa_protocol_v2(uuid,integer,bigint,text) owner to postgres;
alter function private.pos_fin01_enter_pilot_v2(jsonb,text,text,text,text,boolean) owner to postgres;
alter function private.pos_fin01_leave_pilot_v2(uuid) owner to postgres;
alter function private.pos_fin01_guard_qa_write_v2() owner to postgres;
revoke all on function private.pos_fin01_register_new_tenant_v2() from public,anon,authenticated,service_role;
revoke all on function private.pos_fin01_set_clean_qa_protocol_v2(uuid,integer,bigint,text) from public,anon,authenticated,service_role;
revoke all on function private.pos_fin01_enter_pilot_v2(jsonb,text,text,text,text,boolean) from public,anon,authenticated,service_role;
revoke all on function private.pos_fin01_leave_pilot_v2(uuid) from public,anon,authenticated,service_role;
revoke all on function private.pos_fin01_guard_qa_write_v2() from public,anon,authenticated,service_role;


create or replace function private.pos_fin01_validate_sync_contract_v2(p_sync_contract jsonb)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if jsonb_typeof(p_sync_contract) is distinct from 'object' then
    raise exception 'CLOUD_SYNC_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if (p_sync_contract - array['contract_version', 'capabilities']) <> '{}'::jsonb
     or p_sync_contract->>'contract_version' is distinct from '2'
     or jsonb_typeof(p_sync_contract->'capabilities') is distinct from 'array' then
    raise exception 'CLOUD_SYNC_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  if not (p_sync_contract->'capabilities' @> '["historical_credit_preservation_v1","customer_projection_safe_apply_v1"]'::jsonb)
     or exists (
       select 1 from jsonb_array_elements(p_sync_contract->'capabilities') as capability(value)
        where jsonb_typeof(capability.value) is distinct from 'string'
     ) then
    raise exception 'CLOUD_SYNC_CONTRACT_INVALID' using errcode = 'P0001';
  end if;
  -- Capabilities describe client support only; all authority is checked by the
  -- existing license, device, session, actor, role, and permission validators.
end;
$function$;

create or replace function private.pos_fin01_rate_limit_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_staff_session_token text,
  p_rpc_name text,
  p_scope text,
  p_max_attempts integer,
  p_window_seconds integer,
  p_block_seconds integer,
  p_code text default 'RPC_RATE_LIMITED',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language sql
set search_path = ''
as $function$
  select public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    p_rpc_name, p_scope, p_max_attempts, p_window_seconds,
    p_block_seconds, p_code, coalesce(p_metadata, '{}'::jsonb)
  );
$function$;

create or replace function private.pos_fin01_client_identity_v2(p_context jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select jsonb_strip_nulls(jsonb_build_object(
    'device_id', nullif(p_context->>'device_id', ''),
    'device_role', nullif(p_context->>'device_role', ''),
    'staff_user_id', nullif(p_context->>'staff_user_id', ''),
    'actor_type', case when nullif(p_context->>'staff_user_id', '') is not null then 'staff'
                       when jsonb_typeof(p_context->'admin_user') = 'object' then 'admin'
                       else 'device' end
  ));
$function$;

create or replace function private.pos_fin01_customer_ids_v2(p_payload jsonb)
returns table(customer_id text)
language sql
stable
set search_path = ''
as $function$
  with recursive nodes(value, depth) as (
    select coalesce(p_payload, '{}'::jsonb), 0
    union all
    select child.value, node.depth + 1
      from nodes node
      cross join lateral (
        select object_child.value
          from jsonb_each(case when jsonb_typeof(node.value) = 'object' then node.value else '{}'::jsonb end) object_child
        union all
        select array_child.value
          from jsonb_array_elements(case when jsonb_typeof(node.value) = 'array' then node.value else '[]'::jsonb end) array_child
      ) child
     where node.depth < 32
  )
  select distinct node.value->>'id'
    from nodes node
   where jsonb_typeof(node.value) = 'object'
     and jsonb_typeof(node.value->'id') = 'string'
     and nullif(btrim(node.value->>'id'), '') is not null
     and nullif(btrim(node.value->>'name'), '') is not null
     and node.value ?| array['credit_limit', 'creditLimit'];
$function$;

create or replace function private.pos_fin01_customer_projections_v2(p_license_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $function$
declare
  v_customer_id text;
  v_customer public.pos_customers;
  v_pending_state text;
  v_entry_status text;
  v_status text;
  v_debt_cents integer;
  v_projection_version integer;
  v_source text;
  v_result jsonb := '[]'::jsonb;
begin
  for v_customer_id in
    select customer_id from private.pos_fin01_customer_ids_v2(p_payload)
     order by customer_id collate "C"
  loop
    v_customer := null;
    v_pending_state := null;
    v_entry_status := null;
    select c.* into v_customer
      from public.pos_customers c
     where c.license_id = p_license_id and c.id = v_customer_id;

    select a.state, entry_result.status
      into v_pending_state, v_entry_status
      from private.pos_historical_credit_authorizations a
      cross join lateral jsonb_array_elements(coalesce(a.manifest->'entries', '[]'::jsonb)) entry(value)
      left join lateral (
        select result.value->>'status' as status
          from jsonb_array_elements(coalesce(a.results, '[]'::jsonb)) result(value)
         where result.value->>'customer_id' = v_customer_id
         order by result.value->>'status'
         limit 1
      ) entry_result on true
     where a.license_id = p_license_id
       and entry.value->>'customer_id' = v_customer_id
       and a.state in ('PENDING', 'CONFLICT', 'PARTIALLY_CONSUMED')
       and coalesce(entry_result.status, '') not in ('IMPORTED', 'ALREADY_IMPORTED_IDENTICAL')
     order by case a.state when 'CONFLICT' then 0 when 'PARTIALLY_CONSUMED' then 1 else 2 end
     limit 1;

    v_debt_cents := null;
    v_projection_version := greatest(coalesce(v_customer.server_version, 1), 1);
    v_source := 'pos_customers.debt_cents';
    if v_pending_state = 'CONFLICT' or v_entry_status like 'CONFLICT%' then
      v_status := 'CONFLICT';
      v_source := 'historical_credit_manifest_conflict';
    elsif v_pending_state is not null then
      v_status := 'HISTORICAL_PENDING';
      v_source := 'historical_credit_manifest_pending';
    elsif v_customer.id is null then
      v_status := 'CONFLICT';
      v_source := 'pos_customers.missing';
    elsif v_customer.debt_cents = 0 and v_customer.debt = 0 then
      v_status := 'KNOWN_ZERO';
      v_debt_cents := 0;
    elsif v_customer.debt_cents between 1 and 2147483647
       and v_customer.debt = v_customer.debt_cents::numeric / 100 then
      v_status := 'KNOWN_POSITIVE';
      v_debt_cents := v_customer.debt_cents;
    else
      v_status := 'CONFLICT';
      v_source := 'pos_customers.debt_cents_mismatch';
    end if;

    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'customer_id', v_customer_id,
      'status', v_status,
      'debt_cents', v_debt_cents,
      'source', v_source,
      'projection_version', v_projection_version
    ));
  end loop;
  return v_result;
end;
$function$;

create or replace function private.pos_fin01_sync_envelope_v2(
  p_license_id uuid,
  p_endpoint text,
  p_family text,
  p_context jsonb,
  p_payload jsonb,
  p_customer_id text default null,
  p_cursor jsonb default null,
  p_operation jsonb default null
)
returns jsonb
language plpgsql
set search_path = ''
as $function$
declare
  v_envelope jsonb;
begin
  v_envelope := jsonb_build_object(
    'contract_version', 2,
    'tenant_id', p_license_id,
    'endpoint', p_endpoint,
    'family', p_family,
    'client_identity', private.pos_fin01_client_identity_v2(p_context),
    'payload', coalesce(p_payload, '{}'::jsonb),
    -- Financial payloads contain the immutable result, including historical
    -- customer amounts. Current debt is obtained through authorized credit pulls.
    'customer_projection_scope', case when p_family = 'financial_operations' then 'OPERATION_RESULT' else 'CURRENT' end,
    'customer_projections', case when p_family = 'financial_operations' then '[]'::jsonb
      else private.pos_fin01_customer_projections_v2(p_license_id, coalesce(p_payload, '{}'::jsonb)) end
  );
  if p_customer_id is not null then
    v_envelope := v_envelope || jsonb_build_object('customer_id', p_customer_id);
  end if;
  if p_cursor is not null then
    v_envelope := v_envelope || jsonb_build_object('cursor', p_cursor);
  end if;
  if p_operation is not null then
    v_envelope := v_envelope || jsonb_build_object('operation', p_operation);
  end if;
  perform private.pos_fin01_leave_pilot_v2(p_license_id);
  return v_envelope;
end;
$function$;

create or replace function public.pos_fin01_sync_contract_v1(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text default null,
  p_requested_contract integer default 2,
  p_capabilities text[] default array[]::text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_policy private.pos_fin01_qa_pilots_v2;
begin
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_rate := private.pos_fin01_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_fin01_sync_contract_v1', 'SYNC_PULL', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    raise exception 'RPC_RATE_LIMITED' using errcode = 'P0001';
  end if;
  if p_requested_contract is distinct from 2 then
    return jsonb_build_object(
      'contract_version', 2,
      'server_status', 'UPDATE_REQUIRED',
      'tenant_id', v_license_id,
      'requested_contract', p_requested_contract,
      'required_contract', 2
    );
  end if;
  perform pg_advisory_xact_lock_shared(hashtextextended('fin01_qa_protocol:'||v_license_id::text,0));
  select * into v_policy from private.pos_fin01_qa_pilots_v2 where license_id=v_license_id for share;
  if coalesce(v_policy.protocol,1)<>2 then
    if v_policy.activated_at is null then
      return jsonb_build_object('contract_version',2,'server_status','UPDATE_REQUIRED',
        'tenant_id',v_license_id,'active_protocol',1,'reason','QA_PILOT_NOT_ENABLED');
    end if;
    -- A stopped QA pilot may still recover its immutable receipts, but cannot
    -- negotiate directory/payment/execute endpoints. No new write admission.
    return jsonb_build_object('contract_version',2,'server_status','SUPPORTED',
      'tenant_id',v_license_id,'active_protocol',1,'mode','RECOVERY_ONLY',
      'capabilities',jsonb_build_array('historical_credit_preservation_v1','customer_projection_safe_apply_v1','financial_operation_result_v1'),
      'endpoint_families',jsonb_build_array('financial_operations'),
      'endpoints',jsonb_build_array('pos_get_financial_operation_receipt_v2'));
  end if;
  return jsonb_build_object(
    'contract_version', 2,
    'server_status', 'SUPPORTED',
    'tenant_id', v_license_id,
    'capabilities', jsonb_build_array('historical_credit_preservation_v1', 'customer_projection_safe_apply_v1', 'financial_operation_result_v1'),
    'endpoint_families', jsonb_build_array('customer_directory', 'customer_credit', 'financial_operations'),
    'endpoints', jsonb_build_array(
      'pos_upsert_customer_v2', 'pos_delete_customer_v2', 'pos_migrate_local_customers_v2',
      'pos_pull_customers_snapshot_v2', 'pos_pull_customer_changes_v2',
      'pos_get_customer_credit_summary_v2', 'pos_pull_customer_credit_snapshot_v2',
      'pos_pull_customer_credit_changes_v2', 'pos_record_customer_payment_v2',
      'pos_execute_financial_operation_v2', 'pos_get_financial_operation_receipt_v2'
    )
  );
end;
$function$;

create or replace function public.pos_upsert_customer_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_customer jsonb default '{}'::jsonb,
  p_expected_version integer default null, p_idempotency_key text default null,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
  v_customer_id text;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  if jsonb_typeof(p_customer) is distinct from 'object'
     or nullif(btrim(p_customer->>'id'), '') is null
     or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'CUSTOMER_UPSERT_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;
  v_customer_id := p_customer->>'id';
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_upsert_customer', 'POS_WRITE', 120, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_upsert_customer_v2', 'customer_directory', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate), v_customer_id,
      null, jsonb_build_object('idempotency_key', p_idempotency_key));
  end if;
  v_payload := public.pos_upsert_customer_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_customer, p_expected_version, p_idempotency_key
  );
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_upsert_customer_v2', 'customer_directory', v_context,
    v_payload, v_customer_id, null, jsonb_build_object('idempotency_key', p_idempotency_key));
end;
$function$;

create or replace function public.pos_delete_customer_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_customer_id text default null,
  p_expected_version integer default null, p_idempotency_key text default null,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  if nullif(btrim(p_customer_id), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'CUSTOMER_DELETE_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_delete_customer', 'POS_WRITE', 120, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_delete_customer_v2', 'customer_directory', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate), p_customer_id,
      null, jsonb_build_object('idempotency_key', p_idempotency_key));
  end if;
  v_payload := public.pos_delete_customer_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_customer_id, p_expected_version, p_idempotency_key
  );
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_delete_customer_v2', 'customer_directory', v_context,
    v_payload, p_customer_id, null, jsonb_build_object('idempotency_key', p_idempotency_key));
end;
$function$;

create or replace function public.pos_migrate_local_customers_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_customers jsonb default '[]'::jsonb,
  p_batch_id text default null, p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '45s'
set lock_timeout = '20s'
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_item jsonb;
  v_customer_id text;
  v_key text;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_count integer := 0;
  v_failed integer := 0;
  v_seen text[] := array[]::text[];
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  if jsonb_typeof(p_customers) is distinct from 'array' then
    raise exception 'CUSTOMERS_ARRAY_REQUIRED' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_customers) > 500 then
    raise exception 'CUSTOMERS_BATCH_LIMIT_EXCEEDED' using errcode = 'P0001';
  end if;
  if nullif(btrim(p_batch_id), '') is null then
    raise exception 'CUSTOMER_BATCH_ID_REQUIRED' using errcode = 'P0001';
  end if;
  for v_item in select value from jsonb_array_elements(p_customers)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or nullif(btrim(v_item->>'id'), '') is null then
      raise exception 'CUSTOMER_BATCH_ROW_INVALID' using errcode = 'P0001';
    end if;
    v_customer_id := v_item->>'id';
    if v_customer_id = any(v_seen) then
      raise exception 'CUSTOMER_BATCH_DUPLICATE_ID' using errcode = 'P0001';
    end if;
    v_seen := array_append(v_seen, v_customer_id);
  end loop;
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_migrate_local_customers', 'SYNC_PULL', 10, 600, 900, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_migrate_local_customers_v2', 'customer_directory', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate) || jsonb_build_object('batch_id', p_batch_id, 'processed', 0, 'results', '[]'::jsonb),
      null, null, jsonb_build_object('batch_id', p_batch_id));
  end if;
  for v_item in select value from jsonb_array_elements(p_customers)
  loop
    v_count := v_count + 1;
    v_customer_id := v_item->>'id';
    v_key := 'migration:' || p_batch_id || ':customer:' || v_customer_id;
    v_result := public.pos_upsert_customer_unlimited(
      p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
      v_item || jsonb_build_object('metadata', coalesce(v_item->'metadata', '{}'::jsonb) || jsonb_build_object('migration_batch_id', p_batch_id)),
      null, v_key
    );
    if coalesce((v_result->>'success')::boolean, false) is not true then
      v_failed := v_failed + 1;
    end if;
    v_results := v_results || jsonb_build_array(v_result);
  end loop;
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_migrate_local_customers_v2', 'customer_directory', v_context,
    jsonb_build_object('success', v_failed = 0, 'batch_id', p_batch_id, 'processed', v_count, 'failed', v_failed, 'results', v_results),
    null, null, jsonb_build_object('batch_id', p_batch_id));
end;
$function$;

create or replace function public.pos_pull_customers_snapshot_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_limit integer default 500,
  p_offset integer default 0, p_include_deleted boolean default false,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
  v_rows integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_has_more boolean;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_customers_snapshot', 'SYNC_PULL', 30, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customers_snapshot_v2', 'customer_directory', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate), null,
      jsonb_build_object('offset', v_offset, 'has_more', false, 'next_offset', v_offset));
  end if;
  v_payload := public.pos_pull_customers_snapshot_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    least(greatest(coalesce(p_limit, 500), 1), 1000), v_offset, coalesce(p_include_deleted, false)
  );
  v_rows := case when jsonb_typeof(v_payload->'customers') = 'array' then jsonb_array_length(v_payload->'customers') else 0 end;
  v_has_more := coalesce((v_payload->>'has_more')::boolean, false);
  v_payload := v_payload || jsonb_build_object('offset', v_offset, 'has_more', v_has_more);
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customers_snapshot_v2', 'customer_directory', v_context,
    v_payload, null, jsonb_build_object('offset', v_offset, 'has_more', v_has_more, 'next_offset', v_offset + v_rows));
end;
$function$;

create or replace function public.pos_pull_customer_changes_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_since_change_seq bigint default 0,
  p_limit integer default 500, p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
  v_since bigint := greatest(coalesce(p_since_change_seq, 0), 0);
  v_change_seq bigint;
  v_has_more boolean;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_pos_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_customer_changes', 'SYNC_PULL', 120, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_changes_v2', 'customer_directory', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate) || jsonb_build_object('latest_change_seq', v_since, 'has_more', false),
      null, jsonb_build_object('change_seq', v_since, 'has_more', false));
  end if;
  v_payload := public.pos_pull_customer_changes_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_since, least(greatest(coalesce(p_limit, 500), 1), 1000)
  );
  v_change_seq := greatest(v_since, coalesce(nullif(v_payload->>'latest_change_seq', '')::bigint, v_since));
  v_has_more := coalesce((v_payload->>'has_more')::boolean, false);
  v_payload := v_payload || jsonb_build_object('latest_change_seq', v_change_seq, 'has_more', v_has_more);
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_changes_v2', 'customer_directory', v_context,
    v_payload, null, jsonb_build_object('change_seq', v_change_seq, 'has_more', v_has_more));
end;
$function$;

create or replace function public.pos_get_customer_credit_summary_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_customer_id text default null,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  if nullif(btrim(p_customer_id), '') is null then raise exception 'CUSTOMER_ID_REQUIRED' using errcode = 'P0001'; end if;
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_get_customer_credit_summary', 'POS_READ_HEAVY', 60, 600, 300, 'REPORT_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_get_customer_credit_summary_v2', 'customer_credit', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate), p_customer_id);
  end if;
  v_payload := public.pos_get_customer_credit_summary_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token, p_customer_id
  );
  v_payload := v_payload || jsonb_build_object('ledger_reconciliation_complete', false);
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_get_customer_credit_summary_v2', 'customer_credit', v_context,
    v_payload, p_customer_id);
end;
$function$;

create or replace function public.pos_pull_customer_credit_snapshot_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_limit integer default 500,
  p_offset integer default 0, p_customer_id text default null,
  p_include_deleted boolean default false, p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
  v_rows integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_has_more boolean;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_customer_credit_snapshot', 'SYNC_PULL', 30, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_credit_snapshot_v2', 'customer_credit', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate) || jsonb_build_object('ledger_reconciliation_complete', false),
      p_customer_id, jsonb_build_object('offset', v_offset, 'has_more', false, 'next_offset', v_offset));
  end if;
  v_payload := public.pos_pull_customer_credit_snapshot_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    least(greatest(coalesce(p_limit, 500), 1), 1000), v_offset,
    p_customer_id, coalesce(p_include_deleted, false)
  );
  v_rows := case
    when jsonb_typeof(v_payload->'customers') = 'array' then jsonb_array_length(v_payload->'customers')
    when jsonb_typeof(v_payload->'results') = 'array' then jsonb_array_length(v_payload->'results')
    when jsonb_typeof(v_payload->'ledger_entries') = 'array' then jsonb_array_length(v_payload->'ledger_entries')
    else 0 end;
  v_has_more := coalesce((v_payload->>'has_more')::boolean, false);
  v_payload := v_payload || jsonb_build_object('has_more', v_has_more, 'ledger_reconciliation_complete', false);
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_credit_snapshot_v2', 'customer_credit', v_context,
    v_payload, p_customer_id, jsonb_build_object('offset', v_offset, 'has_more', v_has_more, 'next_offset', v_offset + v_rows));
end;
$function$;

create or replace function public.pos_pull_customer_credit_changes_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_since_change_seq bigint default 0,
  p_limit integer default 500, p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
  v_since bigint := greatest(coalesce(p_since_change_seq, 0), 0);
  v_change_seq bigint;
  v_has_more boolean;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_pull_customer_credit_changes', 'SYNC_PULL', 120, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_credit_changes_v2', 'customer_credit', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate) || jsonb_build_object('latest_change_seq', v_since, 'has_more', false, 'ledger_reconciliation_complete', false),
      null, jsonb_build_object('change_seq', v_since, 'has_more', false));
  end if;
  v_payload := public.pos_pull_customer_credit_changes_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    v_since, least(greatest(coalesce(p_limit, 500), 1), 1000)
  );
  v_change_seq := greatest(v_since, coalesce(nullif(v_payload->>'latest_change_seq', '')::bigint, v_since));
  v_has_more := coalesce((v_payload->>'has_more')::boolean, false);
  v_payload := v_payload || jsonb_build_object('latest_change_seq', v_change_seq, 'has_more', v_has_more, 'ledger_reconciliation_complete', false);
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_pull_customer_credit_changes_v2', 'customer_credit', v_context,
    v_payload, null, jsonb_build_object('change_seq', v_change_seq, 'has_more', v_has_more));
end;
$function$;

create or replace function public.pos_record_customer_payment_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_customer_id text default null,
  p_amount numeric default 0, p_payment_method text default 'efectivo',
  p_cash_session_id text default null, p_note text default null,
  p_allocations jsonb default '[]'::jsonb, p_idempotency_key text default null,
  p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_rate jsonb;
  v_payload jsonb;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  perform private.assert_cloud_customer_credit_sync_enabled(v_context);
  perform private.assert_pos_permission(v_context, 'customers');
  if nullif(btrim(p_customer_id), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'CUSTOMER_PAYMENT_IDENTITY_REQUIRED' using errcode = 'P0001';
  end if;
  v_rate := private.pos_fin01_rate_limit_v2(p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_record_customer_payment', 'POS_WRITE', 60, 600, 300, 'RPC_RATE_LIMITED', '{}'::jsonb);
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_record_customer_payment_v2', 'customer_credit', v_context,
      public.build_pos_rpc_rate_limited_response(v_rate), p_customer_id,
      null, jsonb_build_object('idempotency_key', p_idempotency_key));
  end if;
  v_payload := public.pos_record_customer_payment_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_customer_id, p_amount, p_payment_method, p_cash_session_id, p_note,
    coalesce(p_allocations, '[]'::jsonb), p_idempotency_key
  );
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_record_customer_payment_v2', 'customer_credit', v_context,
    v_payload, p_customer_id, null, jsonb_build_object('idempotency_key', p_idempotency_key));
end;
$function$;

create or replace function private.pos_fin01_create_credit_rate_limited_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text, p_sale jsonb, p_items jsonb, p_payments jsonb,
  p_cash_session_id text, p_customer_id text, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_create_cloud_sale_credit', 'POS_WRITE', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;
  return public.pos_create_cloud_sale_credit_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_sale, p_items, p_payments, p_cash_session_id, p_customer_id, p_idempotency_key
  );
end;
$function$;

create or replace function private.pos_fin01_cancel_sale_rate_limited_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text, p_sale_id text, p_reason text, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare v_rate jsonb;
begin
  v_rate := public.enforce_pos_rpc_rate_limit_v2(
    p_license_key, p_device_fingerprint, p_staff_session_token,
    'pos_cancel_cloud_sale', 'POS_WRITE', 60, 600, 300,
    'RPC_RATE_LIMITED', '{}'::jsonb
  );
  if coalesce((v_rate->>'allowed')::boolean, false) is false then
    return public.build_pos_rpc_rate_limited_response(v_rate);
  end if;
  return public.pos_cancel_cloud_sale_unlimited(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_sale_id, p_reason, p_idempotency_key
  );
end;
$function$;

do $dispatcher$
declare
  v_definition text;
begin
  v_definition := pg_get_functiondef(
    to_regprocedure('public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)')
  );
  -- Only these three exact substitutions are permitted in the hash-pinned
  -- source. Transition admission, parent locks/origin checks and completed-sale
  -- reconciliation remain byte-for-byte in the copied core.
  if array_length(string_to_array(v_definition, 'CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1('), 1) is distinct from 2
     or array_length(string_to_array(v_definition, 'public.pos_create_cloud_sale_credit('), 1) is distinct from 2
     or array_length(string_to_array(v_definition, 'public.pos_cancel_cloud_sale('), 1) is distinct from 2 then
    raise exception 'FIN01_V_DISPATCHER_SOURCE_UNEXPECTED';
  end if;
  v_definition := replace(v_definition,
    'CREATE OR REPLACE FUNCTION public.pos_execute_financial_operation_v1(',
    'CREATE OR REPLACE FUNCTION private.pos_execute_financial_operation_core_v2(');
  v_definition := replace(v_definition,
    'public.pos_create_cloud_sale_credit(',
    'private.pos_fin01_create_credit_rate_limited_v2(');
  v_definition := replace(v_definition,
    'public.pos_cancel_cloud_sale(',
    'private.pos_fin01_cancel_sale_rate_limited_v2(');
  if position('public.pos_create_cloud_sale_credit(' in v_definition) > 0
     or position('public.pos_cancel_cloud_sale(' in v_definition) > 0
     or position('public.pos_execute_financial_operation_v1(' in v_definition) > 0 then
    raise exception 'FIN01_V_LEGACY_DISPATCH_REWRITE_INCOMPLETE';
  end if;
  execute v_definition;
end;
$dispatcher$;

create or replace function public.pos_execute_financial_operation_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_idempotency_key text default null,
  p_request_hash text default null, p_operation_type text default null,
  p_request jsonb default '{}'::jsonb, p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout = '45s'
set lock_timeout = '20s'
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_payload jsonb;
  v_operation public.pos_financial_operations;
  v_customer_id text;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token);
  if not (p_sync_contract->'capabilities' @> '["financial_operation_result_v1"]'::jsonb) then
    raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_payload := private.pos_execute_financial_operation_core_v2(
    p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token,
    p_idempotency_key, p_request_hash, p_operation_type, coalesce(p_request, '{}'::jsonb)
  );
  select o.* into v_operation
    from public.pos_financial_operations o
   where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  v_customer_id := nullif(btrim(coalesce(p_request->>'customer_id', p_request #>> '{sale,customer_id}', p_request #>> '{sale,customerId}')), '');
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_execute_financial_operation_v2', 'financial_operations', v_context,
    v_payload, v_customer_id, null,
    jsonb_build_object('idempotency_key', p_idempotency_key, 'request_hash', p_request_hash,
      'operation_type', coalesce(v_operation.operation_type, p_operation_type),
      'status', coalesce(v_operation.status, 'unknown'), 'operation_id', v_operation.id));
end;
$function$;

create or replace function public.pos_get_financial_operation_receipt_v2(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text default null, p_idempotency_key text default null,
  p_request_hash text default null, p_sync_contract jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_context jsonb;
  v_license_id uuid;
  v_device_id uuid;
  v_actor_key text;
  v_operation public.pos_financial_operations;
  v_payload jsonb;
  v_operation_identity jsonb;
  v_operation_status text := 'NOT_FOUND';
  v_origin_authorized boolean := false;
begin
  perform private.pos_fin01_enter_pilot_v2(p_sync_contract,p_license_key,p_device_fingerprint,p_security_token,p_staff_session_token,true);
  if not (p_sync_contract->'capabilities' @> '["financial_operation_result_v1"]'::jsonb) then
    raise exception 'CLOUD_CLIENT_UPDATE_REQUIRED' using errcode = 'P0001';
  end if;
  v_context := private.validate_pos_sync_context(p_license_key, p_device_fingerprint, p_security_token, p_staff_session_token);
  v_license_id := (v_context->>'license_id')::uuid;
  v_device_id := nullif(v_context->>'device_id', '')::uuid;
  v_actor_key := private.resolve_cash_actor_key(v_context);
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'FINANCIAL_IDEMPOTENCY_KEY_REQUIRED' using errcode = 'P0001';
  end if;
  perform private.assert_financial_request_hash_v1(p_request_hash);
  perform private.lock_financial_operation_v1(v_license_id, p_idempotency_key);
  select * into v_operation from public.pos_financial_operations o
   where o.license_id = v_license_id and o.idempotency_key = p_idempotency_key;
  if v_operation.id is null then
    v_payload := jsonb_build_object('status', 'NOT_FOUND');
  else
    begin
      perform private.assert_financial_operation_origin_v1(v_operation, v_actor_key, v_device_id, null);
      v_origin_authorized := true;
    exception when sqlstate 'P0001' then
      v_payload := jsonb_build_object('status', 'NOT_FOUND');
      v_origin_authorized := false;
    end;
    if v_payload is null then
      if v_operation.request_hash is distinct from p_request_hash then
        v_payload := jsonb_build_object('status', 'CONFLICT', 'code', 'IDEMPOTENCY_CONFLICT');
      elsif v_operation.status = 'processing' then
        v_payload := jsonb_build_object('status', 'PROCESSING', 'operation_type', v_operation.operation_type);
      else
        v_payload := jsonb_build_object('status', 'COMPLETED', 'operation_type', v_operation.operation_type, 'result', v_operation.response_payload);
      end if;
    end if;
  end if;
  v_operation_status := coalesce(v_payload->>'status', 'NOT_FOUND');
  v_operation_identity := jsonb_build_object(
    'idempotency_key', p_idempotency_key,
    'request_hash', p_request_hash,
    'status', v_operation_status
  );
  if v_origin_authorized then
    v_operation_identity := v_operation_identity || jsonb_build_object(
      'operation_type', v_operation.operation_type,
      'operation_id', v_operation.id
    );
  end if;
  return private.pos_fin01_sync_envelope_v2(v_license_id, 'pos_get_financial_operation_receipt_v2', 'financial_operations', v_context,
    v_payload, null, null, v_operation_identity);
end;
$function$;

-- Private helpers are callable only by postgres-owned SECURITY DEFINER RPCs.
alter function private.pos_fin01_validate_sync_contract_v2(jsonb) owner to postgres;
alter function private.pos_fin01_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb) owner to postgres;
alter function private.pos_fin01_client_identity_v2(jsonb) owner to postgres;
alter function private.pos_fin01_customer_ids_v2(jsonb) owner to postgres;
alter function private.pos_fin01_customer_projections_v2(uuid,jsonb) owner to postgres;
alter function private.pos_fin01_sync_envelope_v2(uuid,text,text,jsonb,jsonb,text,jsonb,jsonb) owner to postgres;
alter function private.pos_fin01_create_credit_rate_limited_v2(text,text,text,text,jsonb,jsonb,jsonb,text,text,text) owner to postgres;
alter function private.pos_fin01_cancel_sale_rate_limited_v2(text,text,text,text,text,text,text) owner to postgres;
alter function private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb) owner to postgres;

revoke all on function private.pos_fin01_validate_sync_contract_v2(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_rate_limit_v2(text,text,text,text,text,integer,integer,integer,text,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_client_identity_v2(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_customer_ids_v2(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_customer_projections_v2(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_sync_envelope_v2(uuid,text,text,jsonb,jsonb,text,jsonb,jsonb) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_create_credit_rate_limited_v2(text,text,text,text,jsonb,jsonb,jsonb,text,text,text) from public, anon, authenticated, service_role;
revoke all on function private.pos_fin01_cancel_sale_rate_limited_v2(text,text,text,text,text,text,text) from public, anon, authenticated, service_role;
revoke all on function private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb) from public, anon, authenticated, service_role;

alter function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) owner to postgres;
alter function public.pos_upsert_customer_v2(text,text,text,text,jsonb,integer,text,jsonb) owner to postgres;
alter function public.pos_delete_customer_v2(text,text,text,text,text,integer,text,jsonb) owner to postgres;
alter function public.pos_migrate_local_customers_v2(text,text,text,text,jsonb,text,jsonb) owner to postgres;
alter function public.pos_pull_customers_snapshot_v2(text,text,text,text,integer,integer,boolean,jsonb) owner to postgres;
alter function public.pos_pull_customer_changes_v2(text,text,text,text,bigint,integer,jsonb) owner to postgres;
alter function public.pos_get_customer_credit_summary_v2(text,text,text,text,text,jsonb) owner to postgres;
alter function public.pos_pull_customer_credit_snapshot_v2(text,text,text,text,integer,integer,text,boolean,jsonb) owner to postgres;
alter function public.pos_pull_customer_credit_changes_v2(text,text,text,text,bigint,integer,jsonb) owner to postgres;
alter function public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb) owner to postgres;
alter function public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb) owner to postgres;
alter function public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb) owner to postgres;

revoke all on function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) from public;
revoke all on function public.pos_upsert_customer_v2(text,text,text,text,jsonb,integer,text,jsonb) from public;
revoke all on function public.pos_delete_customer_v2(text,text,text,text,text,integer,text,jsonb) from public;
revoke all on function public.pos_migrate_local_customers_v2(text,text,text,text,jsonb,text,jsonb) from public;
revoke all on function public.pos_pull_customers_snapshot_v2(text,text,text,text,integer,integer,boolean,jsonb) from public;
revoke all on function public.pos_pull_customer_changes_v2(text,text,text,text,bigint,integer,jsonb) from public;
revoke all on function public.pos_get_customer_credit_summary_v2(text,text,text,text,text,jsonb) from public;
revoke all on function public.pos_pull_customer_credit_snapshot_v2(text,text,text,text,integer,integer,text,boolean,jsonb) from public;
revoke all on function public.pos_pull_customer_credit_changes_v2(text,text,text,text,bigint,integer,jsonb) from public;
revoke all on function public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb) from public;
revoke all on function public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb) from public;
revoke all on function public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb) from public;

grant execute on function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) to anon, authenticated;
grant execute on function public.pos_upsert_customer_v2(text,text,text,text,jsonb,integer,text,jsonb) to anon, authenticated;
grant execute on function public.pos_delete_customer_v2(text,text,text,text,text,integer,text,jsonb) to anon, authenticated;
grant execute on function public.pos_migrate_local_customers_v2(text,text,text,text,jsonb,text,jsonb) to anon, authenticated;
grant execute on function public.pos_pull_customers_snapshot_v2(text,text,text,text,integer,integer,boolean,jsonb) to anon, authenticated;
grant execute on function public.pos_pull_customer_changes_v2(text,text,text,text,bigint,integer,jsonb) to anon, authenticated;
grant execute on function public.pos_get_customer_credit_summary_v2(text,text,text,text,text,jsonb) to anon, authenticated;
grant execute on function public.pos_pull_customer_credit_snapshot_v2(text,text,text,text,integer,integer,text,boolean,jsonb) to anon, authenticated;
grant execute on function public.pos_pull_customer_credit_changes_v2(text,text,text,text,bigint,integer,jsonb) to anon, authenticated;
grant execute on function public.pos_record_customer_payment_v2(text,text,text,text,text,numeric,text,text,text,jsonb,text,jsonb) to anon, authenticated;
grant execute on function public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb) to anon, authenticated;
grant execute on function public.pos_get_financial_operation_receipt_v2(text,text,text,text,text,text,jsonb) to anon, authenticated;

comment on function public.pos_fin01_sync_contract_v1(text,text,text,text,integer,text[]) is
  'FIN-01 informational Cloud Sync v2 contract discovery; capabilities do not confer authorization.';
comment on function public.pos_upsert_customer_v2(text,text,text,text,jsonb,integer,text,jsonb) is
  'FIN-01 v2 adapter for the guarded customer core; financial debt is projected from server cents and never inferred from absence.';
comment on function public.pos_migrate_local_customers_v2(text,text,text,text,jsonb,text,jsonb) is
  'FIN-01 v2 directory batch adapter; stable migration idempotency keys; historical credit remains owner-authorized through pos_historical_credit_batch_v1.';
comment on function public.pos_execute_financial_operation_v2(text,text,text,text,text,text,text,jsonb,jsonb) is
  'FIN-01 v2 envelope over the shared financial operation ledger; replays preserve the original idempotency key, request hash, and response.';

notify pgrst, 'reload schema';
commit;
