# Diagnóstico P2-04 — mini-fase 2.4

Fecha de revisión: 2026-10-20 (America/Mexico_City)  
PR: #366, Draft  
Rama auditada: `feat/admin-offline-continuity-extended-r1`  
HEAD observado antes de esta actualización: `557a1e136597ab4422d940341c57d9b191ed3ab4`

## Dictamen

La causa física de P2-04 **no queda confirmada**. No se obtuvo una captura del runtime del perfil Tío Antonio ni el resultado RPC que produjo su modal. Por ello no se puede decidir con evidencia entre un Service Worker antiguo, una firma de transporte que aún no cubre el clasificador, evidencia v2 no elegible o una falla posterior del Actor Runtime.

El texto reportado coincide exactamente con el mensaje para `verificationStatus: "server_error"` en el bootstrap actual. En ese flujo, `isSafeAdminOfflineVerificationFailure()` solo habilita continuidad para `transport_unavailable`, `SESSION_RATE_LIMITED` y códigos `SESSION_SERVER_HTTP_5xx`. Un `SESSION_SERVER_ERROR` genérico o `SESSION_GATEWAY_HTTP_401/403` no es elegible. Si el navegador ejecutaba este código y tomó esa rama, no consultó `getAdminOfflineAuthorization()` ni intentó restaurar Actor Runtime. Es una inferencia condicional sobre el texto/modal; faltan los campos de runtime para confirmarla.

## Evidencia de versión y PWA

- El HEAD de GitHub y el deployment asociado al alias estable de la rama coincidían en `557a1e136597ab4422d940341c57d9b191ed3ab4` al momento de la auditoría.
- El HTML del alias respondió 200 y enlazó el bundle `index-DvGq14Ep.js`; `/sw.js` respondió 200. El bundle servido contenía los identificadores de clasificación de mini-fase 2.3 (`transport_unavailable`, `SESSION_TRANSPORT_UNAVAILABLE`, `SESSION_SERVER_HTTP_`, `SESSION_GATEWAY_HTTP_`, `evidence_missing` y `ACTOR_RUNTIME_RESTORE_FAILED`). Esto confirma el artefacto publicado en ese alias, no el controlador que tenía instalado el navegador de Tío Antonio.
- `src/pwa/sw.js` precachea el manifiesto Workbox y ejecuta `cleanupOutdatedCaches()`. La actualización se registra con `updateViaCache: 'none'`; el monitor solicita `SKIP_WAITING`, espera `controllerchange` y recarga la página. No se limpiaron caches ni datos locales durante esta investigación.
- No se pudo leer `navigator.serviceWorker.controller`, su estado ni los recursos efectivamente cargados en el perfil físico: la captura DOM de Chromium/Edge controlado expiró antes de adjuntar la página. No hay evidencia que permita descartar un worker antiguo aún activo en ese perfil.

## Clasificación y elegibilidad

| Caso | Clasificación actual | ¿Elegible? | Consecuencia |
| --- | --- | --- | --- |
| Firma PostgREST 2.87.1 reproducida por mini-fase 2.3: error envuelto de `TypeError: Failed to fetch`, status RPC 0, `code` y `hint` vacíos | `transport_unavailable`, `SESSION_TRANSPORT_UNAVAILABLE`, `httpStatus: 0` | Sí | Evalúa evidencia offline v2 |
| `SESSION_SERVER_ERROR` genérico, respuesta no reconocida o error sin firma exacta de transporte | `server_error` o `invalid_response` | No | No evalúa evidencia offline v2 |
| HTTP 401/403 del gateway | `server_error`, `SESSION_GATEWAY_HTTP_401/403`, estado HTTP conservado | No | No evalúa evidencia offline v2 |
| HTTP 429 o HTTP 5xx | `server_error`, `SESSION_RATE_LIMITED` o `SESSION_SERVER_HTTP_nnn` | Sí | Evalúa evidencia offline v2; el resultado decide si se puede continuar |

La evidencia offline v2 se evalúa solo después de que el clasificador permite continuidad. Una denegación de elegibilidad es diferente de una falla de restauración: el primer caso registra `admin_offline_authorization_decision` con `eligibilityReason`; el segundo solo puede ocurrir tras `eligible` y se registra como `admin_actor_runtime_restore_failed` o la fase de restauración concreta.

## Instrumentación añadida

El bootstrap emite advertencias `[AdminAuth]` con campos sanitizados y códigos permitidos explícitamente:

- `admin_bootstrap_verification_gate`: `category`, `status`, `code`, `httpStatus`, `continuityEligible`.
- `admin_offline_authorization_decision`: `status` y `eligibilityReason` estructurado.
- `admin_actor_runtime_restore_failed` o fase de restauración: categoría, código seguro y motivo de elegibilidad.

No se registra mensaje libre de error, respuesta RPC, credenciales, identificadores, huellas, claves de licencia, evidencia, estado financiero ni valores de tenant. La clasificación conserva `httpStatus` en el resultado de verificación para que el gate pueda reportarlo.

## Regresiones y validaciones locales

- P2-04 con Wi-Fi lógico activo y la firma exacta envuelta de fetch: continuidad habilitada, motivo de evidencia `authorized`, restauración y revalidación al reconectar de la misma sesión; no crea registro nuevo.
- P2-03: una evidencia v2 válida conserva su `sessionId` y su contenido; el arranque offline no hace RPC, no limpia credenciales, no escribe una licencia nueva y restaura Admin.
- Evidencia inválida y HTTP 403: permanecen denegados; HTTP 403 no llega al evaluador offline ni a Actor Runtime.
- Actor Runtime: la regresión separa gate de transporte elegible, evidencia elegible y fallo posterior de restauración. El fallo no se reclasifica como rechazo RPC.
- Las suites focales cubren Staff online-only, PR127 Base/Candidate, Admin Offline Authorization, bootstrap, Actor Runtime, Scoped Storage, Service Worker y almacenamiento local indexado.
- Sin cambios de migraciones, datos de Supabase, vigencia de evidencia ni reglas de identidad, tenant, dispositivo, sesión, licencia o Actor Runtime.

## QA físico mínimo pendiente

Ejecutar en el mismo perfil y dispositivo de Tío Antonio, manteniendo la sesión y los datos locales existentes. No borrar datos del sitio, caches, IndexedDB ni registrar una licencia o dispositivo nuevo.

1. Con Wi-Fi activo, abrir el alias estable actualizado de la rama y aceptar la actualización normal del Service Worker. Esperar `controllerchange`/recarga. En DevTools, comprobar que la página y el bundle cargado corresponden al deployment actual; registrar únicamente el URL/hash del bundle y estado del worker.
2. Confirmar `navigator.onLine === true`. Bloquear solo las solicitudes a Supabase con DevTools (sin activar modo offline) y reabrir Lanzo.
3. Copiar únicamente las entradas `[AdminAuth]`: `phase`, `category`, `status`, `code`, `httpStatus`, `continuityEligible` y `eligibilityReason`. No copiar cuerpos, headers, Storage, requests con credenciales o mensajes libres.
4. Si `continuityEligible` es `false`, el motivo está en la clasificación/error RPC: conservar esos campos y detener la hipótesis de evidencia/Actor Runtime. Si es `true`, comprobar si aparece `admin_offline_authorization_decision`; su motivo decide elegibilidad. Si es `eligible` y aparece una fase `actor_runtime` fallida, el error es posterior al clasificador.
5. Retirar el bloqueo, reconectar y comprobar revalidación de la misma sesión. Verificar que no aparece un nuevo registro Free y que los datos locales permanecen íntegros.
6. Confirmar P2-03 con la misma sesión; probar Staff online-only, PR127 Base/Candidate y los flujos Actor Runtime/Scoped Storage en sus pasos QA habituales.

Hasta recibir esos campos sanitizados del perfil físico, P2-04 no debe declararse aprobado ni atribuirse a una causa raíz concreta.
