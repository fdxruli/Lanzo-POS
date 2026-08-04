# Autohospedaje de Lanzo-POS

## Estado

Estado global de OSS.1.5: `BLOCKED`.

Estado de OSS.1.5.1: `PASS WITH NOTES` por la integración de PR #173; la
configuración local existe y es reconocida por Supabase CLI, pero el daemon de
Docker no respondió en la validación del 2026-08-04.

Estado de OSS.1.5.2: `PASS WITH NOTES`. La migración del modelo de productos
ya no descarga SQL, no depende de GitHub ni requiere la extensión PostgreSQL
`http`; el SQL funcional está versionado localmente y fue comprobado por hash
y comparación exacta.

Esta tarea no valida una base vacía ni los flujos end-to-end, no añade
`lanzo-ai-agent`, no resuelve OSS.1.4 y no activa AGPL.

## Configuración local

La configuración versionada está en `supabase/config.toml` y usa el
identificador local `lanzo-pos-local`. Fue generada a partir de una referencia
creada con Supabase CLI `2.51.0` y reducida a valores locales seguros.

| Componente | Configuración local | Estado en esta validación |
| --- | --- | --- |
| API | `http://127.0.0.1:54321` | BLOCKED: Docker |
| PostgreSQL | `127.0.0.1:54322` | BLOCKED: Docker |
| Shadow database | `127.0.0.1:54320` | NOT VERIFIED |
| Studio | `http://127.0.0.1:54323` | BLOCKED: Docker |
| Inbucket | `http://127.0.0.1:54324` | BLOCKED: Docker |
| Auth | habilitado dentro del API local | BLOCKED: Docker |
| Storage | habilitado, límite `50MiB` | BLOCKED: Docker |
| Realtime | habilitado | BLOCKED: Docker |
| Edge Runtime | habilitado, inspector `8083` | BLOCKED: Docker |
| Analytics | deshabilitado | NOT REQUIRED |

La URL de Auth es `http://127.0.0.1:4173` y el origen adicional permitido es
`http://127.0.0.1:4174`. No se habilitaron proveedores OAuth, SMTP, SMS,
CAPTCHA, S3, IA, pagos ni webhooks externos.

No se añadió `seed.sql`: `db.seed.enabled = false` y `sql_paths = []` porque
este repositorio no contiene un seed sintético autorizado para esta tarea.

## Requisitos

- Supabase CLI compatible con el formato de `supabase/config.toml`.
- Docker Desktop operativo y daemon Linux accesible mediante `docker info`.
- Un clon o worktree limpio para cualquier prueba de runtime.
- Copiar `.env.example` sólo si se necesita configurar el frontend local;
  nunca copiar `.env` ni credenciales reales.

La validación de esta tarea encontró Windows 10 Home Single Language x64,
Supabase CLI `2.51.0` y Docker CLI `28.3.2`. El daemon no estuvo disponible.

## Procedimiento local seguro

Los comandos de CLI y Docker siguientes forman el procedimiento reproducible.
`supabase --version`, el parseo TOML y la inspección estática fueron
verificados. `docker info`, `supabase start` y el resto del runtime quedaron
bloqueados o sin ejecutar por la indisponibilidad del daemon; se indica en la
matriz y en `docs/SELF-HOSTING-VALIDATION.md`.

```powershell
git clone <repositorio> Lanzo-POS
cd Lanzo-POS
supabase --version
docker info
supabase start
supabase status
supabase db reset --local
supabase stop
```

Antes de iniciar, confirmar que el entorno aislado no contiene `.supabase`,
`.env`, `.env.local`, `.vercel`, credenciales, contenedores ni volúmenes de
otra prueba. No versionar `.supabase`.

Para detener una prueba que sí haya iniciado, ejecutar `supabase stop` desde
el mismo worktree. No usar comandos destructivos globales de Docker y no
eliminar contenedores o volúmenes ajenos al proyecto.

## Variables de entorno

`.env.example` ya está alineado con esta configuración:

- `VITE_SUPABASE_URL=http://127.0.0.1:54321`
- `VITE_SUPABASE_PUBLISHABLE_KEY=not-a-real-local-publishable-key`
- `VITE_ADMIN_APP_ORIGIN=http://127.0.0.1:4173`
- `VITE_PUBLIC_STORE_ORIGIN=http://127.0.0.1:4174`
- `PUBLIC_STORE_ORIGINS=http://127.0.0.1:4174`

No se modificó `.env.example` y no se deben copiar claves generadas por
`supabase start` a documentación o control de versiones. La Edge Function
`authorize-image-upload` usa los marcadores sintéticos de
`supabase/functions/.env.example`; `SUPABASE_SERVICE_ROLE_KEY` nunca debe
entrar al frontend.

## Migraciones y alcance de la prueba

El repositorio contiene 215 migraciones SQL, 34 pruebas SQL y una Edge Function
versionada: `authorize-image-upload`.

La migración `supabase/migrations/20260715190958_ecom_products_model_1.sql`
es ahora hermética: contiene localmente el SQL funcional de
`20260715190000_ecom_products_model_1.sql`, recuperado del commit fijado y
verificado con SHA-256 y comparación funcional. No crea la extensión `http`, no
usa `extensions.http_get` ni ejecuta SQL dinámico descargado.

Cuando Docker esté disponible, `supabase db reset --local` debe ejecutarse sin
`--linked`, sin `--db-url` externo y sin reparar migraciones. Esa ejecución
integral sobre una base vacía continúa pendiente; no se declara como realizada
por OSS.1.5.2.

La función `lanzo-ai-agent` es invocada por el cliente pero no está versionada;
su incorporación queda fuera de esta tarea. Auth, RLS, RPC, Storage,
Realtime, Edge Runtime, backup, restore y E2E tampoco quedan certificados por
la creación de esta configuración.

## Prohibiciones de seguridad

Durante la validación local no ejecutar `supabase link`, `supabase db push`,
`supabase migration repair --linked`, `supabase functions deploy`,
`supabase projects create`, `vercel deploy` ni `vercel --prod`. No iniciar
sesión en servicios externos ni usar proyectos, dominios, datos, claves o
secretos oficiales.

## Referencias de validación

- Resultado detallado y evidencia redactada:
  `docs/SELF-HOSTING-VALIDATION.md`.
- Matriz de componentes:
  `docs/SELF-HOSTING-MATRIX.md`.
- Estado global y handoff:
  `docs/SELF-HOSTING-STATUS.md`.
- Secuencia del roadmap:
  `docs/OSS-ROADMAP.md`.

**SELF-HOSTING BLOCKED.** La configuración local y esta migración ya están
preparadas para autohospedaje, pero el daemon de Docker, la ejecución integral
de migraciones, `lanzo-ai-agent`, E2E y backup/restore siguen pendientes.
