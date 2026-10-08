-- Isolated contract fixture only: fixture-license/A/valid is a test context.
-- Run after loading production helper bodies and the forward migration into
-- an isolated PostgreSQL database. Never run the fixture context on production.
begin;
insert into public.pos_restaurant_orders(id, license_id, local_order_id, created_by_device_id,
  updated_at, payment_status, total)
values ('contract-parent','00000000-0000-0000-0000-000000000001','contract-order',
  '00000000-0000-0000-0000-00000000000a','2026-10-01T00:00:00Z','unpaid',50);
insert into public.pos_restaurant_order_items(id,license_id,restaurant_order_id,product_name,status)
select 'contract-item-'||s,'00000000-0000-0000-0000-000000000001','contract-parent','fixture',s
from unnest(array['pending','preparing','ready','delivered','cancelled']) s;
insert into public.pos_restaurant_orders(id,license_id,local_order_id,status,fulfillment_status)
values('contract-kitchen','00000000-0000-0000-0000-000000000001','contract-kitchen','cancelled','cancelled');
update public.pos_restaurant_orders set status='pending',fulfillment_status='pending' where id='contract-kitchen';
do $test$
declare receipt jsonb; retry jsonb; failure text; expected text; version text := '2026-10-01T00:00:00Z';
begin
  -- Every rejected attempt runs in a subtransaction and has no parent/item,
  -- ledger, event, sale, payment, cash or customer-ledger effects.
  foreach expected in array array['no_credentials','auth','invalid_staff','refunds','remote','required','stale','invalid','paid','archived','terminal'] loop
    begin
      if expected='paid' then update public.pos_restaurant_orders set payment_status='paid' where id='contract-parent'; end if;
      if expected='archived' then update public.pos_restaurant_orders set archived_at=now() where id='contract-parent'; end if;
      if expected='terminal' then update public.pos_restaurant_orders set status='cancelled',fulfillment_status='cancelled',cancelled_at=now() where id='contract-parent'; end if;
      perform public.pos_cancel_restaurant_order_from_pos_v1(
        case when expected='no_credentials' then null else 'fixture-license' end,
        case when expected='no_credentials' then null when expected='remote' then 'B' else 'A' end,
        case when expected='auth' then 'invalid' else 'valid' end,
        case when expected='invalid_staff' then 'invalid-staff' when expected='refunds' then 'no-refunds' else null end,'contract-order',
        case when expected='required' then null when expected='stale' then '2026-09-01T00:00:00Z'
          when expected='invalid' then 'invalid' else version end,'QA reason','reject-'||expected);
      raise exception 'UNEXPECTED_SUCCESS:%',expected;
    exception when others then
      failure:=sqlerrm;
      if failure like 'UNEXPECTED_SUCCESS:%' then raise; end if;
      if expected in ('no_credentials','auth') and failure<>'DEVICE_AUTH_INVALID' then raise; end if;
      if expected='invalid_staff' and failure<>'STAFF_SESSION_INVALID' then raise; end if;
      if expected='refunds' and failure<>'POS_PERMISSION_DENIED:refunds' then raise; end if;
      if expected='remote' and failure<>'RESTAURANT_ORDER_REMOTE_CANCEL_BLOCKED' then raise; end if;
      if expected='required' and failure<>'RESTAURANT_ORDER_VERSION_REQUIRED' then raise; end if;
      if expected in ('stale','invalid') and failure<>'RESTAURANT_ORDER_VERSION_CONFLICT' then raise; end if;
      if expected='paid' and failure<>'RESTAURANT_ORDER_ALREADY_PAID' then raise; end if;
      if expected='archived' and failure<>'RESTAURANT_ORDER_NOT_ACTIVE' then raise; end if;
      if expected='terminal' and failure<>'RESTAURANT_ORDER_ALREADY_CANCELLED' then raise; end if;
    end;
    assert not exists(select 1 from public.pos_idempotency_keys where entity_id='contract-order');
    assert not exists(select 1 from public.pos_sync_events where entity_id='contract-parent');
    assert (select status='pending' and server_version=1 from public.pos_restaurant_orders where id='contract-parent');
  end loop;
  receipt:=public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','A','valid','refunds',
    'contract-order',version,'QA reason','contract-cancel');
  assert receipt->>'status'='cancelled' and (receipt->>'serverVersion')::int=2;
  assert (select count(*)=6 from jsonb_object_keys(receipt));
  retry:=public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','A','valid','refunds',
    'contract-order',version,'QA reason','contract-cancel');
  assert retry=receipt;
  assert (select count(*)=1 from public.pos_sync_events where entity_id='contract-parent' and operation='cancel');
  assert (select count(*)=1 from public.pos_idempotency_keys where entity_id='contract-order' and status='completed');
  assert (select count(*)=4 from public.pos_restaurant_order_items where restaurant_order_id='contract-parent' and status='cancelled');
  assert (select server_version=1 from public.pos_restaurant_order_items where id='contract-item-delivered');
  assert (select server_version=1 from public.pos_restaurant_order_items where id='contract-item-cancelled');
  begin
    update public.pos_restaurant_orders set status='pending',fulfillment_status='pending',updated_at=now()
      where id='contract-parent';
    raise exception 'UNEXPECTED_REOPEN';
  exception when others then if sqlerrm<>'RESTAURANT_ORDER_ALREADY_CANCELLED' then raise; end if; end;
  -- Other contracts keep their original semantics: Kitchen cancellation has
  -- no POS marker, and archive metadata on a POS terminal remains writable.
  update public.pos_restaurant_orders set metadata=metadata||'{"archiveQa":true}'::jsonb where id='contract-parent';
  begin
    perform public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','A','valid','refunds',
      'contract-order',version,'different reason','contract-cancel');
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if sqlerrm<>'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin
    perform public.pos_cancel_restaurant_order_from_pos_v1('fixture-license','A','valid','refunds',
      'contract-order',version,'QA reason','different-key');
    raise exception 'UNEXPECTED_SUCCESS';
  exception when others then if sqlerrm<>'RESTAURANT_ORDER_ALREADY_CANCELLED' then raise; end if; end;
  assert not exists(select 1 from public.pos_sales);
  assert not exists(select 1 from public.pos_sale_payments);
  assert not exists(select 1 from public.pos_cash_movements);
  assert not exists(select 1 from public.pos_customer_ledger);
end $test$;
rollback;
