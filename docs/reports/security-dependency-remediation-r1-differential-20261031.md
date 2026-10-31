# LANZO POS — Certificación diferencial de seguridad y regresiones R1

**Fecha:** 2026-10-31 UTC
**Resultado:** `READY_FOR_REMOTE_SECURITY_CI_REVIEW`
**Alcance:** candidata local `security/production-dependencies-remediation-r1`. No se publicó, fusionó ni desplegó.

## Referencias y estado Git

- Base `main`: `1a0d758d09310f2914c475c37d358c4cf885cc01`.
- HEAD de entrada de la candidata: `2515fc44f566f4acbc99fd0868fa27af4e3ac24a`.
- Rama FIN-01 revalidada: `review/fin01-f-pay-n01-release-r1`, `f81f09aaf40164ed896d11b766dc77477f3afff4`.
- La combinación financiera local usa el código de `f81f09a…` más los manifiestos finales de dependencias. Su SHA de prueba local, no publicado, es `ef83120c73ac1a64887f34b31c6700d7eadb016a`.
- `git diff f81f09a… ef83120…` contiene únicamente `package.json` y `package-lock.json`; las fuentes de producto y las migraciones FIN-01 permanecen iguales.
- Node `v24.19.0`, npm `11.9.0`. `npm ci` limpio terminó correctamente. `npm ls --all` terminó con código 0 y `npm audit signatures` no reportó firmas inválidas ni faltantes.
- SHA-256 finales: `package.json` `c26334ad6533484fe1b04165cb1242794ce3791212f2d5302e14ccf213ae9f93`; `package-lock.json` `3926447716c6de58763b104adb3187d7fe3c85a9b7c6e2bdfd973171eec7fb48`.
- No se modificaron código de aplicación, SQL, workflows, pruebas ni aserciones. Los rastros generados bajo `scripts/qa/single-instance-f012*` se conservaron fuera de la candidata preparada.

## Dependencias y seguridad

| Paquete directo | Base | Candidata final |
|---|---:|---:|
| `vite` | 7.2.2 | 7.3.7 |
| `vitest` | 4.0.14 | 4.1.12 |
| `vite-plugin-pwa` | 1.2.0 | 1.3.0 |

Se aplicó `npm audit fix` sin `--force` y luego se elevaron las versiones mínimas compatibles de esas tres herramientas. Se conservaron las remediaciones de producción ya presentes en la candidata: `protobufjs` 7.6.6, React Router 7.18.5, `ws` 8.22.0, Zod 4.6.7, Sharp 0.35.5, Satori 0.33.5 y `@vercel/og` 0.11.1. El lock instala `@standard-schema/spec` 1.1.0 dentro de los rangos declarados por Recharts/Redux Toolkit y Vitest; `npm explain` y los builds/tests combinados lo verificaron.

| Audit | Main base | Candidata antes del cambio de toolchain | Candidata final |
|---|---:|---:|---:|
| Producción | 0 críticas, 7 altas, 4 moderadas, 11 total | 0 | **0** |
| Árbol completo | 1 crítica, 60 altas, 14 moderadas, 67 bajas, 142 total | 1 crítica, 51 altas, 11 moderadas, 67 bajas, 130 total | **0 críticas, 0 altas, 14 moderadas, 2 bajas, 16 total** |

Los snapshots del audit se guardan junto con la evidencia; npm puede actualizar su base de avisos entre ejecuciones. El audit completo final sigue devolviendo código 1 y no se presenta como limpio. Los avisos restantes corresponden a tres advisory roots en herramientas de desarrollo/build: `glob` (GHSA-3g3m-2fjr-6pw4, moderada), `minimatch` (GHSA-g3hv-75wg-m249, moderada) y `deepmerge` (GHSA-gcqx-w48m-w2h4, baja). El arreglo sugerido restante requiere un downgrade forzado de `vite-plugin-pwa`; no se aplicó porque rompe el rango vigente. No hay vulnerabilidades críticas o altas restantes en el árbol final.

### Vitest y exposición

El hallazgo crítico de Vitest 4.0.14 era GHSA-5xrq-8626-4rwp, relacionado con el servidor de Vitest UI; también se cerró GHSA-82fw-gwwq-j7x9 al actualizar a 4.1.12. La búsqueda de configuración/repositorio no encontró `@vitest/ui`, Browser Mode, `--ui`, API HTTP de Vitest ni `server.host`/`--host` en Vite. Los workflows y `test:ci` ejecutan `vitest run`; el script interactivo `npm test` solo inicia el runner en modo watch. No se expone un servidor de Vitest en las configuraciones revisadas de Codex Cloud, Actions o desarrollo local. Los workflows examinados conceden `contents: read` y las pruebas no requieren secretos.

La exposición del toolchain queda reducida: la versión crítica se corrigió y no se habilita la interfaz/servidor asociado. Los 14 avisos moderados y 2 bajos permanecen limitados a dependencias de desarrollo/build y se dejan explícitos para revisión antes de una futura integración.

## Suite global y diferencial

Se ejecutó `npm run test:ci` con reporte JSON sobre checkout limpio de `main` y sobre el árbol final limpio de la candidata, usando Node, npm, OS y parámetros equivalentes. Ambos terminaron con el mismo resultado: **661 archivos, 6,674 tests, 6,534 aprobados, 84 fallidos y 56 omitidos**.

La comparación por archivo, test, mensaje y estado clasifica los 84 fallos emparejados como:

- `ENVIRONMENT_FAILURE`: **48** — seis pruebas de arquitectura sin los artefactos generados `dist-store`/`store/dist`; 17 sin DOM/JSDOM; 16 sin `localStorage`; una sin IndexedDB; ocho cuyo smoke requiere procesos Node hijos bloqueados por el sandbox.
- `BASELINE_FAILURE`: **36** — las mismas aserciones heredadas en main y candidata.
- `NEW_REGRESSION`: **0**.
- `FLAKY`: **0 demostradas**.
- `UNRESOLVED`: **0**.

En tres aserciones de Ecommerce Vitest 4.1 cambió el prefijo de clase del error (`AssertionError` a `Error`); el texto de expectativa/resultado restante coincide byte por byte, por eso se clasifican como baseline y no como regresión.

Las seis pruebas que requerían build output pasaron en el rerun de arquitectura **18/18** después de `npm run build`, `npm run build:store` y `npm run build:store:vercel`. Las ocho pruebas cuyo smoke child-process no pudo arrancar en la corrida global se ejecutaron por separado: el audit de output pasó **61/61**; el proceso sustituye `fetch` por un stub que falla y verifica `externalNetworkDisabled=true`, por lo que no hizo solicitudes externas.

El lint terminó con los mismos **158 errores y 176 warnings** en main y candidata: 334 diagnósticos cada uno, **cero añadidos y cero eliminados**. No se redujeron reglas ni se modificó código para ocultarlos.

## Regresiones de aplicación, builds e imágenes

Sobre el código combinado FIN-01 y las dependencias finales se ejecutó:

- Frontend FIN-01: **83/83**, 22 suites, incluyendo la prueba de `syncConstants.fin01Gate`: dos casos confirman que la importación histórica queda apagada sin el capability explícito.
- Imágenes/Open Graph/router: **134/134**.
- Rutas públicas y seguridad de storefront: **91/91**.
- Audit de `.vercel/output`: **61/61**.
- Arquitectura de artefactos públicos: **18/18**.
- Smoke de imagen real: `@vercel/og` generó PNG 1200×630; Sharp convirtió PNG→WebP→PNG y verificó ambas firmas PNG. El artefacto fue sintético.
- `npm run build`: PASS; postbuild verificó 24 assets iniciales. Persisten avisos de patrones de precache sin coincidencias, sin fallo de build.
- `npm run build:store`: PASS.
- `npm run build:store:vercel`: PASS; auditoría de staging `violations: []`, 11 fuentes y 12 archivos staged. El script no invoca Vercel CLI ni despliega.

## FIN-01: integración en PostgreSQL de laboratorio

Se volvió a probar el código de `f81f09a…` combinado con los manifiestos finales, identificado por el SHA local `ef83120…`. PostgreSQL **17.11** fue un contenedor efímero, enlazado solo a loopback, sin volúmenes ni credenciales productivas. La plantilla sintética conservó el estado posterior a 3D1, 3D13 y 3D14; la secuencia estudiada fue **post-3D14 → FIN-01 F → PAY-N01**.

- Applier selectivo: **15/15**. Solo permite F `20261022135915` y PAY-N01 `20261029235906`; valida SHA, release, proyecto, drift de función/firma/ACL y concurrencia. F y PAY-N01 hicieron `COMMIT` independiente con evidencia de ledger. La inyección de fallo dentro de F hizo `ROLLBACK` sin cambiar las 333 filas originales; fallo dentro de PAY-N01 hizo rollback y reintento seguro. El backup sintético se restauró correctamente.
- Suite FIN-01 + PAY-N01 + PAY-N02: **63/63**. Incluye rechazo PAY-N01 por sobrepago sin efectos parciales, replay válido PAY-N02 sin duplicación, límites, deuda/ledger, Caja, idempotencia y concurrencia. Se conservaron SQLSTATE y muestras de estado financiero sintético.
- Guard del dispatcher 3D14: **5/5**. Rechazos por ausencia de operación financiera en vuelo, Caja no coincidente y actor inválido dieron el SQLSTATE esperado; el caso owner-bound válido pasó. Los contadores de ventas, pagos, deuda, Caja, inventario e idempotencia quedaron idénticos antes/después.
- Contrato frontend FIN-01: **83/83**; prueba de contrato de release: PASS.
- SHA-256 de las migraciones sin cambios: F `855a25f313741d4181be90dede4925cbfdce59fce23a1ff34a5fff463eff5e9e`; PAY-N01 `a53cc7865092737752949bfe5db455521290206c70907040e3b920223380b244`.

Los reportes guardan `COMMIT`/`ROLLBACK`, SQLSTATE y estados de tablas sintéticas. El contenedor se detuvo al terminar. No se conectó a Supabase Production ni se ejecutó SQL productivo.

## Evidencia y hashes

Los JSON originales de main/candidata, clasificación normalizada, audits, lint, builds, pruebas focales y reportes FIN-01 están en [`evidence/differential-20261031/`](security-dependency-remediation-r1/evidence/differential-20261031/). Son **48 archivos de evidencia** más su manifiesto `SHA256SUMS`; todos los hashes se comprobaron con `sha256sum -c`. SHA-256 del manifiesto: `4610a8d046e9dcc4f57161779a80de0112a5926788d63e30891c019eea14d97e`.

## Riesgos residuales y decisión

- El audit completo aún informa **14 moderadas y 2 bajas**, en herramientas de desarrollo/build; no debe describirse como limpio. Se evita ejecutar Vitest UI, se usan runners CLI, los workflows revisados tienen permisos de lectura y el ambiente de prueba no tiene credenciales productivas. La solución compatible para limpiar esos avisos debe revisarse aparte; el downgrade forzado rechazado no se aplicó.
- La suite global y lint conservan fallos heredados y de entorno; no son PASS global. La candidata no produjo diferencias negativas frente a main.
- FIN-01 pasó en laboratorio PostgreSQL 17.11, no en Production. No certifica QA física, despliegue ni autorización de merge.
- El SHA `ef83120…` es un commit sintético local de prueba en `/tmp`; no se publicó. La candidata para revisión permanece en la rama local indicada. No se ejecutó CI remoto.

`PRODUCTION_DEPENDENCIES_GATE=PASS`

`NEW_REGRESSIONS_GATE=PASS`

`DEVELOPMENT_SECURITY_GATE=PASS` — bloqueantes críticos/altos corregidos; los hallazgos moderados/bajos permanecen abiertos y acotados como arriba.

`READY_FOR_REMOTE_SECURITY_CI_REVIEW`

La decisión solo recomienda revisión CI remota posterior; no autoriza publicación, merge o despliegue. La siguiente acción concreta es revisar el commit local de la candidata y, si se desea CI remoto, autorizar explícitamente su publicación en una rama de revisión.

`PR_MERGES=0`

`GITHUB_PUSHES=0`

`SUPABASE_PRODUCTION_SQL_WRITES=0`

`VERCEL_PRODUCTION_DEPLOYMENTS=0`
