# Estado de autohospedaje

Fecha: 2026-08-05.

| Área | Estado | Nota |
| --- | --- | --- |
| OSS.1.5 | `BLOCKED WITH DOCUMENTED LIMITATION` | La instalación limpia desde una base vacía no está soportada actualmente; la limitación está documentada y no invalida un despliegue alojado existente. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado; `supabase/config.toml` existe, pero el daemon Docker no estuvo disponible. |
| OSS.1.5.2 | `PASS WITH NOTES` | La migración ecommerce es hermética; hash y comparación funcional pasan, pero falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | `lanzo-ai-agent` está versionada y 36 pruebas mock Deno pasan; no hubo Supabase remoto, proveedor real ni despliegue. |
| OSS.1.5.4 | `SCHEMA RECONCILED WITH NOTES` | Periodos IA, `period_id`, orden de migraciones, RPC y seguridad versionados; PostgreSQL runtime no ejecutado. |
| OSS.1.5.5 | `FAIL WITH DOCUMENTED LIMITATION` | La primera migración versionada presupone el esquema fundacional histórico; el replay desde una base vacía falla en `public.plans`. No se modificaron migraciones ni producción. |
| Self-hosting | `FRESH INSTALL NOT CURRENTLY SUPPORTED` | El repositorio no debe presentarse como self-hostable desde cero hasta reconstruir y validar un baseline fundacional completo. |
| Existing hosted deployment | `NOT INVALIDATED` | El fallo del intento aislado no demuestra que el proyecto Supabase actual esté dañado ni invalida instalaciones existentes. |
| `SELF-HOSTING.FOUNDATION` | `FUTURE — NON-BLOCKING FOR LICENSE` | Reconstruir y validar el baseline histórico para instalaciones nuevas. |
| OSS.1.4 | sin cambio | Mantener el estado registrado por la revisión de activos. |
| OSS.2 | `CAN CONTINUE WITH DOCUMENTED LIMITATION` | Puede continuar con alcance de licencia, exclusión de activos oficiales, `LICENSE`, notices y documentación de self-hosting. |
| AGPL | no activada | No se creó `LICENSE` ni se cambió la licencia. |

## Estado de la limitación

La primera migración versionada,
`20260614224210_harden_public_tables_and_pos_rpcs.sql`, referencia
`public.plans` antes de que exista. Ninguna migración anterior del historial
local crea esa tabla, porque el esquema fundacional histórico precede a la
historia versionada del repositorio.

Esta validación se ejecutó sólo en un proyecto Supabase remoto aislado. No se
reconstruyó el baseline, no se modificó ninguna migración, no se repitió el
reset remoto y no se ejecutaron pruebas adicionales. El proyecto Supabase
actual puede seguir funcionando y las migraciones incrementales siguen siendo
útiles para instalaciones existentes.

El baseline fundacional queda diferido a `SELF-HOSTING.FOUNDATION`, como tarea
futura no bloqueante para la licencia. OSS.1.5 conserva el estado `BLOCKED WITH
DOCUMENTED LIMITATION`; OSS.2 puede continuar con sus tareas de licencia y
documentación.

## Límites de esta tarea

OSS.1.5.4 no cambia planes o límites comerciales, no modifica el frontend, no
usa Docker, no inicia Supabase local, no usa Supabase remoto, no despliega la
función, no usa Vercel y no activa AGPL. OSS.1.5.3 conserva su estado
`VERSIONED WITH NOTES`.
