# Caja: conciliación financiera Free y PRO

## Estado de entrega

- **Código:** cambios preparados en `fix/caja-financial-reconciliation` para el mismo PR Draft #426.
- **QA automatizado:** 129 pruebas focalizadas aprobadas en 10 archivos: semántica de movimientos, historial/ajustes, cancelación, conciliación, papelera/restauración, ventas, fiado y transacciones Dexie.
- **ESLint:** ESLint directo sobre archivos modificados aprobó con cero errores y tres avisos preexistentes de `console` en `customerCreditRepository.js`. `npm run lint` global falla con 151 errores y 161 avisos del repositorio; no se introdujeron errores en archivos modificados.
- **Compilación:** `npm run build` aprobó. Vite reporta avisos de Rollup/PWA ya presentes (imports/chunks y patrones de precache no coincidentes), sin bloquear el build.
- **CI de GitHub:** pendiente del HEAD definitivo; no se declara aprobado hasta que terminen sus checks.
- **Vercel Preview:** el Preview se comprobará contra el HEAD definitivo. No se hará despliegue manual.
- **QA manual Free y PRO:** pendiente.
- **Production:** solo se hicieron lecturas para preparar la guía PRO. No se ejecutaron ventas, abonos, devoluciones, cierres, migraciones ni otras escrituras.

## Cambios

- La pantalla principal y el cierre local usan la misma conciliación de efectivo. Las ventas fiadas sin anticipo y los pagos con tarjeta/transferencia no aumentan el efectivo; los abonos realmente cobrados en efectivo sí.
- Las cancelaciones Free piden indicar el importe realmente devuelto por efectivo, tarjeta o transferencia. Cancelar no genera un reembolso implícito. Solo la parte devuelta en efectivo crea una salida de caja.
- Cada devolución conserva importe, medio, cobro original asignado, fecha y sesión de caja. La salida de efectivo se registra en la sesión abierta de la estación donde se hace la devolución; el cierre del turno original no se reescribe.
- Venta cancelada y efectos financieros se guardan en una transacción Dexie. Una clave idempotente impide duplicar la salida al reintentar. Los cobros originales de la venta cancelada siguen en su proyección y el reembolso se resta aparte, evitando descontar dos veces el efectivo.
- Los abonos de fiado conservan la venta a la que se asignaron y su medio de pago. Al cancelar, el saldo pendiente se revierte contra el cliente en la misma transacción. El reparador de deudas ignora ventas canceladas.
- Trasladar una cancelación trazable a papelera conserva los cobros para conciliar el turno. Restaurarla la devuelve al historial como cancelada, sin reabrir la venta ni repetir cambios de inventario o dinero. La eliminación permanente de esas cancelaciones se bloquea para conservar auditoría.
- Las ventas históricas sin medio/importes trazables siguen pudiendo cancelarse, pero no se les inventa un reembolso.
- En PRO, la cancelación cloud sigue bajo autoridad del servidor. Esta implementación no agrega una ruta local de reembolso para ventas PRO ni cambia contratos SQL, permisos o migraciones.
- Los movimientos PRO `cancelacion_venta` y `cancelacion_abono_inicial` se presentan de acuerdo con su efecto en efectivo y aparecen en el filtro de salidas. Movimientos informativos y cobros no monetarios no se muestran como entradas de efectivo.
- El historial de cierres solo marca cuadrada una diferencia de cero; una diferencia de $0.01 o $0.50 se identifica como sobrante/faltante. El conteo sin diferencia se confirma como conteo, sin guardar una nota que no se persiste.

## Prueba financiera de aceptación

| Operación | Efectivo esperado |
| --- | ---: |
| Fondo inicial | $100.00 |
| Venta en efectivo de $20 | $120.00 |
| Venta fiada de $20 sin anticipo | $120.00 |
| Abono en efectivo de $10 | $130.00 |
| Venta con tarjeta de $30 | $130.00 |
| Retiro de efectivo de $15 | $115.00 |
| Cancelar la primera venta y devolver realmente $20 en efectivo | $95.00 |
| Contar $94.50 | Faltante de $0.50; no está cuadrada |

La conciliación conserva la entrada original de $20 y registra una salida aparte por la devolución de $20. Efecto neto de ambas operaciones: $0.

## Guía detallada de QA manual

### Free / Local

Realizar en un perfil Free/local de prueba con datos descartables. Estos pasos no escriben en Supabase.

1. Abrir un turno con fondo de $100 y ejecutar el caso de aceptación en el orden de la tabla. Revisar la cifra después de cada operación tanto en la pantalla Caja como en el detalle de cierre. Antes del conteo debe mostrar $95; al contar $94.50 debe registrar faltante de $0.50.
2. **Cancelar sin devolver dinero:** en un turno nuevo con fondo de $100, hacer una venta en efectivo de $20 y cancelarla dejando los tres importes de devolución en cero. El efectivo esperado debe permanecer en $120. Revisar que no exista salida de caja.
3. **Devolución completa:** hacer otra venta en efectivo de $20 y cancelarla indicando $20 de devolución en efectivo. El esperado debe volver a $100 y debe existir una salida por $20, una sola vez.
4. **Devolución parcial válida:** hacer una venta en efectivo de $20, cancelarla y devolver $5.50. El esperado debe quedar en $114.50. Confirmar que el registro conserve $5.50 y que no haya una salida por los $20 completos.
5. **Pago mixto:** vender $40 con $20 en efectivo y $20 con tarjeta. El efectivo debe pasar de $100 a $120. Al cancelar y devolver $5 en efectivo y $20 a tarjeta, el efectivo queda en $115; el reembolso de tarjeta no cambia el efectivo físico.
6. **Fiado y abonos:** crear una venta fiada de $20 sin anticipo (sin cambio de caja), recibir un abono de $10 en efectivo (aumento de $10) y cancelar. Si se devuelven realmente los $10 cobrados en efectivo, el turno vuelve a su cifra anterior al abono; el saldo pendiente se elimina y la deuda total del cliente vuelve a su importe previo a la venta. Repetir con un abono no monetario: no debe generar salida de caja.
7. **Turno posterior:** en el turno A vender $20 en efectivo y cerrar con esperado $120. En el turno B abrir con fondo $100, cancelar la venta A y devolver $20 en efectivo. El turno B debe reflejar $80; el cierre A debe seguir en $120.
8. **Papelera/restauración:** mover a papelera una cancelación que tenga reembolso, comprobar que el turno mantiene cobro y devolución, restaurarla y verificar que sigue cancelada con los mismos totales y sin duplicados. La eliminación permanente de una cancelación con información financiera debe rechazarse.
9. **Apartados e históricos:** registrar y completar un apartado con anticipo en efectivo y verificar que el efectivo entra una sola vez. Revisar registros legacy sin `cash_session_id`; las filas históricas sin medio/importes conocidos no deben mostrar importes de devolución inferidos.
10. **Precisión y ajustes:** comparar $94.50 con esperado $95.00 y confirmar faltante de $0.50. Repetir con sobrante y faltante de $0.01, y con diferencia cero. Con diferencia cero, el flujo debe confirmar el conteo sin ofrecer guardar una nota no persistida; para diferencia real, pedir comentario y registrar el ajuste correcto.
11. Probar permisos Staff/Admin, varios turnos y estaciones, sincronización, reconexión offline, actualización/cierre concurrente y reintentos de una operación con respuesta ambigua. Verificar que los permisos actuales se mantienen, el turno cerrado no cambia y cada efecto aparece una vez.

### PRO / Nube — plan preparado, aún sin autorización de escritura

La verificación de Production fue **solo lectura** en Supabase `odlrhijtfyavryeqivaa`. El Preview debe apuntar al proyecto Productivo correcto, pero usarlo para QA sí escribiría en Production. No se ejecutará ningún paso de esta lista hasta recibir autorización explícita.

Destino observado en la consulta de solo lectura:

- Negocio/licencia: **QA LANZO NUBE V2**, UUID `292b87b5-6326-4257-8197-41a857d5cd86`.
- Artículo de prueba: **PRODUCTO QA**, `$20`, sin control de existencias. Usar solo este artículo; no crear ni modificar productos.
- Cliente para Fiado: **CLIENTE QA NOTAS 002**, con saldo preexistente de `$20`. Registrar ese saldo inicial y exigir que quede igual al final.
- Una estación tenía una caja abierta (UUID de estación `cash_station_device_276c39e9-502f-456a-bbb6-5468b7262a1f`, esperado `$50`): **no utilizarla ni cerrarla**.
- La segunda estación activa, `cash_station_device_1ca346a2-9bf3-4ce7-a0d3-34140ecdfa8a`, no tenía turno abierto en la consulta. Antes de cualquier prueba autorizada, volver a leer el estado; si cambió, detenerse y no tocar la caja ajena.

Operaciones propuestas, cada escenario en un turno nuevo de la segunda estación, con apertura de `$100` y cierre al terminar:

1. **Cancelación sin devolución:** venta de una unidad por `$20` con tarjeta; cancelar sin devolver físicamente dinero. Verificar que no aparezca salida de efectivo y que el servidor mantenga su estado autoritativo.
2. **Devolución completa en efectivo:** venta de `$20` en efectivo, cancelación y entrega real de `$20`. El esperado debe regresar a `$100`; revisar en la respuesta del servidor que cobro y devolución estén vinculados y no se duplique ninguno.
3. **Pago mixto:** dos unidades (`$40`), `$20` en efectivo y `$20` en tarjeta. Verificar que la venta aumente efectivo solo `$20`; en cancelación devolver cada medio según lo realmente entregado y comprobar que solo la parte en efectivo cambie el esperado.
4. **Fiado con abono posterior:** crear Fiado por `$20` sin anticipo al cliente de QA; recibir `$10` en efectivo como abono. Cancelar en el mismo turno y devolver realmente `$10` en efectivo. El esperado debe terminar en `$100`, el adeudo creado por esta venta debe desaparecer y el saldo del cliente debe regresar a los `$20` iniciales. No continuar si el endpoint de cancelación no ofrece una forma autoritativa de registrar el reembolso real.
5. **Atribución entre turnos:** en un turno A vender `$20` en efectivo y cerrar; en un turno B independiente cancelar esa venta y devolver `$20`. Confirmar que el cierre A no se modifica y que la devolución afecta solo al turno B. Si el flujo servidor no soporta esta operación de forma segura, detener esa prueba y reportar el límite.
6. **Roles y concurrencia:** repetir lecturas y las operaciones no financieras permitidas con Admin/Staff y dos estaciones. Revisar permisos, conflictos de sesión, respuesta ambigua, sincronización e idempotencia a partir de las respuestas del servidor. No repetir un envío con una clave distinta.

Registrar por operación rol, estación, estado de red, identificadores de venta/turno/movimiento, importe, medio, saldo inicial/final del cliente y resultado autoritativo. Las consultas anteriores solo establecen el destino propuesto; deben volver a verificarse antes de una futura prueba autorizada.

## Límite de QA

El código local Free y las pruebas automatizadas no escriben en Production. QA real de PRO contra el negocio `QA LANZO NUBE V2` sigue pendiente de autorización separada para las operaciones exactas descritas arriba. No se declara PASS de QA manual, Preview o CI hasta comprobar el HEAD final.
