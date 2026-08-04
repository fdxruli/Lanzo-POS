# OSS.1.4B / OSS.1.4B-R — Procedencia de activos e identidad

Fecha del inventario: 2026-08-03. Repositorio: `fdxruli/Lanzo-POS`.
Base histórica auditada: `origin/main` en
`19f4087bf23b2920154fb72bd6417a4509508ac0`.

## OSS.1.4B-R — inventario vigente

La base vigente es `origin/main` en
`0decbc4124fed4e8cda4e807a9a400f7257e3084`, merge commit del PR #170. Esta
sección describe el árbol actual después del reemplazo y prevalece sobre el
registro histórico que sigue.

| Grupo vigente | Estado de procedencia | Alcance | Cantidad |
| --- | --- | --- | ---: |
| Fuentes SVG canónicas en `brand/` | `AI-ASSISTED / PROJECT-GENERATED`; `NO THIRD-PARTY SOURCE IDENTIFIED` | `TRADEMARK-RESERVED` | 3 |
| PNG y SVG públicos derivados | `GENERATED FROM PROJECT SOURCE` | `TRADEMARK-RESERVED` | 6 |
| Activos anteriores | `SUPERSEDED / REMOVED FROM CURRENT TREE` | No forman parte del conjunto actual | 9 rutas históricas |

Matriz final del árbol actual: UNKNOWN `0`, REVIEW REQUIRED `0` salvo
aprobación visual del mantenedor, BLOCKER `0`. Los archivos eliminados o
reemplazados y sus hashes están en `brand/LEGACY-ASSET-NOTICE.md`; no se
reescribió el historial.

El proceso reproducible está en `scripts/generate-brand-assets.mjs` y el
manifiesto con hashes en `brand/brand-assets.manifest.json`. Los tres SVG
canónicos se clasifican como asistidos por IA y generados dentro del proyecto;
los derivados no se presentan como `VERIFIED FIRST-PARTY`.

## Registro histórico previo a OSS.1.4B-R

Las secciones siguientes conservan la auditoría anterior para documentar por
qué los activos legacy fueron reemplazados. Sus estados `UNKNOWN`,
`REVIEW REQUIRED` y `BLOCKER` se refieren al árbol histórico, no al actual.

## 1. Resumen y decisión

Se inspeccionaron **9 archivos binarios/vectoriales rastreados**. La evidencia
los separa en **6 familias de identidad**: icono cuadrado, wordmark PNG,
iconos PWA/L-mark, wordmark SVG, marca SVG e icono del asistente.

Resultado de activos: **ASSET NO-GO**.
Resultado global: **OSS.1.4 BLOCKED — NO-GO**.

La declaración del mantenedor selecciona la **Opción 3**: no puede demostrar
razonablemente la procedencia completa de uno o más activos. Los PNG de marca
materiales permanecen `UNKNOWN`; los SVG generados con IA permanecen
`REVIEW REQUIRED` porque no se conoce el proveedor ni los términos históricos.
No se identificó una copia deliberada ni una licencia incompatible, pero la
ausencia de esa evidencia no permite activar la futura licencia de código.

No se eliminaron, reemplazaron ni rediseñaron activos.

## 2. Metodología y alcance técnico

Se utilizaron `git ls-files`, `git log --follow`, `git hash-object`,
`Get-FileHash -Algorithm SHA256`, dimensiones PNG con `System.Drawing`,
comparación visual local, `git grep` e inspección textual de los tres SVG.
También se revisaron las rutas de consumo en `src/`, `store/`, `index.html` y
`vite.config.js`.

Los hashes distinguen archivos y los commits prueban incorporación al historial;
ninguno prueba por sí solo titularidad, licencia o permiso de redistribución.

## 3. Inventario técnico

| Familia | Archivos | Tamaño y dimensiones | SHA-256 | Incorporación histórica | Consumo rastreado |
| --- | --- | --- | --- | --- | --- |
| Icono cuadrado | `icono/icono.png`; `public/icono.png` | PNG 1,450,285 bytes; 1024×1024 | Ambos `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c` | `339243ee` (2025-09-04); `public/icono.png` también aparece en `9fdd43e` (2025-11-13); autor visible `fdxruli` | No se encontró referencia de código rastreada al nombre de archivo |
| Wordmark PNG | `icono/icono-web.png` | PNG 1,382,145 bytes; 1024×1024 | `f18a142863439b8a147d335f2232c23edabc2b1cde4b42b4ff959020378b5ef5` | `339243ee` (2025-09-04); autor visible `fdxruli` | No se encontró referencia de código rastreada al nombre de archivo |
| Iconos PWA/L-mark | `public/icono-web.png`; `public/pwa-192x192.png`; `public/pwa-512x512.png` | Dos PNG de 4,411 bytes y 192×192; uno de 17,575 bytes y 512×512 | 192×192: `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673`; 512×512: `b8dfbddccca477b9ca8125ab3f9a9f790e8f8040fb5a1f3480509680217f2460` | `public/icono-web.png`: `339243ee`, `9fdd43e`, `21ede67`; PWA: `21ede67` (2026-01-21); autor visible `fdxruli` | `pwa-192x192.png` y `pwa-512x512.png` en `src/pwa/adminManifest.js`, `src/pwa/adminPwaDocument.js`, pruebas y `vite.config.js` |
| Wordmark SVG | `public/log.svg` | SVG 476 bytes; 320×80 | `3cc39f6eff3148fbeb418eb3ff18397e537067ebf8a172e2324782609f1c1ae2` | `1d599ed0` (2025-11-21); autor visible `fdxruli` | No se encontró consumo de código directo |
| Marca SVG | `public/logIcon.svg` | SVG 338 bytes; 120×120 | `fd0e93e021a8d91d0272753f295d48862fef2c8c9bff91a8e6b90ddab313c98a` | `1d599ed0` (2025-11-21); autor visible `fdxruli` | `index.html`, `src/components/common/WelcomeModal.jsx`, `store/index.html`, `vite.config.js` |
| Icono del asistente | `public/boticon.svg` | SVG 1,026 bytes; 120×120 | `93bf10b60605088cfbd4f35fe23b82f4d9f387fa604f72f5fff54931debea1c4` | `a1e50593` (2026-02-08); autor visible `fdxruli` | `src/components/common/AssistantBot.jsx` |

## 4. Duplicados, derivados y contradicciones

### Duplicados confirmados

- `icono/icono.png` y `public/icono.png` son idénticos byte a byte:
  Git blob `3ed6f593705cb0a36d56569c2fc176ab9433be59`, SHA-256
  `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c`.
- `public/icono-web.png` y `public/pwa-192x192.png` son idénticos byte a
  byte: Git blob `06d18d0fd869d74311c5e11f65eeb51406f2ecb9`, SHA-256
  `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673`.

No se confirmó ningún otro duplicado byte a byte.

### Derivados confirmados o limitados

- La pareja de `icono/*.png` tiene una relación de duplicado confirmada, pero
  el historial no prueba cuál fue el archivo de diseño original.
- La pareja de 192×192 tiene una relación de duplicado confirmada.
- `public/pwa-512x512.png` comparte visualmente el motivo geométrico L con los
  PNG de 192×192, pero no se pudo reproducir la exportación ni probar que sea
  un redimensionado de un archivo concreto.
- `public/logIcon.svg` comparte el motivo geométrico L y colores con la familia
  PWA, pero su contenido demuestra una recreación vectorial, no una conversión
  directa desde un PNG.
- `public/boticon.svg` declara y comenta una derivación del logo original, pero
  no hay evidencia técnica de una conversión de archivo ni permiso separado.

### Contradicción técnica registrada

La declaración describe los PWA como variantes de la identidad principal. La
inspección visual muestra que `icono/icono.png` es una composición de fondo
amarillo con caja registradora y texto `Lanzo Negocio`, mientras que
`public/icono-web.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png` y los
SVG `logIcon` usan un motivo geométrico L sobre fondo oscuro. `icono/icono-web.png`
es otra imagen de fondo amarillo con el wordmark `Lanzo`. Por eso no se afirma
una única fuente canónica para las nueve rutas.

La declaración de uso de IA para los tres SVG coincide con la ausencia de
metadatos de proveedor en sus contenidos, pero no permite verificar el
proveedor, términos históricos ni el expediente de revisión humana.

## 5. Inspección de SVG y tipografías

- `public/log.svg` es autocontenido: contiene un rectángulo, dos paths, un
  elemento `<text>` con `font-family="sans-serif"` y un círculo. El texto no
  está convertido a curvas. No hay `metadata`, `image`, `href`, enlaces,
  `data:` URI, namespace de editor o fuente externa identificada.
- `public/logIcon.svg` es autocontenido y usa únicamente formas geométricas y
  colores; no contiene texto, fuente, imagen embebida ni enlace externo.
- `public/boticon.svg` es autocontenido y contiene comentarios que describen
  un estilo derivado del logo original; no contiene imágenes, fuentes,
  enlaces, `data:` URI ni referencias a otro archivo. Los comentarios no son
  prueba independiente de procedencia.

## 6. Clasificación por familia

`TRADEMARK-RESERVED` se aplica al alcance de todas las familias de identidad y
no sustituye la clasificación de procedencia.

### Fuente canónica y derivados

| Familia | Fuente canónica probable | Derivados o relación | Origen/herramienta declarado | Tercero implicado |
| --- | --- | --- | --- | --- |
| Icono cuadrado | No verificada; `icono/icono.png` es el candidato de inventario | `public/icono.png` es duplicado byte a byte | Creado por `fdxruli`; herramienta y proceso no documentados | Ninguno identificado; no descartado por completo |
| Wordmark PNG | No verificada; `icono/icono-web.png` es el único archivo de esa variante | No confirmado | Relacionado con el logo principal; autor y herramienta no documentados | Ninguno identificado; no descartado por completo |
| Iconos PWA/L-mark | No verificada; no se puede escoger entre los archivos PWA como fuente de diseño | `public/icono-web.png` y `public/pwa-192x192.png` son duplicados; `pwa-512x512` es una variante sin exportación reproducida | Variantes declaradas; fuente y herramienta no documentadas | Ninguno identificado |
| Wordmark SVG | `public/log.svg` solo como archivo vectorial autónomo; no se probó una fuente anterior | No confirmado | Generado con IA; proveedor desconocido | Ninguno identificado en el SVG |
| Marca SVG | `public/logIcon.svg` solo como archivo vectorial autónomo; no se probó conversión desde PNG | Relación visual con PWA, no conversión demostrada | Generado con IA bajo dirección del mantenedor; proveedor desconocido | Ninguno identificado en el SVG |
| Icono del asistente | `public/boticon.svg` como archivo autónomo | Derivación del logo original declarada y comentada, sin conversión técnica probada | Generado/modificado con IA; proveedor desconocido | Ninguno identificado deliberadamente |

| Familia | Procedencia | Alcance | Riesgo | Acción |
| --- | --- | --- | --- | --- |
| Icono cuadrado (`icono/icono.png`, `public/icono.png`) | `UNKNOWN` | `TRADEMARK-RESERVED` | Material de marca; declaración de autoría sin expediente de creación o permiso independiente | Mantener intacto en esta tarea; obtener evidencia adicional o reemplazar antes de activar OSS |
| Wordmark PNG (`icono/icono-web.png`) | `UNKNOWN` | `TRADEMARK-RESERVED` | Autor, herramienta y posibles elementos externos no reconstruibles | Mantener intacto; evidencia adicional o reemplazo posterior |
| Iconos PWA/L-mark | `UNKNOWN` | `TRADEMARK-RESERVED` | Fuente y exportación no documentadas; relación con el icono cuadrado no demostrada | Mantener intactos; confirmar fuente/licencia o reemplazar posteriormente |
| Wordmark SVG (`public/log.svg`) | `REVIEW REQUIRED` — uso de IA declarado, proveedor y términos desconocidos | `TRADEMARK-RESERVED` | Texto genérico no externo, pero procedencia y términos de IA no verificables | Conservar; revisar proveedor/términos o sustituir en `OSS.1.4B-R` |
| Marca SVG (`public/logIcon.svg`) | `REVIEW REQUIRED` — uso de IA declarado, conversión no demostrada | `TRADEMARK-RESERVED` | Derivación visual probable, pero sin fuente ni términos documentados | Conservar; revisar procedencia o sustituir posteriormente |
| Icono del asistente (`public/boticon.svg`) | `REVIEW REQUIRED` — derivación y uso de IA declarados, proveedor desconocido | `TRADEMARK-RESERVED` | Similaridad con identidad propia declarada; no se descarta similitud accidental | Conservar; confirmar expediente o sustituir posteriormente |

### Estado agregado

| Estado | Familias | Archivos | Observación |
| --- | ---: | ---: | --- |
| `VERIFIED FIRST-PARTY` | 0 | 0 | La declaración no demuestra creación desde cero ni permiso suficiente |
| `AI-ASSISTED / HUMAN-REVIEWED` | 0 confirmado | 0 | Hay uso de IA declarado, pero no un expediente separado de revisión humana y términos |
| `VERIFIED THIRD-PARTY` | 0 | 0 | No se identificó una fuente de tercero con licencia y recurso exactos |
| `DERIVATIVE — PERMISSION VERIFIED` | 0 | 0 | No hay permiso documentado para ninguna derivación |
| `REVIEW REQUIRED` | 3 | 3 | Los tres SVG tienen declaración de IA/derivación, sin proveedor o términos verificables |
| `UNKNOWN` | 3 | 6 | PNG de marca/PWA sin fuente de diseño demostrable |
| `BLOCKER` | 3 familias materiales | 6 | El estado `UNKNOWN` bloquea la transición OSS; no se demostró copia o licencia incompatible |
| `REPLACEMENT REQUIRED` | 0 por ahora | 0 | La sustitución se recomienda, pero no se ejecuta ni se ordena como cambio de esta tarea |

## 7. Nombre, identidad y Entre Alas

El nombre `Lanzo` fue declarado como elegido por el mantenedor y no tomado
deliberadamente de otro producto, empresa o proyecto. `README.md` declara que
el proyecto fue iniciado y patrocinado gracias a la dark kitchen `Entre Alas`.
La declaración de esta tarea autoriza mencionar públicamente a Entre Alas como
origen operativo y patrocinador inicial, pero no prueba registro marcario,
titularidad ni autorización indefinida sobre elementos visuales.

La política separada está en [`TRADEMARK_POLICY.md`](../TRADEMARK_POLICY.md).
No existe evidencia local para afirmar que `Lanzo` o `Lanzo-POS` estén
registrados. Los forks deben cambiar nombre, logos, iconos y apariencia oficial.

## 8. Relación con terceros y avisos

No se encontró material visual externo concreto, plantilla, biblioteca de
iconos, imagen embebida o fuente externa en los nueve archivos. No se añade
ningún logo propio como dependencia de terceros. La ausencia de una fuente
identificada no convierte automáticamente los activos en `VERIFIED FIRST-PARTY`.

La declaración completa está en
[`docs/OSS-ASSET-DECLARATION.md`](OSS-ASSET-DECLARATION.md) y los avisos
existentes de dependencias se mantienen separados en
[`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

## 9. Limitaciones y acción de salida

La declaración del mantenedor es evidencia de primera parte y no sustituye
derechos de terceros. No se publican prompts privados, nombres legales,
domicilios, RFC, teléfonos, correos privados, cuentas privadas ni datos de
clientes. No se realizó una búsqueda marcaria exhaustiva ni se consultaron
términos históricos de un proveedor no identificado.

La decisión permitida por la evidencia actual es:

- **ASSET NO-GO**: seis archivos PNG de identidad permanecen `UNKNOWN` y tres
  familias SVG permanecen `REVIEW REQUIRED`;
- **OSS.1.4 BLOCKED — NO-GO**: la conclusión de dependencias sigue siendo
  `DEPENDENCY CONDITIONAL GO`, pero los activos materiales no cumplen el
  umbral de `ASSET CONDITIONAL GO`;
- no se activa AGPL, no se crea `LICENSE` y no se reemplazan activos.

El siguiente paso histórico era obtener documentación adicional de
origen/permiso o realizar una sustitución separada como `OSS.1.4B-R`.

## Cierre vigente de OSS.1.4B-R

La sustitución ya está implementada: los activos actuales desconocidos son
`0`, los blockers actuales son `0` y todos los derivados corresponden a las
tres fuentes canónicas verificadas por `brand:check`. La decisión de activos
es **ASSET CONDITIONAL GO** y OSS.1.4 queda **COMPLETE — CONDITIONAL GO**,
condicionado a la aprobación visual del mantenedor antes del merge. Las
dependencias conservan **DEPENDENCY CONDITIONAL GO**. AGPL sigue prevista,
no vigente, y no se creó `LICENSE`.
