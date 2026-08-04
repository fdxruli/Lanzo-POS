# Lanzo-POS — avisos de terceros

## Propósito y decisión revisada

Esta revisión corrige OSS.1.4A.1 sobre la base de
`4aa73e3ef2fb0e4aced3f9bb920e433a7987de92`, sin cambiar dependencias ni
código.

**DEPENDENCY CONDITIONAL GO.** La inspección no encontró un aviso Exhibit B
aplicado a los archivos distribuidos de `@vercel/og` o `satori`. El texto que
había causado el NO-GO aparece solamente dentro de la copia estándar completa
de MPL-2.0. Resvg queda trazado al commit upstream exacto y su defecto de
empaquetado se puede cubrir con este expediente de avisos. Persisten dos
revisiones: coincidencia exacta del hash de la fuente incluida y paquete real
seleccionado por Vercel.

OSS.1.4 completo continúa **BLOCKED** por la procedencia de los activos propios
de Lanzo, que pertenece a OSS.1.4B. Esta clasificación no es una opinión
jurídica absoluta.

## 1. Cadena OG y MPL-2.0

| Paquete | Versión | Evidencia del tarball instalado | Estado MPL |
| --- | ---: | --- | --- |
| `@vercel/og` | 0.11.1 | Tarball npm exacto: 13 archivos, `sha1=985d0350aa57e41985e6d3aae2dff25d2c95cd46`; solo `LICENSE` contiene Exhibit B (3 coincidencias; frase de incompatibilidad: 1). Código, mapas, `package.json`, README y assets: 0 coincidencias. | **MPL STANDARD — no Exhibit B aplicado** |
| `satori` | 0.25.0 | Tarball npm exacto: 20 archivos, `sha1=6d08254afbd4e010cb01a78628ec0101f1e14fa6`; solo `LICENSE` contiene Exhibit B (3 coincidencias; frase de incompatibilidad: 1). Los cuatro `.LEGAL.txt` solo registran CSSesc; código, mapas y metadata: 0 coincidencias. | **MPL STANDARD — no Exhibit B aplicado** |
| `@resvg/resvg-wasm` | 2.4.0 | Tarball exacto de 7 archivos, sin `LICENSE`, `COPYING` ni `NOTICE`; `README.md` enlaza MPLv2.0 y atribuye `Copyright (c) 2021-present, yisibl`. | **MPL STATUS NOT VERIFIED en el tarball; upstream MPL estándar** |

La búsqueda incluyó `package.json`, LICENSE/COPYING/NOTICE, README, archivos
JavaScript/TypeScript/mapas, `.LEGAL.txt`, encabezados SPDX y encabezados de
licencia. En los tres paquetes: `MPL-2.0-no-copyleft-exception` = 0 y
`MPL-1.1` = 0. No se encontró una declaración explícita de incompatibilidad ni
fragmentos MPL copiados por Lanzo.

La conclusión correcta distingue el caso A —Exhibit B como parte del texto
estándar de MPL— del caso B —aviso adjunto al Covered Software—. La evidencia
local solo demuestra A para OG y Satori; no se infiere B desde A.

Al distribuir la función OG se debe conservar el LICENSE MPL completo y los
avisos de los artefactos que realmente entren en el bundle. Los LICENSE reales
de OG y Satori tienen SHA-256
`1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5`.

## 2. Geist-Regular.ttf

Ruta instalada: `node_modules/@vercel/og/dist/Geist-Regular.ttf`.

| Dato | Resultado |
| --- | --- |
| Tamaño | 125,956 bytes |
| SHA-256 | `bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76` |
| Nombre interno | `Geist`, estilo `Regular`, nombre PostScript `Geist-Regular` |
| Copyright interno | `Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)` |
| Versión interna | `Version 1.800; ttfautohint (v1.8.4.16-eb64)` |
| Licencia interna | OFL-1.1, con enlace a `https://openfontlicense.org` |
| Modificación local Lanzo | No hay archivo rastreado ni parche local; el archivo proviene del tarball exacto de OG |

El proyecto oficial [vercel/geist-font](https://github.com/vercel/geist-font)
publica sus fuentes bajo OFL-1.1 y su
[LICENSE.txt](https://github.com/vercel/geist-font/blob/main/LICENSE.txt) exige
conservar copyright y licencia al redistribuirlas. La licencia incluye la
restricción general de Reserved Font Names, pero el texto inspeccionado no
enumera nombres reservados concretos.

La coincidencia exacta no quedó demostrada: el `Geist-Regular.ttf` del head
oficial `10dc7658f13c38a474cde201bb09a4617267545b` mide 126,048 bytes y tiene
SHA-256 `85a1c6b18a6b0a06dfe9fd4f6d6a5d4979f74ec861eaef4bc7868b5492b8a117`.
También se compararon versiones npm `geist` 1.6.0-beta.2, 1.6.0-beta.3,
1.6.0-beta.4, 1.6.0-beta.5, 1.7.0, 1.7.1 y 1.7.2; ninguna coincide con el
hash instalado. Por eso el estado es **OFL-1.1 indicada por metadata interna;
REVIEW REQUIRED para procedencia exacta**, no `VERIFIED THIRD-PARTY`.

Si el bundle distribuye la fuente, debe conservar el copyright de The Geist
Project Authors y el texto completo de OFL-1.1. No se relicencia bajo AGPL.

## 3. Resvg: origen y aviso

`@resvg/resvg-wasm@2.4.0` tiene en el lockfile:

- `resolved`: `https://registry.npmjs.org/@resvg/resvg-wasm/-/resvg-wasm-2.4.0.tgz`;
- `integrity`: `sha512-C7c51Nn4yTxXFKvgh2txJFNweaVcfUPQxwEUFw4aWsCmfiBDJsTSwviIF8EcwjQ6k8bPyMWCl1vw4BdxE569Cg==`;
- `gitHead`: `30ac8d830d44802df7e967569c92edabbbcec017`;
- repositorio declarado: `github.com/yisibl/resvg-js`, actualmente redirigido a
  [`thx/resvg-js`](https://github.com/thx/resvg-js/tree/30ac8d830d44802df7e967569c92edabbbcec017).

El tarball npm descargado tiene SHA-1
`e01164b9a267c822e1ff797daa2fb91b663ea6f0` y SHA-512 igual al `integrity` del
lockfile. Sus siete archivos coinciden byte a byte con `node_modules`. El
commit upstream contiene un `LICENSE` MPL-2.0 de 16,724 bytes, SHA-256
`4b89d4518bd135ab4ee154a7bce722246b57a98c3d7efc1a09409898160c2bd1`, aunque
el `files`/tarball npm no lo incluye. El README upstream identifica el
proyecto y la licencia MPLv2.0.

Esto es un defecto de empaquetado, no ausencia de trazabilidad. El aviso de
Resvg debe acompañar la entrega: atribución `Copyright (c) 2021-present,
yisibl`, MPL-2.0 completo y referencia al commit upstream anterior. Estado:
**PASS WITH NOTICE**, con revisión de que el artefacto final conserve el texto.

## 4. sharp/libvips por plataforma

La instalación local Windows verificó `sharp@0.34.5`, libvips `8.17.3` y
`@img/sharp-win32-x64@0.34.5`, con los archivos:

```text
lib/libvips-42.dll
lib/libvips-cpp-8.17.3.dll
lib/sharp-win32-x64.node
```

`@img/sharp-win32-x64` declara `Apache-2.0 AND LGPL-3.0-or-later`; su README
enumera libvips y otras bibliotecas LGPLv3. Los paquetes Linux
`@img/sharp-linux-x64@0.34.5` y `@img/sharp-libvips-linux-x64@1.2.4` existen
en el lockfile como opcionales, pero no fueron seleccionados ni instalados en
esta captura.

Esto solo es evidencia local Windows. `store/vercel.json` define `npm ci` y
`npm run build:store:vercel`, pero no fija una plataforma/arquitectura de
binario. No hay `.vercel/output/functions` ni un artefacto de función Vercel
accesible en el checkout; los reportes existentes marcan el Build Output real
como no ejecutado. Estado obligatorio: **VERCEL RUNTIME PACKAGE NOT VERIFIED**.

No se afirma que Vercel distribuya el paquete Windows ni que use Linux x64.
Cuando exista un Build Output verificable, habrá que registrar el paquete
`@img/sharp-*`, `@img/sharp-libvips-*`, OS, arquitectura, libc, LICENSE/NOTICE y
forma de inclusión. Mientras tanto, las obligaciones documentadas son
conservar avisos, identificar libvips, permitir reemplazo/relink cuando
corresponda y no imponer restricciones incompatibles con LGPL.

## 5. Estructura técnica de combinación

- `store/api/og/store.js` hace `import('@vercel/og')` dinámico y no importa
  Satori ni Resvg directamente.
- `store/api/_safePublicImage.js` importa `sharp` para normalizar imágenes.
- `scripts/build-store-vercel.mjs` permite la clausura externa aprobada
  `@vercel/og`, `react` y `sharp`, y comprueba que OG y sharp estén en la
  función esperada.
- El tarball de OG contiene JavaScript compilado, mapas, WASM y la fuente; el
  de Satori contiene JavaScript compilado, mapas, WASM y `.LEGAL.txt`. No se
  encontraron fragmentos MPL en el código de Lanzo ni archivos fuente MPL
  modificados por Lanzo.
- `scripts/audit-vercel-build-output.mjs` puede inspeccionar funciones, pero no
  se ejecutó contra un Build Output Vercel existente en esta tarea. No se
  presenta el bundle final como verificado.

## 6. Activos de Lanzo

La procedencia de logos, iconos, portadas, imágenes de producto y demás activos
propios sigue pendiente en `docs/OSS-ASSET-PROVENANCE.md`. Esta tarea no los
resuelve.

## 7. Activos gráficos de identidad

La auditoría de OSS.1.4B no identificó una fuente visual de tercero, plantilla,
biblioteca de iconos, imagen embebida ni fuente externa concreta en los nueve
activos gráficos rastreados. Los SVG son autocontenidos; `public/log.svg` usa la
familia genérica `sans-serif` y no incorpora una fuente. Los tres SVG tienen
uso de IA declarado, pero el proveedor y los términos históricos no están
documentados.

**NO SPECIFIC THIRD-PARTY ASSET IDENTIFIED.** La referencia a `GPT-4o`,
`OpenAI API` y `ChatGPT` encontrada dentro de metadata C2PA de dos PNG identifica
una declaración de procedencia embebida; no identifica un recurso visual de
tercero, una licencia de activo ni una autorización de redistribución.

No se añaden los logos o iconos propios como avisos de terceros. La declaración
de primera parte y sus limitaciones están en
[`docs/OSS-ASSET-DECLARATION.md`](docs/OSS-ASSET-DECLARATION.md); el alcance de
marca está en [`TRADEMARK_POLICY.md`](TRADEMARK_POLICY.md). La conclusión de
activos permanece **ASSET NO-GO**, por lo que OSS.1.4 global permanece
**BLOCKED — NO-GO**.

## 8. Handoff OSS.1.4.2 sobre activos de identidad

La resolución local del inventario confirmó dos estructuras `caBX` C2PA únicas
en tres rutas PNG. Sus assertions declaran `GPT-4o`, `OpenAI API`, `ChatGPT`,
`c2pa-rs 0.51.1` y `trainedAlgorithmicMedia`; también contienen una assertion
de firma y certificados reconocibles, pero no se verificaron firma ni cadena de
confianza. Esto es **AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA**, no
`VERIFIED PROVIDER`, `VERIFIED AUTHOR` ni `VERIFIED THIRD-PARTY`.

Para los PNG con proveedor declarado, y para los tres SVG cuyo proveedor no se
recuerda, los términos históricos no están disponibles en las fuentes
autorizadas: **PROVIDER TERMS NOT AVAILABLE FROM AUTHORIZED EVIDENCE**. La
metadata no identifica un recurso visual de tercero ni concede una licencia de
redistribución. Los SVG son autocontenidos y no incorporan fuentes, imágenes ni
enlaces externos reconocibles; `public/boticon.svg` conserva una derivación
declarada con fuente desconocida.

Resultado de activos: **REDISTRIBUTION NOT CLEARED** para las nueve rutas.
Consultar [`docs/OSS-ASSET-PROVENANCE.md`](docs/OSS-ASSET-PROVENANCE.md) y el
cuestionario [`docs/OSS-ASSET-EVIDENCE-REQUEST.md`](docs/OSS-ASSET-EVIDENCE-REQUEST.md).
