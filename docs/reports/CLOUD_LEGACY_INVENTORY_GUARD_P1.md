# P1 — Cloud legacy 6B: validación pendiente

**Migración:** `20261110150000_cloud_legacy_inventory_guard_v1.sql`. **Estado:** preparada, no instalada; no se modificaron ventas ni existencias reales.

## Qué protege
R2B valida licencia, sesión, tenant, permisos e identidad real de los productos. Antes de delegar a la hoja 6B, el wrapper `cashier_unlimited` sólo permite items que el catálogo Cloud demuestra sin obligación de inventario. La función de crédito conserva su aplicación de inventario cuando la licencia está habilitada y rechaza, de forma transaccional, cualquier éxito sin stock requerido. No se acepta una declaración `cloudInventoryEffects=false`, `track_stock=false` o `snapshotOnly` como autoridad.

Se conservan la RPC moderna, las autorizaciones, locks, idempotencia y permisos EXECUTE existentes. El error `CLOUD_LEGACY_INVENTORY_UPDATE_REQUIRED` pide actualizar la PWA. Un replay de recibo completado no registra una nueva venta.

## Control antes de instalar
Verificar versión, SHA-256 canónico, proyecto `odlrhijtfyavryeqivaa`, hash MD5 de ambos wrappers y estado del ledger; detenerse ante drift. No usar `db push`. Requiere autorización explícita para Production. Tras aplicar, fusionar **este mismo PR** para dejar el archivo canónico en main.

## QA transaccional real, aún NO EJECUTADO
Usar exclusivamente negocio y dispositivo de prueba aprobados, con Vercel Preview conectado al proyecto correcto; observar cambios antes/después por sale_id + idempotency_key en ventas, pagos, caja, movimientos y existencias.

1. **Legacy controlado:** producto track_stock verdadero, `cloudInventoryEffects=false` y flags manipulados: error UPDATE_REQUIRED; cero venta/pago/caja/movimiento.
2. **Moderna 6C:** mismo producto con stock suficiente: venta y pago coherentes; decremento exacto.
3. **Sin stock:** exceder stock en 6C: rechazo sin efectos financieros persistentes.
4. **Replay:** repetir clave exitosa: mismo recibo, un solo descuento/cobro/caja.
5. **Sin stock requerido:** producto no controlado, sin recetas, modificadores de inventario ni lotes controlados: legacy autorizada según permisos.
6. **Autorización:** Staff sin permiso, sesión revocada y licencia ajena: rechazo en ambas rutas, sin efectos.
7. **Receta/lote/variante/modificador:** manipular `track_stock` en JSON o quitar asignaciones: 6B rechaza; 6C valida y aplica o rechaza atómicamente.
8. **Crédito:** con Cloud inventory habilitado se aplican existencias; sin capacidad, producto controlado no se registra.

**Evidencia requerida:** IDs de prueba, resultado RPC, conteos antes/después y movimientos con vínculo a sale_id; reintento igual. No declarar PASS con una prueba estática o Preview READY.

**Riesgo residual:** llamadas internas con credenciales privilegiadas a la hoja `*_legacy_r2b` (restringida a `service_role`/postgres) no usan este wrapper; nunca debe exponerse service_role al cliente. El alcance cubre RPC públicas y sus rutas delegadas encontradas. Si se descubre un caller privilegiado directo, no publicar comercialmente antes de resolverlo.
