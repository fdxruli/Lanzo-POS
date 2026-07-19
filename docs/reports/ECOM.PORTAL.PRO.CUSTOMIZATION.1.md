# ECOM.PORTAL.PRO.CUSTOMIZATION.1 — reporte técnico

## Resumen

Se implementó personalización visual acotada para Portal PRO: tres plantillas, colores seguros, esquinas, tipografía de sistema, logo y portada mediante el flujo firmado existente. No se incorporó CSS, HTML, JavaScript ni constructor libre.

## Git

- HEAD inicial remoto de `main`: `5bf6dc8f5d7c5c8d0ddc904dbbe1676efb27ad1d`.
- Merge-base de la rama: `5bf6dc8f5d7c5c8d0ddc904dbbe1676efb27ad1d`.
- Rama: `fase-ecom-portal-pro-customization-1`.
- PR #120: cerrado y mergeado antes de iniciar.
- HEAD final: se completa al crear el commit de esta fase.

## Arquitectura

- `src/utils/ecommercePortalTheme.js` normaliza entradas desconocidas y emite exclusivamente variables CSS conocidas.
- `EcommercePortalCustomizationPanel` encapsula edición, preview, reset, upload firmado y revocación de Object URLs.
- `PublicStorePage` normaliza antes de aplicar `data-template-code` y el estilo de variables limitado al shell público.
- El guardado no emite ningún evento de sincronización de catálogo ni altera `catalogRevision`.

Contrato final de `theme`:

```json
{
  "primaryColor": "#0284c7",
  "secondaryColor": "#0369a1",
  "cornerStyle": "rounded",
  "fontStyle": "system"
}
```

Plantillas: `classic`, `showcase`, `compact`. Valores inválidos caen a `classic` en cliente y se rechazan por la RPC.

## Free y PRO

Free conserva `classic`, `basic`, `{}` y portada nula desde la autoridad SQL. El logo básico no se borra. PRO recibe controles activos y la RPC entrega las capacidades `brandingCustomization`, `layoutCustomization`, `customSlug`, `stockVisibility` y `cloudCatalogSource`.

## Imágenes

Se reutiliza `uploadImageFile` con `BUSINESS_LOGO` y `BUSINESS_COVER`. La Edge Function existente fue inspeccionada, no modificada ni redeployada: valida licencia/dispositivo/staff, limita tamaño/tipo, genera ruta en servidor y crea URL firmada sin overwrite. No se crearon objetos de prueba.

## Supabase

- Migración aplicada: `20260719070213_ecom_portal_pro_customization_hardening`.
- Helpers privados: normalización de plantilla, tema y URL de imagen.
- La sobrecarga staff de `ecommerce_admin_upsert_portal` conserva autorización v2, rate limiting, licencia, dispositivo y staff session.
- Se revocó ejecución de helpers para `anon`/`authenticated`; la comprobación confirmó que `anon` tampoco tiene `SELECT` sobre `public.ecommerce_portals`.
- No se modificaron migraciones históricas, bucket ni Edge Function.

## Validaciones

- PASS: prueba focalizada de `ecommercePortalTheme` (3 casos).
- PASS: lint focalizado de los archivos modificados.
- PASS: migración aplicada; validaciones transaccionales de plantilla, tema, colores, URLs y grants.
- PASS: `git diff --check`.
- NO CONCLUYENTE: `npm run lint`, `npm run test:ci`, `npm run build`, `npm run build:store` y React Doctor no produjeron un resultado final antes del límite de 60 s del entorno.

## Matriz manual preparada

1. Free: comprobar tarjeta bloqueada, clásico y guardado básico.
2. PRO admin: escoger `showcase`, cambiar tema, subir/desvincular imágenes, guardar, recargar y completar carrito/checkout.
3. PRO staff con `settings` + `ecommerce`: guardar; sin permisos: confirmar cero RPCs/uploads.
4. Offline: intentar subida y confirmar preservación del estado persistido.

## Riesgos residuales

Los asesores de Supabase todavía reportan avisos preexistentes de RLS/funciones de otras áreas; no se introdujo acceso directo a tablas ni ejecución pública de los helpers nuevos. No se modificaron catálogo, lotes, inventario, pedidos, caja o ventas. La importación dinámica de `buildPosSyncAuthContext` sigue presente. No se hizo merge automático; el PR se creará como draft.
