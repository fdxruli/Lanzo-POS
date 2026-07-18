# Reconciliacion de movimientos legacy de apartados

El hotfix no vuelve a registrar pagos historicos que no tengan `cashMovementId`.
Para obtener un reporte de solo lectura:

```js
const report = await layawayRepo.getLegacyPaymentsForReconciliation();
```

Cada fila incluye apartado, pago, monto, fecha, tipo, cliente y la sesion candidata
(`cajaId`) cuando existe. El resultado se debe revisar contra los movimientos de Caja
de la fecha y la sesion original antes de asignar cualquier movimiento.

El anticipo historico del incidente ($75) debe aparecer como `needs_reconciliation`.
No debe crearse un nuevo ingreso ni asignarse automaticamente a la Caja abierta actual.
La reparacion, si procede, requiere una accion administrativa explicita, una sesion
cerrada candidata confirmada y una comprobacion previa de que no existe ya un ingreso
equivalente.
