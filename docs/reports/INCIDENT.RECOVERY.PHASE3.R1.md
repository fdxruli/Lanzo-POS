# LANZO-POS — Fase 3: sistema unificado de incidencias

- **Estado de desarrollo:** COMPLETADO para Fase 3; código y documentación publicados en el mismo PR.
- **Certificación real:** diferida; pruebas controladas no ejecutadas.
- **PR:** [#357 — feat: unified incident recovery and reporting](https://github.com/fdxruli/Lanzo-POS/pull/357)
- **Rama:** `feat/incident-recovery-center-r1`
- **HEAD inicial verificado:** `e097e4988a817f7aa2383a49e801279f6643d4bb`
- **HEAD de código validado:** `581570c5616f7f35eb4aa28c5b69541222963551`
- **HEAD final del PR:** el commit de cierre que incorpora estos dos informes; el SHA exacto figura en la cabecera vigente del PR #357. El código funcional se validó en `581570c5616f7f35eb4aa28c5b69541222963551`.
- **Producción:** sin cambios; migraciones no aplicadas; PR sin merge y en Draft.

## Decisiones de QA y alcance

Se registran los estados ordenados por el propietario:

```text
PHASE_2_VISUAL_REVIEW = OWNER_ACCEPTED
PHASE_2_REAL_FAILURE_QA = DEFERRED
PHASE_3_DEVELOPMENT = AUTHORIZED
PRODUCTION_RELEASE = NOT_AUTHORIZED
```

No se provocaron fallos reales ni se modificaron negocios, cajas, ventas, pedidos, pagos, sesiones productivas o IndexedDB comercial. El plan de fallos controlados de la próxima certificación está en [`INCIDENT.RECOVERY.CONTROLLED.FAILURE.QA.PLAN.md`](./INCIDENT.RECOVERY.CONTROLLED.FAILURE.QA.PLAN.md); todos sus escenarios permanecen `DEFERRED / NOT RUN`.

## Preparación y auditoría

- Se verificó el HEAD inicial del PR #357 contra GitHub antes de editar. El PR sigue siendo el único PR de esta fase; se conserva abierto y Draft.
- `main` verificada en la auditoría: `b6843578409b62e7efce941aa4b819d304d9d661`.
- El workflow PR127 Global Comparison en el HEAD inicial reportaba 99 fallos baseline compartidos, 0 fallos nuevos y 1 resuelto. Actor Runtime, Actor Scoped Storage, Dexie Recovery y Ecommerce Public estaban `SUCCESS` en ese HEAD. Estos resultados son previos al código Fase 3.
- PR #338 y PR #352 permanecen abiertos/Draft. Se identificaron rutas compartidas: #338 incluye `App.jsx`, `main.jsx` y `vite.config.js`; #352 incluye `UpdatePrompt`, el Service Worker administrativo y pruebas PWA. No se modificaron `App.jsx`, `main.jsx` ni los archivos del Service Worker. `vite.config.js` añade la precarga del formulario lazy y tres dependencias del cierre de arranque administrativo. Vercel detectó inicialmente que faltaban `IncidentReportEntry`, `incidentCapture` y `localTenantGuard`; se añadieron al patrón de precache y el build administrativo local volvió a pasar el audit. La configuración sigue requiriendo revisión al integrar #338.
- Se leyeron los informes de Fases 1 y 2 y se revisó el conjunto de cambios de Mini-Fase 2.1 antes de implementar.
- Se revisaron `incidentDiagnostics`, `recoveryContext`, `incidentEventCenter`, `ErrorBoundary`, `devConsoleCapture`, `Logger`, `supportContact`, `supportTicketService`, los límites de autenticación/actor y el cliente de sincronización.
- La documentación de Supabase consultada cubre funciones de base de datos, seguridad de API y RLS: [Database Functions](https://supabase.com/docs/guides/database/functions), [Securing your API](https://supabase.com/docs/guides/api/securing-your-api), [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security). No se ejecutó ninguna escritura remota.

### Hallazgos Supabase de lectura

- El proyecto productivo existente está activo; no se creó ni activó otro proyecto.
- El esquema tiene tickets y mensajes comerciales de soporte con RLS habilitado y sin políticas directas de API. El acceso actual se hace mediante RPCs `SECURITY DEFINER` y capacidades comerciales. No sirve como canal Free sin alterar el perímetro PRO.
- La ruta de soporte comercial aplica capacidades PRO. El canal técnico de este diseño es independiente y no consulta `support_center`, `support_tickets` ni `support_channel`.
- Existe `private.validate_pos_sync_context(...)`, que valida licencia/entitlement, dispositivo, token de dispositivo y sesión/actor. Devuelve el `license_id` asociado al contexto validado; el cliente no manda un ID de negocio. La comprobación de entitlement de licencia sigue siendo obligatoria, pero el canal no exige comprar soporte PRO.
- No existe una tabla `private.technical_incident_reports`. La tabla privada de incidentes operativos existente se usa para notificaciones internas y no es un almacén de diagnósticos de usuario.
- `pg_cron` ya está instalado en el proyecto consultado. La migración solo agenda la limpieza si existe el esquema; no habilita extensiones.
- Asesores de seguridad/performance devolvieron hallazgos heredados de políticas/índices en otras tablas. No son introducidos ni corregidos por este cambio y se deben seguir por su propio alcance.
- El staging histórico está inactivo. Sin una base aislada operativa no hay certificación SQL en vivo; se agregaron contrato estático y tests con adaptadores simulados.

## Arquitectura y contrato

### Servicio central

`src/services/diagnostics/incidentCapture.js` y `src/services/diagnostics/incidentReporter.js` separan captura local del envío:

- la captura ligera recibe errores sin importar Supabase; `incidentReporter.js` normaliza fallos backend y clasifica errores esperados;
- identificadores opacos de incidente/correlación y fingerprint estable sobre valores seguros;
- deduplicación acotada en memoria (30 segundos; hasta 100 firmas recientes);
- construcción de payload por allowlist y validación de tamaño/texto;
- consentimiento, guardia de contexto actor/tenant, adaptador RPC cargado solo al confirmar y normalización de respuesta;
- respuesta `sent` solo con `success: true` y un folio `IR-<16 hex>` confirmado por la RPC;
- copia local sin guardar reportes en IndexedDB, localStorage, sesión ni outbox comercial;
- resumen breve preparado para una futura extensión de canal, sin bot ni envío a Telegram.

El schema enviado es `schema_version: 1`. No contiene licencia, tokens, cookies, dispositivo, actor/tenant, parámetros de URL, stack, mensaje crudo, estado Zustand, filas de IndexedDB, clientes, ventas, pagos, caja, cuerpo RPC o request/response. `safe_route` se reduce a una ruta permitida; la fingerprint solo usa código/categoría/gravedad/sección seguros. El estado de reporte vive en la UI; el servidor guarda el estado `received` confirmado, sin confiar en un `report_status` del cliente.

`normalizeBackendError` diferencia `expected_business`, `transient_connectivity`, `service_failure`, `authorization`, `financial_outcome_ambiguous`, `integrity` y `unexpected`, además de categoría/gravedad. `captureBackendIncident` es la puerta explícita para puntos de servicio. No se reportan por defecto warnings ni validaciones/permisos esperados. El resultado financiero ambiguo conserva gravedad `critical_blocker` y el reporter nunca importa ni reintenta una operación financiera.

El límite de `posSyncClient.pullSyncEvents` conecta el rechazo real de `pos_pull_sync_events` al centro de avisos mediante `captureServiceIncidentNotice`. La captura no cambia el error propagado ni repite la RPC; el código `42501` queda como rechazo de negocio esperado. El test verifica un aviso saneado para `PGRST202`, ausencia de secreto/importe/cliente y ausencia de aviso para la validación esperada.

### Captura e interfaz

- ErrorBoundary registra una ficha saneada y conserva sus mecanismos de recuperación y bloqueo existentes.
- Los listeners ya instalados por `devConsoleCapture` siguen siendo la única captura global de `error` y `unhandledrejection`; el reporter no instala duplicados ni reenvía logs de consola.
- `incidentEventCenter` aplica deduplicación y muestra avisos suaves para fallos globales relevantes; `AdminIncidentNotice` da acciones de reporte.
- La ruta lazy administrativa y el gate de IndexedDB producen fichas estructuradas en el mismo servicio. El gate no borra ni inspecciona el contenido del almacenamiento.
- ErrorBoundary, DatabaseRecoveryGate, eventos globales y rutas lazy usan el módulo de captura local. El formulario se carga al pulsar «Reportar problema»; Supabase y el contexto de actor solo se consultan al confirmar el envío. Renderizar recuperación y copiar offline no depende del backend.
- `IncidentReportForm` explica los campos automáticos, separa texto opcional no sanitizado, requiere consentimiento activo, informa estados reales y mantiene copia disponible. Abrir mailto o copiar no se presenta como recepción del backend. El chunk del formulario se incluye en la precarga del shell administrativo.

Estados UI: `not_started`, `ready`, `sending`, `sent`, `failed`, `offline`, `unavailable`. Si el RPC todavía no existe, el cliente informa indisponibilidad y permite copiar. No hay cola offline ni retry automático.

## Backend preparado, sin despliegue

Migración preparada y diferida: `supabase/archive/unresolved-migrations/20261015134821_technical_incident_reporting_r1.sql`.

- Tabla privada `private.technical_incident_reports`, sin privilegios directos de `anon`, `authenticated` ni `service_role`; RLS activo y acceso de tabla reservado al rol dueño.
- RPC estrecha `public.submit_technical_incident_report(...)`, `SECURITY DEFINER`, `search_path = ''`, permiso de ejecución revocado primero y otorgado explícitamente solo a `anon`/`authenticated`. La RPC valida consentimiento, allowlist exacta, versión, formatos, ruta/módulo, 10 KB y texto libre máximo de 500 caracteres.
- La RPC llama `private.validate_pos_sync_context`, deriva `license_id` de la respuesta autorizada, serializa la recepción por licencia, deduplica por `(license_id, incident_id)` con digest y limita a 10 reportes por licencia/hora.
- Solo la recepción persistida entrega folio; rechazos no indican recepción. No hay RPC de lectura para clientes ni acceso cross-tenant.
- Retención diseñada: 90 días; función privada acotada a 5.000 borrados por ejecución y job nombrado idempotente si `pg_cron` existe.
- El campo opcional de usuario se almacena como texto libre consentido y acotado; el servidor no afirma que esté sanitizado. La tabla almacena el reporte confirmado, no datos comerciales.

**Estado SQL:** migración versionada y revisada estáticamente; no aplicada; no probada contra una base aislada activa. La función no debe anunciarse como backend operativo hasta que se revise y aplique en una base autorizada por un proceso separado.

## Privacidad y matriz Free / PRO

| Capacidad | Lanzo Local (Free) | Lanzo Nube (PRO) |
|---|---|---|
| Crear/copiar diagnóstico local | Sí, sin red y sin guardar cola | Sí |
| Enviar reporte técnico | Sí, con licencia/dispositivo/actor válidos, consentimiento e internet; sin requisito de ticket PRO | Sí, bajo los mismos controles |
| Tickets/canales comerciales PRO | No se habilitan por el reporte técnico | Se conservan por sus capacidades actuales |
| Consulta de reportes por el cliente | No; el cliente recibe solo el folio confirmado | No; el cliente recibe solo el folio confirmado |

El formulario muestra qué se comparte y qué se excluye. La descripción libre se trata separadamente y el usuario confirma que también quiere compartirla. No existe telemetría automática ni recolección masiva.

## Resultados de pruebas y CI

### Matriz automatizada Fase 3

Los tests nuevos usan errores sintéticos, reloj/transportes simulados, allowlists y contrato SQL estático. No son certificación de SQL ni de fallos de un dispositivo real.

| Grupo | Cobertura añadida |
|---|---|
| IR-01/03/04/05/06/07/08/10/12/13/14/15/16/18/19/22 | Reporter unitario: captura React/backend/IndexedDB, warnings y permisos esperados, normalización, redacción, deduplicación, guardia de contexto, Free, offline, unavailable, folio, límite de descripción, fallo aislado y ausencia de persistencia comercial. |
| IR-02 | Evento global asíncrono, categoría segura y deduplicación entre `error` y rechazo global. |
| Consentimiento UI | Test de explicación, descripción, checkbox obligatorio, folio de respuesta y copia local. |
| IR-09/17/20/21 | Contrato SQL estático: sesión validada, derivación server-side del tenant, rechazo genérico, llave de idempotencia, rate limit, RLS/grants y límites. No certifica transacciones reales. |
| IR-11 | Servicio de tickets PRO no se modifica; se reejecutan sus tests de regresión. |

Resultados locales tras integrar el límite RPC: reporter, captura React/asíncrona, formulario, recuperación y sincronización **95/95 PASS** en 11 archivos; PWA/arquitectura focal **36/36 PASS**; contrato SQL estático **4/4 PASS**; ESLint focal **PASS**; builds administrativo y público **PASS**. El audit local verificó 23 recursos de arranque y 0 rutas Local eager. La preview Vercel del HEAD `581570c` está **READY**: `https://lanzo-d6g808g01-fdxrulis-projects.vercel.app`; su log verificó 28 recursos de arranque y 0 rutas Local eager. Ecommerce Public, Dexie Recovery y Store Git Runtime terminaron `SUCCESS`. [PR127 Global Comparison](https://github.com/fdxruli/Lanzo-POS/actions/runs/38752179430) terminó `SUCCESS`: 99 fallos compartidos, 0 nuevos candidate-only, 0 baseline intermitentes, 1 resuelto y 0 identidades sin resolver. [Actor Runtime](https://github.com/fdxruli/Lanzo-POS/actions/runs/38752180054) terminó `SUCCESS`: BASE 5.114/75/52 y CANDIDATE 5.214/75/52 (PASS/FAIL/SKIP en dos repeticiones por lado); 93 fallos preexistentes compartidos, 1 fallo observado solo en BASE, 0 regresiones nuevas; 350/350 ejecuciones focales pasan en BASE y CANDIDATE. [Actor Scoped Storage](https://github.com/fdxruli/Lanzo-POS/actions/runs/38752179457) también terminó `SUCCESS`: BASE 5.114/75/52 y CANDIDATE 5.214/75/52 en ambas repeticiones; 93 fallos estables compartidos, 1 observación solo en BASE, 0 candidate-only; 350/350 invocaciones focales por lado y 50/50 controles de envío duplicado por lado pasaron. Los negativos que desactivan la guarda de envío único y la aserción de historial detectaron ambos defectos inyectados. El full suite local previo reportó **5.207 PASS / 80 FAIL / 52 SKIP**; el diferencial PR127 confirma que no hay candidate-only nuevo.

## Dependencias con PR #338, PR #352 y Fase 4

- #338 (rutas/arranque administrativo) y #352 (Service Worker/PWA) siguen abiertos y Draft. `vite.config.js` es compartido con #338: el cambio solo suma el chunk CSS/JS del formulario a la precarga, y requiere revalidación integrada al combinar ramas. No se modificó el Service Worker de #352.
- Fase 4 podrá agregar un adaptador de canal y un resumen basado en folio confirmado. No debe enviar el diagnóstico sensible por enlaces externos ni depender de que el canal Telegram acepte mensajes directos.
- La RPC solo existe en la migración local; habilitar envío backend, probar Free/PRO con sesiones reales QA y desplegar el canal requiere revisión y despliegue aislados separados.

## Riesgos y limitaciones

1. La tabla, RPC, permisos y retención no se han aplicado ni probado en Supabase aislado; el modo remoto todavía es `unavailable` cuando no exista la función.
2. El modelo personalizado de sesión de actor se valida con la función existente. Debe certificarse con usuarios Free y PRO ficticios antes de producción; una licencia expirada o contexto local no listo puede bloquear el envío y dejar solo la copia local.
3. El texto voluntario del usuario es libre, no se limpia automáticamente, y se almacena por hasta 90 días tras confirmación. Debe revisarse con privacidad antes de cualquier despliegue.
4. La deduplicación frontend es en memoria y por 30 segundos; la idempotencia durable depende de la migración aplicada.
5. La captura automática limitada de eventos globales no sustituye instrumentación explícita en todos los `catch` de Edge Functions o servicios que consumen errores.
6. No se certificó el flujo en un POS físico, PWA instalada, red interrumpida ni operación financiera real.

## Estado de liberación

Fase 3 queda lista para el desarrollo de Fase 4 en alcance de comunicación complementaria basada en folio; la recepción remota continúa cerrada hasta revisión/aplicación autorizada de la migración en un entorno aislado. Esto no es autorización de producción.

```text
INCIDENT_REPORTER_STATUS = IMPLEMENTED; consent and backend confirmation enforced
FRONTEND_INTEGRATION = IMPLEMENTED
BACKEND_INTEGRATION = PREPARED; NOT DEPLOYED
SUPABASE_SCHEMA_STATUS = PRIVATE SCHEMA AND RPC PREPARED; NO ISOLATED DB TO CERTIFY
MIGRATIONS_PREPARED = YES
MIGRATIONS_APPLIED = NONE
SECURITY_AUDIT = STATIC REVIEW PASS; LIVE CROSS-TENANT TEST DEFERRED
FREE_PRO_PERMISSIONS = TECHNICAL REPORT OPEN TO VALID CONTEXT; PRO COMMERCIAL SUPPORT UNCHANGED
OFFLINE_REPORTING = LOCAL COPY ONLY; NO QUEUE
AUTOMATED_TESTS = FOCAL AND REQUIRED CI PASS AT CODE HEAD 581570c
CONTROLLED_FAILURE_QA_PLAN = PREPARED; NOT RUN
REAL_FAILURE_QA_STATUS = DEFERRED
PRODUCTION_CHANGES = NONE
CRITICAL_BLOCKERS = NO ISOLATED SUPABASE DB; SQL RECEIPT AND CROSS-TENANT AUTH NOT CERTIFIED
READY_FOR_PHASE_4 = YES, DEVELOPMENT ONLY; FOLIO-ONLY CHANNEL EXTENSION
READY_FOR_PRODUCTION = NO
MERGE_STATUS = NOT_MERGED; PR OPEN / DRAFT
```
