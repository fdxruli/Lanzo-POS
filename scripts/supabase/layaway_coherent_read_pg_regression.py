#!/usr/bin/env python3
"""Real PostgreSQL 17 MVCC regression, disposable PR338 financial fixture only.

The two reader RPCs, commercial layaway executors and frontier are exact
read-only catalog captures. The pre-existing PR338 schema/auth dependencies
are reused. Test-only serializer wrappers provide a deterministic lock
barrier without replacing either RPC or any financial executor. No network
connection to Production; docker exec only. This does not exercise the
public financial dispatcher, Realtime transport or the browser.
"""
import hashlib
import json
import subprocess
import sys
import time
import uuid
from pathlib import Path

assert sys.argv[1:] == ['--isolated-fixture']
C = 'lanzo-layaway-pg-' + uuid.uuid4().hex[:10]
IMAGE = 'postgres:17@sha256:846a7ddaa67a4b354ae1d21087b683901aa6113a4ed626d3787cfbf6c85e3e07'
ROOT = Path('supabase/tests/fixtures')
FIX = ROOT / 'pr338-real-financial'
MIG = Path('supabase/migrations/20261126020000_layaway_coherent_read_v1.sql')
ROLLBACK = Path('docs/sync/20261126020000_layaway_coherent_read_v1.rollback.sql')
L = '00000000-0000-0000-0000-000000000001'
B = '00000000-0000-0000-0000-000000000002'
ADMIN = "'lab-license-a','lab-device-a','lab-device-token-a','lab-admin-session'"
STAFF = "'lab-license-a','lab-device-b','lab-device-token-b','lab-staff-session'"
LOCK = 918273615
PARENT = 'pos_layaway_read_to_jsonb_v1'
PAYMENT = 'pos_layaway_payment_read_to_jsonb_v1'
FRONTIER = 'pos_sync_safe_frontier_v1'
TYPES = {PARENT: 'public.pos_layaways', PAYMENT: 'public.pos_layaway_payments'}
FIELDS = ('payments', 'inventory_reservations', 'cash_movements', 'inventory_movements')

def cmd(user='postgres'):
    return ['docker', 'exec', '-i', C, 'psql', '-X', '-qAt', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']

def sql(s, user='postgres', check=True):
    result = subprocess.run(cmd(user), input=s, capture_output=True, text=True, timeout=90)
    if check and result.returncode:
        raise AssertionError(result.stderr + '\nSQL: ' + s[:500])
    return result

def scalar(s):
    return sql(s).stdout.strip().splitlines()[-1]

def lit(s):
    return "'" + str(s).replace("'", "''") + "'"

def js(s):
    return lit(json.dumps(s, separators=(',', ':'))) + '::jsonb'

def auth_expr(expr, auth_role='anon'):
    return 'set role ' + auth_role + '; select ' + expr + ';'

def get_expr(id, auth=ADMIN):
    return 'public.pos_get_layaway(' + auth + ',' + lit(id) + ')'

def pull_expr(since, limit=499, auth=ADMIN):
    return 'public.pos_pull_layaway_changes(' + auth + ',' + str(since) + ',' + str(limit) + ')'

def read(expr, role='anon'):
    return json.loads(scalar(auth_expr(expr, role)))

def frontier():
    return int(scalar("select safe_change_seq from private.pos_sync_safe_frontier_v1(" + lit(L) + "::uuid);"))

def capture_aggregate(payload, id):
    parent = payload.get('layaway')
    if parent is None:
        parent = next(x for x in payload['layaways'] if x['id'] == id)
    # Each race page contains one aggregate; field order is not semantic.
    return (parent, *(sorted(payload[k], key=lambda x: x['id']) for k in FIELDS))

def operation(name, request, key):
    if name == 'completion':
        return 'private.execute_layaway_completion_financial_v1(' + ADMIN + ',' + js(request) + ',' + lit(key) + ')'
    return ('private.execute_layaway_' + name + '_financial_v1(private.validate_pos_sync_context(' + ADMIN
            + '),' + js(request) + ',' + lit(key) + ',' + lit('hash-' + key) + ",'lab-station-a')")

def writer(expr):
    response = json.loads(scalar('select ' + expr + ';'))
    assert response['success'] is True, response
    return response

def create_case(id, initial):
    since = frontier()
    items = [
        dict(id=id+'-line1', product_id=id+'-unit', product_name=id+'-unit', quantity=1, unit_price=10, line_total=10),
        dict(id=id+'-line2', product_id=id+'-batch', product_name=id+'-batch', batch_id=id+'-lot', quantity=1, unit_price=10, line_total=10)
    ]
    sql("insert into public.pos_products(id,license_id,name,name_key,price,cost,stock,batch_management) values "
        f"({lit(id+'-unit')},{lit(L)},{lit(id+'-unit')},{lit(id+'-unit')},10,4,20,'{{\"enabled\":false}}'),"
        f"({lit(id+'-batch')},{lit(L)},{lit(id+'-batch')},{lit(id+'-batch')},10,4,20,'{{\"enabled\":true}}');"
        "insert into public.pos_product_batches(id,license_id,product_id,stock,cost,price,expiry_date) values "
        f"({lit(id+'-lot')},{lit(L)},{lit(id+'-batch')},20,4,10,'2099-01-01');")
    writer(operation('create', {
        'layaway': dict(id=id, customer_name='Synthetic customer', total_amount=20, deadline='2099-01-01', items=items),
        'payment': dict(id=id+'-initial', amount=initial, method='cash', payment_type='initial_deposit'),
        'cash_session_id': 'lab-cash-a'
    }, id+'-create'))
    before = read(get_expr(id))
    assert len(before['inventory_reservations']) == 2, before
    assert {x.get('batch_id') for x in before['inventory_reservations']} == {None, id+'-lot'}
    assert all(x['status'] == 'reserved' and float(x['quantity']) == 1 for x in before['inventory_reservations'])
    return since, before

def mutation(id, kind):
    if kind == 'payment':
        return operation('payment', dict(layaway_id=id, cash_session_id='lab-cash-a',
            payment=dict(id=id+'-second', amount=5, method='cash')), id+'-pay')
    if kind == 'cancel':
        return operation('cancel', dict(layaway_id=id, cash_session_id='lab-cash-a', retain_money=False,
            refund_id=id+'-refund', reason='synthetic cancellation'), id+'-cancel')
    items = json.loads(scalar('select items from public.pos_layaways where id='+lit(id)+';'))
    return operation('completion', dict(layaway_id=id, sale=dict(id=id+'-sale', total=20),
        items=items, payments=[dict(id=id+'-sale-pay',method='layaway_completed',amount=20)]), id+'-deliver')

def instrument_serializer(name):
    typ = TYPES[name]
    sql(f"alter function private.{name}({typ}) rename to qa_original_{name};"
        f"create function private.{name}(p_row {typ}) returns jsonb language plpgsql stable set search_path='' as $qa$"
        "begin if current_setting('application_name')='layaway-race-reader' then "
        f"perform pg_advisory_xact_lock({LOCK}::bigint); end if; "
        f"return private.qa_original_{name}(p_row); end;$qa$;")

def restore_serializer(name):
    typ = TYPES[name]
    sql(f"drop function private.{name}({typ}); alter function private.qa_original_{name}({typ}) rename to {name};")

def instrument_frontier():
    sql(f"alter function private.{FRONTIER}(uuid) rename to qa_original_{FRONTIER};"
        f"create function private.{FRONTIER}(p_license_id uuid) returns table(safe_change_seq bigint,sync_deferred boolean) "
        "language plpgsql volatile set search_path='' as $qa$ begin "
        f"return query select * from private.qa_original_{FRONTIER}(p_license_id); "
        "if current_setting('application_name')='layaway-race-reader' then "
        f"perform pg_advisory_xact_lock({LOCK}::bigint); end if; end;$qa$;")

def restore_frontier():
    sql(f"drop function private.{FRONTIER}(uuid); alter function private.qa_original_{FRONTIER}(uuid) rename to {FRONTIER};")

def run_race(expr, write_expr):
    # Writer holds a session advisory lock; reader enters a real PostgreSQL lock
    # wait after acquiring the designated snapshot. Observer verifies the wait.
    writer_proc = subprocess.Popen(cmd(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, bufsize=1)
    reader_proc = None
    try:
        def send(s, marker):
            writer_proc.stdin.write(s + '\n\\echo ' + marker + '\n')
            writer_proc.stdin.flush()
            lines = []
            while True:
                line = writer_proc.stdout.readline()
                if not line:
                    raise AssertionError('writer terminated: ' + writer_proc.stderr.read())
                if line.strip() == marker:
                    return lines
                if line.strip():
                    lines.append(line.strip())
        send(f"set statement_timeout='30s'; select pg_advisory_lock({LOCK}::bigint);", 'WRITER_LOCKED')
        reader_proc = subprocess.Popen(cmd(), stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        reader_proc.stdin.write("set application_name='layaway-race-reader'; set statement_timeout='30s'; "
                                + auth_expr(expr) + '\n')
        reader_proc.stdin.close()
        reader_proc.stdin = None
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if reader_proc.poll() is not None:
                out, err = reader_proc.communicate()
                raise AssertionError('Reader exited before barrier: ' + out + err)
            waiting = scalar("select exists(select 1 from pg_locks l join pg_stat_activity a on a.pid=l.pid "
                "where a.application_name='layaway-race-reader' and l.locktype='advisory' and not l.granted "
                f"and l.classid=0 and l.objid={LOCK} and l.objsubid=1);")
            if waiting == 't':
                break
            time.sleep(.05)
        else:
            raise AssertionError('No actual reader advisory-lock wait observed')
        lines = send('select ' + write_expr + ';', 'WRITER_COMMITTED')
        assert json.loads(lines[-1])['success'] is True, lines
        # Autocommit finishes the writer statement before the marker is printed.
        send(f'select pg_advisory_unlock({LOCK}::bigint);', 'WRITER_UNLOCKED')
        out, err = reader_proc.communicate(timeout=35)
        assert reader_proc.returncode == 0, err
        return json.loads(out.strip().splitlines()[-1])
    finally:
        if reader_proc is not None and reader_proc.poll() is None:
            reader_proc.kill()
            reader_proc.wait(timeout=5)
        if writer_proc.poll() is None:
            writer_proc.stdin.close()
            writer_proc.wait(timeout=10)

def check_committed_state(id, kind, payload):
    parent = payload['layaway']
    rows = payload['inventory_reservations']
    payments = payload['payments']
    if kind == 'payment':
        assert float(parent['paid_amount']) == 10 and float(parent['balance_due']) == 10
        assert sum(float(x['amount']) for x in payments if x['status']=='confirmed') == 10
        assert len(payments)==2 and len(payload['cash_movements'])==2
        status, stock = 'reserved', 20
    elif kind == 'cancel':
        assert parent['status']=='cancelled' and all(x['status']=='refunded' for x in payments)
        assert len(payload['cash_movements'])==2
        status, stock = 'released', 20
    else:
        assert parent['status']=='completed' and parent['conversion_sale_id']==id+'-sale'
        assert len(payments)==1 and len(payload['cash_movements'])==1
        assert scalar('select count(*) from public.pos_sales where layaway_id='+lit(id)+';')=='1'
        status, stock = 'consumed', 19
    assert len(rows)==2 and all(x['status']==status and float(x['quantity'])==1 for x in rows), rows
    physical = json.loads(scalar("select jsonb_build_array((select stock from public.pos_products where id="
        +lit(id+'-unit')+"),(select stock from public.pos_product_batches where id="+lit(id+'-lot')
        +"),(select committed_stock from public.pos_products where id="+lit(id+'-unit')
        +"),(select committed_stock from public.pos_product_batches where id="+lit(id+'-lot')+"));"))
    committed = 1 if status=='reserved' else 0
    assert physical == [stock, stock, committed, committed], physical

def race_case(phase, kind, mode):
    id = phase+'-'+kind+'-'+mode
    since, before = create_case(id, 20 if kind=='completion' else 5)
    expr = get_expr(id,STAFF) if mode=='get' else pull_expr(since,499,STAFF)
    helper = PAYMENT if mode=='get' else PARENT
    before_snapshot = capture_aggregate(read(expr), id)
    instrument_serializer(helper)
    try:
        observed = run_race(expr, mutation(id, kind))
    finally:
        restore_serializer(helper)
    after = read(get_expr(id))
    after_snapshot = capture_aggregate(after, id)
    actual = capture_aggregate(observed, id)
    assert before_snapshot != after_snapshot
    if phase=='after':
        assert actual == before_snapshot, (phase,kind,mode,observed)
    else:
        assert actual != before_snapshot and actual != after_snapshot, ('original mixture not reproduced',kind,mode,observed)
    check_committed_state(id,kind,after)
    if mode=='pull':
        replay = read(pull_expr(observed['latest_change_seq']))
        assert capture_aggregate(replay,id)==after_snapshot
    print(f'{phase} {kind} {mode}: ' + ('coherent previous snapshot; committed state verified' if phase=='after' else 'mixed snapshot reproduced; committed state verified'), flush=True)

subprocess.run(['docker','run','--detach','--name',C,'-e','POSTGRES_USER=lab_bootstrap',
                '-e','POSTGRES_DB=postgres','-e','POSTGRES_PASSWORD=synthetic-lab-only',IMAGE], check=True, capture_output=True)
try:
    for _ in range(100):
        ready = subprocess.run(['docker','exec',C,'pg_isready','-h','127.0.0.1','-U','lab_bootstrap','-d','postgres'], capture_output=True)
        if ready.returncode==0:
            break
        time.sleep(.2)
    else:
        raise AssertionError('Isolated PostgreSQL did not start')
    sql('create role postgres login createdb createrole bypassrls; alter database postgres owner to postgres; grant all on schema public to postgres;', user='lab_bootstrap')
    sql((FIX/'01-schema.sql').read_text())
    sql('set check_function_bodies=off;\n'+';\n'.join(json.loads((FIX/'02-function-sources.json').read_text()))+';')
    for filename in ['03-trigger-dependencies.sql','04-constraints-indexes-triggers.sql','05-policies.sql','06-function-acl.sql','seed-attempt-2.sql']:
        sql((FIX/filename).read_text())
    # The historical fixture lacks the real variant table required by its
    # installed stock-publication trigger. Reuse the exact canonical DDL;
    # this table remains empty and no stock trigger is disabled or mocked.
    variant_ddl = Path('supabase/migrations/20260715190958_ecom_products_model_1.sql').read_text()
    variant_ddl = variant_ddl[variant_ddl.index('create table if not exists public.ecommerce_published_product_variants ('):]
    sql(variant_ddl[:variant_ddl.index(';')+1])
    sql('grant anon,authenticated to postgres with set true;', user='lab_bootstrap')
    sql("alter table public.business_profiles add column if not exists timezone text;"
        "alter table public.pos_sync_events alter column change_seq drop default;"
        "update public.plans set features=features||'{\"cloud_layaways\":true}' where code='qa_real_lab';"
        f"insert into public.business_profiles(license_id,business_name,business_type,timezone) values ({lit(L)},'Synthetic shop',array['abarrotes'::public.business_category],'America/Merida');")
    rows = json.loads((ROOT/'layaway-coherent-read-live.json').read_text())
    sql('set check_function_bodies=off;\n'+';\n'.join(x['definition'] for x in rows)+';')
    for row in rows:
        name = row['schema']+'.'+row['name']
        signature = scalar("select oid::regprocedure::text from pg_proc where pronamespace="+lit(row['schema'])+"::regnamespace and proname="+lit(row['name'])+";")
        # search_path may omit public; use the explicitly qualified catalog name.
        signature = name+signature[signature.index('('):]
        if row['acl'] is not None:
            sql('revoke all on function '+signature+' from public,anon,authenticated,service_role;')
            for role in ['anon','authenticated','service_role']:
                if role+'=X/' in row['acl']:
                    sql('grant execute on function '+signature+' to '+role+';')
        actual = scalar("select md5(replace(pg_get_functiondef("+lit(signature)+"::regprocedure),chr(13),''));")
        assert actual==row['md5'], (name,actual,row['md5'])
    print('PG '+scalar('show server_version;')+'; exact reader/writer/frontier definitions verified; migration SHA256 '+hashlib.sha256(MIG.read_bytes()).hexdigest(),flush=True)
    for phase in ['before','after']:
        if phase=='after':
            sql(MIG.read_text())
            print('candidate installed in isolated PostgreSQL; guarded pre/postflight PASS',flush=True)
        for kind in ['payment','completion','cancel']:
            for mode in ['get','pull']:
                race_case(phase,kind,mode)

    # Writer commits after the safe frontier was observed, but before the
    # candidate's single MVCC statement begins. No cursor may be consumed.
    id = 'frontier-deferred'
    since, before = create_case(id,5)
    instrument_frontier()
    try:
        deferred = run_race(pull_expr(since,499,STAFF),mutation(id,'payment'))
    finally:
        restore_frontier()
    assert deferred['sync_deferred'] is True and deferred['latest_change_seq']==since
    assert deferred['events']==[] and deferred['layaways']==[]
    recovered = read(pull_expr(since))
    assert capture_aggregate(recovered,id)==capture_aggregate(read(get_expr(id)),id)
    print('future-aggregate deferral and recovery PASS',flush=True)

    # Stable pagination, all event ids exactly once, no skipped cursor or replay.
    expected = json.loads(scalar("select coalesce(jsonb_agg(e.change_seq order by e.change_seq),'[]') "
        "from public.pos_sync_events e left join public.pos_layaway_payments p on p.license_id=e.license_id and p.id=e.entity_id and e.entity_type='layaway_payment' "
        "left join public.pos_layaway_inventory_reservations r on r.license_id=e.license_id and r.id=e.entity_id and e.entity_type='layaway_inventory_reservation' "
        f"where e.license_id={lit(L)} and e.change_seq>{since} and (e.entity_type='layaway' or p.id is not null or r.id is not null or "
        "(e.entity_type in ('cash_movement','product','product_batch') and e.metadata->>'layaway_id' is not null));"))
    received, cursor = [], since
    for _ in range(100):
        page = read(pull_expr(cursor,1))
        assert page['since_change_seq']==cursor and page['latest_change_seq']>=cursor
        assert page['latest_change_seq']<=page['safe_change_seq'] and not page['sync_deferred']
        received.extend(x['change_seq'] for x in page['events'])
        if not page['has_more']:
            cursor=page['latest_change_seq']
            break
        assert page['latest_change_seq']>cursor
        cursor=page['latest_change_seq']
    else:
        raise AssertionError('Pagination did not terminate')
    assert received==expected and len(set(received))==len(received), (received,expected)
    assert read(pull_expr(cursor))['events']==[]
    ahead=read(pull_expr(cursor+100000))
    assert ahead['cursor_ahead_of_safe_frontier'] and ahead['latest_change_seq']==cursor+100000
    print('pagination, duplicate-free events and cursor-ahead compatibility PASS',flush=True)

    # Authorized Staff gets the same aggregate, then live permission revocation
    # denies both RPCs. A separate tenant's row is invisible to tenant A.
    assert capture_aggregate(read(get_expr(id,STAFF),'authenticated'),id)==capture_aggregate(read(get_expr(id)),id)
    assert capture_aggregate(read(pull_expr(since,499,STAFF),'authenticated'),id)==capture_aggregate(read(get_expr(id)),id)
    sql("update public.license_staff_users set permissions='{}' where username='lab-staff';")
    for expr in [get_expr(id,STAFF),pull_expr(since,499,STAFF)]:
        denied=sql(auth_expr(expr,'authenticated'),check=False)
        assert denied.returncode and 'POS_PERMISSION_DENIED:pos' in denied.stderr,denied.stderr
    sql("insert into public.pos_layaways(id,license_id,total_amount,paid_amount,balance_due,deadline,status,actor_key,actor_name)"
        f" values('tenant-b-secret',{lit(B)},10,0,10,'2099-01-01','active','synthetic','synthetic');"
        f"select private.record_pos_sync_event({lit(B)}::uuid,'layaway','tenant-b-secret','create');")
    denied=sql(auth_expr(get_expr('tenant-b-secret')),check=False)
    assert denied.returncode and 'LAYAWAY_NOT_FOUND' in denied.stderr
    assert all(x['id']!='tenant-b-secret' for x in read(pull_expr(0))['layaways'])
    bad_device=sql(auth_expr(get_expr(id,ADMIN.replace('lab-license-a','lab-license-b'))),check=False)
    assert bad_device.returncode and 'DEVICE_NOT_ALLOWED' in bad_device.stderr
    print('Admin/Staff allowed, revoked Staff and cross-tenant isolation PASS',flush=True)
    sql(ROLLBACK.read_text())
    print('guarded rollback and original function hashes PASS',flush=True)
finally:
    subprocess.run(['docker','rm','--force',C],check=True,capture_output=True)
