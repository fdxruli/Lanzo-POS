# LANZO_BOT_HEADER_REFINEMENT_REPORT

## Base verificada
- `main`: `42fa6c9f3c37925072514d93b7906de05b514fee` (merge PR #396).

## Decisión de UX
En conversación normal, el botón flotante es la única X y el encabezado no duplica la acción. Se alinean «Lanzó Bot · [sección actual]» en una fila adaptable con dos líneas como máximo para el contexto y el nombre completo en `title`. No se modifica la descripción contextual ni el chat.

## Teclado en Android
Se conserva el comportamiento ya implementado de `visualViewport`: cuando detecta teclado, el CSS mueve el panel y oculta el botón flotante para no tapar los controles de texto. Solo durante ese estado aparece la X accesible de la cabecera. Al ocultar el teclado, desaparece la X de la cabecera y reaparece el botón flotante; Escape y ambos cierres usan `close()`, que apaga el Worker y devuelve foco al lanzador. No hay dos X visibles a la vez.

## Avisos globales
Se mantiene la X propia de los avisos (el flotante no existe durante un aviso), el bloqueo de cierre de avisos críticos y la política anterior de reconocimiento. No se toca `GLOBAL_ALERT`.

## Archivos
- `src/components/common/AssistantBot.jsx`
- `src/components/common/AssistantBot.css`
- `src/components/common/__tests__/AssistantBot.test.jsx`
- `docs/reports/LANZO_BOT_HEADER_REFINEMENT_REPORT.md`

## Pruebas
Cinco casos focales añadidos: FAB y Escape/restauración de foco/terminación del Worker; conmutación por teclado simulado; título largo; aviso descartable; aviso crítico. Siguen disponibles las pruebas anteriores de conversación, accesos y guías. Se requiere confirmar la ejecución real de Vitest y del build en el entorno CI/Preview; no equiparar el compilado READY con QA manual.

## QA pendiente
En Android real con pantalla 390×844 y 320×568, comprobar que el teclado no tape la entrada ni Enviar y que la X temporal sea visible y alcanzable. Comprobar tema oscuro y retorno de foco. En Windows probar Escape. La geometría de teclado, el contraste, la altura y las safe areas no se certifican con jsdom.

## Límites
Un único PR Draft, sin merge, SQL, cambios en Worker, Supabase ni despliegue manual a Production.
