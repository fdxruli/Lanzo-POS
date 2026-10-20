# Auditoría y hardening de recuperación de incidentes — Fase 1

**Repositorio:** `fdxruli/Lanzo-POS`

**Rama:** `feat/incident-recovery-center-r1`

**Base consultada:** `main` en `b6843578409b62e7efce941aa4b819d304d9d661`

**Alcance:** auditoría y hardening de recuperación, privacidad de diagnósticos y continuidad offline. No incluye rediseño visual.

## Estado de preparación y PRs relacionados

Se verificó `main` antes de crear la rama; su HEAD sigue siendo `b6843578409b62e7efce941aa4b819d304d9d661`. Los PRs relacionados siguen abiertos y Draft:

| PR | HEAD observado | Archivos que también modifica esta fase |
| --- | --- | --- |
| [#338](https://github.com/fdxruli/Lanzo-POS/pull/338) | `fb17e9a43929d54087ab937cb760a8cd6e087c36` | `src/App.jsx`, `src/architecture/__tests__/adminLazyRouteRecoveryArchitecture.test.js`, `src/architecture/__tests__/adminPwaArchitecture.test.js`, `src/components/common/AdminLoginModal.jsx`, `src/main.jsx`, `vite.config.js` |
| [#352](https://github.com/fdxruli/Lanzo-POS/pull/352) | `d758f69b2119f1bc346eb0ac86ba0a74c0265668` | `src/components/common/UpdatePrompt.jsx`, `src/components/common/UpdatePrompt.test.jsx`, `src/pwa/__tests__/adminServiceWorker.test.js`, `src/pwa/adminServiceWorker.js`, `src/store/slices/createPWASlice.js`, `src/store/slices/createPWASlice.test.js` |

El trabajo del #352 incluye coordinación del Service Worker entre pestañas y flujo de caja. Se deberá reconciliar ese comportamiento con este hardening antes de integrar cualquiera de los PRs. El #338 también comparte el entrypoint y archivos de arquitectura/build. Esta rama parte de `main`, no incluye esos PRs ni realiza rebase. No se hizo merge.

## Hallazgos de captura y propagación

| Mecanismo | Captura | Puede escapar o reemplazar el shell |
| --- | --- | --- |
| `ErrorBoundary` de React | Errores síncronos de render, constructor y lifecycle en sus descendientes. Los límites más cercanos conservan las secciones vecinas. | No captura errores de handlers, timers, callbacks asíncronos, promesas ni eventos globales. El límite que envuelve `RouterProvider` y el límite de `Routes` pueden reemplazar el shell administrativo si el error llega hasta ellos. |
| Límites de React Router | `errorElement` local para fallos de rutas/acciones y render asociados a la ruta. | Un fallo de import inicial del entrypoint sucede antes del router. El `errorElement` de bootstrap y la pantalla de inicio son la última recuperación, y pueden ocupar toda la pantalla. |
| `PosApplicationBootstrap` y `DatabaseRecoveryGate` | Fallo al preparar IndexedDB, cargar runtime o terminar su inicialización. El gate conserva la aplicación cerrada si el preflight no da una base compatible. | Un fallo del preflight puede bloquear toda la app Local; es una barrera de seguridad de datos. No intenta reparar borrando bases ni promete que los datos se mantuvieron intactos. |
| Carga de chunks administrativos | `adminOptionalLazy` conserva la sección principal para módulos secundarios; las rutas lazy muestran una recuperación limitada a la ruta. | Un asset necesario para arrancar antes de montar React lleva a la pantalla de inicio. La recuperación automática no activa SW ni recarga. |
| `PublicStoreErrorBoundary` | Error React de la tienda pública y errores globales que `main-store.jsx` envía a `recoverFromPublicChunkError`. | El recuperador global está diseñado para fallos de chunks; otros errores globales no tienen un fallback unificado. El límite de tienda ofrece un reintento acotado y una actualización manual. |
| `devConsoleCapture` | `window.error`, `unhandledrejection` y llamadas de consola para diagnóstico durante la sesión. | En el admin registra un resumen seguro para la consola de desarrollo visible; no convierte cada rechazo global en un fallback para el usuario. |
| Límites especializados | `ChartErrorBoundary` contiene fallos del gráfico; otras secciones tienen límites locales. | La cobertura no es universal; revisar async/globales y límites para módulos secundarios en Fase 2. |

**Riesgo identificado:** una falla del entrypoint, runtime inicial, IndexedDB o un error que alcance el límite raíz puede sustituir la aplicación completa. La contención por sección reduce el impacto una vez montado el shell, pero eventos globales y promesas no están bajo `ErrorBoundary`.

## Riesgos antes y después

| Riesgo | Antes | Cambio de Fase 1 | Riesgo residual |
| --- | --- | --- | --- |
| Reporte con mensaje, stack, query o valores de objetos de error | Alto: el reporte podía incluir datos sin una lista de campos aprobados. | Códigos y metadatos con allowlist, tamaños acotados, ruta genérica y tipo de error aprobado. Se excluyen stack, causa y mensaje crudo. | Bajo para el reporte generado; texto que el usuario escriba por separado en soporte puede incluir datos que decidió compartir. |
| Limpieza amplia de sesión o caches durante un error | Alto: el recovery no debía invalidar sesión Local ni caché ajena. | Eliminada limpieza indiscriminada en ErrorBoundary; recuperación de inicio elimina solamente cachés del shell Lanzo permitidas y de mismo origen. Sólo acción explícita, con internet verificado. | Bajo; la eliminación del shell puede requerir descargar assets de nuevo. No limpia IndexedDB ni outbox. |
| Actualización/recarga mientras cambia usuario, tenant o hay operación activa | Alto: callbacks obsoletos o actualización podían actuar bajo contexto distinto. | Snapshot en memoria de actor/sesión/tenant; operación cancelada lógicamente si cambió el contexto. Recovery explícito bloqueado si hay checkout o operación actor-bound en curso. | Bajo para estados que la aplicación registra; no sustituye QA real de pestañas/dispositivos físicos. |
| Reintentos y ciclos de actualización | Alto: llamada repetida podía duplicar trabajo o loop. | Single-flight, marcadores separados para recovery automática y forzada, una tentativa forzada por página/build, query de recuperación acotada y sin activación automática. | Bajo; una recuperación fallida requiere recarga manual o nuevo ciclo de inicio para intentar otra vez. |
| Tenant incorrecto o reconstrucción con pérdida de datos | Alto: reset genérico sería incompatible con operación offline. | Recuperación local mantiene revalidación/rebind selectivos; no limpia tablas de ventas, inventario, caja, clientes, pedidos, licencia ni sincronización. | No es posible certificar integridad frente a corrupción física, cierre forzado del navegador o una escritura interrumpida sin validar cada caso en QA. |
| Error financiero de resultado ambiguo | Alto si se reejecuta a ciegas. | La clasificación marca `critical_blocker` sólo ante resultado financiero explícitamente desconocido; el reporte no reejecuta la operación. Nuevos intentos deben verificar el ledger/recibo canónico de idempotencia. | La verificación del resultado financiero sigue siendo responsabilidad del flujo canónico; no se alteró la ejecución de ventas en esta fase. |
| Error global async del admin | Medio/alto: se registra, pero puede no ofrecer recuperación contextual al usuario. | El resumen de DevConsole se sanitiza. | Medio: un centro global unificado pertenece a Fase 2; no se afirma que `ErrorBoundary` capture promesas o handlers. |

## Clasificación e información segura

Nueva utilidad `src/services/diagnostics/incidentDiagnostics.js` mantiene separadas gravedad y taxonomía. Las categorías son `react_render`, `navigation_resource`, `indexeddb`, `pwa`, `authorization_session`, `supabase_rpc`, `synchronization`, `financial_operation`, `connectivity` y `unknown`. Severidades: `recoverable`, `section_failure`, `critical_blocker`. Un error desconocido empieza como `section_failure`; no se promueve a crítico sólo por desconocido. La promoción automática a crítico requiere un resultado financiero explícitamente desconocido; un caller puede declarar otra gravedad únicamente cuando ya conoce el impacto.

`buildSafeIncidentReport` y sus helpers aceptan campos de diagnóstico aprobados, limitan longitud y fallan de forma defensiva ante objetos malformados. No serializan tokens, credenciales, licencias completas, fingerprints/IDs de dispositivo, query string, datos personales, importes o contenido de transacciones, filas de IndexedDB, stores completos, stack ni causa. El contexto actor/sesión/tenant se utiliza sólo en memoria para guardas y no se incluye en el reporte.

`supportContact.js` y `supportTicketService.js` normalizan la metadata de diagnóstico y la forma de respuestas RPC. El texto libre de una solicitud que el usuario redacte voluntariamente es independiente del reporte técnico y no se declara redactado automáticamente.

El formulario general de soporte sigue incluyendo nombre del negocio, plan y terminación enmascarada de licencia para identificar la solicitud; no se copian esos campos al reporte técnico del ErrorBoundary. Los mensajes del hilo de soporte también son texto funcional del usuario y no forman parte del evento diagnóstico.

## Recuperación y preservación de datos

- `sessionStorage.clear()` no se usa en el recovery de producción. Sólo se escriben/eliminan claves propias de recuperación; el borrado de storage en tests es aislamiento del fixture.
- No hay eliminación de bases Dexie/IndexedDB como parte del nuevo recovery. La prueba de capacidad elimina únicamente una base temporal de nombre propio.
- La recuperación automática de chunks preserva el shell instalado: no activa un worker, no limpia caches y no recarga. El recovery forzado exige una acción explícita, conexión confirmada y contexto vigente.
- La eliminación de caches está limitada a nombres Lanzo (`lanzo-admin-static-vN`, `lanzo-admin-media-vN`) y a precache Workbox de la raíz del mismo origen. No borra `CacheStorage` completo ni desregistra workers de producción.
- La activación del Service Worker espera una acción explícita; el bridge legacy deja un estado pendiente y no navega clientes. `controllerchange` difiere la recarga cuando hay checkout u operación actor-bound activo y deja disponible el estado de actualización.
- El recovery forzado es single-flight y se intenta una vez por página/build. Se verifica actor, sesión y tenant en memoria antes/después de awaits; una captura vieja queda bloqueada.
- Los cambios de tenant conservan las verificaciones del runtime tenant y no copian ni mezclan operaciones locales. Una venta/sincronización pendiente sigue perteneciendo a su contexto original.
- Para resultado de cobro incierto no se ejecuta un retry automático; se debe consultar el ledger/recibo canónico por clave de idempotencia antes de repetir.
- Sin conexión se conserva el shell y la operación Local si DB/sesión local son válidas; no se exige Supabase para el recovery Local.

## Cambios realizados y archivos afectados

- **Diagnóstico seguro y clasificación:** nuevos `src/services/diagnostics/incidentDiagnostics.js` y `recoveryContext.js`; actualización de `ErrorBoundary.jsx`, `devConsoleCapture.js`, servicios de soporte y sus pruebas.
- **Ciclo admin, chunks y PWA:** actualización de `src/pwa/adminStartupRecovery.js`, `adminLazyRouteRecovery.js`, `adminOptionalLazy.js`, `adminServiceWorker.js`, `adminUpgradeBridge.js`, `sw.js`, `main.jsx`, `App.jsx` y `PosApplicationBootstrap.jsx`. Actualización de textos y pruebas de recuperación y arquitectura.
- **Gate de almacenamiento y copy de seguridad:** `DatabaseRecoveryGate.jsx`, `indexedDbPreflight.js`, pantallas de inicio/licencia/renovación y banner de downgrade. Se evita mostrar conteos/valores de stores o prometer integridad no verificada.
- **Tienda pública:** `PublicStoreErrorBoundary.jsx`, `main-store.jsx` y `publicChunkRecovery.js` limitan el reintento y conservan el carrito/local data; el mensaje reconoce que una operación no guardada no se puede confirmar desde esa pantalla.
- **Build offline:** `vite.config.js` incluye las dependencias de protección actor/operación del shell de inicio en el cierre de assets precacheados; el presupuesto/auditoría de inicio se conserva.
- **Tests:** Vitest para error React, almacenamiento, offline, sesión/tenant obsoletos, reintento repetido, SW fallido, finanzas, recuperación de tienda pública y ausencia de secretos en reportes.

No se modificó el contrato financiero ni se introdujeron migraciones/RPC de Supabase. No hubo consultas de escritura a Supabase ni cambios en producción.

## Pruebas y builds

| Verificación local | Resultado |
| --- | --- |
| Suite focal de incidentes/PWA/storage/support/arquitectura | PASS — 21 archivos, 171 tests |
| Cobertura adicional de límites públicos y bootstrap | PASS — 3 archivos, 5 tests (`PublicStoreErrorBoundary`, fallo inicial de bootstrap y runtime recovery) |
| Actor Runtime | PASS — 2 archivos, 26 tests |
| Actor Scoped Storage y persistencia | PASS — 10 archivos, 73 tests |
| Tenant, IndexedDB, outbox e idempotencia financiera | PASS — 9 archivos, 186 tests |
| PR127: `pr127-global-comparison.node-test.mjs` y `focused-target-evidence.node-test.mjs` | PASS — ambos comandos con exit code 0 |
| ESLint sobre JS/JSX cambiados y módulos de diagnóstico | PASS — sin errores de lint |
| `npm run build` admin + auditoría postbuild | PASS — 21 assets de inicio verificados, 0 assets de rutas Local core cargados lazy |
| `npm run build:store` | PASS — 1,846 módulos transformados |
| `git diff --check` | PASS |

El build muestra warnings ya presentes de chunk/importación, patrones glob sin coincidencia y `baseline-browser-mapping` desactualizado; no fallan compilación, precache ni auditoría. No se ejecutó la suite completa del repositorio ni los workflows remotos contra la nueva rama; GitHub ejecutará sus checks al publicar el PR.

## Riesgos pendientes

1. QA manual de actualización PWA en equipo físico y múltiples pestañas; comprobar el bloqueo durante checkout/outbox activo y la reanudación después de drenar.
2. Simular pérdida de red y fallos de chunk con perfil Local válido; verificar navegación y venta offline sin recarga, reseteo de sesión ni vaciado de caché comercial.
3. Verificar en un perfil de prueba que una base bloqueada/migración fallida conserva evidencia y que la recuperación reporta sólo códigos/metadata permitidos.
4. Probar un cobro con resultado remoto ambiguo en entorno QA: confirmar ledger/recibo por clave idempotente antes de permitir una repetición manual. Esta fase no simuló transacciones reales.
5. No se puede garantizar integridad ante corrupción física de IndexedDB, power loss o datos ya inconsistentes a partir de esta auditoría estática/unitaria.
6. Globales async del admin siguen visibles principalmente en DevConsole; para el centro de incidentes de Fase 2 hace falta registrar errores de forma segura sin inventar contexto de sección.
7. Hay solapamiento de archivos con #338 y #352. Resolverlo comparando ambas ramas y volver a correr los gates; no integrar la rama actual por encima de ellas a ciegas.

## Recomendaciones para Fase 2

- Diseñar el centro visual sobre esta taxonomía sin mover diagnósticos crudos al usuario; distinguir acción disponible, sección bloqueada y operación financiera que requiere comprobación.
- Incorporar fallos globales async del admin como eventos seguros con deduplicación y contexto de ruta aprobado, sin serializar objetos originales.
- Definir un contrato explícito de estados de recovery (`detect`, `preserve`, `user_action`, `verified`, `failed`) con trace/correlation id opaco no identificable.
- QA manual de comportamiento PWA cross-tab, actualización con transacción activa y vuelta a operación Local offline antes de cualquier merge.
- Documentar para soporte cómo verificar un resultado financiero ambiguo en el ledger y cuándo no reintentar.
- Coordinar con #338/#352 los archivos compartidos y repetir Actor Runtime, Actor Scoped Storage, PR127, build y tests focales después de resolver conflictos.

## Checklist de QA manual

- [ ] Con perfil Local de prueba y sesión vigente, desconectar internet y abrir POS, ventas e inventario; confirmar que no aparece setup/reset por falta de red.
- [ ] Provocar error de importación de una ruta secundaria en offline; confirmar que no activa SW, borra cache ni fuerza reload.
- [ ] Con sesión/tenant A, iniciar una recuperación simulada y cambiar a B antes de resolver la promesa; confirmar que la acción vieja queda bloqueada y no afecta A ni B.
- [ ] Durante checkout/outbox actor-bound activo, ofrecer una actualización y simular `controllerchange` desde otra pestaña; confirmar que la recarga se difiere y la operación actual sigue disponible.
- [ ] Drenar/terminar la operación, luego iniciar actualización explícita online; confirmar una sola activación/reload y que se conservan los registros Local.
- [ ] Repetir la misma recuperación forzada en la misma página/build; confirmar respuesta `already-attempted` sin otra actualización, borrado ni reload.
- [ ] En base QA con versión incompatible o conexión bloqueada, verificar que el gate explica la condición y no elimina bases ni expone filas/counts de negocio.
- [ ] Inspeccionar reporte copiado y consola visible usando datos señuelo: token, licencia, query secreto, teléfono, importe, ID de venta y store deben quedar fuera.
- [ ] En tienda pública con carrito de prueba, forzar render/chunk error y usar el reintento disponible; confirmar que el carrito no se limpia y la actualización es manual/acotada.
- [ ] Para cobro de resultado ambiguo en QA, consultar el comprobante/ledger canónico por clave idempotente antes de cualquier repetición; comprobar que no se crea doble venta/movimiento.
- [ ] Repetir tenant A → B → A con operación pendiente; comprobar que identidad, outbox y datos de cada tenant permanecen aislados.
- [ ] Verificar que una falla de actualización PWA muestra error recuperable sin logout, setup ni pérdida de sesión.

**Límites:** revisión y pruebas automatizadas no equivalen a certificación de una restauración física ni a garantía global de integridad. Esta fase no tocó producción ni Supabase.
