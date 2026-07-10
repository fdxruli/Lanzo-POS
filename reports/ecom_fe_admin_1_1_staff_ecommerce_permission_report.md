# ECOM.FE.ADMIN.1.1 — Permiso staff para administrar el portal ecommerce

## Estado consolidado

El trabajo quedó dividido en tres entregas:

1. `ECOM.FE.ADMIN.1.1` — autorización backend y frontend para staff con permisos `settings + ecommerce`.
2. `ECOM.FE.ADMIN.1.1.1` — rate limit administrativo previo exclusivamente por dispositivo.
3. `HOTFIX ECOM.FE.ADMIN.1.1.2` — corrección de la guarda interna de `EcommercePortalSettings`.

El PR #82 fue mergeado antes de detectar el defecto visual corregido por el PR #83. Por tanto, el PR #82 resolvió la autorización y la pestaña de configuración, pero conservaba una guarda heredada dentro del componente real.

Supabase producción: `odlrhijtfyavryeqivaa`.

## ECOM.FE.ADMIN.1.1 — Resumen

La matriz de autorización vigente es:

| Actor | Condición | Resultado |
|---|---|---|
| Admin | Dispositivo activo y permiso `settings` | Permitido sin sesión staff |
| Staff | Sesión válida y permisos `settings=true`, `ecommerce=true` | Permitido |
| Staff sin uno de los permisos | Falta `settings` o `ecommerce` | Bloqueado |
| Staff sin sesión válida | Token nulo, incorrecto, vencido, revocado o de otro dispositivo | Bloqueado por backend |
| Otro rol | No es admin ni staff | Bloqueado |

El frontend continúa enviando:

```js
p_staff_session_token: authContext.staffSessionToken || null
```

No existe fallback a las firmas antiguas ni reintento sin token.

## ECOM.FE.ADMIN.1.1.1 — Rate limit por dispositivo

La tercera migración aplicada en la fase anterior fuerza:

```sql
p_staff_session_token := null
```

al ejecutar el rate limiter previo de las RPC administrativas ecommerce.

La sesión staff se valida después mediante `verify_staff_session_unlimited`, pero no participa en el bucket de rate limit.

Resultados previamente verificados:

- tokens inválidos distintos comparten una sola fila;
- token válido e inválido comparten una sola fila;
- admin con token nulo o arbitrario comparte una sola fila;
- `staff_session_hash IS NULL` para `ECOM_ADMIN`;
- helper privado cerrado para `anon`, `authenticated` y `public`;
- tablas ecommerce sin grants directos.

## HOTFIX ECOM.FE.ADMIN.1.1.2 — Guarda interna del panel

### 1. Síntoma observado con caja1

Después de mergear el PR #82, la cuenta staff `caja1` podía ver la pestaña `Configuración > Portal online`, pero el componente mostraba:

> Solo el propietario o dispositivo administrador puede configurar el portal online.

La cuenta ya tenía sesión válida, `device_role=staff`, `settings=true` y `ecommerce=true`; el rechazo era exclusivamente frontend.

### 2. Causa raíz en EcommercePortalSettings.jsx

`SettingsPage.jsx` ya utilizaba la matriz compartida, pero `EcommercePortalSettings.jsx` conservaba una guarda heredada equivalente a:

```js
if (currentDeviceRole && currentDeviceRole !== 'admin')
```

Esa condición bloqueaba todos los dispositivos staff sin consultar la capacidad compartida.

Además, el efecto inicial ejecutaba `load()` sin comprobar antes la autorización visual, por lo que el componente podía intentar llamar RPC aunque se montara desde otro punto sin permiso.

### 3. Condición heredada eliminada

La condición exclusiva de propietario/admin fue retirada.

La defensa interna permanece, pero ahora responde con:

```text
No tienes permiso para administrar el portal online.
```

No se concede acceso por username, `role_name`, nombre de cuenta ni permisos hardcodeados.

### 4. Uso de evaluateEcommercePortalAccess

`src/pages/settingsPageAccess.js` expone ahora explícitamente:

```js
export const evaluateEcommercePortalAccess = ({
  canAccess,
  currentDeviceRole
}) => { ... };
```

Se conserva el alias `canManageEcommercePortal` para compatibilidad con imports existentes.

Tanto `SettingsPage.jsx` como `EcommercePortalSettings.jsx` usan el mismo evaluador.

Reglas aplicadas:

- admin + `settings` → permitido;
- staff + `settings + ecommerce` → permitido;
- staff sin cualquiera de ambos permisos → bloqueado;
- otro rol → bloqueado.

### 5. Protección antes de llamar RPC

La carga inicial quedó condicionada:

```js
useEffect(() => {
  if (authorizationPending || !canManageEcommercePortal) return;
  load();
}, [authorizationPending, canManageEcommercePortal, load]);
```

Cuando la capacidad local es falsa no se ejecutan:

- `ecommerce_admin_get_portal`;
- `ecommerce_admin_list_published_products`;
- ninguna mutación administrativa.

La seguridad definitiva sigue en Supabase y no fue retirada ni modificada.

### 6. Bootstrap y reactividad visual

El componente se suscribe a:

- `canAccess`;
- `currentDeviceRole`;
- `currentStaffUser`;
- `licenseDetails`;
- `_isInitializing`.

Mientras el rol o la sesión staff todavía se restauran se muestra:

```text
Cargando portal online...
```

Durante ese estado:

- no se muestra rechazo definitivo;
- no se ejecutan RPC administrativas;
- al restaurarse el estado, el panel carga sin recarga manual.

Si se revoca visualmente `ecommerce`, el componente vuelve a renderizar, oculta el panel y muestra acceso denegado. El backend continúa aplicando la revocación real en la siguiente RPC.

### 7. Pruebas nuevas del componente real

Archivo agregado:

`src/components/ecommerce/__tests__/EcommercePortalSettings.test.jsx`

Casos cubiertos:

1. Admin autorizado carga el portal.
2. Staff con `settings=true` y `ecommerce=true` carga el portal.
3. Staff sin `ecommerce` queda bloqueado y no llama RPC.
4. Staff sin `settings` queda bloqueado y no llama RPC.
5. Estado no restaurado muestra carga y después abre el panel sin recargar.
6. Revocación visual vuelve a renderizar, oculta el panel y no genera llamadas nuevas.

La prueba staff autorizada representa la condición funcional de `caja1`, pero no hardcodea username ni `role_name`.

### 8. Validación manual con staff autorizado

No se utilizó contraseña ni sesión real de `caja1`, por lo que no se afirma haber realizado un login manual autenticado en el preview.

La conducta requerida quedó validada mediante el componente real y el store real de Zustand:

- rol staff;
- permisos `settings + ecommerce`;
- restauración asíncrona de sesión;
- carga de `ecommerce_admin_get_portal`;
- ausencia del mensaje exclusivo de propietario/admin.

El smoke test manual recomendado antes del merge es:

1. cerrar sesión staff;
2. iniciar como `caja1`;
3. abrir `Configuración > Portal online`;
4. comprobar carga del portal y productos;
5. guardar una descripción controlada;
6. publicar y despublicar un producto;
7. comprobar que no aparecen funciones administrativas adicionales.

### 9. Resultado admin

Prueba del componente:

- no muestra acceso denegado;
- ejecuta `getEcommercePortal`;
- carga el panel correctamente.

Resultado: PASS.

### 10. Resultado staff no autorizado

Para las combinaciones:

- `settings=true`, `ecommerce=false`;
- `settings=false`, `ecommerce=true`;

se verificó:

- mensaje de acceso denegado;
- ninguna RPC administrativa;
- panel no renderizado.

Resultado: PASS.

### 11. Lint, tests y build

Validación específica:

| Validación | Resultado |
|---|---|
| ESLint de archivos del hotfix | PASS, exit 0 |
| Vitest específico | PASS, 3 archivos y 14 pruebas |
| Pruebas nuevas del componente | PASS, 6 de 6 |
| Pruebas previas de acceso | PASS, 5 de 5 |
| Pruebas del servicio ecommerce | PASS, 3 de 3 |
| Build Vite/PWA | PASS, exit 0 |

Validación global:

| Comando | Resultado |
|---|---|
| `npm run lint` | FAIL heredado: 34 errores y 116 advertencias |
| `npm run test:ci` | FAIL heredado: 66 archivos PASS, 28 FAIL; 360 pruebas PASS, 79 FAIL |

Los seis nuevos tests pasan también dentro de la suite global. El incremento de 354 a 360 pruebas PASS corresponde a este hotfix; no se agregaron fallos nuevos.

No se afirma que la suite global completa esté verde.

### 12. Preview Vercel

Preview usado para la validación completa:

`https://lanzo-lr8qingq0-fdxrulis-projects.vercel.app`

Preview limpio después de restaurar `build: vite build` y eliminar el runner temporal:

`https://lanzo-a46ahafay-fdxrulis-projects.vercel.app`

Alias de la rama:

`https://lanzo-pos-git-hotfix-ecom-fe-admin-1-1-902bb3-fdxrulis-projects.vercel.app`

Estado del preview limpio: `READY`.

## Confirmación de alcance

Este hotfix es frontend-only.

No se modificó:

- Supabase producción;
- migraciones;
- helpers privados;
- RPC;
- grants;
- políticas RLS;
- permisos o sesiones de `caja1`;
- roles de dispositivos;
- tienda pública;
- carrito público;
- checkout;
- ventas;
- caja;
- inventario.

## Resultado

La guarda interna quedó alineada con `SettingsPage`, los actores no autorizados no generan llamadas administrativas y los cambios de sesión/permisos provocan el rerender esperado.

`ECOM.FE.ADMIN.1.1.2 — AUTOMATED PASS`
