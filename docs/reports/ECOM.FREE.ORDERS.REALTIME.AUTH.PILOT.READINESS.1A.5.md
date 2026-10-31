# LANZO POS — Fase 1A.5: preparación de piloto Realtime en producción

**Corte de preflight:** 22 de octubre de 2026, 23:32–23:42 UTC

**Estado:** `HOLD_PRODUCTION_DEPLOYMENT` + `HOLD_SECURITY`

**Uso:** snapshot disponible y bajo cuota; no hay ensayo durante este corte.

> La guía QA-01…22 está en [ECOM.FREE.ORDERS.REALTIME.AUTH.PILOT.QA.GUIDE.1A.5.md](ECOM.FREE.ORDERS.REALTIME.AUTH.PILOT.QA.GUIDE.1A.5.md). Ninguna prueba física está habilitada todavía. No se aplicaron cambios de producción, no se instaló infraestructura QA, no se hizo merge ni se cambió de plan.

## Decisión ejecutiva

La preparación de código y evidencia permite seguir después de resolver los gates, pero el propietario todavía no puede iniciar la certificación física en la aplicación real. El frontend Production sirve `main` en `9ca65fc`; ese código no monta el receptor ni muestra diagnóstico QA. El broker y sus objetos SQL son candidatos del PR y no están desplegados. Además, las seis RPC `SECURITY DEFINER` continúan ejecutables por `PUBLIC`, no existe el rol receptor aislado y no hay una relación comprobable entre un dispositivo físico y el propietario.

El corte confirma cuota suficiente para un piloto pequeño, pero esa capacidad no habilita el receptor ni compensa los gates de seguridad. El modo permitido sigue siendo únicamente `qa_probe`; no se emiten pedidos ni eventos comerciales.

## A. GitHub y estado de código

| Elemento | Estado observado |
|---|---|
| Worktree de trabajo | `C:\dev\Lanzo-POS-ecom-auth-1a2`, rama `codex/ecom-realtime-auth-1a2`; limpia antes de añadir este informe, guía y evidencia. |
| HEAD del código evaluado en este corte | `3931ff2e3d4415701ab0a80920ca0583a8090eb7`; no se modificó código de aplicación en esta continuación. |
| Base remota del PR | `9ca65fc07804f40c2add5e59bee0e6edca940b8f`. |
| PR #368 | [OPEN / Draft / mergeable](https://github.com/fdxruli/Lanzo-POS/pull/368). No merge. Tiene 193 archivos cambiados y unos 25,316 insertions; mantenerlo Draft. |
| Checks del SHA | Check Vercel: success. Workflow `Ecommerce Native Bridge QA`: failure bruto. `PR127 Global Comparison`: success. El informe 1A.4 conserva el desglose de fallos históricos/base y comparación diferencial; no se oculta el FAIL bruto. |
| #338 y #352 | OPEN/Draft; sin cambios. |
| Otros PRs | #369 modifica `src/App.jsx` y recuperación Admin/Actor Runtime, por lo que debe revisarse antes de integrar un montaje. #370 es financiero y no se tocó. |
| Worktree `main` | No se utilizó. Su checkout local estaba atrasado y tenía archivos sin seguimiento ajenos a esta tarea; se preservaron. |
| Artefactos de esta entrega | Solo documentación y evidencia; cualquier commit de esta entrega no modifica runtime, SQL o configuración. |

Fuentes de evidencia previa reutilizadas: [informe Fase 1A.4](ECOM.FREE.ORDERS.REALTIME.AUTH.PHASE1A.4.md), [informe de producción R2](ECOM.FREE.ORDERS.REALTIME.AUTH.PRODUCTION.R2.md) y `docs/reports/evidence/ecom-realtime-auth-1a4/`. No se repitió una auditoría general.

## B. Supabase producción

Proyecto [Lanzo / Supabase](https://supabase.com/dashboard/project/odlrhijtfyavryeqivaa), ref `odlrhijtfyavryeqivaa`: `ACTIVE_HEALTHY`, región `us-east-2`, PostgreSQL 17.6.1.063 y plan Free.

| Inventario | Estado actual de solo lectura |
|---|---|
| Ledger | 324 filas; última `20261022184218 qa_ecom_bridge_1a4_cleanup`. Sin reparación ni `db push`. |
| Roles | 31. `lanzo_ecom_bridge_receiver` no existe. |
| Usuarios/sesiones de Supabase Auth | 0 usuarios y 0 sesiones. |
| Recursos QA | 0 relaciones en los esquemas QA consultados; 0 funciones QA nombradas; no existe allowlist o grant persistente para el piloto. |
| Vault | 0 filas en `vault.secrets`. |
| Edge Functions | `lanzo-ai-agent` ACTIVE v49 (`verify_jwt=false`) y `authorize-image-upload` ACTIVE v31 (`verify_jwt=true`). No existe `lanzo-ecom-bridge-qa`. Las dos funciones originales no se modificaron. |
| Realtime | 3 políticas existentes en `realtime.messages`: canales POS, tracking Ecommerce y licencia; todas SELECT para `anon, authenticated`. No hay política QA ni rol receptor. El Usage muestra pico del ciclo de 4 conexiones; no es una lectura de conexiones activas en este instante. |
| Advisors | Seguridad: 34 INFO `rls_enabled_no_policy`, 7 WARN `function_search_path_mutable`, 181 WARN `anon_security_definer_function_executable`, 182 WARN `authenticated_security_definer_function_executable`. Rendimiento: 51 INFO `unindexed_foreign_keys`, 76 INFO `unused_index`. Son hallazgos de plataforma existentes; no se cambiaron. |

### Secretos: nombres solamente

Se consultaron metadatos sin revelar valores. La lista de secretos de Functions contiene 12 nombres: `AI_API_KEY`, `AI_API_URL`, `AI_MAX_PROMPT_CHARS`, `AI_MODEL`, `AI_PROVIDER`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`, `SUPABASE_JWKS`, `SUPABASE_PUBLISHABLE_KEYS`, `SUPABASE_SECRET_KEYS`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`. No aparece `LANZO_ECOM_QA_CONTROL_TOKEN` ni otro secreto QA. No se cambió ninguno.

Vercel devolvió 11 nombres de variables del proyecto con `decrypt=false`; no existe variable `QA`, `ECOM` o `BRIDGE`. `VITE_ENABLE_LICENSE_REALTIME` es la única que coincide con “REALTIME”, y no habilita este puente Ecommerce. Los nombres, targets y tipo de protección, sin valores, están en la evidencia adjunta.

### ACL compartidas: gate abierto

La consulta en vivo volvió a confirmar `SECURITY DEFINER` y `EXECUTE` vía `PUBLIC` en estas seis firmas exactas:

| Función | `PUBLIC` | `anon` | `authenticated` | `service_role` |
|---|---:|---:|---:|---:|
| `admin_list_staff_users(text,text,text,text)` | sí | sí | sí | sí |
| `admin_create_staff_user(text,text,text,text,text,text,jsonb,text,text)` | sí | sí | sí | sí |
| `admin_update_staff_user(text,text,text,uuid,text,jsonb,boolean,text,text,text)` | sí | sí | sí | sí |
| `pos_get_cash_station_state(text,text,text,text)` | sí | sí | sí | sí |
| `pos_admin_close_cash_session(text,text,text,text,text,text,numeric,numeric,text,text,integer,text)` | sí | sí | sí | sí |
| `pos_admin_adopt_legacy_cash_session(text,text,text,text,text,integer,text)` | sí | sí | sí | sí |

Los grants de `anon`, `authenticated` y `service_role` aparecen expresamente en las ACL actuales. La propuesta separada [public-rpc-acl-proposal.sql](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-proposal.sql) elimina solo `PUBLIC` y exige conservar esos grants; el [rollback exacto](../../supabase/candidates/ecom-signal-auth-r2/public-rpc-acl-rollback.sql) repone únicamente las seis concesiones. El ensayo de ACL previo fue transaccional y revirtió todos los cambios; sus 24 verificaciones pasaron en fixture. Eso no equivale a aplicar el cambio persistentemente ni a autorizarlo.

**No aplicar estos REVOKE sin aprobación específica.** El rol receptor ausente heredaría `PUBLIC EXECUTE` si se creara antes de cerrar este gate. No se habilita JWT Realtime ni se sortea el gate con otro rol.

## C. Negocio FREE y dispositivo

La consulta agregada actual encontró 17 licencias FREE activas y 1 Trial activa; 10 perfiles de negocio, 7 portales Ecommerce activos/no borrados, 7 cuentas Admin propietarias activas, 14 dispositivos activos y 6 cuentas Staff activas. Dos licencias FREE satisfacen simultáneamente los filtros de portal publicado con ordering, entitlement Ecommerce/Inbox y cuentas/dispositivos activos. No se publicaron nombres, IDs, licencias ni huellas.

No se seleccionó una de las dos. `license_devices.user_id` referencia `auth.users(id)`, pero `auth.users` tiene cero filas; por tanto, la base no permite probar qué dispositivo físico controla el propietario. El propietario debe identificar el negocio y dispositivo concretos antes de crear allowlist o tocar sesiones. No se reutilizará ni liberará el único dispositivo Admin del propietario. No se cambiará ninguna licencia a PRO ni se activará `order_created`.

## D. Usage, límites y errores

Snapshot de **Usage del ciclo de facturación actual** (la UI no mostró aquí el rango exacto de fechas):

| Métrica | Observado / incluido | Saldo aritmético visible |
|---|---:|---:|
| Edge Function invocations | 94 / 500,000 | 499,906 |
| Realtime messages | 2,726 / 2,000,000 | 1,997,274 |
| Realtime peak concurrent connections | 4 / 200 | 196 de margen frente al máximo observado |
| Auth MAU | 22 / 50,000 | 49,978 |
| Database size, medidor de facturación | 94 / 500 MB | 406 MB |
| Egress | 0.12 / 5 GB | 4.88 GB |
| Storage average | 0.00 / 1 GB | redondeado por la UI |
| Log ingestion | 0.11 / 1 GB | 0.89 GB |
| Log query | 9.94 / 100 GB | 90.06 GB; la UI indica que no se factura directamente |

Observability muestra además 0.09 GB utilizados de 8 GB provisionados; es otra vista del almacenamiento y no se mezcló con el medidor de facturación de 94/500 MB. No hay overage reportado. En Free, los excesos restringen servicios en vez de facturarse como overage; los límites publicados se pueden contrastar en la [documentación oficial de billing de Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase).

**Métricas exactas de logs, ventana UTC 2026-10-21 23:32:10 → 2026-10-22 23:32:10:** `auth_logs`: 138 filas (125 info, 13 warning, 0 error); `realtime_logs`: 54 (36 info, 18 error). Son señales de servicio de 24 h, no consumo mensual ni atribuible al bridge. No había bridge QA desplegado. La Usage de MAU/Edge/Realtime se refresca con la cadencia que indica el panel; no se afirmó uso instantáneo.

El margen visible supera el presupuesto conservador de un negocio, un dispositivo, una sesión, un líder Web Locks y hasta 10 sondas sintéticas diarias. La proyección de 2,634 invocaciones/mes del plan original sigue siendo una **proyección**, no uso observado. No hay medición durante/después del piloto porque no se ejecutó.

**Gate de recursos:** resuelto para preparar; antes de cualquier piloto sostenido, capturar otra lectura de Usage y mantener advertencia a 70% / apagado preventivo a 80%. Desconocido: fecha exacta del ciclo en esta captura, invocaciones por función, atribución de Realtime por módulo y conexión activa actual.

## E. Vercel y ruta a la aplicación real

Proyecto `lanzo-pos`. La Production vigente es [deployment `dpl_Beeod21Pc9mgeRe3qK6xKm8bc8uu`](https://vercel.com/fdxrulis-projects/lanzo-pos/Beeod21Pc9mgeRe3qK6xKm8bc8uu), READY, alias productivo [lanzo-pos.vercel.app](https://lanzo-pos.vercel.app), rama `main`, SHA `9ca65fc…`.

El deployment del HEAD #368 `3931ff2…` está READY pero tiene `target=null`; no es el deployment `production`. No se usó como sustituto de Production. La protección SSO del proyecto está habilitada (`all_except_custom_domains`); no se modificó.

En el código del PR existen `ecomSignalReceiver.js`, `ecomSignalActorAdapter.js`, Web Locks y `useEcomSignalQa.js`. El hook usa `enabled=false` por defecto, no aparece montado/importado por `src/App.jsx` y no ofrece superficie de diagnóstico. El broker `lanzo-ecom-bridge-qa` está solo en el árbol del PR; tampoco existen objetos SQL, allowlist ni secreto de control en producción. Por eso la URL de Production actualmente no tiene el montaje para QA.

**Ruta soportada sin merge:** Vercel documenta deploy de producción por CLI con `vercel deploy --prod`; ese comando asigna el deployment a dominios Production. No se ejecutó. La promoción de una Preview con `vercel promote` crea un nuevo build usando variables Production, por lo que no debe describirse como “promover el mismo artefacto probado”. Tras cerrar los gates, una ruta posible es revisar un SHA exacto, desplegar ese SHA directamente con `--prod` y verificar de nuevo la asignación de Production; requiere aprobación del SHA/cambio antes de mover tráfico. Referencias: [deploy por CLI](https://vercel.com/docs/projects/deploy-from-cli), [promoción de previews](https://vercel.com/docs/deployments/promote-preview-to-production).

El PR #368 no se debe desplegar tal cual: todavía es Draft y no contiene montaje; tampoco se debe fusionar como atajo. El PR #369 toca `App.jsx` y Actor Runtime, así que debe revisarse como dependencia antes de preparar un montaje mínimo y no competidor.

## F. Automatización y seguridad

Ejecuciones locales de esta continuación, únicamente con fixtures:

- `node --test scripts/supabase/ecom-native-bridge.node-test.mjs`: **13/13 PASS** (broker, vault, receptor, expiración, reconnect, límites y cleanup simulados).
- `vitest run src/services/ecommerce/__tests__/ecomSignalActorAdapter.test.jsx --pool=threads --maxWorkers=1`: **17/17 PASS** (Actor Runtime y hook simulados). El pool predeterminado no respondió a tiempo en Windows; el reintento con pool de hilos ejecutó los casos.
- ESLint focal para receptor, adapter, leadership y hook: **exit 0**; aviso de tabla `baseline-browser-mapping` antigua.
- Hosted de esta continuación: **NOT RUN / BLOCKED**. No se crearon usuarios Auth, grants, topics, sesiones o sondas en producción.

La evidencia previa de 1A.4 se reutiliza únicamente para el SHA y los ensayos allí registrados: 37/37 Node focal PASS; 57/57 React/Actor/bridge/storage PASS; Deno PASS. Node completo Windows: candidato 186 PASS / 12 FAIL y base 149 PASS / los mismos 12 FAIL, cero fallos diferenciales nuevos. Lint completo: 159 errores / 177 warnings en ambos árboles, cero diagnósticos nuevos; el FAIL bruto permanece. Hosted anterior cubrió cuatro TTL, expiración/recovery, aislamiento y carreras/revocación; luego el cleanup dejó cero identidades y objetos QA. En el SHA #368, `Ecommerce Native Bridge QA` conserva **FAIL bruto**, `PR127 Global Comparison` conserva **PASS** y Vercel conserva **success**. En esta continuación, fixtures locales: 13/13 broker/vault/receptor y 17/17 Actor adapter/hook; lint focal exit 0. Hosted producción de esta continuación: **NOT RUN / BLOCKED**. Un deployment Ready no certifica integración física.

El residual Auth de 1A.4 sigue abierto: el broker no controla todos los intentos directos de password/MFA/Auth ni impone una cota por identidad. Se requiere aceptación explícita del propietario o una arquitectura alternativa antes del uso comercial. Para esta fase no se transmiten credenciales, tokens o huellas al navegador.

## G. Gates y próxima secuencia

| Gate | Estado | Siguiente acción concreta |
|---|---|---|
| ACL | `OWNER_APPROVAL_REQUIRED` | Revisar consumidores externos; aprobar o rechazar solo las seis firmas y el rollback enumerados en la propuesta R2. |
| Auth residual | abierto | Aceptar explícitamente el riesgo acotado de QA o elegir una alternativa de firma/limitación; no extenderlo a uso comercial. |
| Piloto | sin selección | Propietario confirma un negocio FREE y un dispositivo físico controlado por él; revisar sesión/permiso Admin y Staff del negocio elegido. |
| Infra QA | candidata, no instalada | Después de ACL y selección, preparar y revisar migraciones aditivas separadas, allowlist, broker, secreto dedicado y apagado server-side. No usar `db push` general. |
| Frontend Production | `HOLD_PRODUCTION_DEPLOYMENT` | Preparar montaje mínimo solo cuando haya autoridad de servidor; certificar SHA/CI, luego ejecutar deploy directo Production únicamente con aprobación del SHA exacto. |
| QA física | `NOT RUN` | Comenzar QA-01…22 solo si Production sirve el SHA aprobado y postflight confirma una allowlist de un negocio/dispositivo y kill switch probado. |
| Usage | disponible; sin delta del bridge | Capturar baseline justo antes de activar y comparar durante/después, sin atribuir tráfico compartido al bridge. |

**Clasificación final:** `HOLD_PRODUCTION_DEPLOYMENT` y `HOLD_SECURITY`. No `READY_FOR_OWNER_PHYSICAL_QA`; tampoco `READY_FOR_OWNER_ACL_APPROVAL`, porque todavía no existe infraestructura persistente revisada ni una selección del negocio/dispositivo. `HOLD_USAGE` queda cerrado para el piloto pequeño según este snapshot.

## Enlaces

- [PR #368](https://github.com/fdxruli/Lanzo-POS/pull/368)
- [Supabase Production / Usage](https://supabase.com/dashboard/project/odlrhijtfyavryeqivaa)
- [Production Vercel deployment](https://vercel.com/fdxrulis-projects/lanzo-pos/Beeod21Pc9mgeRe3qK6xKm8bc8uu)
- [App Production](https://lanzo-pos.vercel.app)
- [Evidencia compacta de preflight](evidence/ecom-realtime-auth-1a5/preflight.json)
- [Guía QA-01…22](ECOM.FREE.ORDERS.REALTIME.AUTH.PILOT.QA.GUIDE.1A.5.md)
- [Continuación 1A.5: allowlist, montaje y estado actual](ECOM.FREE.ORDERS.REALTIME.AUTH.PILOT.1A.5.CONTINUATION.md)
