# PR #366 — Mini-fase 2.3: transporte Supabase bloqueado

Fecha: 2026-10-20 (America/Mexico_City). HEAD investigado: 11f6115afc843e55dcfa0780842c326db752bd90. Rama destino: feat/admin-offline-continuity-extended-r1. Draft; requiere aprobación física; sin merge.

## Causa raíz comprobada

Se reprodujo con @supabase/supabase-js y @supabase/postgrest-js **2.87.1**, iguales al lockfile. Un cliente real con URL y clave ficticias ejecuta verify_admin_session y un fetch controlado rechaza con TypeError('Failed to fetch'). No se contacta Supabase producción.

PostgREST captura el rechazo y devuelve:

~~~json
{
  "error": {
    "message": "TypeError: Failed to fetch",
    "details": "<stack string; omitted>",
    "hint": "",
    "code": ""
  },
  "data": null,
  "count": null,
  "status": 0,
  "statusText": ""
}
~~~

error no tiene name, status ni cause. Si el error nativo tiene causa, el cliente la serializa en details; este parche no interpreta stacks ni cadenas de causas como autoridad.

callAdminAuthRpc ya devuelve el resultado completo. verifyAdminSession extraía data/error y descartaba status. El clasificador esperaba name === 'TypeError' y el mensaje sin prefijo; por ello el objeto envuelto acababa en server_error / SESSION_SERVER_ERROR. La política rechazaba correctamente ese error genérico: el fallo estaba en la clasificación anterior.

El mismo resultado real, pasado al clasificador original extraído con git show del HEAD investigado, produce server_error; con el parche produce transport_unavailable / SESSION_TRANSPORT_UNAVAILABLE. La reproducción mantiene navigator.onLine === true. Es una simulación controlada de transporte, no una certificación física de Chrome o del negocio Tío Antonio.

## Corrección focal y límites

- Se conserva el resultado RPC completo desde verifyAdminSession al clasificador.
- Se acepta la envoltura PostgREST únicamente con estado cero, code/hint vacíos, details string y firma exacta TypeError con mensaje fetch conocido.
- Un estado cero solo no demuestra transporte: el cliente también devuelve cero al fallar JSON.parse de una respuesta 200. Ese caso queda bloqueado.
- Los estados HTTP válidos tienen prioridad frente a señales de transporte contradictorias. null, cadena vacía y false no se convierten en cero.
- HTTP 500/502/503 y 429 conservan su clasificación específica ya permitida por la política. 401/403, JSON inválido, respuesta incompleta, denegación autoritativa, identidad incompatible y fallos locales siguen bloqueados.
- No se modifica isSafeAdminOfflineVerificationFailure, la política v2, el bootstrap productivo, el límite de 168 h ni los vínculos a sesión, Admin, licencia, dispositivo, tenant y Actor Runtime. Staff sigue sin autoridad offline.
- La recuperación reutiliza verify_admin_session. Las pruebas verifican que no se invocan otros RPC de login/creación/registro, ni escrituras de credenciales o registro de dispositivo durante el fallo. El bootstrap restaura desde evidencia y al reconectar vuelve a verificar.

## Archivos y líneas

| Archivo | Línea | Cambio |
| --- | ---: | --- |
| src/services/auth/sessionVerification.js | 98 | Estado RPC tipado y prioridad HTTP |
| src/services/auth/sessionVerification.js | 116 | Firma concreta del fetch envuelto |
| src/services/auth/sessionVerification.js | 135 | Transporte solo con firma conocida y sin HTTP |
| src/services/auth/sessionVerification.js | 163 | Recepción del estado externo |
| src/services/supabase.js | 2293 | Preservación del resultado RPC completo |
| src/services/auth/__tests__/sessionVerification.transport.test.js | 1 | 19 casos con cliente instalado, HTTP, JSON y reconexión |
| src/services/__tests__/supabase.indexedDbBootstrap.test.js | 71 | 7 estados reales a través de verifyAdminSession, sin registro |
| src/services/auth/__tests__/adminOfflineAuthorization.test.js | 72 | 8 variantes de política v2 ante el fetch envuelto |
| src/store/slices/license/__tests__/licenseBootstrapCoordinator.test.js | 71 | Bootstrap P2-04/P2-05 con política v2 real y reconexión |

## Validación

La entrega del PR adjunta los resultados finales de suites, lint, build/postbuild, React Doctor, PR127 y todos los checks del commit publicado. Primera ejecución focal: **99/99 PASS** (clasificador, transporte real, política v2 y servicio IndexedDB).

Suites ampliadas: Actor Runtime/bridge/scoped storage, recuperación Admin, bootstrap, tenant, Dexie y sync con aislamiento. El workflow PR127 del nuevo HEAD debe comparar Candidate y main; el resultado histórico de otro SHA no certifica este parche.

## Repetición física mínima (pendiente de aprobación del propietario)

1. Abrir la Preview correspondiente al nuevo HEAD del PR. Si la PWA ofrece actualizar, aceptar y confirmar la versión antes de probar. Mantener Wi-Fi activo y completar una verificación Admin online válida de Tío Antonio, con datos locales ya disponibles.
2. En DevTools > Network request blocking, habilitar el patrón https://odlrhijtfyavryeqivaa.supabase.co/*; dejar Network en No throttling. Confirmar navigator.onLine === true y que las peticiones Supabase están bloqueadas.
3. P2-04: recargar/reabrir la aplicación con la evidencia v2 vigente. Debe restaurar al mismo Admin y permitir operación local. Registrar pantalla, versión/HEAD y el error de red, sin copiar tokens ni cuerpos con credenciales. Verificar que no aparecen login/enrollment/takeover/registro Free nuevos.
4. P2-05: retirar el bloqueo y reintentar o recargar. Debe verificar la sesión existente y recuperar conectividad; conservar la identidad, el dispositivo y los datos. Comprobar que las peticiones Supabase dejan de fallar.
5. Conservar la evidencia P2-01…P2-06. El PASS automatizado no sustituye el PASS físico de P2-04/P2-05 ni la aprobación para salir de Draft.

Sin migraciones, cambios Supabase producción, borrado de cachés/IndexedDB/licencias/dispositivos ni cambios financieros.
