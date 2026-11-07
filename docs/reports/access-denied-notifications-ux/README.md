# LANZO_ACCESS_DENIED_NOTIFICATIONS_UX_REPORT

## Base y causas

Base: `main` en `3cc574d833a4f962247c462e3212ddb4c6a03910`, merge de [#408](https://github.com/fdxruli/Lanzo-POS/pull/408). No había trabajo posterior ni otro PR abierto para este objetivo al investigar y antes de publicar. Se conserva su autoridad ActorRuntime y sus guards.

**A, demostrado:** `NoPermission` usaba un Link fijo a `/` incluso sin POS. Recibía estilos globales de botón, pero no tenía reglas específicas para `permission-blocker`; el layout elimina el padding horizontal en móviles. El fallo no era ausencia total de estilos.

**B, demostrado en código y pruebas controladas:** campana y drawer usaban rol/permisos de Zustand sin la validación canónica de #408. `canStaffAccessNotifications` acepta cualquier contexto que no identifique explícitamente Staff; `openNotificationCenter` no comprobaba acceso. El ownership distinguía licencia/actor, pero no sesión, generación o permisos efectivos. Un rol histórico de Admin o una transición incompleta podía ofrecer el Centro aun con ActorRuntime bloqueado. Las pruebas reproducen ese desacuerdo y verifican ahora su denegación. Con rol Staff correcto y `notifications: false`, la comprobación anterior sí ocultaba la campana: **no se ha probado qué estado concreto tenía el Android del 6 de noviembre**. No se atribuye el incidente a una causa histórica no observada.

El error del servidor se convertía en texto genérico recuperable, sin conservar su condición de autorización. El grid del cuerpo estiraba el estado y sus filas, incluido Reintentar. Las clases de estado también se utilizan en soporte y alertas locales; el arreglo visual está acotado al Centro Cloud.

## Solución y archivos

- `src/components/common/NoPermission.{jsx,css}`: tarjeta mobile-first con tokens existentes, mensajes para permisos/sesión no confirmada, safe areas y botón táctil. POS → Productos/Inventario → Caja → Clientes → Pedidos; después Ventas, Pedidos Online, Configuración, Portal Online y Agentes IA usando sus políticas reales. Se excluye la URL bloqueada; Acerca de es la salida final sin guard de módulo.
- `src/services/auth/routePermissions.js`: selección de rutas simples sobre el mapa existente. `actorAccessPolicy.js`: contexto de permisos efectivos compatible con las políticas existentes, conservando denegaciones explícitas de categorías.
- `src/services/notifications/notificationAccess.js`: vínculo con `readActorAccess`, contexto de licencia/sesión/generación/dispositivo/negocio y clasificación de códigos definitivos existentes.
- `NotificationBell.jsx`: entrada Cloud solo con autoridad vigente; badges antiguos se ocultan; sincronización del runtime. Se conservan las reglas de alertas locales de inventario, respaldos y conciliación.
- `NotificationCenterDrawer.jsx` y `NotificationCenter.css`: denegación tranquila con cierre, sin controles ni reintentos; error temporal recuperable, carga y vacío separados. Foco inicial, Tab/Mayús+Tab, Escape y restitución del foco. CSS acotado para evitar filas y botones estirados.
- `createNotificationSlice.js` y `createNotificationActorStateSlice.js`: apertura y acciones autorizadas, limpieza de notificaciones/tickets/badges al cambiar contexto o recibir denegación definitiva, descarte de respuestas tardías y protección de vistos/conteos. Una nueva autoridad confirmada puede recuperar el acceso.
- `Navbar.css`: respeta `hidden` frente a las reglas de display de los enlaces móviles y de escritorio.
- Pruebas focales de navegación, guards, campana, categorías y slices; fixtures existentes actualizados a autoridad real y al nuevo texto. Otros tests de Configuración, dispositivos y mantenimiento solo ajustan el mensaje esperado.
- `scripts/qa/access-denied-notifications/browser.mjs` y fixture visual opcional: comprobación reproducible de CSS en Chromium sin dependencias nuevas. Las imágenes y `browser-results.json` son estados controlados, no datos ni QA real de El Balón.

## Seguridad y límites

No se amplían permisos ni se alteran guards, RPC, RLS, migraciones, licencias, sesiones o datos productivos. No se consultó ni modificó producción: los contratos de servidor se inspeccionaron en el repositorio. No se añadieron dependencias. Las comprobaciones frontend complementan al servidor.

La revocación remota se refleja cuando la autoridad normal actualiza el cliente o el servidor rechaza una interacción. No se añade un sistema nuevo de polling ni se promete detectar revocaciones remotas sin conexión. Códigos de servidor que ocultan su causa como error genérico siguen siendo temporales: el cliente no puede inferir una denegación definitiva que el contrato no comunica.

## Validación

**Resultados finales locales:** 712 pruebas PASS y 1 fixture visual opcional omitido en la ejecución normal; fixture visual ejecutado por separado, 48 comprobaciones Chromium PASS; lint de los 21 archivos JS/JSX modificados PASS; lint global FAIL (151 errores y 164 advertencias; comparación con main en curso al preparar el informe); build y postbuild PASS; 5 pruebas de alcance CSS PASS. GitHub y Preview: consultar el único PR Draft y el reporte de entrega con el SHA correspondiente. Comandos ejecutados:

- `npx vitest run ... --maxWorkers=4`: guards comunes, NoPermission, notificaciones, Navbar, pedidos online, IA, aislamiento de Configuración, acceso a mantenimiento/dispositivos, auth, capacidades/servicios de notificaciones y ambos slices.
- `npm run lint`: FAIL; `git diff --cached --name-only -z -- 'src/**/*.js' 'src/**/*.jsx' | xargs -0 npx eslint`: PASS. La comparación aislada con main usa el mismo `npm run lint` en un worktree limpio.
- `npm run build` (incluye `postbuild`, auditoría de precache de arranque y bot).
- `npm run test:button-css-scope`.
- `LANZO_ACCESS_VISUAL_DIR=/tmp/lanzo-access-visual npx vitest run src/components/notifications/__tests__/accessVisual.fixture.test.jsx --maxWorkers=1`.
- `ACTOR_QA_CHROMIUM_EXECUTABLE=/usr/bin/chromium node scripts/qa/access-denied-notifications/browser.mjs`.

Visual: 48 combinaciones, anchos 320/360/393/1280, claro/oscuro, bloqueo normal/POS, denegación Cloud, conexión, carga y vacío. Sin overflow horizontal, botones de acción de 44–89 px, estado compacto, enlaces `hidden` realmente ocultos y tarjeta fuera de la navegación inferior. No equivale a emulación completa de Android. Las comprobaciones de teclado funcionales se ejecutan sobre componentes React en Testing Library; las imágenes son DOM serializado.

Durante la integración fallaron fixtures antiguos sin autoridad confirmada, aserciones del texto sustituido y una expectativa que exponía el error técnico. Se actualizaron a los contratos finales; no se declararon pruebas reales como ejecutadas. Build puede emitir advertencias de anotaciones de dependencias Zod; no son errores de compilación.

## QA y veredicto

[Recorrido específico de El Balón](QA_EL_BALON.md): **PENDIENTE**, sin PASS inventados.

Código: candidato preparado. QA automatizado local: pruebas/build/lint focal PASS (712 pruebas + 48 comprobaciones visuales + 5 pruebas de alcance CSS). Lint global FAIL, documentado sin ocultarlo. QA manual/Android real: pendiente. Production: sin cambios; sin merge y sin despliegue manual. Objetivo funcional: implementación candidata, aceptación de negocio pendiente del recorrido real.

Acción recomendada: abrir el Preview del PR y ejecutar el recorrido mínimo de El Balón.
