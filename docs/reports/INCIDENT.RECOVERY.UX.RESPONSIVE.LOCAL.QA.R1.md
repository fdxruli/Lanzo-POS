# Centro de Recuperación — mini-fase 4.2

Fecha: 2026-10-17. PR: https://github.com/fdxruli/Lanzo-POS/pull/357. Rama remota: feat/incident-recovery-center-r1.
HEAD inicial verificado en GitHub y remoto: 008dc17913b8d18e0c6c02841b0ae334ee8df888.
Implementación en worktree limpio C:/dev/Lanzo-POS-recovery-ux-42; copia del propietario C:/dev/Lanzo-POS-QA-357 preservada. Las huellas SHA-256 anteriores y posteriores de WelcomeModal.jsx, DashboardPage.jsx y src/copy.txt son idénticas. La copia original de trabajo Lanzo-POS-Git también conserva su rama y archivos ajenos a esta mini-fase.

## 1. Evidencia del propietario

El brief describe una captura oscura con cinco acciones mezcladas. La imagen original no fue adjuntada: el diagnóstico visual de esa captura se limita a la descripción del propietario. QA-01 App y QA-04 Ventas reportan captura y diagnóstico seguros. QA-02 es TypeError de Welcome. QA-03 muestra ReferenceError, react_render, section_failure: no acredita un bloqueo financiero. No se cambia la clasificación para producir un PASS.

## 2. Diagnóstico técnico

El flex-wrap de acciones agrupaba recuperación, correo y copia. El entrypoint de reporte estaba fuera del grupo y la nota de correo parecía global. El mismo fallback servía a Welcome y rutas administrativas, sin contrato de presentación. El documento global usa overflow:hidden, por lo que una pantalla de acceso necesita su propio scroll. Layout ya reserva espacio para navegación móvil en rutas administrativas; el contenedor POS requiere conservar explícitamente esa reserva al mostrar recuperación.

Se inspeccionaron IncidentRecoveryPanel, ErrorBoundary.css, IncidentErrorBoundary, ErrorBoundary, IncidentReportEntry, IncidentReportForm y su CSS, AdminRouteRecoveryRegion, PosApplicationBootstrap, WelcomeModal y su CSS, DashboardPage, Layout y su CSS, App, index.css, design-tokens.css, buttons.css, clasificación y pruebas existentes. No se modifica CSS global, WelcomeModal ni DashboardPage.

## 3. Arquitectura de presentación

Área A: icono semántico, identidad discreta, título y descripción. Área B: recuperación y estado junto a las acciones. Área C: ayuda agrupada con reporte, copia y correo, con sus instrucciones asociadas. Los detalles permanecen plegados y fuera de la asistencia. El DOM conserva problema → recuperación → ayuda → detalles. En contenedores amplios, recuperación y asistencia comparten dos columnas; los detalles usan todo el ancho inferior.

## 4. Welcome, App y Ventas

Contrato explícito recoverySurface en IncidentErrorBoundary: welcome y application seleccionan la presentación standalone; sales selecciona únicamente copy conocido; valores desconocidos conservan el fallback genérico. presentation en el panel acepta standalone de manera acotada y nunca sustituye el modo crítico. No se infiere el contexto por ancho, stack o mensaje de excepción.

App marca exclusivamente el boundary de Welcome. PosApplicationBootstrap marca los boundaries raíz de aplicación/ruta para QA-01 y fallos generales, sin llamarlos errores de Welcome. AdminRouteRecoveryRegion usa la igualdad exacta /ventas para el contexto de Ventas; el boundary queda dentro de Layout, conservando navegación y runtimes no afectados. El copy contextual se aplica solo a react_render no crítico; DB, autorización y finanzas conservan su diagnóstico propio. La metadata y el diagnóstico siguen usando la allowlist existente.

Standalone es un elemento normal con viewport y scroll propios, sin portal ni overlay nuevos. El contenido de Welcome que falla se desmonta, incluido su overlay. No se monta un modal dentro de otro.

## 5. Acciones

Reintentar conserva el presupuesto, guardas y handlers existentes. La inspección en navegador detectó que, tras volver a fallar el render, persistía el aviso «Recuperando esta sección…». Se sustituye por un aviso de reintento fallido al capturar la nueva excepción, sin cambiar el límite ni habilitar otra recuperación. Volver al inicio conserva la navegación segura; no aparece si las guardas no la permiten. Correo pasa a supportActions, separado de secondaryActions de recuperación. La nota describe un borrador manual, nunca un envío confirmado. Copiar requiere clic y conserva diagnóstico sanitizado; hay feedback accesible de éxito/error. Reportar mantiene lazy loading, servicios, consentimiento y contrato de envío.

## 6. CSS modificado

ErrorBoundary.css se reorganiza, eliminando el flex-wrap y los overrides móviles anteriores. IncidentReportForm.css añade min-width:0, wrapping de controles y targets de 44px, sin alterar el contrato de formulario. Se reutilizan superficies, tipografía, controles, colores y radios de los tokens de Lanzo. No se cambian Layout.css, tokens, botones globales ni CSS de Welcome.

## 7. Responsive

Una columna de base. Consultas del contenedor: desde 34rem caben dos acciones y dos columnas de metadata; desde 56rem se separa asistencia a la derecha. Estos umbrales dependen del espacio real dentro del shell. Los títulos usan clamp, los textos normales evitan cortes arbitrarios y los códigos permiten wrapping. Safe areas y scroll del viewport para standalone/crítico; sin recorte del contenido. El shell mantiene mobile-navigation-clearance y se restaura su scroll solo mientras existe un panel de sección. Reduced motion desactiva giro y animación heredada del contenedor afectado.

Matriz obligatoria de revisión: 320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280 y 1440px; vertical/horizontal, alturas reducidas, zoom 200%/400% y teclado móvil. Registrar abajo solo lo ejecutado; no confundir CSS implementado con certificación de todos los dispositivos.

## 8. Gravedad y seguridad

Sin cambios a classifyIncident, transporte, actor runtime, almacenamiento, PWA, operaciones, límites de reintento, IndexedDB/outbox o pagos. TypeError/ReferenceError generales permanecen section_failure. FINANCIAL_RESULT_UNKNOWN en fixture de test usa el clasificador real y conserva critical_blocker, portal, inert, aria-hidden y ausencia de reintento/navegación financiera. La evidencia de fixture no certifica infraestructura financiera real.

## 9. Accesibilidad

Standalone usa h1 y h2 para ayuda/operación; sección/crítico conservan h2 y h3 para sus subsecciones. Los encabezados de bloqueos siguen el nivel siguiente. Se elimina el role=status del contenedor interactivo no crítico, evitando anuncios de todo el formulario y live regions anidadas. Estado y copia tienen anuncios puntuales. Foco visible, orden DOM natural, aria-expanded y aria-controls preservados. El fallo inicial no crítico mueve foco al título; el foco tras recuperación mantiene la implementación existente. El formulario recibe foco al abrir y lo restaura al entrypoint al cerrar. Los bloqueos explican su razón por aria-describedby. Contraste calculado desde los tokens existentes: texto secundario/fondo claro 5.06:1, oscuro 8.11:1; texto secundario/tarjeta 5.38:1 y 7.22:1; acción primaria 5.17:1 y 7.73:1. Estos pares superan 4.5:1. No se certifica cumplimiento WCAG completo mediante estos cálculos. Lector de pantalla real y evaluación completa siguen pendientes.

## 10. Validación automatizada

Commit funcional validado: e109f0723d4227564fbc23ad53a363126a5bddc6. CI del laboratorio: **140/140 PASS en 13 archivos**, incluida la suite nueva **8/8 PASS**. Se preservan las pruebas de captura/clasificación, límites de reintento, contexto obsoleto, foco, bloqueo crítico, consentimiento, copia, offline, aislamiento y arquitectura del laboratorio.

ESLint focal de los componentes modificados: 0 errores, 0 advertencias. La importación sin uso de la suite nueva se eliminó y su ejecución focal final de ESLint también dio 0 errores y 0 advertencias. git diff --check: PASS.

Límite local documentado: el pool inicial de Vitest no arrancó su worker dentro de 60s (0 tests ejecutados). La alternativa threads ejecutó 7/7 pruebas antes de añadir la octava prueba de foco, posteriormente validada en CI. La regresión local ampliada se interrumpió por la lentitud del host y se sustituyó como evidencia por CI; no se presenta como PASS local. El build local llegó a transformar y se interrumpió para reducir procesos concurrentes. Los builds administrativo/productivo/Preview/público y empaquetado público sí aprobaron en CI. No se cambiaron scripts o assertions para ocultar fallos.

El workflow del laboratorio incluye expresamente la nueva suite, sin retirar ninguna prueba previa. La regresión local posterior al ajuste del aviso dio 46/46 PASS en 3 archivos con threads; se vuelve a ejecutar tras ajustar niveles de encabezados.

React Doctor: 83/100, 17 hallazgos en 96 archivos respecto a origin/main (1 error y 16 advertencias). El error señalado —asignación de currentIncidentIdRef durante render en IncidentReportForm— ya existe en el HEAD inicial 008dc1791; no fue introducido aquí. Las advertencias incluyen complejidad/tamaño, resets ligados al incidente, claves de fixtures y un supuesto teardown ausente: componentWillUnmount sí limpia temporizadores, suscripciones y restaura el root crítico. No se añadieron supresiones ni dependencias. El escáner no se presenta como limpio.

## 11. CI

Primer commit funcional **e109f0723d4227564fbc23ad53a363126a5bddc6**: los siete workflows terminaron SUCCESS. Los resultados siguientes corresponden únicamente a ese SHA. El commit de cierre añade evidencia estática, niveles de encabezados y el aviso de reintento fallido; su validación final se registra en el PR tras terminar sus propios workflows.

| Gate | Resultado y evidencia |
| --- | --- |
| [PR127 Global Comparison](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705531) | SUCCESS. Artefacto 12093531342 inspeccionado: candidato 99 fallos, base 100, compartidos 99; candidate-only 0, nuevos 0, sin resolver 0, mejora 1. |
| [Incident Recovery QA Lab](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705546) | SUCCESS. 140/140 pruebas, 13 archivos; ESLint focal; build administrativo y auditoría precache (44 ejecutables, 0 artefactos QA); Preview y exclusión (9 chunks estáticos, 0 módulos comerciales). |
| [Actor Runtime](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705544) | SUCCESS. Artefacto diferencial 12094035790: 0 regresiones nuevas, 93 observaciones de fallos preexistentes estables, 0 flaky, mejora 1; 2 ejecuciones completas y 350 focales por lado. Diferencial focal: 0 candidate-only semánticos y 0 regresiones de tasa. |
| [Actor Scoped Storage](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705549) | SUCCESS. Artefacto 12094215506: 0 regresiones nuevas, 93 observaciones preexistentes estables, 0 flaky, mejora 1; 2 ejecuciones completas y 350 focales por lado. |
| [Dexie Recovery](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705533) | SUCCESS. |
| [Ecommerce Public](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705536) | SUCCESS. |
| [Store Git Runtime](https://github.com/fdxruli/Lanzo-POS/actions/runs/39011705542) | SUCCESS. |

Los dos diferenciales Actor registran 75 tests fallidos en la ejecución completa del candidato y de su base correspondiente. SUCCESS significa que su comparación no detectó regresiones nuevas; **no** significa una suite global sin fallos. Los fallos candidate-only se comprobaron en los artefactos, sin reclasificarlos manualmente.

## 12. Evidencia visual

Se capturó el componente real con dependencias del laboratorio cerradas en memoria, en localhost; se inspeccionaron las imágenes guardadas. El navegador integrado permitió las capturas desktop; la extensión de Edge permitió inspeccionar los viewports móviles tras el bloqueo del cambio de tamaño integrado. El fixture temporal y su servidor no forman parte del PR. La captura original del propietario no está disponible: «antes» reproduce el código del HEAD inicial, no su sesión.

La matriz DOM de Welcome y Ventas cubre **320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280 y 1440px**: 0px de overflow horizontal y targets de al menos 44px en ambos contextos. [Mediciones Welcome](assets/incident-recovery-ux-42/welcome-responsive-matrix.json) y [mediciones Ventas](assets/incident-recovery-ux-42/sales-responsive-matrix.json). Ventas utiliza un scaffold de navegación con Layout.css real; no equivale a ejecutar la sesión comercial completa.

| Paso inspeccionado | Evidencia y conclusión |
| --- | --- |
| Antes, desktop claro | [00 — reproducción inicial](assets/incident-recovery-ux-42/00-baseline-desktop-light.jpg). Acciones mezcladas en la composición previa. |
| Welcome desktop | [01 claro](assets/incident-recovery-ux-42/01-welcome-desktop-light.jpg), [02 oscuro](assets/incident-recovery-ux-42/02-welcome-desktop-dark.jpg). Problema y recuperación a la izquierda; asistencia agrupada a la derecha. |
| Welcome móvil | [03 claro](assets/incident-recovery-ux-42/03-welcome-mobile-light.jpg), [04 oscuro](assets/incident-recovery-ux-42/04-welcome-mobile-dark.jpg), 390×844. Una columna y scroll natural. |
| Detalles al final | [05 Welcome](assets/incident-recovery-ux-42/05-mobile-details.jpg). ScrollTop 553 = máximo; último elemento a 807.875px dentro de 844px. |
| Formulario | [06 apertura](assets/incident-recovery-ux-42/06-mobile-report-form.jpg). Foco en encabezado al abrir, textarea de 281px sin desborde y retorno al botón al cerrar. Sin envío ni consentimiento. |
| Ventas 320px | [07 panel](assets/incident-recovery-ux-42/07-sales-mobile-320.jpg), [08 final de detalles](assets/incident-recovery-ux-42/08-sales-mobile-details-bottom.jpg). Último elemento a 519.2px, antes de navegación a 589.4px. |
| Ventas desktop oscuro | [09 diagnóstico expandido](assets/incident-recovery-ux-42/09-sales-desktop-dark.jpg), 1440×900. Metadatos y acciones legibles. |
| Reintento agotado | [10 aviso corregido](assets/incident-recovery-ux-42/10-retry-exhausted.jpg), 360×844. Botón deshabilitado, motivo y aviso de fallo, asistencia disponible. |
| Crítico financiero reconocido | [11 desktop](assets/incident-recovery-ux-42/11-financial-critical-desktop.jpg), [13 móvil](assets/incident-recovery-ux-42/13-financial-critical-mobile.jpg). FINANCIAL_RESULT_UNKNOWN sintético con clasificador real. Root inert y aria-hidden, sin Reintentar ni Volver al inicio. Móvil: scrollHeight 1034, clientHeight 740, overflow horizontal 0. |
| Horizontal y poca altura | [12 Welcome 844×390](assets/incident-recovery-ux-42/12-welcome-landscape-short.jpg). Panel visible de 347px con scrollHeight 760; todos los controles alcanzables al desplazar. |

Teclado comprobado: Tab desde título a Reintentar y luego Volver al inicio; Shift+Tab vuelve a Reintentar; Enter/Espacio accionan detalles. La prueba de atajo de zoom no cambió la escala efectiva: **200%/400% siguen pendientes**, junto con teclado móvil físico y lector de pantalla real. No se presentan capturas emuladas como dispositivos físicos.

**OWNER_VISUAL_QA: PENDING.** La evidencia complementaria no sustituye QA-01/02/03/04 en la copia local del propietario.

## 13. Incorporar cambios sin perder los errores locales

No actualizar automáticamente la copia QA averiada. El método recomendado crea una segunda copia y conserva íntegra la original. En PowerShell, desde un directorio de trabajo:

```powershell
# Guardar únicamente las inyecciones conocidas, sin modificar la copia original.
git -C C:/dev/Lanzo-POS-QA-357 diff --binary --output=C:/dev/Lanzo-POS-QA-357-faults.patch -- src/components/common/WelcomeModal.jsx src/pages/DashboardPage.jsx
Copy-Item -LiteralPath C:/dev/Lanzo-POS-QA-357/src/copy.txt -Destination C:/dev/Lanzo-POS-QA-357-copy-backup.txt

# Traer el PR y preparar otro worktree, sin cambiar la rama/copia original.
git -C C:/dev/Lanzo-POS-Git fetch origin feat/incident-recovery-center-r1
git -C C:/dev/Lanzo-POS-Git worktree add --detach C:/dev/Lanzo-POS-QA-357-UX origin/feat/incident-recovery-center-r1

# Si --check falla, detenerse y revisar el parche; no forzar ni sobrescribir archivos.
git -C C:/dev/Lanzo-POS-QA-357-UX apply --check C:/dev/Lanzo-POS-QA-357-faults.patch
if ($LASTEXITCODE -ne 0) { throw "El parche necesita revisión; no se aplicó ni se inició la copia nueva." }
git -C C:/dev/Lanzo-POS-QA-357-UX apply C:/dev/Lanzo-POS-QA-357-faults.patch
Set-Location C:/dev/Lanzo-POS-QA-357-UX
npm ci
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Antes del último comando, detener manualmente el servidor anterior que use 5175. Revisar el diff de las dos inyecciones y el HEAD remoto antes de aplicar. Si copy.txt no existe, omitir solo su copia. No hacer reset, clean, restore masivo, borrado de datos del navegador ni publicación del parche de fallos. Mantener la configuración local habitual fuera de Git; no copiar credenciales al informe. La prueba de UI en localhost no acredita una base aislada. No ejecutar una transacción para simular el bloqueo financiero; usar exclusivamente fixture de test.

Checklist del propietario: Welcome claro/oscuro móvil y desktop; Ventas móvil/desktop con shell; widths de toda la matriz y orientación horizontal; detalles expandidos; formulario y teclado; Tab/Shift+Tab/Enter/Espacio; zoom; reintento agotado; scroll hasta última acción; critical financiero solo en fixture seguro. Registrar QA-01/02/03/04 de nuevo sobre el HEAD actualizado.

## 14. Riesgos pendientes

Aprobación visual desde localhost del propietario; navegadores/dispositivos reales; cliente de correo externo; lector de pantalla; recepción/persistencia/RLS reales e integración aislada. No elevar QA-03 ReferenceError a certificación financiera. No se aplican migraciones ni cambios productivos.

## 15. Coordinación y PR

PRs abiertos revisados: #352 y #338. #352 no comparte los archivos modificados. #338 comparte App.jsx: se inspeccionó el patch remoto; sus hunks cambian imports y lazy loading, no el boundary de Welcome. Sin solapamiento del hunk de esta mini-fase. No incorporar trabajo de restaurante ni modificar sus archivos. Actualizar exclusivamente #357, conservar Draft y no hacer merge.
