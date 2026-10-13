# LANZO POS — Preparación de staging aislado R1

Fecha de auditoría: 2026-10-13

Alcance: Supabase, Vercel, GitHub, migraciones de Restaurante y preparación de QA integrado para PR #338 y PR #352.

## Resultado

```text
IMPLEMENTATION_STATUS = NEW_STAGING_RECOMMENDED
STAGING_OPTION_RECOMMENDED = NEW_SUPABASE_PROJECT
STAGING_CREATION = PENDING_AUTHORIZATION
COST_REVIEW = REQUIRED
STAGING_READINESS = BLOCKED_PENDING_CREATION_AND_ISOLATION
INTEGRATED_QA_READINESS = BLOCKED
PRODUCTION_DEPLOYMENT_READINESS = HOLD
MERGE_READINESS = HOLD
```

El staging histórico sigue inactivo y no pudo certificarse para reutilización. El Preview de #352 usa variables compartidas con Production; la URL efectiva de Supabase apunta al proyecto productivo. Recomiendo un Supabase nuevo con datos sintéticos y una variable Preview específica para la rama de #352. La documentación y las guardas locales quedan preparadas, pero no se creó infraestructura ni se cambió configuración remota.

## Referencias vigentes

| Recurso | Estado verificado al 2026-10-13 |
|---|---|
| Repositorio | `fdxruli/Lanzo-POS` |
| main | `5be67950eea27c1b25db3e8765339222f8217e35` |
| PR #338 | OPEN / Draft; rama `feat/restaurant-split-flexible-payments-r1`; HEAD `fb17e9a43929d54087ab937cb760a8cd6e087c36` |
| PR #352 | OPEN / Draft; rama `feat/restaurant-admin-supervision-r1`; HEAD al inicio `e12c371252d5c80f192b10ef36792a6881ee69d1`; base #338 |
| PR #354 | MERGED en main el 2026-10-12; cambios de pruebas Ecommerce |
| Supabase Production | `Lanzo`, ref `odlrhijtfyavryeqivaa`, `us-east-2`, ACTIVE_HEALTHY, PostgreSQL `17.6.1.063` |
| Supabase histórico | `Lanzo-staging-historical-r1`, ref `jdnbmvaphvjunwhnxowo`, `us-west-2`, INACTIVE, PostgreSQL `17.6.1.166` |
| Organización Supabase | Plan Free; sólo se leyó el plan y el inventario de proyectos |
| Vercel | Hobby team `fdxrulis-projects`; proyecto `lanzo-pos`, ID `prj_tE5uWn6kLBYdS1eDFWVxRm449RUr` |

El PR #352 continúa en Draft y sin merge. Para su HEAD inicial, la consulta actual de estados de commit devuelve `Vercel – lanzo-pos` SUCCESS; el endpoint de ejecuciones de Actions no devolvió workflows disparados por pull request. La descripción del PR contiene resultados de un candidato histórico distinto, por lo que aquí no se usan para afirmar los gates del SHA actual. El deployment más reciente enumerado para esa rama está READY y corresponde al mismo SHA; el campo `target` de Vercel llegó como null, así que la clasificación exacta del destino queda UNVERIFIED. No se abrió el Preview para ejecutar QA.

El SHA actual de main incluye el merge de #354 y ya no coincide con la base histórica descrita en el cuerpo anterior del PR #352. No hice rebase, merge ni cambios en #338 o main.

## Supabase: aislamiento, servicios y recuperación

### Production

- El ref productivo se revalidó mediante el listado de proyectos. No se leyeron datos de negocios, clientes, ventas, licencias ni sesiones.
- La organización devuelve plan Free. La API disponible no devolvió estado detallado de backups ni PITR de Production; por eso `PRODUCTION_BACKUP_STATUS=UNVERIFIED` y `PITR_STATUS=UNVERIFIED`. La documentación de Supabase indica que Free no incluye backups diarios descargables y que PITR es un add-on de planes pagos con compute Small o superior. Una restauración recuperable no puede declararse por la existencia de SQL en Git.
- Catálogos de sólo lectura confirmaron que `public.pos_restaurant_orders` y `public.pos_restaurant_order_items` tienen RLS habilitado y no forzado. Los dos triggers productivos revisados para settlement y cancelación terminal están habilitados.
- Las funciones financieras y de cancelación de #338 existen en Production. Se compararon firmas, modo SECURITY DEFINER, permisos efectivos para `anon`, `authenticated` y `service_role`, y MD5 de `prosrc` con las funciones del SQL versionado. Coincidieron las definiciones de `execute_split_sale_financial_v1`, `pos_execute_financial_operation_v1` y `pos_cancel_restaurant_order_from_pos_v1`.
- Los MD5 de `pos_upsert_restaurant_order_unlimited`, `pos_close_restaurant_order_after_checkout_unlimited` y `pos_update_restaurant_order_status_unlimited` difieren del SQL final de #352, como se espera antes de instalar esa migración.
- Auth y Realtime son servicios del proyecto activo, pero su configuración, usuarios, redirect URLs, canales y permisos no se pudieron obtener desde las interfaces de sólo lectura usadas: UNVERIFIED.
- El proyecto Production informa dos Edge Functions activas. No se leyeron sus secretos. Ninguna función ni URL productiva queda autorizada para las pruebas de staging.

### Staging histórico

- El inventario actual devuelve INACTIVE, PostgreSQL 17.6.1.166 y ninguna rama de desarrollo. El listado de funciones Edge devuelve una lista vacía.
- La causa exacta de INACTIVE no está expuesta por el inventario. El historial de migraciones terminó con timeout de conexión. Auth, Realtime, API, dependencias y credenciales recuperables quedan UNVERIFIED.
- Un reporte de sólo lectura ya versionado en la certificación QA previa registró `pitr_enabled=false`, `backups_count=0` y `walg_enabled=true` para este ref. Como el proyecto permanece inactivo, esos datos son evidencia previa, no una lectura nueva durante esta auditoría.
- Supabase documenta que los proyectos Free pausados por inactividad pueden reanudarse desde Studio hasta un año después de la pausa. Eso hace plausible una recuperación técnica, pero no prueba que este proyecto esté pausado por inactividad, que Auth/Realtime estén restaurables o que se conserven sus migraciones. Reactivación y coste: UNVERIFIED; no se intentó.

### Comparación de opciones

| Criterio | Staging histórico | Proyecto Supabase nuevo | PostgreSQL temporal aislado |
|---|---|---|---|
| Aislamiento de Production | Ref distinto; runtime y dependencias actuales no verificados | Alto si recibe credenciales, datos, Auth, funciones y destino independientes | Alto para SQL si se crea en instancia separada |
| Auth real | UNVERIFIED; proyecto INACTIVE | Sí, proyecto Supabase dedicado, pendiente de crear y configurar | No |
| Realtime | UNVERIFIED | Sí, pendiente de activar/configurar | No |
| RPC reales | Historial inaccesible; no certificado | Sí, replay limpio de migraciones al autorizar | Sólo RPC SQL disponibles en PostgreSQL |
| Migraciones | Ledger no leído; riesgo histórico | Reproducibles desde manifiesto combinado, pendientes de revisión de versión | Requiere cargar SQL manualmente |
| QA financiera integrada | BLOCKED | Viable después de instalar dependencias y crear fixtures sintéticos | No sustituye Caja, Auth, Realtime, Edge Functions ni Storage |
| Recuperación | Evidencia previa: cero backups y PITR apagado; confirmar | Rehacer desde migraciones/fixtures; respaldo y costes dependen del plan | Rehacer desde el fixture |
| Coste | No confirmado; no se intentó reactivar | $0 si hay cupo Free disponible; precio/cupo exactos UNVERIFIED. Pro publicado desde $25/mes y proyectos adicionales desde $10/mes | UNVERIFIED; no se aprovisionó |
| Riesgo | Alto: configuración, datos y estado desconocidos | Bajo después de autorización, aislamiento y replay verificado | Medio para SQL; insuficiente para certificar la aplicación |
| Recomendación | No reutilizar como primera opción | Recomendada | Usar sólo como complemento de pruebas SQL |

La página oficial de Supabase indica dos proyectos Free activos y que los pausados no cuentan para ese límite. El inventario muestra dos proyectos en la organización, uno activo y otro INACTIVE; la elegibilidad concreta del nuevo proyecto requiere verificar si el histórico es efectivamente un proyecto pausado. El precio Pro y los add-ons publicados no son una cotización del proyecto. No se solicitó ni generó una cotización de creación.

Fuentes: [pausa y recuperación de proyectos Free](https://supabase.com/docs/guides/platform/free-project-pausing), [límites y facturación por organización](https://supabase.com/docs/guides/platform/billing-on-supabase), [precios publicados](https://supabase.com/pricing), [backups y PITR](https://supabase.com/docs/guides/platform/backups).

## Migraciones y dependencias SQL

La lectura administrativa de Production devolvió 312 registros en `supabase_migrations.schema_migrations`. El árbol de migraciones de PR #352 tiene 310 archivos. No se debe usar Production como destino de staging ni completar diferencias mediante inserciones manuales en el ledger.

| Versión del archivo en PR #352 | Estado de Production | Evidencia de catálogo/definición |
|---|---|---|
| `20260929091708_restaurant_payment_split_financial_r1.sql` | Ledger presente con esa versión | La función de split está disponible en el esquema productivo |
| `20261006181758_restaurant_atomic_settlement_3d1.sql` | No figura con esa versión; el ledger contiene `20261006224032 / restaurant_atomic_settlement_3d1` | La huella de `execute_split_sale_financial_v1` coincide exactamente con el archivo de #338 |
| `20261008013643_restaurant_origin_cancel_contract_3d13.sql` | No figura con esa versión; el ledger contiene `20261008030859 / restaurant_origin_cancel_contract_3d13` | La huella de `pos_cancel_restaurant_order_from_pos_v1` coincide exactamente con el archivo de #338 |
| `20261010013257_restaurant_cloud_transition_bridge_v1.sql` | Ausente | No aparecen tablas de estado/permiso ni RPC del bridge |
| `20261010013258_restaurant_admin_supervision_r1.sql` | Ausente | No aparecen objetos de intervención/supervisión; las funciones reemplazadas conservan hashes anteriores |

Los desfases de versión entre archivos y Production son importantes: un `db push` contra Production podría proponer SQL que ya está instalado bajo otra versión. No se tocará el historial para ocultar la diferencia. La comparación de hashes y firmas se usa para explicar el estado actual, no para aprobar la aplicación a otro proyecto existente.

PR #352 no contiene cinco migraciones que sí están en el main actual: identidad de licencia y cuatro migraciones legales, una de ellas todavía posterior al último ledger de Production. El árbol de main y el del PR tienen diez diferencias de nombres (cinco archivos por lado); no se encontraron rutas duplicadas con contenido modificado. Para una instalación limpia, el manifiesto propuesto es:

1. Usar como base todos los archivos de migración de main en `5be67950eea27c1b25db3e8765339222f8217e35`.
2. Añadir los tres archivos de Restaurante de #338 presentes en `fb17e9a43929d54087ab937cb760a8cd6e087c36`.
3. Añadir el bridge `20261010013257_restaurant_cloud_transition_bridge_v1.sql` de #352.
4. Añadir después el SQL final `20261010013258_restaurant_admin_supervision_r1.sql`.
5. Construir un único directorio temporal con rutas únicas y aplicar en orden ascendente por la versión de 14 dígitos. El conjunto resultante tendría 315 archivos. La revisión estática de ambas fuentes no encontró una referencia directa de `restaurant_atomic_settlement_3d1` a `license_neutral_identity_r1`: la primera instala funciones financieras de Restaurante y la segunda reemplaza RPC de creación de licencias sobre tablas existentes. Confirmar el replay limpio antes de autorizar; este análisis de referencias no sustituye la prueba de instalación.
6. Verificar contra el catálogo aislado: tablas, RLS, policies, ACL, firmas, definiciones, triggers, funciones, extensiones, Auth y Realtime. Confirmar Admin desactivado por defecto.

El orden completo de 315 nombres, la procedencia por SHA y las versiones se guardaron en `docs/fixtures/restaurant-staging.migration-manifest.r1.json`. Es una propuesta para replay limpio, no una orden ejecutable; verificar que esos commits siguen siendo los aprobados antes de usarla.

El origen exacto del manifiesto se comprobará otra vez justo antes de autorizar la ejecución. Esta fase no corrió `db reset`, `db push`, `apply_migration` ni SQL DDL. El ref de staging y las credenciales aún no existen como destino autorizado.

Un proyecto nuevo creado actualmente puede usar PostgreSQL 17.11 o posterior, mientras Production e histórico reportan 17.6.1. El repositorio declara pgcrypto y no mostró uso de ltree, btree_gist, pg_graphql ni funciones PGP de cifrado en las migraciones revisadas. Antes de certificar compatibilidad del proyecto nuevo, verificar extensiones y versión provisionada; la actualización 17.11 documenta acciones condicionales para datos e índices existentes. La certificación final también debe comprobar grants explícitos en Data API: los proyectos nuevos ya pueden omitir exposición automática y el cambio se aplica a todos los proyectos el 2026-10-30.

Fuentes: [cambios de PostgreSQL 17.11](https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes), [exposición explícita de tablas al Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [backups](https://supabase.com/docs/guides/platform/backups).

## Vercel, Preview y GitHub Actions

### Vercel

- El proyecto `lanzo-pos` está enlazado a `fdxruli/Lanzo-POS` en el Hobby team. Los dominios devueltos son `lanzo-pos.vercel.app`, `lanzo-pos-fdxrulis-projects.vercel.app` y `lanzo-pos-git-main-fdxrulis-projects.vercel.app`.
- La configuración informa Vite, Node `22.x`, SSO/protección habilitada con alcance `all_except_custom_domains`, password protection apagada y trusted IPs apagadas. No se cambió la protección.
- `package.json` declara Node `24.x`; alinear el runtime efectivo antes de certificar builds de staging. El endpoint de proyecto usado no expuso la propiedad de rama Production. El alias de main sugiere `main`, pero la configuración exacta queda UNVERIFIED.
- El deployment de la rama #352 más reciente es `dpl_4ene3Xf7S3328s5cZTCy4HVcSVt1`, READY, source GitHub, SHA `e12c371252d5c80f192b10ef36792a6881ee69d1`. El API no devolvió un valor explícito para target.
- Se listaron 11 variables de entorno por nombre y ámbito, sin descifrar secretos ni imprimir valores. Ninguna tiene `gitBranch` específico. `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` aplican globalmente a Preview, Production y Development. La URL efectiva de Supabase se comparó en memoria y apunta a Production. Por lo tanto, el riesgo de backend cruzado en Preview es CRÍTICO.
- No apareció una variable llamada `SERVICE_ROLE` o `SECRET_KEY` en el listado de Vercel. Esto no demuestra que el bundle o las funciones remotas estén libres de secretos. La clave publishable es la apropiada para cliente; la clave service_role nunca debe usar prefijo `VITE_`.
- `VITE_LICENSE_SALT` sí se incorpora al navegador. El código lo usa para un hash JavaScript de integridad de almacenamiento local, que no es una frontera de autorización criptográfica. Ese valor no debe tratarse como secreto; usar una configuración QA independiente.
- WhatsApp, Telegram, correo, pagos, webhooks, cron jobs y secretos de Edge Functions no se verificaron como sandbox. `EXTERNAL_SERVICE_ISOLATION=UNVERIFIED`.

La opción de menor impacto es añadir sólo variables Preview específicas para `feat/restaurant-admin-supervision-r1` en el proyecto existente, después de tener el Supabase aislado. Vercel documenta que una variable de Preview específica de rama sobrescribe el valor global sólo en esa rama; otros Previews siguen usando su valor existente. Esta capacidad no se probó ni se configuró. El set mínimo de branch overrides a evaluar es URL Supabase, publishable key y salt cliente QA; cada endpoint de Edge Function y servicio externo debe comprobarse también. Si la rama no puede aislar todos sus destinos, usar un proyecto Vercel QA separado como alternativa.

La protección del proyecto indica SSO activo para deployments salvo dominios personalizados. El acceso efectivo a un Preview no se probó. Un push a una rama no productiva genera un Preview automáticamente; ese Preview seguirá apuntando a Production hasta que se configure y certifique el override. No hacer QA ni visitas con operaciones de escritura allí.

Fuentes: [variables específicas de rama](https://vercel.com/docs/environment-variables/manage-across-environments), [Preview y variables por rama](https://vercel.com/docs/environment-variables), [protección de deployments](https://vercel.com/docs/deployment-protection).

### GitHub Actions

El workflow `.github/workflows/supabase-production-migrations.yml` sólo se dispara por `workflow_dispatch`; exige `refs/heads/main`, SHA exacto de main, versiones esperadas y confirmación exacta `APPLY <versions>` para ejecutar `db push`. El ref productivo está fijado explícitamente. Un push documental a la rama PR no satisface esos controles y no activa ese workflow.

El workflow referencia secretos `SUPABASE_ACCESS_TOKEN` y `SUPABASE_PRODUCTION_DB_PASSWORD`; no se leyeron sus valores. Reglas de aprobación del entorno GitHub `production` quedan UNVERIFIED. La API reportó main sin protección de branch; no hubo escritura ni workflow dispatch.

## Contrato de aislamiento y guardas

Para una autorización futura:

```text
STAGING_SUPABASE_REF != odlrhijtfyavryeqivaa
EXPECTED_STAGING_REF = ref aprobado explícitamente
EFFECTIVE_SUPABASE_URL.ref = EXPECTED_STAGING_REF
TARGET_ENVIRONMENT = staging
STAGING_AUTH / REALTIME / EDGE_FUNCTIONS = proyecto QA
STAGING_BUSINESS_DATA = synthetic only
PRODUCTION_WRITES_FROM_QA = blocked
SERVICE_ROLE_IN_BROWSER = absent
```

Se añadieron validadores locales que:

- rechazan ambiente, URL, ref o ref autorizado ausentes/desconocidos;
- comparan el ref derivado del host Supabase con el ref aprobado y bloquean el ref productivo;
- permiten validar por separado el URL efectivo, el ref objetivo de una migración antes de conectarse y la evidencia de Preview; rechazan refs productivos, desconocidos o que no coinciden con el ref autorizado;
- exigen para Preview el deployment target, rama, SHA, variables branch-specific limitadas sólo a Preview y el mismo ref aislado para Supabase, Realtime y Edge Functions;
- escanean nombres de variables públicas y bundles compilados para detectar claves service_role/secret y referencias productivas;
- no abren conexiones ni ejecutan migraciones.

Los tests usan únicamente refs y secretos ficticios. Resultado local: 16/16 pruebas enfocadas aprobadas. El guard local no certifica Vercel ni Supabase por sí mismo: en Fase 2 recibirá una captura no secreta de configuración y debe complementarse con inspección de bundle y tráfico real de red.

Plantilla sin secretos: `docs/fixtures/restaurant-staging.env.example`.

## Datos sintéticos y permisos

El manifiesto `docs/fixtures/restaurant-staging.synthetic-plan.r1.json` prepara dos tenants QA, identidades lógicas, Staff A/B, Admin QA, dos dispositivos, dos sesiones de Caja, mesas, productos simples, lotes, fracciones, receta, insumos compartidos y cliente sintético de Fiado. No contiene IDs de Production, licencias reales, tokens, contraseñas ni destinatarios reales; los correos terminan en `.invalid`. Especifica mocks o sinks para servicios externos y no es SQL ejecutable.

La secuencia de permiso a certificar permanece:

| Actor | Consulta | Edita mesa propia | Cobra mesa propia | Cobra mesa ajena | Cancela mesa ajena |
|---|---|---|---|---|---|
| Staff A/B | Según permiso | Sí | Sí | No | No |
| Admin QA habilitado por la licencia sintética | Sí | Según contrato de origen | Sí | Sí | Sí |

La edición remota de productos sigue bloqueada. El Admin QA se habilitará sólo en el tenant de prueba y como escenario explícito; la fixture conserva Admin apagado por defecto.

## QA, recuperación y cutover

- Se conserva íntegra la matriz QA-01 a QA-40 en `RESTAURANT.SCOPED.STORAGE.INTEGRATED.QA.CERTIFICATION.R1.md`. Los 40 escenarios integrados continúan BLOCKED hasta staging, identidades sintéticas, Preview aislado y dos dispositivos.
- La preparación cubre pago normal, Split, pago mixto, Fiado/abonos, Caja, inventario por lote, fracciones, recetas, Kitchen, aislamiento tenant, reconexión, recibos e idempotencia. No se ejecutaron ventas ni escrituras financieras.
- El plan de cutover y de reversión durable ya está documentado en `RESTAURANT.FRONTEND.SQL.TRANSITION.R1.md`; todavía no fue simulado. Una reversión SQL no restaura ventas, deuda, caja, Storage, secretos ni configuración externa.
- Production backup y restore readiness siguen UNVERIFIED. Antes de avanzar, documentar método, fecha, retención, PITR/RPO/RTO y permisos por fuente administrativa autorizada. Una restauración de base requiere reconstruir por separado Storage, Auth/config, Edge Function secrets, webhooks y trabajos programados; detener efectos externos antes de restaurar.
- Añadir al ensayo de dispositivos la compatibilidad TLS. El changelog Supabase del 2026-10-12 anuncia retirar un subconjunto de cifrados TLS 1.2 el 2026-11-10; navegadores o sistemas muy antiguos pueden dejar de conectar.

## Aprobaciones requeridas para Fase 2

1. Autorizar crear un Supabase QA independiente en la organización elegida y confirmar cupo Free o coste de plan/compute/add-ons. Ningún proyecto se creó.
2. Autorizar la configuración branch-specific de Preview para #352 y el siguiente build Preview; el Preview actual apunta a Production.
3. Autorizar aplicar el manifiesto SQL y sembrar fixtures únicamente después de verificar el nuevo ref, Auth, Realtime, funciones, ACL/RLS, grants, servicios externos y plan de recuperación.
4. Autorizar por separado las pruebas financieras integradas en staging. No habilita writes, cambios de licencia, migraciones ni deployment en Production.
5. Resolver respaldo/PITR de Production y aprobar costes si se requieren. No es requisito para hacer pruebas sintéticas de staging, pero sí mantiene Production y cutover en HOLD.

## Campos de salida de esta fase

```text
IMPLEMENTATION_STATUS = NEW_STAGING_RECOMMENDED
REPOSITORY = fdxruli/Lanzo-POS
PR338_STATUS = OPEN_DRAFT
PR338_HEAD = fb17e9a43929d54087ab937cb760a8cd6e087c36
PR352_STATUS = OPEN_DRAFT
PR352_HEAD_INITIAL = e12c371252d5c80f192b10ef36792a6881ee69d1
PR352_GATES_STATUS = VERCEL_SUCCESS; ACTION_WORKFLOW_RUNS_NOT_RETURNED
PR354_STATUS = MERGED
MAIN_SHA = 5be67950eea27c1b25db3e8765339222f8217e35
PRODUCTION_PROJECT_NAME = Lanzo
PRODUCTION_PROJECT_REF = odlrhijtfyavryeqivaa
PRODUCTION_PROJECT_STATUS = ACTIVE_HEALTHY
HISTORICAL_STAGING_NAME = Lanzo-staging-historical-r1
HISTORICAL_STAGING_REF = jdnbmvaphvjunwhnxowo
HISTORICAL_STAGING_STATUS = INACTIVE
STAGING_REACTIVATION_FEASIBILITY = POSSIBLE_BUT_UNVERIFIED
STAGING_REACTIVATION_COST = UNVERIFIED
NEW_STAGING_FEASIBILITY = RECOMMENDED_PENDING_CAPACITY_AUTHORIZATION
NEW_STAGING_COST = FREE_IF_QUOTA_AVAILABLE; EXACT_QUOTE_UNVERIFIED
STAGING_OPTION_RECOMMENDED = NEW_SUPABASE_PROJECT
STAGING_OPTION_RATIONALE = HISTORICAL_STATE_UNVERIFIED; NEW_PROJECT_BEST_ISOLATION_AFTER_APPROVAL
VERCEL_PROJECT = lanzo-pos
VERCEL_PREVIEW_ENVIRONMENT = SHARED_PROJECT; NO_BRANCH_OVERRIDE_CONFIGURED
VERCEL_PROJECT_ISOLATION = PREVIEW_SHARED_WITH_PRODUCTION
VERCEL_ENVIRONMENT_VARIABLE_AUDIT = 11_NAMES_ONLY; GLOBAL_PREVIEW_URL_POINTS_TO_PRODUCTION
VERCEL_DEPLOYMENT_PROTECTION = SSO_ENABLED; PREVIEW_ACCESS_NOT_TESTED
PRODUCTION_SUPABASE_ISOLATION = PRODUCTION_REF_IDENTIFIED; NO_QA_WRITES
STAGING_SUPABASE_ISOLATION = NOT_CREATED
AUTH_ISOLATION = UNVERIFIED
REALTIME_ISOLATION = UNVERIFIED
EDGE_FUNCTION_ISOLATION = PRODUCTION_HAS_TWO; STAGING_NOT_CREATED
EXTERNAL_SERVICE_ISOLATION = UNVERIFIED
SERVICE_ROLE_EXPOSURE = NO_NAMED_VERCEL_VARIABLE; BUNDLE_UNVERIFIED
SECRETS_HANDLING = NO_VALUES_PRINTED_OR_COMMITTED
BRIDGE_MIGRATION_STATUS = ABSENT_FROM_PRODUCTION
ADMIN_SQL_MIGRATION_STATUS = ABSENT_FROM_PRODUCTION
PR338_MIGRATION_DEPENDENCIES = NO_DIRECT_DEPENDENCY_FOUND_IN_STATIC_SOURCE_SCAN; CLEAN_REPLAY_REQUIRED
STAGING_MIGRATION_PLAN = MAIN_5BE6795 + THREE_PR338_MIGRATIONS + TWO_PR352_MIGRATIONS; 315_FILES
SYNTHETIC_BUSINESS_FIXTURES = PREPARED_NOT_EXECUTED
SYNTHETIC_STAFF_FIXTURES = PREPARED_NOT_EXECUTED
SYNTHETIC_ADMIN_FIXTURES = PREPARED_NOT_EXECUTED
SYNTHETIC_DEVICE_FIXTURES = PREPARED_NOT_EXECUTED
FINANCIAL_QA_PREPARATION = READY_FOR_AUTHORIZED_STAGING
INVENTORY_QA_PREPARATION = READY_FOR_AUTHORIZED_STAGING
KITCHEN_QA_PREPARATION = READY_FOR_AUTHORIZED_STAGING
QA_01_40_READINESS = BLOCKED
CUTOVER_READINESS = PLAN_DOCUMENTED; SIMULATION_BLOCKED
PRODUCTION_BACKUP_STATUS = UNVERIFIED; FREE_PLAN_HAS_NO_DOWNLOADABLE_DAILY_BACKUPS
PITR_STATUS = UNVERIFIED
RESTORE_PLAN_STATUS = DOCUMENTED; NOT_TESTED
ROLLBACK_PLAN_STATUS = HOLD
GUARD_SCRIPTS_CREATED = YES
GUARD_TESTS_RESULT = 16_PASSED; 0_FAILED
FILES_CHANGED = 7; REPORT, THREE_FIXTURES, TWO_GUARD_FILES, PACKAGE_JSON_SCRIPT
STAGING_CREATED = NO
STAGING_REACTIVATED = NO
MIGRATIONS_APPLIED = NONE
PRODUCTION_SQL_WRITES = NONE
PRODUCTION_DATA_WRITES = NONE
PRODUCTION_FRONTEND_DEPLOYED = NO
PR338_MERGED = NO
PR352_MERGED = NO
REMAINING_BLOCKERS = NEW_STAGING_AND_PREVIEW_ISOLATION_UNAVAILABLE
REQUIRED_USER_APPROVALS = PROJECT_AND_COST; PREVIEW_BRANCH_OVERRIDE; MIGRATION_AND_FIXTURE_APPLY; INTEGRATED_QA
NEXT_ACTIONS = AUTHORIZE_INFRASTRUCTURE_AND_COST_REVIEW; CONFIGURE_BRANCH_ISOLATION; REPLAY_AND_CERTIFY_STAGING
PRODUCTION_DEPLOYMENT_READINESS = HOLD
MERGE_READINESS = HOLD
```
