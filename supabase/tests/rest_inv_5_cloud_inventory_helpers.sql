-- REST.INV.5 — verificación rápida de reglas de extras cloud.
-- Ejecutar contra Supabase después de aplicar migraciones.

select
  private.rest_inv5_modifier_tracks_inventory('{"ingredientId":"ing_queso","ingredientQuantity":30,"tracksInventory":true}'::jsonb) = true as queso_tracks,
  private.rest_inv5_modifier_inventory_quantity('{"ingredientId":"ing_queso","ingredientQuantity":30,"tracksInventory":true}'::jsonb) = 30 as queso_qty,
  private.rest_inv5_modifier_tracks_inventory('{"name":"Sin cebolla","tracksInventory":false}'::jsonb) = false as texto_no_tracks,
  private.rest_inv5_modifier_tracks_inventory('{"name":"Empaque extra","price":5}'::jsonb) = false as precio_sin_ingrediente_no_tracks,
  private.rest_inv5_modifier_tracks_inventory('{"ingredientId":"ing_tocino","quantity":25}'::jsonb) = true as legacy_tracks,
  private.rest_inv5_modifier_inventory_quantity('{"ingredientId":"ing_tocino","quantity":25}'::jsonb) = 25 as legacy_qty;

-- Casos funcionales completos a validar con datos reales PRO/cloud:
-- 1) Hamburguesa x2 con receta pan 1 pza + carne 150 g => pan -2, carne -300.
-- 2) Extra queso 30 g en Hamburguesa x2 => queso -60.
-- 3) Extra solo texto / precio sin ingrediente => sin movimiento de inventario.
-- 4) Reintento de la misma venta con el mismo idempotency_key => sin doble descuento.
-- 5) Cancelación cloud => return_in de los sale_out originales, sin recalcular receta actual.
