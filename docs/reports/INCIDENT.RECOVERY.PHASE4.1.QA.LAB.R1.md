# Lanzo POS — Mini-fase 4.1: laboratorio de recuperación

- PR: [#357](https://github.com/fdxruli/Lanzo-POS/pull/357), OPEN / Draft. Sin merge.
- Rama: `feat/incident-recovery-center-r1`.
- HEAD inicial: `90352f4a782a4ee8ddde093e2fc6993f579f9e6b`.
- Implementación: `93620127552962a3fca297ee4463580df2091a74`.
- Corrección de precache y gate QA: `f3527703b2faf5b78620780441b971b4361199af`.
- Código final del laboratorio: `86a71e9583fef4ac7ace5e549ebac91073d9c188` (incluye aislamiento de deduplicación por resultado del adaptador y apertura externa voluntaria de borrador de prueba).
- Alcance: **LAB_QA**. **ISOLATED_INTEGRATION_QA** pendiente. **PRODUCTION_QA** no autorizada.
- Producción y Supabase: sin cambios; migraciones aplicadas: ninguna.

## Arquitectura e integración

La galería anterior renderizaba el panel real con metadatos y estados visuales, pero no lanzaba una excepción React ni recorría el formulario. Al seleccionar el nivel crítico, `#root` quedaba inerte mientras los controles de la galería permanecían dentro de él: no existía una salida QA accesible.

El laboratorio tiene tres capas:

1. **Orquestador**: `IncidentRecoveryQaGallery.jsx` mantiene escenarios, tema, conectividad simulada, contexto ficticio, acciones y resultados en memoria. No monta rutas comerciales ni inicia el POS.
2. **Implementación real**: la implementación del ErrorBoundary se extrajo, sin duplicarla, a `IncidentErrorBoundary.jsx`. `ErrorBoundary.jsx` continúa siendo el wrapper productivo que inyecta el store, la guarda y la captura originales. El laboratorio inyecta dependencias ficticias a la misma clase, conservando clasificación, captura, presupuesto de reintento, panel y bloqueo crítico reales. También reutiliza `IncidentRecoveryPanel`, `IncidentReportEntry`, el formulario lazy `IncidentReportForm`, `createIncidentReporter`, `createIncidentCapture`, los normalizadores y los constructores reales de comunicación, Telegram y correo.
3. **Adaptadores cerrados**: `src/qa/incidentLabAdapters.js` aporta transporte exclusivamente en memoria, conectividad, portapapeles y contexto. La comparación de snapshots de `recoveryContext` se extrajo a una función pura compartida; no importa controladores comerciales en QA. No se usan mocks globales en la aplicación.

La entrada `incident-qa.html` / `IncidentLabBoot.jsx` es independiente de `main.jsx`. La ruta `/__qa/incident-recovery` se reescribe a esta entrada. Así se evita evaluar el store, la base local, la autenticación y la sincronización comerciales al iniciar la prueba. Los listeners globales productivos de `incidentEventCenter` no se instalan en el laboratorio: la captura y deduplicación se ejercitan con una instancia local, sin contaminar la cola global.

El formulario acepta servicios explícitos. Cuando se inyectan servicios, la ausencia de un transporte produce fallo cerrado y nunca activa el transporte productivo. Sin inyección, conserva la ruta productiva original. Se añadió además una guarda de contexto a la copia del diagnóstico del formulario.

## Excepciones auténticas frente a simulaciones

| Escenario | Mecanismo | Qué certifica y qué no |
|---|---|---|
| QA-01 | Excepción auténtica de render en `RenderFixture`, después de pulsar el disparador | Captura real, clasificación, fallback local, diagnóstico seguro y recuperación. No monta Ventas comercial. |
| QA-02 | Excepción auténtica dentro del fixture de sección administrativa | Shell ficticio conservado, fallback de sección y límite real de un reintento. No provoca fallos de rutas comerciales. |
| QA-03 | Excepción de render del fixture con código ficticio `FINANCIAL_RESULT_UNKNOWN` | Bloqueo crítico real, resultado desconocido, ausencia de reintento y salida QA. No existe transacción financiera. |
| QA-04 | Estado de conectividad inyectado | Offline, timeout y servidor; nunca desconecta físicamente la red ni envía al reconectar. |
| QA-05 | Errores RPC ficticios pasados por normalizadores reales | `PGRST202`, temporal, autorización, inesperado e indisponible; autorización no se eleva a bloqueo crítico. No llama RPC real. |
| QA-06 | Errores ficticios del adaptador de almacenamiento | Base no disponible, apertura rechazada, esquema incompatible y acceso denegado. No abre ni crea IndexedDB. |
| QA-07 | Formulario real con transporte QA | Consentimiento, campos compartidos, descripción opcional, diagnóstico, estado de fallo y copia local. |
| QA-08 | Éxito del reporter validado internamente y convertido a resultado QA | Validación del formato del recibo, contexto, deduplicación e invalidación. No certifica recepción real. |
| QA-09 | Constructor real del resumen y enlace oficial de compartir | Mensaje marcado como prueba, sin descripción libre ni folio ficticio; destinatario elegido manualmente. Apertura real de Telegram pendiente de dispositivo. |
| QA-10 | Constructor real de borrador hacia `example.invalid`, con inspección local | Asunto, cuerpo saneado, sin envío ni apertura automática del cliente. Cliente de correo del dispositivo pendiente. |
| QA-11 | Snapshots QA-A/QA-B y QA-OWNER/QA-STAFF | Guardas reales de contexto; envío y comunicación anteriores invalidados, incluso durante una respuesta pendiente. No certifica RLS del backend. |
| QA-12 | Repetición del fixture y captura real local | Deduplicación por clave segura; errores distintos conservan identidad distinta; envío simultáneo contenido. |
| QA-13 | Excepción dentro del transporte QA | Reporter falla sin bucle, falsa recepción, recarga ni pérdida de controles. |
| QA-14 | Demostración visual explícita y controles de tema/estado | Permite inspeccionar gravedad no crítica, estado y disponibilidad de acciones. No debe registrarse como prueba de un fallo real. |

El selector de recuperación permite retirar el fallo después de capturarlo y probar el reintento real; también permite mantenerlo para agotar el presupuesto. Una recuperación confirmada no vuelve a fallar por cambiar el tema o registrar resultados.

## Garantías y prueba de aislamiento

- Identidades exclusivamente ficticias. Sin licencias, tokens, sesiones, credenciales o dispositivos reales.
- Transporte de `createIncidentReporter` sustituido explícitamente por una función en memoria. No se reutiliza el cliente Supabase productivo.
- Ninguna llamada de pago, ventas, caja, outbox, DB o revocación. No se instala, elimina ni modifica un Service Worker desde QA.
- La conexión simulada no modifica `navigator.onLine` ni la red del navegador.
- Capturas, guardas, resultados y registro de hasta 30 acciones en memoria; resultados solo cambian mediante decisión manual. Se exporta únicamente por acción explícita. Observaciones limitadas a 500 caracteres y rotuladas como datos QA que deben revisarse.
- Cambio de contexto invalida las guardas previas, limpia la copia/borrador de inspección y reinicia la deduplicación de captura para el nuevo contexto.
- Tests de interacción incluyen tripwires que fallan si se carga el store, Supabase o autenticación productivos, si se usa `fetch` o si se escribe en Storage. El escenario de almacenamiento comprueba que `indexedDB.open` no se invoca.
- El registro no dice «cero tráfico observado» a partir de un contador fijo: muestra llamadas al adaptador en memoria. La evidencia de no transporte remoto proviene de los tripwires y del cierre de imports estáticos del bundle; una captura de red en navegador sigue siendo QA adicional.

## Folios ficticios y canales externos

El reporter real valida internamente una referencia con formato aceptado. El adaptador QA suprime esa referencia y devuelve `QA_SIMULATED_ACK` con estado no disponible para la UI. Por tanto, el formulario **no recibe `sent` ni un folio ficticio**, y nunca muestra «Lanzo recibió el reporte» para una simulación. La regla productiva de confirmación por backend no cambia.

Todos los estados muestran `SIMULACIÓN — NO ENVIADO A SUPABASE`. El constructor QA de comunicación fuerza diagnóstico local, añade «PRUEBA QA. No es una incidencia registrada» y excluye referencias. La copia tiene una segunda defensa que elimina referencias con formato `IR-…`. Se deduplican respuestas ficticias de éxito por contexto/incidente y resultado del adaptador. La secuencia recepción ficticia → excepción del reporter tiene un test de regresión: no puede reutilizar el éxito anterior.

Telegram utiliza `https://t.me/share/url`; abrirlo requiere una acción manual y no cambia el estado del reporte. No se asume que el canal público admite mensajes directos. El correo tiene destinatario deliberadamente no entregable `qa-no-enviar@example.invalid` y el enlace del formulario se intercepta para inspeccionar el borrador en memoria. Tras inspeccionarlo se ofrece por separado «Abrir borrador de prueba en correo»: apertura externa voluntaria, siempre hacia `.invalid`, sin folio ficticio y con advertencia de no enviarlo. El feedback dice que se solicitó abrirlo y conserva inspección local si no hay cliente asociado. No se envía un falso reporte a soporte real.

## Bloqueo crítico y accesibilidad

Se conserva el `inert` y `aria-hidden` productivos sobre `#root`. El panel real se monta en un host QA fuera del root. Dentro del propio `alertdialog` se inyectan únicamente los controles QA «Salir de la prueba» y «Reintentar operación» deshabilitado, además del rótulo de simulación. No se añade una salida a la UI productiva.

Escape desmonta el fixture; Tab/Shift+Tab permanecen dentro del host activo; al salir se restaura `inert`, el atributo original y el foco en el selector. El caso crítico → salir → nivel 1 sin recarga tiene prueba de interacción. Un control adicional con StrictMode verifica que el replay de lifecycles de desarrollo conserva el bloqueo y permite salir. Los controles usan regiones/encabezados, labels, `aria-expanded`, estados anunciados, foco visible, altura mínima de 44 px y movimiento reducido. La disposición es de dos columnas en escritorio y vertical por debajo de 768 px; sin tarjeta contenedora gigante.

**Limitación:** semántica y foco están probados en DOM renderizado. Contraste computado, lector de pantalla, scroll y layout reales a cada ancho requieren inspección de navegador; no se declaran PASS a partir de jsdom.

## Exclusión productiva

- Vite solo añade `incident-qa.html` a los inputs cuando `VERCEL_ENV === 'preview'`. Un `VITE_INCIDENT_QA_PREVIEW=true` por sí solo no lo habilita en producción.
- En desarrollo, un middleware reescribe exclusivamente la ruta exacta QA. No existen query parameters ni endpoints que activen inyección desde rutas comerciales.
- El build productivo falla si encuentra módulos `src/qa` o `IncidentRecoveryQaGallery` en los chunks, aunque la ruta estuviera oculta.
- Un auditor posterior escanea archivos JS/HTML/CSS emitidos y rechaza nombres o marcadores de capacidades QA. Se probaron controles negativos con módulos y marcadores camuflados.
- El build Preview recorre el cierre estático real de los chunks QA y falla si incluye `src/store` o servicios comerciales de DB, auth, sync o Supabase. Emite `incident-qa-isolation.json` como evidencia.
- La ruta productiva apunta a un HTML que no se emite; además, los módulos ejecutables QA están ausentes del artefacto. La seguridad no depende únicamente de mostrar un 404.
- El primer Preview detectó cuatro dependencias compartidas del shell no incluidas en precache debido a la entrada múltiple de Vite. Se añadieron únicamente los chunks reales `buttons`, `contextSnapshotGuard` y `recoveryContext` a las globs existentes (JS/CSS explican los cuatro archivos). No se modifica `src/pwa/sw.js` ni su política de navegación, seguridad o recuperación; los entrypoints/fixtures/adaptadores QA permanecen fuera del precache comercial.

## Pruebas y evidencia automatizada

| Comprobación | Resultado comprobado |
|---|---|
| Nuevos tests del laboratorio | 33/33 PASS: 26 interacciones/adaptadores (incluido StrictMode) y 7 de arquitectura con controles negativos |
| Regresión funcional amplia | 489/489 PASS en 51 archivos: laboratorio, ErrorBoundary, diagnóstico, reporter, comunicación, soporte, PWA, bootstrap, finanzas y tienda pública |
| Laboratorio + arquitectura PWA con artefactos | 45/45 PASS |
| Arquitectura general, artefactos disponibles | 95 PASS / 50 SKIP; dos suites bloqueadas por preparación de paquetes en este host |
| Bloqueo de paquete admin | `cp EEXIST` en directorio temporal; reproducido también en BASE `b684357…` con el mismo host/dependencias. No corresponde a un fallo del laboratorio. |
| Bloqueo de paquete público | La preparación exige checkout limpio y CLI `vercel`; tras limpiar checkout, el bloqueo concreto es CLI ausente. Build y auditoría del artefacto público sí aprobaron. |
| ESLint focal | PASS sin errores ni warnings del código modificado |
| Build administrativo productivo + postbuild | PASS; 25 recursos de arranque verificados |
| Build Preview + postbuild | PASS; 31 recursos de arranque verificados |
| Build público y `build:store:vercel` | PASS; auditoría sin violaciones |
| Auditor de exclusión productiva | PASS; 44 JS/HTML/CSS auditados, 0 artefactos QA |
| Auditor de cierre estático Preview | PASS; 9 chunks en el cierre QA, 0 módulos comerciales |
| Contrato SQL de Fase 3 | 4/4 PASS; contrato estático, sin aplicar migración |
| `git diff --check` | PASS |

La primera ejecución amplia de arquitectura se lanzó antes de disponer de los artefactos públicos y produjo ENOENT. Se corrigió el orden de preparación y se separó esa falta de entorno de los resultados funcionales; no se cambiaron ni relajaron sus pruebas. La descarga local de Chromium falló (archivo de distribución incompleto); no se presentan capturas locales ficticias.

## CI y Preview

Preview de código: [Abrir laboratorio](https://lanzo-d2dhipqf1-fdxrulis-projects.vercel.app/__qa/incident-recovery).
Deployment `dpl_3478s5JSCPyGcsught9c86VDtAp6`, proyecto `lanzo-pos`, entorno Preview, commit `86a71e9583fef4ac7ace5e549ebac91073d9c188`: **READY**. Fetch autenticado del conector: HTTP 200, título «Lanzo POS — Laboratorio QA», entrypoint QA presente.

| Gate en 86a71e9 | Estado |
|---|---|
| [Laboratorio QA](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990166) | SUCCESS |
| [Store Git Runtime](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990152) | SUCCESS |
| [Ecommerce Public](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990076) | SUCCESS |
| [Dexie Recovery](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990220) | SUCCESS |
| [PR127 Global Comparison](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990066) | SUCCESS — 99 compartidos, 0 candidate-only, 0 nuevos, 1 resuelto, 0 sin resolver |
| [Actor Runtime](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990205) | SUCCESS — 0 regresiones nuevas; 2 suites completas por lado; 350 repeticiones focales por lado |
| [Actor Scoped Storage](https://github.com/fdxruli/Lanzo-POS/actions/runs/38840990046) | SUCCESS — 0 regresiones nuevas; 2 suites completas y 350 repeticiones focales por lado |

Artefacto PR127 `pr127-global-comparison-86a71e9583fef4ac7ace5e549ebac91073d9c188`, ID `12021627221`: descargado y JSON diferencial inspeccionado, `status=OK`, 0 fallos nuevos y 0 sin resolver. El color verde no se usa como única evidencia del diferencial.

Artefacto Actor Runtime `shared-terminal-full-suite-differential`, ID `12021634568`: JSON inspeccionado. BASE: 5,114 PASS / 75 FAIL / 52 SKIP; CANDIDATE: 5,267 PASS / 75 FAIL / 52 SKIP, en dos suites por lado. Clasificación: 93 observaciones de fallos preexistentes, 0 regresiones nuevas, 1 observación solo en BASE; 0 regresiones semánticas o de tasa en los siete objetivos focales.

Artefacto Actor Scoped Storage `shared-terminal-3-full-suite-differential-38840990046`, ID `12022067446`: JSON inspeccionado. Dos suites por lado, con los mismos totales BASE/CANDIDATE descritos arriba; 350 repeticiones focales por lado, 93 observaciones preexistentes, 0 regresiones nuevas y 1 observación solo en BASE. Los controles de envío duplicado y sus controles negativos finalizaron en el workflow.

El workflow nuevo ejecuta interacciones, tripwires, lint y builds de producción/Preview con sus auditores. Los seis gates existentes no se debilitaron ni se cambiaron sus scripts.

## Evidencia visual y límites de acceso

La navegación real desde Work llegó al login de Vercel, coherente con Deployment Protection activa. Se intentó autenticación mediante el flujo seguro del navegador; la verificación no terminó porque Vercel rechazó el código introducido. No se desactiva protección ni se solicitan secretos en chat.

No hay todavía capturas válidas del laboratorio en navegador. No se atribuye este bloqueo externo de autenticación a un error JavaScript de Lanzo. No se reproduce ni se explica como resuelto el incidente previo de Android que abría/cerraba un enlace: requiere comparar navegador integrado con Chrome usando el nuevo Preview inmutable.

| Evidencia solicitada | Estado real |
|---|---|
| Desktop claro/oscuro | BLOCKED: acceso de navegador a Preview no autenticado |
| 320/360/390/430 px; 768/1024 px; 1280/1440 px | NOT RUN: emulación exacta no disponible en la interfaz de navegador de esta sesión |
| Android físico / Chrome Android / navegador integrado | NOT RUN: requiere dispositivo del propietario |
| Error React, sección, crítico y salida | PASS en interacción DOM automatizada; captura visual pendiente |
| Formulario, offline, backend no disponible, copia, Telegram, resultados | PASS en interacción DOM automatizada; captura visual pendiente |
| Selector externo Telegram y cliente de correo del SO | NOT RUN; no se envía ningún mensaje |
| Contraste, lector de pantalla, zoom y ausencia de overflow real | NOT RUN |

## Checklist manual exacto — Android y escritorio

Abrir el Preview inmutable indicado, usando una cuenta Vercel autorizada. En Android preferir «Abrir en Chrome» si se parte de una aplicación con navegador integrado. Si aparece Vercel, completar su acceso antes de diagnosticar Lanzo. No cambiar la protección, borrar datos ni desregistrar el Service Worker de ningún negocio.

1. Confirmar el encabezado del laboratorio, el commit y ambos rótulos de datos ficticios. No debe aparecer login comercial, caja ni catálogos reales. Si aparecen, detener la prueba y registrar BLOCKED.
2. QA-01: pulsar «Provocar error de componente». Comprobar fallback local y controles activos. Abrir detalles. En «Recuperación del fixture» elegir retirar fallo y pulsar «Reintentar». Debe reaparecer el fixture; cambiar tema no lo rompe.
3. QA-02: provocar fallo de sección. Mantener el fallo y pulsar «Reintentar sección». Comprobar que «Reintento utilizado» queda deshabilitado y el shell ficticio continúa disponible.
4. QA-03: provocar bloqueo financiero ficticio. Confirmar resultado desconocido y «Reintentar operación» deshabilitado. Usar «Salir de la prueba» o Escape. Confirmar foco en selector, elegir QA-01 y ejecutar otra prueba sin recargar.
5. QA-04: seleccionar cada conexión simulada, generar incidente, abrir formulario, consentir y enviar al adaptador. Offline debe conservar 0 llamadas al transporte y permitir copia. No se desconecta físicamente el navegador.
6. QA-05: recorrer códigos RPC, generar incidencia y revisar categoría/normalización. Seleccionar también el resultado equivalente del adaptador para comprobar la normalización del envío. Autorización no debe ocultar todo el laboratorio.
7. QA-06: recorrer cuatro errores de almacenamiento. No debe aparecer limpieza de datos, borrado de outbox ni acceso a base comercial.
8. QA-07: abrir «Reportar problema». Verificar botón deshabilitado sin consentimiento, descripción opcional y lista de campos. Consentir y ejecutar el envío QA. Copiar diagnóstico; para probar el portapapeles real seleccionar «Copia manual al navegador» y pegar en un editor local antes de compartir.
9. QA-08: generar, consentir y enviar con confirmación ficticia. Debe decir que es ficticia, sin folio visible ni «Lanzo recibió el reporte». Preparar/copy mensaje: no debe contener `IR-` ni descripción libre.
10. QA-09: preparar y revisar mensaje de prueba. Pulsar «Abrir opciones de Telegram» solo si se desea probar la aplicación externa. Revisar selector y destinatario; cancelar. No enviar mensajes ni asumir DM del canal oficial.
11. QA-10: preparar mensaje y pulsar «Inspeccionar borrador local». Abrir el inspector del borrador: destinatario `example.invalid`, asunto de seguimiento y cuerpo de prueba. La inspección no debe abrir una aplicación externa ni enviar soporte real. Opcionalmente, pulsar «Abrir borrador de prueba en correo» para revisar el cliente asociado y cancelar; si no abre, conservar la inspección local y registrar la limitación.
12. QA-11: con mensaje preparado, cambiar tenant y después actor. Deben desaparecer las opciones externas del mensaje anterior; envío y copia obsoletos se rechazan. Generar un incidente nuevo. Repetir el cambio mientras el adaptador muestra envío en curso.
13. QA-12: provocar varias veces el mismo fallo; revisar captura deduplicada. Probar un error distinto y comprobar identidad/clasificación distinta. Dos pulsaciones de enviar no deben iniciar dos transportes simultáneos.
14. QA-13: enviar con excepción del reporter. Confirmar fallo sin éxito, bucle ni recarga; preparar/copiar diagnóstico y cambiar de escenario.
15. QA-14: inspeccionar claro/oscuro, estados visuales y disponibilidad de acciones. Repetir por cada ancho solicitado; comprobar scroll natural, objetivos táctiles, foco, Tab/Shift+Tab, Enter/Espacio, detalles plegables, contraste y movimiento reducido. No marcar PASS solo por abrirlo.
16. Registrar manualmente PASS/FAIL/BLOCKED/NOT RUN en cada escenario y observaciones únicamente de QA. «Copiar resumen QA» exporta la sesión; revisar antes de compartir. Recargar borra el registro de la sesión.

## Certificación final e infraestructura

El laboratorio no certifica recepción real, persistencia SQL, autorización/RLS, retención/rate-limit del servidor, sesiones revocadas, integridad Dexie tras fallos reales, transacciones ambiguas ni recuperación tras cortes reales. El staging histórico inactivo no se ha usado ni restaurado. No se aplicó la migración de reportes preparada en Fase 3.

La certificación final requiere proyecto/base y perfil de navegador aislados, datos ficticios, respaldo/restauración comprobados, credenciales QA, bloqueo de pagos y correo saliente y el plan `INCIDENT.RECOVERY.CONTROLLED.FAILURE.QA.PLAN.md`. No se cambia este requisito por aprobar el laboratorio. No se autoriza producción ni merge.

## Estado de entrega

Este informe separa implementación verificada, LAB_QA automatizada, QA visual pendiente e integración aislada no realizada. El commit final de documentación añade también el control de StrictMode, sin cambiar el código de los adaptadores ni de recuperación; su CI se consulta en el PR antes de cerrar la mini-fase.

```text
MINI_PHASE_4_1_STATUS: IMPLEMENTED; AUTOMATED_LAB_PASS; SEVEN_CODE_WORKFLOWS_PASS; VISUAL_QA_BLOCKED
PR_NUMBER: 357
PR_URL: https://github.com/fdxruli/Lanzo-POS/pull/357
BRANCH: feat/incident-recovery-center-r1
HEAD_INITIAL: 90352f4a782a4ee8ddde093e2fc6993f579f9e6b
HEAD_FINAL: 86a71e9583fef4ac7ace5e549ebac91073d9c188 (CODE; DOCUMENTARY HEAD IN PR)
LAB_IMPLEMENTATION: IMPLEMENTED; INDEPENDENT QA ENTRY; MEMORY-ONLY ADAPTERS
REAL_REACT_ERROR_SCENARIO: PASS_AUTOMATED; VISUAL_PENDING
SECTION_RECOVERY_SCENARIO: PASS_AUTOMATED
CRITICAL_BLOCKER_SCENARIO: PASS_AUTOMATED; EXIT/FOCUS/ESCAPE; NO FINANCIAL CALL
SUPABASE_FAULT_SIMULATION: PASS_AUTOMATED; NO REAL CLIENT
INDEXEDDB_FAULT_SIMULATION: PASS_AUTOMATED; NO DATABASE OPENED
REPORT_FORM_INTEGRATION: PASS_AUTOMATED; REAL FORM + CLOSED TRANSPORT
MOCK_RECEIPT_SAFETY: PASS_AUTOMATED; MOCK REFERENCE NEVER REACHES UI/SENT/SHARE
TELEGRAM_QA: BUILDER/PRIVACY/CONTEXT PASS; EXTERNAL CHOOSER NOT RUN
EMAIL_QA: LOCAL DRAFT PASS; OPTIONAL EXTERNAL .invalid DRAFT IMPLEMENTED; DEVICE NOT RUN
ACTOR_TENANT_ISOLATION: PASS_AUTOMATED; FICTITIOUS CONTEXTS; SERVER RLS NOT CERTIFIED
OFFLINE_QA: PASS_AUTOMATED; INJECTED CONNECTIVITY; NO REAL DISCONNECTION
RESPONSIVE_QA: IMPLEMENTED; REQUESTED REAL VIEWPORTS NOT RUN
ACCESSIBILITY_QA: SEMANTICS/FOCUS/KEYBOARD PASS_AUTOMATED; VISUAL CONTRAST/AT PENDING
PRODUCTION_BUILD_QA_EXCLUSION: PASS; MODULE GRAPH + EMITTED EXECUTABLE AUDIT
AUTOMATED_TESTS: LAB 33/33 (INCLUDES STRICTMODE); BROAD 489/489 BEFORE EXTRA STRICTMODE CONTROL; SQL STATIC 4/4
PR127_RESULT: SUCCESS; 99 SHARED / 0 CANDIDATE-ONLY / 0 NEW / 1 RESOLVED
ACTOR_RUNTIME_RESULT: SUCCESS; 0 NEW REGRESSIONS; 2X FULL SUITE + 350 FOCUSED RUNS PER SIDE
ACTOR_SCOPED_STORAGE_RESULT: SUCCESS; 0 NEW REGRESSIONS; 2X FULL SUITE + 350 FOCUSED RUNS PER SIDE
DEXIE_RESULT: SUCCESS
ECOMMERCE_RESULT: SUCCESS
STORE_GIT_RUNTIME_RESULT: SUCCESS
PREVIEW_URL: https://lanzo-d2dhipqf1-fdxrulis-projects.vercel.app/__qa/incident-recovery
MANUAL_QA_CHECKLIST: 16 STEPS IN THIS REPORT; OWNER EXECUTION PENDING
REAL_FAILURE_CERTIFICATION: LAB FIXTURE EXCEPTIONS VERIFIED; ISOLATED INTEGRATION DEFERRED
SUPABASE_MIGRATIONS_APPLIED: NONE
PRODUCTION_CHANGES: NONE
CRITICAL_BLOCKERS: NO LAB FUNCTIONAL BLOCKER FOUND; VISUAL EVIDENCE BLOCKED BY BROWSER AUTH; ISOLATED BACKEND ABSENT
READY_FOR_OWNER_QA: YES (MANUAL VISUAL/DEVICE QA REQUIRED)
READY_FOR_ISOLATED_CERTIFICATION: NO
READY_FOR_PRODUCTION: NO
MERGE_STATUS: NOT_MERGED
```
