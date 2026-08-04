# Roadmap OSS

Actualización: 2026-08-04.

| Tarea | Estado | Alcance |
| --- | --- | --- |
| OSS.1.4 | `BLOCKED — NO-GO (RELEASE BOUNDARY PENDING)` | OSS.1.4.1 `PROVENANCE RECONCILED WITH NOTES`, OSS.1.4.2 `ASSET EVIDENCE EXHAUSTED WITH NOTES` y OSS.1.4.3 `MAINTAINER DECLARATION RECORDED WITH RESTRICTED ASSET SCOPE`; activos `RESTRICTED OFFICIAL IDENTITY — OSS LICENSE EXCLUDED`. |
| OSS.1.4.2 | `ASSET EVIDENCE EXHAUSTED WITH NOTES` | Evidencia de código, Git y GitHub agotada para seis familias; no hay grant de redistribución, fuente editable ni términos autorizados suficientes. |
| OSS.1.4.3 | `MAINTAINER DECLARATION RECORDED WITH RESTRICTED ASSET SCOPE` | Declaración final recibida para seis familias; los nueve activos permanecen como identidad oficial restringida y fuera del alcance automático de una futura licencia OSS del código. |
| OSS.1.4.4 | `PENDING` | Implementar y validar el límite técnico de distribución sin cambiar la identidad de producción. |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no es reproducible; runtime, E2E y backup/restore siguen pendientes. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado y configuración local creada; Docker daemon no disponible para validar runtime. |
| OSS.1.5.2 | `PASS WITH NOTES` | Migración ecommerce hermética, con SQL local equivalente; falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | Edge Function `lanzo-ai-agent` versionada, contrato frontend preservado, proveedor configurable, reserva/finalización segura y 36 tests Deno mock. |
| OSS.1.5.4 | `SCHEMA RECONCILED WITH NOTES` | Bootstrap reproducible de periodos IA, `period_id`, RPC por periodo, backfill conservador y validación estática; runtime PostgreSQL pendiente. |
| OSS.2 | `BLOCKED` | No se desbloquea por esta tarea. |
| AGPL | no activada | No se adopta ni se declara vigente en esta tarea. |

## Handoff de OSS.1.4

OSS.1.4.1 reconcilió el inventario, los hashes, el historial y el consumo sin
alterar activos. OSS.1.4.2 agotó las fuentes autorizadas y OSS.1.4.3 registró la
declaración final del mantenedor: las seis familias son identidad oficial
restringida, fuera del alcance automático de una futura licencia OSS del
código, sin grant general de redistribución o modificación. La conservación
actual no desbloquea OSS.1.4.

El cuestionario concreto está en
[`docs/OSS-ASSET-EVIDENCE-REQUEST.md`](OSS-ASSET-EVIDENCE-REQUEST.md). No se
modificaron activos, consumidores, dependencias, `LICENSE` ni AGPL.

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

OSS.1.4.4 — implementar y validar el límite técnico de distribución de los
activos oficiales restringidos sin cambiar la identidad de producción. Deberá
decidir qué archivos entran en una entrega OSS, qué placeholders se usan en
forks, cómo se mantiene producción intacta y cómo se validan manifests, PWA,
favicon y asistente. OSS.1.5.5 sigue pendiente dentro de su propia fase; OSS.2
permanece bloqueado.
