# Lanzo POS — Fase 2: auditoría de continuidad Admin offline

## Estado de auditoría

- `main` remoto verificado antes del trabajo: `a09b224cc1aff671f4a29152f21b9d9d12173f20` (merge de PR #365).
- Rama nueva: `feat/admin-offline-continuity-extended-r1`, creada desde ese SHA.
- Checkout original conservado sin cambios; contiene archivos sueltos ajenos a esta fase.
- PR #365 está `MERGED`.
- No se modificó producción, Supabase remoto, esquema, RLS ni datos.
- Esta matriz se preparó antes de modificar código de la Fase 2.

## Matriz de dependencias y riesgos

| Componente | Control actual | Dependencia / riesgo observado | Cambio de política requerido |
|---|---|---|---|
| `src/services/supabase.js` | `hasValidOfflineAdminSession()` acepta `last_valid_admin_session` por hasta 24 h desde `validatedAt`; revisa `expiresAt` si existe. Token e ID de sesión se almacenan en claves separadas. | La marca se escribe en el cliente después de respuesta positiva, pero el registro actual no fija token, sesión, admin, dispositivo ni tenant a esa marca. | Guardar evidencia versionada solo desde respuesta positiva; exigir vínculo con credenciales actuales, identidad, dispositivo y lease tenant. Mantener una ventana única de 168 h y el vencimiento de servidor retornado. |
| `supabase.js` — reloj local | `security_monotonic_clock` conserva el mayor `Date.now()` visto. Retrocesos de hasta 24 h usan el valor anterior; retrocesos mayores bloquean la validación de licencia. Una validación de licencia online puede corregir el reloj. | El reloj vive en almacenamiento del navegador; no es monotónico de hardware ni evidencia firmada. El cambio de zona horaria no cambia el epoch; un ajuste manual sí. | La política Admin mantiene su propio mayor instante visto y deniega cualquier retroceso tras reinicio; no reutiliza la tolerancia de 24 h de licencia. No actualiza `validatedAt` por apertura/reintento y deniega tiempos futuros/sospechosos. |
| `src/services/auth/actorSessionRuntimeBridge.js` | `assertAuthenticatedActorSessionCurrent()` repite un máximo de 24 h y revisa `expiresAt`; la restauración canónica exige familia de credenciales no ambigua, Admin ID, sesión, dispositivo y Tenant Runtime. | Es un segundo límite independiente. Los handles y generación protegen respuestas obsoletas y la transición entre tenant/actor. | Eliminar el cálculo temporal local duplicado y delegarlo a la política común; conservar las comprobaciones de handle, generación, tenant y dispositivo. |
| `src/services/auth/actorRuntimeController.js` | La concesión exige identidad estable, ID de sesión y lease tenant; los handles revisan generación, dispositivo y tenant activo. | `generation` es de proceso y protege concurrencia, no constituye una fecha de expiración persistida. | Mantenerlo como defensa de concurrencia; no usarlo para iniciar ni renovar la ventana offline. |
| `src/services/auth/actorScopedStorage.js` | Claves de datos se derivan de tenant opaque ID y actor; token de contexto detecta otra pestaña y suspende escrituras. | Protege aislamiento y writes, pero no valida la autoridad Admin ni el reloj. | No cambiar su esquema; la restauración debe pasar por Actor Runtime antes de habilitar sus consumidores. |
| `licenseBootstrapActions.js` | Admin moderno intenta fallback local solo cuando `navigator.onLine` es falso o la clasificación es `transport_unavailable`; restaura Actor Runtime antes de seguir. Staff conserva ruta online. | `SERVER_ERROR` es inconcluso y hoy no activa continuidad. Los resultados de licencia 72 h no son autorización Admin. | Consultar una sola política para cada fallback Admin. Permitir errores de transporte, HTTP 5xx y rate limit conocido; denegar 401/403 de gateway, respuestas inválidas y códigos desconocidos. Staff sigue bloqueado offline. |
| `licenseAdminActions.js` | La recuperación post-login del PR #364 verifica el mismo token/sesión existente; no crea sesión ni dispositivo nuevo. El fallback requiere un actor pendiente y `hasValidOfflineAdminSession()`. | Esta ruta debe recibir el mismo límite y los mismos fallos técnicos elegibles que bootstrap. Una denegación autoritativa se bloquea antes del fallback. | Mantener el contrato del #364; usar la política común y conservar los guards de snapshots, logout, tenant y respuestas tardías. |
| `licenseProcessingActions.js` | `_processOfflineMode()` aplica `localExpiry` local de hasta 30 días, vencimiento comercial y gracia; si faltan marcas, hoy puede derivar `localExpiry` desde `activated_at` o `Date.now()`. | Es una autoridad de licencia/producto distinta. No debe ampliar una sesión Admin ni convertir un permiso offline de licencia en autenticación. | La política Admin tomará `localExpiry` y vencimiento/gracia como límites superiores. La ventana Admin no mutará `expires_at` ni `localExpiry`; la elegibilidad Admin no se basará solo en licencia. |
| `licenseGuards.js` | Vencimiento comercial y periodo de gracia limitan operaciones; estados locales incompletos pueden requerir resolución remota. | Un negocio puede seguir en gracia con permisos limitados; la sesión no debe durar más que el final de gracia. | Capar la autorización al vencimiento comercial o al final de gracia, el que corresponda; no transformar gracia en sesión. |
| `licenseStorage.js` | `localExpiry` se establece normalmente a 30 días; la firma implementada es un hash JavaScript local con salt de build. | La firma no es prueba criptográfica de autoridad del servidor y el almacenamiento es editable por el propietario del navegador. | Usarla solo como límite local y nunca como prueba de sesión Admin. No renovar ni extenderla desde la política nueva. |
| Guardas de tenant/dispositivo | `localTenantGuard` mantiene binding sticky por `license_id` o hash de licencia y bloquea tenant distinto; Supabase contrasta token de dispositivo/fingerprint y Actor Runtime vuelve a comprobar deviceRef. | Las claves Admin se leen desde la base scoped al tenant activo; identidad global en localStorage no basta para evitar una asociación cruzada. | Persistir y comparar el opaque ID del Tenant Runtime y la identidad de licencia del servidor junto con el fingerprint canónico de dispositivo. Denegar si no coinciden. |
| `licenseStaffActions.js` / bootstrap Staff | Credenciales Staff se verifican en servidor; no existe fallback Staff offline. | Riesgo de elevación si la política común acepta el rol a partir de `device_role` o licencia. | Rechazar cualquier sesión Staff y credenciales Admin/Staff simultáneas ambiguas. |
| Pruebas actuales | `supabase.indexedDbBootstrap.test.js` cubre 23/24/25 h, futuros y `expiresAt`; `adminLoginRecovery.integration.test.js` cubre continuidad del actor pendiente y expiración. Hay suites de bootstrap, Actor Runtime/Scoped Storage, tenant y licencia. | No hay una matriz completa de 168 h, binding entre prueba/tokens/actor/tenant/dispositivo, reloj adelantado/atrasado ni error 5xx con `navigator.onLine=true`. | Añadir pruebas temporales con reloj simulado y regresiones de clasificación/restauración. No alterar fecha del SO ni datos reales. |

## Contrato de servidor constatado

La migración versionada `20260722222305_license_admin_auth_1_foundation.sql` define `license_admin_sessions.expires_at` como `timestamptz NOT NULL` con default de 30 días. El RPC `verify_admin_session` valida hash del token, sesión no revocada, expiración, dispositivo y propietario activo. Su respuesta positiva hereda de `private.require_active_admin_session` el vencimiento real en `expires_at`; `details.expires_at` es el vencimiento comercial de la licencia. Login/enrollment retornan `admin_session_expires_at`. El cliente reconoce estos campos según la ruta y nunca confunde el vencimiento comercial con el de sesión.

El cliente debe usar el `admin_session_expires_at` real de la respuesta positiva y denegar continuidad si falta, es inválido o ya venció. El default de 30 días describe creación de sesión en servidor; no autoriza al cliente a presumir esa duración ni extender el valor recibido. No se requiere cambio de backend para limitar el cliente a 168 h, pero el cliente offline no puede observar revocaciones posteriores hasta reconectar.

## Decisión propuesta y riesgo temporal

Adoptar una ventana máxima de **168 horas** desde una respuesta positiva Admin persistida. La elegibilidad final vence en el mínimo estricto entre: `validatedAt + 168 h`, el `admin_session_expires_at` recibido, `localExpiry`, vencimiento comercial o fin de gracia aplicable y los bloqueos locales conocidos. En la frontera de expiración se deniega (`effectiveNow >= expiresAt`). Ninguna apertura, lectura, restauración, reintento fallido, operación local o marca `last_check_failed` renueva el inicio.

Riesgo aceptado: una sesión revocada remotamente mientras el dispositivo permanece completamente offline puede conservar autoridad local hasta el límite efectivo anterior. Siete días reducen la ventana respecto de los 30 días máximos de sesión del contrato y no prometen revocación instantánea. La ventana es producto/seguridad, no evidencia de que el servidor siga disponible.

Reloj: la política persiste el último epoch observado durante la evaluación y, al reabrir la aplicación, deniega cualquier retroceso detectable. Mientras la app sigue abierta, Actor Runtime usa tiempo monotónico del proceso para no extender su deadline ante retrocesos del reloj de pared. El cambio de zona horaria no altera epoch. Aun así, el reloj del sistema y IndexedDB/localStorage son controlables por quien controla el dispositivo; el piso local no es evidencia criptográfica y no puede demostrar cuánto tiempo transcurrió si también se altera el almacenamiento. Esta defensa detecta ajustes ordinarios y falla cerrada, pero no afirma resistencia absoluta contra manipulación local. Para esa garantía se requeriría evidencia temporal firmada por servidor y revisar el contrato backend, fuera del alcance y sin autorización para cambiarlo.

## GitHub y compatibilidad

PRs abiertos revisados al comenzar: #357 Draft (base histórica `31fadba...`), #338 Draft (base histórica `a7cd1ef...`) y #352 Draft (base #338). #352 no toca los archivos de autorización auditados. #357 comparte el modal Admin, pero sus cambios son copy de recuperación de incidencias. #338 comparte AdminLoginModal, Actor Runtime/Bridge y `licenseProcessingActions`: sus hunks actuales agregan diagnóstico/cierre de recuperación de autoridad y manejo de errores; no cambian el límite temporal ni el RPC de sesión. Hay solapamiento que deberá revisarse al integrar esos PRs, pero no se encontró incompatibilidad funcional que impida esta rama. PRs vecinos no se modificarán.

## Contrato de política para implementar

- Resultado determinista y estructurado; denegar por defecto cuando falte evidencia.
- Autoridad solo para Admin con token e ID de sesión presentes, familia Staff ausente, identidad igual a la persistida, binding actual de dispositivo/tenant y restauración Actor Runtime exitosa.
- La prueba se escribe solamente en la ruta de respuesta Admin positiva verificada, conserva el vencimiento servidor y queda ligada a sesión, Admin, licencia/tenant y dispositivo.
- `transport_unavailable`, HTTP 5xx y rate limit reconocido pueden usar continuidad local ya autorizada; 401/403 ambiguo, código desconocido, respuesta inválida y denegación autoritativa no conceden autoridad. Fallo de almacenamiento, evidencia incompleta, actor/tenant/device incoherente o tiempo sospechoso deniegan.
- Staff permanece online-only. Vencer la ventana bloquea la operación y conserva ventas, catálogo, caja y transacciones locales para revalidación legítima posterior.

## Implementación Fase 2

Se centralizó la decisión en `src/services/auth/adminOfflineAuthorization.js`. La política v2 define una ventana exacta de 168 horas desde el instante local capturado inmediatamente después de una respuesta positiva Admin del servidor y persistida junto con la sesión. El evaluador es determinista, retorna motivo y vencimiento efectivo, falla cerrada, y no crea ni renueva evidencia. En la igualdad exacta del vencimiento (`effectiveNow >= expiresAt`) deniega.

La prueba local se escribe solo desde `buildAdminSessionResult()` cuando el backend confirmó éxito. Está enlazada a digest del token Admin, ID de sesión, Admin ID, licencia/tenant, ID y fingerprint estable del dispositivo y digest del token de seguridad del dispositivo. Cada restauración vuelve a comparar esos valores con credenciales canónicas actuales y con el Actor Runtime. Credenciales Admin y Staff simultáneas, Staff solo, tenant distinto, actor incompatible, almacenamiento no disponible y prueba legada sin vínculo suficiente deniegan. La comprobación `hasValidOfflineAdminSession()` ahora delega al evaluador central.

El permiso efectivo es el mínimo entre 168 h, expiración concreta de la sesión informada por la ruta del backend, `localExpiry`, vencimiento comercial o fin de gracia aplicable. La licencia conserva su propio comportamiento; no se modifica `expiresAt`, `localExpiry` ni la ventana comercial. Los bloqueos conocidos (revocación, dispositivo liberado o límite excedido) deniegan. Los fallos de transporte, HTTP 5xx y `SESSION_RATE_LIMITED` conocido pueden usar evidencia vigente incluso si `navigator.onLine` es `true`; 401/403, respuesta inválida/desconocida y rechazo autoritativo no tienen fallback. Staff sigue online-only.

Actor Runtime conserva el vencimiento efectivo y lo comprueba en accesos/handles; al vencer bloquea el actor e invalida escrituras scoped, sin borrar ventas ni otros datos. Al iniciar de nuevo, la política verifica primero y la restauración debe completar Actor Runtime antes de abrir la operación. La ruta de reintento existente verifica la misma sesión persistida y solo actualiza evidencia en nueva respuesta positiva; no crea una sesión ni registra otro dispositivo.

### Límite de reloj

La marca `validatedAt` es el epoch local leído inmediatamente después de la respuesta positiva, no un timestamp firmado por servidor. La política persiste el mayor tiempo visto y deniega cualquier retroceso detectable tras reinicio. Actor Runtime usa reloj monotónico del proceso mientras permanece abierta la app. Un cambio de zona horaria no cambia epoch. Al estar offline no hay fuente confiable para medir el tiempo transcurrido mientras la app estaba cerrada; una persona con control del dispositivo puede alterar el reloj y el almacenamiento local. Por ello esta mitigación detecta ajustes ordinarios y falla cerrada ante contradicciones detectables, pero no ofrece integridad criptográfica. Obtener esa garantía requiere evidencia temporal firmada o validable por servidor y un contrato/backend revisado; no se fabricó esa garantía ni se cambió el backend.

### Archivos cambiados

- `src/services/auth/adminOfflineAuthorization.js` (nuevo): política, motivos, expiraciones, clasificación de errores seguros y copy de recuperación.
- `src/services/supabase.js`: prueba versionada vinculada solo al camino positivo; lectura/evaluación central; separación entre expiración de sesión y licencia; preserva el fallback de licencia de 72 h como concepto independiente.
- `src/services/auth/actorRuntimeController.js` y `src/services/auth/actorSessionRuntimeBridge.js`: deadline efectivo y expiración del actor.
- `src/store/slices/license/licenseBootstrapActions.js` y `src/store/slices/license/licenseAdminActions.js`: fallback en bootstrap y recuperación post-login por la misma política.
- Pruebas asociadas de política, bootstrap, Supabase, Actor Runtime/bridge, scoped storage y recuperación Admin.
- Este reporte.

### Comprobaciones automatizadas

| Suite | Resultado |
|---|---:|
| `adminOfflineAuthorization.test.js` — matriz `OFFLINE-AUTH-P2` | PASS, 45/45 |
| `indexedDbPrimaryKeyRecovery.test.js` — recuperación Dexie | PASS, 17/17 |
| Guardas/aislamiento tenant, autoridad Admin Free, catálogo e inventario Free y outbox/sync tenant | PASS, 46/46 en 7 archivos |
| Caja local, gate financiero, reconciliación downgrade y recuperación de red | PASS, 35/35 en 4 archivos |
| Actor Runtime Controller | PASS, 20/20 |
| Actor login recovery integration | PASS, 43/43 |
| Bootstrap coordinator | PASS, 10/10 |
| Admin recovery y tests de acciones Admin | PASS, 22/22 |
| Supabase IndexedDB bootstrap | PASS, 20/20 |
| Actor bridge y Actor Scoped Storage | PASS, 20/20 |

Las pruebas focales de política simulan las fronteras temporales; no cambian el reloj del sistema ni acceden a producción. Una suite agrupada de caja/tenant fue interrumpida por lentitud y luego se dividió en grupos focales; los grupos reportados arriba terminaron con éxito. La comparación unitaria del clasificador PR127 pasó 14/14. El workflow global PR127 (run `39364599153`) terminó `SUCCESS`: tanto Candidate como Base corrieron y el comparador reportó 100 fallos compartidos, 0 fallos raw solo en Candidate, 0 fallos nuevos, 0 identidades no resueltas y 0 fallos flaky preexistentes clasificados. El reporte descargado quedó en el artefacto `pr127-global-comparison-03275a370a057af52dbbc20130f2eedc5d9022bd`.

`npm run build`: PASS; Vite transformó 3,593 módulos y `postbuild` confirmó 21 assets de arranque. El build mantiene advertencias de división dinámica/estática de chunks y patrones de precache sin coincidencia (incluyendo cinco assets legacy y rutas Local estáticamente importadas); el audit de precache finalizó correctamente. ESLint sobre los 14 JavaScript modificados: PASS, 0 errores y 0 warnings tras retirar un import sin uso. ESLint mostró la notificación informativa de que el dataset `baseline-browser-mapping` tiene más de dos meses.

### Matriz de QA manual para el propietario

| Caso | Preparación / acción | Resultado esperado |
|---|---|---|
| A, día 2 | Admin Free verificado, cerrar PWA, permanecer 48 h offline y abrir | Restaura el mismo Admin/tenant si la sesión y licencia siguen dentro de sus límites. |
| B, día 5 | Repetir sin comunicación por cinco días | Continúa solo hasta el límite efectivo más estricto. |
| C, frontera | Usar reloj simulado en prueba automatizada; en app comprobar justo antes y después de 168 h | Antes puede continuar; igualdad y cualquier instante posterior quedan bloqueados. |
| D, reconexión | Restaurar red, reintentar verificación de la sesión existente | Autoridad normal, mismo actor/tenant/dispositivo, sin login ni sesión/dispositivo duplicado. |
| E, revocación remota | Revocar durante desconexión y reconectar | No se puede detectar hasta reconexión; después de confirmación, deniega la evidencia anterior. |
| F, Wi-Fi sin backend | Mantener `navigator.onLine=true`, bloquear Supabase para timeout/5xx y luego probar 401/403 | Fallback local solo para timeout/transporte, 5xx y rate-limit conocido; auth denial no usa fallback. |
| G, Staff | Reabrir con credenciales Staff y red ausente | Sin sesión Staff offline. |
| H, downgrade | Pro → Free con bloqueo/límite conocido | Respeta límites y reconciliación vigentes; no cierra caja automáticamente. |
| Dispositivo móvil | Probar portrait/landscape, viewport pequeño, teclado, bottom bar y lector de pantalla en estados concedido/vencido | No modal invasivo durante continuidad válida; copy de revalidación legible y acción de reintento accesible. |

La matriz manual y los flujos físicos de cierre/reapertura quedan para QA del propietario en el Draft Preview; aquí se validó la política y las rutas automatizadas sin manipular el reloj del SO ni datos productivos.

## Estado de rama y entrega

- HEAD inicial de `main`: `a09b224cc1aff671f4a29152f21b9d9d12173f20`.
- Rama: `feat/admin-offline-continuity-extended-r1`.
- PR #366 Draft: https://github.com/fdxruli/Lanzo-POS/pull/366.
- HEAD de código del PR: `03275a370a057af52dbbc20130f2eedc5d9022bd` (commit `feat(auth): add bounded admin offline continuity`).
- PR #365 permanece merged y no se reutiliza.
- Conflictos materiales detectados: ninguno. Hay solapamientos de archivos que requieren revisión futura con PR #357 y #338; #352 no solapa con la autorización auditada.
- Vercel Preview `Ready`: https://lanzo-pos-git-feat-admin-offline-conti-519026-fdxrulis-projects.vercel.app. `vercel curl` autenticado devolvió el shell HTML de Lanzo; el acceso visual/interactivo móvil queda para QA propietario.
- Checks focales de GitHub, Dexie, builds y PR127 Base/Candidate: `SUCCESS`. Los jobs observacionales extendidos de repetición de suite Candidate/Base de los workflows Shared Terminal Actor Runtime/Actor Scoped Storage permanecían `in_progress` al último sondeo; sus jobs focales (auth, tenant, runtime, sync, caja, lint y builds) completaron `SUCCESS`.
- Producción/Supabase: sin cambios; migraciones: ninguna.
- Merge: no realizado.

## Mini-Fase 2.1 — recuperación de evidencia Admin

### Auditoría del incidente y causa raíz

El HEAD inicial del PR #366 fue `34881231a0e43f37c8fa546c871b64323b20f4b1`; su base en la API del PR continúa registrada como `a09b224cc1aff671f4a29152f21b9d9d12173f20`. La referencia remota `main` ahora apunta a `f014a1f340ed78335d3e704eefff49cda8465115` tras PR #357. Se inspeccionaron los contratos SQL locales de `admin_login_on_device`, `admin_takeover_free_device`, `admin_enroll_owner_on_device` y `verify_admin_session`; no se llamaron RPC de producción.

La discrepancia que causaba la pérdida de autoridad quedó confirmada: las tres respuestas positivas de inicio/takeover/enrolamiento no devuelven raíz `license_id` ni `device_id`, mientras que `verify_admin_session` obtiene ambos de `private.require_active_admin_session`. El fixture de `supabase.indexedDbBootstrap.test.js` antes incluía esos dos campos en la respuesta de login, condición que no cumple el contrato SQL real. Con el contrato real, `createPersistedAdminOfflineEvidence()` devolvía `null`; el cliente persistía credenciales, pero Actor Runtime denegaba con `evidence_missing`. La acción de recuperación del PR #364 también descartaba el resultado pendiente al primer bloqueo y no podía volver a verificar la misma sesión.

Se reprodujo además, como incompatibilidad separada y no como causa única demostrada del incidente físico, el caso de un tenant histórico vinculado solo por `license-key-sha256:<digest>`. El guard sticky permite el tenant correcto sin añadir alias `license-id`; el generador/evaluador v2 antes exigía ese alias y denegaba evidencia. La compatibilidad nueva exige que el digest guardado en evidencia coincida exactamente con el alias histórico persistido y que el servidor confirme, dentro de la misma sesión, el `license_id` y `device_id`. No se amplía la lista de alias ni se hace rebind.

### Corrección y contrato final

Cuando la respuesta positiva de login/takeover/enrolamiento carece de los identificadores canónicos, el cliente hace una sola llamada adicional a `verify_admin_session`, con el mismo `admin_session_token`, token de seguridad, fingerprint estable y clave del negocio. Solo acepta la respuesta si está verificada, devuelve el mismo `admin_session_id`, la identidad Admin es consistente y están presentes licencia, dispositivo y vencimiento real de sesión. No usa otra llamada de login, inscripción, takeover ni registro de dispositivo para completar evidencia. En revalidación de sesión existente, la verificación ya completada se reutiliza sin volver a llamar al RPC.

La evidencia v2 se escribe solo cuando sus datos canónicos están completos. Guarda digest de sesión/dispositivo, ID de Admin/sesión/licencia/dispositivo, tenant opaco, binding local compatible y expiración real del servidor. Para un binding histórico por hash de clave, el evaluador lo reconoce solo si el digest de evidencia válido coincide con el alias sticky. Fallos de red conservan credenciales cuando corresponde, pero no crean autoridad; una denegación autoritativa limpia la continuidad y bloquea. La acción post-login mantiene el resultado pendiente si falta evidencia y permite reintentar la verificación existente; Actor Runtime sigue cerrado hasta que el evaluador común conceda autoridad.

`validatedAt` se captura al recibirse una respuesta positiva verificada, antes de persistencia/perfil y se persiste junto con la evidencia. No se genera desde apertura, restauración, error, reintento offline ni navegación. La elegibilidad sigue limitada por las mismas 168 horas, expiración de servidor, licencia local/comercial/gracia y bloqueos conocidos; no se cambia licencia, `expiresAt` ni política Staff.

Se agregaron trazas temporizadas de RPC, persistencia local, disponibilidad IndexedDB, restauración/concesión de Actor Runtime y perfil. Registran fases, duración, estado y códigos diagnósticos con prefijos permitidos; omiten tokens, contraseñas, fingerprints, claves de licencia y datos financieros. El watchdog de 15 segundos de `App.jsx` es una alerta de inicialización, separada de `evidence_missing`. No hay una traza de la sesión física de Chrome disponible, así que no atribuimos el retraso reportado a RPC, IndexedDB, actor o perfil sin observación directa.

### Cobertura automatizada AUTH-P2-REC

La prueba de login ahora usa la forma positiva real sin `license_id`/`device_id` y verifica las llamadas en orden (`admin_login_on_device`, `verify_admin_session`), sus argumentos y la evidencia persistida; el reinicio simulado lee la evidencia ya guardada. Otras pruebas cubren alias histórico y nuevo, tenant/Admin/dispositivo incompatibles, fallo de almacenamiento, recuperación de la sesión pendiente, denegación autoritativa, Staff online-only, ventana de 168 h, expiraciones, logout/respuestas tardías, dos pestañas/generación Actor Runtime y handoff financiero. Takeover Free e inscripción inicial verifican la sesión emitida con credenciales de dispositivo existentes. La revalidación no vuelve a invocar login/takeover/enrollment, por lo que no consume otro cupo ni crea sesión/dispositivo.

| Verificación | Resultado |
|---|---:|
| AUTH-P2-REC focal: Supabase, política offline, acciones Admin | PASS, 84/84 en 3 archivos |
| OFFLINE-AUTH-P2, Actor Runtime/Bridge/Scoped Storage, recuperación Admin, bootstrap, tenant, FREE, Dexie, caja y financiero | PASS, 265/265 en 17 archivos |
| PR127 global-comparison classifier unit tests | PASS, 14/14 |
| ESLint focal sobre los archivos modificados | PASS, 0 errores; aviso informativo: `baseline-browser-mapping` tiene más de dos meses |
| React Doctor sobre cambios de interfaz | PASS, 90/100; sin hallazgos en 15 archivos |
| `npm run build` + `postbuild` | PASS; 3,593 módulos, worker generado y auditoría con 21 assets de inicio verificados |
| GitHub PR127 global Base/Candidate, run `39376922424` sobre `e51a6ef` | FAIL: 99 fallos compartidos, 1 candidato exclusivo, 0 sin clasificar. El candidato es `src/tests/ErrorBoundary.test.jsx` (`__FILE_FAILURE__`, `expect is not defined`). El blob de ese test es idéntico al de la base `a09b224`; el run base no produjo evidencia para ese archivo. El fallo local ocurre al importar `@testing-library/jest-dom` sin `expect` global. La versión actual en `main` fue reescrita por #357 y no es la que contiene el HEAD remoto del PR. |

Workbox emitió advertencias de seis patrones de precache sin coincidencia (incluye rutas Local importadas estáticamente y cinco assets legacy); el audit final confirmó todos los assets de inicio requeridos. Vite también reportó imports mixtos estático/dinámico y el chunk vacío `vendor_supabase`. No son errores de compilación. La matriz se ejecutó con reloj simulado/fixtures; no se modificó el reloj del sistema ni datos locales reales.

### Compatibilidad, entrega y QA físico

Los PR abiertos #338, #352 y #357 se revisaron; no se modificó ninguno. #338 comparte rutas Admin/Actor y #352 no solapa la autorización auditada. PR #357 actualizó `main` de `a09b224cc1aff671f4a29152f21b9d9d12173f20` a `f014a1f340ed78335d3e704eefff49cda8465115`. Los cambios de autorización de #366 se combinan automáticamente con esa base. Una sincronización local completa con `main` encontró un conflicto textual en `src/tests/ErrorBoundary.test.jsx`, reescrito por #357, y habría incorporado 3,934 commits que la API del PR aún no refleja en su `base.sha`. Esa sincronización no se conservó ni se envió. El código de aplicación de #366 permanece en `e51a6ef35c50306980273f045093e4e17b7a4a8f`; la revisión del reporte añadida a continuación no cambia fuentes. No se forzó la actualización de base ni se envió un merge a la rama remota.

En el HEAD de aplicación `e51a6ef`, los checks focales de autenticación/bootstrap, Dexie, calidad, Actor Runtime/tenant, almacenamiento scoped, sync, POS, lint, builds y Vercel Preview están `PASS`. El check `compare-global-suite` de PR127 está `FAIL` por el caso descrito arriba. Las repeticiones completas Base/Candidate de los workflows Shared Terminal Actor Runtime y Actor Scoped Storage seguían `in_progress` al último sondeo. El commit de reporte no altera código de aplicación; Vercel marcó `Ready` el preview documental con URL https://lanzo-8m74hklen-fdxrulis-projects.vercel.app. PR #366 sigue abierto en Draft: https://github.com/fdxruli/Lanzo-POS/pull/366.

Para repetir Farmacia Gary Chrome en QA físico: usar el perfil Chrome y el dispositivo Free ya registrados; no liberar dispositivos ni cambiar datos. Con conexión disponible, iniciar sesión Admin con la misma licencia, esperar la confirmación y, si aparece recuperación pendiente, pulsar «Reintentar verificación». Confirmar que se consulta `verify_admin_session` sobre la misma sesión, se restaura el mismo negocio y no aparece un nuevo registro de dispositivo. Cerrar completamente Lanzo/PWA y abrir de nuevo; después comprobar una apertura offline dentro del límite, sin efectuar venta de prueba ni alterar caja. Revisar la consola por códigos/fases seguros y anotar duración de RPC, IndexedDB, Actor Runtime y perfil. QA físico del propietario sigue pendiente.

No se modificó Supabase producción, licencias, dispositivos, usuarios ni sesiones remotas. No se hizo merge. La revocación remota continúa siendo incognoscible mientras el cliente está desconectado y se aplica al reconectar.
