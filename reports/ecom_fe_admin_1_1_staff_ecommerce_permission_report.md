# ECOM.FE.ADMIN.1.1 — Permiso staff para administrar el portal ecommerce

## Estado

Implementación completada en la rama `fase-ecom-fe-admin-1-1-staff-permission` y publicada en el PR `#82`.

Supabase producción: `odlrhijtfyavryeqivaa`.

Migraciones aplicadas de forma controlada:

1. `ecom_fe_admin_1_1_staff_permission` — autorización v2 y sobrecargas RPC.
2. `ecom_fe_admin_1_1_rate_limit_actor_partition` — primer hardening admin/staff.
3. `ecom_fe_admin_1_1_device_rate_limit` — corrección ECOM.FE.ADMIN.1.1.1 con bucket previo exclusivamente por dispositivo.

Archivos versionados:

- `supabase/migrations/20260710070000_ecom_fe_admin_1_1_staff_permission.sql`
- `supabase/migrations/20260710071000_ecom_fe_admin_1_1_rate_limit_actor_partition.sql`
- `supabase/migrations/20260710072000_ecom_fe_admin_1_1_device_rate_limit.sql`

Las dos primeras migraciones ya estaban aplicadas y no fueron editadas ni renombradas. No se aplicaron migraciones ajenas y no se usó `db push`, `migration repair` ni `--include-all`.

## 1. Causa raíz original

El acceso al portal online dependía exclusivamente del rol físico del dispositivo.

Frontend anterior:

```js
canAccess('settings') && currentDeviceRole === 'admin'
```

Backend anterior:

```sql
d.device_role = 'admin'
```

Un staff con sesión válida y permisos explícitos no podía visualizar ni invocar la administración ecommerce.

## 2. Condición frontend anterior

`SettingsPage.jsx` ocultaba `Portal online` a cualquier dispositivo no admin. Tampoco existía una capacidad staff específica ni una guarda adicional antes de montar `EcommercePortalSettings` desde `?tab=portal-online`.

## 3. Restricción backend anterior

Las cinco RPC administrativas usaban `private.ecommerce_admin_authorize(...)`, que:

- solo aceptaba `device_role = 'admin'`;
- no recibía sesión staff;
- no consultaba los permisos vigentes `settings` y `ecommerce`.

## 4. Matriz admin/staff vigente

| Actor | Condición | Resultado |
|---|---|---|
| Admin | Dispositivo activo, licencia activa y security token válido | Permitido sin sesión staff |
| Staff | Sesión válida, mismo dispositivo/licencia/usuario y ambos permisos | Permitido |
| Staff sin sesión | Token nulo o vacío | `ECOMMERCE_STAFF_SESSION_REQUIRED` |
| Staff con sesión inválida | Token incorrecto, revocada, vencida, usuario inactivo u otro dispositivo | `ECOMMERCE_STAFF_SESSION_INVALID` |
| Staff sin `settings` o sin `ecommerce` | Falta cualquiera de los dos permisos | `ECOMMERCE_STAFF_PERMISSION_DENIED` |
| Otro rol | No es admin ni staff | `ECOMMERCE_ADMIN_ACCESS_DENIED` |

## 5. Helper privado

Firma vigente:

```sql
private.ecommerce_admin_authorize_v2(
  p_license_key text,
  p_device_fingerprint text,
  p_security_token text,
  p_staff_session_token text,
  p_rpc_name text
)
```

Propiedades verificadas:

- `LANGUAGE plpgsql`;
- `SECURITY DEFINER`;
- `SET search_path TO ''`;
- argumentos nombrados;
- sin ejecución para `public`, `anon` ni `authenticated`;
- no devuelve licencia, fingerprint, tokens ni hashes.

La partición vigente del rate limiter es exclusivamente por dispositivo para todos los actores. El token staff nunca participa en el bucket previo.

## 6. Firmas RPC nuevas

Sobrecargas sin valores por defecto:

```sql
public.ecommerce_admin_get_portal(text, text, text, text)
public.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)
public.ecommerce_admin_list_published_products(text, text, text, text)
public.ecommerce_admin_upsert_published_product(text, text, text, text, jsonb)
public.ecommerce_admin_set_product_published(text, text, text, text, uuid, boolean)
```

El cuarto argumento sigue siendo `p_staff_session_token` porque se necesita para autorizar al staff después del rate limit previo.

## 7. Estrategia de compatibilidad

Las firmas antiguas se conservaron intactas y siguen usando `private.ecommerce_admin_authorize(...)`.

- El frontend anterior continúa funcionando para admin.
- Una firma antigua sin token no autoriza staff.
- No hay `DEFAULT NULL` que genere ambigüedad en PostgREST.
- El frontend nuevo invoca siempre las sobrecargas con token staff explícito.

## 8. Validación de sesión staff

El helper v2 reutiliza:

```sql
public.verify_staff_session_unlimited(
  p_license_key := ...,
  p_device_fingerprint := ...,
  p_staff_session_token := ...
)
```

Se exige `valid = true`. La función valida licencia, dispositivo, hash, expiración, revocación, usuario activo y vínculo de la sesión con el dispositivo.

## 9. Permisos obligatorios

Después de verificar la sesión, el backend vuelve a consultar `public.license_staff_users` y exige:

```sql
coalesce((permissions->>'settings')::boolean, false) is true
and coalesce((permissions->>'ecommerce')::boolean, false) is true
```

No se confía en `currentStaffUser`, permisos enviados por el cliente ni snapshots de sesión.

## 10. Protección contra sesión de otro dispositivo o usuario

Además de `verify_staff_session_unlimited`, se verifica:

```sql
staff_user.id = license_devices.staff_user_id
```

Una sesión válida vinculada a otro dispositivo fue rechazada en la prueba transaccional.

## 11. Revocación inmediata

Dentro de una transacción se cambió únicamente `permissions.ecommerce` a `false` manteniendo activa la sesión. La siguiente RPC respondió `ECOMMERCE_STAFF_PERMISSION_DENIED`.

El fixture fue restaurado mediante `ROLLBACK`.

## 12. Resultado admin

Con dispositivo admin activo y `p_staff_session_token = null`:

- obtener portal: PASS;
- listar productos: PASS;
- guardar portal en rollback: PASS.

Admin con token arbitrario:

- conserva acceso por dispositivo: PASS;
- comparte el mismo bucket que la llamada con token nulo: PASS;
- una sola fila de rate limit: PASS;
- contador `1 → 2`: PASS;
- `staff_session_hash IS NULL`: PASS.

## 13. Resultado staff autorizado

Con dispositivo staff activo, sesión fixture válida y `settings=true`, `ecommerce=true`:

- obtener portal: PASS;
- listar productos: PASS;
- guardar portal en rollback: PASS;
- crear/actualizar producto en rollback: PASS;
- publicar/despublicar en rollback: PASS.

El token válido se utiliza únicamente para autorización posterior. El bucket previo sigue siendo por dispositivo y tiene `staff_session_hash IS NULL`.

## 14. Resultado staff no autorizado

Casos verificados con rollback:

- `settings=true`, `ecommerce=false`: rechazado;
- `settings=false`, `ecommerce=true`: rechazado;
- token nulo: rechazado;
- token incorrecto: rechazado;
- sesión revocada: rechazado;
- sesión vencida: rechazado;
- usuario inactivo: rechazado;
- sesión de otro dispositivo: rechazado;
- firma antigua sin token desde dispositivo staff: rechazado.

Resultados consolidados:

- `DEVICE BUCKET FRAGMENTATION MATRIX: PASS`
- `AUTHORIZATION REGRESSION MATRIX: PASS`

## 15. Verificación read-only de caja1

Producción confirmó:

```json
{
  "username": "caja1",
  "role_name": "custom",
  "is_active": true,
  "settings": true,
  "ecommerce": true,
  "device_role": "staff",
  "device_active": true
}
```

El JSON real conserva sin cambios los demás permisos, incluidos `pos`, `products`, `cash_register`, `discounts` y `notifications`. No se sobrescribió el objeto completo ni se modificó contraseña, username, role name, device role o sesiones reales.

## 16. Confirmación de que caja1 no fue convertido a admin

`caja1` continúa vinculado a un dispositivo activo con `device_role = 'staff'`.

No se concedió acceso por username o `role_name`.

## 17. Grants y helpers privados

Verificación posterior a la tercera migración:

- helper v2: `SECURITY DEFINER=true`;
- `search_path=''`;
- `anon_execute=false`;
- `authenticated_execute=false`;
- `public_execute=false`;
- grants directos sobre tablas `public.ecommerce_%`: **0 filas**.

No se modificaron los grants de las cinco RPC públicas.

## 18. Frontend, lint, pruebas y build

No se realizaron cambios funcionales de frontend en ECOM.FE.ADMIN.1.1.1.

Continúa vigente:

- admin + `settings` → acceso;
- staff + `settings + ecommerce` → acceso;
- staff sin cualquiera de ambos permisos → bloqueo;
- todas las RPC envían `p_staff_session_token: authContext.staffSessionToken || null`;
- no existe reintento sin token;
- no existe fallback a firmas antiguas.

Validaciones ejecutadas:

| Validación | Resultado |
|---|---|
| ESLint específico | PASS, exit 0 |
| Vitest específico | PASS, 2 archivos y 8 pruebas |
| Build Vite/PWA | PASS, exit 0 |
| `npm run lint` global | FAIL heredado: 34 errores y 116 advertencias |
| `npm run test:ci` global | FAIL heredado: 65 archivos PASS, 28 FAIL; 354 pruebas PASS, 79 FAIL |

Las fallas globales están fuera de los archivos de esta fase. No se afirma que la suite global esté verde. Las dos suites específicas pasan también dentro de la ejecución global.

El runner temporal de validación fue retirado y `package.json` volvió a `build: vite build`.

## 19. Preview de Vercel

Alias de la rama:

`https://lanzo-pos-git-fase-ecom-fe-admin-1-1-s-bcb022-fdxrulis-projects.vercel.app`

El preview de validación completa quedó `READY`. Después de retirar el runner temporal se generó un preview limpio con el script estándar de producción.

## 20. Riesgos y operación posterior

1. El permiso visual depende del estado local del staff; tras cambiar permisos puede requerirse cerrar e iniciar sesión nuevamente.
2. El backend aplica la revocación en la siguiente RPC aunque la pestaña aún estuviera visible.
3. Las firmas antiguas se mantienen temporalmente para despliegue sin interrupción y continúan siendo admin-only.
4. La fase no modifica catálogo público, carrito, checkout, pedidos, ventas, caja, inventario ni reportes.
5. La línea base global de lint y tests conserva deuda técnica preexistente documentada.
6. No se agregó un segundo rate limiter por sesión; para esta superficie administrativa el límite previo por dispositivo es deliberado.

## Corrección ECOM.FE.ADMIN.1.1.1 — Rate limit por dispositivo

### 1. Defecto detectado

La segunda migración distinguía un dispositivo staff antes de verificar su sesión y enviaba el token suministrado al rate limiter. El helper de rate limit calculaba SHA-256 de cualquier token no vacío.

### 2. Por qué un token inválido creaba buckets distintos

La clave del bucket incluía `staff_session_hash`. Por ello, dos cadenas inválidas diferentes producían hashes diferentes y dos particiones independientes antes de ser rechazadas por `verify_staff_session_unlimited`.

### 3. Nueva partición exclusivamente por dispositivo

La tercera migración fuerza:

```sql
p_staff_session_token := null
```

en todas las llamadas previas a `public.enforce_pos_rpc_rate_limit_v2`.

La clave efectiva queda formada por licencia, fingerprint, RPC, scope y ventana, sin hash de sesión.

### 4. Confirmación de que el token sigue validándose

El frontend sigue enviando el token staff. Después del rate limit por dispositivo, `public.verify_staff_session_unlimited(...)` continúa validándolo para autorizar al staff.

### 5. Tokens inválidos distintos

Dos tokens inválidos diferentes desde el mismo dispositivo staff:

- ambos rechazados con `ECOMMERCE_STAFF_SESSION_INVALID`;
- una sola fila de bucket;
- `staff_session_hash IS NULL`;
- contador compartido `1 → 2`;
- resultado: PASS con rollback.

### 6. Token válido e inválido

Una llamada con token válido seguida de otra con token inválido:

- la válida fue autorizada;
- la inválida fue rechazada después del rate limit;
- ambas compartieron una sola fila;
- contador `1 → 2`;
- `staff_session_hash IS NULL`;
- resultado: PASS con rollback.

### 7. Resultado admin

Admin con token nulo y token arbitrario compartió una sola fila por dispositivo, contador `1 → 2` y hash nulo. Resultado: PASS.

### 8. Resultado staff autorizado

Las cinco RPC administrativas conservaron su funcionamiento para staff autorizado. Resultado: PASS.

### 9. Resultado staff no autorizado

Permisos parciales, sesión nula, incorrecta, revocada, vencida, usuario inactivo y sesión de otro dispositivo continuaron bloqueados. Resultado: PASS.

### 10. Grants

El helper privado conserva ejecución cerrada para `anon`, `authenticated` y `public`. Las tablas ecommerce continúan sin grants directos.

### 11. Verificación de caja1

`caja1` permanece activo, con `settings=true`, `ecommerce=true`, dispositivo activo y `device_role=staff`.

### 12. Pruebas frontend

- 2 archivos PASS;
- 8 pruebas PASS;
- frontend sin modificaciones funcionales;
- token staff continúa enviándose para autorización.

### 13. Build y migración aplicada

- migración aplicada: `ecom_fe_admin_1_1_device_rate_limit`;
- build Vite/PWA: PASS;
- definición instalada contiene `p_staff_session_token := null`;
- el rate limiter aparece antes de `verify_staff_session_unlimited`;
- producción reporta buckets ECOM_ADMIN con hash no nulo: **0**.

### 14. Riesgos residuales

El límite es por dispositivo, por RPC y por ventana. Varias sesiones válidas del mismo dispositivo comparten deliberadamente el mismo contador. Esto evita la fragmentación y es suficiente para la superficie administrativa actual.
