# Actualizador LANZO POS: implementación y revisión

Base verificada: `origin/main`, `e7a85fcb96d00f57d1414af8b8908785a7e50fbe` (2026-11-06). Rama única: `fix/reliable-app-updates`. Este trabajo termina en un PR Draft: no autoriza merge ni despliegue manual de Production.

## Problemas comprobados en main

- `UpdatePrompt.jsx` consultaba `lanzo_update_dismissed === true` en cada render. Posponer impedía reabrir el aviso desde Zustand y ocultaba cualquier actualización posterior de esa sesión. No había identidad de compilación en esa decisión.
- `createPWASlice.runUpdate` eliminaba el pendiente al recibir `true` de `location.reload()`: esa llamada no demuestra que se haya ejecutado la compilación nueva y el aviso nativo puede cancelar la navegación.
- El monitor devolvía `checked` tras `registration.update()`. No contrastaba un despliegue por red ni esperaba a que terminara la descarga/instalación del worker. Navbar solo ofrecía actualizar si ya existía un pendiente; Acerca de no permitía comprobar.
- Había dos temporizadores propios para `registration.update()`: cinco minutos en el monitor y una hora en el coordinador, fuera de una misma exclusión de concurrencia.
- `controllerchange` intentaba recargar cualquier pestaña si su guard retornaba true. Ese guard solo comprobaba ownership de checkout y operaciones del actor; no incluía respaldo, transacciones nativas, sincronización o peticiones financieras que sobreviven un timeout de interfaz.
- Workbox elimina entradas antiguas del precache al activar. Activar sobre otra ventana deja a su documento anterior dependiendo de recursos antiguos. El puente legacy solo hacía `clients.claim()` una vez, por lo que no era una garantía uniforme para despliegues posteriores.

## Solución y archivos

- `vite.config.js`, `appVersion.js`, `vercel.json`: JSON de build generado con el mismo identificador usado por documento y worker; SHA completo (primero `VERCEL_GIT_COMMIT_SHA`, luego Git), fecha UTC e ID `SHA:fecha`. Metadatos fuera del precache, ruta NetworkOnly en `sw.js`, headers no-store y exclusión del fallback SPA.
- `adminServiceWorkerUpdateMonitor.js`: único monitor. Una comprobación compartida para foco/resume/online/visibilidad/temporizador y acción manual. Throttle automático de un minuto, polling visible de cinco minutos, timeout de veinte segundos. La consulta manual omite el throttle y comparte el trabajo en curso. Una petición nativa `update()` que sobreviva el timeout se reutiliza hasta resolver; no se dispara otra simultánea.
- Se valida respuesta HTTP, content-type y estructura del JSON; después se comprueba el worker y se espera su instalación. Error, respuesta HTML, descarga incompleta o timeout nunca equivalen a «actualizada». En web sin soporte de SW se puede comparar el documento contra el JSON y recargar con guard.
- `adminServiceWorker.js`, `sw.js`: consulta de identidad por MessageChannel; recuperación de documento antiguo frente a controller nuevo; reintento tras fallo de registro; listeners de instalación y activación; pendiente conservado. Solo la ventana cuya persona pidió actualizar puede recargarse automáticamente. Las demás reciben un pendiente.
- El worker nuevo exige cerrar otras ventanas administrativas antes de `skipWaiting`, incluyendo ventanas suspendidas. Se excluyen rutas públicas de tienda/API/auth conforme a la política existente. La solicitud bloqueada retorna una explicación y permite reintentar. Es una política conservadora deliberada para proteger también los recursos de otras ventanas.
- `UpdateControls.jsx`, `Navbar.jsx`, `AboutPage.jsx`: «Buscar actualizaciones» permanente en menú móvil, menú de escritorio y Acerca de. Estados en español, región aria-live, búsqueda deshabilitada durante trabajo en curso, última comprobación correcta y compilación publicada en este origen. Acerca de muestra versión comercial, SHA exacto, fecha e identificador completo desplegable.
- `UpdatePrompt.jsx/.css`, `createPWASlice.js`: tarjeta discreta, sin modal ni toma de foco, controles de al menos 44 px, opción Más tarde, acceso permanente al pendiente. No se lee ni escribe el antiguo booleano de sesión. Se conserva la decisión mientras siga pendiente la misma compilación; otra identidad conocida vuelve a avisar. Un recibo opcional por pestaña solo muestra «Actualización completada» al verificar la compilación objetivo tras recargar.
- `adminUpdateSafety.js`, `dexie.js`, `PosApplicationBootstrap.jsx`: se reutilizan los guards de actor/checkout y se suman transacciones readwrite reales (hasta complete/abort), preparación de IndexedDB, respaldo/restauración y sincronización activa. Los carritos persistidos y las colas durables pendientes no bloquean indefinidamente una actualización: bloquea el trabajo actualmente en ejecución.
- `financialTimeout.js`: protección de recarga durante la vida real de la petición financiera, incluso si el timeout público ya terminó. No modifica ledger, idempotencia, receipt, autoridad, payload ni protocolo de Cloud.
- `CajaPage.jsx`, `useNavigationGuard.js`, `EcommerceSiteBuilderFoundation.jsx`: formularios de caja abiertos y ediciones ya protegidas por navegación también posponen la actualización. El motivo es visible y se libera al terminar/cerrar.
- `scripts/qa/pwa-updates/`: prueba aislada reproducible con dos builds reales de Vite/Workbox y Chromium en un mismo origen. Utiliza los componentes y coordinador de producción, una slice Zustand aislada y registros IndexedDB sintéticos. Ningún fixture se incorpora al build ordinario ni usa licencias, tenants, RPC o datos de negocio.
- `.github/workflows/pwa-update-validation.yml`: regresiones, build, contrato de precache y recorrido real de navegador; adjunta evidencia JSON y capturas como artifact. Tests de navegación corrigen su entorno jsdom y cleanup para que su resultado sea reproducible.

## Persistencia y recuperación

No hay borrados de IndexedDB, localStorage, sesiones, carritos, reservas, caja ni colas Cloud en este actualizador. El único dato nuevo de sesión es el identificador objetivo del recibo de recarga; se elimina al confirmar ese mismo build. Los carritos múltiples ya se conservan con la persistencia por tenant de `useActiveOrders`; no se sustituyó ese mecanismo. Reservas, ledger financiero y outbox mantienen sus contratos existentes.

Se conserva `injectManifest`, `registerType: prompt`, el precache Local y las cachés runtime acotadas existentes. La recuperación de chunks sigue siendo independiente: una recuperación **explícita** existente puede reconstruir cachés de aplicación, nunca se invoca para forzar una comprobación normal. No se agregaron SQL, tablas, servicios externos ni cambios en Supabase Production.

Al cerrar la última ventana, el navegador puede activar naturalmente el worker en espera sin una acción adicional. Reabrir debe ejecutar la compilación activa, no volver a avisar por una versión ya aplicada. Ante una descarga fallida se conserva la aplicación anterior. Una actualización ya descargada puede aplicarse offline si los guards permiten la recarga.

## Versionado

Se mantiene **4.0.0** como versión comercial de este PR. No se aumenta por cada PR. Propuesta para el próximo lanzamiento aprobado: **4.1.0**, mediante el script `version:minor` existente, revisando el resultado en un cambio de release.

Cada build se identifica independientemente con SHA completo + fecha UTC, incluso si se recompila el mismo commit. El SHA debe coincidir con el commit del deployment Vercel. La comparación «actualizada» se refiere exclusivamente a la compilación publicada en el **mismo origen**; no consulta la última versión global ni Production desde Preview. El identificador del worker se puede contrastar aun offline, pero no permite afirmar que no haya otro despliegue en el servidor.

Un build local con árbol modificado identifica su commit base, no un commit futuro. Para evidencia de revisión se ejecuta también sobre código confirmado en Git y en CI sobre el SHA del PR.

## Evidencia y límites de aceptación

Ver `VALIDATION.md` y `browser-evidence.json` para resultados observados. El fixture de navegador es evidencia de integración del actualizador, **no** de una venta comercial real ni de instalación Android. READY y CI verde son estados independientes del QA funcional pendiente.

No se dispone en este entorno de instalación Android real ni de un tenant comercial de prueba autorizado para recorrer ventas y cobros Cloud. No se realizaron operaciones financieras en Production. La transición desde un cliente anterior a este PR requiere QA manual: el JavaScript anterior conserva sus propios guards hasta que cargue el nuevo documento.

Limitaciones concretas:

- Otra ventana administrativa, aunque esté inactiva o suspendida, debe cerrarse antes de activar explícitamente. Si se abre otra justo después de la enumeración de clientes del worker, el coordinador del nuevo código no la recarga automáticamente; las transacciones activas siguen protegidas. El chequeo de ventanas no es un bloqueo distribuido de creación de ventanas.
- Una petición financiera nativa que no llegue a asentarse conserva el bloqueo de actualización de esa sesión. El mensaje pide esperar; el ledger y la recuperación existentes siguen siendo la autoridad sobre un resultado financiero ambiguo. No se fuerza una recarga para eliminar ese estado.
- Un timeout/fallo de conexión deja el estado como no comprobado; conservar la última comprobación correcta visible no afirma vigencia actual.
- Caché y almacenamiento de navegadores siguen sujetos a las políticas de cuota/expulsión del SO. Este cambio no convierte un navegador en un respaldo de negocio ni modifica el gestor de persistencia existente.

## QA manual antes de Production

Usar un origen estable de **prueba**, un perfil limpio y datos ficticios. Dos URLs inmutables de Preview distintas tienen orígenes y almacenamiento distintos: no sirven para simular A→B. Para ello usar el alias de la rama o un servidor de prueba con el mismo origen y dos despliegues sucesivos. Registrar SHA/ID, screenshots, worker waiting/active, datos y número de recargas.

- [ ] Chrome web Android y escritorio: abrir A; desplegar B sobre el mismo alias de prueba; buscar; observar búsqueda y disponible; actualizar una vez; verificar SHA/fecha de B en Acerca de y `build-info.json` por red. Volver a buscar: actualizada, sin un aviso anterior.
- [ ] PWA Android instalada: instalar A, trabajar y abrir B en el mismo origen; posponer; comprobar acceso desde menú y Acerca de; cerrar **todas** las ventanas de ese origen y reabrir. Registrar si B se activó naturalmente o sigue pendiente; nunca inferirlo solo del cierre del aviso. Repetir con una compilación C para verificar nueva notificación.
- [ ] Venta Local: crear dos carritos, una reserva y una operación pendiente; abrir cobro y tratar de actualizar; debe indicar el motivo, sin recarga. Completar/cancelar el cobro; actualizar; confirmar carritos, importes, stock, reservas, historial y caja.
- [ ] Caja/Cloud de prueba: mantener un formulario con importe capturado; comprobar bloqueo. Durante una escritura/sync/RPC retenida, incluido timeout público con respuesta tardía, intentar actualizar; no recargar. Dejar terminar y verificar ledger/receipt/proyección y que la actualización vuelva a estar permitida, sin reenvío financiero.
- [ ] Offline: preparar shell y rutas Local; cortar conectividad; reabrir y usar recursos disponibles; «Buscar» debe informar falta de conexión. Una actualización completamente descargada puede aplicarse sin red. Reconectar y repetir comprobación.
- [ ] Varias ventanas: mantener B con un cobro y pedir actualizar desde A. Debe pedir cerrar las otras ventanas; ningún documento se recarga ni pierde recursos. Finalizar/cancelar y cerrar B, reintentar desde A. Incluir pestaña suspendida y PWA + navegador del mismo perfil/origen cuando compartan registro.
- [ ] Migración desde main anterior: con datos de prueba en un perfil que ejecute realmente `e7a85fcb…`, publicar candidato sobre el mismo origen. Verificar aviso anterior, activación, cierre/reapertura, permanencia de datos y búsquedas posteriores con la nueva UX.
- [ ] Accesibilidad/mobile: teclado, lector de pantalla, zoom, safe area y pantalla pequeña; aviso sin robar foco, Más tarde y menú accesibles, sin encubrir controles esenciales durante una venta.

El objetivo funcional queda preparado para revisión; el QA de instalación Android, la migración legacy y las operaciones reales de un tenant de prueba deben aprobarse antes de considerar cumplido el objetivo en Production.
