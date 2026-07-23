# LICENSE.ADMIN.AUTH.1 — Identidad administrativa multidispositivo

## Estado de despliegue (2026-07-23)

- `aaaa7f4` reconcilió el historial versionado con `supabase_migrations` remoto; no quedan migraciones históricas pendientes.
- `32103c5` incorporó límites anti-rotación de fingerprint y el aislamiento de cachés admin/staff en el cliente.
- `20260722222305_license_admin_auth_1_foundation` está aplicada en `odlrhijtfyavryeqivaa`.
- `20260723173112_license_admin_auth_1_foundation_multidevice_fix` está aplicada como compensación: elimina el índice legado que impedía más de un admin activo por licencia.
- `20260723180000_license_admin_auth_1_cutover` queda versionada y pendiente. No debe aplicarse hasta que el frontend compatible esté desplegado en producción.

La matriz foundation se ejecutó remotamente dentro de `BEGIN/ROLLBACK`; las fixtures sintéticas, sesiones y rate limits terminaron en cero. Dos solicitudes concurrentes de login para el último cupo produjeron exactamente un éxito y un `DEVICE_LIMIT_REACHED`, con el contador final igual al límite. El enrollment concurrente produjo un único propietario y un único `ADMIN_OWNER_ALREADY_ENROLLED`.

El lint remoto mantiene un error heredado de agrupación en `public.admin_get_license_details`. No se atribuyeron avisos a las tablas, sesiones ni helpers nuevos de esta fase.

## Simulación del cutover

El cutover `20260723180000_license_admin_auth_1_cutover` se ejecutó contra el proyecto remoto dentro de una única transacción con la matriz completa y `ROLLBACK`. La simulación pasó para activación FREE/Pro, grants de contratos antiguos, selector según `staff_roles`, ecommerce admin/staff, sesiones revocadas, tokens cruzados y overloads ecommerce de tres y cuatro argumentos.

La verificación posterior confirmó: versión del cutover ausente de `schema_migrations`, activador legado no creado, definición productiva anterior intacta, y cero fixtures/rate limits. Por ello el cutover continúa pendiente y `supabase db push --dry-run` debe mostrar únicamente esa versión.

El build de Vercel para el HEAD `c371d743ac29a89ab32976984468381e5736bd4d` pasó (3,380 módulos, PWA y deployment READY). Las advertencias de imports dinámicos/estáticos y del glob de `cashSyncHandler` no bloquearon el build y permanecen como deuda previa.

## Diagnóstico

La base previa separaba usuarios y sesiones staff, pero trataba al administrador como una propiedad del dispositivo. `activate_license_on_device_unlimited` promovía un dispositivo a `admin` cuando no encontraba otro admin activo. `release_device_anon_unlimited`, las RPC de usuarios staff y varios helpers administrativos autorizaban únicamente con rol, fingerprint y token del dispositivo.

Reutilizar `license_staff_users` habría permitido confundir identidad y permisos staff con propiedad administrativa. Esta fase usa tablas separadas y mantiene intacto el modelo staff.

## Arquitectura

- `license_admin_users`: una identidad propietaria activa por licencia, username normalizado y password bcrypt.
- `license_admin_sessions`: varias sesiones por propietario y dispositivo; token bcrypt, expiración y revocación.
- `private.require_active_admin_session`: valida licencia, dispositivo admin activo, token de dispositivo, propietario y sesión admin.
- La fila de `licenses` se bloquea durante inscripción y login para serializar propietario y conteo de dispositivos.
- El índice parcial de propietario y el índice único de dispositivo actúan como última defensa ante concurrencia.
- Admin y staff siguen compartiendo `license_devices`; el conteo usa todos los dispositivos activos.

El token de sesión administrativo solo se entrega al cliente al crearse y se guarda en IndexedDB. La base almacena únicamente bcrypt. Los tokens de dispositivo heredados siguen el formato previo de `license_devices`; eliminarlos o migrarlos a hash requiere actualizar todos los helpers POS y Realtime y queda como endurecimiento posterior explícito.

## Flujos

- FREE (`free_trial`) conserva la función histórica de activación.
- FREE→PRO conserva el dispositivo actual; al quedar como admin confiable debe inscribir al propietario antes de entrar.
- Un Pro heredado solo permite inscripción desde su admin activo con token de dispositivo válido.
- Con propietario existente, la clave devuelve `ADMIN_OR_STAFF_LOGIN_REQUIRED` y no activa el equipo.
- Login admin valida credenciales antes de registrar/reactivar, cuenta el cupo común, revoca una sesión staff previa, rota el token del dispositivo y crea sesión admin.
- Liberar un admin revoca sus sesiones admin y staff, invalida tokens del dispositivo y conserva propietario y datos.
- Cerrar sesión admin revoca solo la sesión; no libera el dispositivo.

## RPC protegidas en esta fase

- `admin_enroll_owner_on_device`
- `admin_login_on_device`
- `verify_admin_session`
- `admin_logout_session`
- `admin_get_license_devices`
- `admin_release_device`
- overloads con sesión de `admin_list_staff_users`, `admin_create_staff_user`, `admin_update_staff_user`
- `private.ecommerce_admin_authorize_v2` para los endpoints ecommerce que ya transportan sesión del actor

Las firmas antiguas de gestión de dispositivos y staff pierden `EXECUTE` para `anon` y `authenticated`.

## Auditoría pendiente

Estas superficies aún aceptan el contexto histórico de token de dispositivo o tienen contratos sin parámetro de sesión admin. No se afirma que toda la plataforma esté migrada:

- `private.validate_pos_sync_context`
- `public.validate_pos_rpc_rate_limit_context`
- `private.ecommerce_orders_authorize_v1`
- `private.get_support_ticket_context`
- `public.begin_ai_agent_analysis`
- `public.get_ai_agent_usage_unlimited`
- `public.refresh_operational_notifications`
- `public.save_business_profile_secure_unlimited`
- helpers Realtime `private.can_access_license_realtime_topic` y `private.can_access_pos_realtime_topic`
- overloads ecommerce antiguos de tres argumentos; cuando existe propietario, `private.ecommerce_admin_authorize` falla cerrado porque no puede presentar sesión

La siguiente fase debe generalizar `p_staff_session_token` a un contrato `actor_session_token` en POS, soporte, notificaciones, IA, perfil y Realtime, y migrar el token de dispositivo heredado a almacenamiento hasheado sin romper operación offline.

## Prueba manual

1. Convertir una licencia FREE de prueba a Pro y confirmar que aparece inscripción, no entrada directa.
2. Crear propietario con credenciales ficticias y verificar entrada inmediata sin recarga.
3. En navegador privado introducir la misma licencia, elegir Administrador e iniciar sesión.
4. Confirmar que ambos admins aparecen activos y consumen dos lugares.
5. Alcanzar `max_devices` y confirmar rechazo del siguiente login.
6. Cerrar sesión admin y confirmar que el dispositivo sigue registrado.
7. Volver a entrar, liberar el dispositivo actual y confirmar regreso al acceso de licencia.
8. Liberar el último admin tras leer la advertencia; entrar desde otro equipo con el propietario.
9. Elegir Staff y confirmar que el flujo y permisos existentes no cambian.
10. Revocar una sesión/liberar un admin desde otro equipo y confirmar que el bootstrap exige login.

No se incluyen credenciales, claves, tokens ni datos reales en este reporte.
