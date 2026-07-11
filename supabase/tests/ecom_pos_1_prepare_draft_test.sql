-- ECOM.POS.1.1 controlled SQL test.
-- Every fixture and temporary change is reverted by the final ROLLBACK.
begin;

do $mapping_test$
declare
  v_order_id uuid;
  v_portal_id uuid;
  v_license_id uuid;
  v_published_id uuid;
  v_expected_source text;
  v_real_item uuid := extensions.gen_random_uuid();
  v_other_license_item uuid := extensions.gen_random_uuid();
  v_other_portal_item uuid := extensions.gen_random_uuid();
  v_unlinked_item uuid := extensions.gen_random_uuid();
  v_other_license_published uuid;
  v_other_portal uuid := extensions.gen_random_uuid();
  v_other_portal_published uuid := extensions.gen_random_uuid();
  v_unlinked_published uuid := extensions.gen_random_uuid();
  v_snapshot jsonb;
  v_snapshot_source text;
  v_unmapped integer;
begin
  select o.id, o.portal_id, o.license_id
  into v_order_id, v_portal_id, v_license_id
  from public.ecommerce_orders o
  where o.public_order_code = 'EC-00000010'
  limit 1;

  if v_order_id is null then raise exception 'mapping fixture order missing'; end if;

  select pp.id, coalesce(pp.product_id, pp.local_product_ref)
  into v_published_id, v_expected_source
  from public.ecommerce_published_products pp
  where pp.portal_id = v_portal_id
    and pp.license_id = v_license_id
    and coalesce(pp.product_id, pp.local_product_ref) is not null
  order by pp.created_at, pp.id
  limit 1;

  if v_published_id is null or v_expected_source is null then
    raise exception 'same-tenant mapped publication missing';
  end if;

  -- Reproduce the real checkout contract: published_product_id is present and source_product_id is null.
  insert into public.ecommerce_order_items (
    id, order_id, portal_id, license_id, published_product_id, source_product_id,
    product_name, unit_price, quantity, line_total
  ) values (
    v_real_item, v_order_id, v_portal_id, v_license_id, v_published_id, null,
    'ECOM.POS.1.1 realistic item', 1, 1, 1
  );

  if (select source_product_id from public.ecommerce_order_items where id = v_real_item)
       is distinct from v_expected_source then
    raise exception 'server trigger did not map realistic checkout item';
  end if;

  -- Same tenant, but genuinely unlinked publication: source remains null.
  insert into public.ecommerce_published_products (
    id, portal_id, license_id, source_type, product_id, local_product_ref,
    public_name, price
  ) values (
    v_unlinked_published, v_portal_id, v_license_id, 'local_snapshot', null, null,
    'ECOM POS unlinked publication', 1
  );

  insert into public.ecommerce_order_items (
    id, order_id, portal_id, license_id, published_product_id, source_product_id,
    product_name, unit_price, quantity, line_total
  ) values (
    v_unlinked_item, v_order_id, v_portal_id, v_license_id, v_unlinked_published, null,
    'ECOM.POS.1.1 unlinked item', 1, 1, 1
  );

  if (select source_product_id is not null from public.ecommerce_order_items where id = v_unlinked_item) then
    raise exception 'unlinked publication mapped unexpectedly';
  end if;

  -- Publication from another license must never map.
  select pp.id into v_other_license_published
  from public.ecommerce_published_products pp
  where pp.license_id <> v_license_id
    and coalesce(pp.product_id, pp.local_product_ref) is not null
  order by pp.created_at, pp.id
  limit 1;

  if v_other_license_published is null then raise exception 'other-license publication missing'; end if;

  insert into public.ecommerce_order_items (
    id, order_id, portal_id, license_id, published_product_id, source_product_id,
    product_name, unit_price, quantity, line_total
  ) values (
    v_other_license_item, v_order_id, v_portal_id, v_license_id,
    v_other_license_published, null, 'ECOM.POS.1.1 other-license item', 1, 1, 1
  );

  if (select source_product_id is not null from public.ecommerce_order_items where id = v_other_license_item) then
    raise exception 'cross-license publication mapped unexpectedly';
  end if;

  -- Build a second active portal for the same license only inside this rollback transaction.
  update public.ecommerce_portals set deleted_at = now() where id = v_portal_id;

  insert into public.ecommerce_portals (id, license_id, slug, name)
  values (
    v_other_portal,
    v_license_id,
    'ecom-pos-test-' || replace(v_other_portal::text, '-', ''),
    'ECOM POS temporary portal'
  );

  insert into public.ecommerce_published_products (
    id, portal_id, license_id, source_type, product_id, local_product_ref,
    public_name, price
  ) values (
    v_other_portal_published, v_other_portal, v_license_id, 'local_snapshot', null,
    'other-portal-local-ref', 'ECOM POS other portal publication', 1
  );

  insert into public.ecommerce_order_items (
    id, order_id, portal_id, license_id, published_product_id, source_product_id,
    product_name, unit_price, quantity, line_total
  ) values (
    v_other_portal_item, v_order_id, v_portal_id, v_license_id,
    v_other_portal_published, null, 'ECOM.POS.1.1 other-portal item', 1, 1, 1
  );

  if (select source_product_id is not null from public.ecommerce_order_items where id = v_other_portal_item) then
    raise exception 'cross-portal publication mapped unexpectedly';
  end if;

  update public.ecommerce_portals set deleted_at = now() where id = v_other_portal;
  update public.ecommerce_portals set deleted_at = null where id = v_portal_id;

  -- Simulate legacy rows and execute the exact safe backfill contract.
  update public.ecommerce_order_items set source_product_id = null where id = v_real_item;

  update public.ecommerce_order_items as i
  set source_product_id = coalesce(pp.product_id, pp.local_product_ref)
  from public.ecommerce_published_products as pp
  where pp.id = i.published_product_id
    and pp.portal_id = i.portal_id
    and pp.license_id = i.license_id
    and i.source_product_id is null
    and coalesce(pp.product_id, pp.local_product_ref) is not null;

  select count(*) into v_unmapped
  from public.ecommerce_order_items i
  join public.ecommerce_published_products pp
    on pp.id = i.published_product_id
   and pp.portal_id = i.portal_id
   and pp.license_id = i.license_id
  where i.source_product_id is null
    and coalesce(pp.product_id, pp.local_product_ref) is not null;

  if v_unmapped <> 0 then raise exception 'backfill left % mappable item(s)', v_unmapped; end if;
  if (select source_product_id from public.ecommerce_order_items where id = v_real_item)
       is distinct from v_expected_source then raise exception 'backfill did not map realistic item'; end if;
  if (select source_product_id is not null from public.ecommerce_order_items where id = v_other_license_item)
     or (select source_product_id is not null from public.ecommerce_order_items where id = v_other_portal_item)
     or (select source_product_id is not null from public.ecommerce_order_items where id = v_unlinked_item) then
    raise exception 'backfill crossed tenant boundary or mapped an unlinked product';
  end if;

  -- Snapshot fallback remains safe when a legacy row is temporarily null.
  update public.ecommerce_order_items set source_product_id = null where id = v_real_item;
  v_snapshot := private.ecommerce_order_pos_snapshot_v1(
    v_order_id,
    v_license_id,
    jsonb_build_object('actor_type', 'admin', 'device_id', 'sql-ecom-pos-1-1')
  );

  select item->>'sourceProductId' into v_snapshot_source
  from jsonb_array_elements(coalesce(v_snapshot->'items', '[]'::jsonb)) item
  where item->>'id' = v_real_item::text
  limit 1;

  if v_snapshot_source is distinct from v_expected_source then
    raise exception 'snapshot fallback did not resolve same-tenant product';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_snapshot->'items', '[]'::jsonb)) item
    where item->>'id' in (
      v_other_license_item::text,
      v_other_portal_item::text,
      v_unlinked_item::text
    ) and item->>'sourceProductId' is not null
  ) then raise exception 'snapshot exposed cross-tenant or unlinked mapping'; end if;

  if has_function_privilege('anon', 'private.ecommerce_resolve_order_item_source_product_v1()', 'execute')
     or has_function_privilege('authenticated', 'private.ecommerce_resolve_order_item_source_product_v1()', 'execute')
     or has_function_privilege('public', 'private.ecommerce_resolve_order_item_source_product_v1()', 'execute')
     or has_function_privilege('anon', 'private.ecommerce_order_pos_snapshot_v1(uuid,uuid,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'private.ecommerce_order_pos_snapshot_v1(uuid,uuid,jsonb)', 'execute')
     or has_function_privilege('public', 'private.ecommerce_order_pos_snapshot_v1(uuid,uuid,jsonb)', 'execute') then
    raise exception 'private ecommerce POS helper is executable by a client role';
  end if;

  if has_table_privilege('anon', 'public.ecommerce_order_items', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.ecommerce_order_items', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.ecommerce_published_products', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.ecommerce_published_products', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.ecommerce_orders', 'select,insert,update,delete')
     or has_table_privilege('authenticated', 'public.ecommerce_orders', 'select,insert,update,delete') then
    raise exception 'client role retains direct ecommerce table grants';
  end if;
end;
$mapping_test$;

do $claim_test$
declare
  v_license_id uuid;
  v_license_key text;
  v_order_id uuid;
  v_new_order_id uuid;
  v_admin_id uuid;
  v_admin_fingerprint text;
  v_staff_ok uuid := extensions.gen_random_uuid();
  v_staff_other uuid := extensions.gen_random_uuid();
  v_staff_ok_device uuid := extensions.gen_random_uuid();
  v_staff_other_device uuid := extensions.gen_random_uuid();
  v_result jsonb;
  v_retry jsonb;
  v_claim_token uuid;
begin
  select o.id, o.license_id, l.license_key
  into v_order_id, v_license_id, v_license_key
  from public.ecommerce_orders o
  join public.licenses l on l.id = o.license_id
  where o.public_order_code = 'EC-00000010';
  select id into v_new_order_id from public.ecommerce_orders where public_order_code = 'EC-00000011';
  if v_order_id is null or v_new_order_id is null then raise exception 'claim fixture orders missing'; end if;

  select id, device_fingerprint into v_admin_id, v_admin_fingerprint
  from public.license_devices
  where license_id = v_license_id and device_role = 'admin' and is_active is true
  limit 1;
  if v_admin_id is null then raise exception 'active admin fixture missing'; end if;

  update public.license_devices
  set security_token = 'fixture-token-a', previous_security_token = null
  where id = v_admin_id;

  insert into public.license_staff_users(id, license_id, username, display_name, password_hash, permissions)
  values
    (v_staff_ok, v_license_id, 'ecom_pos_ok', 'ECOM POS OK', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"ecommerce":true,"pos":true}'::jsonb),
    (v_staff_other, v_license_id, 'ecom_pos_other', 'ECOM POS OTHER', extensions.crypt('fixture', extensions.gen_salt('bf')), '{"ecommerce":true,"pos":true}'::jsonb);

  insert into public.license_devices(id, license_id, device_fingerprint, device_name, is_active, security_token, device_role, staff_user_id)
  values
    (v_staff_ok_device, v_license_id, 'ecom-pos-test-staff-ok', 'ECOM POS STAFF OK', true, 'fixture-token-ok', 'staff', v_staff_ok),
    (v_staff_other_device, v_license_id, 'ecom-pos-test-staff-other', 'ECOM POS STAFF OTHER', true, 'fixture-token-other', 'staff', v_staff_other);

  insert into public.license_staff_sessions(license_id, staff_user_id, device_id, session_token_hash, expires_at)
  values
    (v_license_id, v_staff_ok, v_staff_ok_device, extensions.crypt('session-ok', extensions.gen_salt('bf')), now() + interval '1 hour'),
    (v_license_id, v_staff_other, v_staff_other_device, extensions.crypt('session-other', extensions.gen_salt('bf')), now() + interval '1 hour');

  update public.ecommerce_orders
  set status = 'accepted', accepted_at = coalesce(accepted_at, now()), converted_sale_id = null,
      pos_draft_status = 'none', pos_draft_id = null, pos_claim_token = null,
      pos_claim_request_key = null, pos_claimed_at = null, pos_claim_expires_at = null,
      pos_claim_actor_type = null, pos_claim_actor_ref = null, pos_draft_prepared_at = null
  where id = v_order_id;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-admin-a'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'admin claim failed: %', v_result->>'code';
  end if;
  v_claim_token := nullif(v_result #>> '{order,posDraft,claimToken}', '')::uuid;
  if v_claim_token is null then raise exception 'claim token missing'; end if;

  v_retry := public.ecommerce_admin_claim_pos_draft(
    v_license_key, v_admin_fingerprint, 'fixture-token-a', null, v_order_id, 'request-admin-a'
  );
  if nullif(v_retry #>> '{order,posDraft,claimToken}', '')::uuid is distinct from v_claim_token then
    raise exception 'idempotent claim changed token';
  end if;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_license_key, 'ecom-pos-test-staff-other', 'fixture-token-other', 'session-other',
    v_order_id, 'request-other-device'
  );
  if v_result->>'code' <> 'ECOMMERCE_POS_DRAFT_IN_PROGRESS' then
    raise exception 'second device was not blocked';
  end if;

  v_result := public.ecommerce_admin_confirm_pos_draft(
    v_license_key, v_admin_fingerprint, 'fixture-token-a', null,
    v_order_id, v_claim_token, 'ecom-test'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'confirm failed'; end if;
  if (select status <> 'accepted' or converted_sale_id is not null or pos_draft_status <> 'prepared'
      from public.ecommerce_orders where id = v_order_id) then
    raise exception 'confirm changed financial conversion state';
  end if;

  v_retry := public.ecommerce_admin_confirm_pos_draft(
    v_license_key, v_admin_fingerprint, 'fixture-token-a', null,
    v_order_id, v_claim_token, 'ecom-test'
  );
  if coalesce((v_retry->>'success')::boolean, false) is not true
     or coalesce((v_retry->>'changed')::boolean, true) is true then
    raise exception 'confirm is not idempotent';
  end if;

  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key, v_admin_fingerprint, 'fixture-token-a', null,
    v_order_id, null, 'admin_release'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'admin release failed'; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_license_key, 'ecom-pos-test-staff-ok', 'fixture-token-ok', 'session-ok',
    v_order_id, 'request-staff-ok'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'authorized staff claim failed'; end if;
  v_claim_token := nullif(v_result #>> '{order,posDraft,claimToken}', '')::uuid;

  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key, 'ecom-pos-test-staff-other', 'fixture-token-other', 'session-other',
    v_order_id, v_claim_token, 'foreign_release'
  );
  if v_result->>'code' <> 'ECOMMERCE_POS_DRAFT_TOKEN_INVALID' then raise exception 'foreign release was not blocked'; end if;

  v_result := public.ecommerce_admin_release_pos_draft(
    v_license_key, 'ecom-pos-test-staff-ok', 'fixture-token-ok', 'session-ok',
    v_order_id, v_claim_token, 'owner_release'
  );
  if coalesce((v_result->>'success')::boolean, false) is not true then raise exception 'owner release failed'; end if;

  v_result := public.ecommerce_admin_claim_pos_draft(
    v_license_key, v_admin_fingerprint, 'fixture-token-a', null,
    v_new_order_id, 'request-new'
  );
  if v_result->>'code' <> 'ECOMMERCE_ORDER_INVALID_TRANSITION' then raise exception 'non-accepted order was not blocked'; end if;

  if has_function_privilege('public', 'public.ecommerce_admin_claim_pos_draft(text,text,text,text,uuid,text)', 'execute') then
    raise exception 'PUBLIC can execute claim RPC';
  end if;
  if has_function_privilege('anon', 'private.ecommerce_pos_draft_authorize_v1(text,text,text,text,text)', 'execute')
     or has_function_privilege('authenticated', 'private.ecommerce_pos_draft_authorize_v1(text,text,text,text,text)', 'execute') then
    raise exception 'private authorization helper is executable by client role';
  end if;
end;
$claim_test$;

select jsonb_build_object(
  'status', 'ECOM.POS.1.1 SQL PASS',
  'realisticProductMapping', true,
  'backfill', true,
  'crossLicenseBlocked', true,
  'crossPortalBlocked', true,
  'snapshotFallback', true,
  'claimIdempotency', true,
  'financialEffects', 0,
  'rolledBack', true
) as result;

rollback;
