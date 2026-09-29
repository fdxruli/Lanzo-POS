# Fase 6 — Certificación integral de Lía

Esta matriz registra la cobertura automatizada que protege las capacidades de Lía de las Fases 1–5 y sirve como guía ejecutable de QA manual en Preview. La ejecución de Preview aún debe completarse antes de cerrar la certificación.

## Registro de concurrencia y alcance

| Dato | Verificación inicial |
|---|---|
| Repositorio | `fdxruli/Lanzo-POS` |
| `MAIN_SHA_START` / `MAIN_SHA_END` | `5838dd4eba82c0f4d38417323849da293dbd7968` / `5838dd4eba82c0f4d38417323849da293dbd7968` |
| `MAIN_ADVANCED` | No |
| PR #335 | Merged en `5838dd4eba82c0f4d38417323849da293dbd7968` |
| `PR336_STATUS_START` / `PR336_STATUS_END` | Open, Draft / Open, Draft |
| `PR336_HEAD_START` | `e585ce5b80010fd4d4c34f291138bf4a9e65a3c3` |
| `PR336_HEAD_END` | `328390285b3a8a70aa0398cd1ba55b7c498b958e` |
| `PR336_BASE_START` / `PR336_BASE_END` | `bd9a6dce9faa023bdfd0e42bb6a63366af83a8a6` / `bd9a6dce9faa023bdfd0e42bb6a63366af83a8a6` |
| `PR336_MERGED_DURING_WORK` | No |
| Merge base del HEAD de #336 con `origin/main` al cierre | `5838dd4eba82c0f4d38417323849da293dbd7968` |
| Cambios efectivos del HEAD de #336 contra `origin/main` | 7 archivos de restaurante |
| `PR336_OVERLAP_START` / `PR336_OVERLAP_END` | Ninguno / Ninguno contra los archivos modificados por Fase 6 |
| PR de Fase 6 | [#337 — Draft](https://github.com/fdxruli/Lanzo-POS/pull/337) |
| Rama de Fase 6 | `test/ai-lia-phase6-hardening-r1`, creada desde `origin/main` |

La vista de archivos de la API de GitHub para #336 continúa enumerando cambios de Lía porque su `baseRefOid` está atrasado. Se actualizó el ref local desde `refs/pull/336/head` y se comprobó `origin/main...origin/pr-336-current`: el diff efectivo contiene sólo los siete archivos de restaurante descritos en el brief. El HEAD de #336 avanzó durante la auditoría, pero no modificó esos archivos de Fase 6.

## Matriz automatizada por capacidad

| Fase | Capacidades que se certifican | Cobertura automatizada principal |
|---|---|---|
| 1 — Identidad y router | Identidad local, preguntas libres, normalización, rutas ambiguas, contexto faltante y fuera de alcance | `commercialQuestionRouter.test.js`, `commercialAgentContract.test.js`, `CommercialAIAgents.test.jsx` |
| 2 — Crecimiento | `sales_growth`, `ticket_growth`, `product_opportunity`, `sales_trend`, evidencia actual/anterior, recomendaciones y cuota | `salesProfitabilityAnalytics.test.js`, `commercialAgentContext.test.js`, `salesProfitabilityAgentService.test.js`, `index.test.ts` |
| 3 — Surtido | Catálogo completo/parcial, categorías, productos actuales e históricos, sin movimiento y demanda no demostrada | `assortmentAnalytics.test.js`, `salesProfitabilityAgentService.test.js`, `salesProfitabilityDownloadReport.test.js`, `index.test.ts` |
| 4 — Estrategia y simulaciones | Metas, what-if, prioridades fundamentadas, precio, promociones y combos; nulos, costos y límites | `commercialScenarioAnalytics.test.js`, `commercialQuestionRouter.test.js`, `salesProfitabilityAgentService.test.js`, `CommercialAIAgents.test.jsx`, `index.test.ts` |
| 5 — Competencia | Evidencia declarada, monedas, unidades, fechas, equivalencia, URL de referencia, sanitización y análisis local | `competitiveAnalysis.test.js`, `competitiveAnalysisFlow.test.js`, `CommercialAIAgents.test.jsx`, `salesProfitabilityHistory.test.js`, `salesProfitabilityDownloadReport.test.js` |
| 6 — Certificación transversal | Interferencia entre intents, escenarios stale, tenant/sesión, fallos del proveedor, snapshots, reportes, cuota y permisos | `commercialQuestionRouter.test.js`, `salesProfitabilityAgentService.test.js`, `CommercialAIAgents.test.jsx`, `salesProfitabilityHistory.test.js`, `salesProfitabilityDownloadReport.test.js`, `aiAgentAuthorization.test.js`, `index.test.ts` |

Las pruebas del servicio cubren la carga paginada de ventas válidas y detalle de costos, deduplicación y fuentes; zonas horarias y periodos comparables; rentabilidad, margen, utilidad, ticket, unidades, variaciones, metas y what-if; datos incompletos; historial; y snapshots descargables. Los contratos cliente y Edge validan allowlists y rechazan claves no permitidas antes de cuota/proveedor.

Las pruebas Edge usan proveedor y RPC simulados. Cubren autenticación y autorización, allowlists de RPC/intents, `evidenceKeys`, timeout, errores 429/5xx, JSON inválido o truncado, narrativa no utilizable y confirmación de cuota. No se realizan llamadas IA reales.

## Hallazgos de la auditoría

| Severidad | Hallazgo | Corrección |
|---|---|---|
| P0 | La deduplicación de solicitudes en curso usaba una clave global; dos tenants podían compartir el mismo resultado si reutilizaban una clave de solicitud. | La clave ahora incluye tenant, actor, sesión, dispositivo y licencia activos. Se añadieron pruebas concurrentes entre tenants. |
| P0 | Las consultas ordinarias de ventas no revalidaban el contexto autorizado después de lecturas asíncronas. | El runner comprueba tenant/actor/sesión/licencia tras las lecturas y después de la respuesta del proveedor. Si el contexto cambió, no devuelve el resultado. |
| P1 | Una respuesta tardía podía aparecer después de seleccionar otra pregunta. | La página invalida resultados pendientes cuando cambian pregunta, intención o parámetros. El snapshot guardado conserva la pregunta enviada originalmente. |
| P2 | El test de secuencia de cinco simulaciones excede ocasionalmente el timeout predeterminado de 15 s en el barrido completo, aunque pasa aislado. | Se aumentó únicamente el timeout de ese test a 30 s; el test sigue verificando que los combos reciban un escenario vacío. |

No se encontraron motivos para modificar el contrato de ventas, la Edge Function, el esquema de base de datos, licencias ni cuotas.

## Resultados automatizados locales

| Validación | Resultado |
|---|---|
| Vitest de servicios de IA | 15 archivos, 334 pruebas aprobadas |
| Vitest de componentes de IA | 2 archivos, 63 pruebas aprobadas |
| Edge `deno check` | Aprobado |
| Edge `deno test` | 69 aprobadas, 0 fallidas |
| ESLint focalizado | Aprobado; sólo aviso de antigüedad de `baseline-browser-mapping` |
| React Doctor | 90/100; dos avisos de mantenibilidad por complejidad en `UsageStatusPanel` y `CommercialAIAgentsPage` |
| `npm run build` | Aprobado; incluye `postbuild` automático |
| `npm run postbuild` explícito | Aprobado; 23 assets de inicio verificados |
| `git diff --check` | Aprobado |
| PR127 Global Comparison / Vercel Preview | Se ejecutan y se registran en el PR sobre el HEAD final |

Los dos avisos de React Doctor corresponden a funciones ya existentes en `main`: `UsageStatusPanel` está intacta frente a la base y la declaración de `CommercialAIAgentsPage` ya está presente en la misma ubicación. No aparecieron avisos nuevos fuera de esos dos bloques. La advertencia no justifica una refactorización amplia para este hardening; las escrituras de refs añadidas ocurren en eventos/efectos, no durante render.

El build también informa cuatro patrones opcionales de precache sin archivo generado y módulos cargados dinámica y estáticamente; no afectan la compilación y son ajenos a estos cambios. Se conserva el aviso de datos `baseline-browser-mapping` desactualizados.

El Preview de Vercel para el primer HEAD del PR (`7f666b98aff6a87ae0669b6acfb5f0c98003fd9a`) quedó `READY` y su check pasó. La ruta `/agentes-ia`, abierta mediante el acceso protegido de Preview, mostró la pantalla de licencia porque no se usó un negocio de pruebas autenticado. En esa pantalla el documento midió 320/320, 768/768 y 1280/1280 píxeles (viewport/documento) y no reportó errores de consola. Esto valida el acceso y overflow del gate; las interacciones funcionales, accesibilidad y zoom de Lía permanecen en la QA manual de abajo.

## Seguridad y datos

- **Tenant y actor:** la clave de solicitudes en curso y las verificaciones posteriores a operaciones asíncronas quedan ligadas al contexto autorizado. La interfaz también descarta respuestas tardías al cambiar de tenant/sesión/licencia.
- **Cuota:** identidad, fuera de alcance, contexto incompleto, escenarios aún sin enviar, competencia local, historial y descarga no llaman al proveedor. La interfaz distingue llamada, resultado narrativo y estado confirmado de cuota.
- **Evidencia externa:** el texto competitivo se trata como dato, se limita y limpia; las fuentes siguen marcadas como aportadas por el usuario y no verificadas. No se consulta una URL ni se envía esa evidencia al proveedor.
- **Prompt injection y URLs:** cobertura de HTML/scripts, caracteres de control, texto largo, credenciales, hosts privados y protocolos no admitidos.
- **Historial y exportación:** se reabren snapshots, no se recalculan; se filtran credenciales, IDs internos y filas crudas; la descarga no vuelve a ejecutar el análisis.
- **Costos y actividad:** costo desconocido no es cero; ausencia de ventas no demuestra ausencia de demanda; un periodo o catálogo incompleto conserva su limitación.

## Estado de Supabase

| Dato | Inicial y final de esta auditoría |
|---|---|
| Proyecto | `odlrhijtfyavryeqivaa` (`Lanzo`, `ACTIVE_HEALTHY`) |
| Edge Function | `lanzo-ai-agent`, `ACTIVE`, versión `46`, `verify_jwt=false` |
| SHA desplegado | `3fffad1164d4764ed80e14867d10edd2e878387e3711d7823f675164eec931bc` |
| Archivos remotos frente a rama base | `index.ts`, `contract.ts` y `provider.ts` coinciden byte por byte tras normalizar finales de línea |
| Deploy requerido | No |
| Migraciones / cambios de esquema | No / No |
| Secrets modificados | No |

## QA manual para Preview

Use un negocio de pruebas que tenga historial y catálogo preparados. Para estas comprobaciones no cambie licencia, cuota, ventas, costos, inventario ni precios reales. Cuando se indica “narrativa opcional”, confirme la etiqueta de uso que muestre la pantalla: una llamada sólo puede consumir cuota si Edge confirma el resultado conforme al contrato.

| Caso | Pregunta o acción | Datos necesarios | Proveedor / cuota | Evidencia visible esperada | Fallo |
|---|---|---|---|---|---|
| A — Identidad | “¿Por qué te llamas Lía?” | Ninguno | No / No | Explicación breve de la identidad de Lía; respuesta local inmediata. | Carga ventas, llama IA o muestra una respuesta comercial. |
| B — Rentabilidad | “¿Mi negocio es rentable?” | Ventas válidas del periodo; costos para evaluar utilidad y margen | Puede llamar si hay evidencia útil / Puede consumir sólo con confirmación | Ventas, cobertura de costos, utilidad y margen sólo cuando los costos alcancen; limitación clara cuando falten. | Presenta costo desconocido como cero, o afirma rentabilidad sin cobertura. |
| C — Crecimiento | “¿Cómo puedo aumentar mis ventas?” | Periodo actual y anterior comparable | Puede llamar / Puede consumir con narrativa válida | Cambio de ventas y acciones vinculadas a señales reales, con forma de medirlas. | Recomendación sin datos, promesa de crecimiento o comparación incompleta presentada como completa. |
| D — Ticket | “¿Cómo aumento mi ticket promedio?” | Tickets y detalle de unidades del periodo actual/anterior | Puede llamar / Puede consumir con narrativa válida | Ticket, unidades por ticket y variación disponibles, con recomendación medible. | Divide por cero o confunde venta total con ticket. |
| E — Productos | “¿Qué productos debería impulsar?” | Detalle de productos en periodos comparables | Puede llamar / Puede consumir con narrativa válida | Productos existentes con métricas y evidencia citadas. | Recomienda un nombre que no existe o contradice las métricas. |
| F — Surtido | “¿Cómo está mi surtido?” | Catálogo, categorías e historial de ventas | Puede llamar si la evidencia permite narrativa / Puede consumir con narrativa válida | Conteo de catálogo, concentración y productos activos sin ventas; cobertura completa o parcial identificada. | Interpreta “sin ventas” como “sin demanda” o esconde que el catálogo está parcial. |
| G — Productos nuevos | “¿Qué productos nuevos debería vender?” | Catálogo actual e historial de ventas | Puede llamar si hay evidencia útil / Puede consumir con narrativa válida | Señales para investigar categorías o brechas del surtido, con límites explícitos. | Presenta productos completamente nuevos como demanda comprobada. |
| H — What-if | “¿Qué pasa si vendo 25% más?”; luego seleccione −10% | Ventas del periodo actual | Editar no llama ni consume; al ejecutar, la narrativa puede llamar / Puede consumir sólo con confirmación | El escenario inicial no inventa porcentaje; al elegirlo aparecen fórmula, cambio y supuesto constantes. El valor negativo reduce el resultado. | El selector elige un valor sin acción del usuario, el porcentaje manual no reemplaza al previo o se afirma que es pronóstico. |
| I — Meta | “Quiero facturar $100,000” | Ventas, tickets y meta introducida | Puede llamar / Puede consumir con narrativa válida | Meta, brecha y equivalentes al ticket actual; el número se puede corregir antes de ejecutar. | Cambia la meta escrita, confunde $100,000 con 100 o la presenta como pronóstico. |
| J — Estrategia | “¿Qué debería priorizar?” | Ventas, costos, comparativo y catálogo según disponibilidad | Puede llamar si existen candidatos útiles / Puede consumir con narrativa válida | Prioridades derivadas de productos, categorías, ticket u otras señales presentes; sin garantías de resultado. | Prioridad arbitraria, repetida o contradictoria. |
| K — Competencia sin evidencia | “Analiza mi competencia” | Ninguno inicialmente | No / No | Pide observaciones, fecha y procedencia; no consulta URL alguna. | Carga catálogo, llama IA o muestra una comparación inventada. |
| L — Precios equivalentes | Registre producto propio y competidor con precio, misma moneda/presentación, equivalencia confirmada y fecha. | Catálogo propio y observación completa | No / No | Diferencia numérica reproducible, condiciones y fuente aportada sin declarar verificación externa. | Compara monedas o presentaciones distintas como si fueran equivalentes. |
| M — Productos no equivalentes | Registre productos de distinta presentación o equivalencia sin confirmar. | Catálogo propio y dos observaciones no equivalentes | No / No | Advertencia de no comparabilidad; sin diferencia porcentual engañosa. | Presenta una comparación numérica como concluyente. |
| N — Historial y descarga | Abra un análisis guardado y descargue su reporte. | Al menos un snapshot previo | No / No | Se conserva la pregunta, cifras y evidencia originales; el archivo refleja ese snapshot. | Relee ventas actuales, llama proveedor, cambia cifras o incluye datos crudos/IDs. |
| O — Cambio de pregunta | Ejecute un escenario, seleccione otra intención, cambie pregunta y porcentaje y vuelva a ejecutar. | Escenario anterior y nuevo | Seleccionar/editar: No / No; ejecutar: según intención | Se borran campos previos, se muestra la pregunta activa y sólo su resultado; el historial conserva cada envío bajo su pregunta original. | Se hereda porcentaje/producto, reaparece respuesta tardía bajo la pregunta nueva o se registra el snapshot equivocado. |

### Comprobación visual y accesible

Repita la pantalla principal, formulario de escenarios, competencia, resultado, historial y descarga en móvil pequeño (~320 px), tablet (~768 px) y escritorio (~1280 px); revise también zoom 200%. Recorra con teclado desde la pregunta hasta resultados e historial: cada control debe tener etiqueta, foco visible y orden lógico. Envíe formularios incompletos para confirmar que el mensaje se asocia al campo correcto y se anuncia; pruebe campos condicionales y estados de carga. Las tablas pueden desplazarse dentro de su contenedor; la página completa no debe desbordarse horizontalmente.

## Validaciones automatizadas requeridas antes de completar

- Vitest de servicios AI, router, contratos, analítica, estrategia, surtido, competencia, historial, descargas y UI.
- `deno check` y pruebas Edge.
- ESLint focalizado y React Doctor.
- Build y postbuild.
- `git diff --check`.
- PR127 Global Comparison sobre el HEAD final y Vercel Preview sobre ese mismo HEAD.
- Revisar `main` y PR #336 al cierre; repetir validaciones afectadas si cambia la base.

## Corrección focalizada para PR #337 — rentabilidad y oportunidades

Esta adenda registra únicamente las observaciones B y E informadas en QA manual. Conserva como reportes del usuario los PASS anteriores; no declara terminada la QA manual global.

| Dato | Verificación de esta corrección |
|---|---|
| `MAIN_SHA_START` | `5838dd4eba82c0f4d38417323849da293dbd7968` |
| `MAIN_SHA_END` | `3736dc6262afc34c6046efe81988eae9801d3919` |
| `MAIN_SYNC_PERFORMED` | Sí; merge de `origin/main` en la rama existente del PR, commit `cde359683` |
| `PR337_HEAD_INITIAL` | `537cf10487a158bc3ee09ade6fc081f2e77eb20c` |
| `PR337_HEAD_FINAL` | HEAD vigente de la rama `test/ai-lia-phase6-hardening-r1` al cierre del PR |
| Commit de implementación y pruebas locales | `0679a5e1cfa3bac68972c7ff9d935ba2d09139f1` |
| `PR336_MERGED_CONFIRMED` | Sí; squash merge en `3736dc6262afc34c6046efe81988eae9801d3919` |
| Estado de PR #337 | Debe permanecer `OPEN / DRAFT`; sin merge |

### B — Respuesta de rentabilidad

La analítica local ya clasificaba rentabilidad como `profitable`, `not_profitable`, `undetermined` o `insufficient_data`. El resultado visible podía mostrar primero el resumen del periodo porque la capa que combinaba la respuesta del proveedor con el resultado determinístico permitía que una narrativa válida de ventas sustituyera la respuesta directa; en ausencia de ventas también había una frase genérica que no mencionaba la evaluación de rentabilidad.

El servicio ahora usa la explicación determinística como respuesta directa y resumen principal para `profitability_summary`, incluso cuando el proveedor omite o contradice la conclusión. Distingue utilidad bruta positiva, nula/negativa, costos incompletos y ausencia de ventas válidas. La respuesta aclara que el cálculo con costos de producto no acredita por sí solo la rentabilidad neta después de gastos operativos. Se conserva una sola llamada opcional al proveedor y los snapshots de historial/descarga retienen el mismo texto determinístico.

La fuente financiera existente trata un costo numérico cero como no verificado porque no expone evidencia suficiente para distinguir un costo real de un dato centinela. Se conserva ese comportamiento preventivo y la regresión correspondiente; representar un costo cero como verificado requiere ampliar el contrato de procedencia financiera, fuera del alcance de esta corrección.

### E — Selección de oportunidades por producto

La auditoría encontró recortes antes de la priorización: la agregación y comparación limitaban productos a 20 usando ventas/variación absoluta, y la construcción del contexto reducía `evidenceKeys` a 24 antes de ordenar candidatos. Por eso un producto elegible posterior podía perder su evidencia aunque tuviera señales más fuertes. La repetición de nombres no demostraba que sólo existiera un pequeño surtido vendido; el catálogo (incluidos sus 115 elementos reportados por el usuario), productos vendidos, comparables, elegibles y seleccionados son universos distintos.

La analítica mantiene identidades de producto separadas por ID internamente y evalúa todos los comparables recibidos. El constructor de contexto puede inspeccionar hasta 10.000 filas internas antes de priorizar; aplica el límite de oportunidades después de evaluar las señales. El planificador ordena por señales combinadas de crecimiento/participación/margen conocido y desempata con participación, variación de ventas, unidades y ventas actuales. Se conserva la deduplicación de etiquetas al presentar productos homónimos, el máximo breve de candidatos narrativos, `evidenceKeys` acotado, y no se envían IDs, filas crudas ni cientos de productos a Edge. Costos desconocidos pueden respaldar crecimiento, pero no margen o rentabilidad.

### Cobertura agregada y QA nueva pendiente

Regresiones añadidas para: respuesta directa positiva, utilidad bruta cero/negativa, costo incompleto, ausencia de ventas, narrativa de proveedor sólo-resumen/contradictoria, snapshots en historial y descarga, más de 20 productos comparables, candidato sólido fuera del primer recorte, selección de varios candidatos independientes, nombres duplicados con IDs distintos, costos nulos/no verificados, contexto del proveedor acotado y contrato Edge sin IDs internos. Se volvieron a incluir las pruebas del router, contrato, analítica, contexto, servicio, historial, descargas, UI y regresiones P0/P1 en la validación focal.

Pruebas manuales únicamente pendientes para esta corrección:

1. **B1:** “¿Mi negocio es rentable?” — confirmar que la conclusión aparece antes del resumen.
2. **B2:** repetir con costos faltantes — confirmar que indica que no puede determinar la rentabilidad completa.
3. **E1:** “¿Qué productos debería impulsar?” — confirmar productos reales, explicación y ausencia de candidatos inventados.
4. **E2:** comparar 7, 30 y 90 días cuando exista historial — confirmar que cada lista corresponde al periodo seleccionado.
5. **Regresión de concurrencia UI:** cambiar de pregunta durante el análisis y confirmar que no aparezca la respuesta tardía bajo la pregunta nueva.

El usuario reportó PASS en A, C, D, F, G, H1–H3, I, J, K, L y cambio de pregunta; E quedó PASS parcial y B requiere revalidación. Estos resultados no son ejecuciones nuevas de Codex. La QA global, el acceso funcional al Preview con negocio de prueba, la accesibilidad y el zoom continúan pendientes.

| Validación local de esta corrección | Resultado |
|---|---|
| Vitest AI: servicios, router, contratos, analytics, contexto, servicio, historial, descarga y UI | 17 archivos, 408 pruebas aprobadas; sin proveedor real |
| Deno Edge | `deno test`: 69 aprobadas; `deno check`: aprobado |
| ESLint focal | Aprobado sin errores ni avisos de código; permanece el aviso de antigüedad de `baseline-browser-mapping` |
| `npm run build` | Aprobado; 3.561 módulos transformados y PWA generado. Reportó avisos de imports mixtos y cuatro patrones opcionales de precache sin archivo, ya listados en la certificación |
| `npm run postbuild` explícito | Aprobado; 23 assets de inicio verificados |
| PR127 Global Comparison / Vercel Preview | SUCCESS en `b7509692`: 103 fallos compartidos, 0 nuevos/solo-candidato, 0 sin resolver y 2 fallos de base resueltos. El deployment estuvo READY para ese SHA; el check y deployment del HEAD de esta actualización se verificarán y registrarán en el PR #337. |

No se modificó la Edge Function ni el contrato cliente/servidor: no requiere deploy; Edge `lanzo-ai-agent` de referencia permanece en versión 46. Sin migraciones, cambios de esquema, secretos ni reglas de cuota.
