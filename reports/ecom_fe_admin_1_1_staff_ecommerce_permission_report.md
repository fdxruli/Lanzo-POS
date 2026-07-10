# ECOM.FE.ADMIN.1.1 — Permiso staff para administrar el portal ecommerce

## Estado

Implementación completada en la rama `fase-ecom-fe-admin-1-1-staff-permission` y publicada en el PR independiente `#82`.

Supabase producción: `odlrhijtfyavryeqivaa`.

Se aplicaron de forma controlada únicamente las migraciones de esta fase:

1. `ecom_fe_admin_1_1_staff_permission` — autorización v2 y sobrecargas RPC.
2. `ecom_fe_admin_1_1_rate_limit_actor_partition` — hardening de la partición admin/staff del rate limiter.

En el repositorio quedaron ordenadas como:

- `supabase/migrations/20260710070000_ecom_fe_admin_1_1_staff_permission.sql`
- `supabase/migrations/20260710071000_ecom_fe_admin_1_1_rate_limit_actor_partition.sql`

No se editaron migraciones antiguas, no se aplicaron migraciones ajenas y no se usó `db push`, `migration repair` ni `--include-all`.

## 1. Causa raíz

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
- enviaba siempre token staff nulo al rate limiter;
- no consultaba los permisos vigentes `settings` y `ecommerce`.

## 4. Nueva matriz admin/staff

| Actor | Condición | Resultado |
|---|---|---|
| Admin | Dispositivo activo, licencia activa y security token válido | Permitido sin sesión staff |
| Staff | Sesión válida, mismo dispositivo/licencia/usuario y ambos permisos | Permitido |
| Staff sin sesión | Token nulo o vacío | `ECOMMERCE_STAFF_SESSION_REQUIRED` |
| Staff con sesión inválida | Token incorrecto, revocada, vencida, usuario inactivo u otro dispositivo | `ECOMMERCE_STAFF_SESSION_INVALID` |
| Staff sin `settings` o sin `ecommerce` | Falta cualquiera de los dos permisos | `ECOMMERCE_STAFF_PERMISSION_DENIED` |
| Otro rol | No es admin ni staff | `ECOMMERCE_ADMIN_ACCESS_DENIED` |

## 5. Helper privado creado

Se creó:

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

El hardening complementario identifica el rol confiable del dispositivo antes de elegir la partición del rate limiter:

- admin, rol desconocido o credenciales no confiables: partición por dispositivo, token staff forzado a `null`;
- staff identificado por licencia, fingerprint y security token: partición por sesión staff.

Así un admin no puede fragmentar el límite enviando tokens arbitrarios.

## 6. Firmas RPC nuevas

Se agregaron sobrecargas sin valores por defecto:

```sql
public.ecommerce_admin_get_portal(text, text, text, text)
public.ecommerce_admin_upsert_portal(text, text, text, text, jsonb)
public.ecommerce_admin_list_published_products(text, text, text, text)
public.ecommerce_admin_upsert_published_product(text, text, text, text, jsonb)
public.ecommerce_admin_set_product_published(text, text, text, text, uuid, boolean)
```

El cuarto argumento es `p_staff_session_token`.

## 7. Estrategia de compatibilidad

Las firmas antiguas se conservaron intactas y siguen usando `private.ecommerce_admin_authorize(...)`.

Consecuencias:

- el frontend anterior continúa funcionando para admin;
- una firma antigua sin token no autoriza staff;
- no hay `DEFAULT NULL` que genere ambigüedad en PostgREST;
- el frontend nuevo invoca siempre las sobrecargas con token staff explícito.

## 8. Validación de sesión staff

El helper v2 reutiliza:

```sql
public.verify_staff_session_unlimited(
  p_license_key := ...,
  p_device_fingerprint := ...,
  p_staff_session_token := ...
)
```

Se exige `valid = true`. La función existente valida licencia, dispositivo, hash, expiración, revocación, usuario activo y vínculo de la sesión con el dispositivo.

## 9. Permisos obligatorios

Después de verificar la sesión, el backend vuelve a consultar `public.license_staff_users` y exige:

```sql
coalesce((permissions->>'settings')::boolean, false) is true
and coalesce((permissions->>'ecommerce')::boolean, false) is true
```

No se confía en `currentStaffUser`, en permisos enviados por el cliente ni en un snapshot de sesión.

## 10. Protección contra sesión de otro dispositivo o usuario

Además de `verify_staff_session_unlimited`, se verifica:

```sql
staff_user.id = license_devices.staff_user_id
```

Una sesión válida de otro dispositivo fue rechazada en la prueba transaccional.

## 11. Revocación inmediata

Dentro de una transacción se cambió únicamente `permissions.ecommerce` a `false` manteniendo activa la sesión. La siguiente RPC respondió `ECOMMERCE_STAFF_PERMISSION_DENIED`.

Esto confirma que el backend consulta permisos vigentes en cada llamada. El fixture fue restaurado mediante `ROLLBACK`.

## 12. Resultado admin

Con dispositivo admin activo y `p_staff_session_token = null`:

- obtener portal: PASS;
- listar productos: PASS;
- guardar portal en rollback: PASS;
- crear/actualizar producto en rollback: PASS;
- publicar/despublicar en rollback: PASS.

Prueba adicional del rate limiter:

- admin enviando un token arbitrario: sigue en la partición del dispositivo;
- no se creó una partición basada en el hash arbitrario;
- resultado: PASS con rollback.

## 13. Resultado staff autorizado

Con dispositivo staff activo, sesión fixture válida y `settings=true`, `ecommerce=true`:

- obtener portal: PASS;
- listar productos: PASS;
- guardar portal en rollback: PASS;
- crear/actualizar producto en rollback: PASS;
- publicar/despublicar en rollback: PASS;
- partición del rate limiter por sesión staff: PASS.

No se registró ni imprimió el token staff.

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

- `ECOM.FE.ADMIN.1.1 SQL MATRIX: PASS`
- `RATE LIMIT ACTOR PARTITION: PASS`

## 15. Verificación read-only de caja1

Producción confirmó:

```json
{
  "username": "caja1",
  "role_name": "custom",
  "is_active": true,
  "permissions": {
    "settings": true,
    "ecommerce": true
  }
}
```

El JSON real conserva sin cambios los demás permisos, incluidos `pos`, `products`, `cash_register`, `discounts` y `notifications`. No se sobrescribió el objeto completo ni se modificó contraseña alguna.

## 16. Confirmación de que caja1 no fue convertido a admin

`caja1` continúa vinculado a un dispositivo activo con `device_role = 'staff'`.

No se actualizó `license_devices.device_role` y no se concedió acceso por username o `role_name`.

## 17. Grants y helpers privados

Verificación posterior a ambas migraciones:

- RPC administrativas antiguas y nuevas: `SECURITY DEFINER`;
- `search_path = ''`;
- firmas públicas nuevas: `anon=true`, `authenticated=true`, `public=false`;
- helpers privados: `anon=false`, `authenticated=false`, `public=false`;
- grants directos sobre tablas `public.ecommerce_%`: **0 filas**.

## 18. Frontend, lint, pruebas y build

Cambios frontend:

- admin requiere `settings`;
- staff requiere simultáneamente `settings + ecommerce`;
- navegación directa no autorizada cae en una pestaña permitida;
- `EcommercePortalSettings` no se monta sin capacidad;
- `ecommerceAdminService.js` reutiliza `buildPosSyncAuthContext({ licenseKey })`;
- las cinco RPC reciben `p_staff_session_token`;
- no existe fallback inseguro a la firma antigua;
- errores de sesión/permisos usan mensajes seguros;
- errores técnicos no se muestran directamente al usuario.

Pruebas agregadas:

- `src/pages/__tests__/settingsPageAccess.test.js`;
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`.

| Validación | Resultado |
|---|---|
| ESLint específico | PASS, exit 0 |
| Vitest específico | PASS, 2 archivos y 8 pruebas |
| Build Vite/PWA | PASS |
| `npm run lint` global | FAIL heredado: 34 errores y 116 advertencias |
| `npm run test:ci` global | FAIL heredado: 65 archivos PASS, 28 FAIL; 354 pruebas PASS, 79 FAIL |

Las fallas globales están fuera de los archivos de esta fase. No se afirma que la suite global esté verde. Las dos suites nuevas también pasaron dentro de la ejecución global.

El repositorio no contiene workflows activos en `.github/workflows`; no hubo checks de GitHub Actions asociados al commit.

## 19. Preview de Vercel

Alias de la rama:

`https://lanzo-pos-git-fase-ecom-fe-admin-1-1-s-bcb022-fdxrulis-projects.vercel.app`

Preview limpio validado después de restaurar `build: vite build` y retirar el runner temporal:

`https://lanzo-ax60hgwqy-fdxrulis-projects.vercel.app`

Estado: `READY`. El build generó correctamente los artefactos Vite/PWA.

No se realizó una prueba manual autenticada en navegador con admin y `caja1`, porque no se utilizaron contraseñas ni tokens reales. El backend se cubrió con pruebas SQL transaccionales y el contrato frontend con pruebas unitarias.

## 20. Riesgos y operación posterior

1. El permiso visual depende del estado local del staff; tras cambiar permisos puede requerirse cerrar e iniciar sesión nuevamente.
2. El backend aplica la revocación en la siguiente RPC aunque la pestaña aún estuviera visible.
3. Las firmas antiguas se mantienen temporalmente para despliegue sin interrupción y continúan siendo admin-only.
4. La fase no modifica catálogo público, carrito, checkout, pedidos, ventas, caja, inventario ni reportes.
5. La línea base global de lint y tests conserva deuda técnica preexistente documentada.
6. El hardening del rate limiter quedó en una segunda migración porque la primera ya estaba aplicada y no debía editarse.

Prueba manual posterior al despliegue:

1. cerrar sesión staff;
2. iniciar nuevamente como `caja1`;
3. abrir Configuración;
4. confirmar que aparece `Portal online`;
5. cargar portal y productos;
6. guardar un cambio controlado;
7. confirmar que no obtiene acceso a funciones administrativas adicionales.
