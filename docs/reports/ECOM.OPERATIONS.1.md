# FASE ECOM.OPERATIONS.1 — Horarios y disponibilidad operativa

**Fecha:** 2026-07-15  
**Estado:** IMPLEMENTACIÓN COMPLETA — PENDIENTE DE PUBLICAR  
**Proyecto Supabase:** Lanzo (`odlrhijtfyavryeqivaa`)  
**Deployments realizados:** 0

## 1. Resumen ejecutivo

Se implementaron horarios semanales, excepciones por fecha, zona horaria IANA, pausa manual/temporal y enforcement server-side de pedidos. Supabase ya contiene la migración y es compatible con frontends anteriores porque `business_hours_enabled` inicia en `false`. Los frontends administrativo y público quedaron construidos, probados y staged, pero no se publicaron por restricción expresa de la fase.

## 2. Estado heredado

Se conservaron `ecommerce_portals`, `ecommerce_portal_hours`, `ecommerce_portal_hour_exceptions`, productos publicados, pedidos, catálogo, tracking, fulfillment, stock, límites y autorización administrativa efectiva. No se reemplazaron tablas ni índices existentes.

## 3. Alcance

La entrega cubre persistencia, evaluador central, RPC administrativas, contrato público, enforcement de checkout, UI admin/store, revalidación, pruebas SQL/frontend, builds y auditorías. No incluye horarios partidos, pedidos programados, pagos, tarifas, realtime ni cambios de deployment.

## 4. Compatibilidad

Los tres portales existentes recibieron defaults seguros y continúan operando como antes. Mientras `business_hours_enabled=false`, el horario no bloquea. Las respuestas RPC conservan campos y firmas anteriores y agregan campos JSON compatibles.

| Estado | Catálogo visible | Checkout | ecommerce_create_order |
|---|---:|---:|---:|
| Horario desactivado | Sí | Sí | Permitido |
| Abierto | Sí | Sí | Permitido |
| Cerrado | Sí | No | Bloqueado |
| Pausa manual | Sí | No | Bloqueado |
| Portal paused | No | No | Portal no encontrado |
| Offline | Caché posible | No | No ejecutado |

## 5. Arquitectura

El servidor es la autoridad. Un evaluador privado alimenta la lectura pública, la lectura administrativa y `ecommerce_create_order`. El frontend sólo presenta el resultado y bloquea anticipadamente; nunca envía hora ni timezone como autoridad.

## 6. Migración

Archivo local: `supabase/migrations/20260715053540_ecom_operations_1_business_hours.sql`. Se creó como migración compensatoria nueva, después de inspeccionar la definición remota efectiva de autorización y creación de pedidos. No se modificaron migraciones históricas.

## 7. Columnas

Se añadieron a `public.ecommerce_portals`:

- `business_hours_enabled boolean not null default false`
- `timezone text not null default 'America/Mexico_City'`
- `orders_paused boolean not null default false`
- `orders_paused_until timestamptz`
- `orders_pause_reason text`
- `orders_pause_updated_at timestamptz`

Constraints: timezone no vacía y razón nula o de máximo 300 caracteres.

## 8. Timezone

La RPC valida identificadores contra `pg_catalog.pg_timezone_names`. La evaluación usa `AT TIME ZONE` del portal. El test fijo `2026-07-15 15:00:00+00` demuestra `09:00` en `America/Mexico_City` y `08:00` en `America/Tijuana`, además de un `nextOpenAt` correcto.

## 9. Evaluador de disponibilidad

`private.ecommerce_evaluate_portal_availability(ecommerce_portals,timestamptz)` devuelve timezone, tiempos server/local, fecha/weekday, flags, fuente, intervalo, estado, códigos y próximos cambios. Es `SECURITY DEFINER` con `search_path=''` y no es ejecutable por roles de cliente.

## 10. Prioridades

El portal no publicado se filtra antes del contrato público. Para un portal publicado:

| Prioridad | Condición | Código |
|---:|---|---|
| 1 | ordering_enabled false | ECOMMERCE_ORDERING_DISABLED |
| 2 | pausa manual vigente | ECOMMERCE_ORDERS_PAUSED |
| 3 | fuera de horario | ECOMMERCE_STORE_CLOSED |
| 4 | horario inválido | ECOMMERCE_SCHEDULE_NOT_CONFIGURED |
| 5 | disponible | OPEN |

## 11. Horario semanal

Se mantiene una fila por weekday y un intervalo por día. Servidor y UI rechazan formato inválido, apertura igual/posterior al cierre y cruces de medianoche. Al activar la aplicación del horario se exige al menos un día abierto.

## 12. Excepciones

Una excepción exacta reemplaza el weekday semanal. Se validan fechas únicas, máximo 60, fecha no extremadamente antigua, razón máxima de 300 y horas válidas cuando está abierta. El reemplazo sólo afecta el portal autorizado.

## 13. Pausa manual

`ecommerce_admin_set_order_pause` soporta pausa indefinida, 30/60 minutos desde UI y fecha/hora específica en timezone del negocio. Reanudar limpia razón y timestamp. No cambia `portal.status`, catálogo ni horarios.

## 14. Expiración automática

Una pausa temporal sólo está vigente mientras `orders_paused_until > clock_timestamp()`. Al vencer deja de bloquear sin cron; el evaluador marca `manuallyPaused=false` y una escritura posterior puede limpiar los campos.

## 15. Admin RPC

`ecommerce_admin_save_operating_schedule` valida todo antes de bloquear/actualizar el portal y después hace upsert/delete exclusivo del horario del portal. `ecommerce_admin_set_order_pause` valida razón y futuro. Ambas reutilizan `private.ecommerce_admin_authorize_v2`, su rate limit, licencia, dispositivo, sesión staff y permisos `settings=true` + `ecommerce=true`.

## 16. Public RPC

`ecommerce_get_portal_by_slug(text)` conserva `portal`, `hours`, `features`, `catalogRevision` y `cachePolicy`, y agrega `availability` segura con fechas, intervalo, fuente y copy operativo autorizado.

## 17. ecommerce_create_order

La migración obtiene `pg_get_functiondef` de la función efectiva y la parchea dinámicamente para no perder hotfixes. Conserva rate limit, order inbox, carrito, cantidades, stock, mínimos, límites, tracking, WhatsApp, eventos y notificaciones. Hay dos evaluaciones: una para el pedido nuevo y otra después del lock `FOR UPDATE`, inmediatamente antes del insert.

## 18. Idempotencia

La búsqueda de pedido existente sucede antes del primer guard de disponibilidad. Repetir la misma key tras cerrar o pausar devuelve el pedido original con `idempotent=true`; no crea otro. Un key nuevo sí queda bloqueado.

## 19. Staff

SQL verificó staff con `settings=true,ecommerce=true` exitoso y staff con `ecommerce=false` bloqueado con código seguro y sin mutación. El dispositivo admin también pasó. No se debilitó la sesión staff ni el vínculo dispositivo/usuario.

## 20. Free/Pro

Horario, excepciones, pausa y enforcement están disponibles para Free y Pro/Lanzo Nube. No se añadió paywall ni se alteraron límites por plan.

## 21. Servicio admin

`ecommerceAdminService` incorpora `saveOperatingSchedule` y `setOrderPause`, usa el auth context actual y `staff_session_token`, conserva manejo offline/retryable y limita mensajes al catálogo seguro; nunca muestra SQL remoto crudo.

## 22. Servicio público

`ecommercePublicService` normaliza tipos estrictamente. Un bloque `availability` presente pero inválido falla cerrado. Si un backend anterior no lo devuelve, deriva temporalmente de `portal.orderingEnabled`. `createPublicOrder(slug,payload)` conserva firma y no envía reloj cliente.

## 23. Utilidad frontend

`ecommerceAvailability.js` formatea con `Intl` y timezone del negocio, genera copy español, calcula delay de refresh y convierte una fecha/hora de pared del negocio para la pausa administrativa. No importa store POS.

## 24. UI admin

Configuración → Portal online muestra siete días Lunes→Domingo conservando weekday backend, toggle de enforcement, timezone, validación inline, excepciones, estado calculado y controles de pausa/reanudación. Se aclara la diferencia entre “Pausar portal” y “Pausar pedidos”.

## 25. UI pública

Header, aviso y carrito distinguen Abierto, Cerrado, Pedidos pausados y No acepta pedidos con texto, icono y regiones `aria-live`. Catálogo, búsqueda, categorías, imágenes, precios y edición del carrito permanecen disponibles.

## 26. Checkout

Antes de abrir: online, lectura sin caché single-flight, availability, revisión vigente de catálogo, carrito reconciliado, mínimo y método. La idempotency key se crea sólo al confirmar. Los errores de disponibilidad conservan formulario, carrito e intento, no abren WhatsApp y disparan revalidación.

## 27. Revalidación

Se revalida al cargar, volver online, focus, visibility, antes del checkout, tras rechazo, en `nextChangeAt` y cada 60 s como fallback. Availability no depende de `catalogRevision` y no usa realtime.

## 28. Offline

El catálogo compatible puede leerse desde caché, pero checkout permanece bloqueado y no se ejecuta la RPC de creación. Availability cacheada no habilita pedidos.

## 29. Tests SQL

`supabase/tests/ecom_operations_1_business_hours_test.sql` ejecutó la matriz de 18 casos dentro de una única transacción con rollback: compatibilidad, weekly abierto, cerrado, missing, ambas precedencias de excepción, pausa indefinida/temporal/expirada, ordering disabled, timezone inválida, duplicado, intervalo inválido, staff permitido/denegado, idempotencia, pedido nuevo bloqueado y frontera de timezone. También verificó que inventario, caja y ventas no cambiaran.

Resultado final remoto: PASS; 0 licencias, staff, devices, pedidos, horarios o excepciones sintéticas residuales. Conteos reales antes/después: 3 portales, 20 pedidos, 0 hours, 0 exceptions.

## 30. Tests frontend

Matriz ecommerce final: 12 archivos, 92/92 PASS. Cubre servicios, normalización/fallback, payload admin, días, timezone, activación/validación, semanal/excepciones, pausa/reanudación/temporal, copy, timezone fija, abierto/cerrado/pausa, catálogo/carrito, preflight, focus/visibility, rechazo server-side, legacy y offline. Sin `.skip`, `.todo`, snapshots grandes ni incremento artificial de timeout.

Arquitectura: 8 archivos, 114/114 PASS. Lint dirigido: PASS. El lint global no es PASS por 158 errores preexistentes fuera de ecommerce; no se modificaron esos módulos.

React Doctor: el comando recomendado con `--diff` agotó 244 s; el CLI actual ya no documenta `--diff` y el workspace no tiene Git. Un segundo escaneo completo, sin red/dead-code y con presupuesto, también quedó sin salida hasta timeout. Se registra como limitación de herramienta, no como pase.

## 31. Builds

- `npm run build`: PASS; 74 archivos, PWA, manifest y Service Worker presentes.
- `npm run build:store`: PASS; 9 archivos, 730,584 bytes.
- `npm run build:store:vercel`: PASS; staging 10 archivos/730,610 bytes con `robots.txt`, copia byte-idéntica y `deployed=false`.

## 32. Auditorías

- Public delivery admin: PASS, 0 referencias faltantes.
- Public delivery store: PASS, 0 violaciones, 0 manifest/SW/Workbox/admin/POS/source maps.
- Cutover: 31/31 PASS.
- Arquitectura pública/Git/prebuilt/PWA/admin package: 114/114 PASS.
- Advisors Supabase: ningún hallazgo de performance relevante. Los INFO de RLS sin policy en hours/exceptions son intencionales (RPC-only). Los WARN de RPC `SECURITY DEFINER` ejecutables por anon/auth son esperados: las RPC deben ser accesibles desde el cliente, pero autorizan internamente con licencia, device/token o sesión staff, permisos y rate limit.
- Auditor remoto read-only: seguridad PASS (0 escrituras, 0 pedidos, perfil efímero eliminado), paridad FAIL esperada porque producción conserva el bundle anterior; siete hashes locales nuevos no existen aún en el alias. No se desplegó para corregirlo.

## 33. Supabase

Proyecto único usado: `odlrhijtfyavryeqivaa`. Postgres 17.6. La migración se aplicó mediante el conector autorizado, sin `db push`, `migration repair`, proyecto nuevo ni edición de historial.

## 34. Historial remoto

Registro remoto confirmado: versión `20260715061240`, nombre `ecom_operations_1_business_hours`. El timestamp local de creación es `20260715053540`; ambos son UTC, únicos y posteriores a `20260713061218`. Se verificaron columnas/defaults, constraints, firmas, ACL, `SECURITY DEFINER`, `search_path=''`, dos guards de create order y orden idempotente.

## 35. Git

La copia local no contiene `.git`; no fue posible verificar HEAD/main. Conforme al contrato, no se inicializó Git, no se reconstruyó metadata, no se creó rama, no se tocó main y no se hicieron commits.

## 36. PR

No se creó PR porque no existe checkout Git real. Tras subir los archivos, crear rama `fase-ecom-operations-1` y un único draft PR titulado `FASE ECOM.OPERATIONS.1 — Horarios y disponibilidad operativa`. No mergear automáticamente.

## 37. Vercel

Deployments manuales: 0. Previews deliberados: 0. Vercel CLI: no usado. No se cambiaron proyectos, root, rama, build, output, integración Git, dominios, aliases ni variables. La validación remota final queda para después de revisión/merge.

## 38. Archivos creados

- `supabase/migrations/20260715053540_ecom_operations_1_business_hours.sql`
- `supabase/tests/ecom_operations_1_business_hours_test.sql`
- `src/utils/ecommerceAvailability.js`
- `src/utils/__tests__/ecommerceAvailability.test.js`
- `src/components/ecommerce/EcommerceOperatingHoursSettings.jsx`
- `src/components/ecommerce/EcommerceOrderPauseControl.jsx`
- `src/components/ecommerce/__tests__/EcommerceOperationsSettings.test.jsx`
- `src/services/ecommerce/__tests__/ecommerceOperationsService.test.js`
- `docs/reports/ECOM.OPERATIONS.1.md`

## 39. Archivos modificados

- `src/services/ecommerce/ecommerceAdminService.js`
- `src/services/ecommerce/ecommercePublicService.js`
- `src/services/ecommerce/ecommercePublicCatalogCache.js`
- `src/components/ecommerce/EcommercePortalSettings.jsx`
- `src/components/ecommerce/EcommercePortalSettings.css`
- `src/components/ecommerce/public/PublicStoreHeader.jsx`
- `src/components/ecommerce/public/PublicCartDrawer.jsx`
- `src/components/ecommerce/public/PublicCheckoutDialog.jsx`
- `src/pages/PublicStorePage.jsx`
- `src/pages/PublicStorePage.css`
- `src/components/ecommerce/__tests__/EcommercePortalSettings.test.jsx`
- `src/components/ecommerce/__tests__/EcommercePortalSettings.stockAlerts.test.jsx`
- `src/pages/__tests__/PublicStoreCheckout.test.jsx`
- Artefactos regenerados: `dist/**`, `dist-store/**`, `store/dist/**`.

## 40. Riesgos

1. Los frontends nuevos no están en producción; el backend sí, pero defaults false mantienen compatibilidad.
2. La auditoría remota seguirá mostrando drift hasta que Git publique ambos frontends.
3. RPC administrativas son endpoints cliente `SECURITY DEFINER`; la defensa depende de conservar `ecommerce_admin_authorize_v2`, grants explícitos y rate limit.
4. No hubo prueba manual autenticada sobre un negocio real para evitar alterar datos de cliente.
5. El lint global y React Doctor tienen deuda/limitaciones independientes documentadas.

## 41. Pruebas manuales posteriores

Después de subir y antes de merge: probar con fixture/negocio QA autorizado guardar timezone, semana y excepción; pausar 30 min y reanudar; observar copy y `nextOpenAt` en store; conservar carrito al cerrar; confirmar que mismo idempotency key retorna la orden; revisar móvil/teclado/lector. Después del merge: repetir builds por Git, auditoría remota de hashes/browser y comprobar ambos aliases sin realizar pedidos reales.

## 42. Conclusión

Horarios, excepciones y pausa funcionan; `ecommerce_create_order` bloquea pedidos nuevos en servidor y conserva idempotencia; portales existentes siguen compatibles. Supabase está aplicado y verificado. La implementación está lista para revisión y publicación mediante Git, pero no se declara operativa completa en producción hasta merge y validación remota posterior.

| Recurso | Cantidad |
|---|---:|
| Migraciones nuevas | 1 |
| Migraciones aplicadas | 1 |
| Pedidos sintéticos residuales | 0 |
| Escrituras residuales de prueba | 0 |
| Deployments manuales | 0 |
| Previews deliberados | 0 |
| Proyectos nuevos | 0 |
| GitHub Actions | 0 |
