# Supabase migration ledger reconciliation

## Status

`BLOCKED` — the remote-only history has been reconciled in the repository, but
`20260801043000_ecom_catalog_legacy_timestamp_revision_repair` cannot safely be
marked applied: two currently eligible image projections differ from their POS
source. No production migration, DDL, customer-data mutation, or ledger repair
was performed.

## Scope and authoritative snapshot

- Repository: `fdxruli/Lanzo-POS`
- Production project: `odlrhijtfyavryeqivaa` (Lanzo)
- Reconciliation branch: `fix/supabase-migration-ledger-reconcile`
- Base: `origin/main` at `b0f555ae0bdcbe9a8d5067ab144e28aa30ab4ae1`
- Snapshot method: read-only production queries through the configured Supabase
  connection. No secrets are recorded here.

```sql
select
  version,
  name,
  statements
from supabase_migrations.schema_migrations
order by version;
```

The production snapshot contains 214 rows. Before file reconciliation, the
repository contained 218 migration files: 212 aligned, two remote-only, and six
local-only.

Initial remote-only entries:

- `20260802053039_ecom_portal_unified_site_document_v2`
- `20260802074419_ecommerce_site_version_deletion`

Initial local-only entries:

- `20260621000000_oss_bootstrap_license_period_schema.sql`
- `20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql`
- `20260801120000_ecom_portal_unified_site_document_v2.sql`
- `20260802073907_ecommerce_site_version_deletion.sql`
- `20260806061500_business_profile_rubro_realtime_sync.sql`
- `20260807061320_apparel_conflict_fix_initial_batches_create_only.sql`

The last item above was part of the initial evidence from the Product Form branch.
It is not present on this branch, which was created directly from current
`origin/main`.

## Divergence matrix

| Version / local file | Remote row and statement evidence | Current schema evidence | Classification | Resolution |
| --- | --- | --- | --- | --- |
| `20260802074419_ecommerce_site_version_deletion.sql` / old local alias `20260802073907_…` | Remote name matches. One statement, exact MD5 `6f6b4d5b406906f3032bbb4b4909207e`; the normalized-final-LF MD5 is `5c7f970242532524f039c62494a3b957`. | The known Git blob is `198ce8f800623bc060237f7bcf82ebbd0962b2d4`; it matches the canonical file after final-newline normalization. | `REMOTE_APPLIED_LOCAL_ALIAS` | Restored canonical `20260802074419` from production statements and removed `20260802073907`. SQL was not executed. |
| `20260802053039_ecom_portal_unified_site_document_v2.sql` / old local alias `20260801120000_…` | Remote name matches. One statement, 46,053 characters, MD5 `e54954657b7f7db936f1b6e3db0d4b8c`. The remote statement was recovered in bounded encoded chunks and written byte-for-byte after newline normalization. | Both required version/source constraints are present. All 25 named public/private functions exist with `SECURITY DEFINER` and a fixed `search_path`; none of their stored bodies contains the historical marker described below. | `REMOTE_APPLIED_LOCAL_ALIAS` | Removed `20260801120000` and retained the canonical remote timestamp. |
| `20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql` | No remote ledger row. | The decision function exists, remains `SECURITY DEFINER` with fixed `search_path`, preserves the intended legacy-epoch `apply` result and ordinary-version `conflict` result, and retains its comment. However, 2 of 4 currently eligible source-image projections differ from the POS source. | `UNRESOLVED` | Do **not** run `migration repair --status applied 20260801043000`. Full equivalence is not proven. |
| `20260621000000_oss_bootstrap_license_period_schema.sql` | No remote ledger row. | It is a compatibility foundation for `license_periods`, `ai_agent_usage.period_id`, and `ensure_current_license_period`, before their first June 24 dependency. | `BOOTSTRAP_ONLY` | Do not execute or repair it in production. Keep it in `supabase/migrations/`: moving it would break the documented fresh-install dependency order. |
| `20260806061500_business_profile_rubro_realtime_sync.sql` | No remote ledger row. | `BUSINESS_PROFILE_UPDATED` is absent from the broadcaster, the emitting function and trigger do not exist, and the profile RPC lacks `updated_at` and `profile_revision`. The required `realtime.send(jsonb,text,text,boolean)` signature and prerequisite tables/functions exist. | `LEGITIMATELY_PENDING` | Remains pending for a post-merge deployment only. |

### Unified-site-document source note

The remote recorded statement contains the literal historical sequence
`â€¦29 tokens truncatedâ€¦`. It was preserved exactly because
`schema_migrations.statements` is the authoritative ledger source for this
reconciliation. The former `20260801120000` file differed only by the
corresponding Unicode ellipsis encoding; after that encoding normalization its
SQL is identical to the recovered remote source. The production function bodies
and constraints were separately inspected and do not contain that marker.

This is a historical-source anomaly, not a reason to reconstruct SQL from a
different local file. Any future fresh-install repair must be handled as a
separate, explicitly reviewed foundation task.

## Catalog repair audit

| Object / effect | Expected | Production | Match | Evidence |
| --- | --- | --- | --- | --- |
| `private.ecommerce_source_revision_decision` | Legacy epoch-millisecond same-order hash change returns `apply`; normal version returns `conflict`. | `apply` and `conflict`, respectively. | Yes | Read-only function calls. |
| Function hardening | `SECURITY DEFINER`, empty fixed search path, explanatory comment. | Present with both protections and the comment. | Yes | `pg_proc` and object comment inspection. |
| Source-image repair | Every eligible inherited HTTP(S) image projection matches POS. | 4 eligible rows; 2 mismatched rows. | **No** | Aggregate-only production query; no customer values recorded. |

The historical application report alone is insufficient while a migration effect
is currently divergent. CLI 2.51.0 help confirms the eventual syntax would be
`supabase migration repair 20260801043000 --status applied`, but that command
was deliberately not run.

## OSS bootstrap audit

The bootstrap migration is explicitly documented in:

- `docs/SELF-HOSTING.md`
- `docs/SELF-HOSTING-VALIDATION.md`
- `docs/OSS-1.5.5-RUNTIME-VALIDATION.md`

It establishes the contract consumed by the June 24 AI usage migration. The
repository does not currently claim a validated fresh install, but this makes
relocating the file more dangerous, not safer: it is required in timestamp order
for a future baseline reconstruction. No references authorize moving it to a
separate bootstrap directory today.

## Pending business-profile realtime migration

Static and read-only audit results:

- The migration changes no table RLS policy and creates no public table.
- Its new direct trigger function is private, `SECURITY DEFINER`, uses
  `search_path = ''`, and revokes execution from `PUBLIC`, `anon`, and
  `authenticated`.
- The existing public unlimited RPC currently has no public, anon, or
  authenticated execute privilege; `CREATE OR REPLACE` preserves that
  permission model.
- The broadcaster continues to target only active devices and delegates feature
  gating to `private.license_realtime_enabled`, covering FREE/PRO behavior.
- The trigger is idempotently replaced with `DROP TRIGGER IF EXISTS`; its
  payload is limited to profile identifiers, revision, timestamp, and business
  type.

`supabase/tests/business_profile_rubro_realtime_sync_test.sql` exists and uses
`BEGIN/ROLLBACK`, but was not run against production because this task does not
modify customer data. It also was not run locally because no local Supabase
database is started.

## Final modeled ledger

After the file-only reconciliation:

- Local migrations: 217
- Remote migrations: 214
- Aligned: 214
- Remote-only: 0
- Local-only classifications:
  - `20260621000000`: `BOOTSTRAP_ONLY`
  - `20260801043000`: `UNRESOLVED`
  - `20260806061500`: `LEGITIMATELY_PENDING`

`supabase migration list --linked --output json` was attempted but is blocked
in this clean worktree because it has no local project ref
(`Cannot find project ref. Have you run supabase link?`). No project link,
`db push --dry-run`, or production deployment was attempted. The Supabase
production snapshot above independently verifies that remote-only is zero in
the reconciled file model.

## Production changes

None.

No `db push`, `--include-all`, manual schema-migrations DML, migration
repair, Apparel migration, Product Form V2 change, PR #184 change, or customer
data operation was performed.

## Next step

Keep this change as a draft-only reconciliation PR. Resolve the two catalog
projection mismatches (or obtain evidence that they are later legitimate source
changes) before considering ledger repair. After this PR is reviewed and merged,
link a clean checkout to production, re-run `migration list` and
`db push --dry-run`, and apply only the expected
`20260806061500_business_profile_rubro_realtime_sync` migration.
