import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

// This module runs only inside the already-verified disposable R6.14 database.
const licenseId = '00000000-0000-0000-0000-000000000001';
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'";

export function settlementSql(order, version, key) {
  const name = q(order);
  return `do $r6_financial$ -- R6_FINANCIAL_RPC: public.pos_execute_financial_operation_v1
  declare req jsonb; h text; receipt jsonb; begin
    req:=jsonb_build_object('cash_session_id','lab-cash-a',
      'sale',jsonb_build_object('id',${name},'subtotal',10,'total',10,'payment_method','cash','amount_paid',10,'balance_due',0,'change_amount',0),
      'items',jsonb_build_array(jsonb_build_object('id',${q(order + '-sale-item')},'product_id','bridge-restaurant-product','product_name','Bridge synthetic product','quantity',1,'unit_price',10,'line_subtotal',10,'line_total',10)),
      'payments',jsonb_build_array(jsonb_build_object('id',${q(order + '-payment')},'method','cash','amount',10,'received_amount',10,'change_amount',0)),
      'restaurant_settlement',jsonb_build_object('parent_order_id',${name},'parent_order_version',${q(version)}));
    h:=private.financial_operation_hash('sale.cashier_inventory',private.canonical_financial_request_v1('sale.cashier_inventory',req),
      'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a');
    receipt:=public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',${q(key)},h,'sale.cashier_inventory',req);
    if coalesce((receipt->>'success')::boolean,false) is not true then raise exception 'R6_RACE_SETTLEMENT_FAILED: %',receipt; end if;
    raise notice 'R6_RACE_RECEIPT:%',receipt;
  end $r6_financial$;`;
}

export function cancellationContenderSql(order, version) {
  return `do $r6_cancel$ declare state text; message text; begin
    begin
      perform public.pos_cancel_restaurant_order_from_pos_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',${q(order)},${q(version)},'synthetic race',${q(order + '-cancel')});
      raise exception 'R6_CANCEL_UNEXPECTEDLY_ACCEPTED';
    exception when others then
      get stacked diagnostics state=returned_sqlstate,message=message_text;
      if state<>'P0001' or message<>'RESTAURANT_ORDER_ALREADY_PAID' then raise; end if;
      raise notice 'R6_CANCEL_REJECTED:%:%',state,message;
    end;
  end $r6_cancel$;`;
}

function session(name, psqlBin, env) {
  const child = spawn(psqlBin, ['-X','-q','-A','-t','-v','ON_ERROR_STOP=1'], {
    env: { ...env, PGHOST:'127.0.0.1', PGDATABASE:'pr352_bridge_isolated', PGAPPNAME:name,
      PGOPTIONS:'-c statement_timeout=20000 -c lock_timeout=12000' },
    stdio:['pipe','pipe','pipe'], windowsHide:true,
  });
  let out='', err='', closed=false, failure=null;
  child.stdout.on('data', x => { out+=x; });
  child.stderr.on('data', x => { err+=x; });
  child.stdin.on('error', e => { failure ||= e; });
  const exited = new Promise(resolve => {
    child.once('error', e => { failure ||= e; });
    child.once('close', (code,signal) => { closed=true; resolve({code,signal,failure}); });
  });
  return { name, exited, get out(){return out;}, get err(){return err;}, get closed(){return closed;}, get failure(){return failure;},
    send(sql) { if (failure || closed || !child.stdin.writable) throw new Error(`psql unavailable: ${name}: ${failure || err}`); child.stdin.write(sql+'\n'); },
    finish(sql) { if (failure || closed || !child.stdin.writable) throw new Error(`psql cannot finish: ${name}: ${failure || err}`); child.stdin.end(sql+'\n\\q\n'); },
    async kill() { if (!closed && !child.pid) await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]);
      if (!closed && child.pid) { child.kill('SIGTERM'); await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]); }
      if (!closed) { child.kill('SIGKILL'); await Promise.race([exited,new Promise(r=>setTimeout(r,3000))]); }
      if (!closed) throw new Error(`psql cleanup failed: ${name}`); },
  };
}

async function observeUntil(label, observe, predicate, watched=[]) {
  const deadline=Date.now()+9000;
  let last;
  while (Date.now()<deadline) {
    for (const s of watched) if (s.closed || s.failure) throw new Error(`psql session exited during ${label}: ${s.name}; error=${s.failure || ''}; stderr=${s.err}`);
    last=await observe(); if (predicate(last)) return last; await new Promise(r=>setTimeout(r,50));
  }
  throw new Error(`lock observation timed out: ${label}; last=${JSON.stringify(last)}`);
}

async function exitWithin(s) {
  let timer;
  const result=await Promise.race([s.exited,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),15000);})]);
  clearTimeout(timer);
  if (!result) throw new Error(`psql completion timeout: ${s.name}; stderr=${s.err}`);
  assert.equal(result.failure,null,`${s.name} process error: ${result.failure}`);
  assert.equal(result.code,0,`${s.name} exit ${result.code}: ${s.err}`);
  assert.equal(result.signal,null,`${s.name} signal ${result.signal}`);
  return {code:result.code,stdout:s.out,stderr:s.err};
}

function receipt(stderr) {
  const match=stderr.match(/R6_RACE_RECEIPT:(\{[^\r\n]*\})/);
  assert.ok(match,`Missing actual settlement receipt: ${stderr}`);
  return JSON.parse(match[1]);
}

export function assertRaceState(state, order, key, stockBefore) {
  assert.equal(state.parentCount,1); assert.ok(['pending','preparing','ready','delivered'].includes(state.parentStatus));
  assert.equal(state.paymentStatus,'paid'); assert.equal(state.paidSaleId,order);
  assert.equal(state.sales,1); assert.equal(state.payments,1); assert.equal(state.operations,1);
  assert.equal(state.inventory,1); assert.equal(Number(state.stock),Number(stockBefore)-1);
  assert.ok(Number.isInteger(state.cashMovements) && state.cashMovements>=0 && state.cashMovements<=1, 'cash movement must not be duplicated');
  assert.equal(state.cancelledItems,0); assert.equal(state.cancelKeys,0); assert.equal(state.permits,0);
  assert.equal(state.operationKey,key);
}

export async function runRestaurantFinancialRaces({query, psqlBin, env, createLegacyOrder}) {
  const all=[]; const sessions=[]; let primaryError;
  try {
    const endpoint=await query("select current_database() || '|' || current_setting('server_version_num')",4000);
    assert.equal(endpoint,'pr352_bridge_isolated|170006','Financial races require the disposable PostgreSQL 17.6 database');
    for (const kind of ['F1','F2']) {
      const order=`r6-${kind.toLowerCase()}-parent`;
      const key=`${order}-settlement`;
      const internalId=await createLegacyOrder(order,`${order}-seed`);
      const seed=JSON.parse(await query(`select json_build_object('version',updated_at,'stock',(select stock from public.pos_products where license_id=${q(licenseId)}::uuid and id='bridge-restaurant-product'))::text from public.pos_restaurant_orders where license_id=${q(licenseId)}::uuid and id=${q(internalId)} and local_order_id=${q(order)} and deleted_at is null`));
      assert.ok(seed.version && seed.stock !== null, `${kind} seed must exist`);
      const firstSql=settlementSql(order,seed.version,key);
      const secondSql=kind==='F1' ? cancellationContenderSql(order,seed.version) : settlementSql(order,seed.version,key);
      const firstName=`pr352-r6-financial-${kind.toLowerCase()}-holder`, secondName=`pr352-r6-financial-${kind.toLowerCase()}-contender`;
      const holder=session(firstName,psqlBin,env), contender=session(secondName,psqlBin,env); sessions.push(holder,contender);
      holder.send('begin;'); holder.send(firstSql);
      const holderState=await observeUntil(`${kind} completed settlement, open transaction`,
        async()=>JSON.parse(await query(`select coalesce(json_agg(json_build_object('pid',pid,'state',state,'query',query)),'[]'::json)::text from pg_stat_activity where application_name=${q(firstName)}`,4000)),
        rows=>rows.length===1 && rows[0].state==='idle in transaction' && rows[0].query.includes('R6_FINANCIAL_RPC') && holder.err.includes('R6_RACE_RECEIPT:'),[holder]);
      contender.send('begin;'); contender.send(secondSql);
      const observed=await observeUntil(`${kind} contender blocked by holder on parent advisory lock`,
        async()=>JSON.parse(await query(`select coalesce(json_agg(json_build_object('holderPid',h.pid,'contenderPid',c.pid,'wait',c.wait_event_type,'query',c.query,'holderMode',hl.mode,'contenderMode',cl.mode,'holderGranted',hl.granted,'contenderGranted',cl.granted,'classId',hl.classid::bigint,'objectId',hl.objid::bigint,'objectSubId',hl.objsubid,'blockedBy',pg_blocking_pids(c.pid))),'[]'::json)::text
          from pg_stat_activity h join pg_stat_activity c on h.pid=any(pg_blocking_pids(c.pid))
          join pg_locks hl on hl.pid=h.pid and hl.locktype='advisory' and hl.mode='ExclusiveLock' and hl.granted
            and hl.classid::bigint=(hashtext(${q(licenseId)})::bigint & 4294967295) and hl.objid::bigint=(hashtext('restaurant_split:' || ${q(order)})::bigint & 4294967295) and hl.objsubid=2
          join pg_locks cl on cl.pid=c.pid and cl.locktype=hl.locktype and cl.mode='ExclusiveLock' and cl.database is not distinct from hl.database and cl.classid is not distinct from hl.classid and cl.objid is not distinct from hl.objid and cl.objsubid is not distinct from hl.objsubid and not cl.granted
          where h.application_name=${q(firstName)} and c.application_name=${q(secondName)} and c.wait_event_type='Lock'`,4000)),
        rows=>rows.some(x=>x.holderPid===holderState[0].pid && x.contenderPid!==x.holderPid && x.query.includes(kind==='F1'?'pos_cancel_restaurant_order_from_pos_v1':'R6_FINANCIAL_RPC')),[holder,contender]);
      contender.finish('commit;'); holder.finish('commit;');
      const first=await exitWithin(holder), second=await exitWithin(contender);
      const firstReceipt=receipt(first.stderr);
      let contenderReceipt=null;
      if (kind==='F1') assert.match(second.stderr,/R6_CANCEL_REJECTED:P0001:RESTAURANT_ORDER_ALREADY_PAID/);
      else { contenderReceipt=receipt(second.stderr); assert.deepEqual(contenderReceipt,firstReceipt, 'Concurrent identical K/H must replay the same receipt'); }
      const state=JSON.parse(await query(`select json_build_object(
        'parentCount',(select count(*) from public.pos_restaurant_orders where license_id=${q(licenseId)}::uuid and local_order_id=${q(order)}),
        'parentStatus',o.status,'paymentStatus',o.payment_status,'paidSaleId',o.paid_sale_id,
        'sales',(select count(*) from public.pos_sales where license_id=${q(licenseId)}::uuid and id=${q(order)}),
        'payments',(select count(*) from public.pos_sale_payments where license_id=${q(licenseId)}::uuid and sale_id=${q(order)}),
        'cashMovements',(select count(*) from public.pos_cash_movements where license_id=${q(licenseId)}::uuid and sale_id=${q(order)}),
        'operations',(select count(*) from public.pos_financial_operations where license_id=${q(licenseId)}::uuid and legacy_idempotency_key=${q(key)}),
        'operationKey',${q(key)},'inventory',(select count(*) from public.pos_inventory_movements where license_id=${q(licenseId)}::uuid and sale_id=${q(order)}),
        'stock',(select stock from public.pos_products where license_id=${q(licenseId)}::uuid and id='bridge-restaurant-product'),
        'cancelledItems',(select count(*) from public.pos_restaurant_order_items where license_id=${q(licenseId)}::uuid and restaurant_order_id=o.id and status='cancelled'),
        'cancelKeys',(select count(*) from public.pos_idempotency_keys where license_id=${q(licenseId)}::uuid and idempotency_key=${q(order+'-cancel')}),
        'permits',(select count(*) from private.restaurant_bridge_cancel_permits where license_id=${q(licenseId)}::uuid and order_id=o.id))::text
        from public.pos_restaurant_orders o where o.license_id=${q(licenseId)}::uuid and o.id=${q(internalId)}`));
      assertRaceState(state,order,key,seed.stock);
      const pending=Number(await query(`select count(*) from pg_stat_activity where application_name in (${q(firstName)},${q(secondName)})`,4000));
      assert.equal(pending,0,`${kind} leaked database sessions`);
      all.push({name:kind,status:'PASS',submitted:{holder:true,contender:true},sql:{holder:firstSql,contender:secondSql},holderState,lockObservations:observed,
        releaseOrder:['holder settlement completed within transaction','contender waits on holder parent advisory lock','holder COMMIT','contender COMMIT'],
        exitCodes:{holder:first.code,contender:second.code},sqlstate:{holder:'00000',contender:kind==='F1'?'P0001':'00000',message:kind==='F1'?'RESTAURANT_ORDER_ALREADY_PAID':null},
        stockBefore:Number(seed.stock),finalState:state,receipt:firstReceipt,contenderReceipt,pendingDatabaseSessions:pending,pendingProcesses:sessions.filter(s=>!s.closed).length});
    }
    return all;
  } catch (error) {
    primaryError=error;
    throw error;
  } finally {
    const cleanup=await Promise.allSettled(sessions.map(s=>s.kill()));
    const failed=cleanup.filter(x=>x.status==='rejected').map(x=>x.reason);
    if (sessions.length) {
      try {
        const names=sessions.map(s=>q(s.name)).join(',');
        const pending=Number(await query(`select count(*) from pg_stat_activity where application_name in (${names})`,4000));
        if (pending!==0) failed.push(new Error(`Financial race leaked ${pending} database sessions`));
      } catch (error) { failed.push(error); }
    }
    if (failed.length) throw new AggregateError(primaryError ? [primaryError,...failed] : failed,
      `Financial race session cleanup failed${primaryError ? `; original failure: ${primaryError.message}` : ''}`);
  }
}
