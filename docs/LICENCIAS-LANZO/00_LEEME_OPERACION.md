# LANZO-POS — Emisión manual de licencias y primer acceso

**Edición:** 2026-11-07 · **Estado:** procedimiento preparado, **no ejecutado** para un nuevo cliente.
**Supabase Production:** `odlrhijtfyavryeqivaa` · **Repositorio:** `fdxruli/Lanzo-POS`.
**Licencia inicial verificada:** Free/Local, plan interno `free_trial`, 1 dispositivo, vigencia indefinida.
**Primera inscripción instalada:** migración `20261107152500_license_admin_initial_owner_onboarding_v1.sql` (integrada en `main` por PR #413). SHA-256 canónico: `97c30551b5c8ed88675333585a9fd3471714c70a7b4a0043fdaede0c232d69aa`.

> **Importante:** Este paquete es documentación y scripts de operador. No es una migración ni cambia automáticamente Supabase. El contenido se basó en definiciones, columnas, restricciones, triggers, datos de plan y funciones consultadas en Production el 7 de noviembre de 2026. La creación nueva del archivo `01` **no se ha ejecutado** de extremo a extremo. Antes del primer cliente, ejecutar los preflights, revisar el negocio y las condiciones comerciales. No afirmar QA PASS de emisión manual hasta probarlo.

## Propósito y alcance

La aplicación LANZO-POS ya permite que el propietario complete su primer ingreso con **licencia + código de configuración temporal** y cree él mismo su usuario, contraseña y dispositivo. La función fue comprobada con Mercadito Colibrí QA (7/7 pruebas reportadas por el propietario, con registros coherentes en Production).

**Por ahora NO se integrará un panel generador en LANZO-POS.** Se usará la consola administrativa de Supabase y estos scripts para **Lanzo Local / Free**. El futuro generador será un sistema interno independiente; su diseño está en `FASE3_GENERADOR_INDEPENDIENTE_PENDIENTE.md`.

**PRO/Nube:** no modificar `01` para cambiar `free_trial` por `pro_monthly`. PRO exige período de pago/renovación, expiración, entitlement, límites y trazabilidad comercial específicos. `admin_create_license` es heredada, compara un secreto fijo y **no crea un período comercial adecuado**; no utilizarla para emitir a clientes. Antes de una alta PRO real hay que verificar y preparar un procedimiento focalizado para ese plan y duración, sin prometer que el script Free sea PRO-compatible.

## El flujo completo para UN cliente Free

1. **Confirmar la venta / solicitud**: nombre comercial, rubro, contacto y folio interno único de emisión (`MANUAL-2026-0001` es ejemplo). **No emitir** una licencia adicional si ya hay una para el mismo folio.
2. Abrir [Supabase SQL Editor (Production)](https://supabase.com/dashboard/project/odlrhijtfyavryeqivaa/sql/new) con autoridad SQL `postgres`, confirmar proyecto y ejecutar `00_PRECHECK_SOLO_LECTURA.sql`.
3. Si el precheck coincide, abrir `01_CREAR_LICENCIA_FREE_SIN_DISPOSITIVO.sql` y cambiar **el nombre, rubro, folio y contacto**, incluidos los **dos lugares** donde aparece el folio (variable y SELECT final). Ejecutarlo completo. Deberá devolver una licencia nueva `LANZO-XXXX-XXXX-XXXX-XXXX` y un único perfil/período; **0 propietarios y 0 dispositivos**. La generación es transaccional y usa un folio para prevenir duplicados accidentales al repetir el encargo.
4. Copiar **solo la clave de licencia**. Ejecutar `03_VERIFICAR_ESTADO.sql` sustituyendo `COLOCA_LICENCIA_AQUI`, y confirmar entitlement `true`, Free/Local, 1 período activo, 1 perfil, 0 propietarios, 0 dispositivos, 0 invitaciones consumidas.
5. **Cuando el cliente esté listo para configurar el teléfono**, ejecutar `02_EMITIR_CODIGO_PRIMER_INGRESO.sql` sustituyendo la licencia. Se crea una autorización de **64 caracteres hexadecimales**, válida **24 horas**, de uso **único**. Se muestra solo en el resultado de SQL; en la tabla se almacena su hash. **No adelantar su emisión si la entrega será otro día.**
6. Entregar al propietario por canal confiable **la licencia y el código**, preferiblemente por canales separados. No guardar el código en capturas, tickets públicos, commits, documentos compartidos ni logs. Pedir al cliente que **cree personalmente el nombre de usuario y contraseña**. LANZO no necesita conocer su contraseña.
7. El cliente instala/abre LANZO-POS **en línea**, coloca la licencia, entra a «Tu acceso como propietario», introduce código, nombre, usuario y contraseña y completa el alta.
8. Tras confirmación, verificar en `03_VERIFICAR_ESTADO.sql`: 1 propietario activo, 1 dispositivo activo, 1 invitación consumida y sesión vigente. La licencia Free respeta 1 dispositivo. Comprobar cierre y reapertura de PWA y login normal si lo solicita.
9. Registrar internamente el folio, licencia, negocio, plan, fecha y estado de entrega **sin el código, sin contraseñas ni tokens de dispositivo/sesión**.

## Archivos del paquete

| Archivo | ¿Modifica Production? | Uso |
|---|---:|---|
| `00_PRECHECK_SOLO_LECTURA.sql` | No | Confirmar proyecto, rol, plan Free y migración de onboarding |
| `01_CREAR_LICENCIA_FREE_SIN_DISPOSITIVO.sql` | **Sí** | Una licencia Free, período, perfil y eventos, en una sola transacción; SIN cuenta ni dispositivo |
| `02_EMITIR_CODIGO_PRIMER_INGRESO.sql` | **Sí** | Código aleatorio de un uso; **revoca y sustituye** cualquier invitación anterior pendiente para esa licencia |
| `03_VERIFICAR_ESTADO.sql` | No | Revisar estado comercial, propietario, dispositivos, invitaciones y sesiones |
| `04_REVOCAR_CODIGO_PENDIENTE.sql` | **Sí** | Invalidar una invitación no consumida si hubo error de entrega |
| `05_BUSCAR_LICENCIA_POR_FOLIO.sql` | No | Recuperar la licencia ya emitida cuando una ejecución anterior produjo respuesta perdida o se intentó duplicar el folio |
| `FASE3_GENERADOR_INDEPENDIENTE_PENDIENTE.md` | No | Diseño del generador externo que se implementaría en otra etapa |

## Condiciones verificadas y por qué el procedimiento es así

- `public.create_free_license` → `public.create_free_license_unlimited` **inserta un `license_devices` inicial y emite token de dispositivo**; no usarla con una huella ficticia para clientes remotos.
- El alta manual requiere `public.licenses`, `public.license_periods`, `public.business_profiles`; `public.license_events` conserva trazabilidad. El script Free sigue el modelo vigente de `free_lifetime`: `license_type='free'`, `is_lifetime=true`, `expires_at=null`, plan interno `free_trial`, `period_type='trial'` por compatibilidad, `period.status='active'`, y 1 dispositivo permitido. El trigger `sync_license_plan_snapshot` aplica las características actuales del plan.
- La función instalada `private.issue_license_onboarding_invitation(text)` restringida a `postgres` crea un código aleatorio de 32 bytes y lo almacena como hash, con caducidad de 24 horas; **la clave de licencia no da permiso para convertirse en propietario**.
- El RPC público `public.admin_enroll_owner_with_invitation(...)` valida código, entitlement, propietario ausente, estado del dispositivo y límites; realiza el alta del primer propietario, dispositivo y sesión en una transacción. **No llamarlo desde el SQL Editor para simular un dispositivo**: el cliente debe hacerlo desde LANZO-POS con su huella real.
- El negocio que indica el rubro `restaurante` es normalizado por el trigger a `food_service`; use `food_service` directamente si corresponde a comida/restaurante. Los valores permitidos consultados son: `farmacia`, `abarrotes`, `verduleria/fruteria`, `antojitos`, `darkitchen`, `restaurante`, `food_service`, `apparel`, `hardware`, `otro`.
- `private.license_entitlement_state_v1` devuelve derecho vigente basado en la licencia/plan; sin licencia activa y fecha coherente se podría mostrar «activa» una licencia que no funciona. Por eso el `01` valida entitlement dentro de la misma transacción.

## Seguridad y tratamiento de fallos

- **No volver a ejecutar `01` a ciegas** si apareció un error de red. Buscar primero el folio con `05_BUSCAR_LICENCIA_POR_FOLIO.sql`. Si existe, utilizar la licencia encontrada; no crear una segunda.
- La función de invitaciones **reemplaza** la invitación anterior pendiente al emitir otra. Si un cliente no recibió o extravió el código, revocarlo si es necesario y emitir uno nuevo **solo después de comprobar que no existe propietario**. El código anterior quedará inválido.
- Si la inscripción se realizó en el servidor pero se perdió la respuesta, **no volver a emitir** invitación: el cliente debe usar «Ya configuré mi cuenta: iniciar sesión» con el usuario y la contraseña que creó. Verificar primero propietario/dispositivo/sesión en `03`.
- **Nunca recuperar, editar o enviar contraseñas** desde Supabase. Las invitaciones no sustituyen la recuperación administrativa de cuentas existentes.
- **En el mismo teléfono usado para otros negocios** se puede activar una licencia nueva: la identidad de dispositivo y los límites son por licencia. Antes de cambiar, cerrar operaciones pendientes y mantener segregados los datos locales. No borrar IndexedDB ni sesiones sin necesidad.
- **Nunca cambiar plan ni período desde el frontend**; el futuro generador externo emitirá a través de una autoridad de servidor propia, con controles por operador.
- No dar a clientes acceso al SQL Editor. No introducir claves secretas de Supabase en páginas web ni en scripts del navegador. Cualquier exportación o copia de este paquete a lugares públicos debe eliminar datos de clientes; este paquete no contiene credenciales reales.

## Si llega un cliente PRO/Nube

**No se incluye un SQL ejecutable de alta PRO** en este paquete. Las funciones vigentes `public.admin_change_license_plan` y `private.materialize_license_upgrade_v1` gestionan cambios a `pro_monthly` y períodos, pero no se probó aquí crear una licencia PRO nueva, sin propietario ni dispositivo, y completar su primera configuración. La función de cambio observada usa 1 mes para planes pagados, y las renovaciones usan otro contrato. Para un cliente PRO se debe preparar **el script exacto para el período contratado** y realizar preflight de precio, fechas, límites, eventos, entitlement, capacidad de Nube y permisos. No usar una licencia Free como «PRO provisional» sin explicar sus efectos al cliente ni asumir que la conversión será segura.

## Estado de validación

- **VERIFICADO EN LECTURA:** estructura y restricciones de las tablas; firmas y cuerpos relevantes de funciones; plan Free activo; categoría `public.business_category`; esquema de invitaciones; versión de migración y ejemplo real de Mercadito Colibrí QA.
- **QA MANUAL PREVIO:** primera inscripción con invitación en Mercadito Colibrí QA, 7/7 comprobaciones reportadas por el propietario.
- **NO EJECUTADO:** `01_CREAR_LICENCIA_FREE_SIN_DISPOSITIVO.sql` para un nuevo cliente. La aceptación del primer cliente exige confirmar la salida, el nuevo negocio, la emisión del código, la inscripción y el arranque completo desde su teléfono.

En caso de cambios posteriores de esquema o plan, revalidar estos scripts antes de emitir una licencia real.
