# Lanzo-POS — avisos de terceros

## Propósito y estado

Este documento registra avisos y obligaciones de las dependencias que pueden
llegar al runtime o a una función distribuida de Lanzo-POS. La evidencia de
esta revisión está en [`docs/OSS-DEPENDENCY-EVIDENCE.md`](docs/OSS-DEPENDENCY-EVIDENCE.md)
y el inventario SPDX en [`docs/sbom.spdx.json`](docs/sbom.spdx.json).

Base verificada: `origin/main` en `81400b41a8788aac1c5c46cb0c0c9ad707524cfa`.
La instalación reproducible se hizo con `npm ci --include=optional`, sin
modificar manifests ni dependencias. `package.json` no declara una licencia
OSS adoptada para Lanzo-POS; AGPL-3.0-only sigue siendo una propuesta y no se
crea una `LICENSE` en esta tarea.

Este documento no es una certificación jurídica. Cuando se indica
**sin conflicto evidente identificado**, significa solamente que la evidencia
local no demostró un conflicto; no sustituye la revisión del titular.

## Decisión de esta revisión

**DEPENDENCY NO-GO para cerrar formalmente el bloque de dependencias.**

La razón es material y acotada: los LICENSE reales de `@vercel/og` y `satori`
contienen el aviso Exhibit B de MPL-2.0, `@resvg/resvg-wasm` declara MPL-2.0
pero no trae un LICENSE/COPYING/NOTICE independiente, y la fuente incluida en
`@vercel/og` no tiene un aviso de licencia separado. La cadena Windows de
`sharp` también requiere distribuir correctamente el aviso compuesto del
binario precompilado y sus componentes LGPL.

No se afirma que exista incompatibilidad jurídica definitiva. Los elementos
anteriores quedan como **BLOCKER/REVIEW REQUIRED** antes de una distribución
formal. OSS.1.4 completo continúa **BLOCKED** además por la procedencia de
logos, iconos y otros activos, que pertenece a OSS.1.4B.

## 1. Runtime distribuido

Las funciones de la tienda importan `@vercel/og` y `sharp`; por tanto la
clausura material incluye sus dependencias transitivas aunque el bundle se
genere fuera de Git. Los demás paquetes runtime directos permanecen
inventariados por `package-lock.json` y el SBOM; sus avisos deben acompañar
cualquier entrega si sus archivos entran en el artefacto.

| Paquete y versión | Licencia declarada | Evidencia local verificada | Obligación/estado |
| --- | --- | --- | --- |
| `@vercel/og@0.11.1` | MPL-2.0 | `node_modules/@vercel/og/LICENSE` (MPL completo, SHA-256 `1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5`); no hay NOTICE | Conservar LICENSE y avisos; Exhibit B presente; **BLOCKER/REVIEW REQUIRED** |
| `satori@0.25.0` | MPL-2.0 | `node_modules/satori/LICENSE` (mismo texto/hash MPL que OG); no hay NOTICE | Dependencia de OG; conservar LICENSE; Exhibit B presente; **BLOCKER/REVIEW REQUIRED** |
| `@resvg/resvg-wasm@2.4.0` | MPL-2.0 | `node_modules/@resvg/resvg-wasm/package.json`; README enlaza MPLv2.0 y atribuye `Copyright (c) 2021-present, yisibl`; no hay LICENSE/COPYING/NOTICE | Obtener/conservar el texto y aviso requerido del paquete antes de distribuir; **REVIEW REQUIRED** |
| `sharp@0.34.5` | Apache-2.0 | `node_modules/sharp/LICENSE` (Apache-2.0 completo, SHA-256 `73ba74dfaa520b49a401b5d21459a8523a146f3b7518a833eea5efa85130bf68`); no hay NOTICE | Conservar LICENSE y avisos Apache; revisar la clausura binaria; **REVIEW REQUIRED** |

Los paquetes runtime directos adicionales y sus expresiones declaradas en el
lockfile son: `@fingerprintjs/fingerprintjs@5.0.1` (MIT), `@google/genai@1.50.1`
(Apache-2.0), `@react-oauth/google@0.13.5` (MIT), `@supabase/supabase-js@2.86.0`
(MIT), `@zxing/library@0.21.3` (MIT), `big.js@7.0.1` (MIT), `dexie@4.4.3`
(Apache-2.0), `dexie-export-import@4.4.0` (Apache-2.0),
`dexie-react-hooks@4.2.0` (Apache-2.0), `es-toolkit@1.46.0` (MIT),
`lucide-react@0.553.0` (ISC), `react@19.2.0` (MIT), `react-dom@19.2.0` (MIT),
`react-hot-toast@2.6.0` (MIT), `react-router-dom@7.13.0` (MIT),
`react-virtualized-auto-sizer@1.0.26` (MIT), `react-window@2.2.3` (MIT),
`react-zxing@2.1.0` (MIT), `recharts@3.8.1` (MIT), `zod@4.1.13` (MIT) y
`zustand@5.0.8` (MIT). Sus LICENSE/NOTICE individuales no se copiaron de
forma indiscriminada en este documento; deben conservarse desde los tarballs
exactos cuando formen parte de la entrega.

## 2. Cadena OG: MPL-2.0, Resvg y fuentes

`@vercel/og@0.11.1` depende exactamente de `satori@0.25.0` y
`@resvg/resvg-wasm@2.4.0`. Los LICENSE de OG y Satori contienen literalmente
la sección **Exhibit B — “Incompatible With Secondary Licenses”** y el aviso
de que el Source Code Form es incompatible con Secondary Licenses. El uso
observado es desde `node_modules`, sin modificaciones locales de esos archivos
por Lanzo; no se encontró ningún archivo equivalente rastreado en el repo.

El paquete OG instala `dist/Geist-Regular.ttf` (125,956 bytes; SHA-256
`bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76`). No trae
LICENSE/NOTICE separado para esa fuente. Además, el README instalado afirma que
la fuente incluida por defecto es Noto Sans, mientras el archivo instalado se
llama `Geist-Regular.ttf`. La identidad, licencia y procedencia de esa fuente
quedan **REVIEW REQUIRED**; no se debe tratar como un activo de marca autorizado
por la licencia del código MPL.

Al distribuir la función OG se deben conservar los textos completos de MPL y
los avisos aplicables del bundle. Este PR registra las rutas y hashes, pero no
vende ni versiona `node_modules` ni copia cientos de licencias completas.

## 3. Cadena sharp/libvips

En el entorno de verificación Windows `win32/x64`, `require('sharp')` cargó:

- `sharp@0.34.5`, declarado Apache-2.0;
- libvips `8.17.3`;
- `@img/sharp-win32-x64@0.34.5`, opcional y realmente instalado;
- `lib/libvips-42.dll`, `lib/libvips-cpp-8.17.3.dll` y
  `lib/sharp-win32-x64.node`.

`@img/sharp-win32-x64` declara `Apache-2.0 AND LGPL-3.0-or-later`. Su
LICENSE local contiene el texto Apache-2.0, mientras su README enumera
`libvips` y varias bibliotecas bajo LGPLv3 y explica que se usa la cláusula de
"any later version" de LGPLv2/LGPLv2.1. No se instaló un paquete separado
`@img/sharp-libvips-win32-x64`; en esta plataforma libvips está dentro del
paquete Windows seleccionado. Los paquetes `@img/sharp-libvips-*` de otras
plataformas aparecen como opcionales en el lockfile, pero no son el binario
seleccionado en esta instalación.

No se debe mezclar la licencia upstream que el README describe para libvips
con la declaración npm `LGPL-3.0-or-later` sin conservar ambas evidencias. La
entrega del bundle o función debe incluir el README/LICENSE aplicable y el
expediente de fuentes/correspondencia exigible para el componente LGPL.

## 4. Build y desarrollo

Las herramientas de `devDependencies` (`vite`, `vitest`, ESLint, Testing
Library, JSDOM, plugin PWA y sus transitivas) están en el SBOM. No se
identifican por sí solas como runtime público. Si un build copia una
transitiva, un source map, Workbox o un asset al artefacto distribuido, sus
avisos deben incorporarse al mismo expediente. No se ejecutó build ni prueba
de interfaz en esta tarea.

## 5. Datos y licencias de contenido

El SBOM y el lockfile también contienen expresiones que no deben normalizarse
a MIT: `caniuse-lite` (CC-BY-4.0), `argparse` (Python-2.0), BlueOak-1.0.0,
`(AFL-2.1 OR BSD-3-Clause)`, `(Unlicense OR Apache-2.0)`, `(MIT OR CC0-1.0)` y
`MIT AND ISC`. Deben conservarse sus operadores y atribuciones exactos si
entran en un artefacto distribuido.

## 6. Activos de marca pendientes de OSS.1.4B

Los activos rastreados siguen inventariados en
[`docs/OSS-ASSET-PROVENANCE.md`](docs/OSS-ASSET-PROVENANCE.md). Esta tarea no
resuelve autoría, permiso, licencia o procedencia de logos, iconos, portadas,
fuentes de marca ni imágenes de producto. Que una URL sea pública no prueba
permiso de reutilización.

## 7. Requisito de entrega

Antes de un release, el responsable debe adjuntar los LICENSE/COPYING/NOTICE
completos de los componentes materiales, el aviso de la fuente incluida y la
explicación de distribución de los binarios de sharp/libvips. Esta revisión no
crea `LICENSE`, no modifica dependencias y no autoriza despliegues.
