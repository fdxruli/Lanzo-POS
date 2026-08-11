# Aislamiento local por tenant

## Incidente y causa raíz

`LanzoDB1` era una sola base Dexie por origen del navegador. Sus tablas de
negocio no tenían `licenseId` y el bootstrap podía autenticar una licencia
nueva, cargar `company`/catálogo y arrancar sync sobre los registros que había
dejado la licencia anterior. El reset de catálogo solo limpiaba memoria; no
establecía propiedad sobre la persistencia.

La clasificación del incidente es **LOCAL TENANT DATA ISOLATION FAILURE**. No
hubo evidencia de asociación incorrecta en Supabase; la fuga era local.

## Modelo anterior

```text
AUTH -> LanzoDB1 global -> profile/catalog -> sync -> ready
```

La identidad física del dispositivo (`lanzo_device_id`) se conservaba, pero no
existía una identidad local separada para el negocio.

## Modelo nuevo de fase 1

```text
AUTH
  -> resolve tenant identity
  -> LocalTenantGuard
       -> binding compatible: GRANTED
       -> binding incompatible: LOCAL_TENANT_MISMATCH
       -> legacy ambiguo: LOCAL_TENANT_LEGACY_UNRESOLVED
  -> profile
  -> catalog
  -> sync
  -> ready
```

La base continúa llamándose `LanzoDB1`. Dexie v31 agrega únicamente la tabla
`local_tenant_binding` (`key = primary`). La migración es forward-only: no
elimina tablas, no vacía registros y no hace un backfill ciego durante
`upgrade()`.

El binding guarda una identidad estable, no el nombre del negocio ni el
correo. Se prefiere `license_id` cuando el contrato lo entrega; la alternativa
actual es `SHA-256(license_key)` mediante Web Crypto. La clave real no se copia
al binding.

El guard se bloquea después del preflight estructural y antes de importar el
runtime administrativo. Un middleware DBCore rechaza lecturas y mutaciones de
tablas tenant-owned mientras el estado no sea `GRANTED`. Las APIs de sync son
fail-closed incluso si alguien intenta llamarlas antes de inicializar el guard.

## Resolución de estados

- Base nueva, sin binding ni datos: se liga a la licencia autenticada.
- Mismo tenant: acceso normal; no se borra ni migra contenido.
- Binding A e intento B: se bloquea antes de profile, catálogo, Layout,
  backups o sync, incluso si la base está vacía. El binding es deliberadamente
  sticky en fase 1 para eliminar carreras entre pestañas y escritores tardíos.
- Base legacy con datos no etiquetados (productos, ventas, clientes, lotes,
  cachés de navegador, etc.): se bloquea. Un `company` mutable o una clave de
  sync no pueden atribuir de forma inequívoca filas globales ya contaminadas.
- El backfill legacy automático queda limitado al caso estrecho donde todos
  los registros ocupados son perfiles `company` con la misma licencia
  explícita y no existe ninguna store/caché no atribuible ni evidencia en
  conflicto. Cualquier duda produce `LOCAL_TENANT_LEGACY_UNRESOLVED`.
- Si no se puede inspeccionar el almacenamiento del navegador, se bloquea; un
  fallo de enumeración nunca equivale a una base vacía.

Las evidencias se comparan por identidad criptográfica y no se exponen en el
estado de UI ni en logs públicos.

## Clasificación de tablas

Ante cualquier duda, una tabla nueva es **tenant-owned por defecto**.

| Alcance | Tablas / registros | Motivo |
| --- | --- | --- |
| Tenant-owned: catálogo e inventario | `menu`, `product_batches`, `categories`, `ingredients`, `images`, `inventory_events` | Productos, recetas, stock, lotes y recursos del negocio. |
| Tenant-owned: ventas/clientes | `sales`, `customers`, `layaways`, `customer_ledger` | Operaciones, identidad de clientes, crédito y apartados. |
| Tenant-owned: caja | `cajas`, `movimientos_caja` | Sesiones y movimientos financieros. |
| Tenant-owned: configuración | `company`, `theme` | Perfil, datos fiscales/comerciales y presentación del negocio. |
| Tenant-owned: métricas/auditoría | `global_stats`, `daily_stats`, `waste_logs`, `processed_sales_log`, `transaction_log`, `sequences`, `corrupted_states` | Agregados, numeración, payloads y recuperación del negocio. “Global” significa global al negocio, no a todas las licencias. |
| Tenant-owned: papeleras | `deleted_menu`, `deleted_customers`, `deleted_sales`, `deleted_categories` | Datos recuperables del tenant. |
| Tenant-owned: sync | `sync_outbox`, `sync_meta`, `sync_conflicts` | Cursores, operaciones y conflictos nunca deben reutilizar credenciales de otra licencia. |
| Tenant-owned: recovery | `__lanzo_sales_backup_v30`, `__lanzo_deleted_sales_backup_v30` | Copias de ventas; cuentan para determinar ocupación. |
| Mixto, tenant-sensitive | `sync_cache` | Todo registro cuenta como tenant salvo la allowlist cerrada indicada abajo. |
| Device-owned | `sync_cache.lanzo_device_id`, `sync_cache.lanzo_license_attempts` | Identidad física y rate limit del dispositivo; están disponibles antes del tenant. |
| Global/recovery | `local_tenant_binding`, `__lanzo_db_recovery` | Autoridad de aislamiento y metadata estructural, no contenido comercial. |

`security_monotonic_clock`, tokens, sesiones, validaciones y cualquier clave
desconocida de `sync_cache` se consideran tenant-sensitive. No se amplía la
allowlist por inferencia.

## Cachés fuera de IndexedDB

También cuentan como ocupación comercial cuando contienen datos:

- `lanzo-active-orders-storage`;
- `lanzo-cart-storage` y `lanzo-inventory-storage` legacy;
- prefijo `lanzo-cart-storage-corrupted-`;
- `lanzo:restaurant-order-close-pending:v1`;
- `ignored_expirations_ttl`;
- `lanzo_cash_opening_policy`.

La caché de órdenes activas no se hidrata ni escribe mientras el guard está
bloqueado. Al hacer logout/mismatch se retira de memoria sin eliminar el valor
persistido, y se rehidrata solo tras conceder de nuevo el mismo tenant. Un
fallo de cuota no purga otras claves de Lanzo.

`lanzo_drive_session:v1` contiene un token OAuth temporal en `sessionStorage`.
Se trata como sesión tenant-sensitive: no se hidrata antes de `GRANTED` y se
retira de memoria en logout/mismatch sin borrar el valor persistido de A; solo
se rehidrata cuando el mismo tenant vuelve a quedar `GRANTED`. Las claves del storefront público están
separadas por slug/token y no se usan para decidir la propiedad de `LanzoDB1`.

## Protección de sync y colas

Antes de arrancar bootstrap POS, pull, outbox, realtime o construir contexto
RPC se exige:

```text
active tenant === local database tenant
```

Las filas de `sync_outbox` se seleccionan por igualdad estricta de
`licenseKey`. Una fila legacy sin licencia queda intacta: no se selecciona, no
se resetea y no recibe las credenciales activas. Cada mutación del outbox vuelve
a comprobar propietario.

Los handlers y snapshots se ejecutan con un lease de tenant. El binding sticky
impide rebinds A→B y el lease descarta operaciones si logout/mismatch bloqueó
el controller; los errores de aislamiento se relanzan y los cursores no avanzan. Antes de
aplicar respuestas tardías y antes de cada commit de metadata se revalida la
licencia capturada al inicio de la operación.

La cola de cierres de restaurante ahora guarda `licenseKey` en filas nuevas y
solo reintenta coincidencias exactas. Las filas legacy sin licencia permanecen
sin cambios para recuperación asistida.

## Logout, offline y actores

Logout no borra IndexedDB ni el binding. Primero retira profile/catálogo del
render, detiene sync, limpia únicamente credenciales de actor y deja el acceso
tenant bloqueado. Conserva el token de dispositivo, la última validación y el
reloj monotónico necesarios para el retorno offline del mismo tenant. Drive y
la política de caja se retiran de memoria, pero su persistencia no se elimina.

Una licencia FREE del mismo tenant puede abrir offline usando el binding y la
validación local existentes. El guard no requiere una llamada cloud una vez
establecida la identidad.

Admin y Staff son actores, no tenants. Cambiar de actor dentro de la misma
licencia conserva el binding y los datos. Sus tokens se persisten únicamente
después de volver a comprobar el tenant. El logout del actor bloquea de nuevo
el runtime local hasta autenticar un actor compatible, pero no borra la base.

## Comportamiento de mismatch

`appStatus = local_tenant_mismatch` monta una pantalla de bloqueo independiente.
No monta `Layout`, profile, catálogo, BackupRuntime ni coordinadores sync. No
ofrece botón de borrado. El usuario puede volver al login para usar la licencia
anterior o abrir la nueva licencia en otro perfil de navegador.

Secuencia de recuperación soportada:

```text
Tenant A -> logout -> intento Tenant B -> BLOCK -> login Tenant A -> PASS
```

## BackupManager

Fase 1 conserva el nombre `LanzoDB1`, pero el nuevo binding sí exige una
frontera adicional en el worker. Backup/restore requieren un tenant `GRANTED`;
el worker compara sus aliases con `local_tenant_binding`, incluye la identidad
hasheada en el header autenticado y rechaza un restore legacy o de otro tenant
antes de `clearTablesBeforeImport`. El runtime tampoco se monta en mismatch.

El timeout de configuración observado durante el incidente se registra como
hallazgo independiente; no se atribuye al binding y no se modifica en este
cambio.

Los workers de estadísticas y migración también reciben únicamente aliases
hasheados, comparan el binding antes de leer/escribir datos tenant-owned y se
cancelan o descartan sus resultados cuando el guard deja de estar concedido.

## Validación manual QA

Usar un perfil de navegador creado para QA, nunca datos reales del incidente:

1. Iniciar Tenant A y crear `TENANT-A-PRODUCT`.
2. Cerrar sesión.
3. Autenticar Tenant B.
4. Confirmar la pantalla de mismatch y que no aparece Layout, profile,
   catálogo ni actividad RPC/outbox de B.
5. Volver al login y autenticar Tenant A.
6. Confirmar que `TENANT-A-PRODUCT` y las colas de A siguen intactas.
7. Repetir mismo tenant offline y los cambios Admin -> Staff -> Admin.

## Limitación conocida y fase futura

Esta fase admite un solo tenant local propietario de `LanzoDB1`. No ofrece un
selector, rebind automático ni alternancia de varios tenants locales.

`LOCAL.TENANT.ISOLATION.2` puede introducir bases separadas, por ejemplo
`LanzoDB::<tenant-id>`, o un particionamiento integral por tenant. Ese cambio
deberá seleccionar el nombre/base correcta en workers y migrar de forma
explícita todas las tablas, colas y cachés.
