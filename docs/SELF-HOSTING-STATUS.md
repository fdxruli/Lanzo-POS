# Estado de autohospedaje

Fecha: 2026-08-04.

| Área | Estado | Nota |
| --- | --- | --- |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no está demostrado; faltan runtime, E2E, base vacía, backup/restore y resolver `period_id`. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado; `supabase/config.toml` existe, pero el daemon Docker no estuvo disponible. |
| OSS.1.5.2 | `PASS WITH NOTES` | La migración ecommerce es hermética; hash y comparación funcional pasan, pero falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | `lanzo-ai-agent` está versionada y 36 pruebas mock Deno pasan; no hubo Supabase remoto, proveedor real ni despliegue. |
| OSS.1.4 | sin cambio | Mantener el estado registrado por la revisión de activos. |
| OSS.2 | `BLOCKED` | Continúan pendientes los bloqueos del roadmap. |
| AGPL | no activada | No se creó `LICENSE` ni se cambió la licencia. |

## Handoff a la siguiente tarea

La siguiente tarea debe ejecutar el runtime aislado de Edge Functions y la
validación E2E sin usar producción. Antes de ese runtime debe revisarse la
inconsistencia heredada entre `get_ai_agent_usage`, que cuenta por
`ai_agent_usage.period_id`, y las migraciones versionadas, que no añaden esa
columna. No se debe corregirla dentro de OSS.1.5.3 ni inventar una RPC.

También quedan pendientes la ejecución integral de migraciones, backup/restore
y las pruebas de permisos/grants de las RPC server-side.

## Límites de esta tarea

OSS.1.5.3 no añade migraciones, no cambia planes o límites, no modifica el
frontend, no usa Docker, no inicia Supabase local, no usa Supabase remoto, no
despliega la función, no usa Vercel y no activa AGPL.
