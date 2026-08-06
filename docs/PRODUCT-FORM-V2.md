# Product Form V2

Product Form V2 es la implementación productiva predeterminada. `ProductForm.jsx` conserva el contrato usado por `ProductsPage` y decide internamente la implementación mediante `src/components/products/productFormImplementation.js`.

## Activación y rollback

`PRODUCT_FORM_IMPLEMENTATION` es la única autoridad de despliegue. Su valor normal es `v2`; cambiarlo a `legacy` devuelve temporalmente al formulario anterior, sin exponer controles, preferencias ni parámetros públicos. El formulario legacy vive en `src/components/products/legacy/ProductFormLegacy.jsx` y no debe eliminarse hasta PRODUCT.FORM.V2.3.

## Guardado e imágenes

V2 llama `onSave(payload, existingProduct, options)`. `options` contiene `intent` (`save` o `save_and_add_another`), `keepFormOpen` y `source: 'product-form-v2'`. `ProductsPage` sigue preparando imágenes, guardando en `productRepository`, refrescando catálogo/categorías, emitiendo eventos y navegando después de un guardado ordinario.

Para una imagen nueva V2 conserva el archivo original en `imageUploadSource` para publicación cloud y usa la copia comprimida como `image` local. Las URLs `blob:` se revocan al reemplazar o desmontar. Una eliminación se expresa mediante `imageRemoved`, que evita conservar por accidente la imagen local o remota anterior.

`Guardar y agregar otro` utiliza la misma persistencia pero no navega ni abre un modal; V2 muestra una confirmación accesible, conserva el rubro, restablece defaults y enfoca el nombre. Los fallos no limpian los datos.

## Edición, inventario y estado sucio

El formulario expone `isDirty` al contenedor. `ProductsPage` activa su guarda de navegación solo cuando el formulario está abierto y tiene cambios sin guardar. La edición muestra el stock como información y el payload conserva el valor existente; no crea lote inicial ni interpreta la edición como reposición.

Los productos nuevos obtienen un ID al abrir el formulario, por lo que un reintento usa el mismo ID. El repositorio crea exactamente un lote inicial solo para una alta con existencia positiva, sin receta ni variantes.

## Rubros y paridad funcional

| Rubro | Cobertura V2 |
| --- | --- |
| General | Nombre, precio, categoría opcional, imagen, inventario y caducidad. |
| Abarrotes / ferretería | Unidad, granel/fraccionado, conversión, alertas y preservación de mayoreo existente. |
| Frutería | Pieza/peso y caducidad estricta o vida útil mutuamente excluyentes. |
| Apparel | Variantes con IDs de lote estables; el stock general no se duplica. |
| Farmacia | Datos farmacéuticos, lote/caducidad de entrada inicial y estrategia canónica `fefo`. |
| Restaurante | Platillo, bebida, producto listo e insumo; receta, modificadores y estaciones reutilizan los componentes existentes. |

No se realizan migraciones de Supabase ni despliegues manuales. La retirada de legacy, una acción independiente de reposición y la expansión visual de mayoreo quedan para fases posteriores.
