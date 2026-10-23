# Lanzo POS — Mini-fase 2.5A.1

## Resultado

**`FIN01_PHASE25A1_IMPLEMENTED_REMOTE_DEPLOY_HOLD`**

Se completó localmente el contrato Cloud v2 de servidor y cliente sobre la rama aislada de #370. El preflight de Production queda en **HOLD**: no se aplicó F ni V, no se ejecutaron escrituras SQL remotas y no se hizo QA financiero remoto. Falta acreditar respaldo y restauración aislada, además de contener la superficie legacy antes de cambiar funciones compartidas.

El estado HOLD permite publicar el código como PR Draft de revisión. No autoriza merge ni instalación.

## A. Identificación y Git

| Campo | Valor |
|---|---|
| Repositorio | `fdxruli/Lanzo-POS` |
| Proyecto Supabase | `odlrhijtfyavryeqivaa` (`Lanzo`, PostgreSQL 17.6.1, `ACTIVE_HEALTHY`) |
| Rama candidata | `feat/cloud-sync-protocol-v2-fin01-r1` |
| Worktree | `C:\Users\pituf\.codex\worktrees\cloud-sync-protocol-v2-fin01-r1\Lanzo-POS-Git` |
| HEAD inicial | `b31bbd80bf398d956890debced5b20de7b0c928d` (HEAD actual de #370) |
| Base prevista del Draft | `fix/financial-credit-limit-enforcement-r1` (#370) |
| Estado al inicio | Cambios locales sin commit preservados; checkpoint recuperable previo conservado |
| Rama remota candidata previa | No existía en `origin` durante la revalidación |
| `PRODUCTION_WRITES` | `0` |
| `MERGE` | No ejecutado |

Revalidación GitHub de esta entrega:

- #370: abierto, Draft, mergeable, HEAD `b31bbd80bf398d956890debced5b20de7b0c928d`; sin cambios de esta tarea.
- #338: abierto, Draft, HEAD `fef7205f76b173025f503e60d0968f446f741e78`; sin cambios de esta tarea.
- #352: abierto, Draft, HEAD `d758f69b2119f1bc346eb0ac86ba0a74c0265668`; sin cambios de esta tarea.
- `main` usado como base del #370: `9ca65fc07804f40c2add5e59bee0e6edca940b8f`.

## B. Contrato Cloud v2

La migración V local agrega la negociación informativa `pos_fin01_sync_contract_v1` y las once contrapartes que necesita el cliente:

1. `pos_upsert_customer_v2`
2. `pos_delete_customer_v2`
3. `pos_migrate_local_customers_v2`
4. `pos_pull_customers_snapshot_v2`
5. `pos_pull_customer_changes_v2`
6. `pos_get_customer_credit_summary_v2`
7. `pos_pull_customer_credit_snapshot_v2`
8. `pos_pull_customer_credit_changes_v2`
9. `pos_record_customer_payment_v2`
10. `pos_execute_financial_operation_v2`
11. `pos_get_financial_operation_receipt_v2`

La migración conserva el envelope con identidad de tenant/actor, familia, endpoint, cursor y operación. Las capabilities solo describen soporte; no autorizan operaciones. Las proyecciones distinguen `KNOWN_ZERO`, `KNOWN_POSITIVE`, `HISTORICAL_PENDING` y `CONFLICT`; deuda ausente o no reconciliada permanece desconocida. Los lotes de ledger parciales se marcan incompletos.

V aplica guards de una sola transacción, exige que F esté registrada y que existan sus dependencias. Compara hashes, owner y `search_path` de las funciones existentes que reutiliza. Los RPC financieros y de clientes se enrutan a los cores actuales autorizados; no se expone el dispatcher legacy como mecanismo de fallback. La migración de directorio usa una clave idempotente estable por batch y cliente. La ruta de recibo no revela `operation_type` ni `operation_id` cuando el actor/dispositivo no es el origen autorizado.

Los helpers privados conservan permisos cerrados; los RPC públicos tienen grants explícitos a `anon` y `authenticated`. No se modifica F en este candidato. No se dispara importación histórica durante la instalación.

**Límite de validación:** la migración se revisó estáticamente, pero no se pudo compilar/ejecutar en un PostgreSQL local. El host solo tiene binarios PostgreSQL 18 y `initdb` falla por falta de `share/postgres.bki`; PostgreSQL 17 no está instalado. Docker estaba prohibido por la solicitud y no se usó. No se presenta el test estático como sustituto de la ejecución SQL real.

## C. Migraciones y estado de Production

| Campo | Resultado |
|---|---|
| F | `20261022135915_fin01_historical_credit_owner_authorization.sql`, necesaria antes de V |
| F en ledger Production | Ausente durante la lectura de preflight |
| `pos_historical_credit_batch_v1` en Production | Ausente durante la lectura de preflight |
| Última migración Production observada | `20261022184218 qa_ecom_bridge_1a4_cleanup` |
| V local | `supabase/migrations/20261023033028_fin01_cloud_sync_protocol_v2_r1.sql` |
| SHA-256 de V | `76CB71ED898A3AAC209984F5A4593BFD15529E941A6BA7B8DF2948F5DC4E63C9` |
| V en Production | No instalada |
| Q | No implementada ni instalada |
| `db push` / `migration repair` | No ejecutados |

La lectura de Production confirmó PostgreSQL 17.6.1 y el ledger indicado. El drift histórico de Atomic Settlement y Origin Cancel se mantiene documentado y no se corrigió en esta fase. El candidato no ejecutó DDL ni DML en Production.

## D. Integración cliente y preservación

- Los repositorios Cloud de clientes y crédito y el ledger financiero consumen nombres v2; no hacen fallback silencioso a v1 cuando falta discovery/RPC.
- Un backend sin contrato v2 produce `CLOUD_CLIENT_UPDATE_REQUIRED`; el Local continúa disponible y el outbox conserva clave, hash, payload, intentos y checkpoint.
- El outbox pausa por familia y reanuda solo después de negociar compatibilidad. No consume retries al pausarse.
- Snapshots y ledger se aplican con validación de tenant/actor y transacciones Dexie; la deuda histórica Local se mantiene hasta aprobación explícita del propietario y recibos completos.
- Las intenciones financieras siguen usando la clave idempotente y el request hash durables existentes. Una respuesta incierta se resuelve por recibo; no se genera otra identidad.
- Se añadió validación de proyección también para clientes anidados en respuestas financieras.

Esto demuestra protecciones de cliente en fixtures/Dexie local; no certifica el contrato contra SQL/PostgREST instalado.

## E. Gate H — decisión remota

**`PRODUCTION_PREFLIGHT_HOLD`**

Evidencia que impide GO:

1. El informe R3.3.2 mantiene `SYNTHETIC_RESTORE_IN_ISOLATION=NOT_RUN`.
2. R3.4 reporta `R3.4_MAY_START=NO`; no hay destino aislado de restauración acreditado.
3. Las certificaciones de backup R1 y R2 reportan `BACKUP_READINESS=HOLD`; no se acreditó restaurabilidad con las estructuras y datos financieros afectados.
4. Q no existe y las rutas antiguas v1 siguen disponibles para clientes/PWA antiguos. V modifica funciones compartidas y un Preview no aísla Production.
5. No está certificada la población completa de deuda exclusiva de Dexie por dispositivo; un backup Cloud no contiene esa deuda.

El riesgo no se resuelve por tratarse de negocios QA ni por la ausencia de usuarios comerciales reales. No se usó Farmacia Gary como tenant de QA ni se hicieron operaciones remotas.

**Decisión:** no aplicar F/V, no ejecutar SQL de prueba con escritura, no insertar fixtures financieros y no iniciar QA funcional contra Production. Primero completar R3.4 con restauración en aislamiento y preservar evidencia por dispositivo; después certificar Q contra los 14 endpoints/wrappers legacy identificados y definir un corte de clientes/PWA; finalmente recalcular ledger/hashes, revisar F→V y reevaluar Gate H.

## F. Validación local

| Control | Resultado | Evidencia/límite |
|---|---|---|
| Contrato SQL estático | PASS, 6/6 | Guards/hash, discovery + 11 RPC, cores/idempotencia, envelope/proyección, ACL y cliente |
| Cloud Sync v2 focal | PASS, 9/9 | Incluye discovery ausente, sin fallback, tenant, actor, cursor, replay y clientes anidados |
| Regresión focal relacionada | PASS, 22 archivos / 193 tests | Históricos/Dexie, crédito, ledger/recovery, ventas, caja, actor/tenant, orquestador y outbox |
| ESLint focal | PASS, exit 0 | Advertencia de `baseline-browser-mapping` desactualizado |
| Build Production/PWA | PASS, exit 0 | Vite, `injectManifest`; postbuild verificó 24 assets de arranque y 0 assets de rutas core Local |
| Build warnings | Informativas | Chunk `vendor_supabase` vacío, imports dinámicos/estáticos y patrones PWA sin coincidencias; postbuild terminó correctamente |
| React Doctor | PASS, 91/100 | Dos avisos de rendimiento `async-await-in-loop` en las rutinas de pausa/reactivación del outbox; se conserva el guard de tenant antes de cada fila |
| Barrido ampliado exploratorio | UNRESOLVED / interrumpido | La ejecución de 58 archivos no produjo un resumen durante la ventana; se detuvo y no se cuenta como PASS ni FAIL |
| PostgreSQL aislado | No ejecutado | PG18 sin `postgres.bki`; PG17 no instalado; Docker prohibido |
| PostgREST/SQL real | No ejecutado | F/V ausentes en Production y Gate H en HOLD |
| QA funcional Production/Preview | No ejecutada | No se abrieron sesiones ni se hicieron operaciones financieras remotas |

Los errores `BATCH_ALLOCATION_INVALID`, `FINANCIAL_REQUEST_HASH_INVALID` y `LOCAL_PROJECTION_FAILED` impresos durante la suite de retry son rechazos intencionales simulados por sus fixtures; las aserciones correspondientes pasaron.

Los avisos de React Doctor revisan cada fila del outbox antes de modificarla. Ese orden vuelve a comprobar el tenant/identidad después de cada operación asíncrona; no se cambió por una escritura paralela que debilite el corte si cambia la sesión.

## G. Compatibilidad y Preview

| Cliente | Backend | Estado |
|---|---|---|
| Cliente antiguo | Backend actual sin F/V | Sin compatibilidad nueva certificada; wrappers v1 existen |
| Cliente v2 | Backend actual sin discovery/RPC v2 | Se bloquea con `CLOUD_CLIENT_UPDATE_REQUIRED`, sin fallback legacy |
| Cliente v2 | F+V | Contrato implementado localmente; integración PostgREST pendiente |
| Cliente antiguo | F+V sin Q | HOLD; compatibilidad peligrosa no certificada |

Vercel `lanzo-pos` está conectado al repositorio. No había deployment de la rama candidata en la consulta anterior a publicar. La QA funcional queda diferida hasta instalar/verificar dependencias SQL y superar los gates; cualquier Preview que GitHub genere automáticamente debe permanecer protegida y no abrirse contra Production para ejecutar acciones.

## H. Estados finales

```text
FIN01_PHASE25A1_STATUS=FIN01_PHASE25A1_IMPLEMENTED_REMOTE_DEPLOY_HOLD
V2_BACKEND_STATUS=IMPLEMENTED_LOCAL_NOT_INSTALLED
V2_RPC_COVERAGE=11_OF_11_PLUS_DISCOVERY_IMPLEMENTED_LOCAL
V2_FRONTEND_STATUS=INTEGRATED_LOCAL_NO_V1_FALLBACK
V2_ENVELOPE_STATUS=IMPLEMENTED_STATIC_CONTRACT_PASS_LIVE_UNVERIFIED
V2_IDEMPOTENCY_STATUS=EXISTING_KEY_HASH_AND_RECEIPT_FLOW_PRESERVED
V2_FINANCIAL_RECEIPT_STATUS=IMPLEMENTED_ACTOR_ORIGIN_GUARDED_LIVE_UNVERIFIED
PRODUCTION_PREFLIGHT_STATUS=PRODUCTION_PREFLIGHT_HOLD
PRODUCTION_SQL_STATUS=NOT_RUN_GATED
PRODUCTION_FIN01_STATUS=F_ABSENT_NOT_APPLIED
PRODUCTION_V2_STATUS=NOT_INSTALLED
PRODUCTION_QA_STATUS=NOT_RUN
VERCEL_PREVIEW_STATUS=FUNCTIONAL_QA_DEFERRED_GATE_HOLD
POSTGREST_INTEGRATION_STATUS=NOT_RUN
LEGACY_COMPATIBILITY_STATUS=HOLD_Q_MISSING
LOCAL_DEBT_PRESERVATION_STATUS=CLIENT_GUARDS_PASS_REMOTE_UNCERTIFIED
BACKUP_RESTORE_STATUS=HOLD_R3_4_AND_ISOLATED_RESTORE_MISSING
SELECTIVE_MIGRATION_STATUS=PREPARED_LOCAL_NOT_APPLIED
NEW_REGRESSIONS=0_CONFIRMED_IN_22_FILE_193_TEST_FOCAL_SCOPE
PR_V2_STATUS=DRAFT_TO_BE_PUBLISHED_STACKED_ON_PR370
PR370_STATUS=OPEN_DRAFT_UNMODIFIED_HEAD_B31BBd80
PR338_STATUS=OPEN_DRAFT_UNMODIFIED_HEAD_FEF7205F
PR352_STATUS=OPEN_DRAFT_UNMODIFIED_HEAD_D758F69B
MERGE_READINESS=HOLD
GENERAL_RELEASE_READINESS=HOLD
PRODUCTION_WRITES=0
NEXT_RECOMMENDED_ACTION=COMPLETE_R3_4_ISOLATED_RESTORE_AND_LEGACY_Q_THEN_REEVALUATE_GATE_H
```
