# SHARED.TERMINAL.4 — CASH STATION + CASH SESSION + FINANCIAL HANDOFF

Fecha de verificación: 2026-08-19

Repositorio: `fdxruli/Lanzo-POS`

Proyecto Supabase: `odlrhijtfyavryeqivaa`

## 1. Precondición PR #210 / SHARED.TERMINAL.3

**PR #210 merge: VERIFIED.**

- PR: `#210`, `feat/shared-terminal-actor-scoped-storage` → `main`.
- Estado remoto: `MERGED`.
- Merge commit verificado: `294349e5ca590ab98bd75b0b7e38661d086b7217`.
- `main` remoto fue consultado antes de crear la rama.
- `main` contenía el merge commit y los contratos de Fases 1–3: `ActorRuntime`, `actorKey`, generación de actor, `ACTOR_CONTEXT_STALE`, `ACTOR_SESSION_AMBIGUOUS`, estados `LOCKED` / `AUTHENTICATING` / `HANDOFF_CHECK` / `GRANTED`, `device_mode`, separación `DEVICE != ACTOR`, autenticación real Admin/Staff, `ActorScopedStorage`, aislamiento de carrito/drafts, write fencing, handoff seguro, `originActor` y legacy ambiguous state fail-closed.

## 2. Base, rama, PR y commits

- `MAIN_SHA=294349e5ca590ab98bd75b0b7e38661d086b7217`.
- Nueva rama: `feat/shared-terminal-financial-handoff`.
- La rama fue creada desde exactamente `MAIN_SHA` mediante la integración GitHub.
- Nuevo PR Draft: [#211](https://github.com/fdxruli/Lanzo-POS/pull/211), contra `main`.
- El PR permanece `OPEN`, `DRAFT`, `merged=false`; no se modificó ni mergeó el PR #210.
- Commits publicados:
  1. `93f910a8cb898c70fc4671dcce8b3fa620cfbb02` — `feat(cash): add station identity and local schema guards`.
  2. `baa97f81f879e19c1da9ae96f100339f0268263a` — `feat(cash): enforce actor-scoped financial handoff`.
  3. `26e67f698f3fc8132c5add8b906e332a27d2fabd` — `test(cash): cover shared-terminal handoff and compatibility`.
- **HEAD final validado del código:** `26e67f698f3fc8132c5add8b906e332a27d2fabd`.
- El commit posterior de este reporte es únicamente documental; no cambia el código validado ni sus resultados.

## 3. Auditoría de arquitectura de caja previa

La auditoría se hizo sobre el `main` real y sobre Supabase producción, no sólo sobre migraciones históricas.

- `DEVICE` representa la terminal física, su `device_mode`, provenance y binding de licencia.
- `ACTOR` representa a la persona autenticada (`admin:<id>` o `staff:<id>`); `device_role` no es ownership financiero.
- `pos_cash_sessions` ya representaba una sesión financiera cuyo `actor_key` era la propiedad histórica; conservaba actor/device/admin provenance, estado, conteo, diferencia y cierre auditado.
- `pos_cash_movements` ya se vinculaba por `cash_session_id`, pero antes de esta fase no tenía identidad de estación ni una exclusividad física independiente del actor.
- La restricción previa relevante era por actor/licencia, no por recurso físico: podía impedir dos sesiones de un actor, pero no resolvía dos actores sobre el mismo efectivo.
- No existía una abstracción CashStation estable suficiente en cliente/cloud. Se introdujo la mínima necesaria, sin crear una IndexedDB nueva ni cambiar la identidad de tenant.
- Se auditaron `pos_cash_sessions`, `pos_cash_movements`, `pos_sync_events`, idempotencia, `license_devices`, contexto Admin/Staff, `resolve_cash_actor_key/name`, `validate_pos_sync_context`, apertura/cierre/movimientos, ventas, cancelaciones/refunds, audited close, adopción legacy, sync/reconciliation, índices, `cajaService`, hooks, checkout, outbox y recovery.

## 4. CashStation / contrato final

`CashStation` es un recurso financiero físico/lógico; no es un actor, no concede permisos y no es propietario de movimientos.

Contrato conceptual implementado:

```text
CashStation = {
  id, license_id, station_key, status,
  binding_mode, metadata
}

CashSession = {
  license_id, cash_station_id, actor_key,
  opened_by_actor_key, opened_by_device_id,
  status, opening/closing/reconciliation fields
}
```

Se eligió una primera implementación `device_default` conservadora:

- identidad lógica `cash_station_device_<device-id>`;
- binding explícito en `pos_cash_station_bindings`;
- `device_id` sólo aporta provenance/binding, nunca actor financiero;
- la identidad de estación puede sobrevivir al reemplazo de dispositivo cuando exista un binding explícito futuro;
- un dispositivo nuevo sin evidencia de binding no adopta automáticamente una estación con efectivo abierto: queda `CASH_STATION_UNRESOLVED` / recovery path.

Esto permite hoy un cajón por dispositivo sin cerrar la arquitectura a varias estaciones por licencia, varios dispositivos por estación o reemplazo de dispositivo.

## 5. Ownership de CashSession

La sesión continúa siendo actor-owned:

- `actor_key` no se modifica en logout, restart, browser clear, actor switch, sync ni retry.
- `opened_by_actor_key` conserva quién abrió; `opened_by_device_id` conserva provenance.
- Un cierre normal usa el actor propietario reautenticado.
- Un cierre administrativo usa `pos_admin_close_cash_session` / su contrato auditado existente, conserva el owner original y registra `closed_by_admin_user_id`, `closed_by_actor_key`, `closing_mode`, `reason`, comments, conteo y reconciliation status.
- Un Admin Z que resuelve una sesión de Staff X queda registrado como ejecutor; la sesión sigue siendo de Staff X.
- Staff no puede cerrar una sesión ajena por tener únicamente `cash_register=true`.

## 6. Exclusividad por CashStation

**One-open-session-per-station: PASS.**

- Migración: `supabase/migrations/20260819090000_shared_terminal_cash_station_financial_handoff.sql`.
- Índice parcial: `ux_pos_cash_sessions_open_station` sobre `(license_id, cash_station_id)` para `status='open'`, `deleted_at is null` y estación no nula.
- Preflight de producción antes de crear el índice: `duplicate_candidate_station_groups=0`, `max_open_per_candidate_station=1`, `candidate_station_groups=3`.
- La migración aborta explícitamente con `SHARED_TERMINAL_4_BLOCKED_OPEN_STATION_CONFLICTS` si existen conflictos, no los cierra ni reasigna.
- `pos_open_cash_session` bloquea la fila de estación (`FOR UPDATE`), comprueba la sesión abierta y conserva el índice parcial como última defensa de carrera.
- La política de actor único por licencia/otra estación también se conserva cuando el contrato existente la requiere.

## 7. Financial handoff y HANDOFF_CHECK

La autenticación y el gate financiero son distintos.

- `ActorRuntime` puede llegar a `GRANTED` para funciones no financieras.
- La condición financiera se consulta mediante el gate canónico `cashFinancialGate` / `pos_get_cash_station_state`.
- Estados estructurados: `READY`, `NO_SESSION`, `OWN_SESSION_OPEN`, `HANDOFF_REQUIRED`, `RECONCILIATION_REQUIRED`, `BLOCKED`.
- Código principal: `CASH_HANDOFF_REQUIRED`.
- Si no puede verificarse la estación online: `CASH_HANDOFF_REQUIRES_ONLINE` / `CASH_STATION_UNRESOLVED`; se permite únicamente operación no financiera según permisos.

Caso Admin A → logout → Staff B:

```text
C1: actor_key=admin:A, station=S, status=open
Staff B: autenticación PASS, ActorRuntime PASS, ActorScopedStorage=B
Financial gate: HANDOFF_REQUIRED / CASH_HANDOFF_REQUIRED
```

Staff B no hereda C1, no cambia su owner, no cobra contra C1 y no abre C2 sobre S. El flujo seguro es `close/reconcile explícito → audit → open C2`.

Resultados equivalentes:

- **Staff → Admin:** Admin no hereda la sesión de Staff; espera el cierre o usa audited close.
- **Staff X → Staff Y:** Staff Y no hereda ni modifica C1; requiere owner/admin resolution.
- **Owner normal close:** owner reautenticado cuenta y cierra; después otro actor puede abrir una nueva sesión.
- **Admin audited close:** se reutiliza el mecanismo existente, con razón obligatoria según la política vigente, conteo/reconciliation y actor ejecutor auditados.
- **Direct staff takeover:** bloqueado por defecto.
- **Automatic logout close:** MUST BE NO; logout no toca la sesión financiera.

## 8. Cloud y local ownership

Supabase sigue siendo la autoridad canónica en planes cloud/PRO. La UI/local cache no declara “libre” una estación si el cloud no lo confirma.

En IndexedDB se mantiene la misma base física `LanzoDB_t_<opaque-id>` para el tenant, sin DB por actor ni por CashStation. Dexie registra el esquema con `db.version(32)`; la capa de recuperación lo expone como versión nativa de IndexedDB `320` (`CURRENT_NATIVE_DATABASE_VERSION=320`). La migración es forward-only, determinista, no destructiva, restart-safe y retry-safe.

Stores/campos relevantes:

- `cajas`: `actorKey`, `cashStationId`, `cashSessionId`, estado, opening/closing provenance, reconciliation metadata.
- `movimientos_caja`: `cashSessionId`, `cashStationId`, `actorKey`, `performedByActorKey`, `originActorKey`, idempotency metadata.
- ventas: `cash_session_id`, estación y actor de origen cuando el pago es efectivo.

Los registros legacy se clasifican como deterministically adoptable (sólo con evidencia inmutable de device/cloud), cloud-linked, local-only legacy o `legacy_unresolved`. La ambigüedad no inventa estación/owner, no borra ni duplica; queda fail-closed/recovery required.

## 9. Sales, payments y movements

- Una venta en efectivo requiere una sesión exacta `OPEN`, del actor actual o de una autorización explícita; además debe coincidir con la estación actual.
- Se eliminó la ruta insegura de “primera caja abierta” genérica.
- Staff B no puede registrar venta cash sobre C1 de Admin A; Admin A tampoco puede usar C1 de Staff X después del handoff.
- Las operaciones no-cash conservan la política empresarial existente; no se introdujo un bloqueo artificial de tarjeta fuera del alcance.
- Movimientos conservan `cash_session_id`; la estación se deriva/verifica de la sesión y nunca sustituye al owner.
- `performed_by_actor_key` distingue al ejecutor del owner. Un trigger cloud impide saltos de sesión/estación y preserva la inmutabilidad.
- Cierre concurrente vs. venta/movimiento se rechaza si la sesión ya no está abierta o si el actor/generation/station no coincide.

## 10. Actor stale protection

Las mutaciones financieras capturan tenant, actor, generation, sesión esperada y estación esperada. Se revalidan inmediatamente antes del write/transaction.

- `LOCKED`, `AUTHENTICATING`, `HANDOFF_CHECK` y generation stale rechazan cash mutation.
- Un tab antiguo no puede agregar movimiento después del actor switch.
- Un movimiento de Admin A en outbox no se reinterpreta como Staff B.
- No existe asignación de ownership basada en `device_role` o `device_id`.

## 11. Idempotencia y concurrencia

Se conservan/gatean claves de idempotencia para `cash.open`, `cash.close`, movimientos, ajustes, sale cash y audited close. El RPC de apertura devuelve el resultado ya completado o `IDEMPOTENCY_PROCESSING`; no crea C2/C3 ante retry.

La apertura cloud serializa la estación y además depende del índice parcial único. El close normal/audited conserva el contrato existente y la evidencia de sync/idempotencia. Las pruebas locales cubren dos opens concurrentes sobre una estación y retry de close del owner; máximo una sesión queda satisfecha.

## 12. Offline y replacement

Si Staff B inicia sesión offline mientras existe o podría existir una sesión incompatible:

- no se asume estación libre;
- no se permite takeover ni nueva OPEN cash session;
- cash open/movement/adjust/close/sale cash quedan bloqueados con `CASH_HANDOFF_REQUIRES_ONLINE` o estado estructurado equivalente;
- funciones no financieras pueden continuar si el actor/permisos lo permiten.

Un dispositivo reemplazado no hace desaparecer C1. Sin binding/evidencia segura, el nuevo dispositivo queda unresolved y requiere recovery/admin audited close; no se crea una segunda caja por ausencia de D1.

## 13. Outbox financiero

El outbox genérico de Fase 3 no se rediseñó. Para operaciones financieras:

- se preservan `originActorKey`, `cashSessionId`, `cashStationId`, tenant e idempotency key donde aplican;
- el actor que transporta un retry no sustituye al actor de origen;
- si el servidor requiere reautenticación/autoridad original, la operación queda HOLD / REAUTH REQUIRED;
- el replay offline de cash PRO permanece deshabilitado/fail-closed (`CASH_OUTBOX_DISABLED`) para no fabricar disponibilidad ni cambiar ownership.

## 14. Supabase: migración y producción

**Supabase: TOUCHED.** No se ejecutó DDL manual fuera de migración y no se borraron/cerraron sesiones reales.

Archivos nuevos:

1. `supabase/migrations/20260819090000_shared_terminal_cash_station_financial_handoff.sql`
   - crea `public.pos_cash_stations` y `public.pos_cash_station_bindings`;
   - agrega identidad de estación/provenance a sesiones y movimientos;
   - hace backfill sólo deterministic-device-bound;
   - crea constraints/FKs/índices y `ux_pos_cash_sessions_open_station` después del preflight;
   - añade `resolve_cash_station_for_device`, `assert_cash_session_station`, `pos_get_cash_station_state`, apertura serializada y guards de movimientos/close normal;
   - conserva el path auditado Admin.
2. `supabase/migrations/20260819090100_shared_terminal_cash_movement_performed_by.sql`
   - completa la provenance `performed_by_actor_key` sin reescribir owner;
   - mantiene la estación/sesión inmutable en updates.

Aplicación registrada en producción con los nombres de migración:

- `shared_terminal_4_cash_station_financial_handoff`;
- `20260819090000_shared_terminal_cash_station_financial_handoff`;
- `20260819090100_shared_terminal_cash_movement_performed_by`.

Post-apply read-only verification:

- columnas/constraints/indexes/functions/grants/search_path presentes;
- `pos_get_cash_station_state` expuesta sólo con el grant existente `anon, authenticated` y `search_path=''`;
- `open_unresolved=0`;
- `duplicate_open_station_groups=0`;
- `movement_station_mismatches=0`;
- `movement_performed_by_null=0`;
- `migration_registered=1`;
- guard de `performed_by_actor_key` presente;
- bindings cross-tenant: `0`.

**Production invariant:** duplicate OPEN station sessions = **0**.

No se ejecutaron pruebas destructivas ni cierres/aperturas artificiales contra datos reales.

## 15. Tests y validación

Focused suites:

- CashFinancialGate / CashLocalRepository / handoff: PASS (incluye Admin→Staff, owner close, concurrent local opens, retry idempotente).
- Sales repository cash-session binding: PASS (foreign actor rejected, exact actor/station accepted).
- ActorRuntime, ActorScopedStorage, tenant isolation, database recovery, IndexedDB schema/recovery, auth/device-mode: PASS en focused run.
- Focused broad result: `188 passed, 3 pre-existing stock-synthetic failures`, todos reproducibles en BASE.

Regression/build checks:

- `npm run build`: PASS.
- `npm run build:store`: PASS.
- `npm run build:store:vercel`: PASS.
- ESLint dirigido sobre archivos modificados: `0 errors, 4 warnings` (warnings preexistentes/no bloqueantes).
- `git diff --check`: PASS.
- Full raw suite candidato: `49 failed / 336 passed` files, `92 failed / 2868 passed / 51 skipped` tests.
- Full raw suite base: `52 failed / 331 passed` files, `102 failed / 2848 passed / 51 skipped` tests.
- El lint global conserva exactamente los `344 problems (152 errors, 192 warnings)` preexistentes en BASE y CANDIDATE.

## 16. BASE vs CANDIDATE

La validación de código de `26e67f698f3fc8132c5add8b906e332a27d2fabd` había producido una comparación normalizada sin regresiones nuevas en el conjunto de evidencia de esa validación.

Para CLOSEOUT.R1 se reejecutó el mismo contraste sobre el HEAD observado `c57652ca88f114390e4aeb7f6c64a087dda86616`:

- BASE y CANDIDATE terminaron sus suites observacionales.
- El gate diferencial repetido de ActorRuntime — run `32264900716`, job `96109547965` — terminó **FAIL**.
- El candidato presentó una observación normalizada exclusiva en la repetición 2: `src/pages/__tests__/PublicStorePage.siteVersion.test.jsx` / `STACK_TRACE_ERROR`.
- BASE presentó una observación incidental de la misma clase general en `PublicStoreCheckout.test.jsx`, pero no el mismo identificador; el workflow la clasificó como `PR_REGRESSION` y no permite afirmar que el resultado sea cero.
- Por tanto, en el HEAD observado, `NEW/CHANGED REGRESSIONS` queda **UNRESOLVED — 1 candidate-only normalized observation**, no `0`.

CLOSEOUT.R1 no modificó archivos de código ni dependencias; la diferencia es una observación no causalmente atribuible a la corrección de whitespace. Aun así, la regla de cierre exige respetar el resultado rojo y mantener el estado fail-closed hasta revisión independiente o una corrida estable que lo descarte explícitamente.
## 17. Riesgos y trabajo diferido

- El binding avanzado multi-device/physical-drawer topology aún requiere una política explícita de negocio; la primera versión usa `device_default` determinista.
- El replay durable/genérico del outbox no se rediseñó; cash offline permanece bloqueado.
- La suite global y el lint global conservan fallos históricos observacionales; además, el gate diferencial exacto de CLOSEOUT.R1 quedó rojo por una observación candidata no resuelta. No se debe declarar PASS mientras ese resultado permanezca.
- Debe continuar la revisión independiente y añadir escenarios de integración no destructivos para topologías multi-dispositivo y para la observación de `PublicStorePage.siteVersion`.

No se inventó ownership histórico ni se hizo limpieza destructiva para ocultar estos riesgos.
## 18. CLOSEOUT.R1 — corrección de evidencia y auditoría de migraciones

### Estado remoto inicial

- PR #211 antes de este closeout: `OPEN`, `DRAFT`, `merged=false`.
- Rama: `feat/shared-terminal-financial-handoff`.
- Old HEAD: `23b8449a9ba91651bd8799e9b1f76a6a10bcd1a2`.
- Código validado sin cambios: `26e67f698f3fc8132c5add8b906e332a27d2fabd`.
- HEAD observado y validado antes de esta actualización del reporte: `c57652ca88f114390e4aeb7f6c64a087dda86616`.
- Esta actualización es documental y no cambia el código validado, las migraciones SQL ni Supabase. El SHA del commit que contiene esta versión final del reporte se verificará directamente en GitHub y se entrega también en el cierre externo; el reporte no intenta referenciar su propio SHA.

### Causa exacta del fallo report-only

Los workflows del old HEAD `23b8449a` reportaron:

- `Shared Terminal Actor Scoped Storage Validation` — run `32237418999`: FAIL.
- `Shared Terminal Actor Runtime Validation` — run `32237418996`: FAIL.
- `HOTFIX Dexie Recovery Validation` — run `32237419115`: FAIL.
- `PR127 Global Comparison` — run `32237419044`: PASS.

La causa reproducible del primer fallo de calidad fue `git diff --check` sobre el reporte, líneas 3 y 4: espacios de Markdown para hard-break al final de `Fecha de verificación` y `Repositorio`. Se eliminaron todos los trailing whitespace del reporte; no se modificó código funcional.

### Auditoría de migration history

El repositorio conserva estas migraciones ejecutables:

- `20260819090000_shared_terminal_cash_station_financial_handoff.sql`.
- `20260819090100_shared_terminal_cash_movement_performed_by.sql`.

La aplicación productiva se hizo mediante el conector Supabase `apply_migration`, que recibe un nombre separado del SQL y registra un `version` numérico generado por el mecanismo remoto. La evidencia del propio proyecto documenta el mismo comportamiento en Builder.1: una migración local con timestamp `20260720010757` fue aplicada por MCP, producción registró `20260721113522`, conservó el nombre y el SQL quedó hash-equivalente; luego el archivo Git se alineó al timestamp remoto.

Producción conserva actualmente:

| version | name | evidencia SQL |
| --- | --- | --- |
| `20260819084636` | `shared_terminal_4_cash_station_financial_handoff` | nombre corto del primer apply; una sentencia |
| `20260819084719` | `20260819090000_shared_terminal_cash_station_financial_handoff` | MD5 `c03d9dca69296b3bd9b6b4c5f5bbe91c`, igual al archivo Git |
| `20260819085828` | `20260819090100_shared_terminal_cash_movement_performed_by` | MD5 `2a9a1c5e3cda971f6907fc073236f11c`, igual al archivo Git sin su LF final |

La consulta read-only confirmó que `supabase_migrations.schema_migrations` tiene `version`, `statements[]`, `name`, `created_by`, `idempotency_key` y `rollback[]`. Las dos sentencias Git fueron aplicadas como una sentencia cada una. No hay indicio de contenido SQL distinto: la diferencia del segundo hash es únicamente el newline final que el conector no conserva.

La documentación oficial de Supabase establece que `supabase migration list` compara únicamente timestamps locales contra `schema_migrations.version`, y que `supabase db push` omite sólo migraciones cuyo timestamp ya está aplicado. La documentación y los scripts del repositorio identifican `supabase migration list` / `supabase db push --dry-run` como el mecanismo normal de despliegue versionado; no hay workflow de GitHub que despliegue estas migraciones automáticamente.

**Resultado:** existe drift real de historia, no una discrepancia inocua de nombres. Para la CLI normal, `20260819090000` y `20260819090100` serían local-only, mientras `20260819084719` y `20260819085828` serían remote-only; por tanto existe riesgo de reapply.

La reparación soportada sería `supabase migration repair`, pero el entorno conectado no expone esa operación: no hay herramienta MCP de repair, el binario Supabase CLI no está instalado y el checkout no está enlazado con credenciales remotas. No se usó `supabase_execute_sql` para modificar historial.

- **MIGRATION REAPPLY RISK:** CONFIRMED.
- **SUPABASE CLOSEOUT MUTATION:** NOT PERFORMED.
- **Migration SQL reexecuted:** NO.
- **Repair status:** BLOCKED — safe official history repair is unavailable in this environment.
- **SHARED.TERMINAL.4-CLOSEOUT.R1:** BLOCKED.

### Producción después de la auditoría

La auditoría fue read-only y dejó el esquema financiero sin cambios:

- `pos_cash_stations`: presente.
- `pos_cash_station_bindings`: presente.
- columnas de estación/provenance: presentes.
- `ux_pos_cash_sessions_open_station`: presente con semántica correcta.
- FKs de estación en bindings, sessions y movements: presentes.
- duplicate OPEN station groups: `0`.
- movement station mismatches: `0`.
- movement performed_by null: `0`.
- cross-tenant bindings: `0`.

### Validación del HEAD observado antes de esta actualización

La corrida completa sobre `c57652ca88f114390e4aeb7f6c64a087dda86616` dejó esta evidencia:

| Workflow | Run | Resultado |
| --- | --- | --- |
| Shared Terminal Actor Scoped Storage Validation | `32264900801` | **PASS** |
| Shared Terminal Actor Runtime Validation | `32264900716` | **RED**: focused PASS; differential job FAIL |
| HOTFIX Dexie Recovery Validation | `32264900786` | **PASS** |
| PR127 Global Comparison | `32264900722` | **PASS** |

El focused ActorRuntime job `96109597489`, el focused ActorScopedStorage job `96106875097` y HOTFIX ejecutaron `git diff --check`, builds y validaciones dirigidas sin errores de whitespace. La enumeración read-only del reporte confirmó cero líneas con trailing whitespace. Los jobs BASE/CANDIDATE observacionales terminaron, pero no convierten el gate diferencial fallido en PASS.

El workflow ActorRuntime del primer commit documental `0efce620c95febc742fae5d0396752fe5701fde5` publicó accidentalmente el commit report-only `96ea65fd798d83a19c2d5446ca966149a7dcbca1`. Se revirtió de forma controlada, sin force-push, mediante `c57652ca88f114390e4aeb7f6c64a087dda86616`, dejando el árbol Phase4 intacto. Después de `c57652c` no apareció otro commit automático y el publisher quedó skipped; esta actualización debe conservar esa estabilidad y no iniciar un loop.

El reporte se entrega con el resultado real: no se convierten estados RED en PASS y la evidencia de migraciones sigue siendo el bloqueo principal.
## 19. Estado exacto

**SHARED.TERMINAL.4: PARTIAL** (resultado funcional de la fase).

**SHARED.TERMINAL.4-CLOSEOUT.R1: BLOCKED**

Motivos de bloqueo:

1. La auditoría probó drift real entre los timestamps de migración Git y `schema_migrations.version`; la CLI normal puede considerar los dos archivos local-only y existe riesgo de reapply.
2. La reparación oficial `supabase migration repair` no está disponible en el entorno conectado. No se permite manipular manualmente `schema_migrations`; Supabase no fue modificado y las migraciones SQL no fueron reejecutadas.
3. El gate diferencial del HEAD observado terminó RED con una observación candidata normalizada no resuelta.

El handoff financiero, la exclusividad por estación, la separación actor/device, la protección stale, la idempotencia, el bloqueo offline y el binding sale/movement siguen fail-closed y sin evidencia de ownership leak.

- NO MERGE.
- Mantener el PR #211 en DRAFT.
- No iniciar `SHARED.TERMINAL.5`.
- Esperar revisión independiente.


**SHARED.TERMINAL.4: PARTIAL**

El handoff principal, la exclusividad por estación, la separación actor/device, la protección stale, la idempotencia, el bloqueo offline y el binding sale/movement quedaron implementados y verificados sin ownership leaks ni regresiones nuevas. Las deudas listadas arriba fallan cerradas.

- NO MERGE.
- Mantener el PR #211 en DRAFT.
- No iniciar `SHARED.TERMINAL.5`.
- Esperar revisión independiente.
