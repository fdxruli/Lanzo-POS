# FASE ECOM.PRODUCTS.APPAREL.1

Fecha: 2026-07-17 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-apparel-1`  
PR: `#112`  
Estado: **BLOQUEANTE RESIDUAL CORREGIDO — PR DRAFT, VALIDACIONES DE PRUEBAS Y LINT PENDIENTES**

## 1. Resumen ejecutivo

Se corrigió el bloqueante residual de inventario apparel por SKU: cuando ninguna partida compatible contiene por sí sola toda la cantidad solicitada, el resolutor ya no clasifica automáticamente el caso como stock insuficiente.

La semántica final es:

```text
Un lote compatible individual alcanza
→ se selecciona por FEFO dentro de la variante.

Ningún lote individual alcanza,
pero el total compatible sí alcanza
→ MULTI_BATCH_REQUIRED.

El total compatible no alcanza
→ ECOMMERCE_VARIANT_STOCK_INSUFFICIENT.
```

No se implementó reparto automático entre varios lotes. `MULTI_BATCH_REQUIRED` permanece como conflicto manual seguro porque el flujo actual no persiste ni descuenta múltiples lotes para una sola línea.

## 2. Verificación Git inicial

Antes de modificar se confirmó:

```text
HEAD inicial de la rama: 0a29db7f5778b98ff028a51ff5f860cb90312fe0
HEAD de main:             9aab390498877b5f16d0dd00021aa015f639f720
Merge-base:               9aab390498877b5f16d0dd00021aa015f639f720
Ahead de main:             26
Behind de main:            0
PR abierto:                sí
PR draft:                  sí
PR mergeado:               no
```

Todas las escrituras se realizaron exclusivamente sobre `fase-ecom-products-apparel-1`.

## 3. Estado heredado preservado

Se conservaron sin regresión intencional las correcciones ya aprobadas:

- variantes hermanas con `sourceProductId: null`;
- `localProductRef` apuntando al producto padre;
- identidad comercial por `sourceVariantRef`, SKU y atributos;
- índice único por `source_product_id` sin eliminar ni relajar;
- apparel reconocido con `variants: []` permanece fail-closed;
- `APPAREL_VARIANTS_UNAVAILABLE`, `sourceAvailable: false` y `stockSnapshot: 0`;
- ausencia de degradación a producto simple;
- ausencia de agregado directo al carrito sin variante válida.

## 4. Causa del defecto residual

Existían dos rutas con la misma clasificación incompleta:

1. `selectEcommerceVariantBatch` en `ecommerceApparelVariants.js`.
2. `prepareEcommerceApparelVariantInventory` en `ecommercePosApparelVariantResolution.js`.

Ambas buscaban correctamente un lote individual compatible y sumaban el stock de los lotes compatibles, pero si ningún lote individual alcanzaba devolvían siempre:

```text
ECOMMERCE_VARIANT_STOCK_INSUFFICIENT
```

La suma agregada no se utilizaba para distinguir stock realmente insuficiente de stock suficiente repartido.

## 5. Corrección aplicada

Se añadió un helper compartido:

```text
classifyEcommerceVariantBatchStock
```

El helper recibe:

- candidatos ya filtrados por variante;
- cantidad requerida;
- función para leer disponibilidad física o disponibilidad restante del ledger.

Su resultado único contiene:

```text
selectedBatch
availableStock
code
```

La misma función es utilizada por:

- `selectEcommerceVariantBatch`;
- `prepareEcommerceApparelVariantInventory`.

Esto evita que ambos resolutores mantengan semánticas distintas.

## 6. Código de conflicto definitivo

Se reutilizó el código canónico del resolutor base:

```text
MULTI_BATCH_REQUIRED
```

Persistencia final:

```text
inventoryResolution.status = conflict
inventoryResolution.code = MULTI_BATCH_REQUIRED
inventoryResolution.availableQuantitySnapshot = stock compatible restante
inventoryResolution.selectionMode = variant_exact
```

Stock insuficiente conserva:

```text
ECOMMERCE_VARIANT_STOCK_INSUFFICIENT
```

## 7. Seguridad operativa

La corrección no:

- divide silenciosamente una línea entre varios lotes;
- selecciona un lote arbitrario;
- descuenta inventario parcialmente;
- sustituye SKU, talla, color o atributos;
- usa stock de otra variante;
- expone IDs internos al mensaje operativo.

El ledger virtual continúa descontando sólo el lote individual seleccionado. Las líneas repetidas evalúan el stock restante.

## 8. Mensajes operativos

Para stock repartido:

```text
La variante tiene stock suficiente, pero esta repartido entre varios lotes y requiere resolucion manual.
```

Para stock insuficiente:

```text
No hay stock suficiente de la talla y color comprados.
```

Los mensajes son distintos y no incluyen identificadores internos.

## 9. Archivos modificados por este bloqueante

```text
src/services/ecommerce/ecommerceApparelVariants.js
src/services/ecommerce/ecommercePosApparelVariantResolution.js
src/services/ecommerce/__tests__/ecommercePosApparelVariantResolution.test.js
docs/reports/ECOM.PRODUCTS.APPAREL.1.md
```

No se modificó `ecommercePosInventoryResolutionBase.js`; se reutilizó su convención canónica `MULTI_BATCH_REQUIRED`.

## 10. Pruebas agregadas

La prueba focalizada ahora cubre explícitamente:

1. lote individual suficiente y FEFO entre lotes suficientes;
2. stock compatible `1 + 1` para cantidad `2` como `MULTI_BATCH_REQUIRED`;
3. persistencia del snapshot agregado `2`;
4. stock agregado `1 + 0.5` para cantidad `2` como insuficiente, snapshot `1.5`;
5. exclusión de otra talla, color o SKU del cálculo;
6. FEFO únicamente dentro de la variante solicitada;
7. ledger entre líneas repetidas;
8. clasificación directa de `selectEcommerceVariantBatch`;
9. mensajes distintos para stock repartido e insuficiente.

## 11. Validaciones ejecutadas

### 11.1 Revisión del diff

Resultado: **PASS**.

Los tres commits funcionales sólo modifican:

- helper y clasificación compartida;
- persistencia y mensaje del conflicto;
- cobertura focalizada.

### 11.2 `npm run build`

Resultado: **PASS** sobre el HEAD funcional:

```text
847662d115d3a12772ca509621b2a770d0f4771c
```

Evidencia del build automático de Vercel:

```text
Branch: fase-ecom-products-apparel-1
Commit: 847662d
Comando: npm run build
Vite: 3354 módulos transformados
Build principal: 16.94 s
Service worker: 84 módulos transformados
Estado del deployment: READY
```

Se observaron advertencias preexistentes de partición de chunks y actualización de `baseline-browser-mapping`; no fueron errores de compilación.

No se creó un deployment manual. Los previews observados fueron generados automáticamente por la integración GitHub–Vercel al escribir la rama.

### 11.3 Pruebas focalizadas

Resultado: **NO EJECUTADAS EN ESTE ENTORNO**.

La cobertura fue añadida al archivo real, pero este entorno no dispone de un checkout completo con dependencias ejecutables y el HEAD no tiene un workflow de GitHub Actions asociado. No se declara PASS.

### 11.4 `npm run test:ci`

Resultado: **NO EJECUTADO**.

No se declara PASS global.

### 11.5 `npm run lint`

Resultado: **NO EJECUTADO**.

No se declara PASS global.

## 12. Supabase

No fue necesaria ninguna modificación de base de datos.

Migraciones existentes involucradas en la fase:

```text
20260717160018_ecom_products_apparel_variant_snapshot.sql
20260717171605_ecom_apparel_variant_parent_consistency.sql
```

Confirmaciones:

- no se editaron migraciones aplicadas;
- no se creó una migración nueva;
- no se ejecutó SQL para este bloqueante;
- no se dejaron datos temporales.

## 13. Commits funcionales

```text
801ab9dea689f818b4661c3f3ed3791c7e72b3b2 fix(ecommerce): classify apparel variant multi-batch stock
16f103a7de0016ffb7d5d9579ff407e862418dc8 fix(ecommerce): persist apparel multi-batch conflicts
847662d115d3a12772ca509621b2a770d0f4771c test(ecommerce): cover apparel multi-batch resolution
```

`847662d115d3a12772ca509621b2a770d0f4771c` es el HEAD funcional compilado. El HEAD final autoritativo, que incluye esta actualización documental, se registra en la descripción del PR porque un archivo no puede autocontener el SHA del mismo commit que lo crea.

## 14. Estado final y limitaciones

El bloqueante lógico está corregido y el build global pasa, pero el trabajo **no se marca como completo ni listo para merge** mientras permanezcan pendientes:

```text
pruebas focalizadas reales
npm run test:ci
npm run lint
```

El PR debe continuar:

```text
OPEN
DRAFT
MERGED = FALSE
```

No mergear hasta ejecutar y aprobar esas validaciones sobre un checkout completo del HEAD final.
