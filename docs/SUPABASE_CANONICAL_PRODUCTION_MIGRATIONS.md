# Canonical Supabase production migrations

Production migrations are deployed only by the manual workflow
`.github/workflows/supabase-production-migrations.yml`. The Supabase connector
`apply_migration` path is forbidden for this purpose because it cannot accept a
caller-selected ledger version.

## Required repository secrets

Configure these encrypted GitHub Actions secrets manually. Never commit or print
their values:

- `SUPABASE_ACCESS_TOKEN` — Supabase CLI non-interactive access token.
- `SUPABASE_PRODUCTION_DB_PASSWORD` — database password for project
  `odlrhijtfyavryeqivaa`.

## DRY_RUN

1. Open **Actions → Canonical Supabase Production Migrations → Run workflow**
   from `main`.
2. Select `DRY_RUN`.
3. Enter the exact current `main` SHA and the comma-separated migration version
   set expected to be pending, for example `20260820123456`.
4. Inspect `migration list` and `db push --dry-run` output. A mismatch, invalid
   filename, missing secret, unexpected local-only/remote-only row, duplicate
   version, or already-applied expected version fails closed.

## APPLY

Use only after reviewed DRY_RUN evidence. Run from `main` with the same SHA and
expected set, select `APPLY`, and enter exactly `APPLY <expected_versions>`.
The workflow re-runs the entire preflight before `supabase db push --linked`.
It then re-runs `supabase migration list --linked`; every version applied by the
invocation must match a committed `supabase/migrations/<14-digit-version>_<name>.sql`
prefix. No repair, reset, direct ledger mutation, or connector SQL application
is permitted.
