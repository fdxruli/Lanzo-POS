# Matriz de autohospedaje

Estados usados: `VERIFIED`, `VERIFIED WITH NOTES`, `PARTIAL`, `NOT VERIFIED`,
`BLOCKED`, `NOT REQUIRED`, `OPTIONAL`.

| Componente | Requerido por | Configuración | Variable | Dependencia externa | Validación | Estado | Bloqueo | Alternativa | Evidencia |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PWA administrativa | Lanzo Local | Vite + `src/pwa` | build metadata | navegador | build, manifest y SW generados | VERIFIED WITH NOTES | smoke funcional no completado | servir `dist` con un host estático | build admin |
| IndexedDB | Lanzo Local | Dexie/local DB | ninguna | navegador | código y shell inspeccionados | PARTIAL | app exige configuración cloud al arrancar | validar con backend aislado | `src/services/db` |
| Supabase PostgreSQL | Lanzo Nube/ecommerce | 215 migraciones | URL pública | Supabase/Postgres | no se inició instancia | BLOCKED | falta `supabase/config.toml`; Docker no disponible | configurar Supabase local completo | validación |
| Auth | nube/admin | Supabase Auth | URL + publishable key | Supabase Auth | no ejecutado | NOT VERIFIED | backend no iniciado | Auth local de Supabase | migraciones/client |
| RLS | nube/ecommerce | políticas SQL | ninguna adicional | Postgres | inspección estática | NOT VERIFIED | no hubo base vacía | probar SQL en proyecto aislado | 23 archivos habilitan RLS |
| RPC | admin/POS/ecommerce | funciones SQL | ninguna adicional | Postgres | nombres inspeccionados | NOT VERIFIED | no hubo ejecución | pruebas SQL en Postgres local | migraciones |
| Realtime | admin/sincronización | publicaciones y canales | `VITE_ENABLE_LICENSE_REALTIME` | Supabase Realtime | no ejecutado | NOT VERIFIED | backend no iniciado | desactivar realtime cuando sea opcional | migraciones/client |
| Storage | imágenes | bucket `images` + function | secretos de function | Supabase Storage | fuente inspeccionada | PARTIAL | bucket/RLS/function no ejecutados | fixture Storage local | Edge Function |
| Edge Functions | imágenes/IA | `supabase/functions` | function env | Supabase Edge Runtime | una fuente presente | PARTIAL | `lanzo-ai-agent` falta | retirar IA o versionar función | `authorize-image-upload` |
| IA | asistente | `lanzo-ai-agent` | `AI_API_KEY`/`OPENAI_API_KEY` referidas | proveedor IA | invocación cliente, fuente ausente | BLOCKED | función no versionada | integración comunitaria posterior | `src/services/aiService.js` |
| Google Drive | respaldo opcional | OAuth en cliente | `VITE_GOOGLE_CLIENT_ID` | Google Drive | código/test estático | OPTIONAL | no se usó cuenta real | respaldo local/manual | `googleDriveService.js` |
| Tienda pública | ecommerce | build `store/` | Supabase + origins | host Node/serverless | build PASS | VERIFIED WITH NOTES | runtime con slug no ejecutado | host Node compatible | `build:store` |
| Checkout | ecommerce | RPC/cliente | Supabase pública | Postgres/RLS | no ejecutado | NOT VERIFIED | falta backend aislado | fixture E2E comunitario | servicios ecommerce |
| Seguimiento | ecommerce | RPC tracking | Supabase pública | Postgres/RLS | no ejecutado | NOT VERIFIED | falta backend aislado | fixture E2E comunitario | servicios/migraciones |
| Imágenes | tienda/admin | Storage + `sharp` | function env | Storage, sharp | staging sin secretos | VERIFIED WITH NOTES | upload/lectura no ejecutados | almacenamiento local compatible | build Vercel staging |
| Open Graph | tienda pública | `/api/og/store` + `@vercel/og` | Supabase pública | runtime Node/Vercel | empaquetado PASS | VERIFIED WITH NOTES | render real no ejecutado | runtime Node con equivalente | rutas serverless |
| Vercel | despliegue público | `vercel.json` + staging | ninguna obligatoria local | Vercel sólo para despliegue | script no llama CLI | VERIFIED WITH NOTES | despliegue remoto no probado | host Node compatible con adaptación | `build:store:vercel` |
| Dominios/orígenes | tienda y enlaces | allowlist | `VITE_*_ORIGIN`, `PUBLIC_STORE_ORIGINS` | DNS/HTTPS | sólo sintético | NOT VERIFIED | no se usaron dominios reales | origins locales | config pública |
| Service Worker | PWA admin | `injectManifest` | build commit | navegador seguro | generado en `dist` | VERIFIED WITH NOTES | actualización/rollback no probado | servir HTTPS local | build admin |
| Respaldo local | Lanzo Local | export/import IndexedDB | opcional Drive | navegador/Drive opcional | código presente | PARTIAL | respaldo/recovery no ejecutados | exportación manual local | `src/services/backup` |
| Respaldo PostgreSQL/Storage | nube | procedimiento de plataforma | secretos de plataforma | Postgres/Storage | no ejecutado | NOT VERIFIED | no hay instancia aislada | backup nativo del proveedor | Nivel 4 |
| Restauración | operación | instancia nueva | configuración/secrets | Postgres/Auth/Storage | no ejecutado | NOT VERIFIED | no hay backup ni instancia | restaurar en staging | Nivel 4 |
| Actualización | operación | migraciones + builds | configuración | plataforma elegida | npm/build reproducidos | PARTIAL | rollback y migraciones no probados | probar dos tags en staging | guía |
