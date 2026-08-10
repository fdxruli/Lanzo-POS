# Supabase migration ledger reconciliation

## Status

`BLOCKED` — the repository and production migration ledgers are linked and
`REMOTE-ONLY = 0`, but
`20260801043000_ecom_catalog_legacy_timestamp_revision_repair` cannot safely be
marked applied. Two of its four eligible inherited-image projections differ from
their POS source, and no later applied migration explains either difference. No
production migration, DDL, customer-data mutation, or ledger repair was
performed.

## Scope and authoritative snapshot

- Repository: `fdxruli/Lanzo-POS`
- Production project: `odlrhijtfyavryeqivaa` (Lanzo)
- Reconciliation branch: `fix/supabase-migration-ledger-reconcile`
- Base: `origin/main` at `b0f555ae0bdcbe9a8d5067ab144e28aa30ab4ae1`
- Snapshot method: read-only production queries through the configured Supabase
  connection. No secrets are recorded here.

## Worktree Link

- Worktree: `C:\dev\Lanzo-POS-ledger-reconcile`
- Branch / initial HEAD: `fix/supabase-migration-ledger-reconcile` /
  `310a8dde2a1381770b2678fa6195802b451c0cd3`
- Linked project ref: `odlrhijtfyavryeqivaa` (Lanzo production)
- CLI: `2.51.0`
- `supabase migration list --linked`: **PASS**

The link created only ignored local metadata. `git status --porcelain` was
clean immediately before the scoped OSS-bootstrap/documentation work below.

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
| `20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql` | No remote ledger row. | The decision function exists, remains `SECURITY DEFINER` with fixed `search_path`, preserves the intended legacy-epoch `apply` result and ordinary-version `conflict` result, and retains its comment. Two of four eligible source-image projections differ from POS, with no later applied migration to supersede the backfill. | `UNEXPLAINED_DIFFERENCE` | Do **not** run `migration repair --status applied 20260801043000`. |
| `oss_bootstrap_license_period_schema.sql` | No remote ledger row; intentionally no longer a production migration file. | It is a compatibility foundation for `license_periods`, `ai_agent_usage.period_id`, and `ensure_current_license_period`, before their first June 24 dependency. | `BOOTSTRAP_ONLY_RESOLVED` | Moved to `supabase/bootstrap/` and injected only into a disposable local OSS overlay by `oss:db:reset-local`; never execute it against production. |
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

## 20260801043000 Temporal Audit

Historical application evidence is strong for the DDL portion: production has
the exact distinctive legacy-epoch decision behavior, `SECURITY DEFINER`, a
fixed empty `search_path`, and the migration comment. The current file is the
blob introduced by `124f38ef`; its function is still present in production, and
the remote ledger contains no later applied statement that redefines it.

The four affected items are eligible data projections selected by the migration
backfill, rather than four independent DDL objects. Tokens and image hashes are
one-way digests so this report records no customer URLs or identifiers.

| Object | `20260801043000` definition | Later applied migrations | Latest expected definition | Current production | Result |
| --- | --- | --- | --- | --- | --- |
| `private.ecommerce_source_revision_decision` | Same-order legacy epoch-millisecond hash change returns `apply`; ordinary version returns `conflict`. | None after `20260801043000`. | Original definition. | Behavior, comment, `SECURITY DEFINER`, and fixed search path match. | `MATCH_ORIGINAL` |
| Projection `0e4c39db…` | Set inherited `ecommerce_published_products.image_url` from POS when eligible. | None. | POS source image. | Published/source image hash `10c8ab141d2f7b3e83f73c0f73d55204`. | `MATCH_ORIGINAL` |
| Projection `3297bdee…` | Same backfill. | None. | POS source hash `6b5988c94d303bf53329d6287951ea01`. | Published hash `7df1074bd6f415369eb335bff3ad1781`. | `UNEXPLAINED_DIFFERENCE` |
| Projection `7f469e31…` | Same backfill. | None. | POS source image. | Published/source image hash `76cc37ede82984a45f52e8da439eb355`. | `MATCH_ORIGINAL` |
| Projection `a8afb4db…` | Same backfill. | None. | POS source hash `796839d776a1d4822b2146eb21a02708`. | Published hash `7df1074bd6f415369eb335bff3ad1781`. | `UNEXPLAINED_DIFFERENCE` |

The two mismatched rows have later operational timestamps, but no later
*applied migration* explains their divergence. Under the repair authorization
rule, ordinary post-apply DML is not a substitute for that missing migration
evidence. The required command syntax was verified with CLI 2.51.0, but
`supabase migration repair 20260801043000 --status applied --linked` was not
run. Consequently no before/after schema capture is applicable and no repair
changed production definitions.

## Bootstrap Resolution

- Old location: `supabase/migrations/20260621000000_oss_bootstrap_license_period_schema.sql`
- New location: `supabase/bootstrap/oss_bootstrap_license_period_schema.sql`
- Content: byte-preserved (SHA-256
  `2606343B8B4576B48FAED859711EDE5DC3D8072D8DBFF675CF99C8DCB77B4FF8`)
- Production execution: **NO**

The file is OSS/fresh-install-only: its first critical consumer is
`20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql`, followed by
the period-index and FREE-license migrations. Standard Supabase CLI has no
second bootstrap stream, so a simple relocation would break `db reset` and
`migration up`.

`scripts/oss/reset-local-with-bootstrap.mjs` resolves that location contract.
It builds a disposable overlay containing the normal migrations plus a temporary
`20260621000000` injection, invokes only `supabase db reset --local`, rejects
`--linked`, remote database URLs, passwords, project refs, and arbitrary
arguments, then removes the overlay. `npm run oss:db:reset-local` is the
explicit fresh-install entry point. Its focused Node test verifies ordering,
byte preservation, cleanup, and remote-flag rejection. The OSS restricted-asset
manifest now includes `supabase/bootstrap/**`.

Direct documentation consumers were updated in this reconciliation report and
the self-hosting records; historical validation results remain historical rather
than being rewritten as a fresh-install pass.

## Pending business-profile realtime migration

Static and read-only audit results:

- The migration adds no table columns, tables, RLS policies, or grants. Its
  additive fields are `updated_at` and millisecond `profile_revision` in the
  existing internal RPC JSON contract.
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

Production confirms this remains pending: the trigger and its private function
are absent; `BUSINESS_PROFILE_UPDATED` is absent from the current broadcaster;
the current backing RPC lacks both additive JSON keys; and
`realtime.send(jsonb,text,text,boolean)` exists as its prerequisite. The
backing `*_unlimited` function remains revoked from `PUBLIC`, `anon`, and
`authenticated`, which is correct because the SEC.2 public wrapper owns client
access and rate limiting.

The frontend calls the public wrapper. PRO devices receive the private broadcast
only when entitled and refresh authoritatively; FREE keeps its polling/start/
online refresh path. No defect was demonstrated, so this migration was not
modified or applied.

`supabase/tests/business_profile_rubro_realtime_sync_test.sql` exists and uses
`BEGIN/ROLLBACK`, but was not run against production because this task does not
modify customer data. It also was not run locally because no local Supabase
database is started.

## Final Ledger

After the explicit OSS-bootstrap relocation:

- Local production migrations: 216
- Remote migrations: 214
- Aligned: 214
- Remote-only: **0**
- Local-only:
  - `20260801043000_ecom_catalog_legacy_timestamp_revision_repair` —
    `UNEXPLAINED_DIFFERENCE` / unresolved
  - `20260806061500_business_profile_rubro_realtime_sync` —
    `LEGITIMATELY_PENDING`

`20260621000000` no longer appears in the production migration sequence. The
linked migration list is operationally **PASS**, but the final ledger is
**BLOCKED** because the first local-only item is not authorized for repair.

## Dry Run

Not run. The task explicitly permits `supabase db push --dry-run --linked` only
after unresolved local-only migrations reach zero. Running it now would not
prove the required single-migration result and must not be used to hide or apply
`20260801043000`. No `--include-all` or non-dry-run `db push` was used.

## Advisor Baseline

Read-only baseline from the linked production project:

- Security Advisor: 351 historical findings — 36 `rls_enabled_no_policy`, 7
  `function_search_path_mutable`, 154
  `anon_security_definer_function_executable`, and 154
  `authenticated_security_definer_function_executable`.
- Performance Advisor: 134 informational findings — 27
  `unindexed_foreign_keys` and 107 `unused_index`.

These are baseline debt only; this reconciliation changed none of them.

## Production changes

None.

No `db push`, `--include-all`, manual schema-migrations DML, migration repair,
Apparel migration, Product Form V2 change, PR #184 change, or customer-data
operation was performed. The OSS overlay runner was validated without invoking
a database reset.

## Validation

- `node --test scripts/oss/reset-local-with-bootstrap.test.mjs`: **PASS**
  (5 tests).
- `node --test scripts/oss/release-boundary.test.mjs
  scripts/oss/reset-local-with-bootstrap.test.mjs`: **PASS** (17 tests).
- `git diff --check` and `git diff --cached --check`: **PASS**.
- Focused frontend compatibility tests could not start because this worktree had
  no `node_modules`; a locked `npm ci --ignore-scripts` timed out while fetching
  packages. No dependency or lockfile change was made.
- SQL migration tests require a disposable local PostgreSQL/Supabase instance;
  they were not run against production.

## Next step

Keep PR #185 open and draft. Obtain exact later-applied-migration evidence for
the two catalog projection mismatches, or otherwise resolve their history,
before considering ledger repair. Once `20260801043000` is reconciled, re-run the
linked migration list and dry run; only then should
`20260806061500_business_profile_rubro_realtime_sync` be the sole deployable
migration from reconciled `main`.
