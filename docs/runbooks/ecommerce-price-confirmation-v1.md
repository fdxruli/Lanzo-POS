# Ecommerce price confirmation v1 — instalación y QA

**Estado actual:** `READY_FOR_NEW_ROLLBACK_AUTHORIZATION` · migración **NO INSTALADA**
**Proyecto objetivo inspeccionado:** Supabase Production `odlrhijtfyavryeqivaa` (PostgreSQL 17.6)
**Migración:** `20261114231943_ecommerce_price_confirmation_v1.sql` · versión `20261114231943`
**SHA-256:** `6f19aec959a796dfb922902c929a680c01e2792e57767039f09b8a97c01e6f34` (corrección en PR; migración no instalada)

## Evidencia del seguimiento (2026-11-14 y 2026-11-15)

- **Código:** se corrigió F6 en la aceptación frontend. Precios nulos, ausentes, negativos, no numéricos, fuera de rango, tiers mayoristas inválidos y configuraciones corruptas quedan marcados como no aptos. El checkout muestra “Precio no disponible” y no permite una aceptación nueva ni un envío nuevo con esos datos. El reintento de la misma solicitud idempotente sigue disponible ante un resultado incierto.
- **Vitest:** 6 suites de servicio/utilidades, 76 pruebas aprobadas; `PublicCheckoutDialog.test.jsx`, 19 aprobadas; integración `PublicStoreCheckout.test.jsx`, 21 aprobadas en la ejecución conjunta de checkout. Total focalizado actual: 116 pruebas aprobadas. Los intentos amplios iniciales se cancelaron al incluir copias antiguas bajo `.tmp` o no emitir resultados; los resultados reportados corresponden a reejecuciones controladas con `--exclude .tmp/**`.
- **ESLint y `git diff --check`:** aprobados en los archivos afectados.
- **React Doctor:** revisión final de 14 archivos modificados, score 81/100 y “No issues found”.
- **Build:** `npm run build` aprobado. Emitió advertencias de bundles grandes, imports mixtos, anotaciones de Zod y patrones PWA sin coincidencias; el service worker y las auditorías postbuild finalizaron correctamente.
- **Preflight de Production, solo lectura:** PostgreSQL 17.6; MD5 de `public.ecommerce_create_order(text,jsonb,jsonb,text)` `ed11bdd80c3a3ffaba58c2582fdf60f`; MD5 de `private.ecommerce_public_error(text)` `0c68e50ab545d4b7911d7ad69977309c`; dueño `postgres`; ambas `SECURITY DEFINER` con `search_path` vacío; ACL observadas: `{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}` en `ecommerce_create_order`; `extensions.digest(bytea,text)` y `pgcrypto` disponibles; `ecommerce_orders.metadata` es JSONB; versión `20261114231943` ausente del ledger. Los anchors de sustitución coinciden con la definición leída. No hay postflight porque no se aplicó la migración.
- **ACL Production confirmadas en consulta de solo lectura:** `ecommerce_create_order`: `{postgres=X/postgres,service_role=X/postgres,anon=X/postgres,authenticated=X/postgres}`; `ecommerce_public_error`: `{postgres=X/postgres,service_role=X/postgres}`.
- **Diagnóstico SQL dinámico (2026-11-15 15:46:42.847 UTC):** una ejecución puntual autorizada falló y revirtió completamente antes de insertar el ledger. El log registra `SQLSTATE 42601`, `syntax error at or near "("`, posición interna `24148`, durante `EXECUTE v_definition` al crear `public.ecommerce_create_order`; `DETAIL` y `HINT` llegaron vacíos. El contexto identifica `CREATE OR REPLACE FUNCTION public.ecommerce_create_order(...)`. El fragmento exacto era `::text[])<>'{}'::jsonbor not (v_accepted_pricing?&array[...]::text[])`.
- **Causa y corrección:** reconstruí en memoria `pg_get_functiondef` vigente (MD5 `ed11bdd80c3a3ffaba58c2582fdf60f0`) y apliqué en orden las sustituciones de la migración, sin escritura en Production. La concatenación del comparador unía `::jsonb` y `or not` sin espacio: `...<>'{}'::jsonbor not (...)`. Se corrigió únicamente a `...<>'{}'::jsonb or not (...)`. Las anclas se encontraron con cuentas `1` declaración, `1` hash de solicitud, `2` ramas de idempotencia, `1` allowlist, `1` comparación de precio y `1` metadatos. Las dos apariciones confirman que se cubren tanto el replay inicial como `EXCEPTION WHEN unique_violation`.
- **Comprobación transaccional en Production (2026-11-15):** se envió una vez el script autorizado, sin modificación, en una sola llamada MCP. Resultado: `SQLSTATE P0001`, `ECOMMERCE_PRICE_CONFIRMATION_V1_PUBLIC_ERROR_PREFLIGHT_FAILED`, `CONTEXT: PL/pgSQL function inline_code_block line 26 at RAISE`. No fue el error `42601` de la ejecución de instalación anterior. El primer bloque ejecutó `EXECUTE v_definition` para `public.ecommerce_create_order` y completó su postcheck dentro de la transacción; el segundo bloque falló en su preflight, antes del `EXECUTE` de `private.ecommerce_public_error`. Por tanto, no se obtuvo un resultado de compilación completo para ambas funciones.
- **Causa exacta de P0001:** el archivo canónico de migración usa LF. Al preparar el script original, el cuerpo copiado tenía CRLF. El fragmento literal `$before$` de la precondición para `private.ecommerce_public_error` empieza con LF; la definición leída de Production contiene ese anchor en posición `4211`, mientras que la búsqueda de la variante CRLF devuelve posición `0`. El guard falló correctamente y abortó antes de modificar la función auxiliar. MCP no devolvió posición del error; el contexto disponible fue `PL/pgSQL function inline_code_block line 26 at RAISE`. No se cambió ni debilitó el preflight canónico.
- **Postflight independiente:** después del error, consultas de solo lectura confirmaron PostgreSQL `17.6`, ledger con 360 entradas, target count `0`, latest `20261114055610`; ambas funciones conservaron los MD5 originales `ed11bdd80c3a3ffaba58c2582fdf60f0` y `0c68e50ab545d4b7911d7ad69977309c`, owner `postgres`, ACL, `SECURITY DEFINER` y `search_path` vacío. Los marcadores de la migración siguen ausentes y no quedó una sesión de la comprobación activa. No hay cambios persistentes.
- **Script corregido, no ejecutado:** `docs/runbooks/ecommerce-price-confirmation-v1-rollback-compile.sql`, SHA-256 `eec08d2be847b2f95200304078bbad463b678048bd3604d7022c803705c7e3eb`. Sus dos bloques `DO` son byte por byte idénticos a los bloques de la migración y el literal sensible conserva LF. Incluye una transacción, límites `lock_timeout=3s`, `statement_timeout=25s`, `transaction_timeout=60s`, preflight, ambas sustituciones, postflight y `ROLLBACK` final; no contiene `COMMIT`, registro de ledger, fixtures ni operaciones comerciales. Este nuevo hash requiere autorización explícita antes de una nueva ejecución; no se ha reintentado.
- **Preflight y estado Production:** proyecto `odlrhijtfyavryeqivaa`, `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.063`; ejecutor `postgres`; ledger 360, target count 0, latest `20261114055610`; las dependencias y propiedades de seguridad siguen intactas. No se instaló la migración.
- **Límite del intento:** los límites de tiempo y `ROLLBACK` estaban incluidos; la llamada retornó error antes de alcanzar el `ROLLBACK` textual final. El error abortó la transacción del servidor y el postflight independiente confirmó que no persistieron cambios. No se repitió.
- **Riesgo temporal:** `CREATE OR REPLACE FUNCTION` toma locks de catálogo/función que pueden hacer esperar llamadas concurrentes hasta el `ROLLBACK`. El límite de espera para locks es 3 s; cada sentencia está limitada a 25 s. Si el lock no se obtiene o una sentencia excede el límite, el preflight/postflight aborta y se confirma el estado mediante lecturas independientes.
- **Autorización:** el propietario autorizó una comprobación transaccional para el hash anterior `0b68…`; ese intento ya se consumió. La autorización no cubre el nuevo hash ni una instalación definitiva. No se hizo merge, no se registró ninguna versión y no se instalaron cambios persistentes.
- **QA SQL y concurrencia local:** bloqueados. Docker Desktop está disponible, pero el servicio/daemon no arrancó y requiere elevación que esta sesión no tiene; no hay distribución WSL y el PostgreSQL local no tiene `postgres.bki`. El fixture SQL reusable no contiene la función real, sus helpers ni las tablas necesarias. Dos intentos locales razonables no produjeron un entorno fiel. No se usaron funciones ficticias, Production ni un proyecto externo para suplirlo.
- **CI PostgreSQL aislado:** se intentó reconstruir el proyecto con Supabase CLI 2.79.0 y PostgreSQL 17 en un job efímero, sin secretos ni conexión a Production. `supabase start` inició el stack, pero `supabase db reset --local --no-seed` falló en la primera migración, `20260614224210_harden_public_tables_and_pos_rpcs.sql`, con `relation "public.plans" does not exist (SQLSTATE 42P01)`. La limpieza `supabase stop --no-backup` terminó correctamente. La migración objetivo y `supabase/tests/ecommerce_price_confirmation_v1_test.sql` no se ejecutaron; tampoco C1–C5. El historial de migraciones del repositorio no recrea por sí solo una base vacía y fiel. Se retiró el workflow diagnóstico fallido en lugar de dejar un check roto.
- **QA manual:** pendiente; no hay portal QA autorizado para escrituras.
- **Production:** sin cambios persistentes; la única transacción anterior falló y se revirtió. Migración sin instalar.

## Comprobación transaccional de compilación

La comprobación solo crea las dos funciones dentro de la transacción y no las invoca. El intento del hash anterior terminó en el preflight del helper y no constituye un PASS. El script corregido está preparado pero requiere una nueva autorización del propietario. Antes de otra ejecución, revalidar proyecto, HEAD, ambos SHA-256, hashes/ACL/owner/configuración de las funciones y ledger. Si algo difiere, detenerse.

Con nueva autorización, enviar el contenido completo de `docs/runbooks/ecommerce-price-confirmation-v1-rollback-compile.sql` (SHA-256 `eec08d2be847b2f95200304078bbad463b678048bd3604d7022c803705c7e3eb`) como el parámetro `query` de **una sola** llamada `mcp__codex_apps__supabase_execute_sql` con `project_id="odlrhijtfyavryeqivaa"`. No separar llamadas ni quitar el `ROLLBACK` final. El script ejecuta el cuerpo canónico sin sus delimitadores exteriores y no registra la versión en el ledger. Ante cualquier error, capturar SQLSTATE/mensaje/contexto y hacer únicamente postflight independiente de solo lectura; no reintentar sin autorización.

Si la llamada finaliza correctamente, debe terminar con `ROLLBACK`. En cualquier resultado (éxito o error), en una llamada nueva solo de lectura, ejecutar:

```sql
select count(*) as ledger_total,
       count(*) filter (where version = '20261114231943') as target_count,
       max(version) as latest_version
from supabase_migrations.schema_migrations;

select p.oid::regprocedure as signature,
       md5(p.prosrc) as source_md5,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as function_config,
       p.proacl::text[] as execute_acl,
       position('acceptedPricing' in p.prosrc) = 0 as acceptance_marker_absent,
       position('priceAcceptanceHash' in p.prosrc) = 0 as hash_marker_absent
from pg_proc p
where p.oid in (
  'public.ecommerce_create_order(text,jsonb,jsonb,text)'::regprocedure,
  'private.ecommerce_public_error(text)'::regprocedure
)
order by 1;
```

Esperado: ledger total `360`, target count `0`, latest `20261114055610`; MD5 originales `ed11bdd80c3a3ffaba58c2582fdf60f0` y `0c68e50ab545d4b7911d7ad69977309c`; owner, ACL, `SECURITY DEFINER` y `search_path` idénticos al preflight; marcadores ausentes. Si la compilación completa y el postflight pasan, detenerse: la instalación requiere una autorización distinta.

`CREATE OR REPLACE FUNCTION` puede esperar por el lock de función y mantenerlo hasta el `ROLLBACK`, por lo que llamadas concurrentes al checkout podrían esperar. `lock_timeout=3s` limita la espera por locks, `statement_timeout=25s` limita cada sentencia y `transaction_timeout=60s` limita la transacción completa; estos límites son locales y se revierten. No existe garantía de despliegue atómico, aunque no se confirma ningún cambio.

## Alcance y orden de activación

La migración modifica únicamente `public.ecommerce_create_order(text,jsonb,jsonb,text)` y el mensaje de `private.ecommerce_public_error(text)`. No agrega tablas, índices, políticas, grants ni reservas. El servidor sigue calculando los precios; compara cada aceptación de línea con su snapshot económico vigente dentro de la misma transacción. Rechaza clientes que no envíen `acceptedPricing` con `ECOMMERCE_CATALOG_REVISION_CHANGED`.

No ejecutar durante esta revisión. Requiere autorización explícita del propietario. La política canónica del repositorio exige que, más adelante, el mismo PR se fusione primero a `main`; después se use únicamente el workflow manual `.github/workflows/supabase-production-migrations.yml` desde ese `main`. En Vercel se observaron despliegues automáticos de `main` con target `production`. No se demostró un mecanismo seguro y reversible para retener solo el nuevo frontend; no se cambió Vercel. Pausar el proyecto completo afectaría el servicio activo y no constituye una retención segura. El propietario debe coordinar la aplicación SQL antes del despliegue automático o aceptar explícitamente una ventana breve de fallo cerrado del checkout. Mientras la base mantenga la función anterior, el nuevo campo `acceptedPricing` no está permitido y los nuevos envíos pueden rechazarse; no deberían crear pedidos con un precio distinto. No se promete despliegue atómico.

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
