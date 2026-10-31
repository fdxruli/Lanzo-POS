# FIN-01 release review lab

This directory contains test-only tooling for the authorized review branch. PostgreSQL runs as an ephemeral GitHub Actions service. The database client is fixed to loopback port `55847`, only accepts `fin01_cert_*` database names, requires project identity `fin01-synthetic-replay`, and has no DSN, credentials, or Supabase connection path.

The workflow runs only on `review/fin01-f-pay-n01-release-r1`, grants `contents: read`, and defines no Production secrets. Runtime fixtures are fetched from immutable public commits, checked against SHA-256 values, used only inside the runner, and excluded from uploaded artifacts. The published branch retains only the version-only 333-entry ledger snapshot, profile hashes/ACL metadata, scripts, and reports; it does not duplicate captured PostgreSQL function bodies or the raw evidence archive.

## Rebuilding the post-3D14 state

The runner fetches the existing laboratory evidence at commit `9853236a31d55d9cb6542364c30e9e06be6eddd3` and the function source/ACL fixture at `fd4975ea8b525f2e0b1a812e91142b24fd435dc3`. It verifies the raw archive SHA, the exact `extra-functions.sql` SHA from the existing evidence, fixture JSON hashes, and all source-file hashes. The exact pre-3D14 definitions needed by the canonical 3D14 preconditions are reconstructed at runtime from the already published source snapshot. The runner then applies the hash-pinned canonical `20261026214837_restaurant_sale_dispatcher_guard_3d14.sql` and checks the resulting body hashes, owner, ACL, `SECURITY DEFINER`, and `search_path` against the hash-only contract.

The published fixture table snapshot predates `public.pos_financial_operations`, which canonical 3D14 references with `%rowtype`. To represent the existing SHARED.TERMINAL prerequisite, the runner extracts only that table's exact DDL, receipt index, RLS enablement, and default ACL revoke from the hash-pinned canonical `20260820165842_shared_terminal_financial_receipt_contract.sql`. It checks prerequisite constraints and the resulting table/security profile before applying 3D14. The migration itself and 3D14 remain unchanged, and the extracted SQL is temporary runtime material.

No altered copy of 3D14 is installed. The runner reports the source commit/file hashes in `artifacts/fin01/fixture-source-manifest.json`; generated fixture SQL and catalog dumps are never uploaded. PostgreSQL service logs are not captured, preventing failed server statements from duplicating function source in artifacts. The raw archive and existing branch commit remain the evidence source for the original fixture.

## Selective migration lab

Only the release migrations below are eligible for the synthetic selective applier:

- `supabase/migrations/20261022135915_fin01_historical_credit_owner_authorization.sql`
- `supabase/migrations/20261029235906_fin01_pay_n01_atomic_rejection_v1.sql`

Before either migration, the lab checks the exact synthetic project/database identity, PostgreSQL version, full 333-version version-only baseline, ledger schema, five F preconditions, and post-3D14 function contract in a read-only preflight. It then applies F followed by PAY-N01, with exact SHA and transaction checks. The test suite covers ledger preservation, PAY-N01 rollback and retry, idempotency, PAY-N02, the complete 63-assertion FIN-01 suite, function profile integrity, backup/restore, and 3D14 dispatcher behavior after both release migrations.

The applier is a test-only prototype. It does not connect to Production and does not claim that Supabase CLI will select only these two migrations. The Production workflow, remote ledger drift, backups, frontend sequencing, manual QA, and owner authorization remain independent deployment gates.

## CI coverage

The branch-only workflow runs on PostgreSQL 17.11 and 17.6, focused FIN-01 frontend tests, parser and transaction-control tests, an ESLint differential, production dependency advisory scan, the production build/postbuild audit, the selective-apply failure and recovery matrix, PAY-N01/PAY-N02 plus the 63-test FIN-01 suite, and 3D14 dispatcher assertions. It uploads JSON reports and logs, not runtime fixtures or database dumps.
