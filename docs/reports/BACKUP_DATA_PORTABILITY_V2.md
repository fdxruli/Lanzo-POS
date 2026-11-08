# LANZO POS — Respaldo y portabilidad V2

## Alcance y estado de evidencia

Este documento describe la cobertura implementada en el cliente y el recorrido manual que falta completar en Vercel Preview. Las pruebas automatizadas usan IndexedDB sintética y no certifican la recuperación comercial real.

El respaldo recupera las tablas de negocio incluidas en la lista explícita de `backupScope.js`. No copia colas de sincronización, intenciones financieras pendientes, credenciales del dispositivo ni estado temporal del navegador. Cuando detecta trabajo pendiente o una caja abierta, marca la cobertura como parcial y lo muestra durante la revisión del archivo.

La restauración comprueba el PIN, la integridad autenticada del archivo, la identidad de la licencia, el nombre de la base, las tablas requeridas y el estado actual del destino. Prepara el archivo en una base temporal y reemplaza las tablas aprobadas en una transacción del negocio. La transacción evita que un fallo de escritura deje la base destino a medias. La restauración conserva identificadores y referencias tal como aparecen en el archivo; no ejecuta una validación general de relaciones contables ni reconcilia saldos contra Cloud.

## Matriz de cobertura

| Datos y ubicación | Recuperación `.lzbk` | Exportación portable | Transferencia a otro negocio | Reglas y límites |
|---|---|---|---|---|
| Catálogo: `menu`, `categories` | Incluidos, con sus IDs y relaciones. | JSON seleccionable; CSV por tabla. | Productos y categorías se mapean a IDs destino; conflictos visibles. | Se conservan precios y atributos comerciales. |
| Variantes: filas de `product_batches` con `attributes`, SKU y precio | Incluidos como lotes completos. | JSON seleccionable; CSV de lotes. | El paquete de catálogo conserva talla, color, SKU y precio compatibles; crea variantes con existencias cero. | No se transfieren cantidades, costo, fecha de caducidad ni lotes de origen. |
| Ingredientes y recetas: `ingredients`, recetas/modificadores en `menu` | Incluidos. | JSON y CSV seleccionable. | Ingredientes y referencias compatibles se reasignan; referencias inválidas producen conflicto o se omiten. | No se copian existencias ni costos de ingredientes. |
| Imágenes: `images` y campos de producto | Incluidas, incluidos blobs. | JSON; los blobs se codifican en Base64. | Se reasignan IDs de imagen; el paquete puede crecer mucho. | No se exportan credenciales embebidas; archivos de transferencia limitados a 64 MiB al importar. |
| Lotes, existencias y costos: `product_batches` | Incluidos con cantidades, costos, caducidad, estado y relaciones. | JSON y CSV seleccionable. | No se importan como inventario histórico. | Inventario inicial desde CSV de productos usa el repositorio vigente para crear producto y lote de forma atómica; repetir un CSV reconocido no vuelve a añadir existencias. |
| Clientes: `customers` | Incluidos con sus datos guardados. | JSON y CSV seleccionable. | Solo datos maestros compatibles, como nombre, teléfono y dirección; saldos se fijan en cero. | El JSON/CSV de consulta no está cifrado y puede contener datos personales. |
| Fiados y abonos: `customer_ledger` y filas de clientes | Incluidos tal como están almacenados. | JSON y CSV seleccionable. | No se importan. | Se conservan movimientos e importes originales, sin recalcular ni verificar el saldo contra el historial. |
| Ventas, partidas, pagos y cancelaciones: `sales`, `deleted_sales` | Incluidos con IDs, fechas, detalles y referencias. | JSON y CSV seleccionable. | No se importan entre licencias. | El archivo no genera nuevas ventas ni las vuelve a enviar a Cloud. |
| Apartados y pagos: `layaways` | Incluidos con estado y referencias originales. | JSON y CSV seleccionable. | No se importan. | Comparar saldo y estado en QA con el negocio origen. |
| Cajas y movimientos: `cajas`, `movimientos_caja` | Incluidos; IDs y relaciones se conservan. | JSON y CSV seleccionable. | No se importan. | Se eliminan IDs y huellas crudas del dispositivo. Las claves locales de estación se sustituyen por valores aleatorios coherentes dentro del archivo; una caja abierta conserva su estado, el archivo queda marcado parcial y la sesión no se reasigna a la estación nueva. |
| Mermas y movimientos de inventario: `waste_logs`, `inventory_events` | Incluidos. | JSON y CSV seleccionable. | No se importan como movimientos del nuevo negocio. | Las referencias originales se preservan; no se reconstruyen lotes ni existencias durante una transferencia de catálogo. |
| Papelera: `deleted_menu`, `deleted_customers`, `deleted_categories` | Incluidos. | JSON y CSV seleccionable. | No se importan. | Mantienen historial de borrado para recuperación del mismo negocio. |
| Folios: `sequences` | Solo `id === "sale_folio"`. | Solo esa secuencia se exporta. | No se importa. | Evita llevar contadores técnicos ajenos al flujo comercial. |
| Estadísticas derivadas: `global_stats`, `daily_stats` | Excluidas. | No forman parte de las categorías portables. | No se importan. | Se recalculan desde las operaciones existentes cuando el producto lo permita. |
| Configuración/perfil: `company`, `theme`, `sync_cache`, `sync_meta`, `processed_sales_log`, `corrupted_states`, tablas de recuperación y binding local | Excluidos. | Excluidos. | Excluidos. | `company` se omite porque puede contener información de licencia; el perfil debe cargarse mediante la activación legítima de la misma licencia. La configuración visual y de dispositivo se recrea localmente. |
| Sincronización y operaciones inciertas: `sync_outbox`, `sync_conflicts`, `financial_intents`, `transaction_log` | Se inspeccionan durante el mismo snapshot, pero sus filas no se copian. Sus pendientes hacen que la cobertura sea parcial. | Excluidas. | Excluidas. | Se debe conciliar en el origen antes de depender del respaldo. No existe una bóveda de cuarentena exportada ni reproducción de estas operaciones en el destino. |
| Estado fuera de Dexie: carritos, pedidos activos, ajustes de inventario sin terminar, cierres de restaurante pendientes y TTL de expiraciones ignoradas | Excluidos y contabilizados en `coverage.excludedBrowserState` cuando el navegador permite inspección. | Excluidos. | Excluidos. | Su presencia marca cobertura parcial; el estado de aplicación no se reconstruye desde el respaldo. La política de apertura de caja también vive fuera del archivo. |
| Credenciales y estado criptográfico: `LanzoBackupConfig`, almacenamiento de sesión, licencia, tokens y registro de dispositivo | Excluidos. | Excluidos. | Excluidos. | El archivo solo contiene una huella SHA-256 de la identidad del negocio y los metadatos del formato; las claves de cifrado no se copian. La nueva instalación debe activarse por la ruta normal. |

### Qué significa “completo”

La etiqueta `completa` indica que las tablas aprobadas se exportaron y que los indicadores observables de operaciones pendientes, cajas abiertas y estado de navegador excluido no reportaron trabajo pendiente. No certifica conciliación de saldos, integridad referencial, completitud de datos Cloud ni contenido que el navegador no pudo inspeccionar. Si la inspección del almacenamiento falla, el archivo queda parcial.

## Formatos y controles

### Respaldo cifrado

- `.lzbk` V2 usa cabecera `LANZOBK2`, AES-GCM de 256 bits, PBKDF2-SHA-256 con 600,000 iteraciones y bloques de 4 MiB. Cada bloque usa un IV aleatorio y autenticación que incluye la cabecera y el índice del bloque.
- La cabecera identifica versión de archivo y esquema, fecha, conteos por tabla/categoría, razones de cobertura parcial y una huella SHA-256 del negocio. No incluye la licencia en texto claro.
- El nombre de archivo y la retención de siete copias se separan por huella del negocio; rotar copias de un negocio no borra las de otro en la misma carpeta.
- Se pueden leer archivos V1 (`LANZOBK1`). V1 solo contiene `menu`, `sales` y `customers`; se etiqueta parcial y nunca borra en destino las tablas que el archivo no trae.
- En un navegador sin acceso persistente a carpeta, el respaldo manual descarga el blob cifrado. El automático requiere que la aplicación siga abierta y permiso de carpeta; no se promete ejecución con la aplicación cerrada.

### Exportación de consulta y transferencia

- La exportación estructurada usa JSON `format: "lanzo-portable-data"`, `version: 1`, `dataKind: "business-data-export"`, `schemaVersion`, `datasetId`, `tableCounts`, `categories` y `data.tables`.
- La transferencia de catálogo usa el mismo contenedor con `dataKind: "catalog-transfer"` y una lista fija de tablas permitidas. No acepta ventas, saldos, cajas ni pagos.
- CSV se genera por tabla con encabezados derivados de los campos presentes. Las cadenas se entrecomillan, se duplican las comillas, se admite salto de línea dentro de una celda y se antepone apóstrofo a valores que podrían ser fórmulas de hoja de cálculo.
- Las exportaciones JSON y CSV son archivos de consulta sin cifrar. La interfaz advierte que pueden contener información comercial y personal.
- El exportador JSON y las imágenes se materializan en memoria. La importación de paquetes de catálogo limita el archivo a 64 MiB; no se ha certificado rendimiento con catálogos grandes.

## Operación y almacenamiento

La revisión automática no compara solo conteos: las tablas de negocio actualizan una revisión tenant-local ante altas, cambios y borrados. El proceso compara revisión y conteos ligeros; si la revisión no puede persistirse o el respaldo anterior falló, vuelve a intentar en vez de omitir el respaldo. En navegadores sin escritura automática disponible, el usuario debe descargar manualmente. El intervalo automático es de cuatro horas con la aplicación abierta.

La configuración y la sesión criptográfica se guardan con IDs separados por negocio. La retención filtra por el prefijo de huella del negocio. Al cambiar PIN se migran archivos antiguos genéricos solo después de descifrarlos y validar su identidad; los archivos de otros negocios no se migran.

## Evidencia automatizada

Las pruebas focalizadas cubren whitelist y exclusiones, snapshot con conteos de operaciones, V1 parcial no destructivo, archivo V2, sustitución atómica con rollback, aislamiento de estación de caja, cifrado/formato, seguimiento de cambios sin cambiar cantidades, sesión por negocio, CSV con fórmulas y saltos de línea, transferencia repetida de catálogo y permisos de interfaz. Todo resultado automatizado es sintético.

## QA manual en Vercel Preview

### Requisitos y estado seguro

1. Usa el URL Preview del commit que contiene este documento. Confirma que indica entorno Preview y que no redirige a Production.
2. Usa únicamente una licencia Free de prueba aprobada y desechable, y un negocio sin información que deba conservarse. Antes de activar, confirma que el entorno Preview está conectado a un servicio de licencias autorizado para QA. Si la activación escribiría en Supabase Production, detén la prueba: esta tarea no autorizó esas escrituras.
3. Usa un perfil de navegador dedicado para el negocio origen y otro perfil limpio para destino. No limpies almacenamiento de un perfil con datos reales.
4. Guarda PIN y archivos de prueba en un medio privado temporal. No adjuntes respaldos ni datos personales en el PR o en evidencia pública.
5. En Chrome o Edge prueba tanto pestaña como PWA instalada. Para móvil usa Android/PWA con descarga manual cuando no aparezca el selector persistente de carpetas.

### Recorrido principal — mismo negocio, equipo limpio

1. Activa la licencia Free autorizada en el perfil A y termina la configuración inicial. Anota la etiqueta del negocio y la versión Preview.
2. Crea una categoría `QA-portabilidad-<fecha>`; crea un ingrediente si el rubro lo usa; crea un producto con nombre acentuado, coma y descripción con salto de línea. Define precio, costo y código de barras ficticio.
3. Registra dos lotes para ese producto, por ejemplo 6 y 4 unidades con fechas y costos distintos. Anota las cantidades por lote y el total inicial (10).
4. Crea un cliente ficticio con teléfono no real. Conserva capturas de su saldo inicial en cero.
5. Abre caja con fondo de $500. Haz una venta de contado de dos unidades a $100 cada una. Registra una venta fiada de una unidad a $100, abona $25 y confirma en cliente el saldo pendiente de $75.
6. Crea un apartado ficticio por $150 y registra un pago de $50. Confirma saldo pendiente de $100 y que el producto reservado/existencia comprometida coincide con la regla vigente del POS.
7. Registra una entrada de efectivo de $40 y una salida de $10 con conceptos de QA. Verifica movimientos, vínculo a sesión y totales teóricos. Cuenta y cierra la caja desde el flujo normal; compara el efectivo esperado y la diferencia antes de continuar.
8. Abre Configuración → Respaldos. Define PIN de al menos ocho dígitos y un destino privado. Genera el respaldo manual. Anota hora, nombre, categorías/conteos y resultado de cobertura. Para el caso principal, cobertura debe ser completa; si aparece pendiente, resuelve en A y genera una nueva copia.
9. Copia el archivo a una ubicación privada y conserva el origen A sin modificaciones. No uses el único archivo de respaldo como archivo corrupto de prueba.
10. En el perfil B limpio, visita la misma Preview, activa legítimamente la misma licencia de prueba y confirma que la base destino está vacía. No configures antes un PIN de respaldo en B.
11. Selecciona el `.lzbk`, introduce el PIN del archivo y pulsa **Revisar archivo**. Confirma versión, fecha, negocio, tablas/conteos, cobertura y que el destino aparece vacío. Si la identidad no coincide o el PIN falla, no confirmes restauración.
12. Restaura. Compara en B con A: categoría, producto, variantes, lotes y vencimientos; existencias totales y por lote; imagen; cliente y saldo; venta contado y fiada; abono; apartado y pago; sesión cerrada y movimientos. Comprueba IDs/referencias por pantallas de detalle y que no aparecieron filas adicionales.
13. Abre una caja nueva en B con un fondo de prueba. Confirma que la sesión antigua cerrada no aparece como sesión actual, y que la nueva venta se vincula únicamente a la nueva sesión. La sesión nueva de B debe recibir un ID propio; la sesión histórica conserva su ID para mantener referencias.
14. En Configuración → Exportar información, descarga JSON de ventas/clientes/inventario y CSV de productos o ventas. Abre CSV en una hoja de cálculo; verifica acentos, comillas, saltos de línea, importes y que cualquier nombre que empiece con `=`, `+`, `-` o `@` no se evalúa como fórmula.

### Caja abierta — caso de conciliación aparte

15. En otro conjunto desechable, deja abierta la caja en A y genera respaldo. En B usa **Revisar archivo** y confirma la advertencia de caja abierta. El archivo debe mostrar cobertura parcial y nunca seleccionar esa caja como sesión actual de B. La clave local de estación en el respaldo debe ser opaca y no coincidir con la estación nueva; los IDs/huellas crudas de A no deben aparecer en el archivo restaurado. Conciliación manual sigue pendiente: no marques este caso como PASS si no se puede abrir una caja nueva de forma separada y operar sin asociarse al efectivo histórico.

### Portabilidad a otro negocio

16. Crea otro negocio de prueba con licencia autorizada distinta. En A descarga un paquete de **Transferencia de catálogo** con categorías, productos, ingredientes e imágenes compatibles.
17. En el nuevo negocio selecciona el paquete y revisa el conteo de nuevos, reutilizados, duplicados, conflictos y rechazados. No confirmes mientras exista conflicto.
18. Confirma. Verifica mapeo de IDs de categorías, productos, recetas e imágenes; stock y costos deben ser cero/ausentes, sin lotes de origen, clientes con deuda, ventas, abonos, apartados ni movimientos de caja.
19. Revisa el mismo paquete una segunda vez. No deben aparecer productos/categorías nuevos ni aumentarse existencias. Los productos ya reconocidos pueden mostrar actualización de datos maestros, pero su stock y costo local deben conservarse.
20. Confirma que A mantiene intactos sus datos. Para inventario inicial desde CSV, usa el flujo de importación con vista previa en un negocio de prueba y repite el mismo archivo: no debe crear productos o lotes de inicio adicionales.

### Archivos inválidos, versiones y PWA

21. Prueba un PIN incorrecto y después un duplicado de archivo con un byte alterado. Ambos deben rechazarse antes de escribir datos. Prueba un archivo de otra licencia autorizada y confirma que se rechace por identidad aunque el PIN sea correcto.
22. Si se dispone de una copia V1 de prueba, confirma la etiqueta parcial, la restauración de `menu`, `sales`, `customers` y que `categories`/otras tablas ya existentes en destino no se borran.
23. Instala la Preview como PWA en el perfil de prueba. Tras un nuevo build Preview, vuelve a abrirla y confirma que la versión se actualiza y las pantallas de respaldo/portabilidad siguen disponibles. No fuerces una actualización mientras haya una operación financiera en curso.

### Evidencia, criterios de fallo y limpieza

24. Guarda capturas de Preview URL/commit, cobertura del respaldo, vista previa de restauración, saldo del cliente, detalle de apartado, inventario por lote, cierre y movimientos de caja, archivos CSV/JSON, vista previa del catálogo transferido y mensaje de rechazo de archivo alterado. Oculta licencia, teléfonos y datos del negocio.
25. Marca fallo si cambia algún saldo o existencia, faltan referencias, se duplica un pago/venta/lote, la caja anterior se convierte en caja actual, el archivo de otra licencia se acepta, o se limpian datos destino antes de confirmar.
26. Al terminar, cierra caja, conserva el archivo cifrado solo si forma parte de QA aprobado y borra datos locales únicamente de los perfiles desechables. No borres ni modifiques registros de licencias/negocios reales para “limpiar” la prueba.

### Resultado actual

| Etapa | Estado |
|---|---|
| Código implementado | PARCIAL: capacidades cliente entregadas; conciliación general de relaciones/saldos y Cloud no certificada |
| QA automatizado | PASS local: 90 pruebas en 13 archivos focalizados; no es una operación certificada |
| Builds | PASS local: `npm run build` y auditorías postbuild |
| CI | PENDIENTE de GitHub |
| Preview | PENDIENTE de deployment READY asociado al commit |
| QA manual | PENDIENTE; no ejecutado por esta implementación |
| Production | SIN CAMBIOS; sin SQL, migraciones, merge ni deployment productivo |
| Objetivo comercial | NO CERTIFICADO hasta completar el recorrido real de QA |
