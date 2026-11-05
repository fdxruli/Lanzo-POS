# LANZO_DEV_CONSOLE_IMPROVEMENT_REPORT

## Entrega y alcance

- Rama: `feat/dev-console-diagnostics-controls`, creada desde `main` confirmado en GitHub: `9c26743b4ffe64d93db4e573981aaa032310b2ea`. `main` seguía en ese HEAD al publicar.
- El HEAD final y el enlace del único PR Draft se registran en la descripción del PR y en la entrega. Sin merge ni promoción de Production.
- Código implementado; validación automatizada realizada. QA manual con licencia existente en Preview y Android físico **pendiente**.
- Sin SQL, migraciones, cambios de datos, permisos, esquemas, licencias ni configuración productiva.

## Causa confirmada

`Logger` → `console` → `devConsoleCapture.addEntry` → `summarizeDiagnosticEvent` → `classifyIncident` → búfer → `DevConsole` → portapapeles.

El capturador conservaba el nivel original, pero aplicaba el clasificador de **incidentes** también a mensajes informativos. El fallback del clasificador era categoría `unknown`, texto «Error inesperado», código `INCIDENT_UNKNOWN` y tipo `Error`. Eso hacía parecer errores a eventos de otros niveles. La sanitización descartaba correctamente mensajes y payloads privados; solo seis etiquetas exactas aportaban operación. Además, el emisor de Dexie envolvía la excepción en `originalError`, un campo que la proyección segura intencionalmente no recorre. Los niveles informativos de Logger se suprimían en builds de producción.

No existe evidencia que relacione estos fallbacks con el timeout de PostgREST observado el 2026-11-05 a las 10:09:20 UTC. No se investigaron ni modificaron datos productivos para atribuir una causa.

## Cambios implementados

- Proyección estructurada y cerrada antes de almacenar: nivel original, categoría, código, tipo técnico, gravedad, operación, estado y evidencia conocida. Los eventos informativos usan semántica de evento; las advertencias sin evidencia permanecen advertencias. Los errores sin contexto reconocen «Causa no identificada».
- Catálogo de operaciones seguro y emisores estructurados para estado de sincronización, pull, outbox y Realtime. Dexie entrega código seguro y excepción técnica directamente, sin exponer payloads ni modificar su resultado de negocio.
- Tipos técnicos de Dexie/IndexedDB y gravedad de incidentes normalizados conservados. Los resultados financieros desconocidos siguen siendo bloqueantes; nunca se agrupan.
- Explicaciones de códigos exactos: almacenamiento local, restricciones PostgreSQL, permisos y PostgREST. `57014` indica cancelación, sin inferir timeout; `PGRST003` sí identifica espera agotada del pool. Referencia: [Supabase Data API errors](https://supabase.com/docs/guides/api/rest/postgrest-error-codes).
- Logger permite eventos estructurados de operaciones registradas en builds de producción mediante un sink local; mantiene suprimido el ruido de depuración arbitrario y no imprime argumentos informativos privados en la consola del navegador.
- Repeticiones adyacentes con código específico y operación conocidos se agrupan durante hasta 30 segundos entre eventos. Se conservan número de ocurrencias, primera/última fecha y clasificación. Se presentan como **eventos técnicamente equivalentes**, sin afirmar una causa común. Los errores desconocidos, fallos locales genéricos, fallbacks por categoría y eventos financieros permanecen separados.
- Búfer limitado a 300 filas sanitizadas e inmutables; actualizaciones de vista agrupadas cada 100 ms, sin copiar el búfer en cada registro. Excepciones de suscriptores y reentrancia de logs no alteran el POS ni impiden reenviar llamadas originales.

## Toggle, autoridad y persistencia

Configuración → Controles → **Consola de diagnóstico** reutiliza `SettingsSwitch` y los estilos existentes. Desactivada por defecto. Activar muestra el acceso; desactivar desmonta y cierra inmediatamente el panel.

La preferencia usa `ActorScopedStorage` existente, local al dispositivo y aislado por negocio/actor. Requiere autoridad vigente de ActorRuntime para `settings` y concordancia con la identidad y permisos de Configuración del app store. No depende del plan ni de conectividad/Supabase. Al bloquear/cambiar actor o negocio, o perder autoridad por otra pestaña, se limpia el búfer y se cierra el panel; no se reutiliza la sesión visual anterior. La preferencia se recupera para el mismo actor tras reiniciar. Un fallo de persistencia se informa al usuario; apagar cierra incluso si no es posible escribir.

El capturador global permanece instalado una sola vez. La visibilidad no deshabilita los avisos críticos de recuperación. El búfer visual se suspende cuando no existe contexto autorizado; se puede seguir registrando en el contexto autorizado con el panel oculto. Los registros no se persisten en disco.

Se eligió un servicio pequeño separado de `createUISlice` porque las otras preferencias de esa slice son globales y no ofrecen el aislamiento de autoridad y contexto necesario para estos registros.

## Móvil, escritorio y UX

Panel adaptable, sin restricción de viewport ni bloqueo modal del POS; launcher movible y ubicación inicial por encima de la navegación móvil. Respeta áreas seguras, temas claro/oscuro, foco de teclado, cierre con Escape y retorno al acceso. Los diálogos críticos mantienen prioridad de capa.

Filtros por nivel/categoría, búsqueda por diagnóstico/evidencia/gravedad, inspección de registro, copia de registros filtrados, pausa/actualización de la vista, limpieza y desplazamiento. La vista no fuerza el seguimiento al final cuando el usuario está leyendo registros anteriores. La copia muestra confirmación o fallo y reutiliza el fallback de portapapeles existente.

Los módulos nuevos de preferencias y política de Configuración se incluyen en el precache, verificado por el postbuild, para no romper el inicio Local offline.

## Seguridad y privacidad

Solo vocabularios cerrados y valores técnicos permitidos entran al búfer, búsqueda, interfaz y copia. No se serializan mensajes arbitrarios, stacks, causas, URLs, RPC, respuestas completas, IndexedDB, identificadores, credenciales, licencias, huellas, información personal ni importes. La lectura de campos de consola utiliza descriptores propios: no ejecuta getters ni métodos de serialización. Las pruebas incluyen objetos hostiles y proxies revocados.

El texto copiado sale de las mismas entradas sanitizadas/inmutables que se muestran. La autoridad se vuelve a validar antes de copiar. No se modificó la política de autorización ni recuperación operativa existente.

## Validaciones ejecutadas

- Vitest: **26 archivos, 243 pruebas PASS**. Incluye diagnóstico, seguridad, captura global/promesas, unicidad de interceptores, filtros/copia/pausa, toggle, almacenamiento real por actor, permisos, arranque, Realtime y regresiones de cobro/caja/recibos/recuperación. [Salida](evidence/vitest.log).
- Tras endurecer la exclusión de agrupación financiera: **2 archivos, 19 pruebas PASS** de captura/proyección, incluidos los cuatro códigos de resultado financiero desconocido/pendiente. [Salida](evidence/financial-grouping-vitest.log).
- ESLint focalizado: **0 errores**; nueve advertencias `no-console` del Logger ya presentes en `main`, sin nuevas advertencias. [Candidato](evidence/eslint.log), [base](evidence/eslint-logger-main.log).
- `npm run build`: **PASS**, incluido `postbuild`: 25 assets de arranque verificados en precache. Vite conserva avisos existentes de patrones de chunks opcionales que no generan archivos. No son fallos de compilación.
- `git diff --check`: **PASS**.
- Chromium automatizado con fixture sintético: **PASS** a 390×844 y 1440×900, cambio móvil a 844×390, claro/oscuro, filtros, búsqueda, agrupación, inspección por pruebas de componentes, copia sanitizada, pausa/reanudación, limpieza, Escape y foco. Acción simulada fuera del panel accesible, sin errores de página; bloqueadas las peticiones ajenas al servidor local. [Resultados](evidence/browser-results.json), [móvil claro](evidence/mobile-light.png), [escritorio oscuro](evidence/desktop-dark.png).
- Las huellas de los archivos implementados y probados están en [tested-source.json](evidence/tested-source.json). La última exclusión de agrupación financiera tiene su comprobación focalizada y build posteriores.

Reproducción de navegador: con Python Playwright y Chromium en `/usr/bin/chromium`, ejecutar `npm run dev -- --host 127.0.0.1` y, en otra terminal, `python3 scripts/qa/dev-console/smoke.py`. Los fixtures están fuera de las entradas de producción y no inician sesión ni envían operaciones del POS. Evidencias nuevas se guardan en `/tmp/lanzo-console-qa`; puede cambiarse con `LANZO_DIAGNOSTIC_QA_OUTPUT`.

Para repetir la cobertura principal: `npx vitest run src/services/diagnostics/__tests__ src/services/__tests__/devConsoleCapture.test.js src/services/__tests__/devConsolePreferences.test.jsx src/components/debug/__tests__/DevConsole.test.jsx src/components/settings/__tests__/OperationalSettings.ticker.test.jsx src/components/settings/__tests__/OperationalSettings.cashOpening.test.jsx --maxWorkers=3`. Las suites complementarias ejecutadas constan en el comando de validación documentado en el PR.

## Preview, límites y QA manual

El estado, URL y SHA del Preview se registran en el PR y en la entrega después de publicar la rama. **READY no equivale a QA funcional aprobado.** No se han utilizado licencias de prueba para completar el recorrido manual, ni un Android físico, ni ventas/cobros reales. Production permanece sin cambios de esta tarea.

Límites: los emisores aún no instrumentados pueden seguir careciendo de módulo o causa; se muestran honestamente sin inventar información. El catálogo técnico es deliberadamente acotado. La agrupación agrega equivalencia técnica, no correlación de transacciones. Se conservan como máximo 300 filas en memoria por contexto actual. Si el almacenamiento del navegador está bloqueado, la persistencia no puede garantizarse y el control informa el fallo. Los logs originales del navegador conservan su comportamiento previo; las garantías de sanitización descritas son para la consola visual y su copia.

Pasos de aceptación manual pendientes, en un Preview cuyo SHA coincida con el PR:

1. Abrir con una licencia de prueba existente y un actor autorizado, en Android y escritorio.
2. Entrar a Configuración → Controles; activar Consola de diagnóstico y abrirla.
3. Observar eventos reales seguros y verificar módulo/operación/estado cuando existan; comprobar que informativos y advertencias no aparecen como errores inesperados.
4. Filtrar nivel/categoría, buscar un código, inspeccionar, pausar/reanudar, copiar y verificar que la copia coincide con el diagnóstico sin datos privados.
5. Comprobar repetición, marcas temporales y conservación de errores desconocidos independientes, sin provocar fallos financieros.
6. Desactivar con el panel abierto: debe desaparecer. Recargar/reiniciar y comprobar OFF. Repetir con ON y comprobar su restauración.
7. Cambiar actor/negocio o revocar permisos: comprobar cierre, limpieza y aislamiento. Comprobar funcionamiento Local offline y Nube con/sin conectividad.
8. Cambiar orientación y tamaño, probar teclado/tema y confirmar que no se tapan diálogos críticos.
9. Confirmar ventas, caja, inventario y sincronización mediante los flujos de prueba habituales ya autorizados. No forzar errores financieros ni realizar cobros para verificar la consola.

El smoke aislado y las pruebas financieras automatizadas no certifican este recorrido manual.
