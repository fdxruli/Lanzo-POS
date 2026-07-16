# HOTFIX ECOM.POS.EXPIRED.RESERVATION.RECOVERY

Fecha: 2026-07-16 (America/Mexico_City)  
Rama: `hotfix-ecom-expired-reservation-recovery`

## Incidente

El pedido `EC-00000068` conservó una reserva de conversión `reserved` después de que el cobro se interrumpiera antes de crear una venta.

Supabase confirmó:

- pedido `accepted`;
- fulfillment `preparing`;
- pago `pending`;
- borrador POS `prepared`;
- conversión `reserved`;
- `converted_sale_id` nulo;
- sin venta correspondiente en `pos_sales`.

La reserva pertenece al dispositivo `19975864-3468-43f4-8146-5adb2c1c59bf`, registrado como Chrome en Android. El claim venció el 16 de julio de 2026 a las 13:12:02, hora de Ciudad de México.

## Defecto residual

El hotfix anterior agregó una recuperación autoritativa, pero `recoverEcommercePosConversion` terminaba inmediatamente cuando la recuperación base devolvía `success: true` y `changed: false`.

Después de recargar la aplicación, el estado local podía restaurarse como `idle`, aunque Supabase continuara en `reserved`. En ese escenario:

1. la recuperación base veía el estado local `idle` y concluía sin cambios;
2. la extensión no consultaba el estado remoto;
3. posteriormente `OrderSummary` obtenía `reserved` y mostraba la reserva pendiente;
4. no se ejecutaba nuevamente la recuperación;
5. el pedido permanecía bloqueado para cobrar y liberar.

## Corrección

La recuperación ahora consulta el estado remoto cuando el borrador ecommerce local está en `idle`, `error`, `reserving`, `reserved` o `unknown`, salvo que la venta ya esté completada.

Una reserva solo se libera automáticamente cuando:

- pertenece al dispositivo actual;
- el claim remoto ya venció, o la recuperación de venta quedó pendiente;
- no existe venta local cerrada con la clave ecommerce;
- la RPC `ecommerce_cancel_pos_conversion` confirma que no existe una venta remota.

Una reserva vigente no se cancela, porque todavía puede existir un checkout activo. Una reserva de otro dispositivo tampoco se libera.

## Seguridad

- No cambia precios ni totales.
- No modifica el snapshot financiero.
- No libera reservas de otros dispositivos.
- No confía únicamente en el estado local.
- La cancelación remota conserva la comprobación transaccional contra `pos_sales`.
- Sin migraciones ni escrituras directas en Supabase.

## Pruebas añadidas

- estado local restaurado en `idle` + reserva remota vencida y propia => recuperación y liberación;
- reserva remota vigente => no se cancela;
- reserva de otro dispositivo => no se cancela.
