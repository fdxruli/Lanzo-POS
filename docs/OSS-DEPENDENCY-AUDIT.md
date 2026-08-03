# OSS.1.4 — Auditoría de dependencias y licencias

Fecha del inventario: 2026-08-03. Repositorio: `fdxruli/Lanzo-POS`.
Base auditada: `origin/main` en `0315e20b0b57038d7a747c9cfd2920e17537159c`.

## 1. Resumen ejecutivo

Esta auditoría inspeccionó los manifiestos rastreados, el lockfile, el grafo de
dependencias, las importaciones de producción, las herramientas de build/test,
los workflows y los artefactos generados que pueden llegar a una entrega.

Resultado documental: **BLOCKED — NO-GO para cerrar OSS.1.4**.

No se identificó una licencia de dependencia declarada como claramente
incompatible con la licencia prevista AGPL-3.0-only. Sí existen asuntos que
requieren revisión humana antes de una adopción formal:

- `@vercel/og` y su cadena `satori`/`@resvg/resvg-wasm` declaran MPL-2.0 y
  forman parte de la función de generación de imágenes OG.
- `sharp` declara Apache-2.0, pero su árbol incluye binarios opcionales de
  libvips bajo LGPL-3.0-or-later.
- Los archivos de marca e iconografía rastreados no tienen un expediente de
  autoría, permiso o licencia verificable en el repositorio.
- `npm ci`, `npm ls --all` y `npm sbom` no pudieron completarse con el
  `node_modules` disponible; el lockfile sí pudo auditarse directamente.

La expresión correcta para la compatibilidad preliminar es **sin conflicto
evidente identificado**, no “jurídicamente compatible”. AGPL-3.0-only sigue
siendo una licencia prevista y no está vigente en este árbol.

## 2. Alcance

Se revisaron:

- `package.json`, `package-lock.json` y `store/package.json`;
- configuraciones que importan paquetes;
- workflows de `.github/workflows/`;
- código fuente y funciones generadas por scripts;
- dependencias directas, ubicaciones transitivas y fuentes resueltas;
- licencias declaradas en `package-lock.json` y metadatos exactos del registro
  npm para las dependencias directas y expresiones materiales;
- historial alcanzable para autores, committers, trailers y señales de agentes.

No se modificaron manifiestos, lockfiles, código productivo, configuración,
Supabase, Vercel ni historial. La auditoría no es asesoramiento jurídico.

## 3. Metodología

La evidencia principal fue local: lockfile v3, manifiestos, código importador,
historial Git y archivos rastreados. Para complementar el lockfile se consultó
el metadato de versión exacta del registro npm cuando el paquete directo no
estaba disponible localmente.

Se marcaron como `REVIEW REQUIRED` las cadenas con MPL/LGPL, licencias de
contenido o expresiones no triviales, y cualquier evidencia que requiera
confirmación de avisos o derechos. No se infirió compatibilidad jurídica a
partir de un campo SPDX aislado.

## 4. Entorno utilizado

| Elemento | Evidencia |
| --- | --- |
| Node.js | `v24.18.1` |
| npm | `11.16.0` |
| Plataforma | Windows |
| Fecha | `2026-08-03` |
| Base | `origin/main` = `0315e20b0b57038d7a747c9cfd2920e17537159c` |
| `npm ci` | Intentado; agotó el límite y después falló al limpiar un `node_modules` parcial (`ENOTEMPTY`) |
| `npm ls --all` | No reproducible con el árbol parcial; reportó paquetes `missing`, `invalid` y `extraneous` |
| `npm sbom --sbom-format=spdx` | Falló con `ESBOMPROBLEMS`; no se conservó un SBOM vacío o inválido |

El fallo de instalación es una limitación del entorno, no evidencia de que el
lockfile esté roto. No se ejecutó `npm install`, `npm update` ni `npm audit fix`.

## 5. Manifiestos inspeccionados

| Manifiesto | Función | Lockfile | Dependencias directas | Observaciones |
| --- | --- | --- | --- | --- |
| `package.json` | Aplicación administrativa, PWA pública, build y pruebas | `package-lock.json`, lockfile v3 | 23 runtime; 17 development | Todos los rangos son `^`; no hay `file:`, Git URL ni registro alternativo |
| `package-lock.json` | Resolución reproducible del proyecto raíz | Sí, v3 | 773 ubicaciones de paquetes; 729 nombres únicos; 763 pares nombre-versión | Todas las entradas resueltas inspeccionadas apuntan al registro npm |
| `store/package.json` | Alcance de runtime Git para funciones/tienda | No | 0 | `private: true`; no declara dependencias propias |

No se encontraron otros `package.json`, lockfiles Yarn/pnpm/Bun o
`npm-shrinkwrap` rastreados. Las configuraciones que importan paquetes son
`vite.config.js`, `vite.store.config.js` y `eslint.config.js`.

Los tres workflows rastreados usan acciones externas versionadas: `actions/checkout@v4`,
`actions/setup-node@v4` y `actions/upload-artifact@v4`. Son componentes de CI,
no dependencias del bundle de aplicación, pero deben permanecer dentro del
inventario de procedencia de automatización.

## 6. Conteos de dependencias

| Conteo | Resultado |
| --- | ---: |
| Directas runtime | 23 |
| Directas development | 17 |
| Entradas de paquete en lockfile, sin raíz | 773 |
| Paquetes transitivos únicos por nombre | 729 |
| Pares únicos nombre-versión | 763 |
| Expresiones de licencia únicas en el lockfile | 18 |
| Fuentes locales o Git URL en lockfile | 0 |
| Rangos `*`, `latest` o sin fijación declarada | 0 |
| Entradas con `os`/`cpu` | 73 |
| Paquetes con `hasInstallScript` | 4 |

Los rangos de manifiesto no están fijados por sí solos; la resolución concreta
queda fijada por el lockfile. Ejemplos de resolución distinta del mínimo
declarado: `dexie` `4.4.3` desde `^4.3.0` y `react-router-dom` `7.13.0` desde
`^7.9.6`.

## 7. Dependencias directas

`Lic/NOTICE` significa la ruta esperada dentro del paquete instalado. La
instalación no quedó disponible de forma confiable, por lo que la existencia y
el contenido de esos archivos locales se marca **NV (no verificado)**. La
licencia de la tabla proviene del campo del lockfile; el registro npm se usó
como corroboración cuando respondió.

### Runtime

| Paquete | Resuelto | Uso observado | Licencia | Lic/NOTICE | Bundle y clasificación |
| --- | ---: | --- | --- | --- | --- |
| `@fingerprintjs/fingerprintjs` | 5.0.1 | fingerprint/licenciamiento admin | MIT | NV | Admin; PASS WITH NOTES |
| `@google/genai` | 1.50.1 | servicios de IA admin | Apache-2.0 | NV | Admin; PASS WITH NOTES |
| `@react-oauth/google` | 0.13.5 | OAuth/Drive admin | MIT | NV | Admin; PASS WITH NOTES |
| `@supabase/supabase-js` | 2.86.0 | cliente cloud admin y público | MIT | NV | Admin/PWA; PASS WITH NOTES |
| `@vercel/og` | 0.11.1 | `store/api/og/store.js` | MPL-2.0 | NV | Función generada; REVIEW REQUIRED |
| `@zxing/library` | 0.21.3 | scanner y QR | MIT | NV | Admin/PWA; PASS WITH NOTES |
| `big.js` | 7.0.1 | cálculos compartidos | MIT | NV | Según ruta importadora; PASS WITH NOTES |
| `dexie` | 4.4.3 | IndexedDB | Apache-2.0 | NV | Admin/PWA; PASS WITH NOTES |
| `dexie-export-import` | 4.4.0 | backup local | Apache-2.0 | NV | Admin; PASS WITH NOTES |
| `dexie-react-hooks` | 4.2.0 | hooks IndexedDB | Apache-2.0 | NV | Admin/PWA; PASS WITH NOTES |
| `es-toolkit` | 1.46.0 | utilidades compartidas | MIT | NV | Según ruta importadora; PASS WITH NOTES |
| `lucide-react` | 0.553.0 | iconos SVG runtime | ISC | NV | Admin/PWA; atribución/aviso; PASS WITH NOTES |
| `react` | 19.2.0 | UI | MIT | NV | Admin/PWA; PASS WITH NOTES |
| `react-dom` | 19.2.0 | UI | MIT | NV | Admin/PWA; PASS WITH NOTES |
| `react-hot-toast` | 2.6.0 | notificaciones | MIT | NV | Según ruta importadora; PASS WITH NOTES |
| `react-router-dom` | 7.13.0 | routing | MIT | NV | Admin/PWA; PASS WITH NOTES |
| `react-virtualized-auto-sizer` | 1.0.26 | layout admin | MIT | NV | Admin; PASS WITH NOTES |
| `react-window` | 2.2.3 | listas admin | MIT | NV | Admin; PASS WITH NOTES |
| `react-zxing` | 2.1.0 | cámara/scanner | MIT | NV | Admin; PASS WITH NOTES |
| `recharts` | 3.8.1 | gráficos admin | MIT | NV | Admin; PASS WITH NOTES |
| `sharp` | 0.34.5 | normalización WebP en OG | Apache-2.0 | NV | Función generada; REVIEW REQUIRED por libvips |
| `zod` | 4.1.13 | validación compartida | MIT | NV | Admin/PWA/functions; PASS WITH NOTES |
| `zustand` | 5.0.8 | estado compartido | MIT | NV | Admin/PWA; PASS WITH NOTES |

### Development, build y test

| Paquete | Resuelto | Función | Licencia | Lic/NOTICE | Clasificación |
| --- | ---: | --- | --- | --- | --- |
| `@eslint/js` | 9.39.3 | configuración lint | MIT | NV | PASS WITH NOTES; metadato registry no respondió en una consulta |
| `@testing-library/jest-dom` | 6.9.1 | assertions | MIT | NV | Desarrollo; PASS WITH NOTES |
| `@testing-library/react` | 16.3.2 | pruebas UI | MIT | NV | Desarrollo; PASS WITH NOTES |
| `@testing-library/user-event` | 14.6.1 | pruebas interacción | MIT | NV | Desarrollo; PASS WITH NOTES |
| `@types/react` | 19.2.4 | tipos | MIT | NV | Desarrollo; PASS WITH NOTES |
| `@types/react-dom` | 19.2.3 | tipos | MIT | NV | Desarrollo; PASS WITH NOTES |
| `@vitejs/plugin-react` | 5.1.1 | build | MIT | NV | Build; PASS WITH NOTES |
| `eslint` | 9.39.3 | lint | MIT | NV | Desarrollo; PASS WITH NOTES |
| `eslint-plugin-react` | 7.37.5 | lint | MIT | NV | Desarrollo; PASS WITH NOTES |
| `eslint-plugin-react-hooks` | 7.0.1 | lint | MIT | NV | Desarrollo; PASS WITH NOTES |
| `eslint-plugin-react-refresh` | 0.4.24 | lint | MIT | NV | Desarrollo; PASS WITH NOTES |
| `fake-indexeddb` | 6.2.5 | pruebas IndexedDB | Apache-2.0 | NV | Test; PASS WITH NOTES |
| `globals` | 16.5.0 | configuración lint | MIT | NV | Desarrollo; PASS WITH NOTES |
| `jsdom` | 28.1.0 | entorno DOM test | MIT | NV | Test; PASS WITH NOTES |
| `vite` | 7.2.2 | build/dev server | MIT | NV | Build; PASS WITH NOTES |
| `vite-plugin-pwa` | 1.2.0 | Workbox/PWA build admin | MIT | NV | Build; PASS WITH NOTES |
| `vitest` | 4.0.14 | pruebas | MIT | NV | Test; PASS WITH NOTES |

## 8. Clasificación de licencias

El lockfile declara estas 18 expresiones, contando ubicaciones duplicadas por
separado en el conteo: MIT (627), Apache-2.0 (43), ISC (35), BSD-3-Clause
(20), BSD-2-Clause (13), BlueOak-1.0.0 (8), LGPL-3.0-or-later (10), MPL-2.0
(3), MIT-0 (2), 0BSD (1), CC-BY-4.0 (1), CC0-1.0 (1), Python-2.0 (1),
`(AFL-2.1 OR BSD-3-Clause)` (1), `(Unlicense OR Apache-2.0)` (1),
`(MIT OR CC0-1.0)` (1), `MIT AND ISC` (1) y tres expresiones combinadas que
incluyen Apache-2.0/LGPL-3.0-or-later.

Clasificación preliminar:

- Permisivas o con aviso: MIT, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause,
  0BSD, MIT-0 y BlueOak-1.0.0.
- Copyleft o aviso especial: MPL-2.0 y LGPL-3.0-or-later.
- Contenido o datos: CC-BY-4.0, CC0-1.0 y `caniuse-lite`.
- Dual/múltiple: expresiones con `OR` y `AND` arriba enumeradas.
- No declaradas: **0 en el lockfile**. La verificación de archivos LICENSE y
  NOTICE del paquete instalado sigue pendiente.

## 9. Componentes transitivos relevantes

### MPL-2.0

La cadena `@vercel/og@0.11.1` → `satori@0.25.0` y
`@resvg/resvg-wasm@2.4.0` es relevante porque el código de
`store/api/og/store.js` se empaqueta para una función pública. Deben
conservarse avisos/licencias, comprobar el contenido font/asset incluido y
revisar las obligaciones si algún archivo del componente se modifica. No se
detectó modificación local de esos paquetes.

### LGPL-3.0-or-later en la cadena de `sharp`

`sharp@0.34.5` usa paquetes opcionales `@img/sharp-libvips-*@1.2.4` para
plataformas concretas. El lockfile declara LGPL-3.0-or-later para libvips y
expresiones combinadas Apache/LGPL para algunos adaptadores. La plataforma
real seleccionada depende del entorno de build/deploy. Se requiere conservar
el aviso y revisar la forma de distribución de la función antes de afirmar
compatibilidad definitiva.

### Datos y licencias no software

`caniuse-lite@1.0.30001754` declara CC-BY-4.0. Debe tratarse como datos con
atribución, no como código MIT. `argparse@2.0.1` declara Python-2.0; su uso es
transitivo de tooling. Las licencias duales deben conservar su operador y no
normalizarse a una sola etiqueta.

### BlueOak y expresiones múltiples

`glob`, `minimatch`, `jackspeak`, `package-json-from-dist`, `path-scurry` y
dos ubicaciones de `lru-cache` declaran BlueOak-1.0.0. También aparecen
`json-schema` con `(AFL-2.1 OR BSD-3-Clause)`, `@zxing/text-encoding` con
`(Unlicense OR Apache-2.0)`, `type-fest` con `(MIT OR CC0-1.0)` y
`victory-vendor` con `MIT AND ISC`. No son bloqueantes por sí mismos, pero
requieren que el aviso final conserve la expresión exacta.

## 10. Código vendorizado o generado

No se encontraron archivos rastreados con nombres `vendor`, `bundle`,
`*.min.js`, `workbox-*`, polyfills copiados, source maps o `dist/` generado.
El `.gitignore` excluye `dist/`, `dist-store/` y
`store/generated/storeHtmlTemplate.js`.

El código fuente sí contiene generadores y auditores bajo `scripts/`. En
particular, `scripts/generate-store-html-template.mjs` produce un módulo
marcado “Generated from dist-store/index.html. Do not edit manually”. Es
regenerable y no está rastreado. Las funciones de `store/api/` se empaquetan
por scripts y pueden incorporar `@vercel/og`, `react` y `sharp`; por eso esas
licencias se consideran materialmente distribuidas aunque el bundle no viva
en Git.

Los workflows usan acciones externas (`checkout`, `setup-node`,
`upload-artifact`) y deben mantenerse con su referencia/versionado y avisos
correspondientes en la documentación de CI.

## 11. Obligaciones de avisos

- MIT/ISC/BSD/Apache: conservar texto de licencia y avisos aplicables en el
  artefacto de distribución; para Apache comprobar además `NOTICE`.
- MPL-2.0: conservar licencia y avisos; revisar modificaciones por archivo y
  la entrega de fuente correspondiente si aplica.
- LGPL-3.0-or-later: revisar la distribución de los binarios de libvips,
  avisos, fuente/correspondencia y la separación de la obra que los utiliza.
- CC-BY-4.0: dar atribución a `caniuse-lite` según su aviso, separada de las
  licencias de software.
- Paquetes con licencia dual/múltiple: conservar la expresión y revisar cada
  componente material; no afirmar una elección no documentada.

La ausencia de un `NOTICE` local no se interpreta como ausencia de obligación:
los archivos no pudieron comprobarse localmente porque `npm ci` no terminó.

## 12. Hallazgos

| ID | Severidad | Estado | Hallazgo | Evidencia |
| --- | --- | --- | --- | --- |
| DEP-001 | HIGH | REVIEW REQUIRED | Runtime OG contiene MPL-2.0 y font/artefactos del paquete que deben inventariarse | `@vercel/og`, `satori`, `@resvg/resvg-wasm`; `store/api/og/store.js` |
| DEP-002 | HIGH | REVIEW REQUIRED | `sharp` incorpora cadena opcional LGPL-3.0-or-later de libvips | `package-lock.json`; `store/api/_safePublicImage.js` |
| DEP-003 | MEDIUM | PASS WITH NOTES | No hay fuentes locales/Git ni rangos abiertos no fijados por lockfile | `package-lock.json` |
| DEP-004 | MEDIUM | BLOCKED | No pudo validarse el árbol instalado con `npm ci`/`npm ls` | ejecución local del 2026-08-03 |
| DEP-005 | MEDIUM | REVIEW REQUIRED | Licencias de contenido/BlueOak/duales requieren avisos exactos | lockfile; expresiones enumeradas en §8–9 |
| DEP-006 | LOW | PASS WITH NOTES | Workflows dependen de acciones externas versionadas en `@v4` | `.github/workflows/*.yml` |

## 13. Bloqueantes

Bloqueantes para el cierre de OSS.1.4: **2 categorías**.

1. La revisión de distribución y avisos de MPL/LGPL del runtime OG no está
   cerrada.
2. Los activos de marca asociados al producto no tienen procedencia o permiso
   verificable; se detalla en `docs/OSS-ASSET-PROVENANCE.md`.

No se clasificó ninguna dependencia como `BLOCKER` por una incompatibilidad
demostrada. Esto no convierte la combinación en una certificación jurídica.

## 14. Riesgos y limitaciones

- `node_modules` estaba parcial y no fue posible reconstruirlo dentro del
  límite del entorno; no se copiaron sus rutas ni su log al repositorio.
- No se verificaron localmente los archivos LICENSE/COPYING/NOTICE de cada
  tarball instalado.
- El lockfile refleja resolución y metadata de npm, pero no prueba por sí
  solo el contenido exacto de cada archivo de licencia.
- No se ejecutó un build completo; el cambio es documental.
- No se examinó el riesgo histórico de OSS.1.1 ni se reescribió el historial.
- La procedencia de código generado, contribuciones asistidas por IA y activos
  de marca necesita confirmación del titular.

## 15. Recomendaciones

1. Repetir `npm ci`, `npm ls --all` y `npm sbom --sbom-format=spdx` en un
   entorno limpio compatible con el proyecto y revisar los LICENSE/NOTICE
   reales de los tarballs.
2. Preparar avisos de MPL/LGPL para la función OG y confirmar la política de
   distribución de fuentes/binarios antes de AGPL.
3. Obtener expediente de autoría, permiso o reemplazo para cada familia de
   marca indicada en el inventario de activos.
4. Crear o confirmar una política de marca separada; la licencia de código no
   debe interpretarse como licencia de `Lanzo`, `Lanzo-POS` o `Entre Alas`.
5. Repetir la revisión humana/jurídica antes de crear `LICENSE` o cambiar el
   campo `license` de `package.json`.

## 16. Decisión de salida

**NO-GO — CONDITIONAL REVIEW REQUIRED.**

No se recomienda avanzar a la adopción formal de AGPL-3.0-only hasta cerrar
la procedencia de los activos y la matriz de avisos MPL/LGPL. Esta decisión
no activa AGPL, no crea `LICENSE` y no modifica el manifiesto.
