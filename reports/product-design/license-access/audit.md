# Auditoría — “¿Cómo deseas ingresar?”

## Alcance

Flujo de selección de acceso después de validar una licencia con perfiles de Administrador y Personal / Staff.

## Evidencia

- `01-desktop-before.png`: panel original en 1440 × 900.
- `02-mobile-before.png`: panel original en 390 × 844.
- `03-desktop-after.png`: rediseño en 1440 × 900.
- `04-mobile-after.png`: rediseño en 390 × 844.
- `05-desktop-dark-after.png`: comprobación visual del rediseño con tema oscuro.

## Hallazgos del estado original

1. El panel parecía un modal genérico: no había señal de progreso, estado de licencia ni una jerarquía visual que ayudara a decidir.
2. Las tarjetas usaban colores fijos (`#fff`, `#0f172a`, `#64748b`) y no seguían los tokens claro/oscuro del producto.
3. En desktop las dos opciones tenían poco contraste entre sí y el texto ocupaba el espacio sin una ruta visual clara.
4. En mobile la columna única funcionaba, pero las tarjetas podían ser más táctiles y el pie del panel no tenía una jerarquía propia.

## Cambios aplicados

- Base mobile first con bottom sheet, áreas táctiles amplias y apilado vertical.
- Layout desktop a dos columnas a partir de 720 px, manteniendo la misma prioridad de contenido.
- Colores, fondos, bordes, sombras y foco basados en los tokens `--ui-*` y `color-mix()`.
- Jerarquía nueva: “Paso 2 de 2”, estado de licencia, icono de confianza, guía breve y confirmación de acceso protegido.
- Estados hover, focus-visible, active y reduced-motion para interacción y accesibilidad.

## Límites de la auditoría

La captura permite evaluar jerarquía, contraste aparente y composición, pero no sustituye una prueba completa con teclado, lector de pantalla, zoom del navegador o dispositivos físicos.
