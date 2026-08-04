# Evidencia de validación de autohospedaje

Fecha: 2026-08-04 (America/Mexico_City)

Commit probado: `0decbc4124fed4e8cda4e807a9a400f7257e3084`.

Rama de trabajo: `chore/oss-self-hosting-reproducibility`.

## Entorno

| Elemento | Resultado |
| --- | --- |
| Sistema operativo | Windows 10/11, x64; el navegador reportó Windows 10/11 |
| Git | disponible; worktree temporal limpio |
| Node | `v24.18.1` |
| npm | `11.16.0` |
| Supabase CLI | `2.51.0` |
| Docker CLI | `28.3.2` |
| Docker daemon | `docker info` excedió 20 s; no disponible para la prueba |
| Navegador | Chrome 150 reportado por el navegador aislado |
| Perfil del navegador | pestaña aislada del navegador de validación; no se usó perfil personal |

No se copiaron `node_modules`, `dist`, `store/dist`, `.vercel`, `.supabase` ni
archivos `.env` al worktree temporal.

## Comandos y resultados

| Comando | Resultado | Tiempo aproximado |
| --- | --- | ---: |
| `npm ci` | PASS, código 0; 703 paquetes añadidos | 330.1 s |
| `npm ls --all` | PASS, código 0; opcionales de plataforma omitidos | 14.6 s |
| `npm run build` | PASS; `dist`, 83 archivos | 184.9 s |
| `npm run build:store` | PASS; `dist-store`, 10 archivos | 48.5 s |
| `npm run build:store:vercel` | PASS; staging `store/dist`, 11 archivos | 58.3 s |
| `npm run test:ci -- --reporter=dot` | TIMEOUT a los 600 s, sin resumen; no verificado | 600 s |
| `npx vitest run store/tests/social-preview src/pwa src/services/backup src/config --reporter=dot` | TIMEOUT a los 300 s, sin resumen; no verificado | 300 s |
| `docker info` | TIMEOUT a los 20 s | 20 s |
| `supabase start` | NO EJECUTADO: Docker no disponible y falta `supabase/config.toml` | — |
| `supabase db reset` | NO EJECUTADO por la misma compuerta de seguridad | — |
| `supabase link` / `supabase db push` | NO EJECUTADO; prohibido en esta validación | — |
| `vercel link` / `vercel deploy` / `vercel --prod` | NO EJECUTADO; prohibido en esta validación | — |

Advertencias relevantes de `npm ci`: `react-zxing@2.1.0` declara Node 18/20/22,
se omitieron scripts opcionales de `esbuild`, `protobufjs` y `sharp`, y npm
reportó vulnerabilidades existentes. No se ejecutó ningún comando de reparación
ni se cambió el lockfile.

## Inventario estático

- 215 migraciones SQL; nombres con timestamp válidos y sin timestamps duplicados.
- 34 pruebas SQL.
- 23 archivos de migración contienen `CREATE TABLE`; 41 contienen índices;
  172 reemplazan funciones SQL; 23 habilitan RLS.
- Hay referencias a Storage, `supabase_realtime`, `realtime.send` y extensiones
  de Postgres.
- `supabase/config.toml` está ausente.
- Sólo está versionada la función
  `supabase/functions/authorize-image-upload/index.ts`.
- El cliente invoca `authorize-image-upload` y `lanzo-ai-agent`; la segunda no
  existe en el árbol.
- `20260715190958_ecom_products_model_1.sql` obtiene SQL externo con la
  extensión `http` y falla explícitamente si la respuesta o el hash no
  coinciden. No se ejecutó para no confundir análisis estático con un resultado
  de base vacía.

## Variables

Las referencias públicas verificadas están en `.env.example`. La función de
Storage requiere `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, documentadas con
marcadores no funcionales en `supabase/functions/.env.example`. No se imprimió
ningún secreto, token, project ref ni valor de producción.

## Smoke local

Vite respondió HTTP 200 en el puerto local. El navegador aislado cargó el shell
PWA y posteriormente mostró la pantalla de recuperación con el error:
“Faltan las variables de entorno de Supabase”. Se observaron errores de consola
correspondientes al `ErrorBoundary`. Esto demuestra el guard de configuración,
no la operación local. No se declararon PASS para IndexedDB, creación de
negocio/producto/venta, reinicio, offline o Service Worker recuperado.

No se creó ni se usó una cuenta, usuario, pedido, bucket, dominio, clave o
proyecto real.

## Artefactos y limpieza

Los builds se generaron sólo en el worktree temporal. Después de cada build el
estado Git fue limpio y `package-lock.json` no cambió. No se rastrearon
`node_modules`, `dist`, `dist-store`, `store/dist`, `.vercel`, `.supabase`,
logs, capturas, dumps ni archivos `.env` reales.

## Niveles alcanzados

| Nivel | Estado | Evidencia |
| --- | --- | --- |
| 0 | VERIFIED WITH NOTES | instalación y tres rutas de build |
| 1 | BLOCKED | guard de Supabase; no flujo local funcional demostrado |
| 2 | BLOCKED | Docker daemon ausente y `config.toml` faltante |
| 3 | NOT VERIFIED | no hubo backend aislado ni flujo E2E |
| 4 | NOT VERIFIED | no se ejecutó respaldo/restauración/actualización |

## Conclusión

**SELF-HOSTING BLOCKED.** La evidencia permite repetir el frontend y el
empaquetado de tienda, pero no permite instalar y operar de forma reproducible
el sistema completo. OSS.1.4 sigue `NO-GO`; OSS.2 permanece bloqueado.
