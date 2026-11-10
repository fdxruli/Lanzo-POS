-- LANZO POS P1. Complementary integration regression, synthetic fixture, one transaction.
-- Execute ONLY against an authorized isolated PostgreSQL fixture with the P1 migration applied.
-- Never execute against Supabase Production without separate permission.
begin;
do $test$
declare
  v_suffix text := lower(substr(md5(random()::text || clock_timestamp()::text),1,12));
  v_license_id uuid := extensions.gen_random_uuid();
  v_device_id uuid := extensions.gen_random_uuid();
  v_staff_id uuid := extensions.gen_random_uuid();
  v_product_id text := 'legacy-p1-product-' || v_suffix;
  v_batch_id text := 'legacy-p1-batch-' || v_suffix;
  v_license_key text := 'LEGACY-P1-' || v_suffix;
  v_device_fingerprint text := 'legacy-p1-device-' || v_suffix;
  v_security_token text := 'legacy-p1-security-' || v_suffix;
  v_staff_token text := 'legacy-p1-staff-' || v_suffix;
  v_station_id text := 'legacy-p1-station-' || v_suffix;
  v_cash_id text := 'legacy-p1-cash-' || v_suffix;
  v_sale_id text;
  v_sale jsonb;
  v_items jsonb;
  v_payments jsonb;
  v_response jsonb;
  v_receipt jsonb;
  v_error text;
  v_stock numeric;
  v_moves integer;
  v_cash_moves integer;
  v_sales integer;
begin
  insert into public.licenses(
    id,license_key,license_type,status,expires_at,max_devices,
    product_name,features,plan_id
  ) values (
    v_license_id,v_license_key,'pro','active',now()+interval '1 day',4,
    'P1 legacy inventory synthetic fixture',
    '{"cloud_pos_sync":true,"cloud_sales_sync_base":true,"cloud_sales_cashier":true,"cloud_sales_credit":true,"cloud_sales_inventory":true,"cloud_products_sync":true,"cloud_cash_sync":true}'::jsonb,
    (select id from public.plans where code='pro_monthly' limit 1)
  );
  insert into public.license_staff_users(id,license_id,username,display_name,password_hash,permissions)
  values (
    v_staff_id,v_license_id,'legacy_p1_staff_'||v_suffix,'P1 Staff',
    extensions.crypt('p1-test-password',extensions.gen_salt('bf',4)),
    '{"pos":true,"cash_register":true,"customers":true,"discounts":false}'::jsonb
  );
  insert into public.license_devices(
    id,license_id,device_fingerprint,device_name,security_token,
    is_active,device_role,staff_user_id
  ) values (
    v_device_id,v_license_id,v_device_fingerprint,'P1 fixture device',v_security_token,
    true,'staff',v_staff_id
  );
  insert into public.license_staff_sessions(
    license_id,staff_user_id,device_id,session_token_hash,expires_at
  ) values (
    v_license_id,v_staff_id,v_device_id,
    extensions.crypt(v_staff_token,extensions.gen_salt('bf',4)),
    now()+interval '1 hour'
  );
  insert into public.pos_products(
    id,license_id,name,name_key,price,cost,stock,committed_stock,track_stock,
    is_active,product_type,sale_type,batch_management,expiration_mode,server_version
  ) values (
    v_product_id,v_license_id,'P1 controlled product',v_product_id,25,8,8,0,true,
    true,'sellable','unit','{"enabled":false}'::jsonb,'NONE',1
  );
  insert into public.pos_product_batches(
    id,license_id,product_id,sku,stock,committed_stock,cost,price,
    track_stock,is_active,status,active_stock_status
  ) values (
    v_batch_id,v_license_id,v_product_id,'P1-BATCH-'||v_suffix,8,0,8,25,
    false,true,'active',1
  );
  insert into public.pos_cash_stations(id,license_id,station_key,status,binding_mode)
  values (v_station_id,v_license_id,'p1-station-'||v_suffix,'active','explicit');
  insert into public.pos_cash_station_bindings(license_id,cash_station_id,device_id,binding_mode,status)
  values (v_license_id,v_station_id,v_device_id,'explicit','active');
  insert into public.pos_cash_sessions(
    id,license_id,device_id,staff_user_id,device_role,scope,actor_key,
    status,cash_station_id,opened_by_actor_key,opening_amount,
    expected_cash_total,responsible_name,opened_by_device_id,
    opened_by_staff_user_id,server_version
  ) values (
    v_cash_id,v_license_id,v_device_id,v_staff_id,'staff','actor',
    'staff:'||v_staff_id,'open',v_station_id,'staff:'||v_staff_id,0,
    0,'P1 Staff',v_device_id,v_staff_id,1
  );

  -- 1 / 7: 6B controlled product; fake flags cannot override catalog.
  v_sale_id := 'p1-legacy-reject-'||v_suffix;
  v_sale := jsonb_build_object(
    'id',v_sale_id,'local_sale_id',v_sale_id,'total',25,'subtotal',25,
    'amount_paid',25,'payment_method','cash',
    'metadata',jsonb_build_object('cloudInventoryEffects',false,'noCloudInventoryEffects',true,'snapshotOnly',true)
  );
  v_items := jsonb_build_array(jsonb_build_object(
    'id',v_sale_id||':item','product_id',v_product_id,'quantity',1,
    'unit_price',25,'line_subtotal',25,'line_total',25,'track_stock',false
  ));
  v_payments := jsonb_build_array(jsonb_build_object(
    'id',v_sale_id||':pay','method','cash','amount',25,'received_amount',25,'change_amount',0
  ));
  v_error := null;
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      v_sale,v_items,v_payments,v_cash_id,'p1-legacy-idem-'||v_suffix
    );
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error=message_text;
  end;
  if v_error is null or position('CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED' in v_error)=0 then
    raise exception 'P1_LEGACY_NOT_REJECTED: %',v_error;
  end if;
  if exists(select 1 from public.pos_sales where license_id=v_license_id and id=v_sale_id)
     or exists(select 1 from public.pos_sale_payments where license_id=v_license_id and sale_id=v_sale_id)
     or exists(select 1 from public.pos_inventory_movements where license_id=v_license_id and sale_id=v_sale_id)
     or exists(select 1 from public.pos_cash_movements where license_id=v_license_id) then
    raise exception 'P1_LEGACY_PARTIAL_EFFECTS';
  end if;

  -- 1b: cloudInventoryEffects=true used to bypass the old v_operation guard.
  -- The 6C-only server scope must not be set for this direct legacy call.
  v_sale_id := 'p1-legacy-true-'||v_suffix;
  v_error := null;
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      jsonb_build_object('id',v_sale_id,'local_sale_id',v_sale_id,'total',25,'subtotal',25,'amount_paid',25,'payment_method','cash',
        'metadata',jsonb_build_object('cloudInventoryEffects',true)),
      jsonb_build_array(jsonb_build_object('id',v_sale_id||':item','product_id',v_product_id,'quantity',1,
        'unit_price',25,'line_subtotal',25,'line_total',25)),
      jsonb_build_array(jsonb_build_object('id',v_sale_id||':pay','method','cash','amount',25,'received_amount',25,'change_amount',0)),
      v_cash_id,'p1-legacy-true-idem-'||v_suffix
    );
  exception when sqlstate 'P0001' then get stacked diagnostics v_error=message_text;
  end;
  if v_error is null or position('CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED' in v_error)=0
    or exists(select 1 from public.pos_sales where license_id=v_license_id and id=v_sale_id)
    or exists(select 1 from public.pos_cash_movements where license_id=v_license_id) then
    raise exception 'P1_LEGACY_TRUE_FLAG_BYPASS: %',v_error;
  end if;

  -- 1c: absent client flag is also denied for controlled products.
  v_sale_id := 'p1-legacy-absent-'||v_suffix;
  v_error := null;
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      jsonb_build_object('id',v_sale_id,'local_sale_id',v_sale_id,'total',25,'subtotal',25,'amount_paid',25,'payment_method','cash'),
      jsonb_build_array(jsonb_build_object('id',v_sale_id||':item','product_id',v_product_id,'quantity',1,
        'unit_price',25,'line_subtotal',25,'line_total',25)),
      jsonb_build_array(jsonb_build_object('id',v_sale_id||':pay','method','cash','amount',25,'received_amount',25,'change_amount',0)),
      v_cash_id,'p1-legacy-absent-idem-'||v_suffix
    );
  exception when sqlstate 'P0001' then get stacked diagnostics v_error=message_text;
  end;
  if v_error is null or position('CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED' in v_error)=0
    or exists(select 1 from public.pos_sales where license_id=v_license_id and id=v_sale_id)
    or exists(select 1 from public.pos_cash_movements where license_id=v_license_id) then
    raise exception 'P1_LEGACY_ABSENT_FLAG_BYPASS: %',v_error;
  end if;

  -- 2: 6C stock and cash are applied once.
  v_sale_id := 'p1-modern-'||v_suffix;
  v_sale := jsonb_build_object(
    'id',v_sale_id,'local_sale_id',v_sale_id,'total',25,'subtotal',25,
    'amount_paid',25,'payment_method','cash',
    'metadata',jsonb_build_object('cloudInventoryEffects',true)
  );
  v_items := jsonb_build_array(jsonb_build_object(
    'id',v_sale_id||':item','product_id',v_product_id,'quantity',1,
    'unit_price',25,'line_subtotal',25,'line_total',25
  ));
  v_payments := jsonb_build_array(jsonb_build_object(
    'id',v_sale_id||':pay','method','cash','amount',25,'received_amount',25,'change_amount',0
  ));
  v_response := public.pos_create_cloud_sale_cashier_inventory(
    v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
    v_sale,v_items,v_payments,v_cash_id,'p1-modern-idem-'||v_suffix
  );
  if coalesce((v_response->>'success')::boolean,false) is not true then
    raise exception 'P1_MODERN_FAILED: %',v_response;
  end if;
  v_receipt := v_response;
  select stock into v_stock from public.pos_products where license_id=v_license_id and id=v_product_id;
  select count(*) into v_moves from public.pos_inventory_movements where license_id=v_license_id and sale_id=v_sale_id;
  select count(*) into v_cash_moves from public.pos_cash_movements where license_id=v_license_id;
  if v_stock <> 7 or v_moves <> 1 or v_cash_moves <> 1
     or (v_response->'sale'->>'inventory_effect_status') <> 'applied' then
    raise exception 'P1_MODERN_EFFECT_MISMATCH: stock %, inventory %, cash %, receipt %',v_stock,v_moves,v_cash_moves,v_response;
  end if;

  -- 3: Insufficient stock: rejection and no new sale/payment/cash/movement.
  v_sale_id := 'p1-insufficient-'||v_suffix;
  v_error := null;
  begin
    v_response := public.pos_create_cloud_sale_cashier_inventory(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      jsonb_build_object('id',v_sale_id,'local_sale_id',v_sale_id,'total',750,'subtotal',750,'amount_paid',750,'payment_method','cash','metadata',jsonb_build_object('cloudInventoryEffects',true)),
      jsonb_build_array(jsonb_build_object('id',v_sale_id||':item','product_id',v_product_id,'quantity',30,'unit_price',25,'line_subtotal',750,'line_total',750)),
      jsonb_build_array(jsonb_build_object('id',v_sale_id||':pay','method','cash','amount',750,'received_amount',750,'change_amount',0)),
      v_cash_id,'p1-insuff-idem-'||v_suffix
    );
  exception when sqlstate 'P0001' then
    get stacked diagnostics v_error=message_text;
    v_response := jsonb_build_object('success',false,'message',v_error);
  end;
  if coalesce((v_response->>'success')::boolean,true) is not false then
    raise exception 'P1_INSUFFICIENT_DID_NOT_REJECT: %',v_response;
  end if;
  if exists(select 1 from public.pos_sales where license_id=v_license_id and id=v_sale_id)
    or exists(select 1 from public.pos_sale_payments where license_id=v_license_id and sale_id=v_sale_id)
    or exists(select 1 from public.pos_inventory_movements where license_id=v_license_id and sale_id=v_sale_id)
    or (select count(*) from public.pos_cash_movements where license_id=v_license_id) <> v_cash_moves then
    raise exception 'P1_INSUFFICIENT_PARTIAL_EFFECTS';
  end if;
  select stock into v_stock from public.pos_products where license_id=v_license_id and id=v_product_id;
  if v_stock <> 7 then raise exception 'P1_INSUFFICIENT_STOCK_DRIFT: %',v_stock; end if;

  -- 4: Idempotent replay: same receipt, same stock, no extra inventory or cash.
  v_sale_id := 'p1-modern-'||v_suffix;
  v_response := public.pos_create_cloud_sale_cashier_inventory(
    v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
    v_sale,v_items,v_payments,v_cash_id,'p1-modern-idem-'||v_suffix
  );
  if coalesce((v_response->>'success')::boolean,false) is not true
     or v_response->'sale'->>'id' is distinct from v_receipt->'sale'->>'id'
     or (select count(*) from public.pos_inventory_movements where license_id=v_license_id and sale_id=v_sale_id) <> v_moves
     or (select count(*) from public.pos_cash_movements where license_id=v_license_id) <> v_cash_moves
     or (select stock from public.pos_products where license_id=v_license_id and id=v_product_id) <> 7 then
    raise exception 'P1_REPLAY_DUPLICATED: %',v_response;
  end if;

  -- 5: Non-controlled item remains eligible for the legacy route.
  update public.pos_products set track_stock=false where license_id=v_license_id and id=v_product_id;
  v_sale_id := 'p1-nonstock-'||v_suffix;
  v_response := public.pos_create_cloud_sale_cashier(
    v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
    jsonb_build_object('id',v_sale_id,'local_sale_id',v_sale_id,'total',25,'subtotal',25,'amount_paid',25,'payment_method','cash','metadata',jsonb_build_object('cloudInventoryEffects',false)),
    jsonb_build_array(jsonb_build_object('id',v_sale_id||':item','product_id',v_product_id,'quantity',1,'unit_price',25,'line_subtotal',25,'line_total',25)),
    jsonb_build_array(jsonb_build_object('id',v_sale_id||':pay','method','cash','amount',25,'received_amount',25,'change_amount',0)),
    v_cash_id,'p1-nonstock-idem-'||v_suffix
  );
  if coalesce((v_response->>'success')::boolean,false) is not true
     or (select count(*) from public.pos_inventory_movements where license_id=v_license_id) <> v_moves then
    raise exception 'P1_NONSTOCK_FAILED: %',v_response;
  end if;

  -- 7: A recipe cannot be masked by the client; separate tracked batch case.
  update public.pos_products
    set recipe=jsonb_build_array(jsonb_build_object('ingredientId',v_product_id,'quantity',1))
    where license_id=v_license_id and id=v_product_id;
  v_error := null;
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      jsonb_build_object('id','p1-recipe-'||v_suffix,'total',25,'subtotal',25,'amount_paid',25,'payment_method','cash'),
      jsonb_build_array(jsonb_build_object('id','p1-recipe-item-'||v_suffix,'product_id',v_product_id,'quantity',1,'unit_price',25,'line_subtotal',25,'line_total',25)),
      jsonb_build_array(jsonb_build_object('method','cash','amount',25,'received_amount',25,'change_amount',0)),
      v_cash_id,'p1-recipe-idem-'||v_suffix
    );
  exception when sqlstate 'P0001' then get stacked diagnostics v_error=message_text;
  end;
  if v_error is null or position('CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED' in v_error)=0 then
    raise exception 'P1_RECIPE_BYPASS: %',v_error;
  end if;
  update public.pos_products set recipe='[]'::jsonb where license_id=v_license_id and id=v_product_id;
  update public.pos_product_batches set track_stock=true where license_id=v_license_id and id=v_batch_id;
  v_error := null;
  begin
    perform public.pos_create_cloud_sale_cashier(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      jsonb_build_object('id','p1-batch-'||v_suffix,'total',25,'subtotal',25,'amount_paid',25,'payment_method','cash'),
      jsonb_build_array(jsonb_build_object('id','p1-batch-item-'||v_suffix,'product_id',v_product_id,'quantity',1,'unit_price',25,'line_subtotal',25,'line_total',25)),
      jsonb_build_array(jsonb_build_object('method','cash','amount',25,'received_amount',25,'change_amount',0)),
      v_cash_id,'p1-batch-idem-'||v_suffix
    );
  exception when sqlstate 'P0001' then get stacked diagnostics v_error=message_text;
  end;
  if v_error is null or position('CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED' in v_error)=0 then
    raise exception 'P1_BATCH_BYPASS: %',v_error;
  end if;

  -- 6: Real Staff permissions must be server-side, not accepted from the client.
  update public.license_staff_users
  set permissions=jsonb_set(permissions,'{pos}','false'::jsonb,true)
  where license_id=v_license_id and id=v_staff_id;
  v_error := null;
  begin
    perform public.pos_create_cloud_sale_cashier_inventory(
      v_license_key,v_device_fingerprint,v_security_token,v_staff_token,
      jsonb_build_object('id','p1-revoked-'||v_suffix,'total',25,'subtotal',25,'amount_paid',25,'payment_method','cash','metadata',jsonb_build_object('cloudInventoryEffects',true)),
      jsonb_build_array(jsonb_build_object('id','p1-revoked-item-'||v_suffix,'product_id',v_product_id,'quantity',1,'unit_price',25,'line_subtotal',25,'line_total',25)),
      jsonb_build_array(jsonb_build_object('method','cash','amount',25,'received_amount',25,'change_amount',0)),
      v_cash_id,'p1-revoked-idem-'||v_suffix
    );
  exception when others then get stacked diagnostics v_error=message_text;
  end;
  if v_error is null then raise exception 'P1_PERMISSION_BYPASS'; end if;
  if exists(select 1 from public.pos_sales where license_id=v_license_id and id='p1-revoked-'||v_suffix) then
    raise exception 'P1_PERMISSION_PARTIAL_SALE';
  end if;
  raise notice 'P1_CLOUD_LEGACY_INVENTORY_GUARD_SQL_REGRESSION_PASS in rolled-back isolated fixture';
end;
$test$;
rollback;
