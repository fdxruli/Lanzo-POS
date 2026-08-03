# OSS.1.4A — auditoría verificada de dependencias, avisos y SBOM

Fecha: 2026-08-03. Repositorio: `fdxruli/Lanzo-POS`.
Base auditada: `origin/main` en
`81400b41a8788aac1c5c46cb0c0c9ad707524cfa`.

## 1. Resultado ejecutivo

La instalación reproducible y la inspección de archivos reales ya fueron
completadas. El SBOM SPDX fue generado por npm y validado como JSON. No se
modificaron `package.json`, `package-lock.json`, `store/package.json`, código,
configuración, Supabase, Vercel ni `LICENSE`.

La conclusión de dependencias es **DEPENDENCY NO-GO para cierre formal**:

1. `@vercel/og@0.11.1` y `satori@0.25.0` contienen el aviso Exhibit B de
   MPL-2.0 en sus LICENSE reales y forman parte de una función distribuida.
2. `@resvg/resvg-wasm@2.4.0` declara MPL-2.0, pero su paquete instalado no
   trae LICENSE/COPYING/NOTICE independiente; solo un enlace MPL y copyright
   en README.
3. `@vercel/og` incluye `dist/Geist-Regular.ttf` sin aviso de fuente separado;
   el README dice Noto Sans, por lo que el archivo real y su procedencia
   requieren revisión.
4. La variante Windows de sharp declara una combinación Apache/LGPL y
   contiene DLLs de libvips; la matriz de avisos y fuentes de distribución
   aún debe cerrarse.

Esto es una clasificación documental de riesgo y obligaciones, no una
afirmación de incompatibilidad jurídica absoluta. La fórmula aplicable es
**sin conflicto evidente identificado**, sujeta a la revisión pendiente.
OSS.1.4 en conjunto permanece **BLOCKED** por la procedencia de activos de
marca, que corresponde a OSS.1.4B.

## 2. Evidencia reproducible

| Elemento | Resultado verificado |
| --- | --- |
| Node.js | `v24.18.1` |
| npm | `11.16.0` |
| Sistema | Windows NT 10.0.19045.0, `win32/x64` |
| Commit base | `81400b41a8788aac1c5c46cb0c0c9ad707524cfa` |
| SHA-256 de `package-lock.json` | `c20b5b450a0322fe39a5cfe9958068d0a0d00756e804fa9d4648689cec543474` |
| `npm ci --include=optional` | exit 0; añadió 703 paquetes y auditó 704 en 14 minutos |
| `npm ls --all` | exit 0; mostró opcionales no aplicables a Windows, sin error de paquete obligatorio |
| SBOM | `npm sbom --sbom-format=spdx`, exit 0; SPDX-2.3, 692 paquetes, 1,477 relaciones |
| SHA-256 de `docs/sbom.spdx.json` | `f8b782d...de9d34f` |

El SBOM se generó con el comando indicado, sin edición de contenido. En
PowerShell, la primera redirección produjo UTF-16LE; se repitió el mismo
comando usando redirección binaria de `cmd.exe` para conservar JSON UTF-8. La
validación `JSON.parse` pasa. El documento contiene la raíz
`lanzo-pos-react`, dependencias directas y transitivas, y no contiene rutas
personales, credenciales, valores de entorno ni tokens detectables.

`npm ci` emitió advertencias de engine para `react-zxing` bajo Node 24 y
avisos de scripts pendientes para `esbuild`, `protobufjs` y `sharp`; no se
usaron `npm install`, `npm update`, `npm audit fix`, `--force` ni
`--legacy-peer-deps`. Las advertencias de vulnerabilidades de npm no se
resolvieron porque no forman parte del alcance y hacerlo modificaría el
lockfile.

## 3. Inventario del lockfile y del SBOM

El lockfile es v3 y mantiene 23 dependencias runtime y 17 de desarrollo. Sus
entradas resueltas permanecen en el registro npm; no hay cambios locales en
los manifests. `docs/sbom.spdx.json` es el artefacto generado por npm y no un
JSON escrito a mano.

El SBOM incluye, entre otros, estos componentes materiales:

| Componente | Versión SBOM | Licencia declarada SBOM |
| --- | ---: | --- |
| `lanzo-pos-react` | 4.0.0 | `NOASSERTION` |
| `@vercel/og` | 0.11.1 | MPL-2.0 |
| `satori` | 0.25.0 | MPL-2.0 |
| `@resvg/resvg-wasm` | 2.4.0 | MPL-2.0 |
| `sharp` | 0.34.5 | Apache-2.0 |
| `@img/sharp-win32-x64` | 0.34.5 | Apache-2.0 AND LGPL-3.0-or-later |

Los opcionales de otras plataformas aparecen como no instalados en
`npm ls --all`, lo cual es esperado. En Windows se instaló
`@img/sharp-win32-x64@0.34.5`; no se instaló un
`@img/sharp-libvips-win32-x64` independiente.

## 4. Verificación de archivos reales

La inspección detallada, hashes y rutas está en
[`docs/OSS-DEPENDENCY-EVIDENCE.md`](OSS-DEPENDENCY-EVIDENCE.md). Los hechos
principales son:

- `@vercel/og/LICENSE` y `satori/LICENSE` son textos MPL-2.0 completos y
  contienen Exhibit B; ambos tienen el mismo hash SHA-256.
- `@resvg/resvg-wasm` no contiene LICENSE, COPYING ni NOTICE, aunque su
  `package.json` declara MPL-2.0 y su README enlaza MPLv2.0.
- `sharp/LICENSE` es Apache-2.0; no hay NOTICE local en el paquete.
- `@img/sharp-win32-x64/LICENSE` contiene Apache-2.0, mientras el metadato del
  paquete declara Apache-2.0 AND LGPL-3.0-or-later. Su README enumera libvips y
  otras bibliotecas LGPLv3.
- `@vercel/og/dist/Geist-Regular.ttf` existe como asset de 125,956 bytes sin
  LICENSE/NOTICE separado; el README instalado describe Noto Sans. Esto no se
  trata como permiso de marca o de fuente.

No se detectó modificación local de archivos MPL: `node_modules` está ignorado,
`git ls-files node_modules` fue vacío y no se versionan parches de esos
paquetes. La distribución real debe conservar los textos completos desde los
tarballs exactos.

## 5. Sharp, libvips y plataforma

`require('sharp')` confirmó `sharp 0.34.5`, `vips 8.17.3`, plataforma
`win32/x64`. Los archivos seleccionados son:

- `node_modules/@img/sharp-win32-x64/lib/libvips-42.dll`;
- `node_modules/@img/sharp-win32-x64/lib/libvips-cpp-8.17.3.dll`;
- `node_modules/@img/sharp-win32-x64/lib/sharp-win32-x64.node`.

El runtime obtiene esos binarios mediante el paquete opcional específico de
plataforma de sharp. No se sustituyó sharp. El README del binario declara
libvips LGPLv3 y la cláusula de versiones posteriores; esto debe distinguirse
de la declaración npm `LGPL-3.0-or-later` y del `Apache-2.0` de sharp. La
entrega debe documentar licencia, avisos y fuente/correspondencia aplicables a
la obra LGPL.

## 6. Hechos frente a interpretación

| Hecho local | Interpretación operativa |
| --- | --- |
| Exhibit B aparece en los LICENSE de OG y Satori | **BLOCKER/REVIEW REQUIRED** para la decisión de distribución; no se afirma incompatibilidad definitiva |
| Resvg declara MPL pero carece de archivo LICENSE/COPYING/NOTICE | **REVIEW REQUIRED**: obtener/conservar aviso completo antes de entregar |
| El font asset real es `Geist-Regular.ttf` y el README dice Noto Sans | **REVIEW REQUIRED** para identidad, licencia y procedencia del asset |
| sharp carga libvips 8.17.3 desde `@img/sharp-win32-x64` | **REVIEW REQUIRED** para avisos y correspondencia de los binarios LGPL |
| No hubo cambios en manifests ni código | No se alteró la resolución ni el comportamiento del producto |
| Activos de marca no están documentados como propios/licenciados | OSS.1.4 sigue **BLOCKED** hasta OSS.1.4B |

## 7. Archivos y acciones fuera de alcance

No se modificaron `package.json`, `package-lock.json`, `store/package.json`,
`src/**`, `store/**`, `supabase/**`, `scripts/**`, `public/**`, `.github/**`,
configuraciones, pruebas, migraciones ni `LICENSE`. No se desplegó a Vercel,
no se consultaron ni modificaron variables de producción y no se crearon
previews manuales. No se ejecutó build ni prueba de interfaz.

## 8. Próximos cierres necesarios

1. Revisar con el titular la consecuencia de Exhibit B para la distribución
   prevista de la función OG.
2. Obtener el aviso MPL completo de Resvg y la licencia/procedencia de
   `Geist-Regular.ttf` antes de un bundle distribuible.
3. Preparar avisos y correspondencia de libvips y sus dependencias en el
   artefacto de sharp para cada plataforma de despliegue.
4. Resolver por separado la procedencia de activos de marca en OSS.1.4B.

Esta auditoría no activa AGPL, no crea `LICENSE`, no actualiza dependencias y
no autoriza un release.
