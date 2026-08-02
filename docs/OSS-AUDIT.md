# Auditoría de preparación open source de Lanzo-POS

Fecha de revisión: 2 de agosto de 2026
Modalidad: **REMOTE STATIC REVIEW**
Referencia revisada: `docs/oss-foundation-readme` en `c834a6b37006a5fefe3772c4d5eb264d74cf6e49`
Base documental: `bb02da792c09a0c98bdfac3c74d35ab575fb5392`

## 1. Resumen ejecutivo

| Área | Resultado | Severidad | Acción recomendada |
| --- | --- | --- | --- |
| Estado legal actual | BLOCKED | Alta | No presentar todavía el proyecto como software open source formal. Crear `LICENSE` solamente después de cerrar los bloqueantes de titularidad, secretos, dependencias y activos. |
| Autoría y contribuciones | NOT VERIFIED | Alta | Preparar una declaración de procedencia, revisar autores del historial completo y adoptar DCO o un mecanismo equivalente para contribuciones futuras. |
| Secretos y datos sensibles del árbol actual | PASS WITH NOTES | Alta | No se confirmó un secreto completo en los archivos puntuales inspeccionados, pero existen identificadores operativos, rutas locales y datos de negocios reales que deben sanearse. Ejecutar escáneres locales antes de licenciar. |
| Historial Git | NOT VERIFIED | Crítica | Revisar todas las referencias y objetos históricos con `gitleaks` y, si está disponible, `trufflehog`; inspeccionar archivos eliminados y ramas antiguas. |
| Dependencias y licencias | PENDING | Alta | Generar inventario de producción, reporte de licencias, `THIRD_PARTY_NOTICES.md` y SBOM. Resolver paquetes o recursos sin procedencia o licencia verificable. |
| Activos y contenido de terceros | PENDING | Alta | Documentar procedencia y autorización de logos, iconos, imágenes, capturas, datos de ejemplo y recursos externos. |
| Documentación e información operativa | BLOCKED | Alta | Anonimizar, trasladar o retirar reportes con rutas locales, IDs de proyectos, negocios, slugs, pedidos e incidentes reales; revisar también el historial. |
| Arquitectura y autohospedaje | PENDING | Media | Completar variables de entorno de ejemplo, fuentes de funciones faltantes, orden de migraciones y una instalación reproducible probada antes de publicar `SELF-HOSTING.md`. |
| Clave permanente del negocio | PASS WITH NOTES | Baja | Conservarla como identificador canónico del tenant. Documentar su función y distinguirla expresamente de la licencia jurídica del software. |
| Lanzo Local y Lanzo Nube | PASS WITH NOTES | Baja | La oferta administrada es compatible conceptualmente con publicar el código; documentar qué opera localmente y qué depende de servicios administrados. |
| Preparación para `AGPL-3.0-only` | BLOCKED | Crítica | No agregar todavía `LICENSE`. Cerrar los bloqueantes de propiedad intelectual, historial, datos operativos, dependencias y activos. |

**Conclusión ejecutiva:** el repositorio tiene una base técnica y documental suficiente para continuar una iniciativa de apertura, pero **no está listo para adoptar formalmente `AGPL-3.0-only`**. La recomendación de esta auditoría es **NO-GO** para agregar la licencia en el estado actual. El siguiente trabajo debe ser una fase de saneamiento y verificación, no la declaración inmediata de que AGPL ya está vigente.

## 2. Alcance y limitaciones

Esta revisión es una **REMOTE STATIC REVIEW** del árbol accesible en GitHub y de metadatos remotos disponibles. Se inspeccionaron archivos representativos, búsquedas de patrones, el manifiesto npm, documentación operativa y metadatos visibles de commits y pull requests.

No se ejecutaron `gitleaks`, `trufflehog`, un checkout local, un análisis binario de imágenes, una auditoría jurídica, una restauración completa de la base de datos ni una instalación desde cero. Tampoco se inspeccionó exhaustivamente cada objeto de todas las referencias Git. Por ello:

- la ausencia de un hallazgo en esta revisión no demuestra que el historial completo esté limpio;
- una coincidencia de búsqueda no demuestra por sí sola que sea un secreto;
- la licencia declarada por una dependencia no demuestra por sí sola compatibilidad jurídica definitiva;
- la presencia de un archivo en el repositorio no demuestra su autoría o titularidad;
- las conclusiones distinguen evidencia observada, inferencias técnicas y recomendaciones;
- esta auditoría no sustituye asesoramiento jurídico profesional.

No se modificó código, configuración, infraestructura, Supabase, Vercel, dependencias, pruebas, migraciones ni workflows durante OSS.1.

## 3. Estado legal y licenciamiento

### Evidencia observada

- No existe `LICENSE` en el árbol revisado.
- `package.json` no declara el campo `license`.
- `README.md` explica que `AGPL-3.0-only` es la licencia prevista o en evaluación, pero también aclara que todavía no está vigente.
- El repositorio es público en GitHub, pero la visibilidad pública no concede por sí sola una licencia open source.
- No se encontraron en las rutas estándar inspeccionadas:
  - `CONTRIBUTING.md`;
  - `SECURITY.md`;
  - `NOTICE`;
  - `THIRD_PARTY_NOTICES.md`;
  - `SELF-HOSTING.md`;
  - `TRADEMARKS.md`.
- No se confirmó un aviso general de copyright que cubra el proyecto completo.
- `README.md` ya distingue correctamente la futura licencia jurídica del software de la clave permanente usada por Lanzo.

### Evaluación

En su estado actual, Lanzo-POS puede describirse como un repositorio de código fuente públicamente visible, pero **no debe describirse formalmente como software open source licenciado**. Falta un permiso jurídico explícito y todavía no se ha demostrado la cadena completa de derechos necesaria para relicenciar todo el contenido bajo AGPL.

La futura licencia del código y la clave permanente de cada negocio son conceptos distintos:

- `AGPL-3.0-only` regularía permisos y obligaciones sobre el software;
- `license_id`, `license_key` y campos relacionados participan en la identidad operativa del tenant, la autorización y la relación entre módulos.

**Recomendación:** no agregar `LICENSE` hasta cerrar las secciones 4, 5, 6, 7, 8 y 9 de esta auditoría.

## 4. Autoría y contribuciones

### Evidencia observada

- El commit documental revisado, `c834a6b37006a5fefe3772c4d5eb264d74cf6e49`, tiene autor y committer identificados en Git.
- En el conjunto de pull requests remotos inspeccionado, el autor visible es principalmente la cuenta mantenedora `fdxruli`.
- Existen ramas, mensajes y reportes que mencionan trabajo mediante Codex, agentes y validaciones automáticas.
- El conector remoto no devolvió autoría normalizada para todos los commits consultados y no se revisó exhaustivamente el historial completo.
- No existe `CONTRIBUTING.md`, ni se confirmó un Contributor License Agreement, DCO, archivo `AUTHORS` o política equivalente.
- No puede descartarse que existan aportes externos, fragmentos adaptados, archivos subidos manualmente o contenido procedente de terceros.

### Evaluación

No existe evidencia suficiente para afirmar que toda la propiedad intelectual del árbol y del historial está certificada para relicenciarse. El hecho de que buena parte del desarrollo haya usado IA tampoco resuelve automáticamente la titularidad.

El uso de IA **no elimina automáticamente la participación humana del maintainer**. La selección de resultados, integración, corrección, pruebas, revisión, decisiones arquitectónicas y aceptación final pueden reflejar una contribución humana relevante. Debe conservarse evidencia de esas actividades: issues, prompts operativos no sensibles, commits, revisiones, pruebas, decisiones técnicas y registros de aceptación.

### Acciones recomendadas

1. Exportar y revisar la lista completa de autores y committers de todas las referencias.
2. Confirmar por escrito qué personas aportaron código, documentación, diseño o activos.
3. Obtener autorización o rehacer cualquier aporte cuya titularidad no pueda demostrarse.
4. Adoptar DCO para futuras contribuciones y añadir el proceso a `CONTRIBUTING.md`.
5. Mantener trazabilidad de cambios generados con IA y de la revisión humana aplicada.

## 5. Secretos y datos sensibles

### Clasificación de lo observado

#### Claves públicas diseñadas para navegador

- `src/services/supabase.js` y `src/services/supabasePublic.js` usan `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY`.
- `src/services/supabase.js` contiene valores de respaldo para configuración publicable del navegador.

Una clave publishable o anon diseñada para cliente no debe confundirse con `service_role`. Aun así, debe documentarse su alcance, depender de RLS/RPC seguras y evitar que los valores oficiales queden como única configuración implícita.

#### Secretos reales esperados solo en servidor

- `supabase/functions/authorize-image-upload/index.ts` lee `SUPABASE_SERVICE_ROLE_KEY` desde el entorno del servidor.
- `src/services/aiService.js` espera que la función de IA disponga de `AI_API_KEY` u `OPENAI_API_KEY`; no incorpora el valor en el cliente.
- No se confirmó un valor completo de `service_role`, una API key privada, una clave privada PEM o una contraseña de base de datos dentro de los archivos puntuales inspeccionados.

Esta observación **no equivale** a certificar el árbol ni el historial como libres de secretos.

#### Identificadores operativos y datos no secretos que requieren higiene

Se observaron o localizaron referencias a:

- project ref de Supabase en `reports/sec_1_security_surface_report.md` y otros reportes;
- nombres y scopes de proyectos Vercel, IDs sanitizados, hashes y URLs en `docs/reports/ECOM.PUBLIC.DEPLOY.1.1.md`;
- orígenes oficiales por defecto en `src/config/publicOrigins.js`;
- rutas locales en `design-qa.md` y múltiples archivos bajo `docs/reports/`;
- rutas de perfil de Windows, por ejemplo `C:\Users\...`, en reportes históricos;
- el negocio real Entre Alas y un enlace de Facebook en `src/pages/AboutPage.jsx`;
- el negocio y slug de prueba `Farmacia Gary Chrome` / `farmaciagary` en reportes y pruebas;
- códigos de pedidos `EC-*`, folios `V-*`, incidentes y estados de producción en `reports/` y `docs/reports/`;
- archivos históricos `informe_supabase_*` con detalles de infraestructura y modelos de datos;
- una dirección de soporte configurable y una dirección de respaldo en superficies de la aplicación;
- `src/services/support/supportContact.js`, que incorpora la clave de licencia, nombre del negocio y datos del dispositivo en un correo de soporte generado por el usuario.

Los project IDs y URLs públicas no son necesariamente secretos. Sin embargo, la acumulación de identificadores, topología, incidentes y datos reales reduce la limpieza de un repositorio público y puede facilitar reconocimiento de infraestructura.

### Archivos de entorno y respaldos

- `.gitignore` excluye `.env`, `.env.*`, `.vercel/`, temporales y artefactos generados.
- La excepción `!.env.example` está preparada, pero `.env.example` no existe.
- No se confirmó un archivo `.env` rastreado en el árbol revisado.
- La búsqueda remota no sustituye la inspección de objetos eliminados o blobs históricos.

### Resultado

**PASS WITH NOTES para los archivos puntuales inspeccionados; PENDING para el árbol completo; NOT VERIFIED para el historial.**

No deben publicarse valores completos de posibles secretos en reportes, issues o resultados de escáner. Cualquier hallazgo debe redactarse y, si fue real, rotarse antes de limpiar el historial.

## 6. Historial Git

### Evidencia disponible

GitHub permite consultar commits, ramas, pull requests y comparaciones, pero esta revisión no tuvo un clon local completo ni enumeró todos los objetos alcanzables. Se localizaron reportes históricos, nombres de ramas automatizadas, archivos operativos y referencias a incidentes reales.

No se inspeccionaron exhaustivamente:

- blobs de archivos eliminados;
- stashes locales;
- reflogs de computadoras;
- todas las ramas históricas;
- todos los tags;
- objetos no alcanzables;
- forks o copias externas;
- artefactos de CI ya expirados.

### Validación local obligatoria

Ejecutar desde `C:\dev\Lanzo-POS-Git`:

```powershell
git fetch --all --prune
git status --short
gitleaks detect --source . --log-opts="--all" --redact
```

Y, si `trufflehog` está disponible:

```powershell
trufflehog git file://C:/dev/Lanzo-POS-Git --only-verified
```

También se recomienda inventariar objetos históricos y autores:

```powershell
git shortlog -sne --all
git log --all --format="%H%x09%an%x09%ae%x09%cn%x09%ce" > git-authors.tsv
git rev-list --objects --all > git-objects.txt
```

No se ejecutó ninguno de esos comandos durante OSS.1. La revisión completa del historial queda **NOT VERIFIED**.

## 7. Dependencias y licencias de terceros

### Evidencia observada

- `package.json` define dependencias directas de React, Supabase, Dexie, Vercel OG, Google GenAI, FingerprintJS, ZXing, Recharts, Sharp y otras bibliotecas.
- `package-lock.json` contiene metadatos de licencias para múltiples paquetes.
- No existe un inventario legal consolidado ni `THIRD_PARTY_NOTICES.md`.
- No existe un SBOM versionado.
- No se realizó una correlación completa entre cada versión bloqueada, su licencia efectiva, archivos incluidos, avisos y excepciones.
- `sharp` incorpora componentes nativos y requiere revisar también sus distribuciones transitivas.
- `@vercel/og`, SDKs, módulos de autenticación y cualquier contenido descargado o consumido desde servicios externos requieren revisión por versión y uso.
- Las referencias a imágenes externas, por ejemplo imágenes de productos o fuentes de datos públicas, no quedan cubiertas automáticamente por la licencia del paquete npm que las consume.

### Clasificación preliminar

| Categoría | Clasificación | Motivo |
| --- | --- | --- |
| Paquetes con identificador SPDX presente en `package-lock.json` | Compatibles sin observaciones evidentes, de forma provisional | La declaración es evidencia útil, pero debe verificarse contra la versión y el contenido distribuido. |
| Paquetes nativos, renderizadores, SDKs y autenticación | Requieren revisión | Pueden incorporar avisos, binarios, fuentes, datos o condiciones adicionales. |
| Recursos externos que no son paquetes npm | Requieren atribución o revisión | La licencia del cliente no concede derechos sobre cada imagen, dataset, plantilla o servicio consumido. |
| Paquetes o recursos sin licencia identificable | NOT VERIFIED | No se completó un inventario que permita afirmar que no existen. |
| Bloqueante legal confirmado por una dependencia | No confirmado | No se identificó uno de forma concluyente, pero la revisión está incompleta. |

No se debe afirmar compatibilidad jurídica definitiva únicamente por el nombre `MIT`, `Apache-2.0`, `BSD` u otro identificador. Deben revisarse obligaciones de atribución, avisos, modificaciones, distribución de binarios y compatibilidad con el modo concreto de distribución bajo AGPL.

### Entregables de una fase posterior

- `THIRD_PARTY_NOTICES.md`;
- inventario de dependencias directas y transitivas;
- reporte de licencias por versión;
- listado de recursos externos no npm;
- SBOM en un formato estándar;
- registro de excepciones y decisiones de compatibilidad.

## 8. Activos, imágenes y contenido de terceros

### Superficies inspeccionadas

- `public/logIcon.svg`;
- iconos PWA referenciados por `src/pwa/adminManifest.js` y `vite.config.js`;
- logos y portadas cargados por negocios;
- imágenes de productos almacenadas en Supabase o referenciadas externamente;
- capturas y artefactos mencionados en `design-qa.md` y `docs/reports/`;
- ejemplos, fixtures y datos de pruebas;
- documentación técnica y reportes históricos.

### Evaluación preliminar

| Tipo de activo | Estado | Acción |
| --- | --- | --- |
| `public/logIcon.svg` e identidad visual de Lanzo | Origen no certificado por esta revisión | Registrar autor, fecha, archivos fuente y autorización de uso. |
| Iconos PWA de Lanzo | Origen no certificado por esta revisión | Confirmar que derivan de identidad propia y no de una plantilla sin licencia compatible. |
| Iconos de bibliotecas importadas | Provenientes de dependencias | Cubrirlos mediante inventario y avisos de terceros. |
| Logos, portadas e imágenes de negocios | Datos aportados por usuarios o pruebas | No asumir que pueden redistribuirse como parte del repositorio; revisar fixtures y capturas. |
| Imágenes externas de productos | Origen variable | Documentar fuente, términos, atribución y si se almacenan o solo se enlazan. |
| Capturas de producción y artefactos QA | Requieren saneamiento | Retirar o anonimizar información real antes de publicación limpia. |
| PDFs, fuentes, sonidos o plantillas | NOT VERIFIED | No se confirmó un inventario exhaustivo; revisar el árbol y el historial por tipo MIME y extensión. |

No se eliminó ningún activo durante OSS.1.

## 9. Documentación e información operativa

El repositorio mezcla documentación de producto con evidencia de implementación, incidentes y operación. Esa evidencia puede ser útil internamente, pero no toda debe permanecer en un repositorio público de código.

| Ruta o grupo | Hallazgo | Clasificación recomendada |
| --- | --- | --- |
| `README.md` | Visión del producto, arquitectura y estado de licencia | Aceptable públicamente, sujeto a mantener exactitud. |
| `design-qa.md` | Rutas locales absolutas y referencias a capturas en una computadora específica | Debe anonimizarse o trasladarse fuera del repositorio. |
| `docs/reports/ECOM.PUBLIC.DEPLOY.1.1.md` | Rutas locales, proyectos y scope de Vercel, IDs, hashes, URLs y cronología operativa | Debe anonimizarse; parte de la evidencia detallada debe trasladarse fuera. Requiere revisar historial. |
| `docs/reports/ECOM.PUBLIC.SOCIAL.PREVIEW.*` | Arquitectura útil mezclada con slug, negocio, endpoints, despliegues y evidencias de producción | Separar documentación reusable de evidencia operativa; anonimizar y revisar historial. |
| `reports/sec_1_security_surface_report.md` y reportes SEC | Project ref y detalle de superficies de seguridad | Mantener solo el modelo técnico necesario; mover evidencia sensible o demasiado específica. |
| `reports/ecom_*` y `docs/reports/HOTFIX.ECOM.*` | Códigos de pedidos, estados, folios, casos reales e incidentes | Sustituir por fixtures sintéticos; eliminar o trasladar evidencia real; revisar historial. |
| `informe_supabase_*` | Informes históricos de tablas, RPC, licencias, caja, ventas o clientes | Revisar individualmente; probable traslado fuera del repositorio público y saneamiento histórico. |
| `src/pages/AboutPage.jsx` | Historia de Entre Alas y enlace público concreto | Aceptable solo si el titular desea publicarlo de forma permanente; documentar como decisión de marca. |
| `src/config/publicOrigins.js` | Dominios oficiales con override por entorno | Aceptable públicamente si son intencionales y no se tratan como secretos. |
| Pruebas y migraciones con nombres ficticios | Fixtures técnicos | Aceptables si son inequívocamente sintéticos y no reutilizan datos reales. |

Antes de formalizar AGPL debe existir una política clara para separar:

1. documentación pública reusable;
2. runbooks internos;
3. evidencia de incidentes;
4. datos de clientes o negocios;
5. resultados temporales y capturas;
6. secretos o valores que requieran rotación.

## 10. Arquitectura, servicios y autohospedaje

### Componentes ejecutables localmente

- aplicación administrativa Vite/React desde `src/main.jsx`;
- tienda pública desde `src/main-store.jsx` y `vite.store.config.js`;
- almacenamiento local mediante Dexie/IndexedDB;
- funciones locales de productos, ventas, caja, clientes, inventario y reportes según el plan;
- compilaciones npm descritas en `package.json` y `README.md`.

### Dependencias de Supabase

- Postgres, tablas, funciones RPC, RLS y migraciones bajo `supabase/migrations/`;
- Storage para imágenes;
- Realtime y sincronización cloud;
- Edge Function `supabase/functions/authorize-image-upload/index.ts`;
- variables de servidor como `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`;
- contratos de licencias, dispositivos, staff, ecommerce, pedidos y analítica.

### Dependencias de Vercel

- configuración administrativa en `vercel.json`;
- build y proyecto independiente de la tienda pública;
- endpoints de Open Graph y HTML dinámico bajo `store/`;
- dominios oficiales y despliegues separados descritos en `README.md` y reportes.

### Gaps de reproducibilidad

- no existe `.env.example`;
- no existe `supabase/config.toml`;
- el cliente invoca una función de IA configurable cuyo código fuente no se encontró en `supabase/functions/lanzo-ai-agent/index.ts`;
- no existe una guía probada de orden de migraciones, creación de buckets, secretos y despliegue de funciones;
- no se confirmó un seed mínimo completamente sintético;
- no hay instalación Docker declarada;
- no se documentó una alternativa a Vercel para todos los endpoints de tienda;
- no se ejecutó una instalación limpia desde cero durante esta auditoría;
- `package.json` no fija `engines`, por lo que la versión compatible de Node debe documentarse;
- la topología oficial y los dominios son configurables en parte mediante variables, pero existen defaults oficiales codificados.

### Requisitos antes de publicar `SELF-HOSTING.md`

1. Crear una matriz completa de variables públicas y secretas sin valores reales.
2. Incluir `.env.example` con placeholders seguros.
3. Versionar o sustituir todas las funciones necesarias, incluida la IA si forma parte de la distribución.
4. Probar una base Supabase vacía y documentar el orden real de migraciones.
5. Documentar buckets, RLS, grants, RPC, Realtime y secrets.
6. Probar builds administrativo y público fuera de la infraestructura oficial.
7. Definir qué funciones administradas no forman parte de la edición autohospedada.
8. Ejecutar una instalación reproducible y conservar evidencia sanitizada.

No debe publicarse una promesa de autohospedaje completo hasta que ese procedimiento haya sido ejecutado por una persona distinta o en un entorno limpio.

## 11. Clave permanente del negocio

La clave permanente del negocio debe conservarse.

### Función observada e inferida

- identifica de forma estable el tenant o negocio;
- relaciona dispositivos, sesiones, perfil, sincronización y datos cloud;
- participa en ecommerce, catálogo, pedidos, Storage y otras operaciones;
- permite mantener continuidad aunque cambien otros atributos comerciales;
- aparece en contratos frontend y Supabase como `license_id`, `license_key` o variantes según la capa.

### Decisión

- es permanente;
- identifica el tenant;
- conecta ecommerce y demás datos;
- no debe eliminarse;
- no debe desacoplarse del ecommerce únicamente por adoptar una licencia open source;
- **no es la licencia jurídica del software**.

Debe documentarse qué representación es un ID interno, cuál se muestra al usuario, cuál se usa como credencial operativa y qué tokens adicionales autorizan acciones. Los valores reales no deben incluirse en documentación pública, fixtures o resultados de soporte salvo consentimiento y necesidad operativa.

## 12. Lanzo Local y Lanzo Nube

### Lanzo Local

De acuerdo con `README.md`, `src/pages/AboutPage.jsx` y la arquitectura inspeccionada, Lanzo Local concentra:

- operación en un dispositivo;
- persistencia en IndexedDB/Dexie;
- punto de venta;
- caja y cortes locales;
- productos e inventario local;
- clientes y reportes locales;
- operación offline-first;
- respaldo manual/local;
- ausencia de sincronización cloud y administración multi-dispositivo.

### Lanzo Nube

Lanzo Nube agrega servicios administrados que pueden requerir infraestructura y soporte continuos:

- sincronización Supabase;
- varios dispositivos;
- staff, roles, sesiones y permisos;
- datos cloud de productos, ventas, caja, clientes y reportes;
- ecommerce y seguimiento de pedidos;
- Storage de imágenes;
- Realtime;
- IA mediante servicios externos;
- auditoría, trazabilidad y operación administrada;
- despliegue de aplicaciones y endpoints mediante Vercel u otra infraestructura equivalente.

Supabase, Vercel, almacenamiento, tráfico, IA, soporte, monitoreo y administración tienen costos operativos. Cobrar por Lanzo Nube, soporte, hosting, configuración, mantenimiento o servicios administrados **no contradice por sí mismo** que el código se publique bajo una licencia open source.

Esta auditoría no cambia precios, reglas Free/Pro, límites de dispositivos, funciones ni contratos comerciales.

## 13. Evaluación preliminar de `AGPL-3.0-only`

### Aspectos favorables

- La arquitectura cliente-servidor y el servicio accesible por red hacen razonable evaluar una licencia con obligaciones de disponibilidad de código para versiones modificadas ofrecidas como servicio.
- No se confirmó un bloqueante técnico inherente en Supabase, Vercel o el modelo Lanzo Nube.
- Cobrar por hosting y servicios administrados es conceptualmente compatible con licenciar el código.
- `README.md` ya evita afirmar que AGPL está vigente.
- La clave permanente del tenant puede conservarse sin confundirse con la licencia jurídica.

### Bloqueantes o incertidumbres

- no se ha demostrado la titularidad completa del código, documentación y activos;
- no se ha revisado exhaustivamente el historial para secretos y datos eliminados;
- no existe inventario legal de dependencias y recursos;
- existen reportes con datos operativos y casos aparentemente reales;
- no está certificada la procedencia de logos, iconos, imágenes y otros activos;
- no existe política de contribución ni DCO;
- no existe política de marca;
- no existe guía reproducible de autohospedaje;
- no se ha separado formalmente el código AGPL de marcas, servicios oficiales, datos de terceros y credenciales.

No se identificó en esta revisión un conflicto definitivo que haga imposible usar `AGPL-3.0-only`. El resultado es **BLOCKED por falta de verificación y saneamiento**, no una conclusión de incompatibilidad.

No se agregó `LICENSE`, no se copió el texto completo de AGPL y no se modificó la licencia.

## 14. Bloqueantes antes de OSS.2

OSS.2 no debe activar todavía `AGPL-3.0-only`. Deben cerrarse como mínimo:

1. **Historial y secretos:** ejecutar los escáneres locales sobre `--all`, revisar hallazgos, rotar secretos reales y decidir si se requiere reescritura de historial.
2. **Datos operativos:** inventariar y sanear `reports/`, `docs/reports/`, `design-qa.md`, `informe_*`, capturas, artefactos y fixtures con datos reales.
3. **Titularidad:** identificar autores y colaboradores, documentar procedencia y resolver aportes o archivos de titularidad incierta.
4. **Dependencias:** generar el inventario completo, verificar licencias y obligaciones, preparar avisos y SBOM.
5. **Activos:** verificar autoría y autorización de marca, iconos, imágenes, plantillas, datasets y contenido de terceros.
6. **Contribuciones futuras:** preparar `CONTRIBUTING.md`, DCO y proceso de revisión.
7. **Marca:** decidir qué nombres, logos y activos se reservan y preparar una política de marca separada de AGPL.
8. **Autohospedaje:** documentar los gaps de reproducibilidad sin prometer soporte aún no probado.
9. **Revisión final:** obtener revisión jurídica cuando sea posible, especialmente por autoría asistida por IA, activos y modelo de distribución.

## 15. Acciones que requieren la computadora local

### Seguridad e historial

```powershell
cd C:\dev\Lanzo-POS-Git
git fetch --all --prune
git status --short
gitleaks detect --source . --log-opts="--all" --redact
trufflehog git file://C:/dev/Lanzo-POS-Git --only-verified
```

El comando de `trufflehog` debe omitirse si la herramienta no está instalada. Los resultados deben guardarse fuera del repositorio o completamente redactados.

### Autoría y objetos

```powershell
git shortlog -sne --all
git log --all --format="%H%x09%an%x09%ae%x09%cn%x09%ce" > git-authors.tsv
git rev-list --objects --all > git-objects.txt
```

### Inventario y saneamiento

- enumerar archivos por extensión y tamaño;
- revisar `reports/`, `docs/reports/`, `informe_*`, `artifacts/` y respaldos;
- buscar nombres, correos, teléfonos, direcciones, slugs, pedidos, licencias y rutas locales;
- identificar binarios y activos sin archivo fuente;
- generar el inventario de dependencias y licencias desde el lockfile real;
- probar una instalación limpia y los builds documentados;
- probar una instancia Supabase vacía antes de escribir `SELF-HOSTING.md`.

Ninguna de estas acciones se declaró ejecutada en OSS.1.

## 16. Recomendación final

# NO-GO

Lanzo-POS **no debe adoptar formalmente `AGPL-3.0-only` todavía** y OSS.2 no debe crear `LICENSE` hasta cerrar los bloqueantes de la sección 14.

La recomendación no significa que AGPL sea incompatible con Lanzo ni que deba eliminarse la clave permanente. Significa que el repositorio público actual conserva deuda verificable de procedencia, datos operativos, revisión histórica, dependencias, activos y reproducibilidad.

Una vez completados los escaneos locales, el saneamiento del árbol y del historial, la verificación de autoría, el reporte de terceros y la revisión de activos, podrá repetirse esta auditoría con un resultado potencial de **GO WITH CONDITIONS** y entonces iniciar OSS.2 de forma responsable.
