# HOTFIX ECOM.POS.RECIPE.CONFIGURED.PRICE

Fecha: 2026-07-16 (America/Mexico_City)  
Rama: `hotfix-ecom-pos-recipe-configured-price`

## Resumen

Se corrigen dos falsos conflictos observados al preparar pedidos ecommerce en Punto de Venta y se completa el vínculo seguro entre opciones públicas y modificadores locales.

## Causa raíz

### Precio configurado

`OrderSummary` comparaba:

- `currentPosPrice`: precio base del producto local;
- `ecommerceSnapshotPrice`: precio final aceptado, incluyendo extras.

Para Papas a la francesa el POS tenía `$45`, mientras el pedido con Queso extra aceptó `$57`. La diferencia de `$12` era legítima, pero generaba el aviso de precio distinto.

### Recetas

`ecommercePosInventoryResolution` clasificaba cualquier producto con receta en modo exacto como `INVENTORY_UNKNOWN`, sin evaluar sus ingredientes. Por eso productos sin stock directo, pero preparados con ingredientes disponibles, quedaban siempre en `Requiere atención`.

### Extras e inventario

El snapshot del pedido conserva IDs públicos de opciones. El catálogo POS utiliza IDs locales como `modopt_papas_queso`. Sin reconciliación, el extra podía mostrarse y cobrarse con el precio aceptado, pero no quedar representado en `selectedModifiers` para validar y descontar su ingrediente.

## Solución

1. Se reconcilian grupos y opciones del snapshot contra la configuración local usando:
   - referencia de origen cuando exista;
   - grupo y nombre normalizados;
   - precio como desempate.
2. Se construyen modificadores POS canónicos con ingrediente, cantidad, unidad y precio vigentes.
3. `currentPosPrice` representa ahora el precio POS de la misma configuración: base actual más opciones seleccionadas.
4. Antes de declarar lista una receta se ejecuta la validación acumulada de:
   - ingredientes base de la receta;
   - ingredientes de extras seleccionados;
   - stock directo o por lotes.
5. Cuando la validación es correcta, el producto padre se adapta únicamente para el resolutor legado de stock directo y se registra como resolución `recipe`.
6. El cobro conserva el snapshot financiero ecommerce y vuelve a ejecutar la validación canónica de inventario en `processSale`.

## Resultado esperado

Para Papas a la francesa con Queso extra:

- precio aceptado: `$57`;
- precio POS comparable: `$45 + $12 = $57`;
- sin falso aviso de diferencia;
- receta verificada mediante papa y salsa;
- queso extra representado con `ing_rest_queso_oaxaca`, cantidad `0.05 kg`;
- el pedido solo queda listo si todos esos ingredientes tienen existencia suficiente.

## Seguridad

- No se modifica el total aceptado por el cliente.
- No se sustituyen precios ecommerce por precios locales durante el cobro.
- Una opción que no pueda mapearse de forma inequívoca bloquea la resolución.
- El inventario se valida nuevamente al registrar la venta.
- Sin cambios en Supabase ni migraciones.

## Pruebas añadidas

- comparación de precio configurado;
- mapeo del queso público al modificador POS;
- bloqueo ante una opción inexistente;
- validación conjunta de receta y extra;
- bloqueo por queso insuficiente;
- adaptación controlada del padre de receta para el resolutor legado.
