# ADMIN.STAFF.SECTION.ISOLATION.R1

## 1. Base SHA

`9ba15a7f61cd10f307621277deb9f60fc7dfc6bf`

The branch was created from, and rechecked against, the then-current `origin/main`. A final fetch before committing confirmed that `origin/main`, `HEAD`, and the merge base were still this SHA.

## 2. Branch

`codex/admin-staff-section-isolation-r1`

Required delivery state: one Draft PR, no merge.

## 3. Final candidate SHA

`1b7ac24e84d7b89e506674db57f9039188f9605a`

This is the implementation candidate containing all application, test, script, and migration changes. The subsequent PR head commit adds this permanent report only.

## 4. Exact files changed

The implementation candidate changes 82 files. The PR changes the following 83 files after adding this report:

```text
docs/reports/ADMIN.STAFF.SECTION.ISOLATION.R1.md
scripts/check-admin-staff-profile-actor-authorization-r1.mjs
scripts/check-sales-refunds-actor-authorization-r1.mjs
src/App.jsx
src/__tests__/App.backupPro.test.jsx
src/components/common/AssistantBot.jsx
src/components/common/DeviceManager.jsx
src/components/common/InputPromptModal.jsx
src/components/common/SalesReportsRoute.jsx
src/components/common/SettingsRoute.jsx
src/components/common/__tests__/InputPromptModal.actorIsolation.test.jsx
src/components/common/__tests__/SalesReportsRoute.test.jsx
src/components/common/__tests__/SettingsRoute.test.jsx
src/components/customers/LayawayModal.jsx
src/components/dashboard/RecycleBin.jsx
src/components/dashboard/SaleCancellationModal.jsx
src/components/dashboard/SalesHistory.jsx
src/components/dashboard/__tests__/SalesHistory.ecommerceReference.test.jsx
src/components/layout/Layout.jsx
src/components/layout/Navbar.jsx
src/components/layout/__tests__/Layout.reportAuthorization.test.jsx
src/components/layout/__tests__/Navbar.backupPro.test.jsx
src/components/layout/__tests__/Navbar.test.jsx
src/components/pos/OrderSummary.jsx
src/components/pos/TablesView.jsx
src/components/products/DataTransferModal.jsx
src/components/products/__tests__/DataTransferModal.access.test.jsx
src/components/settings/BackupSettings.jsx
src/components/settings/DevicesSettings.jsx
src/components/settings/LicenseSettings.jsx
src/components/settings/MaintenanceSettings.jsx
src/components/settings/__tests__/BackupSettings.backupPro.test.jsx
src/components/settings/__tests__/DevicesSettings.access.test.jsx
src/components/settings/__tests__/LicenseSettings.access.test.jsx
src/components/settings/__tests__/MaintenanceSettings.access.test.jsx
src/hooks/pos/useActiveOrders.js
src/hooks/pos/useTableManagement.js
src/pages/CustomersPage.jsx
src/pages/DashboardPage.jsx
src/pages/SettingsPage.jsx
src/pages/__tests__/SettingsPage.backupPro.test.jsx
src/pages/__tests__/SettingsPage.isolation.test.jsx
src/pages/__tests__/settingsPageAccess.test.js
src/pages/settingsPageAccess.js
src/services/__test__/sales/cancelSaleCore.test.js
src/services/__test__/sales/restoreDeletedSaleCore.test.js
src/services/__tests__/layawayFinancialService.test.js
src/services/__tests__/salesRefundAuthorization.test.js
src/services/__tests__/supabase.businessProfileActor.test.js
src/services/auth/__tests__/actorRuntimeController.test.js
src/services/auth/__tests__/actorSessionRuntimeBridge.test.js
src/services/auth/__tests__/salesPermissionPolicy.test.js
src/services/auth/__tests__/settingsAccessPolicy.test.js
src/services/auth/__tests__/useActorRuntimeSnapshot.test.jsx
src/services/auth/__tests__/useSettingsAccess.test.jsx
src/services/auth/actorRuntimeController.js
src/services/auth/actorSessionRuntimeBridge.js
src/services/auth/refundsActorAuthorization.js
src/services/auth/salesPermissionPolicy.js
src/services/auth/settingsAccessPolicy.js
src/services/auth/useActorRuntimeSnapshot.js
src/services/auth/useSettingsAccess.js
src/services/db/__tests__/layawaysCashConsistency.test.js
src/services/db/layaways.js
src/services/layawayFinancialService.js
src/services/sales/cancelSaleCore.js
src/services/sales/inventoryFlow.js
src/services/sales/restoreDeletedSaleCore.js
src/services/salesCloud/salesCloudCancellationService.js
src/services/salesService.js
src/services/supabase.js
src/store/__tests__/useMessageStore.actorIsolation.test.js
src/store/slices/createProfileSlice.js
src/store/slices/createProfileSlice.profileSync.test.js
src/store/slices/license/licenseActivationActions.js
src/store/slices/license/licenseActivationActions.test.js
src/store/useMessageStore.js
src/store/useRecycleBinStore.js
src/store/useSalesStore.js
supabase/migrations/20260824165820_admin_staff_profile_actor_authorization_r1.sql
supabase/migrations/20260824165839_sales_refunds_actor_authorization_r1.sql
supabase/tests/admin_staff_profile_actor_authorization_r1_test.sql
supabase/tests/sales_refunds_actor_authorization_r1_test.sql
```

## 5. Authorization matrix before

| Surface | Admin | Staff authority before | Defect |
| --- | --- | --- | --- |
| `/configuracion` | Allowed | `settings OR products` at the route | `products` incorrectly opened Settings. |
| Settings navigation | Allowed | Shown only for `settings` | Staff with `license`, `devices`, `sync`, or `inventory` could not discover an otherwise intended area. |
| Settings initial tab | General | Fell back to General when no tab was authorized | A transient/zero-permission render mounted privileged General content. |
| General / controls | Allowed | Page-level access, not consistently action-level | No single actor-aware policy governed route, tabs, and actions. |
| License / Devices | Allowed | Coupled presentation; device management effectively Admin-only | `devices` had no safe Staff sub-area; `license` and `devices` were conflated. |
| Maintenance / Backup | Allowed | Coarse tab access | `sync` and `inventory` actions were mixed. Sales export did not require `reports`. |
| Business-profile save | Device credentials | Device credentials | Four-argument public RPC had no current-actor proof. |
| Sales reports | Allowed | `reports` route | Nested cancellation, recycle-bin, and layaway mutations remained reachable. |
| Cancellation/refund | Allowed | Not consistently tied to `refunds` | UI and direct service/repository paths could mutate without canonical refund authority. |
| Products | Existing behavior | Existing `products` behavior | Products also accidentally granted Settings shell access. |

## 6. Authorization matrix after

| Surface/action | Admin | Staff required permission | Additional invariants |
| --- | --- | --- | --- |
| Settings shell | Yes | Any of `settings`, `license`, `devices`, `sync`, `inventory` | Runtime must be `granted` and match the explicit app-store actor identity. |
| General / controls / profile UI | Yes | `settings` | No `products` implication. |
| License | Yes | `license` | Staff/license view is bounded; Admin-only account/device administration stays Admin-only. |
| Devices | Yes | `devices` | Staff receives a safe current-device/session view; the Admin roster RPC remains Admin-only. |
| Maintenance sync routines | Yes | `sync` | Each action captures and revalidates the actor. |
| Inventory maintenance / CSV | Yes | `inventory` | Product behavior is unchanged; only Settings maintenance authority changed. |
| Sales/pharmacy export in Settings | Yes | `sync AND reports` | The actor is checked before and after reading sales. |
| Backup | Yes | `sync` | Restore/upload callbacks are fenced across confirmation and async boundaries. |
| Business-profile mutation | Yes | `settings` | Canonical Admin/Staff session, license, device, expiry, revocation, and permission validation occurs in the database. |
| Sales read route | Yes | `reports` | `refunds` alone does not grant reports. |
| Cancel/refund/restore sale or layaway | Yes | `refunds` | Existing POS, ownership/global override, financial, cash, stock, state, and idempotency checks remain in force. |
| Products | Existing behavior | Existing `products` behavior | No granular product RBAC was added. |

## 7. Confirmed P0 root causes

1. `PermissionRoute` treated the Settings permission array as OR, and `/configuracion` supplied `['settings', 'products']`.
2. `resolveInitialSettingsTab` returned `general` for an empty permission set, while `SettingsPage` corrected the tab only after a render effect.
3. Store `canAccess` and actor runtime used different permission representations. Real Staff permissions arrive as a JSON object, while actor runtime previously normalized arrays only.
4. `save_business_profile_secure(text,text,text,jsonb)` authenticated only license/device credentials and delegated to the unlimited writer.
5. First-time free-trial setup created device authority but no Admin actor session; an actor-aware profile RPC therefore required a real owner enrollment flow.
6. Reports pages rendered cancellation and recycle-bin actions without a canonical `refunds` policy. Direct service, store, local core, layaway, and cloud paths also lacked a uniform fail-closed boundary.
7. Actor changes could leave modals, assistant/report data, message callbacks, and pending async actions alive long enough to publish stale privileged UI or local-cache writes.

## 8. Settings shell policy

`settingsAccessPolicy` is the single pure policy used by `SettingsRoute`, Navbar, `SettingsPage`, sub-area components, and action guards. It fails closed unless actor runtime is `granted` and the runtime actor/session agrees with the explicit Admin or Staff identity in the application store.

The shell is available to Admin or Staff with at least one of `settings`, `license`, `devices`, `sync`, or `inventory`. `products` is deliberately absent. A zero-tab result is `null` and renders `NoPermission`; General is never a fallback for an unauthorized or transient actor.

## 9. Settings sub-area mapping

| Sub-area | Permission |
| --- | --- |
| General and business controls | `settings` |
| License | `license` |
| Devices | `devices` |
| Maintenance: archive/rebuild/sync routines | `sync` |
| Maintenance: stock repair/inventory export | `inventory` |
| Maintenance: sales/pharmacy export | `sync` and `reports` |
| Backup/restore/Drive upload | `sync` |

Tabs are resolved synchronously from the current actor snapshot. Direct component rendering is also guarded, so hiding a tab is not the authorization boundary.

## 10. Business-profile actor authority

The frontend captures an immutable `settings` actor handle before logo/profile async work, asserts it before the RPC, and reasserts before publishing local cache/state. `saveBusinessProfile` rejects missing, mismatched, or ambiguous Admin/Staff credentials and sends the unique five-argument RPC signature.

The backend uses the existing canonical `private.validate_pos_sync_context(text,text,text,text)` and `private.has_pos_permission(jsonb,text)` authority. It binds actor session to the same active license and device and validates actor status, expiry, revocation, and `settings`. Device-only and historical four-argument calls fail closed.

Free plans no longer receive a device-only profile exception. The activation flow routes first-time free setup through real owner enrollment, and the existing Admin enrollment/login functions now accept active free plans while retaining device-token, password, device-mode, limit, and session protections.

## 11. Supabase migrations

Applied forward-only migrations:

- `20260824165820_admin_staff_profile_actor_authorization_r1.sql`
- `20260824165839_sales_refunds_actor_authorization_r1.sql`

Neither migration drops or rewrites tenant business data. Historical migrations were not edited. The profile migration contains no business-profile row DML. Both migrations include prerequisite and postcondition checks and reload the PostgREST schema cache.

## 12. RPC and ACL before/after

### Business profile

Before:

- Public client contract: `save_business_profile_secure(text,text,text,jsonb)`.
- `anon`, `authenticated`, and `service_role` had EXECUTE; `PUBLIC` was revoked.
- `save_business_profile_secure_unlimited(text,text,text,jsonb)` was service-role-only.
- The public wrapper preserved the SEC.2 `PROFILE` rate bucket but did not validate an actor.

After:

- Public client contract: `save_business_profile_secure(text,text,text,text,jsonb)`.
- It keeps the exact `PROFILE` 30/600/600 device-scoped rate wrapper and adds canonical actor validation plus `settings`.
- The old four-argument function is renamed `_legacy` and revoked from `PUBLIC`, `anon`, `authenticated`, and `service_role`.
- The unlimited persistence body remains service-role-only.
- All Security Definer functions introduced/replaced here use `search_path = ''`.

### Sales cancellation

Before:

- SEC.2 public preview/execute wrappers retained their intentional client ACLs and rate limits.
- Their internal service-role bodies enforced the existing POS/cancellation rules but did not make `refunds` mandatory.

After:

- Public wrapper signatures, rate limiting, and intentional `anon`/`authenticated`/`service_role` ACLs are preserved.
- New service-role-only internal bodies validate the canonical actor and require `refunds`, then delegate to the renamed legacy engine.
- Renamed legacy preview/execute bodies are revoked from all client roles and `service_role`, closing direct bypass.
- Existing ownership is preserved: a Staff actor may cancel their own sale; the existing explicit `sales_cancellations_global` authority is still required for another Staff actor's sale.

## 13. Sales reports/refunds policy

`reports` is read authority. `refunds` is mutation authority. Neither implies the other.

The reports route, Navbar, Layout data loading, Dashboard history, and AssistantBot report context require a current `reports` actor. Cancellation buttons/modals, open-sale annul paths, recycle-bin sale restore/permanent-delete/empty operations, and layaway cancellation/refund require a current `refunds` actor.

The same rule is enforced below presentation in `salesService`, `useSalesStore`, `useRecycleBinStore`, cloud cancellation service, local cancel/restore cores, layaway financial service, and layaway repository boundaries. Missing assertions fail closed. Actor handles are revalidated before and after async work and immediately before mutation/publication.

## 14. Products policy explicitly preserved

No product create/edit/delete, price, stock-entry, batch/lot, category, or product repository permission contract was changed. Product regression coverage exercised both product forms, repository events, local preparation, atomic product updates, batch payloads, and initial stock behavior.

The only product-adjacent change is Settings `DataTransferModal`: inventory CSV requires `inventory`, while sales/pharmacy export requires both `sync` and `reports`. `/configuracion` is no longer granted by `products=true`.

## 15. Actor-switch tests

Automated tests cover:

- Admin to Staff: the replacement actor immediately loses Admin-only Settings/report/refund UI and stale actions reject.
- Staff to Admin: authorized tabs/actions appear from the new granted runtime, with no reuse of Staff callbacks.
- Staff A to Staff B: generation/session changes invalidate captured handles even in the same tenant and same IndexedDB.
- Permission removal and runtime lock: route, Navbar, tabs, assistant/report loaders, modals, prompts, cache publication, and mutation callbacks fail closed.
- JSON-object Staff permissions: true-valued permission keys normalize correctly; false-valued keys do not grant authority.

## 16. Stale UI/cache findings

The actor runtime bridge now normalizes the real Staff JSON permission object and exposes a primitive snapshot suitable for React subscriptions. Runtime lock wins over a lagging store role.

Settings and sales routes use actor-aware boundaries. Privileged page trees and assistant/report consumers are remounted or denied on actor generation changes. Message and input-prompt callbacks close/remove on actor handoff. Profile/logo saves, backup/restore, maintenance exports, cancellation previews/execution, recycle-bin work, and layaway refunds capture immutable handles and assert current authority across awaits.

Tenant IndexedDB remains shared by design. This phase isolates authority and stale publication rather than duplicating tenant data per actor.

## 17. Direct URL tests

Tests cover direct entry to `/configuracion` for Admin, each allowed Staff shell permission, products-only Staff, no-permission Staff, missing identity, runtime lock, and actor handoff. They also cover zero authorized tabs and direct rendering of protected sub-area components.

`/ventas` uses `SalesReportsRoute`, with tests proving reports-only allow, refunds-only deny, no-actor deny, actor handoff deny, and browser Back/Forward denial after authority loss. Navbar visibility follows the same policies.

## 18. Production verification

Preconditions completed before apply:

- Migration review complete.
- Focused repository tests, builds, lint, static contracts, and whitespace checks green.
- Remote/local ledger aligned through `20260824101231`.
- `supabase db push --linked --dry-run --yes` listed exactly the two R1 migrations.
- Pre-migration catalog/ACL and read-only business-profile diagnostics captured.
- A combined production transaction applied both migrations and the SQL harnesses, then rolled back successfully before the real deployment.

Production apply and verification:

- `supabase db push --linked --yes` applied only `20260824165820` and `20260824165839`.
- Remote migration ledger reports both exact versions/names.
- Catalog checks confirm unique five-argument profile RPC, retired/revoked four-argument RPC, service-only unlimited/inner bodies, intentional public-wrapper ACLs, empty `search_path`, and `settings`/`refunds` gates.
- Post-apply profile and sales SQL harnesses passed inside rollback-safe transactions.
- Admin allow, Staff allow, reports-only deny, missing/revoked/expired/inactive/cross-license/cross-device actor deny, ownership deny/override, free-owner enrollment/login, rate wrapper, and real cancellation rollback behavior were exercised.
- Verification residue: 0 R1 fixture licenses, 0 fixture profiles, and 0 fixture sales.
- Existing business-profile row count remained 6; the migration contains no profile-row DML.
- Security advisors decreased from 368 to 366 findings; performance advisors remained 137. No new phase-related advisor appeared. The generic Security Definer warnings for the three intentional public RPC wrappers remain expected because those wrappers implement device/actor validation and rate limiting. References: [anon executable Security Definer lint](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [authenticated executable Security Definer lint](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

`PRODUCTION_APPLIED = YES` and `PRODUCTION_VERIFIED = YES`.

## 19. CI/workflows

No workflow file was changed. Validation executed locally against the exact candidate:

- `git diff --check`: PASS.
- Changed-file ESLint across 76 JS/JSX files: PASS, 0 errors and 7 non-blocking warnings.
- `npm run build`: PASS, 3,475 modules.
- `npm run build:store`: PASS, 1,828 modules.
- Profile static contract script: PASS.
- Sales/refunds static contract script: PASS.
- React Doctor final pass: exit 0, 0 errors, 20 warnings. The reported loading resets were inspected and are inside `finally`; remaining items are maintainability/performance suggestions or deliberate security sequencing.
- Focused Vitest runs passed across Settings routes/pages/actions, Navbar/Layout, actor runtime/storage/session transitions, profile mutation/onboarding, sales/refunds UI/services/cores, layaway/recycle-bin, and direct URL/Back-Forward behavior.
- Production SQL transaction and post-apply rollback-safe harnesses: PASS.

## 20. Differential regression result

`NEW REGRESSIONS = 0`.

The repository has a pre-existing `useActiveOrders` expectation mismatch (variant price 25 versus non-variant price 20); the exact test fails identically on base and candidate. It is not caused by this phase.

The products group initially produced one timing-sensitive `ProductFormV2` status assertion after 61 passing assertions. The exact case then passed in isolation on both base and candidate. No product implementation file was changed by this phase, and the remaining product regression suite passed.

The `.oss-release` and temporary worktree trees were excluded from canonical focused runs because repository-wide discovery otherwise duplicates tests. The temporary base worktree was removed after differential verification.

## 21. Deferred granular permission work

Deliberately not implemented:

- Product create versus edit versus delete.
- Product prices.
- Inventory quantity adjustment.
- Batch/lot granular access.
- Categories.
- Customer create/edit/delete granular access.
- Report subsections.
- Individual Settings fields.
- Per-action permission expansion beyond the confirmed `refunds` decision.
- A generalized RBAC framework.

Historical cancellation compatibility keys remain only as narrowing checks inside the preserved legacy engine; they cannot grant cancellation without mandatory `refunds`. Any replacement of those compatibility keys belongs to a later, explicit permission-migration phase.

## 22. Final verdict

All required isolation conditions pass:

- Settings direct URL bypass closed.
- Zero-tab General fallback closed.
- Business-profile backend is actor-aware.
- Staff `settings` is enforced server-side.
- `license`, `devices`, `sync`, and `inventory` direct sub-area access follows the specified matrix.
- `reports` does not imply cancellation.
- `refunds` controls cancellation/refund mutations.
- Products behavior is preserved.
- Admin/Staff and Staff/Staff handoff isolation is validated.
- No new differential regression was introduced.
- The production contract is applied and verified.

`ADMIN.STAFF.SECTION.ISOLATION.R1: PASS`

No merge was performed. The PR must remain Draft. No granular RBAC phase was started.
