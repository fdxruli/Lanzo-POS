# OSS.1.4A.1 — evidencia corregida de MPL, fuentes, Resvg y runtime

Base: `4aa73e3ef2fb0e4aced3f9bb920e433a7987de92`. Rama autorizada:
`chore/oss-dependency-evidence`. PR: #169.

## Instalación y tarballs exactos

La instalación previa permanece válida: `npm ci --include=optional` exit 0,
`npm ls --all` exit 0 y SBOM SPDX-2.3 válido. No se regeneró el SBOM en esta
subtarea porque no cambió el lockfile ni la instalación.

Los tarballs npm se compararon con `node_modules` usando los `resolved` e
`integrity` del lockfile:

| Paquete | Tarball | Resultado |
| --- | --- | --- |
| `@vercel/og@0.11.1` | 13 archivos; SHA-1 `985d0350aa57e41985e6d3aae2dff25d2c95cd46` | conjunto y contenido instalados idénticos |
| `satori@0.25.0` | 20 archivos; SHA-1 `6d08254afbd4e010cb01a78628ec0101f1e14fa6` | conjunto y contenido instalados idénticos |
| `@resvg/resvg-wasm@2.4.0` | 7 archivos; SHA-1 `e01164b9a267c822e1ff797daa2fb91b663ea6f0` | conjunto y contenido instalados idénticos |

## Exhibit B: búsqueda reproducida

Se inspeccionaron todos los archivos textuales de cada tarball instalado:
LICENSE/COPYING/NOTICE, `package.json`, README, JavaScript, TypeScript,
source maps, `.LEGAL.txt` y metadata. También se buscaron encabezados SPDX,
`MPL-2.0-no-copyleft-exception` y `MPL-1.1`.

| Paquete | Exhibit B | Frase “This Source Code Form…” | Fuera de LICENSE |
| --- | ---: | ---: | ---: |
| `@vercel/og@0.11.1` | 3 en `LICENSE` | 1 en `LICENSE` | 0 |
| `satori@0.25.0` | 3 en `LICENSE` | 1 en `LICENSE` | 0 |
| `@resvg/resvg-wasm@2.4.0` | 0 | 0 | 0 |

Resultado: el texto en OG/Satori es el anexo del LICENSE MPL estándar (caso
A), no un aviso aplicado a archivos Covered Software (caso B). No se encontró
`MPL-2.0-no-copyleft-exception`, `MPL-1.1`, SPDX MPL ni declaración explícita
de incompatibilidad. Clasificación: OG/Satori **MPL STANDARD — no Exhibit B
aplicado**; Resvg **MPL STATUS NOT VERIFIED en el tarball**.

## Geist-Regular.ttf

Archivo: `node_modules/@vercel/og/dist/Geist-Regular.ttf`.

- tamaño: 125,956 bytes;
- SHA-256: `bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76`;
- name table: `Geist`, `Regular`, `Geist Regular`, `Geist-Regular`;
- copyright interno: `Copyright 2024 The Geist Project Authors
  (https://github.com/vercel/geist-font.git)`;
- versión interna: `Version 1.800; ttfautohint (v1.8.4.16-eb64)`;
- licencia interna: OFL-1.1, `https://openfontlicense.org`;
- Reserved Font Names: el LICENSE oficial contiene la restricción OFL, pero no
  enumera nombres concretos.

El repositorio oficial [vercel/geist-font](https://github.com/vercel/geist-font)
y su [LICENSE OFL-1.1](https://github.com/vercel/geist-font/blob/main/LICENSE.txt)
son la referencia de licencia. El hash no coincidió con el head oficial
`10dc7658f13c38a474cde201bb09a4617267545b` ni con las versiones npm `geist`
1.6.0-beta.2–1.7.2 comparadas. Estado: **OFL-1.1 indicada por metadata;
REVIEW REQUIRED para la coincidencia exacta de origen**. No se relicencia bajo
AGPL ni se afirma que el nombre por sí solo pruebe procedencia.

## Resvg

`@resvg/resvg-wasm@2.4.0` declara MPL-2.0, repo
`github.com/yisibl/resvg-js`, `gitHead=30ac8d830d44802df7e967569c92edabbbcec017`,
resolved npm e integrity del lockfile. El commit corresponde al repositorio
[`thx/resvg-js`](https://github.com/thx/resvg-js/tree/30ac8d830d44802df7e967569c92edabbbcec017).

El tarball contiene `index.js`, `index.min.js`, `index.mjs`, `index.d.ts`,
`index_bg.wasm`, `package.json` y README; no contiene LICENSE. El upstream
contiene LICENSE MPL-2.0 de 16,724 bytes, SHA-256
`4b89d4518bd135ab4ee154a7bce722246b57a98c3d7efc1a09409898160c2bd1`.
Clasificación: trazabilidad suficiente para **PASS WITH NOTICE**; el release
de Lanzo debe incluir el texto MPL completo y `Copyright (c) 2021-present,
yisibl`.

## sharp y paquete de producción

La captura local `win32/x64` carga `sharp@0.34.5`,
`@img/sharp-win32-x64@0.34.5` y libvips `8.17.3`, con DLLs
`libvips-42.dll`, `libvips-cpp-8.17.3.dll` y el binding `.node`. Esto no es
evidencia del runtime Vercel.

La configuración de tienda ejecuta `npm ci` y `npm run build:store:vercel`, pero
no fija plataforma, arquitectura o libc. No hay `.vercel/output/functions` ni
artefacto de función accesible; los reportes existentes marcan el Build Output
real como no ejecutado. Estado: **VERCEL RUNTIME PACKAGE NOT VERIFIED**. Los
paquetes `@img/sharp-linux-x64` y `@img/sharp-libvips-linux-x64` del lockfile
son opcionales candidatos, no una selección demostrada.

## Forma de combinación técnica

`store/api/og/store.js` importa dinámicamente `@vercel/og`;
`store/api/_safePublicImage.js` importa `sharp`; Satori y Resvg llegan por la
clausura de OG. El empaquetador restringe y audita esa clausura. No se
encontraron fragmentos MPL copiados en Lanzo, archivos MPL modificados ni
fuentes de esos paquetes rastreadas en Git. Sin Build Output real no se afirma
si el bundle final minifica, copia o mantiene archivos separados; solo se
documenta la estructura fuente y la composición del tarball.

## Resultado operativo

La evidencia elimina el NO-GO basado únicamente en Exhibit B. La salida queda
**DEPENDENCY CONDITIONAL GO**, con revisiones pendientes de Geist, aviso MPL de
Resvg y selección sharp/libvips de Vercel. La procedencia de activos propios de
Lanzo continúa pendiente de OSS.1.4B.
