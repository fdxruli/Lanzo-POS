#!/usr/bin/env python3
"""Disposable PG17 reproduction; never connects to Production.
Uses real financial SQL from the existing PR338 snapshot plus exact Pharmacy
Stages 1-3. Use --current-financial to overlay the narrowly compared live dependency slice.
This does not certify unrelated operations or the full Production schema.
Run: python scripts/supabase/pharmacy_stage3_deferred_pg_regression.py --isolated-fixture
Evidence: work/pharmacy-stage3[-current]-results.json. Container removed on exit.
"""
import subprocess, json, datetime, sys, time, uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
FAR_001 = sys.argv[1:] == ['--isolated-fixture', '--current-financial', '--far-001']
CURRENT_FINANCIAL = FAR_001 or sys.argv[1:] == ['--isolated-fixture', '--current-financial']
if sys.argv[1:] != ['--isolated-fixture'] and not CURRENT_FINANCIAL:
    raise SystemExit('Explicit --isolated-fixture required')
C = 'lanzo-pharmacy-p0-' + uuid.uuid4().hex[:10]
IMAGE = 'postgres:17@sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07'

def bootstrap_sql(statement, user='postgres'):
    r = subprocess.run(['docker','exec','-i',C,'psql','-X','-U',user,'-d','postgres','-v','ON_ERROR_STOP=1'], input=statement,text=True,capture_output=True)
    if r.returncode: raise RuntimeError(r.stderr)

subprocess.run(['docker','run','--detach','--name',C,'-e','POSTGRES_USER=lab_bootstrap','-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD=synthetic-lab-only',IMAGE],check=True,capture_output=True)
try:
    for attempt in range(100):
        ready = subprocess.run(['docker','exec',C,'pg_isready','-h','127.0.0.1','-U','lab_bootstrap','-d','postgres'],capture_output=True)
        if ready.returncode == 0: break
        time.sleep(.2)
    else: raise RuntimeError('Isolated PostgreSQL did not start')
    bootstrap_sql('CREATE ROLE postgres LOGIN CREATEDB CREATEROLE BYPASSRLS; ALTER DATABASE postgres OWNER TO postgres; GRANT ALL ON SCHEMA public TO postgres;', 'lab_bootstrap')
    fixture = Path('supabase/tests/fixtures/pr338-real-financial')
    bootstrap_sql((fixture/'01-schema.sql').read_text())
    bootstrap_sql('SET check_function_bodies=off;\n'+';\n'.join(json.loads((fixture/'02-function-sources.json').read_text()))+';')
    for file in ['03-trigger-dependencies.sql','04-constraints-indexes-triggers.sql','05-policies.sql','06-function-acl.sql','seed-attempt-2.sql']:
        bootstrap_sql((fixture/file).read_text())
    for file in ['20261111190000_pharmacy_stage1_catalog_and_sale_guard.sql','20261111230000_pharmacy_stage2_inventory_authority.sql','20261112040000_pharmacy_stage3_atomic_dispensations.sql']:
        bootstrap_sql(Path('supabase/migrations',file).read_text())
    if CURRENT_FINANCIAL:
        current_fixture = Path('supabase/tests/fixtures/pharmacy-stage3-current-financial')
        bootstrap_sql((current_fixture/'tables.sql').read_text())
        for row in json.loads((current_fixture/'overlay.json').read_text()):
            # Verbatim pg_get_functiondef from Production, only in this disposable DB.
            signature = row['nspname']+'.'+row['proname']+'('+row['args']+')'
            bootstrap_sql('SET check_function_bodies=off; '+row['definition']+';')
            bootstrap_sql('REVOKE ALL ON FUNCTION '+signature+' FROM PUBLIC,anon,authenticated,service_role;')
            if row['proacl'] is None:
                bootstrap_sql('GRANT EXECUTE ON FUNCTION '+signature+' TO PUBLIC;')
            else:
                for role in ['anon','authenticated','service_role']:
                    if role+'=X/' in row['proacl']:
                        bootstrap_sql('GRANT EXECUTE ON FUNCTION '+signature+' TO '+role+';')
        bootstrap_sql((current_fixture/'triggers.sql').read_text())
        # Historical ACL has redundant named grants in addition to PUBLIC.
        # Match the live default ACL exactly, ONLY in the fixture.
        bootstrap_sql('REVOKE ALL ON FUNCTION private.resolve_pos_actor_type(jsonb) FROM PUBLIC,anon,authenticated,service_role; GRANT EXECUTE ON FUNCTION private.resolve_pos_actor_type(jsonb) TO PUBLIC;')
        # Pin exact current definitions and their execution context, not mocks.
        for row in json.loads((current_fixture/'catalog.json').read_text()):
            signature = row['nspname']+'.'+row['proname']+'('+row['args']+')'
            expected = json.dumps({'owner':row['owner'],'definer':row['prosecdef'],
                'config':row['proconfig'],'md5':row['definition_md5']}).replace("'","''")
            bootstrap_sql("DO $verify$ BEGIN IF (SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig,'md5',md5(replace(pg_get_functiondef(oid),chr(13),''))) FROM pg_proc WHERE pronamespace='"+row['nspname']+"'::regnamespace AND proname='"+row['proname']+"' AND pg_get_function_identity_arguments(oid)='"+row['args']+"') IS DISTINCT FROM '"+expected+"'::jsonb THEN RAISE EXCEPTION 'CURRENT_FINANCIAL_DEFINITION_DRIFT: "+row['proname']+"'; END IF; END $verify$;")
            expected_acl = "acldefault('f',proowner)" if row['proacl'] is None else "'"+row['proacl']+"'::aclitem[]"
            bootstrap_sql("DO $acl$ BEGIN IF NOT (SELECT coalesce(proacl,acldefault('f',proowner)) @> "+expected_acl+" AND "+expected_acl+" @> coalesce(proacl,acldefault('f',proowner)) FROM pg_proc WHERE pronamespace='"+row['nspname']+"'::regnamespace AND proname='"+row['proname']+"' AND pg_get_function_identity_arguments(oid)='"+row['args']+"') THEN RAISE EXCEPTION 'CURRENT_FINANCIAL_ACL_DRIFT: "+row['proname']+"'; END IF; END $acl$;")
        print('CURRENT_FINANCIAL: 50 live function definitions/owners/modes/search_paths/ACLs verified')
    bootstrap_sql('CREATE ROLE authenticator LOGIN NOINHERIT; GRANT anon,authenticated TO authenticator; REVOKE ALL ON SCHEMA private FROM PUBLIC,anon,authenticated,service_role;')
    bootstrap_sql('GRANT anon,authenticated TO postgres WITH SET TRUE;', 'lab_bootstrap')
    bootstrap_sql("INSERT INTO public.business_profiles(license_id,business_name,business_type) VALUES ('00000000-0000-0000-0000-000000000001','Synthetic shop',ARRAY['abarrotes'::public.business_category]);")
    L='00000000-0000-0000-0000-000000000001'
    def sql(s,check=True,user='postgres'):
     r=subprocess.run(['docker','exec','-i',C,'psql','-X','-U',user,'-d','postgres','-At','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose'],input=s,text=True,capture_output=True)
     if check and r.returncode:raise RuntimeError(r.stderr)
     return r

    def lit(s):return "'"+str(s).replace("'","''")+"'"
    def scalar(s):return sql(s).stdout.strip().splitlines()[-1]

    def seed(pid,fraction=None,antibiotic=False,batch=False):
     meta={} if not fraction else {'pharmacy':{'kind':'medicine','status':'confirmed','fraction':fraction,'antibiotic':antibiotic}}
     required=antibiotic or fraction in ['I','II','III','IV']
     typ='antibiotic' if antibiotic else ('controlled' if fraction in ['I','II','III'] else (None if required else 'otc'))
     sql("INSERT INTO public.pos_products(id,license_id,name,name_key,price,cost,stock,track_stock,metadata,requires_prescription,prescription_type,is_active,batch_management) VALUES ("+','.join([lit(pid),lit(L),lit(pid),lit(pid),'10','4','20','true',lit(json.dumps(meta)),str(required).lower(),'NULL' if typ is None else lit(typ),str(fraction not in ['I','II','III']).lower(),lit(json.dumps({'enabled':batch}))])+') ON CONFLICT DO NOTHING;')
     if batch:sql("INSERT INTO public.pos_product_batches(id,license_id,product_id,stock,cost,price,manufacturer_batch_id,expiry_date) VALUES ("+','.join([lit(pid+'-batch'),lit(L),lit(pid),'20','4','10',lit('SYNTHETIC'),"'2099-01-01'"])+') ON CONFLICT DO NOTHING;')
    for args in [('service',),('unbatched_iv','IV'),('null_flags',),('common',),('batch',None,False,True),('other',),('otc','VI'),('ab','IV',True,True),('iv','IV',False,True),('I','I',False,True),('II','II',False,True),('III','III',False,True)]:seed(*args)

    if CURRENT_FINANCIAL:
     sql("UPDATE public.pos_products SET track_stock=false WHERE id IN ('service','unbatched_iv');")

    def request(name,pid,rx=None,batch=None,qty=2):
     i={'id':name+'-line','product_id':pid,'product_name':pid,'quantity':qty,'unit_price':10,'line_subtotal':10*qty,'line_total':10*qty}
     if rx is not None:i['metadata']={'pharmacyDispensationV1':rx}
     if batch:i['batch_id']=batch
     return {'cash_session_id':'lab-cash-a','sale':{'id':name,'subtotal':10*qty,'total':10*qty,'payment_method':'cash','amount_paid':10*qty,'balance_due':0,'change_amount':100-10*qty},'items':[i],'payments':[{'id':name+'-pay','method':'cash','amount':10*qty,'received_amount':100,'change_amount':100-10*qty}]}

    def rx(name):return {'version':1,'reference':name,'prescriberName':'Synthetic Doctor','prescriberLicense':'SYNTH-1234','prescriberAddress':'Synthetic address only','issuedOn':scalar("SELECT (now() AT TIME ZONE 'America/Merida')::date"),'treatmentUntil':'2099-01-01','prescribedQuantity':2,'stampDeclared':True,'retentionDeclared':True}

    def state(name,pid):
     return json.loads(scalar("SELECT json_build_object('sales',(SELECT count(*) FROM public.pos_sales WHERE id="+lit(name)+"),'items',(SELECT count(*) FROM public.pos_sale_items WHERE sale_id="+lit(name)+"),'stock',(SELECT stock FROM public.pos_products WHERE id="+lit(pid)+"),'inventory',(SELECT count(*) FROM public.pos_inventory_movements WHERE sale_id="+lit(name)+"),'receipts',(SELECT count(*) FROM public.pos_financial_operations WHERE idempotency_key="+lit(name+'-key')+"),'dispensed_quantity',(SELECT coalesce(sum(quantity),0) FROM private.pharmacy_dispensations_v1 WHERE sale_id="+lit(name)+"),'cash_amount',(SELECT coalesce(sum(amount),0) FROM public.pos_cash_movements WHERE sale_id="+lit(name)+"),'cash',(SELECT count(*) FROM public.pos_cash_movements WHERE sale_id="+lit(name)+"),'payments',(SELECT count(*) FROM public.pos_sale_payments WHERE sale_id="+lit(name)+"),'dispensations',(SELECT count(*) FROM private.pharmacy_dispensations_v1 WHERE sale_id="+lit(name)+"))"))

    def call(req,role='anon',op='sale.cashier_inventory',*,full_response=False,staff=False):
     j=lit(json.dumps(req))+'::jsonb';name=req['sale']['id'] if 'sale' in req else req['sale_id']+'-cancel'
     actor_key = 'staff:00000000-0000-0000-0000-0000000000ab' if staff else 'admin:00000000-0000-0000-0000-0000000000aa'
     station = 'lab-station-b' if staff else 'lab-station-a'
     cash_binding = ('NULL,NULL' if op == 'sale.cancel' else
                     f'NULL,{lit(station)}' if op == 'sale.layaway_complete' else
                     f'{lit(req["cash_session_id"])},{lit(station)}')
     request_hash=scalar("SELECT private.financial_operation_hash("+lit(op)+",private.canonical_financial_request_v1("+lit(op)+","+j+"),"+lit(actor_key)+","+cash_binding+")")
     projection = "" if full_response else "->>'success'"
     s="BEGIN; SET LOCAL ROLE "+role+"; SELECT public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',"+lit(name+'-key')+","+lit(request_hash)+","+lit(op)+","+j+")"+projection+"; SELECT session_user,current_user; COMMIT;"
     if staff:
      s = (s.replace('lab-device-a','lab-device-b').replace('lab-device-token-a','lab-device-token-b')
           .replace('lab-admin-session','lab-staff-session'))
     return sql(s,False,user='authenticator')

    sql("INSERT INTO public.pos_customers(id,license_id,name,credit_limit) VALUES ('lab-p0-customer','00000000-0000-0000-0000-000000000001','Synthetic customer',200);")
    cases=[('ordinary_6b','common',False,None,None,None),('ordinary_credit','common',False,None,None,None),('pharmacy_null_flags','null_flags',True,None,None,None),('common','common',False,None,None,None),('common_batch','batch',False,None,'batch-batch',None),('pharmacy_other','other',True,None,None,None),('otc','otc',True,None,None,None),('antibiotic','ab',True,'valid','ab-batch',None),('fraction_iv','iv',True,'valid','iv-batch',None),('missing_rx','ab',True,None,'ab-batch','PHARMACY_PRESCRIPTION_REQUIRED'),('missing_batch','ab',True,'valid',None,'PHARMACY_DISPENSATION_BATCH_REQUIRED'),('wrong_batch','ab',True,'valid','iv-batch','CLOUD_BATCH_NOT_AVAILABLE'),('excess','ab',True,'excess','ab-batch','PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED'),('I','I',True,'valid','I-batch','CLOUD_PRODUCT_NOT_AVAILABLE'),('II','II',True,'valid','II-batch','CLOUD_PRODUCT_NOT_AVAILABLE'),('III','III',True,'valid','III-batch','CLOUD_PRODUCT_NOT_AVAILABLE'),('no_stamp','ab',True,'no_stamp','ab-batch','PHARMACY_PRESCRIPTION_STAMP_REQUIRED'),('no_retention','ab',True,'no_retention','ab-batch','PHARMACY_PRESCRIPTION_RETENTION_REQUIRED'),('expired','ab',True,'expired','ab-batch','PHARMACY_PRESCRIPTION_EXPIRED_OR_QUANTITY_INVALID'),('doctor_missing','ab',True,'doctor_missing','ab-batch','PHARMACY_PRESCRIPTION_FIELDS_INVALID')]
    sql("UPDATE public.pos_products SET prescription_type=NULL, requires_prescription=NULL WHERE id='null_flags';")
    if CURRENT_FINANCIAL:
     cases=[(label,'service' if label=='ordinary_6b' else ('unbatched_iv' if label=='missing_batch' else pid),pharmacy,kind,batch,error) for label,pid,pharmacy,kind,batch,error in cases]
     cases += [('legacy_stock_guard','common',False,None,None,'CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED'),('pharmacy_credit','iv',True,'valid','iv-batch',None)]
    results=[]
    if FAR_001:
     sql("INSERT INTO public.pos_products(id,license_id,name,name_key,price,cost,stock,track_stock,metadata,is_active,batch_management,expiration_mode,requires_prescription,prescription_type) VALUES ('far001-vi',"+lit(L)+",'FAR001 VI','far001 vi',10,4,0,true,'{\"pharmacy\":{\"kind\":\"medicine\",\"status\":\"confirmed\",\"fraction\":\"VI\"}}',true,'{\"enabled\":true}','STRICT',false,'otc');")
     result_path = Path('work/pharmacy-far001-current-financial-results.json')
    else:
     result_path = Path('work/pharmacy-stage3-current-results.json' if CURRENT_FINANCIAL else 'work/pharmacy-stage3-results.json')

    for phase in (['after'] if FAR_001 else ['before','after']):
     if phase=='after':
      migration=next(Path('supabase/migrations').glob('*_pharmacy_stage3_deferred_batch_security.sql')).read_text()
      sql(migration);sql(migration)
      if FAR_001:
       far_migration = next(Path('supabase/migrations').glob('*_far_001_pharmacy_receipt_authority.sql'))
       sql((current_fixture/'far001-receipt-helpers.sql').read_text())
       sql(far_migration.read_text())
       sql("UPDATE public.business_profiles SET business_type=ARRAY['farmacia'::public.business_category] WHERE license_id="+lit(L))
       receipt_data = {
           'version': 1, 'supplier': 'Synthetic Supplier', 'documentType': 'factura',
           'documentReference': 'FAR001-QA', 'receivedAt': '2026-11-18T00:00:00Z',
           'manufacturerBatchId': 'FAR001-LOT', 'expiryDate': '2099-01-01'
       }
       params = """
            'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',
            p_product_id=>'far001-vi', p_quantity=>10, p_base_quantity=>10,
            p_supplier=>'Synthetic Supplier', p_manufacturer_batch_id=>'FAR001-LOT',
            p_expiry_date=>'2099-01-01', p_occurred_at=>'2026-11-18T00:00:00Z',
            p_idempotency_key=>'far001-qa', p_metadata=>""" + lit(json.dumps({'pharmacyReceipt': receipt_data})) + "::jsonb"
       denied = sql("BEGIN; SET LOCAL ROLE anon; SELECT public.pos_receive_pharmacy_inventory_v1("
                    +params.replace('lab-admin-session', 'lab-staff-session')
                    .replace('lab-device-a', 'lab-device-b').replace('lab-device-token-a', 'lab-device-token-b')+"); COMMIT;",
                    check=False, user='authenticator')
       assert denied.returncode != 0 and 'POS_PERMISSION_DENIED:inventory.write' in denied.stderr, denied.stderr
       legacy = sql("BEGIN; SET LOCAL ROLE anon; SELECT public.pos_add_inventory_entry("+params+"); COMMIT;",
                    check=False, user='authenticator')
       assert legacy.returncode != 0 and 'PHARMACY_RECEIPT_CLIENT_UPDATE_REQUIRED' in legacy.stderr, legacy.stderr
       assert scalar("SELECT stock FROM public.pos_products WHERE id='far001-vi'") == '0'
       for role in ['anon', 'authenticated']:
        confirmed = sql("BEGIN; SET LOCAL ROLE "+role+"; SELECT public.pos_receive_pharmacy_inventory_v1("+params+")->>'success'; COMMIT;",
                        user='authenticator')
        assert 'true' in confirmed.stdout, confirmed.stdout
       assert scalar("SELECT stock FROM public.pos_products WHERE id='far001-vi'") in ['10','10.00','10.0000']
       cases += [('far001_stock', 'far001-vi', True, None, 'batch-entry-far001-qa', None)]
       cases = [(label,pid,pharmacy,kind,batch,
                 'PHARMACY_CLOUD_AUTHORITY_REQUIRED' if label in ['otc','missing_batch'] else error)
                for label,pid,pharmacy,kind,batch,error in cases]
     for label,pid,pharmacy,kind,batch,error in cases:
      name=phase+'-'+label; data=rx(name) if kind else None
      if kind=='excess':data['prescribedQuantity']=1
      if kind=='no_stamp':data['stampDeclared']=False
      if kind=='no_retention':data['retentionDeclared']=False
      if kind=='expired':data['treatmentUntil']='2020-01-01';data['issuedOn']='2020-01-01'
      if kind=='doctor_missing':data['prescriberName']=''
      sql("UPDATE public.business_profiles SET business_type=ARRAY["+lit('farmacia' if pharmacy else 'abarrotes')+"::public.business_category] WHERE license_id="+lit(L))
      req=request(name,pid,data,batch)
      op='sale.cashier' if label in ['missing_batch','ordinary_6b','legacy_stock_guard'] else 'sale.cashier_inventory'
      if label in ['ordinary_credit','pharmacy_credit']:
       op='sale.credit';req['customer_id']='lab-p0-customer'
       req['sale'].update(customer_id='lab-p0-customer',payment_method='mixed_credit',amount_paid=5,balance_due=15,change_amount=0,metadata={'cloudInventoryEffects':True})
       req['payments'][0].update(amount=5,received_amount=5,change_amount=0)
      if label=='far001_stock':
       req['sale'].update(payment_method='card',change_amount=0)
       req['payments'][0].update(method='card',received_amount=20,change_amount=0)
      before=state(name,pid);r=call(req,role='authenticated' if label=='ordinary_6b' else 'anon',op=op);after=state(name,pid)
      expected=error or (None if phase=='after' else '42501')
      # Before fix missing final batch is masked by the schema privilege error.
      if phase=='before' and label=='missing_batch':expected='42501'
      if phase=='before' and label in ['pharmacy_other','pharmacy_null_flags']:expected='PHARMACY_PRESCRIPTION_REQUIRED'
      passed=(r.returncode==0 and 'true' in r.stdout) if expected is None else (r.returncode!=0 and expected in r.stderr)
      if r.returncode:passed=passed and before==after
      else:
       expected_cash = 0 if label=='far001_stock' else (5 if op=='sale.credit' else 20)
       passed = (passed and after['sales']==1 and after['items']==1 and after['payments']==1
                 and after['cash']==int(expected_cash > 0) and after['cash_amount']==expected_cash
                 and after['inventory']==(0 if op=='sale.cashier' else 1)
                 and after['stock']==before['stock']-(0 if op=='sale.cashier' else 2)
                 and after['receipts']==1)
      row={'phase':phase,'case':label,'role':'authenticated' if label=='ordinary_6b' else 'anon','business':'pharmacy' if pharmacy else 'ordinary','operation':op,'passed':passed,'stdout':r.stdout,'error':r.stderr,'before':before,'after':after};results.append(row)
      print(phase,label,'PASS' if passed else 'FAIL',r.stderr.splitlines()[0] if r.stderr else '')
      if phase=='after' and label in ['common_batch','antibiotic','pharmacy_credit','far001_stock'] and r.returncode==0:
       rr=call(req,op=op); replay=state(name,pid);results.append({'phase':phase,'case':label+'_replay','role':'anon','operation':op,'passed':rr.returncode==0 and replay==after,'state':replay,'error':rr.stderr})
    # Security, retained prescriptions and confirmed-dispensation integrity.
    sql("UPDATE public.business_profiles SET business_type=ARRAY['farmacia'::public.business_category] WHERE license_id="+lit(L))
    reused = request('after-retained-reuse','ab',rx('after-antibiotic'),'ab-batch')
    initial = state('after-retained-reuse','ab'); rejection = call(reused)
    results.append({'case':'retained_reuse','role':'anon','passed':rejection.returncode!=0 and 'PHARMACY_PRESCRIPTION_ALREADY_RETAINED' in rejection.stderr and state('after-retained-reuse','ab')==initial,'error':rejection.stderr})
    for role in ['anon','authenticated']:
     for statement in ['SELECT * FROM private.pharmacy_dispensations_v1;', 'SELECT private.pharmacy_stage3_require_final_batch();']:
      rejection=sql('SET ROLE '+role+';'+statement,False)
      results.append({'case':'direct_access_denied','role':role,'passed':rejection.returncode!=0 and '42501' in rejection.stderr,'error':rejection.stderr})
    for statement in ["UPDATE private.pharmacy_dispensations_v1 SET quantity=quantity+1 WHERE sale_id='after-antibiotic';", "DELETE FROM private.pharmacy_dispensations_v1 WHERE sale_id='after-antibiotic';"]:
     rejection=sql(statement,False)
     results.append({'case':'dispensation_immutable','role':'postgres (owner, not superuser)','passed':rejection.returncode!=0 and 'PHARMACY_DISPENSATION_IMMUTABLE' in rejection.stderr,'error':rejection.stderr})
    # A privileged fixture corrupts batch/product correspondence inside its own
    # uncommitted transaction. The exact final validator must fail closed.
    # Check the final validator with a newly queued sale and a changed batch.
    req=request('after-batch-integrity','ab',rx('after-batch-integrity'),'ab-batch')
    j=lit(json.dumps(req))+'::jsonb'
    integrity_sql="BEGIN; SELECT private.financial_operation_hash('sale.cashier_inventory',private.canonical_financial_request_v1('sale.cashier_inventory',"+j+"),'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a') AS hash \\gset\nSET LOCAL ROLE anon; SELECT public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session','after-batch-integrity-key',:'hash','sale.cashier_inventory',"+j+"); RESET ROLE; UPDATE public.pos_product_batches SET product_id='iv' WHERE id='ab-batch'; SET LOCAL ROLE anon; COMMIT;"
    rejection=sql(integrity_sql,False)
    results.append({'case':'final_batch_wrong_product','role':'anon at COMMIT; owner mutation within synthetic transaction','passed':rejection.returncode!=0 and ('PHARMACY_BATCH_IDENTITY_IMMUTABLE' if FAR_001 else 'PHARMACY_DISPENSATION_BATCH_REQUIRED') in rejection.stderr,'error':rejection.stderr})
    if CURRENT_FINANCIAL:
     # Preserve the existing v2 pilot gate; never simulate an admission witness.
     sql("INSERT INTO private.pos_fin01_qa_pilots_v2(license_id,creation_xid,protocol) VALUES ("+lit(L)+",pg_current_xact_id(),2);")
     initial=state('after-pilot-rejected','common')
     rejection=call(request('after-pilot-rejected','common'))
     results.append({'case':'v1_pilot_gate_preserved','role':'anon','passed':rejection.returncode!=0 and 'CLOUD_CLIENT_UPDATE_REQUIRED' in rejection.stderr and state('after-pilot-rejected','common')==initial,'error':rejection.stderr})
     sql("DELETE FROM private.pos_fin01_qa_pilots_v2 WHERE license_id="+lit(L))
    assert scalar("SELECT count(*) FROM private.pharmacy_dispensations_v1 d JOIN public.pos_sale_items si ON si.id=d.sale_item_id JOIN public.pos_product_batches b ON b.id=d.batch_id WHERE d.batch_id IS DISTINCT FROM si.batch_id OR b.product_id<>d.product_id OR b.license_id<>d.license_id")=='0'
    if FAR_001:
     assert scalar("SELECT stock FROM public.pos_products WHERE id='far001-vi'") in ['8','8.00','8.0000']
     # Exercise the same explicit physical lines that the candidate sends.
     second_receipt = (params.replace('FAR001-LOT', 'FAR001-SECOND')
                       .replace('2099-01-01', '2099-02-01')
                       .replace('=>10', '=>27').replace('far001-qa', 'far001-second'))
     sql("BEGIN; SET LOCAL ROLE anon; SELECT public.pos_receive_pharmacy_inventory_v1("
         +second_receipt+")->>'success'; COMMIT;", user='authenticator')
     # The existing single-lot case already sold two units. Receive them again
     # on the same physical lot so the scenario starts with exactly 10 + 27.
     refill = params.replace('=>10', '=>2').replace('far001-qa', 'far001-refill')
     sql("BEGIN; SET LOCAL ROLE anon; SELECT public.pos_receive_pharmacy_inventory_v1("
         +refill+",p_batch_id=>'batch-entry-far001-qa')->>'success'; COMMIT;", user='authenticator')
     sql("UPDATE public.pos_products SET price=50 WHERE id='far001-vi';")
     multi = request('far001-multi','far001-vi',batch='batch-entry-far001-qa',qty=15)
     first = request('far001-multi-a','far001-vi',batch='batch-entry-far001-qa',qty=10)['items'][0]
     second = request('far001-multi-b','far001-vi',batch='batch-entry-far001-second',qty=5)['items'][0]
     multi['items'] = [first, second]
     for line in multi['items']:
      line.update(unit_price=50, line_subtotal=50*line['quantity'], line_total=50*line['quantity'])
     multi['payments'][0].update(amount=750, received_amount=750, change_amount=0)
     multi['sale'].update(subtotal=750, total=750, amount_paid=750, change_amount=0)
     assert float(scalar("SELECT stock FROM public.pos_products WHERE id='far001-vi'")) == 37
     with ThreadPoolExecutor(max_workers=2) as pool:
      replies = list(pool.map(call, [multi, multi]))
     assert all(reply.returncode == 0 and 'true' in reply.stdout for reply in replies), replies
     sold = state('far001-multi','far001-vi')
     assert sold['sales'] == sold['payments'] == sold['receipts'] == sold['cash'] == 1, sold
     assert sold['stock'] == 22 and sold['cash_amount'] == 750 and sold['inventory'] == 2, sold
     assert scalar("SELECT string_agg(batch_id||':'||quantity::int,',' ORDER BY quantity DESC) "
                   "FROM public.pos_inventory_movements WHERE sale_id='far001-multi'") == (
                       'batch-entry-far001-qa:10,batch-entry-far001-second:5')
     assert call(multi).returncode == 0 and state('far001-multi','far001-vi') == sold
     sql("UPDATE public.pos_products SET price=10 WHERE id='far001-vi';")
     print('far001 pharmacy multilote 10 + 27 -> 15 -> 22 PASS (concurrent same-key and replay)')

     sql("INSERT INTO public.pos_products(id,license_id,name,name_key,price,cost,stock,track_stock,metadata,is_active,batch_management,expiration_mode,requires_prescription,prescription_type) VALUES "
         "('far001-other',"+lit(L)+",'General','general',10,4,0,true,'{\"pharmacy\":{\"kind\":\"other\",\"status\":\"pending\"}}',true,'{\"enabled\":true}','STRICT',false,'otc');")
     sql("INSERT INTO public.pos_customers(id,license_id,name,credit_limit) VALUES ('far001-other-customer',"
         +lit(L)+",'Synthetic FAR-001 credit',500);")
     generic_batch = 'batch-entry-far001-other-entry'
     credit = request('far001-other-credit','far001-other',batch=generic_batch)
     credit['customer_id'] = 'far001-other-customer'
     credit['sale'].update(customer_id=credit['customer_id'], payment_method='credit',
                           amount_paid=0, balance_due=20, change_amount=0)
     credit['payments'] = []
     pending_credit = json.loads(json.dumps(credit))
     del pending_credit['items'][0]['batch_id']
     before_receipt = state('far001-other-credit','far001-other')
     failure = call(pending_credit, op='sale.credit', full_response=True)
     assert 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT' in (failure.stdout + failure.stderr), failure
     assert state('far001-other-credit','far001-other') == before_receipt
     print('far001 credit before Cloud receipt reproduces NO_CURRENT_BATCH_FOR_STRICT_PRODUCT without effects')
     sql("BEGIN; SET LOCAL ROLE anon; SELECT public.pos_add_inventory_entry("
         "'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',"
         "p_product_id=>'far001-other', p_quantity=>10, p_base_quantity=>10,"
         "p_manufacturer_batch_id=>'GENERAL',p_expiry_date=>'2099-01-01',"
         "p_idempotency_key=>'far001-other-entry')->>'success'; COMMIT;", user='authenticator')
     assert float(scalar("SELECT stock FROM public.pos_product_batches WHERE id="+lit(generic_batch))) == 10
     generic_cash = request('far001-other-cash','far001-other',batch=generic_batch)
     reply = call(generic_cash)
     assert reply.returncode == 0 and 'true' in reply.stdout, reply
     credit['sale']['id'] = 'far001-other-credit-confirmed'
     credit['items'][0]['id'] = 'far001-other-credit-confirmed-line'
     automatic_credit = json.loads(json.dumps(credit))
     del automatic_credit['items'][0]['batch_id']
     raw = lit(json.dumps(automatic_credit)) + '::jsonb'
     trial = sql("BEGIN; SELECT private.financial_operation_hash('sale.credit',"
                 "private.canonical_financial_request_v1('sale.credit',"+raw+"),"
                 "'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a') AS hash \\gset\n"
                 "SET LOCAL ROLE anon; SELECT public.pos_execute_financial_operation_v1("
                 "'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',"
                 "'far001-other-credit-baseline',:'hash','sale.credit',"+raw+")->>'success'; ROLLBACK;",
                 check=False)
     assert trial.returncode == 0 and 'true' in trial.stdout, trial
     print('far001 general credit baseline also succeeds with a valid STRICT lot in the fixture')
     for _ in range(2):
      reply = call(credit, op='sale.credit')
      assert reply.returncode == 0 and 'true' in reply.stdout, reply
     credited = state('far001-other-credit-confirmed','far001-other')
     assert credited['stock'] == 6 and credited['sales'] == credited['inventory'] == credited['receipts'] == 1, credited
     assert credited['cash'] == credited['payments'] == 0, credited
     assert float(scalar("SELECT debt FROM public.pos_customers WHERE id='far001-other-customer'")) == 20
     assert scalar("SELECT count(*) FROM public.pos_customer_ledger WHERE customer_id='far001-other-customer'") == '1'
     assert float(scalar("SELECT stock FROM public.pos_product_batches WHERE id="+lit(generic_batch))) == 6
     print('far001 general credit PASS (one debt, no cash payment and physical lot persisted across connections)')

     def expect_rejected_without_effects(req, operation, expected):
      name = req['sale']['id']
      before = state(name,'far001-other')
      reply = call(req, op=operation, full_response=True)
      assert (reply.returncode != 0 or 'false' in reply.stdout) and expected in (reply.stdout + reply.stderr), reply
      assert state(name,'far001-other') == before
      assert float(scalar("SELECT debt FROM public.pos_customers WHERE id='far001-other-customer'")) == 20

     # The historical receipt endpoint allowed existing STRICT lots to lack a date.
     # Both payment routes must still reject that condition and expired stock.
     for suffix, expiry, expected in [
         ('missing-date', 'NULL', 'NO_CURRENT_BATCH_FOR_STRICT_PRODUCT'),
         ('expired', "'2000-01-01'", 'STRICT_EXPIRED_BATCH_BLOCKED'),
         ('archived', "'2099-01-01'", 'CLOUD_BATCH_NOT_AVAILABLE'),
         ('empty', "'2099-01-01'", 'INSUFFICIENT_CLOUD_STOCK'),
         ('foreign', "'2099-01-01'", 'CLOUD_BATCH_NOT_AVAILABLE')]:
      bad_lot = 'far001-other-' + suffix
      if suffix == 'foreign':
       # A known existing lot from a different licensed tenant.
       bad_lot = 'far001-foreign-lot'
       foreign = '00000000-0000-0000-0000-000000000002'
       sql("INSERT INTO public.pos_products(id,license_id,name,name_key,price,cost,stock,track_stock,is_active,batch_management) "
           "VALUES ('far001-foreign',"+lit(foreign)+",'Foreign','foreign',10,4,3,true,true,'{\"enabled\":true}');"
           "INSERT INTO public.pos_product_batches(id,license_id,product_id,price,cost,stock,expiry_date) VALUES "
           "('far001-foreign-lot',"+lit(foreign)+",'far001-foreign',10,4,3,'2099-01-01');")
      else:
       sql("INSERT INTO public.pos_product_batches(id,license_id,product_id,price,cost,stock,expiry_date,status,is_active) VALUES ("
           +','.join([lit(bad_lot),lit(L),"'far001-other'",'10','4','0' if suffix=='empty' else '3',
                      expiry,"'archived'" if suffix=='archived' else "'active'",
                      'false' if suffix=='archived' else 'true'])+');')
      expect_rejected_without_effects(request('far001-bad-cash-'+suffix,'far001-other',batch=bad_lot),
                                      'sale.cashier_inventory',expected)
      bad_credit = json.loads(json.dumps(credit))
      bad_credit['sale']['id'] = 'far001-bad-credit-'+suffix
      bad_credit['items'][0].update(id=bad_credit['sale']['id']+'-line',batch_id=bad_lot)
      expect_rejected_without_effects(bad_credit,'sale.credit',expected)
     print('far001 cash and credit reject missing expiry, expired, archived, empty and other-tenant lots PASS')

     for _ in range(2):
      reversal = call({'sale_id': 'far001-other-credit-confirmed', 'reason': 'Synthetic refund'},
                      op='sale.cancel', full_response=True)
      assert reversal.returncode == 0 and '"success": true' in reversal.stdout, reversal
     assert float(scalar("SELECT debt FROM public.pos_customers WHERE id='far001-other-customer'")) == 0
     assert float(scalar("SELECT stock FROM public.pos_product_batches WHERE id="+lit(generic_batch))) == 8
     assert scalar("SELECT count(*) FROM public.pos_sale_cancellations WHERE sale_id='far001-other-credit-confirmed'") == '1'
     assert scalar("SELECT count(*) FROM public.pos_cash_movements WHERE sale_id='far001-other-credit-confirmed'") == '0'
     print('far001 credit cancellation restores the same lot and clears debt once with no cash effect PASS')
     sql("UPDATE public.license_staff_users SET permissions=permissions || '{\"customers\":true}' "
         "WHERE id='00000000-0000-0000-0000-0000000000ab';")
     unauthorized = json.loads(json.dumps(credit))
     unauthorized['sale']['id'] = 'far001-other-staff-denied'
     unauthorized['items'][0]['id'] = 'far001-other-staff-denied-line'
     unauthorized['cash_session_id'] = 'lab-cash-b'
     denied_before = state(unauthorized['sale']['id'],'far001-other')
     denied = call(unauthorized, op='sale.credit', staff=True, full_response=True)
     assert 'POS_PERMISSION_DENIED:pos_credit_sales' in (denied.stderr + denied.stdout), denied
     assert state(unauthorized['sale']['id'],'far001-other') == denied_before

     competing = [request(f'far001-competing-{index}','far001-other',batch=generic_batch,qty=5)
                  for index in range(2)]
     with ThreadPoolExecutor(max_workers=2) as pool:
      replies = list(pool.map(lambda req: call(req, full_response=True), competing))
     assert sum(reply.returncode == 0 and '"success": true' in reply.stdout for reply in replies) == 1, replies
     assert any('INSUFFICIENT_CLOUD_STOCK' in (reply.stdout + reply.stderr) for reply in replies), replies
     assert float(scalar("SELECT stock FROM public.pos_product_batches WHERE id="+lit(generic_batch))) == 3
     assert scalar("SELECT count(*) FROM public.pos_sales WHERE id LIKE 'far001-competing-%'") == '1'
     assert scalar("SELECT count(*) FROM public.pos_cash_movements WHERE sale_id LIKE 'far001-competing-%'") == '1'
     print('far001 staff credit permission and competing sales for the same lot PASS')


     assert scalar("SELECT count(*) FROM public.pos_inventory_movements WHERE product_id='far001-vi'") == '6'
     sql("UPDATE public.plans SET features=features || '{\"cloud_layaways\":true}'::jsonb WHERE code='qa_real_lab';")
     for layaway_id, reserved in [('far001-layaway', True), ('far001-layaway-unconfirmed', False)]:
      item = {'product_id':'far001-vi','product_name':'FAR001 VI','batch_id':'batch-entry-far001-second',
              'quantity':2,'unit_price':10,'unit_cost':4,'line_subtotal':20,'line_total':20}
      normalized = scalar("SELECT private.normalize_layaway_items_v1("+lit(json.dumps([item]))+"::jsonb,20)->'items'")
      sql("INSERT INTO public.pos_layaways(id,license_id,total_amount,paid_amount,deadline,status,items,actor_key,actor_name)"
          " VALUES ("+lit(layaway_id)+","+lit(L)+",20,20,now()+interval '1 day','ready',"
          +lit(normalized)+"::jsonb,'admin:00000000-0000-0000-0000-0000000000aa','Synthetic cashier');"
          " INSERT INTO public.pos_layaway_payments(id,license_id,layaway_id,payment_method,amount,actor_key,actor_name)"
          " VALUES ("+lit(layaway_id+'-payment')+","+lit(L)+","+lit(layaway_id)
          +",'cash',20,'admin:00000000-0000-0000-0000-0000000000aa','Synthetic cashier');")
      if reserved:
       sql("UPDATE public.pos_products SET committed_stock=2 WHERE id='far001-vi';"
           " UPDATE public.pos_product_batches SET committed_stock=2 WHERE id='batch-entry-far001-second';"
           " INSERT INTO public.pos_layaway_inventory_reservations"
           " (id,license_id,layaway_id,item_index,product_id,batch_id,quantity,unit_cost,actor_key,actor_name)"
           " VALUES ('far001-reservation',"+lit(L)+","+lit(layaway_id)+",1,'far001-vi','batch-entry-far001-second',2,4,"
           "'admin:00000000-0000-0000-0000-0000000000aa','Synthetic cashier');")
      sale_id = layaway_id+'-sale'
      layaway_req = {'layaway_id':layaway_id,'sale':{'id':sale_id,'total':20},
                     'items':[item],'payments':[{'id':sale_id+'-payment','method':'layaway_completed','amount':20}]}
      before = state(sale_id,'far001-vi')
      response = call(layaway_req, op='sale.layaway_complete')
      after = state(sale_id,'far001-vi')
      if reserved:
       valid = (response.returncode==0 and 'true' in response.stdout and after['stock']==6
                and after['sales']==1 and after['inventory']==1 and after['cash']==0)
      else:
       valid = (response.returncode!=0 and 'PHARMACY_CLOUD_AUTHORITY_REQUIRED' in response.stderr
                and before==after)
      results.append({'case':layaway_id,'operation':'sale.layaway_complete','passed':valid,
                      'stdout':response.stdout,'error':response.stderr,'before':before,'after':after})
      print(layaway_id,'PASS' if valid else 'FAIL',response.stderr.splitlines()[0] if response.stderr else '')
    assert scalar("SELECT count(*) FROM public.pos_sale_payments WHERE sale_id LIKE 'after-%' AND sale_id NOT IN ('after-ordinary_credit','after-pharmacy_credit','after-far001_stock') AND (received_amount<>100 OR change_amount<>80 OR amount<>20)")=='0'
    assert scalar("SELECT count(*) FROM public.pos_financial_operations WHERE status<>'completed'")=='0'
    roles=scalar("SELECT string_agg(rolname||':'||rolsuper||':'||rolbypassrls,',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated')")
    print('ROLES',roles)
    assert 'postgres:false:true' in roles
    assert scalar("SELECT count(*) FROM private.pharmacy_prescription_items_v1 WHERE dispensed_quantity<>2")=='0'
    assert scalar("SELECT debt FROM public.pos_customers WHERE id='lab-p0-customer'") in (['30','30.00'] if CURRENT_FINANCIAL else ['15','15.00'])
    Path('work').mkdir(exist_ok=True)
    result_path.write_text(json.dumps(results,indent=2))
    print('TOTAL',len(results),'PASS',sum(x['passed'] for x in results))
    if not all(x['passed'] for x in results): raise SystemExit('REGRESSION_FAILED: see '+str(result_path))
finally:
    subprocess.run(['docker','rm','-f','-v',C],capture_output=True)
