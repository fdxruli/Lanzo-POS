# Guía de QA: arqueo asistido por denominaciones MXN

Esta guía aplica después de que el PR de arqueo asistido haya sido fusionado y el cambio esté disponible en Production. Las pruebas que confirman o cierran una caja deben ejecutarse únicamente en un negocio y turno de prueba autorizados, sin efectivo ni ventas de operación.

## Preparación

1. Anota la versión o SHA desplegado y confirma que corresponde al merge esperado.
2. Prepara una cuenta Free/Local de prueba y un negocio PRO/Nube de prueba con permisos para abrir y cerrar caja. Usa una estación dedicada.
3. Para verificar offline, carga la aplicación Free/Local en línea primero y confirma que la sesión de prueba ya está disponible en el dispositivo. Después desconecta la red del dispositivo; no uses el modo offline para PRO/Nube.
4. Usa una caja de prueba cuyo efectivo esperado sea **$355.50 MXN**. Si necesitas producir el importe, abre un turno de prueba con fondo inicial de $355.50 y no registres movimientos adicionales. Confirma qué política de apertura automática tiene ese negocio.
5. Registra el ID de sesión, el importe esperado inicial y el estado de Caja antes de empezar. No cambies ventas, abonos ni movimientos para fabricar el resultado.

Banco de México enumera billetes de $20, $50, $100, $200, $500 y $1,000, además de monedas de $20, $10, $5, $2, $1, 50, 20, 10 y 5 centavos. La herramienta presenta esas denominaciones y suma cada pieza con precisión decimal; no redondea centavos. Fuente: [billetes y monedas de circulación actual de Banco de México](https://www.banxico.org.mx/banknotes-and-coins/currently-banknotes-and-coins.html).

## Prueba principal

En **Caja → Turno**, abre el cierre normal de la sesión de prueba y selecciona **Conteo por denominaciones**.

| Denominación | Piezas | Subtotal |
| --- | ---: | ---: |
| Billete de $200 | 1 | $200.00 |
| Billete de $100 | 1 | $100.00 |
| Billete de $20 | 2 | $40.00 |
| Moneda de $10 | 1 | $10.00 |
| Moneda de $5 | 1 | $5.00 |
| Moneda de 50 centavos | 1 | $0.50 |
| **Total contado** |  | **$355.50** |

Verifica que:

- El subtotal de billetes sea $340.00, el de monedas sea $15.00 y el de centavos sea $0.50.
- El total contado muestre $355.50 y la diferencia contra el esperado sea $0.00.
- Al borrar la pieza de 50 centavos, el total cambie a $355.00 y muestre faltante de $0.50.
- Al restaurar esa pieza, el total vuelva a $355.50 sin cerrar ni reiniciar el formulario.
- El campo de fondo del siguiente turno continúe obedeciendo sus reglas actuales y no supere el efectivo contado.

Avanza a la revisión de cierre. Confirma que la pantalla de confirmación presenta $355.50 como efectivo físico y diferencia $0.00. Confirma el cierre una sola vez.

## Verificación por modalidad

### Free / Local

1. Completa la prueba principal con la aplicación conectada y confirma el cierre en la caja Free de prueba.
2. Comprueba en Historial que se cerró la sesión esperada y que su diferencia es $0.00.
3. Comprueba que el cierre no creó un movimiento de ajuste de entrada o salida. Si la apertura automática está configurada, valida por separado que solo se haya creado la siguiente sesión esperada por esa política.
4. Repite el recorrido con otro turno de prueba ya cargado en el dispositivo y la red desconectada. El modo asistido debe seguir calculando el mismo importe y usar el cierre local existente.
5. Vuelve a conectar la red y confirma que la sesión cerrada se conserva de acuerdo con la sincronización local ya existente, sin una segunda sesión de cierre.

### PRO / Nube

1. En el turno del propietario, repite la prueba principal en línea. La conexión es necesaria para enviar el cierre.
2. Verifica en Caja e Historial que el servidor cerró la sesión original con $355.50 contado y diferencia $0.00; no vuelvas a pulsar confirmar mientras el resultado se procesa o verifica.
3. Si el usuario autorizado revisa una caja ajena mediante **Revisar y cerrar caja**, selecciona **Conté físicamente esta caja**, usa el conteo asistido, elige un motivo permitido y confirma la revisión antes del cierre.
4. Si el servidor informa que cambiaron los totales mientras revisabas, valida que el importe esperado se actualice, que el desglose de piezas siga editable y que el usuario tenga que revisar y confirmar otra vez.
5. Comprueba que el modo **No existe un conteo físico verificable** mantiene su comportamiento actual y no muestra ni envía un importe contado.

## Compatibilidad y regresiones

- Abre el formulario y verifica que **Total manual** siga seleccionado inicialmente. Captura $355.50 manualmente y confirma que el flujo actual continúa disponible.
- Cambia de manual a asistido y de regreso. Confirma que el campo manual recibe el importe calculado y que el conteo por piezas sigue disponible al volver a asistido.
- Prueba una pieza de 50 centavos y abre **Más centavos (20¢, 10¢ y 5¢)** para contar monedas pequeñas. Los subtotales deben conservar centavos exactos.
- Intenta introducir cantidades negativas o fraccionarias. Deben rechazarse; las cantidades válidas son enteros no negativos.
- En Android, comprueba que el teclado numérico facilita capturar piezas, los campos permanecen visibles al desplazarse y el total no queda oculto tras el teclado.
- En desktop, prueba navegación con Tab y flechas del grupo de opciones, y confirma que cada campo anuncia su denominación y cantidad de piezas.
- Repite en tema claro y oscuro. La diferencia, los subtotales, el foco y las etiquetas deben mantener contraste legible.
- Comprueba los permisos vigentes: un rol que no podía ajustar o cerrar antes debe seguir sin poder hacerlo.
- Cierra y vuelve a abrir otro turno. El conteo nuevo debe iniciar vacío; se conserva el importe que el flujo financiero ya guarda, no el desglose de piezas.

## Resultado que registrar

Anota para cada ejecución: SHA desplegado, Free o PRO, navegador/dispositivo y ancho de pantalla, tema, estado de red, rol, ID de sesión de prueba, importe teórico, importe contado, diferencia, historial final, movimientos observados y cualquier identificador de auditoría. Separa resultados de UI de evidencia de cierre/sincronización.

Detén la prueba si el efectivo teórico cambia inesperadamente, aparece otro cierre para la misma sesión, se crea un movimiento de ajuste no solicitado, el servidor deja la operación en verificación pendiente o los permisos no coinciden con el rol usado. Conserva el ID de sesión y el resultado visible para el análisis; no repitas una operación financiera cuyo resultado siga pendiente.
