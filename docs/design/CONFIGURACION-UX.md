# Configuración — guía UX

Referencia de diseño para futuros rediseños de **Configuración** en LANZO POS. Aplicar estos criterios al alcance autorizado; no copiar una maqueta idéntica para todas las pantallas.

## Jerarquía y composición
- Mobile-first, encabezados compactos, contenido operativo primero y explicaciones sin repeticiones.
- Columnas según ancho real disponible; evitar anchos fijos que compriman formularios.
- Una superficie por grupo funcional cuando aporte valor; preferir separadores a tarjetas decorativas anidadas.

## Densidad y formularios
- Espacios orientativos de 8–12 px entre controles relacionados y alrededor de 16 px entre grupos.
- No imponer alturas innecesarias ni reducir texto o objetivos táctiles (al menos 44 px cuando corresponda).
- Campos confirmados protegidos como información de lectura; pendientes visiblemente editables.
- Botones de guardado contextuales y confirmación real. Mantener estados de carga, error, vacío, protegido, pendiente y sin cambios.

## Responsive y accesibilidad
- Verificar 360, 390, 768, 1024 y 1440 px, móvil/tablet/escritorio, tema claro y oscuro.
- Sin scroll horizontal accidental; respetar navegación inferior y safe areas.
- Foco visible, teclado, contraste suficiente, estados no dependientes solo del color y validación accesible.
- Usar expansiones para información consultiva, nunca para ocultar campos pendientes o errores relevantes.

## Estilos y comportamiento
- Reutilizar tokens y componentes actuales; CSS por sección, sin estilos globales nuevos ni dependencias ornamentales.
- Un rediseño visual no cambia permisos, validaciones, persistencia, contratos ni reglas comerciales.

## Criterios de entrega
1. Definir qué podrá hacer el usuario y una prueba manual real de extremo a extremo.
2. Aplicar el cambio mínimo reversible, sin modificar otras secciones sin autorización.
3. Ejecutar regresión focal, seguridad/permisos y QA responsive cuando corresponda.
4. Separar código preparado, QA automatizado, QA manual físico, Production y objetivo cumplido.
5. No declarar PASS de una prueba no ejecutada ni sustituir QA real por CI verde.
