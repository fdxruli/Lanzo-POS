# Unresolved and deferred migrations

Files in this directory are **non-canonical, non-executable SQL** preserved
for historical review or deliberately deferred future work. They are outside
`supabase/migrations/` and must not be consumed by production migration
runners. A deferred migration must not be moved into the canonical directory
without a separately approved phase.

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

## `20261015134821_technical_incident_reporting_r1.sql`

- Status: `DEFERRED / NOT APPLIED / NOT CANONICAL`
- Scope: optional technical incident intake, separate from commercial support.
- Decision: this delivery uses manual Telegram and email support only. Do not
  move this SQL into `supabase/migrations/` or apply it as part of a canonical
  production deployment. Reconsider it only in a separately approved phase.
- SHA-256 (canonical Git/LF bytes):
  `20631989505E71636590B001F0E1D70B562D94DB6F970EC108BB00B57ECDDCC5`
