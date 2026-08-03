# Lanzo-POS — avisos de terceros

## Propósito y estado

Este documento registra dependencias y contenido de terceros identificados en
el inventario OSS.1.4, con fecha **2026-08-03** y base
`0315e20b0b57038d7a747c9cfd2920e17537159c`.

Lanzo-POS **todavía no tiene una `LICENSE` OSS vigente**. AGPL-3.0-only es una
licencia prevista, no adoptada. Este documento no es una certificación jurídica
ni sustituye la revisión de los textos completos de licencia antes de una
distribución formal.

La fuente primaria local para versiones, integridad, origen de tarball y
licencias declaradas es `package-lock.json`. `npm ci` no terminó en el entorno
de esta auditoría; por tanto, las rutas `node_modules/...` se indican como
rutas esperadas y su contenido LICENSE/NOTICE queda **no verificado**.

## Runtime distribuido

| Paquete | Versión | Licencia declarada | Proyecto de origen | Verificación local | Obligación/nota |
| --- | ---: | --- | --- | --- | --- |
| `@fingerprintjs/fingerprintjs` | 5.0.1 | MIT | [fingerprintjs/fingerprintjs](https://github.com/fingerprintjs/fingerprintjs) | `node_modules/@fingerprintjs/fingerprintjs/LICENSE*` — no verificado | Conservar licencia y aviso |
| `@google/genai` | 1.50.1 | Apache-2.0 | [googleapis/js-genai](https://github.com/googleapis/js-genai) | `node_modules/@google/genai/LICENSE*` — no verificado | Conservar licencia y `NOTICE` si el paquete lo incluye |
| `@react-oauth/google` | 0.13.5 | MIT | [MomenSherif/react-oauth](https://github.com/MomenSherif/react-oauth) | `node_modules/@react-oauth/google/LICENSE*` — no verificado | Conservar aviso |
| `@supabase/supabase-js` | 2.86.0 | MIT | [supabase/supabase-js](https://github.com/supabase/supabase-js) | `node_modules/@supabase/supabase-js/LICENSE*` — no verificado | Conservar aviso |
| `@vercel/og` | 0.11.1 | MPL-2.0 | Proyecto Vercel OG; repository no informado en el metadato exacto revisado | `node_modules/@vercel/og/LICENSE*`, `NOTICE*`, font assets — no verificado | **REVIEW REQUIRED**; revisar aviso, fuente y font incluido |
| `@zxing/library` | 0.21.3 | MIT | [zxing-js/library](https://github.com/zxing-js/library) | `node_modules/@zxing/library/LICENSE*` — no verificado | Conservar aviso |
| `big.js` | 7.0.1 | MIT | [MikeMcl/big.js](https://github.com/MikeMcl/big.js) | `node_modules/big.js/LICENSE*` — no verificado | Conservar aviso |
| `dexie` | 4.4.3 | Apache-2.0 | [dexie/Dexie.js](https://github.com/dexie/Dexie.js) | `node_modules/dexie/LICENSE*` — no verificado | Conservar licencia/`NOTICE` si existe |
| `dexie-export-import` | 4.4.0 | Apache-2.0 | [dexie/Dexie.js](https://github.com/dexie/Dexie.js) | `node_modules/dexie-export-import/LICENSE*` — no verificado | Conservar licencia/`NOTICE` si existe |
| `dexie-react-hooks` | 4.2.0 | Apache-2.0 | [dexie/Dexie.js](https://github.com/dexie/Dexie.js) | `node_modules/dexie-react-hooks/LICENSE*` — no verificado | Conservar licencia/`NOTICE` si existe |
| `es-toolkit` | 1.46.0 | MIT | [toss/es-toolkit](https://github.com/toss/es-toolkit) | `node_modules/es-toolkit/LICENSE*` — no verificado | Conservar aviso |
| `lucide-react` | 0.553.0 | ISC | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) | `node_modules/lucide-react/LICENSE*` — no verificado | Conservar aviso/atribución |
| `react` | 19.2.0 | MIT | [facebook/react](https://github.com/facebook/react) | `node_modules/react/LICENSE*` — no verificado | Conservar aviso |
| `react-dom` | 19.2.0 | MIT | [facebook/react](https://github.com/facebook/react) | `node_modules/react-dom/LICENSE*` — no verificado | Conservar aviso |
| `react-hot-toast` | 2.6.0 | MIT | [timolins/react-hot-toast](https://github.com/timolins/react-hot-toast) | `node_modules/react-hot-toast/LICENSE*` — no verificado | Conservar aviso |
| `react-router-dom` | 7.13.0 | MIT | [remix-run/react-router](https://github.com/remix-run/react-router) | `node_modules/react-router-dom/LICENSE*` — no verificado | Conservar aviso |
| `react-virtualized-auto-sizer` | 1.0.26 | MIT | [bvaughn/react-virtualized-auto-sizer](https://github.com/bvaughn/react-virtualized-auto-sizer) | `node_modules/react-virtualized-auto-sizer/LICENSE*` — no verificado | Conservar aviso |
| `react-window` | 2.2.3 | MIT | [bvaughn/react-window](https://github.com/bvaughn/react-window) | `node_modules/react-window/LICENSE*` — no verificado | Conservar aviso |
| `react-zxing` | 2.1.0 | MIT | [adamalfredsson/react-zxing](https://github.com/adamalfredsson/react-zxing) | `node_modules/react-zxing/LICENSE*` — no verificado | Conservar aviso |
| `recharts` | 3.8.1 | MIT | [recharts/recharts](https://github.com/recharts/recharts) | `node_modules/recharts/LICENSE*` — no verificado | Conservar aviso |
| `sharp` | 0.34.5 | Apache-2.0 | [lovell/sharp](https://github.com/lovell/sharp) | `node_modules/sharp/LICENSE*`, `NOTICE*` — no verificado | **REVIEW REQUIRED** por libvips LGPL y binarios opcionales |
| `zod` | 4.1.13 | MIT | [colinhacks/zod](https://github.com/colinhacks/zod) | `node_modules/zod/LICENSE*` — no verificado | Conservar aviso |
| `zustand` | 5.0.8 | MIT | [pmndrs/zustand](https://github.com/pmndrs/zustand) | `node_modules/zustand/LICENSE*` — no verificado | Conservar aviso |

### Runtime generado de la tienda

La función `store/api/og/store.js` importa `@vercel/og` y la función de
normalización `store/api/_safePublicImage.js` importa `sharp`. El script de
preparación restringe explícitamente la clausura permitida a
`@vercel/og`, `react` y `sharp` para esa función. Estos paquetes deben aparecer
en los avisos del material distribuido de la función, incluso si el bundle se
genera fuera de Git.

## Build y herramientas

| Paquete | Versión | Licencia | Uso | Verificación local |
| --- | ---: | --- | --- | --- |
| `@eslint/js` | 9.39.3 | MIT | lint | `node_modules/@eslint/js/LICENSE*` — no verificado |
| `@testing-library/jest-dom` | 6.9.1 | MIT | test | `node_modules/@testing-library/jest-dom/LICENSE*` — no verificado |
| `@testing-library/react` | 16.3.2 | MIT | test | `node_modules/@testing-library/react/LICENSE*` — no verificado |
| `@testing-library/user-event` | 14.6.1 | MIT | test | `node_modules/@testing-library/user-event/LICENSE*` — no verificado |
| `@types/react` | 19.2.4 | MIT | tipos | `node_modules/@types/react/LICENSE*` — no verificado |
| `@types/react-dom` | 19.2.3 | MIT | tipos | `node_modules/@types/react-dom/LICENSE*` — no verificado |
| `@vitejs/plugin-react` | 5.1.1 | MIT | build | `node_modules/@vitejs/plugin-react/LICENSE*` — no verificado |
| `eslint` | 9.39.3 | MIT | lint | `node_modules/eslint/LICENSE*` — no verificado |
| `eslint-plugin-react` | 7.37.5 | MIT | lint | `node_modules/eslint-plugin-react/LICENSE*` — no verificado |
| `eslint-plugin-react-hooks` | 7.0.1 | MIT | lint | `node_modules/eslint-plugin-react-hooks/LICENSE*` — no verificado |
| `eslint-plugin-react-refresh` | 0.4.24 | MIT | lint | `node_modules/eslint-plugin-react-refresh/LICENSE*` — no verificado |
| `fake-indexeddb` | 6.2.5 | Apache-2.0 | test | `node_modules/fake-indexeddb/LICENSE*` — no verificado |
| `globals` | 16.5.0 | MIT | lint | `node_modules/globals/LICENSE*` — no verificado |
| `jsdom` | 28.1.0 | MIT | test | `node_modules/jsdom/LICENSE*` — no verificado |
| `vite` | 7.2.2 | MIT | build/dev | `node_modules/vite/LICENSE*` — no verificado |
| `vite-plugin-pwa` | 1.2.0 | MIT | PWA/Workbox build | `node_modules/vite-plugin-pwa/LICENSE*` — no verificado |
| `vitest` | 4.0.14 | MIT | test | `node_modules/vitest/LICENSE*` — no verificado |

Estas herramientas no se identificaron como parte del runtime público por sí
solas. Los bundles generados deben auditarse cuando se produzcan, porque un
build puede incorporar subdependencias o assets adicionales.

## Componentes transitivos materiales

| Componente | Versión | Licencia | Alcance | Tratamiento |
| --- | ---: | --- | --- | --- |
| `satori` | 0.25.0 | MPL-2.0 | cadena de `@vercel/og` | Mantener aviso/licencia; revisar modificaciones y fuentes |
| `@resvg/resvg-wasm` | 2.4.0 | MPL-2.0 | cadena de `@vercel/og` | Mantener aviso/licencia; revisar bundle |
| `@img/sharp-libvips-*` | 1.2.4 | LGPL-3.0-or-later | binarios opcionales de `sharp` | Verificar plataforma seleccionada y obligaciones de distribución |
| `@img/sharp-*` | 0.34.5 | Apache-2.0 con expresiones Apache/LGPL en algunas variantes | adaptadores nativos opcionales | Conservar avisos de `sharp`/libvips |
| `caniuse-lite` | 1.0.30001754 | CC-BY-4.0 | datos de browserslist/build | Atribución separada del código |
| `argparse` | 2.0.1 | Python-2.0 | tooling transitivo | Conservar licencia si se distribuye el tooling |
| `glob`, `minimatch`, `jackspeak`, `package-json-from-dist`, `path-scurry`, `lru-cache` | versiones del lockfile | BlueOak-1.0.0 | build/test | Conservar texto/aviso exacto |
| `@zxing/text-encoding` | 0.9.0 | `(Unlicense OR Apache-2.0)` | cadena ZXing | Mantener expresión dual |
| `json-schema` | 0.4.0 | `(AFL-2.1 OR BSD-3-Clause)` | tooling | Mantener expresión dual |
| `type-fest` | 0.16.0 | `(MIT OR CC0-1.0)` | tooling | Mantener expresión dual |
| `victory-vendor` | 37.3.6 | `MIT AND ISC` | cadena Recharts | Mantener ambas licencias |

No se copian aquí cientos de textos completos. Antes del primer release OSS se
deben generar los avisos a partir de los tarballs exactos y comprobar cada
`LICENSE`, `COPYING` y `NOTICE` real.

## Activos y contenido

Los 9 archivos de marca rastreados están inventariados en
[`docs/OSS-ASSET-PROVENANCE.md`](docs/OSS-ASSET-PROVENANCE.md). Su estado no es
una licencia de terceros: no se demostró autoría o permiso suficiente para
clasificarlos como `VERIFIED FIRST-PARTY`.

Las imágenes de productos, logos de negocios, portadas y otros recursos
remotos llegan desde datos de usuario o almacenamiento público. Que una URL
sea pública no concede automáticamente permiso de reutilización. La política
de contenido deberá exigir derechos del uploader.

## SBOM

No existe `docs/sbom.spdx.json`. `npm sbom --sbom-format=spdx` fue intentado,
pero falló con `ESBOMPROBLEMS` debido al árbol `node_modules` parcial después
de los intentos de `npm ci`. No se creó un SBOM manual fingiendo completitud.

## Próximo paso

Este documento es un inventario preliminar para revisión humana. No activa
AGPL-3.0-only, no crea `LICENSE` y no sustituye la decisión del titular sobre
marca, avisos y distribución de funciones generadas.
