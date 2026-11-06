# LANZO_BOT_IMPLEMENTATION_REPORT

## 1. Entrega y alcance

- Repositorio: `fdxruli/Lanzo-POS`.
- Rama: `fix/lanzo-bot-contextual`.
- Base `main` verificada con `git fetch origin main` al inicio y al cierre: `5e1b4303e942657c406d91237ffa7ff44db91cec`.
- HEAD del código validado: `57e8178a4b492cf94dfda4f87917aa4eb8587cf2`. Los commits posteriores de esta entrega documentan evidencia y resultados del Preview.
- PR Draft único contra `main`: [#394](https://github.com/fdxruli/Lanzo-POS/pull/394), abierto y sin merge.
- Se revisaron los PR abiertos antes de crear la rama: no había uno abierto que atendiera Lanzó Bot. El PR abierto devuelto era #374, sobre migraciones FIN01 y ajeno al asistente.

| Estado separado | Resultado |
| --- | --- |
| Código preparado | Núcleo funcional y 37 guías en 11 rutas; un solo motor; consultas de lectura protegidas. |
| QA automatizado | 288 pruebas / 18 archivos; navegador Chromium aislado en cuatro escenarios; build y auditorías PWA. |
| QA manual | Pendiente: sin sesión de negocio de prueba disponible, Windows real, Android físico ni PWA instalada. |
| Production | Sin cambios, SQL, migraciones, activaciones ni operaciones comerciales. Sin merge ni force push. |
| Objetivo funcional cumplido | Núcleo demostrado en automatización. Objetivo global pendiente de QA real y de las limitaciones de datos Nube descritas abajo. |

## 2. Causas confirmadas y clasificación

| Hallazgo | Clasificación y evidencia | Tratamiento |
| --- | --- | --- |
| Una sugerencia antes del PONG solo rellenaba `userInput`; el campo seguía deshabilitado por `!isReady`. | Fallo demostrado en prueba React sobre el código inicial: no se enviaba `PROCESS_MESSAGE` y quedaba el texto en el campo deshabilitado. | Se eliminó la dependencia de readiness y se usa un recorrido único de envío. |
| `pageContext` incluía `icon`, un componente React con funciones internas, dentro del objeto enviado por `postMessage`. | Fallo de clonación demostrado con `structuredClone({page:{icon:ShoppingCart}})`; defecto estático confirmado en la llamada original al Worker. No se atribuye a hardware específico. | El bot ya no usa mensajes entre procesos ni serializa componentes. |
| El Worker importaba servicios que usan el proxy de `tenantRuntimeRouter`, cuyo `active` es estado del módulo; no inicializaba ese runtime en su propio proceso. | Defecto estático confirmado: `current()` exige un runtime abierto; el Worker no recibía ni establecía esa autoridad. No se hizo QA manual del Worker original en un negocio real. | Lecturas en el runtime de la aplicación, por servicios oficiales. No se abre otra base ni se infiere el negocio por su nombre. |
| `postMessage` podía lanzar después de registrar la promesa y el timeout; el manejo de errores dejaba readiness/ref inconsistentes y no ofrecía reinicialización. | Defectos estáticos confirmados. No se afirma que todos ocurrieran en cada dispositivo. | Se retiró ese transporte y su mapa de promesas. El nuevo hook tiene cancelación y timeout de 15 s, sin recursos pendientes después de finalizar. |
| El bot calculaba ventas y utilidad directamente, sin los contratos actuales de descuentos, costos y estados. | Defecto estático confirmado; el filtro original solo miraba `fulfillmentStatus !== 'cancelled'` y la utilidad multiplicaba precio/costo sin usar la política financiera vigente. | Repositorio de reportes, política financiera y agregación compartida con el dashboard. |
| Se sospechaba que `customer.debt` era siempre obsoleto. | No confirmado como defecto universal: el repositorio oficial Local todavía utiliza ese campo. Sí se confirmó que el bot lo leía por su cuenta y simulaba antigüedad de deuda. | Se usa el reporte oficial de crédito; se prefiere su importe en centavos cuando existe. No se cambió ningún esquema ni saldo. |
| La disponibilidad del bot estaba ligada a reportes; había contextos duplicados y pestañas fuera de la URL ignoradas. | Defectos estáticos confirmados en Layout y las páginas. | Ayuda para actores autorizados sin requerir reportes; permisos dentro de las consultas; publicación explícita de pestañas resueltas. |
| Los servicios de inventario capturaban fallos y devolvían `[]`. | Defecto confirmado para un consumidor que necesita distinguir error de ausencia de resultados. Pruebas nuevas verifican ambos casos. | Opción optativa `throwOnError`, sin cambiar el comportamiento de los consumidores anteriores. |
| El precaché no incluía los archivos opcionales del asistente. | Defecto estático de disponibilidad offline en una primera apertura; auditoría del build confirmó la ausencia. | Se incluyen los archivos del bot y se comprueba su cierre de dependencias estáticas. |

Riesgos plausibles que no se presentan como fallos demostrados: diferencias de teclado virtual entre fabricantes Android, actualización de una PWA antigua, latencias de un catálogo grande y comportamiento con una sesión real que expire durante una petición Nube. La automatización cubre sus límites de estado y autoridad; falta QA real.

## 3. Correcciones

- Un único motor en la aplicación. `AssistantBot` continúa con carga diferida; el motor operativo se carga con él y no necesita inicializar un Worker.
- Sugerencia, formulario, Enter, opciones de seguimiento y Reintentar comparten el envío. Bloqueo síncrono de solicitudes simultáneas y protección de 500 ms contra repeticiones idénticas.
- Indicador visible de procesamiento; error comprensible y reintento explícito. El timeout incluye cualquier espera de carga/procesamiento.
- Cancelación al cambiar ruta, búsqueda, pestaña, actor o tenant; respuestas tardías descartadas. El historial no se persiste y se limita a 40 mensajes.
- Las lecturas capturan el handle de `actorRuntimeController`, verifican permisos antes de cargar servicios y antes/después de cada llamada del adaptador. Una respuesta de otro contexto no se muestra.
- Reportes protegidos por `reports`; crédito exige además `customers`, inventario exige además `inventory`. No se toma un booleano enviado desde la UI como autoridad de lectura.
- No se muestra a Staff ordinario un fallback Local/Mixto de alcance de negocio cuando el repositorio no puede aplicar un filtro individual. Nube usa el alcance autorizado por la política existente.
- Un error, métrica ausente o costo incompleto no se convierte en cero ni en una utilidad confirmada.

## 4. Mejoras funcionales y UX

El panel abre directamente la ayuda y el chat, sin modos redundantes ni avisos comerciales proactivos. Muestra pantalla/pestaña, rubro, Local/Nube y conexión. Las sugerencias permanecen en un desplegable, sin desplazar la conversación.

Las respuestas incluyen procedimientos numerados y enlaces revisados contra el registro de rutas. Los atajos comprueban permisos de sección; pedidos online y Lía reutilizan sus políticas vigentes de acceso y disponibilidad. Cuando no hay acceso, se explica el requisito.

El diseño mantiene los tokens de LANZO POS, temas claro/oscuro, controles de 44 px, texto de entrada de 16 px, `role=log`, estado de procesamiento y cierre con Escape que devuelve el foco. El panel se ajusta a `visualViewport`; abrirlo no activa automáticamente el teclado del teléfono. Los estilos están limitados al asistente y no modifican botones genéricos de otras pantallas.

Las guías añaden indicaciones para abarrotes, farmacia, restaurante, frutas/verduras, ropa/calzado y ferretería. Staff recibe orientación sobre opciones restringidas. Cocina tiene pasos distintos para Local y Nube. Una pregunta desconocida ofrece tareas de la pantalla, sin inventar capacidades.

## 5. Cobertura preparada

| Sección real | Guías y ejemplos |
| --- | --- |
| Punto de venta `/` | Venta rápida, búsqueda/escaneo, cantidades/descuentos, cliente al cobrar, cancelación y apartados. «¿Cómo cambio cantidades y descuentos?» |
| Productos | Agregar Producto, Productos (Venta), edición/inactivos, Gestionar Lotes, entradas, costos/márgenes, errores de stock, categorías, ingredientes, variantes y configuración restaurante. «¿Cómo agrego stock o un lote?» |
| Clientes | Agregar cliente, historial, edición/límites de crédito, abonos, apartados, mensajes y recordatorios según disponibilidad. «¿Cómo registro un abono?» |
| Caja | Turno/apertura, entradas/salidas/retiros, corte, diferencias, Movimientos, Historial y alcance de Negocio. «¿Qué hago si la caja no cuadra?» |
| Restaurante | Mesas/cuentas/comandas, preparación, entrega y KDS Local/Nube. La preparación no se confunde con el estado de pago. |
| Reportes | Estadísticas Clave, período/fuente, costos faltantes, Historial y Papelera/cancelación, Reabastecimiento, Caducidad y Mermas. |
| Configuración | Datos y Apariencia, Controles, Licencia y Rubros, Dispositivos/permisos, Datos y Mantenimiento, Respaldos. |
| Portal online | Información, Catálogo, Operación, Diseño y disponibilidad de Lanzo Nube. Publicación controlada y verificación en Abrir tienda. |
| Pedidos online | Revisión de bandeja, estado, artículos y entrega, con requisitos de permiso/función/conexión. |
| Lía `/agentes-ia` | Diferencia respecto de Lanzó Bot, preguntas de análisis, períodos, evidencia, simulaciones y límites de plan/uso. |
| Acerca de | Soporte, versión, mantenimiento e instalación PWA desde el navegador. |

Consultas comerciales reconocidas: «¿Cuánto vendí hoy?», «¿Cuál fue mi ganancia esta semana?», «¿Quién me debe dinero?», «¿Qué productos tienen stock bajo?», «¿Qué productos están por caducar?» y «¿Qué se vende más este mes?».

Períodos de ventas: hoy, ayer, semana desde el lunes, semana pasada, mes actual, mes pasado y últimos 1–366 días. Otras fechas piden concreción en lugar de consultar otro período silenciosamente. Caducidad consulta los próximos siete días y stock es una copia local explícita.

## 6. Optimización y beneficios verificables

- Se elimina un Worker completo, su handshake, mapa de promesas, transferencias de contexto y cadena de servicios duplicada en otro proceso.
- Se retiran el scoring fuzzy repetido por intención, análisis de sentimiento y memoria global que no eran necesarios para esta ayuda determinista. No se registran las preguntas en consola.
- Un catálogo de 37 guías sustituye contextos operativos duplicados y sus listas de enlaces contradictorias. Se conserva la política de avisos globales.
- El bot deja de suscribirse a estadísticas y al catálogo completo para producir resúmenes automáticos. Mantiene solo una suscripción booleana al carrito para colocar el botón.
- La agregación de productos se extrae sin cambiar sus reglas de `TopProducts`; bot y dashboard consumen la misma función. No se reimplementan cálculos financieros.
- Los servicios de datos se cargan al hacer una consulta. La ayuda operativa no requiere una API, IA externa ni nuevas credenciales.
- Auditoría de build: cinco archivos del bot y 24 dependencias estáticas verificados en el precaché. La prueba Chromium del SW desactiva la caché HTTP para comprobar entregas offline reales.

Estos son beneficios estructurales y comprobaciones de recursos. No se midieron RAM, batería ni velocidad en dispositivos físicos; no se atribuyen mejoras porcentuales.

## 7. Archivos y motivo

| Archivos | Motivo |
| --- | --- |
| `src/components/common/AssistantBot.jsx`, `AssistantBot.css` | Recorrido único de preguntas, estado/cancelación, navegación, panel móvil, foco y estilos aislados. |
| `src/hooks/useBotAssistant.js` | Límite temporal, cancelación, exclusión de solicitudes concurrentes y limpieza. |
| `src/hooks/useBotScreenContext.jsx` | Contexto React para pestañas reales que no aparecen en la URL. |
| `src/config/botKnowledge.js` | Catálogo de procedimientos, rutas, preguntas y pantallas. |
| `src/config/botContext.js` | Se conserva la política existente de avisos; se retiran contextos operativos sustituidos. |
| `src/config/botContextByRubro.js` | Indicaciones compactas por rubro, sin un segundo catálogo de rutas. |
| `src/utils/botIntelligence.js`, `IntentPatterns.js`, `nlpEngine.js` | Motor único, intenciones específicas y rangos de calendario explícitos. |
| `src/utils/botNavigation.js` | Validación de destinos y reutilización de permisos/disponibilidad. |
| `src/services/botReadService.js` | Adaptador de lectura autorizado; fuente, ausencia de datos y calidad financiera. |
| `src/services/inventoryAnalysis.js` | Opción estricta optativa para distinguir error de lista vacía. |
| `src/services/reports/productStats.js`, `src/components/dashboard/TopProducts.jsx` | Compartir la agregación existente del dashboard sin duplicarla ni cambiar sus reglas. |
| `src/components/layout/Layout.jsx` | Disponibilidad de ayuda independiente de reportes y proveedor de contexto. |
| `src/pages/ProductsPage.jsx`, `CustomersPage.jsx`, `DashboardPage.jsx`, `SettingsPage.jsx`, `CajaPage.jsx` | Publicar pestaña resuelta, incluida la persistida o limitada por permisos. |
| `src/components/ecommerce/EcommercePortalSettings.jsx`, `src/components/restaurant/LocalKitchenMonitor.jsx`, `CloudKitchenMonitorRest8Container.jsx` | Publicar sección/estado local de portal y cocina. |
| Eliminados: `src/hooks/useBotWorker.js`, `src/workers/bot.worker.js`, `src/workers/__tests__/botWorker.test.js` | Retirar el transporte inseguro para ese runtime y una prueba limitada al PING. Se sustituyen por pruebas del recorrido completo y autoridad. |
| `src/components/common/__tests__/AssistantBot.test.jsx`, `src/hooks/__tests__/useBotAssistant.test.jsx` | Preguntas, Enter, repetición, recuperación, timeout, cancelación, offline y navegación. |
| `src/utils/__tests__/botIntelligence.test.js` | Procedimientos, consultas frecuentes, rutas, pestañas, períodos y políticas de atajos. |
| `src/services/__tests__/botReadService.test.js`, `botInventoryReads.test.js`, `src/services/reports/__tests__/productStats.test.js` | Lecturas, autoridad, cambios de tenant, calidad de datos, errores y agregación compartida. |
| `src/components/layout/__tests__/Layout.reportAuthorization.test.jsx` | Ayuda para Staff sin cargar reportes; se nombran los componentes mock para cumplir las reglas de hooks. |
| `vite.config.js`, `package.json`, `scripts/audit-bot-precache.mjs` | Precaché del bot y gate de dependencias offline durante postbuild. Sin dependencias nuevas. |
| `scripts/qa/lanzo-bot/{fixture.html,fixture.jsx,smoke.py,precache.py}` | Navegador aislado y prueba del Service Worker generado, reproducibles sin sesión ni operaciones reales. |
| Este informe y `docs/reports/lanzo-bot/` | Resultados y capturas sin datos de negocio. |

## 8. Validación ejecutada

| Prueba mínima | Evidencia y alcance real |
| --- | --- |
| Sugerencia → procesamiento → respuesta | React con motor real y Chromium con identidad/stores simulados. Worker ausente. |
| Pregunta manual / Enter | React + Chromium. |
| Inicialización y recuperación | Loader/processor fallido y reintento; sin requisito de iniciar Worker. Suite existente de carga diferida opcional incluida. |
| Timeout / respuesta tardía | Temporizadores controlados en hook; navegación durante petición en componente. La respuesta tardía no sustituye una nueva consulta. |
| Navegación desde respuesta | React Router y Chromium a `/productos?tab=batches`; guard de rutas y permisos. |
| Reconocimiento frecuente | Guías, variantes de preguntas comerciales/operativas y períodos. |
| Administrador / Staff | Controlador real de autoridad con identidad/tenant sintéticos; mocks de repositorios para no consultar cuentas reales. |
| Aislamiento de tenants | Cambio A → B durante lectura: se descarta el resultado. También suite existente de `tenantRuntimeRouter` con IndexedDB sintético. No se abren bases de negocios reales. |
| Falta de datos | Excepción, métrica ausente, costos faltantes, lista vacía e inventario incompleto; nunca se afirma cero por un error. |
| Offline / reconexión | Guías tras desconexión en Chromium; estado actualizado al reconectar. SW del build entrega archivos en primera petición offline con caché HTTP deshabilitada. No certifica sincronización financiera real. |

Resultados finales:

- `vitest`: **288 PASS**, **18 archivos**, sin pruebas fallidas. [Registro](lanzo-bot/automated-tests.log).
- Incluidas suites de Layout, tenant, inventario, Caja, Clientes, Configuración, portal, carga opcional y POS/lector físico con fixtures. No equivalen a QA con un lector real.
- `eslint` sobre todos los JS/JSX modificados o creados: **PASS**, sin errores ni advertencias.
- `git diff --check`: **PASS**.
- `npm run build` y auditorías postbuild: **PASS**. Workbox avisa sobre patrones de archivos que no emiten chunks independientes; el gate verifica los archivos efectivamente emitidos. Zod emite avisos de anotaciones de terceros; no impiden el build.
- Chromium headless en Linux: **PASS** en 320×568, 390×844, 1440×900 y 390×844 con tema oscuro; sin `pageerror`. [Resultados](lanzo-bot/browser-results.json), [móvil](lanzo-bot/android-size.png), [oscuro](lanzo-bot/android-dark.png), [escritorio](lanzo-bot/windows-size.png).
- Service Worker: [evidencia](lanzo-bot/precache-results.json). Se usa un origen localhost limpio y el manifest como documento, sin abrir sesión ni ejecutar el bootstrap del POS.

Reproducción de navegador: iniciar `npm run dev -- --host 127.0.0.1`, ejecutar `python3 scripts/qa/lanzo-bot/smoke.py`. Para SW: `npm run build`, servir `dist` en localhost:4173 y ejecutar `python3 scripts/qa/lanzo-bot/precache.py`. Requiere Playwright Python y Chromium; no se agregaron al paquete del producto.

## 9. Vercel Preview

- Proyecto/equipo: `lanzo-pos` / `team_buvft2mAJErTNR8gDhXcZGfS`.
- Preview automático observado: **READY**, `dpl_Dx23bMN7FoHBXv8bxpFtYkgeVMmA`.
- SHA desplegado: `7acd41197a45de794407c9673b8c94111be303cf` (código `57e8178a` más informe/evidencia).
- URL: https://lanzo-nsezp1po5-fdxrulis-projects.vercel.app
- GitHub registra `Vercel – lanzo-pos: success` para ese SHA. Esto no es el resultado de la suite completa de CI.
- Acceso HTTP directo observado: **302 a Vercel SSO**. No hay sesión de aplicación de un negocio de prueba ni identidad CLI local disponible para recorrer el POS en ese Preview.
- **QA funcional autenticado en Preview: NO EJECUTADO.** READY no certifica el bot, sus cifras ni los dispositivos.
- No se ejecutó despliegue manual, promoción ni cambio de protección de Vercel. Los commits documentales posteriores no cambian el código validado.

## 10. Límites pendientes y problemas conocidos

- No hay QA manual autenticado con un negocio de prueba ni certificación en Android físico, Windows o PWA instalada. Los cuatro viewports son Chromium Linux, no esos dispositivos.
- El ranking Nube no se calcula a partir de páginas parciales: el contrato de overview disponible no entrega un ranking completo. Solución mínima entregada: explicación y enlace válido. Ampliarlo requeriría decidir entre un contrato oficial agregado o un recorrido paginado completo con límites de rendimiento; no se añade una RPC, migración ni servicio externo sin autorización.
- Stock/caducidad son la copia local y pueden estar incompletos en Nube. No se presentan como inventario global al día. Caducidad consulta siete días.
- Staff con reportes pero sin auditoría global no recibe cifras de un fallback local que no separa usuarios. La ayuda operativa sí permanece disponible.
- Contratos mixtos/antiguos que no entreguen ventas netas o una lista de deudores confirmada reciben una explicación de ausencia de datos. No se rellenan métricas por intuición.
- Las guías describen tareas verificadas, no todos los posibles estados de cada modal. El bot no lee un formulario abierto ni ejecuta operaciones; para una pregunta no reconocida ofrece tareas de la pantalla.
- La ayuda offline exige haber descargado la aplicación y activado su Service Worker previamente. Una visita inicial sin ningún archivo descargado no puede funcionar offline.
- No se ejecutó la suite completa del repositorio ni se certifica ausencia de toda regresión posible. No hay regresiones conocidas en las suites seleccionadas.

## 11. QA manual breve: Android, Windows y PWA

1. Usar el Preview y un negocio de prueba existente. Entrar como administrador; abrir Lanzó Bot en POS y pulsar una sugerencia. Confirmar indicador y respuesta; enviar una pregunta con Enter y repetir rápidamente el botón.
2. Navegar por Productos/lotes, Clientes/abonos, Caja/Movimientos e Historial, Reportes/Caducidad, cocina y portal. Confirmar que título, sugerencias, procedimientos y destinos coincidan con la pestaña visible.
3. Preguntar ventas de hoy, ganancia, deudores, stock y productos destacados. Comparar con los reportes del mismo alcance/período, incluidos cancelaciones, costos faltantes, copia local y pendientes de sincronización. Solo consultar: no hacer ventas, pagos, cancelaciones ni movimientos reales.
4. Cambiar a Staff sin reportes: la ayuda debe abrir; las cifras protegidas deben denegarse y los atajos restringidos no aparecer. Cambiar de usuario/negocio durante una consulta: no deben quedar respuestas de la sesión anterior.
5. En Android probar teclado virtual, rotación, desplazamiento del chat y botones de cerrar/enviar. En Windows probar Tab, Enter y Escape. Verificar lectores de pantalla y tema oscuro.
6. Tras cargar/instalar con conexión y activar la nueva versión, cerrar, desconectar y abrir por primera vez una guía en otra sección. Reconectar y comprobar el estado. Revisar también la actualización desde la PWA anterior sin borrar datos.
7. Simular un fallo de lectura/timeout únicamente en un entorno controlado: debe aparecer recuperación, sin cifras inventadas, duplicación ni bloqueo permanente.

## 12. Recomendación

**Realizar QA autenticado del único PR Draft. No solicitar merge todavía.** Priorizar Android físico/PWA, Windows y comparación de cifras contra los servicios del negocio de prueba. Decidir después si se amplía el contrato de ranking Nube; esa limitación no justifica añadir cálculos paralelos ni debilitar permisos.
