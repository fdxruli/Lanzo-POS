# Farmacia Etapa 2 — recepción trazable (candidato parcial)

## Alcance implementado

En Productos V2, acción **Agregar existencia**, un medicamento con clasificación confirmada IV–VI y control de lotes activo puede registrar:
- Cantidad en la unidad actual del inventario, lote del fabricante, caducidad.
- Proveedor, tipo y referencia de comprobante, fecha de recepción y fecha de adquisición opcional.
- Observaciones y costo unitario opcionales.
- Nueva recepción en lote existente con otro comprobante, sin sobrescribir el movimiento anterior.

Se reutilizan `addInventoryEntry` (Dexie) y `pos_add_inventory_entry` (Cloud). No se añadieron tablas ni migraciones. En Dexie, el evento `INVENTORY_ENTRY` almacena `metadata.pharmacyReceipt`, `supplier`, `originActor` y la identidad del lote. En Cloud, la RPC vigente incorpora `p_metadata` al movimiento `pos_inventory_movements.metadata` y devuelve `inventory_movement.metadata`. La procedencia del movimiento es independiente del campo mutable `supplier` del lote.

La interfaz muestra los últimos cinco movimientos documentados *de este dispositivo*. No representa una consulta de movimientos históricos recuperados desde Cloud.

Para medicamentos I–III, clasificación pendiente, falta de lotes o conversión de unidades no compatible: el flujo se bloquea. No autoriza dispensación ni libros especiales COFEPRIS.

## Bloqueos comprobados: no cerrar ni fusionar como Etapa 2 completa

1. **Entradas alternativas:** `ProductInventoryFields` permite existencia inicial positiva; `BatchFormModal` y `useBatchManagerController` permiten crear/editar el stock absoluto de lotes. Los RPC heredados `pos_upsert_product`, `pos_upsert_product_batch` y `pos_migrate_local_product_catalog` siguen disponibles en Production. Sus contratos no obligan a adjuntar un comprobante de recepción. Restringir el modal solamente no cierra el bypass de clientes heredados. **Se requiere una decisión focalizada** sobre cómo proteger esas rutas sin afectar restauraciones.
2. **Recuperación Cloud:** se verificó que `pos_add_inventory_entry` persiste y devuelve `p_metadata`, pero no se verificó un flujo de consulta/hidratación de movimientos históricos en otro dispositivo. No declarar recuperación documental Cloud.
3. **Validación en servidor:** la RPC actual no aplica las nuevas validaciones farmacéuticas de documentación, duplicidad física de lote y caducidad. La validación frontend/Dexie del candidato no equivale a control transaccional del servidor.
4. **FEFO, Staff, concurrencia Cloud, respaldo restaurado:** no hay QA manual real. Las pruebas Dexie no prueban esos contratos en Production.

No hay permisos para modificar Production o instalar SQL en esta etapa. No usar `db push`. No abrir otro PR sin autorización.

## QA manual al autorizar operación en Preview (pendiente)

Negocio farmacéutico de prueba, producto **Amoxicilina QA 500 mg**, fracción IV, antibiótico, 0 cajas:

A. Recibir 10 cajas; fabricante `AMX-QA-2026-A`, caducidad `2027-10-31`, Distribuidora QA, factura `FAC-QA-001`. Verificar lote=10, producto=10, evento y comprobante.

B. Recibir 5 cajas del mismo lote con `FAC-QA-002`. Verificar lote=15, producto=15 y dos movimientos/comprobantes distintos.

C. Recibir 8 cajas lote `AMX-QA-2026-B`, caducidad `2027-04-30`. Verificar total=23 y FEFO priorizando B.

D. Reintentar la misma operación; existencia debe seguir en 23, sin otro movimiento.

E. Cerrar/reabrir PWA; recuperar existencias, lotes y comprobantes en el mismo dispositivo.

F. PRO/Nube: con autorización expresa de QA real, comprobar `pos_inventory_movements`, campos metadata, idempotencia, permisos Staff, aislamiento tenant, concurrencia A(+5)/B(+3), restauración desde Cloud y sesiones revocadas. No ejecutar escrituras automáticamente.

## Separación de evidencias

- Código: preparado en rama Draft.
- QA automatizado: correr la suite focal y CI del PR; ningún resultado afirmado sin ejecución.
- QA integrado Cloud: pendiente.
- QA manual Android/desktop: pendiente.
- Preview Vercel: estado pendiente de consulta.
- Production: sin modificaciones.
- Objetivo de negocio: **PARTIAL_HOLD** hasta cerrar las rutas alternativas y recuperar documentación en Cloud.

## Naturaleza documental

El registro es **auxiliar**; no es un libro de control autorizado ni implica validación de COFEPRIS. Referencias para trabajos posteriores: trámite [COFEPRIS-03-005](https://www.gob.mx/public/tramites/detalleTramite.xhtml?homoclave=COFEPRIS-03-005), Ley General de Salud artículo 226 y Suplemento FEUM vigente, según aplique a la farmacia y a sus medicamentos.

## Iteración de corrección focalizada — bloqueo estructural confirmado (11-nov-2026)

### Matriz de rutas verificada (GitHub + definición SQL en Production; solo lectura)

| Ruta | Puede ingresar stock | Documento obligatorio | Autoridad actual | Acción segura |
|---|---|---|---|---|
| `addInventoryEntry` / `pos_add_inventory_entry` | Sí, delta aditivo | Dexie del candidato sí; RPC Cloud **no** | Dexie + servidor | Endurecer RPC cuando haya frontera segura |
| Alta de producto mediante `ProductInventoryFields` / `prepareProduct` / `pos_upsert_product_unlimited` | Sí, stock inicial o lotes iniciales positivos | No | Cliente + RPC | Para nuevos medicamentos, forzar 0 en UI **no basta**; proteger servidor con excepción legítima de migración |
| Crear lote con `BatchFormModal` / `saveBatch` / `pos_upsert_product_batch_unlimited` | Sí, stock positivo | No | Cliente + RPC | Evitar alta comercial indocumentada sin bloquear recuperación |
| Editar stock de lote | Sí, asignación absoluta `stock = v_stock` | No | RPC de lotes | Prohibir aumentos farmacéuticos informales, distinguiendo sincronización y corrección legítimas |
| `pos_migrate_local_product_catalog_unlimited` | Sí, productos y lotes | No; `migration_batch_id` no prueba adquisición | RPC reenvía a las mismas upserts | Necesita señal de migración autorizada y no falsificable; no confiar solo en `p_batch_id` ni en metadata enviada por cliente |
| Restauración/recuperación local | Repone estado previo, no representa compra | No aplica como compra | Funciones de respaldo y catálogo existentes | Conservar su semántica, no forzar factura ficticia |

**Pruebas de la frontera:** en Production, `pos_upsert_product_unlimited` inserta `v_stock` o `v_batch_stock` al crear registros. La edición de catálogo ya no muta stock del producto directamente (no afirmar lo contrario). En `pos_upsert_product_batch_unlimited`, el insert usa `v_stock` y el update hace `stock = v_stock`. `pos_migrate_local_product_catalog_unlimited` llama a ambas RPC de catálogo con productos y lotes importados y un `p_batch_id` proporcionado por el solicitante. Se validan contexto y permisos, pero **no** un origen documental de adquisición distinto del origen de una migración. El guard Stage 1 protege clasificación y venta, no procedencia de inventario.

El flujo legítimo `productMigrationService.runInitialMigrationIfNeeded` llama a `productCloudRepository.migrateLocalCatalog` con el stock local, incluyendo los lotes. Rechazar genéricamente todo stock positivo de farmacia en esas RPC rompería este cutover. Confiar en `p_batch_id`, `metadata.source` o cualquier etiqueta introducida por el navegador permitiría disfrazar una entrada informal como migración. **No instalar un trigger genérico ni desbloquear con heurística de incremento.**

### Lectura Cloud

`pos_inventory_movements` tiene RLS activo, sin política directa de lectura; `authenticated` tampoco tiene `SELECT` concedido. `private.pos_inventory_movement_to_jsonb` incluye metadata y actor, pero es un serializador interno. Los RPC de snapshot de catálogo recuperan productos y lotes, no constituyen un historial documentado de recepciones del producto. La recuperación interdispositivo de comprobantes sigue sin demostrarse. Una consulta paginada y autorizada de movimientos sería una mejora focalizada, pero no soluciona el bypass P0.

### Decisión de parada

**Estado: STRUCTURAL_HOLD.** Antes de modificar código o preparar una migración, hay que decidir el contrato que diferencia:
1. nuevas recepciones documentadas (delta más factura);
2. migraciones iniciales autenticadas (saldo histórico, **no** compra nueva);
3. sincronización y restauraciones de estado legítimas;
4. ajustes de inventario (no convertirlos en compras).

**Solución mínima propuesta:** diseñar y comprobar una señal de cutover/rehidratación autorizada **en servidor**, no falsificable por un cliente legacy, para las RPC existentes. Solo después restringir las altas/incrementos de stock farmacéutico mediante las upserts y exigir proveedor, lote, caducidad y comprobante en `pos_add_inventory_entry`. Añadir lectura paginada y protegida de movimientos para el dispositivo secundario. No habilitar comercialmente PRO para recepciones con trazabilidad garantizada antes de SQL + QA real.

**Costo/impacto:** al menos una migración focalizada que afectaría a la RPC de recepción, la frontera de upsert de producto/lote y el protocolo de migración; requiere pruebas con clientes antiguos, sincronización retrasada y restauración. No es una corrección segura de solo frontend. En este punto no hay SQL preparado ni hash que presentar.

**Alternativa:** mantener el flujo actual deshabilitado como garantía documental en PRO/Nube; trabajar únicamente con un piloto Free/Local delimitado si el propietario autoriza explícitamente ese recorte. Mantener el PR Draft, sin merge ni nuevas ramas, hasta la decisión.

**Evidencias ejecutadas:** lectura estática de GitHub y `pg_get_functiondef`, RLS y grants en Production. **No ejecutadas:** pruebas transaccionales SQL, Vitest de esta iteración, QA real Preview, pruebas entre dispositivos, restauración y escrituras en Production. Los checks existentes del PR no prueban estos recorridos.
