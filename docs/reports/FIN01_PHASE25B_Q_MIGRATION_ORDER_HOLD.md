# LANZO POS — Mini-fase 2.5B — FIN-01 Q

## Decisión

**`FIN01_PHASE25B_HOLD_MIGRATION_ORDER`**

El preflight confirma una dependencia de instalación que todavía no puede ejecutarse de forma segura con el aplicador canónico actual. La migración V exige la definición original de `public.pos_execute_financial_operation_v1`; Q debe sustituir esa función después de que V haya creado su copia privada. La secuencia de cuerpos es, por tanto, `F → V → Q`. Entre V y Q, los RPC legacy seguirían aceptando llamadas.

Una revocación temporal de `EXECUTE` antes de F podría cerrar esa ventana sin cambiar `pg_get_functiondef`, pero no existe en la rama un paso canónico que la ejecute, registre sus precondiciones, espere el drenado de llamadas activas y mantenga el cierre si F/V fallan. El workflow productivo existente solo valida versiones y ejecuta `supabase db push`; no contiene ese paso previo. Además, las versiones F y V que faltan en Production son anteriores al último registro remoto y el workflow no pasa `--include-all`.

Por este gate no se creó una migración Q, no se sustituyeron wrappers y no se publicó SQL que aparentara estar listo. Se conserva este informe como Draft de diseño para acordar y probar el corte necesario. `IMPLEMENTATION_HOLD`.

## A. Identificación y preflight

| Campo | Valor |
|---|---|
| `REPOSITORY` | `fdxruli/Lanzo-POS` |
| `MAIN_HEAD` | `52bb573e651529b323b6617e3161cd76ece14a39` |
| `PR370_HEAD` | `b31bbd80bf398d956890debced5b20de7b0c928d` — OPEN / Draft / mergeable |
| `PR371_HEAD` | `2f33cea480f3d478f797b495b168feac9aed483f` — OPEN / Draft / mergeable |
| `NEW_BRANCH` | `feat/fin01-legacy-protocol-quarantine-r1` |
| `NEW_PR_NUMBER` | `374` — OPEN / Draft |
| `NEW_PR_BASE` | `feat/cloud-sync-protocol-v2-fin01-r1` |
| `NEW_PR_HEAD` | `cfcdf5982bc57cbcca240484d651cdfd7674594a` al crear el Draft; después se añadió únicamente este metadato del PR al mismo informe |
| `SUPABASE_PROJECT` | `odlrhijtfyavryeqivaa` (`Lanzo`, `us-east-2`, ACTIVE_HEALTHY, PostgreSQL 17.6.1) |
| `PRODUCTION_WRITES` | `0`; solo se ejecutaron consultas `SELECT` remotas |

La rama local se creó en un worktree aislado desde el HEAD remoto actual de #371. La rama remota Q no existía al iniciar. El worktree original y sus archivos sin confirmar se conservaron.

| PR | Estado revalidado | CI observable para el HEAD consultado |
|---|---|---|
| #370 | OPEN / Draft / mergeable; sin modificación | Cuatro workflows SUCCESS en el SHA `b31bbd80…` |
| #371 | OPEN / Draft / mergeable; sin modificación | No se encontraron workflow runs para `2f33cea4…` |
| #338 | OPEN / Draft; sin modificación | Nueve workflows SUCCESS en `fef7205f…` |
| #352 | OPEN / Draft; sin modificación | No se encontraron workflow runs para `d758f69b…` |

La búsqueda de `INVENTORY.md`, `source-inventory.json`, `inventory-validation.json` y los artefactos 2.4 no encontró esos archivos en esta rama; GitHub tampoco devuelve historial para las rutas consultadas de `INVENTORY.md` y `source-inventory.json`. El informe 2.5A.1 conserva la lista de 14 RPC, pero no contiene el inventario fuente completo de 37 endpoints ni la matriz 2.3/2.4. El archivo `cloudCriticalRpcGuards.js` enumera 25 RPC críticos; no sustituye aquella matriz.

La lectura del ledger Production confirma que F, V y Q no están registradas. El último registro es `20261024130558_qa_ecom_bridge_1a4_remove_unused_race_probe`. La lista completa se consultó mediante el conector Supabase; no se modificó el ledger.

## B. Inventario de los 14 RPC legacy

Las firmas siguientes proceden del catálogo Productivo. Para cada nombre hay una sola sobrecarga con la firma indicada. Los 14 son `SECURITY DEFINER`, propiedad de `postgres`, `search_path=""`, y tienen `EXECUTE` explícito para `anon`, `authenticated` y `service_role`; no se observó una concesión a `PUBLIC`. La consulta de privilegios confirmó `has_function_privilege=true` para `anon` y `authenticated` en los 14.

| RPC y firma exacta | Core / datos de respuesta | Replay y efectos | Autorización observada | Protección Q requerida |
|---|---|---|---|---|
| `pos_upsert_customer(text,text,text,text,jsonb,integer,text)` | Llama `pos_upsert_customer_unlimited`; la respuesta puede incluir ficha, `debt`, `debt_cents` y límite. | El core usa idempotencia; escribe ficha y evento de sincronización. | Contexto de licencia/dispositivo/sesión y reglas del core de clientes. | Rechazo explícito antes del core y de cualquier proyección de ficha. |
| `pos_delete_customer(text,text,text,text,text,integer,text)` | Llama `pos_delete_customer_unlimited`; respuesta relacionada con la ficha/cliente eliminado. | Core con clave idempotente; cambio de ficha/evento. | Contexto y autorización existente del core de clientes. | Rechazo explícito antes de borrar o responder con una ficha aplicable. |
| `pos_migrate_local_customers(text,text,text,text,jsonb,text)` | Llama `pos_migrate_local_customers_unlimited`; batch con resultados de clientes y posibles fichas anidadas. | Admite `p_batch_id`; el core delega trabajo por cliente. | Contexto y reglas del core; el camino legacy ha usado el wrapper público de upsert. | Bloquear el batch entero, no solo el wrapper anidado, para evitar resultados parciales. V2 debe conservar su llamada directa al core autorizado. |
| `pos_pull_customers_snapshot(text,text,text,text,integer,integer,boolean)` | Llama `pos_pull_customers_snapshot_unlimited`; devuelve colección de clientes. | Lectura paginada; el cliente mantiene el cursor/checkpoint. | Contexto y permisos de lectura del core. | Rechazar antes de serializar una ficha o página antigua. |
| `pos_pull_customer_changes(text,text,text,text,bigint,integer)` | Llama `pos_pull_customer_changes_unlimited`; devuelve cambios con datos de cliente. | Lectura incremental desde `p_since_change_seq`; la respuesta incluye secuencia que el cliente puede guardar como checkpoint. | Contexto y permisos de lectura del core. | Rechazar sin entregar cambios ni una secuencia que el cliente interprete como aplicada. |
| `pos_get_customer_credit_summary(text,text,text,text,text)` | Llama `pos_get_customer_credit_summary_unlimited`; el cuerpo contiene claves `customer`, `customers`, `debt` y `debt_cents`. | Lectura de cliente/ledger; sin escritura financiera en el wrapper. | Contexto, sesión y acceso a crédito del core. | No devolver saldo ausente, cero implícito ni resumen incompatible. |
| `pos_pull_customer_credit_snapshot(text,text,text,text,integer,integer,text,boolean)` | Llama `pos_pull_customer_credit_snapshot_unlimited`; incluye datos de cliente y ledger de crédito. | Lectura paginada; el cursor lo conserva el cliente. | Contexto y permisos de crédito del core. | Rechazar antes de emitir página, saldos o cursor. |
| `pos_pull_customer_credit_changes(text,text,text,text,bigint,integer)` | Llama `pos_pull_customer_credit_changes_unlimited`; devuelve cambios relacionados con cliente, ledger y caja. | Lectura incremental; `p_since_change_seq` puede alimentar checkpoint local. | Contexto y permisos de crédito del core. | Rechazar sin exponer deuda ni avanzar el checkpoint local. |
| `pos_record_customer_payment(text,text,text,text,text,numeric,text,text,text,jsonb,text)` | Llama `pos_record_customer_payment_unlimited`; respuesta relacionada con cliente y recibo. | Clave idempotente; escribe ledger de cliente y efecto de caja. | Contexto, sesión, permisos de cliente/caja y validación financiera del core. | Rechazar antes de reservar la clave, asentar pago, crear recibo o devolver replay. |
| `pos_migrate_local_customer_credit(text,text,text,text,jsonb,jsonb,text)` | Llama `pos_migrate_local_customer_credit_unlimited`; procesa balances/ledger de clientes. | Importación histórica puede escribir ledger y devolver saldos/clientes. | F deshabilita el camino legacy; la autorización vigente de propietario se conserva en `pos_historical_credit_batch_v1`. | Mantener bloqueada la ruta antigua; no introducir otro importador ni saltarse F. La RPC autorizada de F es un contrato separado. |
| `pos_create_cloud_sale_credit(text,text,text,text,jsonb,jsonb,jsonb,text,text,text)` | Llama `pos_create_cloud_sale_credit_unlimited`; respuesta financiera de venta fiada. | Clave idempotente; puede afectar venta, crédito/ledger, pago, caja e inventario según la venta. El replay exacto del payload no se certificó en este preflight. | Contexto, sesión de caja, permisos y validación de crédito del core. | Rechazar antes de la reserva/venta/efectos; probar resultado persistido con fixture antes de habilitar Q. |
| `pos_cancel_cloud_sale(text,text,text,text,text,text,text)` | Llama `pos_cancel_cloud_sale_unlimited`, que consulta primero el preview de cancelación. | Puede revertir efectos de venta, crédito, caja e inventario; acepta clave idempotente. La forma exacta del replay no se certificó aquí. | Preview y autorizaciones actuales de cancelación. | Rechazar antes de preview mutante, cancelación, reversa o replay; probar rollback financiero. |
| `pos_execute_financial_operation_v1(text,text,text,text,text,text,text,jsonb)` | Dispatcher genérico con `p_operation_type` y `p_request`; referencia `pos_financial_operations`. Puede transportar resultados anidados de varias familias. | Reserva/ejecuta/reproduce operaciones financieras y respuestas asociadas. | Validación común de contexto, hash, origen y autoridad por operación. No se puede usar el tipo declarado por el cliente para permitir operaciones. | Bloquear el dispatcher v1 completo. No filtrar por tipo declarado ni responder un `result`/`children[].customer` antiguo. |
| `pos_get_financial_operation_receipt(text,text,text,text,text,text)` | Lee recibos/resultado del almacén de operaciones; la respuesta persistida puede ser un payload de cliente/venta. | No crea una operación financiera nueva, pero puede reproducir una respuesta previamente persistida. | Validación de contexto y del origen/actor de la operación. | Rechazar antes de devolver `response_payload`, `result`, recibo o cliente anidado. |

Las diez rutas que terminan en `_unlimited` de esta familia no deben recibir grants de cliente. La verificación V que ya existe comprueba que sus cores sigan inaccesibles a `anon` y `authenticated`; el V2 SECURITY DEFINER los invoca internamente. Q no puede sustituir ni conceder acceso a esos cores.

Además, Production expone `pos_get_customer_credit_report(...)` y `pos_get_reports_credit_overview(...)` como RPC de reporte con `SECURITY DEFINER`, `search_path=""` y permisos cliente. La inspección del repositorio los encuentra en `reportsCloudRepository.js`, no en los repositorios que aplican snapshots a Dexie. No se clasifican como rutas de sincronización de ficha; permanecen dentro del alcance de privacidad de reportes y requieren la matriz 2.4 para cerrar la revisión de los 37 endpoints.

## C. Arquitectura y contrato propuestos, aún sin implementar

La alternativa candidata sería sustituir los 14 wrappers públicos después de V, mantener los cores y las funciones privadas intactos, validar primero el contexto/actor existente y emitir un rechazo explícito sin datos de proyección. El nombre conceptual coincide con el cliente: `CLOUD_CLIENT_UPDATE_REQUIRED`.

El cliente V2 crea ese error con `code=CLOUD_CLIENT_UPDATE_REQUIRED`, `recoverable=true` y `retryable=false`. El manejador de RPC revisa `error.code`; PostgreSQL expone un SQLSTATE de cinco caracteres y pondría el texto del rechazo en `message`. Por ello no se ha demostrado que una excepción SQL con SQLSTATE estándar vaya a mapear al código de dominio. Hay que elegir y probar una representación explícita que no sea una respuesta `success=true` ni una ficha incompleta.

El cliente actual de V2 consume endpoints V2 y no cae a v1. `customerCreditCloudRepository.migrateLocalCredit()` ya rechaza localmente con `CLOUD_CLIENT_UPDATE_REQUIRED`. La compatibilidad de pestañas y PWA antiguas no se infiere de eso: las respuestas recibidas antes del corte pueden seguir en memoria o en una sesión anterior.

No se seleccionó una estrategia final porque aún faltan dos garantías de transición: un gate canónico que cierre los permisos antes de F y que drene llamadas legacy activas, y una prueba de lectura de replay/payload en el dispatcher y recibo. No se propone devolver JSON vacío, borrar `debt` ni fingir éxito.

## D. Gate de hashes F/V y orden

Las migraciones existentes quedaron intactas. SHA-256 de los archivos actuales:

| Migración | SHA-256 |
|---|---|
| F `20261022135915_fin01_historical_credit_owner_authorization.sql` | `0168E13BA24938BB2205DACD7857B6E23130BE0525F7318552ADAF26099155FF` |
| V `20261023033028_fin01_cloud_sync_protocol_v2_r1.sql` | `6E0044F13C4459B9D1F2885DB259947A83DBFB903E2A3E8CD88C6270E6E31DDF` |
| Q | No existe; no se generó timestamp ni hash |

F tiene cinco precondiciones MD5: los wrappers/cores financieros y de autorización listados al inicio de F. Ninguna exige reemplazar un wrapper público legacy por Q.

V compara 49 funciones por SHA-256, owner `postgres` y `search_path` vacío. Su lista incluye `public.pos_execute_financial_operation_v1(...)` con SHA-256 `c575e9751a0a2b70a14231ab9e9073d9cdac8775ac0571de5989d6435ade559b`. Luego V lee esa definición y comprueba que contiene las llamadas públicas de venta y cancelación antes de copiarla a `private.pos_execute_financial_operation_core_v2`, reescribirlas a helpers privados y crear el dispatcher V2.

Conclusión del gate:

1. Si Q reemplaza `pos_execute_financial_operation_v1` antes de V, falla el hash de V (`FIN01_V_DEPENDENCY_DRIFT`) y también puede fallar su comprobación de fuente (`FIN01_V_DISPATCHER_SOURCE_UNEXPECTED`). No se actualizarán esos hashes.
2. Si Q reemplaza ese dispatcher después de V, sus precondiciones ya se ejecutaron y el core privado V2 conserva una copia reescrita. La compatibilidad de los cuerpos puede mantenerse.
3. Esa secuencia deja las rutas públicas legacy disponibles durante F/V, salvo que un gate previo las cierre.
4. Revocar `EXECUTE` solo cambia ACL; una prueba transaccional PG17 sobre un wrapper mostró mismo `md5(pg_get_functiondef(...))` antes/después y bloqueo de `anon`/`authenticated` al revocar también `PUBLIC`. El test cubrió un wrapper existente, no las 14 firmas ni el aplicador.
5. La revocación debe incluir `PUBLIC`; la documentación Supabase advierte que revocar solo `anon`/`authenticated` no elimina un permiso heredado de `PUBLIC`.

El workflow `.github/workflows/supabase-production-migrations.yml` exige dispatch, SHA de `main` y versiones exactas, pero su APPLY termina en `supabase db push --linked`. No hay un preflight de revocación ni espera de drenado. La versión instalada del CLI es 2.51.0; `migration new --help`, `migration up --help` y `db push --help` se verificaron. `db push` ofrece `--include-all`; el workflow no lo usa. Las versiones F/V faltan por debajo de registros posteriores del ledger Production, de modo que la aplicación canónica aún no demuestra que incorporará F/V y seguirá su dependencia con Q.

No se probó ni ejecutó ningún aplicador selectivo contra Production. Una secuencia futura necesitaría un paso aprobado que cierre y verifique los 14 permisos antes de F, espere a que terminen las llamadas activas, aplique exactamente F→V→Q con filas de ledger verificables, y solo restaure el acceso público después de que Q haya cambiado los wrappers para rechazar. Si una etapa falla, el cierre debe permanecer activo. El pipeline tendría que demostrar cómo lo hace antes de declarar `QFV_INSTALLATION_ORDER_STATUS=PASS`.

## E. Integridad y seguridad

No se escribió SQL Q, por lo que no hay owner, ACL, RLS, `SECURITY DEFINER`, `search_path` ni grants de Q que certificar. La propuesta no añade tablas. Cualquier futura función helper debe ser privada, con `search_path=''`, sin grants públicos ni cambios a cores.

La superficie Production observada no tiene Q: las 14 rutas siguen ejecutables por `anon` y `authenticated`. Los núcleos `_unlimited` inspeccionados permanecen restringidos a servicio/owner; el catálogo V exige que sigan así. La cuarentena debe validar tenant, licencia, dispositivo, sesión y permiso antes de responder el código de actualización, sin usar capabilities declaradas como autorización.

Para evitar efectos, el rechazo tendría que ocurrir antes de reservar idempotencia, reproducir payloads, escribir ledger, pago, venta, cancelación, caja o inventario. Las rutas de lectura deben fallar antes de serializar fichas, deuda, recibos o checkpoints. `pos_migrate_local_customer_credit` debe continuar sujeto a F y al flujo explícito de propietario; Q no autoriza importación.

## F. Evidencia de pruebas

| Área | Ejecutado | Resultado | Evidencia / límite |
|---|---:|---|---|
| Production SQL | SELECT de catálogo, permisos, firmas y ledger | PASS / solo lectura | `PRODUCTION_WRITES=0` |
| GitHub preflight | PR 370/371/338/352, HEADs y workflow runs | PASS | Sin cambios a esos PR |
| CLI Supabase | `--version` y `--help` de migraciones | PASS | CLI 2.51.0; no se generó Q |
| PostgreSQL nativo | Cluster nuevo local PG 17.11, loopback `127.0.0.1:55847` | PASS | Datos sintéticos; PostgreSQL detenido y archivos conservados en `C:\Users\pituf\AppData\Local\Lanzo-Recovery\fin01-q-cert-20261025T0353Z` |
| Aplicación F | Aplicar migración F en fixture sintético | PASS | La transacción y sus cinco guards terminaron correctamente; no se repitieron los 61 escenarios financieros ya reportados en R22 |
| F + ACL freeze | Prueba de revocación dentro de transacción, una firma | PASS limitado | `pg_get_functiondef` conservó hash; `PUBLIC`, `anon` y `authenticated` quedaron sin EXECUTE; transacción revertida |
| Aplicación V | Intento en fixture R22 | NOT_TESTED | Se abortó en el guard antes de cambios: falta `private.assert_cloud_layaways_enabled(jsonb)`; el fixture no contiene 38 de los 49 cuerpos requeridos por V. No es un fallo de V ni un PASS |
| Q PostgreSQL | No ejecutado | NOT_TESTED | No se creó Q por el HOLD arquitectónico |
| Replay/recibo precargado | No ejecutado | NOT_TESTED | El fixture R22 no certifica V2/replay de dispatcher completo |
| Unit/Vitest/Dexie/PWA/UI | No ejecutado en esta fase | NOT_TESTED | No se cambió código de aplicación |
| Build/ESLint/React Doctor | No ejecutado | NOT_TESTED | Solo se añadió el informe de diseño |
| Vercel Preview | No ejecutada | NOT_TESTED | No se abrió una app conectada a Production |
| Concurrencia Q | No ejecutada | NOT_TESTED | Requiere Q y fixture completo |
| Production QA financiera | No ejecutada | NOT_RUN / prohibida por alcance | Sin sesiones POS ni RPC de escritura |

La creación de la base local usó `initdb`, `createdb` y `psql` nativos PostgreSQL 17; no Docker. El cluster local propio se detuvo ordenadamente, conservando sus archivos y log.

## G. Recuperación, riesgos y límites

R3.4 continúa en `R3_4_PARTIAL_WITH_BLOCKERS`: el restore sintético anterior aprobó 22 aserciones, pero el backup real, la restauración Productiva, la recuperación Dexie por dispositivo y la cobertura de Auth/Storage/configuración siguen pendientes por decisión del propietario. No se pidió ni ejecutó un backup.

| Prioridad | Riesgo | Estado |
|---|---|---|
| P1 | Los RPC legacy permanecen expuestos en Production y pueden devolver proyecciones/replays incompatibles. | Riesgo previo confirmado; Q no aplicada. |
| P1 | No hay transición verificada que congele y drene llamadas legacy antes de F/V y mantenga el cierre tras un fallo. | Bloqueo de implementación y despliegue. |
| P1 | El aplicador productivo no demuestra que incorpore F/V, versiones más antiguas que el máximo del ledger, ni el paso previo de ACL. | Bloqueo de orden/ledger. |
| P1 | V no se pudo ejecutar contra el fixture PG17 de R22 por 38 dependencias faltantes. | Cobertura no probada, no regresión atribuida. |
| P1 | Pestañas, PWA y respuestas recibidas antes del corte pueden conservar estado anterior. | Compatibilidad universal no certificada; requiere plan de drenado/actualización y R3.4. |
| P2 | El inventario 2.4 de 37 endpoints no está disponible en la rama ni en las rutas GitHub consultadas. | Falta evidencia para cerrar bypasses fuera de los 14. |
| P2 | La normalización del error SQL a `CLOUD_CLIENT_UPDATE_REQUIRED` no está demostrada para el cliente RPC actual. | Requiere escoger y probar un contrato. |

No se identificaron regresiones nuevas: esta rama no cambia funciones, código de cliente ni workflow. Eso no equivale a confirmar que el sistema Productivo actual esté libre de la exposición legacy conocida.

## H. GitHub y estados finales

```text
FIN01_PHASE25B_STATUS=FIN01_PHASE25B_HOLD_MIGRATION_ORDER
Q_ARCHITECTURE_STATUS=HOLD_TRANSITION_GATE_UNPROVEN
Q_LEGACY_ENDPOINT_COVERAGE=14_OF_14_CATALOGED; 37_ENDPOINT_MATRIX_MISSING
Q_REPLAY_PROTECTION_STATUS=NOT_IMPLEMENTED; DISPATCHER_AND_RECEIPT_REPLAYS_NOT_TESTED
Q_FINANCIAL_EFFECTS_STATUS=NOT_TESTED_FOR_Q
Q_RPC_ACL_STATUS=14_OF_14_ANON_AUTHENTICATED_EXECUTE_IN_PRODUCTION
Q_BYPASS_STATUS=37_ENDPOINT_REVIEW_INCOMPLETE; REPORT_RPCS_CLASSIFIED_SEPARATELY
Q_ERROR_CONTRACT_STATUS=TOKEN_MATCHES_V2_DISCOVERY; POSTGREST_EXCEPTION_MAPPING_UNPROVEN
Q_MIGRATION_STATUS=NOT_CREATED_GATE_D_STOP
Q_F_HASH_COMPATIBILITY=F_PRECONDITIONS_PASS_IN_ISOLATED_APPLY; Q_NOT_APPLIED
Q_V_HASH_COMPATIBILITY=Q_MUST_RUN_AFTER_V; FULL_V_GATE_NOT_EXECUTED_IN_R22_FIXTURE
QFV_INTEGRATION_STATUS=HOLD
QFV_INSTALLATION_ORDER_STATUS=HOLD_PREAPPLY_FREEZE_AND_INCLUDE_ALL_UNPROVEN
V2_REGRESSION_STATUS=NOT_RUN_THIS_PHASE; PR371_PRIOR_LOCAL_TESTS_RETAINED
OLD_CLIENT_RECONNECTION_STATUS=NOT_CERTIFIED
MIXED_TABS_STATUS=HOLD
POSTGRESQL_17_STATUS=17.11_AVAILABLE; F_APPLY_PASS; V_AND_Q_NOT_CERTIFIED
R3_4_BACKUP_GATE=R3_4_PARTIAL_WITH_BLOCKERS; REAL_BACKUP_RESTORE_PENDING
PRODUCTION_WRITES=0
PR_STATUS=OPEN_DRAFT_374; MERGEABLE=false
MERGE_READINESS=HOLD
PRODUCTION_DEPLOY_READINESS=HOLD
NEXT_RECOMMENDED_ACTION=PROVE_CANONICAL_PREFLIGHT_FREEZE_AND_LEDGER_ORDER; RESTORE_2_4_INVENTORY; RUN_COMPLETE_F_V_Q_FIXTURE
```

La rama de este informe se basa en el HEAD actual de #371; no se modificaron #370, #371, #338 ni #352. Sin merge, `db push`, `migration repair`, cambio de ledger, backup real ni despliegue frontend.
