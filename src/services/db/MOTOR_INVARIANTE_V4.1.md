# Motor Invariante V4.1 - Documentación de Arquitectura

## Resumen Ejecutivo

El **Motor Invariante V4.1** es una capa de seguridad arquitectónica que garantiza la consistencia del índice `activeStockStatus` en las tablas `MENU` y `PRODUCT_BATCHES`. Elimina la "fuga de abstracción" donde el código de negocio podía mutar stock sin disparar los hooks de Dexie.

---

## Problema Crítico Solucionado

### La Fuga de Abstracción Fatal

**Antes (V4.0):**
```javascript
// En cancelSaleCore.js - Lógica de restauración de stock
const saveBatchResult = await saveDataSafe(STORES.PRODUCT_BATCHES, updatedBatch);
// ❌ saveDataSafe usa generalRepository.save() que hace:
// await db.table(STORES.PRODUCT_BATCHES).update(id, validatedData)
// Esto SÍ dispara hooks, pero el problema era otro...

// El problema real: código que calculaba activeStockStatus manualmente
// y pasaba el valor al update, ignorando el estado real de isActive + stock
```

**Problema:** El código de negocio podía:
1. Calcular incorrectamente `activeStockStatus`
2. Pasar ese valor a través de `saveDataSafe`
3. El hook lo aceptaba sin validar consistencia
4. Resultado: Índices desincronizados, Dashboard mostrando datos incorrectos

### Impacto del Bug
- Productos con stock real > 0 aparecían como agotados en el Dashboard
- Índice `[categoryId+activeStockStatus]` retornaba datasets incompletos
- Inconsistencia matemática entre stock real y el índice de búsqueda
- Cancelaciones de ventas no restauraban visibilidad de productos

---

## Solución: Motor Invariante V4.1

### Principio Fundamental

> **"La base de datos es el último guardián de la verdad, no el código de negocio."**

Ningún código fuera de `services/db/` puede calcular `activeStockStatus`. Solo los hooks de Dexie (`creating`/`updating`) y los métodos especializados de `productsRepository` pueden tocar estos campos.

### 1. Guardias de Seguridad en Hooks (dexie.js)

```javascript
db.table(STORES.MENU).hook('updating', function (modifications, primKey, obj, transaction) {
  const nextState = { ...obj, ...modifications };
  const isActive = nextState.isActive !== false;
  const hasStock = Number(nextState.stock) > 0;
  const nextStatus = (isActive && hasStock) ? 1 : 0;

  // 🛡️ GUARDIA: Sobrescribir intentos manuales de setear activeStockStatus
  if (modifications.hasOwnProperty('activeStockStatus') && modifications.activeStockStatus !== nextStatus) {
    console.warn(`[HOOK GUARD] Intento de setear activeStockStatus=${modifications.activeStockStatus} ignorado...`);
    modifications.activeStockStatus = nextStatus;
    return;
  }

  // Inyectar el valor calculado si no está presente o es incorrecto
  if (nextState.activeStockStatus !== nextStatus) {
    modifications.activeStockStatus = nextStatus;
  }
});
```

**Características:**
- ✅ Calcula `activeStockStatus` siempre a partir de `isActive` + `stock`
- ✅ Sobrescribe CUALQUIER intento manual de mutar el campo
- ✅ Log en consola para debugging de violaciones
- ✅ Funciona tanto para `MENU` como `PRODUCT_BATCHES`

### 2. Método Atómico para Cancelaciones (products.js)

```javascript
async restoreStockFromCancellation(items) {
  return await db.transaction('rw',
    [db.table(STORES.PRODUCT_BATCHES), db.table(STORES.MENU)],
    async () => {
      // 1. Recopilar IDs de lotes y productos
      // 2. bulkGet para cargar estado actual
      // 3. Calcular nuevos stocks EN MEMORIA
      // 4. Usar db.table(STORES.PRODUCT_BATCHES).put(updatedBatch) - Dispara hook ✅
      // 5. Usar db.table(STORES.MENU).put(updatedProduct) - Dispara hook ✅
      // 6. Sincronizar productos padre afectados por lotes
    }
  );
}
```

**Reglas estrictas:**
- Usa `put()` en lugar de `update()` para garantizar disparo de hooks
- NUNCA calcula `activeStockStatus` manualmente (lo hace el hook)
- Transacción atómica: todo o nada
- Retorna lista de items restaurados y warnings

### 3. Deprecación Controlada en saveDataSafe (index.js)

```javascript
export const saveDataSafe = (storeName, data) => {
  // 🛡️ GUARDIA Pilar 1: Evitar uso accidental en tablas críticas
  if (storeName === STORES.MENU || storeName === STORES.PRODUCT_BATCHES) {
    console.error(`[ARQUITECTURA] Usar productsRepository en lugar de saveDataSafe...`);
    throw new Error(`saveDataSafe prohibido para ${storeName}. Use productsRepository...`);
  }
  return safeExecute(() => generalRepository.save(storeName, data));
};
```

**Efecto:**
- Cualquier código que intente usar `saveDataSafe(STORES.MENU, ...)` recibe error inmediato
- Stack trace incluido para encontrar y refactorizar el código violador
- No afecta otras tablas (CUSTOMERS, SALES, etc.)

### 4. Refactorización de cancelSaleCore.js

**Antes (MAL):**
```javascript
// Lógica de actualización de stock inline (~70 líneas)
// Usaba db.table(STORES.X).update() - parcial, riesgo de race conditions
// Calculaba stocks manualmente sin garantizar sincronización de índices
```

**Después (CORRECTO):**
```javascript
if (normalizedRestoreStock && saleFound.items?.length > 0) {
  const { productsRepository } = await import('../db/products.js');
  const { restored, warnings } = await productsRepository.restoreStockFromCancellation(
    saleFound.items
  );
  // El método garantiza disparo de hooks y consistencia de índices
}
```

---

## Patrones de Uso Aprobados

### ✅ RESTAURAR STOCK POR CANCELACIÓN

```javascript
import { productsRepository } from './services/db/products';

// ✅ CORRECTO: Usar método especializado
const result = await productsRepository.restoreStockFromCancellation(sale.items);
console.log(`Restaurados ${result.restored.length} items`);
```

### ✅ ACTUALIZAR PRODUCTO CON STOCK

```javascript
// ✅ CORRECTO: Usar db.table().put() - los hooks calcularán activeStockStatus
await db.table(STORES.MENU).put({
  ...existingProduct,
  stock: newStock,
  isActive: true
  // No incluir activeStockStatus - lo calcula el hook
});
```

### ✅ ACTUALIZAR LOTE

```javascript
// ✅ CORRECTO: Usar productsRepository.saveBatchAndSyncProduct()
await productsRepository.saveBatchAndSyncProduct({
  productId: 'prod-123',
  stock: 50,
  isActive: true
  // El hook en PRODUCT_BATCHES calculará activeStockStatus
});
```

---

## Patrones Prohibidos 🚫

### ❌ NO USAR saveDataSafe EN TABLAS CRÍTICAS

```javascript
// ❌ PROHIBIDO: Lanza error Motor Invariante V4.1
await saveDataSafe(STORES.MENU, { id: 'x', stock: 10 });
await saveDataSafe(STORES.PRODUCT_BATCHES, { id: 'y', stock: 5 });
```

### ❌ NO CALCULAR activeStockStatus MANUALMENTE

```javascript
// ❌ PROHIBIDO: El código de negocio nunca calcula este campo
const activeStockStatus = (isActive && stock > 0) ? 1 : 0;
await db.table(STORES.MENU).update(id, {
  stock,
  activeStockStatus // ❌ El hook lo sobrescribirá y loggeará warning
});
```

### ❌ NO USAR UPDATE PARCIAL SIN CONSIDERAR HOOKS

```javascript
// ⚠️ PELIGROSO: update() solo pasa las modificaciones al hook
// Asegúrate de que el hook fusione correctamente: { ...obj, ...modifications }
await db.table(STORES.MENU).update(id, { stock: newStock });
// ✅ El hook actual en dexie.js sí hace la fusión correctamente
```

---

## Transacciones y Concurrencia

### Anidación Automática

Si `cancelSaleCore` abre una transacción, y `restoreStockFromCancellation` también abre una transacción sobre las mismas tablas, Dexie maneja automáticamente la anidación (flattening):

```javascript
// En cancelSaleCore.js
db.transaction('rw', [SALES, DELETED_SALES, PRODUCT_BATCHES, MENU], async () => {
  // ...
  // Dentro de restoreStockFromCancellation:
  // db.transaction('rw', [PRODUCT_BATCHES, MENU], async () => {
  //   ✅ Dexie "aplana" esta transacción dentro de la outer transaction
  // });
});
```

### Rendimiento

- `bulkGet` + `put` individual dentro de transacción = **O(n)**
- No usar `bulkPut` porque no dispara hooks individuales de forma predecible
- Las operaciones individuales dentro de la misma transacción mantienen atomicidad

---

## Testing

### Ejecutar Tests del Motor Invariante

```bash
npm test src/services/db/__tests__/motorInvariante.test.js
```

### Tests Implementados

1. **Hook Enforcement**
   - `activeStockStatus` se calcula correctamente desde 0 a 5
   - `activeStockStatus=0` cuando `isActive=false`
   - Guardias ignoran intentos manuales de setear el campo

2. **Evitación de Fugas**
   - `saveDataSafe(STORES.MENU)` lanza error
   - `saveDataSafe(STORES.PRODUCT_BATCHES)` lanza error
   - Otras tablas funcionan normalmente

3. **Integridad en Cancelaciones**
   - Restauración de productos simples
   - Restauración de lotes con sincronización de padre
   - Consistencia del índice tras cancelación

4. **Consistencia de Índices**
   - `[categoryId+activeStockStatus]` funciona correctamente
   - Productos aparecen/desaparecen del índice según stock

---

## Migración desde Código Antiguo

### Paso 1: Identificar Usos Prohibidos

Buscar en codebase:
```bash
grep -r "saveDataSafe.*STORES.MENU" src/
grep -r "saveDataSafe.*STORES.PRODUCT_BATCHES" src/
```

### Paso 2: Refactorizar según Patrón

| Escenario | Antes | Después |
|-----------|-------|---------|
| Cancelación | `saveDataSafe(STORES.MENU, {...})` | `productsRepository.restoreStockFromCancellation(items)` |
| Actualizar producto | `saveDataSafe(STORES.MENU, product)` | `db.table(STORES.MENU).put(product)` |
| Guardar lote | `saveDataSafe(STORES.PRODUCT_BATCHES, batch)` | `productsRepository.saveBatchAndSyncProduct(batch)` |

### Paso 3: Verificar Tests

Asegurar que tests existentes pasen con el nuevo motor:
```bash
npm test
```

---

## Troubleshooting

### "saveDataSafe prohibido para menu"

**Causa:** Código usando `saveDataSafe` en tabla protegida  
**Solución:** Refactorizar a `db.table(STORES.MENU).put()` o método especializado

### "[HOOK GUARD] Intento de setear activeStockStatus..."

**Causa:** Código calculando `activeStockStatus` manualmente  
**Solución:** Eliminar el campo del objeto de actualización, dejar que el hook lo calcule

### Producto no aparece en Dashboard tras cancelación

**Causa:** Stock restaurado pero `activeStockStatus` no actualizado  
**Diagnóstico:**
```javascript
// En consola de navegador
const product = await db.table('menu').get('prod-id');
console.log(product.stock, product.isActive, product.activeStockStatus);
// stock > 0 && isActive !== false pero activeStockStatus === 0? -> Bug de hook
```

**Solución:** Verificar que se esté usando `restoreStockFromCancellation` y no lógica custom

---

## Changelog

### V4.1 (2024-XX-XX)

- ✅ Guardias de seguridad activas en hooks `updating` de MENU y PRODUCT_BATCHES
- ✅ Método atómico `restoreStockFromCancellation` en productsRepository
- ✅ Guardia en `saveDataSafe` para prohibir uso en tablas críticas
- ✅ Refactorización completa de `cancelSaleCore.js`
- ✅ Tests unitarios para garantizar invariantes

### V4.0 (Previo)

- Hooks básicos de `creating`/`updating` (pasivos, sin guardias)
- Fuga de abstracción permitía inconsistencias
- Código de negocio podía calcular `activeStockStatus` manualmente

---

## Referencias

- **Archivos modificados:**
  - `src/services/db/dexie.js` - Hooks con guardias
  - `src/services/db/products.js` - `restoreStockFromCancellation`
  - `src/services/sales/cancelSaleCore.js` - Refactorizado
  - `src/services/db/index.js` - Guardia en `saveDataSafe`

- **Tests:**
  - `src/services/db/__tests__/motorInvariante.test.js`

- **Dexie Hooks Documentation:**
  - https://dexie.org/docs/Table/Table.hook('creating')
  - https://dexie.org/docs/Table/Table.hook('updating')

---

**Mantenido por:** Equipo de Arquitectura Lanzo  
**Versión:** 4.1.0  
**Fecha:** 2024
