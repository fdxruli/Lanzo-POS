# FASE ECOM.PRODUCTS.PUBLIC.1 — Variantes, extras y configuración pública

Fecha: 2026-07-15/16 (America/Mexico_City)  
Repositorio: `fdxruli/Lanzo-POS`  
Proyecto Supabase: `odlrhijtfyavryeqivaa`  
Rama: `fase-ecom-products-public-1`  
Base: `main` en `5c9945c31b0c80e8b266e3bec22bf561ac4c1386`

## Resumen ejecutivo

PUBLIC.1 implementó variantes, grupos, opciones, extras, precio estimado, carrito configurable, edición, payload mínimo y checkout autoritativo. PUBLIC.1.1 corrigió disponibilidad manual, separó `configurationVersion` de `configurationRevision`, añadió revisión SHA-256 de contenido, propagó la revisión por cliente/checkout/snapshot e incorporó rate limit individual HMAC y global.

PUBLIC.1.2 corrige dos defectos residuales:

1. revisión, contenido y precio podían observar estados distintos bajo concurrencia;
2. cuando no existía una cabecera de red confiable, todos los visitantes compartían un bucket individual `anonymous`.

La RPC de detalle ahora mantiene un lock compartido del padre mientras calcula revisión y lee hijos. El checkout conserva el replay idempotente antes de locks, después bloquea portal y productos en orden determinista, y mantiene los locks hasta insertar pedido y partidas. El escritor canónico mantiene lock exclusivo del padre antes de modificar hijos. Se revocó DML directo de tablas hijas a roles de aplicación.

El fallback del rate limit devuelve `NULL` sin identidad confiable y usa sólo el límite global. El límite global de 1200 se probó efectivamente con y sin identidad.

Las matrices SQL transaccionales pasaron y dejaron cero fixtures. La prueba real de dos sesiones no pudo ejecutarse desde este entorno porque no existe una segunda conexión PostgreSQL autenticada. El script reproducible quedó incluido.

**ESTADO: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN DE CONCURRENCIA PENDIENTE.**

---

# Historial de implementación

## PUBLIC.1 — Implementación inicial

Incluyó:

- RPC pública de detalle `ecommerce_get_product_configuration`;
- selector mobile-first;
- variantes concretas y combinaciones válidas;
- grupos `single` y `multiple`;
- `required`, `minSelect`, `maxSelect`;
- precio estimado con `base`, `delta` y `absolute`;
- líneas configurables con `lineKey` determinista;
- edición y fusión de líneas equivalentes;
- checkout server-side autoritativo;
- snapshot en `ecommerce_order_items.options`;
- WhatsApp con variante, grupos y opciones;
- compatibilidad con productos simples;
- caché de detalle y catálogo;
- ausencia de ventas, caja, inventario o reservas POS durante creación del pedido.

Migraciones iniciales:

- `20260716012251_ecom_products_public_1.sql`;
- `20260716012935_ecom_products_public_1_parent_gate_fix.sql`.

## PUBLIC.1.1 — Disponibilidad, revisión y rate limit

Defectos corregidos:

- `manual_available=false` del padre configurable no era siempre autoritativo;
- `configurationVersion` se utilizaba como si representara contenido;
- checkout podía aceptar configuración modificada sin revisión real;
- rate limit de detalle era un bucket compartido de 120 solicitudes;
- faltaba propagación explícita de contexto React.

Resultado heredado que PUBLIC.1.2 conserva:

- `manual_available=false` bloquea siempre;
- `requires_configuration` sólo omite el `is_available` técnico del padre;
- `configurationVersion` representa el esquema;
- `configurationRevision` representa contenido público;
- la RPC devuelve la revisión;
- carrito, `sessionStorage`, payload mínimo, firma idempotente y snapshot conservan revisión;
- checkout exige revisión para líneas configurables;
- replay idempotente ocurre antes de validaciones mutables;
- `lineKey` no incluye revisión;
- líneas obsoletas bloquean checkout hasta actualizar opciones;
- `catalogRevision`, `offlineCatalog` y `maxItemQuantity` se propagan por React;
- los productos simples no requieren revisión;
- no se almacena IP literal ni el secreto HMAC.

Migraciones PUBLIC.1.1:

- `20260716045221_ecom_products_public_1_availability_revision_fix.sql`;
- `20260716045242_ecom_products_public_1_checkout_revision_fix.sql`;
- `20260716045301_ecom_products_public_1_rate_limit_isolation.sql`.

---

# ECOM.PRODUCTS.PUBLIC.1.2 — Snapshot atómico y fallback seguro de rate limit

## 1. Estado heredado

HEAD inicial revisado de la rama:

`7a6ae7503f569bd10943a380ba675cbdd4768755`

HEAD de `main`:

`5c9945c31b0c80e8b266e3bec22bf561ac4c1386`

PR #99 estaba abierto, draft, sin merge, base `main`, head `fase-ecom-products-public-1` y mergeable.

No se inició ECOM.PRODUCTS.POS.1 ni personalización Pro.

## 2. Condición de carrera anterior

PostgreSQL opera en `READ COMMITTED` por defecto. Sentencias distintas dentro de una función PL/pgSQL pueden observar snapshots distintos.

La RPC de detalle hacía, en sentencias separadas:

1. leer producto;
2. calcular `configurationRevision`;
3. leer variantes;
4. leer grupos;
5. leer opciones;
6. devolver disponibilidad y `catalogRevision`.

Una sincronización concurrente podía producir revisión A con contenido B.

El checkout podía:

1. calcular y aceptar revisión A;
2. permitir que un escritor cambiara hijos;
3. valorar variante/opciones B;
4. crear un snapshot B bajo una revisión validada A.

## 3. Snapshot RPC anterior

La revisión era canónica y estable, pero el producto padre no permanecía bloqueado entre el hash y las consultas de hijos. La función no tenía una barrera que impidiera a `ecommerce_apply_product_configuration` modificar variantes, grupos u opciones durante la lectura.

## 4. Snapshot checkout anterior

El replay idempotente estaba correctamente antes de validaciones, pero cada línea calculaba revisión y después consultaba configuración sin un lock compartido adquirido previamente sobre todos los padres del carrito.

## 5. Protocolo de lectores

### RPC de detalle

Orden efectivo:

1. resolver portal;
2. validar producto solicitado;
3. adquirir `FOR SHARE` sobre `ecommerce_published_products`;
4. releer `catalog_revision` después del lock;
5. aplicar rate limit;
6. calcular `configurationRevision`;
7. leer variantes;
8. leer grupos y opciones;
9. calcular disponibilidad;
10. devolver el resultado;
11. liberar lock al finalizar la transacción de la RPC.

La revisión, precio, disponibilidad, variantes, grupos, opciones y revisión de catálogo pertenecen al mismo estado protegido.

### Checkout

Orden efectivo:

1. resolver portal;
2. normalizar idempotency key;
3. buscar `portal_id + idempotency_key`;
4. devolver pedido existente inmediatamente;
5. validar estructura básica del carrito nuevo;
6. bloquear el portal `FOR UPDATE`;
7. extraer UUID de productos válidos y distintos;
8. ordenar por UUID;
9. adquirir `FOR SHARE` sobre todos los padres;
10. cargar productos y comparar revisión;
11. leer variante, grupos y opciones;
12. validar disponibilidad y stock;
13. calcular precio autoritativo;
14. construir snapshot;
15. insertar `ecommerce_orders` y `ecommerce_order_items`;
16. confirmar transacción y liberar locks.

Los productos simples pueden participar en el lock conjunto, pero no empiezan a exigir `configurationRevision`.

## 6. Protocolo de escritores

El escritor canónico es:

`private.ecommerce_apply_product_configuration(uuid, uuid, jsonb, text)`

Su orden efectivo es:

1. validar payload;
2. bloquear padre `FOR UPDATE`;
3. insertar/actualizar variantes;
4. hacer soft delete de variantes ausentes;
5. insertar/actualizar grupos;
6. insertar/actualizar opciones;
7. hacer soft delete de opciones y grupos ausentes;
8. actualizar flags y metadata del padre;
9. finalizar transacción.

`private.ecommerce_apply_product_configuration_checked` también bloquea el padre antes de llamar al escritor canónico.

## 7. Modo de bloqueo

- lector de detalle: `FOR SHARE` del padre;
- checkout: portal `FOR UPDATE`, después padres `FOR SHARE`;
- sincronización legacy: portal `FOR UPDATE`, después padres `FOR UPDATE`;
- escritor de configuración: padre `FOR UPDATE`.

`FOR SHARE` impide actualizaciones o deletes concurrentes del padre. Los escritores de hijos están obligados a obtener primero el lock exclusivo del padre, por lo que no pueden modificar hijos mientras existe un lector protegido.

## 8. Orden determinista

El checkout bloquea padres con:

`ORDER BY pp.id FOR SHARE OF pp`

Esto reduce deadlocks entre carritos con varios productos.

El orden global compatible es:

`portal → productos ordenados → hijos`

## 9. Prevención de deadlocks

No se añadió un `FOR UPDATE` del padre dentro del trigger de fila hija. Un trigger `BEFORE UPDATE` puede ejecutarse cuando la fila hija ya está bloqueada y crear el orden inverso:

`hijo → padre`

mientras el escritor canónico usa:

`padre → hijo`

En su lugar:

- las funciones canónicas conservan `padre → hijo`;
- el checkout conserva `portal → padre`;
- se eliminó DML directo de roles de aplicación sobre hijos.

## 10. Escritores auditados

Funciones efectivas auditadas:

- `private.ecommerce_apply_product_configuration`;
- `private.ecommerce_apply_product_configuration_checked`;
- `public.ecommerce_admin_sync_product_configuration`;
- `public.ecommerce_admin_sync_published_catalog_v2`;
- `public.ecommerce_admin_sync_published_catalog`;
- `public.ecommerce_admin_upsert_published_product_v2`;
- `public.ecommerce_admin_upsert_published_product`;
- `public.ecommerce_admin_set_product_published`;
- `private.ecommerce_configuration_child_guard`;
- triggers de revisión de catálogo y soft delete.

La búsqueda de cuerpos PL/pgSQL encontró un solo escritor de las tablas hijas:

`private.ecommerce_apply_product_configuration`.

Las rutas V2 terminan en el helper checked/canónico. Las rutas legacy que actualizan el producto bloquean el padre antes de escribirlo.

## 11. DML directo

Antes de PUBLIC.1.2, `service_role` tenía:

- `INSERT`;
- `UPDATE`;
- `DELETE`;
- `TRUNCATE`;

sobre variantes, grupos y opciones.

PUBLIC.1.2 revocó esos privilegios a:

- `PUBLIC`;
- `anon`;
- `authenticated`;
- `service_role`.

`service_role` conserva únicamente privilegios no DML necesarios, como lectura. Las funciones `SECURITY DEFINER`, owner `postgres`, continúan escribiendo mediante el protocolo canónico.

DELETE físico y soft delete de aplicación ya no tienen una vía directa por roles de aplicación. El escritor canónico realiza soft delete después de bloquear el padre.

## 12. Catalog revision

La RPC relee `ecommerce_portals.catalog_revision` después de adquirir el lock del padre.

Los triggers de cambios de variantes, grupos y opciones incrementan la revisión del catálogo. Bajo el protocolo:

- lector anterior devuelve snapshot A con revisión de catálogo A;
- escritor espera;
- escritor aplica B e incrementa revisión;
- lector posterior devuelve snapshot B con revisión de catálogo B.

## 13. Configuration revision

La revisión continúa siendo SHA-256 hexadecimal canónico de 64 caracteres.

Incluye campos públicos relevantes de producto, variantes, grupos y opciones. Excluye cantidad exacta volátil de stock, identificadores privados, ingredientes, costos, staff y tokens.

PUBLIC.1.2 no cambia su semántica; garantiza que el contenido utilizado junto con la revisión está protegido por el mismo protocolo de lock.

## 14. Precio y snapshot

El checkout compara la revisión después de adquirir locks y usa los mismos registros protegidos para:

- validar variante;
- validar grupos y opciones;
- calcular ajuste de variante;
- calcular extras;
- validar stock;
- construir `configurationSnapshot`;
- insertar `ecommerce_order_items`.

Por tanto, ya no puede aceptar revisión A y cobrar B dentro de una ejecución que respete el protocolo.

## 15. Pruebas de dos sesiones

Se añadió:

`scripts/test-ecom-products-public-1-2-concurrency.ps1`

Requiere:

- `psql`;
- `DATABASE_URL` con conexión PostgreSQL owner-capable;
- dos sesiones concurrentes.

Usa únicamente fixtures sintéticos y limpia pedidos, hijos, productos, portal, licencia y rate limits en `finally`.

No crea funciones o helpers permanentes.

## 16. Resultado lector primero

Caso implementado en el script:

1. sesión A ejecuta detalle y mantiene la transacción abierta;
2. sesión B ejecuta el escritor canónico;
3. B debe esperar;
4. A confirma revisión/precio/opción A;
5. B aplica B;
6. nueva lectura confirma íntegramente B.

**Resultado en este entorno: pendiente de ejecución real.**

## 17. Resultado escritor primero

Caso implementado:

1. escritor canónico modifica a B y mantiene `FOR UPDATE`;
2. lector intenta detalle;
3. lector debe esperar;
4. después del commit devuelve íntegramente B.

**Resultado en este entorno: pendiente de ejecución real.**

## 18. Resultado checkout primero

Caso implementado:

1. checkout con revisión A crea pedido y partida dentro de transacción abierta;
2. escritor intenta modificar configuración;
3. escritor debe esperar;
4. checkout confirma precio, snapshot y revisión A;
5. escritor aplica B;
6. checkout posterior con revisión A falla.

**Resultado en este entorno: pendiente de ejecución real.**

## 19. Limitación de concurrencia del entorno

Se intentó crear una segunda conexión mediante `dblink` dentro de una transacción de prueba. PostgreSQL devolvió:

`ERROR: 2F003: password or GSSAPI delegated credentials required`

También se intentó obtener un checkout local para ejecutar clientes paralelos. La red del entorno devolvió:

`fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/': Could not resolve host: github.com`

No se declara concurrencia PASS.

## 20. Rate limit anterior

PUBLIC.1.1 generaba un HMAC incluso cuando no existía IP, usando el material lógico `anonymous`. Todos los visitantes sin header confiable terminaban en el mismo bucket individual de 60 solicitudes.

Una persona podía bloquear a todos los visitantes sin identidad durante 15 minutos.

## 21. Fingerprint NULL

`private.ecommerce_public_configuration_client_fingerprint` devuelve `NULL` cuando:

- no existe una cabecera habilitada explícitamente;
- `request.headers` está ausente;
- el JSON es inválido;
- la cabecera está vacía;
- el valor no es una IP válida.

No genera identidades `anonymous`, `unknown`, `fallback`, `0.0.0.0` ni equivalentes.

## 22. Cabecera confiable

No fue posible verificar en una petición pública real cuál cabecera sobrescribe la infraestructura Supabase/PostgREST.

Por seguridad, ninguna cabecera se considera confiable por defecto.

Una cabecera individual sólo se activa si la infraestructura se verifica y se configura explícitamente mediante:

`app.settings.ecommerce_public_trusted_ip_header`

Valores soportados:

- `cf-connecting-ip`;
- `x-real-ip`;
- `x-forwarded-for`.

Mientras la configuración está ausente, producción utiliza exclusivamente el límite global.

## 23. Límite individual

Cuando existe una cabecera habilitada y una IP válida:

- HMAC-SHA256 por cliente, portal y producto;
- 60 solicitudes por 10 minutos;
- bloqueo de 15 minutos.

Las pruebas transaccionales confirmaron:

- HMAC de 64 caracteres;
- clientes A y B producen hashes distintos;
- cliente A bloqueado no bloquea B;
- el hash no contiene IP literal.

## 24. Límite global

Se aplica siempre:

- con identidad individual;
- sin identidad individual.

Contrato:

- 1200 solicitudes por portal y producto;
- ventana de 10 minutos;
- bloqueo de 15 minutos.

La función base incrementa primero y bloquea cuando el contador resultante supera el máximo. La prueba inicial detectó esta semántica y se corrigió para establecer `request_count=1200` sobre el bucket vigente y ejecutar la llamada siguiente.

Resultado confirmado con y sin identidad:

```json
{"allowed":false,"code":"ECOMMERCE_RATE_LIMITED"}
```

También se confirmó separación entre:

- productos distintos;
- portales distintos.

## 25. Privacidad

Confirmado:

- no existe bucket `anonymous`;
- no se persiste IP literal;
- no se persiste el contenido de headers;
- metadata no contiene `cf-connecting-ip`, `x-real-ip` ni `x-forwarded-for`;
- la respuesta pública no expone tier, fingerprint o cabecera;
- el secreto permanece en `private.ecommerce_public_rate_limit_secret`;
- `PUBLIC`, `anon`, `authenticated` y `service_role` no tienen `SELECT` sobre el secreto;
- helpers privados no son ejecutables por `anon` o `authenticated`.

## 26. Migraciones PUBLIC.1.2

Creadas y aplicadas:

- `20260716055921_ecom_products_public_1_atomic_snapshot_fix.sql`;
- `20260716055941_ecom_products_public_1_rate_limit_fallback_fix.sql`.

No se editaron las cinco migraciones previamente aplicadas.

## 27. Historial remoto

Supabase registra:

- `20260716012251_ecom_products_public_1`;
- `20260716012935_ecom_products_public_1_parent_gate_fix`;
- `20260716045221_ecom_products_public_1_availability_revision_fix`;
- `20260716045242_ecom_products_public_1_checkout_revision_fix`;
- `20260716045301_ecom_products_public_1_rate_limit_isolation`;
- `20260716055921_ecom_products_public_1_atomic_snapshot_fix`;
- `20260716055941_ecom_products_public_1_rate_limit_fallback_fix`.

Los filenames locales coinciden con los timestamps remotos.

## 28. Seguridad efectiva

Verificado después de aplicar:

- owner `postgres`;
- `SECURITY DEFINER`;
- `search_path=''`;
- RPC públicas ejecutables por `anon`, `authenticated`, `service_role`;
- helpers privados ejecutables únicamente por `postgres` y `service_role`;
- secreto sin lectura por roles públicos o `service_role`;
- DML directo de hijos revocado a roles de aplicación;
- checkout contiene lock determinista;
- replay idempotente aparece antes del lock.

## 29. Pruebas SQL

Se añadió:

`supabase/tests/ecom_products_public_1_2_atomic_snapshot_test.sql`

La matriz usa `BEGIN/ROLLBACK` y cubre:

- `manual_available`;
- revisión estable;
- cambio de precio de opción;
- stock exacto 20→19 sin cambio de revisión;
- coherencia de detalle A y B;
- checkout vigente;
- checkout obsoleto;
- snapshot y precio;
- replay antes de locks;
- producto simple legacy;
- revocación DML;
- ACL de helpers;
- fingerprint `NULL` sin identidad;
- ausencia de bucket individual sin identidad;
- ausencia de bucket `anonymous`;
- HMAC A/B;
- A bloqueado no bloquea B;
- global real a 1200 con y sin identidad;
- separación por portal y producto;
- ausencia de PII;
- ausencia de ventas, caja e inventario.

Los bloques efectivos de la matriz fueron ejecutados remotamente dentro de transacciones revertidas y pasaron.

Después de los rollbacks se confirmó:

- licencias sintéticas: 0;
- portales sintéticos: 0;
- productos sintéticos: 0;
- pedidos sintéticos: 0;
- filas sintéticas de rate limit: 0.

## 30. Pruebas JavaScript

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

Vitest no se ejecutó porque no fue posible clonar/instalar el workspace. No se declara PASS.

## 31. ESLint y validación Git

Pendientes:

- `git diff --check` en checkout local;
- `git status --short` en checkout local;
- ESLint enfocado;
- `npm run lint`.

Error exacto del checkout:

`fatal: unable to access 'https://github.com/fdxruli/Lanzo-POS.git/': Could not resolve host: github.com`

No se usó `node --check` como sustituto de ESLint.

## 32. Builds

Pendientes por falta de workspace instalable:

- `npm ci`;
- `npm run build`;
- `npm run build:store`;
- `npm run build:store:vercel`;
- `npm run test:ci`.

No se declaran PASS.

## 33. Vercel

- deployments manuales: 0;
- previews deliberados: 0;
- redeploys: 0;
- promociones de alias: 0;
- cambios de proyecto: 0;
- cambios de Root Directory: 0;
- cambios de build command/output: 0;
- cambios de dominios o variables: 0.

El check automático no se usa como sustituto de SQL, concurrencia, Vitest, ESLint o builds.

## 34. Archivos PUBLIC.1.2

### Creados

- `supabase/migrations/20260716055921_ecom_products_public_1_atomic_snapshot_fix.sql`;
- `supabase/migrations/20260716055941_ecom_products_public_1_rate_limit_fallback_fix.sql`;
- `supabase/tests/ecom_products_public_1_2_atomic_snapshot_test.sql`;
- `scripts/test-ecom-products-public-1-2-concurrency.ps1`.

### Modificados

- `docs/reports/ECOM.PRODUCTS.PUBLIC.1.md`.

No hubo cambios JavaScript productivos en PUBLIC.1.2.

## 35. Riesgos residuales

1. Falta ejecutar el script real de dos sesiones con una conexión PostgreSQL owner-capable.
2. Falta verificar en una petición pública real qué header sobrescribe la infraestructura; hasta entonces el límite individual permanece deshabilitado y se usa el global.
3. Faltan Vitest, ESLint y los tres builds en un checkout con dependencias.
4. La revocación de DML directo exige que futuras integraciones escriban configuración mediante los RPC/helpers canónicos.
5. ECOM.PRODUCTS.POS.1, consumo de ingredientes, lotes, comandas e impresión siguen fuera de alcance.

## 36. Estado del PR

PR #99 debe permanecer:

- abierto;
- draft;
- sin merge;
- base `main`;
- head `fase-ecom-products-public-1`;
- sin marcar ready automáticamente.

## 37. Conclusión

- la RPC adquiere lock antes de calcular revisión: sí;
- la RPC mantiene el lock mientras lee hijos: sí;
- `catalogRevision` se lee después del lock: sí;
- revisión y contenido usan el mismo protocolo: sí;
- replay idempotente precede locks: sí;
- checkout bloquea productos en orden UUID: sí;
- checkout compara revisión después del lock: sí;
- precio y snapshot se construyen bajo esos locks: sí;
- escritor canónico bloquea padre antes de hijos: sí;
- DML directo de hijos por roles de aplicación: revocado;
- inversión de lock en trigger: no introducida;
- bucket individual `anonymous`: eliminado;
- sin identidad: fingerprint `NULL` y sólo límite global;
- límite global de 1200 probado realmente: sí;
- IP y headers persistidos: no;
- concurrencia real de dos sesiones ejecutada: no, pendiente por falta de conexión;
- fixtures residuales: 0;
- cambios directos en `main`: 0;
- merge automático: no;
- deployment manual: no.

**ESTADO FINAL: IMPLEMENTACIÓN COMPLETA — VALIDACIÓN DE CONCURRENCIA PENDIENTE.**

No se inició ECOM.PRODUCTS.POS.1. No se inició personalización Pro. El PR permanece draft para otra revisión técnica.