# OSS.1.4A — evidencia local de licencias instaladas

Fecha de captura: 2026-08-03. Base: `81400b41a8788aac1c5c46cb0c0c9ad707524cfa`.
La evidencia se obtuvo después de `npm ci --include=optional` en Windows
`win32/x64`, con Node `v24.18.1` y npm `11.16.0`.

## Instalación y SBOM

- `npm ci --include=optional`: exit 0; 703 paquetes añadidos, 704 auditados.
- `npm ls --all`: exit 0. Los avisos `UNMET OPTIONAL DEPENDENCY` corresponden
  a plataformas o herramientas opcionales no seleccionadas por Windows; no
  hubo un paquete obligatorio faltante.
- `npm sbom --sbom-format=spdx`: exit 0. El archivo generado es SPDX-2.3,
  contiene 692 paquetes y 1,477 relaciones, y tiene como raíz
  `lanzo-pos-react@4.0.0`.
- SHA-256 de `package-lock.json`:
  `c20b5b450a0322fe39a5cfe9958068d0a0d00756e804fa9d4648689cec543474`.
- SHA-256 de `docs/sbom.spdx.json`:
  `f8b782d99ff3a72c61bef79331ef9f8ebe907fb1b0a95927ff1bc25c4de9d34f`.

El SBOM no fue editado para ocultar datos. La redirección final se hizo con
salida UTF-8 cruda de `cmd.exe`, porque la redirección de Windows PowerShell
había producido UTF-16LE. `JSON.parse` pasa y no se encontraron rutas
Rutas de usuario local, credenciales, valores de entorno o tokens.

## Paquetes materiales

| Paquete | Declaración de `package.json` | Archivos reales encontrados |
| --- | --- | --- |
| `@vercel/og@0.11.1` | MPL-2.0; depende de Satori y Resvg; sharp opcional | `LICENSE`; no NOTICE; `dist/Geist-Regular.ttf`, `dist/resvg.wasm`, `dist/yoga.wasm` |
| `satori@0.25.0` | MPL-2.0 | `LICENSE`; no NOTICE |
| `@resvg/resvg-wasm@2.4.0` | MPL-2.0 | README con enlace MPLv2.0 y copyright; no LICENSE/COPYING/NOTICE |
| `sharp@0.34.5` | Apache-2.0 | `LICENSE`; no NOTICE; dependencias opcionales por plataforma |
| `@img/sharp-win32-x64@0.34.5` | Apache-2.0 AND LGPL-3.0-or-later | `LICENSE`, README, `versions.json`, DLLs y `.node`; no NOTICE separado |

## MPL-2.0 y Exhibit B

`node_modules/@vercel/og/LICENSE` y `node_modules/satori/LICENSE` tienen
16,725 bytes y SHA-256
`1f256ecad192880510e84ad60474eab7589218784b9a50bc7ceee34c2b91f1d5`.
Ambos contienen la sección `Exhibit B - "Incompatible With Secondary
Licenses"` y el aviso correspondiente. Lanzo no modifica esos archivos: se
consumen sin parches desde `node_modules`, que no contiene archivos rastreados
por Git.

`@resvg/resvg-wasm` también declara MPL-2.0, pero la inspección local no pudo
confirmar un texto MPL distribuido dentro del paquete: solo hay referencia
MPLv2.0 y copyright en `README.md`. Esto es una obligación de aviso pendiente,
no una inferencia de permiso.

## Fuente y assets incluidos en OG

El paquete instalado contiene `dist/Geist-Regular.ttf` de 125,956 bytes,
SHA-256 `bde046ddd9f20be35b0bd56cc79eb752b967fb6661a3fe76cb067bb09f871d76`.
No existe LICENSE/NOTICE separado para ese archivo. El README de la misma
versión afirma que la fuente incluida por defecto es Noto Sans, mientras el
archivo real se llama `Geist-Regular.ttf`. La identidad, licencia y procedencia
de la fuente requieren revisión independiente; el nombre del archivo no prueba
autoría ni permiso.

## Sharp/libvips y binario seleccionado

La ejecución:

```text
require('sharp') => sharp 0.34.5, vips 8.17.3, win32/x64
```

confirmó el binario opcional instalado:

```text
@img/sharp-win32-x64@0.34.5
  lib/libvips-42.dll
  lib/libvips-cpp-8.17.3.dll
  lib/sharp-win32-x64.node
```

El LICENSE del paquete binario es Apache-2.0, pero el metadato declara
`Apache-2.0 AND LGPL-3.0-or-later`. Su README enumera `libvips`, glib, pango,
librsvg y otras bibliotecas como LGPLv3 y dice que el uso es mediante la
cláusula "any later version" de LGPLv2/LGPLv2.1. La variante seleccionada no
usa un paquete separado `@img/sharp-libvips-win32-x64`; las variantes
`@img/sharp-libvips-*` de otras plataformas son opcionales y no se cargaron en
esta captura.

Hashes SHA-256 de la captura Windows:

| Archivo | SHA-256 |
| --- | --- |
| `@img/sharp-win32-x64/LICENSE` | `dc1f5d2d43c5531dfe0acaf4e950ea5dbe3e61e1850cf0e983bda7efc10d6693` |
| `@img/sharp-win32-x64/README.md` | `c416cd0af88256407c36a0613f189ac4257221c7206d0324f7ef5563c66f1125` |
| `lib/libvips-42.dll` | `f8d356def73941668252347b825055310e99023ff77c7d3036e592d0771e1529` |
| `lib/libvips-cpp-8.17.3.dll` | `f1b3c3eeea1b6a8292a69d78dd2cd1debacb9951cabdd9217a57e34137570cd1` |
| `lib/sharp-win32-x64.node` | `afc813593f255968ddae8f1d66557e0f96484bb374606e4eb2267a7dbc7cb25a` |

## Lockfile frente a archivos reales

- `@vercel/og`, `satori`, `sharp` y `@img/sharp-win32-x64` coinciden entre el
  lockfile y su `package.json` instalado en versión y expresión de licencia.
- `@resvg/resvg-wasm` coincide en la declaración MPL-2.0, pero no tiene
  LICENSE/COPYING/NOTICE local que conserve el texto completo.
- `@img/sharp-win32-x64` declara una expresión compuesta; su archivo LICENSE
  visible es Apache-2.0 y el README es el aviso que documenta los componentes
  LGPL incluidos. No debe reducirse la expresión a una sola licencia.
- El lockfile contiene paquetes `@img/sharp-libvips-*` LGPL opcionales de
  plataformas no seleccionadas. No se deben reportar como binario Windows
  cargado.

## Conclusión

No se observó una modificación local de los archivos MPL ni una incompatibilidad
demostrada. Sí quedan obligaciones materiales no cerradas: Exhibit B de OG y
Satori, aviso independiente de Resvg, licencia/procedencia de la fuente OG y
avisos/correspondencia del binario LGPL de sharp. Por ello la dependencia queda
`DEPENDENCY NO-GO` para cierre formal y los elementos indicados son
`REVIEW REQUIRED`/`BLOCKER` según el impacto de la distribución prevista.
