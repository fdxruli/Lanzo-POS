# HOTFIX ECOM.POS.REVALIDATION.RECOVERY

Fecha: 2026-07-16 (America/Mexico_City)  
Rama: `hotfix-ecom-pos-revalidation-recovery`

## Incidente observado

El pedido `EC-00000068` quedó en estado de conversión `reserved` después de iniciar el cobro:

- el pedido permaneció `accepted` y `preparing`;
- el pago continuó `pending`;
- la reserva de conversión quedó asociada al borrador POS;
- no se encontró una venta correspondiente en `pos_sales`;
- tampoco se registraron eventos de conversión completada o cancelada.

Por seguridad, la aplicación conservó la reserva y bloqueó la liberación del pedido para evitar un posible cobro duplicado.

## Causa raíz

La extensión de inventario para recetas agregada en el hotfix anterior reescribía en cada revalidación:

- `inventoryResolution.resolvedAt`;
- `ecommerceInventoryResolvedAt`.

Esto ocurría incluso cuando la receta, los extras, las cantidades y las existencias no habían cambiado.

El flujo de cobro guarda un snapshot al abrir el modal de pago y vuelve a construirlo antes de registrar la venta. Como `ecommerceInventoryResolvedAt` cambiaba entre ambas operaciones, la comparación estricta interpretaba que el pedido o su inventario habían cambiado y detenía el cobro antes de crear la venta.

## Corrección

### Revalidación estable

Se conserva la marca temporal original cuando el resultado semántico del inventario es idéntico:

- mismo producto y línea;
- misma cantidad requerida;
- mismo estado y código de resolución;
- mismo lote;
- mismos detalles de inventario;
- mismo estado global.

Una modificación real de stock, lote, cantidad o conflicto continúa generando una nueva resolución y bloqueando el cobro cuando corresponda.

### Recuperación autoritativa

Cuando la recuperación ordinaria no puede concluir si existe una venta cloud, se añade un segundo mecanismo:

1. confirma que la reserva remota pertenece al mismo dispositivo e intento;
2. comprueba que no existe una venta local cerrada con la clave ecommerce;
3. solicita la cancelación mediante `ecommerce_cancel_pos_conversion`;
4. la RPC verifica transaccionalmente `pos_sales` antes de liberar;
5. si existe una venta, la RPC rechaza la cancelación y el pedido permanece en revisión;
6. si no existe venta, la reserva vuelve a `idle`, se limpia el lock local y el pedido puede cobrarse nuevamente.

No se libera una reserva basándose únicamente en el estado del navegador.

## Relación con OrderSummary

`OrderSummary` y `EcommercePosConversionPanel` solo muestran el estado resultante. No causaron la reserva. El bloqueo provenía del contrato de conversión después de la interrupción preventiva del cobro.

## Seguridad

- No se modifica el precio aceptado.
- No se debilita el snapshot financiero.
- No se permite repetir un cobro cuando existe una venta.
- No se realizan cambios directos en Supabase.
- No se modifica el pedido `EC-00000068` manualmente.
- La liberación remota continúa protegida por identidad, claim, intento, sale ID, conversion key y comprobación autoritativa de venta.

## Pruebas añadidas

- una segunda revalidación idéntica conserva los timestamps y devuelve `changed: false`;
- un cambio real de inventario conserva el nuevo estado conflictivo;
- una reserva sin venta se libera mediante la RPC autoritativa;
- una cancelación rechazada por posible venta mantiene el pedido bloqueado.