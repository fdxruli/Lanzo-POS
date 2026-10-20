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

Las pruebas focales de política simulan las fronteras temporales; no cambian el reloj del sistema ni acceden a producción. Una suite agrupada de caja/tenant fue interrumpida por lentitud y luego se dividió en grupos focales; los grupos reportados arriba terminaron con éxito. La comparación unitaria del clasificador PR127 pasó 14/14. El workflow global PR127 ejecuta Base/Candidate completos al abrir el Draft y queda pendiente de GitHub Actions.

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
- PR #365 permanece merged y no se reutiliza.
- Conflictos materiales detectados: ninguno. Hay solapamientos de archivos que requieren revisión futura con PR #357 y #338; #352 no solapa con la autorización auditada.
- Producción/Supabase: sin cambios; migraciones: ninguna.
- Merge: no realizado.
- PR Draft, HEAD final, checks de GitHub y Preview: pendientes de publicación de la rama. El workflow Base/Candidate PR127 se disparará al abrir el Draft.
