# Caja: conciliación financiera Free y PRO

## Estado de entrega

- **Código:** implementado en la rama `fix/caja-financial-reconciliation`.
- **QA automatizado:** 138 pruebas focalizadas aprobadas; ESLint de los archivos modificados aprobado.
- **Compilación:** `npm run build` aprobado. Vite mostró avisos no bloqueantes de Rollup y patrones de precache que no encuentran archivos.
- **CI de GitHub:** la suite global del PR terminó con éxito; el job sigue comparando contra `main`. Consulta los checks del PR #426 para el estado más reciente.
- **Vercel Preview:** el Preview del PR está READY en `lanzo-pos` (`prj_tE5uWn6kLBYdS1eDFWVxRm449RUr`), conectado a `fdxruli/Lanzo-POS`. GET `/` respondió HTTP 200 y sirvió la app shell. No se hizo despliegue manual.
- **QA manual Free y PRO:** pendiente.
- **Production:** sin cambios. No se hicieron escrituras, migraciones ni modificaciones de datos en Supabase Production.

## Bloqueo pendiente para cancelaciones Free

El flujo Free de `cancelSaleCore` cambia el estado de la venta a `cancelled`, pero no captura ni persiste el medio o importe realmente devuelto. La proyección local deja de contar la venta cancelada; por eso no puede distinguir una devolución real en efectivo de una cancelación sin devolución. El flujo de cancelación cloud PRO sí usa movimientos y agregados financieros del servidor.

La solución mínima para garantizar esa distinción también en Free es ampliar el contrato local de cancelación para capturar el importe y medio devuelto, guardar una reversa local idempotente y proyectarla en Caja; debe cubrir además cancelaciones mixtas y abonos posteriores. Eso toca el modal, servicio de cancelación y modelos financieros. Se detuvo esa ampliación para mantener este cambio pequeño y no inferir una devolución física a partir del estado `cancelled`. El QA manual de cancelaciones Free queda pendiente hasta resolver ese contrato.

## Cambios

- La pantalla principal y el cierre local calculan el efectivo esperado mediante la misma conciliación. La conciliación usa pagos de venta en efectivo, movimientos de caja y vínculos de pagos de apartados para evitar contar dos veces abonos o anticipos.
- Las ventas fiadas sin abono y las ventas con tarjeta o transferencia no se suman al efectivo físico. Los abonos en efectivo sí se suman.
- Los movimientos PRO `cancelacion_venta` y `cancelacion_abono_inicial` se muestran como devoluciones de efectivo y se incluyen en el filtro de salidas. Los medios no monetarios y los registros informativos no se presentan como entradas o salidas de efectivo.
- La historia de cierres reconoce como cuadrada únicamente una diferencia de cero. Los importes negativos se muestran con el signo antes del símbolo monetario.
- Un conteo sin diferencia se confirma como conteo, sin ofrecer guardar un comentario que el flujo no persiste. El comentario sigue siendo obligatorio para registrar un ajuste real.
- No se cambiaron contratos del servidor, SQL, migraciones, permisos ni el protocolo de idempotencia de PRO.

## Caso financiero de aceptación

| Operación | Efectivo esperado |
| --- | ---: |
| Fondo inicial | $100.00 |
| Venta en efectivo de $20 | $120.00 |
| Venta fiada de $20 sin anticipo | $120.00 |
| Abono en efectivo de $10 | $130.00 |
| Venta con tarjeta de $30 | $130.00 |
| Retiro de efectivo de $15 | $115.00 |
| Cancelación con devolución en efectivo de $20 | $95.00 |
| Conteo físico de $94.50 | Diferencia de -$0.50 (faltante) |

## Guía de QA manual

Ejecutar en Vercel Preview y en un negocio de prueba autorizado. No usar una sesión conectada a datos de negocio de Production para crear ventas, abonos, apartados, movimientos, ajustes ni cierres. El QA de esos recorridos requiere un tenant de prueba aislado o autorización explícita para escribir en los datos de Production.

### Free / Local

1. Abrir una caja con fondo de $100 y repetir el caso financiero de aceptación en el orden de la tabla. Verificar el efectivo teórico después de cada paso y confirmar que tanto la pantalla principal como el cierre muestran $95 antes del conteo. La cancelación con devolución real requiere resolver primero el bloqueo descrito arriba.
2. Registrar la venta fiada de $20 sin anticipo. Confirmar que no aumenta el efectivo. Después registrar el abono en efectivo de $10 y confirmar que aumenta una sola vez.
3. Crear una venta mixta de $50 (por ejemplo, $20 efectivo y $30 tarjeta). Verificar que el efectivo aumenta solo $20.
4. Registrar un anticipo de apartado en efectivo y luego completar el apartado. Confirmar que el movimiento vinculado entra una sola vez, también tras sincronizar/reabrir la pantalla.
5. Registrar una salida de efectivo y revisar que el efectivo teórico, el filtro de salidas y el cierre coincidan.
6. Contar $94.50 frente a $95.00. Confirmar que el cierre y el historial muestran faltante de $0.50. Repetir con sobrante de $0.01, faltante de $0.01 y diferencia cero.
7. Probar el modal de ajuste: con diferencia cero debe decir “Confirmar conteo” e informar que el comentario no se guarda; con una diferencia real debe requerir comentario y registrar el movimiento por el importe de la diferencia.
8. Repetir el cierre con la aplicación offline y reabrir Caja. Verificar que los movimientos locales y el resultado de cierre se conservan y que reintentar el mismo cierre no lo duplica.
9. Revisar movimientos históricos legacy sin `cash_session_id`, apartados anteriores y cambios de turno para detectar diferencias entre la tarjeta principal, el detalle y el cierre.

### PRO / Nube

1. En una sesión de prueba Admin y otra Staff, revisar los permisos para abrir, ajustar, revisar y cerrar caja conforme a las reglas vigentes. Confirmar que los totales visibles vienen de los agregados autoritativos del servidor.
2. Repetir ventas en efectivo, fiadas sin anticipo, abonos en efectivo, tarjeta/transferencia, pagos mixtos y retiro. Confirmar que cada medio afecta solo el efectivo correspondiente.
3. Cancelar una venta en efectivo con devolución y una venta sin efectivo. Solo la primera debe generar una salida de efectivo. Si se cancela una venta fiada con abono inicial, verificar por separado la devolución de ese abono.
4. Probar la misma caja desde varias estaciones: actualizar dos sesiones concurrentes, cerrar desde una y comprobar que la otra recibe el conflicto/estado actualizado sin pisar el cierre.
5. Reintentar una operación de apertura, ajuste, sincronización o cierre cuya respuesta sea ambigua. Verificar idempotencia y que no aparezcan movimientos duplicados; no volver a enviar una operación financiera con una clave distinta para simular un reintento.
6. Simular pérdida y recuperación de red durante una lectura y durante un envío. Confirmar que los mensajes distinguen una operación confirmada de una pendiente/ambigua y que la interfaz no inventa un total local cuando la respuesta autoritativa falta.
7. Comparar el resumen principal, el cierre y el historial; revisar el filtro “Salidas de efectivo” para `cancelacion_venta` y `cancelacion_abono_inicial`, y el filtro “Sin movimiento de efectivo” para ventas con tarjeta y registros informativos.

Registrar para cada paso el rol, estación, estado de red, importe mostrado y resultado del servidor. Marcarlo como aprobado solo después de observar el resultado en Preview con un tenant permitido.
