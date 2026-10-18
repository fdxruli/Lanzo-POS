# LANZO-POS — ADMIN ACTOR RUNTIME LOGIN RECOVERY R1

## Scope and confirmed cause

Base: `main`, `bca323cddebac97678f6b388d7abbdf7d3cfc730`. Branch: `fix/admin-actor-runtime-login-recovery-r1`.

The deterministic reproduction uses the real Admin action coordinator, bootstrap coordinator, ActorRuntime controller, session bridge and profile slice. Only external I/O and storage/handoff adapters are controlled. Separate existing suites exercise real Dexie, scoped storage and financial handoff behavior.

1. `admin_login_on_device` accepts the identity and persists tenant-scoped credentials.
2. `completeAdminSession` grants ActorRuntime before loading the profile.
3. A failed/timeout profile request without an authorized usable cache makes `_loadProfile` return `null`, preserving `admin_login_required`.
4. The original finalizer ignores the incomplete result, clears the pending session and returns `success: true`.
5. A second click calls `beginAuthentication` while the actor is already `GRANTED`, producing `ACTOR_HANDOFF_REQUIRED`; the original catch then locks the actor.

An additional reproduction confirms that the memory-profile fallback returns a usable profile without publishing `ready`. Another confirms that an old remote login can publish its tenant after the requested license changes if an adapter returns late.

The six initial regression tests run against unmodified base source produced four failures. A separate base run of the second-click test reproduces the handoff error. These are controlled reproductions of code defects, not proof of the exact network request involved in the reported field incident.

Supabase was inspected read-only. The available default 24-hour log window contained 19 matching login events; no incident timestamp, device correlation or request identifier was supplied. No individual server event is attributed to the field incident. A successful HTTP response is never treated as sufficient authority: the existing RPC `success`/`valid` contract still applies. A SELECT against pg_proc confirmed deployed signatures for Admin login, session verification, explicit Free takeover and business-profile lookup. No database mutations or migrations were executed.

## Correction

- Keep the existing Zustand `pendingAdminSessionResult` for incomplete preparation. No competing persistent state machine is introduced.
- Require an explicit profile preparation completion signal before returning `READY` or an authorized `SETUP_REQUIRED`. A silent `null`, stale result or unchanged visual state cannot imply success.
- Publish the memory-profile fallback coherently in foreground loads. Preserve scoped local cache continuity without synthesizing a profile.
- Serialize Admin login, enrollment, explicit Free takeover and preparation retry. A concurrent invocation returns `ADMIN_AUTH_IN_PROGRESS` and makes no second RPC.
- Retry preparation through a dedicated action/button. An already granted recovery must prove the original immutable actor handle, tenant database/generation, stable administrator, canonical device, canonical session, unambiguous token family and current validation/expiry metadata. An online retry verifies the existing session, never registers a second session.
- Preserve the original canonical session/device identifiers in the sanitized Admin result. Locked pre-grant retry requires the original session proof; verification must match it before credential writes. Preserve fresh verified plan/features on PRO/Local transitions.
- Treat explicit valid:false as a denial before storing credentials, including a contradictory success:true response.
- Honor authoritative denial even if connectivity changes while the response arrives. Network fallback requires an existing granted handle, the existing offline Admin contract and the existing offline license policy. A locked pre-grant session requires server revalidation before another grant.
- Capture authentication generations and check asynchronous boundaries. Old login, profile and handoff work cannot grant, publish or lock a newer actor. Cross-tab invalidation remains authoritative.
- Check generation immediately after asynchronous actor-key derivation and before replacing the storage binding; an obsolete preparation cannot clear a newer actor's active storage.
- Reuse the same finalizer after online session restoration and when an authorized offline restoration lacks an operational profile.
- Keep structural storage recovery on the existing database recovery gate. Preserve business data and credentials only under validated recovery contracts.
- Diagnostics use existing Logger phases and safe error codes; no password, token, full license, session identifier, customer or financial data is added to logs.

The Bot worker warning has an independent explanation: its generic message listener sees a PONG before the separate ping listener resolves it, or a timed-out worker response arrives after its pending entry was removed. No evidence connects it to ActorRuntime authority. The debt auto-heal log is likewise not a demonstrated authentication cause. Neither module is modified.

## Security and compatibility

No changes to sales, checkout, cash closing, customer credit, payments, inventory mutation, device limits, takeover consent, SQL, RLS or migrations. No IndexedDB deletion or blanket cache reset. `beginAuthentication` continues to reject a granted actor; recovery never catches HANDOFF_REQUIRED as automatic success. Admin and Staff remain distinct.

Dependency lockfile unchanged: Node 24.18.1, npm 11.16.0; React 19.2.0, Zustand 5.0.8, Supabase JS 2.87.1, Dexie 4.4.3, Vitest 4.0.14, Vite 7.2.2. Existing RPC contracts were inspected alongside the [official Supabase RPC documentation](https://supabase.com/docs/reference/javascript/rpc). The [Supabase changelog](https://supabase.com/changelog) was checked; the announced TLS cipher retirement does not change these application contracts. No new dependency was added.

Open PRs inspected before editing:

| PR | Audited head | Shared files / integration concern |
| --- | --- | --- |
| #338 | `fb17e9a43929d54087ab937cb760a8cd6e087c36` | AdminLoginModal, actor controller/bridge and actor workflow. Preserve its authority-error classifier, lock diagnostics, `completeActorAuthorityRecovery()` and financial barriers when integrating this hotfix. |
| #352 | `d758f69b2119f1bc346eb0ac86ba0a74c0265668` | Based on #338. Direct overlap is workflow coordination; Staff/table authority remains outside this hotfix. |
| #357 | `fbef877583a20f87b69fff293642623ec7ef73b0` | AdminLoginModal and its recovery tests. Reconcile its revised incident copy with the specific preparation-recovery messages. Reuse its incident infrastructure; this hotfix adds no telemetry service. |
| #363 | `eb7f3e96915eb2462a2bec7e0c1098d5f3815706` | No directly shared source files. Backup/notification persistence and UI slice are unchanged. |

These PRs were neither edited nor merged. Compatibility above is a source/contract review, not certification of a combined merge commit. Re-run shared tests when branches are integrated.

## Automated evidence

Focal evidence: **310/310 latest results across 38 files**, combining the 285 passing results of the broad focal run with the final **51/51** recheck of the three affected modules, plus two passing response-identity/session checks before credential persistence and the **73/73** Admin/RPC contract run plus the final **65/65** reconciliation run. The final reconciliation also covers a valid immutable Admin grant with a desynchronized login view and no pending marker: canonical session/device and server verification must still pass, and another username, license, Staff actor or substituted session cannot recover it. The recheck includes real ActorScopedStorage rejection before replacing an active binding. It supersedes a test added while the earlier process had already loaded its previous module snapshot.

ESLint of all modified JavaScript/JSX and new tests: **PASS**. `git diff --check`: **PASS**. React Doctor: **90/100**, no errors and one large-component warning for AdminLoginModal; no dependency installed into the project. `npm run build`: **PASS**, including service-worker generation and startup precache audit (21 startup assets).

Full local CANDIDATE/BASE comparison: in progress sequentially with one worker on the two-core Windows host. The candidate run began before the last response/plan contract guards were finalized; it is observational and cannot certify the final immutable HEAD. The first overlapping BASE attempt was stopped after confirming memory pressure (about 600 MB free); it is incomplete evidence, not a BASE_FAILURE or PASS. The repository's `npm run test:ci` command was invoked; Vitest rejects a duplicate `--maxWorkers` override, so the equivalent complete suite runs directly as `node node_modules/vitest/vitest.mjs run --maxWorkers=1`. No timeout, assertion or CI threshold was relaxed. Canonical four-worker test:ci and PR127 comparison remain required in GitHub Actions.

A repeated full-suite gate exposed a scheduler-sensitive immediate focus assertion in the new preparation test. The test now awaits the actual React focus effect while preserving the exact toHaveFocus assertion and its default timeout; the new target passed **20/20 isolated repetitions**. The same post-effect synchronization is used for two existing takeover assertions after PR127 focused evidence reproduced their matching failure on both main and candidate. The existing 13-case takeover file also passed **20/20 repetitions (260 case executions)** after this synchronization. No production authorization or test threshold was relaxed.

See the attached PR's checks and final review report for final full-suite/CI outcomes. This committed report is not a claim of completed physical QA.

AUTH-R1 coverage is grouped below; several IDs share one deterministic integration case and existing suites complement the adapter-controlled integration.

| Matrix IDs | Evidence |
| --- | --- |
| 01–02, 05–13, 18–25, 29–30, 32–35 | `src/services/auth/__tests__/adminLoginRecovery.integration.test.js`: Local/PRO, partial profile, same-session recovery, single flight, canonical binding failures, denial, late results, real bootstrap reload, storage recovery and offline policy. |
| 03–04, 19, 31 | Integration negative results plus Admin modal classification and existing Admin/Free device tests. |
| 14–17, 27–28 | Real bootstrap integration plus existing bootstrap coordinator, session transitions, modern Free cutover and Admin/Staff suites. |
| 22–23, 25–26 | Integration rejection cases plus real ActorRuntime, session bridge, actor scoped storage and operational/financial handoff suites. |
| 35 and responsive/accessibility UX | Preparation modal tests; physical device and network QA remains pending. |

Raw JSON/logs are retained outside tracked source; the report below records commands and final counts. BASE and CANDIDATE use the same immutable base and lockfile. Candidate-only failures must be resolved or classified with focused evidence; a prior flaky failure is not treated as a new regression merely because one full run fails.

## QA manual en Windows — pendiente del propietario

Usa el Preview del PR y una licencia de QA autorizada, con un dispositivo reservado para esa licencia. No confirmes un cambio de dispositivo de un negocio que esté operando. No borres almacenamiento ni IndexedDB.

1. **QA-01/09:** En Chrome o Edge abre el Preview, inicia sesión Local y compara, sin editar, inventario, ventas, caja y configuración con lo esperado. Cierra sesión e inicia otra vez (**QA-08**).
2. **QA-02/03:** Presiona F12, pestaña Network, activa Offline antes de iniciar sesión. Comprueba el mensaje y la ausencia de acceso. Vuelve a Online y entra con normalidad.
3. **QA-04:** En un contexto de QA sin perfil local previo, abre DevTools → More tools → Network request blocking. Añade `*get_business_profile_anon*`, activa el bloqueo y deja disponible `admin_login_on_device`. Inicia sesión. La autenticación debe verificarse y la preparación debe ofrecer **Reintentar carga**. Si hay una caché autorizada utilizable y la aplicación entra normalmente, eso es continuidad válida; no elimines la caché para forzar el caso. Usa la prueba automatizada o una licencia/contexto de QA preparado sin perfil local.
4. **QA-05/06/14:** Conserva el registro Network. Quita únicamente el bloqueo del perfil y pulsa **Reintentar carga**, sin recargar. Debe entrar, sin mostrar códigos técnicos. Cuenta las solicitudes: un `admin_login_on_device` en el intento inicial y ninguno adicional por el reintento; `verify_admin_session` sí puede aparecer. No deben registrarse dispositivos duplicados.
5. **QA-07/15:** Recarga con conexión y confirma restauración. En Local, después de una validación legítima y con caché vigente, cambia a Offline y recarga: debe respetar las reglas offline existentes. No se espera restauración de credenciales expiradas.
6. **QA-10:** En un segundo dispositivo de QA comprueba que Local respeta su límite y el consentimiento de takeover; cancela el takeover si no deseas trasladar la licencia de QA. No se debe obtener acceso por recuperar el contexto del primer dispositivo.
7. **QA-11/12:** En DevTools activa Device toolbar: móvil 360×640 y 640×360, tablet 768×1024 y escritorio. Repite el fallo parcial. Verifica texto legible, desplazamiento, teclado, botones accesibles y foco en **Reintentar carga**. Repite en un móvil físico vertical/horizontal antes de certificar.
8. **QA-13:** Repite login, fallo parcial, reintento, recarga y logout con una cuenta PRO autorizada. Comprueba que Staff conserva solo sus permisos.

Para ejecutar la evidencia local con Node 24 desde PowerShell:

```powershell
Set-Location '<ruta-del-worktree-del-hotfix>'
npm ci
npx vitest run src/services/auth/__tests__/adminLoginRecovery.integration.test.js src/components/common/__tests__/AdminLoginModal.recovery.test.jsx --maxWorkers=4
npm run test:ci
npm run build
```

No se considera certificación física completa hasta registrar los resultados de QA-01 a QA-15. El PR permanece Draft, sin merge ni despliegue manual a producción.

## Residual limits

Physical laptop/mobile QA is pending. The exact field incident lacks correlated server evidence. Offline revocation detection retains the existing validation window and requires reconnection to learn a server revocation. A session without trustworthy canonical evidence is not automatically resurrected. Combined integration of the four open PRs still needs its own checks.
