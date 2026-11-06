# LANZO_BOT_INDEPENDENT_WORKER_REPORT

## 1. Entrega

- PR único: [#394](https://github.com/fdxruli/Lanzo-POS/pull/394), permanece **Draft** contra `main`. Sin merge ni Ready for Review.
- Rama existente: `fix/lanzo-bot-contextual`.
- HEAD de código validado: `cc13eba13c94476071902c0514e5b3ae349b1983`. Los commits siguientes de esta entrega contienen documentación y evidencia; el HEAD de entrega se publica en el PR.
- Inicio verificado con GitHub y Git: `main` = `5e1b4303e942657c406d91237ffa7ff44db91cec`; PR = `c11f82c362b8ddd5b9b91a811cef26be05ae4937`. Ambos se volvieron a contrastar antes de preparar el commit. No se creó otra rama ni PR.

| Estado separado | Resultado |
| --- | --- |
| Código preparado | Worker independiente bajo demanda, lectura autorizada y cálculo acotado; apagado/cierre/cambio de contexto cancelan la instancia. |
| QA automatizado | Suite amplia 281 pruebas/20 archivos; revisión final 27 pruebas/4 archivos; stock específico 4 pruebas. Hay solapamiento: no se suman esos conteos. Navegador con Worker real, build, arquitectura, medición y actualización de recursos offline. |
| QA manual | **No ejecutado** en Android físico, Windows, PWA instalada ni con sesión autenticada de un negocio de prueba en Preview. |
| Production | Sin cambios, SQL, migraciones, ventas, abonos, cobros ni movimientos reales. |
| Objetivo funcional demostrado | Independencia, ciclo de vida, guías y cómputo en escenarios complementarios reproducibles. Falta verificar el recorrido real del POS y sus datos en Preview; no se certifica ese resultado con fixtures. |

## 2. Arquitectura elegida

Un Worker dedicado por chat abierto, creado al abrirlo y terminado al cerrarlo. No hay pool, Worker compartido permanente, inicialización en el arranque ni motor alternativo de procesamiento en React. La preferencia existente `showAssistantBot` conserva su persistencia y control desde Configuración → Controles.

El primer hito fue una sugerencia real → cliente → `DedicatedWorkerGlobalScope` → respuesta visible en Chromium. Después se trasladó el cálculo que seguía bloqueando el hilo principal: agregaciones financieras y de productos. Las consultas de stock dejan de cargar ventas, lotes y mermas para una respuesta que únicamente muestra disponibilidad operativa.

No se duplicó el runtime tenant ni se reescribieron los repositorios. El protocolo es pequeño y cerrado, extensible mediante operaciones puras explícitas. No es un RPC general de LANZO POS.

## 3. Responsabilidades

| Hilo principal | Worker |
| --- | --- |
| React, controles, foco, estado del chat y navegación. | Normalización, reconocimiento de intención, selección de las 37 guías y construcción de respuestas operativas. |
| Preferencia, actor, sesión, tenant y permisos vigentes. | Contexto transferible: ruta, pestaña, rubro y pistas de presentación; no recibe credenciales ni nombres de bases. |
| Repositorios oficiales de lectura y fuentes Local/Nube/cache. | Acumulador financiero oficial, agregación de productos del dashboard y clasificación operativa de stock. |
| Proyección de campos necesarios en lotes de hasta 128 registros, con una confirmación antes del siguiente lote. | Retiene acumuladores, un mapa por producto cuando es necesario y hasta cinco alertas de stock; no conserva ventas crudas entre lotes. |
| Validación de resultados, calidad financiera y texto comercial de hasta cinco filas. | Libera el acumulador al finalizar; terminar la instancia cancela también CPU en curso. |

Las lecturas asíncronas no se confunden con trabajo de CPU: los repositorios existentes todavía pueden filtrar/ordenar datos y construir proyecciones en el hilo principal. Este PR mueve el procesamiento propio del bot y sus agregaciones adicionales; no afirma que todos los servicios de LANZO POS sean independientes ni que una consulta real grande carezca de costo de lectura.

## 4. Autoridad y aislamiento

`READ` es una solicitud de intención, no autoridad. El adaptador principal captura `actorRuntimeController`, requiere `reports` y los permisos del módulo, obtiene el alcance mediante la política existente y valida antes/después de cada lectura. Cada lote de cálculo vuelve a comprobar el handle y el AbortSignal; también se comprueba el resultado final.

El Worker no importa DB/Dexie, stores, autenticación, Supabase ni `tenantRuntimeRouter`. Una prueba recorre transitivamente sus imports y el build comprueba su aislamiento. No existe una API para abrir una base por nombre desde un mensaje.

Los datos proyectados excluyen clientes, comprobantes, imágenes y claves de tenant. Para calcular se transfieren solo los campos que consumen los algoritmos oficiales, con backpressure; no se clona todo el historial o catálogo en una sola petición ni se mantienen dos colecciones completas dentro del Worker. La lectura oficial puede tener su colección de origen mientras el adaptador la recorre: ese costo no se oculta.

Se conservan los controles del PR anterior: Staff sin reportes recibe guías, no cifras protegidas; un fallback Local/Mixto sin filtro individual no se presenta como reporte individual de Staff. Costos ausentes, datos incompletos y errores no se convierten en cero.

## 5. Mensajes y cancelación

- `CONTEXT` inicializa metadatos mínimos; plazo de inicialización de cinco segundos.
- `QUESTION` tiene ID único. Responde con `RESULT`, `ERROR` o una única solicitud `READ` de intención permitida.
- El principal resuelve `READ` con los servicios vigentes. Cuando necesita cálculo puro, utiliza `COMPUTE_START`, `COMPUTE_CHUNK` y `COMPUTE_END`, limitados a `financial`, `products` y `stock`.
- Solo hay una pregunta simultánea. El timeout de la pregunta es de 15 segundos y permanece activo durante lectura y lotes; el tiempo de inicialización es independiente.
- Timeout, fallo, cierre o invalidación terminan el Worker, abortan las tareas del adaptador, rechazan las promesas y eliminan timers/listeners. Los mensajes tardíos se ignoran.
- Constructor no disponible, `messageerror`, error de ejecución, contexto no clonable o respuesta de inicialización inválida producen recuperación explícita. No hay bucle de reinicios: una nueva pregunta/reintento puede crear una instancia nueva.

Un request de red/IndexedDB ya iniciado por un repositorio que no acepta AbortSignal puede terminar internamente. El bot no inicia etapas adicionales ni muestra su resultado después de cancelar. No se modificó el sistema de cancelación de servicios ajenos.

## 6. Ciclo de vida

| Estado | Conducta |
| --- | --- |
| Desactivado | Layout no importa el componente opcional; no crea Worker ni ejecuta el motor. |
| Activado, cerrado | Botón visible; cero Workers del bot, polling o temporizadores de procesamiento. |
| Abierto | Una instancia, una inicialización y una pregunta concurrente como máximo. |
| Cerrado | Termina la instancia y limpia conversación, entrada y solicitudes. Reabrir crea otra instancia. |
| Desactivación durante una pregunta | Desmontaje/invalidación, AbortSignal y terminación; ninguna respuesta tardía visible. |
| Cambio de actor, sesión, tenant, ruta o pestaña | Invalida IDs/contexto, borra conversación y sustituye la instancia solo si el chat sigue abierto. |
| Aviso global crítico con bot desactivado | Mantiene el aviso sin iniciar el motor ni mostrar el lanzador al descartarlo. |

Los archivos precacheados siguen disponibles en almacenamiento; eso no significa que estén ejecutándose. Los módulos del hilo principal que el navegador ya evaluó no se pueden descargar de su caché de módulos simplemente cerrando React.

## 7. Medición reproducible de recursos y fluidez

[Datos completos](lanzo-bot-worker/benchmark.json), `scripts/qa/lanzo-bot/benchmark.py`. Chromium **154.0.8037.57**, Linux headless, viewport 390×844 y CPU ralentizada 4×. El mismo origen, navegador y conjuntos retenidos durante todos los estados: **20.000 ventas / 60.000 líneas, 20.000 productos y 50 referencias de catálogo**. Hay tres consultas consecutivas, cinco reaperturas y cancelación durante cambio de actor/navegación.

La lectura se simula explícitamente en el límite del servicio; React, transporte, Worker y algoritmos son reales. No es una sesión del POS ni una medición de una base comercial real. La generación del fixture no forma parte de la latencia de consulta.

Métrica: bytes del **heap JavaScript del renderer principal después de GC solicitado mediante CDP**. **Excluye heap del Worker y RAM total del proceso/sistema.**

| Estado | Heap principal, bytes | Workers del bot activos |
| --- | ---: | ---: |
| disabled | 13,095,836 | 0 |
| enabled_closed | 14,197,300 | 0 |
| open_idle | 15,196,968 | 1 |
| processing | 15,545,712 | 1 |
| closed_after_use | 16,191,948 | 0 |
| disabled_after_use | 16,136,228 | 0 |
| after_5_reopens | 16,333,608 | 0 |
| disabled_during_query | 16,366,444 | 0 |
| after_actor_and_navigation_cancel | 16,452,772 | 0 |

- Inicialización observada: aproximadamente **308 ms**.
- 20.000 ventas: aproximadamente **939 ms**, 58 frames durante la consulta y separación máxima entre frames de **33,3 ms**.
- 20.000 productos: aproximadamente **334 ms**, 25 frames y separación máxima de **16,8 ms**.
- El mismo algoritmo financiero, invocado síncronamente en el principal como referencia explícita de prueba, tardó aproximadamente **1.095 ms** y produjo una separación entre frames de **1.083 ms**. No es un segundo motor del producto.
- Se obtuvieron importes de venta/utilidad equivalentes. La prueba de proyección/acumulador compara todos los campos de la política, incluidos descuentos, decimales y costos faltantes, atravesando límites de lote.
- El observador Long Tasks no registró entradas en las consultas. Tampoco registró la evaluación de referencia vía DevTools; por ello no se usa para afirmar que esa evaluación no bloqueó. La pausa aparece en la medición de frames.
- Cero Workers después de cerrar, desactivar, cinco reaperturas y cancelar por cambio de contexto. No se afirma que el heap vuelva al valor inicial: **el heap principal aumentó tras utilizar la UI y los algoritmos**, y no se midió el heap de los Workers ni RSS.

No se deduce una reducción de RAM de 200 MB a 100 MB ni un porcentaje de mejora. La evidencia sostiene separación de CPU y liberación de la instancia, con los límites anteriores.

[Huella del build](lanzo-bot-worker/build-footprint.json): Worker independiente **44.225 bytes sin comprimir**. El precaché pasa de 3.562.366 bytes del snapshot anterior del workspace a aproximadamente 3,58 MB, dentro del presupuesto existente de 6.320.268 bytes/48 JS. El snapshot no es una medición de Production. Los bytes de entrada observados por Performance Resource Timing en Vite dev excluyen imports internos del Worker; no se presentan como descarga total de la aplicación.

## 8. Funcionalidades preservadas

Se conserva la fuente de conocimiento de **37 guías y 11 rutas**, preguntas manuales/sugeridas, contexto de pestaña y rubro, Local/Nube, Staff, permisos, enlaces, accesibilidad, estilo móvil y límite de 40 mensajes mientras está abierto. El catálogo completo deja de importarse desde React; el Worker devuelve solo metadatos de sugerencias y la respuesta necesaria.

Permanecen las consultas comerciales y sus límites: ventas/ganancia oficiales, lista de deudores, copia local de stock/caducidad, ranking local y explicación del ranking Nube incompleto. No se inventa una agregación Nube a partir de páginas parciales. No se modificó ninguna regla financiera, permiso de negocio ni RLS.

## 9. Archivos y motivo

| Archivo/grupo | Cambio |
| --- | --- |
| `src/workers/bot.worker.js`, `botProtocol.js` | Motor independiente y operaciones explícitas. |
| `src/services/botWorkerClient.js` | IDs, startup, backpressure, lecturas tipadas, timeout, terminación y recuperación. |
| `src/services/botComputationProjection.js` | Campos mínimos de ventas/stock; sin datos ajenos al cálculo. |
| `src/hooks/useBotAssistant.js` | Ciclo de vida ligado al chat y contexto; no importa el motor operativo. |
| `src/components/common/AssistantBot.jsx` | Sugerencias del Worker, apagado, invalidación al cerrar y limpieza de estado/listeners. |
| `src/components/layout/Layout.jsx` | Pasa la preferencia existente también cuando se monta un aviso global. |
| `src/components/settings/OperationalSettings.jsx` | Explica cuándo inicia y se libera el motor; no añade otro interruptor. |
| `src/utils/botIntelligence.js` | Módulo puro: solicita lectura, no importa servicios tenant. |
| `src/services/botReadService.js` | Delega agregaciones al Worker después de validar autoridad; no ejecuta un fallback financiero en React. |
| `src/services/inventoryAnalysis.js` | Opción stock operativo: una lectura de productos, sin cargar historia, lotes o mermas innecesarios. Los consumidores anteriores no cambian. |
| `src/services/sales/financialPolicy.js` | Expone un acumulador de las mismas operaciones exactas; `summarizeFinancialSales` conserva firma/resultados. Retira un helper privado sin uso. |
| `src/services/reports/productStats.js` | Permite acumular la agregación existente por lotes; la API anterior del dashboard permanece. |
| `vite.config.js`, `scripts/audit-bot-precache.mjs` | Worker ES de Vite y auditoría obligatoria de su recurso/precaché. |
| Pruebas en `src/hooks`, `src/components/common`, `src/services/__tests__` | Casos de ciclo de vida, autoridad, proyección y lectura mínima. |
| `src/architecture/__tests__/{adminPwaArchitecture,botWorkerArchitecture}.test.js` | Contrato actualizado sin retirar presupuesto/aislamiento; imports seguros del Worker y ausencia de motor duplicado en UI. |
| `scripts/qa/lanzo-bot/{fixture.jsx,smoke.py,benchmark.py,worker_pwa.py}` | Fixtures complementarios explícitos, Worker real, medición y actualización offline. |
| Este informe y `docs/reports/lanzo-bot-worker/` | Evidencia sin datos de negocios ni credenciales. |

## 10. Pruebas ejecutadas

- [Suite amplia](lanzo-bot-worker/focused-20-files.log): **281 PASS / 20 archivos**. Incluye las guías, permisos/tenant, Layout, Caja, Clientes, Configuración, inventario, POS/lector con fixtures y arquitectura con build presente.
- [Revisión final focal](lanzo-bot-worker/final-targets.log): **27 PASS / 4 archivos**. Añade inicialización malformada y la última verificación del ciclo de vida. No se suman a la suite amplia porque hay casos repetidos.
- [Stock operativo](lanzo-bot-worker/stock-read.log): **4 PASS**, incluido que esa consulta no carga ventas/lotes/mermas.
- `eslint` de todos los JS/JSX creados/modificados y `git diff --check`: **PASS**, sin errores ni advertencias.
- `npm run build`: **PASS**, con ambas auditorías postbuild. [Registro](lanzo-bot-worker/build-audits.log). Los avisos de anotaciones Zod y glob sin chunk independiente son de build, no una certificación de runtime.
- [Chromium, cuatro escenarios](lanzo-bot-worker/browser-worker.json): pregunta sugerida/escrita, contexto, navegación, offline tras descarga, reconexión y foco. La comprobación dentro del Worker devuelve `DedicatedWorkerGlobalScope`; no es un Worker mock. Identidad/stores de UI son fixtures.
- [Worker compilado + SW](lanzo-bot-worker/built-worker-offline-upgrade.json): **PASS**, actualización desde recursos del snapshot previo, activación explícita y guía ejecutada offline, con caché HTTP deshabilitada. No abre el bootstrap del POS, no crea sesión ni borra datos. Comprueba actualización de recursos, no actualización de una PWA de negocio instalada.
- [Medición](lanzo-bot-worker/benchmark.json): transporte/cálculo real y datasets sintéticos; cancelación durante CPU, desactivación, actor y navegación. Sin `pageerror`.

Reproducción: `npm run dev -- --host 127.0.0.1`; ejecutar `python3 scripts/qa/lanzo-bot/smoke.py` o `benchmark.py`. Para el Worker compilado: `npm run build` y `python3 scripts/qa/lanzo-bot/worker_pwa.py`; el script sirve el build en localhost:4180. `LANZO_BOT_OLD_DIST` permite señalar un build anterior conservado. Requiere Playwright Python y Chromium; no se añaden dependencias al producto.

## 11. CI y Vercel Preview

La [comparación anterior](lanzo-bot-worker/prior-ci-comparison.json), [run 42153078695](https://github.com/fdxruli/Lanzo-POS/actions/runs/42153078695), tiene **95 firmas exactas compartidas** y **una regresión propia** de la expectativa de postbuild, reproducida 20/20 en el candidato frente a 20/20 PASS en `main`. No se atribuye ese fallo propio a la línea base. La exclusión de AssistantBot aparecía además al validar un build existente.

Se corrigen ambas expectativas conservando la auditoría de arranque, el presupuesto de precaché, el aislamiento público y la exclusión de otros Workers y superficies opcionales. Las pruebas locales de arquitectura pasan con el build nuevo.

También se ejecutó `financialStats.test.js`: tuvo un fallo de igualdad por campos de calidad adicionales. La misma firma está entre los fallos de `main` del artefacto comparativo; se documenta y **no se modifica** esa prueba ajena. No se repitió una auditoría global completa local ni se repararon los otros fallos compartidos.

El nuevo push activará el CI/Preview del mismo PR. **Estado remoto al preparar este documento: pendiente del nuevo HEAD**; se publica el estado observado y la URL en el cuerpo del PR, sin confundir READY con QA funcional. Proyecto esperado: `lanzo-pos`, equipo `team_buvft2mAJErTNR8gDhXcZGfS`. No se hace un despliegue manual ni se cambia la protección de Vercel.

## 12. Limitaciones

- Falta QA autenticado de aplicación en el Preview y proyecto Supabase de prueba correcto. No se sustituyó por una VM/base sintética. Tampoco hay QA físico en Android/Windows o PWA instalada.
- El heap del Worker y la RAM total no se midieron. Los módulos ya cargados del principal pueden permanecer después de cerrar; no se promete reducir la memoria total.
- Los repositorios oficiales pueden realizar CPU al leer/ordenar/proyectar; ese costo real no está cubierto por el benchmark de lectura simulada. No se afirma independencia de toda la aplicación ni latencia garantizada de IndexedDB/Nube.
- Las operaciones oficiales ya iniciadas sin AbortSignal pueden terminar internamente; se descartan sus resultados y no se continúa el pipeline del bot.
- Stock/caducidad conservan alcance local explícito; caducidad consulta siete días. Ranking Nube completo sigue fuera del contrato disponible.
- En navegadores que bloquean Workers se informa el problema y se ofrece reintento; no se mantiene otro motor completo en React.
- La prueba de actualización cubre recursos/activación de SW; no certifica actualización con operaciones del negocio pendientes.

## 13. QA manual mínimo

1. En el Preview del HEAD indicado, verificar que apunta al Supabase de prueba esperado y usar un negocio ya existente. No registrar operaciones comerciales para esta revisión.
2. En Configuración → Controles desactivar Lanzó Bot; confirmar ausencia de su Worker en DevTools y que ventas, lector, formularios y navegación responden. Activarlo sin abrir: debe seguir sin Worker.
3. Abrir, preguntar con sugerencia y Enter, comprobar contexto/atajos y un único Worker. Cerrar, reabrir cinco veces y desactivar durante una pregunta: ninguna instancia anterior debe continuar ni mostrar respuestas.
4. Consultar ventas/ganancia/stock/deudores y comparar solo lecturas con reportes del mismo período/fuente. Repetir con Staff sin reportes, costos incompletos y desconexión. No hacer ventas, abonos, cancelaciones ni movimientos reales.
5. Cambiar usuario/negocio y navegar durante una consulta: no debe aparecer el resultado anterior. Verificar mesas/cocina, Caja, catálogo grande, búsqueda/lector y teclado mientras se procesa.
6. Android físico: teclado virtual, rotación, cierre y reconexión. Windows: Tab/Enter/Escape y foco. PWA: descargar/actualizar con conexión, activar la nueva versión de forma normal, cerrar y usar guías sin conexión; verificar también una instalación que venía del PR previo.

## 14. Recomendación

**Mantener #394 en Draft y realizar QA real de aplicación/dispositivos después de revisar CI del nuevo HEAD.** La independencia y gestión de recursos están demostradas en automatización complementaria; no se propone merge ni Ready for Review y no se presenta el POS autenticado como certificado.
