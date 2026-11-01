import assert from 'node:assert/strict';

// All IDs and credentials here belong exclusively to the disposable QA seed.
const license = '00000000-0000-0000-0000-000000000001';
const admin = "'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session'";
const staff = "'lab-license-a','lab-device-b','lab-device-token-b','lab-staff-session'";
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;


// Each snapshot is read from PostgreSQL in its own completed transaction.
async function cancellationSnapshot(query, order) {
  const value = JSON.parse(await query(`select jsonb_build_object(
    'parent',(select to_jsonb(o) from public.pos_restaurant_orders o where o.license_id='${license}'::uuid and o.local_order_id=${literal(order)} and o.deleted_at is null),
    'items',(select jsonb_agg(to_jsonb(i) order by i.id) from public.pos_restaurant_order_items i join public.pos_restaurant_orders o
      on o.id=i.restaurant_order_id and o.license_id=i.license_id where o.license_id='${license}'::uuid and o.local_order_id=${literal(order)} and i.deleted_at is null),
    'effects',jsonb_build_object('sales',(select count(*) from public.pos_sales),
      'payments',(select count(*) from public.pos_sale_payments),'inventory',(select count(*) from public.pos_inventory_movements),
      'cash',(select count(*) from public.pos_cash_movements)),
    'cancelEvents',(select count(*) from public.pos_sync_events e join public.pos_restaurant_orders o on o.id=e.entity_id and o.license_id=e.license_id
      where o.license_id='${license}'::uuid and o.local_order_id=${literal(order)} and e.operation='cancel'),
    'permits',(select count(*) from private.restaurant_bridge_cancel_permits p join public.pos_restaurant_orders o
      on o.id=p.order_id and o.license_id=p.license_id where o.license_id='${license}'::uuid and o.local_order_id=${literal(order)}))::text`));
  assert.ok(value.parent && value.parent.local_order_id === order, `Missing cancellation parent ${order}`);
  assert.ok(Array.isArray(value.items) && value.items.length === 1, `Unexpected item count for ${order}`);
  return value;
}

function observedSqlstate(value, expectedState, expectedMessage) {
  const [state, ...parts] = value.split(':');
  const message = parts.join(':');
  assert.equal(state, expectedState);
  assert.equal(message, expectedMessage);
  return { state, message };
}

function evidence(name, order, actor, before, after, sqlstate, extra = {}) {
  return { name, status: 'PASS', operation: 'public.pos_cancel_restaurant_order_from_pos_v1',
    actor, parentId: before.parent.id, localOrderId: order, stateBefore: { parent: before.parent, items: before.items, cancelEvents: before.cancelEvents },
    stateAfter: { parent: after.parent, items: after.items, cancelEvents: after.cancelEvents },
    financialEffects: { before: before.effects, after: after.effects },
    cleanup: { permitRows: after.permits }, sqlstate, ...extra };
}

// Invoke only after the bridge and actors have been installed, with a paid parent
// produced by the real dispatcher and owned by lab-device-a.  createLegacyOrder
// must call the authentic writer, as the parent and line identity matter here.
export async function runRestaurantCancellationScenarios({ query, createLegacyOrder, paidOrderId }) {
  assert.equal(typeof query, 'function');
  assert.equal(typeof createLegacyOrder, 'function');
  assert.ok(typeof paidOrderId === 'string' && paidOrderId.length > 0);
  const results = [];
  await createLegacyOrder('r6-cancel-valid', 'r6-cancel-valid-seed');
  const validBefore = await cancellationSnapshot(query, 'r6-cancel-valid');
  const c1Boundary = JSON.parse(await query(`do $c1$ declare v text; parent_id text; first_receipt jsonb; replay_receipt jsonb;
      before_sales bigint; before_payments bigint; before_inventory bigint; before_cash bigint;
      state text; message text;
    begin
      select id,updated_at::text into strict parent_id,v from public.pos_restaurant_orders
        where license_id='${license}'::uuid and local_order_id='r6-cancel-valid' and deleted_at is null;
      select count(*) into before_sales from public.pos_sales;
      select count(*) into before_payments from public.pos_sale_payments;
      select count(*) into before_inventory from public.pos_inventory_movements;
      select count(*) into before_cash from public.pos_cash_movements;
      perform private.prepare_restaurant_bridge_cancel_v1(${admin},'r6-cancel-valid',v);
      if (select count(*) from private.restaurant_bridge_cancel_permits where transaction_id=pg_current_xact_id()
        and license_id='${license}'::uuid and order_id=parent_id)<>1 then raise exception 'R6_C1_PERMIT_NOT_GRANTED'; end if;
      first_receipt:=public.pos_cancel_restaurant_order_from_pos_v1(${admin},'r6-cancel-valid',v,'synthetic cancellation','r6-cancel-valid-key');
      if first_receipt->>'success' is distinct from 'true' or first_receipt->>'status' is distinct from 'cancelled'
        or first_receipt->>'localOrderId' is distinct from 'r6-cancel-valid' then raise exception 'R6_C1_RECEIPT'; end if;
      if not exists(select 1 from public.pos_restaurant_orders where id=parent_id and license_id='${license}'::uuid
        and status='cancelled' and fulfillment_status='cancelled' and cancelled_at is not null and coalesce(payment_status,'unpaid')='unpaid')
        or (select count(*) from public.pos_restaurant_order_items where restaurant_order_id=parent_id and license_id='${license}'::uuid
          and local_line_id='r6-cancel-valid-line' and deleted_at is null and status='cancelled' and cancelled_at is not null)<>1
        then raise exception 'R6_C1_PARENT_OR_ITEM'; end if;
      if exists(select 1 from private.restaurant_bridge_cancel_permits where license_id='${license}'::uuid and order_id=parent_id)
        then raise exception 'R6_C1_PERMIT_LEAK'; end if;
      if (select count(*) from public.pos_sales)<>before_sales or (select count(*) from public.pos_sale_payments)<>before_payments
        or (select count(*) from public.pos_inventory_movements)<>before_inventory or (select count(*) from public.pos_cash_movements)<>before_cash
        then raise exception 'R6_C1_EFFECTS'; end if;
      perform set_config('pr352_r6.c1_backend_pid',pg_backend_pid()::text,true);
      perform set_config('pr352_r6.c1_transaction_id',pg_current_xact_id()::text,true);
    end $c1$;
    select json_build_object('backendPid',current_setting('pr352_r6.c1_backend_pid')::integer,
      'transactionId',current_setting('pr352_r6.c1_transaction_id'))::text;`));
  c1Boundary.committed = true;
  c1Boundary.scope = 'separate psql -c implicit transaction completed before C4';
  const validAfter = await cancellationSnapshot(query, 'r6-cancel-valid');
  results.push(evidence('C1', 'r6-cancel-valid', 'lab-device-a/admin', validBefore, validAfter,
    { state: '00000', message: null }, { parent: 'cancelled', item: 'cancelled', permitGranted: true, permitRows: 0, receipt: 'success', transactionBoundary: c1Boundary }));

  // A new query opens a new psql session after C1 has committed; retain the original version for a lost-response replay.
  const c4Boundary = JSON.parse(await query(`do $c4$ declare v text := ${literal(validBefore.parent.updated_at)}; parent_id text; first_receipt jsonb; replay_receipt jsonb;
      before_sales bigint; before_payments bigint; before_inventory bigint; before_cash bigint; state text; message text; begin
      select id into strict parent_id from public.pos_restaurant_orders where license_id='${license}'::uuid
        and local_order_id='r6-cancel-valid' and deleted_at is null;
      select response_payload into strict first_receipt from public.pos_idempotency_keys where license_id='${license}'::uuid
        and idempotency_key='r6-cancel-valid-key' and status='completed';
      select count(*) into before_sales from public.pos_sales;
      select count(*) into before_payments from public.pos_sale_payments;
      select count(*) into before_inventory from public.pos_inventory_movements;
      select count(*) into before_cash from public.pos_cash_movements;
      replay_receipt:=public.pos_cancel_restaurant_order_from_pos_v1(${admin},'r6-cancel-valid',v,'synthetic cancellation','r6-cancel-valid-key');
      if replay_receipt is distinct from first_receipt then raise exception 'R6_C4_REPLAY'; end if;
      begin
        perform public.pos_cancel_restaurant_order_from_pos_v1(${admin},'r6-cancel-valid',v,'synthetic cancellation','r6-cancel-other-key');
        raise exception 'R6_C4_DUPLICATE_ACCEPTED';
      exception when others then
        get stacked diagnostics state=returned_sqlstate,message=message_text;
        if state<>'P0001' or message<>'RESTAURANT_ORDER_ALREADY_CANCELLED' then raise; end if;
        perform set_config('pr352_r6.c4_sqlstate',state||':'||message,true);
      end;
      if (select count(*) from public.pos_idempotency_keys where license_id='${license}'::uuid and idempotency_key='r6-cancel-valid-key'
        and status='completed' and response_payload=first_receipt)<>1
        or exists(select 1 from public.pos_idempotency_keys where idempotency_key='r6-cancel-other-key')
        or (select count(*) from public.pos_sync_events where license_id='${license}'::uuid and entity_id=parent_id
          and entity_type='restaurant_order' and operation='cancel')<>1
        or (select count(*) from public.pos_sales)<>before_sales or (select count(*) from public.pos_sale_payments)<>before_payments
        or (select count(*) from public.pos_inventory_movements)<>before_inventory or (select count(*) from public.pos_cash_movements)<>before_cash
        then raise exception 'R6_C1_C4_EFFECTS'; end if;

    end $c4$;
    select json_build_object('sqlstate',current_setting('pr352_r6.c4_sqlstate'),
      'backendPid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text)::text;`));
  assert.ok(Number.isInteger(c4Boundary.backendPid), 'C4 must report its PostgreSQL backend');
  assert.ok(c4Boundary.transactionId, 'C4 must report its PostgreSQL transaction');
  assert.notEqual(c4Boundary.transactionId, c1Boundary.transactionId, 'C4 replay must follow the committed C1 transaction');
  const c4Sqlstate = c4Boundary.sqlstate;
  const replayAfter = await cancellationSnapshot(query, 'r6-cancel-valid');
  results.push(evidence('C4', 'r6-cancel-valid', 'lab-device-a/admin', validAfter, replayAfter,
    observedSqlstate(c4Sqlstate, 'P0001', 'RESTAURANT_ORDER_ALREADY_CANCELLED'),
    { sameKey: 'identical receipt', differentKey: 'P0001 RESTAURANT_ORDER_ALREADY_CANCELLED', cancellationEvents: 1, completedKeys: 1,
      replayBoundary: { ...c4Boundary, afterTransactionId: c1Boundary.transactionId, priorBackendPid: c1Boundary.backendPid,
        separateConnection: true, priorTransactionCommitted: true } }));
  const staffSeed = JSON.parse(await query(`select public.pos_upsert_restaurant_order_unlimited(${staff},
    jsonb_build_object('localOrderId','r6-cancel-nonowner','tableLabel','QA','status','pending','fulfillmentStatus','pending','source','tables','subtotal',10,'total',10),
    jsonb_build_array(jsonb_build_object('localLineId','r6-cancel-nonowner-line','productId','bridge-restaurant-product','productName','QA','quantity',1,'unitPrice',10,'lineTotal',10)),
    'r6-cancel-nonowner-seed')::text`));
  assert.equal(staffSeed.success, true, 'C2 synthetic staff order must actually be created');
  const deniedBefore = await cancellationSnapshot(query, 'r6-cancel-nonowner');
  const c2Sqlstate = await query(`do $c2$ declare v text; parent_id text; before_row jsonb; before_item jsonb; state text; message text;
    sales bigint; payments bigint; movements bigint; cash bigint; begin
    select id,updated_at::text,to_jsonb(o) into strict parent_id,v,before_row from public.pos_restaurant_orders o
      where license_id='${license}'::uuid and local_order_id='r6-cancel-nonowner' and deleted_at is null;
    select to_jsonb(i) into strict before_item from public.pos_restaurant_order_items i
      where license_id='${license}'::uuid and restaurant_order_id=parent_id and local_line_id='r6-cancel-nonowner-line' and deleted_at is null;
    select count(*) into sales from public.pos_sales;
    select count(*) into payments from public.pos_sale_payments;
    select count(*) into movements from public.pos_inventory_movements;
    select count(*) into cash from public.pos_cash_movements;
    begin
      perform public.pos_cancel_restaurant_order_from_pos_v1(${admin},'r6-cancel-nonowner',v,'synthetic cancellation','r6-cancel-denied-key');
      raise exception 'R6_C2_UNEXPECTED_SUCCESS';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if state<>'P0001' or message<>'RESTAURANT_TABLE_OWNER_REQUIRED' then raise; end if;
      perform set_config('pr352_r6.c2_sqlstate',state||':'||message,true);
    end;
    if (select to_jsonb(o) from public.pos_restaurant_orders o where id=parent_id) is distinct from before_row
      or (select to_jsonb(i) from public.pos_restaurant_order_items i where id=before_item->>'id') is distinct from before_item
      or exists(select 1 from public.pos_idempotency_keys where idempotency_key='r6-cancel-denied-key')
      or exists(select 1 from private.restaurant_bridge_cancel_permits where order_id=parent_id and license_id='${license}'::uuid)
      or exists(select 1 from public.pos_sync_events where entity_id=parent_id and operation='cancel')
      or (select count(*) from public.pos_sales)<>sales or (select count(*) from public.pos_sale_payments)<>payments
      or (select count(*) from public.pos_inventory_movements)<>movements or (select count(*) from public.pos_cash_movements)<>cash
      then raise exception 'R6_C2_EFFECTS'; end if;
    end $c2$; select current_setting('pr352_r6.c2_sqlstate');`);
  const deniedAfter = await cancellationSnapshot(query, 'r6-cancel-nonowner');
  results.push(evidence('C2', 'r6-cancel-nonowner', 'lab-device-a/admin, nonowner', deniedBefore, deniedAfter,
    observedSqlstate(c2Sqlstate, 'P0001', 'RESTAURANT_TABLE_OWNER_REQUIRED'), { denial: 'P0001 RESTAURANT_TABLE_OWNER_REQUIRED', parentUnchanged: true, permitRows: 0 }));

  const paidBefore = await cancellationSnapshot(query, paidOrderId);
  const c3Sqlstate = await query(`do $c3$ declare v text; parent_id text; before_row jsonb; state text; message text;
      sales bigint; payments bigint; movements bigint; cash bigint; begin
    select id,updated_at::text,to_jsonb(o) into strict parent_id,v,before_row from public.pos_restaurant_orders o
      where license_id='${license}'::uuid and local_order_id=${literal(paidOrderId)} and deleted_at is null
        and payment_status='paid' and paid_sale_id is not null and created_by_device_id='00000000-0000-0000-0000-00000000000a'::uuid
        and created_by_staff_user_id is null;
    select count(*) into sales from public.pos_sales;
    select count(*) into payments from public.pos_sale_payments;
    select count(*) into movements from public.pos_inventory_movements;
    select count(*) into cash from public.pos_cash_movements;
    begin
      perform public.pos_cancel_restaurant_order_from_pos_v1(${admin},${literal(paidOrderId)},v,'synthetic cancellation','r6-cancel-paid-key');
      raise exception 'R6_C3_UNEXPECTED_SUCCESS';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if state<>'P0001' or message<>'RESTAURANT_ORDER_ALREADY_PAID' then raise; end if;
      perform set_config('pr352_r6.c3_sqlstate',state||':'||message,true);
    end;
    if (select to_jsonb(o) from public.pos_restaurant_orders o where id=parent_id) is distinct from before_row
      or exists(select 1 from public.pos_idempotency_keys where idempotency_key='r6-cancel-paid-key')
      or exists(select 1 from private.restaurant_bridge_cancel_permits where order_id=parent_id and license_id='${license}'::uuid)
      or exists(select 1 from public.pos_sync_events where entity_id=parent_id and operation='cancel')
      or (select count(*) from public.pos_sales)<>sales or (select count(*) from public.pos_sale_payments)<>payments
      or (select count(*) from public.pos_inventory_movements)<>movements or (select count(*) from public.pos_cash_movements)<>cash
      then raise exception 'R6_C3_EFFECTS'; end if;
    end $c3$; select current_setting('pr352_r6.c3_sqlstate');`);
  const paidAfter = await cancellationSnapshot(query, paidOrderId);
  results.push(evidence('C3', paidOrderId, 'lab-device-a/admin', paidBefore, paidAfter,
    observedSqlstate(c3Sqlstate, 'P0001', 'RESTAURANT_ORDER_ALREADY_PAID'), { denial: 'P0001 RESTAURANT_ORDER_ALREADY_PAID', parentUnchanged: true }));

  await createLegacyOrder('r6-cancel-rollback', 'r6-cancel-rollback-seed');
  const rollbackBefore = await cancellationSnapshot(query, 'r6-cancel-rollback');
  const c6Sqlstate = await query(`do $c6$ declare v text; parent_id text; before_parent jsonb; before_item jsonb; receipt jsonb; state text; message text;
    sales bigint; payments bigint; movements bigint; cash bigint; begin
    select id,updated_at::text,to_jsonb(o) into strict parent_id,v,before_parent from public.pos_restaurant_orders o
      where license_id='${license}'::uuid and local_order_id='r6-cancel-rollback' and deleted_at is null;
    select to_jsonb(i) into strict before_item from public.pos_restaurant_order_items i
      where license_id='${license}'::uuid and restaurant_order_id=parent_id and local_line_id='r6-cancel-rollback-line' and deleted_at is null;
    select count(*) into sales from public.pos_sales;
    select count(*) into payments from public.pos_sale_payments;
    select count(*) into movements from public.pos_inventory_movements;
    select count(*) into cash from public.pos_cash_movements;
    begin
      perform private.prepare_restaurant_bridge_cancel_v1(${admin},'r6-cancel-rollback',v);
      if (select count(*) from private.restaurant_bridge_cancel_permits where transaction_id=pg_current_xact_id()
        and license_id='${license}'::uuid and order_id=parent_id)<>1 then raise exception 'R6_C6_PERMIT_NOT_GRANTED'; end if;
      raise exception 'R6_C6_PERMIT_ROLLBACK' using errcode='P0001';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if state<>'P0001' or message<>'R6_C6_PERMIT_ROLLBACK' then raise; end if;
    end;
    if exists(select 1 from private.restaurant_bridge_cancel_permits where order_id=parent_id and license_id='${license}'::uuid)
      then raise exception 'R6_C6_PERMIT_ROLLBACK_LEAK'; end if;
    begin
      receipt:=public.pos_cancel_restaurant_order_from_pos_v1(${admin},'r6-cancel-rollback',v,'synthetic cancellation','r6-cancel-rollback-key');
      if receipt->>'success' is distinct from 'true' or not exists(select 1 from public.pos_restaurant_orders where id=parent_id and status='cancelled')
        or exists(select 1 from private.restaurant_bridge_cancel_permits where order_id=parent_id and license_id='${license}'::uuid)
        then raise exception 'R6_C6_INNER_EFFECTS'; end if;
      raise exception 'R6_C6_ROLLBACK_PROBE' using errcode='P0001';
    exception when others then get stacked diagnostics state=returned_sqlstate,message=message_text;
      if state<>'P0001' or message<>'R6_C6_ROLLBACK_PROBE' then raise; end if;
      perform set_config('pr352_r6.c6_sqlstate',state||':'||message,true);
    end;
    if (select to_jsonb(o) from public.pos_restaurant_orders o where id=parent_id) is distinct from before_parent
      or (select to_jsonb(i) from public.pos_restaurant_order_items i where id=before_item->>'id') is distinct from before_item
      or exists(select 1 from public.pos_idempotency_keys where idempotency_key='r6-cancel-rollback-key')
      or exists(select 1 from public.pos_sync_events where entity_id=parent_id and operation='cancel')
      or exists(select 1 from private.restaurant_bridge_cancel_permits where order_id=parent_id and license_id='${license}'::uuid)
      or (select count(*) from public.pos_sales)<>sales or (select count(*) from public.pos_sale_payments)<>payments
      or (select count(*) from public.pos_inventory_movements)<>movements or (select count(*) from public.pos_cash_movements)<>cash
      then raise exception 'R6_C6_ROLLBACK_EFFECTS'; end if;
    end $c6$; select current_setting('pr352_r6.c6_sqlstate');`);
  const rollbackAfter = await cancellationSnapshot(query, 'r6-cancel-rollback');
  results.push(evidence('C6', 'r6-cancel-rollback', 'lab-device-a/admin', rollbackBefore, rollbackAfter,
    observedSqlstate(c6Sqlstate, 'P0001', 'R6_C6_ROLLBACK_PROBE'),
    { rollback: 'P0001 R6_C6_ROLLBACK_PROBE', rollbackKind: 'plpgsql_subtransaction', parentAndItemRestored: true, permitRows: 0 }));
  return results;
}
