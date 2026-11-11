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
