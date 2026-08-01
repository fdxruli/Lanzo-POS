# ECOM.PRODUCT.IMAGES.CLOUD.1

## Objetivo

Permitir que las fotografías de productos de licencias con sincronización cloud se vean en la tienda pública sin almacenar imágenes pesadas en la base de datos.

## Flujo

1. El formulario conserva la imagen seleccionada en IndexedDB para operación local.
2. Antes de sincronizar el producto, la imagen se decodifica respetando su orientación.
3. Se limita a un máximo de 1280 × 1280 píxeles sin deformar ni ampliar imágenes pequeñas.
4. Se codifica como WebP con calidad 0.80.
5. El archivo resultante se valida contra el límite de 4 MB.
6. `authorize-image-upload` genera una subida firmada con propósito `product-image`.
7. El archivo se guarda en el bucket público `images`.
8. La URL pública HTTPS se persiste como `image_url` en el producto cloud.
9. La sincronización del catálogo copia esa URL al producto publicado y la tienda la muestra mediante `PublicSafeImage`.

## Seguridad y límites

- Tipos aceptados: JPEG, PNG, WebP y GIF según el contrato actual de Storage.
- Tamaño máximo de entrada antes de optimizar: 20 MB.
- Tamaño máximo del archivo final para producto: 4 MB.
- La ruta debe comenzar con `public_uploads/` y se obtiene mediante autorización firmada.
- No se escriben tokens, claves de licencia ni identificadores sensibles en la URL.

## Compatibilidad

- Las licencias locales continúan guardando la imagen solo en IndexedDB.
- Las licencias cloud conservan una copia local y una URL pública.
- Al editar sin seleccionar otra fotografía, se mantiene la URL pública anterior.
- Si la subida de una fotografía nueva falla, no se guarda un producto cloud aparentemente sincronizado con una imagen inexistente.

## Recuperación de imágenes anteriores

Las referencias antiguas `img-*` existen únicamente en el IndexedDB del dispositivo que creó el producto. Para publicarlas se debe volver a seleccionar la fotografía después de desplegar esta versión.
