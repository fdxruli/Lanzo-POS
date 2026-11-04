# LANZO POS — Mini-fase 2.5A

## Estado de entrega

**Resultado: `FIN01_PHASE25A_PARTIAL_WITH_BLOCKERS`.** Se adaptó el frontend Cloud al contrato v2 y se validó el comportamiento local cubierto por las suites disponibles. La migración V y sus RPC de servidor no existen todavía. Sin ellas, el candidato no puede operar contra un backend F+V ni certificarse como protocolo completo.

Se conservaron los cambios en una rama y worktree aislados. No se creó commit, no se publicó la rama ni se abrió un PR Draft porque hacerlo presentaría una adaptación cliente cuyas contrapartes SQL aún no existen. No se aplicó SQL ni se escribió en Supabase Production. Q sigue sin implementar y F permanece intacta.

## A. Identificación

| Campo | Valor |
|---|---|
| `REPOSITORY` | `fdxruli/Lanzo-POS` |
| `MAIN_HEAD` | `9ca65fc07804f40c2add5e59bee0e6edca940b8f` (preflight) |
| `PR370_HEAD` | `b31bbd80bf398d956890debced5b20de7b0c928d` (OPEN, Draft; mergeable/Clean y checks aplicables aprobados en el preflight) |
| `NEW_BRANCH` | `feat/cloud-sync-protocol-v2-fin01-r1` |
| `NEW_PR_NUMBER` | Ninguno; no publicado |
| `NEW_PR_BASE` | No aplica. Base prevista si se desbloquea: rama de #370 `fix/financial-credit-limit-enforcement-r1` |
| `CANDIDATE_HEAD_INITIAL` | `b31bbd80bf398d956890debced5b20de7b0c928d` |
| `CANDIDATE_HEAD_FINAL` | `b31bbd80bf398d956890debced5b20de7b0c928d`; árbol de trabajo con cambios sin commit |
| `PR338_HEAD` | `fef7205f76b173025f503e60d0968f446f741e78` (preflight; no modificado) |
| `PR352_HEAD` | `d758f69b2119f1bc346eb0ac86ba0a74c0265668` (preflight; no modificado) |
| `SUPABASE_PROJECT` | `odlrhijtfyavryeqivaa` |
| `PRODUCTION_WRITES` | `0` |

Los HEAD y checks de PR corresponden al preflight de esta sesión. No se creó una nueva referencia remota; #370, #338 y #352 no recibieron cambios.

## B. Arquitectura y cobertura

El frontend introduce `financial_customer_sync_contract = 2` como versión lógica, negociada mediante `pos_fin01_sync_contract_v1`. El descubrimiento pide las capabilities informativas `historical_credit_preservation_v1` y `customer_projection_safe_apply_v1`; ninguna otorga permisos ni sustituye licencia, tenant, dispositivo, sesión, actor o autorización financiera.

Las llamadas Cloud afectadas pasan a estos nombres v2, sin fallback automático a v1:

- Clientes: `pos_upsert_customer_v2`, `pos_delete_customer_v2`, `pos_migrate_local_customers_v2`, `pos_pull_customers_snapshot_v2`, `pos_pull_customer_changes_v2`.
- Crédito: `pos_get_customer_credit_summary_v2`, `pos_pull_customer_credit_snapshot_v2`, `pos_pull_customer_credit_changes_v2`, `pos_record_customer_payment_v2`.
- Intenciones financieras: `pos_execute_financial_operation_v2`, `pos_get_financial_operation_receipt_v2`.

La cobertura anterior describe el **cliente preparado**. Cobertura de contrapartes SQL implementadas: **0/11 endpoints listados y 0 migraciones V**. La función de descubrimiento tampoco está instalada por este candidato.

El módulo `cloudSyncProtocolV2` valida versión, tenant, familia y endpoint, identidad de cliente, idempotency key y request hash, estado de proyección, deuda en centavos, payloads anidados con clientes y cursores. El mapper mantiene desconocida una proyección ausente o inconsistente; solo infiere `KNOWN_ZERO` o `KNOWN_POSITIVE` cuando recibe deuda y centavos enteros consistentes. El envelope validado se conserva junto al resultado. Todo esto valida la frontera del frontend; no sustituye pruebas contra las respuestas SQL reales.

Las capacidades y el envelope no son una autorización financiera. No se implementó un core SQL compartido; no se puede demostrar aún el grafo `RPC v2 → autorización existente → core común → efectos` ni la paridad del dispatcher con los wrappers actuales. Esta es una dependencia de arquitectura pendiente, en particular porque la migración de directorio actual llama al wrapper público `pos_upsert_customer` y el dispatcher financiero actual llama wrappers públicos de venta y cancelación.

## C. SQL y estado remoto

| Aspecto | Resultado |
|---|---|
| Migración V nueva | Ninguna |
| Firmas, owners y `SECURITY DEFINER` nuevos | Ninguno |
| `search_path`, ACL, grants y RLS nuevos | Ninguno |
| Función de descubrimiento instalada | No |
| RPC v2 de servidor instaladas | No |
| Ejecución de DDL/DML remoto, `db push` o `migration repair` | Ninguna |

El acceso a Production fue solo de lectura. El preflight observó PostgreSQL **17.6**, máximo remoto `20261022184218` (`qa_ecom_bridge_1a4_cleanup`), ausencia remota de `20261022135915_fin01_historical_credit_owner_authorization.sql` y de `pos_historical_credit_batch_v1`; los cinco hashes FIN01 consultados coincidieron. La migración F existe localmente por la base del PR #370 y no aparece en el diff del candidato.

El drift histórico ya conocido sigue vigente: Atomic Settlement usa `20261006181758` en #338 y `20261006224032` en Production; Origin Cancel usa `20261008013643` en #338 y `20261008030859` en Production. No se intentó corregir drift. La próxima migración deberá respetar la dependencia de F y revisar el máximo local/remoto vigente antes de generar su timestamp.

No se encontró PostgreSQL 17 nativo en este host; solo PostgreSQL 18 local. Docker está excluido por la solicitud. Por eso no se ejecutó certificación SQL aislada en PG17 ni se declaran verificados ACL, RLS, owners, firmas o concurrencia real.

## D. Frontend, Dexie y recuperación

- Los repositorios de clientes y crédito llaman las rutas v2 enumeradas arriba. La migración histórica FIN01 existente sigue separada; el importador legacy local de crédito no hace fallback.
- Los mappers distinguen `KNOWN_ZERO`, `KNOWN_POSITIVE`, `HISTORICAL_PENDING`, `CONFLICT` y `NOT_INCLUDED`. La deuda ausente no se convierte a cero.
- La aplicación de lotes de clientes usa una sola transacción Dexie y rechaza IDs duplicados.
- La aplicación de crédito agrupa ledger, clientes, caché y proyecciones de caja en una transacción; valida `ActorRuntime` durante la operación. El checkpoint se escribe después de aplicar el payload validado y los cursores paginados se comprueban antes de continuar.
- El outbox introduce `UPDATE_REQUIRED`, pausa por familia y reanuda únicamente tras una negociación compatible. La pausa conserva intentos, payload, clave de idempotencia y checkpoint; no consume un retry ni descarta una intención.
- El ledger financiero usa las rutas de execute/receipt v2 sin cambiar la idempotency key ni el request hash existentes. Una respuesta incierta continúa por el flujo de consulta de recibo y no crea otra clave.
- `CloudProtocolUpdateNotice` agrega un aviso localizado por familia en Layout. No fuerza recarga ni sugiere borrar datos.

Estas rutas se probaron con dobles de RPC y pruebas locales/Dexie, incluidas suites con `fake-indexeddb`. No es una certificación de persistencia física de un navegador ni una prueba E2E del backend. La operación local no requiere el handshake para abrir; una ruta Cloud incompatible queda en estado recuperable.

## E. Pruebas y builds

| Área | Ejecutadas | PASS | FAIL | SKIP / límite | Evidencia |
|---|---:|---:|---:|---|---|
| Protocolo, outbox, ledger, retry, snapshot histórico | 7 suites / 94 tests | 94 | 0 | RPC simulados | `vitest` focalizado |
| Regresión de clientes, crédito, sync, caja, finanzas y ventas | 39 suites / 350 tests | 350 | 0 | No certifica SQL real | `vitest --maxWorkers=2 --reporter=dot` |
| Revalidación de apply histórico y protocolo/outbox | 4 suites / 30 tests | 30 | 0 | `fake-indexeddb`/fixtures | `vitest` focalizado tras corregir mapper |
| PostgreSQL 17 | 0 | 0 | 0 | SKIP: PG17 no instalado; Docker prohibido | Inventario local: solo PG18 |
| Dexie en navegador real | 0 | 0 | 0 | SKIP | Se probaron suites locales; no navegador físico |
| UI visual y accesibilidad en navegador | 0 | 0 | 0 | SKIP | No se ejecutó navegador ni Preview |
| ESLint focalizado sobre archivos tocados | 1 ejecución | 1 | 0 | — | Exit code 0; aviso de `baseline-browser-mapping` desactualizado |
| Build Production / PWA | 1 ejecución | 1 | 0 | — | `npm run build`, exit code 0; postbuild verificó 24 assets de arranque Admin y 0 assets de rutas core Local |
| React Doctor | 2 intentos | — | — | UNRESOLVED: exploración no terminó dentro de la ventana; proceso interrumpido | El CLI indicó que `--diff` está deprecated; el segundo intento usó `--scope changed --base b31bbd80…` |
| GitHub CI / Vercel Preview | 0 | 0 | 0 | SKIP: no existe PR ni publicación | Sin deployment |

El primer barrido amplio, ejecutado mientras compilaban el build y React Doctor, encontró tres fallos del mapper y dos timeouts de worker. Se corrigió la inferencia segura de proyecciones con deuda más centavos consistentes; las suites afectadas pasaron después y la repetición completa quedó en **39/39 suites, 350/350 tests**. El último build se ejecutó después de la corrección y terminó con exit code 0. Vite informó advertencias de chunking y patrones de precache que no encuentran ciertos assets; el postbuild de assets Admin pasó.

## F. Compatibilidad

| Frontend | SQL/backend | Resultado | Evidencia | Riesgo |
|---|---|---|---|---|
| Antiguo | Antiguo | Baseline documentado en inventario 2.4 | `docs/reports/fin01-phase24/route-classifications.json` del worktree original | Sin Q, conserva rutas legacy |
| FIN-01 actual sin v2 | Backend que no publica contrato | No se usa v1 como fallback desde las rutas adaptadas | Tests de protocolo y clasificación PGRST202 | Requiere cliente/backend coordinados |
| Frontend v2 de esta rama | Backend antiguo sin discovery/RPC v2 | `CLOUD_CLIENT_UPDATE_REQUIRED`, sin fallback | Test unitario con discovery ausente | No ejecutable hasta instalar V |
| Frontend v2 de esta rama | Backend F+V | UNRESOLVED | No existe V en SQL | No afirmar compatibilidad |
| Frontend antiguo | Backend F+V sin Q | No certificado; sigue siendo riesgoso | Sin negativos legacy de 2.5B | Wrappers v1 aún expuestos |
| Frontend antiguo | Futuro backend Q/F/V | No probado | Q no implementado | HOLD de compatibilidad |

## G. GitHub, Vercel y publicación

`NEW_PR_STATUS=NOT_CREATED_BLOCKED`. No hay commit nuevo, push, PR, CI del candidato, mergeability de candidato ni Vercel Preview. Un Preview no tendría contrapartes v2 instaladas y no serviría como certificación. El PR #370 permanece abierto y Draft; no se cambió su base ni su rama.

## H. Seguridad

El cliente mantiene el `ActorRuntime` y los argumentos de sesión/licencia existentes; la versión y las capabilities solo seleccionan contrato. Se añadieron comprobaciones de tenant, actor, cursor e identidad de respuesta antes de persistir. Las pruebas locales cubren rechazo de tenant/proyección inválidos y aislamiento en outbox.

No se editaron funciones SQL, RLS, ACL o grants. Por ello la autoridad de servidor, permisos efectivos, límites de tasa, exposición de `EXECUTE`, `search_path` y paridad de actores/dispositivos para cada RPC v2 siguen **sin certificar**. No se usó `service_role` ni se expusieron secretos. No se ejecutaron RPC financieras de escritura sobre Production.

## I. Lista exacta de preparación para Mini-fase 2.5B

El inventario de Mini-fase 2.4 clasificó estas 14 rutas/wrappers legacy como superficie de riesgo o de respuestas financieras anidadas:

1. `pos_upsert_customer`
2. `pos_delete_customer`
3. `pos_migrate_local_customers`
4. `pos_pull_customers_snapshot`
5. `pos_pull_customer_changes`
6. `pos_get_customer_credit_summary`
7. `pos_pull_customer_credit_snapshot`
8. `pos_pull_customer_credit_changes`
9. `pos_record_customer_payment`
10. `pos_migrate_local_customer_credit`
11. `pos_create_cloud_sale_credit`
12. `pos_cancel_cloud_sale`
13. `pos_execute_financial_operation_v1`
14. `pos_get_financial_operation_receipt`

Antes de poner wrappers en cuarentena, Q debe resolver dos dependencias para evitar autobloqueo: (a) `pos_migrate_local_customers` invoca el wrapper público `pos_upsert_customer`; (b) el dispatcher financiero utiliza wrappers públicos de venta y cancelación. V debe apuntar a cores internos autorizados y compartidos. Q también deberá cubrir payloads/replays persistidos de `response_payload`, recibos, resultados `customer`, `children[].customer`, `sale.credit`, cancelaciones, pagos, conflictos y `sale.split`; mantener `pos_migrate_local_customer_credit` bloqueado por la autoridad FIN01 y no crear un importador alternativo.

Gates pendientes: tests negativos para las 14 entradas legacy antes de reserva y replay; mismos tenant/actor/dispositivo/permiso; replays con misma key/hash sin duplicar ventas, Caja, inventario o ledger; rollback y concurrencia real en PostgreSQL 17; firmas/owners/ACL/RLS/search path; capacidades manipuladas; compatibilidad de migración F→V y certificación Q→F→V. No declarar legacy bloqueado ni activar Q aquí.

## J. Estados finales

```text
FIN01_PHASE25A_STATUS=FIN01_PHASE25A_PARTIAL_WITH_BLOCKERS
V2_PROTOCOL_STATUS=FRONTEND_CONTRACT_IMPLEMENTED_SERVER_CONTRACT_MISSING
V2_RPC_COVERAGE=11_FRONTEND_CALLS_PREPARED_0_SERVER_COUNTERPARTS
V2_ENVELOPE_STATUS=FRONTEND_VALIDATION_IMPLEMENTED_UNCERTIFIED_AGAINST_SQL
V2_FINANCIAL_RECEIPT_STATUS=FRONTEND_V2_EXECUTE_AND_RECEIPT_PREPARED_SERVER_MISSING
V2_IDEMPOTENCY_STATUS=FRONTEND_PRESERVES_EXISTING_KEY_AND_HASH
V2_CUSTOMER_SYNC_STATUS=FRONTEND_ADAPTED_SERVER_MISSING
V2_DEXIE_INTEGRITY_STATUS=LOCAL_ATOMIC_APPLY_AND_SNAPSHOT_TESTS_PASS
V2_OFFLINE_STATUS=LOCAL_PATH_UNCOUPLED_CLOUD_UPDATE_REQUIRED_RECOVERABLE
V2_ACTOR_TENANT_STATUS=FRONTEND_GUARDS_TESTED_SERVER_UNVERIFIED
POSTGRESQL_17_STATUS=SKIP_NOT_INSTALLED_DOCKER_PROHIBITED
FRONTEND_REGRESSION_STATUS=39_SUITES_350_TESTS_PASS
Q_LEGACY_QUARANTINE_STATUS=NOT_IMPLEMENTED_BY_SCOPE
F_FIN01_MIGRATION_STATUS=UNCHANGED_IN_CANDIDATE_ABSENT_FROM_PRODUCTION
NEW_SQL_MIGRATIONS=NONE
NEW_PR_STATUS=NOT_CREATED_BLOCKED
NEW_REGRESSIONS=NONE_CONFIRMED_IN_TESTED_SCOPE
PRODUCTION_WRITES=0
MERGE_READINESS=NOT_READY
PRODUCTION_DEPLOY_READINESS=NOT_READY
NEXT_RECOMMENDED_ACTION=IMPLEMENT_AND_REVIEW_V_SQL_CORE_REUSE_THEN_CERTIFY_F_TO_V_ON_ISOLATED_POSTGRESQL_17
```
