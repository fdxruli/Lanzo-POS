# Lanzo POS — Offline auth classification R1

## Estado de entrega

- Rama base: `main`, HEAD inicial `31fadba8bdb4f92725d07572e2696f9af20c47ca`.
- PR #364 verificado integrado; no se reabrió ni se reutilizó su rama.
- Rama de trabajo: `fix/offline-auth-error-classification-r1`, HEAD de código verificado `9ce32ede7d5466f42df973b10222df5921b8ea01`.
- PR #365: [Draft abierto](https://github.com/fdxruli/Lanzo-POS/pull/365), base `main` en `31fadba8bdb4f92725d07572e2696f9af20c47ca`.
- Los checks focales, FREE Local, Dexie, Shared Terminal Device Actor Auth, PR127, Actor Runtime y almacenamiento scoped pasaron en el SHA de código. Las suites completas repetidas y sus gates diferenciales observacionales también terminaron PASS.
- PR127 Global Comparison final en `9ce32ede`: Candidate 100 fallos / Base 101 fallos; 100 compartidos, 0 candidate-only, 0 nuevos, 0 flaky y 1 fallo resuelto. La regresión inicial de mensaje de rate limit en `activateLicense()` se retiró y quedó cubierta localmente.
- Preview Vercel final `READY`, desplegado desde `9ce32ede7d5466f42df973b10222df5921b8ea01`, respondió HTTP 200 mediante acceso autenticado.
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
| `npm run build` | PASS en el SHA final de código, exit 0. Vite y Service Worker compilaron; postbuild auditó 23 assets de inicio y 0 assets de rutas Local en el core. Avisos existentes: imports mixtos estático/dinámico, bundle > 1 MB, patrones PWA sin archivos y metadatos `baseline-browser-mapping` obsoletos. |
| `Shared Terminal Actor Runtime Validation` (run `39225859048`) | PASS: suites completas repetidas de base y candidato, y gate diferencial observacional. Los jobs focales de Actor Runtime, tenant, autenticación, lint y builds también pasaron. |
| `Shared Terminal Actor Scoped Storage Validation` (run `39225858954`) | PASS: suites completas repetidas de base y candidato, control de duplicación de envío y gate diferencial observacional. Los jobs focales de almacenamiento scoped, handoff, tenant, sync, POS, lint y builds también pasaron. |
| Type checking | No hay script `typecheck` definido en `package.json`; el cliente de autenticación modificado es JS/JSX. |

Las pruebas focales incluyen: verificación Supabase/IndexedDB, bootstrap Admin/Staff, transiciones de sesión, corte Free legacy, recuperación Admin del #364, control de actor, almacenamiento scoped, guardas/aislamiento tenant, modales Admin/Staff, licencia por tenant y operaciones de caja protegidas. No se declara aprobada QA física.

## GitHub, PR y Preview

- HEAD inicial de `main`: `31fadba8bdb4f92725d07572e2696f9af20c47ca` (verificado en `origin/main`).
- PR #364: `MERGED`, verificado.
- PRs abiertos revisados: #357 (base `main`), #352 (base #338) y #338 (base `main`). #357 y #338 también tocan `AdminLoginModal.jsx`; #338 toca `StaffLoginModal.jsx` y el submit de login/error de Staff. #352 no toca los archivos modificados por esta fase. Los cambios de UI son combinables, aunque los archivos Admin/Staff requieren integración de hunks al resolver esos PRs. No se trajeron commits ni cambios de otras ramas.
- Rama: `fix/offline-auth-error-classification-r1`; PR #365 Draft abierto, [https://github.com/fdxruli/Lanzo-POS/pull/365](https://github.com/fdxruli/Lanzo-POS/pull/365). SHA de código validado: `9ce32ede7d5466f42df973b10222df5921b8ea01`.
- El primer comparador PR127 detectó un cambio no deseado en el mensaje de rate limit de `activateLicense()`. Se restauró el comportamiento previo, se cubrió con prueba local y el comparador final quedó PASS: 0 fallos nuevos, 1 resuelto.
- Preview Vercel final del SHA de código respondió HTTP 200 con acceso autenticado. No se hizo prueba visual manual.

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

## Refinamiento focal pre-QA — PR #365

La revisión posterior al HEAD `4bb4769511e2d67e5a8e9fb2475dd25e0d6c48ff` encontró y corrigió estos dos bordes:

- `AdminLoginModal.retryPreparation()` usa `initializeApp()` solo en la rama de verificación y ahora interpreta su `{ status }`; los estados gestionados por el bootstrap no generan una alerta por carecer de `success`. La rama `resumeAdminSessionPreparation()` conserva intacto el contrato `success`/`recoveryRequired` del PR #364.
- «Reintentar verificación» queda habilitado sin conexión. El intento vuelve a ejecutar el bootstrap y no concede acceso por sí solo: la restauración offline Admin sigue dependiendo de `hasValidOfflineAdminSession()` y de la restauración canónica de Actor Runtime. La prueba existente mantiene elegible exactamente el límite de 24 horas e invalida evidencia más antigua, futura, vencida o malformada.
- `verifyAdminSession()` y `verifyStaffSession()` limpian bajo lease ambas cachés de rol ante una denegación autoritativa, siempre que todo el snapshot capturado siga idéntico. Esto es intencional para la sesión exclusiva por dispositivo. Devuelven `sessionCredentialCleared` al terminar; `_requireAdminLogin()` y `_requireStaffLogin()` no repiten la limpieza cruzada después de esperar a `stopLicenseSync()`, de modo que un login nuevo posterior al lease no pierde sus credenciales.
- Si cualquier credencial del snapshot cambia antes de limpiar, el verificador descarta la respuesta como contexto obsoleto y no escribe limpieza. Admin compara token de dispositivo, token e id Admin, y token e id Staff; Staff compara token e id Staff y token e id Admin. Los logins exitosos también siguen limpiando las credenciales del rol anterior al cambiar explícitamente de rol.

Pruebas focales añadidas: cinco estados de `initializeApp()` sin falsas alertas, reintentos de verificación online/offline con y sin estado recuperable, limpieza cruzada condicionada para Admin y Staff, reemplazo tardío de credenciales del mismo y del otro rol, y limpieza cruzada única en ambos `_require*Login()`. La QA manual de navegador/PWA permanece pendiente; no se amplió la política offline ni se modificó SQL, Actor Runtime, aislamiento tenant o datos financieros.

Verificación del refinamiento: 7 suites focales separadas, 123/123 pruebas PASS; `npm run build` PASS y auditoría de precache con 23 assets de inicio/0 assets Local en el core; React Doctor PASS, 15 archivos escaneados, sin hallazgos; ESLint en los 7 archivos JS/JSX cambiados PASS. `npm run lint` completo falla por hallazgos fuera de estos archivos (163 errores y 179 advertencias en el árbol completo). Avisos conocidos del build: imports mixtos, chunks >1 MB y patrones PWA sin coincidencias.

## Cierre del gate Actor Runtime — PR #365

Run investigado: [Shared Terminal Actor Runtime Validation #39280939375](https://github.com/fdxruli/Lanzo-POS/actions/runs/39280939375), sobre `b3837912f0576d10c0917ba62dae9d4f739e53ae`.

- El diferencial registró un único fallo candidato en la repetición 2: `BackupRuntime.attention.test.jsx > rejects a stale click when the app-store identity changes before ActorRuntime`, `TypeError: Cannot read properties of null (reading 'readStates')`. La repetición 1 del candidato no lo observó.
- La referencia BASE de ese gate era el baseline histórico Actor Runtime `2f3457313b81f09937acab6fe4bac4399e79035f`, no el merge-base del PR. Ese SHA no contiene el test; sus artefactos no ejecutaron el caso. La base efectiva del PR era `31fadba8bdb4f92725d07572e2696f9af20c47ca` y sí contiene el mismo test original con la misma lectura de `localStorage.key(0)`. El caso fallido, `BackupRuntime`, `useLocalBackupAttention`, `localBackupAttention`, `useSettingsAccess` y `actorRuntimeController` no tenían diferencias entre esa base del PR y el candidato `b383791`.
- Causa: carrera del fixture. `findByRole()` esperaba el botón visible, pero no la escritura asíncrona del efecto `presented`; el test suponía que siempre existía una primera clave global. Si la escritura aún no había ocurrido, `localStorage.key(0)` era `null`. El rechazo obsoleto no debe crear ni leer la preferencia; `useSettingsActionGuard` revalida Actor Runtime y la identidad actual del app-store antes de permitir `update()` o `navigate()`.
- Corrección solo de prueba: esperar `presentedAt` en la clave hash exacta de tenant/actor/dispositivo y capturar el registro antes del clic. Tanto el clic con Actor Runtime revocado como el clic con identidad de app-store distinta comprueban que la ruta no cambia y que el registro scoped permanece idéntico y sin `readStates`. No se modificó `BackupRuntime`, el hook ni Actor Runtime.

Evidencia local sobre el runner Windows:

| Comparación | Repeticiones / resultado |
|---|---|
| Base real del PR `31fadba…`, test original sin corregir, ejecución aislada | 10/10 PASS |
| Candidato corregido, test aislado con `--pool=threads --maxWorkers=1` | 10/10 PASS |
| Candidato corregido, suite completa `BackupRuntime.attention.test.jsx` | 16/16 PASS |

La suite completa de atención en el worktree BASE no terminó: Vitest no respondió al worker en este entorno Windows; se canceló esa ejecución. El test aislado sí terminó en ambos árboles bajo la misma versión/runner. Quedan registrados más arriba los resultados originales CI BASE/CANDIDATE y, tras subir esta corrección, se añadirá aquí el resultado final del nuevo diferencial, PR127, suites focales, ESLint y build.
