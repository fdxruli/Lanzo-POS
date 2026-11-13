# QA manual final — Apartados Apparel Free/PRO

**Estado:** pendiente. El propietario reservó la validación comercial completa para el cierre final en Supabase Production. No ejecutar este recorrido durante la preparación del PR.

Durante la implementación se permite QA automatizado y consultas de solo lectura. No instalar SQL, crear datos comerciales de prueba, ni modificar inventario, Caja o apartados en Production antes de la ventana de QA final.

## Preparación

- Usar un cliente de prueba autorizado por el propietario y un Admin de Apparel.
- Preparar un producto con inventario controlado. Registrar stock físico, unidades comprometidas y disponibilidad antes de cada recorrido.
- Para PRO, confirmar que el tenant y el producto estén sincronizados con Cloud; probar con la variante o lote que se vaya a entregar.
- Abrir Caja para los recorridos de reembolso y confirmar el saldo inicial.
- Registrar el folio de cada apartado, los movimientos de Caja esperados y el conteo inicial de ventas.

## Recorrido

1. En Free/Local, crear un apartado del producto con inventario y registrar abonos hasta liquidarlo. Confirmar que los abonos queden registrados una sola vez y que la reserva reduzca la disponibilidad.
2. Entregar el apartado desde la ficha del cliente. Confirmar estado completado, una venta histórica ligada al apartado, folio visible y descuento físico de las unidades entregadas. Verificar que la entrega no añada otro cobro a Caja.
3. Reabrir el historial y actualizar la ficha. Confirmar que la venta y el folio sigan únicos, que el apartado sea de solo lectura y que no haya acciones de abono, entrega o cancelación.
4. Repetir los pasos 1–3 en PRO/Cloud. Confirmar el estado, folio, venta e inventario devueltos por Cloud. Si la respuesta de entrega queda incierta, actualizar el historial antes de reintentar; comprobar que el reintento recupera el resultado sin otra venta ni otro descuento.
5. Crear un apartado activo sin pagos y cancelarlo. Confirmar estado cancelado, reserva liberada, stock físico sin incremento y ningún movimiento de Caja.
6. Crear un apartado con abonos y elegir **Reembolsar al cliente**. Confirmar una sola salida de Caja por el total abonado, referencia del reembolso en el historial y liberación de la reserva.
7. Crear otro apartado con abonos y elegir **Retener el dinero**. Confirmar estado cancelado, importe retenido y trazabilidad en el historial, sin salida de Caja adicional.
8. En otro apartado con pagos, abrir la decisión de fondos y pulsar **Volver sin cancelar**. Confirmar que estado, Caja e inventario no cambien. Repetir cerrando o descartando el diálogo si el entorno permite esa acción; el resultado debe ser el mismo.
9. Ingresar como Staff sin permiso `refunds`. Confirmar que la interfaz no ofrezca cancelar/reembolsar apartados y que el historial siga de solo lectura. La suite automatizada comprueba además que una invocación directa sin esa autoridad sea rechazada.
10. Actualizar los apartados completados y cancelados e intentar repetir las acciones terminales que la interfaz ofrezca. Confirmar que no se creen ventas, reembolsos ni liberaciones duplicadas. Verificar también un apartado vencido: no admite abonos nuevos y conserva su reserva hasta una cancelación autorizada.

## Evidencia para cerrar QA

- Capturas del historial de cada resultado y su folio o referencia financiera.
- Conteos antes/después de stock físico, reservas y ventas.
- Movimientos de Caja antes/después para reembolso, retención y cancelación sin pagos.
- Resultado del reintento Cloud y confirmación de que no duplicó venta ni inventario.
- Identidad y permiso usados en la comprobación de Staff.

Marcar este recorrido aprobado únicamente cuando se ejecute en la ventana final de Production y se revise toda la evidencia.
