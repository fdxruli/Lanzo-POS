# POS sync client integration — Block 3

Status: client code prepared in Draft PR #593. This document records the client contract; it does not authorize installing either SQL migration or merging the PR.

## Snapshot and delta contract

The client negotiates `snapshot_keyset_reference_v1` before dispatching any new snapshot endpoint. Negotiation must advertise all five families/endpoints. Missing capability keeps the current legacy route; authority errors are propagated and never trigger a less restrictive fallback. Production has not advertised the Block 2 endpoints in the read-only inspection performed for this block.

For a supported contract, the first request sends a null reference and null page cursor. The client retains `snapshot_reference_change_seq` from that response, sends the opaque `next_page_cursor` unchanged, and follows `has_more` until `has_more=false` and `snapshot_complete=true`. The catalog uses one traversal for categories, products, and batches. Customer and credit V2 envelopes are normalized by the existing protocol adapter.

`safe_change_seq` and `snapshot_reference_change_seq` are reference metadata. They are not proof that the client applied the incremental range. Client results expose `snapshotReferenceChangeSeq` separately from the `latestChangeSeq` returned by incremental pulls.

## Durable state and recovery

`durableSnapshotService` stores a license-scoped marker in the existing sync metadata store. The marker binds stream, protocol version, tenant, stable actor/session/device identity, permission set, and data scope. It records the initial reference, opaque page position, number of pages, and state. A page checkpoint is written only after its full local projection has applied successfully. Retrying a page is idempotent; local apply and page checkpoint failures cannot mark the traversal complete.

The states used are `in_progress`, `snapshot_complete`, `recovery_pending`, and `complete`. Finishing all pages moves the marker to `recovery_pending`; it does not finish the load. The existing module delta handler starts at the lesser of the durable cursor and snapshot reference, keeps the durable cursor monotonic, and follows each response’s exact page boundary for the current traversal. It marks recovery `complete` only after all available pages apply, with no `sync_deferred` work and a durable cursor at or beyond the snapshot reference. Deferred reads continue through the #592 per-entity scheduler.

## Consumers

| Data | Snapshot consumer | Delta consumer | Scope/cursor notes |
| --- | --- | --- | --- |
| Catalog | `productMigrationService.pullFullSnapshot` | `pullCatalogChanges` | One reference for categories, products, and batches; existing product read permissions remain in force. |
| Customers | `customerMigrationService.pullFullSnapshot` | `customerSyncHandler.onEvents` | Full directory scope; V2 customer projection envelope. |
| Credit | `customerCreditSyncHandler` | `customerCreditSyncHandler.onEvents` | Full customer ledger reconciliation; V2 credit projection envelope. |
| Sales | `salesCloudSyncHandler` | `salesCloudSyncHandler.onEvents` | Full date range; Admin/report scope or actor/session scope, with separate staff cursor keys. |
| Cash | `cashSyncHandler` | `cashSyncHandler.onEvents` | Admin all-scope or Staff mine-scope; Staff cursor is scoped by actor and session. |

Each module validates its returned projections before checkpointing and applies pages through local repositories that preserve newer server versions and pending local state. Sales rows and their items/payments apply in one Dexie transaction; cash sessions and movements apply in one transaction; catalog applies its entity projections transactionally; customer and credit repositories retain their existing financial and history safeguards.

## Legacy and transition

Legacy snapshots remain callable when the capability is absent, but their results are returned with `consistent: false` and `legacyFallback: true`. An observed legacy snapshot sequence is not stored as an applied cursor. Existing incremental cursors are not rewound. This keeps older Production RPCs usable while avoiding a new cursor advance based on a limited or mutable OFFSET result.

An existing cursor may still contain an older omission that is not detected by `cursor_ahead_of_safe_frontier`. No history reset or reconciliation policy is activated here. Block 4 must define the bounded client transition and recovery scope; 4F must sequence that transition with SQL installation, writer quiescence, and legacy-client handling.

The Block 2 event log must remain available from the retained snapshot reference through delta recovery. If a future server policy prunes events, the client needs an explicit expired-reference response and a safe restart/reconciliation policy before that policy is enabled.

## SQL dependency

The five Block 2 snapshot RPCs are already in `20261124220046_pos_consistent_snapshots_v1.sql`. The additive `20261125001528_pos_snapshot_contract_discovery_v1.sql` updates the existing capability discovery response so the client can safely negotiate and dispatch those endpoints. Both remain migration candidates in Draft; no Production migration was installed.
