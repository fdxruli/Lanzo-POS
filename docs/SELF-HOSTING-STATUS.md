# Estado de autohospedaje

Fecha: 2026-08-04.

| Área | Estado | Nota |
| --- | --- | --- |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no está demostrado; faltan runtime, E2E, base vacía y backup/restore. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado; `supabase/config.toml` existe, pero el daemon Docker no estuvo disponible. |
| OSS.1.5.2 | `PASS WITH NOTES` | La migración ecommerce es hermética; hash y comparación funcional pasan, pero falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | `lanzo-ai-agent` está versionada y 36 pruebas mock Deno pasan; no hubo Supabase remoto, proveedor real ni despliegue. |
| OSS.1.5.4 | `SCHEMA RECONCILED WITH NOTES` | Periodos IA, `period_id`, orden de migraciones, RPC y seguridad versionados; PostgreSQL runtime no ejecutado. |
| OSS.1.4 | sin cambio | Mantener el estado registrado por la revisión de activos. |
| OSS.2 | `BLOCKED` | Continúan pendientes los bloqueos del roadmap. |
| AGPL | no activada | No se creó `LICENSE` ni se cambió la licencia. |

## Handoff a la siguiente tarea

La siguiente tarea debe ejecutar el runtime aislado de Edge Functions y la
validación E2E sin usar producción. Debe comprobar además el reset desde cero,
las instalaciones existentes con backfill ambiguo y la cadena completa de
migraciones; OSS.1.5.4 ya dejó versionado el contrato de periodos y no requiere
inventar otra RPC.

También quedan pendientes la ejecución integral de migraciones, backup/restore
y las pruebas de permisos/grants de las RPC server-side.

## Límites de esta tarea

OSS.1.5.4 no cambia planes o límites comerciales, no modifica el frontend, no
usa Docker, no inicia Supabase local, no usa Supabase remoto, no despliega la
función, no usa Vercel y no activa AGPL. OSS.1.5.3 conserva su estado
`VERSIONED WITH NOTES`.
