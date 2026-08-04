# Roadmap OSS

Actualización: 2026-08-04.

| Tarea | Estado | Alcance |
| --- | --- | --- |
| OSS.1.4 | `BLOCKED — NO-GO` | OSS.1.4.1 `PROVENANCE RECONCILED WITH NOTES`; activos `ASSET NO-GO` / `ASSET REVIEW REQUIRED`; handoff a OSS.1.4.2. |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no es reproducible; runtime, E2E y backup/restore siguen pendientes. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado y configuración local creada; Docker daemon no disponible para validar runtime. |
| OSS.1.5.2 | `PASS WITH NOTES` | Migración ecommerce hermética, con SQL local equivalente; falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | Edge Function `lanzo-ai-agent` versionada, contrato frontend preservado, proveedor configurable, reserva/finalización segura y 36 tests Deno mock. |
| OSS.1.5.4 | `SCHEMA RECONCILED WITH NOTES` | Bootstrap reproducible de periodos IA, `period_id`, RPC por periodo, backfill conservador y validación estática; runtime PostgreSQL pendiente. |
| OSS.2 | `BLOCKED` | No se desbloquea por esta tarea. |
| AGPL | no activada | No se adopta ni se declara vigente en esta tarea. |

## Handoff de OSS.1.4

OSS.1.4.1 reconcilió el inventario, los hashes, el historial y el consumo sin
alterar activos. OSS.1.4.2 debe obtener las fuentes, exportaciones, términos y
permisos concretos de las familias `UNKNOWN` y `REVIEW REQUIRED`, o decidir una
sustitución separada por familia. La conservación actual no desbloquea OSS.1.4
ni concede derechos de redistribución sobre la identidad.

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
un proveedor real. OSS.1.5.4 resolvió la referencia de `period_id` mediante una
migración de compatibilidad situada antes de la primera dependencia; no se
encontró una migración histórica exacta que restaurar.

## Siguiente tarea

OSS.1.5.5: ejecutar, en un entorno aislado autorizado, el runtime de Edge
Functions, el reset desde cero, las pruebas E2E y el flujo de backup/restore,
incluyendo una instalación existente con backfill ambiguo. OSS.1.5 no debe
marcarse `VERIFIED` hasta completar esas comprobaciones; OSS.2 permanece
bloqueado.
