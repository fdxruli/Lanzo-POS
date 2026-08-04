# Brand provenance

## Estado

- Fecha de creación: 2026-08-03.
- Repositorio: `fdxruli/Lanzo-POS`.
- Rama de trabajo: `chore/oss-brand-asset-replacement`.
- Responsable del proyecto: `fdxruli`.
- Clasificación: `AI-ASSISTED / PROJECT-GENERATED`.
- Fuente de terceros identificada: `NO THIRD-PARTY SOURCE IDENTIFIED`.
- Alcance: `TRADEMARK-RESERVED`.
- Registro de marca: `NO VERIFICADO`.

La identidad nueva fue creada asistida por Codex bajo instrucciones del
mantenedor. La revisión y aprobación visual humana del mantenedor son
requeridas antes del merge.

## Concepto y proceso

El concepto es **Punto de impulso**: un punto central de origen acompañado por
tres piezas geométricas escalonadas que sugieren avance, lanzamiento y
operación estable. El wordmark LANZO está construido mediante rectángulos,
polígonos, círculos y paths propios; no utiliza el elemento SVG `<text>`.

El proceso no utilizó plantillas, imágenes de referencia, activos externos,
fuentes, bibliotecas de iconos, Google Fonts, bancos de imágenes, Canva, Figma
ni servicios remotos. No se recrearon los diseños reemplazados y no se usaron
PNG antiguos como fuentes de diseño.

## Fuentes canónicas

Las únicas fuentes canónicas son:

- `brand/lanzo-mark.svg` — mark cuadrado para favicon, PWA y maskable.
- `brand/lanzo-wordmark.svg` — wordmark horizontal LANZO.
- `brand/lanzo-assistant.svg` — mark de asistencia abstracta derivado del
  nuevo mark, sin rostro, ojos ni personaje.

Cada SVG es autocontenido, tiene `viewBox`, `<title>` y `<desc>`, y contiene
únicamente geometría creada dentro de esta tarea.

## Generación reproducible

El script `scripts/generate-brand-assets.mjs` lee las tres fuentes, valida que
no contengan texto, imágenes, href, data URI, scripts, fuentes o URLs remotas,
genera los PNG con `sharp` y copia byte a byte los SVG públicos. El modo
`npm run brand:check` no modifica archivos y comprueba fuentes, derivados,
dimensiones, hashes, manifiesto y hashes legacy en las rutas de activos.

El manifiesto reproducible está en `brand/brand-assets.manifest.json`.
La generación usa `sharp@0.34.5`, versión de proceso `1.0.0`, fecha fija de
generación `2026-08-03` y el commit base `0decbc4124fed4e8cda4e807a9a400f7257e3084`.

## Variantes y hashes SHA-256

| Archivo | Dimensiones | SHA-256 | Relación |
| --- | ---: | --- | --- |
| `brand/lanzo-mark.svg` | 64×64 | `7f795d23ae677e12474c7d54bea440f30843229437f3f0827e16cab628dd9a69` | Fuente canónica |
| `brand/lanzo-wordmark.svg` | 360×96 | `aeb2b9ea67d7d34cc47ff22888a3f0547e973413dfb78ddda9a9c79a88454e48` | Fuente canónica |
| `brand/lanzo-assistant.svg` | 64×64 | `7b0e2ade7d87e17386914a84482e29f58afe9276de1b60103b569daf98dcb81f` | Fuente canónica |
| `public/icono-web.png` | 192×192 | `a4912ced146ec234eb78cea531d7e4f0c28c33ca9fdf3dd89173eb1dfc74a091` | PNG generado desde mark |
| `public/pwa-192x192.png` | 192×192 | `a4912ced146ec234eb78cea531d7e4f0c28c33ca9fdf3dd89173eb1dfc74a091` | PNG generado desde mark |
| `public/pwa-512x512.png` | 512×512 | `70d6adbe8fedd786804020c18d5e7dcec8819403b44f72fde19ce084d3817eea` | PNG generado desde mark |
| `public/log.svg` | 360×96 | `aeb2b9ea67d7d34cc47ff22888a3f0547e973413dfb78ddda9a9c79a88454e48` | Copia exacta del wordmark |
| `public/logIcon.svg` | 64×64 | `7f795d23ae677e12474c7d54bea440f30843229437f3f0827e16cab628dd9a69` | Copia exacta del mark |
| `public/boticon.svg` | 64×64 | `7b0e2ade7d87e17386914a84482e29f58afe9276de1b60103b569daf98dcb81f` | Copia exacta del assistant |

Los detalles completos del proceso y de `sharp` están en el manifiesto. La
generación es determinista y no depende de timestamps de ejecución.

## Limitaciones

Esta documentación no afirma copyright exclusivo garantizado, registro
marcario, ausencia absoluta de cualquier semejanza mundial, dictamen legal ni
autoría humana exclusiva. La asistencia de IA forma parte de la procedencia y
por eso la clasificación correcta no es `VERIFIED FIRST-PARTY`.

Los activos anteriores se describen en
`brand/LEGACY-ASSET-NOTICE.md` como:

**SUPERSEDED — NOT PART OF THE CURRENT BRAND ASSET SET**
