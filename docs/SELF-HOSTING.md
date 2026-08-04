# Autohospedaje de Lanzo-POS

## Estado

Estado global de OSS.1.5: `BLOCKED`.

Estado de OSS.1.5.1: `BLOCKED` por disponibilidad de infraestructura local.
La configuración local ya existe y es reconocida por Supabase CLI, pero el
daemon de Docker no respondió en la validación del 2026-08-04. Por ello no se
declara iniciado ni validado ningún servicio de Supabase.

Esta tarea resuelve únicamente la ausencia de `supabase/config.toml`. No
corrige la migración que descarga SQL externo, no añade `lanzo-ai-agent`, no
valida flujos end-to-end, no resuelve OSS.1.4 y no activa AGPL.

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

La primera migración que debe investigarse después de obtener Docker operativo
es `supabase/migrations/20260715190958_ecom_products_model_1.sql`. Crea
temporalmente la extensión `http` y descarga desde GitHub la migración
`20260715190000_ecom_products_model_1.sql`, comprobando después un SHA-256.
Ese comportamiento no es hermético y queda fuera de OSS.1.5.1.

Cuando Docker esté disponible, `supabase db reset --local` debe ejecutarse sin
`--linked`, sin `--db-url` externo y sin reparar migraciones. Si alcanza esa
migración y falla únicamente por la descarga o su hash, registrar `PASS WITH
NOTES` para OSS.1.5.1 y abrir OSS.1.5.2. No descargar el SQL manualmente, no
saltar la migración y no editarla en esta rama.

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

**SELF-HOSTING BLOCKED.** Esta configuración elimina el primer bloqueo de
configuración, pero el daemon de Docker y la migración externa siguen
impidiendo declarar Lanzo-POS autohospedable.
