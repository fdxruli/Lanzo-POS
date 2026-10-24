| ID | Assertion | Result |
| --- | --- | --- |
| BGX-01 | BGX-01 PROF-01 no cache: raw RPC, both local writes and publication settle | PASSED |
| BGX-02 | BGX-02 PROF-02 fresh memory cache avoids remote work | PASSED |
| BGX-03 | BGX-03 PROF-03 slow raw RPC keeps root and transport pending | PASSED |
| BGX-04 | BGX-04 PROF-04 quiesce before transport admission starts no RPC | PASSED |
| BGX-05 | BGX-05 PROF-05 public profile timeout leaves transport pending without late publication | PASSED |
| BGX-06 | BGX-06 PROF-06 tenant change rejects old remote response before writes | PASSED |
| BGX-07 | BGX-07 PROF-07 actor change rejects old remote response before writes | PASSED |
| BGX-08 | BGX-08 PROF-08 logout rejects old remote response before writes | PASSED |
| BGX-09 | BGX-09 PROF-09 new profile wins over previous request | PASSED |
| BGX-10 | BGX-10 PROF-10 asynchronous preference substitute is observed and remains UNKNOWN | PASSED |
| BGX-11 | BGX-11 PROF-11 asynchronous refresh rejection is observed | PASSED |
| BGX-12 | BGX-12 PROF-12 invalidated request never invokes onPrepared | PASSED |
| BGX-13 | BGX-13 PROF-13 offline Admin profile uses tenant cache without extending authorization | PASSED |
| BGX-14 | BGX-14 PROF-14 profile observation cannot authorize a locked Staff | PASSED |
| BGX-15 | BGX-15 PROF-15 final local cache continuation is part of drain | PASSED |
| BGX-16 | BGX-16 Drive refresh is synchronous and issues no network request | PASSED |
| BGX-17 | BGX-17 Drive local token rehydrates only through existing cache permission | PASSED |
| BGX-18 | BGX-18 locking Drive hides token without deleting credentials | PASSED |
| BGX-19 | BGX-19 expired Drive session retains existing reauth behavior | PASSED |
| BGX-20 | BGX-20 malformed Drive session is safely cleared as before | PASSED |
| BGX-21 | BGX-21 async Drive replacement keeps UNKNOWN until its own contract exists | PASSED |
| BGX-22 | BGX-22 pending profile cannot refresh Drive after tenant switch at local guard | PASSED |
| BGX-23 | BGX-23 UI preference refresh is synchronous tenant-local policy read | PASSED |
| BGX-24 | BGX-24 permission-denied preference refresh falls back to manual | PASSED |
| BGX-25 | BGX-25 profile and Drive refresh never auto-backup or mutate remote credentials | PASSED |
| BGX-26 | BGX-26 SHARED-01 owner and consumer join one raw lifetime | PASSED |
| BGX-27 | BGX-27 SHARED-02 two consumers share owner without additional transport | PASSED |
| BGX-28 | BGX-28 SHARED-03 public owner timeout does not settle either lifetime | PASSED |
| BGX-29 | BGX-29 SHARED-04 consumer quiesce never cancels shared transport | PASSED |
| BGX-30 | BGX-30 SHARED-05 public deadline plus raw reject records late failure in both consumers | PASSED |
| BGX-31 | BGX-31 SHARED-06 logout blocks shared old continuations | PASSED |
| BGX-32 | BGX-32 SHARED-07 tenant switch blocks shared old continuations | PASSED |
| BGX-33 | BGX-33 SHARED-08 late shared rejection has no unhandled promise | PASSED |
| BGX-34 | BGX-34 SHARED-09 new actor cannot reuse old actor validation | PASSED |
| BGX-35 | BGX-35 SHARED-10 originally unobserved owner remains conservatively UNKNOWN | PASSED |
| BGX-36 | BGX-36 processing settlement retains delegated sync UNKNOWN | PASSED |
| BGX-37 | BGX-37 processing waits for profile public result but cannot infer child raw settlement | PASSED |
| BGX-38 | BGX-38 context invalidated during profile never starts subsequent sync refresh | PASSED |
| BGX-39 | BGX-39 context invalidated during persistence never publishes result | PASSED |
| BGX-40 | BGX-40 stale processing before admission has no effects | PASSED |
| BGX-41 | BGX-41 processing persistence errors remain failures without sync side effects | PASSED |
| BGX-42 | BGX-42 pending sync refresh remains pending processing without confirmation | PASSED |
| BGX-43 | BGX-43 processing can settle while a subscriber child is still running | PASSED |
| BGX-44 | BGX-44 asynchronous store-triggered work is a reproducible unknown counterexample | PASSED |
| BGX-45 | BGX-45 processing UNKNOWN prevents a false SYNC_QUIESCED drain | PASSED |
| BGX-46 | BGX-46 joining an owned promise registers synchronously | PASSED |
| BGX-47 | BGX-47 quiesced consumer cannot join or start more work | PASSED |
| BGX-48 | BGX-48 context invalidation before profile factory blocks all providers | PASSED |
| BGX-49 | BGX-49 two stores do not invalidate each others profile generation | PASSED |
| BGX-50 | BGX-50 license cleared without actor update still rejects old profile | PASSED |
| BGX-51 | BGX-51 timeout before validation transport suppresses later RPC and observes deadline rejection | PASSED |
| BGX-52 | BGX-52 raw profile rejection after timeout remains observed | PASSED |
| BGX-53 | BGX-53 unknown profile substitute cannot claim complete drain | PASSED |
| BGX-54 | BGX-54 scope invalidation after raw result blocks profile publication | PASSED |
| BGX-55 | BGX-55 successful profile RPC clears its public deadline timer | PASSED |
| BGX-56 | BGX-56 default non-observed profile still publishes usable profile | PASSED |
| BGX-57 | BGX-57 default non-observed revalidation preserves server denial result | PASSED |
| BGX-58 | BGX-58 no license cannot acquire authority through lifecycle | PASSED |
| BGX-59 | BGX-59 no ready tenant skips background profile and all refresh providers | PASSED |
| BGX-60 | BGX-60 observer and default queries keep identical public profile values | PASSED |
| EXTRA-01 context captured at invocation blocks actor replacement before factory | EXTRA-01 context captured at invocation blocks actor replacement before factory | PASSED |
| EXTRA-02 asynchronous onPrepared callback stays observed and UNKNOWN | EXTRA-02 asynchronous onPrepared callback stays observed and UNKNOWN | PASSED |
| EXTRA-TOKEN-actor credential recovery rechecks context before persisting | EXTRA-TOKEN-actor credential recovery rechecks context before persisting | PASSED |
| EXTRA-TOKEN-tenant credential recovery rechecks context before persisting | EXTRA-TOKEN-tenant credential recovery rechecks context before persisting | PASSED |
| EXTRA-TOKEN-valid credential recovery preserves legitimate persistence | EXTRA-TOKEN-valid credential recovery preserves legitimate persistence | PASSED |
| EXTRA-LATE-refreshTenantUiPreferences synchronous quiesce retains unknown continuation and rejection | EXTRA-LATE-refreshTenantUiPreferences synchronous quiesce retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-refreshTenantUiPreferences synchronous invalidate retains unknown continuation and rejection | EXTRA-LATE-refreshTenantUiPreferences synchronous invalidate retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-refreshDriveSession synchronous quiesce retains unknown continuation and rejection | EXTRA-LATE-refreshDriveSession synchronous quiesce retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-refreshDriveSession synchronous invalidate retains unknown continuation and rejection | EXTRA-LATE-refreshDriveSession synchronous invalidate retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-onPrepared synchronous quiesce retains unknown continuation and rejection | EXTRA-LATE-onPrepared synchronous quiesce retains unknown continuation and rejection | PASSED |
| EXTRA-LATE-onPrepared synchronous invalidate retains unknown continuation and rejection | EXTRA-LATE-onPrepared synchronous invalidate retains unknown continuation and rejection | PASSED |
