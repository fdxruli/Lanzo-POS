# Estado de autohospedaje

Fecha: 2026-08-04.

| Área | Estado | Nota |
| --- | --- | --- |
| OSS.1.5 | `BLOCKED` | La reproducibilidad completa aún no está demostrada; siguen pendientes runtime, E2E, backup/restore y `lanzo-ai-agent`. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 está integrado; `supabase/config.toml` existe y es aceptado, pero Docker daemon no está disponible para validar runtime. |
| OSS.1.5.2 | `PASS WITH NOTES` | La migración ecommerce es hermética; hash y comparación funcional pasan, pero falta el reset sobre una base vacía. |
| OSS.1.4 | sin cambio | Mantener el estado registrado por la revisión de activos; esta tarea no lo modifica. |
| OSS.2 | `BLOCKED` | Continúan pendientes los bloqueos del roadmap. |
| AGPL | no activada | No se creó `LICENSE` ni se cambió la licencia. |

## Handoff a la siguiente tarea

La siguiente tarea técnica exacta es versionar e integrar `lanzo-ai-agent`,
además de ejecutar la validación aislada pendiente del runtime. La migración
`supabase/migrations/20260715190958_ecom_products_model_1.sql` ya contiene el
SQL canónico local de `20260715190000_ecom_products_model_1.sql`; su blob y
SHA-256 fueron verificados, y no conserva llamadas de red ni SQL dinámico.

No saltar la migración, no usar `migration repair`, no ejecutar sobre proyectos
remotos y no declarar completo el autohospedaje.

## Límites

Esta tarea no añade `lanzo-ai-agent`, no cambia otras migraciones o Edge Functions,
no valida Auth/RLS/RPC/Storage/Realtime/E2E, no ejecuta backup/restore, no usa
Supabase remoto, no usa Vercel y no activa AGPL.
