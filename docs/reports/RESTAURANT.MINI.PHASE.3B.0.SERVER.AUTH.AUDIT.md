# Mini-fase 3B.0 — auditoría Device Auth / ActorRuntime

## Alcance y evidencia

Auditoría de PR #338 sobre el HEAD inicial `a8bca87263cb4292e4a7e2e1fdf6f6ac28dfe264`.
Se inspeccionaron migraciones y cliente. La auditoría del proyecto Supabase Lanzo
consultó únicamente `pg_proc`, `pg_namespace` y `pg_get_functiondef` mediante
`SELECT`, para comprobar las definiciones desplegadas. No se consultaron valores
de tokens, credenciales, fingerprints o sesiones de usuarios. No se ejecutaron
RPCs de login, validación, checkout, release o takeover en producción.

`SQL_CHANGES = NONE`, `MIGRATIONS_CREATED = NONE`,
`MIGRATIONS_APPLIED = NONE`, `SUPABASE_PRODUCTION_CHANGES = NONE`.

La cadena técnica puede reproducirse mediante mocks y un modelo de dos orígenes.
Esto no atribuye exclusivamente el incidente histórico a Vercel Preview: no se
realizó un login productivo ni se correlacionaron identidades reales del incidente.

## Contrato de rotación vigente

La última definición de `admin_login_on_device` está en
`supabase/migrations/20260924051208_license_free_owner_device_takeover_r1.sql`:

- Línea 198: genera un device token nuevo después de comprobar credenciales y
  límites del dispositivo.
- Líneas 214–219: para un dispositivo existente sustituye `security_token` y
  establece `previous_security_token = null`.
- Líneas 229–233: revoca sesiones Staff con `ADMIN_LOGIN_HANDOFF`.
- Línea 235: crea la nueva sesión Admin.

`private.create_admin_session` revoca las sesiones Admin anteriores del mismo
dispositivo con `SESSION_ROTATED`; véanse las líneas 193–198 de
`20260722222305_license_admin_auth_1_foundation.sql`.
Estas semánticas se confirmaron en las definiciones desplegadas.

Staff también genera un token nuevo y revoca la autoridad anterior del
dispositivo: `20260818164207_shared_terminal_device_actor_auth.sql`, líneas
903–904 y 936–946. Recuperar Staff requiere sus credenciales y no concede Admin.

La rotación forma parte del handoff que invalida autoridad anterior. No existe
evidencia que justifique conservar tokens antiguos para mantener simultáneamente
varios Preview. Esta mini-fase preserva esa rotación.

## Validación Restaurante y clonación

Las RPC Restaurante validan Device y Actor por separado mediante
`private.validate_pos_sync_context`:

- `pos_get_restaurant_orders`: `20260701205851_fase_rest_2_restaurant_orders_cloud.sql`,
  línea 664.
- Split financiero: `20260929091708_restaurant_payment_split_financial_r1.sql`,
  línea 436.
- Validador vigente: `20260916072854_license_expiry_entitlement_contract_r1.sql`,
  líneas 630–639. Distingue dispositivo ausente/inactivo, token requerido, token
  inválido y sesión actor requerida, antes de autorizar la operación.

En ese mismo contrato, `verify_device_license_unified_unlimited` devuelve
`DEVICE_TOKEN_REQUIRED` cuando falta token y `CLONING_DETECTED` cuando no coincide
con current/previous; líneas 1067–1072. La definición desplegada conserva esta
semántica. El mismatch por sí solo no prueba la causa física: también puede
producirlo un login autorizado que rotó el token. Aun así, esta mini-fase no
reinterpreta `CLONING_DETECTED`, no cambia el servidor ni permite escribir con el
token rechazado. La UX no necesita exponer el código interno.

La recuperación por `DEVICE_TOKEN_INVALID` o `DEVICE_TOKEN_REQUIRED` puede
resolverse en el cliente: detener el uso de esas credenciales, bloquear
ActorRuntime, solicitar autenticación explícita y reconstruir el contexto mediante
el handoff existente. Un token rechazado nunca concede autoridad. Un login válido
emite credenciales nuevas; no revive el token ni el handle anterior.

## Modelo de dos Preview

`src/services/supabase.js`, líneas 363–375, obtiene `FingerprintJS.visitorId` y
persiste la identidad en LocalStorage y el registro del dispositivo. El token se
lee/escribe en `SYNC_CACHE`, líneas 58–74. El fallback de generación puede producir
una identidad distinta; no se supone que todos los Preview necesariamente tengan
el mismo fingerprint.

Distintos hosts de Preview son distintos orígenes. El navegador separa su
IndexedDB, LocalStorage y BroadcastChannel aunque la identidad calculada del
dispositivo sea igual. Véase la
[política de mismo origen de MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy).

Con fingerprint compartido, el modelo es:

1. Preview A guarda token A y sesión Actor A en su almacenamiento.
2. Login autorizado en Preview B sustituye el token servidor por B y revoca la
   sesión actor anterior del mismo dispositivo.
3. El almacenamiento de A sigue conservando A.
4. La siguiente RPC Restaurante de A rechaza ese token. El cliente debe bloquear
   su autoridad y presentar recuperación; no debe reintentar con A ni aceptar A.
5. Login explícito en A puede emitir una nueva autoridad y, por el mismo contrato,
   invalidar la autoridad anterior de B.

No se sincronizan tokens entre orígenes ni se introducen parámetros, URLs, cookies,
canales externos o almacenes paralelos para compartir credenciales.

## Release, takeover y logout

Los contratos desplegados mantienen:

- Logout Admin revoca la sesión actor y no libera el dispositivo:
  `20260722222305_license_admin_auth_1_foundation.sql`, líneas 545–551.
- Logout Staff revoca su sesión. No convierte logout en release.
- `admin_release_device` exige autoridad Admin; revoca sesiones Admin/Staff,
  desactiva el dispositivo y borra current/previous tokens:
  `20260818164207_shared_terminal_device_actor_auth.sql`, líneas 1678–1698.
- `admin_takeover_free_device` exige credenciales de propietario y evidencia del
  ciclo Free vigente. Desactiva dispositivos desplazados y borra sus tokens;
  revoca las sesiones de la licencia:
  `20260924051208_license_free_owner_device_takeover_r1.sql`, líneas 499–505 y
  575–592. Las migraciones posteriores endurecen la evidencia del ciclo.

`DEVICE_NOT_ALLOWED`, release y el contrato de takeover siguen siendo bloqueos
de dispositivo. La recuperación de un token no los transforma en un login simple
que evada autorización.

## Hallazgos del cliente y límites del fix

Antes del fix, `restaurantOrdersRepository.callRpc` propagaba el rechazo Supabase
sin notificar pérdida de autoridad. Los lookup callers podían transformarlo en
resultado de lectura antes de que apareciera recuperación. El request manager
carecía de clasificación crítica para ambos errores de token.

El cierre posterior al cobro convertía los errores en filas pendientes
reintentables. La recuperación de autoridad debe evitar que una operación
rechazada por identidad se reemita automáticamente después de login. Los errores
de red mantienen su contrato de recuperación normal.

La implementación del repositorio captura el handle antes de construir contexto
asíncrono y comprueba la misma autoridad antes y después de la RPC. Esto incluye
lecturas bajo caché y mutaciones directas. Una respuesta de una generación anterior
se descarta con `CLOUD_REQUEST_RESPONSE_STALE` antes de reportar su error; no vuelve
a bloquear un actor recién autenticado ni aplica el éxito antiguo.

Un rechazo de la generación vigente conserva el error original, y un payload
`success: false` conserva su resultado. Ambos se reportan antes de traducciones
posteriores. Si falta sólo el token local, con licencia y device presentes, se
reporta `DEVICE_TOKEN_REQUIRED` sin emitir RPC. Licencia o identidad incompletas
conservan `POS_SYNC_AUTH_CONTEXT_INCOMPLETE`; no se clasifican genéricamente como
pérdida de Device Auth.

El cierre por fallo de autoridad devuelve un
resultado de fallo controlado, sin encolarlo para retry financiero. Un cierre ya
pendiente se marca para revisión/reintento manual antes de emitir su RPC; si la
autoridad se pierde, conserva ese marcador durable sin escribir después del lock.
El background omite los marcadores incluso después de reauth.

El cierre y el background exigen un ActorRuntime `GRANTED` incluso cuando no
existe snapshot de recuperación. Logout y rechazo de dispositivo/integridad
mantienen su motivo y bloquean antes de obtener un lease o modificar pending.
Las comprobaciones del handle también protegen los commits después de un await;
un error antiguo recibido tras un grant nuevo no encola ni reemite el cierre.

No se modifica cálculo financiero, reservas, stock, creación de ventas ni
semántica SQL. La recuperación tampoco dispara automáticamente checkout, split,
cancelación, refund ni otras escrituras financieras.

## Revisión del trayecto financiero existente

`salesCloudRepository.createCloudSplitTableSale` usa el ledger financiero
directamente (`src/services/salesCloud/salesCloudRepository.js`, líneas 160–174).
El ledger rechaza payloads persistentes con campos secretos antes de guardar el
intento (`financialIntentLedger.js`, líneas 42–47 y 768). El contexto RPC se
construye aparte; esta auditoría no imprimió sus argumentos ni valores.

Un `P0001` determinista queda `BLOCKED` y conserva el error que llegó desde la
RPC: `financialIntentLedger.js`, líneas 187–198, 1020–1049 y 1117. Primero persiste
la evidencia financiera bajo la autoridad capturada; después propaga el fallo
hacia el cliente. El mapper de cashier conserva `originalError` y el código
semántico (`salesCloudCashierService.js`, líneas 271–276 y 385–389). Así, la
clasificación de Device Auth puede inspeccionar el código aun envuelto.

No hay suscripción de grant que redispare un intento financiero en el ledger.
El retry de un intento existente pasa por el contrato de reintento explícito
(línea 870); el redispatch protegido se documenta como explícito desde la línea
1180. El loop de split en `salesService.js`, líneas 235–260, sólo repite un
`RACE_CONDITION`, no errores de autoridad.

Límite local observado, fuera del fix Restaurante: `financialIntentLedger.js`,
línea 234, y `salesCloudRepository.js`, línea 45, todavía agrupan contextos locales
incompletos como `POS_SYNC_AUTH_CONTEXT_INCOMPLETE`. No se modificó ese contrato
financiero ni se atribuyó a ese caso el incidente reproducido. Los errores
`DEVICE_TOKEN_REQUIRED` que devuelve el servidor conservan su clasificación.

## Verificación

Las pruebas funcionales se escribieron antes de modificar estos servicios:

- `restaurantOrdersRepository.authorityRecovery.test.js`: rechazo original,
  notificación antes de traducción de lookup, RPC promise rejection, una sola
  emisión y separación de errores de red/rate limit/stock.
- `restaurantOrderCheckoutClose.authorityRecovery.test.js`: no enqueue ante ambos
  códigos de token, resultado auth en split, marcador durable previo a RPC,
  ausencia de replay después de login, bloqueo de background durante recovery y
  conservación de recuperación normal de red.

El primer run funcional previo al fix ejecutó 20 casos: 17 fallaron y 3 pasaron.
Los rechazos demostraron falta de reporte de autoridad, enqueue reintentable y
ausencia de gate de recovery. Un caso tenía una fixture con clave de idempotencia
distinta de la canónica; se corrigió antes de verificar el fix. Un segundo caso
añadido para cierre explícito sobre pending existente falló antes de su corrección
adicional y comprobó el riesgo de replay después de reauth.

La extensión para actor LOCKED, token local ausente y respuestas de una generación
anterior ejecutó 31 casos: 9 fallaron y 22 pasaron antes del nuevo fix. Ocho fallos
fueron aserciones funcionales; el caso de contexto antiguo agotó timeout por una
fixture que conservaba el RPC deferred del caso previo. Se corrigió su reset.
Una segunda extensión seleccionada ejecutó seis casos y los seis fallaron antes
de interceptar payloads de autoridad y mover el gate LOCKED fuera del lease.
Los runners de diagnóstico 84197 y 39462 se cancelaron sin resultado; no se cuentan
como validación.

Verificación focal final del área Restaurante: **73/73 PASS** en cinco suites
(38 casos de recovery, 7 de cierre existente, 6 de reconciliación y 22 de split
preflight). ESLint focal en los cinco archivos JS modificados: PASS.
`git diff --check` focal: PASS. La suite existente de cierre recibió un mock
explícito de `tenantScopedStorage`, coherente con sus fixtures de claves raw y su
guard unitario; representa un actor ya GRANTED mediante un mock de runtime y
recovery. Las suites nuevas prueban explícitamente los estados LOCKED y las
generaciones. Producción continúa exigiendo namespace READY y autoridad real.

Regresión 3B financiera adicional: **143/143 PASS**, siete suites:
`salesCloudLocalRepository.integration`, `salesCloudFinancialRetry.integration`,
`cajaProjection`, `restaurantSplitPayments`, `salesCloudCashierMapper`,
`salesCloudCashierService.ecommerce` y `splitOrderContract`. Esta corrida se hizo
una vez; los cambios posteriores a gates Restaurante se verificaron en las cinco
suites focales. Los únicos mensajes de tooling fueron el aviso existente de
`baseline-browser-mapping` y normalización LF/CRLF de Git.

Los quality gates globales se registran en el reporte principal de mini-fase
3B.0. La QA manual debe confirmar el flujo de sesión y mesa
antes de retomar las QA financieras pendientes. No se realizaron ventas manuales
ni automáticas en producción como parte de esta auditoría.

## Recuperación del cliente y mesa ya confirmada

El clasificador compartido distingue pérdida de Device/Actor, contexto de otra
pestaña, permisos, respuestas descartadas, logout y bloqueos fuertes. El
coordinador suspende escrituras y solicita el login correspondiente. No concede
autoridad ni ejecuta de nuevo la operación que falló. Admin y Staff utilizan sus
acciones existentes; el handoff hidrata el estado durable y activa el binding
del actor antes de reanudar escrituras. Los handles anteriores siguen inválidos.

La transacción local de guardar mesa conserva un marcador de limpieza pendiente.
Si la mesa se confirmó y después falló retirar el tab, la UI reconoce ambos
hechos: guardado durable exitoso y limpieza pendiente. No borra la mesa ni reserva
otra copia. El handoff elimina sólo el borrador sin guardar que corresponde a
ese marcador y reconstruye un carrito consistente. Un fallo anterior al commit
revierte la mesa y la reserva mediante la misma transacción existente.

Los callbacks de cancelación, carga y checkout capturan los errores de autoridad
y muestran mensajes seguros. Checkout compensa exclusivamente el lock recién
adquirido por ese intento cuando se pierde autoridad; no repite ventas, pagos ni
efectos de inventario. Las operaciones y respuestas anteriores a una nueva
generación se descartan antes de modificar el carrito del actor nuevo.

## QA manual posterior

Ejecutar primero los cinco casos de sesión y mesa con datos de QA:

1. **QA-3B.0-01:** login limpio, crear y guardar mesa; confirmar una sola mesa y
   tab limpio, sin bloqueo de autoridad inesperado.
2. **QA-3B.0-02:** guardar y cargar la mesa; comprobar carrito y mesa coherentes.
3. **QA-3B.0-03:** guardar y cancelar; confirmar cancelación normal y contador.
4. **QA-3B.0-04:** guardar, cargar y pulsar Cobrar; comprobar que se alcanza el
   modal de pago/división con autoridad vigente.
5. **QA-3B.0-05:** provocar una pérdida controlada de autoridad; comprobar el
   mensaje de sesión, login explícito Admin/Staff, recuperación y reintento
   manual. Otra pestaña sigue invalidando el contexto anterior. No se repite
   automáticamente checkout, split, cancelación, refund ni cierre pendiente.

Después reanudar QA-10, QA-11, QA-12, QA-13, QA-15 y QA-18 con ventas y folios
nuevos. PR #338 permanece Draft y sin merge. No se inicia 3C ni 3D.
