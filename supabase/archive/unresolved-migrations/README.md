# Unresolved historical migrations

Files in this directory are **historical, non-executable evidence**. They are
deliberately outside `supabase/migrations/` and must not be consumed by
production migration runners.

## `20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql`

- Status: `HISTORICAL / NON-EXECUTABLE`
- Execution provenance: `UNRECOVERABLE`
- SHA-256: `FF0386A936BF76BC27A62687EBD45FD9B963404962F37291424006B33B3033CC`

Must not:

- use `migration repair` to mark it applied or reverted;
- re-execute its DML; or
- use it as a production migration.

The forward schema contract formerly present in this file is represented by
`20260810092512_ecom_catalog_revision_forward_baseline.sql`. That prospective
migration intentionally excludes the historical data backfill.
