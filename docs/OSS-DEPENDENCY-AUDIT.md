# OSS.1.4A.1 — auditoría corregida de MPL y runtime

Fecha: 2026-08-03. Repositorio: `fdxruli/Lanzo-POS`.
Base: `4aa73e3ef2fb0e4aced3f9bb920e433a7987de92` sobre la rama existente
`chore/oss-dependency-evidence`.

## 1. Conclusión revisada

La conclusión anterior era **DEPENDENCY NO-GO** porque trataba la presencia
del texto Exhibit B en un LICENSE MPL estándar como si fuera un aviso aplicado
al Covered Software. Esa inferencia era demasiado conservadora y queda
corregida.

La evidencia de los tarballs exactos muestra que Exhibit B aparece únicamente
en `LICENSE` de `@vercel/og@0.11.1` y `satori@0.25.0`; no aparece en código,
mapas, metadata, README, `.LEGAL.txt` ni otro archivo distribuido. La
clasificación para ambos es **MPL STANDARD — no Exhibit B aplicado**. No se
afirma compatibilidad jurídica absoluta.

La nueva conclusión es **DEPENDENCY CONDITIONAL GO**:

- no hay Exhibit B aplicado demostrado ni incompatibilidad MPL evidente;
- Resvg queda vinculado al tarball y al `gitHead` upstream, con defecto de
  empaquetado que exige conservar el LICENSE MPL completo;
- la fuente declara OFL-1.1 en su metadata interna, pero su hash no coincide
  con las versiones oficiales muestreadas y queda `REVIEW REQUIRED`;
- el paquete sharp/libvips real de Vercel no está identificado: queda
  `VERCEL RUNTIME PACKAGE NOT VERIFIED`.

El GO definitivo requiere cerrar la procedencia exacta de Geist, conservar los
avisos de Resvg y obtener un Build Output Vercel verificable o una matriz de
plataformas aprobada. OSS.1.4 completo sigue **BLOCKED** por activos de Lanzo;
ese trabajo pertenece a OSS.1.4B.

## 2. Exhibit B: hechos y conteos

| Paquete | Archivos inspeccionados | Coincidencias en LICENSE | Código/metadata/avisos | Estado |
| --- | --- | ---: | ---: | --- |
| `@vercel/og@0.11.1` | 13 archivos del tarball; `LICENSE`, `package.json`, README, JS, mapas, WASM y TTF | `Exhibit B` = 3; frase completa = 1 | 0 `Exhibit B`; 0 `MPL-2.0-no-copyleft-exception`; 0 SPDX MPL | MPL STANDARD — no aplicado |
| `satori@0.25.0` | 20 archivos; además cuatro `dist/*.LEGAL.txt` | `Exhibit B` = 3; frase completa = 1 | 0 en código/mapas/LEGAL; LEGAL solo CSSesc | MPL STANDARD — no aplicado |
| `@resvg/resvg-wasm@2.4.0` | 7 archivos del tarball | 0 en tarball | package metadata MPL; README MPLv2.0; sin LICENSE local | MPL STATUS NOT VERIFIED en tarball; upstream estándar |

En los tres paquetes no hubo coincidencias locales de
`MPL-2.0-no-copyleft-exception` ni `MPL-1.1`. El texto de Exhibit B en el
LICENSE estándar describe una opción de la licencia; no es por sí solo una
decisión del titular aplicada a cada archivo distribuido.

## 3. Procedencia y licencia de Geist

Archivo: `node_modules/@vercel/og/dist/Geist-Regular.ttf`.

- Tamaño: 125,956 bytes.
- SHA-256: `bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76`.
- Name table: family `Geist`, style `Regular`, PostScript `Geist-Regular`.
- Copyright: `Copyright 2024 The Geist Project Authors
  (https://github.com/vercel/geist-font.git)`.
- Metadata de versión: `Version 1.800; ttfautohint (v1.8.4.16-eb64)`.
- Metadata de licencia: OFL-1.1, enlace `https://openfontlicense.org`.

La fuente oficial de Geist está en
[`vercel/geist-font`](https://github.com/vercel/geist-font), cuyo LICENSE
declara OFL-1.1. Se comparó el hash instalado con el head oficial y con las
versiones npm `geist` 1.6.0-beta.2 a 1.7.2; no hubo coincidencia exacta.
Por eso no se etiqueta `VERIFIED THIRD-PARTY`: queda **REVIEW REQUIRED** para
probar el commit o release exacto de origen. El aviso OFL y copyright deben
acompañar cualquier bundle que la incluya; no se relicencia bajo AGPL.

## 4. Resvg: trazabilidad cerrada con aviso pendiente

Para `@resvg/resvg-wasm@2.4.0`:

- resolved: `https://registry.npmjs.org/@resvg/resvg-wasm/-/resvg-wasm-2.4.0.tgz`;
- integrity: `sha512-C7c51Nn4yTxXFKvgh2txJFNweaVcfUPQxwEUFw4aWsCmfiBDJsTSwviIF8EcwjQ6k8bPyMWCl1vw4BdxE569Cg==`;
- gitHead: `30ac8d830d44802df7e967569c92edabbbcec017`;
- upstream: [`thx/resvg-js` en ese commit](https://github.com/thx/resvg-js/tree/30ac8d830d44802df7e967569c92edabbbcec017);
- tarball SHA-1: `e01164b9a267c822e1ff797daa2fb91b663ea6f0`;
- tarball: 7 archivos, todos coinciden byte a byte con node_modules;
- upstream LICENSE: MPL-2.0, SHA-256
  `4b89d4518bd135ab4ee154a7bce722246b57a98c3d7efc1a09409898160c2bd1`.

El npm package omitió el LICENSE del upstream. Esto se clasifica como
**PASS WITH NOTICE**, no como paquete sin licencia verificable: el origen,
commit y licencia están vinculados, pero el texto MPL completo debe conservarse
en los avisos de distribución.

## 5. Combinación técnica

La fuente de Lanzo solo importa directamente `@vercel/og` y `sharp` en la
función OG; Satori y Resvg llegan como dependencias de OG. El empaquetador
`scripts/build-store-vercel.mjs` restringe la clausura permitida y comprueba
OG/sharp. No se encontraron fragmentos MPL copiados, modificaciones locales ni
fuentes MPL rastreadas por Lanzo.

La evidencia local demuestra estructura de dependencias, no una conclusión
legal de “Larger Work”. Los tarballs contienen artefactos compilados y mapas;
no se encontró un aviso Exhibit B aplicado a esos artefactos.

## 6. sharp/libvips y Vercel

La captura local Windows `win32/x64` carga:

- `sharp@0.34.5`;
- `@img/sharp-win32-x64@0.34.5`;
- libvips `8.17.3`;
- `libvips-42.dll`, `libvips-cpp-8.17.3.dll` y `sharp-win32-x64.node`.

La configuración de tienda ejecuta `npm ci` y `npm run build:store:vercel`,
pero no fija OS, arquitectura o libc. No existe `.vercel/output/functions`
accesible en el checkout y los reportes existentes documentan que el Build
Output real no se ejecutó. Por tanto el paquete de producción queda
**VERCEL RUNTIME PACKAGE NOT VERIFIED**. Los paquetes Linux x64 del lockfile
son candidatos opcionales, no evidencia de selección por Vercel.

Las obligaciones observadas son conservar avisos, identificar sharp/adaptador/
libvips por separado, permitir reemplazo o relink cuando corresponda y no
imponer restricciones contrarias a LGPL. No se afirma incompatibilidad
automática LGPL/AGPL.

## 7. Archivos no modificados y límites

No se modificaron `package.json`, `package-lock.json`, `store/package.json`,
`src/**`, `store/**`, `public/**`, `supabase/**`, `scripts/**`, `.github/**`,
configuraciones ni `LICENSE`. No se regeneró el SBOM porque la evidencia no
cambió la instalación. No se hizo deployment, preview manual, consulta o
cambio de variables de producción. Los activos de Lanzo siguen pendientes en
OSS.1.4B.

## 8. Bloqueantes y revisiones restantes

- **REVIEW REQUIRED:** demostrar el commit/release oficial exacto de
  `Geist-Regular.ttf` o conservar una justificación de procedencia aprobada.
- **REVIEW REQUIRED:** incluir el LICENSE MPL de Resvg que falta del tarball.
- **REVIEW REQUIRED:** identificar el paquete sharp/libvips del artefacto real
  de Vercel; hasta entonces, `VERCEL RUNTIME PACKAGE NOT VERIFIED`.
- **BLOCKER global OSS.1.4:** procedencia/licencia de activos propios de Lanzo,
  fuera de esta tarea y pendiente de OSS.1.4B.

## 9. Registro histórico de OSS.1.4B — conclusión de activos

Las conclusiones que siguen describen el estado anterior al reemplazo de
OSS.1.4B-R y se conservan como evidencia histórica.

La revisión de activos gráficos se completó sobre `origin/main` en el commit
`19f4087bf23b2920154fb72bd6417a4509508ac0`. La declaración del mantenedor
selecciona la Opción 3 y los PNG materiales de identidad permanecen
`UNKNOWN`; los SVG con IA permanecen `REVIEW REQUIRED` por proveedor y
términos históricos no documentados.

- Conclusión de dependencias: **DEPENDENCY CONDITIONAL GO**; esta conclusión no
  cambia en OSS.1.4B.
- Conclusión de activos: **ASSET NO-GO**.
- Conclusión global OSS.1.4: **BLOCKED — NO-GO**.
- La evidencia completa está en
  [`docs/OSS-ASSET-PROVENANCE.md`](OSS-ASSET-PROVENANCE.md) y la política de
  marca en [`TRADEMARK_POLICY.md`](../TRADEMARK_POLICY.md).
- AGPL continúa sin activarse y no se crea `LICENSE`.

## 10. Cierre vigente después de OSS.1.4B-R

El PR #170 está fusionado y `origin/main` vigente es
`0decbc4124fed4e8cda4e807a9a400f7257e3084`. La conclusión de dependencias no
cambia: **DEPENDENCY CONDITIONAL GO**. La sustitución de identidad completó
la parte de activos: **ASSET CONDITIONAL GO** y **OSS.1.4 COMPLETE —
CONDITIONAL GO**, condicionado a la aprobación visual del mantenedor antes del
merge. AGPL sigue prevista, no vigente; no se creó `LICENSE`.
