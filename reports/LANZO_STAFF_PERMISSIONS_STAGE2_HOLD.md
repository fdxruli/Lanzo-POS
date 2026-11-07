# LANZO POS — Etapa 2: permisos Staff sin cerrar sesión

Estado: **DETENIDO por el límite de seguridad de operaciones abiertas**. No hay corrección de producción implementada. El criterio principal de revocar y recuperar POS sin cerrar sesión sigue pendiente. QA real: **NO EJECUTADO**; corresponde al propietario en Vercel Preview.

## Base y rama local

- Rama: `fix/staff-live-permissions`.
- `origin/main` verificado al inicio y al terminar: `ff7f3b248a0b958967d7257749f7a20136244d41`.
- PR #408 integrado: `3cc574d833a4f962247c462e3212ddb4c6a03910`; introduce la autoridad común basada en ActorRuntime.
- PR #409 integrado: `7b23e00221195b3a3171f34be9aed48163b95fbb`; conserva los guards y el diseño de accesos denegados.
- PR #411 integrado y HEAD actual: `ff7f3b24`; conserva Staff cuando la revalidación del dispositivo compartido no contiene `staff_user`.
- Metadatos de los tres PR comprobados por GitHub; ascendencia de #408 y #409 comprobada por Git.

## Causa reproducida localmente

La cadena actual es `LICENSE_UPDATE` → listener → `runLicenseSyncCheck('realtime_event')` → `verifySessionIntegrity` → revalidación de licencia. No incluye `verifyStaffSession` ni una actualización de permisos de ActorRuntime.

La caracterización configura una sesión Staff POS abierta, una respuesta disponible de `verifyStaffSession` con `pos: false` y una revalidación de dispositivo compartido válida sin permisos Staff. Al ejecutar `runLicenseSyncCheck('realtime_event')`, se llama al verificador de licencia, **no se consulta el verificador Staff** y el handle de la misma sesión todavía acepta POS. No se cerró ni reinició la sesión de prueba.

Esto reproduce el defecto del cliente incluso suponiendo que el evento sí llegó. No demuestra recepción en el dispositivo de El Balón ni constituye una revocación real en Supabase. Se usaron fixtures locales; no se accedió a la cuenta real `prueba`.

Además, actualizar únicamente `currentStaffUser` no resuelve las concesiones posteriores: la política usa la intersección store/runtime y ActorRuntime conserva los permisos del grant. El controlador ofrece refresco Admin de vencimiento, pero no refresco Staff de permisos de la misma sesión. Repetir el grant de autenticación exige handoff y altera la generación, almacenamiento y propiedad operativa; no es una sustitución segura en caliente.

Fuentes:

- `src/store/slices/license/licenseRealtimeActions.js`: callback `onLicenseChanged`.
- `src/store/slices/license/licenseSyncActions.js:105`: sincronización y TTL de licencia.
- `src/store/slices/license/licenseIntegrityActions.js`: revalidación y reconciliación de identidad del PR #411.
- `src/services/supabase.js:1044`: `verifyStaffSession`, con comprobación de credenciales y callback `beforeLocalPersistence`.
- `src/services/auth/actorRuntimeController.js:230`: concesión de sesión; `:287`: refresco exclusivo Admin.
- `src/services/auth/actorAccessPolicy.js`: intersección explícita store/runtime.

## Configuración real de Realtime

Se usó la guía `supabase:supabase` y se consultaron el changelog y la documentación actual de Broadcast. No se ejecutó SQL.

- `.env.development.local` y `.env.example`: `VITE_ENABLE_LICENSE_REALTIME=false`. Esto sólo describe el entorno local.
- Vercel, proyecto `lanzo-pos`: variable presente para Production y Preview, marcada sensitive. La API de variables no devolvió el valor; su presencia por sí sola no demuestra que esté habilitado.
- Comprobación adicional, sólo lectura: `https://lanzo-pos.vercel.app/build-info.json` identificó el commit `ff7f3b24`, compilado `2026-11-07T05:22:35.108Z`.
- El bundle servido `assets/useAppStore-DqWze1wJ.js` contiene **`VITE_ENABLE_LICENSE_REALTIME:"true"`**. La condición compilada `Bp` exige `features.realtime_license_sync === true` y un `realtime_topic` existente.
- Por tanto, el build Production actual sí habilita la bandera. No se comprobó la licencia autenticada de El Balón, el topic de esa sesión, SUBSCRIBED, RLS del canal ni la entrega al dispositivo. No se atribuye el fallo real a pérdida del evento.
- No se comprobó el bundle de cada Preview ni una PWA instalada que pudiera ejecutar una versión anterior.

## Bloqueo de seguridad confirmado

No se aplica un refresco ingenuo de autoridad por esta instrucción explícita del encargo: «Si actualizar la autoridad exige un cambio estructural o compromete operaciones abiertas, detenerse y explicar la mínima alternativa viable».

1. `PermissionRoute.jsx:10–13` deja de renderizar los hijos al faltar POS. La prueba con el guard real confirma el desmontaje inmediato del contenido POS al retirar el permiso efectivo.
2. `usePosCheckout.js:260` guarda el snapshot de cobro en `useRef(null)`. El intento adquiere un bloqueo y registra su identidad antes de publicar ese snapshot (`:953`, `:1005`).
3. La prueba con el hook real inicia un cobro, confirma la apertura de pago, desmonta y remonta el hook. El bloqueo y el `checkoutAttemptId` persisten en la persistencia simulada, no se llama a `unlockOrder`, y el segundo inicio falla porque la orden sigue bloqueada. La nueva instancia carece del snapshot anterior.

Las dos pruebas muestran por separado la cadena guard → desmontaje y desmontaje → pérdida del snapshot con bloqueo conservado. La persistencia y los servicios del hook están simulados; no se afirma haber completado esta cadena contra una caja real. Es evidencia suficiente para no introducir este cambio sin resolver el ciclo de vida del cobro.

Subir la generación del actor también volvería obsoletos handles y propiedad del checkout. Borrar bloqueos, reasignar recursos, ocultar la revocación o conceder desde Zustand/Broadcast contradiría los límites del encargo.

## Alternativa mínima viable para continuar

Se necesita una ampliación acotada del ciclo de vida del cobro, además de la consulta Staff:

1. Reutilizar `verifyStaffSession`, capturando antes la identidad, sesión, dispositivo, licencia y binding completo del tenant. Comprobarlos de nuevo antes de cualquier limpieza, persistencia o publicación. Descartar respuestas obsoletas. Sólo una verificación `verified` de la misma identidad puede conceder permisos.
2. Añadir al controlador existente un refresco Staff de esa misma sesión que reemplace permisos y notifique observadores sin ejecutar login/handoff, rehidratar carritos ni reasignar recursos. Mantener separada la identidad operativa de la revisión de permisos. Los callbacks previos deben volver a comprobar el permiso vigente al iniciar una operación protegida.
3. **Resolver primero el desmontaje con cobro activo.** Conservar el intento bajo su dueño existente y una vía explícita para finalizar o cancelar de forma segura; bloquear nuevas operaciones inmediatamente. Elegir entre mantener el propietario del checkout montado hasta un punto seguro o hacer recuperable el snapshot fuera de la página. No permitir nuevos cobros con una concesión antigua. La implementación precisa requiere revisar las fronteras de efectos del checkout y probarlas; no se propone liberar ni completar automáticamente.
4. Integrar la consulta Staff antes del TTL largo de licencia, con una sola solicitud en vuelo por binding y tratamiento de eventos recibidos durante la solicitud para no perder una concesión posterior. Los eventos sólo disparan la verificación.
5. Reutilizar el health check y la reconexión existentes con cooldown propio de Staff (por ejemplo 90 segundos) independiente del TTL de licencia y del estado del canal. Evitar que los umbrales de tres minutos o la recuperación Realtime salten por completo esa comprobación. Los errores de red no conceden permisos; una denegación autorizada utiliza la recuperación existente de sesión sin tocar recursos ajenos.

Los puntos 2 y 3 son diseño propuesto, no código implementado ni garantía probada. El punto 3 requiere tocar comportamiento de montaje/checkout; no se hizo bajo la restricción de conservar el flujo y el diseño del PR #409.

## Pruebas y artefactos

**124/124 pruebas focales, 8 archivos, 0 fallos.** Incluye tres caracterizaciones añadidas temporalmente para esta investigación, y pruebas existentes de ActorRuntime, bridge, handoff, transición de sesión, guards y listener. El PASS significa que se reproduce y caracteriza el comportamiento actual; **no significa que la Etapa 2 esté corregida**.

Los cambios temporales a tests están preservados en `reports/LANZO_STAFF_PERMISSIONS_STAGE2_REPRODUCTION.patch.gz`. No quedan aplicados al código del repositorio para no convertir el fallo conocido en una expectativa permanente. Para repetir en una copia limpia de esta base, aplicar ese parche y ejecutar:

```sh
gzip -dc reports/LANZO_STAFF_PERMISSIONS_STAGE2_REPRODUCTION.patch.gz | git apply
npx vitest run \
  src/store/slices/license/licenseSyncActions.profileSync.test.js \
  src/components/common/__tests__/PermissionRoute.integration.test.jsx \
  src/hooks/pos/__tests__/usePosCheckout.ecommerce.test.jsx \
  src/services/auth/__tests__/actorRuntimeController.test.js \
  src/services/auth/__tests__/actorSessionRuntimeBridge.test.js \
  src/services/auth/__tests__/actorOperationalHandoff.test.js \
  src/store/slices/license/licenseSessionTransitions.test.js \
  src/store/slices/license/licenseRealtimeActions.profileSync.test.js \
  --maxWorkers=4
```

ESLint de los tres archivos de pruebas y `git diff --check`: PASS. No se ejecutó build porque no hay cambios de código de aplicación. No se creó suite general ni infraestructura.

| Escenario | Evidencia y estado |
| --- | --- |
| Admin | Tests existentes de runtime, bridge, transición y rutas; no QA real |
| Staff sólo POS | Guard existente y caracterización local; no aceptación de la solución |
| Dispositivo compartido | Reproducción de revalidación sin permisos Staff; no sesión real |
| Retirar POS | Defecto de consulta ausente y riesgo de desmontaje reproducidos |
| Volver a conceder POS | No implementado; requiere verificación y refresco runtime |
| Desconexión/regreso | Flujo y cooldowns inspeccionados; recuperación Staff nueva pendiente |
| Sesión revocada | Verificador y recuperación existentes inspeccionados; nueva integración pendiente |
| Cambio de identidad/tenant | Pruebas existentes focales; carreras del refresco propuesto pendientes |
| Cobro abierto | Hook real con persistencia simulada: remount pierde snapshot y conserva bloqueo |

## Archivos finales de la rama

- `reports/LANZO_STAFF_PERMISSIONS_STAGE2_HOLD.md`: este informe.
- `reports/LANZO_STAFF_PERMISSIONS_STAGE2_REPRODUCTION.patch.gz`: reproducción focal sobre la base vigente.

Intermedios y resultados detallados quedan en `work/staff-live-permissions/`, fuera del commit. No se modificaron estilos, navegación, código productivo, SQL, migraciones, configuración ni datos de Supabase Production. No hubo push, merge, despliegue ni creación de PR.

Riesgo restante: el defecto original continúa en la aplicación. La entrega es un diagnóstico detenido por el límite explícito del encargo; no es una corrección lista para Preview.
