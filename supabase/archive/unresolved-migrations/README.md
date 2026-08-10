# Unresolved historical migrations

Files in this directory are **historical, non-executable evidence**. They are
deliberately outside `supabase/migrations/` and must not be consumed by
production migration runners.

## `20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql`

- Status: `HISTORICAL / NON-EXECUTABLE`
- Execution provenance: `UNRECOVERABLE`
- SHA-256 (canonical Git/LF bytes): `A95243579B801D83EFCABDA4770EBABD0B155553CC16C853DDA016F22F5C7023`

Must not:

- use `migration repair` to mark it applied or reverted;
- re-execute its DML; or
- use it as a production migration.

The forward schema contract formerly present in this file is represented by
`20260810092512_ecom_catalog_revision_forward_baseline.sql`. That prospective
migration intentionally excludes the historical data backfill.
