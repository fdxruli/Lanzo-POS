#!/usr/bin/env python3
"""Stage 3B: real PostgreSQL 17 syntax and replay-guard placement, isolated only.

Financial authority, receipt integrity and concurrency require later application QA.
The tiny dispatcher fixture here exercises the SQL transformation, not real payments.
"""
import os
import re
import subprocess
from pathlib import Path

if (os.getenv("PGHOST"), os.getenv("PGPORT"), os.getenv("PGUSER"), os.getenv("PGDATABASE")) != (
    "127.0.0.1", "55432", "postgres", "postgres"
):
    raise SystemExit("REFUSE_NON_ISOLATED_POSTGRES")

b_path = Path("supabase/migrations/20261112213000_apparel_layaway_financial_deadline_guard.sql")
replay_path = Path("supabase/migrations/20261112220000_apparel_layaway_completed_replay_cash_guard.sql")
phase_b = b_path.read_text()
replay = replay_path.read_text()
assert phase_b.count("$function$;") == 2, "Stage B function terminators"
assert "d0940c3da4d4a8346be12962ffeb7284" in replay
assert "85a8ee90ae77b0267b952a724c4a53bc" in replay

def body_only(source):
    source = re.sub(r"(?im)^begin;\s*$", "", source, count=1)
    source = re.sub(r"(?im)^commit;\s*$", "", source, count=1)
    return source

def run_sql(source):
    result = subprocess.run(
        ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-q", "-A", "-t"],
        input=source, text=True, capture_output=True, check=False, timeout=90
    )
    if result.returncode:
        print(result.stdout)
        print(result.stderr)
        raise SystemExit(result.returncode)
    return result.stdout.strip()

# B is parsed and both complete function definitions compiled by the real engine.
# All DDL below is rolled back in the isolated database.
schema = """
begin;
create schema private;
create table public.pos_layaways(id text, license_id uuid);
create table public.pos_cash_sessions(id text, license_id uuid, status text);
create table public.pos_layaway_payments(id text, license_id uuid);
create table public.pos_cash_movements(id text, license_id uuid);
create table public.pos_sync_events(id bigint, license_id uuid);
"""
calendar = """
do $calendar$
begin
  assert (timestamptz '2026-11-13 05:59:00+00' at time zone 'America/Merida')::date = date '2026-11-12';
  assert (timestamptz '2026-11-13 06:01:00+00' at time zone 'America/Merida')::date = date '2026-11-13';
  assert (timestamptz '2026-11-13 07:59:00+00' at time zone 'America/Tijuana')::date = date '2026-11-12';
  assert (timestamptz '2026-11-13 08:01:00+00' at time zone 'America/Tijuana')::date = date '2026-11-13';
  assert (timestamptz '2026-11-12 00:00:00+00' at time zone 'UTC')::date = date '2026-11-12';
  begin
    perform '2026-02-30'::date;
    raise exception 'INVALID_DEADLINE_ACCEPTED';
  exception when datetime_field_overflow then null;
  end;
end;
$calendar$;
"""
run_sql(schema + body_only(phase_b) + calendar + "rollback;")
print("SQL_B_POSTGRES17_PASS: two complete functions compiled and rolled back; Merida/Tijuana dates")

# A small independent fixture tests only the precise guard movement, in PostgreSQL.
# It does NOT mock a commercial end-to-end payment or establish payment authority.
fixture = """
create schema private;
create table public.pos_cash_sessions(license_id uuid, id text, status text);
create table public.pos_financial_operations(
  license_id uuid, idempotency_key text, status text,
  response_payload jsonb, legacy_idempotency_key text
);
insert into public.pos_cash_sessions values
  ('00000000-0000-0000-0000-000000000001', 'closed', 'closed'),
  ('00000000-0000-0000-0000-000000000001', 'open', 'open');
insert into public.pos_financial_operations values
  ('00000000-0000-0000-0000-000000000001', 'K1', 'completed',
   '{"confirmed":true}'::jsonb, 'INTERNAL_K1');
"""
stub = """
create or replace function __NAME__(
  p_license_key text, p_device_fingerprint text, p_security_token text,
  p_staff_session_token text, p_idempotency_key text, p_request_hash text,
  p_operation_type text, p_request jsonb
) returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_license_id uuid := '00000000-0000-0000-0000-000000000001'::uuid;
  v_cash_session_id text := p_request->>'cash_session_id';
  v_operation public.pos_financial_operations;
  v_internal_idempotency_key text;
begin
  select * into v_operation from public.pos_financial_operations
   where license_id = v_license_id and idempotency_key = p_idempotency_key;
  if v_cash_session_id is not null then
      if (select status from public.pos_cash_sessions where license_id = v_license_id and id = v_cash_session_id) <> 'open' then
        raise exception 'CASH_SESSION_NOT_OPEN' using errcode = 'P0001';
      end if;
  end if;
  if v_operation.status = 'completed' then
    return v_operation.response_payload;
  end if;
  v_internal_idempotency_key := v_operation.legacy_idempotency_key;
  return jsonb_build_object('status', 'EXECUTED');
end;
$function$;
"""
names = ("public.pos_execute_financial_operation_v1", "private.pos_execute_financial_operation_core_v2")
run_sql(fixture + "".join(stub.replace("__NAME__", name) for name in names))
hashes = run_sql("""
select md5(replace(pg_get_functiondef(to_regprocedure(identity)),chr(13),''))
from (values
  (1, 'public.pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)'),
  (2, 'private.pos_execute_financial_operation_core_v2(text,text,text,text,text,text,text,jsonb)')
) as sources(ordering, identity)
order by ordering;
""").splitlines()
assert len(hashes) == 2
# Only this disposable validation copy substitutes fixture precondition hashes.
test_replay = replay.replace("d0940c3da4d4a8346be12962ffeb7284", hashes[0]).replace(
    "85a8ee90ae77b0267b952a724c4a53bc", hashes[1]
)
check = """
do $check$
declare
  fname text;
  fn regprocedure;
  definition text;
  response jsonb;
begin
  for fname in select unnest(array[
    'public.pos_execute_financial_operation_v1',
    'private.pos_execute_financial_operation_core_v2'
  ]) loop
    fn := to_regprocedure(fname || '(text,text,text,text,text,text,text,jsonb)');
    definition := pg_get_functiondef(fn);
    assert position('CASH_SESSION_NOT_OPEN' in definition) >
      position('v_operation.status = ''completed''' in definition), 'Cash guard precedes replay';
    execute format('select %s($1,$2,$3,$4,$5,$6,$7,$8)',fname)
      into response using 'license','device','token',null,'K1','hash','layaway.payment',
        '{"cash_session_id":"closed"}'::jsonb;
    assert response = '{"confirmed":true}'::jsonb, 'Committed closed-session replay failed';
    begin
      execute format('select %s($1,$2,$3,$4,$5,$6,$7,$8)',fname)
        using 'license','device','token',null,'K2','hash','layaway.payment',
          '{"cash_session_id":"closed"}'::jsonb;
      raise exception 'NEW_CLOSED_CASH_WAS_NOT_REJECTED';
    exception when sqlstate 'P0001' then
      if SQLERRM <> 'CASH_SESSION_NOT_OPEN' then raise; end if;
    end;
  end loop;
end;
$check$;
"""
run_sql("begin;\n" + body_only(test_replay) + check + "rollback;")
print("SQL_REPLAY_POSTGRES17_PASS: transform compiled and reverted; synthetic closed-session decision")
print("COMMERCIAL_QA_PENDING: no production operations or real financial/concurrency test")
