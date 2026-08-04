# Roadmap OSS

Actualización: 2026-08-04.

| Tarea | Estado | Alcance |
| --- | --- | --- |
| OSS.1.4 | sin cambio | Mantener el estado previo de activos y sus bloqueos. |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no es reproducible; runtime, E2E, backup/restore y esquema IA siguen pendientes. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado y configuración local creada; Docker daemon no disponible para validar runtime. |
| OSS.1.5.2 | `PASS WITH NOTES` | Migración ecommerce hermética, con SQL local equivalente; falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | Edge Function `lanzo-ai-agent` versionada, contrato frontend preservado, proveedor configurable, reserva/finalización segura y 36 tests Deno mock. |
| OSS.2 | `BLOCKED` | No se desbloquea por esta tarea. |
| AGPL | no activada | No se adopta ni se declara vigente en esta tarea. |

## Contexto conservado

OSS.1.5.1 añadió `supabase/config.toml` y la documentación de configuración y
validación. No habilitó proyectos remotos ni secretos oficiales.

OSS.1.5.2 eliminó la descarga de SQL en tiempo de ejecución de
`20260715190958_ecom_products_model_1.sql`. La fuente canónica fue recuperada
del historial Git, verificada por SHA-256 y comparada funcionalmente con el SQL
embebido.

OSS.1.5.3 incorpora la función que el frontend ya invoca por defecto:

- `usage` consulta `get_ai_agent_usage` sin requerir la configuración del proveedor.
- El análisis valida el request, reserva con `begin_ai_agent_analysis`, llama una
  sola vez al proveedor y finaliza la reserva con `complete_ai_agent_analysis`.
- `AI_API_KEY` es la clave principal y `OPENAI_API_KEY` sólo el fallback.
- `AI_API_URL` exige un endpoint completo y sólo se soportan explícitamente
  Responses-style y Chat-Completions-style.
- No se añadieron SDKs, dependencias, migraciones ni cambios de frontend.

La validación de OSS.1.5.3 es `VERSIONED WITH NOTES`: Deno `2.5.1` ejecutó 36
tests mock y `deno check` pasó, pero no se ejecutaron Supabase local/remoto ni
un proveedor real. La revisión también encontró que la RPC final de consulta
usa `ai_agent_usage.period_id`, columna que no aparece en migraciones
versionadas; resolver ese bloqueo es una tarea de esquema separada.

## Siguiente tarea

Resolver la evidencia de esquema `period_id` y ejecutar, en un entorno aislado
con Docker autorizado, el runtime de Edge Functions, el reset desde cero, las
pruebas E2E y el flujo de backup/restore. OSS.1.5 no debe marcarse `VERIFIED`
hasta completar esas comprobaciones; OSS.2 permanece bloqueado.
