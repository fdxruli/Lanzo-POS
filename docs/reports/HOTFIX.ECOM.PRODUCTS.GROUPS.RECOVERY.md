# HOTFIX ECOM.PRODUCTS.GROUPS.RECOVERY

Fecha: 2026-07-16
Proyecto Supabase: `odlrhijtfyavryeqivaa`

## Alcance aplicado

1. Se corrigió `private.ecommerce_source_revision_decision` para permitir que una lectura confirmada con revisión `version` o `timestamp` recupere un producto previamente marcado como `source-missing` sin revisión comparable.
2. Se actualizó la configuración canónica de `prod_rest_taco_pastor`:
   - grupo `Extras` en modo `multiple`;
   - `required=false`;
   - `minSelect=0`;
   - `maxSelect=3`;
   - etiqueta semántica `Sin extras` en metadata.
3. Se actualizó la proyección publicada del grupo para que el portal público use casillas y permita combinaciones como queso extra + tortillas + sin cebolla.

## Verificación

- La función de decisión devuelve `apply` para `source-missing` sin revisión seguido de `version:2`.
- `pos_products.server_version` avanzó a `2`.
- `ecommerce_published_option_groups.Extras` quedó como `multiple`, mínimo `0`, máximo `3`.
- No se modificaron pedidos, ventas, caja, reservas ni inventario.

## Comportamiento esperado

Tras recargar el POS en el dispositivo vigente, la reconciliación normal debe retirar el conflicto de revisión de `Taco al pastor`. En la tienda pública, el grupo Extras permite seleccionar varias opciones simultáneas. Un grupo opcional con cero selecciones representa "Sin extras" y no agrega precio ni inventario.
