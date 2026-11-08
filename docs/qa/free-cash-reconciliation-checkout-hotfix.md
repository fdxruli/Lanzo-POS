# Guía de QA Production — conciliación de efectivo Free y confirmaciones de venta

Esta guía se ejecuta después de que el hotfix haya sido revisado, fusionado y desplegado con autorización. El código de esta rama no cambia Production ni realiza escrituras en Supabase.

## Alcance

Verificar en una cuenta Free/Local que una venta pagada en efectivo se atribuya a la sesión de Caja que la recibió, aunque la orden se haya creado antes de abrir esa sesión. Confirmar también que el POS muestra una sola notificación al cobrar y que un resultado de cobro incierto indica revisar Historial sin afirmar éxito ni pedir repetir el cobro.

No ejecutar esta guía con clientes, efectivo real en disputa ni una caja activa de operación. Usar una cuenta local de prueba y un producto de prueba de precio fijo. Registrar la hora, navegador, versión desplegada y capturas de Caja, Historial y cierre. No borrar datos de Production como limpieza.

## Preparación segura

1. En Android y en desktop, iniciar sesión con una cuenta Free/Local de prueba y verificar que la interfaz indica que se trabaja en modo local.
2. Elegir una caja de prueba sin una sesión abierta. Confirmar que no haya otra prueba o cierre en curso.
3. Usar un producto de prueba con existencia suficiente y precio de **$20.00**. No habilitar pagos a crédito, mezclas de pago ni integraciones cloud.
4. Mantener una segunda pestaña de **Ventas → Historial** disponible para lectura. No iniciar un segundo cobro mientras el primero esté pendiente.
5. Para la pasada offline, cargar la app antes de desconectar Internet. No cambiar de perfil ni limpiar almacenamiento local durante la prueba.

## Caso 1: orden creada antes de abrir Caja

1. Con Caja cerrada, agregar una unidad del producto de prueba y guardar la orden abierta. No cobrarla aún.
2. Abrir Caja con fondo inicial de **$100.00**.
3. Volver a la orden guardada antes de abrir Caja. Cobrar una unidad como **efectivo exacto de $20.00** y esperar a que termine el flujo.
4. Crear otra orden nueva después de abrir Caja y cobrar una unidad de **$20.00 en efectivo**.
5. Consultar el resumen de la sesión abierta.

**Resultado esperado:** el efectivo teórico es **$140.00**: $100.00 de fondo más $40.00 de las dos ventas. Las ventas contadas en efectivo muestran $40.00. La primera orden conserva su historial normal; no se crea un movimiento manual adicional por el mismo cobro.

6. En Caja, capturar **$140.00** como efectivo físico y confirmar el cierre una sola vez.
7. Abrir el detalle del cierre y consultar Historial.

**Resultado esperado:** efectivo teórico $140.00, efectivo contado $140.00 y diferencia $0.00. Hay una sola venta por cada orden y un solo cierre. Reabrir el detalle no debe cambiar el importe cerrado.

## Caso 2: sesión nueva y ventas de sesiones anteriores

1. En la misma caja de prueba, abrir una sesión nueva con fondo inicial de **$100.00** y sin ventas.
2. Consultar el efectivo teórico y el detalle del cierre anterior.

**Resultado esperado:** la sesión nueva muestra $100.00; no suma las ventas ni los movimientos de la sesión cerrada. El detalle y los totales cerrados de la sesión anterior siguen en $140.00.

No completar un segundo cierre si la pantalla ya indica que la sesión quedó cerrada. Si el estado no es claro, detener la prueba y revisar Historial antes de volver a tocar Caja.

## Caso 3: notificación de venta y error

1. En una sesión de prueba abierta, cobrar una venta en efectivo y esperar a que se cierre el formulario de pago.
2. Observar la notificación global en la parte superior de la pantalla y contar las filas nuevas de Historial.

**Resultado esperado:** aparece una sola confirmación de venta, no aparece un error para el mismo cobro y existe una sola fila de venta en Historial. El importe del resumen de Caja aumenta solo por el efectivo aplicado a esa venta.

3. Si existe en la cuenta de prueba un escenario de rechazo previo a guardar (por ejemplo, un artículo de prueba sin disponibilidad y sin aceptar la venta de todos modos), ejecutarlo una vez.

**Resultado esperado:** se muestra el motivo del rechazo en una sola notificación y no se agrega una venta ni efectivo a Caja. No crear deliberadamente un fallo de red durante un cobro real en Production.

## Caso 4: aviso de resultado incierto

No provocar una desconexión o cierre de navegador durante una venta en Production. Si el aviso aparece de forma natural:

1. Leer el aviso: debe indicar que el resultado sigue pendiente, revisar **Ventas → Historial** y no repetir el cobro.
2. No volver a pulsar cobrar. Consultar Historial y el estado de la orden una sola vez.
3. Si la venta aparece, verificar que exista una sola fila y que el importe de Caja la incluya una sola vez. Si no aparece o el estado no es concluyente, detenerse y escalar la revisión.

**Resultado esperado:** no se presenta un aviso de éxito para el intento incierto, no se invita a reintentar y el bloqueo de checkout no se libera como si el intento hubiera fallado. Si el estado incierto no aparece naturalmente, anotar que este caso quedó verificado por pruebas automatizadas, no por QA manual de Production.

## Pasada offline de Free

Después de iniciar sesión y cargar la app, desconectar Internet y repetir los casos 1 y 2 en una cuenta local de QA aislada. Confirmar que la venta, Caja y cierre siguen disponibles y que los resultados coinciden. Al reconectar, no ejecutar cobros de nuevo; comprobar que la interfaz no haya creado filas duplicadas durante la recuperación local.

## Matriz de dispositivos y accesibilidad

Repetir los casos 1 y 3 en Android y desktop. Revisar en tema claro y oscuro, confirmar que la notificación se distingue del fondo, no queda debajo de modales o controles, no tapa el botón principal de Caja y desaparece según su duración normal. En desktop, completar cobro y cierre usando teclado; comprobar que foco, etiquetas y botones siguen siendo utilizables.

## Registro y criterio de parada

Registrar por cada pasada: dispositivo y tamaño de pantalla, modo Free/Local, conectividad, hora, valores esperado/observado, folios de prueba y capturas. Detenerse ante una diferencia financiera, una venta duplicada, dos avisos para un cobro, ausencia de historial o estado de cierre ambiguo. No corregir importes mediante movimientos manuales para hacer coincidir el resultado de la prueba; conservar evidencia y escalar.
