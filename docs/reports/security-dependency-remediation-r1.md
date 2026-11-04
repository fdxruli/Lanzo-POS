# LANZO POS — Remediación de dependencias de producción R1

**Fecha:** 2026-10-31 UTC

**Dictamen:** `LANZO_SECURITY_DEPENDENCIES_REMEDIATED_LOCAL`

**Alcance del dictamen:** audit de producción y superficies de regresión directamente afectadas. No certifica todo el audit de desarrollo ni que la suite global esté verde.

## Estado Git verificado

- Base de la candidata: `main` `1a0d758d09310f2914c475c37d358c4cf885cc01`.
- Rama local aislada: `security/production-dependencies-remediation-r1`.
- Commit local de dependencias: `0b30c527d3fb6dc4f5760d718e2cb3ba6cd75295`.
- FIN-01 remota revalidada: `review/fin01-f-pay-n01-release-r1` en `f81f09aaf40164ed896d11b766dc77477f3afff4`.
- `origin/main` volvió a leerse y sigue en el SHA de base indicado.
- SHA-256: `package.json` `9f8e0684a636b21adf4c018549ec7d93dbec92f75c15ccfd9571595e32c1913e`; `package-lock.json` `b56074e25cdb982bb88bd1d50534b69b07da21610016ad66a87b92ebb21ea33d`.
- El cambio de producto está limitado a esos dos manifiestos. El resto de archivos añadidos son este informe y evidencia local. No se modificó código de aplicación, SQL financiero, workflow ni umbrales de audit.

No hubo push, merge, cambios a `main` o PR oficiales, SQL de escritura en Supabase Production ni despliegues Vercel. Las pruebas PostgreSQL usaron un contenedor efímero PostgreSQL 17.11 y datos sintéticos.

## Vulnerabilidades de producción

La primera captura del árbol base reportó 7 altas y 1 moderada. Al repetir el audit más tarde, npm había actualizado su base de avisos: la captura comparable del mismo árbol base reportó 7 altas y 4 moderadas. La candidata, evaluada en la misma captura actualizada, reportó **cero** vulnerabilidades de producción: `0 critical / 0 high / 0 moderate / 0 low`.

Los avisos únicos del árbol de producción inicial se agrupan así; los JSON guardados contienen nombres, rangos y descripciones completos:

| Paquete vulnerable | Avisos iniciales | Cambio fijado en el lock |
|---|---|---|
| `protobufjs` | GHSA-jggg-4jg4-v7c6, GHSA-wcpc-wj8m-hjx6, GHSA-f38q-mgvj-vph7, GHSA-j3f2-48v5-ccww | 7.5.6 → 7.6.6, transitivo de `@google/genai` |
| `react-router` / `react-router-dom` | GHSA-49rj-9fvp-4h2h, GHSA-8646-j5j9-6r62, GHSA-8x6r-g9mw-2r78, GHSA-rxv8-25v2-qmq8, GHSA-84g9-w2xq-vcv6, GHSA-wrjc-x8rr-h8h6, GHSA-h8fp-f39c-q6mh, GHSA-337j-9hxr-rhxg, GHSA-chx6-hx7r-mcp5, GHSA-2j2x-hqr9-3h42, GHSA-qwww-vcr4-c8h2, GHSA-f22v-gfqf-p8f3 | 7.13.0 → 7.18.5 |
| `ws` | GHSA-58qx-3vcg-4xpx, GHSA-96hv-2xvq-fx4p | 8.18.3 → 8.22.0, transitivo de GenAI y Supabase Realtime |
| `zod` | GHSA-mrhx-c7xc-m3w5 | 4.1.13 → 4.6.7 |
| `sharp` | GHSA-f88m-g3jw-g9cj, GHSA-rgj7-g3m4-5g8c, GHSA-wq5f-xc86-pv6w | 0.34.5 → 0.35.5 |
| `satori` | GHSA-wx4j-mvgx-mqwp | 0.25.0 → 0.33.5 |

`@google/genai`, `@supabase/realtime-js`, `@supabase/supabase-js`, `react-router-dom` y `@vercel/og` también aparecían como nodos afectados agregados por sus dependencias transitivas.

### Decisiones sobre versiones y overrides

- `@google/genai` sigue en 1.50.1. Sus transitivos vulnerables `protobufjs` y `ws` quedaron en versiones corregidas dentro del lock.
- El rango directo de React Router ya permitía la versión segura; el lock queda en 7.18.5. Las pruebas de navegación y storefront pasaron.
- `zod` queda bloqueado por el lock en 4.6.7. Se rechazó `safeParse` sobre un array inválido de 1,000,000 de elementos en 47 ms en el smoke local.
- `sharp` pasó de 0.34.5 a 0.35.5. Este cruce de la frontera `0.x` se justificó con la matriz de procesamiento y normalización de imágenes, render Open Graph, ESM en Node 24.19 y builds.
- Se probó `@vercel/og` 1.0.3 y se descartó: falló la carga ESM en Node con `Dynamic require of "fs" is not supported` desde `harfbuzzjs`. La candidata mantiene `@vercel/og` 0.11.1, con `satori` 0.33.5 corregido y `sharp` 0.35.5 compartido mediante overrides.
- Al probar Satori 0.33.5 sin ese pin, npm resolvió un `fflate` anidado 0.7.3. El override lo alinea con 0.7.5, ya presente en el árbol base. Los overrides están comprobados por `npm ls`, render Open Graph real, pruebas de imágenes y audit de producción en cero.
- No se usó `--force`, `--legacy-peer-deps`, `--audit=false` ni allowlist de avisos.

## Desarrollo y audit completo

El audit completo sigue rojo y no se presenta como limpio. La comparación actual es:

| Árbol | Critical | High | Moderate | Low | Total |
|---|---:|---:|---:|---:|---:|
| `main` base | 1 | 60 | 14 | 67 | 142 |
| Candidata | 1 | 51 | 11 | 67 | 130 |

El hallazgo crítico restante es `vitest@4.0.14`, GHSA-5xrq-8626-4rwp, asociado a lectura/ejecución arbitraria cuando se expone el servidor de Vitest UI; el audit también marca GHSA-82fw-gwwq-j7x9 como moderado. Los scripts del repositorio usan `vitest run` y no habilitan UI. Vite y otros paquetes de build/test aportan más avisos de desarrollo. No forman parte del bundle de producción; requieren una actualización separada del toolchain y su propia regresión antes de afirmar que el audit completo está limpio.

Otros nodos de desarrollo destacados en la captura actual: `vite@7.2.2` (incluye GHSA-v2wj-q39q-566r y GHSA-p9ff-h696-f583, además de avisos `launch-editor`); `undici@7.25.0` (varios high/moderate de TLS, WebSocket y cache); `rollup@4.53.2` (GHSA-mw96-cpmx-2vgc); y `workbox-build@7.4.0` (hallazgos agregados en herramientas transitivas). El inventario completo y rangos están en `evidence/full-audit-candidate-current.json`. No se actualizó el toolchain de desarrollo en esta candidata.

## Validaciones ejecutadas

- `npm ci` limpio en la candidata de seguridad y en la integración local de FIN-01 produjo el árbol fijado. Node `v24.19.0`.
- `npm audit --omit=dev`: 0 vulnerabilidades en la candidata y también 0 sobre la integración de FIN-01.
- Smoke ESM local: import de GenAI; encode/decode protobuf; carga de `ws`; validación Zod de entrada grande; conversión PNG→WebP→PNG con `sharp`; render PNG real de 1200×630 con `@vercel/og`. Todas las aserciones pasaron.
- Imágenes, entrada de imágenes públicas, Open Graph y rutas: **134/134**.
- Redirects y contrato de storefront: **91/91**, incluidos valores `javascript:` y rutas públicas.
- Audit sintético de `.vercel/output`: **61/61** cuando se permite ejecutar sus procesos Node hijos. En la corrida global aislada, 8 smoke assertions de ese archivo no pudieron cargar/invocar el hijo; el rerun individual con el mismo fetch externo bloqueado pasó.
- `npm run build`: pasó; el postbuild verificó 24 assets de arranque. Permanecen advertencias preexistentes de imports dinámicos y patrones PWA que no encuentran archivos.
- `npm run build:store:vercel`: pasó los audits standalone y de staging; 11 archivos fuente, 12 staged, copias idénticas y `violations: []`. El script indica `deployed: false`; no se usó CLI de Vercel.
- FIN-01 sobre SHA `f81f09a…`, con PostgreSQL 17.11 efímero y la secuencia **estado post-3D14 → F → PAY-N01**: preparación del fixture/ledger 333 filas PASS; applier selectivo **15/15**; suite PAY-N01, PAY-N02 y FIN-01 **63/63**; dispatcher 3D14 **5/5**. Los contratos de frontend FIN-01 pasaron **41/41** y el contrato de release **4/4**.
- `npm run test:ci` global terminó con **621/661 archivos**, **6,544/6,674 tests** aprobados, **78 fallos** y **52 skips**. Sus fallos incluyen archivos que necesitan DOM pero corren sin `jsdom`, errores de descubrimiento/importación y aserciones de Ecommerce, backup, caja y estado en archivos sin cambios. No repetí los 661 archivos en el árbol base, así que no afirmo que todos esos fallos sean preexistentes. Los cuatro fallos de navegación móvil de `usePosModals` sí se reprodujeron en `main` limpio. La suite global queda registrada como FAIL y no se cambia ninguna expectativa para forzar PASS.
- `npm run lint` terminó con 158 errores y 176 warnings sobre fuentes no modificadas por esta candidata.

Los JSON de audit y FIN-01, el resumen de la suite global, logs de build/lint y smoke están en `docs/reports/security-dependency-remediation-r1/evidence/`; `SHA256SUMS` valida esos archivos.

## Compatibilidad con FIN-01 y límite del dictamen

El commit `f81f09a…` de la rama de review y `main` se revalidaron antes de probar. El árbol integrado solo sustituye `package.json` y `package-lock.json`; las migraciones, límites de crédito, idempotencia, identidad de actor/tenant y gate FIN-01 no cambian. La prueba `syncConstants.fin01Gate` quedó incluida entre los contratos frontend aprobados. Las pruebas financieras se ejecutaron nuevamente sobre la combinación exacta; no se reutilizaron checks de un SHA combinado anterior.

**Resultado:** la remediación local de vulnerabilidades de producción está completa y las pruebas enfocadas de las dependencias modificadas y de FIN-01 pasaron. El audit completo de desarrollo y la suite/lint global siguen teniendo fallos documentados; este informe no declara la rama lista para merge ni para deploy. No se aplicó SQL a Supabase Production, no se cambió F01 y no se publicó esta rama.

`PR_MERGES=0`

`GITHUB_PUSHES=0`

`SUPABASE_PRODUCTION_SQL_WRITES=0`

`VERCEL_PRODUCTION_DEPLOYMENTS=0`
