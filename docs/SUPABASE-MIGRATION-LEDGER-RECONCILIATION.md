# Supabase migration ledger reconciliation

## Prior task status (superseded by baseline reset)

**BLOCKED** — the repository and production migration ledgers are linked and
REMOTE-ONLY = 0, but the data portion of
20260801043000_ecom_catalog_legacy_timestamp_revision_repair cannot safely be
marked applied. Two of four eligible inherited-image projections are currently
NULL instead of their POS source URL. The exact writer and historical
configuration state cannot be proven from retained evidence, so both are
classified F — INSUFFICIENT_EVIDENCE. No production migration, DDL,
customer-data mutation, or ledger repair was performed.

## Baseline Reset Decision

Provenance recovery for
`20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql` is
exhausted. Its historical execution is **UNKNOWN / UNRECOVERABLE**. No assertion
is made about whether it fully executed.

The current production data state is accepted as the forward baseline. This
does not authorize a correction for projections C/D: their historical image
state and configuration cannot be recovered, and changing them would be a data
decision without sufficient evidence. `migration repair` is not used, so the
unresolved historical version is neither recorded as applied nor reverted.

The historical SQL was byte-preserved at
`supabase/archive/unresolved-migrations/20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql`,
outside executable migration discovery. Its canonical Git/LF SHA-256 is
`A95243579B801D83EFCABDA4770EBABD0B155553CC16C853DDA016F22F5C7023`.
The archive README marks it historical/non-executable and forbids ledger repair
or DML re-execution.

| Historical statement | Type | Current production equivalent | Needed for future reproducibility | Included in forward baseline |
| --- | --- | --- | --- | --- |
| `create or replace function private.ecommerce_source_revision_decision(...)` | DDL | Current production function definition, hash `f6e63dd70069f24db34e72d1c16f15f5a68d90f75d1d8f8654101699b1a98762` | Yes | Yes |
| `comment on function private.ecommerce_source_revision_decision(...)` | COMMENT | Current production comment, hash `2e8a2ab8ab2bf6f6c8df3428d0eeab796efe5f6db3d7865a6e2e77090f06791c` | Yes | Yes |
| Function owner and execute privileges | GRANT/REVOKE / ownership | Owner `postgres`; execute only for `postgres` and `service_role` | Yes | Yes |
| `update public.ecommerce_published_products ...` | DML | No authoritative historical equivalent; C/D remain as-is | No | No |

`20260810092512_ecom_catalog_revision_forward_baseline.sql` is a prospective,
schema-only migration created with `supabase migration new`. It reproduces the
current supported function contract (arguments, return type, `IMMUTABLE`,
`SECURITY DEFINER`, empty `search_path`, owner, privileges, behavior and
comment), and intentionally contains no historical image URLs, projection IDs,
backfill, or DML. Applying it to current production is expected to leave the
function definition semantically unchanged; only its future migration-history
row would be new.

Expected ledger after this reset:

- Remote-only: `0`.
- Historical `20260801043000`: archived and permanently outside the production
  ledger.
- Prospectively pending: `20260806061500_business_profile_rubro_realtime_sync`
  and `20260810092512_ecom_catalog_revision_forward_baseline`.

Fresh installations retain the schema object through the prospective baseline.
They do not receive historical production data, because no initial data is
needed for an empty installation and no historical data claim can be made.

## Current Status

- Archive integrity: **PASS** — canonical Git/LF SHA-256
  `A95243579B801D83EFCABDA4770EBABD0B155553CC16C853DDA016F22F5C7023`.
- Forward-baseline static contract test: **PASS** (2 tests).
- OSS bootstrap runner test: **PASS** (5 tests).
- Full OSS bootstrap reset: **BLOCKED** before executing migrations because
  Docker Desktop's Linux engine is unavailable in this environment.
- `supabase migration list --linked`: **PASS** — `REMOTE-ONLY = 0`; local-only
  consists exactly of `20260806061500` and
  `20260810092512_ecom_catalog_revision_forward_baseline`.
- `supabase db push --dry-run --linked`: **PASS** — would apply exactly
  `20260806061500_business_profile_rubro_realtime_sync.sql` followed by
  `20260810092512_ecom_catalog_revision_forward_baseline.sql`.
- `git diff --check`: **PASS**.

**BLOCKED — LOCAL BOOTSTRAP ENVIRONMENT.** The historical file has been archived byte-for-byte and
is no longer executable. The linked ledger has `REMOTE-ONLY = 0`; its only
pending migrations are the already-audited `20260806061500` business-profile
migration and the new forward baseline. `supabase db push --dry-run --linked`
passed and reported exactly those two files. No migration was applied.

Production was queried read-only only. No production DDL, DML, ledger repair,
image change, ecommerce resynchronization, or C/D change was performed.

## Scope and authoritative snapshot

- Repository: `fdxruli/Lanzo-POS`
- Production project: `odlrhijtfyavryeqivaa` (Lanzo)
- Reconciliation branch: `fix/supabase-migration-ledger-reconcile`
- Base: `origin/main` at `b0f555ae0bdcbe9a8d5067ab144e28aa30ab4ae1`
- Snapshot method: read-only production queries through the configured Supabase
  connection. No secrets are recorded here.

## Worktree Link

- Worktree: `C:\dev\Lanzo-POS-ledger-reconcile`
- Branch / audit HEAD: `fix/supabase-migration-ledger-reconcile` /
  `64a64da00b8b779d4a637192198b222a3e25c8cb`
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
| `20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql` | No remote ledger row. | The decision function exists, remains `SECURITY DEFINER` with fixed `search_path`, preserves the intended legacy-epoch `apply` result and ordinary-version `conflict` result, and retains its comment. C and D are currently NULL instead of their POS source URL, but retained evidence cannot prove the historical writer or sync configuration. | `F — INSUFFICIENT_EVIDENCE` | Do **not** run `migration repair --status applied 20260801043000`; ledger repair is not safe. |
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

## 20260801043000 Forensic Projection Analysis

### Decision

**BLOCKED.** The DDL/function projection matches the original migration and two
of four eligible image projections match. The other two are real, exact
differences, but they are classification **F — INSUFFICIENT_EVIDENCE**, not
evidence that this migration's data UPDATE was certainly skipped or later
overwritten. Ledger repair is therefore **NOT SAFE**, and data correction is
**UNDETERMINED**.

All values below are read-only production observations. Projection aliases and
SHA/MD5 digests intentionally replace product identifiers and image URLs.

### Source → eligibility → expected projection → target update

The migration's only data statement is an UPDATE of
public.ecommerce_published_products joined to public.pos_products by license_id
and local_product_ref. Its SOURCE columns are the POS id, license, deleted_at,
and image_url; its target-side eligibility is:

- both source and target are not soft-deleted;
- published sync_config.image is source;
- the POS image URL is HTTP(S); and
- the current published image differs from that source URL.

For every eligible row, the expected projection is the current POS image URL;
the direct UPDATE writes only target image_url and updated_at. It does not
write image_ref, source revision, source payload hash, or sync configuration.
At the time of an actual UPDATE, expected updated_at would be the transaction
now(), which cannot be reconstructed because the migration has no ledger row.

| Projection | Current eligibility evidence | Expected target image | Current target image | Result |
| --- | --- | --- | --- | --- |
| A / 0e4c39db… | source config; POS HTTP(S); both live; current state in_stock | source digest 10c8ab141d2f7b3e83f73c0f73d55204 | same digest | MATCH |
| B / 7f469e31… | source config; POS HTTP(S); both live; current state not_tracked | source digest 76cc37ede82984a45f52e8da439eb355 | same digest | MATCH |
| C / 3297bdee… | source config; POS HTTP(S); both live; current state out_of_stock | source digest 6b5988c94d303bf53329d6287951ea01 | NULL | F — INSUFFICIENT_EVIDENCE |
| D / a8afb4db… | source config; POS HTTP(S); both live; current state not_tracked | source digest 796839d776a1d4822b2146eb21a02708 | NULL | F — INSUFFICIENT_EVIDENCE |

The current source configuration shown above is not historical configuration
evidence. All four target image_ref values are NULL; the migration would not
have changed them.

### Exact timing and retained evidence

The migration file was introduced by Git commit 124f38ef30174581958a6ffad952467858190519,
authored 2026-08-01T04:44:46Z. Its filename timestamp is 20260801043000, but
the time at which its unrecorded data statement may have executed is UNKNOWN.

For C, POS revision V4 was updated at 2026-08-01T04:53:20.524251Z and V5 at
2026-08-01T04:54:55.247275Z; published last_synced_at is
2026-08-01T04:54:59.188133Z, last_sync_attempt_at is
2026-08-01T04:55:35.561229Z, and updated_at is
2026-08-10T02:54:37.545761Z. For D, POS V6 was updated at
2026-08-01T04:53:18.495142Z and V7 at 2026-08-01T04:55:32.465600Z;
published last_synced_at is 2026-08-01T04:55:35.561229Z and both
last_sync_attempt_at and updated_at are 2026-08-10T02:55:02.748939Z.
These timestamps establish later catalog activity, not the ordering or outcome
of an unrecorded migration transaction.

The stored source_payload_hash for C is
af97f465e83e0712b3c063de842fbf1345fb4b448c66966eed5b99846e1d18e7 and for D
is eeb4db8f77df52cf4a89f7ae17a3b3dfabf64bf21fc6011cde7d3b6c89e905fc.
Read-only reconstruction of the base catalog-sync payload exactly matches each
stored hash only when fields.image contains the current POS source URL; it does
not match a NULL-image candidate. This proves a retained catalog payload
remembered the source URL, not that the historical sync configuration was
source or that the migration UPDATE executed after that payload.

### Function, later migrations, writers, and triggers

The production definition of private.ecommerce_source_revision_decision matches
the migration: IMMUTABLE SECURITY DEFINER, fixed empty search_path, the legacy
epoch changed-payload result apply, ordinary changed-version result conflict,
and the migration comment. No later applied migration redefines it.

The only ledger rows after the missing version are
20260802053039_ecom_portal_unified_site_document_v2 and
20260802074419_ecommerce_site_version_deletion. Their authoritative recorded
statements affect portals/site documents and site versions respectively; neither
updates ecommerce_published_products, image_url, or the decision function.

The core writer ecommerce_admin_sync_published_catalog can write image_url only
in its apply branch when the historical configuration is source and the payload
contains image; its conflict and idempotent branches leave image_url unchanged.
The direct admin upsert can explicitly clear image_url when an imageUrl key is
present but NULL or empty. The current metadata.last_admin_source = admin_ui on
C and D is generic context, not a durable audit record of actor, field value,
or time. A frontend normalization edge case is also mechanically plausible but
has no row-specific proof and is not attributed as the cause.

Before triggers run alphabetically. The active sync guard restores the old
image only for source_state unverified or source_missing; it does not restore
the image for C or D's current states. The touch trigger always changes
updated_at, so that value only proves some UPDATE. The recipe and variant
guards do not mutate image_url, and the after catalog-revision trigger records
the update's public signature. None supplies missing historical provenance.

### Exhausted provenance and classification

No schema_migrations row records this version. PostgreSQL commit timestamps are
disabled; the relevant license audit query returned zero rows; platform logs
retain at most 24 hours and cannot reach 2026-08-01; and catalog sync request
records are retained for seven days. Only D's 2026-08-06 onward idempotent
requests remain, and those branches do not write image_url. Git history found
no later migration or catalog writer change that explains C or D.

The retained facts are consistent with at least three distinct histories:

1. the migration data UPDATE ran and a later application or unknown writer left
   image_url NULL;
2. a successful catalog sync occurred while sync_config.image was manual, then
   configuration later changed to source without an image resync; or
3. the migration data UPDATE was not executed or only partially executed.

No retained record distinguishes these histories. C and D are therefore F —
INSUFFICIENT_EVIDENCE. Marking the ledger applied would falsely claim a proven
data backfill, while correcting the NULL images could overwrite valid user or
application intent. Do not repair the ledger and do not correct data. The next
safe task is SUPABASE.MIGRATION.LEDGER.PROVENANCE-RECOVERY.1 to seek retained
deployment, backup, or external audit provenance.

### Superseded preliminary temporal snapshot

The following preliminary table is retained only as historical work notes. It
predates the exact NULL-image and provenance analysis above and must not be
used for classification, repair, or data correction.

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
| Projection `3297bdee…` | Same backfill. | None. | POS source hash `6b5988c94d303bf53329d6287951ea01`. | Published image is NULL. | `F — INSUFFICIENT_EVIDENCE` |
| Projection `7f469e31…` | Same backfill. | None. | POS source image. | Published/source image hash `76cc37ede82984a45f52e8da439eb355`. | `MATCH_ORIGINAL` |
| Projection `a8afb4db…` | Same backfill. | None. | POS source hash `796839d776a1d4822b2146eb21a02708`. | Published image is NULL. | `F — INSUFFICIENT_EVIDENCE` |

The two NULL-image rows have later operational timestamps, but neither a later
*applied migration* nor retained operational provenance explains their history.
Under the repair authorization rule, ordinary post-apply DML is not a substitute
for the missing evidence. The required command syntax was verified with CLI
2.51.0, but `supabase migration repair 20260801043000 --status applied --linked`
was not run. Consequently no before/after schema capture is applicable and no
repair changed production definitions.

## Provenance Recovery

### Scope, safeguards, and result

This is the finite, read-only recovery pass for
20260801043000_ecom_catalog_legacy_timestamp_revision_repair. It searched
external historical sources rather than inferring history from the current C/D
rows. No production RPC, SQL write, migration command, restore, deployment,
re-sync, configuration change, or row correction was performed.

The recovery found direct evidence that the migration file and its surrounding
application code existed, were tested, merged, and deployed. It found no
DIRECT or STRONG_CIRCUMSTANTIAL evidence that either C or D ever stored its
expected image URL, and no evidence identifying a later NULL writer. The
result is therefore PROVENANCE_UNRECOVERABLE.

### Sources searched

| Source | Scope / retention | Evidence and relevance |
| --- | --- | --- |
| Local project copies | Known Lanzo-POS worktrees under C:\dev, project-local tests, reports, Codex-related project evidence, and matching migration/identifier/digest searches. | The target worktree is C:\dev\Lanzo-POS-ledger-reconcile at a0d5bf03fd87aed7238bd48fac464f39cb1f11ef. Other discovered worktrees were preserved. No SQL dump, ZIP, backup, historical payload, or log in the known project evidence paths contained C/D history. A bounded broad C:\dev content sweep exceeded 124 seconds, so this is not claimed as an exhaustive negative for unrelated personal directories; the known Lanzo-POS roots and Git object store were fully covered. |
| Local Git, reachable and unreachable | git reflog --all, git rev-list --all, targeted -S/history searches, git fsck --full --no-reflogs --unreachable, and git fsck --lost-found in disposable C:\dev\Lanzo-POS-ledger-fsck-analysis-20260810. | No object contains a historical C/D URL or image state. The migration source blob is 9c286f17b07e22fb8552ed060239d38ab2369c59. The only matching unreachable blob was b68daf85641f696255f8bc63a2d64ebb10f9e7ed, a 14,183-byte copy of current Temporal Audit documentation, not a historical snapshot. |
| GitHub commits, PRs, runs, logs, and artifacts | PRs/branches/runs from 2026-07-31 through 2026-08-04. Actions artifacts: 57 comparison artifacts retained about 14 days; 26 Pages artifacts expired after about one day; 117 focal artifacts expired after about seven days. | Commit 124f38ef30174581958a6ffad952467858190519 directly proves creation of the source file, not execution. Retained artifacts and workflow logs had no C/D image state, SQL dump, audit, or publication payload. |
| Vercel metadata and logs | Deployment metadata for 2026-08-01 through 2026-08-03 was available. Runtime-log requests for the target window failed before results with 400 Bad Request {"name":"ExceedsBillingLimitError"}. | Deployment/build metadata proves code availability only. The relevant production builds invoked Vite, not a Supabase migration command. The runtime-log error is an access/billing limitation, not a negative-log result. |
| Supabase physical backups | Read-only supabase backups list against odlrhijtfyavryeqivaa. | backups=[], physical_backup_data={}, pitr_enabled=false, walg_enabled=true. No downloadable physical backup and no PITR range are available; 2026-08-01 through 2026-08-03 are not covered. |
| Audit and application logs | The existing catalog request table retains idempotency metadata/hash/response/created_at, not the projection or image_url; its sync RPC deletes records older than seven days. The connected Supabase log surface retains only the last 24 hours. | Target-date records cannot be reconstructed from this source as of the recovery date. The previously inspected license audit returned zero rows. No Vercel drain, Sentry, Datadog, New Relic, Checkly, or OpenTelemetry configuration is committed. |
| Offline test data | Known test roots: supabase/tests, src/__tests__, and docs/reports. | No C/D identifier or expected digest occurred. The PWA/browser audit tooling uses ephemeral profiles, synthetic IndexedDB, loopback networking, and cleanup; no retained production test profile was found or opened. |

### Local and Git object evidence

The following local worktrees were found and left untouched: the active
Product Form worktree at C:\dev\Lanzo-POS-Git, the two builder worktrees, and
the target reconciliation worktree. Their presence is provenance for source
code only; none contained a historical C/D row snapshot.

Migration file creation is DIRECT source evidence:

| Path / object | Timestamp | Hash | Source | Relevance |
| --- | --- | --- | --- | --- |
| supabase/migrations/20260801043000_ecom_catalog_legacy_timestamp_revision_repair.sql | 2026-08-01T04:44:46Z commit author time | commit 124f38ef30174581958a6ffad952467858190519; blob 9c286f17b07e22fb8552ed060239d38ab2369c59 | Reachable Git | Defines the intended backfill and decision function; it does not record production execution or C/D values. |
| unreachable blob b68daf85641f696255f8bc63a2d64ebb10f9e7ed | Date not demonstrable because it is unreachable | 14,183 bytes | git fsck object store and lost-found | Current audit text containing already-known digests; no historical URL, image value, or row snapshot. |

git fsck --full --no-reflogs --unreachable found 11 unreachable commits. Their
trees were searched for the migration identifier, aliases, both projection
identifiers, and both expected digests with no historical C/D result.
git fsck --lost-found was run only in the disposable analysis clone so source
worktrees and their refs stayed untouched; it materialized 21 commits and 50
other objects. Its searches again yielded only blob b68daf... above.

The related reachable code events were 3821c7b (legacy timestamp revision
handling), 816ed091 (source-controlled image backfill), and 124f38ef (target
migration). They are WEAK_CIRCUMSTANTIAL evidence that code capable of the
behavior existed, not evidence of a row write.

### GitHub evidence and artifacts

PR #157 was created from 124f38ef and merged as 5d66c1ffd236a86c78fe331db671b29066d1fc7e
at 2026-08-01T04:52:26Z. Its contemporary description makes an unverified
claim that compatibility was applied in production and that a limited backfill
updated a differently named product. It names neither C nor D, neither
expected digest, and no supporting audit/log; it is WEAK_CIRCUMSTANTIAL only.

The exact PR #157 Actions run 30684560640 completed successfully from
04:45:43Z to 04:51:09Z. Its only job checked out code, ran Node comparison
tests, and uploaded results. Searches of its workflow logs for the migration,
C/D identifiers, expected digests, image_url, Supabase, and migration found no
matches. The subsequent Pages run 30684761097 only built/deployed source; it
listed the SQL file but had no db push, psql, repair, or database operation.

The six retained, related comparison artifacts were downloaded into local
analysis copies and scanned without changing their GitHub originals. They each
contain comparison JSON/Markdown rather than a database dump, SQL snapshot, or
publication payload.

| Artifact | Created / expires UTC | Available | Contents | C/D provenance |
| --- | --- | --- | --- | --- |
| 8812555944, pr127-global-comparison-971b55... | 2026-08-01 03:24:33 / 2026-08-15 03:24:32 | Yes | global-comparison JSON/Markdown and global main/PR JSON | None |
| 8813077340, pr127-global-comparison-96a89f... | 2026-08-01 04:12:00 / 2026-08-15 04:11:59 | Yes | same comparison/report shape | None |
| 8813489578, pr127-global-comparison-124f38... | 2026-08-01 04:51:04 / 2026-08-15 04:51:03 | Yes | global-comparison JSON/Markdown; raw global main/PR JSON | None; official SHA-256 406a6a42948ea963283da95a74ca7acf137567ab737624c6aa91199b47aa0d84 |
| 8813695052, pr127-global-comparison-3b57dd... | 2026-08-01 05:11:32 / 2026-08-15 05:11:31 | Yes | comparison/report JSON and Markdown | None |
| 8827583968, pr127-global-comparison-a4f7a4... | 2026-08-02 03:01:46 / 2026-08-16 03:01:45 | Yes | comparison/report JSON and Markdown | None |
| 8830574473, pr127-global-comparison-854cf9... | 2026-08-02 07:59:12 / 2026-08-16 07:59:12 | Yes | comparison/report JSON and Markdown | None |

Each available artifact was searched for the migration number/name, both
projection identifiers, both expected digests, ecommerce_published_products,
and image_url. There were no matches. The expired Pages/focal artifact groups
cannot be reconstituted from GitHub retention. PRs #158, #163, #164, and #174
were also reviewed; their image/portal/other migration work does not record or
write the two historical C/D image states.

### Vercel and backup availability

| Deployment time (UTC) | Event / source | Commit | C image state | D image state | Confidence |
| --- | --- | --- | --- | --- | --- |
| 2026-08-01T04:13:45.750Z | lanzo-store production deployment, legacy image-migration code | a697da1 | Unknown | Unknown | WEAK_CIRCUMSTANTIAL |
| 2026-08-01T04:40:56Z | lanzo-pos preview, legacy timestamp recovery test | 118a1b3 | Unknown | Unknown | WEAK_CIRCUMSTANTIAL |
| 2026-08-01T04:42:32Z | lanzo-pos preview, source-controlled image backfill | 816ed09 | Unknown | Unknown | WEAK_CIRCUMSTANTIAL |
| 2026-08-01T04:44:57.948Z | lanzo-pos preview of target source | 124f38ef | Unknown | Unknown | DIRECT deployment metadata; not row provenance |
| 2026-08-01T04:52:29Z | lanzo-pos and lanzo-store production deployment; retained build log shows Vite-only build | 5d66c1f, which contains 124f38ef | Unknown | Unknown | WEAK_CIRCUMSTANTIAL for a possible application write |
| 2026-08-01T05:13:41Z | lanzo-pos production public-image sizing | f7bc26d | Unknown | Unknown | WEAK_CIRCUMSTANTIAL |
| 2026-08-02T08:04:45Z / 22:33:52Z | production unified-site publishing / storefront design tokens | bb02da7 / 89aaa6f | Unknown | Unknown | WEAK_CIRCUMSTANTIAL; no catalog writer indicated |
| 2026-08-03 | production security/docs deployments | c40f69e / 0315e20 / 81400b4 | Unknown | Unknown | NONE for image provenance |

The target migration may have executed at an unknown time after its source was
created, but there is no schema_migrations row or retained action log proving
that event. Vercel build metadata proves deployment of frontend code, and its
Vite-only command excludes a Vercel build-time migration command; neither fact
proves what a user/client later wrote.

Backup availability is conclusively NONE for this investigation: there is no
daily physical backup in the returned list, PITR is disabled, and no range
exists to inspect. No paid/destructive backup action was attempted or needed.

### Reconstructed timeline and classification

| Timestamp | Event | Source | Commit | Actor / writer | C image state | D image state | Confidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-08-01T04:44:46Z | Migration file created | Git / PR #157 | 124f38ef | Source commit author | Not recorded | Not recorded | DIRECT for source creation only |
| 2026-08-01T04:45:43Z-04:51:09Z | Comparison CI completed and target artifact created | GitHub Actions 30684560640 / artifact 8813489578 | 124f38ef | CI test workflow | Not recorded | Not recorded | DIRECT negative artifact evidence |
| 2026-08-01T04:52:26Z | PR #157 merged to main | GitHub | 5d66c1f | Merge actor | Not recorded | Not recorded | DIRECT merge evidence only |
| 2026-08-01T04:52:29Z | Main code deployed to Vercel production | Vercel metadata/build log | 5d66c1f | Vercel build; no DB writer identified | Not recorded | Not recorded | WEAK_CIRCUMSTANTIAL |
| 2026-08-01T04:53:18Z-04:55:35Z | POS revisions and catalog sync timestamps observed in the prior read-only snapshot | Production snapshot already recorded above | N/A | Unknown catalog flow | Target state not retained | Target state not retained | WEAK_CIRCUMSTANTIAL |
| Unknown | Possible production execution of the missing-ledger migration | No retained ledger/action record | 124f38ef source only | Unknown | Unknown | Unknown | NONE |
| 2026-08-02 to 2026-08-04 | Later portal/site and unrelated migration work | GitHub/Vercel review | bb02da7, 89aaa6f, later PRs | No C/D writer identified | Not recorded | Not recorded | NONE |
| 2026-08-06 onward | Retained idempotent catalog requests for D do not write image_url | Prior production snapshot / documented request behavior | N/A | Idempotent sync branch | NULL is current-state evidence only | NULL is current-state evidence only | WEAK_CIRCUMSTANTIAL |
| 2026-08-10 | Current production observation | Prior read-only snapshot | N/A | Unknown prior writer | NULL | NULL | DIRECT for current state only |

### Projection conclusions

| Projection | Expected digest | Historical states recovered | Conclusion |
| --- | --- | --- | --- |
| C / 3297bdee... | 6b5988c94d303bf53329d6287951ea01 | None | There is no proof that the expected URL was ever stored and no attributable transition to NULL. |
| D / a8afb4db... | 796839d776a1d4822b2146eb21a02708 | None | There is no proof that the expected URL was ever stored and no attributable transition to NULL. |

DIRECT evidence that C/D previously had the expected URL: NO.
STRONG_CIRCUMSTANTIAL evidence: NO. The remaining evidence is code/deployment
availability or unverified narrative and is WEAK_CIRCUMSTANTIAL at most.

Final classification: PROVENANCE_UNRECOVERABLE.

- Migration execution: not proven, not disproven, and not classified as partial.
- Ledger repair: NOT SAFE.
- Data correction: UNDETERMINED.
- Required next task: SUPABASE.MIGRATION.LEDGER.BASELINE-RESET.1, a separate
  design task to establish a new safe baseline without asserting this missing
  migration was applied or changing C/D automatically.

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

## Prior final ledger (superseded by baseline reset)

After the explicit OSS-bootstrap relocation:

- Local production migrations: 216
- Remote migrations: 214
- Aligned: 214
- Remote-only: **0**
- Local-only:
  - `20260801043000_ecom_catalog_legacy_timestamp_revision_repair` —
    `F — INSUFFICIENT_EVIDENCE` / unresolved; ledger repair not safe
  - `20260806061500_business_profile_rubro_realtime_sync` —
    `LEGITIMATELY_PENDING`

`20260621000000` no longer appears in the production migration sequence. The
linked migration list is operationally **PASS**, but the final ledger is
**BLOCKED** because the first local-only item is not authorized for repair.

## Prior dry run (superseded by baseline reset)

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

## Prior validation (superseded by baseline reset)

- `node --test scripts/oss/reset-local-with-bootstrap.node-test.mjs`: **PASS**
  (5 tests).
- `node --test scripts/oss/release-boundary.test.mjs
  scripts/oss/reset-local-with-bootstrap.node-test.mjs`: **PASS** (17 tests).
- `git diff --check` and `git diff --cached --check`: **PASS**.
- Focused frontend compatibility tests could not start because this worktree had
  no `node_modules`; a locked `npm ci --ignore-scripts` timed out while fetching
  packages. No dependency or lockfile change was made.
- SQL migration tests require a disposable local PostgreSQL/Supabase instance;
  they were not run against production.

## Prior next step (superseded by baseline reset)

Keep PR #185 open and draft. Provenance recovery is complete and classified
PROVENANCE_UNRECOVERABLE; do not repeat the same finite source set without a
new evidence source.

The next task is SUPABASE.MIGRATION.LEDGER.BASELINE-RESET.1. It must design a
new safe baseline without recording 20260801043000 as applied, changing C/D, or
making any production mutation by default. The legitimately pending
20260806061500_business_profile_rubro_realtime_sync remains separate and is
not authorized for application by this recovery result.
