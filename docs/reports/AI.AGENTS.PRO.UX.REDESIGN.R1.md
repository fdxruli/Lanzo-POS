# Agentes IA PRO — workspace responsive R1

## Base y alcance

- Base: `main`, `b6843578409b62e7efce941aa4b819d304d9d661`, obtenida con `git fetch origin main` antes de editar.
- Rama: `feat/ai-agents-pro-responsive-workspace-r1`; no existía local ni remotamente.
- Checkout aislado: `C:/dev/Lanzo-POS-ai-ux-r1`. Los archivos ajenos del checkout original se conservan. El gestor de worktrees de la app quedó pendiente de registro; se utilizó un worktree Git convencional.
- No se encontraron instrucciones AGENTS.md aplicables.
- PR abiertos inspeccionados: #338, #352 y #357, incluyendo archivos modificados. Ninguno modifica `src/components/ai/`. #357 toca Layout y tokens globales: riesgo indirecto, mitigado sin editar esos archivos ni introducir selectores globales.
- Esta es una auditoría técnica del código. La captura visual inicial está BLOQUEADA: inventario de navegador vacío y creación de pestaña IAB agotó tiempo. No hay mediciones visuales ni capturas válidas antes/después.

## Auditoría técnica

| Componente | Problema | Causa técnica confirmada | Impacto móvil | Impacto escritorio | Solución | Riesgo de regresión |
| --- | --- | --- | --- | --- | --- | --- |
| Header / tarjetas | Formulario desplazado por información repetida | Dos tarjetas con min-height 235px, grid a una columna bajo 720px | Dos bloques completos antes de Lía | Duplica presentación del agente activo | Identificación de Ventas dentro del workspace; Ecommerce horizontal después del resultado | Bajo, solo presentación PRO |
| Workspace | Jerarquía extensa | Introducción, badge, cuota, textarea de mínimo 6.5rem | Retrasa la acción principal | Una columna con poco aprovechamiento horizontal | Cabecera breve, capacidades expandibles, cuota compacta, formulario con controles alineados | Medio: validar formularios condicionales |
| Sugerencias | Diez preguntas en varias filas | flex-wrap sin límite | Scroll adicional antes de parámetros y CTA | Densidad innecesaria | Cuatro iniciales, expansión explícita y selección visible al contraer | Medio: preservar textos, selectIntent y parámetros |
| Historial | Aumenta todo el documento | HistoryPanel siempre montado debajo del workspace | Lista y respuesta alargan la página | Lista y detalle apilados sin límite | Portal modal amplio con scroll propio y navegación lista/detalle | Alto: foco, borrado, cierre y contexto |
| Metadatos históricos | Bloques extensos por registro | Filtros, explicación de cuota y snapshot siempre visibles | Repetición vertical | Escaneo difícil | Periodo/modo visibles; detalles secundarios expandibles | Bajo: no eliminar información |
| CSS / temas | Colores fijos y breakpoints repetidos | Blancos y grises literales; varios @media 720/640 | Contraste incoherente | Igual problema | Tokens existentes y selectores exclusivos de workspace/formulario/historial | Alto si afecta reportes: excluir AnalysisResult |
| Modal Ecommerce | Patrón existente reutilizable conceptualmente | createPortal, Escape, foco, overflow body | Útil como referencia | Body no es el único scroller: .content-wrapper usa overflow-y:auto | Mismo patrón más bloqueo/restauración de ancestros, inert y contención de foco | Medio: montajes, StrictMode, confirmaciones |
| Ruta / autorización / storage | Superficies protegidas | Showcase antes de montar página; scope negocio/actor/sesión/licencia | Deben permanecer iguales | Deben permanecer iguales | No editar ruta, servicios, persistencia, contratos ni cuota | Alto: pruebas de aislamiento y cero llamadas adicionales |

## Archivos previstos antes de implementación

1. `src/components/ai/CommercialAIAgentsPage.jsx`: contenedores PRO, sugerencias, HistoryPanel y apertura de modal.
2. Estilos exclusivos de workspace e historial: durante implementación se eligió `CommercialAIWorkspace.css` para conservar **íntegro** `CommercialAIAgentsPage.css`, incluidas todas las reglas de reportes.
3. `src/components/ai/CommercialAIHistoryModal.jsx`: diálogo accesible siguiendo el patrón local.
4. Tests de UI, modal e invariancia; este informe.

Zona protegida: desde `function Metric(` hasta antes de `function HistoryPanel(`, SHA256 normalizando CRLF a LF `cca23f163a0492d3f32838ba709734b63306bc42df6a27a16f1c8c55b208663a`. Incluye AnalysisResult, subcomponentes, copia y adaptador histórico; no editar.

## Línea base

- Autorización: 7/7 PASS antes de modificar código.
- UI original del main exacto: 66/66 PASS. Autorización, historial y cuota: 32/32 PASS (incluye los 7 de autorización; no sumar dos veces).
- Workflows revisados: PR127 compara suite global candidate/main; Runtime y ScopedStorage validan autoridad y aislamiento; gates Dexie/Ecommerce/Store conservados. No se editarán workflows ni umbrales.

## Certificación y QA

### Implementación

- Cabecera compacta con identidad de Lía y acceso Historial. Contador del scope activo; sin números mientras carga o hay un aviso de persistencia.
- Ventas y rentabilidad integrado al workspace, con disponibilidad visible. Capacidades y advertencia completas en disclosure nativo. Ecommerce sigue en DOM después del resultado como agente futuro no ejecutable.
- Cuota horizontal con números existentes, fecha, carga, error/reintento y avisos de límite/próximo al límite. Sin cambiar consulta, reserva o consumo.
- Cuatro sugerencias iniciales; al elegir una posterior y contraer quedan las tres primeras más la elegida. Las diez etiquetas/intenciones y cuatro periodos tienen contrato de integridad. Expandir no llama selectIntent ni borra parámetros.
- Textarea de dos líneas, crecimiento hasta 224px con scroll interno posterior y resize manual; límite original de 1200 caracteres. Formulario condicional y submit originales.
- Historial en portal con lista/detalle alternos. Reutiliza el adaptador y AnalysisResult originales. Descarga en lista y en reporte; confirmación de eliminación individual y limpieza. Escape cancela confirmación antes de cerrar; backdrop no descarta accidentalmente.
- Role, aria-modal, título/descripción, foco inicial, Tab/Shift+Tab, contención de foco, restauración, fondo inert/aria-hidden con estado anterior preservado, bloqueo/restauración de body/documento/ancestros de scroll y limpieza en StrictMode.
- El token de apertura se compara durante render con el contexto actual: negocio/actor/sesión/licencia nuevos desmontan inmediatamente el modal y su selección. Servicios de storage y guardas existentes intactos.
- `100dvh`, scroll interno, safe areas y capa sobre navbar; escritorio centrado hasta 1240px, cabecera del workspace y cuota en columnas desde 900px. Tokens existentes y violeta local; ningún selector nuevo apunta a tablas, métricas o secciones internas de respuesta.

### Comparación sustentada en código

| Aspecto | Antes (main) | Después | Medición visual |
| --- | --- | --- | --- |
| Acceso al formulario | Hero + grid de dos tarjetas antes del workspace | Hero + identificación, capacidades y cuota compactas | Posición Y no medida |
| Tarjetas informativas | min-height 235px por tarjeta; una columna bajo 720px | Sin tarjetas introductorias; Ecommerce horizontal secundario | Altura real no medida |
| Sugerencias | Diez con flex-wrap siempre | Cuatro, expandibles a diez; selección conservada | Número de filas no medido |
| Acceso a Analizar | Después de sugerencias completas y parámetros | Después de sugerencias contraídas y parámetros originales | Desplazamiento aproximado no medido |
| Historial | Lista y respuesta al pie de la página | Modal con scroll propio, lista o detalle | Contención DOM probada; layout real pendiente |
| Escritorio | Tarjetas en dos columnas, workspace apilado | Cabecera/cuota en columnas, controles y diálogo amplios | Aprovechamiento visual pendiente |

### QA manual ejecutable por el propietario

Usar sólo contexto sintético de QA y una licencia PRO autorizada en Preview. No crear ventas, movimientos financieros o datos reales para esta revisión. Probar también Free y Staff sin permiso. No se proporciona un bypass de autorización.

Repetir en 320, 360, 375, 390, 430, 640, 768, 1024 y ≥1280px, claro/oscuro y orientación horizontal. Para cada paso registrar PASS/FAIL/BLOCKED y captura; abrir un escenario no implica aprobarlo.

| Paso | Acción | Verificación | Estado visual |
| --- | --- | --- | --- |
| 1 | Abrir Agentes IA PRO | Lía, pregunta y CTA prioritarios; capacidades completas disponibles | NOT RUN |
| 2 | Capturar primera carga | Medir Y del textarea y scroll hasta Analizar; comparar con main al mismo ancho | NOT RUN |
| 3 | Expandir/contraer preguntas | Diez textos originales; selección posterior visible al contraer; sin salto al inicio | NOT RUN |
| 4 | Seleccionar simulación | Producto/precio/promoción/metas visibles; valores y periodo permanecen al abrir/cerrar historial | NOT RUN |
| 5 | Seleccionar competencia | Todos los campos obligatorios y validaciones accesibles | NOT RUN |
| 6 | Revisar respuesta extensa sintética | Secciones, métricas, tablas, formatos y descargas iguales a main | NOT RUN |
| 7 | Abrir historial vacío | Título, privacidad, estado vacío y cerrar accesibles | NOT RUN |
| 8 | Abrir historial con varias consultas | Fecha/hora, pregunta, periodo/modo y tres acciones legibles; metadatos expandibles | NOT RUN |
| 9 | Ver respuesta histórica extensa | Sólo detalle en diálogo, sin extender página; scroll interno hasta último contenido | NOT RUN |
| 10 | Volver a lista y cerrar | Foco útil, scroll de fondo restaurado y estado principal intacto | NOT RUN |
| 11 | Eliminar una consulta | Confirmar/cancelar; Escape cancela confirmación; sólo desaparece el registro elegido | NOT RUN |
| 12 | Limpiar historial | Confirmación explícita y vacío dentro del mismo diálogo | NOT RUN |
| 13 | Navegar con teclado/lector | Foco inicial, Tab/Shift+Tab contenidos, Escape y foco al disparador; privacidad anunciada | NOT RUN |
| 14 | Cambiar negocio/sesión/licencia | Modal anterior desaparece; ningún reporte previo visible en el nuevo contexto | NOT RUN |
| 15 | Móvil con navbar/teclado/rotación | Cierre y acciones sin solapamientos; safe areas y viewport dinámico | NOT RUN |
| 16 | Repetir en oscuro y escritorio | Contraste/focus/legibilidad; reportes protegidos conservados; sin overflow exterior | NOT RUN |
| 17 | Abrir como Free/Local y Staff sin permiso | Showcase original/denegación originales; sin carga operativa | NOT RUN |
| 18 | Desconectar red y consultar historial | Lectura/descarga local disponible según navegador; sin solicitudes nuevas por navegación | NOT RUN |

No se declara PASS visual ni certificación WCAG completa, compatibilidad física del teclado, safe areas o navbar sin navegador/dispositivo. Los colores internos aprobados de los reportes siguen intactos: no se reinterpretan para el nuevo tema del contenedor.

### Resultados automatizados

- Servicios IA/permisos/historial/cuota/router/competencia/descargas y validación: 363/363 PASS en 17 archivos.
- ESLint focal: 0 errores, 0 warnings.
- Build + postbuild inicial: PASS; 21 startup assets auditados. Avisos de chunks/imports dinámicos y glob Workbox sin coincidencias; no se modifican sus controles. Se revalidará tras el endurecimiento final del modal.
- React Doctor inicial: 92/100, 0 errores y 2 warnings de duplicación JSX en funciones de evidencia protegidas (líneas originales 225 y 293). Esas funciones son byte a byte iguales a main; no se refactorizan.
- Primer UI candidato: 81 PASS / 7 FAIL. Un fallo de recorrido de foco, dos expectativas históricas aún en página y cuatro timeouts locales; no se ocultan ni se elevan los límites. Se corrigió foco/entrada al modal y se reejecutó. La ejecución focal diagnóstica posterior tuvo 6 PASS / 2 timeouts y 73 casos fuera del filtro; no se presenta como suite completa aprobada.
- UI completa tras endurecimiento: **89/89 PASS, 0 skips** (81 casos de página, 3 de modal y 5 de invariancia).
- Comprobación posterior del retorno de scroll al historial, descarga desde lista y restauración exacta de aria-hidden: **10/10 PASS**. Es un subconjunto de los 89; 79 quedaron fuera del filtro, no se suman como casos nuevos.
- Total único focal: **452 pruebas** (89 UI/invariancia + 363 servicios/validación), sin invocar infraestructura ni proveedor reales.
- Lint focal final: **0 errores / 0 warnings**.
- Build final, lint completo, segundo React Doctor incluyendo archivos nuevos, CI y Preview: pendientes de cierre.

## Garantías de alcance

Free/showcase/ruta, permisos, backend IA, prompts, contratos, cuota, persistencia y separación multitenant no se editan. No hay dependencias nuevas, migraciones, Edge Functions, datos financieros, cambios de producción ni merge. El PR debe permanecer Draft.
