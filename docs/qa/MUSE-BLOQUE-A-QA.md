# Guía QA de Muse — Bloque A

Esta guía está pensada para BOUTIQUE MUSE QA o un negocio desechable expresamente autorizado. No ejecutar escrituras en Production ni usar las ventas, apartados, cierres o existencias históricas de Muse como datos de prueba. Si no hay un negocio aislado, limitarse a las verificaciones de navegación y presentación.

Conservar capturas con fecha, negocio/tenant visible, actor y plan. Para una operación, anotar folio, resultado y pantalla final. No compartir datos personales o credenciales.

## 1. Caja y apartados — APP-BUG-012 y APP-BUG-019

### Apartado totalmente pagado

- **Condición inicial:** negocio de QA aislado, Admin autorizado, caja abierta y producto de prueba. Crear un apartado por **$899** con anticipo **$200**, luego abono **$300** y abono **$399**. Confirmar saldo **$0**.
- **Acciones:** entregar el apartado una sola vez; después volver a consultar Caja, la venta vinculada y el apartado.
- **Resultado esperado:** existe una venta vinculada de **$899**; la entrega no agrega otro cobro de $899, no aumenta efectivo y no registra tarjeta/transferencia ficticia. Reintentar la consulta no duplica venta ni movimientos.
- **Observar:** folio del apartado y de venta, pagos originales, total de caja por medio de pago y estado final.
- **Evidencia:** capturas del saldo $0 antes de entregar, vínculo venta-apartado y movimientos después de entregar. Probar Free/Local y, si hay un negocio PRO de QA autorizado, PRO/Nube por separado.

### Primera apertura y turno posterior

- **Condición inicial:** negocio de QA sin cierre anterior.
- **Acciones:** abrir el primer turno con fondo físico contado de **$1,000**; registrar la referencia y diferencia mostradas. En un segundo turno controlado, cerrar con **$500** y abrir el siguiente contando **$500**.
- **Resultado esperado:** primera apertura: referencia **$0** y diferencia **$1,000** identificada como diferencia contra referencia inexistente/cero, no como pérdida de efectivo. Turno posterior: referencia **$500**, fondo contado **$500**, diferencia **$0**. No reabrir ni modificar cierres históricos.
- **Observar:** fondo sugerido, referencia, conteo, diferencia y texto que explique el primer turno.
- **Evidencia:** capturas de ambas aperturas y del cierre intermedio. Si la interfaz presenta los $1,000 como faltante/sobrante o la segunda referencia no coincide, anotar los valores sin editar la caja.

## 2. Permisos, productos y selección de lotes — APP-BUG-004, 005, 014 y 009

- **Condición inicial:** cuenta Admin y cuenta Staff de prueba en el mismo tenant QA; productos y venta de prueba. No cambiar roles de usuarios productivos.
- **Acciones:** Admin abre Productos y usa el botón **Categorías**; Admin inicia cancelación de una venta de prueba. Staff sin permiso intenta abrir Productos/Categorías y cancelar. En un actor desechable, comprobar cambio Admin → Staff, cierre de sesión y cambio de tenant. Durante restauración de sesión, esperar a que termine la verificación antes de operar.
- **Resultado esperado:** Admin autorizado entra a Categorías por el botón; Staff y actor revocado siguen bloqueados. Mientras la sesión se confirma, se muestra estado de verificación y no se habilita contenido protegido. Cambio de actor/tenant invalida permisos anteriores. La venta de prueba solo se cancela si el actor conserva permiso al confirmar.
- **Lotes:** para una camisa con gestión estricta de lote y variante válida, provocar una lectura transitoria solo en un entorno de prueba controlado. El primer intento debe fallar cerrado y no añadir la camisa; después de recuperar la lectura, volver a seleccionar y confirmar que se usa exactamente el lote/variante vigente. Probar por separado lote archivado, stock insuficiente e identidad ambigua; todos deben bloquear la venta.
- **Observar:** actor, tenant, estado de restauración, texto del error, contenido del carrito, `batchId`/SKU/talla y cantidad.
- **Evidencia:** capturas antes y después de restaurar, respuesta bloqueada de Staff/revocación, carrito sin la selección fallida y lote exacto del reintento. Repetir la autoridad Local y Cloud únicamente en negocios QA autorizados; mocks no demuestran persistencia Cloud.

## 3. Ventas, fechas y estadísticas — APP-BUG-015 y 016

### Hora de confirmación

- **Condición inicial:** venta de prueba en un tenant desechable; anotar hora local y zona horaria del negocio.
- **Acciones:** abrir un borrador, esperar unos minutos y confirmarlo; registrar la hora exacta de pulsar confirmar. Revisar historial, sesión de Caja, comprobante y reportes.
- **Resultado esperado objetivo:** el historial debe identificar claramente la hora de confirmación, conservar el orden cronológico y la sesión correcta; el timestamp enviado/reintentado debe ser estable y no duplicar la venta.
- **Estado de esta rama:** queda pendiente. El contrato actual conserva el timestamp durable del borrador para identificar e idempotentizar la venta; la nube valida ese timestamp en el intento financiero. No marcar PASS si el historial muestra la hora de creación del borrador. Registrar hora de borrador, confirmación, persistencia y sincronización para decidir el cambio compatible.
- **Evidencia:** folio/ID de venta, captura del reloj de confirmación, timestamp que presenta cada pantalla, sesión y resultado de un reintento si aplica.

### Métricas de Hoy

- **Condición inicial:** usar las ventas ya existentes del día en el tenant QA; no crear 18 ventas para reproducir el reporte. Anotar zona horaria del negocio y ventas confirmadas, pagos, costos y cancelaciones disponibles.
- **Acciones:** abrir Dashboard → Hoy y comparar Ventas netas, Cobrado, Ganancia bruta, Pedidos, Ticket promedio y Productos vendidos con las operaciones autorizadas del día. Revisar también el límite de día y los filtros de cliente/rubro.
- **Resultado esperado:** cifras disponibles solo cuando el reporte confirma cobertura. Ganancia bruta solo con costos suficientes; cancelaciones siguen el contrato del reporte. Si falla la lectura, debe quedar claro que el reporte no pudo consultarse; no aceptar cifras estimadas ni mezclar Local y Cloud.
- **Observar:** estado de carga/error, fuente (Local/Cloud), rango horario, zona, recuento de ventas, pagos y productos.
- **Evidencia:** captura de Hoy, rango y zona del negocio junto a un listado autorizado de ventas usado para la comparación. El incidente original de 18 ventas permanece no concluyente hasta repetirlo con ese dataset.

## 4. Navegación y folios — APP-BUG-011 y 017

- **Condición inicial:** Admin y Staff de prueba; una venta y un apartado de QA, uno completado y otro activo si el contrato del negocio permite crearlos.
- **Acciones:** abrir `/reportes`; abrir `/apartados`; revisar Clientes y el historial de apartados completados.
- **Resultado esperado:** `/reportes` redirige a `/ventas` y la pantalla aplica sus permisos existentes. `/apartados` lleva a `/clientes` sin 404 y respeta el permiso de Clientes. Un apartado completado muestra el folio persistido de su venta vinculada; debe coincidir exactamente con el folio de esa venta. No aceptar ID interno ni ID truncado como folio comercial.
- **Límite conocido:** el modelo actual no define un folio comercial independiente para todo apartado activo ni una lista global `/apartados`; no dar por resuelta esa parte si el comerciante requiere localizar un apartado sin conocer su cliente.
- **Observar:** URL final, bloqueo según rol, tenant, estado del apartado y folio de la venta vinculada.
- **Evidencia:** capturas de URL antes/después y ficha con folio/estado; repetir como Staff para validar permisos.

## 5. Inventario — APP-BUG-006

- **Condición inicial:** producto variante de QA con **M Negro = 5**, **S Negro = 5**, sin reservas; no usar inventario histórico de Muse.
- **Acción objetivo:** registrar una merma de **1** en M Negro con motivo y consultar historial.
- **Resultado esperado objetivo:** M Negro **5 → 4**, S Negro permanece en **5**, total del producto disminuye **1**, motivo y movimiento quedan vinculados una sola vez, sin afectar reservas.
- **Límite conocido de esta rama:** la merma existente opera sobre el producto padre y el editor de lote permite cambios absolutos; no hay operación demostrada que registre merma/motivo sobre la variante concreta y deje evento trazable. No ejecutar la acción padre como sustituto de la merma por variante. Registrar este recorrido como **bloqueado**, mantener existencias y guardar captura de los controles disponibles.
- **Evidencia:** configuración inicial, controles disponibles e historial. No ajustar el stock a mano para conseguir los valores esperados.

## 6. Registro y zona horaria — APP-BUG-001

- **Condición inicial:** flujo aislado de configuración/registro sin enviar una nueva licencia ni crear negocio Productivo.
- **Acciones:** avanzar hasta Zona horaria. Comprobar que el campo está vacío con el placeholder **“Ejemplo: America/Merida”**; usar el control de zona detectada o escribir `America/Merida` y revisar el valor visible. Probar un identificador IANA inválido sin finalizar el alta.
- **Resultado esperado:** el ejemplo no cuenta como valor seleccionado; la zona válida elegida permanece en el estado y puede validarse sin reescritura. Un valor inválido continúa bloqueado. No enviar el alta final ni crear licencias para este QA.
- **Observar:** valor controlado visible, validación y payload previo al envío solo si la herramienta de QA lo expone de forma segura.
- **Evidencia:** capturas del campo vacío, valor válido seleccionado y rechazo del valor inválido. La prueba automatizada cubre el campo vacío/placeholder.

## 7. Comprobantes y exportación — APP-BUG-018

- **Condición inicial:** historial de ventas de un tenant QA, con una venta autorizada visible en la página actual.
- **Acciones:** exportar CSV de la página y abrir/imprimir el PDF del historial. Revisar si el detalle individual de la venta ofrece reimpresión o descarga de comprobante.
- **Resultado esperado:** la interfaz confirma que se solicitó la descarga CSV; comprobar que el navegador crea el archivo y que incluye únicamente filas filtradas de la página. El PDF corresponde a las filas/periodo seleccionados. Una confirmación de solicitud por sí sola no demuestra que el navegador descargó el archivo.
- **Límite conocido:** no se encontró un generador existente de comprobante individual reimprimible/descargable en Historial; no marcar ese requisito como PASS ni compartir automáticamente con terceros.
- **Observar:** mensaje visible, nombre y contenido del CSV, filas exportadas, ventana de impresión y controles del detalle.
- **Evidencia:** captura del mensaje, CSV descargado sin datos ajenos al tenant y vista previa de impresión. No cancelar ni volver a cobrar la venta para probar el comprobante.

## Resultado de sesión

Registrar por recorrido: **PASA / FALLA / NO EJECUTADO / BLOQUEADO**, build o SHA, plan, tenant de prueba, actor, hora y evidencias. No combinar resultados automatizados con pruebas manuales ni declarar persistencia PRO/Nube a partir de un mock.
