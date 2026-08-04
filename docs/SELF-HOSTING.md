# Autohospedaje de Lanzo-POS

## Estado

Estado global de OSS.1.5: `BLOCKED`.

Estado de OSS.1.5.1: `PASS WITH NOTES`. La configuración local está
versionada en `supabase/config.toml`, pero Docker no estuvo disponible para
validar el runtime.

Estado de OSS.1.5.2: `PASS WITH NOTES`. La migración del modelo de productos
es hermética, no descarga SQL, no depende de GitHub ni requiere la extensión
PostgreSQL `http`; el SQL funcional fue comprobado por hash y comparación
exacta.

Estado de OSS.1.5.3: `VERSIONED WITH NOTES`. La Edge Function
`supabase/functions/lanzo-ai-agent` está versionada con las operaciones que el
frontend ya invoca, pruebas mock ejecutadas con Deno y sin servicios reales.
No se usaron Supabase remoto, proveedor real, Docker ni despliegue.

El runtime completo, E2E, backup/restore, ejecución integral de migraciones y
OSS.1.4 continúan fuera de esta validación. AGPL no está activada.

## Configuración local

La configuración está en `supabase/config.toml` y usa el identificador local
`lanzo-pos-local`.

| Componente | Configuración local | Estado en esta validación |
| --- | --- | --- |
| API | `http://127.0.0.1:54321` | BLOCKED: Docker |
| PostgreSQL | `127.0.0.1:54322` | BLOCKED: Docker |
| Shadow database | `127.0.0.1:54320` | NOT VERIFIED |
| Studio | `http://127.0.0.1:54323` | BLOCKED: Docker |
| Auth | habilitado dentro del API local | BLOCKED: Docker |
| Storage | habilitado, límite `50MiB` | BLOCKED: Docker |
| Realtime | habilitado | BLOCKED: Docker |
| Edge Runtime | habilitado | NOT VERIFIED: sin despliegue |
| Analytics | deshabilitado | NOT REQUIRED |

No se habilitaron proveedores OAuth, SMTP, SMS, CAPTCHA, S3, IA, pagos ni
webhooks externos en la configuración local.

## Edge Function `lanzo-ai-agent`

La función está en `supabase/functions/lanzo-ai-agent/index.ts` y conserva el
contrato de `src/services/aiService.js`:

- `POST { action: "usage", auth }` llama únicamente a
  `get_ai_agent_usage` y funciona sin variables del proveedor de IA.
- El análisis valida auth, prompts, agent type, opciones y configuración antes
  de llamar a `begin_ai_agent_analysis`.
- La reserva precede al proveedor y se finaliza exactamente una vez como
  `completed` o `failed` mediante `complete_ai_agent_analysis`.
- `AI_API_URL` debe ser un endpoint HTTP completo de `/responses` o
  `/chat/completions`; los endpoints desconocidos se rechazan.
- `AI_API_KEY` tiene prioridad y `OPENAI_API_KEY` sólo es fallback.
- Los tokens de licencia/dispositivo/staff, prompts, respuestas y claves no se
  envían al proveedor ni se registran.

Límites documentados: body de 256 KiB; prompt de sistema de 32.000
caracteres; prompt de usuario de 96.000; total de prompts de 128.000;
`temperature` de 0 a 2; `maxTokens` de 1 a 4.096; timeout de 55 segundos y
respuesta del proveedor de 512 KiB.

La implementación usa un cliente RPC server-side mínimo sobre `fetch`, con
`persistSession: false` y `autoRefreshToken: false`, y sólo permite las tres
RPC fijadas en el código. No añade SDK ni dependencias.

## Variables de entorno

`supabase/functions/.env.example` contiene únicamente marcadores sintéticos:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `AI_API_KEY`
- `OPENAI_API_KEY` como fallback compatible
- `AI_API_URL` como endpoint HTTP completo
- `AI_MODEL`

La separación frontend/backend es obligatoria: las variables de Supabase
server-side no deben entrar en `.env` del frontend ni en variables `VITE_*`.

## RPC y modelo de periodos IA

La secuencia final usa `get_ai_agent_usage`, `begin_ai_agent_analysis` y
`complete_ai_agent_analysis`. OSS.1.5.4 versiona el contrato que faltaba:
`license_periods`, `ensure_current_license_period` y
`ai_agent_usage.period_id` existen antes de la primera migración que los usa.

El modelo vigente es C, híbrido de compatibilidad: para los registros nuevos
rige el límite por periodo, contado por `license_id + period_id`, con
`reserved` y `completed`; los registros `failed` no consumen el límite. Los
usos nuevos reciben el periodo vigente durante la reserva. `period_type` conserva los valores observados
`trial`, `basic_paid`, `pro_paid` y `admin_grant`; FREE lifetime permanece como
`trial`, activo, sin `ends_at` y con límite IA cero.

La migración `20260621000000_oss_bootstrap_license_period_schema.sql` es una
`OSS bootstrap compatibility migration`. No se encontró una migración
histórica exacta que restaurar. Los usos históricos con una única coincidencia
temporal se rellenan; los ambiguos o sin coincidencia conservan `period_id`
nullable y quedan marcados en `metadata`. La FK compuesta evita asociar un uso
con un periodo de otra licencia.

Resultado OSS.1.5.4: `SCHEMA RECONCILED WITH NOTES`. El contrato, orden,
seguridad y pruebas focalizadas quedaron versionados, pero no se ejecutó
PostgreSQL runtime ni la cadena completa de migraciones.

## Procedimiento local seguro

Cuando exista un entorno aislado autorizado, el procedimiento es:

```powershell
supabase --version
docker info
supabase start
supabase status
supabase db reset --local
supabase stop
```

Este procedimiento no fue ejecutado en OSS.1.5.3. No se debe usar `supabase
link`, `supabase db push`, `supabase migration repair --linked`,
`supabase functions deploy`, un proyecto remoto ni un proveedor real.

**SELF-HOSTING BLOCKED.** La configuración, el esquema de periodos y la
función están versionados, pero el runtime PostgreSQL, la base vacía, E2E y
backup/restore siguen pendientes. OSS.1.5 no debe marcarse `VERIFIED` todavía.
