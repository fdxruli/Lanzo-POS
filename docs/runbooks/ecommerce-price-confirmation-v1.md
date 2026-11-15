# Ecommerce price confirmation v1 — instalación y QA

**Estado actual:** `READY_FOR_INSTALLATION_REVIEW` · migración **NO INSTALADA**
**Proyecto objetivo inspeccionado:** Supabase Production `odlrhijtfyavryeqivaa` (PostgreSQL 17.6)
**Migración:** `20261114231943_ecommerce_price_confirmation_v1.sql` · versión `20261114231943`
**SHA-256:** `a0d6153f3cb931314e5320eb1475b73c5cc9be20ba89dd7be64b4ecfc11d8e39`

## Alcance y orden de activación

La migración modifica únicamente `public.ecommerce_create_order(text,jsonb,jsonb,text)` y el mensaje de `private.ecommerce_public_error(text)`. No agrega tablas, índices, políticas, grants ni reservas. El servidor sigue calculando los precios; compara cada aceptación de línea con su snapshot económico vigente dentro de la misma transacción. Rechaza clientes que no envíen `acceptedPricing` con `ECOMMERCE_CATALOG_REVISION_CHANGED`.

No ejecutar durante esta revisión. Requiere autorización explícita del propietario. La política canónica del repositorio exige que, más adelante, el mismo PR se fusione primero a `main`; después se use únicamente el workflow manual `.github/workflows/supabase-production-migrations.yml` desde ese `main`. En la revisión de Vercel se observaron despliegues recientes de `main` con target `production`; por tanto, el merge puede publicar el frontend antes de aplicar SQL. Antes de fusionar, el propietario debe aprobar una coordinación de corte: retener por separado el despliegue de Production mientras se aplica SQL, o aceptar explícitamente una ventana breve en que el checkout rechace pedidos de forma segura hasta que termine la migración. Con el SQL anterior, el nuevo campo `acceptedPricing` todavía no está permitido y los nuevos envíos fallarán cerrados; no se crearán pedidos a precio distinto, pero el checkout podría quedar temporalmente indisponible. No se modificó Vercel ni se publicó Production.

Después de esa decisión, usar únicamente el workflow manual `.github/workflows/supabase-production-migrations.yml` desde `main`. Ejecutar primero `DRY_RUN` con el SHA actual de `main` y la única versión esperada `20261114231943`; revisar que no haya otras migraciones pendientes; con autorización separada, ejecutar `APPLY` para esa versión. El workflow verifica el SHA, ledger, preflight y resultado. No usar el conector `apply_migration`, el editor SQL, `migration repair` ni `db push` fuera de ese workflow. Validar postcondiciones; liberar el despliegue retenido, si se usó. El Preview apunta a Production: no realizar el caso manual con un negocio real ni editar precios comerciales productivos. El propietario debe designar un portal/producto QA autorizado o habilitar un entorno seguro antes de ejecutar escrituras.

La migración está en una transacción. Un error antes del `COMMIT` revierte ambos reemplazos. Si hay un problema después del `COMMIT`, detener el despliegue y preparar una corrección SQL hacia adelante; no volver a la función legacy sin una reversión coordinada del frontend y aprobación explícita, porque la función legacy no exige aceptación económica.

## Preflight antes de instalar

Conectar al proyecto `odlrhijtfyavryeqivaa` y ejecutar en modo lectura. Los resultados deben confirmar firma, versión de servidor, dependencias, estado de seguridad y que esta versión aún no está en el ledger:

```sql
select current_setting('server_version') as server_version,
       to_regprocedure('public.ecommerce_create_order(text,jsonb,jsonb,text)') as create_order,
       to_regprocedure('private.ecommerce_public_error(text)') as public_error,
       to_regprocedure('extensions.digest(bytea,text)') as sha256_digest,
       to_regclass('public.ecommerce_orders') as orders_table,
       (select data_type from information_schema.columns
        where table_schema = 'public' and table_name = 'ecommerce_orders'
          and column_name = 'metadata') as order_metadata_type,
       (select version from supabase_migrations.schema_migrations
        where version = '20261114231943') as this_version_in_ledger;

select p.oid::regprocedure as signature,
       md5(p.prosrc) as source_md5,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_config,
       p.proacl as execute_acl
from pg_proc p
where p.oid in (
  'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure,
  'private.ecommerce_public_error(text)'::regprocedure
)
order by 1;
```

Esperado: PostgreSQL 17.x; `extensions.digest(bytea,text)` disponible; `ecommerce_orders.metadata` de tipo `jsonb`; migración ausente del ledger; dueño `postgres`; ambas funciones `SECURITY DEFINER`, `search_path` vacío y ACL sin cambios. Los MD5 deben ser `ed11bdd80c3a3ffaba58c2582fdf60f0` para `ecommerce_create_order` y `0c68e50ab545d4b7911d7ad69977309c` para `ecommerce_public_error`. Si una comprobación falla, **no instalar**: la migración aborta ante definiciones distintas.

Guardar la salida de `pg_get_functiondef(...)`, owner, ACL y configuración de ambas funciones en el ticket de instalación. Revisar que el ledger siga en la versión observada (`20261114055610`) y que la entrada nueva no exista. El bloqueo de instalación evita pisar cambios posteriores.

## Aplicación y comprobaciones posteriores

1. Verificar el SHA-256 publicado en el PR contra el archivo canónico ya fusionado en `main`.
2. En el workflow canónico, `DRY_RUN` debe mostrar exactamente esta versión pendiente. `APPLY` solo se autoriza tras revisar el resultado y el estado de QA; el workflow aplica el conjunto exacto y registra el ledger.
3. Confirmar la nueva versión en `supabase_migrations.schema_migrations` y revisar que ambas funciones conserven owner `postgres`, `SECURITY DEFINER`, `search_path` vacío y ACL previo.
4. Confirmar que `pgcrypto` continúa instalado bajo `extensions`, la firma RPC no cambió y la función auxiliar contiene el mensaje de `ECOMMERCE_PRICE_CONFIRMATION_CHANGED`.
5. Si se retuvo el despliegue, liberarlo después de instalar SQL. Si se aprobó no retenerlo, verificar que SQL se aplique enseguida y reconocer que el checkout habrá fallado cerrado durante el intervalo. Los clientes antiguos reciben rechazo seguro sin crear pedido; pueden necesitar recargar la tienda para usar el contrato nuevo.

Las escrituras del frontend deben esperar al contrato SQL. Un Preview con el frontend nuevo antes de instalar esta migración no sirve para el caso funcional y puede recibir el error de allowlist de la función actual.

## QA aislado

En una base desechable cuya estructura y migraciones coincidan con Production, instalar la migración y ejecutar:

```text
supabase/tests/ecommerce_price_confirmation_v1_test.sql
```

El script crea fixtures sintéticos dentro de una transacción y termina en `ROLLBACK`. Cubre aceptación de $100, replay idempotente, reutilización con importe diferente, aumento a $120, disminución a $80 y rechazo legacy. Verificar cero pedidos, líneas y eventos adicionales en cada rechazo. No ejecutarlo en Production. La prueba no simula concurrencia real; ejecutar la prueba concurrente antes de instalar en un PostgreSQL aislado con dos sesiones, manteniendo la sesión A dentro de la RPC mientras la sesión B intenta modificar el producto/configuración. Confirmar que solo una operación avance primero y que el pedido nunca registre un importe distinto del aceptado.

## QA manual en Preview

Solo con un portal/producto de QA autorizado y un administrador de prueba. No editar precios, publicar/despublicar productos, crear pedidos ni generar efectos comerciales en un negocio real.

1. En Android Chrome/PWA, abrir el Preview con el carrito de QA y confirmar explícitamente $100.
2. En una segunda sesión del mismo portal QA, cambiar el precio publicado a $120 y esperar confirmación de Supabase.
3. Sin recargar el checkout, enviar la aceptación de $100. Esperar `ECOMMERCE_PRICE_CONFIRMATION_CHANGED`; confirmar que no hay pedido, línea, evento ni reserva del intento rechazado.
4. Comprobar que se conserva el carrito, aparece “El precio de tu pedido cambió” con antes/ahora/diferencia y que el nuevo total no queda aceptado automáticamente.
5. Revisar el carrito, aceptar $120 y confirmar. Verificar en Supabase un solo pedido por $120 y líneas que suman $120.
6. Repetir con reducción de precio, configuración cambiada y producto no disponible. Probar doble clic y timeout/respuesta perdida: como máximo un pedido; el reintento conserva la misma clave y snapshot aceptados.
7. Probar un cambio solo de descripción/imagen: la aceptación monetaria debe seguir siendo válida.

Registrar URLs/versión de Preview, plataforma/dispositivo, IDs de QA, requests/respuestas, pedido/líneas/eventos y resultado de cada paso. Si no existe un negocio QA autorizado, dejar el QA manual pendiente hasta que el propietario lo provea. No marcarlo como aprobado por inspección de código.
