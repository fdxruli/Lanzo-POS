# Product Form V2

Product Form V2 es la única implementación de alta y edición de productos. `ProductForm.jsx` conserva el contrato estable usado por `ProductsPage` y renderiza V2 directamente.

## Guardado e imágenes

V2 llama `onSave(payload, existingProduct, options)`. `options` contiene `intent` (`save` o `save_and_add_another`), `keepFormOpen` y `source: 'product-form-v2'`. `ProductsPage` prepara imágenes, persiste mediante `productRepository`, actualiza catálogo y categorías, emite eventos y navega tras un guardado ordinario.

Las imágenes nuevas conservan el archivo original en `imageUploadSource` para publicación cloud y una copia comprimida como `image` local. Las URLs `blob:` se revocan al reemplazar o desmontar; `imageRemoved` evita conservar imágenes anteriores.

`Guardar y agregar otro` usa la misma persistencia sin navegar, conserva el rubro, restaura valores por defecto y devuelve el foco al nombre. Los fallos no limpian los datos.

## Edición, inventario y estado sucio

El formulario comunica `isDirty` al contenedor. `ProductsPage` activa la guarda de navegación únicamente si el formulario está abierto y hay cambios sin guardar. Al editar, el stock se muestra como información: la edición no crea lotes iniciales ni se interpreta como reposición.

Los productos nuevos reciben un ID al abrir el formulario, por lo que un reintento usa el mismo ID. El repositorio crea un lote inicial solo en altas con existencia positiva, sin receta ni variantes.

## Rubros y paridad funcional

| Rubro | Cobertura V2 |
| --- | --- |
| General | Nombre, precio, categoría opcional, imagen, inventario y caducidad. |
| Abarrotes / ferretería | Unidad, granel/fraccionado, conversión, alertas y mayoreo existente. |
| Frutería | Pieza/peso y caducidad estricta o vida útil mutuamente excluyentes. |
| Apparel | Variantes con IDs de lote estables; el stock general no se duplica. |
| Farmacia | Datos farmacéuticos, lote/caducidad de entrada inicial y estrategia `fefo`. |
| Restaurante | Platillo, bebida, producto listo e insumo; receta, modificadores y estaciones reutilizan componentes compartidos. |

## Legacy retirement completed

- Fecha: 2026-08-10.
- PR: pendiente de crear para `refactor/product-form-v2-legacy-retirement`.
- Retirado: selector de implementación, `ProductFormLegacy`, modos asistido/experto, wizards, formularios expertos, hooks, estilos y pruebas exclusivos de legacy.
- Conservado: `CategorySelect`, `ProductImagePicker`, `QuickVariantEntry`, `RecipeBuilderModal`, `ScannerModal` y `RestauranteFields`, porque V2 continúa utilizándolos.
- Tests: la cobertura de V2 mantiene los flujos de producto general, inventario, apparel, farmacia, restaurante, imágenes, lotes, variantes y caducidad.
- Base de datos: no se crearon ni aplicaron migraciones; no hubo cambios de esquema ni datos.
