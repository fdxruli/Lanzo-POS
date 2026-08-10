# Autohospedaje de Lanzo-POS

## Estado

Estado global de OSS.1.5: `BLOCKED`.

Estado de OSS.1.5.1: `PASS WITH NOTES`. La configuración local está
versionada en `supabase/config.toml`, pero el runtime local no fue ejecutado
porque Docker no forma parte del entorno utilizado para esta validación.

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
| API | `http://127.0.0.1:54321` | NOT VERIFIED |
| PostgreSQL | `127.0.0.1:54322` | NOT VERIFIED |
| Shadow database | `127.0.0.1:54320` | NOT VERIFIED |
| Studio | `http://127.0.0.1:54323` | NOT VERIFIED |
| Auth | habilitado dentro del API local | NOT VERIFIED |
| Storage | habilitado, límite `50MiB` | NOT VERIFIED |
| Realtime | habilitado | NOT VERIFIED |
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
usos nuevos reciben el periodo vigente durante la reserva. `period_type`
conserva los valores observados `trial`, `basic_paid`, `pro_paid` y
`admin_grant`; FREE lifetime permanece como `trial`, activo, sin `ends_at` y
con límite IA cero.

La migración `20260621000000_oss_bootstrap_license_period_schema.sql` es una
`OSS bootstrap compatibility migration`. No se encontró una migración
histórica exacta que restaurar. Los usos históricos con una única coincidencia
temporal se rellenan; los ambiguos o sin coincidencia conservan `period_id`
nullable y quedan marcados en `metadata`. La FK compuesta evita asociar un uso
con un periodo de otra licencia.

Resultado OSS.1.5.4: `SCHEMA RECONCILED WITH NOTES`. El contrato, orden,
seguridad y pruebas focalizadas quedaron versionados, pero no se ejecutó
PostgreSQL runtime ni la cadena completa de migraciones.

## Compatibilidad e idempotencia de OSS.1.5.4

**Instalaciones nuevas:** el orden quedó corregido estáticamente y la migración
bootstrap aparece antes de la primera dependencia del 24 de junio. La cadena
completa todavía no fue ejecutada sobre una base vacía.

**Instalaciones existentes:** compatibilidad diseñada y validada
estáticamente; aplicación real no verificada. No se consultó producción, no se
aplicó la migración sobre una base existente y no se ejecutó ningún backfill
real.

La revisión estática confirma que la migración es repetible frente al contrato
esperado:

- usa `CREATE TABLE IF NOT EXISTS` y `ADD COLUMN IF NOT EXISTS`;
- comprueba la existencia de constraints antes de crearlas;
- crea índices con `IF NOT EXISTS`;
- modifica únicamente usos con `period_id IS NULL` durante el backfill;
- vuelve a escribir la misma clave `period_reconciliation` de forma
  determinista, sin duplicar hechos de uso;
- recrea políticas mediante `DROP POLICY IF EXISTS` + `CREATE POLICY`;
- define helpers y RPC mediante `CREATE OR REPLACE FUNCTION`;
- no elimina periodos, usos, tokens, estados ni conteos históricos.

Esta revisión no garantiza que una instalación existente esté libre de datos
incompatibles. Duplicados de periodos activos, valores fuera de los constraints
o relaciones históricas inválidas deben detectarse durante OSS.1.5.5 antes de
aplicar cambios. No se afirma que el backfill haya pasado en producción.

La prueba `supabase/tests/ai_agent_period_schema_test.sql` fue **añadida pero
no ejecutada**. Requiere PostgreSQL/`psql` aislado y su resultado continúa como
`NOT VERIFIED`, no como `PASS`.

## Procedimiento de validación futura

En un entorno aislado que ya disponga de PostgreSQL o de la infraestructura
necesaria, debe ejecutarse una validación equivalente de migraciones, RPC,
Edge Runtime y restauración. Docker es una alternativa técnica de Supabase CLI,
no un requisito del flujo cotidiano del proyecto ni de la computadora del
usuario.

No se debe usar `supabase link`, `supabase db push`,
`supabase migration repair --linked`, `supabase functions deploy`, un proyecto
remoto ni un proveedor real durante una validación aislada no autorizada.

**SELF-HOSTING BLOCKED.** La configuración, el esquema de periodos y la
función están versionados, pero el runtime PostgreSQL, la base vacía, E2E y
backup/restore siguen pendientes. OSS.1.5 no debe marcarse `VERIFIED` todavía.

### Addendum: OSS bootstrap overlay

The period-schema compatibility SQL now lives outside the production migration
ledger at `supabase/bootstrap/oss_bootstrap_license_period_schema.sql`. For an
isolated OSS replay, use `npm run oss:db:reset-local`; it creates a disposable
local overlay, inserts the bootstrap at its historical ordering point, and
invokes only `supabase db reset --local`. The runner rejects remote/link/project
arguments and must never be used against production.
