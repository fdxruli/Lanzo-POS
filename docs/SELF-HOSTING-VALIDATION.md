# Evidencia de validación de autohospedaje

Fecha: 2026-08-04 (America/Mexico_City)

## Base y GitHub

| Elemento | Resultado |
| --- | --- |
| Repositorio | `fdxruli/Lanzo-POS` |
| PR #174 | `MERGED` |
| `merged_at` | `2026-08-04T16:37:04Z` |
| Head SHA del PR #174 | `c393b2d8052aae9be5d42d399e1d76e5957dbb4d` |
| Merge commit del PR #174 | `5736eb6cd3ba36361530164655351a601a595f57` |
| SHA actual de `origin/main` | `5736eb6cd3ba36361530164655351a601a595f57` |
| Ancestro confirmado | `git merge-base --is-ancestor 5736eb6c... origin/main` PASS |
| Worktree antes de editar | limpio |
| HEAD inicial de la rama | `5736eb6cd3ba36361530164655351a601a595f57` |
| Rama | `feat/oss-version-lanzo-ai-agent` |
| HEAD final | commit único de esta rama: `feat(oss): version Lanzo AI edge function` |

`git fetch origin --prune`, `git switch main` y `git pull --ff-only origin main`
se ejecutaron antes de crear la rama. `HEAD` y `origin/main` coincidieron antes
de editar.

## Evidencia de contrato

La auditoría inspeccionó completamente los servicios y componentes IA usados
por el frontend, incluyendo `src/services/aiService.js`,
`src/services/aiAgentUsageService.js`, `src/utils/aiPromptBuilder.js`,
`src/utils/buildAgentPayload.js`, `src/agents/**`,
`src/components/dashboard/AIAgentDashboard.jsx` y
`src/hooks/dashboard/useAgentPreview.js`.

El frontend invoca `lanzo-ai-agent` por defecto y envía camelCase:
`auth.licenseKey`, `auth.deviceFingerprint`, `auth.deviceSecurityToken`,
`auth.staffSessionToken`, `agentType`, `systemPrompt`, `userPrompt` y
`options.temperature`/`options.maxTokens`.

No se encontró una implementación histórica de la Edge Function. El historial
contiene únicamente los cambios del frontend que enrutan a la función:

- `6214f432 feat(ai): route agents through Supabase Edge Function`.
- `120e2a0f feat(ai): add AI agent usage service`.
- `d38b6a21 perf: cache AI agent usage checks`.

## RPC finales inspeccionadas

| RPC | Firma final usada | Retorno/semántica | Permisos/rate limit |
| --- | --- | --- | --- |
| `get_ai_agent_usage` | `(text, text, text, text default null)` | JSONB de licencia, dispositivo, staff, periodo y uso | wrapper público final con `AI_USAGE`, 30/600 s, bloqueo 300 s |
| `begin_ai_agent_analysis` | `(text, text, text, text default null, text default 'unknown', jsonb default '{}')` | JSONB; valida licencia/dispositivo/staff, reserva y devuelve `usage_id` | RPC interna protegida; la Edge Function la llama server-side |
| `complete_ai_agent_analysis` | `(uuid, boolean, integer default null, integer default null, integer default null, text default null, jsonb default '{}')` | JSONB; cambia a `completed` o `failed` | RPC interna protegida; la Edge Function la llama server-side |

Las migraciones finales de `get_ai_agent_usage` delegan en la versión de
periodos y cuentan `reserved`/`completed` por `period_id`. La auditoría de
OSS.1.5.3 detectó que la columna no aparecía en el historial; OSS.1.5.4 la
versiona junto con `license_periods` y la función de periodo actual.

## Implementación OSS.1.5.3

Archivos creados:

- `supabase/functions/lanzo-ai-agent/index.ts`
- `supabase/functions/lanzo-ai-agent/contract.ts`
- `supabase/functions/lanzo-ai-agent/provider.ts`
- `supabase/functions/lanzo-ai-agent/index.test.ts`
- `supabase/functions/lanzo-ai-agent/README.md`

Características verificadas por inspección y mocks:

- CORS `OPTIONS` y método `POST`.
- Validación de JSON, content type, body, auth, prompts, agent type y opciones.
- `usage` no requiere `AI_API_KEY`, `AI_API_URL` ni `AI_MODEL`.
- Análisis sin configuración no llama a `begin`.
- Reserva antes del proveedor y una única finalización por reserva.
- Finalización `failed` en error HTTP, timeout, JSON inválido o respuesta vacía.
- Adaptadores explícitos para `/responses` y `/chat/completions`.
- `AI_API_KEY` tiene prioridad sobre `OPENAI_API_KEY`.
- No se aceptan URLs, headers, RPCs ni secretos desde el request.
- No hay reintentos automáticos.

## Pruebas ejecutadas

| Herramienta | Resultado |
| --- | --- |
| Deno | `2.5.1` disponible |
| `deno check supabase/functions/lanzo-ai-agent/index.ts` | PASS |
| `deno test supabase/functions/lanzo-ai-agent/index.test.ts` | PASS: 36 tests, 0 fallos |
| `npm test -- --run src/agents/__tests__/agentToolRegistry.test.js` | PASS: 3 tests, 0 fallos |
| Proveedor real | NO UTILIZADO |
| Supabase remoto | NO UTILIZADO |
| Docker | NO UTILIZADO |
| `supabase start` / `db reset` | NO EJECUTADOS |
| `supabase functions deploy` | NO EJECUTADO |

Los mocks inyectan RPC, fetch, entorno, reloj y request ID. No contienen
credenciales, tokens ni respuestas reales.

## Resultado y limitaciones

Resultado OSS.1.5.3: `VERSIONED WITH NOTES`.

La función está versionada y el contrato frontend está cubierto por pruebas
locales sin servicios reales. No se declara `VERIFIED` porque no hubo runtime
Supabase ni proveedor real; la inconsistencia histórica de `period_id` queda
resuelta por OSS.1.5.4.

OSS.1.5 permanece `BLOCKED` hasta completar runtime/E2E, base vacía y
backup/restore. OSS.1.4 mantiene su estado; OSS.2
permanece `BLOCKED`; AGPL no fue activada y no se creó `LICENSE`.

### Addendum: bootstrap location reconciliation

The historical descriptions above remain evidence of the original OSS.1.5.4
analysis. The compatibility SQL is now stored at
`supabase/bootstrap/oss_bootstrap_license_period_schema.sql`, not in the
production migration sequence. `npm run oss:db:reset-local` injects an
ephemeral `20260621000000` copy into a disposable local overlay between the
older AI RPC migrations and the first June 24 consumer. This preserves the
fresh-install order without exposing the bootstrap to `migration list`,
`db push`, or production.

## Alcance negativo comprobado

No se modificaron migraciones, `supabase/config.toml`,
`authorize-image-upload`, frontend, `store`, `public`, manifiestos,
lockfiles, `.github`, `vercel.json`, `LICENSE` ni activos de marca. No se
reescribió historial, no se usaron secretos, no se accedió a producción y no
se desplegó la función.

## OSS.1.5.4 — reconciliación del esquema de periodos IA

### Precondiciones y base

| Elemento | Resultado |
| --- | --- |
| PR #175 | `MERGED` |
| Head SHA de #175 | `968df9d0042d17c813e5ae1e27b254900941d5ae` |
| `merged_at` | `2026-08-04T17:42:33Z` |
| Merge commit de #175 | `7c807c07c9dd54d5959c4935d75adc17a7067da3` |
| SHA actual de `origin/main` | `7c807c07c9dd54d5959c4935d75adc17a7067da3` |
| Ancestro confirmado | `git merge-base --is-ancestor 7c807c07... origin/main` PASS |
| HEAD inicial | `7c807c07c9dd54d5959c4935d75adc17a7067da3` |
| Rama | `fix/oss-ai-agent-period-schema` |
| Worktree antes de editar | limpio |

Se ejecutaron `git fetch origin --prune`, `git switch main` y
`git pull --ff-only origin main`; `HEAD` y `origin/main` coincidieron antes de
crear la rama de trabajo.

### Evidencia cronológica y matriz de objetos

| Objeto | Primera referencia | Primera creación | Última definición | Estado antes de OSS.1.5.4 |
| --- | --- | --- | --- | --- |
| `public.ai_agent_usage` | `20260619204242_create_ai_agent_usage_table.sql` | `20260619204242_create_ai_agent_usage_table.sql` | tabla + índices de IA | CREATED BEFORE USE |
| `ai_agent_usage.period_id` | `20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql:11` | ninguna | ninguna | REFERENCED BUT NOT CREATED |
| `public.license_periods` | `20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql:109` | ninguna | ninguna | REFERENCED BUT NOT CREATED |
| `public.ensure_current_license_period` | `20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql:104` | ninguna | ninguna | REFERENCED BUT NOT CREATED |
| `public.get_ai_agent_usage` | `20260620062018_add_ai_agent_usage_lookup_rpc.sql` | `20260620062018_add_ai_agent_usage_lookup_rpc.sql` | `20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql` | CREATED BEFORE USE |
| `public.begin_ai_agent_analysis` | `20260619204304_create_ai_agent_usage_rpcs.sql` | `20260619204304_create_ai_agent_usage_rpcs.sql` | `20260620080954_fix_ai_agent_begin_for_update_nullable_join.sql` | CREATED BEFORE USE |
| `public.complete_ai_agent_analysis` | `20260619204304_create_ai_agent_usage_rpcs.sql` | `20260619204304_create_ai_agent_usage_rpcs.sql` | misma migración | CREATED BEFORE USE |
| `idx_ai_agent_usage_license_period_status` | `20260624063444_optimize_ai_agent_usage_staff_session_lookup.sql:10` | misma migración | misma migración | CREATED AFTER USE |

La inspección de `git log --all`, ramas remotas, reflog y
`git fsck --no-reflogs --unreachable` no encontró un blob o commit histórico
que cree `license_periods`, `period_id` o `ensure_current_license_period`.
Resultado: `HISTORICAL MIGRATION NOT FOUND`.

El orden anterior no era válido: el índice del 24 de junio referenciaba una
columna inexistente y la RPC final referenciaba una tabla y una función que no
estaban creadas. El orden nuevo es válido por la migración
`20260621000000_oss_bootstrap_license_period_schema.sql`, situada después de
las RPC antiguas de reserva y antes de la primera dependencia del 24 de junio.

### Modelo y estrategia

Se eligió el `MODELO C — HÍBRIDO DE COMPATIBILIDAD`, sustentado por la RPC
final, el conteo por `period_id`, los snapshots de plan y las migraciones FREE/admin que
cierran el periodo activo e insertan uno nuevo. `period_type` conserva los
valores verificables `trial`, `basic_paid`, `pro_paid` y `admin_grant`.

La estrategia elegida es `BOOTSTRAP COMPATIBILITY MIGRATION`: no existe una
fuente histórica exacta para restaurar, y una migración posterior no podía
arreglar el índice inválido durante un reset desde cero.

Contrato final:

- `license_periods.id` es `uuid`; `license_id` referencia `licenses` con
  `ON DELETE CASCADE`; `plan_id` referencia `plans` con `ON DELETE RESTRICT`.
- La tabla conserva snapshots, `period_type`, `status`, `starts_at`,
  `ends_at`, `closed_at`, `ai_agent_limit`, `metadata` y `created_at`.
- Sólo puede existir un periodo `active` por licencia mediante índice único
  parcial. FREE lifetime usa `trial`, `ends_at = NULL` y `ai_agent_limit = 0`.
- `ai_agent_usage.period_id` es `uuid NULL` por compatibilidad histórica y
  participa en la FK compuesta `(period_id, license_id)` con `ON DELETE RESTRICT`.
  Esto impide referencias cruzadas entre licencias.
- Los usos nuevos reciben el periodo actual en BEGIN. GET cuenta sólo
  `reserved` y `completed` del periodo actual; COMPLETE no modifica
  `period_id`.
- El backfill asigna sólo una coincidencia temporal inequívoca. Los casos sin
  coincidencia o ambiguos no se borran ni se reasignan arbitrariamente: quedan
  nullable y se marcan en `metadata`.

### Seguridad y validación

`license_periods` conserva RLS, políticas de denegación directa y revokes para
`PUBLIC`, `anon` y `authenticated`. `ensure_current_license_period` usa
`SECURITY DEFINER`, `search_path = ''`, nombres calificados, lock de la fila de
licencia e idempotencia. BEGIN y COMPLETE quedan reservadas a `service_role`;
GET conserva el grant público protegido por su validación de dispositivo/staff.

Se añadió `supabase/tests/ai_agent_period_schema_test.sql` con casos de orden,
FK compuesta, periodo activo, FREE lifetime, límite positivo/cero/alcanzado,
reserva, conteo por periodo, FAILED, RESERVED, COMPLETE, backfill nullable,
licencias cruzadas, staff session, device token y RLS/grants. La prueba SQL no
se ejecutó porque no hay `psql` ni PostgreSQL aislado disponible.

Resultado OSS.1.5.4: `SCHEMA RECONCILED WITH NOTES`. No se ejecutó PostgreSQL
runtime, reset completo, E2E, backup/restore ni despliegue.

El handoff exacto a OSS.1.5.5 es ejecutar esa cadena en un entorno aislado y
validar una instalación existente con registros históricos ambiguos. OSS.1.5
continúa pendiente de validación integral; OSS.2 permanece `BLOCKED`; AGPL no
fue activada.
