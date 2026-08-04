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
periodos y cuentan `reserved`/`completed` por `period_id`. La auditoría detectó
que `ai_agent_usage.period_id` no aparece en ninguna migración versionada; no se
inventó una migración ni se corrigió en esta tarea.

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
locales sin servicios reales. No se declara `VERSIONED` porque no hubo runtime
Supabase ni proveedor real, y porque la migración final de consulta referencia
una columna `period_id` ausente del historial de migraciones versionado.

OSS.1.5 permanece `BLOCKED` hasta completar runtime/E2E, base vacía,
backup/restore y la revisión de `period_id`. OSS.1.4 mantiene su estado; OSS.2
permanece `BLOCKED`; AGPL no fue activada y no se creó `LICENSE`.

## Alcance negativo comprobado

No se modificaron migraciones, `supabase/config.toml`,
`authorize-image-upload`, frontend, `store`, `public`, manifiestos,
lockfiles, `.github`, `vercel.json`, `LICENSE` ni activos de marca. No se
reescribió historial, no se usaron secretos, no se accedió a producción y no
se desplegó la función.
