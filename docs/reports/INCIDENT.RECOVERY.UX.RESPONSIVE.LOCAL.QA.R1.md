# Centro de Recuperación — mini-fase 4.2

Fecha: 2026-10-17. PR: https://github.com/fdxruli/Lanzo-POS/pull/357. Rama remota: feat/incident-recovery-center-r1.
HEAD inicial verificado en GitHub y remoto: 008dc17913b8d18e0c6c02841b0ae334ee8df888.
Implementación en worktree limpio C:/dev/Lanzo-POS-recovery-ux-42; copia del propietario C:/dev/Lanzo-POS-QA-357 preservada.

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

Reintentar conserva el presupuesto, guardas y handlers existentes. Volver al inicio conserva la navegación segura; no aparece si las guardas no la permiten. Correo pasa a supportActions, separado de secondaryActions de recuperación. La nota describe un borrador manual, nunca un envío confirmado. Copiar requiere clic y conserva diagnóstico sanitizado; hay feedback accesible de éxito/error. Reportar mantiene lazy loading, servicios, consentimiento y contrato de envío.

## 6. CSS modificado

ErrorBoundary.css se reorganiza, eliminando el flex-wrap y los overrides móviles anteriores. IncidentReportForm.css añade min-width:0, wrapping de controles y targets de 44px, sin alterar el contrato de formulario. Se reutilizan superficies, tipografía, controles, colores y radios de los tokens de Lanzo. No se cambian Layout.css, tokens, botones globales ni CSS de Welcome.

## 7. Responsive

Una columna de base. Consultas del contenedor: desde 34rem caben dos acciones y dos columnas de metadata; desde 56rem se separa asistencia a la derecha. Estos umbrales dependen del espacio real dentro del shell. Los títulos usan clamp, los textos normales evitan cortes arbitrarios y los códigos permiten wrapping. Safe areas y scroll del viewport para standalone/crítico; sin recorte del contenido. El shell mantiene mobile-navigation-clearance y se restaura su scroll solo mientras existe un panel de sección. Reduced motion desactiva giro y animación heredada del contenedor afectado.

Matriz obligatoria de revisión: 320, 360, 375, 390, 430, 600, 768, 820, 1024, 1280 y 1440px; vertical/horizontal, alturas reducidas, zoom 200%/400% y teclado móvil. Registrar abajo solo lo ejecutado; no confundir CSS implementado con certificación de todos los dispositivos.

## 8. Gravedad y seguridad

Sin cambios a classifyIncident, transporte, actor runtime, almacenamiento, PWA, operaciones, límites de reintento, IndexedDB/outbox o pagos. TypeError/ReferenceError generales permanecen section_failure. FINANCIAL_RESULT_UNKNOWN en fixture de test usa el clasificador real y conserva critical_blocker, portal, inert, aria-hidden y ausencia de reintento/navegación financiera. La evidencia de fixture no certifica infraestructura financiera real.

## 9. Accesibilidad

Standalone usa h1; sección/crítico conservan h2, con h3 para ayuda. Se elimina el role=status del contenedor interactivo no crítico, evitando anuncios de todo el formulario y live regions anidadas. Estado y copia tienen anuncios puntuales. Foco visible, orden DOM natural, aria-expanded y aria-controls preservados. El fallo inicial no crítico mueve foco al título; el foco tras recuperación mantiene la implementación existente. El formulario recibe foco al abrir y lo restaura al entrypoint al cerrar. Los bloqueos explican su razón por aria-describedby. Lector de pantalla real y evaluación WCAG completa no se declaran certificados por pruebas DOM.

## 10. Validación automatizada

Ejecución local inicial BLOQUEADA: Vitest llegó a RUN, pero su worker no respondió dentro de 60s (transform/setup/import/tests: 0ms; ningún test ejecutado). Se intentó un pool de threads como alternativa; resultado pendiente. No se atribuye el bloqueo del worker a un fallo de assertions del producto. ESLint y builds locales pendientes. git diff --check: PASS. Los resultados definitivos se añaden al cierre. Nueva suite IncidentRecovery.ux.test.jsx cubre errores reales sintéticos, contextos conocidos/desconocidos, separación semántica, nota asociada, copia, foco, reintento agotado y clasificador financiero real. No se debilitan pruebas existentes.

## 11. CI

PENDIENTE del HEAD de publicación. Los SUCCESS históricos de 008dc1791 no se atribuyen al nuevo código. Esperar los gates de PR127, Actor Runtime, Actor Scoped Storage, Dexie Recovery, Ecommerce Public, Store Git Runtime y laboratorio. Inspeccionar artefactos diferenciales si hay fallos candidate-only; no aprobarlos como baseline sin comparación.

## 12. Evidencia visual

La captura original del propietario no está disponible. El navegador integrado y las dependencias de la copia limpia presentaron problemas de carga durante la preparación. Los resultados complementarios, si se obtienen, se registrarán abajo con su alcance. OWNER_VISUAL_QA permanece PENDING en todos los casos. No se cambia producción para capturar.

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
