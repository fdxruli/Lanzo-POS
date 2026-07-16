# FASE ECOM.PRODUCTS.PUBLIC.1 — Variantes, extras y configuración pública

Fecha: 2026-07-15/16 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-public-1`  
Base: `main` en `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`

## Resumen ejecutivo

PUBLIC.1 implementó variantes, grupos, opciones, extras, precio estimado, carrito configurable, edición, payload mínimo y checkout server-side autoritativo. PUBLIC.1.1 corrigió `manual_available`, separó la versión del esquema de la revisión del contenido, propagó `configurationRevision` por cliente/checkout/snapshot e incorporó rate limit individual HMAC y global.

PUBLIC.1.2 corrige los bloqueantes residuales:

1. revisión, contenido y precio podían observar estados diferentes bajo concurrencia;
2. checkout podía validar revisión A y valorar configuración B;
3. la RPC de detalle podía combinar revisión A con hijos B;
4. visitantes sin cabecera confiable compartían un bucket individual `anonymous`;
5. el límite global de 1200 no había sido probado efectivamente;
6. no existía un harness reproducible de dos sesiones.

La RPC mantiene un lock compartido del padre mientras calcula la revisión y lee hijos. Checkout conserva el replay idempotente antes de locks, después bloquea portal y productos en orden determinista y mantiene los locks hasta insertar pedido y partidas. Todos los escritores de aplicación auditados usan el orden:

`portal → padre → hijos`

Se revocó DML directo del padre y de las tablas hijas a roles de aplicación.

Sin una cabecera de infraestructura verificada, el fingerprint devuelve `NULL` y se aplica únicamente el límite global. El umbral global se probó con y sin identidad.

Las matrices SQL transaccionales pasaron y dejaron cero fixtures. La concurrencia real de dos conexiones no pudo ejecutarse en este entorno; el script quedó incluido.

**ESTADO: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN DE CONCURRENCIA PENDIENTE.**

---

# Historial conservado

## PUBLIC.1 — Implementación inicial

Incluyó:

- RPC pública `ecommerce_get_product_configuration`;
- selector mobile-first;
- variantes concretas;
- grupos `single` y `multiple`;
- `required`, `minSelect`, `maxSelect`;
- precios `base`, `delta` y `absolute`;
- `lineKey` determinista;
- edición y fusión de líneas equivalentes;
- checkout autoritativo;
- snapshot en `ecommerce_order_items.options`;
- WhatsApp con configuración;
- compatibilidad simple;
- caché y soporte offline de lectura;
- cero ventas, caja, inventario o reservas POS durante creación del pedido.

Migraciones:

- `20260716012251_ecom_products_public_1.sql`;
- `20260716012935_ecom_products_public_1_parent_gate_fix.sql`.

## PUBLIC.1.1 — Disponibilidad, revisión y rate limit

Correcciones conservadas:

- `manual_available=false` bloquea siempre;
- `requires_configuration` omite únicamente el `is_available` técnico del padre;
- `configurationVersion` representa el esquema;
- `configurationRevision` representa el contenido público;
- RPC, carrito, `sessionStorage`, payload, firma idempotente y snapshot conservan revisión;
- checkout exige revisión para líneas configurables;
- replay idempotente ocurre antes de validaciones mutables;
- `lineKey` no incluye revisión;
- líneas obsoletas bloquean checkout;
- `catalogRevision`, `offlineCatalog` y `maxItemQuantity` se propagan por React;
- productos simples no requieren revisión;
- IP y secreto HMAC no se exponen.

Migraciones:

- `20260716045221_ecom_products_public_1_availability_revision_fix.sql`;
- `20260716045242_ecom_products_public_1_checkout_revision_fix.sql`;
- `20260716045301_ecom_products_public_1_rate_limit_isolation.sql`.

---

# ECOM.PRODUCTS.PUBLIC.1.2 — Snapshot atómico y fallback seguro

## 1. Estado heredado

HEAD inicial de la rama:

`7a6ae7503f569bd10943a380ba675cbdd4768755`

HEAD de `main`:

`5c9945c31b0c80e8b266e3bec22bf561ac4c1386`

PR #99 estaba abierto, draft, sin merge, base `main`, head `fase-ecom-products-public-1` y mergeable.

## 2. Condición de carrera anterior

En `READ COMMITTED`, sentencias PL/pgSQL distintas pueden observar snapshots distintos.

La RPC hacía por separado:

1. leer producto;
2. calcular revisión;
3. leer variantes;
4. leer grupos;
5. leer opciones;
6. devolver disponibilidad y catálogo.

Checkout podía aceptar revisión A y consultar/preciar hijos B antes de insertar la partida.

## 3. Snapshot RPC anterior

El hash era canónico, pero no existía una barrera que impidiera una sincronización entre el cálculo del hash y las consultas de hijos.

## 4. Snapshot checkout anterior

El replay estaba correctamente primero, pero las líneas configurables no se valoraban bajo locks compartidos adquiridos previamente sobre todos los padres del carrito.

## 5. Protocolo del lector de detalle

Orden efectivo:

1. resolver portal;
2. localizar producto;
3. bloquear padre `FOR SHARE`;
4. releer `catalog_revision`;
5. aplicar rate limit;
6. calcular `configurationRevision`;
7. leer variantes;
8. leer grupos y opciones;
9. calcular disponibilidad;
10. devolver resultado;
11. liberar lock al terminar la transacción.

`catalogRevision`, `configurationRevision`, producto, variantes, grupos, opciones, precio y disponibilidad pertenecen al mismo estado protegido.

## 6. Protocolo del checkout

Orden efectivo:

1. resolver portal;
2. normalizar idempotency key;
3. buscar pedido existente;
4. devolver replay inmediatamente;
5. validar estructura básica del carrito nuevo;
6. bloquear portal `FOR UPDATE`;
7. extraer UUID distintos;
8. ordenar por UUID;
9. bloquear padres `FOR SHARE`;
10. comparar revisión;
11. leer variante, grupos y opciones;
12. validar disponibilidad y stock;
13. calcular precio autoritativo;
14. construir snapshot;
15. insertar pedido y partidas;
16. confirmar y liberar locks.

Productos simples pueden participar en el lock conjunto, pero no requieren revisión.

## 7. Protocolo de escritores

Se añadió:

`private.ecommerce_lock_configuration_writer(uuid, uuid)`

Su orden es:

1. localizar `portal_id` sin bloquear el padre;
2. bloquear portal `FOR UPDATE`;
3. bloquear padre `FOR UPDATE`;
4. devolver el portal bloqueado.

El escritor canónico y sus rutas verificadas usan después:

5. modificar variantes;
6. modificar grupos;
7. modificar opciones;
8. realizar soft deletes;
9. actualizar flags/metadata del padre;
10. finalizar.

Orden global:

`portal → padres → hijos`

## 8. Inversión detectada y corregida

Durante la revisión final se confirmó que los triggers de variantes, grupos y opciones actualizan `ecommerce_portals.catalog_revision`.

Antes de la tercera compensatoria podía existir:

- checkout: `portal → padre`;
- escritor directo del helper: `padre → hijo → portal`.

Eso permitía un deadlock.

La tercera migración corrige:

- `private.ecommerce_apply_product_configuration`;
- `private.ecommerce_apply_product_configuration_checked`;
- ambas firmas de `ecommerce_admin_upsert_published_product`;
- ambas firmas de `ecommerce_admin_set_product_published`.

Todos adquieren portal antes del padre.

## 9. Orden determinista

Checkout usa:

`ORDER BY pp.id FOR SHARE OF pp`

Esto reduce deadlocks entre carritos con varios productos.

## 10. Triggers y prevención de deadlocks

No se añadió un lock del padre dentro del trigger de fila hija. Hacerlo después de que la fila hija ya esté bloqueada crearía `hijo → padre`, contrario al protocolo.

La prevención se realiza mediante:

- funciones canónicas con `portal → padre → hijos`;
- checkout con `portal → padres ordenados`;
- revocación de DML directo.

## 11. Escritores auditados

Se leyeron definiciones efectivas de:

- `private.ecommerce_apply_product_configuration`;
- `private.ecommerce_apply_product_configuration_checked`;
- `private.ecommerce_configuration_child_guard`;
- `public.ecommerce_admin_sync_product_configuration`;
- `public.ecommerce_admin_sync_published_catalog_v2`;
- `public.ecommerce_admin_sync_published_catalog`;
- `public.ecommerce_admin_upsert_published_product_v2`;
- ambas firmas de `public.ecommerce_admin_upsert_published_product`;
- ambas firmas de `public.ecommerce_admin_set_product_published`;
- triggers de revisión de catálogo y guardas.

La búsqueda de cuerpos PL/pgSQL encontró un solo escritor directo de tablas hijas:

`private.ecommerce_apply_product_configuration`.

Las rutas V2 terminan en el helper checked/canónico.

## 12. DML directo

Se revocó `INSERT`, `UPDATE`, `DELETE` y `TRUNCATE` de:

- `ecommerce_published_products`;
- `ecommerce_published_product_variants`;
- `ecommerce_published_option_groups`;
- `ecommerce_published_options`.

Roles afectados:

- `PUBLIC`;
- `anon`;
- `authenticated`;
- `service_role`.

`service_role` conserva lectura y privilegios no DML. Las funciones `SECURITY DEFINER`, owner `postgres`, continúan escribiendo.

Soft delete y delete de aplicación ya no pueden evadir el protocolo mediante DML directo.

## 13. Catalog revision

La RPC relee la revisión del catálogo después del lock del padre.

Los triggers de hijos incrementan `catalog_revision` bajo el lock del portal ya adquirido por el escritor. Un lector anterior devuelve A; el escritor espera; después de B, el lector posterior devuelve B.

## 14. Configuration revision

Continúa siendo SHA-256 hexadecimal canónico de 64 caracteres.

Incluye contenido público relevante. Excluye cantidad exacta volátil de stock, referencias privadas, ingredientes, costos, staff y tokens.

PUBLIC.1.2 garantiza que la revisión y el contenido se usan bajo los mismos locks.

## 15. Precio y snapshot

Después de los locks, checkout usa los mismos registros para:

- validar variante;
- validar grupos/opciones;
- calcular precio;
- validar stock;
- construir `configurationSnapshot`;
- insertar la partida.

No puede validar A y cobrar B si los escritores respetan el protocolo instalado.

## 16. Pruebas de dos sesiones

Se añadió:

`scripts/test-ecom-products-public-1-2-concurrency.ps1`

Requiere:

- `psql`;
- `DATABASE_URL` owner-capable;
- dos conexiones PostgreSQL.

Usa fixtures sintéticos y limpieza en `finally`. No crea helpers permanentes.

Casos:

- lector primero;
- escritor primero;
- checkout primero;
- revisión obsoleta.

## 17. Resultado lector primero

El script mantiene la transacción lectora abierta, intenta una escritura canónica concurrente y verifica que el escritor espere. Después confirma detalle A y lectura posterior B.

**Pendiente de ejecución real en este entorno.**

## 18. Resultado escritor primero

El escritor mantiene portal/padre bloqueados, el lector debe esperar y después recibir íntegramente B.

**Pendiente de ejecución real en este entorno.**

## 19. Resultado checkout primero

Checkout crea pedido y partida bajo revisión A, mantiene la transacción abierta y el escritor debe esperar. Después se valida precio/snapshot A y el cambio B.

**Pendiente de ejecución real en este entorno.**

## 20. Limitación del entorno

Intento con `dblink`:

`ERROR: 2F003: password or GSSAPI delegated credentials required`

Intento de checkout local:

`fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/': Could not resolve host: github.com`

No se declara concurrencia PASS.

## 21. Rate limit anterior

Sin IP, PUBLIC.1.1 construía material lógico `anonymous`. Todos los visitantes sin cabecera terminaban en el mismo bucket individual de 60 solicitudes.

## 22. Fingerprint NULL

La función devuelve `NULL` cuando:

- no hay cabecera habilitada explícitamente;
- faltan headers;
- el JSON es inválido;
- el valor está vacío;
- el valor no es IP.

No genera `anonymous`, `unknown`, `fallback` ni equivalentes.

## 23. Cabeceras confiables

No pudo verificarse una cabecera real del proxy Supabase/PostgREST.

Ninguna se confía por defecto. La identidad individual sólo se activa mediante:

`app.settings.ecommerce_public_trusted_ip_header`

Valores soportados:

- `cf-connecting-ip`;
- `x-real-ip`;
- `x-forwarded-for`.

Sin configuración se utiliza sólo el límite global.

## 24. Límite individual

Con cabecera habilitada e IP válida:

- HMAC-SHA256 por cliente/portal/producto;
- 60 solicitudes por 10 minutos;
- bloqueo de 15 minutos.

Probado:

- hashes válidos y distintos para A/B;
- A bloqueado no bloquea B;
- hash sin IP literal.

## 25. Límite global

Siempre se aplica:

- 1200 solicitudes por portal/producto;
- 10 minutos;
- bloqueo de 15 minutos.

La función base bloquea cuando el contador resultante supera el máximo. La prueba estableció `request_count=1200` en el bucket vigente y ejecutó la llamada siguiente.

Resultado con y sin identidad:

```json
{"allowed":false,"code":"ECOMMERCE_RATE_LIMITED"}
```

También pasó separación por producto y portal.

## 26. Privacidad

Confirmado:

- no existe bucket `anonymous`;
- no se persiste IP;
- no se persisten headers;
- metadata no contiene nombres de headers;
- la respuesta no expone tier o fingerprint;
- el secreto no está en el repositorio;
- `service_role` no tiene `SELECT` sobre el secreto;
- helpers privados no son ejecutables por browser roles.

## 27. Migraciones PUBLIC.1.2

Creadas y aplicadas:

- `20260716055921_ecom_products_public_1_atomic_snapshot_fix.sql`;
- `20260716055941_ecom_products_public_1_rate_limit_fallback_fix.sql`;
- `20260716062053_ecom_products_public_1_writer_lock_order_fix.sql`.

No se editaron migraciones aplicadas previamente.

## 28. Historial remoto

Supabase registra las ocho migraciones PUBLIC.1/PUBLIC.1.1/PUBLIC.1.2:

- `20260716012251_ecom_products_public_1`;
- `20260716012935_ecom_products_public_1_parent_gate_fix`;
- `20260716045221_ecom_products_public_1_availability_revision_fix`;
- `20260716045242_ecom_products_public_1_checkout_revision_fix`;
- `20260716045301_ecom_products_public_1_rate_limit_isolation`;
- `20260716055921_ecom_products_public_1_atomic_snapshot_fix`;
- `20260716055941_ecom_products_public_1_rate_limit_fallback_fix`;
- `20260716062053_ecom_products_public_1_writer_lock_order_fix`.

Filenames locales y versiones remotas coinciden.

## 29. Seguridad efectiva

Verificado:

- owner `postgres`;
- `SECURITY DEFINER`;
- `search_path=''`;
- RPC públicas: `anon`, `authenticated`, `service_role`;
- helpers privados: `postgres`, `service_role`;
- tabla de secreto sin lectura pública/service role;
- DML directo revocado en padre e hijos;
- replay antes del lock;
- lock de productos determinista;
- escritores con lock helper antes de mutaciones.

## 30. Pruebas SQL

Archivos:

- `supabase/tests/ecom_products_public_1_2_atomic_snapshot_test.sql`;
- `supabase/tests/ecom_products_public_1_2_writer_lock_order_test.sql`.

Casos ejecutados remotamente en transacciones revertidas:

- detalle A coherente;
- revisión estable;
- stock 20→19 sin cambio de revisión;
- checkout A y snapshot A;
- cambio coordinado a B;
- detalle B;
- revisión A obsoleta rechazada;
- checkout B;
- replay original;
- simple legacy;
- `manual_available`;
- escritor canónico funcional;
- helper devuelve portal correcto;
- DML revocado;
- ACL privadas;
- fingerprint NULL;
- ausencia de bucket individual sin identidad;
- ausencia de bucket `anonymous`;
- HMAC A/B;
- A bloqueado no bloquea B;
- global real a 1200 con/sin identidad;
- separación portal/producto;
- ausencia de PII;
- cero ventas, caja e inventario.

Después de rollback:

- licencias: 0;
- portales: 0;
- productos: 0;
- pedidos: 0;
- filas de rate limit: 0.

## 31. Pruebas JavaScript

Suites relacionadas presentes:

- `ecommercePublicRevision`;
- `ecommercePublicConfiguredService`;
- `ecommercePublicConfigurationCache`;
- `ecommerceConfiguredProduct`;
- `usePublicCart.configurationRevision`;
- `usePublicCart.configured`;
- `PublicProductConfigurationModal`;
- `PublicStorePage.configurationContext`.

PUBLIC.1.2 no modifica JavaScript productivo.

Vitest no se ejecutó por falta de checkout instalable. No se declara PASS.

## 32. ESLint y Git

Pendientes:

- `git diff --check` local;
- `git status --short` local;
- ESLint enfocado;
- `npm run lint`.

Error:

`fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/': Could not resolve host: github.com`

## 33. Builds

Pendientes:

- `npm ci`;
- `npm run build`;
- `npm run build:store`;
- `npm run build:store:vercel`;
- `npm run test:ci`.

No se declaran PASS.

## 34. Vercel

- deployments manuales: 0;
- previews deliberados: 0;
- redeploys: 0;
- promociones: 0;
- cambios de configuración: 0.

El check automático no sustituye validación local o concurrencia.

## 35. Archivos PUBLIC.1.2

Creados:

- tres migraciones compensatorias;
- dos matrices SQL;
- un script PowerShell de concurrencia.

Modificado:

- `docs/reports/ECOM.PRODUCTS.PUBLIC.1.md`.

## 36. Riesgos residuales

1. Ejecutar el script con dos conexiones PostgreSQL owner-capable.
2. Verificar qué header sobrescribe el proxy real antes de activar el límite individual.
3. Ejecutar Vitest, ESLint y builds en un checkout con dependencias.
4. Futuras integraciones deben usar los RPC/helpers canónicos porque DML directo fue revocado.
5. POS.1, ingredientes, lotes, comandas e impresión siguen fuera de alcance.

## 37. Estado del PR

PR #99 debe permanecer:

- abierto;
- draft;
- sin merge;
- base `main`;
- head `fase-ecom-products-public-1`;
- sin marcar ready.

## 38. Conclusión

- detalle bloquea antes de calcular revisión: sí;
- detalle mantiene lock durante lectura completa: sí;
- catálogo se lee después del lock: sí;
- checkout recupera idempotencia antes de locks: sí;
- checkout bloquea productos ordenados: sí;
- revisión se compara después del lock: sí;
- precio y snapshot usan registros protegidos: sí;
- escritores usan `portal → padre → hijos`: sí;
- DML directo de aplicación: revocado;
- inversión trigger padre/portal: corregida;
- bucket `anonymous`: eliminado;
- sin identidad: sólo global;
- global 1200 probado: sí;
- PII persistida: no;
- concurrencia real ejecutada: no, pendiente;
- fixtures residuales: 0;
- cambios en `main`: 0;
- merge: no;
- deployment manual: no.

**ESTADO FINAL: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN DE CONCURRENCIA PENDIENTE.**

No se inició ECOM.PRODUCTS.POS.1. No se inició personalización Pro. El PR permanece draft para revisión.