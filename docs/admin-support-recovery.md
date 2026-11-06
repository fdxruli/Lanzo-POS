# Recuperación administrativa asistida — candidato v1

Base verificada: `main` `3edf5198085207162466db388423e72f16d665ed`.
Proyecto único: Supabase Production `odlrhijtfyavryeqivaa`.
El Balón: licencia interna `d655758f-0ad8-4988-879d-7df08c6e7b19`.

## Estado de entrega

- Implementación preparada en una sola rama: `feat/admin-support-account-recovery`.
- PostgreSQL local real: 13 pruebas de emisión, canje, concurrencia, aislamiento,
  revocación, rollback y login FREE/PRO. Las tablas comerciales/entitlement son
  límites explícitos del fixture; esto no sustituye el QA de Production.
- Las seis funciones existentes usadas por las pruebas se extraen de migraciones
  canónicas. Sus cuerpos se contrastaron con Production el 2026-11-06: coinciden.
- Vitest: 163 pruebas en nueve archivos; ESLint de los archivos JavaScript
  modificados, build y comprobaciones de precaché PWA: correctos.
- Migración Production: **pendiente de autorización exacta; no instalada**.
- QA manual con el propietario: **pendiente**.
- Merge y frontend Production: **no autorizados ni ejecutados**.

## Autoridad y alcance

La sesión administrativa vigente se valida con
`private.require_active_admin_session`. Para solicitar un correo se vuelve a
comprobar la contraseña actual mediante bcrypt en el backend. El evento
`contact_requested_with_password` y la solicitud referencian la sesión real.
Soporte comprueba esos registros; una captura, una licencia o datos comerciales
no acreditan la titularidad.

El correo queda verificado únicamente cuando el propietario canjea el código
que soporte envió manualmente a la dirección devuelta por el backend, desde la
misma sesión que inició la solicitud. La solicitud dura 24 horas; la sesión debe
seguir vigente para emitir y confirmar. No se permite sustituir un contacto
verificado en v1. El cambio exige otro procedimiento con verificación independiente.

Para recuperar la contraseña, el operador selecciona la cuenta y el backend
obtiene exclusivamente su contacto verificado. No acepta un correo alternativo.
No se exige recordar el usuario. Este se devuelve solamente después de un canje
válido y el restablecimiento de contraseña.

Los códigos contienen una referencia aleatoria de 48 bits y un secreto de 128
bits, generados por `gen_random_bytes`. Solo se guarda SHA-256 del código, con
15 minutos de vigencia y cinco intentos por código. Reemisión invalida el código
anterior. Límites compartidos por licencia: una emisión cada 60 segundos, tres
por hora y cinco por día; la solicitud con contraseña tiene cinco intentos por
15 minutos. Una referencia aleatoria evita revelar estados de cuentas mediante
consultas con licencias conocidas.

Las mutaciones bloquean primero la fila de licencia, como el login existente.
El canje, hash bcrypt nuevo, consumo, auditoría y revocación de todas las sesiones
del propietario forman una transacción. Un fallo revierte todos esos cambios.
La nueva contraseña debe diferir de la anterior, tener 8 caracteres, letra y
número, y como máximo 72 bytes UTF-8, límite de bcrypt.

Las tablas están en `private`, con RLS y sin permisos para `PUBLIC`, `anon`,
`authenticated` o `service_role`. Las cuatro RPC públicas son la única superficie
del cliente: tres comprueban sesión propia; la cuarta exige el código temporal.
El emisor es `SECURITY INVOKER`, sin grants a roles de API: solo un operador con
acceso administrativo SQL puede ejecutarlo. No hay secreto estático nuevo.

No cambia licencia, plan, identidad, permisos, dispositivos, sesiones Staff ni
tablas comerciales. El login posterior conserva sus reglas existentes, incluidos
cupos y handoff de Staff en el mismo dispositivo. No se borra ni migra Dexie.

Una sesión completamente offline puede continuar hasta su límite local vigente:
como máximo siete días desde su última validación, acotado además por vencimiento
de sesión/licencia. El servidor rechaza la sesión revocada en su siguiente
validación u operación remota protegida. No se promete cierre offline inmediato
ni se deshacen operaciones que ya estaban en curso antes del restablecimiento.

## Migración exacta para revisar y autorizar

- Archivo: `supabase/migrations/20261106201326_admin_support_account_recovery_v1.sql`.
- Versión: `20261106201326`.
- SHA-256: `3a7eb520c926562e9d8c20b009da426d1307eae17255cc1766cad0de5cd56f3f`.
- Añade tres tablas privadas, dos índices explícitos además de PK/UNIQUE,
  dos helpers privados y cuatro RPC.
- Revoca grants por defecto y concede únicamente las cuatro RPC a `anon` y
  `authenticated`. Notifica recarga del esquema a PostgREST.
- No modifica funciones existentes, contraseñas, sesiones ni registros actuales
  al instalarse. No elimina objetos. El posterior uso del canje sí cambia una
  contraseña y revoca sesiones; no hay rollback que restaure una contraseña olvidada.
- Preflight: último ledger observado `20261106025114`; no existen las tablas nuevas.
  El Balón está en `pro_monthly`, con 3 dispositivos activos de un máximo de 5.

Tras autorización, aplicar **solo este archivo** al proyecto indicado y registrar
la misma versión/contenido en `supabase_migrations.schema_migrations`. No usar
`db push` general ni renombrar la versión silenciosamente. Si la herramienta de
migración asigna otra versión, verificar primero su procedimiento y alinear
explícitamente archivo y ledger; nunca repetir la instalación.

Verificar firmas, grants efectivos, RLS, hash del archivo, ledger y equivalencia
del SQL instalado. Antes del cierre, el commit canónico debe integrarse en `main`
mediante este mismo PR y con autorización de merge; hasta entonces el estado
debe declarar esa integración pendiente. No despachar automáticamente el workflow
general de migraciones, que puede incluir otras versiones.

## Operación de soporte: vincular correo

El propietario entra al Preview con sus credenciales conservadas y abre
**Configuración → Licencia y Rubros → Recuperación**. Introduce su correo y
contraseña actual, y pulsa **Solicitar vinculación**. Comparte con soporte la
referencia de solicitud; nunca su contraseña ni token de sesión.

Un operador autorizado abre SQL Editor en el proyecto correcto. Sustituye
`REFERENCIA_DE_SOLICITUD` por el UUID mostrado. Comprueba esta evidencia real:

```sql
select c.id as request_id, c.license_id, u.username, u.display_name,
       c.email as requested_email, c.requested_at,
       c.consumed_at, c.invalidated_at,
       s.revoked_at as session_revoked_at, s.expires_at as session_expires_at,
       d.is_active as device_active, d.device_mode,
       exists (
         select 1 from private.admin_recovery_audit a
         where a.challenge_id=c.id and a.action='contact_requested_with_password'
       ) as password_checked_by_backend
from private.admin_recovery_challenges c
join public.license_admin_users u
  on u.id=c.admin_user_id and u.license_id=c.license_id and u.is_owner and u.is_active
join public.license_admin_sessions s
  on s.id=c.request_session_id and s.admin_user_id=u.id and s.license_id=c.license_id
join public.license_devices d on d.id=s.device_id and d.license_id=c.license_id
where c.id='REFERENCIA_DE_SOLICITUD'::uuid
  and c.license_id='d655758f-0ad8-4988-879d-7df08c6e7b19'::uuid
  and c.purpose='contact';
```

Debe haber una solicitud reciente, no consumida ni invalidada, comprobación de
contraseña verdadera, sesión vigente y dispositivo activo permitido. La función
de emisión vuelve a comprobar estos requisitos, sin confiar en la captura del cliente.

```sql
select private.support_issue_admin_recovery_code(
  'd655758f-0ad8-4988-879d-7df08c6e7b19'::uuid,
  'contact',
  'IDENTIDAD_DEL_OPERADOR',
  'Solicitud y sesión comprobadas en backend; referencia INTERNA_DE_SOPORTE',
  'REFERENCIA_DE_SOLICITUD'::uuid
);
```

El resultado contiene `delivery_email`, `code` y `expires_at`. Enviar manualmente
el código **solo a `delivery_email`**, desde `lanzocontacto@gmail.com`. No enviarlo
a una dirección indicada después por el solicitante. No guardar el código en
auditorías, capturas, PR, consola ni diagnósticos. La salida administrativa es
necesaria para entregarlo; el código utilizable no se persiste en las tablas.

El propietario abre ese correo e introduce el código en la misma sesión de
LANZO. Debe aparecer **Correo verificado**. Soporte puede comprobarlo con:

```sql
select license_id, admin_user_id, email, verified_at
from private.admin_recovery_contacts
where license_id='d655758f-0ad8-4988-879d-7df08c6e7b19'::uuid;
```

Si no controla ese buzón, no puede completar la verificación. No marcar la tabla
como verificada manualmente para saltarse la prueba.

## Operación de soporte: recuperar acceso

El propietario pulsa **¿Olvidaste tus datos de acceso?** desde el login y escribe
a soporte. Identificar la cuenta mediante su registro previo; no es necesario
pedirle su usuario anterior. El UUID de El Balón ya está indicado para este QA.
En operación habitual se puede localizar un contacto registrado mediante:

```sql
select license_id, admin_user_id, email, verified_at
from private.admin_recovery_contacts
where email=lower(btrim('CORREO_PREVIAMENTE_VERIFICADO'));
```

El resultado solo es para el operador. Si aparecen varios negocios, comprobar
el contexto correcto antes de emitir. Si no existe contacto verificado, mantener
la solicitud pendiente hasta comprobar titularidad independientemente.

Esperar al menos 60 segundos desde la emisión anterior:

```sql
select private.support_issue_admin_recovery_code(
  'd655758f-0ad8-4988-879d-7df08c6e7b19'::uuid,
  'password',
  'IDENTIDAD_DEL_OPERADOR',
  'Recuperación solicitada; entrega exclusiva al contacto previamente verificado'
);
```

Enviar manualmente el código a `delivery_email`. El emisor obtiene la dirección
del contacto verificado y no acepta otra. No solicitar `service_role` al cliente.
El correo de soporte es un canal de contacto, no una exigencia de correo asociado
a la licencia histórica. Telegram conserva su presentación de referencia: la
página pública muestra «Send Message», pero no se ha probado recepción efectiva.

## QA manual con El Balón, con participación del propietario

1. Confirmar instalación autorizada del SQL y URL Preview conectada a
   `https://odlrhijtfyavryeqivaa.supabase.co`. No ejecutar este recorrido antes.
2. En Android o computadora, iniciar sesión normalmente. Un Preview tiene otro
   origen y su propio almacenamiento local; puede ocupar otro dispositivo según
   las reglas existentes. Hay dos cupos disponibles en el preflight; no liberar
   equipos automáticamente si eso cambia. No importar ni borrar bases locales.
3. Anotar datos visibles de inventario, ventas, clientes, caja, plan y permisos,
   y el estado de operaciones pendientes de este mismo origen antes de probar.
4. Solicitar correo, verificar evidencia backend, emitir código `contact`, enviarlo
   manualmente al correo del propietario y canjearlo. Confirmar el registro verificado.
5. Cerrar sesión administrativa. No liberar el dispositivo ni cambiar de licencia.
6. Desde **¿Olvidaste tus datos de acceso?**, solicitar a soporte un código
   `password`; soporte lo envía exclusivamente al contacto verificado.
7. Introducirlo, elegir una contraseña diferente y confirmarla. Verificar que la
   aplicación muestra el usuario original tras el éxito. No cambiar la contraseña
   antes de tener código y poder ejecutar el resto de estas comprobaciones.
8. Volver al login, probar una vez la contraseña anterior: debe rechazarse.
   Intentar reutilizar el código con una contraseña válida: debe indicarse usado.
9. Iniciar sesión con el usuario recuperado y la contraseña nueva. Debe abrirse
   realmente el POS; no basta una respuesta SQL exitosa.
10. Comparar los datos y permisos anotados. Confirmar que las sesiones admin previas
    están revocadas en backend y que el login nuevo emitió una nueva sesión.
    Un equipo desconectado sigue el límite offline explicado, sin prometer cierre inmediato.

Si se pierde la respuesta de red, la pantalla indica **operación no confirmada**.
Probar primero el login con la contraseña nueva. Un mensaje de código usado puede
ser consecuencia de un canje anterior exitoso cuya respuesta se perdió; no asumir
que el backend no cambió nada. Nunca repetir automáticamente una recuperación.

Registrar fecha, commit Preview, operador, referencias de solicitud/auditoría y
resultado de cada paso, **sin contraseñas ni códigos**. El QA queda pendiente hasta
que el propietario ejecute estos pasos. No probar otras cuentas sin autorización.

## Reproducir pruebas automatizadas

Con PostgreSQL 17 local y `psql` disponibles:

```sh
RECOVERY_TEST_PGURL=postgresql://postgres@127.0.0.1:55432/postgres \
  node --test scripts/supabase/admin-support-recovery.node-test.mjs
```

El runner rechaza hosts remotos y crea/elimina únicamente una base local temporal
`lanzo_recovery_test_<pid>`. No tiene credenciales productivas ni necesita Docker.
`RECOVERY_TEST_PSQL` permite seleccionar el binario. El workflow focalizado usa un
servicio PostgreSQL temporal y ejecuta también regresiones UI, offline y build.
