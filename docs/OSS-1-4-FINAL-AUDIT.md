# OSS.1.4-R — auditoría final de cierre

Fecha de cierre: 2026-08-05. Repositorio: `fdxruli/Lanzo-POS`.
Rama de trabajo: `docs/oss-1-4-final-audit`.

## 1. Alcance y criterio de cierre

Este documento consolida la auditoría final sobre `main` después de integrar el
límite técnico de distribución de OSS.1.4. No repite las investigaciones de
proveniencia, evidencia de activos ni dependencias ya cerradas en los PRs
anteriores; verifica su integración, ejecuta los validadores canónicos y deja
las condiciones residuales explícitas.

El criterio aplicado fue: código y configuración de producción intactos, activos
de identidad oficial fuera de la entrega OSS, placeholders neutrales únicamente
en los consumidores necesarios, manifiesto determinista y documentación
consistente. Esta tarea no crea una licencia, no activa AGPL, no despliega y no
modifica servicios externos.

## 2. Cadena de integración en `main`

| PR | Estado | Head commit | Merge commit | En `main` |
| --- | --- | --- | --- | --- |
| #170 | MERGED | `c1dd31e41a07b68f3a8bf6774cde0e269fed71d7` | `0decbc4124fed4e8cda4e807a9a400f7257e3084` | Sí |
| #171 | CLOSED / NOT MERGED | `72590fd200be6200e44cf64c14ef38204526d4bf` | — | No |
| #177 | MERGED | `cc6337bdd26b558b52d3ab239998dec19d897bb0` | `6c5144d7e9327bcc3f9ec78adfc66776dc0d304e` | Sí |
| #178 | MERGED | `bc3866c067a44a4a181b3129c458e5b2de0029d5` | `b7c3f2be384d76c9cbb1a2b352aba383de78d718` | Sí |
| #179 | MERGED | `827b35c4fe742d8f5daeedf4225b7d34701a3662` | `ac003a54158c68d2427f244514dc3def379c37cc` | Sí |

La rama se basó en `origin/main` en `ac003a54158c68d2427f244514dc3def379c37cc`.
`git merge-base --is-ancestor ac003a54 origin/main` pasó y el commit rechazado de
#171 no es ancestro de `main`. No hay PRs OSS abiertos fuera de esta auditoría.

## 3. Dependencias y avisos de terceros

### Resultado

`npm ls --all` terminó con exit 0. No hay dependencias requeridas ausentes o
inválidas; los únicos avisos locales son opcionales y específicos de otras
plataformas o integraciones de runtime. OSS.1.4-R no añadió dependencias ni
modificó `package-lock.json`; PR #179 sólo añadió scripts de validación al
`package.json`.

| Componente | Evidencia local | Resultado |
| --- | --- | --- |
| Geist / `@vercel/og` | `@vercel/og@0.11.1`; `node_modules/@vercel/og/dist/Geist-Regular.ttf`; 125,956 bytes; SHA-256 observado `bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76`. El paquete declara MPL-2.0 y la fuente interna declara OFL-1.1. | `CONDITIONAL`: conservar el aviso OFL completo si se redistribuye la fuente y cerrar la procedencia exacta del hash antes de afirmar equivalencia oficial. |
| Resvg | `@resvg/resvg-wasm@2.4.0`, declara MPL-2.0; el paquete instalado no trae `LICENSE`, `NOTICE` ni `COPYING`. `THIRD_PARTY_NOTICES.md` conserva upstream, `gitHead` `30ac8d830d44802df7e967569c92edabbbcec017` y SHA-256 del LICENSE upstream `4b89d4518bd135ab4ee154a7bce722246b57a98c3d7efc1a09409898160c2bd1`. | `PASS WITH NOTICE`: cualquier artefacto redistribuido debe conservar el texto MPL completo. |
| sharp / libvips | `sharp@0.34.5`, libvips runtime `8.17.3`, `@img/sharp-win32-x64@0.34.5` instalado en Windows x64. Las variantes Linux aparecen como opcionales en el lockfile, no instaladas localmente. | `SHARP/LIBVIPS PRODUCTION ARTIFACT — NOT INDEPENDENTLY VERIFIED`. |

La condición de dependencias consolidada es `DEPENDENCY CONDITIONAL GO`. No se
encontró incompatibilidad MPL evidente ni Exhibit B aplicado en código o
metadata; los detalles históricos y los avisos completos permanecen en
`docs/OSS-DEPENDENCY-AUDIT.md`, `docs/OSS-DEPENDENCY-EVIDENCE.md` y
`THIRD_PARTY_NOTICES.md`.

## 4. Activos oficiales y frontera de distribución

Los nueve activos de identidad oficial permanecen restringidos y fuera de la
entrega OSS:

- `icono/icono.png`
- `public/icono.png`
- `icono/icono-web.png`
- `public/icono-web.png`
- `public/pwa-192x192.png`
- `public/pwa-512x512.png`
- `public/logIcon.svg`
- `public/boticon.svg`
- `public/log.svg`

El manifiesto canónico produce cinco omisiones:
`icono/icono.png`, `public/icono.png`, `icono/icono-web.png`,
`public/icono-web.png` y `public/log.svg`.

Produce cuatro reemplazos neutrales, con hashes deterministas:

| Ruta | SHA-256 del reemplazo |
| --- | --- |
| `public/pwa-192x192.png` | `a297fdb49a1738aed6034fda0f8653b0018628b044ded5c1cb9fc8e3a0e61a75` |
| `public/pwa-512x512.png` | `23d1a5300a34c6b57b6b701b58ded73839c0c1a338458425fcbab3e20d8d8a93` |
| `public/logIcon.svg` | `8ef932dc1b464e12fda10aa892c06a618a6d529d242a16e1379f4dbcdcc30c34` |
| `public/boticon.svg` | `4098b750c947769479e99127b2126c707fb2d513d218b78779d9f8b327eacdb9` |

El último valor se valida por el pipeline como
`4098b750c947769479e99127b2126c707fb2d513d218b78779d9f8b327eacdb9`.
Los placeholders no contienen identidad oficial ni C2PA. No existe grant general
de redistribución o modificación de marca; los forks deben usar nombre,
apariencia e identidad propios. La política de marca sigue reservada.

## 5. Validación del límite técnico

El manifest es la fuente autoritativa. La preparación final reportó:

- 1,528 archivos tracked copiados.
- 1,534 archivos en la salida final.
- 97 transformaciones.
- 9 activos clasificados.
- 5 omisiones y 4 reemplazos.
- `officialHashMatches: []`.
- `unknownIdentityReferences: []`.
- `transformationFailures: []`.
- `pr171Matches: []`.
- ausencia de C2PA.
- identidad oficial de producción: `UNCHANGED`.
- `LICENSE`: `NOT CREATED`.
- AGPL: `NOT ACTIVATED`.

La auditoría de la salida terminó en `PASS`. La verificación adicional de
consumidores requeridos terminó en `PASS`: favicon administrativo, favicon de
tienda, manifest PWA, icono del asistente y fuente de precache quedaron
resueltos dentro del límite autorizado.

La build administrativa se ejecutó desde el candidato preparado y produjo 80
archivos. La build de tienda se ejecutó desde el mismo candidato y produjo 10
archivos. Ambas verificaciones terminaron en `PASS` sin bytes de identidad
oficial en sus salidas. La documentación de `docs/OSS-RELEASE-BOUNDARY.md` fue
corregida para que las builds usen realmente el candidato source-only y para que
la salida de tienda permanezca fuera del árbol auditado.

## 6. Pruebas canónicas y nota de diseño aceptada

`npm run test:oss-release` terminó con:

```text
12 tests, 12 pass, 0 fail
```

La suite cubre los nueve activos, las cinco omisiones, los cuatro reemplazos,
hashes, seguridad de rutas, placeholders, ausencia de C2PA, referencias de
identidad desconocidas, consumo PWA/favicon/asistente, conteo esperado y
determinismo. La segunda ejecución de preparación produjo el mismo árbol
completo.

El conteo esperado permanece validado de forma estricta: un cambio no autorizado
falla la suite y una referencia desconocida falla la auditoría. Es una nota de
diseño aceptada, no un hueco que requiera relajar el hardening.

## 7. Consistencia documental y alcance excluido

Se revisaron y alinearon `README.md`, `BRAND_ASSETS.md`, `TRADEMARK_POLICY.md`,
`docs/OSS-ASSET-PROVENANCE.md`, `docs/OSS-ASSET-DECLARATION.md`,
`docs/OSS-ASSET-EVIDENCE-REQUEST.md`, `docs/OSS-RELEASE-BOUNDARY.md`,
`docs/OSS-ROADMAP.md` y los avisos de terceros. Los documentos de dependencias
conservan su valor probatorio histórico, pero señalan explícitamente que el
estado vigente está en este informe.

No se modificaron código de aplicación, consumidores de producción,
dependencias, lockfile, migraciones, Supabase, Vercel, Docker, servicios
externos, `LICENSE`, AGPL ni activos oficiales. La salida `.oss-release/` y las
builds son artefactos locales ignorados, no archivos versionados.

## 8. Decisión final

| Área | Resultado |
| --- | --- |
| Auditoría OSS.1.4-R | `PASS / COMPLETED` |
| Integración | PRs #170, #177, #178 y #179 en `main`; #171 excluido |
| Activos | `RESTRICTED OFFICIAL IDENTITY — RELEASE BOUNDARY VERIFIED` |
| Dependencias | `DEPENDENCY CONDITIONAL GO` |
| Resultado global | **`OSS.1.4 FINAL — CONDITIONAL GO`** |

Las condiciones restantes son estrechas y explícitas: preservar los avisos de
Resvg/MPL y Geist/OFL en cualquier redistribución real, cerrar la procedencia
exacta de Geist y verificar el artefacto sharp/libvips de producción de Vercel o
aprobar formalmente una matriz de plataformas equivalente.

## 9. Handoff

`OSS.1.5` permanece `BLOCKED` por runtime, E2E y backup/restore pendientes.
`OSS.2` permanece `BLOCKED` y no se desbloquea por esta tarea. No se creó
`LICENSE` y AGPL no quedó vigente.

La siguiente tarea permitida es `OSS.1.5.5`, únicamente después de disponer de
un entorno Supabase aislado y autorizado. No iniciar `OSS.1.5.6` antes de cerrar
esa dependencia. No iniciar OSS.2 mientras OSS.1.5 siga bloqueado.

## 10. Comandos de evidencia

```text
npm ls --all
npm run test:oss-release
npm run oss:release:prepare
npm run oss:release:audit -- --output-root .oss-release/lanzo-pos-oss
npm run oss:release:verify -- --output-root .oss-release/lanzo-pos-oss --admin-build .oss-release/admin-build --store-build .oss-release/store-build
git diff --exit-code origin/main...HEAD -- icono/icono.png public/icono.png icono/icono-web.png public/icono-web.png public/pwa-192x192.png public/pwa-512x512.png public/logIcon.svg public/boticon.svg public/log.svg
git diff --exit-code origin/main...HEAD -- src store index.html vite.config.js vite.store.config.js supabase vercel.json .github package.json package-lock.json
git diff --exit-code origin/main...HEAD -- LICENSE
```

Resultado de cierre: la auditoría final está documentada, reproducida y lista
para revisión mediante un PR draft; no se autoriza merge automático, deploy,
release ni tag desde esta tarea.
