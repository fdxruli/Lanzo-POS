# Actor context contract — investigación 3.2A.2

**RESEARCH ONLY. No contrato de producto aprobado.** Base D: `1cdc1cd029982e0279177ab29be1f8fffacb6ed8`.
No importar estos módulos desde `src`, ni publicar una Preview. Datos, actores, sesiones y efectos son sintéticos.

## Componentes

- `prototype.mjs`: modelo Runtime explícitamente sintético, autoridad IndexedDB, contexto individual, revocación dirigida y efecto sintético dentro de una misma transacción. No autentica usuarios ni implementa 168h, permisos Staff, RPC ni recuperación comercial.
- `prototype.test.mjs`: intercalaciones y propiedades con fake-indexeddb; también contraejemplos identificados como tales.
- `runtime-boundary.test.mjs`: controller/storage/runWithActorHandle reales con callback de contador; muestra que retirar un handle de storage no certifica por sí solo la frontera Runtime. No es una venta.
- `browser.mjs`: Chromium real, dos o tres documentos del mismo origen y perfil, IDB/Web Storage/BC reales, freeze/thaw por CDP, sin negocio ni Supabase.
- `evidence/`: resultados íntegros de esta ejecución. Los FAIL de seguridad se conservan; no equivalen a un runner roto.

## Reproducir

Node 24 y `npm ci` en el repositorio. No cambiar dependencias del producto.

```sh
npx vitest run scripts/qa/actor-context-contract/*.test.mjs --maxWorkers=1
```

Para Chromium usar Playwright y un ejecutable instalados **fuera del repositorio**. El runner acepta `ACTOR_QA_PLAYWRIGHT_MODULE` (ruta absoluta a `playwright/index.mjs`) y `ACTOR_QA_CHROMIUM_EXECUTABLE` (ruta al navegador). También detecta el Playwright del runtime Codex si existe. Ejemplo PowerShell:

```powershell
$env:ACTOR_QA_PLAYWRIGHT_MODULE = 'C:\tooling\node_modules\playwright\index.mjs'
$env:ACTOR_QA_CHROMIUM_EXECUTABLE = 'C:\ruta\a\chrome.exe'
node scripts/qa/actor-context-contract/browser.mjs > architecture-browser.json
```

TLS opcional: `ACTOR_QA_TLS_KEY` y `ACTOR_QA_TLS_CERT`, rutas a un certificado exclusivamente de prueba. La fixture acepta ese certificado con ignoreHTTPSErrors; no valida una cadena pública. Nunca guardar claves en Git. Sin TLS el caso HTTPS queda PENDING. Si no puede enumerar interfaces, HTTP IP usa interceptación local y lo registra; no representa transporte LAN real.

Las observaciones de main/main y versiones mezcladas conservan `status=FAIL` porque incumplen la propiedad de seguridad. Exit 0 del runner significa que reprodujo los contraejemplos conocidos y no fallaron las propiedades esperadas del modelo; **no certifica arquitectura legacy**. Exit 1 indica un resultado inesperado, incluso si dejó de reproducirse un contraejemplo; exit 2 indica error de harness. La reproducción anterior `scripts/qa/actor-late-context-browser.mjs` sigue saliendo 1 por LC13.

Las aserciones Vitest de contraejemplo comprueban el estado inseguro observado. Su PASS significa detección, no aceptación de la propiedad refutada. Consultar el informe para distinguirlos de los tests positivos.

## Alcance de los trazados

`initial`, estados intermedios por caso, `finalBeforeWriteProbe`, `writes` y `final` contienen autoridad durable, registros por contexto, estado de handles, modelo Runtime o `NOT_LOADED_storage_only`, y resultados reales de la frontera de escritura. Un probe final de v2 crea una operación/efecto **sintéticos** con clave idempotente. Ninguna observación ejecuta caja, abono, venta POS, SQL o RPC.

Recarga no equivale a descarte de proceso; CDP freeze no equivale a suspensión Windows; una página headless no equivale a PWA instalada. No interpretar silencio de BC como cierre ni realizar borrado de datos para recuperar autoridad.
