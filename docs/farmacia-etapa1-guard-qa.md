# Farmacia Etapa 1 — Protección y QA pendiente

**Estado:** candidato Draft, nunca permiso de dispensación. Normas: Ley General de Salud art. 226 (DOF); Acuerdo antibióticos 27/05/2010.

**Modelo:** `pos_products.metadata.pharmacy` (version 1, kind, fraction I–VI, status, antibiotic, concentration, dosageForm, sanitaryRegistration). Dexie conserva el mismo objeto en producto local. Los campos heredados se derivan para registros confirmados; los históricos sin fracción conservan sus restricciones originales.

**Restricción temporal:** una clasificación medicinal confirmada no puede alterarse ni eliminarse mediante edición/legacy; hasta disponer de reclasificación autorizada, se bloquea el cambio. Los medicamentos I–III se guardan inactivos y no pueden venderse mediante checkout genérico.

**SQL, solo propuesta:** `20261111190000_pharmacy_stage1_catalog_and_sale_guard.sql` añade dos triggers y sus funciones:
- `pos_products` bloquea activación, eliminación/alteración de fracción confirmada y degradación de banderas heredadas.
- `pos_sale_items` bloquea materialización de líneas identificadas por product_id o batch_id desde el catálogo del tenant, para I–III. Se aplica dentro de transacciones de los RPC. No modifica datos existentes.

**Limitación:** una línea sin ID de producto ni lote no puede atribuirse con fiabilidad a un medicamento existente. La etapa no inventa una coincidencia por nombre. Probar las rutas reales con productos canónicos y verificar en autorización RPC que no puedan omitir el vínculo.

**QA PostgreSQL aislado OBLIGATORIO (no realizado):**
1. Crear una base clonada desde schema+RPC de Production, sin datos reales. Aplicar exclusivamente esta migración.
2. Crear licencia/dispositivo/caja de QA y productos de fracciones II, IV, VI y legado con IDs conocidos, sin inventario físico.
3. Ejecutar `pos_upsert_product` (activo=false especial), `pos_toggle_product_status` (intentar activar II), actualización legacy omitiendo/alterando `metadata.pharmacy`.
4. Ejecutar los RPC reales `pos_create_cloud_sale_cashier`, `pos_create_cloud_sale_cashier_inventory`, `pos_create_cloud_sale_credit` y `pos_upsert_sale_shadow` para producto II. Cada tentativa debe rechazar sin escribir ventas, pagos o efectos de inventario.
5. Repetir con VI, IV e histórico no clasificado: no rechazar indiscriminadamente. Verificar permisos Staff y aislamiento por license_id.
6. Intentar omitir product_id / enviar batch_id y datos falsificados, revisar si los RPC aceptan líneas no vinculadas. Si aceptan líneas sin vínculo de farmacia como ventas, mantener HOLD hasta corrección.
7. Verificar atomicidad, idempotencia, concurrencia (activar mientras venta se confirma) y eventos.

**No confundir:** Vitest/CI o examen estático del SQL no prueba llamadas a los RPC reales. Sin esta prueba y sin instalación posterior autorizada, **la protección Cloud NO existe en Production**.

**QA manual Preview pendiente:** negocio farmacia de prueba; crear antibiótico IV, cerrar/reabrir; crear II en stock 0 y comprobar que no se activa; crear VI; editar legado; repetir recuperación Cloud contra el proyecto autorizado (solo acciones QA expresamente aprobadas).
