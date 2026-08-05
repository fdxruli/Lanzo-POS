# OSS.1.4B — Procedencia de activos e identidad

Fecha del inventario: 2026-08-03. Repositorio: `fdxruli/Lanzo-POS`.
Base auditada: `origin/main` en
`19f4087bf23b2920154fb72bd6417a4509508ac0`.

## OSS.1.4.1 — reconciliación vigente

Fecha de auditoría: 2026-08-04. La base exacta es `origin/main` en
`bf5baca14822d2b343f04ee34244f329b32a23aa`.

**Resultado:** `PROVENANCE RECONCILED WITH NOTES`.

El inventario, los hashes, el historial, el consumo y la declaración quedan
reconciliados sin alterar los activos. Permanecen notas de procedencia y
distribución: los PNG PWA siguen `UNKNOWN` y los SVG siguen `REVIEW REQUIRED`;
los dos PNG grandes tienen un proveedor de IA declarado en metadata C2PA, pero
no una validación independiente de firma, derechos o términos. Por ello los
activos no pasan a GO y OSS.1.4 permanece **BLOCKED — NO-GO**.

### Precondiciones remotas y base

| Control | Evidencia |
| --- | --- |
| PR #170 | Fusionado; merge commit `0decbc4124fed4e8cda4e807a9a400f7257e3084` |
| PR #171 | Cerrado sin merge; head rechazado `72590fd200be6200e44cf64c14ef38204526d4bf` |
| PR #176 | Fusionado; merge commit `bf5baca14822d2b343f04ee34244f329b32a23aa` |
| SHA actual de `origin/main` | `bf5baca14822d2b343f04ee34244f329b32a23aa` |
| Ancestralidad #170 | `git merge-base --is-ancestor`: exit 0 |
| Ancestralidad #176 | `git merge-base --is-ancestor`: exit 0 |
| Ancestralidad del head rechazado #171 | `git merge-base --is-ancestor`: exit 1; no es ancestro |
| Worktree previo | Limpio sobre `main`; `HEAD` y `origin/main` coincidían |

El `HEAD` inicial de la rama de trabajo fue
`bf5baca14822d2b343f04ee34244f329b32a23aa`. La rama creada exclusivamente para
esta tarea es `docs/oss-current-asset-provenance`.

### Decisión de conservación

Se conservan `public/log.svg`, `public/logIcon.svg`, `public/boticon.svg`, los
seis PNG actuales y sus rutas. No se rediseña, regenera, normaliza ni reemplaza
ningún activo; no se cambian consumidores. La conservación es una decisión de
mantenimiento, no evidencia suficiente de autoría o permiso de redistribución.

### Inventario vigente completo

Los SHA-256 son de los bytes de `origin/main`; el SHA de blob es el objeto Git
de la ruta actual. La incorporación y el último cambio se expresan como
commits visibles y sin correos privados.

| Ruta | Formato; bytes; dimensiones | SHA-256 | Git blob SHA | Incorporación / último cambio en `origin/main` | Consumo y estado | Familia; procedencia; distribución |
| --- | --- | --- | --- | --- | --- | --- |
| `icono/icono.png` | PNG; 1,450,285; 1024×1024 | `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c` | `3ed6f593705cb0a36d56569c2fc176ab9433be59` | Alta `339243ee` / último `339243ee`; 2025-09-04; `fdxruli` | Sin consumidor de código; `TRACKED BUT UNUSED` | Identidad oficial; `AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA`; firma/cadena de confianza no verificadas; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/icono.png` | PNG; 1,450,285; 1024×1024 | `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c` | `3ed6f593705cb0a36d56569c2fc176ab9433be59` | Alta de ruta `9fdd43e` / último `9fdd43e`; 2025-11-13; `fdxruli`; contenido relacionado desde `339243ee` | Sin consumidor de código; `TRACKED BUT UNUSED`; duplicado exacto | Identidad oficial; `AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA` por bytes compartidos; firma/cadena de confianza no verificadas; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `icono/icono-web.png` | PNG; 1,382,145; 1024×1024 | `f18a142863439b8a147d335f2232c23edabc2b1cde4b42b4ff959020378b5ef5` | `4a632cb5bbc4bee9d0be4442ae44bb2adb759659` | Alta `339243ee` / último `339243ee`; 2025-09-04; `fdxruli` | Sin consumidor de código; `TRACKED BUT UNUSED` | Identidad oficial; `AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA`; firma/cadena de confianza no verificadas; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/icono-web.png` | PNG; 4,411; 192×192 | `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673` | `06d18d0fd869d74311c5e11f65eeb51406f2ecb9` | Alta de ruta `9fdd43e` / último `21ede67`; 2026-01-21; `fdxruli`; reemplazó 1,382,145 bytes | Sin consumidor exacto; `TRACKED BUT UNUSED`; duplicado exacto de PWA 192 | PWA; `UNKNOWN`; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/pwa-192x192.png` | PNG; 4,411; 192×192 | `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673` | `06d18d0fd869d74311c5e11f65eeb51406f2ecb9` | Alta y último `21ede67`; 2026-01-21; `fdxruli` | `src/pwa/adminManifest.js`, `adminPwaDocument.js`, prueba y precache; `ACTIVE PWA ASSET` | PWA; `UNKNOWN`; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/pwa-512x512.png` | PNG; 17,575; 512×512 | `b8dfbddccca477b9ca8125ab3f9a9f790e8f8040fb5a1f3480509680217f2460` | `717cf15f0cc9117847f2266adab77ad0a3dd0f0c` | Alta y último `21ede67`; 2026-01-21; `fdxruli` | Manifest y precache; `ACTIVE PWA ASSET` | PWA; `UNKNOWN`; variante/derivado no demostrado; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/log.svg` | SVG; 476; 320×80 | `3cc39f6eff3148fbeb418eb3ff18397e537067ebf8a172e2324782609f1c1ae2` | `4058be73e1c0e740bf33217ed52630feeccc8bc5` | Alta y último `1d599ed0`; 2025-11-21; `fdxruli` | Sin consumo directo; `TRACKED BUT UNUSED` | Identidad oficial; `AI-ASSISTED — PROVIDER UNKNOWN`; `REVIEW REQUIRED`; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/logIcon.svg` | SVG; 338; 120×120 | `fd0e93e021a8d91d0272753f295d48862fef2c8c9bff91a8e6b90ddab313c98a` | `58a26ebf427c3b6b60ddd58101da19588b6b4b1a` | Alta y último `1d599ed0`; 2025-11-21; `fdxruli` | Favicon administrativo, bienvenida, store y precache; `ACTIVE PRODUCT ASSET` + `ACTIVE STORE ASSET` | Identidad oficial; `AI-ASSISTED — PROVIDER UNKNOWN`; `REVIEW REQUIRED`; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |
| `public/boticon.svg` | SVG; 1,026; 120×120 | `93bf10b60605088cfbd4f35fe23b82f4d9f387fa604f72f5fff54931debea1c4` | `b2436426b116e0dd062813890258f683208b0abe` | Alta y último `a1e50593`; 2026-02-08; `fdxruli` | `src/components/common/AssistantBot.jsx`; `ACTIVE PRODUCT ASSET` | Interfaz/asistente; `DERIVATIVE — SOURCE UNKNOWN` y proveedor IA desconocido; `REVIEW REQUIRED`; `TRADEMARK-RESERVED`; `REDISTRIBUTION NOT CLEARED` |

No se encontraron otras rutas rastreadas con extensiones visuales o de fuente
(`png`, `svg`, `jpg`, `jpeg`, `webp`, `gif`, `avif`, `ico`, `bmp`, `tiff`, `pdf`,
`woff`, `woff2`, `ttf`, `otf`). No hay fuentes tipográficas rastreadas en el
inventario. Las URLs de imágenes aportadas por usuarios no son archivos de este
inventario.

### Comparación de hashes y relaciones

Los nueve SHA-256 actuales coinciden con la línea base de OSS.1.4:
`UNCHANGED SINCE OSS.1.4`. No hay `MODIFIED SINCE OSS.1.4`, `REMOVED` ni `NEW
ASSET`. Tampoco hay cambios de los nueve activos entre el merge de #170 y
`origin/main` actual.

Duplicados exactos confirmados:

- `icono/icono.png` = `public/icono.png`, mismo SHA-256 y mismo blob Git.
- `public/icono-web.png` = `public/pwa-192x192.png`, mismo SHA-256 y mismo blob Git.

Derivados demostrados: únicamente esos dos pares de duplicación byte a byte.
El historial muestra que `public/icono-web.png` fue reducido de 1,382,145 a
4,411 bytes en `21ede67`, y que PWA 192 se añadió con esos mismos bytes; no
demuestra un archivo fuente de diseño. `public/pwa-512x512.png` comparte familia
declarada, pero su redimensionado/exportación no es reproducible desde el
historial. La relación visual de `logIcon.svg` con PWA no demuestra conversión.
La derivación de `boticon.svg` está declarada y comentada dentro del archivo,
pero no prueba una conversión técnica ni permiso separado.

Ningún archivo es una fuente canónica de diseño demostrada. Como fuente
canónica probable de inventario se puede usar `icono/icono.png` para la pareja
cuadrada y `icono/icono-web.png` para la variante raster de 1024×1024, sin
convertir esa probabilidad en `VERIFIED FIRST-PARTY`.

### Metadata PNG y procedencia embebida

Los dos PNG de 1024×1024 tienen un chunk `caBX` con contenido C2PA legible. No
presentan chunks `tEXt`, `iTXt` o `zTXt`; la metadata relevante está en el bloque
C2PA. Los tres PNG de PWA sólo presentan `IHDR`, `IDAT` e `IEND`, sin metadata
de editor legible. La evidencia C2PA contiene una declaración de
proveedor/modelo, pero no se realizó validación independiente de firma,
autenticidad o cadena de confianza y no se infiere licencia ni autoría.

### Inspección SVG actual

| Ruta | Elementos | Texto/fuente | Paths/formas | Imágenes/enlaces/data URI | Metadata/comentarios/referencias |
| --- | --- | --- | --- | --- | --- |
| `public/log.svg` | `rect`, 2 `path`, `text`, `circle` | Texto `LANZO`; `font-family="sans-serif"`; no fuente embebida | Fondo redondeado, dos paths y círculo | 0; sólo namespace SVG; sin `href` ni `data:` | Sin `metadata`, comentarios ni referencias externas |
| `public/logIcon.svg` | `rect`, 2 `path`, `circle` | Sin texto ni fuente | Fondo redondeado, dos paths y círculo | 0; sólo namespace SVG; sin `href` ni `data:` | Sin `metadata` ni comentarios |
| `public/boticon.svg` | `rect`×3, `path`×3, `circle`×3 | Sin texto ni fuente | Fondo, cabeza/cuerpo, ojos, indicadores y antena | 0; sólo namespace SVG; sin `href` ni `data:` | Sin `metadata`; 7 comentarios internos describen la relación declarada con el logo |

Los SVG no fueron normalizados, optimizados, convertidos ni modificados.

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

### Evidencia de exclusión del PR #171

GitHub confirma #171 como `CLOSED`, `merged=false`, con head
`72590fd200be6200e44cf64c14ef38204526d4bf`. La lista verificada del diff
incluye, entre otros cambios, los siguientes archivos exclusivos del sistema
rechazado:

- `brand/BRAND-PROVENANCE.md`, `brand/LEGACY-ASSET-NOTICE.md`,
  `brand/brand-assets.manifest.json`, `brand/brand-tokens.json`;
- `brand/lanzo-assistant.svg`, `brand/lanzo-mark.svg`,
  `brand/lanzo-wordmark.svg`;
- `scripts/generate-brand-assets.mjs`.

Esas ocho rutas están ausentes de `origin/main`. También están ausentes los
términos específicos `brand:generate`, `brand:check`, `brand-assets.manifest`,
`lanzo-mark.svg`, `lanzo-wordmark.svg`, `lanzo-assistant.svg`, `Punto de impulso`
y `SUPERSEDED — NOT PART OF THE CURRENT BRAND ASSET SET`. En las rutas de
activos compartidas, los blobs de #171 son distintos de los blobs actuales; las
rutas `icono/*` y `public/icono.png` fueron eliminadas en la rama rechazada.
El commit rechazado no es ancestro de `origin/main` ni de esta rama.

Resultado: **REJECTED PR #171 CONTENT: NOT PRESENT**. No se copiaron sus SVG,
scripts, manifest, hashes ni componentes; no se ejecutaron `brand:generate` ni
`brand:check`.

### Política de consumo

La clasificación de consumo se limita a referencias exactas/relativas
rastreadas con `git grep`:

- `public/pwa-192x192.png`: `ACTIVE PWA ASSET`, manifest, apple-touch-icon,
  pruebas y precache.
- `public/pwa-512x512.png`: `ACTIVE PWA ASSET`, manifest y precache; aparece dos
  veces en manifest para `any` y `maskable`.
- `public/logIcon.svg`: `ACTIVE PRODUCT ASSET` y `ACTIVE STORE ASSET`, favicon,
  modal de bienvenida y precache.
- `public/boticon.svg`: `ACTIVE PRODUCT ASSET`, imagen del asistente.
- `icono/icono.png`, `public/icono.png`, `icono/icono-web.png`,
  `public/icono-web.png` y `public/log.svg`: `TRACKED BUT UNUSED`; las únicas
  referencias restantes son documentación, historial o auditoría.

No se eliminaron, consolidaron ni cambiaron referencias. Los uploads y URLs de
imágenes de usuarios quedan fuera de esta clasificación porque son contenido
de runtime, no archivos distribuidos por estas rutas.

### Clasificación de procedencia y distribución

| Eje | Familias actuales |
| --- | --- |
| `VERIFIED FIRST-PARTY` | Ninguna; Git y la incorporación del mantenedor no prueban autoría material |
| `MAINTAINER-ATTESTED` | Declaración de identidad y decisión de conservación; no es el estado exclusivo de procedencia de un archivo |
| `AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA` | PNG 1024×1024 y su duplicado exacto; sólo refleja una declaración embebida, sin firma o cadena de confianza verificadas |
| `AI-ASSISTED — PROVIDER UNKNOWN` | `public/log.svg`, `public/logIcon.svg` |
| `VERIFIED THIRD-PARTY` | Ninguna |
| `DERIVATIVE — SOURCE VERIFIED` | Ninguna |
| `DERIVATIVE — SOURCE UNKNOWN` | `public/boticon.svg`; la derivación está declarada, pero la fuente y el permiso no están demostrados |
| `UNKNOWN` | `public/icono-web.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png` |
| `REVIEW REQUIRED` | Los tres SVG; los PNG PWA permanecen `UNKNOWN` por fuente/exportación no documentada |
| `REPLACEMENT REQUIRED` | Ninguno como acción automática; sólo puede evaluarse por familia en OSS.1.4.2 |

En distribución, ningún activo tiene autorización separada documentada:
`REDISTRIBUTION NOT CLEARED`. La política de marca aplica
`TRADEMARK-RESERVED` a la identidad oficial, pero no sustituye procedencia ni
copyright. No se identificó una licencia separada de activos ni un activo de
tercero verificable.

### Declaración del mantenedor y política de marca

Se conservó la declaración histórica y la **Opción 3**. La sección nueva de
decisión de conservación no atribuye proveedor, prompt, herramienta de diseño,
fecha de creación, licencia o cesión de derechos al mantenedor. La diferencia
entre intención de conservar y evidencia de procedencia permanece explícita.

`TRADEMARK_POLICY.md` fue revisada: separa código, nombre Lanzo, logos/iconos,
apariencia oficial, capturas promocionales, Entre Alas y forks; no afirma
registro marcario ni derechos exclusivos mundiales, y deja claro que la licencia
del código no concede automáticamente derechos sobre la identidad. No requería
corrección en esta auditoría.

`THIRD_PARTY_NOTICES.md` fue revisado. No se identificó un recurso visual de
tercero, proveedor de imagen, plantilla, fuente, biblioteca o licencia exactos:
**NO SPECIFIC THIRD-PARTY ASSET IDENTIFIED**. La mención de OpenAI dentro de
metadata C2PA es una declaración de provenance del archivo, no la identificación
de un recurso visual de tercero ni un aviso de licencia suficiente.

### Matriz precisa para OSS.1.4.2

| Familia no resuelta | Evidencia disponible | Evidencia ausente | Riesgo/impacto | Acción mínima concreta | Quién debe aportarla | ¿Documental? | ¿Sustitución? | ¿Reserva de marca? | ¿Bloquea distribución OSS? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Icono cuadrado (`icono/icono.png`, `public/icono.png`) | Declaración del mantenedor; duplicado exacto; metadata C2PA que nombra GPT-4o/OpenAI API/ChatGPT; historial de incorporación | Archivo fuente, proceso, validación C2PA de confianza, términos históricos y autorización de redistribución | Autoría/licencia no reconstruibles; dos copias rastreadas sin consumidor | Aportar archivo fuente o declaración explícita de creación y permiso, y conservar evidencia del proveedor/términos; si falla, sustituir sólo esta familia o excluirla de paquetes | Mantenedor; proveedor sólo si puede recuperarse públicamente | Sí, salvo que falte permiso | Sólo si no se aclara | Sí, mientras no se redistribuya como libre | Sí |
| Wordmark PNG (`icono/icono-web.png`) | Declaración de relación con identidad; C2PA con proveedor declarado; historial y hash estables | Fuente, exportación, derechos sobre composición y términos | Wordmark material sin reproducción técnica | Localizar fuente o aportar declaración de creación/permiso y términos C2PA; sustituir sólo esta familia si la evidencia falla | Mantenedor y proveedor identificado en metadata | Sí, salvo que falte permiso | Sólo si no se aclara | Sí | Sí |
| PWA (`public/icono-web.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png`) | Dos duplicados exactos; consumidores PWA; variante 512 rastreada; declaración de que son variantes | Fuente canónica y herramienta/exportación; relación reproducible con 512 | PWA activa sin fuente de exportación verificable | Documentar fuente y comando/exportación, o aportar una familia con licencia separada; si no, reemplazar sólo derivados PWA | Mantenedor o diseñador original | Sí, si se conserva cadena de exportación | Sí, sólo la familia PWA | Sí | Sí |
| `public/log.svg` y `public/logIcon.svg` | Declaración de generación con IA; SVG autocontenido; proveedor/modelo y términos no están en los bytes | Proveedor, cuenta/modalidad, términos históricos, prompt y revisión humana verificable | Procedencia IA y redistribución no aclaradas; relación vector/PNG no demostrada | Identificar proveedor y términos aplicables, o aportar expediente de creación y revisión; si no, sustituir la familia SVG | Mantenedor y proveedor | Parcial; requiere términos | Sí, sólo SVG afectados | Sí | Sí |
| `public/boticon.svg` | Declaración y comentarios de derivación del logo; consumo activo; SVG autocontenido | Fuente técnica, permiso de derivación, proveedor/términos IA y revisión de similitud | Riesgo de derivación sin fuente/permiso separado | Documentar la fuente y permiso de derivación o declarar una creación independiente verificable; sustituir sólo el bot si no se aclara | Mantenedor y fuente original, si existe | Sí, si la relación puede probarse | Sí, sólo boticon | Sí | Sí |

No ejecutar estas acciones en OSS.1.4.1. El handoff es la recopilación concreta
de evidencia anterior, no una orden de reemplazo preventivo.

### Resultado global y handoff

- OSS.1.4.1: **PROVENANCE RECONCILED WITH NOTES**.
- Activos: **ASSET NO-GO / ASSET REVIEW REQUIRED** según la familia.
- Dependencias: conservar **DEPENDENCY CONDITIONAL GO**.
- OSS.1.4: **BLOCKED — NO-GO**.
- OSS.1.5: sin cambios.
- OSS.2: `BLOCKED`.
- AGPL: prevista, no vigente; no se creó `LICENSE`.
- Siguiente tarea: **OSS.1.4.2**, empezando por el archivo fuente y los términos
  de los tres grupos `UNKNOWN`/`REVIEW REQUIRED`, sin modificar estos activos
  hasta contar con evidencia o una decisión separada de sustitución.

### Validaciones y límites operativos

Se ejecutaron `git fetch origin --prune`, comprobaciones de estado, historial,
`git grep`, `git hash-object`, `git cat-file`, `git diff` y validaciones de
ancestros. No se ejecutaron builds, `npm ci`, ESLint, pruebas frontend,
`brand:generate` ni `brand:check`. No se usaron Docker, Ubuntu/Linux como
requisito, PostgreSQL local, Supabase, Vercel, despliegues, previews,
buscadores visuales, reverse image search, OCR o generadores de imágenes.

Los activos no fueron modificados: el diff de los nueve paths contra
`origin/main` es vacío. El código productivo, dependencias, manifiestos,
`supabase/`, `vercel.json`, `.github/`, `LICENSE` y archivos de entorno tampoco
se modifican por esta tarea. No se reescribió el historial y AGPL no se activó.

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

La implementación del límite técnico de la siguiente fase está documentada en
[`docs/OSS-RELEASE-BOUNDARY.md`](OSS-RELEASE-BOUNDARY.md). Este enlace no
modifica las conclusiones históricas ni concede permisos sobre los activos
restringidos.

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

El siguiente paso seguro es obtener documentación adicional de origen/permiso
o realizar una sustitución separada como `OSS.1.4B-R`.

## OSS.1.4.2 — Resolución de evidencia y límite de distribución

Fecha de resolución: 2026-08-04. La base reproducida es `origin/main` en
`6c5144d7e9327bcc3f9ec78adfc66776dc0d304e`, que coincide con el merge commit
del PR #177. Esta sección complementa y no reemplaza la evidencia histórica de
OSS.1.4.1.

**Resultado OSS.1.4.2: `ASSET EVIDENCE EXHAUSTED WITH NOTES`.**

Se agotaron el árbol actual, todas las referencias Git disponibles, los blobs,
los commits de incorporación, el consumo rastreable y los bloques `caBX`
locales. No se recuperó un archivo fuente editable ni una licencia o grant de
redistribución para ninguna familia. La identidad actual se conserva intacta;
esta conservación no convierte los activos en distribuibles bajo una licencia
OSS.

### Integración y exclusión remota

| Control | Evidencia reproducida |
| --- | --- |
| PR #177 | `MERGED`; head `cc6337bdd26b558b52d3ab239998dec19d897bb0`; `merged_at` `2026-08-04T20:37:12Z` |
| Merge commit de #177 | `6c5144d7e9327bcc3f9ec78adfc66776dc0d304e` |
| Base actual | `origin/main` = `6c5144d7e9327bcc3f9ec78adfc66776dc0d304e` |
| Ancestralidad de #177 | `git merge-base --is-ancestor 6c5144d7e9327bcc3f9ec78adfc66776dc0d304e origin/main`: exit 0 |
| PR #171 | `CLOSED`, `merged=false`; head rechazado `72590fd200be6200e44cf64c14ef38204526d4bf` |
| Ancestralidad de #171 | `git merge-base --is-ancestor 72590fd200be6200e44cf64c14ef38204526d4bf origin/main`: exit 1 |
| Contenido rechazado | Las rutas `brand/*`, SVG, manifest y scripts del PR #171 no aparecen en el árbol actual; no se usaron como fuentes |

El worktree previo estaba limpio. La rama de trabajo es
`docs/oss-asset-evidence-resolution` y su `HEAD` inicial fue
`6c5144d7e9327bcc3f9ec78adfc66776dc0d304e`.

### Baseline de inventario

**ASSET INVENTORY BASELINE: PASS.** Se confirmaron exactamente nueve rutas y
seis familias. Los SHA-256 se calcularon sobre los bytes del árbol actual y los
Git blob SHA se obtuvieron del árbol Git de `HEAD`.

| Ruta | Bytes | Dimensiones | SHA-256 | Git blob SHA | Alta / último cambio | Consumo |
| --- | ---: | --- | --- | --- | --- | --- |
| `icono/icono.png` | 1,450,285 | 1024×1024 | `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c` | `3ed6f593705cb0a36d56569c2fc176ab9433be59` | `339243ee` / `339243ee`; 2025-09-04 | Sin consumo productivo rastreado |
| `public/icono.png` | 1,450,285 | 1024×1024 | `6d171dc8eecdb616bea0fe862880dc80fee5b3b4c8d91d8723839bc6f315dc0c` | `3ed6f593705cb0a36d56569c2fc176ab9433be59` | `9fdd43e` / `9fdd43e`; 2025-11-13 | Sin consumo productivo rastreado; duplicado exacto |
| `icono/icono-web.png` | 1,382,145 | 1024×1024 | `f18a142863439b8a147d335f2232c23edabc2b1cde4b42b4ff959020378b5ef5` | `4a632cb5bbc4bee9d0be4442ae44bb2adb759659` | `339243ee` / `339243ee`; 2025-09-04 | Sin consumo productivo rastreado |
| `public/icono-web.png` | 4,411 | 192×192 | `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673` | `06d18d0fd869d74311c5e11f65eeb51406f2ecb9` | `9fdd43e` / `21ede67`; 2026-01-21 | Sin consumidor exacto; duplicado de PWA 192 |
| `public/pwa-192x192.png` | 4,411 | 192×192 | `85d444cf5d1e2545a916a48ccc8567667a98c890074929e5fab0f30b8bd29673` | `06d18d0fd869d74311c5e11f65eeb51406f2ecb9` | `21ede67` / `21ede67`; 2026-01-21 | Manifest, apple-touch-icon, pruebas y precache |
| `public/pwa-512x512.png` | 17,575 | 512×512 | `b8dfbddccca477b9ca8125ab3f9a9f790e8f8040fb5a1f3480509680217f2460` | `717cf15f0cc9117847f2266adab77ad0a3dd0f0c` | `21ede67` / `21ede67`; 2026-01-21 | Manifest y precache |
| `public/log.svg` | 476 | 320×80 | `3cc39f6eff3148fbeb418eb3ff18397e537067ebf8a172e2324782609f1c1ae2` | `4058be73e1c0e740bf33217ed52630feeccc8bc5` | `1d599ed0` / `1d599ed0`; 2025-11-21 | Sin consumo productivo directo |
| `public/logIcon.svg` | 338 | 120×120 | `fd0e93e021a8d91d0272753f295d48862fef2c8c9bff91a8e6b90ddab313c98a` | `58a26ebf427c3b6b60ddd58101da19588b6b4b1a` | `1d599ed0` / `1d599ed0`; 2025-11-21 | Favicon, bienvenida, store y precache |
| `public/boticon.svg` | 1,026 | 120×120 | `93bf10b60605088cfbd4f35fe23b82f4d9f387fa604f72f5fff54931debea1c4` | `b2436426b116e0dd062813890258f683208b0abe` | `a1e50593` / `a1e50593`; 2026-02-08 | `src/components/common/AssistantBot.jsx` |

No hubo activos nuevos, eliminados ni modificados después del merge de #177.
Los dos pares de duplicados exactos son `icono/icono.png` =
`public/icono.png` y `public/icono-web.png` = `public/pwa-192x192.png`. No se
demostró otra equivalencia byte a byte.

### Expediente C2PA local

Se inspeccionó cada `caBX` con un parser local de chunks PNG. La pareja cuadrada
se contó una sola vez porque sus dos rutas son el mismo blob. Las estructuras
únicas son:

| Archivo representativo | Offset del chunk | Longitud | SHA-256 de bytes `caBX` | Estructura reconocible |
| --- | ---: | ---: | --- | --- |
| `icono/icono.png` y `public/icono.png` | 33 | 51,286 | `91cebb3bc584a549f4f7a02089f67b7eba91296af0465973158f307785572c8e` | JUMBF/C2PA, CBOR, dos manifest URN, assertions de acciones, hash, ingrediente y firma |
| `icono/icono-web.png` | 33 | 47,281 | `bba493cdb032f0845756c644cc16e7b04d5c2cae88225844c143b69d439b010a` | JUMBF/C2PA, CBOR, dos manifest URN, assertions de acciones, hash, ingrediente y firma |

El offset es el inicio del chunk PNG, contando desde el primer byte del archivo.
En ambos conjuntos se reconocieron `c2pa.created`, `c2pa.converted`,
`c2pa.hash.data`, `c2pa.thumbnail.ingredient.jpeg` y `c2pa.ingredient.v3`;
`claim_generator_info` declara `ChatGPT` y `c2pa-rs 0.51.1`; las acciones
declaran `GPT-4o`, `OpenAI API` y `digitalSourceType=trainedAlgorithmicMedia`.
Los manifest identificados fueron:

- Cuadrado: `urn:c2pa:eda76a0e-6d24-4ad1-aa75-3ac7104b9ef1` y
  `urn:c2pa:5b914ad0-ec3f-4db0-a6da-049215566443`.
- Wordmark PNG: `urn:c2pa:d9794f17-6b98-4b2c-bae3-341095773d27` y
  `urn:c2pa:6683cd4c-6a8d-4b90-89b1-dd762bcca0ce`.

Hay una assertion `c2pa.signature` y bytes de certificados reconocibles con
`WebClaimSigningCA`, `Truepic`, `OpenAI`, `ChatGPT` y `Truepic Lens CLI in
ChatGPT`. También se reconocen `sha256` en las assertions de hash. Las cadenas
`250113203646Z`–`260113203645Z` y `211209203946Z`–`261208203945Z` aparecen como
ventanas de validez de certificados; no son timestamps de creación del activo.
No se encontró un timestamp de creación independiente.

Clasificación: **C2PA STRUCTURE PRESENT**, **C2PA PROVIDER DECLARED**,
**C2PA SIGNATURE PRESENT — NOT VERIFIED**, **C2PA TRUST CHAIN NOT VERIFIED** y
**C2PA MANIFEST PARTIAL**. Algunas assertions internas dicen `success` o
`claimSignature.validated`, pero son datos embebidos y no sustituyen una
verificación criptográfica independiente. No se instaló un validador, no se
descargó una raíz de confianza y no se declara firma válida, proveedor
verificado, autor verificado ni copyright verificado.

Los tres PNG PWA sólo contienen `IHDR`, `IDAT` e `IEND`; no contienen `caBX`,
`tEXt`, `iTXt` ni `zTXt` reconocibles.

### Fuentes históricas y exportaciones

La búsqueda en branches, tags, commits, objetos, rutas eliminadas, blobs y
extensiones de proyecto no recuperó `psd`, `ai`, `eps`, `afdesign`, `sketch`,
`fig`, `xcf`, `kra` ni un archivo fuente editable de diseño. Los únicos JSON
relacionados son manifests/configuraciones; los archivos `brand/*` y el script
de generación del PR #171 son **REJECTED PR SOURCE — NOT ACCEPTABLE** y no se
usaron como referencia válida.

Los commits de incorporación recuperados son `339243ee` para los dos PNG de
1024×1024, `9fdd43e` para las copias bajo `public/`, `21ede67` para los tres
PWA, `1d599ed0` para los dos SVG de marca y `a1e50593` para `boticon.svg`.
Todos fueron commits visibles de `fdxruli` con mensaje `Add files via upload`;
eso prueba incorporación al repositorio, no creación material, titularidad ni
permiso.

La única exportación demostrada por bytes es la duplicación de los dos pares
indicados. El historial registra que `public/icono-web.png` pasó de 1,382,145 a
4,411 bytes en `21ede67` y que `public/pwa-192x192.png` se añadió con esos
mismos bytes, pero no conserva la herramienta, comando ni parámetros. Las
pruebas locales de redimensionamiento 512→192 con vecino y promedio de área no
coincidieron píxel a píxel; 512→192 no es una **DETERMINISTIC DERIVATIVE
PROVEN**. La relación restante es **VISUAL FAMILY ONLY** y la cadena de
exportación PWA es **EXPORT CHAIN NOT REPRODUCIBLE**.

### SVG y boticon

`public/log.svg` es autocontenido, contiene `LANZO`, `font-family="sans-serif"`,
un `rect`, dos `path`, un `text` y un `circle`; no contiene imágenes, enlaces,
`data:` URI ni una fuente embebida. `public/logIcon.svg` es autocontenido, sin
texto ni fuente, y sólo contiene formas geométricas. Ninguno prueba que sea una
conversión del PNG o una fuente canónica. Para los tres SVG, los términos del
proveedor no están disponibles en código, Git o GitHub autorizado:
**PROVIDER TERMS NOT AVAILABLE FROM AUTHORIZED EVIDENCE**.

`public/boticon.svg` tiene siete comentarios internos que describen un bot
abstracto con el estilo del logo original: fondo, cabeza, cuerpo, ojos,
indicadores y antena. Esos comentarios identifican una descripción conceptual,
no una ruta de fuente. No existe versión histórica distinta, conversión técnica
demostrable ni permiso explícito de derivación. Su clasificación es
**DERIVATIVE — SOURCE UNKNOWN**; no se modificó el SVG.

### Consumo y familias

Activos activos: `public/pwa-192x192.png`, `public/pwa-512x512.png`,
`public/logIcon.svg` y `public/boticon.svg`.

Activos sin consumo productivo rastreado: `icono/icono.png`,
`public/icono.png`, `icono/icono-web.png`, `public/icono-web.png` y
`public/log.svg`. Continúan rastreados porque son identidad histórica, copia o
variante de exportación documentada; su presencia no es necesaria para los
consumidores actuales y amplía el riesgo de una futura distribución, pero no se
eliminan, mueven ni cambian en OSS.1.4.2.

### Decisión de distribución por familia

Todas las familias conservan el alcance `TRADEMARK-RESERVED`. Ninguna obtiene
`DISTRIBUTION CLEARED`: la presencia en el repositorio y la declaración de
conservación no son un grant de copia o redistribución. La clasificación de
límite de distribución es deliberadamente única por familia:

| Familia | Evidencia recuperada | C2PA | Fuente | Derechos | Consumo | Decisión de distribución | Acción siguiente |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Icono cuadrado | Declaración del mantenedor, dos rutas duplicadas, incorporación `339243ee`/`9fdd43e` | Declarado en 3 rutas contando duplicado; firma y cadena no verificadas | `POSSIBLE SOURCE — NOT PROVEN`; no hay editable | Sin grant de redistribución; `PROVIDER TERMS NOT AVAILABLE FROM AUTHORIZED EVIDENCE` | Sin consumo | `MAINTAINER EVIDENCE REQUIRED` | Aportar declaración concreta de creación, fuente/edición y autorización de redistribución y modificación |
| Wordmark PNG | PNG 1024×1024, relación declarada con identidad y commit `339243ee` | `C2PA PROVIDER DECLARED`; firma no verificada | `EXPORT SOURCE NOT FOUND` | Composición, tipografía rasterizada y términos no documentados | Sin consumo | `MAINTAINER EVIDENCE REQUIRED` | Documentar fuente, exportación, elementos externos y grant explícito |
| Familia PWA | Dos duplicados 192×192, variante 512×512, manifest y precache | Ausente en los tres PNG PWA | `EXPORT SOURCE NOT FOUND`; fuente canónica no probada | Derechos sobre fuente y derivados no documentados | Activa | `MAINTAINER EVIDENCE REQUIRED` | Aportar fuente y cadena/comando de exportación, o una declaración de derechos para los tres derivados |
| Wordmark SVG | SVG autocontenido, `LANZO`, formas y `sans-serif`, commit `1d599ed0` | Ausente | `HISTORICAL SOURCE NOT FOUND` | IA declarada, proveedor y términos desconocidos | Sin consumo | `MAINTAINER EVIDENCE REQUIRED` | Identificar proveedor/cuenta/términos o aportar expediente de creación y permiso |
| Marca SVG | SVG autocontenido geométrico, commit `1d599ed0`, relación visual PWA | Ausente | `HISTORICAL SOURCE NOT FOUND` | No se prueba conversión ni licencia de copia | Activa como `logIcon.svg` | `MAINTAINER EVIDENCE REQUIRED` | Documentar relación, fuente y autorización de redistribución/modificación |
| Icono del asistente | Comentarios de derivación, commit `a1e50593`, consumo en `AssistantBot.jsx` | Ausente | `DERIVATIVE — SOURCE UNKNOWN` | Permiso de derivación y términos IA desconocidos | Activo | `MAINTAINER EVIDENCE REQUIRED` | Identificar fuente probable o declarar creación independiente y permiso explícito |

La decisión vigente no ordena sustitución automática. Si no llega evidencia
suficiente, las familias que requieren exclusión o sustitución son, por ahora,
las seis; la sustitución queda fuera de esta tarea y no se ejecuta.

### Declaración del mantenedor y licencia separada

La **OPCIÓN 3** existente no se modifica ni se fortalece. `MAINTAINER-ATTESTED`
no se convierte en `VERIFIED FIRST-PARTY`. Se creó
[`OSS-ASSET-EVIDENCE-REQUEST.md`](OSS-ASSET-EVIDENCE-REQUEST.md) con preguntas
concretas y sin pedir datos personales innecesarios.

Una licencia separada de activos es **SEPARATE ASSET LICENSE REQUIRES
MAINTAINER ATTESTATION**: sólo sería viable después de resolver creación,
fuentes, terceros, términos y permiso de redistribución por familia. No se creó
una licencia ni se redactaron términos jurídicos definitivos.

### Estado global y handoff

- `VERIFIED FIRST-PARTY`: 0.
- `VERIFIED THIRD-PARTY`: 0.
- `AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA`: 3 rutas / 2 archivos únicos.
- `AI-ASSISTED — PROVIDER UNKNOWN`: 3 SVG.
- `DERIVATIVE — SOURCE UNKNOWN`: 1 (`public/boticon.svg`).
- `REVIEW REQUIRED`: 3 SVG; los PWA permanecen `UNKNOWN` por fuente/exportación.
- `REDISTRIBUTION NOT CLEARED`: 9 rutas / 6 familias.
- `DISTRIBUTION CLEARED`: 0; `OFFICIAL IDENTITY — OSS LICENSE EXCLUDED`: 0;
  `PRESENT IN OFFICIAL REPOSITORY — REDISTRIBUTION GRANT NOT ESTABLISHED`: 0;
  `EXCLUDE FROM FUTURE OSS RELEASE ARTIFACT`: 0; `REPLACEMENT REQUIRED`: 0
  como acción ejecutada.
- Activos: `ASSET NO-GO / ASSET REVIEW REQUIRED`.
- Dependencias: `DEPENDENCY CONDITIONAL GO`.
- `OSS.1.4`: `BLOCKED — NO-GO`; `OSS.1.5`: sin cambios; `OSS.2`: `BLOCKED`.
- `AGPL`: prevista, no vigente; `LICENSE`: no creada.
- Siguiente tarea exacta: atender `OSS-ASSET-EVIDENCE-REQUEST.md`; si no hay
  evidencia suficiente, decidir exclusión o sustitución separada por familia.

### Validaciones y límites operativos

Se usaron únicamente código del repositorio, Git y GitHub. Se ejecutaron
`git fetch origin --prune`, estado, hashes, blobs, `git log`, `git show`,
`git cat-file`, `git rev-list`, `git grep`, parser PNG/C2PA local y comparaciones
de píxeles PWA. No se ejecutaron `npm ci`, build, ESLint, Vitest, Supabase,
Vercel, Docker, Ubuntu/Linux como requisito, PostgreSQL, previews,
despliegues, buscadores web, búsqueda inversa, servicios externos, validadores
C2PA remotos ni generadores de imágenes.

No se modificaron activos, código productivo, dependencias, manifests
productivos, `supabase/`, `vercel.json`, `.github/`, `LICENSE` ni el historial.

## OSS.1.4.3 — Declaración del mantenedor y alcance restringido

Fecha de registro: 2026-08-04. Esta sección actualiza el estado agregado de las
seis familias sin borrar ni alterar el inventario, hashes, C2PA, historial,
limitaciones ni la matriz de OSS.1.4.2.

**Resultado OSS.1.4.3: `MAINTAINER DECLARATION RECORDED WITH RESTRICTED ASSET SCOPE`.**

**Estado de activos: `RESTRICTED OFFICIAL IDENTITY — OSS LICENSE EXCLUDED`.**

| Familia | Rutas | Declaración normalizada | Estado vigente |
| --- | --- | --- | --- |
| Icono cuadrado | `icono/icono.png`, `public/icono.png` | Concepto del mantenedor; bocetos propios de cuaderno y lápiz; Claude como asistencia/generación; fuente editable no preservada; no se identifica otro titular. | `MAINTAINER EVIDENCE RECEIVED — RESTRICTED OFFICIAL IDENTITY` |
| Wordmark PNG | `icono/icono-web.png` | Generado o trabajado con Claude bajo dirección del mantenedor; sin plantilla o recurso visual concreto de tercero identificado; fuente editable no preservada. | `MAINTAINER EVIDENCE RECEIVED — RESTRICTED OFFICIAL IDENTITY` |
| Familia PWA | `public/icono-web.png`, `public/pwa-192x192.png`, `public/pwa-512x512.png` | Herramienta web no recordada con certeza; sólo se conservan los archivos; no existe cadena reproducible ni fuente editable. | `MAINTAINER EVIDENCE RECEIVED — RESTRICTED OFFICIAL IDENTITY` |
| Wordmark SVG | `public/log.svg` | Generado con Claude bajo dirección del mantenedor y relacionado con bocetos propios; sin prompt, fuente editable ni términos históricos disponibles. | `MAINTAINER EVIDENCE RECEIVED — RESTRICTED OFFICIAL IDENTITY` |
| Marca SVG | `public/logIcon.svg` | Generado con Claude bajo dirección del mantenedor; relación conceptual con la marca, sin conversión técnica demostrada ni fuente editable. | `MAINTAINER EVIDENCE RECEIVED — RESTRICTED OFFICIAL IDENTITY` |
| Icono del asistente | `public/boticon.svg` | Generado con Claude; deriva conceptualmente del icono oficial de Lanzo; no hay fuente editable ni derivación técnica demostrable. | `MAINTAINER EVIDENCE RECEIVED — RESTRICTED OFFICIAL IDENTITY` |

Todas las familias conservan además `MAINTAINER-ATTESTED`, `NO REDISTRIBUTION
GRANT`, `NO MODIFICATION GRANT`, `TRADEMARK-RESERVED` y
`RELEASE BOUNDARY REQUIRED`. Ninguna se clasifica
como `VERIFIED FIRST-PARTY`, `VERIFIED THIRD-PARTY`, `DISTRIBUTION CLEARED`,
`OPEN ASSET LICENSE` o `ASSET GO`.

### Alcance excluido de la futura licencia del código

Una futura licencia del código, si posteriormente se adopta, no cubrirá
automáticamente las nueve rutas restringidas ni futuras copias exactas,
adaptaciones oficiales de la identidad, versiones oficiales del wordmark,
iconos PWA oficiales, iconos oficiales del asistente o material promocional
que incorpore sustancialmente esta identidad.

La exclusión no se extiende al código fuente, componentes genéricos, estilos
genéricos, funcionalidades, estructuras de base de datos, APIs,
documentación técnica que no incorpore los activos ni contenido creado por
usuarios. No se declara todavía una licencia concreta para el código, no se
crea `LICENSE` y no se declara AGPL vigente.

### Límite de distribución

Los activos permanecen en el repositorio oficial actual para el funcionamiento
y la identidad de producción. Su presencia no constituye un grant general.
Los futuros artefactos OSS deberán definir un límite técnico explícito; los
forks y redistribuciones deberán utilizar identidad propia y no presentarse
como Lanzo-POS oficial. OSS.1.4.3 no elimina, reemplaza ni altera archivos. La
implementación y verificación del límite queda para **OSS.1.4.4 — Implementar y
validar el límite técnico de distribución de los activos oficiales restringidos
sin cambiar la identidad de producción**.

### Consumo actual

Activos consumidos por la aplicación actual: `public/pwa-192x192.png`,
`public/pwa-512x512.png`, `public/logIcon.svg` y `public/boticon.svg`.

Activos sin consumo productivo rastreado: `icono/icono.png`,
`public/icono.png`, `icono/icono-web.png`, `public/icono-web.png` y
`public/log.svg`. Esta distinción no altera su condición de identidad oficial
restringida ni autoriza su redistribución.

### Tratamiento de Claude y C2PA

Claude se registra como herramienta o proveedor declarado por el mantenedor,
evidencia de primera parte no verificada independientemente. No se registra
como material visual de tercero, titular de los activos ni fuente automática
de licencia. No se consultan términos históricos de Claude en Internet y no se
afirma que Anthropic o Claude concedan copyright, transfieran derechos o
permitan o prohíban la redistribución.

Para los PNG con metadata C2PA se conserva exactamente
`AI-ASSISTED — PROVIDER DECLARED IN C2PA METADATA`. La firma está presente pero
no verificada y la cadena de confianza tampoco fue verificada; no se sustituye
por una clasificación de proveedor verificado.

### Estado global posterior a OSS.1.4.3

- Dependencias: `DEPENDENCY CONDITIONAL GO`.
- Evidencia de activos: `EXHAUSTED AND MAINTAINER DECLARATION RECEIVED`.
- Activos: `RESTRICTED OFFICIAL IDENTITY — OSS LICENSE EXCLUDED`.
- OSS.1.4: `BLOCKED — NO-GO (RELEASE BOUNDARY PENDING)`.
- OSS.1.5: sin cambios.
- OSS.2: `BLOCKED`.
- `LICENSE`: no creada.
- AGPL: prevista, no vigente.

OSS.1.4 no pasa a `GO`: todavía falta implementar y verificar el límite
técnico de distribución. Este expediente documental no resuelve por sí solo el
empaquetado ni la redistribución futura.
