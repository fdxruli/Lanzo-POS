#!/usr/bin/env python3
"""Disposable PG17 reproduction; never connects to Production.
Uses real financial SQL from the existing PR338 snapshot plus exact Pharmacy
Stages 1-3. This is NOT a full snapshot of current Production financial code.
Run: python scripts/supabase/pharmacy_stage3_deferred_pg_regression.py --isolated-fixture
Evidence: work/pharmacy-stage3-results.json. Docker container removed on exit.
"""
import subprocess, json, datetime, sys, time, uuid
from pathlib import Path
if sys.argv[1:] != ['--isolated-fixture']:
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
    for args in [('null_flags',),('common',),('batch',None,False,True),('other',),('otc','VI'),('ab','IV',True,True),('iv','IV',False,True),('I','I',False,True),('II','II',False,True),('III','III',False,True)]:seed(*args)

    def request(name,pid,rx=None,batch=None,qty=2):
     i={'id':name+'-line','product_id':pid,'product_name':pid,'quantity':qty,'unit_price':10,'line_subtotal':10*qty,'line_total':10*qty}
     if rx is not None:i['metadata']={'pharmacyDispensationV1':rx}
     if batch:i['batch_id']=batch
     return {'cash_session_id':'lab-cash-a','sale':{'id':name,'subtotal':10*qty,'total':10*qty,'payment_method':'cash','amount_paid':10*qty,'balance_due':0,'change_amount':100-10*qty},'items':[i],'payments':[{'id':name+'-pay','method':'cash','amount':10*qty,'received_amount':100,'change_amount':100-10*qty}]}

    def rx(name):return {'version':1,'reference':name,'prescriberName':'Synthetic Doctor','prescriberLicense':'SYNTH-1234','prescriberAddress':'Synthetic address only','issuedOn':scalar("SELECT (now() AT TIME ZONE 'America/Merida')::date"),'treatmentUntil':'2099-01-01','prescribedQuantity':2,'stampDeclared':True,'retentionDeclared':True}

    def state(name,pid):
     return json.loads(scalar("SELECT json_build_object('sales',(SELECT count(*) FROM public.pos_sales WHERE id="+lit(name)+"),'items',(SELECT count(*) FROM public.pos_sale_items WHERE sale_id="+lit(name)+"),'stock',(SELECT stock FROM public.pos_products WHERE id="+lit(pid)+"),'inventory',(SELECT count(*) FROM public.pos_inventory_movements WHERE sale_id="+lit(name)+"),'receipts',(SELECT count(*) FROM public.pos_financial_operations WHERE idempotency_key="+lit(name+'-key')+"),'dispensed_quantity',(SELECT coalesce(sum(quantity),0) FROM private.pharmacy_dispensations_v1 WHERE sale_id="+lit(name)+"),'cash_amount',(SELECT coalesce(sum(amount),0) FROM public.pos_cash_movements WHERE sale_id="+lit(name)+"),'cash',(SELECT count(*) FROM public.pos_cash_movements WHERE sale_id="+lit(name)+"),'payments',(SELECT count(*) FROM public.pos_sale_payments WHERE sale_id="+lit(name)+"),'dispensations',(SELECT count(*) FROM private.pharmacy_dispensations_v1 WHERE sale_id="+lit(name)+"))"))

    def call(req,role='anon',op='sale.cashier_inventory'):
     j=lit(json.dumps(req))+'::jsonb';name=req['sale']['id']
     request_hash=scalar("SELECT private.financial_operation_hash("+lit(op)+",private.canonical_financial_request_v1("+lit(op)+","+j+"),'admin:00000000-0000-0000-0000-0000000000aa','lab-cash-a','lab-station-a')")
     s="BEGIN; SET LOCAL ROLE "+role+"; SELECT public.pos_execute_financial_operation_v1('lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session',"+lit(name+'-key')+","+lit(request_hash)+","+lit(op)+","+j+")->>'success'; SELECT session_user,current_user; COMMIT;"
     return sql(s,False,user='authenticator')

    sql("INSERT INTO public.pos_customers(id,license_id,name,credit_limit) VALUES ('lab-p0-customer','00000000-0000-0000-0000-000000000001','Synthetic customer',200);")
    cases=[('ordinary_6b','common',False,None,None,None),('ordinary_credit','common',False,None,None,None),('pharmacy_null_flags','null_flags',True,None,None,None),('common','common',False,None,None,None),('common_batch','batch',False,None,'batch-batch',None),('pharmacy_other','other',True,None,None,None),('otc','otc',True,None,None,None),('antibiotic','ab',True,'valid','ab-batch',None),('fraction_iv','iv',True,'valid','iv-batch',None),('missing_rx','ab',True,None,'ab-batch','PHARMACY_PRESCRIPTION_REQUIRED'),('missing_batch','ab',True,'valid',None,'PHARMACY_DISPENSATION_BATCH_REQUIRED'),('wrong_batch','ab',True,'valid','iv-batch','CLOUD_BATCH_NOT_AVAILABLE'),('excess','ab',True,'excess','ab-batch','PHARMACY_PRESCRIPTION_BALANCE_EXCEEDED'),('I','I',True,'valid','I-batch','CLOUD_PRODUCT_NOT_AVAILABLE'),('II','II',True,'valid','II-batch','CLOUD_PRODUCT_NOT_AVAILABLE'),('III','III',True,'valid','III-batch','CLOUD_PRODUCT_NOT_AVAILABLE'),('no_stamp','ab',True,'no_stamp','ab-batch','PHARMACY_PRESCRIPTION_STAMP_REQUIRED'),('no_retention','ab',True,'no_retention','ab-batch','PHARMACY_PRESCRIPTION_RETENTION_REQUIRED'),('expired','ab',True,'expired','ab-batch','PHARMACY_PRESCRIPTION_EXPIRED_OR_QUANTITY_INVALID'),('doctor_missing','ab',True,'doctor_missing','ab-batch','PHARMACY_PRESCRIPTION_FIELDS_INVALID')]
    sql("UPDATE public.pos_products SET prescription_type=NULL, requires_prescription=NULL WHERE id='null_flags';")
    results=[]

    for phase in ['before','after']:
     if phase=='after':
      migration=next(Path('supabase/migrations').glob('*_pharmacy_stage3_deferred_batch_security.sql')).read_text()
      sql(migration);sql(migration)
     for label,pid,pharmacy,kind,batch,error in cases:
      name=phase+'-'+label; data=rx(name) if kind else None
      if kind=='excess':data['prescribedQuantity']=1
      if kind=='no_stamp':data['stampDeclared']=False
      if kind=='no_retention':data['retentionDeclared']=False
      if kind=='expired':data['treatmentUntil']='2020-01-01';data['issuedOn']='2020-01-01'
      if kind=='doctor_missing':data['prescriberName']=''
      sql("UPDATE public.business_profiles SET business_type=ARRAY["+lit('farmacia' if pharmacy else 'abarrotes')+"::public.business_category] WHERE license_id="+lit(L))
      req=request(name,pid,data,batch)
      op='sale.cashier' if label in ['missing_batch','ordinary_6b'] else 'sale.cashier_inventory'
      if label=='ordinary_credit':
       op='sale.credit';req['customer_id']='lab-p0-customer'
       req['sale'].update(customer_id='lab-p0-customer',payment_method='mixed_credit',amount_paid=5,balance_due=15,change_amount=0,metadata={'cloudInventoryEffects':True})
       req['payments'][0].update(amount=5,received_amount=5,change_amount=0)
      before=state(name,pid);r=call(req,role='authenticated' if label=='ordinary_6b' else 'anon',op=op);after=state(name,pid)
      expected=error or (None if phase=='after' else '42501')
      # Before fix missing final batch is masked by the schema privilege error.
      if phase=='before' and label=='missing_batch':expected='42501'
      if phase=='before' and label in ['pharmacy_other','pharmacy_null_flags']:expected='PHARMACY_PRESCRIPTION_REQUIRED'
      passed=(r.returncode==0 and 'true' in r.stdout) if expected is None else (r.returncode!=0 and expected in r.stderr)
      if r.returncode:passed=passed and before==after
      else:passed=passed and after['sales']==1 and after['items']==1 and after['cash']==1 and after['inventory']==(0 if op=='sale.cashier' else 1) and after['stock']==before['stock']-(0 if op=='sale.cashier' else 2) and after['cash_amount']==(5 if op=='sale.credit' else 20) and after['receipts']==1
      row={'phase':phase,'case':label,'role':'authenticated' if label=='ordinary_6b' else 'anon','business':'pharmacy' if pharmacy else 'ordinary','operation':op,'passed':passed,'stdout':r.stdout,'error':r.stderr,'before':before,'after':after};results.append(row)
      print(phase,label,'PASS' if passed else 'FAIL',r.stderr.splitlines()[0] if r.stderr else '')
      if phase=='after' and label in ['common_batch','antibiotic'] and r.returncode==0:
       rr=call(req); replay=state(name,pid);results.append({'phase':phase,'case':label+'_replay','role':'anon','operation':'sale.cashier_inventory','passed':rr.returncode==0 and replay==after,'state':replay,'error':rr.stderr})
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
    results.append({'case':'final_batch_wrong_product','role':'anon at COMMIT; owner mutation within synthetic transaction','passed':rejection.returncode!=0 and 'PHARMACY_DISPENSATION_BATCH_REQUIRED' in rejection.stderr,'error':rejection.stderr})
    assert scalar("SELECT count(*) FROM private.pharmacy_dispensations_v1 d JOIN public.pos_sale_items si ON si.id=d.sale_item_id JOIN public.pos_product_batches b ON b.id=d.batch_id WHERE d.batch_id IS DISTINCT FROM si.batch_id OR b.product_id<>d.product_id OR b.license_id<>d.license_id")=='0'
    assert scalar("SELECT count(*) FROM public.pos_sale_payments WHERE sale_id LIKE 'after-%' AND sale_id<>'after-ordinary_credit' AND (received_amount<>100 OR change_amount<>80 OR amount<>20)")=='0'
    assert scalar("SELECT count(*) FROM public.pos_financial_operations WHERE status<>'completed'")=='0'
    roles=scalar("SELECT string_agg(rolname||':'||rolsuper||':'||rolbypassrls,',' ORDER BY rolname) FROM pg_roles WHERE rolname IN ('postgres','anon','authenticated')")
    print('ROLES',roles)
    assert 'postgres:false:true' in roles
    assert scalar("SELECT count(*) FROM private.pharmacy_prescription_items_v1 WHERE dispensed_quantity<>2")=='0'
    assert scalar("SELECT debt FROM public.pos_customers WHERE id='lab-p0-customer'") in ['15','15.00']
    Path('work').mkdir(exist_ok=True)
    Path('work/pharmacy-stage3-results.json').write_text(json.dumps(results,indent=2))
    print('TOTAL',len(results),'PASS',sum(x['passed'] for x in results))
    if not all(x['passed'] for x in results): raise SystemExit('REGRESSION_FAILED: see work/pharmacy-stage3-results.json')
finally:
    subprocess.run(['docker','rm','-f','-v',C],capture_output=True)
