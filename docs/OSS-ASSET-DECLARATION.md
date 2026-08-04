# OSS.1.4B — Declaración de procedencia de activos

## Propósito

Este documento registra la declaración proporcionada por el mantenedor sobre
la procedencia, herramientas, posibles fuentes externas y uso de inteligencia
artificial en los activos gráficos rastreados de Lanzo-POS. La declaración se
mantiene separada de la política de marca: describir el alcance reservado de
una marca no demuestra quién creó un archivo ni qué permiso existe para
redistribuirlo.

Fecha de la declaración: 2026-08-03

Repositorio: `fdxruli/Lanzo-POS`
Commit base auditado: `19f4087bf23b2920154fb72bd6417a4509508ac0` (`origin/main`)

## Alcance

Se revisaron estos nueve archivos rastreados:

- `icono/icono.png`
- `public/icono.png`
- `icono/icono-web.png`
- `public/icono-web.png`
- `public/pwa-192x192.png`
- `public/pwa-512x512.png`
- `public/log.svg`
- `public/logIcon.svg`
- `public/boticon.svg`

No se modificó ni reemplazó ningún activo como parte de OSS.1.4B.

## Declaración proporcionada por el mantenedor

### A. Icono cuadrado principal

Para `icono/icono.png` y `public/icono.png`, el mantenedor declara que fueron
creados específicamente para la identidad de Lanzo-POS por `fdxruli`. No se
conserva documentación suficiente para demostrar que el diseño fue creado
completamente desde cero. No se recuerda ni se ha identificado deliberadamente
una plantilla, imagen, personaje, icono, logo o referencia externa concreta,
pero tampoco puede descartarse de forma absoluta su uso. El uso de IA y las
modificaciones manuales posteriores no están verificados; la herramienta
original no está documentada.

### B. Wordmark o imagen principal

Para `icono/icono-web.png`, el mantenedor declara que es un activo de identidad
de Lanzo relacionado con el logo principal. La persona, herramienta y proceso
exactos no están documentados. No se recuerda el uso deliberado de plantillas o
elementos externos, pero no existe evidencia suficiente para descartarlo por
completo. El uso de IA no está verificado.

### C. Iconos PWA

El mantenedor declara que `public/icono-web.png`, `public/pwa-192x192.png` y
`public/pwa-512x512.png` son variantes de la identidad visual principal. La
auditoría confirma que los dos primeros son idénticos byte a byte. El archivo
de 512×512 es una variante de mayor resolución, pero no se conserva el archivo
fuente ni se recuerda la herramienta de exportación o redimensionado.

### D. Wordmark vectorial

Para `public/log.svg`, el mantenedor declara generación mediante una herramienta
de inteligencia artificial para la identidad de Lanzo-POS. El proveedor o
herramienta concreta no se recuerda y no están disponibles los términos
históricos aplicables. El estado de la tipografía externa no se conocía al
formular la declaración; la inspección del SVG encontró texto con la familia
genérica `sans-serif`, no una fuente embebida ni una referencia externa.

### E. Marca vectorial

Para `public/logIcon.svg`, el mantenedor declara generación mediante IA bajo su
dirección. Representa la misma identidad general de marca, pero no se conserva
evidencia para afirmar que sea una conversión directa, una recreación o una
variante independiente de `icono/icono.png`. No se identificó deliberadamente
un elemento externo concreto, aunque la procedencia completa del resultado no
puede demostrarse.

### F. Icono del asistente

Para `public/boticon.svg`, el mantenedor declara generación o modificación con
IA para representar al asistente de Lanzo-POS. Declara que deriva del logo
principal y que no solicitó ni utilizó deliberadamente otro bot, personaje,
marca o biblioteca de iconos concreta. No se conserva el proveedor de IA ni
documentación que descarte similitudes accidentales.

### G. Nombre e identidad

El mantenedor declara que eligió el nombre `Lanzo` para el proyecto y que no lo
tomó deliberadamente de otro producto, empresa o proyecto. El registro de marca
de `Lanzo` o `Lanzo-POS` es `NO VERIFICADO`; este repositorio no contiene una
prueba de registro. El mantenedor autoriza que `Entre Alas` se mencione
públicamente como origen operativo y patrocinador inicial del proyecto. Esta
autorización no se presenta como prueba independiente de derechos marcarios o
de una autorización permanente de terceros.

### H. Declaración general seleccionada

**OPCIÓN 3.**

No puedo demostrar razonablemente la procedencia completa de uno o más activos.
Aunque el icono principal fue creado por el mantenedor y algunos SVG fueron
generados mediante IA bajo su dirección, no se conservan la herramienta exacta,
los términos históricos aplicables, los archivos originales ni un expediente
completo del proceso de creación de todas las variantes.

Esta selección no afirma que los activos hayan sido copiados ni que exista una
infracción. Indica que la procedencia completa no puede demostrarse con la
evidencia actualmente disponible.

## Resumen por familia

| Familia | Declaración de origen | IA | Material externo declarado | Estado derivado de la declaración |
| --- | --- | --- | --- | --- |
| Icono cuadrado | Creado por `fdxruli`; proceso no documentado | No verificado | Ninguno identificado deliberadamente; no descartado por completo | Procedencia no demostrada |
| Wordmark PNG | Relacionado con la identidad de Lanzo; autor y herramienta no documentados | No verificado | No recordado; no descartado por completo | Procedencia no demostrada |
| Iconos PWA | Variantes de la identidad principal; fuente y herramienta no documentadas | No indicado | Ninguno identificado | Procedencia no demostrada |
| Wordmark SVG | Generado con IA bajo dirección del mantenedor | Sí, proveedor desconocido | Ninguno identificado en el SVG | Revisión requerida |
| Marca SVG | Generada con IA bajo dirección del mantenedor | Sí, proveedor desconocido | Ninguno identificado en el SVG | Revisión requerida |
| Icono del asistente | Generado/modificado con IA; declarado derivado del logo | Sí, proveedor desconocido | Ninguno identificado deliberadamente | Revisión requerida |

## Herramientas y evidencia técnica

La auditoría utilizó Git, `git hash-object`, `Get-FileHash`, inspección de
dimensiones PNG mediante `System.Drawing`, comparación visual local, `git log
--follow`, `git grep` e inspección textual de los SVG. Estas herramientas se
usaron para auditar el repositorio, no para crear o rediseñar activos.

No se identificó la herramienta de diseño original, exportación, redimensionado
ni el proveedor de IA de ninguna familia. Codex no creó, editó ni reemplazó los
activos inspeccionados.

## Material externo y uso de IA

No se identificó dentro de los nueve archivos una imagen embebida, `data:` URI,
enlace externo, biblioteca de iconos, plantilla, nombre de proveedor de diseño
o tipografía externa concreta. `public/log.svg` usa la familia genérica
`sans-serif`; no contiene un archivo de fuente ni una licencia de fuente
embebida. El contenido autocontenido del SVG no demuestra por sí solo la
procedencia del diseño que produjo sus formas.

El mantenedor declara uso de IA para `public/log.svg`, `public/logIcon.svg` y
`public/boticon.svg`, pero no recuerda el proveedor. Por tanto no pueden
verificarse los términos de uso comercial o redistribución aplicables en la
fecha de creación. La declaración tampoco afirma autoría exclusiva,
copyright garantizado o ausencia absoluta de similitudes con terceros.

## Limitaciones

- La declaración del mantenedor es evidencia de primera parte, no una
  verificación independiente frente a terceros.
- Un commit `Add files via upload` y la autoría Git `fdxruli` prueban la
  incorporación al repositorio, no la autoría material, cesión, licencia o
  permiso de redistribución.
- No están disponibles los archivos originales, prompts, historial de diseño,
  proveedor de IA, modalidad de cuenta ni términos históricos.
- No se realizó una búsqueda marcaria exhaustiva ni se afirma que `Lanzo`,
  `Lanzo-POS` o `Entre Alas` estén registrados.
- La autorización declarada para mencionar a `Entre Alas` no sustituye una
  autorización documentada de derechos de terceros.
- Las conclusiones de esta declaración no son asesoramiento jurídico.

## Firma textual

`fdxruli — mantenedor de Lanzo-POS`

Esta firma identifica la declaración pública del mantenedor; no es una firma
criptográfica ni una certificación independiente.
