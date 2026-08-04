# Evidencia de validación de autohospedaje

Fecha: 2026-08-04 (America/Mexico_City)

Commit base validado: `b1dd23d6b3a435f3f19b6c43b47a760e99bbdcc7`.

Rama: `chore/oss-supabase-local-foundation`.

PR #172: `MERGED`, `merged_at=2026-08-04T15:33:14Z`, merge commit
`b1dd23d6b3a435f3f19b6c43b47a760e99bbdcc7`, ancestro confirmado de
`origin/main`.

Decisión de OSS.1.5.1: `BLOCKED`.

## Entorno

| Elemento | Resultado |
| --- | --- |
| Sistema operativo | Microsoft Windows 10 Home Single Language 10.0.19045 |
| Arquitectura | X64 / AMD64 |
| Git | disponible |
| Worktree de Git | limpio antes de editar; rama dedicada desde `origin/main` |
| Supabase CLI | `2.51.0` |
| Docker CLI | `28.3.2`, contexto `desktop-linux` |
| Docker daemon | `BLOCKED`: `docker info` no pudo abrir `dockerDesktopLinuxEngine` |
| Entorno de runtime aislado | no iniciado: la compuerta Docker falló antes de `supabase start` |
| Configuración local | `supabase/config.toml`, project ID `lanzo-pos-local` |

El workspace compartido contiene estado local previo (`.env`, `.vercel`,
`node_modules` y artefactos de build), por lo que no se usó para iniciar
contenedores ni aplicar migraciones. La validación de runtime quedó detenida
antes de crear estado `.supabase`, contenedores o volúmenes.

## Precondiciones Git

| Comprobación | Resultado |
| --- | --- |
| `git fetch origin --prune` | PASS |
| Estado de PR #172 consultado en GitHub | PASS: merged |
| Merge commit de PR #172 | `b1dd23d6b3a435f3f19b6c43b47a760e99bbdcc7` |
| `git merge-base --is-ancestor <merge> origin/main` | PASS |
| `git status --short` antes de editar | vacío |
| Base exacta | `HEAD = origin/main = b1dd23d6b3a435f3f19b6c43b47a760e99bbdcc7` |
| Rama creada | `chore/oss-supabase-local-foundation` |

## Configuración estática

| Comprobación | Resultado |
| --- | --- |
| `supabase --version` | PASS: `2.51.0` |
| `supabase init --workdir <temporal> --yes` | PASS; referencia generada y luego eliminada |
| Parseo TOML con `tomllib` | PASS |
| `supabase status` reconoce el project ID | PARTIAL: llegó a inspección del contenedor `supabase_db_lanzo-pos-local` y falló al conectar con Docker |
| Rutas absolutas | PASS: no encontradas |
| Project refs o enlaces remotos | PASS: no encontrados |
| URLs productivas | PASS: no encontradas |
| secretos, tokens o passwords | PASS: no encontrados |
| migraciones referenciadas | PASS: `supabase/migrations` existe |
| seeds referenciados | PASS: no se referencia ningún archivo; seeds desactivados |

La referencia temporal de la CLI generó también ajustes de VS Code fuera del
repositorio; no se copiaron. Sólo se incorporó la estructura necesaria en
`supabase/config.toml`.

## Comandos de runtime

| Comando | Resultado | Evidencia |
| --- | --- | --- |
| `docker --version` | PASS | Docker CLI `28.3.2` |
| `docker info` | BLOCKED | no existe el pipe `dockerDesktopLinuxEngine` |
| `supabase start` | NO EJECUTADO | la tarea exige Docker accesible antes de iniciar |
| `supabase status` | BLOCKED | no pudo inspeccionar contenedores por el daemon ausente |
| `supabase db reset` | NO EJECUTADO | no hay stack local; no se usó URL externa |
| `supabase stop` | NO EJECUTADO | no se inició ningún stack de esta prueba |
| `supabase link` / `supabase db push` | NO EJECUTADO | prohibidos por alcance |
| `supabase functions deploy` | NO EJECUTADO | prohibido por alcance |
| `vercel deploy` / `vercel --prod` | NO EJECUTADO | prohibidos por alcance |

No se imprimieron claves locales, tokens, passwords, project refs oficiales ni
valores completos de `.env`.

## Inventario del repositorio

- 215 migraciones SQL, ordenadas por timestamp.
- 34 pruebas SQL.
- Una Edge Function versionada:
  `supabase/functions/authorize-image-upload/index.ts`.
- `lanzo-ai-agent` no está versionada y no fue añadida.
- La migración `20260715190958_ecom_products_model_1.sql` descarga SQL externo
  mediante `extensions.http_get`, valida un hash y debe ser el primer handoff
  de OSS.1.5.2.

No se ejecutaron migraciones; por tanto no hay primera migración aplicada,
última migración aplicada ni primera migración fallida. El error externo queda
confirmado por inspección estática, no por un `db reset` local.

## Servicios y clasificación

| Servicio | Configurado | Verificación de endpoint |
| --- | --- | --- |
| PostgreSQL | sí, puerto `54322` | BLOCKED |
| API | sí, puerto `54321` | BLOCKED |
| Auth | sí | BLOCKED |
| Storage | sí | BLOCKED |
| Realtime | sí | BLOCKED |
| Studio | sí, puerto `54323` | BLOCKED |
| Inbucket | sí, puerto `54324` | BLOCKED |
| Edge Runtime | sí, inspector `8083` | BLOCKED |
| Analytics | no, intencionalmente desactivado | NOT REQUIRED |

## Resultado y limitaciones

`supabase/config.toml` elimina el bloqueo de reconocimiento/configuración y
queda listo para una prueba aislada cuando Docker esté disponible. OSS.1.5.1
no puede pasar a `PASS WITH NOTES` porque no se ejecutaron `start`, `status` y
`db reset`.

El estado global OSS.1.5 permanece `BLOCKED`. OSS.2 permanece `BLOCKED`, OSS.1.4
no cambia y AGPL no fue activada. No se modificaron migraciones, funciones,
código productivo, dependencias, manifiestos, lockfiles ni `.env.example`.
