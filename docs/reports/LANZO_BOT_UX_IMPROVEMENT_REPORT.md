# LANZO_BOT_UX_IMPROVEMENT_REPORT

## Objetivo y causa

Lanzó Bot abría una tarjeta de altura forzada (640 px), con el historial `flex: 1` vacío y una regla móvil `top` que lo alejaba de su lanzador. El resultado era un hueco grande y el desplazamiento contextual fuera de la interfaz.

## Cambios

- Tarjeta de altura automática, límite de viewport y área de lectura desplazable solo cuando falta espacio.
- En móvil el botón flotante se sitúa sobre la barra inferior mediante `--mobile-bottom-nav-height` y `--safe-area-bottom`; la tarjeta aparece 12 px encima del botón. Si el teclado ocupa el viewport, se reposiciona sin reservar el hueco del lanzador.
- Cabecera compacta, estados de conexión/plan, título y subtítulo de ruta, componentes visuales con los tokens del POS y botones táctiles.
- Bienvenida contextual: descripción por las 11 rutas, explicación de pestañas derivada del primer paso de su guía actual y consejo del rubro en POS.
- 2–4 accesos rápidos de navegación: se derivan de IDs existentes de `BOT_GUIDES`; el hilo principal valida cada ruta con `canOpenBotAction` antes de pintarla y al pulsarla. No ejecutan operaciones de negocio.
- Preguntas sugeridas diferenciadas de los accesos. Tras preguntar, la conversación ocupa el panel y se puede alternar con los recursos sin perder mensajes.
- Para evitar saltos en la pantalla subyacente, el autodesplazamiento actúa sobre el historial del bot y ya no sobre `scrollIntoView`.
- El aviso global existente mantiene su flujo independiente sin iniciar Worker.

## Cambios de arquitectura

Solo se amplió la respuesta serializable `CONTEXT` del Worker con `description` y `actions` (id, label, path). Se mantienen intactos el transporte `QUESTION` y `READ`, cálculo, autorizaciones y cancelaciones. No se importaron datos de negocio, bibliotecas nuevas ni catálogos completos al hilo principal.

## Archivos

- `src/components/common/AssistantBot.jsx`
- `src/components/common/AssistantBot.css`
- `src/config/botKnowledge.js`
- `src/workers/bot.worker.js`
- `src/components/common/__tests__/AssistantBot.test.jsx`
- `src/config/__tests__/botKnowledge.context.test.js`

## Validación y estado

Se añadieron siete casos focales: bienvenida, navegación real, filtro de permisos, alternancia de recursos, pestaña, cobertura del catálogo y rubro restaurante. Las pruebas y el build no están certificados en esta revisión: GitHub Connector permite editar el repositorio, pero el contenedor actual no contiene el clon ni dependencias de LANZO POS. El estado de CI se debe consultar en el PR. Tampoco hay QA manual físico de Android ni pruebas reales del teclado y tema oscuro.

## QA manual pendiente

Verificar con sesión y permisos reales en Vercel Preview, sin operaciones financieras:
1. 390×844 y 320×568, con y sin carrito activo, tema claro y oscuro.
2. Inicio compacto y accesos correctos (incluyendo Staff con permisos limitados).
3. Navegación a una pestaña real; preguntar, recibir respuesta, volver a accesos.
4. Abrir y cerrar teclado Android; comprobar entrada, Enviar y botón de cierre.
5. Cerrar y desactivar; verificar ausencia de Worker residual.

No ejecutar SQL, no tocar Production y no fusionar este PR sin autorización del propietario.
