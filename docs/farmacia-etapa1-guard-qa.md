# Farmacia Etapa 1 — Protección y QA pendiente

**Estado:** candidato Draft, nunca permiso de dispensación. Normas: Ley General de Salud art. 226 (DOF); Acuerdo antibióticos 27/05/2010.

**Modelo:** `pos_products.metadata.pharmacy` (version 1, kind, fraction I–VI, status, antibiotic, concentration, dosageForm, sanitaryRegistration). Dexie conserva el mismo objeto en producto local. Los campos heredados se derivan para registros confirmados; los históricos sin fracción conservan sus restricciones originales.

**Restricción temporal:** una clasificación medicinal confirmada no puede alterarse ni eliminarse mediante edición/legacy; hasta disponer de reclasificación autorizada, se bloquea el cambio. Los medicamentos I–III se guardan inactivos y no pueden venderse mediante checkout genérico.

**SQL instalado en Supabase Production (11-nov-2026):** `20261111190000_pharmacy_stage1_catalog_and_sale_guard.sql` añade dos triggers y sus funciones:
- `pos_products` bloquea activación, eliminación/alteración de fracción confirmada y degradación de banderas heredadas.
- `pos_sale_items` exige ID canónico de producto o lote en toda venta Cloud de farmacia, valida licencia/producto/lote y rechaza fracciones I–III. Se aplica antes de materializar líneas, sin modificar registros históricos.

**Limitación:** una línea sin ID de producto ni lote se rechaza para licencias farmacia. La etapa no infiere un producto por nombre y no puede verificar el artículo físico cuando un cliente falsifica integralmente la identidad de otro producto permitido.

**QA funcional de RPC reales PENDIENTE (piloto autorizado en Production, sin pruebas sintéticas realizadas):**
1. Usar únicamente el negocio de farmacia de prueba y autorización específica del propietario para cada operación de QA.
2. Preparar productos ficticios de fracciones II, IV, VI y legado con IDs conocidos, sin inventario físico de controlados.
3. Ejecutar `pos_upsert_product` (activo=false especial), `pos_toggle_product_status` (intentar activar II), actualización legacy omitiendo/alterando `metadata.pharmacy`.
4. Ejecutar los RPC reales `pos_create_cloud_sale_cashier`, `pos_create_cloud_sale_cashier_inventory`, `pos_create_cloud_sale_credit` y `pos_upsert_sale_shadow` para producto II. Cada tentativa debe rechazar sin escribir ventas, pagos o efectos de inventario.
5. Repetir con VI, IV e histórico no clasificado: no rechazar indiscriminadamente. Verificar permisos Staff y aislamiento por license_id.
6. Intentar omitir product_id / enviar batch_id y datos falsificados, revisar si los RPC aceptan líneas no vinculadas. Si aceptan líneas sin vínculo de farmacia como ventas, mantener HOLD hasta corrección.
7. Verificar atomicidad, idempotencia, concurrencia (activar mientras venta se confirma) y eventos.

**No confundir:** Vitest, CI o inspección del SQL no prueban RPC reales. **La protección SQL existe en Production, pero su eficacia funcional no está certificada** hasta el QA manual autorizado.

**QA manual Preview pendiente:** negocio farmacia de prueba; crear antibiótico IV, cerrar/reabrir; crear II en stock 0 y comprobar que no se activa; crear VI; editar legado; repetir recuperación Cloud contra el proyecto autorizado (solo acciones QA expresamente aprobadas).

## Corrección de identidad canónica — 11 noviembre 2026

Archivo: `supabase/migrations/20261111190000_pharmacy_stage1_catalog_and_sale_guard.sql`
SHA-256 SQL corregido: `cb6c46757727b0c592bf7e6dee1e17df870b51b269b038bbb23335e20904b7ef`.

### Evidencia de RPC vigentes (lectura Production)
- `private.r2b_authorize_sale_financial_request_v1` exige `product_id` y valida `pos_products` por licencia y estado; ausencia de identidad -> `MANUAL_ITEM_PRICE_POLICY_REQUIRED`.
- `pos_upsert_sale_shadow` delega a `pos_upsert_sale_shadow_unlimited`, que valida sesión y POS, pero sus líneas dependen del JSON y no del catálogo canónico.
- Las hojas caja/caja-inventario/crédito/shadow insertan `pos_sale_items` en una misma transacción de función; la guarda propuesta actuará antes de insertar cada línea.
- Tipo de negocio confirmado: `business_profiles.business_type`, tipo `public.business_category[]`, unido por `license_id`.
- La corrección exige identidad real para **todas las líneas de licencia farmacia** y consulta su fracción en `pos_products.metadata.pharmacy`. Otros rubros no adquieren la restricción general.
- Artículos no medicinales de farmacia son válidos con producto/lote canónico; una línea manual de farmacia debe registrarse antes en catálogo.
- No hay modo de determinar el artículo físico cuando un cliente miente deliberadamente utilizando la identidad completa de otro producto canónico válido. Esta limitación no queda resuelta por SQL.

### Instalación y postflight verificados (11-nov-2026)
- Supabase Production (`odlrhijtfyavryeqivaa`): 349 → 350 migraciones; versión `20261111190000` registrada exactamente una vez, con SHA-256 canónico comprobado.
- Catálogo Production: 127 productos, 0 con `metadata.pharmacy`; 146 líneas, 0 sin ambos IDs.
- PostgreSQL aislado y ejecuciones funcionales de RPC reales: **no realizadas**; riesgo aceptado por el propietario para el piloto con negocios de prueba.
- Archivo canónico trazado en Git/main mediante PR #477 (merge `7465ee89b1dc36aa2818303295f18f86b692f600`), idéntico al SQL aplicado. Los dos triggers y funciones están instalados y habilitados.
- La instalación se ejecutó sin escrituras retrospectivas ni pruebas de venta; el PR de aplicación #476 sigue Draft, sin merge.

### QA transaccional real pendiente de autorización operativa y ejecución manual en Production
- Ejecutar los RPC existentes, no versiones simuladas: `pos_create_cloud_sale_cashier`, `pos_create_cloud_sale_cashier_inventory`, `pos_create_cloud_sale_credit`, `pos_upsert_sale_shadow`, sus variantes invocables y sus delegaciones.
- Negativos: I/II/III con ID correcto, II solo lote, II sin ambos IDs, ID de otro tenant, ID inexistente, producto-lote discordante, metadata falsa, eliminación de clasificación, activación indebida.
- Positivos: IV/VI, producto no medicinal farmacia con ID, histórico sin clasificación, venta de otro rubro, lotes correctos, permisos Staff.
- Verificar ventas, pagos, créditos, inventario, sync/audit events antes y después de cada rechazo; comprobar atomicidad e idempotencia con reintentos y concurrencia.
- Registrar errores SQL y efectos observados. CI, mocks o revisión estática no sustituyen estos resultados.
