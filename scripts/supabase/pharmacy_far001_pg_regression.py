#!/usr/bin/env python3
"""Run the FAR-001 migration and focused tests in a fresh PostgreSQL 17 container.

Authentication, catalog projection and movement helper functions are fixtures.
The receipt transaction, batch guards and sale-line guard are the migration code.
"""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parents[2]
migrations = root / "supabase/migrations"
fixtures = root / "scripts/supabase/fixtures"
stage2 = (migrations / "20261111230000_pharmacy_stage2_inventory_authority.sql").read_text()
migration = (migrations / "20261118043658_far_001_pharmacy_receipt_authority.sql").read_text()

def stage2_function(name, delimiter="$$"):
    start = stage2.lower().index("create or replace function " + name + "(")
    opening = stage2.index(delimiter, start)
    closing = stage2.index(delimiter, opening + len(delimiter))
    return stage2[start:closing + len(delimiter)] + ";"

container = subprocess.check_output([
    "docker", "run", "--detach", "--rm", "--env", "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17-alpine"
], text=True, timeout=120).strip()

def sql(statement, *, check=True):
    return subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-XAt", "-h", "127.0.0.1", "-U", "postgres", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, check=check, timeout=30
    )

try:
    for _ in range(60):
        if sql("select 1;", check=False).returncode == 0:
            break
        time.sleep(0.5)
    else:
        raise RuntimeError("PostgreSQL container did not become ready")

    setup = (fixtures / "pharmacy_far001_schema.sql").read_text()
    setup += "\n" + "\n".join(stage2_function("private.pharmacy_stage2_" + name) for name in [
        "business", "protected_product", "validate_receipt"
    ])
    setup += "\n" + stage2_function("public.pos_add_inventory_entry", "$function$")
    sql(setup + "\n" + migration + "\n" + (fixtures / "pharmacy_far001_cases.sql").read_text())
    print("PASS isolated receipt, lot rejection, ACL, rollback and sale-line tests")

    # A request aborted before COMMIT leaves no effects. Reuse its original key.
    timed_out = sql("""
      begin;
      select public.far001_test_receipt('timeout', lot=>'LOT-TIMEOUT');
      set local statement_timeout='50ms';
      select pg_sleep(1);
      commit;
    """, check=False)
    assert "canceling statement due to statement timeout" in timed_out.stderr, timed_out.stderr
    assert sql("select count(*) from public.pos_inventory_movements where idempotency_key='timeout';").stdout.strip() == "0"
    assert sql("select public.far001_test_receipt('timeout', lot=>'LOT-TIMEOUT')->>'success';").stdout.strip() == "true"

    # Discard the response of a committed transaction, then retry from another connection.
    sql("select public.far001_test_receipt('lost-response', lot=>'LOT-LOST');")
    assert sql("select public.far001_test_receipt('lost-response', lot=>'LOT-LOST')->>'success';").stdout.strip() == "true"
    assert sql("select count(*) from public.pos_inventory_movements where idempotency_key='lost-response';").stdout.strip() == "1"

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(sql, "begin; select public.far001_test_receipt('same-key', lot=>'LOT-SAME'); select pg_sleep(0.5); commit;")
        second = pool.submit(sql, "select public.far001_test_receipt('same-key', lot=>'LOT-SAME')->>'success';")
        first.result()
        assert second.result().stdout.strip() == "true"
    assert sql("select count(*) from public.pos_inventory_movements where idempotency_key='same-key';").stdout.strip() == "1"

    with ThreadPoolExecutor(max_workers=2) as pool:
        calls = [pool.submit(sql, f"select public.far001_test_receipt('competing-{n}', "
                            f"lot=>'LOT-COMPETING', device=>'00000000-0000-0000-0000-00000000000{n + 1}');",
                             check=False)
                 for n in (1, 2)]
        results = [call.result() for call in calls]
    assert sorted(result.returncode for result in results) == [0, 3], results
    assert any("PHARMACY_EXISTING_BATCH_REQUIRED" in result.stderr for result in results)
    assert sql("select count(*) from public.pos_product_batches where manufacturer_batch_id='LOT-COMPETING';").stdout.strip() == "1"
    print("PASS isolated timeout before commit, lost response after commit and concurrent connections")
except subprocess.CalledProcessError as error:
    print(error.stderr)
    raise
finally:
    subprocess.run(["docker", "stop", container], check=True, capture_output=True, timeout=30)
