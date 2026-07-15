# FASE ECOM.PRODUCTS.MODEL.1

Fecha: 2026-07-15 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-model-1`  
Estado: **IMPLEMENTACIÓN COMPLETA — PR PENDIENTE DE REVISIÓN**

## 1. Resumen ejecutivo

Se implementó el modelo técnico y de datos para productos ecommerce simples, fabricados por receta, configurables y agrupadores de variantes con inventario real. El stock alert dejó de clasificar automáticamente todas las recetas como `UNVERIFIED`: ahora calcula la capacidad vendible como el mínimo de las capacidades de sus ingredientes, identifica el ingrediente limitante y distingue stock cero, inventario no controlado y datos no verificables.

También se añadieron tablas normalizadas para variantes, grupos y opciones, una RPC administrativa transaccional, un resumen público seguro y una política temporal de bloqueo para productos que requieren selección hasta `ECOM.PRODUCTS.PUBLIC.1`.

## 2. Estado heredado

`pos_products` ya contenía `recipe`, `modifiers`, stock, stock comprometido, configuración de lotes y metadatos. `ecommerce_published_products` ya representaba el producto publicado, precio, disponibilidad, stock snapshot, opciones JSONB y revisión de origen. No existían tablas normalizadas para variantes, grupos ni opciones ecommerce.

## 3. Problema de recetas

El evaluador administrativo contenía una salida directa `recipe -> UNVERIFIED`. Esto provocaba “No se pudo verificar el stock” incluso cuando todos los ingredientes y sus existencias eran conocidos. La salida fue reemplazada por un evaluador puro que resuelve ingredientes y lotes sin modificar inventario.

## 4. Alcance

La fase cubre modelo canónico, stock derivado por receta, variantes vinculadas a SKU reales, grupos, opciones, consumo de ingredientes por opción, contratos administrativos/públicos, seguridad entre licencias, migraciones, pruebas y reporte.

## 5. Fuera de alcance

No se implementaron selector público, modal de configuración, líneas de carrito configurables, `variantId`, `optionIds`, descuento de extras, conversión POS de variantes, comandas configuradas, pagos, entrega, SEO ni personalización Pro.

## 6. Modelo canónico

El modelo usa versión `1` y cuatro tipos:

- `simple`
- `recipe`
- `variant_parent`
- `configurable`

Flags complementarios: `hasRecipe`, `hasVariants`, `hasOptionGroups`, `requiresConfiguration` y `tracksDerivedStock`.

| Tipo | Fuente de stock | Resultado |
|---|---|---|
| Simple | Producto fuente | Stock directo |
| Recipe | Ingredientes | Mínimo de capacidades |
| Variant parent | SKU hijos | Agregado de variantes |
| Configurable sin inventario | Producto base | Stock base |
| Opción con ingrediente | Ingrediente de opción | Preparado para PUBLIC.1 |
| No controlado | Ninguna | not_tracked |
| Fuente incompleta | Desconocida | unverified |

## 7. Producto simple

Los productos existentes conservan `configuration_type='simple'`, versión `1`, flags en `false` y `availability_source='direct'`. No se cambió su stock, disponibilidad ni contrato de checkout.

## 8. Producto recipe

Una receta no vacía se clasifica como `recipe`. El stock derivado se calcula a partir de los ingredientes controlados. Una receta sin grupos obligatorios no requiere interacción pública adicional.

## 9. Variant parent

Representa una familia comercial que agrupa combinaciones vendibles concretas. Cada variante enlaza un producto/SKU existente de Lanzo; ecommerce no crea un inventario paralelo.

## 10. Configurable

Representa productos con grupos de opciones o modificadores. Puede combinar producto base, receta y consumo de ingredientes por opción.

## 11. Variantes

Se creó `public.ecommerce_published_product_variants`. `option_values` guarda la combinación completa, por ejemplo `{"color":"Negro","talla":"26"}`. Existen constraints de precio, orden, SKU normalizado, objeto JSONB, fuente requerida, unicidad por referencia, fuente y combinación activa.

## 12. Grupos

Se creó `public.ecommerce_published_option_groups` con selección `single` o `multiple`, obligatoriedad, mínimos, máximos, orden y soft delete. Un grupo `single` no puede aceptar más de una selección.

## 13. Opciones

Se creó `public.ecommerce_published_options` con incremento de precio no negativo, referencia opcional a ingrediente, cantidad, unidad, control de inventario, disponibilidad y orden.

## 14. Vínculos de inventario

Variantes e ingredientes son validados dentro de la misma licencia y portal. Los triggers rechazan referencias cruzadas y opciones bajo grupos ajenos. La autoridad de inventario permanece en `pos_products` y `pos_product_batches`.

## 15. Algoritmo de receta

1. Valida receta, ingrediente, cantidad y estado.
2. Omite ingredientes con `track_stock=false` como limitantes.
3. Resuelve unidad compatible.
4. Calcula stock disponible menos comprometido.
5. Para lotes usa solo lotes activos, no bloqueados y no vencidos.
6. Convierte a la unidad de receta.
7. Calcula `floor(disponible / consumo)`.
8. Selecciona el mínimo e identifica el limitante.
9. Nunca modifica inventario.

## 16. Unidades

Se normalizan alias de `pza`, `kg`, `g`, `lt`/`l` y `ml`. Se soportan `1 kg = 1000 g` y `1 lt = 1000 ml`. No se convierten dimensiones incompatibles.

## 17. Lotes

Se respetan FEFO, stock comprometido, soft delete, estado activo y caducidad. `expires_today` sigue siendo vendible. Lotes vencidos, inactivos o bloqueados no cuentan.

## 18. Ingrediente limitante

La evaluación devuelve `limitingIngredientId`, `limitingIngredientName`, capacidad y componentes. Los identificadores internos no se incluyen en el contrato público.

## 19. Estados de disponibilidad

| Estado | Significado | Checkout actual |
|---|---|---|
| in_stock | Capacidad positiva | Permitido si no requiere configuración |
| out_of_stock | Capacidad cero confirmada | Bloqueado |
| unverified | No puede calcularse con certeza | Política segura |
| not_tracked | Inventario intencionalmente no controlado | Permitido |
| inactive_source | Fuente inactiva | Bloqueado |
| source_missing | Fuente inexistente | Bloqueado |
| configuration_required | Requiere PUBLIC.1 | Bloqueado temporalmente |

Códigos de receta implementados: `RECIPE_CAPACITY_CALCULATED`, `RECIPE_CAPACITY_ZERO`, `RECIPE_INGREDIENT_MISSING`, `RECIPE_INGREDIENT_INACTIVE`, `RECIPE_QUANTITY_INVALID`, `RECIPE_UNIT_INCOMPATIBLE`, `RECIPE_STOCK_INVALID`, `RECIPE_BATCH_READ_FAILED` y `RECIPE_ALL_INGREDIENTS_UNTRACKED`.

## 20. Stock alert

El stock alert preserva caché, single-flight, epoch, contexto por licencia, lotes, stock comprometido e invalidación. Para una receta válida devuelve `in_stock`/`out_of_stock`, capacidad aproximada e ingrediente limitante. Los errores entregan códigos seguros sin costos ni metadatos privados.

## 21. Free

Conserva máximo de 10 productos publicados y stock público oculto. Puede almacenar recetas, variantes y opciones y recibir disponibilidad derivada. No se añadió restricción artificial Pro.

## 22. Pro

Conserva catálogo cloud, productos según su contrato vigente y visibilidad de stock según configuración. No se modificaron límites ni capacidades del plan.

## 23. Sincronización

Se añadió `ecommerce_admin_sync_product_configuration`. Valida payload, tamaño, profundidad, límites y alcance; sincroniza producto, variantes, grupos y opciones en una sola transacción; retira únicamente hijos omitidos del mismo producto y actualiza la revisión de origen.

Límites: 100 variantes, 20 grupos, 100 opciones, 50 caracteres por valor de atributo, 512 KiB y profundidad JSON máxima de 6.

## 24. Transacciones

La RPC es atómica. Dos defectos detectados por las pruebas —ramas de trigger compartido y soft delete coordinado— fueron corregidos mediante migraciones compensatorias independientes, sin editar migraciones aplicadas.

## 25. RPC admin

El contrato administrativo devuelve tipo, versión, flags, fuente/motivo de disponibilidad, limitante y conteos de variantes, grupos y opciones. Se conserva autenticación de licencia, dispositivo, staff y permiso `ecommerce`.

## 26. Contrato público

El catálogo público conserva todos sus campos y añade solamente:

```json
{
  "configuration": {
    "type": "simple",
    "version": 1,
    "hasVariants": false,
    "hasOptionGroups": false,
    "requiresConfiguration": false
  }
}
```

No expone IDs de productos fuente, ingredientes, costos, staff, dispositivos ni metadatos privados.

## 27. Seguridad

Las tres tablas tienen RLS activado, políticas explícitas de denegación para `anon`/`authenticated`, sin grants directos de cliente y acceso mediante RPC. Las funciones sensibles son `SECURITY DEFINER` con `search_path` vacío. El asesor de seguridad no reportó advertencias nuevas atribuibles a estas tablas.

## 28. Migración

Se crearon cuatro migraciones: una principal y tres compensatorias. La última añade índices de cobertura señalados por el asesor de rendimiento.

## 29. Historial remoto

| Versión remota | Nombre |
|---|---|
| `20260715190958` | `ecom_products_model_1` |
| `20260715191822` | `ecom_products_model_1_child_guard_fix` |
| `20260715192025` | `ecom_products_model_1_option_soft_delete_fix` |
| `20260715192456` | `ecom_products_model_1_fk_indexes` |

## 30. Tests SQL

`supabase/tests/ecom_products_model_1_test.sql` ejecutó 30/30 casos dentro de `BEGIN`/`ROLLBACK`. Cubrió receta, unidades, stock comprometido, lotes, seguridad, atomicidad, staff, contratos Free/Pro y ausencia de efectos operativos. La comprobación posterior devolvió cero fixtures en todas las tablas verificadas.

## 31. Tests JavaScript

Se crearon pruebas de modelo, IDs estables, grupos, opciones, límites, conversiones, receta, FEFO, caducidad, committed stock, errores seguros, integración con stock alert y contrato administrativo. Total preparado: 31 casos en los archivos relacionados con esta fase.

## 32. Builds pendientes o ejecutados

No se ejecutaron `npm ci`, Vitest, ESLint ni build: el entorno conectado de ChatGPT no dispone de una copia instalable del repositorio y no se inventaron resultados. Se realizó revisión estática y validación SQL remota completa. La ejecución local Node queda pendiente para la revisión del PR.

## 33. Git

La rama fue creada desde `main` en `68e3b6ee7764b98c96cbfdccf928122c8ed573eb`. No se realizaron escrituras en `main`.

## 34. Rama

`fase-ecom-products-model-1`.

## 35. PR

Único PR draft: pendiente de creación al cierre del reporte. No se hará merge automático.

## 36. Vercel

Deployments manuales: 0. Previews deliberados: 0. Cambios de proyectos, dominios, variables, builds o integración Git: 0.

## 37. Archivos creados

- `src/utils/ecommerceProductConfiguration.js`
- `src/services/ecommerce/ecommerceRecipeAvailability.js`
- `src/utils/__tests__/ecommerceProductConfiguration.test.js`
- `src/services/ecommerce/__tests__/ecommerceRecipeAvailability.test.js`
- `src/services/ecommerce/__tests__/ecommercePublishedStockAlertRecipe.test.js`
- `supabase/migrations/20260715190000_ecom_products_model_1.sql`
- `supabase/migrations/20260715193000_ecom_products_model_1_child_guard_fix.sql`
- `supabase/migrations/20260715194500_ecom_products_model_1_option_soft_delete_fix.sql`
- `supabase/migrations/20260715195500_ecom_products_model_1_fk_indexes.sql`
- `supabase/tests/ecom_products_model_1_test.sql`
- `docs/reports/ECOM.PRODUCTS.MODEL.1.md`

## 38. Archivos modificados

- `src/services/ecommerce/ecommercePublishedStockLocalSource.js`
- `src/services/ecommerce/ecommercePublishedStockAlertService.js`
- `src/services/ecommerce/ecommerceAdminService.js`
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`

## 39. Riesgos

- Vitest, ESLint y builds deben ejecutarse localmente antes de aprobar el PR.
- El agregado y selección pública de variantes queda intencionalmente bloqueado hasta PUBLIC.1.
- Los índices nuevos aparecen inicialmente como “unused” porque las tablas aún no tienen tráfico; no deben eliminarse antes de medir uso real.
- El cálculo cloud de receta depende de que la sincronización envíe el snapshot/motivo; el cálculo local ya está integrado al stock alert.

## 40. Compatibilidad

No se modificaron `ecommerce_create_order`, pedidos, ventas, caja, inventario, pagos ni conversión POS. `options jsonb` se conserva. Productos simples, Free y Pro mantienen sus contratos.

## 41. Pruebas manuales

1. Publicar una hamburguesa con pan, carne y queso y comprobar capacidad 10.
2. Agotar el ingrediente limitante y comprobar `out_of_stock`.
3. Probar kg/g y lt/ml.
4. Probar lote vencido, inactivo y que vence hoy.
5. Sincronizar una familia de SKU y confirmar que el producto queda visible pero no comprable.
6. Probar staff con y sin permiso ecommerce.
7. Confirmar stock oculto en Free y política vigente en Pro.
8. Ejecutar Vitest, ESLint y builds localmente.

## 42. Conclusión

El stock de recetas ya se calcula por ingrediente limitante y dejó de ser `UNVERIFIED` de forma automática. Variantes y opciones tienen un modelo normalizado, seguro y aislado por licencia. Los productos actuales conservan compatibilidad. La fase queda lista para revisión; `ECOM.PRODUCTS.PUBLIC.1` deberá implementar selección, cálculo de precio, carrito configurable y validación server-side de elecciones.

| Recurso | Cantidad |
|---|---:|
| Migraciones creadas | 4 |
| Migraciones aplicadas | 4 |
| Tablas creadas | 3 |
| Columnas añadidas | 10 |
| Funciones creadas/modificadas | 11 |
| Tests SQL | 30 casos / 1 archivo |
| Tests JavaScript | 31 casos / 4 archivos |
| Fixtures residuales | 0 |
| Pedidos residuales | 0 |
| Deployments manuales | 0 |
| Previews deliberados | 0 |
| Proyectos nuevos | 0 |
