insert into public.business_profiles values
 ('00000000-0000-0000-0000-000000000001', array['farmacia'::public.business_category]);
insert into public.pos_products(id,license_id,is_active,track_stock,metadata,batch_management,expiration_mode,stock,server_version)
values
 ('vi','00000000-0000-0000-0000-000000000001',true,true,
  '{"pharmacy":{"kind":"medicine","status":"confirmed","fraction":"VI"}}','{"enabled":true}','STRICT',0,1),
 ('general','00000000-0000-0000-0000-000000000001',true,true,'{}','{}',null,0,1),
 ('ii','00000000-0000-0000-0000-000000000001',true,true,
  '{"pharmacy":{"kind":"medicine","status":"confirmed","fraction":"II"}}','{"enabled":true}','STRICT',0,1);

create function public.far001_test_receipt(
  key text, batch text default null, amount numeric default 10, product text default 'vi',
  lot text default 'LOT-1', expiry text default '2099-01-01', secret text default 'allowed',
  document text default 'QA-001', tenant text default '00000000-0000-0000-0000-000000000001',
  device text default '00000000-0000-0000-0000-000000000002'
) returns jsonb language sql as $$
  select public.pos_receive_pharmacy_inventory_v1(
    tenant, device, secret, p_product_id=>product,
    p_batch_id=>batch, p_quantity=>amount, p_base_quantity=>amount,
    p_supplier=>'Supplier', p_manufacturer_batch_id=>case when batch is null then lot end,
    p_expiry_date=>case when batch is null then expiry::timestamptz end,
    p_occurred_at=>'2026-11-18T00:00Z', p_idempotency_key=>key,
    p_metadata=>jsonb_build_object('pharmacyReceipt',jsonb_build_object(
      'version',1,'supplier','Supplier','documentType','factura','documentReference',document,
      'receivedAt','2026-11-18T00:00Z','manufacturerBatchId',lot,'expiryDate',expiry)));
$$;

create function private.far001_expect_error(statement text, code text)
returns void language plpgsql as $$
begin
  execute statement;
  raise exception 'expected %', code;
exception when sqlstate 'P0001' then
  if sqlerrm <> code then raise; end if;
end
$$;

do $$
begin
  if has_function_privilege('anon',
     'private.far_001_add_inventory_entry(boolean,boolean,text,text,text,text,text,text,numeric,text,numeric,text,numeric,text,text,timestamptz,timestamptz,text,jsonb,text)', 'execute')
  then raise exception 'Private transaction is exposed'; end if;
  if public.far001_test_receipt('receipt-1')->'product'->>'stock' is distinct from '10' then
    raise exception 'Receipt did not create 10 units';
  end if;
  if public.far001_test_receipt('receipt-1', amount=>4)->>'code' is distinct from 'IDEMPOTENCY_PAYLOAD_MISMATCH' then
    raise exception 'Changed request reused the same key';
  end if;
  if public.far001_test_receipt('receipt-1')->>'success' is distinct from 'true' then
    raise exception 'Identical replay failed';
  end if;
  if (select count(*) from public.pos_inventory_movements) <> 1 then
    raise exception 'Duplicate physical receipt';
  end if;
  if public.far001_test_receipt('tenant', batch=>'batch-entry-receipt-1',
       tenant=>'00000000-0000-0000-0000-000000000003')->>'code' is distinct from 'PRODUCT_NOT_FOUND' then
    raise exception 'Cross-tenant catalog found';
  end if;
  if public.far001_test_receipt('nan', amount=>'NaN'::numeric)->>'code' is distinct from 'INVALID_QUANTITY' then
    raise exception 'NaN was accepted';
  end if;
end
$$;

select private.far001_expect_error($q$select public.far001_test_receipt('duplicate')$q$, 'PHARMACY_EXISTING_BATCH_REQUIRED');
select private.far001_expect_error($q$select public.far001_test_receipt('proof', lot=>'LOT-2', document=>'')$q$, 'PHARMACY_PROVENANCE_REQUIRED');
select private.far001_expect_error($q$select public.far001_test_receipt('permission', secret=>'revoked')$q$, 'PERMISSION_DENIED');
select private.far001_expect_error($q$select public.far001_test_receipt('restricted', product=>'ii')$q$, 'PHARMACY_SPECIAL_RECEIPT_NOT_AVAILABLE');
select private.far001_expect_error($q$select public.far001_test_receipt('expired', expiry=>'2000-01-01', lot=>'LOT-2')$q$, 'PHARMACY_BATCH_IDENTITY_REQUIRED');
select private.far001_expect_error($q$select public.pos_add_inventory_entry(
 '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','allowed',
 p_product_id=>'vi',p_quantity=>10,p_base_quantity=>10,p_idempotency_key=>'legacy')$q$,
 'PHARMACY_RECEIPT_CLIENT_UPDATE_REQUIRED');

begin;
update public.pos_product_batches set is_active=false,status='archived' where id='batch-entry-receipt-1';
select private.far001_expect_error($q$select public.far001_test_receipt('archived',batch=>'batch-entry-receipt-1')$q$, 'BATCH_NOT_FOUND');
update public.pos_product_batches set deleted_at=now() where id='batch-entry-receipt-1';
select private.far001_expect_error($q$select public.far001_test_receipt('deleted',batch=>'batch-entry-receipt-1')$q$, 'BATCH_NOT_FOUND');
select private.far001_expect_error($q$select public.far001_test_receipt('deleted-identity')$q$, 'PHARMACY_EXISTING_BATCH_REQUIRED');
rollback;

-- The deferred guard sees effects made after the line insert, as the
-- financial procedures populate the stock movement and then link the line.
begin;
insert into public.pos_sale_items(id,license_id,sale_id,product_id,batch_id,quantity)
values ('line','00000000-0000-0000-0000-000000000001','sale','vi','batch-entry-receipt-1',2);
select private.far001_expect_error('set constraints trg_far_001_pharmacy_sale_inventory immediate',
 'PHARMACY_CLOUD_AUTHORITY_REQUIRED');
rollback;

begin;
insert into public.pos_sale_items(id,license_id,sale_id,product_id,batch_id,quantity)
values ('line','00000000-0000-0000-0000-000000000001','sale','vi','batch-entry-receipt-1',2),
       ('general-line','00000000-0000-0000-0000-000000000001','sale','general',null,1);
update public.pos_product_batches set stock=8 where id='batch-entry-receipt-1';
select (private.recalculate_pos_product_projection('00000000-0000-0000-0000-000000000001','vi')).stock;
insert into public.pos_inventory_movements
 (id,license_id,product_id,batch_id,sale_id,sale_item_id,movement_type,quantity,previous_batch_stock,new_batch_stock)
values ('deduction','00000000-0000-0000-0000-000000000001','vi','batch-entry-receipt-1','sale','line','sale_out',2,10,8);
update public.pos_sale_items
set inventory_effect_status='applied',inventory_movement_id='deduction' where id='line';
commit;

do $$
begin
  if (select stock from public.pos_products where id='vi') is distinct from 8::numeric
    or (select count(*) from public.pos_inventory_movements where product_id='vi') <> 2
    or (select count(*) from public.pos_sale_items where product_id='vi') <> 1 then
    raise exception 'Incorrect persisted receipt and sale';
  end if;
end
$$;

begin;
set constraints trg_far_001_pharmacy_batch_increase immediate;
select private.far001_expect_error(
 $cmd$update public.pos_product_batches set stock=100 where id='batch-entry-receipt-1'$cmd$,
 'PHARMACY_BATCH_STOCK_CHANGE_REQUIRES_DOCUMENTED_MOVEMENT'
);
rollback;

do $$
declare
  v_result jsonb;
begin
  if public.far001_test_receipt('receipt-1')->'product'->>'stock' is distinct from '8' then
    raise exception 'Replay restored stock from before the subsequent sale';
  end if;
  v_result := public.pos_verify_legacy_pharmacy_receipt_v1(
    '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','allowed',
    p_product_id=>'vi',p_quantity=>10,p_base_quantity=>10,p_idempotency_key=>'legacy');
  if v_result->>'receipt_outcome' is distinct from 'rejected' or v_result->'product'->>'stock' is distinct from '8' then
    raise exception 'Uncommitted legacy receipt was not reconciled against current stock';
  end if;
end
$$;
