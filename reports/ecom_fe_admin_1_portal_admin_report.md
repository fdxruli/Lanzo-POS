# ECOM.FE.ADMIN.1 — Configuración interna del portal ecommerce desde el POS

## Resultado

**ECOM.FE.ADMIN.1 PASS**

La administración interna del portal online quedó implementada en el frontend del POS, versionada en GitHub y respaldada por RPC administrativas seguras aplicadas en Supabase producción `odlrhijtfyavryeqivaa`.

La fase no crea la tienda pública `/tienda/:slug` ni conecta pedidos ecommerce con ventas, caja o inventario POS.

## Ejecución

- Repositorio: `fdxruli/Lanzo-POS`
- Rama: `fase-ecom-fe-admin-1`
- Pull request: `#80`
- Proyecto Supabase: `odlrhijtfyavryeqivaa`
- Migración aplicada: `20260710035722_ecom_fe_admin_1_portal_admin_rpcs`
- Migración versionada: `supabase/migrations/20260710035722_ecom_fe_admin_1_portal_admin_rpcs.sql`
- Operaciones destructivas: ninguna
- Datos de prueba persistidos: ninguno; las pruebas de creación FREE/PRO se ejecutaron con rollback transaccional

## 1. Archivos modificados

### Frontend

- `src/pages/SettingsPage.jsx`
  - integra la pestaña `Configuración > Portal online`;
  - la pestaña solo es visible con permiso existente `settings` y `currentDeviceRole === 'admin'`.
- `src/services/ecommerce/ecommerceAdminService.js`
  - encapsula las cinco RPC administrativas;
  - usa el cliente Supabase normal;
  - obtiene el contexto seguro existente de licencia, fingerprint y security token;
  - no usa ni expone service role.
- `src/components/ecommerce/EcommercePortalSettings.jsx`
  - pantalla principal;
  - estados loading, error, empty y success;
  - creación/edición, publicación/pausa, link reservado, diferencias FREE/PRO y productos publicados.
- `src/components/ecommerce/EcommerceProductPublishModal.jsx`
  - selector de producto local;
  - edición del snapshot público;
  - validación de nombre, precio, disponibilidad, publicación y orden.
- `src/components/ecommerce/EcommercePortalSettings.css`
  - estilos responsive;
  - uso de variables visuales existentes para claro/oscuro;
  - sin librerías nuevas.

### Supabase

- `supabase/migrations/20260710035722_ecom_fe_admin_1_portal_admin_rpcs.sql`
  - helpers privados de autorización, errores controlados, slug y serialización;
  - cinco RPC administrativas públicas;
  - grants limitados a ejecución de RPC;
  - ningún grant directo sobre tablas ecommerce.

### Reporte

- `reports/ecom_fe_admin_1_portal_admin_report.md`

## 2. RPCs creadas

### `public.ecommerce_admin_get_portal(...)`

Lee el portal de la licencia validada, capacidades por plan y conteo publicado.

Request:

```json
{
  "p_license_key": "<credencial obtenida del estado seguro>",
  "p_device_fingerprint": "<fingerprint estable>",
  "p_security_token": "<token del dispositivo>"
}
```

Response resumida:

```json
{
  "success": true,
  "plan": {
    "code": "free_trial | pro_monthly",
    "name": "...",
    "isPro": false
  },
  "features": {
    "portalEnabled": true,
    "maxPublishedProducts": 10,
    "customSlug": false,
    "stockVisibility": false,
    "realtimeOrders": false,
    "cloudCatalogSource": false
  },
  "portal": null,
  "publishedProductCount": 0
}
```

### `public.ecommerce_admin_upsert_portal(...)`

Crea o actualiza el portal de la licencia resuelta por el backend.

Request adicional:

```json
{
  "p_payload": {
    "name": "Mi negocio",
    "headline": "Frase corta",
    "description": "Descripción pública",
    "whatsappPhone": "9610000000",
    "address": "Dirección pública",
    "pickupEnabled": true,
    "deliveryEnabled": false,
    "minOrderTotal": 0,
    "status": "draft | published | paused",
    "slug": "mi-negocio"
  }
}
```

El backend ignora personalización avanzada no habilitada, fuerza stock oculto en FREE y genera el slug cuando el plan no permite personalizarlo.

### `public.ecommerce_admin_list_published_products(...)`

Devuelve todos los snapshots activos del portal, incluyendo publicados y despublicados, más el conteo publicado y el límite del plan.

### `public.ecommerce_admin_upsert_published_product(...)`

Crea o edita un snapshot público.

Payload principal:

```json
{
  "sourceType": "local_snapshot",
  "localProductRef": "<id local>",
  "publicName": "Nombre público",
  "publicDescription": "Descripción pública",
  "categoryName": "Categoría",
  "price": 50,
  "isPublished": true,
  "isAvailable": true,
  "displayOrder": 1,
  "stockMode": "hidden",
  "metadata": {
    "source": "admin_ui"
  }
}
```

### `public.ecommerce_admin_set_product_published(...)`

Publica o despublica un producto existente validando que pertenece a la licencia activa.

Todas las RPC devuelven errores JSON controlados con:

```json
{
  "success": false,
  "code": "ECOMMERCE_*",
  "message": "Mensaje seguro para UI"
}
```

## 3. Validación de licencia y dispositivo

Cada RPC llama a `private.ecommerce_admin_authorize(...)`.

La autorización:

1. exige `license_key`, `device_fingerprint` y `security_token` no vacíos;
2. aplica el rate limiter existente `public.enforce_pos_rpc_rate_limit_v2` con scope `ECOM_ADMIN`;
3. resuelve la licencia internamente y exige estado activo y vigencia válida;
4. valida un registro activo en `public.license_devices`;
5. exige `device_role = 'admin'`;
6. acepta el token actual o anterior durante la ventana de rotación existente;
7. valida `ecommerce_portal_enabled` mediante el helper existente;
8. no devuelve `license_key`, security token ni fingerprint en la respuesta.

No se acepta `license_id` desde el frontend.

## 4. Diferencias FREE y PRO

### Plan Free

- portal habilitado;
- slug generado por sistema;
- campo slug bloqueado en UI;
- máximo 10 productos publicados;
- `stock_mode = 'hidden'` forzado en backend;
- plantilla fija `classic`;
- personalización básica;
- snapshot controlado desde catálogo local.

Copy visible:

> En Plan Free el enlace se genera automáticamente.

> Plan Free permite publicar hasta 10 productos. Actualiza a Lanzo Nube para productos ilimitados.

### Lanzo Nube / PRO

- slug editable;
- productos publicados ilimitados mediante feature `-1`;
- UI preparada para logo, portada, color principal y plantilla;
- personalización avanzada no implementada todavía y mostrada como placeholder;
- la fase usa también snapshot controlado para evitar bloquearse por sincronización cloud automática.

Copy visible:

> En Lanzo Nube puedes personalizar el enlace de tu tienda.

> Disponible en una fase posterior de Portal PRO.

La sincronización cloud completa queda documentada para `ECOM.FE.CATALOG.2`.

## 5. Protección del slug FREE vs PRO

La protección existe en dos capas.

Frontend:

- FREE muestra el campo deshabilitado;
- PRO valida entre 3 y 64 caracteres;
- patrón permitido: minúsculas, números y guiones;
- no permite iniciar ni terminar con guion.

Backend:

- FREE conserva el slug existente o llama a `private.ecommerce_admin_generate_slug(...)`;
- si FREE intenta enviar otro slug, devuelve `ECOMMERCE_CUSTOM_SLUG_REQUIRES_PRO`;
- PRO aplica la misma validación de formato;
- la unicidad se valida antes del write y también mediante la restricción existente;
- conflictos devuelven `ECOMMERCE_SLUG_TAKEN`.

Prueba real controlada:

- intento de slug personalizado en FREE: rechazado con `ECOMMERCE_CUSTOM_SLUG_REQUIRES_PRO`;
- slug FREE generado en simulación rollback: `qa-ecom-fe-admin-free-45a3acb0`;
- slug PRO personalizado aceptado en simulación rollback: `qa-ecom-fe-admin-pro`.

## 6. Límite FREE de 10 productos

La UI calcula el conteo sobre productos con `isPublished = true` y bloquea el botón al llegar al límite.

La autoridad final permanece en Supabase:

- la RPC escribe mediante `public.ecommerce_published_products`;
- el trigger existente de ECOM.DB.1 valida el máximo del plan;
- la RPC traduce el error a `ECOMMERCE_PRODUCT_LIMIT_REACHED`.

Prueba real sobre el portal QA FREE ya ubicado en 10 productos:

- intento de publicar producto 11: rechazado;
- código: `ECOMMERCE_PRODUCT_LIMIT_REACHED`;
- filas insertadas por el intento: `0`;
- conteo final publicado: `10`.

Prueba PRO con rollback:

- portal PRO temporal creado;
- 11 snapshots publicados correctamente;
- conteo dentro de la transacción: `11`;
- último producto: `success = true`;
- después del rollback no quedó portal ni producto de prueba.

## 7. Protección de stock FREE

- la UI actual envía `stockMode = 'hidden'`;
- el backend fuerza `hidden` cuando `ecommerce_stock_visibility` es falso;
- FREE no puede activar `status` ni `exact` manipulando el payload;
- no se consulta ni se descuenta inventario POS;
- stock y reservas reales quedan para una fase posterior.

## 8. No afectación a ventas, caja, inventario o reportes

La fase solo administra:

- `public.ecommerce_portals`;
- `public.ecommerce_published_products`;
- infraestructura existente del rate limiter.

La inspección de las cinco definiciones RPC activas confirmó ausencia de referencias a:

- `pos_sales`;
- `pos_sale_items`;
- `pos_cash`;
- `cash_session`;
- `inventory`;
- reportes POS.

No se creó venta, movimiento de caja, descuento de inventario, lote, reserva ni reporte.

## 9. Staff y permisos

- la pestaña se muestra solo con permiso existente `settings` y dispositivo `admin`;
- las RPC vuelven a exigir `device_role = 'admin'`, por lo que ocultar o alterar la UI no evita la autorización;
- no se agregó un permiso nuevo para no romper el modelo staff actual;
- pendiente futuro: permiso granular `ecommerce_portal_manage` si se decide delegar esta función a un staff específico.

## 10. UX implementada

La pantalla incluye:

- estado de carga;
- error con reintento;
- estado vacío con botón `Crear portal online`;
- badge FREE/PRO;
- estado draft/published/paused/disabled;
- link reservado `${window.location.origin}/tienda/${slug}`;
- botón copiar link;
- leyenda de que la página pública se activará después;
- formulario de datos públicos;
- publicar/pausar portal;
- contador de productos;
- lista de snapshots publicados/despublicados;
- modal para publicar y editar;
- success/error toast;
- estilos responsive para móvil/tablet;
- variables de tema existentes para claro/oscuro.

No se creó ninguna ruta React para `/tienda/:slug`.

## 11. Validaciones y pruebas realizadas

### Build

Vercel ejecutó sobre el commit de la rama:

```text
npm run build
vite build
3256 modules transformed
built in 23.10s
Deployment READY
```

**Resultado: PASS**

Advertencias no bloqueantes observadas:

- imports dinámicos y estáticos ya compartidos en módulos existentes;
- chunk principal superior a 1000 kB;
- bases de datos de Browserslist/Baseline desactualizadas.

No hubo error de compilación.

### Lint y sintaxis

- `node --check` sobre el servicio: PASS;
- parseo TypeScript/JSX sin emisión sobre los archivos nuevos: PASS;
- `npm run lint` independiente no se ejecutó porque el repositorio no tiene un check de lint asociado al PR y el entorno local de validación no pudo clonar el repositorio por resolución DNS. El build completo de Vercel sí compiló el código final con dependencias reales.

### Búsqueda estática

En los componentes y servicio frontend nuevos:

- `VITE_SUPABASE_SERVICE_ROLE_KEY`: ausente;
- `service_role`: ausente;
- `license_key` renderizado o mostrado en UI: ausente;
- grants SQL: ausentes;
- referencias a ventas/caja/inventario: ausentes;
- registro de ruta `/tienda/:slug`: ausente.

En la migración:

- no existe `grant select on public.ecommerce_*`;
- no existe `grant insert on public.ecommerce_*`;
- no existe `grant update on public.ecommerce_*`;
- `service_role` solo aparece como rol backend autorizado a ejecutar funciones;
- las tablas permanecen cerradas a `anon`, `authenticated` y `PUBLIC`.

### Seguridad Supabase

- cinco RPC públicas con `SECURITY DEFINER`: PASS;
- cinco RPC públicas con `search_path = ''`: PASS;
- execute para `anon`/`authenticated`: habilitado solo en RPC públicas;
- execute heredado para `PUBLIC`: revocado;
- cinco helpers privados cerrados para `anon`, `authenticated` y `PUBLIC`: PASS;
- grants directos sobre tablas ecommerce para roles cliente: `0`;
- RLS continúa activo en las siete tablas ecommerce: PASS;
- credenciales inválidas devuelven JSON controlado: PASS;
- respuestas FREE/PRO no contienen propiedad `license_key`: PASS.

### Pruebas funcionales mínimas

1. FREE sin portal
   - RPC devuelve `portal: null`;
   - UI entra al empty state y muestra `Crear portal online`.
2. FREE crear portal
   - simulación real con rollback: `success = true`;
   - slug generado por sistema;
   - campo no editable en UI;
   - ningún dato quedó persistido tras rollback.
3. FREE publicar producto
   - simulación real con rollback: producto 1 publicado;
   - conteo subió a `1` dentro de la transacción.
4. FREE límite 10
   - producto 11 rechazado;
   - conteo permaneció en `10`;
   - fila rechazada inexistente.
5. PRO
   - slug personalizado aceptado;
   - 11 productos publicados en simulación rollback;
   - no se aplicó límite FREE.
6. Pausar/publicar
   - FREE pasó por `draft -> published -> paused` dentro de la simulación;
   - PRO pasó de `draft -> published`;
   - rollback confirmado.
7. Link copiable
   - construcción estática confirmada con `window.location.origin` y `/tienda/${slug}`;
   - ruta marcada como reservada, no activa.
8. No POS
   - definiciones RPC sin tablas de venta/caja/inventario/reportes;
   - ningún registro POS creado.

## 12. Pendientes explícitos

Quedan fuera de ECOM.FE.ADMIN.1:

- `/tienda/:slug`;
- carrito público;
- checkout público frontend;
- bandeja de pedidos online;
- realtime de pedidos;
- conversión a venta POS;
- sincronización cloud automática del catálogo (`ECOM.FE.CATALOG.2`);
- stock y reserva real;
- pagos en línea;
- WhatsApp Cloud API;
- uploads específicos de banner/portada;
- permiso granular `ecommerce_portal_manage`.

## 13. Riesgos residuales

1. La pantalla carga como máximo 500 productos locales para el selector. Catálogos mayores necesitarán búsqueda/paginación dedicada.
2. El catálogo PRO usa snapshot controlado en esta fase; cambios del producto cloud/local no actualizan automáticamente el snapshot público.
3. Los avisos de tamaño de bundle son preexistentes y no bloquean la fase, pero conviene continuar el code splitting general.
4. La personalización avanzada está preparada visualmente, pero no guarda banner ni uploads nuevos.
5. La ruta reservada todavía dará el comportamiento general del router hasta implementar la fase pública.
6. El permiso granular para delegar administración ecommerce a staff sigue pendiente; por ahora solo administra el dispositivo owner/admin.

## Cierre

**ECOM.FE.ADMIN.1 PASS**

La configuración interna del portal online queda lista para revisión y merge del PR #80. El backend está aplicado en producción, el frontend compila en Vercel y las reglas FREE/PRO se validaron sin dejar datos de prueba persistentes.
