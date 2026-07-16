# HOTFIX ECOM.CONFIGURED.DRAFT.RECOVERY

Fecha: 2026-07-16 (America/Mexico_City)

## Incidente

Después de recuperar la reserva vencida del pedido EC-00000068, el borrador POS volvió a comparar mal el precio y dejó de representar correctamente los extras.

La evidencia remota permanece correcta: Papas a la francesa con precio base de 45 MXN, Queso extra por 12 MXN, precio final de 57 MXN e ingrediente ing_rest_queso_oaxaca por 0.05 kg.

## Causa raíz

El reconciliador construía su mapa únicamente con la página visible de useProductStore.menu. Cuando el producto no estaba en esa página, utilizaba el propio artículo ecommerce como producto de respaldo. Ese artículo ya tenía price igual a 57, porque es el precio final aceptado. Después volvía a sumar el queso de 12 MXN y podía calcular 69 MXN.

El mismo respaldo podía perder el vínculo de extras si el catálogo visible estaba vacío durante la hidratación o después de una invalidación.

## Corrección

El precio final aceptado ya no se usa como precio base. Cuando el producto no está en la página visible, se utiliza el snapshot del producto conservado en el borrador y se recupera el precio base previamente reconciliado o el precio base aceptado. Los modificadores conservados vuelven a construir selectedModifiers con ingrediente, cantidad y unidad.

También se registra si la fuente utilizada fue catalog o draft_snapshot.

## Seguridad

No cambia item.price, ecommerceSnapshotPrice, subtotal, total ni el snapshot financiero. No modifica Supabase ni aplica migraciones. Las opciones que no pueden mapearse siguen bloqueando inventario.

## Pruebas añadidas

Se cubre un borrador recuperado sin producto en la página visible, la conservación del precio base 45 MXN, el precio configurado 57 MXN, Queso extra y su ingrediente, y una segunda reconciliación sin duplicar extras.
