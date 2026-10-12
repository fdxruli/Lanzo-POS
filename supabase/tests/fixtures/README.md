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
