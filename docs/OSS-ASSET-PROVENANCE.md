# OSS.1.4 — Procedencia de activos e identidad

Fecha del inventario: 2026-08-03. Repositorio: `fdxruli/Lanzo-POS`.
Base auditada: `origin/main` en `0315e20b0b57038d7a747c9cfd2920e17537159c`.

## 1. Resumen

Se localizaron **9 archivos binarios/vectoriales rastreados**, agrupables en
**7 familias**: seis PNG de marca/PWA y tres SVG de identidad/assistant. No se
encontraron fuentes, audio, vídeo, PDF, GIF, JPG, WebP, ICO, AVIF ni archivos
de fuente tipográfica rastreados.

Resultado: **BLOCKED — la procedencia de los activos materiales de marca no
está demostrada**. No se eliminaron ni reemplazaron activos.

Los archivos tienen historial Git y varios fueron añadidos por el mantenedor
visible `fdxruli`, pero “Add files via upload” no demuestra autoría, licencia,
permiso de uso ni ausencia de elementos derivados. Por esa razón no se afirma
que sean de propiedad de una sola persona.

## 2. Metodología

Se inspeccionaron rutas rastreadas con extensiones de imagen, hashes SHA-256,
dimensiones PNG, contenido SVG, referencias desde `src/`/`public/`, `.gitignore`,
historial de alta, nombres de marca y recursos remotos. También se revisaron
los SVG inline de `src/components/common/` y la iconografía importada desde
`lucide-react`.

No se incorporaron capturas ni archivos binarios nuevos. Los hashes solo sirven
para distinguir archivos y no prueban titularidad.

## 3. Rutas inspeccionadas

- `public/**`
- `icono/**`
- `src/components/common/Logo.jsx`
- `src/components/common/LogoMark.jsx`
- SVG inline en componentes de producto, scanner y UI
- referencias de assets en `src/**`, `store/**` y configuraciones de build
- `.gitignore`, historial Git y reportes OSS anteriores

## 4. Inventario por familia

| Familia | Archivos | Formato/dimensiones | SHA-256 | Propósito | Procedencia/estado |
| --- | --- | --- | --- | --- | --- |
| Icono cuadrado fuente | `icono/icono.png`, `public/icono.png` | PNG 1024×1024; ambos idénticos | `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c` | icono de marca | Alta en `339243ee`; autor Git `fdxruli`; permiso/licencia no demostrados — **UNKNOWN / REVIEW REQUIRED** |
| Wordmark/imagen fuente | `icono/icono-web.png` | PNG 1024×1024 | `f18a142863439b8a147d335f2232c23edabc2b1cde4b42b4ff959020378b5ef5` | imagen de identidad para web | Alta en `339243ee`; autoría material y permiso no demostrados — **UNKNOWN / REVIEW REQUIRED** |
| Icono web/PWA pequeño | `public/icono-web.png`, `public/pwa-192x192.png` | PNG 192×192; ambos idénticos | `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673` | favicon/icono PWA | Alta en `339243ee` y `21ede67a`; licencia/permiso no demostrados — **UNKNOWN / REVIEW REQUIRED** |
| Icono PWA grande | `public/pwa-512x512.png` | PNG 512×512 | `b8dfbddccca477b9ca8125ab3f9a9f790e8f8040fb5a1f3480509680217f2460` | icono PWA | Alta en `21ede67a`; licencia/permiso no demostrados — **UNKNOWN / REVIEW REQUIRED** |
| Wordmark vectorial | `public/log.svg` | SVG 320×80; texto `LANZO` | `3cc39f6eff3148fbeb418eb3ff18397e537067ebf8a172e2324782609f1c1ae2` | logo horizontal | Alta en `1d599ed0`; sin cabecera de licencia; **REVIEW REQUIRED** |
| Marca vectorial | `public/logIcon.svg` | SVG 120×120 | `fd0e93e021a8d91d0272753f295d48862fef2c8c9bff91a8e6b90ddab313c98a` | logo/mark | Alta en `1d599ed0`; sin cabecera de licencia; **REVIEW REQUIRED** |
| Icono del assistant | `public/boticon.svg` | SVG 120×120 | `93bf10b60605088cfbd4f35fe23b82f4d9f387fa604f72f5fff54931debea1c4` | icono de bot | Alta en `a1e50593`; el comentario del archivo dice que conserva rasgos del logo original; derivación y permiso no demostrados — **REVIEW REQUIRED** |

### Estado agregado

| Estado | Familias | Archivos |
| --- | ---: | ---: |
| VERIFIED FIRST-PARTY | 0 | 0 |
| VERIFIED THIRD-PARTY | 0 | 0 |
| GENERATED rastreado | 0 | 0 |
| UNKNOWN / REVIEW REQUIRED | 7 | 9 |
| BLOCKER | 0 por evidencia de licencia incompatible; el cierre de procedencia sí queda bloqueado | 0 |

## 5. Logos y marca

El árbol contiene las identidades `Lanzo`, `Lanzo-POS` y `Entre Alas`:

- `Lanzo` y `Lanzo-POS` aparecen en el README, UI, manifiestos y SVG.
- `README.md` dice que el proyecto fue iniciado y patrocinado por la dark
  kitchen `Entre Alas`.
- `docs/OSS-SANITIZATION.md` confirma que la referencia pública a `Entre Alas`
  se conservó deliberadamente durante OSS.1.3.
- El repositorio no contiene `TRADEMARK_POLICY.md`; por tanto no pudo
  comprobarse una política formal desde el árbol actual.
- No se encontró evidencia local para declarar que `Lanzo` o `Entre Alas` sean
  marcas registradas. Esta auditoría no hace esa afirmación.

La futura licencia de código no debe interpretarse como licencia de nombre,
logo, marca, materiales promocionales ni apariencia distintiva. Un fork puede
necesitar reemplazar estos elementos o pedir autorización para conservarlos.

## 6. Iconos PWA

`public/pwa-192x192.png` duplica byte a byte a `public/icono-web.png` y
`public/pwa-512x512.png` es una variante separada. Son activos de identidad,
no activos generados demostrablemente por una herramienta reproducible. La
configuración PWA los consume desde `public/`; no se identificó una licencia o
fuente de diseño en el repositorio.

## 7. Imágenes y capturas

No hay capturas rastreadas después del saneamiento OSS.1.3. No se localizaron
JPG, WebP, GIF, AVIF ni imágenes de demostración adicionales. Los PNG
enumerados arriba son de marca, no fixtures visuales de negocio.

Las pruebas usan URLs y `data:image/*` pequeños como fixtures de validación de
seguridad/render. No son archivos binarios rastreados ni se clasifican como
activos de producto; deben seguir siendo datos sintéticos.

## 8. Fuentes

No se encontraron `.woff`, `.woff2`, `.ttf` ni `.otf` rastreados. El código de
OG puede incorporar fuentes del paquete `@vercel/og` en un bundle generado; ese
recurso pertenece al inventario de dependencias y avisos, no a este inventario
de archivos del repositorio. Debe verificarse el aviso del font antes de
distribuir la función.

## 9. Activos de pruebas

Las pruebas contienen URLs de dominios `.example`, `.invalid`, placeholders,
logos/covers sintéticos y data URIs de uno o pocos píxeles. Se clasifican como
fixtures deterministas y no como activos de terceros reutilizables. No se
encontró evidencia de que correspondan a material real de un cliente.

## 10. Recursos remotos

El producto consume recursos aportados en runtime, que no quedan demostrados
por este inventario de archivos:

- logos, portadas e imágenes de productos desde almacenamiento público de
  Supabase;
- imágenes públicas de catálogo, incluido el flujo de Open Food Facts;
- placeholders remotos de `placehold.co`;
- sonido remoto de notificación de Google en `LocalKitchenMonitor`;
- enlaces sociales y WhatsApp.

El código valida parte de las URLs remotas y limita algunos orígenes/rutas,
pero esa validación técnica no concede derechos de autor ni marca. La futura
política de contenido deberá exigir que quien sube un recurso tenga permiso.

## 11. Código o recursos generados

No hay bundles, `dist`, `store/generated`, Workbox, source maps ni archivos
minificados rastreados. `scripts/generate-store-html-template.mjs` genera
`store/generated/storeHtmlTemplate.js`, excluido por `.gitignore`, a partir de
un build. Es regenerable y no debe auditarse como si fuera un archivo fuente
de primera parte sin revisar los paquetes que incorpora.

Los SVG inline en `Logo.jsx`, `LogoMark.jsx` y algunos componentes son código
de UI que dibuja iconografía; no tienen expediente de licencia separado. La
iconografía importada desde `lucide-react` se clasifica como tercero según su
licencia ISC declarada en el lockfile, aunque su archivo local de licencia no
pudo verificarse en esta ejecución.

## 12. Procedencia de contribuciones

La historia alcanzable muestra seis identidades de autor públicas o técnicas:

- `fdxruli`;
- `google-labs-jules[bot]`;
- `github-actions[bot]`;
- `Codex`;
- `Cursor Agent`;
- una identidad de coautoría indicada como `rulisebastian8009` en un trailer.

El `git shortlog -sne --all` mostró además correos de sistema y una dirección
Gmail en metadatos históricos; no se reproduce ninguna dirección privada aquí.
Se detectó un trailer `Co-authored-by:` y no se detectaron trailers
`Signed-off-by:` en la búsqueda realizada. La presencia de agentes o bots no
prueba por sí sola autoría, cesión de derechos ni revisión humana.

El proyecto tiene 6 commits atribuidos a `Codex`, 1 a `Cursor Agent`, 11 a
`google-labs-jules[bot]` y 4 a `github-actions[bot]` en el historial alcanzable.
Eso permite documentar uso de herramientas, pero no permite afirmar que todo
el código sea generado por IA ni que un proveedor de IA garantice derechos
sobre materiales de terceros.

## 13. Uso de IA

La evidencia histórica permite clasificar parte del historial como **AI-assisted
and human-reviewed / provenance not verified**. No se revisaron prompts
privados ni se publican datos operativos. La clasificación no sustituye la
confirmación del mantenedor sobre qué cambios fueron revisados y qué material
externo pudo haberse adaptado.

## 14. Elementos no verificados

Quedan sin evidencia suficiente:

1. Autor o titular original de las siete familias gráficas.
2. Permiso para usar el texto, geometría y colores de `Lanzo`/`Entre Alas`.
3. Si `boticon.svg` deriva de un diseño anterior y bajo qué permiso.
4. Licencia de cualquier material de marca que pudo haberse cargado mediante
   “Add files via upload”.
5. Avisos de las fuentes embebidas en paquetes de generación OG.
6. Expediente individual de contribuciones de agentes/bots y coautorías.

## 15. Acciones recomendadas

- Confirmar por escrito autoría/permiso de cada familia o reemplazarla en una
  tarea separada; no hacerlo dentro de OSS.1.4.
- Añadir una política de marca separada y mantener nombres/logos fuera del
  alcance de la licencia de código.
- Inventariar los avisos de `@vercel/og`, fuentes, `sharp` y libvips desde un
  `npm ci` limpio.
- Registrar la procedencia de imágenes aportadas por usuarios en la política
  de contenido, sin asumir que una URL pública es una licencia.
- Mantener el historial sin reescritura y tratar el riesgo histórico en su
  tarea independiente.

## 16. Decisión de salida

**NO-GO — BLOCKED.**

La licencia futura del código puede seguir siendo AGPL-3.0-only como propuesta,
pero no debe activarse mientras la identidad gráfica material y los avisos de
los recursos generados no tengan evidencia suficiente. No se crea `LICENSE`,
no se cambia `package.json` y no se eliminan activos en esta fase.
