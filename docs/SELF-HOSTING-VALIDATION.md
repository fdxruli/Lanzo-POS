# Evidencia de validación de autohospedaje

Fecha: 2026-08-04 (America/Mexico_City)

Commit base validado: `5b40515131c7aab805a10f392595923cedc708b1`.

Rama: `fix/oss-hermetic-ecommerce-migration`.

PR #173: `MERGED`, `merged_at=2026-08-04T16:15:01Z`, merge commit
`5b40515131c7aab805a10f392595923cedc708b1`, ancestro confirmado de
`origin/main`. Su SHA final integrado fue `938fba91e2e6413629f286d7a41496486c14028a`.

Decisión de OSS.1.5.1: `PASS WITH NOTES`.
Decisión de OSS.1.5.2: `PASS WITH NOTES`.

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
| Estado de PR #173 consultado en GitHub | PASS: merged |
| Merge commit de PR #173 | `5b40515131c7aab805a10f392595923cedc708b1` |
| SHA final integrado de PR #173 | `938fba91e2e6413629f286d7a41496486c14028a` |
| `git merge-base --is-ancestor <merge> origin/main` | PASS |
| `git status --short` antes de editar | vacío |
| Base exacta | `HEAD = origin/main = 5b40515131c7aab805a10f392595923cedc708b1` |
| Rama creada | `fix/oss-hermetic-ecommerce-migration` |

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

## Validación OSS.1.5.2

| Comprobación | Resultado |
| --- | --- |
| Commit fuente | `ba92582c45f88582e01294137b65411efe80b642` |
| Ruta fuente | `supabase/migrations/20260715190000_ecom_products_model_1.sql` |
| Blob SHA fuente | `79d0a049efd63c00fa9ebcf7799e2576d2823f43` |
| SHA-256 esperado | `1d434996aa3dd79c7e98a2857f475fa4a6c760aed081df877cb238d161205091` |
| SHA-256 obtenido | `1d434996aa3dd79c7e98a2857f475fa4a6c760aed081df877cb238d161205091` |
| Coincidencia de hash | `PASS` |
| Coincidencia funcional | `PASS`: 1,310 líneas fuente y 1,310 líneas embebidas |
| Búsqueda en la migración objetivo | `PASS`: sin `http_get`, URL de GitHub, `http_response`, SQL dinámico ni extensión `http` |
| Búsqueda en todas las migraciones | 11 URLs legítimas de WhatsApp/configuración; ninguna descarga o ejecución remota |
| SQL dinámico descargado | `PASS`: eliminado |
| Base vacía PostgreSQL | `NOT VERIFIED`: no se utilizó Docker ni se ejecutó `db reset` |

La parte funcional embebida se comparó byte a byte contra el blob extraído del
commit fijado, excluyendo únicamente el encabezado de procedencia añadido.

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
- La migración `20260715190958_ecom_products_model_1.sql` es hermética y contiene
  localmente el SQL canónico; la equivalencia fue verificada por SHA-256 y
  comparación funcional.

No se ejecutaron migraciones; por tanto no hay primera migración aplicada,
última migración aplicada ni primera migración fallida. La hermeticidad y la
equivalencia funcional quedan confirmadas por inspección estática, no por un
`db reset` local.

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

`supabase/config.toml` elimina el bloqueo de reconocimiento/configuración y la
migración de productos ya no depende de red. OSS.1.5.1 y OSS.1.5.2 quedan en
`PASS WITH NOTES` porque no se ejecutaron `start`, `status` y `db reset` sobre
una base vacía.

El estado global OSS.1.5 permanece `BLOCKED`. OSS.2 permanece `BLOCKED`, OSS.1.4
no cambia y AGPL no fue activada. `lanzo-ai-agent`, E2E, backup/restore y la
ejecución integral de migraciones siguen pendientes. No se modificaron otras
migraciones, funciones, código productivo, dependencias, manifiestos,
lockfiles ni `.env.example`.
