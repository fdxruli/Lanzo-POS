# HOTFIX ECOM.ORDER.CONFIGURATION.DISPLAY

Fecha: 2026-07-16 (America/Mexico_City)  
Rama: `hotfix-ecom-order-configuration-display`

## Resumen

Se corrigió la omisión visual de variantes, opciones y extras seleccionados en:

- el detalle o ticket del pedido online;
- el borrador abierto en Punto de Venta.

La configuración ya se almacenaba correctamente en `ecommerce_order_items.options`; el defecto estaba exclusivamente en las capas lectoras.

## Causa raíz

1. `ecommerceOrderService` conservaba `item.options`, pero `EcommerceOrdersPage` solo mostraba nombre, cantidad y precio.
2. `ecommercePosDraftService` copiaba el snapshot a `ecommerceOptions`, pero `OrderSummary` solo reconoce `selectedModifiers` para mostrar extras.
3. Convertir directamente el snapshot ecommerce a `selectedModifiers` habría mezclado una fotografía histórica aceptada con la configuración POS vigente y podía afectar validación de precio e inventario.

## Solución

Se añadió un formateador compartido que lee exclusivamente el snapshot inmutable del pedido y genera una descripción segura, por ejemplo:

```text
Taco al pastor — Tamaño: Regular · Extras: Queso extra (+$10.00), Sin cebolla
```

El detalle online decora `productName` al leer el pedido.

El borrador POS decora el nombre mostrado después de que el servicio canónico haya creado o reabierto el borrador. Conserva el nombre base para evitar duplicar la descripción en aperturas repetidas.

## Compatibilidad

- Pedidos actuales con `groups`, `variant` y `priceDelta`.
- Pedidos antiguos con opciones primitivas, por ejemplo `{ "salsa": "BBQ" }`.
- Productos simples sin configuración permanecen sin cambios.
- Pedidos ya creados se benefician al volver a leerlos; no requieren migración ni backfill.

## Alcance de seguridad

No se modifica:

- `selectedModifiers`;
- precio aceptado;
- inventario;
- recetas;
- lotes;
- conversión o cobro;
- datos de Supabase.

## Pruebas añadidas

- `ecommerceOrderConfigurationDisplay.test.js` del utilitario;
- prueba del decorador del detalle online;
- prueba del decorador del borrador POS y reapertura sin duplicados.
