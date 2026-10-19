# Lanzo POS — Offline auth classification R1

## Estado de entrega

- Rama base: `main`, HEAD inicial `31fadba8bdb4f92725d07572e2696f9af20c47ca`.
- PR #364 verificado integrado; no se reabrió ni se reutilizó su rama.
- Rama de trabajo: `fix/offline-auth-error-classification-r1`.
- PR #365: [Draft abierto](https://github.com/fdxruli/Lanzo-POS/pull/365). El primer SHA `ee6beeb553f13f27f8cf24ac3a401b7f62dc15ee` activó checks; registrar el SHA posterior a la corrección de rate limit como final.
- Checks focales, FREE Local y Dexie pasaron en el primer SHA; Actor Device validation y PR127 detectaron la misma regresión de mensaje de rate limit en `activateLicense()`. Actor Runtime y actor scoped storage seguían corriendo cuando se corrigió.
- PR127 Global Comparison en `ee6beeb`: Candidate 5314 passed / 76 failed / 52 skipped; Base 5278 passed / 75 failed / 52 skipped; el comparador identificó 1 regresión nueva en `supabase.deviceRegistry.test.js`. Corregida y cubierta en local; resultado del rerun pendiente.
- Preview Vercel inicial, `READY`, correspondió a `ee6beeb553f13f27f8cf24ac3a401b7f62dc15ee` y respondió HTTP 200 con acceso autenticado. Confirmar deployment del SHA final tras el próximo push.
- Sin modificaciones SQL, migraciones, datos, licencias ni dispositivos; sin despliegue ni merge.

## Causa raíz

En el HEAD base, `verifyAdminSession()` convertía cualquier excepción no local en `{ valid: false, code: 'ADMIN_SESSION_ERROR' }` en `src/services/supabase.js:1780-1808`; `verifyStaffSession()` hacía lo mismo con `STAFF_SESSION_ERROR` en `src/services/supabase.js:782-837`. El bootstrap trataba cualquier `!valid` como rechazo: Staff en `src/store/slices/license/licenseBootstrapActions.js:185-190` y Admin en `:305-314`. `_requireAdminLogin()` bloqueaba Actor Runtime y limpiaba ambas familias de tokens en `src/store/slices/license/licenseAdminActions.js:469-479`; `_requireStaffLogin()` limpiaba Staff y Admin en `src/store/slices/license/licenseStaffActions.js:44-66`. Por tanto, `Failed to fetch`, timeout o gateway podían borrar tokens legítimos como si el servidor hubiese rechazado la sesión.

En el cambio, la clasificación está centralizada en `src/services/auth/sessionVerification.js:1-243`; las verificaciones Admin/Staff conservan evidencia en `src/services/supabase.js:830-920` y `:1867-1984`. El bootstrap diferencia inconcluso de denegación en `src/store/slices/license/licenseBootstrapActions.js:258-319` (Staff) y `:395-467` (Admin). La limpieza admin opcionalmente conserva identidad/token ante resultado no autoritativo en `src/store/slices/license/licenseAdminActions.js:527-553`.

La señal `navigator.onLine` no demuestra que Supabase sea alcanzable. La ruta corregida separa la clasificación de la respuesta de autenticación y conserva el flujo seguro existente: una sesión Admin solo puede continuar offline si la evidencia cumple el mismo límite de 24 horas y `restoreActorRuntimeFromCurrentSessionCache()` confirma la autoridad canónica.

## Contrato de clasificación

| Resultado | Ejemplos reconocidos | Transición |
|---|---|---|
| `verified` | RPC responde `success: true` y `valid: true` sin contradicciones | Continúa la restauración normal con validación de actor/tenant. |
| `authoritative_denial` | Códigos explícitos allowlisted de sesión, dispositivo o licencia | Bloquea y limpia solo las credenciales del actor afectado y solo si siguen siendo las mismas que se verificaron. |
| `transport_unavailable` | `Failed to fetch`, `AbortError`, timeout, DNS/transporte conocido | Conserva credenciales; sin autoridad nueva. Puede reintentar; Admin solo usa el fallback offline canónico vigente. |
| `server_error` | HTTP 5xx, 429, gateway 401/403, `RATE_LIMITED`/`AUTH_RATE_LIMITED` | Conserva credenciales y queda recuperable; no se interpreta como revocación. |
| `invalid_response` | RPC incompleto, desconocido o contradictorio | No concede acceso ni limpia credenciales automáticamente. |
| `local_storage_error` | No se pueden leer credenciales locales | Bloqueado de forma recuperable; conserva la ruta de recuperación de base local. |
| `local_credentials_missing` | Faltan token/sesión/dispositivo necesarios | Requiere autenticación; no se inventa autoridad desde licencia o identidad local. |

Se conservan `success` y `valid` para compatibilidad (`true` únicamente en `verified`). Los consumidores deciden con `verificationStatus`; un `false` de compatibilidad ya no equivale por sí solo a revocación. Los códigos allowlisted se contrastaron con los RPC SQL versionados de Admin, Staff, licencia y rate limit. Las respuestas HTTP 401/403 y códigos desconocidos permanecen inconclusos.

## Cambios implementados

- Clasificador central nuevo en `src/services/auth/sessionVerification.js`, con clasificación estructurada, códigos de transporte conocidos, códigos allowlisted y errores locales diferenciados.
- `src/services/supabase.js`: verifica credenciales y respuestas sin limpiar ante errores técnicos; aplica la limpieza solo a un rechazo reconocido y tras volver a comprobar el token/contexto actual. La evidencia offline no extiende ni renueva sus marcas temporales y rechaza fechas futuras, vencidas o malformadas.
- `src/store/slices/license/licenseBootstrapActions.js`: mantiene a Staff online-only; en fallo inconcluso preserva credenciales y permite reintento. Admin solo intenta continuidad local por la prueba canónica preexistente; si no se puede demostrar, permanece bloqueado y recuperable.
- `src/store/slices/license/licenseAdminActions.js`: reintento de verificación no destructivo, preservación de la recuperación del PR #364 y límites ante respuestas tardías, logout, cambio de actor o tenant. Fallos de preparación no borran credenciales confirmadas.
- `src/store/slices/license/licenseProcessingActions.js` y `licenseStaffActions.js`: misma separación entre rechazo autoritativo e inconcluso para transiciones de licencia/actor y login Staff.
- `src/components/common/AdminLoginModal.jsx` y `StaffLoginModal.jsx`: aviso claro de verificación no disponible y reintento; Staff no muestra un login offline y libera el estado de carga ante excepciones.
- Pruebas nuevas: `src/services/auth/__tests__/sessionVerification.test.js` y `src/components/common/__tests__/StaffLoginModal.verification.test.jsx`. Se ampliaron pruebas de Supabase/bootstrap y se actualizaron fixtures de transición para el contrato estructurado.
- La primera PR127 encontró que una clasificación innecesaria en `activateLicense()` ocultaba el mensaje de rate limit. Se retiró esa clasificación de activación, que no forma parte de la verificación de sesiones, y se conservó la respuesta previa de activación.

No se modificó ningún archivo bajo `supabase/migrations`, permisos, contratos de caja/ventas, Service Worker o arquitectura de Actor Runtime. `licenseIntegrityActions` no tiene una suite de test dedicada en este repositorio.

## Seguridad y alcance

- **Admin:** error inconcluso preserva token, id de sesión, `last_valid_admin_session`, tenant, contexto y timestamps; no concede autoridad nueva. Fallback Admin offline conserva límite vigente de 24 horas y exige restauración canónica.
- **Staff:** error inconcluso conserva su evidencia, pero no habilita login ni restauración offline. Denegación Staff explícita continúa bloqueando.
- **Rechazo autoritativo:** sesión inválida/expirada, dispositivo no autorizado o licencia denegada mantienen el bloqueo; la limpieza se condiciona a que no haya cambiado el token/contexto durante la solicitud.
- **Actor Runtime y multitenant:** callbacks, generación de actor, tenant lease y snapshot de credenciales se validan tras las operaciones asíncronas; respuestas obsoletas se descartan y no restauran otro tenant ni una sesión posterior al logout.
- **Datos financieros:** este flujo no cierra caja ni escribe ventas, pagos, drafts o inventario. Se ejecutaron regresiones de la puerta financiera y recuperación de caja.
- Sin cambios a duración de sesiones SQL, gracia comercial, límite de dispositivos, caché de licencia, fallback de licencia de 72 h ni ventana offline Admin.

## Verificación automatizada

| Comando / suite | Resultado |
|---|---|
| `npx vitest run --maxWorkers=4 --exclude "**/.tmp/**"` con 23 suites focales | En corrida conjunta, 22 archivos/251 pruebas pasaron; 37 pruebas de `tenantRuntimeRouter` agotaron sus 15 s bajo carga. |
| `npx vitest run --maxWorkers=1 --exclude "**/.tmp/**" src/services/db/__tests__/tenantRuntimeRouter.test.js` | 1 archivo, 42/42 PASS; los 37 timeouts de la corrida conjunta no se reprodujeron aislados. |
| `npx vitest run --maxWorkers=1 --exclude "**/.tmp/**" src/services/auth/__tests__/sessionVerification.test.js` | 1 archivo, 24/24 PASS (incluye `RATE_LIMITED`, `AUTH_RATE_LIMITED`, `LICENSE_EXPIRED` y respuesta contradictoria). |
| `npx vitest run --maxWorkers=1 --exclude "**/.tmp/**" src/services/__tests__/supabase.deviceRegistry.test.js src/services/auth/__tests__/sessionVerification.test.js` | 2 archivos, 33/33 PASS tras retirar la clasificación de activación; regresión de `activateLicense()` y clasificador cubiertos. |
| Suites focales finales, con el archivo de tenant repetido aislado | 24 archivos únicos, 298/298 pruebas PASS: 289 de las suites anteriores más 9 de `supabase.deviceRegistry.test.js`; los 22 archivos restantes pasaron en la corrida conjunta. |
| `npx eslint` sobre los 14 archivos de código/test modificados | PASS, cero errores. Solo imprime aviso de metadatos obsoletos de `baseline-browser-mapping`. |
| `npx -y react-doctor@latest . --scope changed --base origin/main --no-score --no-supply-chain --max-duration 120` | 11 archivos escaneados; 6 advertencias previas/de alcance: complejidad/tamaño del modal Admin, modales custom en lugar de `<dialog>` y awaits secuenciales preexistentes en `supabase.js:1287`. El error de `setIsLoading(false)` detectado inicialmente en Staff fue corregido; no aparece en el escaneo final. |
| `npm run build` | PASS, exit 0 antes de la corrección pequeña de `activateLicense()`. Vite y Service Worker compilaron; postbuild auditó 23 assets de inicio y 0 assets de rutas Local en el core. Avisos existentes: imports mixtos estático/dinámico, bundle > 1 MB, patrones PWA sin archivos y metadatos `baseline-browser-mapping` obsoletos. Repetir en el HEAD final. |
| Type checking | No hay script `typecheck` definido en `package.json`; el cliente de autenticación modificado es JS/JSX. |

Las pruebas focales incluyen: verificación Supabase/IndexedDB, bootstrap Admin/Staff, transiciones de sesión, corte Free legacy, recuperación Admin del #364, control de actor, almacenamiento scoped, guardas/aislamiento tenant, modales Admin/Staff, licencia por tenant y operaciones de caja protegidas. No se declara aprobada QA física.

## GitHub, PR y Preview

- HEAD inicial de `main`: `31fadba8bdb4f92725d07572e2696f9af20c47ca` (verificado en `origin/main`).
- PR #364: `MERGED`, verificado.
- PRs abiertos revisados: #357 (base `main`), #352 (base #338) y #338 (base `main`). #357 y #338 también tocan `AdminLoginModal.jsx`; #338 toca `StaffLoginModal.jsx` y el submit de login/error de Staff. #352 no toca los archivos modificados por esta fase. Los cambios de UI son combinables, aunque los archivos Admin/Staff requieren integración de hunks al resolver esos PRs. No se trajeron commits ni cambios de otras ramas.
- Rama: `fix/offline-auth-error-classification-r1`; PR #365 Draft abierto, [https://github.com/fdxruli/Lanzo-POS/pull/365](https://github.com/fdxruli/Lanzo-POS/pull/365). Primer SHA `ee6beeb553f13f27f8cf24ac3a401b7f62dc15ee`; actualizar con SHA final.
- PR127 inicial clasificó la respuesta genérica de `activateLicense()` como una regresión por ocultar el mensaje de rate limit. Código corregido y pruebas locales focales PASS; el comparador CI necesita repetirse en el SHA final.
- Preview inicial correspondió al primer SHA y respondió HTTP 200 mediante acceso autenticado. Confirmar Preview final tras el próximo push. No se hizo prueba visual manual.

## QA manual pendiente del propietario

Ejecutar en laptop Windows con Chrome y Edge, PWA de escritorio, Android Chrome y PWA Android:

1. Sesión Admin Free online normal.
2. Desconectar con la PWA abierta y confirmar que no se fuerza un login por pérdida de red.
3. Cerrar y abrir offline con evidencia reciente elegible.
4. Repetir con Wi-Fi conectado sin salida efectiva a internet.
5. Recuperar conexión y reintentar verificación sin borrar almacenamiento.
6. Confirmar que no se registra un segundo login/dispositivo innecesario.
7. Confirmar que perfil, catálogo y operaciones locales siguen ligados al mismo negocio.
8. Repetir en Chrome y Edge de escritorio.
9. Validar que PRO conserva su autenticación online.
10. Validar que Staff sigue sin acceso offline.

No borrar caché ni IndexedDB, reinstalar PWA ni liberar dispositivos como primer paso. Las pruebas de revocación, expiración y fallos estructurales deben hacerse solo con fixtures controlados. Esta fase queda lista para la validación manual; el dueño aún debe aprobarla.

## Pendiente de fases posteriores

Fase 2 puede normalizar el modelo general de sesión y su recuperación; las fases posteriores pueden abordar telemetría y UX de incidentes, compatibilidad de dispositivos y QA de continuidad física. Nada de eso amplía la autorización offline en este cambio.
