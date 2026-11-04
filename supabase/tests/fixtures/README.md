# Restaurant origin cancel 3D.1.3 SQL fixture

These scripts are for a new, disposable PostgreSQL 17 database on loopback. The setup includes copies of production helper/dispatcher bodies; the auth context and financial leaf functions are controlled test doubles. It creates test roles and tables. Never point it at Supabase production, staging, or a database containing application data.

PowerShell example from the repository root:

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55438'
$env:PGUSER = 'postgres'
$env:PSQL_BIN = 'C:\path\to\pgsql\bin\psql.exe'
node scripts/supabase/restaurant-origin-cancel-3d13-test.mjs --isolated-fixture
```

The SQL assertions run in `BEGIN … ROLLBACK`. They cover missing credentials, invalid device token, invalid staff session, staff without refunds, remote device, missing/stale versions, paid and terminal parents, idempotent retry, no financial effects, and a successful origin-device cancellation. The concurrency runner opens separate PostgreSQL sessions and uses the captured production financial dispatcher and parent lock; controlled fixture functions stand in for checkout/split leaf effects.

## Restaurant sale dispatcher guard 3D.14

`restaurant-sale-dispatcher-guard-3d14-test.mjs` runs the guard helper and the existing R2B receipt checker against a synthetic fixture in a fresh PostgreSQL 17 database named `pr338_3d14_fixture`. It extracts the current helper and R2B function definitions from the migrations, so the test exercises the checked-in helper without a second handwritten copy. The fixture accepts only named synthetic credentials and does **not** certify the production Auth chain or full sale, cash, credit, or inventory effects.

PowerShell example from the repository root:

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55438'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'pr338_3d14_fixture'
$env:PSQL_BIN = 'C:\path\to\pgsql\bin\psql.exe'
node scripts/supabase/restaurant-sale-dispatcher-guard-3d14-test.mjs --isolated-fixture
```

The database must be newly created and disposable. Never point this fixture at Supabase Production, staging, or a database with application data.

`restaurant-sale-dispatcher-guard-3d14-real-auth-test.mjs` is a separate C11 authorization-path fixture in a fresh database named `pr338_3d14_real_auth`. It loads the production entitlement, admin-session, Staff-session, device, permission, cash-station, and 3D.14 guard function definitions from the checked-in migrations. It uses synthetic license/device/session hashes and rolls back fixture rows. The positive cases prove that real Admin and permitted Staff contexts pass the 3D.14 guard; negative cases cover missing permission, expired/revoked sessions, invalid device, cross-tenant receipt lookup, wrong cash station, and a different Staff actor replaying an existing receipt. The fixture asserts unchanged sales, idempotency receipts, financial operations, cash movements, payments, inventory movements, and credit-ledger row counts immediately after each rejected case. It does not invoke full sale, cash, inventory, or credit leaf operations, so it is evidence for the real authorization path only, not complete C11 financial integration.

```powershell
$env:PGHOST = '127.0.0.1'
$env:PGPORT = '55438'
$env:PGUSER = 'postgres'
$env:PGDATABASE = 'pr338_3d14_real_auth'
$env:PSQL_BIN = 'C:\path\to\pgsql\bin\psql.exe'
node scripts/supabase/restaurant-sale-dispatcher-guard-3d14-real-auth-test.mjs --isolated-fixture
```

Use a separate new disposable database for each runner; both fixtures create their own schemas and tables.
