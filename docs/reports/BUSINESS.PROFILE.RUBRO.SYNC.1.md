# BUSINESS.PROFILE.RUBRO.SYNC.1 — Sincronización autoritativa del rubro

## Estado

Implementación preparada para revisión en Pull Request. La migración queda versionada en Git y **no se aplica a producción antes del merge**.

## Incidente verificado

Una licencia PRO cambió su perfil de `abarrotes` a `hardware`. Supabase y el portal ecommerce conservaron correctamente `hardware`, pero algunos dispositivos móviles instalados continuaron usando el perfil local anterior incluso después de salir y volver a entrar.

## Causa raíz

El perfil del negocio y la licencia tienen ciclos de sincronización distintos, pero el cliente no los trataba como recursos independientes:

1. `companyProfile` se conserva en memoria e IndexedDB.
2. El perfil usa un TTL local de 12 horas.
3. La validación de licencia podía omitirse por su propio TTL antes de refrescar el perfil.
4. El cierre de sesión limpiaba la licencia y el estado en memoria, pero no invalidaba los marcadores de frescura del perfil.
5. El canal Realtime privado no reconocía cambios en `business_profiles`.
6. Una transición staff autenticada podía reutilizar la copia local aunque su rubro ya hubiera cambiado remotamente.

## Solución implementada

### 1. Perfil independiente del TTL de licencia

`runLicenseSyncCheck` refresca el perfil antes de decidir si la validación de licencia puede omitirse por TTL.

Se fuerza lectura remota en:

- inicio de sincronización (`start`);
- recuperación de red (`online`);
- fallback `hybrid_polling`;
- `realtime_safety_interval`;
- reconexión Realtime prolongada.

Los probes Realtime no críticos respetan el TTL del perfil para evitar consultas agresivas.

Una falla temporal al refrescar el perfil no bloquea la validación de seguridad de la licencia ni el modo offline.

### 2. Invalidación segura al cerrar sesión

Se eliminan únicamente:

- `Lanzo_last_profile_load`;
- `Lanzo_last_profile_license_key`.

No se elimina IndexedDB ni el perfil cacheado. Esto conserva el fallback offline y evita borrar datos POS locales.

### 3. Transición staff autoritativa

El cargador central detecta cuando existe una transición desde `staff_login_required` hacia una identidad staff ya autenticada. En ese caso ignora el TTL vigente y consulta el perfil remoto antes de marcar la aplicación como lista.

Esta decisión queda centralizada en `createProfileSlice` y no depende del formato ni de la implementación interna del módulo de sesión staff.

### 4. Evento privado Realtime

La migración añade el evento:

```text
BUSINESS_PROFILE_UPDATED
```

El evento se registra en `public.license_events` y se distribuye únicamente por los topics privados y opacos existentes para dispositivos activos con `realtime_license_sync`.

El payload contiene solamente:

- `profile_id`;
- `updated_at`;
- `profile_revision`;
- `business_type`.

No se transmiten teléfono, dirección, tokens, credenciales ni secretos.

El cliente no confía en el payload como fuente de verdad: al recibir el evento fuerza una nueva lectura de `get_business_profile_anon`.

## Migración Supabase

Archivo:

```text
supabase/migrations/20260806061500_business_profile_rubro_realtime_sync.sql
```

### `public.get_business_profile_anon_unlimited(text)`

Conserva el contrato existente y agrega:

- `updated_at`;
- `profile_revision` en milisegundos Unix.

No cambia los permisos existentes ni el RPC público con rate limit que la envuelve.

### `private.broadcast_license_event()`

Agrega `BUSINESS_PROFILE_UPDATED` a la lista de eventos dirigidos a todos los dispositivos activos de la licencia.

Conserva:

- `SECURITY DEFINER`;
- `search_path = ''`;
- topics privados por dispositivo;
- validación de la feature Realtime;
- filtrado de dispositivos activos.

### `private.emit_business_profile_updated_event()`

Nueva función trigger que:

1. ignora actualizaciones sin cambios efectivos en los campos públicos del perfil;
2. resuelve la licencia por `license_id`;
3. inserta un evento privado con metadata mínima;
4. no modifica productos, ventas, inventario, caja, sesiones ni ecommerce.

Se revoca ejecución a `PUBLIC`, `anon` y `authenticated`.

### `trg_business_profile_realtime_event`

Trigger `AFTER INSERT OR UPDATE OF`:

- `business_name`;
- `phone_number`;
- `address`;
- `logo_url`;
- `business_type`.

No sustituye ni elimina el trigger existente de reconciliación de capacidades ecommerce.

## Impacto de datos

- Sin backfill.
- Sin `DELETE`.
- Sin actualización masiva.
- Sin cambios de enum.
- Sin nuevas tablas.
- Sin cambios de RLS.
- Sin exposición de nuevos datos públicos.
- Sin migraciones históricas modificadas.

## Pruebas añadidas

### JavaScript

- invalidación de marcadores del perfil;
- refresco del perfil antes del TTL de licencia;
- lectura forzada en inicio y polling;
- probes Realtime que respetan TTL;
- recepción de `BUSINESS_PROFILE_UPDATED` con metadata;
- lectura autoritativa desde el store;
- transición staff autenticada que ignora un perfil local fresco pero obsoleto;
- separación entre eventos de perfil y eventos de licencia.

### SQL

Archivo:

```text
supabase/tests/business_profile_rubro_realtime_sync_test.sql
```

Valida dentro de `BEGIN/ROLLBACK`:

1. un cambio de rubro crea exactamente un evento;
2. el evento incluye `profile_revision`;
3. `business_type` es un arreglo;
4. el RPC devuelve el perfil;
5. el RPC incluye revisión y `updated_at`;
6. el broadcast permite el nuevo tipo de evento.

## Despliegue recomendado después del merge

1. Aplicar la migración Supabase versionada.
2. Verificar la definición de las funciones y el trigger.
3. Publicar la aplicación.
4. Cambiar temporalmente un perfil de prueba entre dos rubros compatibles.
5. Confirmar que un móvil PRO abierto cambia su interfaz sin cerrar sesión.
6. Confirmar que un móvil sin Realtime se actualiza al reiniciar o mediante fallback polling.
7. Confirmar que el modo offline conserva el último perfil utilizable.

## Rollback operativo

Para revertir solamente el comportamiento Realtime:

1. eliminar `trg_business_profile_realtime_event`;
2. eliminar `private.emit_business_profile_updated_event()`;
3. restaurar `private.broadcast_license_event()` sin `BUSINESS_PROFILE_UPDATED`;
4. conservar los campos adicionales del RPC, ya que son aditivos y compatibles.

La aplicación sigue funcionando si el evento todavía no existe: arranque, transición autenticada y polling realizan el refresco autoritativo como fallback.

## Exclusiones

- No se modifica `main` directamente.
- No se aplica la migración a producción antes de la revisión.
- No se hace merge ni auto-merge.
- No se ejecuta deployment manual ni promoción de preview.
- No se borran cachés IndexedDB ni datos POS.
- No se modifica el catálogo ecommerce ni las reglas de capacidades por rubro.
