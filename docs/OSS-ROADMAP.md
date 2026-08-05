# Roadmap OSS

OSS.1.4.4 está implementado condicionalmente mediante el pipeline source-only
descrito en [`OSS-RELEASE-BOUNDARY.md`](OSS-RELEASE-BOUNDARY.md). La futura
licencia deberá excluir expresamente los activos oficiales; esta tarea no crea
`LICENSE` ni activa AGPL.

Actualización: 2026-08-05.

## Estado vigente tras OSS.1.4-R

El cierre de OSS.1.4 está documentado en
[`docs/OSS-1-4-FINAL-AUDIT.md`](OSS-1-4-FINAL-AUDIT.md) y queda en
`FINAL — CONDITIONAL GO`. La fila de OSS.1.4 y las notas de bloqueo que siguen
se conservan como contexto histórico previo a OSS.1.4-R; no sustituyen el
reporte canónico de cierre.

| Tarea | Estado | Alcance |
| --- | --- | --- |
| OSS.1.4 | `FINAL — CONDITIONAL GO` | OSS.1.4-R consolidó la integración en `main`, verificó el límite técnico de distribución y dejó los activos oficiales fuera del paquete; las condiciones de dependencias quedan registradas en el informe final. |
| OSS.1.4.2 | `ASSET EVIDENCE EXHAUSTED WITH NOTES` | Evidencia de código, Git y GitHub agotada para seis familias; no hay grant de redistribución, fuente editable ni términos autorizados suficientes. |
| OSS.1.4.3 | `MAINTAINER DECLARATION RECORDED WITH RESTRICTED ASSET SCOPE` | Declaración final recibida para seis familias; los nueve activos permanecen como identidad oficial restringida y fuera del alcance automático de una futura licencia OSS del código. |
| OSS.1.4.4 | `COMPLETED WITH NOTES` | Límite técnico source-only implementado y validado; no cambia la identidad de producción ni crea `LICENSE` o AGPL. |
| OSS.1.5 | `BLOCKED` | El autohospedaje completo aún no es reproducible; OSS.1.5.5 documentó un fallo de replay en la primera migración y runtime, E2E y backup/restore siguen pendientes. |
| OSS.1.5.1 | `PASS WITH NOTES` | PR #173 integrado y configuración local creada; Docker daemon no disponible para validar runtime. |
| OSS.1.5.2 | `PASS WITH NOTES` | Migración ecommerce hermética, con SQL local equivalente; falta reset sobre una base vacía. |
| OSS.1.5.3 | `VERSIONED WITH NOTES` | Edge Function `lanzo-ai-agent` versionada, contrato frontend preservado, proveedor configurable, reserva/finalización segura y 36 tests Deno mock. |
| OSS.1.5.4 | `SCHEMA RECONCILED WITH NOTES` | Bootstrap reproducible de periodos IA, `period_id`, RPC por periodo, backfill conservador y validación estática; runtime PostgreSQL pendiente. |
| OSS.1.5.5 | `FAIL` | La validación remota aislada reprodujo que la primera migración referencia `public.plans` antes de que exista; no se tocaron migraciones ni producción. Véase [`OSS-1.5.5-RUNTIME-VALIDATION.md`](OSS-1.5.5-RUNTIME-VALIDATION.md). |
| OSS.2 | `BLOCKED` | No se desbloquea por esta tarea. |
| AGPL | no activada | No se adopta ni se declara vigente en esta tarea. |

## Handoff de OSS.1.4

OSS.1.4.1 reconcilió el inventario, los hashes, el historial y el consumo sin
alterar activos. OSS.1.4.2 agotó las fuentes autorizadas y OSS.1.4.3 registró la
declaración final del mantenedor: las seis familias son identidad oficial
restringida, fuera del alcance automático de una futura licencia OSS del
código, sin grant general de redistribución o modificación. La conservación
actual fue cerrado por OSS.1.4-R con resultado condicional; las condiciones
residuales y el alcance restringido están en el reporte final.

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

OSS.1.5.5 — continuar únicamente después de disponer de un entorno Supabase
aislado y autorizado. OSS.1.5.6 no debe iniciarse antes de cerrar esa
dependencia, y OSS.2 permanece bloqueado mientras OSS.1.5 siga bloqueado.
