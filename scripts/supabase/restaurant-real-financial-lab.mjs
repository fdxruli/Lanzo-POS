import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';

assert.ok(process.argv.includes('--isolated-fixture'), 'Explicit isolated fixture acknowledgement required');
assert.equal(process.env.PGHOST, '127.0.0.1', 'Only loopback PostgreSQL is permitted');
assert.equal(process.env.PGDATABASE, 'pr338_integrated_fixture', 'Use the dedicated disposable database');
assert.ok(process.env.PGPORT && process.env.PSQL_BIN && process.env.PR338_LAB_EVIDENCE_DIR, 'PGPORT, PSQL_BIN and PR338_LAB_EVIDENCE_DIR are required');
const root = process.cwd();
const fixture = resolve(root, 'supabase/tests/fixtures/pr338-real-financial');
const evidence = resolve(process.env.PR338_LAB_EVIDENCE_DIR);
await mkdir(evidence, { recursive: true });
const exec = promisify(execFile);
const base = ['-X', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', process.env.PGPORT, '-d', 'pr338_integrated_fixture'];
const psql = process.env.PSQL_BIN;
const env = process.env;
const sleep = ms => new Promise(resolveDelay => setTimeout(resolveDelay, ms));
async function query(sql) {
  const r = await exec(psql, [...base, '-A', '-t', '-c', sql], { env, windowsHide: true, maxBuffer: 5_000_000 });
  return r.stdout.trim();
}
async function runFile(path, label) {
  try {
    const r = await exec(psql, [...base, '-f', path], { env, windowsHide: true, maxBuffer: 10_000_000 });
    await writeFile(join(evidence, label + '.log'), r.stdout + '\n' + r.stderr);
    return r.stdout;
  } catch (e) {
    await writeFile(join(evidence, label + '.log'), (e.stdout || '') + '\n' + (e.stderr || ''));
    throw new Error(label + ' failed: ' + (e.stderr || e.message));
  }
}
async function runSql(sql, label) {
  const file = join(evidence, label + '.sql');
  await writeFile(file, '\\set ON_ERROR_STOP on\n' + sql);
  return runFile(file, label);
}
const endpoint = await query("SELECT host(inet_server_addr()) || '|' || current_database() || '|' || current_setting('server_version_num')");
assert.match(endpoint, /^127\.0\.0\.1\|pr338_integrated_fixture\|17[0-9]{4}$/);
assert.equal(await query("SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','private','auth') AND c.relkind IN ('r','p')"), '0', 'Database must be empty');
await writeFile(join(evidence, 'endpoint.txt'), endpoint + '\n');
await runFile(join(fixture,'01-schema.sql'),'01-schema.sql');
const functionSources = JSON.parse(await readFile(join(fixture,'02-function-sources.json'),'utf8'));
const generatedFunctions = join(evidence,'02-functions.sql');
await writeFile(generatedFunctions, '\\set ON_ERROR_STOP on\nSET check_function_bodies = off;\n' + functionSources.map(source=>source+';').join('\n'));
await runFile(generatedFunctions,'02-functions.sql');
for (const file of ['03-trigger-dependencies.sql','04-constraints-indexes-triggers.sql','05-policies.sql','06-function-acl.sql']) {
  await runFile(join(fixture, file), file);
}
const expectedHashes = JSON.parse(await readFile(join(fixture,'function-hashes.json'),'utf8'));
const functionNames = [...new Set(expectedHashes.map(row=>row.proname))];
const namesSql = functionNames.map(name=>"'" + name.replaceAll("'","''") + "'").join(',');
const hashRows = JSON.parse(await query("SELECT coalesce(json_agg(json_build_object('nspname',n.nspname,'proname',p.proname,'args',pg_get_function_identity_arguments(p.oid),'md5',md5(replace(pg_get_functiondef(p.oid),chr(13),'')),'sha256',encode(extensions.digest(replace(pg_get_functiondef(p.oid),chr(13),''),'sha256'),'hex')) ORDER BY n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::json)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','private') AND p.proname IN ("+namesSql+")"));
assert.deepEqual(hashRows, expectedHashes, 'Actual SQL function definitions must match the catalog snapshot');
await writeFile(join(evidence,'function-hashes-verified.json'), JSON.stringify(hashRows,null,2));
await runFile(resolve(root, 'supabase/migrations/20261026214837_restaurant_sale_dispatcher_guard_3d14.sql'), 'migration-3d14');
await runFile(join(fixture, 'seed-attempt-2.sql'), 'seed-actors');
const beforeAcl = await query("SELECT has_function_privilege('anon','public.pos_create_cloud_sale_cashier_inventory_legacy_r2b(text,text,text,text,jsonb,jsonb,jsonb,text,text)','execute')::text || '|' || has_function_privilege('anon','public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)','execute')::text");
assert.equal(beforeAcl, 'false|true');

function request(n, mode) {
  const id = 'lab-race-' + n, product = id + '-product';
  if (mode === 'normal') return {
    cash_session_id:'lab-cash-a',
    sale:{id,subtotal:20,total:20,payment_method:'cash',amount_paid:20,balance_due:0,change_amount:0},
    items:[{id:id+'-line',product_id:product,product_name:'Synthetic race '+n,quantity:2,unit_price:10,line_subtotal:20,line_total:20}],
    payments:[{id:id+'-payment',method:'cash',amount:20,received_amount:20,change_amount:0}],
    restaurant_settlement:{parent_order_id:id,parent_order_version:'2026-10-01T00:00:00Z'}
  };
  return {
    parent_order_id:id,parent_order_version:'2026-10-01T00:00:00Z',split_group_id:id+'-group',cash_session_id:'lab-cash-b',
    children:[1,2].map(i=>({
      label:'person-'+i,
      sale:{id:id+'-child-'+i,subtotal:10,total:10,payment_method:'cash',amount_paid:10,balance_due:0,change_amount:0,metadata:{cloudInventoryEffects:true}},
      items:[{id:id+'-item-'+i,product_id:product,product_name:'Synthetic race '+n,quantity:1,unit_price:10,line_subtotal:10,line_total:10}],
      payments:[{id:id+'-pay-'+i,method:'cash',amount:10,received_amount:10,change_amount:0}]
    }))
  };
}
async function seed(n) {
  const id='lab-race-'+n, license='00000000-0000-0000-0000-000000000001';
  await runSql("BEGIN;\nINSERT INTO public.pos_products (id,license_id,name,name_key,price,cost,stock,track_stock) VALUES ('"+id+"-product','"+license+"','Synthetic race "+n+"','synthetic race "+n+"',10,4,20,true);\n"+
  "INSERT INTO public.pos_restaurant_orders (id,license_id,local_order_id,table_label,status,fulfillment_status,subtotal,total,updated_at) VALUES ('"+id+"-row','"+license+"','"+id+"','Lab race "+n+"','ready','ready',20,20,'2026-10-01T00:00:00Z');\n"+
  "INSERT INTO public.pos_restaurant_order_items (id,license_id,restaurant_order_id,local_line_id,product_id,product_name,quantity,unit_price,line_total) VALUES ('"+id+"-orderitem','"+license+"','"+id+"-row','"+id+"-line','"+id+"-product','Synthetic race "+n+"',2,10,20);\nCOMMIT;\n", 'seed-'+n);
}
function raceSql(n, mode, hold, barrier, role) {
  const j=JSON.stringify(request(n,mode)), normal=mode==='normal';
  const op=normal?'sale.cashier_inventory':'sale.split';
  const actor=normal?'admin:00000000-0000-0000-0000-0000000000aa':'staff:00000000-0000-0000-0000-0000000000ab';
  const session=normal?'lab-cash-a':'lab-cash-b', station=normal?'lab-station-a':'lab-station-b';
  const device=normal?'lab-device-a':'lab-device-b',token=normal?'lab-device-token-a':'lab-device-token-b',sessionToken=normal?'lab-admin-session':'lab-staff-session';
  return "\\set ON_ERROR_STOP on\nSET application_name='pr338race"+n+mode+"';\nBEGIN;\n"+
    (barrier?'SELECT pg_advisory_xact_lock_shared(338003);\n':'')+
    "SELECT private.financial_operation_hash('"+op+"',private.canonical_financial_request_v1('"+op+"','"+j+"'::jsonb),'"+actor+"','"+session+"','"+station+"') AS hash \\gset\n"+
    (role?'SET LOCAL ROLE anon;\n':'')+
    "SELECT public.pos_execute_financial_operation_v1('lab-license-a','"+device+"','"+token+"','"+sessionToken+"','lab-race-"+n+"-"+mode+"',:'hash','"+op+"','"+j+"'::jsonb)->>'success' AS success;\n"+
    (hold?'SELECT pg_sleep(12);\n':'')+"COMMIT;\n";
}
function start(file) {
  const child=spawn(psql,[...base,'-f',file],{env,windowsHide:true});
  let out='',err='';
  child.stdout.on('data',x=>{out+=x}); child.stderr.on('data',x=>{err+=x});
  return new Promise(resolveDone=>child.on('close',code=>resolveDone({code,out,err})));
}
async function waitFor(sql, expected, limit=35) {
  for(let i=0;i<limit;i++){await sleep(250);if(await query(sql)===expected)return true}
  return false;
}
async function finalState(n) {
  return query("SELECT (SELECT stock FROM public.pos_products WHERE id='lab-race-"+n+"-product')||'|'||(SELECT count(*) FROM public.pos_sales WHERE id LIKE 'lab-race-"+n+"%')||'|'||(SELECT count(*) FROM public.pos_sale_payments WHERE sale_id LIKE 'lab-race-"+n+"%')||'|'||(SELECT count(*) FROM public.pos_cash_movements WHERE sale_id LIKE 'lab-race-"+n+"%')||'|'||(SELECT count(*) FROM public.pos_inventory_movements WHERE product_id='lab-race-"+n+"-product')||'|'||(SELECT payment_status||'|'||status||'|'||(checkout_closed_at IS NOT NULL)::text FROM public.pos_restaurant_orders WHERE id='lab-race-"+n+"-row')");
}
async function controlled(n, winner) {
  await seed(n);
  const loser=winner==='normal'?'split':'normal', wf=join(evidence,'race-'+n+'-'+winner+'.sql'), lf=join(evidence,'race-'+n+'-'+loser+'.sql');
  await writeFile(wf,raceSql(n,winner,true,false,false));await writeFile(lf,raceSql(n,loser,false,false,false));
  const wp=start(wf);
  assert.ok(await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='pr338race"+n+winner+"' AND wait_event='PgSleep'",'1'), 'Winner never held transaction');
  const lp=start(lf);
  assert.ok(await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='pr338race"+n+loser+"' AND wait_event_type='Lock' AND wait_event='advisory'",'1'), 'Loser did not overlap');
  const [w,l]=await Promise.all([wp,lp]);
  assert.equal(w.code,0,w.err);assert.match(w.out,/\btrue\b/);assert.notEqual(l.code,0);assert.match(l.err,/RESTAURANT_ORDER_(ALREADY_PAID|NOT_ACTIVE)/);
  const state=await finalState(n),expected=winner==='normal'?'18|1|1|1|1|paid|delivered|true':'18|2|2|2|2|paid|delivered|true';
  assert.equal(state,expected);
  await writeFile(join(evidence,'race-'+n+'.json'),JSON.stringify({winner,overlap:'Lock:advisory',w,l,state},null,2));
}
await controlled(24,'normal');
await controlled(22,'split');
await seed(25);
const nf=join(evidence,'race-25-normal.sql'),sf=join(evidence,'race-25-split.sql'),bf=join(evidence,'race-25-barrier.sql');
await writeFile(nf,raceSql(25,'normal',false,true,false));await writeFile(sf,raceSql(25,'split',false,true,false));
await writeFile(bf,"SET application_name='pr338barrier25'; SELECT pg_advisory_lock(338003); SELECT pg_sleep(12); SELECT pg_advisory_unlock(338003);");
const barrier=start(bf);
assert.ok(await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name='pr338barrier25' AND wait_event='PgSleep'",'1'));
const normal=start(nf),split=start(sf);
assert.ok(await waitFor("SELECT count(*) FROM pg_stat_activity WHERE application_name IN ('pr338race25normal','pr338race25split') AND wait_event_type='Lock' AND wait_event='advisory'",'2'), 'Both calls did not reach the barrier');
const [nr,sr,br]=await Promise.all([normal,split,barrier]);
assert.equal(br.code,0);assert.equal([nr.code,sr.code].filter(x=>x===0).length,1);assert.match((nr.code===0?nr:sr).out,/\btrue\b/);
const failed=nr.code===0?sr:nr;assert.match(failed.err,/RESTAURANT_ORDER_(ALREADY_PAID|NOT_ACTIVE)/);
const simultaneous=await finalState(25);assert.equal(simultaneous,nr.code===0?'18|1|1|1|1|paid|delivered|true':'18|2|2|2|2|paid|delivered|true');
await writeFile(join(evidence,'race-25.json'),JSON.stringify({barrier:true,nr,sr,simultaneous},null,2));
await runFile(join(fixture,'race-24-replay.sql'),'replay-and-second-identity');
await runFile(join(fixture,'legacy-real-replay.sql'),'legacy-real-replay');
await runFile(join(fixture,'split-replay.sql'),'split-replay');
await seed(14);await runFile(join(fixture,'candidate-subtxn.sql'),'subtransaction');
await seed(26);
const limiterBefore = Number(await query("SELECT coalesce(sum(request_count),0) FROM public.pos_rpc_rate_limits WHERE license_key='lab-license-a' AND device_fingerprint='lab-device-a' AND rpc_name='pos_create_cloud_sale_cashier'"));
await writeFile(join(evidence,'api-admin.sql'),raceSql(26,'normal',false,false,true));assert.match(await runFile(join(evidence,'api-admin.sql'),'api-admin'),/\btrue\b/);assert.equal(await finalState(26),'18|1|1|1|1|paid|delivered|true');
const limiterAfter = Number(await query("SELECT coalesce(sum(request_count),0) FROM public.pos_rpc_rate_limits WHERE license_key='lab-license-a' AND device_fingerprint='lab-device-a' AND rpc_name='pos_create_cloud_sale_cashier'"));
assert.equal(limiterAfter, limiterBefore + 1, 'Nested cashier rate limit must be preserved');
await seed(29);await runFile(join(fixture,'rate-limit-block.sql'),'rate-limit-block');
await seed(27);await writeFile(join(evidence,'api-staff.sql'),raceSql(27,'split',false,false,true));assert.match(await runFile(join(evidence,'api-staff.sql'),'api-staff'),/\btrue\b/);assert.equal(await finalState(27),'18|2|2|2|2|paid|delivered|true');
await runFile(join(fixture,'seed-negative-actors.sql'),'seed-negative-actors');
await runFile(join(fixture,'c11-negative.sql'),'c11-negative');
await runFile(join(fixture,'guard-negative.sql'),'guard-negative');
await runFile(join(fixture,'cashier-service.sql'),'cashier-service');
await runFile(join(fixture,'batch-sale.sql'),'batch-sale');
await runFile(join(fixture,'ordinary-sale.sql'),'ordinary-sale');
await runFile(join(fixture,'orphan-guard.sql'),'orphan-guard');
for(const n of [11,12,13]) {
  await seed(n);
  await runFile(join(fixture,'payment-'+n+'.sql'),'payment-'+n);
  await runFile(join(fixture,'payment-'+n+'.sql'),'payment-'+n+'-replay');
}
await runSql("DO $$ BEGIN "+
"IF (SELECT count(*) FROM public.pos_sale_payments WHERE sale_id='lab-race-11' AND method='cash' AND amount=20 AND received_amount=25 AND change_amount=5)<>1 OR (SELECT count(*) FROM public.pos_cash_movements WHERE sale_id='lab-race-11' AND amount=20 AND cash_station_id='lab-station-a')<>1 THEN RAISE EXCEPTION 'cash/change mismatch'; END IF; "+
"IF (SELECT count(*) FROM public.pos_sale_payments WHERE sale_id='lab-race-12' AND method='card' AND amount=20)<>1 OR (SELECT count(*) FROM public.pos_cash_movements WHERE sale_id='lab-race-12')<>0 THEN RAISE EXCEPTION 'card mismatch'; END IF; "+
"IF (SELECT count(*) FROM public.pos_sale_payments WHERE sale_id='lab-race-13')<>2 OR (SELECT count(*) FROM public.pos_cash_movements WHERE sale_id='lab-race-13' AND amount=8 AND cash_station_id='lab-station-a')<>1 THEN RAISE EXCEPTION 'mixed mismatch'; END IF; END $$;\n",'payment-assertions');
await runFile(join(fixture,'credit-full-replay.sql'),'credit-full');
await runFile(join(fixture,'customer-payment.sql'),'customer-payment');
await runFile(join(fixture,'credit-initial-3.sql'),'credit-initial');
await runFile(join(fixture,'credit-initial-3-replay.sql'),'credit-initial-replay');
await runFile(join(fixture,'initial-receipt-assert.sql'),'initial-receipt-assert');
assert.equal(await query("SELECT debt||'|'||(SELECT stock FROM public.pos_products WHERE id='lab-credit-product-3')||'|'||(SELECT count(*) FROM public.pos_customer_ledger WHERE customer_id='lab-customer-3')||'|'||(SELECT count(*) FROM public.pos_cash_movements WHERE sale_id='lab-credit-3') FROM public.pos_customers WHERE id='lab-customer-3'"),'15.00|18|2|1');
await runFile(join(fixture,'cancel-credit-3.sql'),'cancel-credit');
await runFile(join(fixture,'cancel-credit-3.sql'),'cancel-credit-replay');
await runFile(join(fixture,'cancel-replay-assert.sql'),'cancel-replay-assert');
assert.equal(await query("SELECT debt||'|'||(SELECT stock FROM public.pos_products WHERE id='lab-credit-product-3')||'|'||(SELECT count(*) FROM public.pos_customer_ledger WHERE customer_id='lab-customer-3')||'|'||(SELECT count(*) FROM public.pos_sale_cancellations WHERE sale_id='lab-credit-3') FROM public.pos_customers WHERE id='lab-customer-3'"),'0.00|20|4|1');
await runSql("DO $$ DECLARE r jsonb; BEGIN r:=public.pos_cancel_cloud_sale('lab-license-a','lab-device-b','lab-device-token-b','lab-staff-session','lab-race-24','Synthetic denied','lab-denied-cancel-24'); IF r->>'code'<>'POS_PERMISSION_DENIED:refunds' THEN RAISE EXCEPTION 'wrong denial: %',r; END IF; IF (SELECT status FROM public.pos_sales WHERE id='lab-race-24')<>'closed' OR (SELECT stock FROM public.pos_products WHERE id='lab-race-24-product')<>18 THEN RAISE EXCEPTION 'denied cancellation effects'; END IF; END $$;\n",'denied-cancellation');
await writeFile(join(evidence,'result.json'),JSON.stringify({endpoint,normal:'18|1|1|1|1|paid|delivered|true',split:'18|2|2|2|2|paid|delivered|true',simultaneous,partial_credit:'20-5=15; reversed to 0',status:'PASS_FOR_EXECUTED_CASES'},null,2));
process.stdout.write('PR338 real financial lab: executed assertions passed; see evidence directory.\n');
