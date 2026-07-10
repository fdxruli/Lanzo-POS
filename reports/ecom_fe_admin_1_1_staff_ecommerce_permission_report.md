# ECOM.FE.ADMIN.1.1 — Permiso staff para administrar el portal ecommerce

## Estado

Implementación funcional completada en la rama:

`fase-ecom-fe-admin-1-1-staff-permission`

PR independiente:

`#82 — FASE ECOM.FE.ADMIN.1.1 — Permitir administración del portal a staff autorizado`

La migración de esta fase fue aplicada de forma controlada en Supabase producción:

`odlrhijtfyavryeqivaa`

No se aplicaron migraciones ajenas, no se usó `db push`, `migration repair` ni `--include-all`.

## 1. Causa raíz

La administración del portal estaba protegida únicamente por el rol físico del dispositivo.

El frontend exigía una condición equivalente a:

```js
canAccess('settings') && currentDeviceRole === 'admin'
```

El backend, mediante `private.ecommerce_admin_authorize(...)`, filtraba el dispositivo con:

```sql
d.device_role = 'admin'
```

Por ello, un dispositivo staff con sesión válida y permisos explícitos no podía visualizar ni invocar la administración ecommerce.

## 2. Condición frontend anterior

`SettingsPage.jsx` ocultaba `Portal online` a cualquier dispositivo cuyo `currentDeviceRole` no fuera `admin`.

La navegación directa a `?tab=portal-online` dependía únicamente de la lista de pestañas visible y no existía una capacidad ecommerce staff explícita ni una guarda adicional al montar `EcommercePortalSettings`.

## 3. Restricción backend anterior

Las cinco RPC administrativas llamaban a `private.ecommerce_admin_authorize(...)`.

Ese helper:

- permitía únicamente dispositivos activos con `device_role = 'admin'`;
- no recibía sesión staff;
- enviaba siempre `p_staff_session_token := null` al rate limiter;
- no evaluaba los permisos vigentes `settings` y `ecommerce`.

## 4. Nueva matriz admin/staff

| Actor | Condición | Resultado |
|---|---|---|
| Admin | Dispositivo activo, token de seguridad válido y licencia activa | Permitido sin sesión staff |
| Staff | Sesión válida, mismo dispositivo/licencia/usuario, `settings=true` y `ecommerce=true` | Permitido |
| Staff sin sesión | Token nulo o vacío | `ECOMMERCE_STAFF_SESSION_REQUIRED` |
| Staff con sesión inválida | Token incorrecto, sesión revocada/vencida, usuario inactivo u otro dispositivo | `ECOMMERCE_STAFF_SESSION_INVALID` |
| Staff sin uno de los permisos | Falta `settings` o `ecommerce` | `ECOMMERCE_STAFF_PERMISSION_DENIED` |
| Otro rol de dispositivo | No es admin ni staff | `ECOMMERCE_ADMIN_ACCESS_DENIED` |

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
- sin ejecución para `public`, `anon` ni `authenticated`;
- ejecución únicamente para `service_role`;
- argumentos nombrados en llamadas internas;
- no devuelve licencia, fingerprint, tokens ni hashes.

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

Las firmas antiguas se conservaron intactas y continúan usando `private.ecommerce_admin_authorize(...)`.

Por tanto:

- el frontend administrativo anterior continúa funcionando para admin;
- una firma antigua sin token no autoriza staff;
- no existe parámetro `DEFAULT NULL` que pueda crear ambigüedad en PostgREST;
- el frontend nuevo invoca siempre las sobrecargas que incluyen `p_staff_session_token`.

## 8. Validación de sesión staff

El helper v2 reutiliza:

```sql
public.verify_staff_session_unlimited(
  p_license_key := ...,
  p_device_fingerprint := ...,
  p_staff_session_token := ...
)
```

Se exige `valid = true`.

La función existente valida licencia, dispositivo, sesión activa, expiración, revocación, usuario activo, hash del token y vínculo de la sesión con el dispositivo.

## 9. Permisos obligatorios

Después de verificar la sesión, el backend vuelve a consultar `public.license_staff_users`.

Se exige simultáneamente:

```sql
coalesce((permissions->>'settings')::boolean, false) is true
and coalesce((permissions->>'ecommerce')::boolean, false) is true
```

No se confía en `currentStaffUser`, en permisos enviados por el cliente ni en un snapshot de sesión.

## 10. Protección contra sesión de otro dispositivo o usuario

Además de `verify_staff_session_unlimited`, se compara:

```sql
staff_user.id = license_devices.staff_user_id
```

La prueba transaccional confirmó que una sesión válida creada para otro dispositivo no puede autorizar la RPC del dispositivo actual.

## 11. Revocación inmediata

En una transacción de prueba se cambió únicamente `permissions.ecommerce` a `false` manteniendo activa la sesión.

La siguiente RPC fue rechazada con:

`ECOMMERCE_STAFF_PERMISSION_DENIED`

La prueba confirma que el backend consulta permisos vigentes en cada solicitud. Todos los cambios del fixture fueron revertidos con `ROLLBACK`.

## 12. Resultado admin

Con un dispositivo admin activo y `p_staff_session_token = null`:

- obtener portal: PASS;
- listar productos: PASS;
- guardar portal en rollback: PASS;
- crear/actualizar producto en rollback: PASS;
- publicar/despublicar en rollback: PASS.

## 13. Resultado staff autorizado

Con un dispositivo staff activo, sesión fixture válida y permisos `settings=true`, `ecommerce=true`:

- obtener portal: PASS;
- listar productos: PASS;
- guardar portal en rollback: PASS;
- crear/actualizar producto en rollback: PASS;
- publicar/despublicar en rollback: PASS.

No se registró ni imprimió el token staff.

## 14. Resultado staff no autorizado

Casos verificados dentro de transacción con rollback:

- `settings=true`, `ecommerce=false`: PASS, rechazado;
- `settings=false`, `ecommerce=true`: PASS, rechazado;
- token nulo: PASS, rechazado;
- token incorrecto: PASS, rechazado;
- sesión revocada: PASS, rechazado;
- sesión vencida: PASS, rechazado;
- usuario inactivo: PASS, rechazado;
- sesión de otro dispositivo: PASS, rechazado;
- firma antigua sin token en dispositivo staff: PASS, rechazado.

Resultado consolidado SQL:

`ECOM.FE.ADMIN.1.1 SQL MATRIX: PASS`

## 15. Verificación read-only de caja1

La consulta final en producción confirmó:

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

El JSON real conserva sin cambios los demás permisos existentes, entre ellos `pos`, `products`, `cash_register`, `discounts` y `notifications`. No se sobrescribió el objeto completo ni se modificó contraseña alguna.

## 16. Confirmación de que caja1 no fue convertido a admin

`caja1` continúa vinculado a un dispositivo activo con `device_role = 'staff'`.

La fase no actualizó `license_devices.device_role`, no elevó el dispositivo y no concedió permisos por username o `role_name`.

## 17. Grants y helpers privados

Verificación posterior a la migración:

- todas las RPC ecommerce administrativas antiguas y nuevas son `SECURITY DEFINER`;
- todas tienen `search_path = ''`;
- nuevas firmas: `anon=true`, `authenticated=true`, `public=false`;
- helpers privados: `anon=false`, `authenticated=false`, `public=false`;
- grants directos sobre tablas `public.ecommerce_%` para `anon`, `authenticated` o `public`: **0 filas**.

## 18. Frontend, lint, pruebas y build

Cambios frontend:

- `SettingsPage.jsx` permite admin con `settings` o staff con `settings + ecommerce`;
- navegación directa no autorizada cae en una pestaña permitida;
- `EcommercePortalSettings` tiene una guarda adicional de montaje;
- `ecommerceAdminService.js` reutiliza `buildPosSyncAuthContext({ licenseKey })`;
- las cinco RPC reciben `p_staff_session_token`;
- no existe fallback inseguro a una firma antigua;
- errores de sesión/permisos usan mensajes seguros;
- excepciones técnicas no se muestran directamente al usuario.

Pruebas agregadas:

- `src/pages/__tests__/settingsPageAccess.test.js`;
- `src/services/ecommerce/__tests__/ecommerceAdminService.test.js`.

Resultados ejecutados en un runner temporal de preview, retirado después de validar:

| Validación | Resultado |
|---|---|
| ESLint específico de archivos modificados | PASS, exit 0 |
| Vitest específico | PASS, 2 archivos y 8 pruebas |
| `npm run build` / Vite producción | PASS |
| `npm run lint` global | FAIL heredado: 34 errores y 116 advertencias |
| `npm run test:ci` global | FAIL heredado: 65 archivos PASS, 28 FAIL; 354 pruebas PASS, 79 FAIL |

Las fallas globales están fuera de los archivos de esta fase. Incluyen suites antiguas con entorno DOM/IndexedDB incompleto y expectativas desactualizadas de ventas, respaldos, navegación, caja y stores. No se afirma que la suite global esté verde.

Las dos suites nuevas pasaron también dentro de la ejecución global.

El repositorio no contiene workflows activos en `.github/workflows`; por ello no hubo checks de GitHub Actions asociados al commit.

## 19. Preview de Vercel

Preview limpio de la rama, generado después de restaurar el script estándar `build: vite build` y retirar el runner temporal:

- estado: `READY`;
- commit validado: `d3d801a1277d04973d232554a394579b2a9dcf6c`;
- URL inmutable: `https://lanzo-ax60hgwqy-fdxrulis-projects.vercel.app`;
- alias de rama: `https://lanzo-pos-git-fase-ecom-fe-admin-1-1-s-bcb022-fdxrulis-projects.vercel.app`.

El build final transformó correctamente la aplicación y generó los artefactos PWA.

No se realizó una prueba manual autenticada dentro del navegador con admin y `caja1`, porque no se utilizaron ni solicitaron contraseñas o tokens reales. La autorización backend se cubrió mediante la matriz SQL transaccional y el contrato frontend mediante pruebas unitarias.

## 20. Riesgos y operación posterior

Riesgos residuales:

1. Los permisos visuales del staff se obtienen del estado local; después de un cambio puede requerirse cerrar e iniciar nuevamente la sesión para refrescar inmediatamente la UI.
2. El backend no depende de ese snapshot: una revocación se aplica en la siguiente RPC aunque la pestaña todavía estuviera visible.
3. Las firmas antiguas se mantienen temporalmente para despliegue sin interrupción; continúan siendo exclusivamente admin.
4. La fase no modifica catálogo público, carrito, checkout, pedidos, ventas, caja, inventario ni reportes.
5. La línea base global de lint y tests tiene deuda técnica preexistente documentada; no fue ampliada para evitar mezclar alcance.

Prueba manual posterior al despliegue:

1. cerrar sesión staff;
2. iniciar nuevamente como `caja1`;
3. abrir Configuración;
4. confirmar que aparece `Portal online`;
5. cargar portal y productos;
6. guardar un cambio controlado;
7. confirmar que no obtiene acceso a funciones administrativas adicionales.
