# Matriz de autohospedaje

Fecha de esta actualización: 2026-08-04.

Estados permitidos: `VERIFIED`, `VERIFIED WITH NOTES`, `PARTIAL`, `NOT
VERIFIED`, `BLOCKED`, `NOT REQUIRED`.

| Componente | Configuración/evidencia | Estado | Bloqueo o siguiente prueba |
| --- | --- | --- | --- |
| Supabase CLI | `2.51.0`; parseó TOML y reconoció `lanzo-pos-local` | VERIFIED WITH NOTES | repetir `status` con Docker |
| Docker | CLI disponible; daemon no usado en OSS.1.5.3 | BLOCKED | iniciar Docker Desktop manualmente |
| PostgreSQL | puerto configurado `54322`, major `17` | BLOCKED | `supabase start` |
| API | puerto configurado `54321` | BLOCKED | comprobar endpoint local |
| Auth | habilitado; site URL local y redirects locales | BLOCKED | comprobar Auth tras `start` |
| Storage | habilitado; límite `50MiB`; bucket esperado `images` | BLOCKED | comprobar bucket/RLS/function |
| Realtime | habilitado | BLOCKED | comprobar conexión/publicaciones |
| Studio | habilitado en `54323` | BLOCKED | abrir Studio local |
| Inbucket | habilitado en `54324` | BLOCKED | comprobar correo local |
| Edge Runtime | función `lanzo-ai-agent` y `authorize-image-upload` versionadas | VERIFIED WITH NOTES | runtime E2E y despliegue no ejecutados |
| `lanzo-ai-agent` | `usage`, reserva/finalización, validación y provider adapters; 36 tests Deno | VERIFIED WITH NOTES | validar contra stack local aislado |
| IA/provider | `AI_API_URL` explícita para `/responses` o `/chat/completions`; fetch sin SDK | VERIFIED WITH NOTES | proveedor real no utilizado |
| Secretos Edge | `SUPABASE_*`, `AI_API_KEY`, fallback `OPENAI_API_KEY`, `AI_API_URL`, `AI_MODEL` documentados con marcadores sintéticos | VERIFIED WITH NOTES | configurar sólo en runtime aislado |
| RPC de usage | `get_ai_agent_usage`; rate limit AI_USAGE 30/600 s, bloqueo 300 s | VERIFIED WITH NOTES | revisar `period_id` antes de runtime |
| RPC de análisis | `begin_ai_agent_analysis` y `complete_ai_agent_analysis`; reserva y cierre único | VERIFIED WITH NOTES | comprobar grants/runtime local |
| Migraciones | 216 encontradas; migración ecommerce hermética; bootstrap de periodos IA versionado; no ejecutadas | VERIFIED WITH NOTES | reset aislado desde cero |
| Reset local | no ejecutado; no hubo stack | BLOCKED | ejecutar sólo con Docker local |
| Migración externa | `20260715190958_ecom_products_model_1.sql` versionada localmente; no usa GitHub, red ni `http` | VERIFIED WITH NOTES | validar reset aislado |
| Periodos IA | `license_periods`, `ensure_current_license_period`, `ai_agent_usage.period_id`, FK compuesta y RPC por periodo versionadas en OSS.1.5.4 | VERIFIED WITH NOTES | ejecutar runtime PostgreSQL y comprobar instalaciones existentes |
| E2E, backup y restore | fuera del alcance de esta tarea | NOT VERIFIED | tareas posteriores |

La configuración local no contiene project refs oficiales, URLs de producción,
claves ni credenciales. La matriz no afirma que los servicios estén saludables
porque no se inició un stack local ni se accedió a Supabase remoto.
