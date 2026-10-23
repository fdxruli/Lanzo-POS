# LANZO POS — F02 R2 — EVIDENCE

Fecha: 22 de octubre de 2026, America/Mexico_City. Estado local: **ADMISSIBLE_FOR_DRAFT**; CI/Preview pendientes de observación remota. QA físico PENDING; merge NOT PERFORMED.

## Fuentes y checkpoints

| Etapa | Commit local | Commit remoto / árbol |
| --- | --- | --- |
| Main | 9ca65fc07804f40c2add5e59bee0e6edca940b8f | mismo SHA, tree 46f8f162261a74b576e41128fd8e170bcfe57962 |
| A: baseline/reproducción | dda0c0f401a6c1e2c86c15f76a20e84676b8c555 | 3edf03eade6d494cdef0ec782f9001a4fd851111 |
| B: producto focal | b053e31389b2ae6fc167963ef1e39750d86a8f66 | 8a124e41b82757d9fbc53cbdeea4bc18cd7e81cf |
| C: pruebas y runners | f4e83ee1 (prefijo local) | 163de34e034ac708cca35fc4b1eca7437c1e3676 |
| D: candidata / evidencia | commit que contiene este documento | SHA exacto registrado en PR y entrega después de publicar |
| E: cierre remoto documental | descendiente de D, sólo docs/evidencia | identificado al cierre; no atribuir CI de D a otro HEAD |

Los commits remotos tienen metadata propia del conector; los árboles se comparan con Git local. No se usa el checkpoint perdido 11888796. Git push devolvió falta de credenciales; se utilizaron create_tree/create_blob/create_commit y refs autenticados. No force push. A preservado en rama audit/admin-resume-f02-r2-checkpoints; B/C alcanzables desde D al publicar candidata. Los SHA se comprobaron mediante GET GitHub. Main reconsultado antes del Draft sigue en 9ca65fc0. #338/#352 mantienen sus SHA declarados en el informe.

Node 24.19.0. Dependencias existentes mediante symlink; lockfile SHA-256 `59e12324df46b964748524051be34760fcc3c1050ef57a8b03deb16c4ae2b581` igual a la instalación. No se modifican package.json ni lockfile. Chromium 143.0.7499.0 externo al producto, Playwright del runtime. El paquete Chromium ya disponible se extrajo a carpeta de tooling de la tarea sin modificar dependencias del repositorio; el primer helper de extracción falló por chown del entorno. No se consideran estos errores de herramienta fallos del producto.

## Resultados nuevos

| Selección | Resultado |
| --- | --- |
| Baseline reproducción F02 + EXP14 existente | 4 PASS / 6 FAIL; EXP14 pasa tras M01 |
| Focal final helper + integración F02 | 41/41 PASS |
| Auth/tenant/license/PWA final | 614/614 PASS |
| Finanzas/handoff completo | 188/188 PASS |
| Dexie Recovery, archivos únicos del workflow | 127/127 PASS |
| Arquitectura/precache/packaging | 70/70 PASS |
| Build Admin/postbuild, Store, Store Vercel | PASS base y candidata |
| ESLint focal / diff-check | PASS |
| Global base nuevo | 5637 PASS / 75 FAIL / 52 SKIP / 5764 total |
| Global candidata inicial | 5675 PASS / 75 FAIL / 52 SKIP / 5802 total |
| Global candidata final, tres casos adicionales | 5678 PASS / 75 FAIL / 52 SKIP / 5805 total |
| PR127 local final | OK: 91 compartidas, cero exclusivas/nuevas/sin resolver |
| Lifecycle Chromium | 20 observaciones, 15 PASS / 5 FAIL baseline esperados / 0 HARNESS_ERROR |
| Compatibilidad Chromium | 34 observaciones, 12 PASS / 21 FAIL LC13 / 1 limitación detectada / 0 HARNESS_ERROR |

Los grupos se solapan: no sumarlos. 75 tests fallidos y 91 identidades del comparador son unidades distintas; las últimas incluyen fallos de archivo. SKIP no es PASS. PR127 local tiene targets=[] y cero repeticiones focales ejecutadas. Se conservan las salidas iniciales y finales. No se modifica ningún comparador/threshold/config para obtener verde.

## Comandos y reproducción

Desde la raíz del repo con dependencias del lockfile:

```sh
npx vitest run src/services/auth/__tests__/adminResumeExpiry.f02.integration.test.jsx src/pwa/__tests__/adminResumeChecks.test.jsx --maxWorkers=2
npx vitest run src/services/auth/__tests__ src/services/tenant/__tests__ src/store/slices/license src/pwa/__tests__ --maxWorkers=3
node scripts/qa/admin-resume-f02-r2/browser.mjs > chromium.json
node scripts/qa/admin-resume-f02-r2/compatibility-browser.mjs > compatibility-chromium.json
npm run build
npm run build:store
npm run build:store:vercel
npm run test:ci -- --reporter=json --outputFile=global.json
node scripts/ci/pr127-global-comparison.mjs extract --candidate candidate.json --base base.json --output phase-one.json
node scripts/ci/pr127-focused-evidence.mjs --targets targets.json --output-dir focused/pr --repetitions 20 --max-workers 4
node scripts/ci/pr127-focused-evidence.mjs --targets targets.json --output-dir focused/main --repetitions 20 --max-workers 4
node scripts/ci/pr127-global-comparison.mjs classify --phase phase-one.json --base-focused focused/main --candidate-focused focused/pr --output final.json
```

Browser requiere CODEX_PRIMARY_RUNTIME_NODE_MODULES para Playwright y ACTOR_QA_CHROMIUM_EXECUTABLE para binario externo. Si el binario empaquetado requiere librerías/fontconfig, configurar sus paths externos. Nunca usar el perfil del propietario. Los runners sirven sólo fixtures por loopback, no el frontend comercial ni Supabase. En el runner lifecycle se compilan el health check de main y su cuerpo de listeners exacto frente a helper actual; React/hook/controller/bridge/storage/política son reales, proveedores de tenant/credenciales/device son sintéticos. CDP freeze/thaw no es hibernación OS.

La selección financiera completa se registra con sus rutas reales en financial-complete.json.gz: src/services/__test__/db/salesRepository.test.js, src/services/cash/cashLocalRepository.test.js, src/services/db/__tests__/customerCreditRepository.test.js y layawaysCashConsistency.test.js; inventario normal/freeLocalAuthority, syncOutbox actorOrigin/tenantIsolation, financial/__tests__ y actorOperationalHandoff. El primer comando usó filtros de cuatro rutas incorrectas y ejecutó 161 tests, no la selección completa; se conserva sin llamarlo certificación de ventas/caja/crédito/apartados.

## Artefactos y preservación

`./scripts/qa/admin-resume-f02-r2/evidence/`:

- baseline-reproduction.json: baseline rojo de producto main nuevo, test añadido sólo para reproducir. Luego se retira del worktree base antes del global; producto base intacto.
- focal-first/expanded/final.json.gz: pruebas por etapas; sólo final usa 41 nuevas assertions.
- auth-license-pwa-final.json.gz: 614 assertions; primera selección de 611 conservada.
- financial-complete.json.gz, dexie.json.gz, architecture.json.gz: grupos finales.
- chromium-final.json.gz y compatibility-chromium.json.gz: snapshots completos, fuentes, versiones y FAILs previos preservados.
- global-base.json.gz, global-candidate.json.gz, global-candidate-final.json.gz: JSON brutos sin pérdida.
- pr127/: phase-one/final/targets/focused y entradas normalizadas; gzip para JSON grandes.
- build-*.log.gz: todos los builds y auditorías de base/candidata.
- eslint-final.log.gz, product.diff.gz, merge-338/352.txt.gz y pr338/352-auth.diff.gz.
- artifact-hashes.json: SHA-256 de artefactos excepto propio manifest.

Las entradas PR127 derivadas sustituyen literalmente, igual en ambos lados, sólo los prefijos de checkout de base/candidata por /home/runner/work/Lanzo-POS/main y /home/runner/work/Lanzo-POS/pr, y el node_modules compartido por /home/runner/work/Lanzo-POS/shared/node_modules. No se eliminan mensajes, clases de error, asserts, frames restantes ni timestamps fuera de las reglas originales del comparador. Los originales se conservan, junto con entradas derivadas y resultados. Los logs pueden contener rutas scratch y nombres de fixtures sintéticos; no hay tokens reales ni filas comerciales. gzip -dc permite inspeccionar originales.

## Fronteras y omisiones

La matriz EXP16 y RESUME07 comprueba un efecto protegido sintético/contador cero con handle real; no ejecuta venta o RPC live. RESUME10 integra coordinador SW real con registration fake y operación tracked real; no instala un SW nuevo durante un cobro comercial. Staff offline se valida en política y suites de autenticación, no contra producción. Reloj/horas/offset sintéticos; no cambiar reloj OS del propietario.

LC13 sequential/concurrent/pending/finally permanece FAIL base/candidata. No exclusividad universal, CAS ni fencing financiero global. No se alteran F01/M03/Authority v2. HTTP LAN conserva el protocolo anterior y no introduce APIs de contexto seguro nuevas; QA física LAN/PWA/Windows/Android pendiente.

El cierre remoto añadirá CI del SHA exacto, artefactos y hashes, Preview READY/target/SHA, lectura estática de HTML/assets/SW/manifest y backend compilado sin credenciales. No se reutilizan resultados de #367. Dexie workflow fuera de sus path filters: no llamarlo SUCCESS si no se dispara. Sin migraciones, llamadas Supabase, escrituras de producción, login live, device registration/release, limpieza de usuario, cierre de caja o merge.
